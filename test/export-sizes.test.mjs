// The table of output resolutions, walked whole.
//
// **This is the assertion a sweep cannot make.** `export-check` renders a handful of
// sizes and compares pixels, which is a stronger claim about the four it visits and says
// nothing at all about the eight it does not - and the failure the table's own comment
// records is exactly that shape: four arms that were all 1.6 against a menu that was all
// 16:9, every arm green and every shipped size wrong. What a test can do that a render
// cannot is range over every row, so what is asserted here is a property of the
// population rather than a sample of it.
//
// The two properties are the two the comment beside the table names. `yuv420p` subsamples
// chroma by two each way, so an odd dimension is not encodable at all and `server/export.js`
// refuses it after the menu has already offered it. And a group's label is what the menu
// prints, so a size that is not the shape its label claims is a number this repo would
// find later and have to correct.
//
// Run by `npm run test:unit`, which needs no server, no sensor and no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_SIZES, DEFAULT_EXPORT_SIZE } from '../web/export-sizes.js';

/**
 * The ratio a label claims, as a number.
 *
 * The parse is stated rather than assumed, because two of the five labels do not survive
 * a naive `split(':')`: `1.90:1 DCI` carries a word after the pair, and `65:24` is the one
 * whose decimal expansion is the thing the comment warns about. So this reads the leading
 * `a:b` and ignores whatever names the format afterwards.
 */
const declaredRatio = (label) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/.exec(label);
  assert.ok(m, `${label} does not open with an a:b ratio, so nothing here knows what it claims`);
  return Number(m[1]) / Number(m[2]);
};

const every = () => EXPORT_SIZES.flatMap((g) => g.sizes.map(([w, h]) => ({ ratio: g.ratio, w, h })));

test('the table is not empty, so every row below ranges over something', () => {
  assert.ok(EXPORT_SIZES.length >= 5, `${EXPORT_SIZES.length} groups`);
  assert.ok(every().length >= 12, `${every().length} sizes`);
});

test('every dimension is even, because yuv420p cannot encode an odd one', () => {
  for (const { ratio, w, h } of every()) {
    assert.equal(w % 2, 0, `${ratio} ${w}x${h} has an odd width`);
    assert.equal(h % 2, 0, `${ratio} ${w}x${h} has an odd height`);
  }
});

test('every size in a group is the same shape, exactly', () => {
  // The strong half, and it is exact rather than tolerant: two sizes under one label that
  // differ at all are two shapes wearing one name, which is the two-lists failure the
  // table exists to stop, arriving inside a single list.
  for (const group of EXPORT_SIZES) {
    const [[w0, h0]] = group.sizes;
    for (const [w, h] of group.sizes) {
      assert.ok(Math.abs(w / h - w0 / h0) < 1e-12,
        `${group.ratio}: ${w}x${h} is ${w / h} where ${w0}x${h0} is ${w0 / h0}`);
    }
  }
});

test('every label is the shape it labels, to within the rounding a label may do', () => {
  // The tolerance is deliberate and so is what it does not buy. `1.90:1 DCI` is really
  // 4096/2160 = 1.8963, which is a label rounded to two places rather than a size that is
  // wrong, and the table's own comment says so - it is 0.195% out, so a quarter of a
  // percent admits it. What this row catches is a label grossly disagreeing with its
  // sizes, which is the failure the comment records: 1.6 against 16:9 is 11% out and this
  // reddens on it. It is measurably *not* a net fine enough to catch 65:24 drifting to
  // the 2.7062 the comment names, which is 0.079% and passes here - that one is the
  // exactness row below, which is why there are two rows and not one.
  for (const { ratio, w, h } of every()) {
    const claimed = declaredRatio(ratio);
    const actual = w / h;
    assert.ok(Math.abs(actual - claimed) / claimed <= 0.0025,
      `${ratio} claims ${claimed} and ${w}x${h} is ${actual}`);
  }
});

test('65:24 is exact rather than nearly right, which is what its widths were chosen for', () => {
  // Named on its own because it is the entry the comment argues about: 2730 and 3900 are
  // there rather than something rounder because 65:24 lands on an even pair only when the
  // height is a multiple of 48. A tolerance cannot see that, so this row does not use one.
  const group = EXPORT_SIZES.find((g) => g.ratio === '65:24');
  assert.ok(group, 'the 65:24 group is gone, so this row is asserting nothing');
  for (const [w, h] of group.sizes) {
    assert.equal(w * 24, h * 65, `${w}x${h} is not exactly 65:24`);
    assert.equal(h % 48, 0, `${w}x${h} has a height that is not a multiple of 48`);
  }
});

test('no two entries share a WxH, because that string is the menu option\'s value', () => {
  const seen = new Set();
  for (const { ratio, w, h } of every()) {
    const key = `${w}x${h}`;
    assert.ok(!seen.has(key), `${key} appears twice, the second time under ${ratio}`);
    seen.add(key);
  }
});

test('the default names a size the table actually offers', () => {
  assert.ok(every().some(({ w, h }) => `${w}x${h}` === DEFAULT_EXPORT_SIZE),
    `${DEFAULT_EXPORT_SIZE} is not in the table, so the menu opens on nothing`);
});
