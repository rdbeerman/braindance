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
  EASE_OUT_LINEAR, EASE_IN_LINEAR, SEGMENT_POINT_CEILING, easeAt, easeParam, elevate,
  keyBefore, HOLD_ENDS, EXTEND_ENDS, scalarAt, scalarSlopeAt, stepAt, hermite, tangentAt,
  foldRefusal, foldFreeX,
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
  assert.ok(near(easeParam(EASE_OUT_LINEAR, EASE_IN_LINEAR, 0), 0, 1e-6));
  assert.ok(near(easeParam(EASE_OUT_LINEAR, EASE_IN_LINEAR, 1), 1, 1e-6));
});

// ------------------------------------------------- the timing curve at any degree
//
// A side holding a list of control points rather than one is what lets a segment be a
// cubic or a quintic without a second curve family beside this one. The four tests
// below are the claims that generalisation rests on, and each of them is a claim a
// rendered frame cannot make: they are about curves being *equal*, which a picture
// comparison can only ever say two things look alike about.

test('linear is the identity at every degree, so `lin` still means unshaped', () => {
  // Any control points on the diagonal, however many, lie on the diagonal - which is
  // why the linear constants did not have to become functions of the point count.
  const diagonals = [
    [[[1 / 3, 1 / 3]], [[2 / 3, 2 / 3]]],
    [[[0.2, 0.2], [0.4, 0.4]], [[0.6, 0.6], [0.8, 0.8]]],
    [[[0.1, 0.1]], [[0.5, 0.5], [0.7, 0.7], [0.9, 0.9]]],
  ];
  for (const [out, inn] of diagonals) {
    let worst = 0;
    for (let i = 0; i <= 1000; i++) worst = Math.max(worst, Math.abs(easeAt(out, inn, i / 1000) - i / 1000));
    assert.ok(worst < 1e-9, `out ${JSON.stringify(out)} in ${JSON.stringify(inn)} drifted ${worst}`);
  }
});

test('the quintic glide IS 6u^5-15u^4+10u^3, which is what makes it C2 rather than nearly', () => {
  // The claim the `glide` preset rests on. A cubic with its ends pinned can bring the
  // rate to zero at a key but never the acceleration; this shape can, and it can
  // because it is exactly the quintic smoothstep rather than something shaped like it.
  const out = [[0.2, 0], [0.4, 0]];
  const inn = [[0.6, 1], [0.8, 1]];
  let worst = 0;
  for (let i = 0; i <= 10000; i++) {
    const u = i / 10000;
    worst = Math.max(worst, Math.abs(easeAt(out, inn, u) - u * u * u * (10 - 15 * u + 6 * u * u)));
  }
  assert.ok(worst < 1e-12, `glide departs the quintic smoothstep by ${worst}`);
});

test('the glide brings acceleration to zero at both ends and the cubic smooth does not', () => {
  // Measured the way a camera feels it: the second difference of the eased fraction
  // just inside each end. The cubic's is finite and non-zero there - that is the step
  // in acceleration a `smooth` key still departs with - and the quintic's is not.
  const accel = (out, inn, x) => {
    const h = 1e-3;
    return (easeAt(out, inn, x + h) - 2 * easeAt(out, inn, x) + easeAt(out, inn, x - h)) / (h * h);
  };
  const smoothStart = Math.abs(accel([[0.42, 0]], [[0.58, 1]], 2e-3));
  const glideStart = Math.abs(accel([[0.2, 0], [0.4, 0]], [[0.6, 1], [0.8, 1]], 2e-3));
  assert.ok(smoothStart > 1, `the cubic smooth should still step in acceleration, got ${smoothStart}`);
  assert.ok(glideStart < smoothStart / 10,
    `the glide should arrive far flatter: cubic ${smoothStart}, quintic ${glideStart}`);
});

test('elevate adds a control point without moving the curve, which is why +pt is safe', () => {
  // The property the whole `+pt` control rests on. A press that handed you another
  // handle and also moved the camera would be two edits wearing one button.
  const shapes = [
    [EASE_OUT_LINEAR, EASE_IN_LINEAR],
    [[[0.42, 0]], [[0.58, 1]]],
    [[[0.2, 0], [0.4, 0]], [[0.6, 1], [0.8, 1]]],
    [[[0.9, 0.15]], [[0.1, 0.85]]],
  ];
  for (const [out, inn] of shapes) {
    for (const side of ['easeOut', 'easeIn']) {
      const up = elevate(out, inn, side);
      assert.equal(up.easeOut.length + up.easeIn.length, out.length + inn.length + 1);
      assert.equal(up[side].length, (side === 'easeOut' ? out : inn).length + 1,
        'the side that was pressed is the side that grew');
      let worst = 0;
      for (let i = 0; i <= 2000; i++) {
        const x = i / 2000;
        worst = Math.max(worst, Math.abs(easeAt(up.easeOut, up.easeIn, x) - easeAt(out, inn, x)));
      }
      assert.ok(worst < 1e-9,
        `elevating ${side} of ${JSON.stringify([out, inn])} moved the curve by ${worst}`);
    }
  }
});

test('elevating repeatedly to the ceiling still does not move the curve', () => {
  // The ceiling is where the numerics would show up if they were going to, so the
  // walk up to it is the test rather than one step being.
  let out = [[0.42, 0]];
  let inn = [[0.58, 1]];
  const sample = (o, i2) => Array.from({ length: 501 }, (_, i) => easeAt(o, i2, i / 500));
  const before = sample(out, inn);
  while (out.length < SEGMENT_POINT_CEILING) {
    ({ easeOut: out, easeIn: inn } = elevate(out, inn, 'easeOut'));
  }
  const after = sample(out, inn);
  const worst = Math.max(...before.map((v, i) => Math.abs(v - after[i])));
  assert.equal(out.length, SEGMENT_POINT_CEILING);
  assert.ok(worst < 1e-9, `walking to the ceiling moved the curve by ${worst}`);
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

/** A pose key as the camera track builds one, position only - what `tangentAt` reads. */
const pose = (t, x) => ({ t, value: { position: [x, 0, 0] } });

test('tangentAt mirrors the missing neighbour a segment outside, not on top of the end key', () => {
  // The end key duplicated at its own instant would make `span` one segment rather
  // than two and double the tangent, so the curve would leave its first key at twice
  // the speed - and the non-uniform form would then disagree with the textbook
  // uniform one on evenly spaced keys, which is the single case they have to match.
  const keys = [pose(0, 0), pose(1, 3), pose(2, 4)];
  assert.ok(near(tangentAt(keys, 0, 0), 3 / 2, 1e-9), 'half the first segment\'s average velocity');
  assert.ok(near(tangentAt(keys, 2, 0), 1 / 2, 1e-9), 'and half the last segment\'s');
  // The interior one is the plain central difference over neighbour *time*.
  assert.ok(near(tangentAt(keys, 1, 0), 4 / 2, 1e-9));
});

test('tangentAt divides by neighbour time, so uneven spacing is not read as an index', () => {
  // The same three positions, with the middle key moved late. The textbook uniform
  // formula reads the parameter as an index and would answer identically for both;
  // dividing by real time is what stops the camera lurching out of a tight pair.
  const tight = [pose(0, 0), pose(0.2, 3), pose(3.2, 4)];
  const even = [pose(0, 0), pose(1.6, 3), pose(3.2, 4)];
  assert.ok(near(tangentAt(tight, 1, 0), 4 / 3.2, 1e-9));
  assert.ok(near(tangentAt(even, 1, 0), 4 / 3.2, 1e-9));
  // Equal only at the interior key, where both spans are the whole width. The end
  // tangents are where the spacing actually shows, and there they differ by 8x.
  assert.ok(near(tangentAt(tight, 0, 0), 3 / 0.4, 1e-9));
  assert.ok(near(tangentAt(even, 0, 0), 3 / 3.2, 1e-9));
});

test('a linear ease composed into a segment is the identity, which is why the default renders as it did', () => {
  // The property `poseAt` leans on: it eases `u` before handing it to `hermite`, and
  // a key created plain must therefore traverse its segment exactly as it used to.
  // One ulp is the whole budget - anything looser and "unchanged" would be a claim
  // about a tolerance rather than about the arithmetic.
  let worst = 0;
  for (let i = 0; i <= 1000; i++) {
    const u = i / 1000;
    worst = Math.max(worst, Math.abs(easeAt(EASE_OUT_LINEAR, EASE_IN_LINEAR, u) - u));
  }
  assert.ok(worst <= 4e-16, `worst departure from the identity was ${worst}`);
  // And exactly, not nearly, at the ends - a segment starts on its key and finishes
  // on the next one however the handles in between are placed.
  assert.equal(easeAt(EASE_OUT_LINEAR, EASE_IN_LINEAR, 0), 0);
  assert.equal(easeAt(EASE_OUT_LINEAR, EASE_IN_LINEAR, 1), 1);
});

test('an eased u traverses the same points, so shaping the timing cannot move the path', () => {
  // The claim the whole camera-ease change rests on. Easing remaps *when* a segment
  // is at a given fraction, so every position it visits is one the unmapped curve
  // visits too - at a different moment. Sampling the eased curve densely and looking
  // each point up on the unmapped one is the direct way to say that.
  const keys = [pose(0, 0), pose(1, 3), pose(2, 4)];
  const raw = (u) => hermite(0, 3, tangentAt(keys, 0, 0), tangentAt(keys, 1, 0), 1, u);
  const eased = (u) => raw(easeAt([[0.42, 0]], [[0.58, 1]], u));
  for (let i = 0; i <= 100; i++) {
    const u = i / 100;
    // Every eased sample is `raw` at some parameter in the unit range, and the ease
    // is monotonic, so it suffices that the value stays inside the raw curve's own
    // span and that the ends are pinned.
    const v = eased(u);
    assert.ok(v >= Math.min(raw(0), raw(1)) - 1e-9 && v <= Math.max(raw(0), raw(1)) + 1e-9,
      `eased sample ${v} left the raw curve's span at u=${u}`);
  }
  assert.ok(near(eased(0), raw(0), 1e-9));
  assert.ok(near(eased(1), raw(1), 1e-9));
  // And it is genuinely a different traversal rather than a no-op. Without this the
  // whole test would pass against an ease that did nothing at all, which is the shape
  // of a control that looks like it works.
  //
  // **Not at the midpoint, and that is the finding rather than a detail.** The first
  // version of this line sampled u=0.5 and failed against a correct build, because
  // `smooth` is [0.42,0]/[0.58,1] - symmetric about the centre, so the one parameter
  // it provably cannot move is the one that was convenient to ask about. A quarter of
  // the way in is where an ease-out has actually done something.
  assert.ok(!near(eased(0.25), raw(0.25), 1e-6),
    `a smooth ease left the quarter point where linear put it: ${eased(0.25)}`);
  assert.ok(near(eased(0.5), raw(0.5), 1e-9),
    'and the midpoint of a symmetric ease is where it started, which is why it is not the probe');
});

// ------------------------------------------------------- whether a segment folds

test('foldRefusal accepts the legal crossed polygon elevate produces, and its source', () => {
  // The pair the loader once refused: `elevate` of `easeOut [[0.9, 0.1]]` /
  // `easeIn [[0.1, 0.9]]` puts descending control x on the outgoing side - 0.675 then
  // 0.5 - while the curve underneath is single-valued the whole way, its dx/du
  // bottoming out at 0.15. A rule about the polygon refuses it; a rule about the
  // curve must not, or the editor saves documents its own reload declines.
  assert.equal(foldRefusal([[0.9, 0.1]], [[0.1, 0.9]]), null);
  const el = elevate([[0.9, 0.1]], [[0.1, 0.9]], 'easeOut');
  assert.equal(foldRefusal(el.easeOut, el.easeIn), null);
});

test('foldRefusal refuses a fold that ascends within each side, which per-side ordering cannot see', () => {
  // Each side's x ascend - 0.9 alone, then 0.05 to 0.1 - and the composed curve runs
  // backwards over roughly 30% of the segment, minimum dx/du -0.41. This is the fold
  // the old per-side check was blind to by construction: `previous` reset to 0 at the
  // join, so descent across it was never compared.
  const why = foldRefusal([[0.9, 0]], [[0.05, 0.5], [0.1, 1]]);
  assert.ok(why !== null && /folds/.test(why), `expected a fold refusal, got ${why}`);
});

test('foldRefusal accepts a plateau, because a stall is a hold rather than a fold', () => {
  // Two coincident control x make dx/du touch zero without crossing it. `easeSlopeAt`
  // names the vertical tangent a legitimate placement, and the bisection lands inside
  // a plateau rather than beside it - so the question is strictly "does x run
  // backwards", never "does it pause".
  assert.equal(foldRefusal([[0.5, 0.2], [0.5, 0.8]], EASE_IN_LINEAR), null);
  assert.equal(foldRefusal(EASE_OUT_LINEAR, EASE_IN_LINEAR), null);
});

test('elevation never turns an accepted segment into a refused one', () => {
  // `+pt` is degree elevation and the curve does not move through it, so a loader
  // that accepts a segment must accept every elevation of it - this is exactly the
  // save-then-refuse defect, asked as arithmetic. Walked to the ceiling on both
  // sides, from the pair whose elevation is maximally crossed.
  let a = [[0.9, 0.1]];
  let b = [[0.1, 0.9]];
  while (a.length < SEGMENT_POINT_CEILING && b.length < SEGMENT_POINT_CEILING) {
    const side = a.length <= b.length ? 'easeOut' : 'easeIn';
    ({ easeOut: a, easeIn: b } = elevate(a, b, side));
    assert.equal(foldRefusal(a, b), null,
      `elevation to ${a.length}+${b.length} control points turned a legal segment into a refused one`);
  }
});

test('foldFreeX holds the line a drag cannot: no sequence of clamped moves folds a segment', () => {
  // The drag's neighbour span is an ordering rule, and ordering is sufficient only
  // when the polygon starts ordered - from the legal crossed states `elevate`
  // produces, a seeded search found folds within six in-span drags. This replays
  // that search through `foldFreeX` with a *wider* adversary: every move proposes an
  // arbitrary x in the unit range, not merely one inside its span, so what passes
  // here is stronger than what the drag handler can ask for.
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const clone = (h) => h.map((p) => [p[0], p[1]]);
  let el = elevate([[0.9, 0.1]], [[0.1, 0.9]], 'easeOut');
  el = elevate(el.easeOut, el.easeIn, 'easeIn');
  const starts = [
    { out: [EASE_OUT_LINEAR[0]], inn: [EASE_IN_LINEAR[0]] },
    { out: [[0.9, 0.1]], inn: [[0.1, 0.9]] },
    { out: clone(el.easeOut), inn: clone(el.easeIn) },
  ];
  // The positive control first, because a search that cannot find a fold proves
  // nothing about a clamp that prevents them: the same adversary writing its
  // proposals straight through must fold, or the assertion below is vacuous.
  let unguarded = 0;
  for (let trial = 0; trial < 200 && !unguarded; trial++) {
    const out = clone(starts[2].out);
    const inn = clone(starts[2].inn);
    for (let step = 0; step < 40; step++) {
      const onOut = rnd() < 0.5;
      const list = onOut ? out : inn;
      const index = Math.floor(rnd() * list.length);
      list[index][0] = rnd();
      if (foldRefusal(out, inn)) { unguarded++; break; }
    }
  }
  assert.ok(unguarded > 0, 'the unguarded adversary never folded, so the guarded run below asks nothing');
  for (const start of starts) {
    for (let trial = 0; trial < 300; trial++) {
      const out = clone(start.out);
      const inn = clone(start.inn);
      for (let step = 0; step < 40; step++) {
        const onOut = rnd() < 0.5;
        const side = onOut ? 'easeOut' : 'easeIn';
        const list = onOut ? out : inn;
        const index = Math.floor(rnd() * list.length);
        list[index][0] = foldFreeX(out, inn, side, index, list[index][0], rnd());
        assert.equal(foldRefusal(out, inn), null,
          `a clamped move folded the segment: ${JSON.stringify({ out, inn })}`);
      }
    }
  }
});
