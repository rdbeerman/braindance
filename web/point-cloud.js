// What a point in the cloud is made of, and how it is addressed.
//
// One depth pixel is two vertices, one uniform table and one material, and those three
// facts are the whole of this file's opinion. The table is the only channel there is for
// telling the shaders anything - a uniform is a cell the GPU reads, so a look parameter
// landing anywhere else lands nowhere - and the geometry is the addressing scheme that
// decides which texel each of those vertices reads. They are one file because they are one
// decision: change how a point is addressed and both the attribute layout and the shader's
// unprojection change together.
//
// The crop predicate at the foot is here for the same reason rather than in a file of its
// own. It reads the table's own faces directly, and its comment says why a second spelling
// of that test is a second place for the next face to be forgotten - the module that owns
// the table is the module that owns the predicate over it, which a boundary between them
// would turn back into a promise.
//
// **Nothing is allocated, no GL is touched and nothing joins the scene while this module
// evaluates.** The geometry, the table, the material and `scene.add(cloud)` are all inside
// `buildPointCloud`, which `web/main.js` calls at the point in its boot it writes out -
// because a module body runs to completion before its importer's first statement, so a
// cloud built up here would put the moment it joins the scene at the mercy of how the
// import list happens to be sorted. Two of the table's values make that unavoidable rather
// than merely tidy: the four source cells come back from `buildTextures` and `stateTex`
// reads a render target `buildSurfaceMemory` has not made yet, so a table built at
// evaluation time would hold nulls for both.

import * as THREE from 'three';
import { DEPTH_H, DEPTH_W, POINTS } from './format.js';
import { scene } from './scene.js';
import { cloudSpine } from './cloud-shader.js';
import { assembleShaders } from './shader-assembly.js';
import { statePrev } from './surface-memory.js';

// The depth pair's defaults, named once because three separate things have to agree
// about them: the two uniforms in the table below, the `near` and `far` entries in
// `web/main.js`'s registry that overwrite them at boot, and `duotoneSpan`, whose default
// is the width of the range these two describe.
//
// They are exported for the registry's sake rather than for the shader's. The entries
// there name these bindings instead of restating 0.05 and 6, which is what keeps the
// boot write agreeing with what the table came up holding - and the identity the duotone's
// own comment rests on is the same one: `6.0f - 0.05f` and `5.95f` round to one float32,
// so a document naming no span renders what it rendered before the span existed.
//
// **Naming them is a repair rather than tidiness.** The uniforms carried 0.5 and 4.5
// while the registry carried 0.05 and 6, and the registry won at boot - so the two
// numbers that looked like the clip range were a range no build has opened at since the
// registry existed, sitting where anybody reading the shader's neighbours would take them
// for the answer.
export const CLIP_NEAR_DEFAULT = 0.05;
export const CLIP_FAR_DEFAULT = 6;

// The cloud as four live bindings, assigned once by the build below and read from
// `web/main.js` for the rest of the program's life: the registry writes the look into the
// table, the transport writes the pair of frames the playhead sits between, the draw range
// follows the shedding switch and the levelling turns the points themselves. None of that
// is a write this file can take over without becoming the registry, which is why only the
// table has an entry in `tools/module-check.mjs` - a uniform cell is the interface three.js
// publishes, and the other three are reached through their own methods rather than written
// into.
export let geometry = null;
export let uniforms = null;
export let material = null;
export let cloud = null;

/**
 * Builds the geometry, the uniform table, the material and the cloud, and puts it in
 * the scene.
 *
 * `sourceCells` is what `buildTextures` handed back, passed in rather than imported so the
 * one place the two are wired together is the boot `web/main.js` writes out. The cells are
 * composed into the table by reference and never copied out of, which is what lets the
 * depth and colour doors reach this shader without importing the material they feed.
 *
 * Called after the surface memory as well as after the textures, because `stateTex` is
 * seeded with the ghost target that exists by then - and that seed is not dead, it is what
 * the first frame samples before the first step of the memory has run.
 *
 * `packages` is the installed effects, each with its manifest and the text of the chunks
 * it declares, and it is passed in for the same reason the cells are: the fetch that
 * produced them is `web/main.js`'s, so this module compiles a shader without ever knowing
 * there is a server - which is what lets the gate run the same assembler under bare node
 * with the packages read off disk instead.
 */
export function buildPointCloud(sourceCells, packages) {
  // Two vertices per depth pixel: one for the live point, one for the ghost it
  // leaves behind. Shedding needs both on screen at once. The ghost half is left
  // out of the draw range entirely when nothing can be shed, so it costs nothing.
  geometry = new THREE.BufferGeometry();
  const pixelCoords = new Float32Array(POINTS * 2 * 3);
  const slotAttr = new Float32Array(POINTS * 2);
  for (let slot = 0; slot < 2; slot++) {
    for (let row = 0, i = 0; row < DEPTH_H; row++) {
      for (let col = 0; col < DEPTH_W; col++, i++) {
        const k = slot * POINTS + i;
        pixelCoords[k * 3] = col;
        pixelCoords[k * 3 + 1] = row;
        pixelCoords[k * 3 + 2] = 0;
        slotAttr[k] = slot;
      }
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(pixelCoords, 3));
  geometry.setAttribute('aSlot', new THREE.BufferAttribute(slotAttr, 1));
  geometry.setDrawRange(0, POINTS);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -3), 12);


  uniforms = {
    // The four source textures, referenced rather than restated: these are the same cells
    // `gpu-textures.js` writes when its door swaps a frame in, so what the shader samples
    // and what the door last bound cannot come apart. A fresh `{ value: depthPrev }` here
    // would read correctly at boot and then hold the first frame forever.
    depthPrev: sourceCells.depthPrev,
    depthCurr: sourceCells.depthCurr,
    colorPrev: sourceCells.colorPrev,
    colorCurr: sourceCells.colorCurr,
    mixT: { value: 1 },
    // How far apart the two bound frames are, in seconds, which is what turns a depth
    // difference into a speed. `mixT` says where inside the pair the playhead sits and
    // `sinceFrameSec` says how far past the older one it has come; neither is the gap,
    // and reconstructing it as the second over the first is degenerate at the head of
    // every pair. So the transport hands it over as its own number.
    //
    // One second at boot, and it is a placeholder rather than a gap anybody should read
    // a frame rate into. Nothing divides by it before the transport writes it: both depth
    // textures are zero-filled until the first bind, so every point leaves at the empty
    // sample test the vertex stage in `web/cloud-shader.js` makes above the division, and
    // the transport writes this beside `mixT` before the render that would reach it.
    // Copying the transport's own nominal gap here would be a second declaration of the
    // frame rate in a second file, for a value that cannot reach a pixel.
    spanSec: { value: 1 },
    snapDelta: { value: 250 },
    interpolate: { value: 1 },
    focal: { value: new THREE.Vector2(366, 366) },
    center: { value: new THREE.Vector2(256, 212) },
    resolution: { value: new THREE.Vector2(DEPTH_W, DEPTH_H) },
    // The drawing buffer's height, which is what makes every screen-space term in
    // `web/cloud-shader.js` a fraction of the frame rather than a count of pixels.
    // Written by `resize` in `web/main.js` and by nothing else, so the one place the
    // buffer can change is also the one place this can.
    bufferHeight: { value: 1080 },
    // What this hardware will rasterise a point sprite at, which is the ceiling the glyph
    // field's grown sprite is clamped to instead of the literal 64 the old path keeps.
    // Written once at boot in `web/main.js` out of ALIASED_POINT_SIZE_RANGE, and not a
    // registry parameter: it is a bound on the machine rather than a value anybody chose,
    // it has nothing to keyframe into, and a preset naming it would carry one GPU's limit
    // to another. The 64 here is the literal it stands in for, so a frame reached before
    // that write draws what the shipped clamp always drew.
    pointCeiling: { value: 64 },
    pointSize: { value: 9 },
    opacity: { value: 1 },
    exposure: { value: 1.15 },
    nearClip: { value: CLIP_NEAR_DEFAULT },
    farClip: { value: CLIP_FAR_DEFAULT },
    // The four lateral faces of the box `nearClip`/`farClip` already close in depth.
    // Metres in the sensor frame, and absolute plane positions rather than insets from
    // an edge, because the sensor's frame widens with depth and an inset would have to
    // name a depth to mean anything. A cuboid names none.
    //
    // Wide open by default: `farClip` reaches 9.5m and the sensor sees 256/fx and 212/fy
    // of that laterally, so +/-6.65m across and +/-5.50m up at the far end of what any
    // slider can ask for. Seven clears both, which is what keeps a project saved before
    // these existed from loading with its subject clipped.
    cropL: { value: -7 },
    cropR: { value: 7 },
    cropB: { value: -7 },
    cropT: { value: 7 },
    // Whether those six faces actually cut, and what a point on the wrong side of them
    // looks like while somebody is editing them. The two are deliberately different
    // kinds of thing and the split is the whole design.
    //
    // `cropOn` is the `crop` parameter's landing site: document state, keyed and
    // exported like every other look value, and it **gates the discard rather than
    // moving the planes**. That is what lets one switch cover all six faces including
    // the depth pair, which the fragment stage also normalises its depth ramp against -
    // a switch that opened `nearClip`/`farClip` instead would re-grade every point still
    // inside the box, and the A/B would stop being an A/B.
    //
    // `cropOutside` is the alpha a cut point draws at instead of vanishing, and it is
    // viewer-only: derived from the crop box being on screen, never assigned, and zero
    // in every path that produces a deliverable because those paths already take the
    // chrome off. Zero also means the discard comes back, which is not a shortcut - a
    // surviving point at alpha zero still writes depth and would punch invisible holes
    // in the cloud behind it.
    cropOn: { value: 1 },
    cropOutside: { value: 0 },
    // The turbulence field. Amplitude is metres, scale is cycles per metre and speed is
    // how fast the field drifts through the scene in program seconds - all three world
    // units, so none of them owes the 1080p reference every screen-space term here does.
    noise: { value: 0 },
    noiseScale: { value: 3 },
    noiseSpeed: { value: 0.7 },
    lattice: { value: 0 },
    latticeCell: { value: 0.05 },
    // The glyph field, which draws a character where the lattice above put a point - and
    // it rides that lattice rather than carrying a grid of its own, because two
    // independent world-cell quantisers in one shader is the second path this design keeps
    // refusing. The master blends the mark from the round splat toward the character and
    // grows the sprite into the cell as it goes, so at a lattice of 1 and a glyph of 0 the
    // picture is the voxel look that ships today.
    //
    // The three keys sum into one index and wrap, which is what lets each of them mean how
    // far it moves the character while a weight at zero contributes exactly nothing.
    // `glyphHash` defaults to 1 rather than to 0, following the ceilings under the glitch
    // master: it is a setting under a master and its default is the identity the probe
    // shipped, which is the character belonging to the cell and to nothing else. The other
    // three default to 0, `glyph` because it is the master and gates the whole thing.
    glyph: { value: 0 },
    glyphTone: { value: 0 },
    glyphHash: { value: 1 },
    glyphRain: { value: 0 },
    // The falling wave. One scalar per point out of world height and program time, driving
    // brightness in the fragment stage - and the glyph field's rain key reads the same
    // scalar to scramble the character, which is the arrangement the duotone already has:
    // one source, two consumers. The three lengths under the master are metres and metres
    // per second of the room, so none of them owes the 1080p reference the screen-space
    // terms do, and each defaults to the value the probe's clips were shot at rather than
    // to zero - a span of zero is a degenerate divisor protected only by the master, which
    // is the shape every other family here avoids.
    rain: { value: 0 },
    rainSpeed: { value: 0.55 },
    rainSpan: { value: 1.3 },
    rainTrail: { value: 0.45 },
    // One region, three uses. Centre, half-extents, corner radius and falloff width are
    // metres in the sensor frame; the three effects below are what read it.
    regionCentre: { value: new THREE.Vector3(0, 0, -2) },
    regionHalf: { value: new THREE.Vector3(0, 0, 0) },
    regionRound: { value: 0.5 },
    regionSoft: { value: 0.2 },
    regionPush: { value: 0 },
    regionNoise: { value: 0 },
    regionMask: { value: 0 },
    ripple: { value: 0 },
    rippleFreq: { value: 4 },
    rippleSpeed: { value: 1 },
    // Datastream corruption, and the five numbers one slider used to hide. `glitch` is
    // the master and the only one of the six that is meant to be keyframed in anger: a
    // clip brings the corruption in and out on one track, where five absolute values
    // would have to be animated in step and reach zero together to stop. The rest are
    // ceilings - what a fully open master means - and every default below is exactly the
    // literal it replaced, so a document that names none of them draws what it drew.
    //
    // The pair that earns its keep is `glitchDensity` against `glitchShove`. Fused into
    // the master they could only ever travel the diagonal, which made sparse-and-violent
    // and dense-and-subtle both unaskable - the complaint that started this. Because the
    // master still multiplies both, perceived intensity ramps as roughly the square of
    // the fader, which is an ease-in you would otherwise keyframe by hand.
    glitch: { value: 0 },
    glitchDensity: { value: 0.45 },
    glitchShove: { value: 0.45 },
    glitchTint: { value: 1.8 },
    glitchBands: { value: 12 },
    glitchAxis: { value: 0 },
    // Hertz, and zero is a state rather than an off switch: `floor(time * 0.0)` is a
    // constant, so the tear pattern freezes where it stands instead of stopping. A held
    // corruption is a different picture from no corruption, and because the rate
    // keyframes it can be stopped and started.
    glitchRate: { value: 7 },
    time: { value: 0 },
    // Program time again, in a cell of its own, and the duplication is what makes one
    // falsification control possible rather than being an oversight. The rain has to be a
    // pure function of program time or a seek lands where playback never would, and the
    // mutation that holds that claim - `timeline-check --mutate rain-accumulates` - has to
    // integrate exactly one line. Pointed at `time` it would redden the ripple, the glitch
    // and the raster along with the rain, and a control that fails everything cannot say
    // which claim is load-bearing. Written beside `time` in the same statement pair, so the
    // two cannot come apart.
    rainPhase: { value: 0 },
    // The five readings of the take, as weights rather than as a mode. Each one is a
    // complete answer to "what colour is this point", and the fragment stage mixes
    // whichever are non-zero - so colour and range compose instead of excluding one
    // another, and a reading can move under the playhead like every other look value.
    // RGB alone is the boot state, which is what the old `mode: 0` meant.
    readRgb: { value: 1 },
    readDepth: { value: 0 },
    readGhost: { value: 0 },
    readContour: { value: 0 },
    readBlackwall: { value: 0 },
    // What each reading is made of, which used to be literals inside its branch. The
    // values here are the literals they replaced, so a build that somehow reached a frame
    // before `params.reset()` in `web/main.js` would draw what the old one drew - and
    // every one of them is what makes the equality `registry-check` hashes against the
    // pre-reading revision hold. A default that drifted off its literal is that
    // comparison's red row rather than something anybody has to eyeball.
    rgbSaturation: { value: 1 },
    depthGamma: { value: 1 },
    ghostRim: { value: 0.7 },
    ghostFill: { value: 0.35 },
    contourBands: { value: 12 },
    // One parameter, two uniforms, and it is a rounding measurement rather than a
    // preference. The band edges are the width either side of the middle of the band,
    // and computing `0.5 - contourWidth` in the shader does that arithmetic in float32:
    // `f32(0.5) - f32(0.08)` is 0.42000001668930054, where the literal `0.42` this
    // replaces is 0.41999998688697815. Those are different floats, so the shader form
    // would move every contour frame by a hair and redden the readContour row of the
    // comparison against the old build for a reason that has nothing to do with the
    // feature. Done here in double and rounded once on the way to the GPU, both edges
    // land on exactly the floats the literals did.
    contourLo: { value: 0.42 },
    contourHi: { value: 0.58 },
    blackwallSweep: { value: 0.28 },
    denoise: { value: 1 },
    edgeTol: { value: 120 },
    // Whether there is a colour camera at all, and the same cell the colour door raises
    // when a JPEG binds - so the stream in `web/main.js` switching colour off and a frame
    // arriving are writing one answer rather than two.
    hasColor: sourceCells.hasColor,
    softEdge: { value: 1 },
    scanAmount: { value: 0 },
    rimAmount: { value: 0.55 },
    // Both apply on top of whichever mode is selected rather than inside one of its
    // branches, so they compose with every reading of the take instead of being a
    // sixth and seventh one. Unitless mixes.
    thermal: { value: 0 },
    edges: { value: 0 },
    // The duotone, which sits beside those two for their reason and carries a second one
    // of its own. It is a tonal transform rather than a palette: the two poles it lands
    // between hold **luminance as well as hue**, the near one running toward black and the
    // far one toward hot, so the near-black figure against a burning core comes out of the
    // same term that decides what colour the room is.
    //
    // That pairing is the design rather than an economy, and it was reached by asking what
    // the obvious shape could not draw. A global toe darkens near and far by the same
    // amount, so a parameter named for the silhouette would have shipped unable to produce
    // one - a control that appears to work, arriving at the level of the look instead of at
    // the level of the wiring, which is the harder place to notice it. Keying the poles on
    // depth is the whole of what makes a subject go black while the space behind it burns,
    // and once the poles carry luminance there is nothing left for a second parameter to do.
    //
    // The pair itself is baked, following the precedent `heatRamp` and `depthRamp` set:
    // both are hardcoded ramps and what is parameterised is how you use them. A `colour`
    // registry kind would be the first new kind since `pose` and would drag a keyframe
    // interpolation in with it - two saturated hues lerped through sRGB pass through grey
    // on the way, so the honest version interpolates perceptually and the document format
    // then carries that choice forever. `duotoneHue` turns both poles together instead,
    // which is the one degree of freedom a look actually reaches for, and it keyframes.
    //
    // Radians here and degrees on the slider, the way the levelling angles are.
    duotoneDepth: { value: 0 },
    duotoneHue: { value: 0 },
    duotoneSplit: { value: 0.5 },
    // How many metres the ramp between the two poles takes, and it is in metres for the
    // one reason worth having: without it the ramp's width *was* the clip range, so the
    // grade was a function of how tightly the crop box happened to be shut.
    //
    // That coupling is easy to defend and was wrong in use. `t` is the point's position
    // inside `nearClip`..`farClip`, and the ramp used to run the whole unit interval, so
    // opening the box flattened the duotone and closing it steepened one. Measured on
    // 2026-08-07-take1, whose cloud sits between 0.58m and 3.73m at p5 and p95: against
    // the default range the visible cloud only reaches `t` 0.62, so the hot pole is
    // unreachable and the grade sits in the cold third of its own travel. Getting the
    // toning back meant shutting the far plane onto the subject and throwing the back of
    // the room away - a framing decision the grade had no business forcing.
    //
    // **The split stays a fraction and only the width becomes a distance**, which is a
    // split down the middle of one parameter rather than an inconsistency. Where the poles
    // meet is a place in the room, and a place is what the crop box already describes, so
    // it should move when the box does. How fast the picture crosses between them is a
    // property of the look, and a look that had to be re-tuned every time a face moved is
    // the thing being removed.
    //
    // The default is the clip range's own width, so a document that names nothing renders
    // what it rendered before this existed. That identity is a property of these two
    // literals rather than of the subtraction - `6.0f - 0.05f` and `5.95f` happen to round
    // to the same float32 - so it is measured rather than argued: see the commit that
    // introduced this, which carries the five readings' hashes either side of the change.
    duotoneSpan: { value: CLIP_FAR_DEFAULT - CLIP_NEAR_DEFAULT },
    duotoneMotion: { value: 0 },
    stateTex: { value: statePrev.texture },
    fadeTime: { value: 0.12 },
    wakeTime: { value: 0 },
    sinceFrameSec: { value: 0 },
  };

  // The two programs those uniforms feed, assembled here rather than imported whole. The
  // spine in `web/cloud-shader.js` carries the text every point in the frame is drawn by
  // and the joints the installed effects splice into; `assembleShaders` concatenates the
  // two. Nine hundred lines of GLSL sitting between the table above and the hundred places
  // in `web/main.js` that write it put the two ends of one parameter out of sight of each
  // other, which is why the text moved out at all, and an effect's own GLSL travelling with
  // its parameters is the same argument one file further.
  //
  // What did not move is the obligation between the two: every uniform the assembled pair
  // declares needs a key here, nothing checks it in either direction, and a uniform with no
  // key is a silent zero rather than an error. Nine of those declarations are in the glyph
  // and rain packages now rather than in the spine, which widens where the obligation is
  // written down without changing what it is - `test/cloud-shader.test.mjs` asks it of the
  // shipped GLSL wherever the shipped GLSL lives. Five of the keys hold cells
  // `web/gpu-textures.js` owns rather than cells this table made, which leaves the
  // obligation exactly where it was and moves only who may write them.
  const { vertexShader, fragmentShader } = assembleShaders(cloudSpine, packages);
  material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
  });

  cloud = new THREE.Points(geometry, material);
  scene.add(cloud);
}

/**
 * The additive-glow switch, which is four writes rather than one because a blend mode is
 * not a blend mode on its own.
 *
 * Additive points have to stop writing depth or the nearest one would occlude the glow of
 * everything behind it, and the soft edge goes with them because a hard-edged sprite added
 * to itself reads as a disc rather than as light. `needsUpdate` is what makes the pair
 * take: three.js compiles a program per material state, and on a Metal driver the blend is
 * its own pipeline object - which is why `warmPrograms` in `web/main.js` presses this both
 * ways at boot rather than trusting one variant to cover the other.
 */
export function setAdditive(on) {
  material.blending = on ? THREE.AdditiveBlending : THREE.NormalBlending;
  material.depthWrite = !on;
  uniforms.softEdge.value = on ? 1 : 0;
  material.needsUpdate = true;
}

/**
 * How far out the four lateral crop planes reach, in metres.
 *
 * It has to clear everything the sensor can see at the furthest depth the near/far
 * sliders allow, or the defaults would crop a project that never asked to be cropped.
 * The widest sample is the frame corner furthest from the principal point, so the
 * half-extent at depth z is `max(c, N - c) / f * z` per axis rather than `c / f * z`
 * - an off-centre principal point makes one side reach further than the other, and
 * this rig's is off centre by 1.8px horizontally and 5.2px vertically.
 *
 * At 9.5m with this Kinect that is 6.69m across and 5.64m up. Seven clears both, and
 * `cropReach()` is exposed so a check can hold the number against the intrinsics of
 * the take actually open rather than against the ones in this comment.
 */
export const CROP_LIMIT = 7;
export const cropReach = (maxDepth = 9.5) => {
  const { x: fx, y: fy } = uniforms.focal.value;
  const { x: cx, y: cy } = uniforms.center.value;
  return {
    x: (Math.max(cx, DEPTH_W - cx) / fx) * maxDepth,
    y: (Math.max(cy, DEPTH_H - cy) / fy) * maxDepth,
    limit: CROP_LIMIT,
  };
};

/**
 * Whether a sensor-space sample is on the wrong side of the crop box.
 *
 * **The crop is asked about in two places and this is one of them.** The vertex shader in
 * `web/cloud-shader.js` has to keep its own copy because it is in another language, but
 * the plan inset's density map in `web/main.js` used to spell the six comparisons out for
 * itself - so a switch wired to the shader alone left the top-down drawing a cropped cloud
 * underneath a picture drawing everything, and the top-down is exactly where the depth
 * faces get dragged. A second spelling of one rule is a second place for the next face, or
 * the next switch, to be forgotten, which is why the plan imports this and asks it rather
 * than deciding.
 *
 * It had a third caller while the room could be levelled by selecting a floor in the
 * picture, and that gesture is gone; the sharing is what survived it, because the one
 * reader left is the one the switch was originally wired past.
 *
 * Sensor metres and before the levelling rotation, matching the shader: the box is a
 * place in the room, so testing a rotated position would move all six faces every time
 * the room was levelled underneath them.
 *
 * `depth` is positive metres from the sensor, which is what every caller already has in
 * hand from the depth texture - the room's own z is its negation, and asking for the
 * value nobody has to flip is what keeps a sign error out of the callers.
 */
export function croppedOut(x, y, depth) {
  if (uniforms.cropOn.value !== 1) return false;
  if (depth < uniforms.nearClip.value || depth > uniforms.farClip.value) return true;
  return x < uniforms.cropL.value || x > uniforms.cropR.value
    || y < uniforms.cropB.value || y > uniforms.cropT.value;
}
