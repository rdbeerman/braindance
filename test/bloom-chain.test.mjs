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
import { BloomPass, BLOOM_LEVELS, bloomChainSize } from '../web/bloom-pass.js';

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
