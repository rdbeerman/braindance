import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RATE_MAX, RATE_MIN, frameLoadByTake, rescaleClipKeys, snapshotClipKeys, usableClipRate,
} from '../web/clip-plan.js';

test('shared-take cache demand counts each requested frame once', () => {
  const take = {};
  const other = {};
  const load = frameLoadByTake([
    { take, from: 10, to: 20 },
    { take, from: 15, to: 25 },
    { take, from: 40, to: 42 },
    { take: other, from: 0, to: 1 },
  ]);
  assert.equal(load.get(take), 19);
  assert.equal(load.get(other), 2);
});

test('a clip speed change rescales only that clip local keys', () => {
  const clipTracks = [{ keys: [{ t: 2 }, { t: 6 }] }];
  const camera = { keys: [{ t: 12 }] };
  const snapshot = snapshotClipKeys(clipTracks);
  rescaleClipKeys(snapshot, 0.5);
  rescaleClipKeys(snapshot, 0.25);
  assert.deepEqual(clipTracks[0].keys.map((key) => key.t), [0.5, 1.5]);
  assert.equal(camera.keys[0].t, 12);
});

test('stored rates stay inside the same finite range the editor offers', () => {
  assert.equal(usableClipRate(RATE_MIN), true);
  assert.equal(usableClipRate(RATE_MAX), true);
  for (const rate of [0, -1, Number.MIN_VALUE, RATE_MIN - 0.001, RATE_MAX + 0.001, Infinity, NaN]) {
    assert.equal(usableClipRate(rate), false, `${String(rate)} was accepted`);
  }
});
