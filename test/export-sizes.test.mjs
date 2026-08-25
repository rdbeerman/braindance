// The table of output resolutions, walked whole. A render arm samples four sizes and says
// nothing about the eight it does not, which is how four arms all at 1.6 once passed against
// a menu that was all 16:9.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_SIZES, DEFAULT_EXPORT_SIZE, reduceAspect, exportAspects, sizesForAspect,
} from '../web/export-sizes.js';

/** The ratio a label claims. Two labels do not survive a naive `split(':')`, so this reads
 *  the leading `a:b` and ignores whatever names the format after it. */
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
  for (const group of EXPORT_SIZES) {
    const [[w0, h0]] = group.sizes;
    for (const [w, h] of group.sizes) {
      assert.ok(Math.abs(w / h - w0 / h0) < 1e-12,
        `${group.ratio}: ${w}x${h} is ${w / h} where ${w0}x${h0} is ${w0 / h0}`);
    }
  }
});

// The tolerance admits `1.90:1 DCI`, which is really 1.8963 and 0.195% out. It is measurably
// not fine enough to see 65:24 drift, which is the exactness row below - hence two rows.
test('every label is the shape it labels, to within the rounding a label may do', () => {
  for (const { ratio, w, h } of every()) {
    const claimed = declaredRatio(ratio);
    const actual = w / h;
    assert.ok(Math.abs(actual - claimed) / claimed <= 0.0025,
      `${ratio} claims ${claimed} and ${w}x${h} is ${actual}`);
  }
});

test('65:24 is exact rather than nearly right, which is what its widths were chosen for', () => {
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

test('a pair reduces to lowest terms, so two sizes of one shape compare equal', () => {
  assert.deepEqual(reduceAspect(1920, 1080), [16, 9]);
  assert.deepEqual(reduceAspect(1280, 720), [16, 9]);
  assert.deepEqual(reduceAspect(2048, 1080), [256, 135]);
  assert.deepEqual(reduceAspect(1000, 1000), [1, 1]);
});

test('a degenerate pair answers [0, 0] rather than dividing by zero', () => {
  assert.deepEqual(reduceAspect(0, 0), [0, 0]);
  assert.deepEqual(reduceAspect(1920, 0), [1, 0]);
});

// `while (b)` is false for NaN, so a naive reduction hands back `[NaN, NaN]` and Infinity
// comes back as `[Infinity, 1]`, which `sameAspect` would read as a shape.
test('and anything that is not two finite numbers answers [0, 0] too', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, {}, [], 'wide']) {
    assert.deepEqual(reduceAspect(bad, 9), [0, 0], `reduceAspect(${String(bad)}, 9)`);
    assert.deepEqual(reduceAspect(16, bad), [0, 0], `reduceAspect(16, ${String(bad)})`);
  }
  assert.deepEqual(reduceAspect(null, 9), [0, 0]);
});

test('a shape that is not a pair of two is not a shape, however it is spelled', () => {
  for (const bad of [null, undefined, {}, '16:9', 42, [], [16], [16, 9, 1], [16, 9, 1, 1]]) {
    assert.deepEqual(sizesForAspect(bad), [], `sizesForAspect(${JSON.stringify(bad) ?? String(bad)})`);
  }
  assert.ok(sizesForAspect([16, 9]).length > 0);
});

test('every size in a group reduces to the same integer pair, not merely the same ratio', () => {
  for (const group of EXPORT_SIZES) {
    const first = reduceAspect(group.sizes[0][0], group.sizes[0][1]);
    for (const [w, h] of group.sizes) {
      assert.deepEqual(reduceAspect(w, h), first,
        `${group.ratio}: ${w}x${h} reduces to ${reduceAspect(w, h)} where the group is ${first}`);
    }
  }
});

// `sizesForAspect` finds the first group of a shape, so a duplicate pair is a set of sizes no
// menu can ever show - the one failure in this file that hides rather than shows.
test('no two groups are the same shape, or one of them is unreachable', () => {
  const seen = new Map();
  for (const { ratio, aspect } of exportAspects()) {
    const key = aspect.join(':');
    assert.ok(!seen.has(key), `${ratio} is ${key}, which ${seen.get(key)} already is`);
    seen.set(key, ratio);
  }
});

test('exportAspects names every group once, with the label the menu prints', () => {
  const aspects = exportAspects();
  assert.equal(aspects.length, EXPORT_SIZES.length);
  for (const [i, group] of EXPORT_SIZES.entries()) {
    assert.equal(aspects[i].ratio, group.ratio);
    assert.deepEqual(aspects[i].aspect, reduceAspect(group.sizes[0][0], group.sizes[0][1]));
  }
});

test('sizesForAspect returns exactly the group of that shape, which is the round trip', () => {
  for (const { ratio, aspect } of exportAspects()) {
    const group = EXPORT_SIZES.find((g) => g.ratio === ratio);
    assert.deepEqual(sizesForAspect(aspect), group.sizes,
      `${ratio} does not come back as the sizes it is made of`);
  }
});

test('sizesForAspect hands back a copy, so a caller cannot edit the table', () => {
  const [{ aspect }] = exportAspects();
  const sizes = sizesForAspect(aspect);
  sizes[0][0] = -1;
  sizes.push([1, 1]);
  assert.notEqual(EXPORT_SIZES[0].sizes[0][0], -1, 'a row of the table was edited through the copy');
  assert.equal(EXPORT_SIZES[0].sizes.length, sizesForAspect(aspect).length, 'the table grew');
});

// `[8, 5]` on purpose: 1600x1000 is the hand-typed `outputSize` a project saved before the
// split, and `openingSizeForAspect` reads the empty answer as "keep the size the document named".
test('a shape the table has nothing for is empty rather than a nearest neighbour', () => {
  assert.deepEqual(reduceAspect(1600, 1000), [8, 5]);
  assert.deepEqual(sizesForAspect([8, 5]), []);
  assert.deepEqual(sizesForAspect([0, 0]), []);
});
