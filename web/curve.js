// The scalar curve maths the keyframe tracks are evaluated through.
//
// Split out of `main.js` because it is the part of the editor that is only arithmetic:
// no renderer, no DOM, no registry, no three.js. That is what makes it the first thing in
// this tree a test can import and call directly - everything else in the viewer needs a
// WebGL context and a page around it before it will answer a question.
//
// The lines below moved out of `main.js` without a character changed, and the exports
// are one statement at the foot rather than a keyword on each declaration, because the
// proof tools match this tree by exact source text.

// The handles of a linear segment. Named rather than written out at the four
// places a key is made, because a key created with anything else silently eases.
//
// A *list* of control points per side rather than one, and the single-element list
// here is the whole of what a document written before that carried. The list is what
// lets a segment be a cubic, a quintic or anything between without a second curve
// family beside this one - see `SEGMENT_POINT_CEILING` for the far end and `elevate`
// for how a side grows without the picture moving.
//
// Linearity is a property of the points and not of their count: a Bezier whose
// control points all sit on a line lies on that line, so any set of interior points
// with x equal to y is the identity ease at any degree. That is why `lin` can go on
// meaning "no easing" after a side has grown, and why the two constants below did not
// have to become functions of the degree.
const EASE_OUT_LINEAR = [[1 / 3, 1 / 3]];
const EASE_IN_LINEAR = [[2 / 3, 2 / 3]];

/**
 * A handle copied deeply enough that nothing shares a control point with it.
 *
 * A shallow `[...h]` was right while a handle was two numbers and is silently wrong
 * now that it is a list of pairs: the copy would hold the *same* pair objects, so
 * dragging a handle on a key would move the same handle in the undo snapshot the copy
 * was taken for. That is the failure mode this exists to name - it is not a
 * convenience, it is the one line standing between an edit and the history it is
 * supposed to be undoable against.
 */
const copyHandle = (h) => h.map((p) => [p[0], p[1]]);

// How many control points one side of a segment may hold. A ceiling rather than a
// preference: de Casteljau is quadratic in the point count and a high-degree Bezier
// loses its locality entirely - every control point pulls on every part of the curve,
// so past about here another handle stops being a control anybody can aim. Four a
// side is a degree-9 segment, which is more shape than a camera move has ever needed.
const SEGMENT_POINT_CEILING = 4;

/**
 * One control ordinate of a segment's timing curve, by index over the whole list.
 *
 * The ends are pinned at (0,0) and (1,1) and are implied rather than stored, which is
 * what lets a handle be a point instead of a point plus a promise about where the
 * segment starts. `a` is the leading run - the `easeOut` of the key being left - and
 * `b` is the trailing run, the `easeIn` of the key being arrived at. Reading them
 * through here rather than concatenating them into one array is what keeps evaluation
 * allocation-free: this runs per track per frame, and a pair of throwaway arrays per
 * evaluation is garbage the render loop would be collecting.
 */
const ctrl = (a, b, k, axis) => {
  if (k === 0) return 0;
  if (k > a.length + b.length) return 1;
  return k <= a.length ? a[k - 1][axis] : b[k - 1 - a.length][axis];
};

// The de Casteljau working buffers, module-scoped and reused for the reason above.
// Two of them because `bezSlopeAxis` needs its own while a value is being computed
// beside it, and neither function calls itself or the other, so a shared buffer can
// never be walked over mid-evaluation. They are sized to the ceiling twice over plus
// the two implied ends, so nothing here ever grows one.
const work = new Float64Array(2 * SEGMENT_POINT_CEILING + 2);
const dwork = new Float64Array(2 * SEGMENT_POINT_CEILING + 2);

/** One coordinate of the segment's timing curve at Bezier parameter `u`. */
function bezAxis(a, b, axis, u) {
  const n = 2 + a.length + b.length;
  for (let i = 0; i < n; i++) work[i] = ctrl(a, b, i, axis);
  for (let m = n - 1; m > 0; m--) {
    for (let i = 0; i < m; i++) work[i] += (work[i + 1] - work[i]) * u;
  }
  return work[0];
}

/**
 * The same coordinate's derivative with respect to `u`.
 *
 * A Bezier's derivative is a Bezier one degree down over the scaled differences of
 * the control points, which is why this is the same loop over a different filling
 * rather than a formula per degree - a formula per degree is what the fixed cubic
 * had, and it is what stopped the curve being able to grow.
 */
function bezSlopeAxis(a, b, axis, u) {
  const n = 1 + a.length + b.length;
  for (let i = 0; i < n; i++) {
    dwork[i] = n * (ctrl(a, b, i + 1, axis) - ctrl(a, b, i, axis));
  }
  for (let m = n - 1; m > 0; m--) {
    for (let i = 0; i < m; i++) dwork[i] += (dwork[i + 1] - dwork[i]) * u;
  }
  return dwork[0];
}

/**
 * The Bezier parameter at which the curve's x reaches `x`. Newton first because it
 * converges in two or three steps over most of the range, then bisection, because
 * Newton stalls exactly where an ease handle is interesting: a hold at the start
 * of a segment is a near-zero derivative, and dividing by it walks off the curve.
 */
function easeParam(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let u = x;
  for (let i = 0; i < 8; i++) {
    const err = bezAxis(a, b, 0, u) - x;
    if (Math.abs(err) < 1e-9) return u;
    const d = bezSlopeAxis(a, b, 0, u);
    if (d < 1e-6) break;
    const next = u - err / d;
    if (!(next > 0 && next < 1)) break;
    u = next;
  }
  let lo = 0;
  let hi = 1;
  u = x;
  for (let i = 0; i < 60; i++) {
    const err = bezAxis(a, b, 0, u) - x;
    if (Math.abs(err) < 1e-12) break;
    if (err > 0) hi = u; else lo = u;
    u = (lo + hi) / 2;
  }
  return u;
}

/** Where in a segment's value range a fraction of the way through it lands. */
function easeAt(a, b, x) {
  return bezAxis(a, b, 1, easeParam(a, b, x));
}

/**
 * The same segment with one more control point on `side`, and the *identical* curve.
 *
 * This is Bezier degree elevation, and that it is exact is the whole reason a control
 * for adding a point can be offered at all. A press that gave you another handle and
 * also moved the camera would be two edits wearing one button, and the one nobody
 * asked for is the one that ruins a take - so the point appears, every other point
 * shifts to the place that keeps the curve where it was, and not a rendered frame
 * changes. `test/curve.test.mjs` holds it to that rather than this comment doing.
 *
 * The elevated interior runs one longer than it did, and which side gets the extra
 * one is the caller's press: the leading run keeps `a.length + 1` of them when the
 * outgoing side grew, and the trailing run takes the rest. Splitting it that way is
 * what keeps `easeOut` and `easeIn` two different numbers rather than two halves of
 * one, which is the distinction the whole preset table is written against.
 *
 * Removing a point has no such function and deliberately gets none. A degree-n curve
 * is not generally a degree-(n-1) curve, so `-pt` drops a control point and the shape
 * follows it - which is what removing a handle looks like everywhere else and is the
 * honest behaviour rather than a least-squares fit nobody could predict.
 */
function elevate(a, b, side) {
  const n = 1 + a.length + b.length;
  const raised = [];
  for (let i = 1; i <= n; i++) {
    const w = i / (n + 1);
    raised.push([0, 1].map((axis) => w * ctrl(a, b, i - 1, axis) + (1 - w) * ctrl(a, b, i, axis)));
  }
  const cut = side === 'easeOut' ? a.length + 1 : a.length;
  return { easeOut: raised.slice(0, cut), easeIn: raised.slice(cut) };
}

/** d(value fraction)/d(time fraction), which is what a retime slope is built from. */
function easeSlopeAt(a, b, x) {
  const u = easeParam(a, b, x);
  const dx = bezSlopeAxis(a, b, 0, u);
  if (dx > 1e-6) return bezSlopeAxis(a, b, 1, u) / dx;
  // A vertical tangent is a legitimate handle placement, and the analytic ratio is
  // infinite there. It used to report zero, which is the opposite of the truth and
  // the wrong kind of wrong: this is the slope step 6's audio gate reads to decide
  // whether the take is playing at 1.0, and a zero at the steepest point of a ramp
  // would unmute exactly where it has to mute. Measured over a small window
  // instead - large, finite, and in the right direction, which is what every
  // caller can actually use.
  const h = 1e-4;
  const lo = Math.max(0, x - h);
  const hi = Math.min(1, x + h);
  return (easeAt(a, b, hi) - easeAt(a, b, lo)) / Math.max(1e-9, hi - lo);
}

/** The last key at or before `t`, or -1 when `t` sits before every key. */
function keyBefore(keys, t) {
  let lo = 0;
  let hi = keys.length - 1;
  if (hi < 0 || t < keys[0].t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Outside the keys a look track holds its end values and the retime curve keeps
// going. That difference is not a preference: a look with one bloom key is a
// constant bloom, while a retime that flattened past its last key would freeze
// the program there and make the take's tail unreachable.
const HOLD_ENDS = 'hold';
const EXTEND_ENDS = 'extend';

function scalarAt(keys, t, ends) {
  const n = keys.length;
  if (n === 0) return 0;
  if (n === 1) return keys[0].value;
  const i = keyBefore(keys, t);
  if (i < 0) {
    if (ends === HOLD_ENDS) return keys[0].value;
    return keys[0].value + (t - keys[0].t) * segmentSlope(keys, 0, 0);
  }
  if (i >= n - 1) {
    if (ends === HOLD_ENDS) return keys[n - 1].value;
    return keys[n - 1].value + (t - keys[n - 1].t) * segmentSlope(keys, n - 2, 1);
  }
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  // Coincident keys are a legal transient while one is being dragged onto
  // another, and the later value is what a step would give, so it is what this
  // gives rather than a division by zero.
  if (span <= 0) return b.value;
  return a.value + (b.value - a.value) * easeAt(a.easeOut, b.easeIn, (t - a.t) / span);
}

/** The slope of segment `i` at one of its ends, in value per program second. */
function segmentSlope(keys, i, x) {
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return 0;
  return ((b.value - a.value) / span) * easeSlopeAt(a.easeOut, b.easeIn, x);
}

function scalarSlopeAt(keys, t) {
  const n = keys.length;
  if (n < 2) return 0;
  const i = keyBefore(keys, t);
  if (i < 0) return segmentSlope(keys, 0, 0);
  if (i >= n - 1) return segmentSlope(keys, n - 2, 1);
  const span = keys[i + 1].t - keys[i].t;
  if (span <= 0) return 0;
  return segmentSlope(keys, i, (t - keys[i].t) / span);
}

function stepAt(keys, t) {
  const i = keyBefore(keys, t);
  return keys[i < 0 ? 0 : i].value;
}

// Catmull-Rom, written in its Hermite form with tangents divided by the *time*
// between the neighbouring keys rather than by an assumed even spacing. The
// textbook uniform formula is the same curve when keys are evenly spaced and a
// different one when they are not: it reads the parameter as an index, so two
// keys 0.2s apart and two keys 3s apart get the same tangent and the camera
// lurches out of the tight pair. Keys land wherever the edit wants them, so the
// non-uniform form is the only one that means what the spec says it means.
function hermite(p0, p1, m0, m1, span, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * p0 + h10 * span * m0 + h01 * p1 + h11 * span * m1;
}

/**
 * The tangent at key `i`, in metres per program second.
 *
 * At the ends the missing neighbour is the end key mirrored one segment *outside*
 * the path rather than the end key sitting on top of itself. That is what makes
 * this the non-uniform generalisation of the textbook formula rather than a
 * near-miss of it: with the duplicate at the same instant the end tangent comes
 * out twice what the uniform Catmull-Rom gives, so the curve would leave its first
 * key at double speed and the two forms would disagree on evenly spaced keys - the
 * one case where they have to agree exactly.
 */
function tangentAt(keys, i, axis) {
  const n = keys.length;
  const at = (k) => (k < 0
    ? { t: 2 * keys[0].t - keys[1].t, value: keys[0].value }
    : (k > n - 1
      ? { t: 2 * keys[n - 1].t - keys[n - 2].t, value: keys[n - 1].value }
      : keys[k]));
  const lo = at(i - 1);
  const hi = at(i + 1);
  const span = hi.t - lo.t;
  if (span <= 0) return 0;
  return (hi.value.position[axis] - lo.value.position[axis]) / span;
}


/**
 * Whether a handle is one this evaluator can be asked to render, and why not if not.
 *
 * **The invariants exist in the drag handler that creates a value and existed nowhere in
 * the loader that reads one back**, which is the shape of the gap this closes: a handle
 * dragged in the editor is clamped as it is written, and a handle arriving in a file went
 * through a check on its *shape* alone - an array of finite pairs, within the count
 * ceiling - while the docstring above that check claimed handles "are checked when
 * present, because a handle outside the unit box bends a curve back on itself". A
 * document is a caller like any other and it was the one caller taken on trust.
 *
 * Both refusals are about silence rather than about crashes, which is why they are worth
 * a door of their own. A point outside the segment pulls the curve past an end it is
 * pinned to, and y outside its bound sends `hermite` past the key on an axis that is
 * already a fraction, so a camera sails through the pose it was keyed at and swings back
 * to it.
 *
 * **What this deliberately does not ask is whether the abscissae are ordered, and it
 * used to.** Descending control x is *sufficient* for a fold and never necessary - a
 * crossed polygon whose curve stays single-valued is a legal state, `elevate` produces
 * one out of the ordinary `easeOut [[0.9, 0.1]]` / `easeIn [[0.1, 0.9]]` pair, and the
 * per-side ordering rule refused it, so the editor could save a document the next
 * reload declined to open. It was also too loose on the same axis: asked one side at a
 * time it could not see a fold spanning the `easeOut`/`easeIn` boundary, which is the
 * fold its own sentence was written about. The real invariant is a property of the
 * whole segment's Bezier and lives in `foldRefusal` below, asked once per segment with
 * both handles in hand.
 *
 * The y bound is a parameter rather than a constant here because it is not one number:
 * a look scalar may legitimately overshoot - a value that swings past its key and comes
 * back is an ordinary creative choice - while a pose and the retime may not, for reasons
 * that read alike and are not the same. `web/main.js` owns that table and passes the
 * bound in, so this stays a statement about curves and the two ends stay one rule.
 *
 * Returns null when there is nothing wrong, and a sentence naming the term when there is.
 */
function handleRefusal(points, loY, hiY) {
  for (const [x, y] of points) {
    if (!(x >= 0 && x <= 1)) {
      return `a control point at x=${x}, outside the segment it shapes - the timing curve `
        + 'is a function of time within the segment, so a point past either end makes it '
        + 'fold back and run the value backwards through part of the move';
    }
    if (!(y >= loY && y <= hiY)) {
      return `a control point at y=${y}, outside the [${loY}, ${hiY}] this kind of track allows`;
    }
  }
  return null;
}

/**
 * Whether a segment's timing curve folds - whether x(u) ever runs backwards - and a
 * sentence naming where when it does.
 *
 * Asked of the composed segment rather than of either handle, because the fold is a
 * property neither side holds alone: `a` is the outgoing handle of the key being left
 * and `b` the incoming handle of the key being arrived at, and a polygon that ascends
 * within each side can still descend across the join. Asked about the *curve* rather
 * than the control polygon, because ordered control x is sufficient for monotonicity
 * and never necessary - the legal crossed polygons `elevate` produces are exactly the
 * states an ordering rule wrongly refuses.
 *
 * A fold is worth refusing because it fails silently: `easeParam`'s bisection still
 * terminates on a folding curve and still returns a `u` inside `[0, 1]`, so the take
 * renders deterministically, repeatably, and at the wrong times. A curve whose x merely
 * *stalls* is not a fold - a plateau is a hold, the bisection lands inside it, and
 * refusing one would take a legitimate handle placement away - so the question is
 * strictly "does dx/du go negative", not "does it reach zero".
 *
 * Answered exactly rather than by sampling. dx/du is itself a Bezier over the scaled
 * differences of the control x, so the convex-hull property decides most polygons in
 * one look - coefficients all non-negative can never dip below zero - and de Casteljau
 * subdivision splits the rest until a piece's endpoint goes negative (a witness, since
 * an endpoint is a point *on* the curve) or every piece's hull clears. A sampling loop
 * would have been shorter and would have made the refusal a fact about the sample
 * count; a fold narrower than the depth bound here is narrower than 2^-40 of a
 * segment, which no renderer resolves and no handle can author.
 */
function foldRefusal(a, b) {
  const n = 1 + a.length + b.length;
  const d = [];
  for (let i = 0; i < n; i++) d.push(n * (ctrl(a, b, i + 1, 0) - ctrl(a, b, i, 0)));
  // Both tests carry one tolerance, and it is doing two jobs. A piece's first and
  // last coefficients are values *on* the curve, computed through enough averaging
  // that a legitimate tangent - dx/du touching zero, which `easeSlopeAt` names as a
  // placement worth keeping - can land a machine epsilon below it, so the endpoint
  // test must not read that as a fold. And the hull test needs the same allowance or
  // it cannot terminate cheaply: the convex-hull property bounds the curve *below* by
  // the least coefficient, so a piece whose coefficients all clear -1e-9 holds dx/du
  // above -1e-9 everywhere and can run x backwards by less than a billionth of a
  // segment - a plateau in every sense that renders. Without that allowance a segment
  // sitting exactly on the boundary, which is the state `foldFreeX`'s bisection
  // deliberately produces, recurses the full depth over an interval the strict test
  // can never decide - measured at 1.4s for one call against microseconds for every
  // ordinary one.
  const witness = (coef, lo, hi, depth) => {
    if (coef.every((c) => c >= -1e-9)) return null;
    if (coef[0] < -1e-9) return lo;
    if (coef[coef.length - 1] < -1e-9) return hi;
    if (depth === 0) return null;
    const mid = (lo + hi) / 2;
    const left = [];
    const right = [];
    const level = [...coef];
    for (let m = level.length; m > 0; m--) {
      left.push(level[0]);
      right.push(level[m - 1]);
      for (let i = 0; i + 1 < m; i++) level[i] = (level[i] + level[i + 1]) / 2;
    }
    return witness(left, lo, mid, depth - 1) ?? witness(right.reverse(), mid, hi, depth - 1);
  };
  const u = witness(d, 0, 1, 40);
  if (u === null) return null;
  const slope = bezSlopeAxis(a, b, 0, u);
  return `a timing curve that folds - its x runs backwards near ${Math.round(u * 100)}% of the way `
    + `through the segment (dx/du ${slope.toFixed(2)}) - so the bisection that samples it still `
    + 'terminates and the move renders at the wrong times rather than failing';
}

/**
 * How far a control point's x may actually move toward `to` before the segment folds.
 *
 * The neighbour span the drag already applies is the ordering rule, and ordering is
 * sufficient for a fold-free curve only when the polygon starts ordered. The legal
 * crossed polygons `elevate` produces do not, and from one of those an adversarial
 * sequence of drags - each individually inside its span - reaches a genuine fold:
 * measured with a seeded search, six in-span drags from the twice-elevated crossed
 * pair fold the curve, and about a sixth of the folded states ascend within each side,
 * so no per-side reading of any strictness would have seen them coming. The span stays,
 * because it is cheap and right about the ordinary polygon; this is the last word,
 * asked of the curve itself.
 *
 * Sliding to the boundary rather than refusing the move, for the reason
 * `clampRetimeKey` gives about its own clamp: a drag that stops early reads as the
 * curve resisting, where a pointer event that throws reads as the editor breaking. The
 * boundary is found by bisection from the last fold-free x, which the caller holds by
 * induction - every earlier drag came through here. A starting state that already
 * folds has nothing fold-free to preserve, so the drag is let through rather than
 * fought; the loader refuses such a document at its own door.
 */
function foldFreeX(a, b, side, index, from, to) {
  const probe = (x) => {
    const list = (side === 'easeOut' ? a : b).map((p) => [p[0], p[1]]);
    list[index] = [x, list[index][1]];
    return foldRefusal(side === 'easeOut' ? list : a, side === 'easeOut' ? b : list) === null;
  };
  if (probe(to)) return to;
  if (!probe(from)) return to;
  let good = from;
  let bad = to;
  for (let i = 0; i < 30; i++) {
    const mid = (good + bad) / 2;
    if (probe(mid)) good = mid; else bad = mid;
  }
  return good;
}

export {
  handleRefusal,
  foldRefusal,
  foldFreeX,
  EASE_OUT_LINEAR,
  EASE_IN_LINEAR,
  SEGMENT_POINT_CEILING,
  copyHandle,
  easeParam,
  easeAt,
  elevate,
  keyBefore,
  HOLD_ENDS,
  EXTEND_ENDS,
  scalarAt,
  segmentSlope,
  scalarSlopeAt,
  stepAt,
  hermite,
  tangentAt,
};
