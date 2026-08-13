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
// reference height it is built at belong to `web/bloom-pass.js`, and the grade below owns
// only its own shader - so this file changes when the pipeline gains or loses a stage, and
// for nothing else.
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

const GradeShader = {
  uniforms: {
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
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  // One combined pass: chaining separate RGBShift/Film/Vignette passes would cost
  // a full-screen read and write each.
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float rgbSplit, scanlines, grain, vignette, crush, time;
    uniform float streak;
    uniform vec2 streakAxis;
    uniform vec2 scanAxis;
    uniform float scanPitch, scanHard;
    uniform vec2 resolution;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      // The same 1080p reference the point pass in web/cloud-shader.js uses. Every term
      // here is sized in reference pixels rather than framebuffer ones, so the grade a
      // look was built at holds at any output size: without it the split narrows, the
      // scanlines crowd and the grain thins as resolution rises - a look that is
      // *nearly* resolution-independent, which is the kind you trust and then have
      // to debug. Bloom needs none of this and gets none, and by a different mechanism
      // rather than by no mechanism: its chain is frozen at a fixed reference height by
      // bloomChainSize in web/bloom-pass.js, because that pass bakes its tap count into
      // its shaders at construction and so has no term to express in these units.
      float k = resolution.y / 1080.0;
      vec2 ref = resolution / k;
      vec2 texel = 1.0 / ref;
      vec3 col;

      if (rgbSplit > 0.0) {
        // Split grows toward the edges, so the centre stays legible.
        vec2 dir = (vUv - 0.5);
        vec2 off = dir * rgbSplit * texel * 8.0;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }

      // Light bleeds. Each pixel gathers back along the streak's own axis and keeps the
      // brightest thing it finds, decayed by how far it had to look, so a highlight smears
      // across the frame the way a sensor smears one down a column of wells. It sits here,
      // below the raster and the vignette and above the tonemap, because it is a thing that
      // happened to the light rather than a thing drawn over the picture: a streak applied
      // after the vignette would glow in the corners the vignette had just put out.
      //
      // **A gather and not a feedback buffer**, which is a decision rather than a
      // simplification. A buffer accumulating across frames smears along whatever the
      // camera did last, so an orbit would drag every streak sideways, and - the half that
      // settles it - a seek would arrive carrying the streak the scrub built rather than
      // the one playback would have built. That is the property the whole transport rests
      // on, broken by an effect nobody would think to test it against.
      //
      // Distances are in reference pixels through texel, for the reason stated at the top
      // of this shader: a streak whose length grew with the window would be the nearly
      // resolution-independent look that is worse than an honestly dependent one. The axis
      // is a *direction* in those same reference pixels rather than in uv, which is the
      // half that keeps the angle honest: the offset below is d reference pixels along the
      // axis whatever shape the window is, where a step taken in uv and scaled afterwards
      // would run at the aspect ratio's angle instead of the one the slider names, and
      // would swing as somebody dragged the window.
      //
      // **The tap schedule is written down because the first one was wrong.** Eight taps at
      // a geometric ratio of 2.1 put the far samples so far apart that they land as separate
      // ghosts - a comb rather than a smear. Sixteen at 1.35 overlap enough to read as
      // continuous and reach about 168 reference pixels.
      //
      // **The direction is the measurement and not the derivation, and the cost of getting
      // that backwards is recorded here because it was paid twice.** When this gather ran
      // one way only it was written with the plus, doubted against a busy frame that seemed
      // to show the light climbing, flipped to a minus, and then restored - because a build
      // cropped down to a single bright band with darkness above and below settles in one
      // look what a full frame full of structure will support either reading of. Two
      // separate readings of the *same* sign came out opposite. Nothing in the suite could
      // have caught the flip: every uniform still landed and every image still changed, so
      // the drop-one sweep stayed green through all of it.
      //
      // That sign is now a whole direction, and the lesson is the same one scaled up: the
      // arm in the registry check calibrates *both* screen axes off the crop's own faces
      // and asks where each angle's light actually lands, rather than deriving where it
      // ought to from which way uv grows - which is the derivation that was wrong the first
      // time. An angle of 0 keeps the fall this always had, and it keeps it exactly: at the
      // default axis the offset below renders bit-identical to the plain vertical vec2 it
      // replaces, measured at four looks and three drawing-buffer sizes, so there is no
      // guard here of the kind the raster below needs. Multiplying by an axis that is
      // exactly zero and exactly one introduces no rounding, where the raster's general
      // form is a dot product against a sum the compiler contracts differently.
      if (streak > 0.0) {
        vec3 fall = col;
        float d = 1.5;
        for (int i = 0; i < 16; i++) {
          vec3 tap = texture2D(tDiffuse, vUv + d * texel * streakAxis).rgb;
          fall = max(fall, tap * exp2(-d * 0.02));
          d *= 1.35;
        }
        col = mix(col, fall, streak);
      }

      if (scanlines > 0.0) {
        // **The default path is the old line itself, not an expression that computes what
        // the old line computed**, and that distinction is a measurement rather than
        // caution. The shipped Blackwall document names a scanlines of 0.35, so this block
        // runs in the one shipped look that is a look, and a raster a hair off the one it
        // replaces is that document quietly re-grading itself.
        //
        // Two things were tried before this and both failed, which is worth recording
        // because each looked like the answer. Taking the sine and cosine of the angle in
        // the shader leaked a whisker of x into a raster meant to run along y, since GLSL
        // ES does not promise the sine of zero is zero - that is real and is why the axis
        // is built on the CPU, but fixing it moved nothing here. What moves the frame is
        // the substitution docs/measurement.md already records: handing the wave a
        // coordinate through a local is not the same as handing it the expression, because
        // the compiler contracts the whole of y times the reference times 1.3 plus the
        // clock across one line and will not do so through a variable. Measured at the
        // shipped 0.35, all six frames differed, 054b99215d9f against 44e1ccf8, with every
        // parameter at its default.
        //
        // So the branch goes around the whole statement and the default path *is* the old
        // one - the same shape, and for the same reason, as the depth reading's gamma in
        // web/cloud-shader.js. It is not a legacy path beside a new one: the general form
        // below is the implementation, and this is the one input for which the arithmetic
        // has to be reached rather than reproduced.
        float line;
        if (scanAxis.x == 0.0 && scanAxis.y == 1.0 && scanPitch == 1.3 && scanHard == 0.0) {
          line = sin(vUv.y * ref.y * 1.3 + time * 2.0) * 0.5 + 0.5;
        } else {
          // The raster's own axis, as a direction in reference pixels, built on the CPU
          // for the reason beside the uniform.
          float coord = dot(vUv * ref, scanAxis);
          float wave = sin(coord * scanPitch + time * 2.0) * 0.5 + 0.5;
          // Hardness is a duty cycle rather than a second term. It narrows a smoothstep
          // about the middle of the wave until the sine becomes a grille of hard lines
          // with dark gaps between them, which is what the reference frames actually
          // carry and what no amount of rotating a sine will ever reach.
          float w = mix(0.5, 0.004, scanHard);
          line = mix(wave, smoothstep(0.5 - w, 0.5 + w, wave), scanHard);
        }
        col *= 1.0 - scanlines * 0.35 * line;
      }

      if (grain > 0.0) {
        // Weighted by luminance so grain lives in the signal instead of lifting
        // the empty background into a grey haze.
        //
        // Quantised onto the reference grid rather than sampled continuously, so
        // one grain cell is one 1080p pixel wherever the frame is drawn. Sampling
        // continuously would give four sub-pixels of a 2x render four unrelated
        // hash values that average to a quarter of the variance, which is exactly
        // the "grain grows finer as resolution rises" this reference exists to
        // stop. At 1080p it is the same one-value-per-pixel noise it always was,
        // off a different seed.
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        float n = hash(floor(vUv * ref) + fract(time) * 137.0);
        col += (n - 0.5) * grain * 0.22 * (0.15 + lum);
      }

      // How far the frame closes down on the subject, which used to be the literal 0.55
      // and therefore a hidden function of whether any of the three terms above was up.
      // The extent is still fixed - a vignette this look wants is a corner falloff and
      // not a shape to author - so the parameter is the depth alone.
      float vig = smoothstep(1.05, 0.32, length(vUv - 0.5));
      col *= mix(1.0, vig, vignette);

      // Roll highlights off per channel instead of letting additive accumulation
      // clip to flat white - hot areas keep their hue this way.
      col = col / (1.0 + col);
      // Then crush the toe back down: Reinhard lifts blacks, and this look needs
      // the empty space to stay genuinely black rather than dark red.
      //
      // The gain stays a literal while the toe becomes a parameter, and that asymmetry is
      // measured rather than lazy. The obvious reading - that 1.12 normalises the toe back
      // out and so should follow it - is wrong: a toe of 0.018 would normalise at 1.018,
      // so 1.12 is an independent graded lift that happens to sit near it. Tying the two
      // together would re-grade every look ever authored the moment anybody moved the toe,
      // which is a whole preset library drifting to buy a tidier-looking line.
      col = max(col - crush, 0.0) * 1.12;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
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
 */
export function buildPostChain() {
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, viewCamera);
  composer.addPass(renderPass);

  afterimage = new AfterimagePass(0.0);
  afterimage.enabled = false;
  composer.addPass(afterimage);

  bloom = new BloomPass(0.0, 0.7, 0.2);
  bloom.enabled = false;
  composer.addPass(bloom);

  grade = new ShaderPass(GradeShader);
  grade.enabled = false;
  composer.addPass(grade);

  composer.addPass(new OutputPass());
}
