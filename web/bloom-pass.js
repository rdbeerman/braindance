// How the halo is built, how big it is built at, and nothing else. The pass below and the
// chain size at the foot of the file are one reason to change rather than two: the size is
// frozen because the pass bakes its reach into its shaders, so a number chosen without the
// mechanism in front of it is a number somebody will later take for a resolution bug.
//
// Nothing here runs at import time beyond declaring a class and three strings - the five
// render targets are allocated in the constructor, which the post chain in `main.js` runs
// where it builds its passes - so importing this module cannot reorder anything a GPU
// sees, and both halves of it can be constructed and measured under bare node with no
// renderer at all.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * The glow, as a progressive down-and-up sample chain rather than a Gaussian per mip.
 *
 * **This replaces `UnrealBloomPass`, and the reason is a measurement rather than a
 * preference.** That pass costs what it costs because of how many render targets it
 * visits and not how big they are: measured on this build, shrinking its chain sixty-fold
 * - 533x300 down to 64x36 - moved the frame by 0.026ms, from +0.278 to +0.252 against
 * bloom off. Sixty times fewer texels for two percent of the cost is a pass count
 * talking, so the only lever that does anything is visiting fewer targets. Its shape is
 * a bright pass, five mips each blurred twice because a Gaussian separates, a composite
 * and an additive blend: **thirteen full-screen draws**, each paying a bind.
 *
 * A down/up chain gets its width from the resampling instead. Each downsample halves the
 * buffer through a thirteen-tap filter whose taps sit on texel corners, so the hardware's
 * bilinear unit does half the averaging for free and one pass reaches as far as a much
 * wider Gaussian would; the upsample walks back with a nine-tap tent, adding each finer
 * level onto the coarser one it just expanded. So the octaves accumulate on the way up
 * rather than being composited at the end, and no level is ever blurred twice. That is
 * **five downsamples, four upsamples and one blend, so ten draws against thirteen** - and
 * the last upsample is not folded into the blend even though it could be, because the
 * blend is where `strength` is applied and fusing them would put a look control inside
 * the resampling arithmetic.
 *
 * **The threshold rides in the first downsample**, which is the one place fusing costs
 * nothing: the bright pass and the first halving both read the full-resolution frame, so
 * doing them separately reads it twice to no end. Its soft knee is the one
 * `LuminosityHighPassShader` applies, kept because the shipped looks are graded against
 * where that knee puts the cut rather than against a hard step.
 *
 * **Sized off the 600-tall reference and not the drawing buffer.** `resize` in `main.js`
 * asks `bloomChainSize` at the foot of this file what to hand `setSize`, and that function
 * carries the whole argument and the measurements behind it. A chain sized off the buffer
 * instead makes the halo's width a fraction of the frame that halves every time the buffer
 * doubles, which is what `export-check` holds.
 *
 * `needsSwap` is true, and the constructor's note on it says why: the last step writes the
 * picture and the glow summed into a third target, because reading the frame at the top of
 * the chain and blending onto it at the bottom aliased a texture with its own render
 * target. Bloom is still light added to a picture rather than a picture built from one -
 * what changed is where the addition is written.
 */
export const BLOOM_LEVELS = 5;

// Thirteen taps in the pattern Jimenez's filter uses - a centre, four at half a texel and
// eight on the diagonals a texel out - weighted so the result is a smooth partition of
// unity. Written as one pass because every tap is bilinear: the four corner groups each
// average four source texels in hardware, so this reads thirty-six texels' worth of
// neighbourhood for thirteen fetches, which is what lets a single pass replace a
// separable pair.
const bloomDownShader = /* glsl */ `
  precision highp float;
  uniform sampler2D tSource;
  uniform vec2 texel;
  uniform float threshold, knee, firstLevel;
  varying vec2 vUv;

  void main() {
    vec2 t = texel;
    vec3 a = texture2D(tSource, vUv + vec2(-2.0 * t.x,  2.0 * t.y)).rgb;
    vec3 b = texture2D(tSource, vUv + vec2( 0.0,        2.0 * t.y)).rgb;
    vec3 c = texture2D(tSource, vUv + vec2( 2.0 * t.x,  2.0 * t.y)).rgb;
    vec3 d = texture2D(tSource, vUv + vec2(-2.0 * t.x,  0.0)).rgb;
    vec3 e = texture2D(tSource, vUv).rgb;
    vec3 f = texture2D(tSource, vUv + vec2( 2.0 * t.x,  0.0)).rgb;
    vec3 g = texture2D(tSource, vUv + vec2(-2.0 * t.x, -2.0 * t.y)).rgb;
    vec3 h = texture2D(tSource, vUv + vec2( 0.0,       -2.0 * t.y)).rgb;
    vec3 i = texture2D(tSource, vUv + vec2( 2.0 * t.x, -2.0 * t.y)).rgb;
    vec3 j = texture2D(tSource, vUv + vec2(-t.x,  t.y)).rgb;
    vec3 k = texture2D(tSource, vUv + vec2( t.x,  t.y)).rgb;
    vec3 l = texture2D(tSource, vUv + vec2(-t.x, -t.y)).rgb;
    vec3 m = texture2D(tSource, vUv + vec2( t.x, -t.y)).rgb;

    vec3 sum = e * 0.125;
    sum += (a + c + g + i) * 0.03125;
    sum += (b + d + f + h) * 0.0625;
    sum += (j + k + l + m) * 0.125;

    // Only the level that reads the frame itself cuts the darks out. Applying it again
    // further down the chain would eat the glow it had already spread, because a halo is
    // dimmer than the highlight that threw it and would fall back under the knee.
    if (firstLevel > 0.5) {
      float lum = dot(sum, vec3(0.299, 0.587, 0.114));
      sum *= smoothstep(threshold, threshold + knee, lum);
    }
    gl_FragColor = vec4(sum, 1.0);
  }
`;

// The nine-tap tent that walks back up. Additive onto the level below, so each octave is
// laid over the wider one under it and the falloff is the sum of the chain rather than a
// set of weights chosen at the end.
const bloomUpShader = /* glsl */ `
  precision highp float;
  uniform sampler2D tSource;
  uniform vec2 texel;
  uniform float radius;
  varying vec2 vUv;

  void main() {
    // The sample radius is what the bloom radius moves, and it moves it here rather than
    // in a composite weight: widening the tent widens every octave together, which is
    // the same knob the pass this replaces spelled as a lerp between two weight sets.
    vec2 t = texel * radius;
    vec3 sum = texture2D(tSource, vUv + vec2(-t.x,  t.y)).rgb * 0.0625;
    sum += texture2D(tSource, vUv + vec2( 0.0,   t.y)).rgb * 0.125;
    sum += texture2D(tSource, vUv + vec2( t.x,   t.y)).rgb * 0.0625;
    sum += texture2D(tSource, vUv + vec2(-t.x,   0.0)).rgb * 0.125;
    sum += texture2D(tSource, vUv).rgb * 0.25;
    sum += texture2D(tSource, vUv + vec2( t.x,   0.0)).rgb * 0.125;
    sum += texture2D(tSource, vUv + vec2(-t.x,  -t.y)).rgb * 0.0625;
    sum += texture2D(tSource, vUv + vec2( 0.0,  -t.y)).rgb * 0.125;
    sum += texture2D(tSource, vUv + vec2( t.x,  -t.y)).rgb * 0.0625;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const bloomVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export class BloomPass extends Pass {
  constructor(strength = 1, radius = 1, threshold = 0) {
    super();
    this.strength = strength;
    this.radius = radius;
    this.threshold = threshold;
    // The last step writes the picture and the glow summed into the other buffer, so the
    // composer swaps onto it. The pass this replaces blended onto the buffer it was
    // handed and set this false; doing that here aliased the texture the chain reads
    // with the target it writes, and the note on `blendMaterial` has what that cost.
    this.needsSwap = true;

    this.targets = [];
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      target.texture.name = `bloom.${i}`;
      target.texture.generateMipmaps = false;
      this.targets.push(target);
    }

    this.downMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        texel: { value: new THREE.Vector2() },
        threshold: { value: threshold },
        knee: { value: 0.01 },
        firstLevel: { value: 0 },
      },
      vertexShader: bloomVertexShader,
      fragmentShader: bloomDownShader,
    });

    this.upMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        texel: { value: new THREE.Vector2() },
        radius: { value: radius },
      },
      vertexShader: bloomVertexShader,
      fragmentShader: bloomUpShader,
      // Additive, because an upsample lays its octave over the wider one already in the
      // target rather than replacing it.
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });

    // **The picture and the glow are added in one shader rather than by blending the
    // glow onto the picture**, and that is a correctness fix rather than a tidy-up. The
    // additive version reads the frame as a texture at the top of the chain and then
    // binds that same buffer as the render target at the bottom, which is a feedback
    // loop: WebGL leaves the result undefined, and here it lost the picture entirely -
    // with `strength` at zero, where the blend provably adds nothing, the frame came back
    // 0% lit against 100% with the pass off. Reading both and writing a third target
    // cannot alias, so the composer swaps to the result instead.
    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPicture: { value: null },
        tBloom: { value: null },
        strength: { value: strength },
      },
      vertexShader: bloomVertexShader,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tPicture, tBloom;
        uniform float strength;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tPicture, vUv);
          gl_FragColor = vec4(base.rgb + texture2D(tBloom, vUv).rgb * strength, base.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new FullScreenQuad(null);
  }

  setSize(width, height) {
    let w = Math.max(1, Math.round(width));
    let h = Math.max(1, Math.round(height));
    for (const target of this.targets) {
      // Halved per level and floored at one, so a chain asked for on a very small preview
      // stops shrinking instead of asking for a zero-sized target.
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      target.setSize(w, h);
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    const previousTarget = renderer.getRenderTarget();

    // Down. The first level reads the frame and cuts the darks; the rest read the level
    // above them, which is what makes this a chain rather than five blurs of one image.
    this.quad.material = this.downMaterial;
    for (let i = 0; i < this.targets.length; i++) {
      const source = i === 0 ? readBuffer : this.targets[i - 1];
      this.downMaterial.uniforms.tSource.value = source.texture;
      this.downMaterial.uniforms.threshold.value = this.threshold;
      this.downMaterial.uniforms.firstLevel.value = i === 0 ? 1 : 0;
      this.downMaterial.uniforms.texel.value.set(1 / source.width, 1 / source.height);
      renderer.setRenderTarget(this.targets[i]);
      renderer.clear();
      this.quad.render(renderer);
    }

    // Up, accumulating. Nothing is cleared on the way back: each pass adds its octave to
    // the level below, which already holds that level's own downsample.
    this.quad.material = this.upMaterial;
    for (let i = this.targets.length - 1; i > 0; i--) {
      const source = this.targets[i];
      this.upMaterial.uniforms.tSource.value = source.texture;
      this.upMaterial.uniforms.radius.value = this.radius;
      this.upMaterial.uniforms.texel.value.set(1 / source.width, 1 / source.height);
      renderer.setRenderTarget(this.targets[i - 1]);
      this.quad.render(renderer);
    }

    // And the two are summed into the buffer the composer will swap to. `strength` is
    // applied here and only here, so the look control stays outside the resampling.
    this.quad.material = this.blendMaterial;
    this.blendMaterial.uniforms.tPicture.value = readBuffer.texture;
    this.blendMaterial.uniforms.tBloom.value = this.targets[0].texture;
    this.blendMaterial.uniforms.strength.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    renderer.clear();
    this.quad.render(renderer);

    renderer.setRenderTarget(previousTarget);
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.downMaterial.dispose();
    this.upMaterial.dispose();
    this.blendMaterial.dispose();
    this.quad.dispose();
  }
}

// What `setSize` should be handed for a given drawing buffer, which is the one number in
// this file that is not a property of the pass itself.
//
// It is a function rather than two lines inside `resize` because the answer is arithmetic
// on the buffer's aspect and nothing else - no renderer, no targets, no page - so the
// invariant the rest of this note spends forty lines defending is one a `node --test`
// assertion can hold, where before it could only be read off a forty-tile picture
// comparison after the fact.
//
// Bloom is the most expensive pass, so it runs at half resolution - and the resolution it
// is half of is a fixed reference rather than the drawing buffer, which is what makes its
// halo a fixed fraction of the frame.
//
// Running it at half the *buffer* makes bloom's cost proportional and its
// appearance anything but: UnrealBloomPass bakes a fixed tap count into its
// shaders when it is constructed - [6, 10, 14, 18, 22] across the five mips -
// while `setSize` scales the mip chain with what it is given. More texels per
// mip and the same number of taps means a halo whose width in frame-fractions
// is inversely proportional to buffer height, halving every time the buffer
// doubles. Measured at 1920x1200 against 3840x2400 it was the whole of the
// remaining residual once every other term was reference-relative: a mean
// channel difference of 13.1 against 0.6, and a halo covering the frame at the
// smaller size against 80.3% of it at the larger.
//
// The reference the chain is frozen at is the 600-tall buffer the look was graded
// against, and it is **not** the 1080p every screen-space term in `main.js` is expressed
// against. The two do not reconcile and neither is a typo for the other: `pointSize` and
// its neighbours are values a document names, so they are stated in one unit and scaled to
// the buffer, while the chain has no value to state because the tap count is baked in at
// construction. Freezing it at 1080 instead was tried and is wrong for a reason worth
// writing down: the halo's width is a tap count over a texel count, so a chain with 1.8x
// the texels has a halo 1.8x tighter - constant at last, but constant at a glow Blackwall
// was never tuned for. Measured across the two builds, the whole look at 1080p against the
// graded look at 600: 7.16/255 on the worst of forty tile means at a 1080-frozen
// chain, 1.10 at this one.
//
// What holds it constant is measured to 1200 and shipped to 2160, and the gap is
// worth naming rather than assuming. The bright pass reads the full-resolution
// frame into this frozen chain with one bilinear tap per destination texel, so
// it point-samples a 2:1 region of the frame at a 600 buffer, 4:1 at 1200 and
// 7.2:1 at 2160 - the undersampling grows with output size while the chain does
// not. `export-check` compares 600 against 1200, where it measures 0.781/255 on
// the coarse grid; nothing here has been measured at 4K, so a 4K export inherits
// the claim by extrapolation. The way to close it is an arm at 3840x2160 against
// 1920x1080, not an argument.
//
// The cost moves with it, in both directions. A 4K export now pays 600-referred
// bloom, which is the cheaper half of the trade and the right direction for a
// render that is CPU-bound anyway. A capture node previewing at 800x480 pays it
// too, which is the expensive half, and the two chains rather than the ratio
// between them: the old code called setSize(400, 240) there and got a 200x120
// first mip, this one calls setSize(500, 300) and gets 250x150. That is 37,500
// texels against 24,000, so 1.56x on the machine with the least to spare.
export function bloomChainSize(bufferWidth, bufferHeight) {
  const refWidth = (bufferWidth / bufferHeight) * 600;
  return { width: Math.max(1, refWidth / 2), height: 300 };
}
