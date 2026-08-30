import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RATE_MAX, RATE_MIN, frameLoadByTake, integerMidpoint, rescaleClipKeys, snapshotClipKeys,
  usableClipRate,
} from '../web/clip-plan.js';

test('bisection midpoints stay inside safe-integer intervals above the signed 32-bit range', () => {
  assert.equal(integerMidpoint(2_900_000_000, 3_000_000_000), 2_950_000_000);
  assert.equal(integerMidpoint(2_900_000_000, 3_000_000_000, true), 2_950_000_000);
  assert.equal(integerMidpoint(3_000_000_000, 3_000_000_001), 3_000_000_000);
  assert.equal(integerMidpoint(3_000_000_000, 3_000_000_001, true), 3_000_000_001);
});

test('a large-frame cache bisection converges on its first fitting frame', () => {
  const firstFit = 3_000_001_461;
  let lo = 2_999_999_100;
  let hi = 3_000_002_100;
  let turns = 0;
  while (lo < hi && turns < 64) {
    const mid = integerMidpoint(lo, hi);
    if (mid >= firstFit) hi = mid;
    else lo = mid + 1;
    turns++;
  }
  assert.equal(lo, firstFit);
  assert.ok(turns < 64, `${turns} turns did not converge`);
});

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
