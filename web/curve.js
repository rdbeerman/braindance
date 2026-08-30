// The scalar curve maths the keyframe tracks are evaluated through, split out of `main.js`
// because it is the part of the editor that is only arithmetic - no renderer, no DOM, no
// three.js - and so the first thing here a test can import and call directly.

// The handles of a linear segment, named rather than written out at the four places a key is
// made, because a key created with anything else silently eases. Linearity is a property of the
// points and not of their count, so these stay right after a side has grown: any interior point
// with x equal to y is the identity ease at any degree.
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

// How many control points one side of a segment may hold. A ceiling rather than a preference:
// de Casteljau is quadratic in the point count and a high-degree Bezier loses its locality, so
// past about here another handle stops being a control anybody can aim.
const SEGMENT_POINT_CEILING = 4;

/**
 * One control ordinate of a segment's timing curve, by index over the whole list. The ends are
 * pinned at (0,0) and (1,1) and are implied rather than stored. `a` is the `easeOut` of the key
 * being left and `b` the `easeIn` of the key being arrived at, read through here rather than
 * concatenated because this runs per track per frame and the arrays would be garbage.
 */
const ctrl = (a, b, k, axis) => {
  if (k === 0) return 0;
  if (k > a.length + b.length) return 1;
  return k <= a.length ? a[k - 1][axis] : b[k - 1 - a.length][axis];
};

// The de Casteljau working buffers, module-scoped and reused for the reason above. Two of them
// because `bezSlopeAxis` needs its own while a value is being computed beside it. Sized to the
// ceiling twice over plus the two implied ends, so nothing here ever grows one.
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
 * The same coordinate's derivative with respect to `u`. A Bezier's derivative is a Bezier one
 * degree down over the scaled differences of the control points, which is why this is the same
 * loop over a different filling rather than a formula per degree.
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
 * The Bezier parameter at which the curve's x reaches `x`. Newton first because it converges
 * in two or three steps over most of the range, then bisection, because Newton stalls exactly
 * where an ease handle is interesting: a hold at the start of a segment is a near-zero
 * derivative, and dividing by it walks off the curve.
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
 * Bezier degree elevation is exact, which is the whole reason a control for adding a point can
 * be offered at all: the point appears, every other point shifts to keep the curve where it
 * was, and not a rendered frame changes. Which side gets the extra one is the caller's press.
 * Removing a point gets no such function, because a degree-n curve is not generally a
 * degree-(n-1) curve and the shape following the handle is the honest behaviour.
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
  // A vertical tangent is a legitimate handle placement and the analytic ratio is infinite
  // there. Measured over a small window instead - large, finite and in the right direction.
  // It used to report zero, which would unmute the audio gate exactly where it has to mute.
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

// Outside the keys a look track holds its end values and the retime curve keeps going: a look
// with one bloom key is a constant bloom, while a retime that flattened past its last key
// would freeze the program and make the take's tail unreachable.
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
  // Coincident keys are a legal transient while one is dragged onto another, and the later
  // value is what a step would give.
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

// Catmull-Rom in its Hermite form, with tangents divided by the *time* between the
// neighbouring keys rather than by an assumed even spacing. The uniform formula reads the
// parameter as an index, so a tight pair and a wide one get the same tangent and the camera
// lurches out of the tight one.
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
 * The tangent at key `i`, in metres per program second. At the ends the missing neighbour is
 * the end key mirrored one segment *outside* the path rather than sitting on top of itself:
 * with the duplicate at the same instant the end tangent comes out twice what uniform
 * Catmull-Rom gives, and the two forms have to agree exactly on evenly spaced keys.
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
 * A document is a caller like any other and was the one caller taken on trust. Both refusals
 * are about silence: a point outside the segment pulls the curve past an end it is pinned to,
 * and y outside its bound sends `hermite` past the key on an axis that is already a fraction.
 *
 * Ordering of the abscissae is deliberately not asked here - it is sufficient for a fold and
 * never necessary, and `foldRefusal` below asks the real invariant with both handles in hand.
 * The y bound is a parameter because a look scalar may legitimately overshoot where a pose and
 * the retime may not, and `web/main.js` owns that table.
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
 * Whether a segment's timing curve folds - whether x(u) ever runs backwards - and a sentence
 * naming where when it does.
 *
 * Asked of the composed segment, because a polygon that ascends within each side can still
 * descend across the join, and asked of the *curve* rather than the control polygon, because
 * ordered control x is sufficient for monotonicity and never necessary. A fold is worth
 * refusing because it fails silently: the bisection still terminates and the take renders
 * deterministically at the wrong times. Answered exactly by de Casteljau subdivision rather
 * than by sampling, which would make the refusal a fact about the sample count.
 */
function foldRefusal(a, b) {
  const n = 1 + a.length + b.length;
  const d = [];
  for (let i = 0; i < n; i++) d.push(n * (ctrl(a, b, i + 1, 0) - ctrl(a, b, i, 0)));
  // Both tests carry one tolerance and it is doing two jobs. A legitimate tangent - dx/du
  // touching zero - can land a machine epsilon below it, so the endpoint test must not read
  // that as a fold; and the hull test needs the same allowance or it cannot terminate cheaply,
  // measured at 1.4s for one call on a segment sitting exactly on the boundary.
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
 * The neighbour span the drag already applies is an ordering rule, which is sufficient only
 * when the polygon starts ordered - and the crossed polygons `elevate` produces do not. Six
 * in-span drags from a twice-elevated crossed pair reach a genuine fold. Slides to the
 * boundary rather than refusing, because a drag that stops early reads as the curve resisting
 * where a pointer event that throws reads as the editor breaking.
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

// A clip's retime curve, as the `{ rate, keys }` block a project document writes it as. The
// editor holds the same curve behind an object with a renderer attached, and the projects page
// holds nothing but the document - so the arithmetic is here and both read it.

/**
 * The source second a clip's own program second maps to. Program time here is measured from the
 * clip's start rather than the project's, which is what every caller has to subtract first.
 */
function retimeSourceSecAt({ rate, keys }, programSec) {
  if (keys.length === 0) return programSec * rate;
  if (keys.length === 1) return keys[0].value + (programSec - keys[0].t) * rate;
  return scalarAt(keys, programSec, EXTEND_ENDS);
}

/** The program position a source position sits at, which is `retimeSourceSecAt` run backwards. */
function retimeProgramSecAt(curve, sourceSec) {
  const { rate, keys } = curve;
  if (keys.length === 0) return sourceSec / rate;
  if (keys.length === 1) return keys[0].t + (sourceSec - keys[0].value) / rate;
  if (sourceSec <= keys[0].value) {
    const slope = segmentSlope(keys, 0, 0);
    return slope > 0 ? keys[0].t - (keys[0].value - sourceSec) / slope : keys[0].t;
  }
  for (let i = 0; i < keys.length - 1; i++) {
    if (keys[i + 1].value < sourceSec) continue;
    // Bisected rather than solved: an eased cubic has no useful closed-form inverse.
    let lo = keys[i].t;
    let hi = keys[i + 1].t;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (retimeSourceSecAt(curve, mid) < sourceSec) lo = mid;
      else hi = mid;
    }
    return hi;
  }
  const last = keys[keys.length - 1];
  const slope = segmentSlope(keys, keys.length - 2, 1);
  return slope > 0 ? last.t + (sourceSec - last.value) / slope : last.t;
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
  retimeSourceSecAt,
  retimeProgramSecAt,
  scalarSlopeAt,
  stepAt,
  hermite,
  tangentAt,
};
