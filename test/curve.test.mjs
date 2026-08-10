// The scalar curve maths, called directly.
//
// This is the first test in this repo that is not a proof tool, and the distinction is
// worth stating because it decides what belongs here. The proof tools drive the real
// running system and ask it questions a browser can answer - pixels, timing, focus, the
// wire - and they carry mutations because a check that indirect can pass while testing
// nothing. This file does the opposite thing: it imports arithmetic and calls it. It
// exists because `web/curve.js` has no renderer, no DOM and no registry in it, so there
// is nothing between the assertion and the answer.
//
// **It supplements the proof tools and replaces none of them.** A unit test asserting
// that an ease returns numbers is strictly weaker than the pixel comparison
// `registry-check` already makes, and the day somebody deletes the latter because this
// exists is the day the suite got worse. What this catches that the tools cannot is the
// edge case a rendered frame never visits: a single key, coincident keys, a query
// before the first key or after the last.
//
// Run by `npm test`, which needs no server, no sensor and no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EASE_OUT_LINEAR, EASE_IN_LINEAR, easeAt, easeParam, keyBefore,
  HOLD_ENDS, EXTEND_ENDS, scalarAt, scalarSlopeAt, stepAt, hermite,
} from '../web/curve.js';

/** A key as the tracks build one: a time, a value, and the two handles around it. */
const key = (t, value) => ({ t, value, easeOut: EASE_OUT_LINEAR, easeIn: EASE_IN_LINEAR });
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('keyBefore answers -1 before the first key rather than 0', () => {
  const keys = [key(1, 10), key(2, 20)];
  assert.equal(keyBefore(keys, 0.5), -1);
  assert.equal(keyBefore(keys, 1), 0);
  assert.equal(keyBefore(keys, 1.5), 0);
  assert.equal(keyBefore(keys, 9), 1);
});

test('a linear ease is the identity, which is what makes it the default handle', () => {
  for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    assert.ok(near(easeAt(EASE_OUT_LINEAR, EASE_IN_LINEAR, x), x, 1e-6),
      `eased ${x} to ${easeAt(EASE_OUT_LINEAR, EASE_IN_LINEAR, x)}`);
  }
});

test('easeParam pins both ends exactly, so a segment starts and finishes on its keys', () => {
  assert.ok(near(easeParam(1 / 3, 2 / 3, 0), 0, 1e-6));
  assert.ok(near(easeParam(1 / 3, 2 / 3, 1), 1, 1e-6));
});

test('scalarAt returns a key\'s own value at that key\'s time', () => {
  const keys = [key(0, 5), key(1, 9), key(2, -3)];
  assert.ok(near(scalarAt(keys, 0, HOLD_ENDS), 5));
  assert.ok(near(scalarAt(keys, 1, HOLD_ENDS), 9));
  assert.ok(near(scalarAt(keys, 2, HOLD_ENDS), -3));
});

test('scalarAt interpolates monotonically between two rising keys', () => {
  const keys = [key(0, 0), key(1, 10)];
  let last = -Infinity;
  for (let t = 0; t <= 1.00001; t += 0.05) {
    const v = scalarAt(keys, t, HOLD_ENDS);
    assert.ok(v >= last - 1e-9, `value fell at t=${t}: ${v} after ${last}`);
    assert.ok(v >= -1e-9 && v <= 10 + 1e-9, `value left the span at t=${t}: ${v}`);
    last = v;
  }
});

// The two end policies, which are a real behavioural fork rather than a detail: a track
// that holds and a track that extends answer differently everywhere outside the keys,
// and only one of them can be right for a given parameter.
test('HOLD_ENDS holds the outer values and EXTEND_ENDS keeps the slope going', () => {
  const keys = [key(1, 10), key(2, 20)];
  assert.ok(near(scalarAt(keys, -5, HOLD_ENDS), 10));
  assert.ok(near(scalarAt(keys, 99, HOLD_ENDS), 20));
  assert.ok(scalarAt(keys, 0, EXTEND_ENDS) < 10, 'extending back should fall below the first key');
  assert.ok(scalarAt(keys, 3, EXTEND_ENDS) > 20, 'extending on should rise past the last key');
});

test('a single key answers with its value everywhere, and no keys answers 0', () => {
  assert.equal(scalarAt([key(4, 7)], 0, HOLD_ENDS), 7);
  assert.equal(scalarAt([key(4, 7)], 99, EXTEND_ENDS), 7);
  assert.equal(scalarAt([], 0, HOLD_ENDS), 0);
});

// Coincident keys are a legal transient while one is being dragged onto another. The
// browser never renders long enough to catch it and the division it would otherwise do
// is by zero, so this is exactly the case a proof tool cannot reach and this can.
test('coincident keys give the later value rather than dividing by zero', () => {
  const keys = [key(1, 10), key(1, 20)];
  const v = scalarAt(keys, 1, HOLD_ENDS);
  assert.ok(Number.isFinite(v), `expected a number, got ${v}`);
  assert.equal(v, 20);
});

test('stepAt holds the earlier value across a segment and never interpolates', () => {
  const keys = [key(0, 0), key(1, 1)];
  assert.equal(stepAt(keys, 0), 0);
  assert.equal(stepAt(keys, 0.99), 0);
  assert.equal(stepAt(keys, 1), 1);
  assert.equal(stepAt(keys, -1), 0, 'before the first key it holds the first value');
});

test('scalarSlopeAt is positive while rising, negative while falling, flat when level', () => {
  assert.ok(scalarSlopeAt([key(0, 0), key(1, 10)], 0.5) > 0);
  assert.ok(scalarSlopeAt([key(0, 10), key(1, 0)], 0.5) < 0);
  assert.ok(near(scalarSlopeAt([key(0, 4), key(1, 4)], 0.5), 0, 1e-6));
});

test('hermite lands on its endpoints, so a segment meets the keys it spans', () => {
  assert.ok(near(hermite(0, 10, 0, 0, 1, 0), 0, 1e-9));
  assert.ok(near(hermite(0, 10, 0, 0, 1, 1), 10, 1e-9));
});
