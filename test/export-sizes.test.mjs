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
import {
  EXPORT_SIZES, DEFAULT_EXPORT_SIZE, reduceAspect, exportAspects, sizesForAspect,
} from '../web/export-sizes.js';

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

// ------------------------------------------------- the shape a size is, and back again
//
// The three rows above this line are about the table. These are about the arithmetic over
// it that the aspect/rate split rests on: a project stores the reduced integer pair rather
// than a size, so `[16, 9]` from one document has to equal `[16, 9]` from another, and the
// resolution menu is `sizesForAspect` of whatever the document holds. Every claim below is
// one a comment in `web/export-sizes.js` makes in prose, asserted here because that file is
// data and a module that throws while it is being imported takes the page down at boot
// rather than saying which row is wrong.

test('a pair reduces to lowest terms, so two sizes of one shape compare equal', () => {
  assert.deepEqual(reduceAspect(1920, 1080), [16, 9]);
  assert.deepEqual(reduceAspect(1280, 720), [16, 9]);
  // The case `reduceAspect`'s comment argues from: DCI is 1.8963 as a decimal and exact as
  // a pair, which is why the pair is what a document carries.
  assert.deepEqual(reduceAspect(2048, 1080), [256, 135]);
  assert.deepEqual(reduceAspect(1000, 1000), [1, 1]);
});

test('a degenerate pair answers [0, 0] rather than dividing by zero', () => {
  // `aspectOfSize` in `web/main.js` leans on this: a document field that is not a size at
  // all has to come back as a shape nothing matches, not as a NaN that compares unequal to
  // itself and lights no button for a reason nobody can read.
  assert.deepEqual(reduceAspect(0, 0), [0, 0]);
  assert.deepEqual(reduceAspect(1920, 0), [1, 0]);
});

test('and anything that is not two finite numbers answers [0, 0] too', () => {
  // **This row is here because the one above was named for a promise it did not test.** It
  // said "a degenerate pair" and checked two pairs of real numbers, so `NaN` walked
  // straight through the reduction - `while (b)` is false for NaN - and came back as
  // `[NaN, NaN]`, while Infinity came back as `[Infinity, 1]`, which `sameAspect` would
  // read as a shape. Two reviewers found the gap independently and neither could reach it
  // from a document, because every caller guards first. A contract kept only by every
  // caller's discipline is one the next caller breaks, so it is kept here instead.
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, {}, [], 'wide']) {
    assert.deepEqual(reduceAspect(bad, 9), [0, 0], `reduceAspect(${String(bad)}, 9)`);
    assert.deepEqual(reduceAspect(16, bad), [0, 0], `reduceAspect(16, ${String(bad)})`);
  }
  // `null` coerces to 0 through `Number.isFinite`? It does not - `Number.isFinite(null)`
  // is false, which is the answer wanted here and is worth pinning, because the older
  // `w > 0` style guard would have let `null` through as 0 and produced `[0, 1]`.
  assert.deepEqual(reduceAspect(null, 9), [0, 0]);
});

test('a shape that is not a pair of two is not a shape, however it is spelled', () => {
  // Both halves shipped wrong and they failed in opposite directions. A `null` or an
  // object is not iterable, so the bare destructure threw a TypeError out of a function
  // whose documented answer for "no such shape" is `[]` - and it is called while the
  // resolution menu is being rebuilt, so the throw landed in a repaint rather than at the
  // document that caused it. A three-element array did the more dangerous thing: the
  // destructure read the first two and ignored the rest, so `[16, 9, 1]` matched the 16:9
  // group and was accepted as a shape.
  for (const bad of [null, undefined, {}, '16:9', 42, [], [16], [16, 9, 1], [16, 9, 1, 1]]) {
    assert.deepEqual(sizesForAspect(bad), [], `sizesForAspect(${JSON.stringify(bad) ?? String(bad)})`);
  }
  // And the pair it is spelled as still works, or the row above passes by refusing
  // everything.
  assert.ok(sizesForAspect([16, 9]).length > 0);
});

test('every size in a group reduces to the same integer pair, not merely the same ratio', () => {
  // **Stronger than the float row above, and the difference is what the split needs.** That
  // row asks whether `w/h` agrees to within 1e-12, which is a question about a quotient;
  // this asks whether the *pairs* are identical, which is the question `sameAspect` actually
  // puts. A group whose sizes agreed as quotients but reduced differently would offer a
  // resolution menu that dropped half its own rows, because `sizesForAspect` matches on the
  // pair.
  for (const group of EXPORT_SIZES) {
    const first = reduceAspect(group.sizes[0][0], group.sizes[0][1]);
    for (const [w, h] of group.sizes) {
      assert.deepEqual(reduceAspect(w, h), first,
        `${group.ratio}: ${w}x${h} reduces to ${reduceAspect(w, h)} where the group is ${first}`);
    }
  }
});

test('no two groups are the same shape, or one of them is unreachable', () => {
  // `sizesForAspect` finds the *first* group of a shape, so a second group carrying the same
  // pair would be a set of sizes the product ships and no menu can ever show. That is the
  // one failure in this file that hides rather than shows: nothing throws, the menu is
  // simply short.
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
  // The one list is the whole argument of this file, and a returned alias would let the
  // resolution menu's builder mutate it - which is the second list arriving by the back
  // door rather than by a second declaration.
  const [{ aspect }] = exportAspects();
  const sizes = sizesForAspect(aspect);
  sizes[0][0] = -1;
  sizes.push([1, 1]);
  assert.notEqual(EXPORT_SIZES[0].sizes[0][0], -1, 'a row of the table was edited through the copy');
  assert.equal(EXPORT_SIZES[0].sizes.length, sizesForAspect(aspect).length, 'the table grew');
});

test('a shape the table has nothing for is empty rather than a nearest neighbour', () => {
  // `[8, 5]` on purpose: 1600x1000 is the hand-typed `outputSize` a project saved before
  // the split could carry, and 1.6 is the exact ratio of the four-arms failure this file's
  // header records. `openingSizeForAspect` in `web/main.js` reads this empty answer as
  // "keep the size the document actually named", so an empty array here is a documented
  // answer with a caller rather than an oversight.
  assert.deepEqual(reduceAspect(1600, 1000), [8, 5]);
  assert.deepEqual(sizesForAspect([8, 5]), []);
  assert.deepEqual(sizesForAspect([0, 0]), []);
});
