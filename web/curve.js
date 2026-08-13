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


export {
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
