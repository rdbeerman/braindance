// The size bloom's mip chain is built at, called directly.
//
// **This is the one number in the render path that is deliberately not expressed against
// 1080p, and the two references are a step apart in the same function's caller.** Every
// screen-space term the look carries is a value a document names, so it is stated once
// against a 1080-tall frame and scaled to whatever buffer is drawn; the chain has no value
// to state, because `BloomPass` bakes its reach into its shaders when it is constructed,
// so its size is frozen at the 600-tall buffer the look was graded on instead. Neither is
// a typo for the other and reconciling them is the mistake, which is why there is a row
// below that would fail if the chain started following the buffer and a row that would
// fail if it were frozen at 1080.
//
// The oracle is `setSize(aspect * 300, 300)` written out longhand rather than read back
// from the module, for the reason `test/world-tilt.test.mjs` gives about its own: a test
// that asked the implementation what reference it used would agree with it by
// construction and could never see the reference move. That spelling is also the one
// CLAUDE.md states, so the two are independent statements of one rule rather than one
// statement read twice.
//
// What this cannot see is what the picture looks like - a chain of the right size built by
// a pass that resamples wrongly is green here and red in `export-check`, whose
// `bloom-buffer-sized` and `bloom-reference-1080` arms drive the same two failures through
// a real export at two output sizes. This file is the cheap half: it runs with no server,
// no sensor and no browser under `npm run test:unit`, and it fails in milliseconds where
// that one needs ffmpeg and a GPU.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BloomPass, BLOOM_LEVELS, bloomChainSize, bloomWeights, BLOOM_COMPAT_GAIN,
} from '../web/bloom-pass.js';

/** The chain CLAUDE.md names, from the buffer's aspect alone. */
const graded = (bufferWidth, bufferHeight) => ({
  width: Math.max(1, (bufferWidth / bufferHeight) * 300),
  height: 300,
});

const BUFFERS = [
  [960, 600], [1920, 1200], [640, 400], [800, 480], [1920, 1080], [3840, 2160], [1280, 720],
];

test('the chain is half a 600-tall reference at the buffer aspect, at every size', () => {
  for (const [w, h] of BUFFERS) {
    assert.deepEqual(bloomChainSize(w, h), graded(w, h), `${w}x${h}`);
  }
});

test('two buffers of one aspect get one chain, which is the whole of what frozen means', () => {
  // The two arms `export-check` compares. They are a factor of two apart in every
  // dimension and the chain has to come back byte-identical, because a halo whose width is
  // a fraction of the frame is the residual that comparison exists to catch.
  assert.deepEqual(bloomChainSize(960, 600), bloomChainSize(1920, 1200));
  assert.deepEqual(bloomChainSize(1920, 1080), bloomChainSize(3840, 2160));
});

test('a chain that followed the buffer would be a different answer - above 600, and only above it', () => {
  // The falsification row for `bloom-buffer-sized`. Without it every assertion above is
  // satisfied by a function that happens to agree at one size, and the two arms of the
  // comparison above would then agree with each other about the wrong thing.
  const followsBuffer = (w, h) => ({ width: Math.max(1, w / 2), height: Math.max(1, h / 2) });
  assert.notDeepEqual(bloomChainSize(1920, 1200), followsBuffer(1920, 1200));
  assert.notDeepEqual(bloomChainSize(3840, 2160), followsBuffer(3840, 2160));

  // **And at a 600-tall buffer the two rules are the same rule**, which is measured here
  // rather than left as a hole somebody rediscovers. The chain is frozen at the height the
  // look was graded on, so at exactly that height half the buffer and half the reference
  // are one number - a build that had lost the freeze entirely draws the graded picture at
  // 600 and something else everywhere else. It is why `export-check` compares 600 against
  // 1200 instead of measuring either alone, and why the row above names a second size.
  assert.deepEqual(bloomChainSize(960, 600), followsBuffer(960, 600));
});

test('and a chain frozen at 1080 would be a different answer too', () => {
  // The falsification row for `bloom-reference-1080`, which is the mutation no per-size
  // comparison can see because both sizes agree about it. 1.8x the texels is a halo 1.8x
  // tighter: constant, and constant at a glow nothing was graded against.
  const frozenAt1080 = (w, h) => ({ width: Math.max(1, (w / h) * 540), height: 540 });
  for (const [w, h] of BUFFERS) {
    assert.notDeepEqual(bloomChainSize(w, h), frozenAt1080(w, h), `${w}x${h}`);
  }
});

test('a buffer too narrow to halve stops at one texel rather than asking for none', () => {
  assert.deepEqual(bloomChainSize(1, 1000), { width: 1, height: 300 });
});

test('the pass halves that chain five times and floors every level at one', () => {
  // Constructed with no renderer at all, which is the property that makes this file
  // possible: `WebGLRenderTarget` is a description of a target until something draws
  // through it, so the sizes below are the pass's own arithmetic rather than a driver's.
  const pass = new BloomPass(1.0, 0.6, 0.85);
  assert.equal(pass.targets.length, BLOOM_LEVELS);

  pass.setSize(533, 300);
  assert.deepEqual(pass.targets.map((t) => [t.width, t.height]),
    [[267, 150], [134, 75], [67, 38], [34, 19], [17, 10]]);

  // A capture node previewing something tiny asks for a chain it cannot halve five times.
  // Every level floors at one rather than reaching zero, which is a target no driver will
  // allocate.
  pass.setSize(1, 1);
  assert.deepEqual(pass.targets.map((t) => [t.width, t.height]),
    [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]);

  pass.dispose();
});

// ------------------------------------------------------- how much light comes out
//
// **The three terms the pass dropped when it replaced `UnrealBloomPass`, held here
// because two of them are arithmetic and the third is a discipline a stub can watch.**
// Every graded look but one was graded against the old pass and every one of them lost
// about 2.4x of frame luminance when it went; the comment at the top of
// `web/bloom-pass.js` names each term and `docs/performance.md` carries what the
// restoration measures. Rows rather than a paragraph, for the reason
// `docs/instruments.md` gives about a finding written down beside the thing that has it:
// a sentence reads later as a decision somebody made, and an arm has to be broken.
//
// These are here rather than in `export-check` for the same reason the chain size is -
// this file runs under bare node in milliseconds, and what it can hold it should.

test('the weight set sums to three at every radius, which is what makes radius a shape', () => {
  // `lerpBloomFactor` mirrors each factor towards `1.2 - factor`, and `sum(1.2 - 2f)`
  // over the five factors is exactly zero - so the radius moves where the light sits in
  // the chain and never how much of it there is. That identity is the reason the gain
  // can be quoted as two constants instead of measured per radius.
  for (const radius of [0, 0.25, 0.5, 0.7, 1]) {
    const sum = bloomWeights(radius).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 3) < 1e-12, `radius ${radius} summed to ${sum}`);
  }
  // And the shape at the radius the looks were graded at, spelled out rather than
  // recomputed - the whole point of the term is that the coarse octaves get the most.
  const graded07 = bloomWeights(0.7).map((w) => Number(w.toFixed(2)));
  assert.deepEqual(graded07, [0.44, 0.52, 0.60, 0.68, 0.76]);
  assert.ok(graded07[4] > graded07[0], 'at 0.7 the coarsest octave outweighs the finest');

  // The falsification row. Without it every assertion above is satisfied by a pass that
  // weights nothing at all: five octaves at 1.0 also sum to five, which is a number, and
  // 3.0 is not it. This is the state the pass actually shipped in.
  assert.notDeepEqual(bloomWeights(0.7), [1, 1, 1, 1, 1]);
  // The factor set itself, asked for at the radius where the mirror is the identity - the
  // module keeps the array private, for the reason `module-check` gives about an array
  // crossing a boundary, and this is the reading that does not need it to be public.
  assert.deepEqual(bloomWeights(0), [1.0, 0.8, 0.6, 0.4, 0.2]);
  assert.equal(bloomWeights(0).length, BLOOM_LEVELS);
});

test('the ratios the up chain carries telescope back into the weighted composite', () => {
  // The pass cannot apply a weight per octave directly, because an accumulating chain
  // only ever sees two levels at a time. It applies `w(i) / w(i-1)` to what arrives and
  // `3.0 * w(0)` at the blend, and the claim is that those multiply out to the old
  // composite's `3.0 * sum(w(i) * octave(i))`. Written out here as the product a reader
  // would have to do on paper, because the arithmetic is the whole of the restoration and
  // the shader cannot say it.
  const w = bloomWeights(0.7);
  const strength = 0.5;
  let carried = 1;
  const delivered = [strength * BLOOM_COMPAT_GAIN * w[0] * carried];
  for (let i = 1; i < BLOOM_LEVELS; i++) {
    carried *= w[i] / w[i - 1];
    delivered.push(strength * BLOOM_COMPAT_GAIN * w[0] * carried);
  }
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    assert.ok(Math.abs(delivered[i] - strength * BLOOM_COMPAT_GAIN * w[i]) < 1e-12,
      `octave ${i} arrives at ${delivered[i]}`);
  }
  // Nine against the five an unweighted chain would deliver, which is the 1.8 the frame
  // moved by - stated as the sum rather than as 1.8, because 1.8 is only the answer while
  // every octave carries the same mean and the arithmetic that is right is the sum.
  const total = delivered.reduce((a, b) => a + b, 0) / strength;
  assert.ok(Math.abs(total - 9) < 1e-12, `the chain delivers ${total} per unit of strength`);
});

test('the pass holds autoClear down while it draws, and hands it back', () => {
  // **The row for the term that cost four of the five octaves.** `WebGLRenderer.render`
  // clears the bound target when `autoClear` is set - it is set by default and
  // `EffectComposer` never changes it - so an additive upsample onto a target the
  // renderer has just wiped replaces the octave below instead of being laid over it.
  // Nothing in the picture says so: the halo is still a halo, one fifth as bright.
  //
  // A stub rather than a renderer, and it is enough because the pass reaches for exactly
  // five things: the bound target, `autoClear`, `setRenderTarget`, `clear` and `render` -
  // and `FullScreenQuad.render` only forwards to the last of those. So this watches the
  // discipline itself rather than a picture that would need a GPU to look at.
  // It also reads the uniform the pass has just bound, which is what turns the two
  // arithmetic rows above from a formula this file believes into the arithmetic the pass
  // performs. Those rows are satisfied by a `bloomWeights` nobody calls; this one is not.
  const seen = [];
  const target = { texture: {}, width: 960, height: 600 };
  const pass = new BloomPass(0.5, 0.7, 0.2);
  pass.setSize(480, 300);
  const renderer = {
    autoClear: true,
    _target: null,
    getRenderTarget() { return this._target; },
    setRenderTarget(t) { this._target = t; },
    clear() { seen.push(['clear', this.autoClear]); },
    render() {
      const u = pass.quad.material.uniforms;
      seen.push(['render', this.autoClear, u.weight?.value, u.strength?.value]);
    },
  };
  pass.render(renderer, { texture: {} }, target);

  assert.equal(seen.filter(([what]) => what === 'render').length, 10,
    'five downsamples, four upsamples and one blend');
  // The five down targets and the output. Worth a row of its own now that `autoClear` is
  // down: these calls used to be redundant beside it and they are the only clearing left.
  assert.equal(seen.filter(([what]) => what === 'clear').length, 6,
    'the five down levels and the composite clear themselves');
  assert.ok(seen.every(([, auto]) => auto === false),
    'every draw the pass makes runs with autoClear down');
  assert.equal(renderer.autoClear, true, 'and the renderer gets its own setting back');

  // The four upsamples, coarsest first, each carrying the ratio between its own weight
  // and the one below it - and then the blend carrying `strength * 3.0 * weights[0]`.
  // Read off the material the pass bound rather than recomputed here.
  const w = bloomWeights(0.7);
  const draws = seen.filter(([what]) => what === 'render');
  const ups = draws.slice(BLOOM_LEVELS, BLOOM_LEVELS + BLOOM_LEVELS - 1).map(([, , weight]) => weight);
  const want = [4, 3, 2, 1].map((i) => w[i] / w[i - 1]);
  ups.forEach((got, n) => assert.ok(Math.abs(got - want[n]) < 1e-12,
    `upsample ${n} carried ${got}, wants ${want[n]}`));
  const blend = draws[draws.length - 1][3];
  assert.ok(Math.abs(blend - 0.5 * BLOOM_COMPAT_GAIN * w[0]) < 1e-12,
    `the blend carried ${blend}, wants strength * ${BLOOM_COMPAT_GAIN} * ${w[0]}`);
  // The two shapes the pass shipped in, each of which satisfies every other row here.
  assert.ok(ups.some((got) => Math.abs(got - 1) > 1e-9), 'an unweighted up chain is a different answer');
  assert.ok(Math.abs(blend - 0.5) > 1e-9, 'and a blend carrying strength alone is another');

  // **The falsification control, and it is the shipped state rather than an invented
  // one.** A renderer whose `autoClear` will not go down puts every draw in exactly the
  // position `124a90b` left them in, so the row above has to go red against it - and a
  // pass that had simply never touched the flag would put them there too. It is worth
  // spelling out that the failure this catches is invisible in a picture: a chain that
  // has lost four of its five octaves still draws a halo of the right width in the right
  // places, one fifth as bright, and no arm in `export-check` reads absolute brightness.
  const refuses = [];
  const stubborn = {
    _target: null,
    get autoClear() { return true; },
    set autoClear(_v) { /* the write the pass makes, declined */ },
    getRenderTarget() { return this._target; },
    setRenderTarget(t) { this._target = t; },
    clear() {},
    render() { refuses.push(this.autoClear); },
  };
  const second = new BloomPass(0.5, 0.7, 0.2);
  second.setSize(480, 300);
  second.render(stubborn, { texture: {} }, target);
  assert.ok(refuses.length === 10 && refuses.every((auto) => auto === true),
    'the control has to be able to see draws that run with autoClear up');

  pass.dispose();
  second.dispose();
});
