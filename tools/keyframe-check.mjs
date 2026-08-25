// Proves the keyframe layer: the three interpolation kinds are the curves the design names,
// evaluation writes them through the registry, the retime curve maps program time to source time
// including a hold, and undo restores the document and never the view. Invocations and mutations:
// docs/proof-tools.md.
//
// Every expected value is computed here rather than read back off the page, and each kind carries a
// control that must disagree: a lerp agrees with every other kind at the keys, so without one a
// page that lerped everything would pass.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const REPO = fileURLToPath(new URL('..', import.meta.url));
const URL_BASE = flag('--url', 'http://localhost:8080');
const TAKE = flag('--take', 'sample');
const HEADED = argv.includes('--headed');
const MUTATE = flag('--mutate');
const SHOTS = flag('--shots');

// 16:9, because `restoreProject` refuses a document framed at a shape `EXPORT_SIZES` has
// no resolution for, and this file undoes.
const STAGE = { width: 640, height: 360 };
// A first guess; the real height is measured after load and the viewport corrected.
const CHROME_H_GUESS = 148;

// Between them is a band where a result proves nothing either way, and a run landing
// there fails rather than picking a side.
const SAME_MAX = 2;
const CONTROL_MIN = 16;
const CONTROL_MIN_PCT = 1.0;

// Both sides are doubles in different orders - a wrong interpolation is wrong by hundredths.
const VALUE_EPS = 1e-9;
// Scalars land on the registry's step grid, so an unsnapped expectation gets half a step.
const halfStep = (spec) => spec.step / 2 + 1e-9;

// A mutation whose text is not found exactly once is refused: a replacement matching nothing would
// run the unmutated page and be recorded as a miss.
const MUTATIONS = {
  // Ease handles stop bending the timing, so every scalar segment is a straight lerp.
  'ease-ignored': { file: 'web/curve.js', edits: [[
    `function easeAt(a, b, x) {
  return bezAxis(a, b, 1, easeParam(a, b, x));
}`,
    'function easeAt(a, b, x) { return x; }',
  ]] },
  // A step track interpolates, which is the one thing a boolean cannot do.
  'step-lerps': { file: 'web/curve.js', edits: [[
    `function stepAt(keys, t) {
  const i = keyBefore(keys, t);
  return keys[i < 0 ? 0 : i].value;
}`,
    `function stepAt(keys, t) {
  const i = keyBefore(keys, t);
  if (i < 0 || i >= keys.length - 1) return keys[i < 0 ? 0 : i].value;
  const u = (t - keys[i].t) / Math.max(1e-9, keys[i + 1].t - keys[i].t);
  return u < 0.5 ? keys[i].value : keys[i + 1].value;
}`,
  ]] },
  // The camera corners on straight lines between its keys.
  'pose-linear': { file: 'web/main.js', edits: [[
    `  const position = [0, 1, 2].map((axis) => hermite(
    a.value.position[axis], b.value.position[axis],
    tangentAt(keys, i, axis), tangentAt(keys, i + 1, axis),
    span, u,
  ));`,
    `  const position = [0, 1, 2].map((axis) => a.value.position[axis]
    + (b.value.position[axis] - a.value.position[axis]) * u);`,
  ]] },
  // The camera ignores its handles. Aimed at the remap alone so it stays separable from
  // `pose-linear`: one says the route is a spline, this one says the traversal is shaped.
  'pose-ignores-ease': { file: 'web/main.js', edits: [[
    '  const u = easeAt(a.easeOut, b.easeIn, (t - a.t) / span);',
    '  const u = (t - a.t) / span;',
  ]] },
  // The pre-roll reads the slope at the target instead of asking how far back the curve
  // covers the span, so a hold answers "no frames needed".
  'preroll-slope-at-target': { file: 'web/main.js', edits: [[
    '    const back = retime.framesBackFor(programSec, surfaceSec, this.outputFps, this.lastFrame);',
    `    // Step 4's two lines restored verbatim, zero-slope branch and all: the slope
    // at a point times a frame count, and a hold answering "no frames needed" for
    // the case that needs the most. The window query goes unused, which is the
    // shape of the finding - a tangent has no window to ask about.
    const sourcePerFrame = Math.abs(retime.slopeAt(programSec)) / this.outputFps;
    const back = { frames: sourcePerFrame > 0 ? Math.ceil(surfaceSec / sourcePerFrame) : 0, covered: true };`,
  ]] },
  // The retime stops being a curve and goes back to a constant slope.
  'retime-ignores-keys': { file: 'web/main.js', edits: [[
    `    if (keys.length === 1) return keys[0].value + (programSec - keys[0].t) * this.rate;
    return scalarAt(keys, programSec, EXTEND_ENDS);`,
    '    return programSec * this.rate;',
  ]] },
  // The evaluator announces its writes, so every evaluated frame schedules a seek.
  'evaluator-repaints': { file: 'web/main.js', edits: [[
    `  withoutRepaint(() => {
    for (const track of tracks.values()) {
      if (track.keys.length === 0) continue;
      if (borrowed && borrowed.has(track.name)) continue;
      params.set(track.name, track.valueAt(t));
    }
  });`,
    `  for (const track of tracks.values()) {
    if (track.keys.length === 0) continue;
    if (borrowed && borrowed.has(track.name)) continue;
    params.set(track.name, track.valueAt(t));
  }`,
  ]] },
  // The undo snapshot widens to the whole registry, so dropping render scale lands on it.
  'undo-includes-view': { file: 'web/main.js', edits: [[
    '  const lookParams = params.values(lookNames);',
    '  const lookParams = params.values(params.names());',
  ]] },
  // Undo pushes per input event rather than per interaction: one drag is two hundred.
  'undo-on-input': { file: 'web/main.js', edits: [[
    "      input.addEventListener('input', () => writeFromControl(name, Number(input.value)));",
    "      input.addEventListener('input', () => { writeFromControl(name, Number(input.value)); history.commit(); });",
  ]] },
  // A seek plans its span once and never looks again.
  'seek-plans-once': { file: 'web/main.js', edits: [
    [`        this.overtaken++;
        if (this.overtaken > SEEK_OVERTAKEN_LIMIT) {
          this.overtaken = 0;
          throw new Error(
            \`\${SEEK_OVERTAKEN_LIMIT} seeks in a row were overtaken before they could land: \`
            + 'the span a seek plans is not becoming resident, which is not a moving curve',
          );
        }
        requestRepaint();
        return null;
      }
      await this.source.ensure(planned.from, planned.to);
      planned = this.planSeek(programSec, options.frames);
    }
`, ''],
    [`    let planned = this.planSeek(programSec, options.frames);
    for (let attempt = 0; !this.source.resident(planned.from, planned.to); attempt++) {
      if (attempt >= SEEK_REPLANS) {
`,
    `    const planned = this.planSeek(programSec, options.frames);
    await this.source.ensure(planned.from, planned.to);
`],
  ] },
  // The pre-roll reads the uniforms, which hold the look where the playhead was parked.
  // The surface half alone; `trails-damp-at-target` is the trails half.
  'preroll-reads-uniforms': { file: 'web/main.js', edits: [[
    `    const surfaceSec = (valueAtProgram('fade', programSec)
      + valueAtProgram('wake', programSec)) / 1000;`,
    '    const surfaceSec = uniforms.fadeTime.value + uniforms.wakeTime.value;',
  ]] },
  // The trails half goes back to the closed form, which holds only while damp is constant.
  'trails-damp-at-target': { file: 'web/main.js', edits: [[
    `    const back2 = this.trailsFramesBack(programSec);
    const trails = back2.frames;`,
    `    const dampNow = valueAtProgram('trails', programSec);
    const back2 = { covered: true };
    const trails = dampNow > 0 ? Math.ceil(Math.log(AFTERIMAGE_RESIDUAL) / Math.log(dampNow)) : 0;`,
  ]] },
  // Orientation holds the earlier key. Every quaternion is still a unit quaternion and
  // every key still hit exactly, so identity rotations hide it.
  'pose-no-slerp': { file: 'web/main.js', edits: [[
    `  slerpA.fromArray(a.value.quaternion);
  slerpB.fromArray(b.value.quaternion);
  slerpA.slerp(slerpB, u);`,
    '  slerpA.fromArray(a.value.quaternion);',
  ]] },
  // The retime's editing doors stop holding a key inside its neighbours.
  'retime-unclamped': { file: 'web/main.js', edits: [
    [`  const floor = i > 0 ? keys[i - 1].value : 0;
  const ceiling = i < keys.length - 1 ? keys[i + 1].value : timeline.source.duration;
  key.value = Math.max(floor, Math.min(ceiling, key.value));`,
      '  key.value = Math.max(0, Math.min(timeline.source.duration, key.value));'],
    ['      if (keys[i].value < keys[i - 1].value) {', '      if (false) {'],
  ] },
  // The handle half of the retime guard goes and the key-value half stays: two claims.
  'retime-handle-unchecked': { file: 'web/main.js', edits: [[
    '        if (!h[0].every((c) => c >= 0 && c <= 1)) {',
    '        if (false) {',
  ]] },
  // The animation loop stops catching, so the pair source's refusal escapes it.
  'tick-uncaught': { file: 'web/main.js', edits: [[
    `    try {
      this.tickNow(nowMs);
    } catch (err) {`,
    `    if (true) {
      this.tickNow(nowMs);
      return;
    }
    try {
      this.tickNow(nowMs);
    } catch (err) {`,
  ]] },
  // The furniture goes back inside the frame, where it broke step 4.
  'chrome-in-frame': { file: 'web/main.js', edits: [[
    `    if (postEnabled()) composer.render(dt);
    else renderer.render(scene, viewCamera);`,
    `    if (postEnabled()) composer.render(dt);
    else renderer.render(scene, viewCamera);
    drawChromeIntoFrame();`,
  ], [
    'function drawChrome() {',
    `function drawChromeIntoFrame() {
  if (!chromeOn) return;
  const { h } = stageSize();
  const rect = insetRect();
  const held = new THREE.Color();
  renderer.getClearColor(held);
  const heldAlpha = renderer.getClearAlpha();
  renderer.setScissor(rect.x, h - rect.y - rect.h, rect.w, rect.h);
  renderer.setScissorTest(true);
  renderer.setClearColor(0x0d1014, 1);
  renderer.clear(true, false, false);
  renderer.setScissorTest(false);
  renderer.setClearColor(held, heldAlpha);
}
function drawChrome() {`,
  ]] },
};

// The interception route comes off the spec's own file rather than a hardcoded `web/main.js`: an
// anchor moving into another module would leave the route matching nothing and the run
// recorded as a miss.
function mutatedSource() {
  const spec = MUTATIONS[MUTATE];
  if (!spec) {
    throw new Error(`unknown mutation ${MUTATE} - have ${Object.keys(MUTATIONS).join(', ')}`);
  }
  let source = readFileSync(join(REPO, spec.file), 'utf8');
  for (const [from, to] of spec.edits) {
    const hits = source.split(from).length - 1;
    if (hits !== 1) {
      throw new Error(`mutation ${MUTATE} matched ${hits} times in ${spec.file}, expected exactly 1: ${from.slice(0, 70)}…`);
    }
    source = source.replace(from, to);
  }
  return { file: spec.file, body: source };
}

/** Where a file under `web/` is reached from a browser. Matched on the whole pathname,
  * because two modules could end in the same name and the wrong one would be served. */
function servedAt(file) {
  if (!file.startsWith('web/')) {
    throw new Error(`${file} is not served to a browser, so a page mutation cannot reach it`);
  }
  return `/${file.slice('web/'.length)}`;
}

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [];
  try {
    roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim());
  } catch { /* no global npm root: the local resolve below may still work */ }

  const candidates = [async () => import('playwright')];
  for (const root of roots) {
    for (const name of ['playwright', '@playwright/cli/node_modules/playwright']) {
      candidates.push(async () => import(pathToFileURL(require.resolve(join(root, name))).href));
    }
  }
  for (const load of candidates) {
    try {
      const mod = await load();
      const pw = mod.chromium ? mod : mod.default;
      if (pw?.chromium) return pw;
    } catch { /* try the next one */ }
  }
  throw new Error('playwright not found - install it globally or in this project');
}

// Never `JSON.stringify`: it turns `NaN` and `undefined` into `null`, so a case labelled NaN
// silently tests null instead.
function src(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    // Enough digits that a double round-trips exactly, or a value lands one step grid away.
    return Object.is(value, -0) ? '-0' : String(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(src).join(', ')}]`;
  return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${src(v)}`).join(', ')}}`;
}

// An oracle that asked the page for both the answer and the expectation would agree with itself
// whatever the arithmetic was, so the algorithm differs too: bisection rather than Newton, and the
// spline anchored against the textbook uniform formula below.

const LIN_OUT = [[1 / 3, 1 / 3]];
const LIN_IN = [[2 / 3, 2 / 3]];

/**
 * One coordinate of a segment's timing curve, summed as Bernstein terms; the page uses de
 * Casteljau, and running that same recurrence here would agree with it by construction. `mid` is
 * the interior ordinates in order, and the ends are pinned at 0 and 1.
 */
const bezN = (mid, u) => {
  const c = [0, ...mid, 1];
  const n = c.length - 1;
  let binom = 1;
  let sum = 0;
  for (let k = 0; k <= n; k++) {
    sum += binom * c[k] * ((1 - u) ** (n - k)) * (u ** k);
    binom = (binom * (n - k)) / (k + 1);
  }
  return sum;
};

function paramAt(mid, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const at = (lo + hi) / 2;
    if (bezN(mid, at) < x) lo = at;
    else hi = at;
  }
  return (lo + hi) / 2;
}

const easeOf = (key) => key.easeOut ?? LIN_OUT;
const easeIn = (key) => key.easeIn ?? LIN_IN;

/**
 * How far through a segment the handles say we are, by bisection rather than the page's Newton -
 * which is the point of it existing twice.
 */
const ordinates = (a, b, axis) => [
  ...easeOf(a).map((point) => point[axis]),
  ...easeIn(b).map((point) => point[axis]),
];
const easedFraction = (a, b, x) => bezN(ordinates(a, b, 1), paramAt(ordinates(a, b, 0), x));

function before(keys, t) {
  let i = -1;
  for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) i = k;
  return i;
}

function scalarAt(keys, t, extend = false) {
  if (keys.length === 0) return 0;
  if (keys.length === 1) return keys[0].value;
  const i = before(keys, t);
  if (i < 0) {
    if (!extend) return keys[0].value;
    return keys[0].value + (t - keys[0].t) * endSlope(keys, 0, 0);
  }
  if (i >= keys.length - 1) {
    if (!extend) return keys[keys.length - 1].value;
    return keys[keys.length - 1].value
      + (t - keys[keys.length - 1].t) * endSlope(keys, keys.length - 2, 1);
  }
  const a = keys[i];
  const b = keys[i + 1];
  return a.value + (b.value - a.value) * easedFraction(a, b, (t - a.t) / (b.t - a.t));
}

/** The segment's slope at one of its ends, by a one-sided difference. */
function endSlope(keys, i, side) {
  const a = keys[i];
  const b = keys[i + 1];
  const h = 1e-7;
  const x = side === 0 ? h : 1 - h;
  const at = (xx) => a.value + (b.value - a.value) * easedFraction(a, b, xx);
  return (at(Math.min(1, x + h)) - at(Math.max(0, x - h))) / ((b.t - a.t) * (Math.min(1, x + h) - Math.max(0, x - h)));
}

function stepValueAt(keys, t) {
  const i = before(keys, t);
  return keys[i < 0 ? 0 : i].value;
}

/**
 * Slerp from the definition rather than from three's implementation. Orientation went three rounds
 * unverified because every test quaternion was the identity, so a page returning the first key's
 * rotation forever passed everything.
 */
function slerp(qa, qb, u) {
  let [bx, by, bz, bw] = qb;
  let dot = qa[0] * bx + qa[1] * by + qa[2] * bz + qa[3] * bw;
  // The shorter arc: a negative dot means the direct path is the long way round.
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (dot > 0.9995) {
    // Nearly parallel, where the sine goes to zero: a lerp and a renormalise.
    const out = [0, 1, 2, 3].map((i) => qa[i] + ([bx, by, bz, bw][i] - qa[i]) * u);
    const len = Math.hypot(...out) || 1;
    return out.map((v) => v / len);
  }
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - u) * theta) / sin;
  const wb = Math.sin(u * theta) / sin;
  return [0, 1, 2, 3].map((i) => qa[i] * wa + [bx, by, bz, bw][i] * wb);
}

/** A quaternion for a rotation of `deg` about a unit axis, so the keys are real poses. */
function quatAbout(axis, deg) {
  const half = (deg * Math.PI) / 360;
  const sin = Math.sin(half);
  const len = Math.hypot(...axis) || 1;
  return [(axis[0] / len) * sin, (axis[1] / len) * sin, (axis[2] / len) * sin, Math.cos(half)];
}

/** The angle between two unit quaternions, in degrees. What a wrong slerp gets wrong. */
function quatAngle(qa, qb) {
  const dot = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * Non-uniform Catmull-Rom in Hermite form, the traversal put through the handles first. The ease
 * enters exactly once and that is the claim: all three channels read the same remapped fraction, so
 * shaping the timing cannot move the curve through space.
 */
function poseValueAt(keys, t) {
  if (keys.length === 1) return keys[0].value;
  const i = before(keys, t);
  if (i < 0) return keys[0].value;
  if (i >= keys.length - 1) return keys[keys.length - 1].value;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const u = easedFraction(a, b, (t - a.t) / span);
  // The end keys are mirrored one segment outside the path, which is the textbook clamp
  // once the parameter is time rather than an index.
  const at = (k) => {
    if (k < 0) return { t: 2 * keys[0].t - keys[1].t, value: keys[0].value };
    if (k > keys.length - 1) {
      return { t: 2 * keys[keys.length - 1].t - keys[keys.length - 2].t, value: keys[keys.length - 1].value };
    }
    return keys[k];
  };
  const tangent = (k, axis) => {
    const lo = at(k - 1);
    const hi = at(k + 1);
    return (hi.value.position[axis] - lo.value.position[axis]) / (hi.t - lo.t);
  };
  const u2 = u * u;
  const u3 = u2 * u;
  const position = [0, 1, 2].map((axis) => (2 * u3 - 3 * u2 + 1) * a.value.position[axis]
    + (u3 - 2 * u2 + u) * span * tangent(i, axis)
    + (-2 * u3 + 3 * u2) * b.value.position[axis]
    + (u3 - u2) * span * tangent(i + 1, axis));
  return {
    position,
    quaternion: slerp(a.value.quaternion, b.value.quaternion, u),
    fov: a.value.fov + (b.value.fov - a.value.fov) * u,
  };
}

/** The textbook uniform Catmull-Rom, for the evenly spaced anchor only. */
function uniformCatmull(points, s) {
  const n = points.length - 1;
  const i = Math.min(Math.floor(s * n), n - 1);
  const u = s * n - i;
  const g = (k) => points[Math.max(0, Math.min(n, k))];
  const [p0, p1, p2, p3] = [g(i - 1), g(i), g(i + 1), g(i + 2)];
  return [0, 1, 2].map((d) => 0.5 * ((2 * p1[d])
    + (-p0[d] + p2[d]) * u
    + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * u * u
    + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * u * u * u));
}

/** Program to source, the way the page's curve does it: linear outside the keys. */
const retimeAt = (curve, t) => (curve.keys.length === 0
  ? t * curve.rate
  : (curve.keys.length === 1
    ? curve.keys[0].value + (t - curve.keys[0].t) * curve.rate
    : scalarAt(curve.keys, t, true)));

/**
 * How many output frames back the curve reaches to cover `span` source seconds ending at `t`. This
 * tool's own walk over its own curve, which the page's number is compared to.
 */
function framesBack(curve, t, span, fps, ceiling) {
  if (!(span > 0)) return 0;
  const at = retimeAt(curve, t);
  for (let n = 1; n <= ceiling; n++) {
    if (at - retimeAt(curve, t - n / fps) >= span - 1e-9) return n;
  }
  return ceiling;
}

/** What the arithmetic this replaced would have said: the tangent at the target. */
function framesBackByTangent(curve, t, span, fps) {
  const h = 1e-6;
  const slope = Math.abs((retimeAt(curve, t + h) - retimeAt(curve, t - h)) / (2 * h));
  const perFrame = slope / fps;
  return perFrame > 0 ? Math.ceil(span / perFrame) : 0;
}

const index = await (await fetch(`${URL_BASE}/capture/${TAKE}/index`)).json();
const stamps = index.frames.stampMs;
const TIMES = stamps.map((s) => (s - stamps[0]) / 1000);
const SOURCE_DURATION = TIMES[TIMES.length - 1];

function bracketOf(sourceSec) {
  let lo = 0;
  let hi = TIMES.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (TIMES[mid] <= sourceSec) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures++;
};
const show = (d) => `max ${d.max}/255, mean ${d.mean.toFixed(4)}, ${d.pct.toFixed(3)}% of pixels differ`;
const worst = (xs) => xs.reduce((a, b) => Math.max(a, b), 0);

// Both sized against the take's real duration rather than a round number. The ramp runs slow then
// fast, so the pre-roll question has a different answer at either end.
const RAMP = {
  rate: 1,
  keys: [
    { t: 0, value: 0 },
    { t: 6, value: 3 },
    { t: 10, value: 15 },
  ],
};
// A four-second freeze: source time stops, so a pre-roll here reaches back through it.
const HOLD = {
  rate: 1,
  keys: [
    { t: 0, value: 0 },
    { t: 4, value: 8 },
    { t: 7, value: 8 },
    { t: 11, value: 16 },
  ],
};
// Drawn with ease handles, so the slope changes everywhere - the case where a tangent at
// the target is furthest off.
const EASED_RAMP = {
  rate: 1,
  keys: [
    { t: 0, value: 0, easeOut: [[0.85, 0.05]], easeIn: LIN_IN },
    { t: 10, value: 20, easeOut: LIN_OUT, easeIn: [[0.15, 0.95]] },
  ],
};
const FLAT = { rate: 1, keys: [] };

const INSTALL = `(() => {
  const k = globalThis.__kinect;
  globalThis.__kf = {
    shots: new Map(),

    async sha(bytes) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    },

    // The viewport draws the free camera and OrbitControls mutates it by
    // accumulation, so it is pinned at the head of every arm and read back at the
    // tail. Drift here would make two images differ for a reason that has nothing
    // to do with keyframes, and the check would blame the wrong thing.
    pinCamera() {
      const cam = k.freeCamera;
      k.controls.target.set(0, 0, -2.2);
      cam.position.set(0, 0.1, 1.6);
      cam.lookAt(0, 0, -2.2);
      k.controls.update(0);
      cam.updateMatrixWorld(true);
    },
    camera() {
      return [...k.freeCamera.position.toArray(), ...k.freeCamera.quaternion.toArray()]
        .map((v) => v.toFixed(9)).join(',');
    },

    counters() { return { ...k.timeline.counters }; },
    since(before) {
      const now = this.counters();
      return Object.fromEntries(Object.keys(now).map((key) => [key, now[key] - before[key]]));
    },

    grab(label) {
      const pixels = k.drive.readPixels();
      this.shots.set(label, pixels);
      return pixels;
    },

    diff(a, b) {
      const x = this.shots.get(a);
      const y = this.shots.get(b);
      if (!x || !y) throw new Error('missing shot ' + (x ? b : a));
      if (x.length !== y.length) throw new Error('shots are different sizes: ' + x.length + ' vs ' + y.length);
      let max = 0;
      let sum = 0;
      let differing = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = Math.max(
          Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]),
        );
        if (d > 0) {
          differing++;
          sum += d;
          if (d > max) max = d;
        }
      }
      const pixels = x.length / 4;
      return { max, mean: sum / pixels, differing, pixels, pct: (differing / pixels) * 100 };
    },
  };
  return true;
})()`;

const { chromium } = await loadPlaywright();
// The full chromium build rather than the headless shell, which can land on SwiftShader
// with no EXT_color_buffer_float and agree with itself for the wrong reason.
const browser = await chromium.launch({ channel: 'chromium', headless: !HEADED });
const context = await browser.newContext({
  viewport: { width: STAGE.width, height: STAGE.height + CHROME_H_GUESS },
  deviceScaleFactor: 1,
});

const page = await context.newPage();
const errors = [];
// With the section attached, so a sentence in the log does not have to be bisected for.
let section = 'startup';
const say = console.log.bind(console);
console.log = (...parts) => {
  const heading = String(parts[0] ?? '').match(/^\n== (.+) ==$/);
  if (heading) section = heading[1];
  say(...parts);
};
const note = (text) => errors.push(`${section} | ${String(text).split('\n')[0]}`);

// Each has to actually arrive: a fragment that matched nothing means the section stopped
// provoking what it was written to provoke.
const expected = [];
const expectError = (fragment, why) => expected.push({ fragment, why, seen: false });
page.on('pageerror', (err) => note(err));
page.on('console', (msg) => { if (msg.type() === 'error') note(msg.text()); });
page.on('response', (res) => { if (!res.ok()) note(`${res.status()} ${res.url()}`); });
await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));

// A route that matches nothing fulfils nothing and throws no error - the page just loads
// the tree's own source - so the interception is counted rather than assumed.
let mutantServed = 0;
let mutantPath = null;
if (MUTATE) {
  const { file, body } = mutatedSource();
  mutantPath = servedAt(file);
  await page.route((url) => url.pathname === mutantPath, (route) => {
    mutantServed++;
    route.fulfill({ contentType: 'text/javascript; charset=utf-8', body });
  });
  console.log(`[keyframe] MUTATED BUILD: ${MUTATE} in ${file} at ${mutantPath} - this run is expected to FAIL`);
}

// The editor. The old root is the main menu, which defines no `__kinect`, so the wait
// below would time out against a page that cannot answer.
await page.goto(`${URL_BASE}/edit?take=${encodeURIComponent(TAKE)}`, { waitUntil: 'load' });
await page.waitForFunction(() => !!globalThis.__kinect);

// Exit 2 rather than a failed row, because a red row on a mutation run reads as a catch. The case
// is a module this page never imports.
if (MUTATE && mutantServed === 0) {
  console.log(`\n[keyframe] DID NOT RUN - ${MUTATE} was staged for ${mutantPath} and the page never `
    + 'requested it, so this run would have measured the unmutated build');
  process.exit(2);
}
// The editor letterboxes to the project's shape, so a viewport alone no longer decides
// the drawing buffer.
await page.evaluate(`globalThis.__kinect.setOutputSize?.("${STAGE.width}x${STAGE.height}")`);
// The transport first, because `#timeline` carries `hidden` until the take opens and a strip
// measured before this wait reads zero.
await page.waitForFunction(() => !!globalThis.__kinect.timeline.transport(), null, { timeout: 20000 });
// `CHROME_H_GUESS` is a first guess: it was 104 while the bar was one row, the bar became
// two, and the stage quietly came out 570x356 against figures written for 640x400.
{
  const furniture = await page.evaluate(`(() => {
    const strip = document.getElementById('timeline');
    const appBar = document.getElementById('appBar');
    return {
      strip: strip && !strip.hidden ? Math.round(strip.getBoundingClientRect().height) : 0,
      shell: appBar && !appBar.hidden ? Math.round(appBar.getBoundingClientRect().height) : 0,
    };
  })()`);
  await page.setViewportSize({
    width: STAGE.width,
    height: STAGE.height + furniture.strip + furniture.shell,
  });
// `setViewportSize` returning is not the renderer having resized. The predicate answers false on a
// page with no renderer rather than throwing, because a throw inside `waitForFunction` is
// not caught by it.
  await page.waitForFunction((want) => {
    const gl = globalThis.__kinect?.renderer?.getContext?.();
    return !!gl && gl.drawingBufferWidth === want.w && gl.drawingBufferHeight === want.h;
  }, { w: STAGE.width, h: STAGE.height }, { timeout: 15000 }).catch(() => {});
}
await page.evaluate(INSTALL);

const gpu = await page.evaluate(() => {
  const gl = globalThis.__kinect.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
  };
});
if (/swiftshader|software|llvmpipe/i.test(gpu.renderer)) {
  throw new Error(`software rasteriser (${gpu.renderer}) - the result would prove nothing`);
}
if (!gpu.colorBufferFloat) throw new Error('no EXT_color_buffer_float: the surface memory is not running at float');
// Every geometric number here is in stage pixels, so a stage of another size makes each of them a
// measurement of somewhere else. A throw rather than a row: wrong units test nothing.
if (gpu.buffer[0] !== STAGE.width || gpu.buffer[1] !== STAGE.height) {
  throw new Error(
    `the stage came out ${gpu.buffer.join('x')} and this file's figures are ${STAGE.width}x${STAGE.height}: `
    + 'the strip height, the application bar or the letterbox moved, and every number below '
    + 'would be measured somewhere else',
  );
}

console.log(`[keyframe] ${gpu.renderer}`);
console.log(`[keyframe] stage ${gpu.buffer.join('x')}, take ${TAKE}: ${TIMES.length} frames, `
  + `${SOURCE_DURATION.toFixed(2)}s source at ${((TIMES.length - 1) / SOURCE_DURATION).toFixed(2)} fps mean`);

/**
 * How much footage this file's rows need, and the refusal when the take is shorter. A short take
 * goes wrong two ways and one is silent: section 4e clamps and reddens, while 4f and 6d carry
 * retime keys at source 12, 20 and 15, so a curve reaching the end of the footage early takes the
 * dragged key off the ruler and two more rows pass because a key never dragged never slid under its
 * neighbour. The scan holds this number against the deepest second the file's own text seeks to; it
 * cannot see the retime values above.
 */
const NEEDS_TAKE_SEC = 24;
const ownSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
const deepestSeek = Math.max(...[...ownSource.matchAll(/\.seek\(\s*(\d+(?:\.\d+)?)\s*\)/g)].map((m) => Number(m[1])));
if (deepestSeek > NEEDS_TAKE_SEC) {
  console.log(`\n[keyframe] DID NOT RUN - a row seeks to ${deepestSeek}s while NEEDS_TAKE_SEC is ${NEEDS_TAKE_SEC}`
    + ' - raise it and point --take at a fixture that holds it, or the clamp will redden rows about the build');
  process.exit(2);
}
if (!(SOURCE_DURATION >= NEEDS_TAKE_SEC)) {
  console.log(`\n[keyframe] DID NOT RUN - the take "${TAKE}" holds ${SOURCE_DURATION.toFixed(2)}s of source and `
    + `these rows need ${NEEDS_TAKE_SEC}s: they seek to ${deepestSeek}s and retime through source 20s. `
    + 'Under a shorter take the program collapses, the dragged key leaves the ruler and the gesture never '
    + 'happens - four rows redden and two pass against nothing. Point --take at a longer capture '
    + '(tools/make-fixture.js loops a short one).');
  process.exit(2);
}

// An evaluator that announced its writes never settles, and takes the page down rather
// than failing a row. Reported as what it is rather than left to crash the tool.
const lost = (err) => {
  const line = String(err?.message ?? err).split('\n')[0];
  console.log(`  FAIL  the page stopped answering, so the run could not finish   ${line}`);
  console.log('\n[keyframe] FAIL (the page was lost)');
  process.exit(1);
};
process.on('unhandledRejection', lost);
process.on('uncaughtException', lost);

const settle = () => page.evaluate('globalThis.__kinect.timeline.settled()');
const diff = (a, b) => page.evaluate(`globalThis.__kf.diff(${src(a)}, ${src(b)})`);
const setTracks = (spec) => page.evaluate(`globalThis.__kinect.keyframes.setTracks(${src(spec)})`);
const setRetime = (curve) => page.evaluate(`globalThis.__kinect.keyframes.setRetime(${src(curve)})`);
const specOf = (name) => page.evaluate(`globalThis.__kinect.params.spec(${src(name)})`);

/**
 * Where to press to reach one key or one ease handle, asked of the document rather than computed
 * from a rectangle, and null when nothing on it can be reached. The predicate is the page's own
 * line, `elementFromPoint(x, y).closest('.tkey, .thandle')` being this element - identity and not
 * class, because adjacent keys overlap. A zero-sized box is refused rather than pressed: a hidden
 * key measures 0x0 and pressing its centre presses the viewport origin.
 */
const lanePressPoint = (owner, which, index) => page.evaluate(`(() => {
  const lane = [...document.querySelectorAll('#tBeds .tlane')].find((l) => l.dataset.owner === ${src(owner)});
  const el = lane && lane.querySelectorAll(${src(which)})[${src(index)}];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // Out to the far corner of the box plus the transparent reach the CSS adds around
  // both shapes, so the walk covers everywhere a hand could land on this element and
  // nowhere it could not.
  const far = Math.ceil(Math.max(r.width, r.height) / 2) + 6;
  for (let d = 0; d <= far; d++) {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
      const x = cx + dx;
      const y = cy + dy;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('.tkey, .thandle') === el) return { x, y, cx, cy, offset: Math.hypot(dx, dy) };
    }
  }
  return null;
})()`);

// Read out of the documents that ship them, so no look value is invented here. `readBlackwall` is
// the reading and not the accumulator, so a shading picked with the grade at zero leaves every
// pre-roll cost at nothing.
const applyLook = (look) => page.evaluate(`globalThis.__kinect.applyPreset(${src(look)})`);
const shippedDoc = (name) => JSON.parse(
  readFileSync(new URL(`../presets-builtin/${name}.json`, import.meta.url), 'utf8'),
);
const BLACKWALL_DOC = shippedDoc('blackwall');
const BLACKWALL_LOOK = BLACKWALL_DOC.values;
const RGB_LOOK = shippedDoc('rgb').values;

// Cheapest claim first: an evaluator writing without the suppression has every frame schedule a
// seek that renders a pre-roll that evaluates, which takes the renderer down minutes
// later somewhere else.
console.log('\n== 0. an evaluated frame schedules no work of its own ==');
{
  await setRetime(FLAT);
  await setTracks({ bloom: [{ t: 0, value: 0.5 }, { t: 4, value: 3 }] });
  // On a budget, because that failure returns no answer at all: the settle helper waits on
  // a queue growing faster than it drains. A healthy build answers in under a second.
  const probe = await Promise.race([
    new Promise((resolve) => { setTimeout(() => resolve('timeout'), 60000); }),
    page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const kf = globalThis.__kf;
    const t = k.timeline.transport();
    await t.seek(0);
    await k.timeline.settled();
    const before = kf.counters();
    for (let i = 0; i < 4; i++) k.renderProgramFrame(t.programSec);
    return kf.since(before);
  })()`),
  ]);
  if (probe === 'timeout') {
    check(false, 'an evaluated frame schedules no seek',
      'the page did not answer within 60s, which is what a seek storm looks like from out here');
  } else {
    console.log(`  4 bare renders at a resident position scheduled ${probe.seeks} seeks and ${probe.drafts} drafts`);
    check(probe.seeks === 0 && probe.drafts === 0, 'an evaluated frame schedules no seek',
      `${probe.seeks} seeks, ${probe.drafts} drafts`);
  }
  if (failures) {
    console.log('\n  the remaining sections were not run: a build that storms cannot be measured');
    console.log(`\n[keyframe] FAIL (${failures})`);
    await browser.close();
    process.exit(1);
  }
}


console.log('\n== 1. scalar with ease handles, step, and pose ==');

// An ease-out into an ease-in: default handles would agree with a lerp and prove nothing.
const EASED = [
  { t: 0, value: 0, easeOut: [[0.75, 0]], easeIn: LIN_IN },
  { t: 4, value: 5, easeOut: [[0.2, 0.9]], easeIn: [[0.25, 1]] },
  { t: 9, value: 1, easeOut: LIN_OUT, easeIn: [[0.6, 0.05]] },
];
const STEPS = [
  { t: 0, value: false },
  { t: 3, value: true },
  { t: 7.5, value: false },
];
// Unevenly spaced, so the non-uniform tangents matter. Every orientation is a real rotation about
// one of two axes - identity quaternions let a page that never slerped pass, and one axis lets a
// component-wise slerp pass as a roll.
const PATH = [
  { t: 0, value: { position: [-1.2, 0.1, 1.4], quaternion: quatAbout([0, 1, 0], -55), fov: 50 } },
  { t: 1.2, value: { position: [-0.5, 0.5, 0.9], quaternion: quatAbout([0, 1, 0], -18), fov: 50 } },
  { t: 6.2, value: { position: [0.6, 0.35, 0.8], quaternion: quatAbout([1, 0.4, 0], 34), fov: 42 } },
  { t: 9, value: { position: [1.3, 0.05, 1.5], quaternion: quatAbout([0, 1, 0], 61), fov: 60 } },
  // More than a half turn apart the naive way round, so the dot is negative and slerp has
  // to take the shorter arc. Without it a page that dropped the flip passed the section.
  { t: 12, value: { position: [1.6, 0.2, 0.9], quaternion: quatAbout([0, 1, 0], -170), fov: 55 } },
];

{
  await setTracks({ bloom: EASED, additive: STEPS, camera: PATH });
  const at = [];
  for (let i = 0; i <= 48; i++) at.push((i / 48) * 12);

  const read = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    const at = ${src(at)};
    return {
      bloom: at.map((t) => k.keyframes.valueAt('bloom', t)),
      additive: at.map((t) => k.keyframes.valueAt('additive', t)),
      camera: at.map((t) => k.keyframes.valueAt('camera', t)),
    };
  })()`);

  const bloomSpec = await specOf('bloom');
  const expectedBloom = at.map((t) => scalarAt(EASED, t));
  const bloomErr = worst(read.bloom.map((v, i) => Math.abs(v - expectedBloom[i])));
  // The control: the same keys read as a straight lerp, which has to be far from them.
  const lerped = at.map((t) => scalarAt(EASED.map((k) => ({ ...k, easeOut: LIN_OUT, easeIn: LIN_IN })), t));
  const lerpGap = worst(read.bloom.map((v, i) => Math.abs(v - lerped[i])));

  console.log(`  bloom, ease-out into ease-in over 3 keys: worst error ${bloomErr.toExponential(1)} `
    + `against this tool's own bezier; a straight lerp of the same keys is ${lerpGap.toFixed(3)} away`);
  check(bloomErr <= halfStep(bloomSpec), 'a scalar track is the eased curve its handles describe',
    `worst ${bloomErr.toExponential(2)} against a half-step of ${halfStep(bloomSpec).toFixed(4)}`);
  check(lerpGap > 20 * halfStep(bloomSpec),
    'and the handles are doing something, because a lerp of the same keys is elsewhere',
    `${lerpGap.toFixed(3)} apart`);

  const expectedStep = at.map((t) => stepValueAt(STEPS, t));
  const stepWrong = read.additive.filter((v, i) => v !== expectedStep[i]).length;
  // A step track's control is any interpolation at all: never a value between the keys.
  const between = read.additive.filter((v) => typeof v !== 'boolean').length;
  console.log(`  additive, 3 step keys: ${read.additive.length - stepWrong} of ${at.length} positions `
    + `hold the earlier key; ${between} landed on something that is not a boolean`);
  check(stepWrong === 0, 'a step track holds the earlier value until the next key', `${stepWrong} wrong`);
  check(between === 0, 'and never lands between two, which is what a lerped boolean would do');

  const expectedPose = at.map((t) => poseValueAt(PATH, t));
  const poseErr = worst(read.camera.map((v, i) => worst(
    v.position.map((x, axis) => Math.abs(x - expectedPose[i].position[axis])),
  )));
  const fovErr = worst(read.camera.map((v, i) => Math.abs(v.fov - expectedPose[i].fov)));
  // A Catmull-Rom agrees with a lerp at every key and departs between them.
  const straight = at.map((t) => {
    const i = before(PATH, t);
    if (i < 0 || i >= PATH.length - 1) return PATH[Math.max(0, Math.min(PATH.length - 1, i))].value.position;
    const u = (t - PATH[i].t) / (PATH[i + 1].t - PATH[i].t);
    return [0, 1, 2].map((d) => PATH[i].value.position[d]
      + (PATH[i + 1].value.position[d] - PATH[i].value.position[d]) * u);
  });
  const straightGap = worst(read.camera.map((v, i) => worst(
    v.position.map((x, axis) => Math.abs(x - straight[i][axis])),
  )));
  console.log(`  camera, 4 unevenly spaced pose keys: worst position error ${poseErr.toExponential(1)} m, `
    + `fov ${fovErr.toExponential(1)}; straight lines between the same keys are ${straightGap.toFixed(3)} m away`);
  check(poseErr < VALUE_EPS, 'a pose track runs a Catmull-Rom through its positions',
    `worst ${poseErr.toExponential(2)} m`);
  check(fovErr < VALUE_EPS, 'and carries fov with it', `worst ${fovErr.toExponential(2)}`);

  // And how far a page that never interpolated would be, which is what the row above was
  // silently passing against while every test rotation was the identity.
  const angleErr = worst(read.camera.map((v, i) => quatAngle(v.quaternion, expectedPose[i].quaternion)));
  const held = at.map((t) => {
    const i = before(PATH, t);
    return PATH[Math.max(0, Math.min(PATH.length - 1, i))].value.quaternion;
  });
  const heldGap = worst(read.camera.map((v, i) => quatAngle(v.quaternion, held[i])));
  const unit = worst(read.camera.map((v) => Math.abs(Math.hypot(...v.quaternion) - 1)));
  console.log(`  orientation across the same ${at.length} positions: worst ${angleErr.toExponential(1)}° from `
    + `this tool's own slerp; holding the earlier key instead would be ${heldGap.toFixed(1)}° out, `
    + `and every quaternion is unit to ${unit.toExponential(1)}`);
  // A thousandth of a degree rather than 1e-9: three reaches the arc through `atan2` and this file
  // through `acos`. The wrong answer is 51.9 degrees out, five orders outside this.
  check(angleErr < 1e-3, 'and slerps its orientation along the shorter arc',
    `worst ${angleErr.toExponential(2)}° against a 1e-3° tolerance`);
  check(heldGap > 5,
    'and it is genuinely interpolating, because holding the earlier key lands elsewhere',
    `${heldGap.toFixed(1)}° apart`);
  check(unit < 1e-9, 'and stays on the unit sphere, which a component-wise lerp would not',
    `worst ${unit.toExponential(2)} off unit`);
  // And the fixture has a pair needing the shorter arc: without one the comparison passes
  // on a page that never negates.
  const dots = PATH.slice(1).map((key, i) => PATH[i].value.quaternion
    .reduce((sum, x, j) => sum + x * key.value.quaternion[j], 0));
  console.log(`  consecutive dot products ${dots.map((d) => d.toFixed(3)).join(' ')} - `
    + `${dots.filter((d) => d < 0).length} of ${dots.length} need the arc flipped`);
  check(dots.some((d) => d < -0.1),
    'and at least one pair is far enough round that the shorter arc is the negated one',
    dots.map((d) => d.toFixed(3)).join(' '));
  check(straightGap > 0.02,
    'and it is genuinely a spline, because straight lines through the same keys land elsewhere',
    `${straightGap.toFixed(3)} m apart`);
}


// On evenly spaced keys the two forms are the same curve, which ties the result to a
// formula neither this tool nor the page invented.
console.log('\n== 1b. evenly spaced keys agree with the textbook uniform formula ==');
{
  const EVEN = [[-1.3, 0.2, 0.15], [-0.55, 0.5, 0.55], [0.5, 0.35, 0.45], [1.25, 0.1, 0.1]];
  const keys = EVEN.map((position, i) => ({ t: i * 2, value: { position, quaternion: [0, 0, 0, 1], fov: 50 } }));
  await setTracks({ camera: keys });
  const at = [];
  for (let i = 0; i <= 30; i++) at.push((i / 30) * 6);
  const read = await page.evaluate(
    `${src(at)}.map((t) => globalThis.__kinect.keyframes.valueAt('camera', t).position)`,
  );
  const err = worst(read.map((p, i) => {
    const u = uniformCatmull(EVEN, at[i] / 6);
    return worst(p.map((x, axis) => Math.abs(x - u[axis])));
  }));
  console.log(`  4 keys 2s apart, 31 positions: worst disagreement ${err.toExponential(1)} m`);
  check(err < 1e-12, 'the non-uniform form is the uniform one when the spacing is uniform',
    `worst ${err.toExponential(2)} m`);
}


// The claim is that the handles moved the timing and left the route alone, so the rows come in
// pairs: each measurement followed by the reading a build that got it wrong would produce.
console.log('\n== 1c. the camera\'s handles shape when it arrives, not where it goes ==');
{
  // The two presses `docs/reference.md` describes. Easing every key would stop the camera
  // dead at each one.
  const SMOOTH_OUT = [[0.42, 0]];
  const SMOOTH_IN = [[0.58, 1]];
  const RAMPED = PATH.map((k, i) => ({
    ...k,
    easeOut: i === 0 ? [...SMOOTH_OUT] : [...LIN_OUT],
    easeIn: i === PATH.length - 1 ? [...SMOOTH_IN] : [...LIN_IN],
  }));

  await setTracks({ camera: RAMPED });
  const at = [];
  for (let i = 0; i <= 96; i++) at.push((i / 96) * 12);
  const read = await page.evaluate(
    `${src(at)}.map((t) => globalThis.__kinect.keyframes.valueAt('camera', t))`,
  );

  const wantEased = at.map((t) => poseValueAt(RAMPED, t));
  const posErr = worst(read.map((v, i) => worst(
    v.position.map((x, axis) => Math.abs(x - wantEased[i].position[axis])),
  )));
  const fovErr = worst(read.map((v, i) => Math.abs(v.fov - wantEased[i].fov)));
  const angErr = worst(read.map((v, i) => quatAngle(v.quaternion, wantEased[i].quaternion)));

  // The control for all three at once: the same keys with the handles taken off.
  const wantRaw = at.map((t) => poseValueAt(PATH, t));
  const rawPosGap = worst(read.map((v, i) => worst(
    v.position.map((x, axis) => Math.abs(x - wantRaw[i].position[axis])),
  )));
  const rawAngGap = worst(read.map((v, i) => quatAngle(v.quaternion, wantRaw[i].quaternion)));
  const rawFovGap = worst(read.map((v, i) => Math.abs(v.fov - wantRaw[i].fov)));

  console.log(`  5 pose keys, smooth on the first and last: worst position error `
    + `${posErr.toExponential(1)} m, fov ${fovErr.toExponential(1)}, orientation ${angErr.toExponential(1)}°`);
  console.log(`  the same keys with the handles ignored would be ${rawPosGap.toFixed(3)} m, `
    + `${rawFovGap.toFixed(2)} fov and ${rawAngGap.toFixed(1)}° away`);
  check(posErr < VALUE_EPS, 'a pose track eases its position through the handles it carries',
    `worst ${posErr.toExponential(2)} m`);
  // Not `VALUE_EPS`: the page runs Newton with a bisection fallback and this file bisects
  // throughout, so `u` agrees to about 1.4e-10 and fov to 2.5e-9. Ignoring the handles
  // reads 0.93 fov out.
  check(fovErr < 1e-7, 'and its field of view with the same fraction',
    `worst ${fovErr.toExponential(2)} against a 1e-7 tolerance, where the control is ${rawFovGap.toFixed(2)}`);
  // The row separating "eased" from "eased position only", where the camera slides down a
  // path it is no longer pointed along.
  check(angErr < 1e-3, 'and slerps its orientation at that same eased fraction, not the raw one',
    `worst ${angErr.toExponential(2)}°`);
  check(rawPosGap > 0.02 && rawAngGap > 1 && rawFovGap > 0.5,
    'and the handles are doing the work, because ignoring them lands somewhere else in all three',
    `${rawPosGap.toFixed(3)} m, ${rawAngGap.toFixed(1)}°, ${rawFovGap.toFixed(2)} fov`);

  // Asked at each key's own time rather than fished out of the sweep, whose 0.125s grid
  // misses keys at 1.2s and 6.2s entirely and scored them as perfectly held.
  const atKeys = await page.evaluate(
    `${src(RAMPED.map((k) => k.t))}.map((t) => globalThis.__kinect.keyframes.valueAt('camera', t))`,
  );
  const keyErr = worst(RAMPED.map((k, i) => worst(
    k.value.position.map((x, axis) => Math.abs(x - atKeys[i].position[axis])),
  )));
  check(keyErr < VALUE_EPS, `and all ${RAMPED.length} keys still hold the pose they were given`,
    `worst ${keyErr.toExponential(2)} m across every key time`);

  // Measured as the distance from each eased sample to the nearest point on a densely
  // sampled unmapped curve.
  const dense = [];
  for (let i = 0; i <= 3200; i++) dense.push(poseValueAt(PATH, (i / 3200) * 12).position);
  // To the nearest point on the polyline, not the nearest sample: `dense` is uniform in time and
  // the camera is not uniform in speed, so sample-to-sample reads the sampling
  // rather than the path.
  const distToSegment = (p, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const s = len2 > 0
      ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2))
      : 0;
    return Math.hypot(ap[0] - s * ab[0], ap[1] - s * ab[1], ap[2] - s * ab[2]);
  };
  const nearest = (p) => {
    let best = Infinity;
    for (let i = 0; i < dense.length - 1; i++) {
      best = Math.min(best, distToSegment(p, dense[i], dense[i + 1]));
    }
    return best;
  };
  const offPath = worst(read.map((v) => nearest(v.position)));

  // The control, because "every sample is near some point of a dense curve" is a test many
  // wrong answers pass.
  const straightPath = at.map((t) => {
    const i = before(PATH, t);
    if (i < 0 || i >= PATH.length - 1) {
      return PATH[Math.max(0, Math.min(PATH.length - 1, i))].value.position;
    }
    const u = (t - PATH[i].t) / (PATH[i + 1].t - PATH[i].t);
    return [0, 1, 2].map((d) => PATH[i].value.position[d]
      + (PATH[i + 1].value.position[d] - PATH[i].value.position[d]) * u);
  });
  const straightOff = worst(straightPath.map((p) => nearest(p)));

  console.log(`  the eased run leaves the unmapped curve by at most ${offPath.toExponential(1)} m; `
    + `a straight-line traversal of the same keys leaves it by ${straightOff.toFixed(3)} m`);
  check(offPath < 1e-5,
    'and the route is untouched - every pose the eased run visits is one the unmapped curve visits',
    `worst ${offPath.toExponential(2)} m off the curve`);
  check(straightOff > 0.02,
    'and that measure can tell, because a genuinely different route through the same keys reads far',
    `${straightOff.toFixed(3)} m off the curve`);
}


console.log('\n== 2. evaluation at a program position writes what the tracks say ==');
{
  await setRetime(FLAT);
  await setTracks({ bloom: EASED, additive: STEPS, camera: PATH });
  await settle();

  // By seeking rather than calling the seam bare: the indexed source refuses to render a
  // frame it has not fetched. The position read back is the transport's own.
  const probes = [0.9, 2.7, 5.4, 8.1];
  const read = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const transport = k.timeline.transport();
    const out = [];
    for (const p of ${src(probes)}) {
      await transport.seek(p);
      const t = transport.programSec;
      out.push({
        t,
        bloom: k.params.get('bloom'),
        additive: k.params.get('additive'),
        camera: k.params.get('camera'),
        // Off the objects the shader and the renderer actually read, so this is
        // "the value reached the image" rather than "the registry remembers it".
        bloomStrength: k.bloom.strength,
        bloomEnabled: k.bloom.enabled,
        blending: k.material.blending,
        cameraPosition: k.programCamera.position.toArray(),
      });
    }
    return out;
  })()`);

  const bloomSpec = await specOf('bloom');
  const snap = (v) => {
    const clamped = Math.min(bloomSpec.max, Math.max(bloomSpec.min, v));
    return bloomSpec.min + Math.round((clamped - bloomSpec.min) / bloomSpec.step) * bloomSpec.step;
  };
  let bloomBad = 0;
  let stepBad = 0;
  let poseBad = 0;
  let landingBad = 0;
  for (const row of read) {
    if (Math.abs(row.bloom - snap(scalarAt(EASED, row.t))) > halfStep(bloomSpec)) bloomBad++;
    if (row.additive !== stepValueAt(STEPS, row.t)) stepBad++;
    const want = poseValueAt(PATH, row.t);
    if (worst(row.camera.position.map((x, i) => Math.abs(x - want.position[i]))) > VALUE_EPS) poseBad++;
    if (Math.abs(row.bloomStrength - row.bloom) > 1e-12) landingBad++;
    if (worst(row.cameraPosition.map((x, i) => Math.abs(x - row.camera.position[i]))) > 1e-12) landingBad++;
  }
  console.log(`  ${probes.length} program positions, three kinds each: `
    + `bloom ${read.map((r) => r.bloom.toFixed(2)).join(' ')} · `
    + `additive ${read.map((r) => (r.additive ? 'on' : 'off')).join(' ')} · `
    + `camera x ${read.map((r) => r.camera.position[0].toFixed(3)).join(' ')}`);
  check(bloomBad === 0, 'a scalar track lands on the registry at the value its curve says', `${bloomBad} wrong`);
  check(stepBad === 0, 'and a step track does', `${stepBad} wrong`);
  check(poseBad === 0, 'and the pose does', `${poseBad} wrong`);
  check(landingBad === 0,
    'and every one of them reaches the object the renderer reads, not just the registry',
    `${landingBad} disagreements between registry and landing site`);

  // The control: the same reader against a different program position has to disagree.
  const shifted = read.filter((row, i) => {
    const other = probes[(i + 1) % probes.length];
    return Math.abs(row.bloom - snap(scalarAt(EASED, other))) < halfStep(bloomSpec);
  }).length;
  check(shifted === 0,
    'and the values are position-dependent, so a constant would not have passed the above',
    `${shifted} of ${probes.length} positions also match a different position's value`);

  // Around bare renders at a position already resident, so the seek that fetched it is not
  // inside the window.
  const delta = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const kf = globalThis.__kf;
    const t = k.timeline.transport();
    await t.seek(5.0);
    await k.timeline.settled();
    const before = kf.counters();
    const at = t.programSec;
    for (let i = 0; i < 6; i++) k.renderProgramFrame(at);
    const immediately = kf.since(before);
    // And nothing left queued behind them: a repaint is deferred to a microtask, so
    // counting without settling first would miss every one of them.
    await k.timeline.settled();
    return { immediately, settled: kf.since(before) };
  })()`);
  console.log(`  6 evaluated renders at one position scheduled ${delta.settled.seeks} seeks `
    + `and ${delta.settled.drafts} drafts, and rendered ${delta.settled.renders} frames in total`);
  check(delta.immediately.seeks === 0 && delta.immediately.drafts === 0,
    'evaluating a frame asks for no repaint of its own',
    `${delta.immediately.seeks} seeks, ${delta.immediately.drafts} drafts`);
  check(delta.settled.renders === 6,
    'and nothing more is left queued behind them once the transport settles',
    `${delta.settled.renders} renders for 6 asked for, ${delta.settled.seeks} seeks`);
}


console.log('\n== 3. a keyframed look: the same program position, reached two ways ==');

// The one preset that switches both accumulators on at once, which is what makes a
// pre-roll cost anything.
await applyLook(BLACKWALL_LOOK);

// A keyed `wake` makes the pre-roll length itself move, so a seek has to compute it at
// the target rather than once.
const LOOK_TRACKS = {
  wake: [
    { t: 0, value: 0, easeOut: [[0.6, 0]], easeIn: LIN_IN },
    { t: 8, value: 900, easeOut: LIN_OUT, easeIn: [[0.4, 1]] },
    { t: 16, value: 200, easeOut: LIN_OUT, easeIn: LIN_IN },
  ],
  bloom: [
    { t: 2, value: 0.2, easeOut: LIN_OUT, easeIn: LIN_IN },
    { t: 12, value: 3.5, easeOut: LIN_OUT, easeIn: LIN_IN },
  ],
  additive: [{ t: 0, value: true }, { t: 9, value: false }],
  camera: PATH,
};

// One arm: pin the camera, reach a program position one of the two ways, read the image back.
// Everything the verdict rests on comes back with it - the counters the arm actually moved, the
// camera it ended on, and what the transport says about the seek it ran.
const arm = (label, kind, targetSec, frames = null) => page.evaluate(`(async () => {
  const k = globalThis.__kinect;
  const kf = globalThis.__kf;
  const t = k.timeline.transport();
  const [label, kind, targetSec, frames] =
    [${src(label)}, ${src(kind)}, ${src(targetSec)}, ${src(frames)}];
  kf.pinCamera();
  await k.timeline.settled();
  kf.pinCamera();
  const before = kf.counters();
  let seek = null;
  if (kind === 'playback') {
    await t.seek(0);
    await t.runTo(t.frameAt(targetSec));
  } else {
    seek = await t.seek(targetSec, frames === null ? {} : { frames });
  }
  const pixels = kf.grab(label);
  return {
    hash: await kf.sha(pixels), delta: kf.since(before), camera: kf.camera(), seek,
    state: k.timeline.read(),
  };
})()`);

{
  await setRetime(FLAT);
  await setTracks(LOOK_TRACKS);
  await settle();

  const TARGET = 11.0;
  const played = await arm('played', 'playback', TARGET);
  const seeked = await arm('seeked', 'seek', TARGET);
  const control = await arm('control', 'seek', TARGET, 0);

  const plan = seeked.seek.plan;
  console.log(`  Blackwall with wake, bloom, additive and the camera all keyed; target ${TARGET}s = `
    + `output frame ${seeked.seek.target}. Pre-roll computed at ${plan.frames} frames `
    + `(surface ${plan.surface}, trails ${plan.trails}) against a wake of `
    + `${scalarAt(LOOK_TRACKS.wake, TARGET).toFixed(0)}ms at the target.`);
  console.log(`  playback rendered ${played.delta.renders} output frames and advanced the surface memory `
    + `${played.delta.stateAdvances} times; the seek rendered ${seeked.delta.renders} and advanced it `
    + `${seeked.delta.stateAdvances}; the control rendered ${control.delta.renders}.`);

  check(played.delta.renders === seeked.seek.target + 1,
    'playback rendered every output frame from the start of the edit',
    `${played.delta.renders} of ${seeked.seek.target + 1}`);
  check(seeked.delta.renders === plan.frames + 1,
    'the seek rendered the pre-roll and the target and nothing else',
    `${seeked.delta.renders} of ${plan.frames + 1}`);
  check(played.delta.renders > seeked.delta.renders * 3,
    'the two arms did substantially different amounts of work');
  check(played.camera === seeked.camera, 'the camera is identical across the arms');

  const same = await diff('played', 'seeked');
  const apart = await diff('played', 'control');
  console.log(`\n  playback vs seek        ${show(same)}${same.max === 0 ? '  (byte-identical)' : ''}`);
  console.log(`  playback vs no pre-roll ${show(apart)}`);
  check(same.max <= SAME_MAX, `a keyframed look seeks within ${SAME_MAX}/255 of the way it plays`, show(same));
  check(apart.max >= CONTROL_MIN && apart.pct >= CONTROL_MIN_PCT,
    'the control lands somewhere else, so the equality above is about something', show(apart));

  // The computed length is the worst case, since a ghost draws while
  // `age < fade + wake * strength`. Measured by walking down until the equality breaks.
  let needed = plan.frames;
  for (let n = plan.frames; n >= 0; n--) {
    await arm('trial', 'seek', TARGET, n);
    const d = await diff('played', 'trial');
    if (d.max > SAME_MAX) break;
    needed = n;
  }
  console.log(`  the shortest pre-roll that still reproduces it is ${needed} frames, `
    + `against ${plan.frames} computed`);
  check(needed > 0, 'a pre-roll is required at all here', `${needed} frames needed`);
  check(plan.frames >= needed, 'and the computed length covers what is needed',
    `${plan.frames} computed against ${needed} needed`);
}


// Deliberately cold. Every arm above reaches its target warm, which hid a real bug for a round:
// `preroll` read fade, wake and damp off the uniforms, so a jump from a cheap position to an
// expensive one sized its warm-up for the cheap one.
console.log('\n== 3b. a seek that jumps from a cheap look to an expensive one ==');
{
  // Anything less and the two plans differ by too little to see in pixels.
  const COLD = {
    trails: [{ t: 0, value: 0 }, { t: 8, value: 0.9 }],
    wake: [{ t: 0, value: 0 }, { t: 8, value: 1500 }],
  };
  await setRetime(FLAT);
  await setTracks(COLD);
  await applyLook(BLACKWALL_LOOK);
  await settle();

  const TARGET = 11.0;
  const cold = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const kf = globalThis.__kf;
    const t = k.timeline.transport();
    kf.pinCamera();
    // Parked at the cheap end first, so the uniforms hold the cheap look when the
    // expensive seek sizes itself. This is the state a scrub release starts from.
    await t.seek(0);
    await k.timeline.settled();
    const parked = {
      fade: k.uniforms.fadeTime.value, wake: k.uniforms.wakeTime.value,
      damp: k.afterimage.uniforms.damp.value,
    };
    const plan = t.preroll(${src(TARGET)});
    const seek = await t.seek(${src(TARGET)});
    kf.grab('cold');
    return { parked, plan, seek, warm: t.preroll(${src(TARGET)}) };
  })()`);
  const played = await arm('cold-played', 'playback', TARGET);

  const same = await diff('cold-played', 'cold');
  console.log(`  parked at 0s the uniforms hold fade ${cold.parked.fade}s, wake ${cold.parked.wake}s, `
    + `damp ${cold.parked.damp}; the track says wake `
    + `${scalarAt(COLD.wake, TARGET).toFixed(0)}ms and trails `
    + `${scalarAt(COLD.trails, TARGET).toFixed(2)} at ${TARGET}s`);
  console.log(`  the cold plan is ${cold.plan.frames} frames (surface ${cold.plan.surface}, `
    + `trails ${cold.plan.trails}); the same plan computed warm is ${cold.warm.frames}`);
  console.log(`  cold seek vs playback   ${show(same)}`);
  check(cold.plan.frames === cold.warm.frames,
    'a pre-roll is sized from the tracks at the target, not from the uniforms at the playhead',
    `${cold.plan.frames} cold against ${cold.warm.frames} warm`);
  check(cold.seek.frames === cold.plan.frames,
    'and the seek ran the length it computed', `${cold.seek.frames} of ${cold.plan.frames}`);
  check(same.max <= SAME_MAX,
    'so a seek that jumps from a cheap look to an expensive one still reproduces its playback',
    show(same));
  // The control: the cheap end really is cheap, or "cold equals warm" would be a
  // statement about two identical configurations.
  check(cold.parked.wake === 0 && cold.parked.damp === 0,
    'and the playhead really was parked somewhere cheap, so the two plans could have differed',
    JSON.stringify(cold.parked));
  await setTracks({});
}


// Whether sampling at the target is correct or merely better. For the surface half it is; for the
// trails half it is not, because three's pass is `max(new, damp * old)` per output frame, so what
// survives is the product of damp across the window and `damp_at_target ^ n` matches only while
// damp is constant.
console.log('\n== 3c. a pre-roll whose window is dearer than its target ==');
{
  await setRetime(FLAT);
  await applyLook(RGB_LOOK);
  // Fade and wake at zero and unkeyed, so the surface half cannot mask the trails half.
  await page.evaluate(`globalThis.__kinect.params.apply(${src({ fade: 0, wake: 0 })})`);
  const dampTrack = [{ t: 0, value: 0.95 }, { t: 7.8, value: 0.95 }, { t: 8.0, value: 0.5 }];
  await setTracks({ trails: dampTrack });
  await settle();

  const TARGET = 8.0;
  const seen = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    const t = k.timeline.transport();
    const fps = t.outputFps;
    return {
      plan: t.preroll(${src(TARGET)}),
      atTarget: k.keyframes.valueAt('trails', ${src(TARGET)}),
      across: [0, 10, 20, 30, 40].map((n) => k.keyframes.valueAt('trails', ${src(TARGET)} - n / fps)),
      fps,
    };
  })()`);
  // What the closed form would say, and what the product actually needs - both
  // computed here rather than read off the page.
  const closed = Math.ceil(Math.log(0.01) / Math.log(seen.atTarget));
  let product = 1;
  let needed = 0;
  for (let n = 1; n <= 400; n += 1) {
    product *= scalarAt(
      dampTrack,
      TARGET - (n - 1) / seen.fps,
    );
    needed = n;
    if (product <= 0.01) break;
  }
  const played = await arm('win-played', 'playback', TARGET);
  const full = await arm('win-full', 'seek', TARGET);
  const short = await arm('win-short', 'seek', TARGET, closed);
  const same = await diff('win-played', 'win-full');
  const apart = await diff('win-played', 'win-short');

  console.log(`  damp runs ${seen.across.map((v) => v.toFixed(2)).reverse().join(' -> ')} into the target`);
  console.log(`  the closed form asks for ${closed} frames; the product over the window needs `
    + `${needed}; the page plans ${seen.plan.trails}`);
  console.log(`  at the planned length vs playback   ${show(same)}`);
  console.log(`  at the closed form's length vs it   ${show(apart)}`);
  check(seen.plan.trails === needed,
    'the trails half counts the frames the product over the window needs',
    `${seen.plan.trails} against ${needed}`);
  check(same.max <= SAME_MAX,
    'so a seek whose window is dearer than its target still reproduces its playback', show(same));
  // The control, and the whole reason this section exists: the closed form is a
  // different number here, and the image it produces is visibly wrong.
  check(closed < needed, 'and the closed form really would have asked for less',
    `${closed} against ${needed}`);
  check(apart.max >= CONTROL_MIN,
    'and landed somewhere else, which is what makes the equality above about something',
    show(apart));
  await setTracks({});
  await applyLook(RGB_LOOK);
  await settle();
}


console.log('\n== 4. program time maps to source time through the curve ==');
{
  for (const [label, curve] of [['ramp', RAMP], ['hold', HOLD]]) {
    await setRetime(curve);
    await setTracks({});
    await settle();

    const probes = [];
    for (let i = 0; i <= 24; i++) probes.push((i / 24) * 11);
    const read = await page.evaluate(`(() => {
      const r = globalThis.__kinect.timeline.retime;
      const t = globalThis.__kinect.timeline.transport();
      return {
        source: ${src(probes)}.map((p) => r.sourceSecAt(p)),
        // Which capture frame the transport would bracket, so the mapping is
        // checked all the way down to the index rather than only as arithmetic.
        bracket: ${src(probes)}.map((p) => t.sourceFrameAt(p)),
        duration: t.duration,
      };
    })()`);

    const wantSource = probes.map((p) => retimeAt(curve, p));
    const sourceErr = worst(read.source.map((v, i) => Math.abs(v - wantSource[i])));
    const wantBracket = read.source.map((s) => bracketOf(s));
    const bracketBad = read.bracket.filter((b, i) => b !== wantBracket[i]).length;
    // The program length is where the curve first reaches the end of the take, by bisection.
    let lo = 0;
    let hi = 200;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (retimeAt(curve, mid) < SOURCE_DURATION) lo = mid;
      else hi = mid;
    }
    console.log(`  ${label}: worst source error ${sourceErr.toExponential(1)}s over 25 positions; `
      + `duration ${read.duration.toFixed(4)}s against ${hi.toFixed(4)}s computed here`);
    check(sourceErr < 1e-6, `${label}: the curve maps program time to the source times it should`,
      `worst ${sourceErr.toExponential(2)}s`);
    check(bracketBad === 0, `${label}: and the transport brackets the capture frames the index names`,
      `${bracketBad} of ${probes.length} wrong`);
    check(Math.abs(read.duration - hi) < 1e-3,
      `${label}: and the program runs until the curve reaches the end of the take`,
      `${read.duration.toFixed(4)}s against ${hi.toFixed(4)}s`);
  }

  // The control: the flat curve has to give different answers, or the three above
  // would pass on a page that ignored its keys entirely.
  await setRetime(FLAT);
  const flat = await page.evaluate('[5, 8, 10].map((p) => globalThis.__kinect.timeline.retime.sourceSecAt(p))');
  const ramped = [5, 8, 10].map((p) => retimeAt(RAMP, p));
  const gap = worst(flat.map((v, i) => Math.abs(v - ramped[i])));
  console.log(`  a curve-free retime at the same positions is ${gap.toFixed(2)}s away from the ramp`);
  check(gap > 1, 'and a page ignoring its keys would land somewhere else entirely', `${gap.toFixed(2)}s apart`);
}


console.log('\n== 4b. a hold freezes source time, and the image with it ==');
{
  await setRetime(HOLD);
  await setTracks({});
  // Every term that reads program time turned off - scan, grain, scanlines, RGB split and glitch
  // all take `uniforms.time`, which keeps running under a freeze. Persistence stays on.
  await applyLook(BLACKWALL_LOOK);
  const TIME_FREE = { scan: 0, 'grain.amount': 0, 'raster.amount': 0, 'rgbsplit.amount': 0, 'glitch.amount': 0, 'noise.amount': 0, trails: 0 };
  await page.evaluate(`globalThis.__kinect.params.apply(${src(TIME_FREE)})`);
  await settle();

  const inside = [4.6, 5.4, 6.2, 6.9];
  const read = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const kf = globalThis.__kf;
    const t = k.timeline.transport();
    const out = [];
    for (const [i, p] of ${src(inside)}.entries()) {
      const before = kf.counters();
      await t.seek(p);
      const pixels = kf.grab('hold-' + i);
      out.push({
        p,
        source: k.timeline.retime.sourceSecAt(p),
        frame: t.sourceFrameAt(p),
        advances: kf.since(before).stateAdvances,
        hash: await kf.sha(pixels),
      });
    }
    return out;
  })()`);

  const sourceSpread = worst(read.map((r) => Math.abs(r.source - read[0].source)));
  console.log(`  four positions across the freeze (${inside.join('s, ')}s) all map to source `
    + `${read[0].source.toFixed(4)}s, capture frame ${read[0].frame}; spread ${sourceSpread.toExponential(1)}s`);
  check(sourceSpread < 1e-9, 'source time does not advance through a hold', `${sourceSpread.toExponential(2)}s`);
  check(new Set(read.map((r) => r.frame)).size === 1,
    'so the same capture frame is under the playhead throughout', `${new Set(read.map((r) => r.frame)).size} frames`);

  const advances = read.map((r) => r.advances);
  console.log(`  the surface memory advanced ${advances.join(', ')} times across the four seeks`);
  const holdDiffs = [];
  for (let i = 1; i < inside.length; i++) holdDiffs.push(await diff('hold-0', `hold-${i}`));
  console.log(`  and the image at each: ${holdDiffs.map(show).join(' | ')}`);
  check(holdDiffs.every((d) => d.max <= SAME_MAX),
    'and a seek to any of them lands on the same image', holdDiffs.map((d) => d.max).join(', '));

  // The control: a position outside the hold has to differ, or "the same image"
  // above would be a statement about a renderer that had stopped working.
  await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    await k.timeline.transport().seek(9.5);
    globalThis.__kf.grab('after-hold');
    return true;
  })()`);
  const past = await diff('hold-0', 'after-hold');
  console.log(`  a position past the freeze, at 9.5s: ${show(past)}`);
  check(past.max >= CONTROL_MIN && past.pct >= CONTROL_MIN_PCT,
    'while a position past it is a different image, so this can tell them apart', show(past));

  // A hold freezes the footage by holding source time still, and everything the look drives
  // off program time carries on.
  await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const kf = globalThis.__kf;
    const t = k.timeline.transport();
    k.params.apply({ scan: 0.35, 'grain.amount': 0.22, 'raster.amount': 0.35 });
    await k.timeline.settled();
    for (const [i, p] of ${src(inside)}.entries()) {
      await t.seek(p);
      kf.grab('lively-' + i);
    }
    return true;
  })()`);
  const lively = await diff('lively-0', 'lively-3');
  console.log(`  with the scan sweep and grain back on, the same two positions: ${show(lively)}`);
  check(lively.max >= CONTROL_MIN,
    'and program time keeps running under the freeze, which is what makes it the coordinate',
    show(lively));
}


console.log('\n== 4c. the pre-roll asks how far back the curve covers a source span ==');
{
  // Placed where the answer is interesting: inside one straight segment the tangent is the
  // curve, so the discriminating positions reach back across a change of slope.
  const CASES = [
    { label: 'ramp, slow side', curve: RAMP, at: 4.0 },
    { label: 'ramp, fast side', curve: RAMP, at: 9.0 },
    { label: 'ramp, just past a knee', curve: RAMP, at: 6.1 },
    { label: 'S-curve, early', curve: EASED_RAMP, at: 2.0 },
    { label: 'S-curve, late', curve: EASED_RAMP, at: 8.5 },
    { label: 'hold, before it', curve: HOLD, at: 3.0 },
    { label: 'hold, inside it', curve: HOLD, at: 6.0 },
    { label: 'hold, just past it', curve: HOLD, at: 7.5 },
  ];
  console.log('  method: Blackwall at fade 120 + wake 550 = 0.670s of source persistence, 30 fps out.');
  console.log('  configuration            window  tangent   source span the window covers');
  const rows = [];
  for (const c of CASES) {
    await setRetime(c.curve);
    await applyLook(BLACKWALL_LOOK);
    await settle();
    const got = await page.evaluate(`(() => {
      const k = globalThis.__kinect;
      const t = k.timeline.transport();
      return {
        plan: t.preroll(${src(c.at)}),
        span: k.uniforms.fadeTime.value + k.uniforms.wakeTime.value,
        fps: t.outputFps,
        lastFrame: t.lastFrame,
      };
    })()`);
    const want = framesBack(c.curve, c.at, got.span, got.fps, got.lastFrame);
    const tangent = framesBackByTangent(c.curve, c.at, got.span, got.fps);
    const covers = retimeAt(c.curve, c.at) - retimeAt(c.curve, c.at - got.plan.surface / got.fps);
    rows.push({ ...c, got, want, tangent, covers });
    console.log(`  ${c.label.padEnd(22)} ${String(got.plan.surface).padStart(6)} `
      + `${String(tangent).padStart(8)}   ${covers.toFixed(4)}s of ${got.span.toFixed(3)}s`);
  }
  for (const r of rows) {
    check(r.got.plan.surface === r.want,
      `${r.label}: the window query counts the frames this tool counts`,
      `${r.got.plan.surface} against ${r.want}`);
  }
  for (const r of rows) {
    check(r.covers >= r.got.span - 1e-6,
      `${r.label}: and the frames it counted really do cover fade plus wake`,
      `${r.covers.toFixed(4)}s of ${r.got.span.toFixed(3)}s`);
  }
  // On a constant slope the two agree; inside a hold the tangent answers "no frames".
  const differing = rows.filter((r) => r.tangent !== r.want).length;
  const holdRow = rows.find((r) => r.label === 'hold, inside it');
  console.log(`  ${differing} of ${rows.length} configurations disagree with the tangent arithmetic; `
    + `inside the hold it asks for ${holdRow.tangent} frames against ${holdRow.want}`);
  check(differing >= 3, 'and the tangent arithmetic would have given different answers',
    `${differing} of ${rows.length} differ`);
  check(holdRow.tangent === 0 && holdRow.want > 0,
    'including a hold, where a slope of zero covers no source span at all whatever it is multiplied by',
    `tangent ${holdRow.tangent}, window ${holdRow.want}`);
}


console.log('\n== 4d. a seek across a ramp and across a hold reproduces its playback ==');
{
  // Just past the knee, so the pre-roll window reaches back across a change of slope.
  for (const [label, curve, target] of [['ramp', RAMP, 6.1], ['hold', HOLD, 6.0]]) {
    await setRetime(curve);
    await setTracks(LOOK_TRACKS);
    await applyLook(BLACKWALL_LOOK);
    await settle();

    const played = await arm(`${label}-played`, 'playback', target);
    const seeked = await arm(`${label}-seeked`, 'seek', target);
    // The control is the pre-roll the tangent arithmetic would have asked for, not zero.
    const span = await page.evaluate(
      'globalThis.__kinect.uniforms.fadeTime.value + globalThis.__kinect.uniforms.wakeTime.value',
    );
    const tangent = framesBackByTangent(curve, target, span, seeked.state.outputFps);
    const old = await arm(`${label}-tangent`, 'seek', target, tangent);

    const same = await diff(`${label}-played`, `${label}-seeked`);
    const apart = await diff(`${label}-played`, `${label}-tangent`);
    console.log(`  ${label} at ${target}s: pre-roll ${seeked.seek.plan.frames} frames `
      + `(surface ${seeked.seek.plan.surface}, trails ${seeked.seek.plan.trails}), playback rendered `
      + `${played.delta.renders}`);
    console.log(`    seek vs playback        ${show(same)}`);
    console.log(`    tangent-sized (${String(tangent).padStart(3)}) vs it  ${show(apart)}`);
    check(same.max <= SAME_MAX, `${label}: the computed pre-roll reproduces the playback`, show(same));
    if (label === 'hold') {
      check(apart.max >= CONTROL_MIN,
        `${label}: and the tangent-sized pre-roll does not, which is the finding this replaces`,
        show(apart));
    }
  }
}


// A seek plans which source frames it needs, awaits them, and renders; the curve can move inside
// that await, and then the render walks the source backwards and the pair source refuses. The first
// arm moves `rate` alone, which is step 4's own path, and `ensure` is wrapped so the curve changes
// exactly as the fetch resolves.
console.log('\n== 4e. the retime curve moving while a seek is fetching ==');
{
  await setTracks({});
  await applyLook(BLACKWALL_LOOK);
  // Drained first: rewriting the curve while a mode's own seek is fetching is contention
  // the check manufactured, and what fails is an operation nobody is testing.
  await settle();

  // From one keyed curve to another rather than from no keys to keys: a lane appearing
  // mid-seek resizes the stage, and two images of different sizes cannot be compared.
  for (const [label, before, after] of [
    ['rate, the step 4 path', { rate: 1, keys: [] }, { rate: 0.25, keys: [] }],
    ['keys, the step 5 path', RAMP, HOLD],
  ]) {
    await setRetime(before);
    await settle();
    const got = await page.evaluate(`(async () => {
      const k = globalThis.__kinect;
      const kf = globalThis.__kf;
      const t = k.timeline.transport();
      const source = t.source;
      // Emptied first, or there is nothing to await and the window this is about
      // never opens. The first run of this check counted zero interruptions and
      // reported two failures against a seek that never fetched anything at all.
      source.cache.clear();
      const real = source.ensure.bind(source);
      let hits = 0;
      // Armed only around the seek under test. Without the flag the rewrite lands
      // in whatever operation happens to be fetching - a repaint queued behind a
      // mode click, in the run that found this - and what fails is that operation
      // rather than the claim, which is a check measuring its own interference.
      let armed = false;
      source.ensure = (a, b) => real(a, b).then((r) => {
        // Once, as the first fetch resolves. Rewriting it on every fetch would
        // never converge, and this is testing a curve that moved rather than a
        // curve that will not stop moving - the bound covers that separately.
        if (armed && hits++ === 0) k.keyframes.setRetime(${src(after)});
        return r;
      });
      await k.timeline.settled();
      let threw = null;
      let landed = null;
      try {
        armed = true;
        landed = await t.seek(12.0);
      } catch (err) {
        threw = String(err.message ?? err);
      } finally {
        armed = false;
      }
      // Read here, before anything is allowed to settle. A stand-down asks for a
      // repaint, and a repaint that lands resets this counter - so reading it after
      // a settle reports zero for a seek that never landed at all. That is what the
      // first version of this section did, and it passed.
      const overtaken = t.overtaken;
      const at = t.programSec;
      const sourceAt = k.timeline.retime.sourceSecAt(at);
      source.ensure = real;
      // Settled before reading, because an overtaken seek stands down quietly and
      // leaves the landing to the repaint it queued. The claim is that the playhead
      // ends up where the winning curve puts it, not that one particular call did
      // the rendering.
      await k.timeline.settled();
      return {
        threw, hits, overtaken, at, sourceAt, landed: landed !== null,
        rate: k.timeline.retime.rate,
        keys: k.timeline.retime.keys.length,
      };
    })()`);
    // As a position rather than as pixels: the two operations reach the same place through
    // different amounts of queued work, so a pixel equality moved between runs.
    const wantSource = retimeAt(after, got.at);
    const drift = Math.abs(got.sourceAt - wantSource);
    console.log(`  ${label}: the curve was rewritten on fetch ${got.hits > 0 ? 'yes' : 'NO'}, `
      + `seek ${got.threw ? `threw: ${got.threw}` : (got.landed ? 'landed' : 'STOOD DOWN')} `
      + `with ${got.overtaken} stand-downs; playhead at program ${got.at.toFixed(3)}s -> source `
      + `${got.sourceAt.toFixed(4)}s against ${wantSource.toFixed(4)}s computed here`);
    check(got.hits > 0, `${label}: the fetch really was interrupted, so this tested something`,
      `${got.hits} interruptions`);
    check(got.threw === null, `${label}: the seek re-planned around it instead of refusing`,
      got.threw ?? '');
    // The load-bearing one: a stand-down asks for a repaint that arrives at the same place a
    // moment later, so every downstream reading looks right while nothing under test ran.
    check(got.landed === true && got.overtaken === 0,
      `${label}: and the seek itself landed rather than standing down for a repaint`,
      `landed ${got.landed}, ${got.overtaken} stand-downs`);
    check(Math.abs(got.at - 12.0) < 1e-6,
      `${label}: at the program position it was asked for`, `${got.at.toFixed(4)}s of 12s`);
    check(drift < 1e-6,
      `${label}: reading the source time the winning curve maps it to`,
      `${drift.toExponential(2)}s adrift`);
  }
  await setRetime(FLAT);
}


// Both accumulators advance one source frame at a time, so a descending segment asks the pair
// source to go backwards and it refuses - and that refusal used to arrive from inside the animation
// loop, which three then stops driving.
console.log('\n== 4f. a retime curve that runs downhill ==');
{
  await setTracks({});
  await setRetime({ rate: 1, keys: [{ t: 0, value: 0 }, { t: 8, value: 12 }, { t: 14, value: 20 }] });
  await settle();

  // (a) the programmatic door - a project file is a door too.
  const refused = await page.evaluate(`(() => {
    try {
      globalThis.__kinect.keyframes.setRetime({ rate: 1, keys: [
        { t: 0, value: 0 }, { t: 5, value: 12 }, { t: 9, value: 4 } ] });
      return null;
    } catch (err) { return String(err.message ?? err); }
  })()`);
  console.log(`  a falling curve through setRetime: ${refused ? 'refused' : 'ACCEPTED'}`);
  check(refused !== null, 'a curve that falls is refused rather than stored', refused ?? 'accepted');
  const holdOk = await page.evaluate(`(() => {
    try {
      globalThis.__kinect.keyframes.setRetime(${src(HOLD)});
      return true;
    } catch { return false; }
  })()`);
  check(holdOk === true, 'while a hold, which is equal values, still is not');

  // The other way to author a descent, invisible to a values-only check: ascending keys with an
  // outgoing handle that overshoots, shallow enough to hide inside single capture brackets.
  const HANDLE_DESCENT = { rate: 1, keys: [
    { t: 0, value: 0, easeOut: [[0.3, 1.6]], easeIn: [[2 / 3, 2 / 3]] },
    { t: 8, value: 6, easeOut: [[1 / 3, 1 / 3]], easeIn: [[2 / 3, 2 / 3]] },
  ] };
  const handleRefused = await page.evaluate(`(() => {
    try {
      globalThis.__kinect.keyframes.setRetime(${src(HANDLE_DESCENT)});
      return null;
    } catch (err) { return String(err.message ?? err); }
  })()`);
  // The largest drawdown rather than a peak followed by a minimum: the descent is a dip mid-segment
  // and the curve still ends at its highest value, so "maximum then minimum" finds nothing.
  const sampled = [];
  for (let i = 0; i <= 320; i++) sampled.push(scalarAt(HANDLE_DESCENT.keys, (i / 320) * 8, true));
  let high = -Infinity;
  let drawdown = 0;
  let from = 0;
  let to = 0;
  for (const v of sampled) {
    if (v > high) high = v;
    if (high - v > drawdown) { drawdown = high - v; from = high; to = v; }
  }
  console.log(`  keys 0 -> 6 with an easeOut y of 1.6: ${handleRefused ? 'refused' : 'ACCEPTED'}; `
    + `that curve reaches ${from.toFixed(3)}s and falls back to ${to.toFixed(3)}s, `
    + `a drawdown of ${drawdown.toFixed(3)}s`);
  check(drawdown > 0.02,
    'the handle really does bend the curve back on itself, so there is something to refuse',
    `${drawdown.toFixed(4)}s of drawdown`);
  check(handleRefused !== null,
    'and a handle outside the unit box is refused, not only falling key values',
    handleRefused ?? 'accepted');
  // The control: an in-box handle is still accepted, so this bounds the handle rather than
  // banning easing the retime at all.
  const easedOk = await page.evaluate(`(() => {
    try {
      globalThis.__kinect.keyframes.setRetime({ rate: 1, keys: [
        { t: 0, value: 0, easeOut: [[0.3, 0.95]], easeIn: [[2 / 3, 2 / 3]] },
        { t: 8, value: 6, easeOut: [[1 / 3, 1 / 3]], easeIn: [[2 / 3, 2 / 3]] } ] });
      return true;
    } catch { return false; }
  })()`);
  check(easedOk === true, 'while an eased retime with both handles inside it still is not');

  // (b) the editing door - dragged with a real pointer, well past the neighbour.
  await setRetime({ rate: 1, keys: [{ t: 0, value: 6 }, { t: 8, value: 12 }, { t: 14, value: 20 }] });
  await settle();
  await settle();
  const lane = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('#tBeds .tlane')].find((l) => l.dataset.owner === 'retime');
    const key = el.querySelectorAll('.tkey')[1];
    const r = key.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, bottom: box.bottom };
  })()`);
  await page.mouse.move(lane.x, lane.y);
  await page.mouse.down();
  // Past the floor of the lane, which without a clamp asks for a value under the key before it.
  await page.mouse.move(lane.x, lane.bottom + 40, { steps: 6 });
  await page.mouse.up();
  await settle();
  const dragged = await page.evaluate(
    'globalThis.__kinect.timeline.retime.keys.map((k) => ({ t: k.t, value: k.value }))',
  );
  const falls = dragged.some((k, i) => i > 0 && k.value < dragged[i - 1].value - 1e-9);
  console.log(`  dragged the middle key to the floor of its lane: `
    + `${dragged.map((k) => k.value.toFixed(2)).join(' -> ')}`);
  check(!falls, 'and a key dragged below the one before it stops there instead of going under',
    JSON.stringify(dragged));
  check(Math.abs(dragged[1].value - dragged[0].value) < 1e-6,
    'landing exactly on it, so the clamp is what stopped it rather than the drag being short',
    `${dragged[1].value.toFixed(4)} against ${dragged[0].value.toFixed(4)}`);

  // (c) the backstop - one that arrives anyway must not take the page with it.
  const survived = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const t = k.timeline.transport();
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    k.keyframes.setRetime({ rate: 1, keys: [{ t: 0, value: 0 }, { t: 12, value: 18 }] });
    await k.timeline.settled();
    await t.seek(4.0);
    // Past every guard, straight onto the object, which is the only way to produce
    // one now and is exactly the "arrives anyway" this backstop is for.
    //
    // The descent starts from where the walk already stands rather than from
    // somewhere else on the take: 6.0s of source at 4.0s of program, which is
    // exactly what the seek above just consumed. A curve that also *jumped* would
    // ask for frames nobody has fetched, and playback would sit waiting for them
    // instead of trying to walk backwards - which is a stall, not this claim.
    k.timeline.retime.keys = [
      { t: 0, value: 8, easeOut: [[1 / 3, 1 / 3]], easeIn: [[2 / 3, 2 / 3]] },
      { t: 12, value: 2, easeOut: [[1 / 3, 1 / 3]], easeIn: [[2 / 3, 2 / 3]] },
    ];
    const before = k.timeline.counters.renders;
    await t.play();
    const startedPlaying = t.playing;
    // Long enough for the walk to catch up with itself. The seek that preceded the
    // swap left the source walk well behind where the new curve points, so the
    // first few steps move *forward* through that backlog and only start going
    // backwards once they reach it - the refusal is a second or so in, not
    // immediate, and a short wait reports a page that simply had not got there yet.
    for (let i = 0; i < 90 && t.playing; i++) await frames();
    const afterCrash = {
      playing: t.playing,
      note: document.getElementById('tNote').textContent,
      rendered: k.timeline.counters.renders - before,
    };
    // Put a sane curve back and ask the loop to work. If the callback stopped being
    // driven this is where it shows - nothing renders, whatever the transport says.
    k.keyframes.setRetime({ rate: 1, keys: [{ t: 0, value: 0 }, { t: 12, value: 18 }] });
    await k.timeline.settled();
    await t.seek(1.0);
    const settledRenders = k.timeline.counters.renders;
    await t.play();
    for (let i = 0; i < 20; i++) await frames();
    t.pause();
    return { startedPlaying, afterCrash, alive: k.timeline.counters.renders - settledRenders };
  })()`);
  console.log(`  a curve written straight onto the object, then play: transport `
    + `${survived.afterCrash.playing ? 'still playing' : 'paused'}, note `
    + `"${survived.afterCrash.note.slice(0, 60)}"`);
  console.log(`  with a sane curve back, the animation loop rendered ${survived.alive} frames`);
  // Renders are the wrong measure of that: it refuses on the first step.
  check(survived.startedPlaying === true,
    'playback really was running when it met the curve',
    `rendered ${survived.afterCrash.rendered} frames before refusing`);
  check(survived.afterCrash.playing === false,
    'a curve that cannot be walked pauses the transport rather than running into it');
  check(survived.afterCrash.note.length > 0, 'and says why on the strip rather than only in the console',
    survived.afterCrash.note);
  // One error, and the run-wide assertion is told to expect it and to fail without it.
  expectError('the retime curve runs backwards here',
    'the refusal a downhill curve produces, caught by the loop rather than by the page dying');
  // The load-bearing one: everything above is also true of a page whose animation loop has
  // stopped being driven, because a paused transport renders nothing either way.
  check(survived.alive > 0,
    'and the animation loop is still being driven afterwards, which is the whole of the claim',
    `${survived.alive} frames rendered after`);
  await setRetime(FLAT);
  await settle();
}


console.log('\n== 5. undo restores the document and never the view ==');
{
  await setRetime(FLAT);
  await setTracks({});
  await applyLook(RGB_LOOK);
  await settle();
  await page.evaluate('globalThis.__kinect.keyframes.undo.begin()');

  const drag = async (id, values) => page.evaluate(`(() => {
    const el = document.getElementById(${src(id)});
    for (const v of ${src(values)}) {
      el.value = String(v);
      el.dispatchEvent(new Event('input'));
    }
    el.dispatchEvent(new Event('change'));
  })()`);
  const depth = () => page.evaluate('globalThis.__kinect.keyframes.undo.depth()');
  const project = () => page.evaluate('globalThis.__kinect.keyframes.project()');

  // (a) one drag is one level, not one per pointer move.
  const before5 = await depth();
  await drag('bloom', [0.5, 1.0, 1.5, 2.0, 2.5]);
  await settle();
  const afterDrag = await depth();
  console.log(`  a five-step drag of the bloom slider took the stack from ${before5} to ${afterDrag}`);
  check(afterDrag === before5 + 1, 'a slider drag pushes one snapshot, at the end of the interaction',
    `${afterDrag - before5} levels for five input events`);

  // (b) input without a release pushes nothing.
  const midDrag = await page.evaluate(`(() => {
    const el = document.getElementById('bloom');
    const start = globalThis.__kinect.keyframes.undo.depth();
    for (const v of [3.0, 3.5, 4.0]) {
      el.value = String(v);
      el.dispatchEvent(new Event('input'));
    }
    return { start, during: globalThis.__kinect.keyframes.undo.depth() };
  })()`);
  await settle();
  check(midDrag.during === midDrag.start, 'and nothing at all while the drag is still running',
    `${midDrag.during - midDrag.start} levels`);
  await page.evaluate("document.getElementById('bloom').dispatchEvent(new Event('change'))");
  await settle();

  // (c) the view leaves no trace: orbiting, scrubbing and render scale.
  const beforeView = await depth();
  const viewProbe = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const t = k.timeline.transport();
    // Orbiting: the controls moved and fired their own events, the way a drag does.
    k.controls.dispatchEvent({ type: 'start' });
    k.freeCamera.position.set(0.6, 0.4, 1.9);
    k.controls.dispatchEvent({ type: 'change' });
    k.controls.dispatchEvent({ type: 'end' });
    await k.timeline.settled();
    const afterOrbit = k.keyframes.undo.depth();
    // Scrubbing.
    await t.seek(6.0);
    const afterScrub = k.keyframes.undo.depth();
    return { afterOrbit, afterScrub, frame: t.frame };
  })()`);
  const scaleEl = 'renderScale';
  const scaleBefore = await page.evaluate(`globalThis.__kinect.params.get(${src(scaleEl)})`);
  await drag(scaleEl, [90, 80, 70]);
  await settle();
  const afterScale = await depth();
  console.log(`  orbit ${viewProbe.afterOrbit}, scrub ${viewProbe.afterScrub}, `
    + `render scale ${scaleBefore} -> 70 gives ${afterScale}, all against ${beforeView}`);
  check(viewProbe.afterOrbit === beforeView, 'orbiting to inspect the cloud leaves the stack untouched');
  check(viewProbe.afterScrub === beforeView, 'and so does moving the playhead');
  check(afterScale === beforeView,
    'and so does dropping render scale, even though its control fires the same change event',
    `${afterScale - beforeView} levels`);

  // (d) and none of it is in the snapshot, so an undo cannot put it back.
  const snapshot = await project();
  // A v3 document is `{ look: { mode, params, tracks }, composition: { retime, camera } }`,
  // and read flat the `in` below throws rather than failing.
  check(!('renderScale' in snapshot.look.params) && !('spin' in snapshot.look.params),
    'the snapshot holds no view state at all', Object.keys(snapshot.look.params).join(' '));

  // (e) an undo restores the document and moves neither the playhead nor the view.
  const keyed = { wake: [{ t: 0, value: 100 }, { t: 5, value: 1200 }] };
  await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.keyframes.setTracks(${src(keyed)});
    k.keyframes.setRetime(${src(RAMP)});
    k.keyframes.undo.commit();
  })()`);
  await settle();
  const withKeys = await project();
  const depthWithKeys = await depth();
  const undone = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    const t = k.timeline.transport();
    const frameBefore = t.frame;
    const scaleBefore = k.params.get('renderScale');
    const camBefore = k.freeCamera.position.toArray();
    const popped = k.keyframes.undo.pop();
    return {
      popped,
      project: k.keyframes.project(),
      frameBefore,
      frameAfter: t.frame,
      scaleBefore,
      scaleAfter: k.params.get('renderScale'),
      camBefore,
      camAfter: k.freeCamera.position.toArray(),
      depth: k.keyframes.undo.depth(),
    };
  })()`);
  await settle();
  // Tracks are look and the curve is composition, so the two readings come from two places.
  const undoneTracks = undone.project.look.tracks;
  const undoneRetime = undone.project.composition.retime;
  console.log(`  a track and a retime curve pushed one level (${depthWithKeys}), then undone: `
    + `tracks ${Object.keys(withKeys.look.tracks).join(',') || 'none'} -> `
    + `${Object.keys(undoneTracks).join(',') || 'none'}, `
    + `retime keys ${withKeys.composition.retime.keys.length} -> ${undoneRetime.keys.length}`);
  check(undone.popped === true, 'the stack had something to pop');
  check(Object.keys(undoneTracks).length === 0 && undoneRetime.keys.length === 0,
    'and undo took the keys and the curve back off', JSON.stringify(undoneTracks));
  check(undone.frameAfter === undone.frameBefore, 'and left the playhead exactly where it was',
    `frame ${undone.frameBefore} -> ${undone.frameAfter}`);
  check(undone.scaleAfter === undone.scaleBefore, 'and did not touch render scale',
    `${undone.scaleBefore} -> ${undone.scaleAfter}`);
  check(String(undone.camBefore) === String(undone.camAfter), 'and did not walk the orbit backwards',
    `${undone.camBefore} -> ${undone.camAfter}`);

  // (f) the look really comes back, not just the key list. Driven through `applyStoredPreset`, the
  // door the apply button uses, and not the `applyPreset` underneath it: that one writes the values
  // and commits nothing. The commit belongs to the gesture, because a track writing values every
  // frame must not push a level.
  const bulkUndo = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const LOOK = ${JSON.stringify(BLACKWALL_LOOK)};
    const watched = Object.keys(LOOK);
    const read = () => Object.fromEntries(watched.map((n) => [n, k.params.get(n)]));
    k.keyframes.undo.begin();
    const before = read();
    // The document's own body, whole, because the door validates the requires list
    // against the values and a body assembled here would be a second statement of it.
    k.library.applyStoredPreset({ name: 'keyframe-check', rev: 'sha256:0', body: ${JSON.stringify(BLACKWALL_DOC)} });
    await k.timeline.settled();
    const after = read();
    const pushed = k.keyframes.undo.depth();
    k.keyframes.undo.pop();
    await k.timeline.settled();
    return { before, after, back: read(), pushed, watched: watched.length };
  })()`);
  const moved = Object.keys(bulkUndo.before).filter((n) => bulkUndo.before[n] !== bulkUndo.after[n]);
  console.log(`  applying the Blackwall look moved ${moved.length} of ${bulkUndo.watched} values `
    + `in ${bulkUndo.pushed} level: ${moved.map((n) => `${n} ${bulkUndo.before[n]}->${bulkUndo.after[n]}`).join(' ')}`);
  // `moved` is counted rather than assumed: a preset that wrote nothing would undo
  // perfectly and pass both rows below.
  check(moved.length > 0, 'applying a look actually moves values', `${moved.length} moved`);
  check(bulkUndo.pushed === 1, `and it is one undo level, not ${bulkUndo.watched}`, `${bulkUndo.pushed}`);
  check(JSON.stringify(bulkUndo.back) === JSON.stringify(bulkUndo.before),
    'and undo restores every value it wrote, together',
    `${JSON.stringify(bulkUndo.back)} against ${JSON.stringify(bulkUndo.before)}`);
}


console.log('\n== 6. look in lanes, composition in the world ==');
{
  await setRetime(FLAT);
  await setTracks({ bloom: EASED, additive: STEPS, camera: PATH });
  await settle();
  const lanes = await page.evaluate('globalThis.__kinect.keyframes.lanes()');
  const named = await page.evaluate('globalThis.__kinect.keyframes.names()');
  const dom = await page.evaluate(
    "[...document.querySelectorAll('#tBeds .tlane')].map((el) => el.dataset.owner)",
  );
  console.log(`  three keyed parameters give lanes ${dom.join(', ')}; `
    + `the registry declares ${lanes.map((l) => `${l.owner}:${l.kind}`).join(' ')}`);
  check(lanes.length === 3 && dom.length === 3, 'only parameters carrying keys get a lane',
    `${lanes.length} lanes for ${named.length} tracks, ${dom.length} in the document`);
  check(String(dom) === String(lanes.map((l) => l.owner)), 'and the lanes drawn are the lanes computed');
  check(lanes.every((l) => l.kind === (l.owner === 'camera' ? 'pose' : (l.owner === 'additive' ? 'step' : 'scalar'))),
    'and each lane takes its kind off the registry rather than off a table of its own',
    lanes.map((l) => `${l.owner}=${l.kind}`).join(' '));

  const empty = await page.evaluate(`(() => {
    globalThis.__kinect.keyframes.setTracks({});
    return [...document.querySelectorAll('#tBeds .tlane')].length;
  })()`);
  check(empty === 0, 'and a clip with no keys has none at all, which is the nine-into-five deletion',
    `${empty} lanes`);
}


console.log('\n== 6b. dragging a path node in the top-down moves it across the floor ==');
{
  await setTracks({ camera: PATH });
  await settle();
  const NODE = 1;
  // A dispatched PointerEvent carries no active pointer id, so the capture the drag takes out
  // throws and the gesture never starts. Canvas-local, where `page.mouse` is viewport-relative: the
  // editor letterboxes to the export aspect, so without the offset the drag lands on background.
  const canvasAt = await page.evaluate(`(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { x: r.left, y: r.top };
  })()`);
  const raw = await page.evaluate(`globalThis.__kinect.keyframes.camera.project(${src(NODE)}, true)`);
  const at = { x: raw.x + canvasAt.x, y: raw.y + canvasAt.y };
  const before = await page.evaluate(`globalThis.__kinect.keyframes.camera.keys()[${src(NODE)}].value.position`);
  const depthBefore = await page.evaluate('globalThis.__kinect.keyframes.undo.depth()');

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  const during = await page.evaluate('globalThis.__kinect.controls.enabled');
  await page.mouse.move(at.x + 18, at.y - 12, { steps: 4 });
  await page.mouse.up();
  await settle();

  const after = await page.evaluate(`globalThis.__kinect.keyframes.camera.keys()[${src(NODE)}].value.position`);
  const orbitAfter = await page.evaluate('globalThis.__kinect.controls.enabled');
  const depthAfter = await page.evaluate('globalThis.__kinect.keyframes.undo.depth()');
  const lane = await page.evaluate("globalThis.__kinect.keyframes.lanes().find((l) => l.owner === 'camera')");

  const d = [0, 1, 2].map((i) => after[i] - before[i]);
  // Drawn to a known scale: 18 pixels right and 12 up, over the inset's pixels per metre.
  const inset = await page.evaluate('globalThis.__kinect.keyframes.chrome.inset()');
  const perMetre = inset.h / 7;
  console.log(`  node ${NODE} moved from ${before.map((x) => x.toFixed(3)).join(', ')} to `
    + `${after.map((x) => x.toFixed(3)).join(', ')}   `
    + `(dx ${d[0].toFixed(3)}, dy ${d[1].toFixed(3)}, dz ${d[2].toFixed(3)})`);
  console.log(`  the plan runs at ${perMetre.toFixed(1)} px/m, so 18 px right and 12 px up is `
    + `${(18 / perMetre).toFixed(3)} m in x and ${(-12 / perMetre).toFixed(3)} m in z`);
  check(Math.abs(d[0] - 18 / perMetre) < 0.05 && Math.abs(d[2] - (-12 / perMetre)) < 0.05,
    'a drag in the plan moves the node the distance the plan\'s own scale says',
    `dx ${d[0].toFixed(3)} against ${(18 / perMetre).toFixed(3)}, dz ${d[2].toFixed(3)} against ${(-12 / perMetre).toFixed(3)}`);
  check(d[1] === 0, 'and leaves its height alone, because a top-down drag says nothing about height',
    `dy ${d[1].toFixed(6)}`);
  check(during === false && orbitAfter === true,
    'and navigation is suspended for the length of the drag and handed back after it',
    `during ${during}, after ${orbitAfter}`);
  check(depthAfter === depthBefore + 1, 'and one drag is one undo level',
    `${depthAfter - depthBefore} levels`);
  check(lane.keys === PATH.length, 'and the path still has all its keys', `${lane.keys}`);
}


// The retime curve is the one track whose value changes how long the program is, so editing a key
// rescales the ruler it is drawn on. Left alone that is a feedback loop: drag down, the clip slows,
// the program lengthens, the ruler rescales, and the key moves under a pointer that
// never moved sideways.
console.log('\n== 6d. a retime key dragged down changes the speed, not when it is ==');
{
  await setTracks({});
  await setRetime({ rate: 1, keys: [{ t: 0, value: 0 }, { t: 15, value: 15 }] });
  await settle();
  // Drained again after the curve is set: a repaint left over from an earlier section gets
  // overtaken here, which is correct behaviour and nothing to do with the claim.
  await settle();
  const lane = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('#tBeds .tlane')].find((l) => l.dataset.owner === 'retime');
    const key = el.querySelectorAll('.tkey')[1];
    const r = key.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      top: box.top, height: box.height,
      value: globalThis.__kinect.timeline.retime.keys[1].value,
    };
  })()`);
  // The walk is in seconds converted to pixels, not in pixels: the lane draws zero to the capture's
  // own length across forty pixels, so what a pixel is worth depends on the fixture. The pixels
  // come from where the page actually drew the key, read back off the drawing rather than assumed.
  const frac = (lane.y - lane.top) / lane.height;
  const perPx = (lane.value / Math.max(1e-6, 1 - frac)) / lane.height;
  const dropPx = (lane.value * 0.75) / Math.max(1e-9, perPx);
  const steps = [1, 2, 3, 4].map((i) => Math.round((dropPx * i) / 4));
  const walk = [];
  await page.mouse.move(lane.x, lane.y);
  await page.mouse.down();
  for (const dy of steps) {
    await page.mouse.move(lane.x, lane.y + dy);
    walk.push(await page.evaluate(`(() => {
      const k = globalThis.__kinect;
      return { t: k.timeline.retime.keys[1].t, value: k.timeline.retime.keys[1].value,
        duration: k.timeline.transport().duration };
    })()`));
  }
  await page.mouse.up();
  await settle();
  console.log(`  four vertical moves of ${steps.join(', ')}px, at ${perPx.toFixed(3)}s per pixel: `
    + `t ${walk.map((w) => w.t.toFixed(3)).join(' ')}`);
  console.log(`  against value ${walk.map((w) => w.value.toFixed(2)).join(' ')} `
    + `and program length ${walk.map((w) => w.duration.toFixed(1)).join(' ')}s`);
  const slid = worst(walk.map((w) => Math.abs(w.t - 15)));
  check(slid < 0.01, 'the key holds its program time through a vertical drag',
    `worst ${slid.toFixed(4)}s of slide`);
  check(Math.abs(walk[3].value - walk[0].value) > 1,
    'while its value moved, so the drag was doing something',
    `${walk[0].value.toFixed(2)} to ${walk[3].value.toFixed(2)}`);
  check(walk[3].duration > walk[0].duration * 1.5,
    'and the program got longer, which is what slowing a clip means',
    `${walk[0].duration.toFixed(1)}s to ${walk[3].duration.toFixed(1)}s`);
  await setRetime(FLAT);
}


// Both are gesture wiring, so the button is clicked and the handle dragged with a real
// pointer rather than with dispatched events.
console.log('\n== 6e. keying from the panel, and dragging a handle ==');
{
  await setRetime(FLAT);
  await setTracks({});
  await applyLook(BLACKWALL_LOOK);
  await settle();
  // The parent surface a hand must cross before the bloom diamond is visible.
  await page.click('#panelTabLook');

  // (a) the keyframe button, clicked.
  const seekTo = (sec) => page.evaluate(
    `(async () => { await globalThis.__kinect.timeline.transport().seek(${src(sec)}); })()`,
  );
  await seekTo(2.0);
  await page.click('.kf[aria-label="bloom keyframe"]');
  await settle();
  const afterClick = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    return {
      keys: k.keyframes.project().look.tracks.bloom ?? null,
      state: document.querySelector('.kf[aria-label="bloom keyframe"]').dataset.kf,
      value: k.params.get('bloom'),
    };
  })()`);
  console.log(`  clicking the bloom diamond at 2.0s: ${afterClick.keys?.length ?? 0} key, `
    + `the control reads "${afterClick.state}", the parameter is ${afterClick.value}`);
  check(afterClick.keys?.length === 1, 'clicking a keyframe control plants a key at the playhead',
    `${afterClick.keys?.length ?? 0} keys`);
  check(afterClick.state === 'here', 'and the control says there is one here', afterClick.state);
  check(Math.abs(afterClick.keys[0].value - afterClick.value) < 1e-9,
    'holding the value the parameter already had, so keying changes no image',
    `${afterClick.keys[0].value} against ${afterClick.value}`);

  // (b) the Final Cut rule: with keys on the track, the slider writes the key at the
  // playhead. The evaluator rewrites every keyed parameter on the next render, so a bare
  // `params.set` is overwritten and the slider springs back on its own.
  await seekTo(8.0);
  await page.click('.kf[aria-label="bloom keyframe"]');
  await settle();
  await page.evaluate(`(() => {
    const el = document.getElementById('bloom');
    el.value = '3';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  })()`);
  await settle();
  await seekTo(5.0);
  const before5 = await page.evaluate('globalThis.__kinect.params.get("bloom")');
  await page.evaluate(`(() => {
    const el = document.getElementById('bloom');
    el.value = '1.25';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  })()`);
  await settle();
  const fc = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    return {
      keys: k.keyframes.project().look.tracks.bloom.map((key) => ({ t: +key.t.toFixed(3), value: key.value })),
      value: k.params.get('bloom'),
      slider: Number(document.getElementById('bloom').value),
    };
  })()`);
  const planted = fc.keys.find((key) => Math.abs(key.t - 5.0) < 0.05);
  console.log(`  at 5.0s the curve read ${before5}; dragging the slider to 1.25 gives keys `
    + `${fc.keys.map((key) => `${key.t}s=${key.value}`).join(' ')}`);
  console.log(`  and after the render that follows it, the parameter reads ${fc.value} `
    + `with the slider at ${fc.slider}`);
  check(fc.keys.length === 3 && planted !== undefined,
    'moving a slider on a keyed track writes a key at the playhead',
    `${fc.keys.length} keys`);
  check(planted !== undefined && Math.abs(planted.value - 1.25) < 0.03,
    'holding the value that was dragged to', `${planted?.value}`);
  // The one that matters: a bare `params.set` passes everything above and is then undone by
  // the evaluator on the very next frame.
  check(Math.abs(fc.value - 1.25) < 0.03 && Math.abs(fc.slider - 1.25) < 0.03,
    'and it stays there through the render that follows, rather than springing back',
    `parameter ${fc.value}, slider ${fc.slider}`);
  // The control: with no keys the same drag must write no key at all.
  await page.evaluate('globalThis.__kinect.keyframes.setTracks({})');
  await settle();
  await page.evaluate(`(() => {
    const el = document.getElementById('bloom');
    el.value = '2';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  })()`);
  await settle();
  const unkeyed = await page.evaluate('globalThis.__kinect.keyframes.names().length');
  check(unkeyed === 0, 'while the same drag on an unkeyed track writes no key at all',
    `${unkeyed} tracks`);

  // Both presses go through `lanePressPoint`, because the three keys here overlap each other by
  // more than a diamond's reach. One press and no retry: a second press inside `DOUBLE_CLICK_MS`
  // deletes the key.
  await setTracks({ bloom: EASED });
  await settle();
  const keyAt = await lanePressPoint('bloom', '.tkey', 1);
  if (keyAt) await page.mouse.click(keyAt.x, keyAt.y);
  await settle();
  const at = keyAt ? await lanePressPoint('bloom', '.thandle', 0) : null;
  // Counted only when there is nothing to press, so the red row can say which went wrong: a lane
  // that drew no handle, or a handle nobody can reach.
  const drawn = keyAt && at === null
    ? await page.evaluate(`(() => {
      const lane = [...document.querySelectorAll('#tBeds .tlane')].find((l) => l.dataset.owner === 'bloom');
      return lane ? lane.querySelectorAll('.thandle').length : 0;
    })()`)
    : 0;
  check(at !== null, 'selecting a key shows its ease handles',
    !keyAt ? 'the key at 4s is unreachable: no point on it hit-tests back to it'
      : at ? `pressed ${keyAt.offset.toFixed(1)}px off centre`
        : drawn === 0 ? 'no handle drawn'
          : `${drawn} drawn and none of them reachable`);
  // Filed red rather than skipped: a section that drops rows reports a smaller count for a
  // broken build than for a working one, and this suite reads names and counts off a run.
  const DRAG_ROWS = [
    'dragging an ease handle rewrites it',
    'and the curve between the keys follows it, which is what a handle is for',
    'while every key value stays exactly where it was, because an ease bends timing and not values',
  ];
  if (at === null) {
    // A missed selection is a row, never a crash: an unguarded `at.x` takes the page down and
    // leaves every section after this one unrun.
    for (const row of DRAG_ROWS) check(false, row, 'did not run: there was no handle to drag');
  } else {
    const curveBefore = await page.evaluate(
      '[5.0, 6.5].map((t) => globalThis.__kinect.keyframes.valueAt("bloom", t))',
    );
    const handleBefore = await page.evaluate(
      'JSON.stringify(globalThis.__kinect.keyframes.project().look.tracks.bloom[1])',
    );
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x - 30, at.y + 8, { steps: 5 });
    await page.mouse.up();
    await settle();
    const handleAfter = await page.evaluate(
      'JSON.stringify(globalThis.__kinect.keyframes.project().look.tracks.bloom[1])',
    );
    const curveAfter = await page.evaluate(
      '[5.0, 6.5].map((t) => globalThis.__kinect.keyframes.valueAt("bloom", t))',
    );
    const moved = worst(curveAfter.map((v, i) => Math.abs(v - curveBefore[i])));
    console.log(`  handle dragged 30px left and 8px down: `
      + `${JSON.stringify(JSON.parse(handleBefore).easeOut)} -> `
      + `${JSON.stringify(JSON.parse(handleAfter).easeOut)}`);
    // Inside the segment the dragged handle shapes - it belongs to the key's outgoing side,
    // and sampling the wrong side reads zero change.
    console.log(`  and the curve it shapes, between 4s and 9s, moved ${moved.toFixed(3)}`);
    check(handleBefore !== handleAfter, DRAG_ROWS[0]);
    check(moved > 0.01, DRAG_ROWS[1], `${moved.toFixed(4)} of change`);
    const keysHeld = await page.evaluate(
      'globalThis.__kinect.keyframes.project().look.tracks.bloom.map((k) => k.value)',
    );
    check(String(keysHeld) === String(EASED.map((k) => k.value)), DRAG_ROWS[2], String(keysHeld));
  }
  await setTracks({});
}


console.log('\n== 6c. the furniture draws outside the frame ==');
{
  await setTracks({ camera: PATH });
  await applyLook(BLACKWALL_LOOK);
  await settle();
  const shots = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const kf = globalThis.__kf;
    const t = k.timeline.transport();
    await t.seek(5.0);
    kf.grab('chrome-on');
    const on = k.keyframes.chrome.on();
    k.keyframes.chrome.set(false);
    await t.seek(5.0);
    kf.grab('chrome-off');
    k.keyframes.chrome.set(true);
    return { on, inset: k.keyframes.chrome.inset() };
  })()`);
  const chromeDiff = await diff('chrome-on', 'chrome-off');
  const insetPct = (shots.inset.w * shots.inset.h) / (STAGE.width * STAGE.height) * 100;
  console.log(`  the top-down covers ${shots.inset.w}x${shots.inset.h} of the stage, `
    + `${insetPct.toFixed(1)}% of it; with the furniture on and off: ${show(chromeDiff)}`);
  check(shots.on === true, 'the furniture was on for the first of the two');
  check(chromeDiff.max === 0,
    'and the rendered frame is byte-identical either way, so none of it is in the image',
    show(chromeDiff));
  // 8% of the stage would be unmissable if it were in the frame.
  check(insetPct > 5, 'and it is large enough that it could not have been missed',
    `${insetPct.toFixed(1)}% of the stage`);
}

{
  const unexpected = errors.filter((text) => {
    const match = expected.find((e) => text.includes(e.fragment));
    if (match) match.seen = true;
    return !match;
  });
  check(unexpected.length === 0, 'the page logged no errors it was not asked for',
    unexpected.slice(0, 3).join(' | '));
  for (const e of expected) {
    check(e.seen, `and the one it was asked for arrived: ${e.why}`, e.seen ? '' : 'never logged');
  }
}

if (SHOTS) {
  await page.locator('#stage').screenshot({ path: join(SHOTS, 'keyframe-stage.png') });
  await page.screenshot({ path: join(SHOTS, 'keyframe-page.png') });
}

console.log(`\n[keyframe] ${failures ? `FAIL (${failures})` : 'PASS'}`);
await browser.close();
process.exit(failures ? 1 : 0);
