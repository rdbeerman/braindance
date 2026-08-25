// The door a sensor frame reaches the GPU through, driven headless: a `DataTexture` is a typed
// array with flags until a renderer uploads it. It says nothing about pixels - a texture bound
// correctly and sampled with the wrong intrinsics is green here and wrong on screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEPTH_H, DEPTH_W } from '../web/format.js';
import {
  buildTextures, bindDepth, bindColor, plantColor, depthCurr, colorPrev, colorCurr,
} from '../web/gpu-textures.js';

const cells = buildTextures();

/** A block at divisor `k`, every sample carrying the index it was measured at. */
const block = (k) => {
  const w = Math.ceil(DEPTH_W / k);
  const h = Math.ceil(DEPTH_H / k);
  const out = new Uint16Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (i % 4000) + 1;
  return { data: out, w, h };
};

/** Where the shipped rule says a full-grid texel takes its sample from, written out longhand
 *  so this cannot agree with the module by construction. */
const sampledAt = (row, col, k, w) => ((row / k) | 0) * w + ((col / k) | 0);

test('the cells the cloud composes are the textures the door owns, and depth starts empty', () => {
  assert.equal(cells.depthCurr.value, depthCurr);
  assert.notEqual(cells.depthPrev.value, cells.depthCurr.value);
  assert.equal(cells.hasColor.value, 0);
  assert.equal(depthCurr.image.data.length, DEPTH_W * DEPTH_H);
  assert.ok(depthCurr.image.data.every((v) => v === 0), 'a frame nobody has bound is all zeroes');
});

test('a full-rate block lands one sample per texel, and the pair swaps under it', () => {
  const wasCurrent = cells.depthCurr.value;
  const willBeCurrent = cells.depthPrev.value;
  // `needsUpdate` is write-only on a three.js texture, so a bind asking for an upload only
  // shows as the version behind it moving.
  const version = willBeCurrent.version;
  const { data } = block(1);
  bindDepth(data);
  assert.equal(cells.depthPrev.value, wasCurrent, 'what was current is now previous');
  assert.equal(cells.depthCurr.value, willBeCurrent);
  assert.deepEqual(cells.depthCurr.value.image.data, data);
  assert.ok(cells.depthCurr.value.version > version, 'the bind asks for an upload');
});

test('a decimated block puts every sample on the ray it was measured on', () => {
  for (const k of [2, 4, 8, 16]) {
    const { data, w } = block(k);
    bindDepth(data);
    const got = cells.depthCurr.value.image.data;
    let wrong = 0;
    let stale = 0;
    for (let row = 0; row < DEPTH_H; row++) {
      for (let col = 0; col < DEPTH_W; col++) {
        const want = data[sampledAt(row, col, k, w)];
        if (got[row * DEPTH_W + col] !== want) wrong++;
        if (got[row * DEPTH_W + col] === 0) stale++;
      }
    }
    assert.equal(wrong, 0, `divisor ${k}: every texel reads the sample its own ray was measured at`);
    assert.equal(stale, 0, `divisor ${k}: no texel is left holding the last frame that filled it`);
  }
});

test('a block on no grid at all is refused, and nothing is half written', () => {
  const { data } = block(4);
  bindDepth(data);
  const before = Uint16Array.from(cells.depthCurr.value.image.data);
  assert.throws(
    () => bindDepth(new Uint16Array(1234)),
    /1234 samples is not the 512x424 grid at any divisor/,
  );
  const held = [cells.depthPrev.value, cells.depthCurr.value].map((t) => t.image.data);
  assert.ok(held.some((d) => d.every((v, i) => v === before[i])), 'the frame that had bound is intact');
});

test('the colour pair swaps too, and binding one is what says there is colour at all', () => {
  const before = cells.colorCurr.value;
  const bitmap = { width: 4, height: 4 };
  bindColor(bitmap);
  assert.equal(cells.colorPrev.value, before);
  assert.equal(cells.colorCurr.value.image, bitmap);
  assert.equal(cells.hasColor.value, 1);
  assert.equal(colorPrev, before);
  assert.notEqual(colorCurr, before);
});

test('a planted colour points both samplers at one texture, so no side of the pair is favoured', () => {
  plantColor(new Uint8Array([255, 0, 0, 255]), 1, 1);
  assert.equal(cells.colorPrev.value, cells.colorCurr.value);
  assert.equal(cells.hasColor.value, 1);
  assert.ok(cells.colorCurr.value instanceof THREE.DataTexture);
  assert.equal(cells.colorCurr.value.colorSpace, THREE.SRGBColorSpace);
});
