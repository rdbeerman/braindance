// How far the registry rounds a value after snapping it onto its slider's grid. The defect this
// exists for is the exponent spelling: `String(1e-7)` has no decimal point, so that step read as
// zero decimals and every value it held was rounded to a whole number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalsOf, snapScalar } from '../web/format.js';

test('a decimal spelling is counted after the point', () => {
  assert.equal(decimalsOf(1), 0);
  assert.equal(decimalsOf(0.5), 1);
  assert.equal(decimalsOf(0.01), 2);
  assert.equal(decimalsOf(0.005), 3);
  assert.equal(decimalsOf(0.000001), 6);
  assert.equal(decimalsOf(-0.25), 2);
});

test('an exponent spelling is counted through the exponent', () => {
  assert.equal(String(1e-7).includes('.'), false, 'the premise: this number has no decimal point in it');
  assert.equal(decimalsOf(1e-7), 7);
  assert.equal(decimalsOf(1.5e-7), 8);
  assert.equal(decimalsOf(2.25e-9), 11);
  assert.equal(decimalsOf(1e-21), 21);
});

test('a number with nothing after the point needs no places', () => {
  assert.equal(decimalsOf(1e21), 0);
  assert.equal(decimalsOf(1.5e21), 0);
  assert.equal(decimalsOf(100), 0);
});

// `toFixed` throws a RangeError above 100 places and the caller rounds with it. The install
// door refuses a step finer than 1e-6, so the cap is about parameters declared inside this repo.
test('the count stays inside what toFixed will accept', () => {
  assert.equal(decimalsOf(1e-300), 100);
  assert.doesNotThrow(() => (0.5).toFixed(decimalsOf(1e-300)));
});

test('past the cap the rounding rewrites a bound rather than refusing it', () => {
  assert.equal(Number((1.5e-100).toFixed(decimalsOf(1.5e-100))), 2e-100,
    'a bound needing 101 places is written to 100, so it is a different bound');
  assert.equal(Number((1e-101).toFixed(decimalsOf(1e-101))), 0,
    'and one further out is written as zero, so the parameter has a floor its manifest never named');
  assert.equal(Number((1e-100).toFixed(decimalsOf(1e-100))), 1e-100,
    'while a bound the cap can still express is itself, which is what says the two above are the cap rather than toFixed');

  assert.equal(snapScalar({ min: 1e-101, max: 3, step: 0.05 }, 0.7), 0.7000000000000001,
    'a floor past the cap moves a value that is exactly on the grid');
  assert.equal(snapScalar({ min: 0, max: 3, step: 0.05 }, 0.7), 0.7,
    'and the same value on an ordinary floor does not, which is what makes the row above about the floor');
});

test('the rounding the registry performs keeps a fine grid rather than collapsing it', () => {
  // `normalise`'s scalar branch with the registry taken out of it: a correct decimal count
  // that nothing rounded with would have been just as invisible, so the composition is the claim.
  const snap = (spec, v) => {
    const clamped = Math.min(spec.max, Math.max(spec.min, v));
    const snapped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step;
    const decimals = Math.max(decimalsOf(spec.min), decimalsOf(spec.step));
    return Math.min(spec.max, Math.max(spec.min, Number(snapped.toFixed(decimals))));
  };
  const fine = { min: 0, max: 1, step: 1e-7 };
  assert.equal(snap(fine, 0.0000003), 0.0000003);
  assert.equal(snap(fine, 0.5000001), 0.5000001);
  const collapsed = (spec, v) => Number((spec.min + Math.round((v - spec.min) / spec.step) * spec.step).toFixed(0));
  assert.equal(collapsed(fine, 0.5000001), 1, 'the premise: rounding to no places is what destroyed the range');
});
