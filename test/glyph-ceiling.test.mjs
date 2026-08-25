// The unit the glyph field's point-size ceiling is expressed in, held as arithmetic.
//
// **This is the same shape as `test/bloom-chain.test.mjs` and it is here for the same
// reason.** The property is a relation between a screen-space term and the buffer it is
// drawn into, no rendered comparison can see it cheaply, and it is a pure function - so it
// is pinned under bare node instead of through a GPU. The glyph branch clamps the grown
// sprite to `min(255.0 * k, pointCeiling)` framebuffer pixels, where `k` is
// `bufferHeight / 1080.0`, so the *reference-pixel* distance at which a cell-sized sprite
// stops growing is that clamp divided by `k` again. Under the shipped form that comes back
// as the same number at every output size; under the form this replaced - the hardware
// ceiling alone, in framebuffer pixels - it comes back as `pointCeiling / k`, which is not
// constant in `k` by construction. That difference is the whole of what item 15 changed and
// it is one line of arithmetic to state.
//
// **What this cannot see**, stated rather than left to be discovered, because the residual
// is the honest counterpart of the claim: it proves the ceiling is *expressed* in the right
// unit and proves nothing at all about whether a sprite actually stops growing there on a
// GPU. A driver that ignored the clamp, a clamp applied to the wrong branch, or a
// `gl_PointSize` the rasteriser rounds differently are all green here. What closes that end
// is that the clamp is one `clamp()` in one statement in
// `effects-builtin/glyph/size.vert.glsl`, and `registry-check`'s glyph sections draw
// through it on every run - so a clamp that stopped clamping at all takes the tiling with
// it. The narrow gap that stays open is a ceiling that clamps at the wrong *distance* while
// still being written in reference pixels, and no arm in this repo holds that.
//
// The 255 is written out here rather than read out of the shader, for the reason the bloom
// chain's oracle gives about its own 300: a test that asked the implementation what number
// it used would agree with it by construction and could never see the number move. The row
// at the foot of this file is what stops that being a second copy - it requires the GLSL to
// carry this exact literal in this exact expression, which is the mechanism `syntax-check`
// already runs over the constants that cross into `native/grabber.cpp`.
//
// **Which means the last row is the only one that can see the shader at all, and that is
// worth saying rather than leaving somebody to find it in a mutation run.** The four rows
// above it are arithmetic over a rule; they are about this build only because the last one
// binds the rule to the shipped statement. Measured rather than reasoned, by editing
// `effects-builtin/glyph/size.vert.glsl` and running this file: putting the ceiling back to
// `pointCeiling` alone - the regression this arm exists for - fails the binding row and
// leaves the other four green, and retuning the shader's literal to 300 while this file
// still says 255 does exactly the same. Both are caught, neither is caught twice, and a
// reader who deletes the binding row as redundant has deleted the whole instrument.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXPORT_SIZES } from '../web/export-sizes.js';

/** The look's own ceiling, in pixels at 1080p. */
const GLYPH_CEILING_REF = 255;

/**
 * What this rig's context reports for the top of `ALIASED_POINT_SIZE_RANGE`, which is what
 * `pointCeiling` is written out of at boot. Measured off the WebGL context on the page the
 * proof tools open - Apple M2 Max through ANGLE's Metal backend - and a parameter here
 * rather than a constant, because it is a property of a machine and the rows below have to
 * be able to ask what happens on a different one.
 */
const MEASURED_POINT_CEILING = 511;

/** Every buffer height an export can ask for, which is what the invariance ranges over. */
const EXPORT_HEIGHTS = [...new Set(EXPORT_SIZES.flatMap(({ sizes }) => sizes.map(([, h]) => h)))];

/** The shipped clamp, and then the distance it puts the ceiling at in the look's own unit. */
const shipped = (bufferHeight, pointCeiling) => {
  const k = bufferHeight / 1080;
  return Math.min(GLYPH_CEILING_REF * k, pointCeiling) / k;
};

/** What the same reading gives for the form this replaced: the hardware bound, alone. */
const hardwareAlone = (bufferHeight, pointCeiling) => {
  const k = bufferHeight / 1080;
  return pointCeiling / k;
};

test('the ceiling is the same reference-pixel distance at every size an export offers', () => {
  const read = EXPORT_HEIGHTS.map((h) => [h, shipped(h, MEASURED_POINT_CEILING)]);
  for (const [h, ref] of read) {
    assert.equal(ref, GLYPH_CEILING_REF, `a ${h}-tall buffer put the ceiling at ${ref}`);
  }
  // And the table is not one entry, which is what makes the row above range over something.
  assert.ok(EXPORT_HEIGHTS.length >= 4, `only ${EXPORT_HEIGHTS.length} distinct export heights`);
});

test('while the hardware bound alone is a different distance at every size, which is the defect', () => {
  // The falsification row, and the mutation it stands against is putting the ceiling back
  // into framebuffer pixels. Without this every assertion above is satisfied by a build
  // that happens to agree at one height.
  //
  // The direction is the half worth writing down, because it is the opposite of what it
  // looks like. 4K was the *tight* end all along: at 2160 the old ceiling already sat at
  // 255.5 reference pixels where at 1080 it sat at 511, so a look opened gaps at twice the
  // range in a 4K export. The fix pulls every smaller output down to what the tallest one
  // can actually draw rather than lifting 4K, which it cannot - 1022 framebuffer pixels is
  // past what the rasteriser will take.
  const distances = EXPORT_HEIGHTS.map((h) => hardwareAlone(h, MEASURED_POINT_CEILING));
  assert.ok(new Set(distances).size > 1,
    `the hardware bound gave one distance at every height: ${distances.join(', ')}`);
  assert.equal(hardwareAlone(1080, MEASURED_POINT_CEILING), 511);
  assert.equal(hardwareAlone(2160, MEASURED_POINT_CEILING), 255.5);
});

test('255 is the largest ceiling the tallest offered output can actually rasterise', () => {
  // Why the number is that number, held rather than asserted in prose. The clamp cannot ask
  // for more framebuffer pixels than the hardware will draw, so the reference ceiling is
  // bounded by `pointCeiling` divided by the largest scale an export reaches - and the
  // tallest entry in the table is what decides it.
  const tallest = Math.max(...EXPORT_HEIGHTS);
  const largestScale = tallest / 1080;
  assert.equal(largestScale, 2, `the tallest export is ${tallest}, a scale of ${largestScale}`);
  assert.ok(GLYPH_CEILING_REF * largestScale <= MEASURED_POINT_CEILING,
    `${GLYPH_CEILING_REF} * ${largestScale} is past the ${MEASURED_POINT_CEILING} this rig draws`);
  assert.ok((GLYPH_CEILING_REF + 1) * largestScale > MEASURED_POINT_CEILING,
    `${GLYPH_CEILING_REF + 1} would also have fitted, so this is not the largest`);
});

test('and on a GPU that cannot draw it the hardware wins, which is the bound doing its job', () => {
  // Not a defect and not hidden: a machine whose rasteriser stops below the look's ceiling
  // clamps tighter than the document asked, and the invariance lapses there rather than the
  // clamp quietly asking for a sprite that will not be drawn. The same lapse is what an
  // interactive window reaches past a scale of 2, which only `renderScale` wound up gets to.
  const small = 128;
  assert.equal(shipped(2160, small), small / 2);
  assert.equal(shipped(1080, small), small);
  assert.notEqual(shipped(2160, small), shipped(1080, small));
  // While a machine with headroom to spare holds the look's number rather than reaching for
  // the headroom, which is what keeps a document portable between the two.
  assert.equal(shipped(2160, 8192), GLYPH_CEILING_REF);
  assert.equal(shipped(1080, 8192), GLYPH_CEILING_REF);
});

test('the shader carries this exact ceiling, so the number above is not a second copy', () => {
  // The cross-language half. `GLYPH_CEILING_REF` is stated once, in JavaScript, and the GLSL
  // is required to agree with it - so retuning the ceiling in the shader without retuning it
  // here fails under bare node rather than drifting. The whole statement is matched rather
  // than the literal alone, because `255.0` appearing somewhere in the file is not the same
  // fact as the clamp being written against the buffer scale.
  const src = readFileSync(new URL('../effects-builtin/glyph/size.vert.glsl', import.meta.url), 'utf8');
  const clamp = `min(${GLYPH_CEILING_REF}.0 * k, pointCeiling)`;
  assert.ok(src.includes(clamp), `the glyph branch does not clamp to ${clamp}`);
  // And it is the grown sprite that is bounded by it, not the fallback beside it - the else
  // branch keeps the literal 64 it always had, which `export-check`'s `pointsize-absolute`
  // anchors on.
  assert.ok(src.includes(`gl_PointSize = clamp(mix(base, cellPx * k, glyph), 1.0, ${clamp});`),
    'the reference ceiling is not on the glyph branch');
  assert.ok(src.includes('gl_PointSize = clamp(pointSize * k / max(0.15, -mv.z), 1.0, 64.0);'),
    'the fallback branch no longer carries the statement export-check anchors on');
});
