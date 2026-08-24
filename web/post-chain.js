// Which passes the picture goes through after the cloud is drawn, and in what order.
//
// The order is the whole of this file's opinion, and it is deliberate rather than
// incidental: trails accumulate the raw cloud, bloom blows out the hot edges of what the
// trails left, and then the grade tears the finished image the way a failing signal
// would. Reordering any two of them is a different look and not a different arrangement
// of the same one - a grade before the bloom would have the glow blooming the tearing
// rather than the picture, and trails after the bloom would smear a halo across the frame
// instead of the cloud that earned it. That is why the four `addPass` calls are here and
// not spread across the callers that switch each pass on.
//
// What is *not* here is any opinion about the passes themselves. The halo's shape and the
// reference height it is built at belong to `web/bloom-pass.js`, and the grade's own text
// belongs to `web/grade-shader.js` and to the packages that splice into it - so this file
// changes when the pipeline gains or loses a stage, and for nothing else.
//
// **The grade's GLSL left and its uniforms stayed**, which is the seam the split put here
// rather than an accident of how far the move got. A uniform's default is a constructed
// object - two of them are a `THREE.Vector2` - and the spine constructs nothing, because the
// gate that holds the assembled text against the literal git history carries has to evaluate
// that spine under bare node, with no three.js anywhere. So the text went to a file that
// imports nothing and the table stayed beside the pass it feeds. What pairs the two is
// `test/cloud-shader.test.mjs`, which reads every `uniform` line of both assembled programs
// against the tables that feed them: a uniform with no key here reads a silent zero, and a
// key with no uniform is a write per frame that reaches no pixel.
//
// **Nothing is allocated and no GL is touched while this module evaluates.** The composer,
// the four passes and the render targets under them are built by `buildPostChain`, which
// `web/main.js` calls at the point in its boot it writes out - because a module body runs
// to completion before its importer's first statement, so a composer constructed up here
// would put the order the GPU sees at the mercy of how the import list happens to be
// sorted. `new EffectComposer(renderer)` is the sharpest case: it reads the renderer's
// pixel ratio and allocates a pair of full-size targets in its constructor, so it cannot
// run before `web/scene.js` has a canvas.

import * as THREE from 'three';
import { renderer, scene, viewCamera } from './scene.js';
import { BloomPass } from './bloom-pass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The chain and the four passes in it, as live bindings assigned once by the build below.
// They are read all over `web/main.js` - the render loop drives the composer, `resize`
// sizes it, the registry's `apply` functions write the look's terms into the passes and
// the camera switch repoints the render pass - and none of that is a write this file can
// take over without becoming the registry. Each is a three.js object whose published
// interface is exactly those property writes, which is what the entries in
// `tools/module-check.mjs` say and why they are there rather than being wrapped.
export let composer = null;
export let renderPass = null;
export let afterimage = null;
export let bloom = null;
export let grade = null;

// Every cell the grade's shader reads, with the value it holds before a look lands. The
// text that reads them is assembled from `web/grade-shader.js` and the installed packages
// and arrives at `buildPostChain` below, so this is the whole of what stayed: a default a
// package cannot carry, because two of them are constructed objects.
const GRADE_UNIFORMS = {
  tDiffuse: { value: null },
  rgbSplit: { value: 0 },
  scanlines: { value: 0 },
  // The three that turn one scanline term into a raster, and they are settings of
  // `scanlines` rather than terms beside it. A raster is one idea and a sine is its
  // softest duty cycle, so two terms that both darken the frame in stripes would be the
  // drifting twin this file keeps refusing - and the hardness is what makes the other
  // two reach anything, because adding an angle to a sine only ever gets you rotated
  // softness where the reference frames are hard line grilles with dark gaps.
  //
  // The angle arrives as its own axis rather than as an angle, and that is a rounding
  // measurement rather than a preference - the same shape `contourLo`/`contourHi` in
  // `web/cloud-shader.js` are two uniforms for. Taking `sin` and `cos` in the shader
  // looked obviously right and was measured wrong: GLSL ES permits a couple of
  // thousandths of absolute error on a trigonometric function, so `sin(0.0)` is not
  // promised to be exactly zero, and a whisker of x leaking into a raster that is
  // supposed to run along y moved all six frames of the comparison against the build
  // this replaces. Done here, `Math.sin(0)` is exactly 0 and `Math.cos(0)` exactly 1 in
  // double, they survive the cast, and the dot below collapses to the frame's own y the
  // way the old line's expression did.
  //
  // Degrees on the slider, and at zero the raster runs along y - the scanline this has
  // always drawn. At a right angle it is the dense vertical column grille the reference
  // frames slice their picture into, and because it keyframes a raster can *rotate*
  // under the playhead, which is a capability rather than parity with a still frame.
  //
  // `scanPitch` was the literal 1.3 baked into the wave, and it defaults to it.
  scanAxis: { value: new THREE.Vector2(0, 1) },
  scanPitch: { value: 1.3 },
  scanHard: { value: 0 },
  grain: { value: 0 },
  // The corner falloff, which was the literal 0.55 and applied whenever this pass ran
  // at all. That made it a hidden function of the three terms above: a look with all
  // of them at zero switched the pass off and lost its vignette, so the comment below
  // claiming the frame "always closes down on the subject" was false in exactly the
  // state the four shipped presets other than Blackwall are in.
  //
  // It defaults to 0 rather than to the 0.55 it was, and that is the one place in this
  // file where a promoted literal does not keep its value. It cannot: the behaviour it
  // replaces is not a constant but a conditional - 0.55 when something else was on, 0
  // when nothing was - and no single default reproduces both branches. Zero is the
  // branch that keeps the parameter defaults drawing what they drew, which is what
  // registry-check hashes against a build from before any of this existed.
  // `blackwall.json` names 0.55 explicitly so the one shipped look that had a vignette
  // keeps it. A project saved before this that raised any grade term is the case that
  // does change: it loses its corner falloff until it names one.
  vignette: { value: 0 },
  // The toe under the Reinhard curve, promoted from the literal 0.018 - and unlike
  // `vignette` above it this one keeps the value it replaced, because the behaviour it
  // replaces is a constant rather than a conditional. That difference decides the whole
  // of how it is wired: a non-zero default cannot gate the pass, so `crush` is a
  // sub-control inside the grade rather than a fifth term beside the four that gate it.
  // See its entry in the registry in `web/main.js` for what gating it would have cost.
  //
  // **It is not the silhouette crush, whatever the name suggests**, and the comment is
  // here to stop the next reader concluding that it is. This darkens near and far alike,
  // so it cannot separate a subject from the space behind it; the term that does that is
  // the duotone in the point shader, in `web/cloud-shader.js`. What this is for is the
  // thing it always did - keep the empty background genuinely black after Reinhard lifts
  // it.
  streak: { value: 0 },
  // Which way the light runs, as its own axis rather than as an angle, for exactly the
  // reason `scanAxis` forty lines up carries in full: GLSL ES permits a couple of
  // thousandths of absolute error on a trigonometric function, so `sin(0.0)` is not
  // promised to be exactly zero, and a whisker of the wrong axis leaking into a fall
  // that is meant to run straight down the frame is a defect no picture shows the shape
  // of. Done here, `Math.sin(0)` is exactly 0 and `Math.cos(0)` exactly 1 in double,
  // they survive the cast, and the offset in the gather below collapses to the frame's
  // own y at the default the way the one-direction version's expression did.
  //
  // Degrees on the slider, and unlike the glitch's `glitchAxis` in `web/cloud-shader.js`
  // that is the honest spelling rather than the lazy one. The tear's bands are quantised
  // in the sensor's frame, where 512 columns meet 424 rows and a band is a run of
  // scanlines rather than a distance, so there is no square in which an angle would mean
  // what an angle means. This runs in the grade pass, in screen space, against a square
  // reference pixel - so an angle here means what an angle means, and turning it 90
  // degrees turns the streak 90 degrees on the glass.
  streakAxis: { value: new THREE.Vector2(0, 1) },
  crush: { value: 0.018 },
  time: { value: 0 },
  resolution: { value: new THREE.Vector2(1, 1) },
};

/**
 * Builds the composer and hangs the four passes off it, in the order the header names.
 *
 * Called after the cloud exists rather than before it, because `RenderPass` is handed the
 * scene it will draw - it holds it by reference and would happily be built first, but the
 * order this program boots in is written out in `web/main.js` rather than inferred, and a
 * pass built before the thing it renders is a sentence nobody reading that boot could
 * check.
 *
 * Every pass but the render and the output starts switched off. That is not a default
 * anybody chose twice: the registry writes each look term into its pass at boot and
 * enables the pass on a non-zero value, so a chain that came up enabled would pay a
 * full-screen read and write per pass for the fraction of a second before the first look
 * lands, on every surface including the ones that never grade anything.
 *
 * `gradeProgram` is the assembled `{ vertexShader, fragmentShader }` pair, handed in for
 * the same reason `buildPointCloud` is handed its own: the packages the text comes from
 * were fetched by `web/main.js`, so this module builds a pass without ever knowing there is
 * a server - which is what lets the gate run the same assembler under bare node with the
 * packages read off disk instead.
 */
export function buildPostChain(gradeProgram) {
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, viewCamera);
  composer.addPass(renderPass);

  afterimage = new AfterimagePass(0.0);
  afterimage.enabled = false;
  composer.addPass(afterimage);

  bloom = new BloomPass(0.0, 0.7, 0.2);
  bloom.enabled = false;
  composer.addPass(bloom);

  // One combined pass: chaining separate RGBShift/Film/Vignette passes would cost
  // a full-screen read and write each.
  grade = new ShaderPass({
    uniforms: GRADE_UNIFORMS,
    vertexShader: gradeProgram.vertexShader,
    fragmentShader: gradeProgram.fragmentShader,
  });
  grade.enabled = false;
  composer.addPass(grade);

  composer.addPass(new OutputPass());
}

/**
 * The grade's program, replaced without replacing the pass.
 *
 * **The pass's identity is what the chain is built out of.** `composer` holds it at a
 * position between the bloom and the output that this file's whole argument is about,
 * `gradeNeeded` in `web/main.js` switches it on and off, and every one of the nine
 * uniforms the look writes is a cell in `GRADE_UNIFORMS` that this pass's material
 * composed by reference. Building a new `ShaderPass` would put the new program in a pass
 * that is in no chain, leaving the drawn image on the old one - which is the shape of
 * failure this program keeps writing case files about, because the picture still comes out
 * and nothing says which program drew it.
 *
 * Here rather than at the call site for the same reason `setCloudProgram` is: `grade` is
 * an exported binding, and a module reaching into an imported object is the channel
 * `tools/module-check.mjs` refuses. Its uniform table is exempt there and is written from
 * `web/main.js` on every look parameter; the material is not, and swapping a program is
 * this file's own business.
 */
export function setGradeProgram(gradeProgram) {
  grade.material.vertexShader = gradeProgram.vertexShader;
  grade.material.fragmentShader = gradeProgram.fragmentShader;
  grade.material.needsUpdate = true;
}
