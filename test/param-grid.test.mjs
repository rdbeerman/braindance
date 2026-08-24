// How far the registry rounds a value after snapping it onto its slider's grid.
//
// `normalise` in `web/main.js` snaps onto `step` and then rounds to the decimals `min` and
// `step` imply, and the rounding is what keeps a value set headlessly and the same value
// set by dragging a slider from landing a hair apart. The snapping needs the registry and
// a document; the decimal count is a pure function of a number, and it is the half that
// was wrong - so it is the half that is held here, under bare node, where the cases can be
// written out rather than driven.
//
// **The defect this file exists for is the exponent spelling.** `String(x)` stops writing
// a decimal point below 1e-6, so a step of `1e-7` read as zero decimals and every value
// that parameter ever held was rounded to a whole number: the slider moved, the readout
// showed a number, and the range had two positions in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalsOf } from '../web/format.js';

test('a decimal spelling is counted after the point', () => {
  assert.equal(decimalsOf(1), 0);
  assert.equal(decimalsOf(0.5), 1);
  assert.equal(decimalsOf(0.01), 2);
  assert.equal(decimalsOf(0.005), 3);
  // The finest step the shipped set declares, and the finest a decimal spelling reaches
  // before JavaScript switches notation on it.
  assert.equal(decimalsOf(0.000001), 6);
  assert.equal(decimalsOf(-0.25), 2);
});

test('an exponent spelling is counted through the exponent', () => {
  // The case that shipped wrong. `String(1e-7)` is "1e-7" and carries no point at all,
  // so the rule that looked for one answered zero.
  assert.equal(String(1e-7).includes('.'), false, 'the premise: this number has no decimal point in it');
  assert.equal(decimalsOf(1e-7), 7);
  assert.equal(decimalsOf(1.5e-7), 8);
  assert.equal(decimalsOf(2.25e-9), 11);
  assert.equal(decimalsOf(1e-21), 21);
});

test('a number with nothing after the point needs no places', () => {
  // The other direction of the same spelling, and the one a naive fix gets backwards: a
  // large number written with an exponent has no fraction to keep, and asking `toFixed`
  // for a negative count throws.
  assert.equal(decimalsOf(1e21), 0);
  assert.equal(decimalsOf(1.5e21), 0);
  assert.equal(decimalsOf(100), 0);
});

test('the count stays inside what toFixed will accept', () => {
  // `toFixed` throws a RangeError above 100 places, and the caller rounds with it. The
  // install door refuses a step finer than 1e-6 long before this, so the cap is about the
  // parameters declared inside this repo rather than about a package.
  assert.equal(decimalsOf(1e-300), 100);
  assert.doesNotThrow(() => (0.5).toFixed(decimalsOf(1e-300)));
});

test('the rounding the registry performs keeps a fine grid rather than collapsing it', () => {
  // The rule as `normalise` composes it, written out here because the composition is what
  // the defect was about: a correct decimal count that nothing rounded with would have
  // been just as invisible. This is the arithmetic of `normalise`'s scalar branch with the
  // registry taken out of it.
  const snap = (spec, v) => {
    const clamped = Math.min(spec.max, Math.max(spec.min, v));
    const snapped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step;
    const decimals = Math.max(decimalsOf(spec.min), decimalsOf(spec.step));
    return Math.min(spec.max, Math.max(spec.min, Number(snapped.toFixed(decimals))));
  };
  const fine = { min: 0, max: 1, step: 1e-7 };
  assert.equal(snap(fine, 0.0000003), 0.0000003);
  assert.equal(snap(fine, 0.5000001), 0.5000001);
  // The falsification: a build that answered zero decimals for this step - which is what
  // shipped - rounds both of those to whole numbers, so the range has 0 and 1 in it.
  const collapsed = (spec, v) => Number((spec.min + Math.round((v - spec.min) / spec.step) * spec.step).toFixed(0));
  assert.equal(collapsed(fine, 0.5000001), 1, 'the premise: rounding to no places is what destroyed the range');
});
