import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { DEPTH_H, DEPTH_W } from './format.js';
import { renderer } from './scene.js';
import { depthCurr } from './gpu-textures.js';

/**
 * How the ghost a ray leaves behind when it lands on a different surface accumulates,
 * ages and decays.
 *
 * A ray that lands on a different surface between two frames is a death and a
 * birth. Without this the point simply teleports, which is the loudest artifact in
 * the viewer: 3.14% of pixels flip valid/zero every frame pair with no fade at all,
 * 44x more pixels than the snap threshold ever touches.
 *
 * Remembering where the ray used to be turns that into a cross-fade, and the
 * same memory is what a wake needs - so both come from one pass, one per
 * arriving frame rather than one per display frame.
 *
 *   .r  depth the ray had before the swap, mm - where the ghost stays
 *   .g  seconds since that swap
 *   .b  how hard the swap was, 0..1
 *   .a  depth at the previous arrival, mm - the swap detector itself
 *
 * **Nothing is allocated and no GL is touched while this module evaluates.** The two
 * targets, the uniforms and the quad are built by `buildSurfaceMemory`, which
 * `web/main.js` calls in the order it writes out - because a module body runs before
 * its importer's first statement, so anything built up here would put the boot order
 * at the mercy of how the import list happens to be sorted.
 *
 * This is the one module of the render core that cannot be imported under bare node,
 * and the reason is a single line: the target's pixel type is decided by asking the
 * live context whether it can render to float. That question has to be asked of the
 * renderer that will draw the answer, and the two alternatives were both worse - a
 * type injected from outside puts the first frame's behaviour in the caller's hands,
 * and a fallback that guesses half-float when nothing is there is a second path that
 * would silently degrade the wake and age arithmetic with nothing in the suite to
 * catch it.
 */

// How long a ray's age is allowed to keep counting, in seconds of source time.
// This is not a free number: a ghost is drawn while `age < fadeTime + wakeTime *
// strength`, so once the clamp sits below the longest life the registry can ask
// for, a ray that stops swapping pins its age at the ceiling and sheds forever at
// fixed alpha. At 4.0 that was reachable - fade and wake top out at 1500 and 4000
// milliseconds - and it showed up as a wake that never expired in the live viewer
// and as a seek that could not reproduce a playback, because a reset zeroes the
// ghost and no length of pre-roll puts an immortal one back.
const MAX_AGE = 6.0;

/**
 * Refuses a look whose two persistence sliders can outlive the ceiling above.
 *
 * The ceiling and the refusal about it are both the memory's, but the number they are
 * measured against is the registry's - the longest life its fade and wake maxima can
 * ask for between them - so the registry hands that over rather than this file reaching
 * for a table it has no business knowing. It is an assertion rather than a clamp because
 * the honest failure is "this look cannot be rendered correctly", which a silently
 * shortened wake would hide; raising a slider's maximum past the ceiling fails at boot
 * rather than in the footage.
 */
export function refuseAgeCeiling(longestLife) {
  if (MAX_AGE < longestLife) {
    throw new Error(
      `the surface memory clamps age at ${MAX_AGE}s but fade and wake can ask for `
      + `${longestLife}s: a ghost past the clamp would never expire`,
    );
  }
}

const makeStateTarget = (type) => new THREE.WebGLRenderTarget(DEPTH_W, DEPTH_H, {
  type,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
});

// Read by the point cloud, which samples the current one, and by the reset that clears
// both. They are live bindings rather than a pair anybody may assign, because the only
// legitimate way for them to change places is the step below having rendered into the
// far one first.
export let statePrev = null;
export let stateNext = null;

// Written only by the step below, which is why they are private: a caller able to set
// `dt` or the snap threshold without rendering would leave the two targets describing
// a gap that never happened.
let stateUniforms = null;
let stateQuad = null;

const stateVertexShader = /* glsl */ `
    in vec3 position;
    void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

const stateFragmentShader = /* glsl */ `
    precision highp float;
    precision highp usampler2D;

    uniform usampler2D depthCurr;
    uniform sampler2D statePrev;
    uniform vec2 resolution;
    uniform float dt, snapDelta;

    out vec4 outState;

    void main() {
      ivec2 px = ivec2(gl_FragCoord.xy);
      float cur = float(texelFetch(depthCurr, px, 0).r);
      vec4 s = texelFetch(statePrev, px, 0);
      float last = s.a;

      bool wasValid = last > 0.0;
      bool isValid = cur > 0.0;
      float jump = (wasValid && isValid) ? abs(cur - last) : 0.0;
      bool swapped = (wasValid != isValid) || jump > snapDelta;

      if (!swapped) {
        // Clamped so age cannot grow without bound across a long session, and so
        // it never reaches the magnitude where a float stops absorbing a 33ms step.
        outState = vec4(s.r, min(s.g + dt, ${MAX_AGE.toFixed(1)}), s.b, cur);
        return;
      }

      // A pixel blinking in the middle of a flat wall is the depth solve's
      // confidence gate chattering, not motion. Keying strength off the local
      // depth spread separates the two: noise sits on a smooth surface and gets
      // only the brief cross-fade, while a silhouette crossing sheds a full wake.
      float ref = isValid ? cur : last;
      float edge = 0.0;
      for (int i = 0; i < 4; i++) {
        ivec2 o = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
        float n = float(texelFetch(depthCurr, clamp(px + o, ivec2(0), ivec2(resolution) - 1), 0).r);
        if (n > 0.0) edge = max(edge, abs(n - ref));
      }

      float strength = (wasValid && isValid)
        ? clamp(jump / (snapDelta * 3.0), 0.0, 1.0)
        : clamp(edge / snapDelta, 0.0, 1.0);

      outState = vec4(wasValid ? last : 0.0, 0.0, strength, cur);
    }
  `;

/**
 * Builds the two targets, the uniforms and the quad that renders one step.
 *
 * Called after the source textures exist, because the pass reads the current depth
 * frame and a uniform seeded with null would leave the first step sampling nothing.
 */
export function buildSurfaceMemory() {
  // Float where the context can render to it, half-float where it cannot. Asked of the
  // live context rather than assumed, because the difference is in what the .g channel
  // can still resolve after several seconds of 33ms steps.
  const stateType = renderer.getContext().getExtension('EXT_color_buffer_float')
    ? THREE.FloatType
    : THREE.HalfFloatType;

  statePrev = makeStateTarget(stateType);
  stateNext = makeStateTarget(stateType);

  stateUniforms = {
    depthCurr: { value: depthCurr },
    statePrev: { value: statePrev.texture },
    resolution: { value: new THREE.Vector2(DEPTH_W, DEPTH_H) },
    dt: { value: 1 / 30 },
    snapDelta: { value: 250 },
  };

  stateQuad = new FullScreenQuad(new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: stateUniforms,
    vertexShader: stateVertexShader,
    fragmentShader: stateFragmentShader,
  }));
}

/**
 * One ping-pong step of the memory, advanced by exactly one source frame.
 *
 * The gap arrives already clamped and the snap threshold arrives from the registry,
 * because both are decisions the transport and the look own rather than this file: what
 * is here is the pass itself and the swap that follows it, which is the whole of why
 * the two targets need no writer outside this module.
 *
 * The swap is the last thing rather than the first: `statePrev` names the target that
 * has just been rendered into, so a caller reading it back afterwards gets the state
 * this step produced.
 */
export function stepSurfaceMemory(dtSec, snapDelta) {
  stateUniforms.depthCurr.value = depthCurr;
  stateUniforms.statePrev.value = statePrev.texture;
  stateUniforms.dt.value = dtSec;
  stateUniforms.snapDelta.value = snapDelta;

  renderer.setRenderTarget(stateNext);
  stateQuad.render(renderer);
  renderer.setRenderTarget(null);

  const swap = statePrev;
  statePrev = stateNext;
  stateNext = swap;
}
