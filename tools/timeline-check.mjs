// Proves the timeline transport: that a seek lands where playback would have, that
// the pre-roll it costs is computed rather than assumed, and that an arbitrary
// output rate interpolates the capture instead of repeating it.

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

// Resolved against this file rather than the working directory, so the tool can
// be run from anywhere the way the other two can.
const REPO = fileURLToPath(new URL('..', import.meta.url));

const URL_BASE = flag('--url', 'http://localhost:8080');
const TAKE = flag('--take', 'sample');
const HEADED = argv.includes('--headed');
const MUTATE = flag('--mutate');
const SAMPLES = Number(flag('--samples', '24'));
const WARMUP = Number(flag('--warmup', '4'));
const SHOTS = flag('--shots');

const STAGE = { width: 640, height: 360 };
const TIMELINE_H_GUESS = 148;

const SAME_MAX = 2;
const CONTROL_MIN = 16;
const CONTROL_MIN_PCT = 1.0;

const RAIN_SAME_MAX = 2;
const RAIN_CONTROL_MIN = 64;
const RAIN_CONTROL_MIN_PCT = 0.8;
const RAIN_CONTROL_MIN_MEAN = 0.08;

const MUTATIONS = {
  // The pre-roll stops being a function of anything.
  'preroll-constant': { file: 'web/main.js', edits: [[
    'const frames = Math.max(back.frames, trails);',
    'const frames = 8;',
  ]] },
  // Nothing is rendered ahead of the target.
  'preroll-none': { file: 'web/main.js', edits: [[
    'let start = Math.max(0, target - length);',
    'let start = target;',
  ]] },
  // Program time stops being scaled into source time.
  'rate-ignored': { file: 'web/main.js', edits: [[
    `  sourceSecAt(programSec) {
    const keys = this.keys;
    if (keys.length === 0) return programSec * this.rate;
    if (keys.length === 1) return keys[0].value + (programSec - keys[0].t) * this.rate;
    return scalarAt(keys, programSec, EXTEND_ENDS);
  },`,
    '  sourceSecAt(programSec) { return programSec; },',
  ]] },
  'duplicate-frames': { file: 'web/main.js', edits: [[
    'const offset = Math.min(Math.max(sourceSec - times[i], 0), span);\n'
    + '    return { steps, mixT: offset / span, sinceFrameSec: offset, spanSec: span };',
    'const offset = Math.min(Math.max(sourceSec - times[i], 0), span);\n'
    + '    return { steps, mixT: Math.round(offset / span), sinceFrameSec: offset, spanSec: span };',
  ]] },
  // A draft stops bypassing the accumulators, so it inherits its history.
  'draft-keeps-accumulators': { file: 'web/main.js', edits: [[
    '    params.apply(BYPASS_ZERO);',
    '    /* mutation: the bypass is skipped */',
  ]] },
  'draft-always-resets': { file: 'web/main.js', edits: [[
    'if (target !== this.frame || this.source.applied !== i + 1) {',
    'if (true) {',
  ]] },
  // The accumulators are not cleared before a pre-roll.
  'no-reset': { file: 'web/main.js', edits: [[
    '  clearFeedback(\n'
    + '    [statePrev, stateNext, afterimage._textureComp, afterimage._textureOld],\n'
    + "    'afterimage internals moved: the accumulator reset is no longer complete',\n"
    + '  );',
    '  /* mutation: accumulator reset skipped */',
  ]] },
  'age-clamp-low': { file: 'web/surface-memory.js', edits: [
    ['const MAX_AGE = 6.0;', 'const MAX_AGE = 4.0;'],
    ['  if (MAX_AGE < longestLife) {', '  if (false) {'],
  ] },
  // The registry stops announcing its writes, so a slider moved while the
  // playhead is parked changes neither the image nor the estimate.
  'no-repaint': { file: 'web/main.js', edits: [[
    '    paramWritten(name, spec.tag);',
    '    /* mutation: the write is not announced */',
  ]] },
  // The mode stops asking for one, so selecting a reading of the footage that
  // writes no parameter leaves the previous one on screen.
  'reading-write-skips-repaint': { file: 'web/main.js', edits: [[
    '    paramWritten(name, spec.tag);',
    '    if (!PARAMS[name].reading) paramWritten(name, spec.tag);',
  ]] },
  'rain-accumulates': { file: 'web/main.js', edits: [[
    '    uniforms.rainPhase.value = t;',
    '    uniforms.rainPhase.value += 1 / 30;',
  ]] },
  'rain-phase-unread': { file: 'effects-builtin/rain/cell.vert.glsl', edits: [[
    '    vRain = (rainPhase * rainSpeed + room.y) / rainSpan + hash(dot(wc.xz, vec2(269.5, 183.3)));',
    '    vRain = (0.0 * rainSpeed + room.y) / rainSpan + hash(dot(wc.xz, vec2(269.5, 183.3)));',
  ]] },
};

// Returned with its file rather than as a bare string so the caller can install the
// route for the right URL and, below, refuse when that URL is never asked for.
function mutatedSource() {
  const spec = MUTATIONS[MUTATE];
  if (!spec) {
    throw new Error(`unknown mutation ${MUTATE} - have ${Object.keys(MUTATIONS).join(', ')}`);
  }
  let source = readFileSync(join(REPO, spec.file), 'utf8');
  for (const [from, to] of spec.edits) {
    const hits = source.split(from).length - 1;
    if (hits !== 1) {
      throw new Error(`mutation ${MUTATE} matched ${hits} times in ${spec.file}, expected exactly 1: ${from}`);
    }
    source = source.replace(from, to);
  }
  return { file: spec.file, body: source };
}

/**
 * Where a file under `web/` is reached from a browser.
 */
function servedAt(file) {
  if (file.startsWith('effects-builtin/')) {
    const parts = file.split('/');
    if (parts.length !== 3) {
      throw new Error(`${file} is not an effect package file - a chunk is <id>/<name> under effects-builtin/`);
    }
    return `/effects/${parts[1]}/file/${parts[2]}`;
  }
  if (!file.startsWith('web/')) {
    throw new Error(`${file} is not served to a browser, so a page mutation cannot reach it`);
  }
  return `/${file.slice('web/'.length)}`;
}

function contentTypeFor(file) {
  return file.endsWith('.glsl') ? 'text/plain; charset=utf-8' : 'text/javascript; charset=utf-8';
}


// Playwright is not a dependency of this project - it is a tool the proofs reach
// for - so it is resolved from wherever it happens to be installed.
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


const index = await (await fetch(`${URL_BASE}/capture/${TAKE}/index`)).json();
const stamps = index.frames.stampMs;
const TIMES = stamps.map((s) => (s - stamps[0]) / 1000);
const DURATION = TIMES[TIMES.length - 1];
const NEEDS_TAKE_SEC = 12;

if (!(DURATION >= NEEDS_TAKE_SEC)) {
  console.log(`\n[timeline] DID NOT RUN - the take "${TAKE}" holds ${DURATION.toFixed(2)}s of source and `
    + `these rows need ${NEEDS_TAKE_SEC}s. Point --take at a longer capture `
    + '(tools/make-fixture.js loops a short one).');
  process.exit(2);
}

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

const pct = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const ms = (x) => `${x.toFixed(2)} ms`;

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures++;
};

// Pixels never cross back over the wire - a 640x360 frame is most of a megabyte
// and there are dozens per run - so every comparison is made in the page and only
// its summary comes back.
const INSTALL = `(() => {
  const k = globalThis.__kinect;
  globalThis.__tl = {
    shots: new Map(),

    async sha(bytes) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    },

    // The free camera is what the viewport draws, and OrbitControls mutates it by
    // accumulation, so it is pinned identically at the head of every arm and read
    // back at the tail of each. If it ever drifted the images would differ for a
    // reason that has nothing to do with the transport, and the check would blame
    // the wrong thing.
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

    // Awaits the transport going idle, because applying a look schedules a repaint
    // and a check that measured through one would be counting renders it did not
    // ask for.
    //
    // A mode used to be a second argument here, applied through setMode before the
    // look. It is gone rather than translated: a reading is a look value now, so it
    // arrives inside the look with everything else, and a separate door for it would
    // be a second write path to the same thing.
    async configure({ look, rate, fps }) {
      if (look) k.params.apply(look);
      k.timeline.retime.rate = rate;
      k.timeline.transport().outputFps = fps;
      this.pinCamera();
      await k.timeline.settled();
      this.pinCamera();
    },

    counters() { return { ...k.timeline.counters }; },

    since(before) {
      const now = this.counters();
      return Object.fromEntries(Object.keys(now).map((key) => [key, now[key] - before[key]]));
    },

    // Must run in the same task as the render that produced the buffer: nothing
    // preserves it across a paint.
    grab(label) {
      const pixels = k.drive.readPixels();
      this.shots.set(label, pixels);
      return pixels;
    },

    brightest(label) {
      const px = this.shots.get(label);
      let max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const d = Math.max(px[i], px[i + 1], px[i + 2]);
        if (d > max) max = d;
      }
      return max;
    },

    diff(a, b) {
      const x = this.shots.get(a);
      const y = this.shots.get(b);
      if (!x || !y) throw new Error('missing shot ' + (x ? b : a));
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

// One arm: configure, reach a program position one of the two ways, read the
// image back. Everything the verdict rests on comes back with it - the counters
// the arm actually moved, the camera it ended on, and what the transport says
// about the seek it ran.
const ARM = `async (opts) => {
  const k = globalThis.__kinect;
  const tl = globalThis.__tl;
  const t = k.timeline.transport();
  await tl.configure(opts);

  const before = tl.counters();
  const rainPhaseBefore = k.uniforms.rainPhase.value;
  let seek = null;
  if (opts.kind === 'playback') {
    // From the head of the edit, every output frame in order.
    await t.seek(0);
    await t.runTo(t.frameAt(opts.targetSec));
  } else {
    seek = await t.seek(opts.targetSec, opts.frames === null ? {} : { frames: opts.frames });
  }
  const pixels = tl.grab(opts.label);
  return {
    hash: await tl.sha(pixels),
    delta: tl.since(before),
    camera: tl.camera(),
    seek,
    // The rain's clock, read at both ends of the arm rather than once at the end of the
    // section. Read once, it is a fact about whatever ran last: the phase is a uniform that
    // persists across arms, so a build integrating it per render arrives at the target
    // carrying everything every earlier arm drew, and a section that reads it after three
    // arms cannot say which of them put it there. Read per arm, the claim is per arm - this
    // one reached this program time and the phase says so, whatever it inherited.
    rainPhaseBefore,
    rainPhaseAfter: k.uniforms.rainPhase.value,
    state: k.timeline.read(),
  };
}`;


const { chromium } = await loadPlaywright();
// The full chromium build rather than the headless shell: the shell can land on
// SwiftShader, which has no EXT_color_buffer_float, and a run that silently fell
// back to a software rasteriser would agree with itself for the wrong reason.
const browser = await chromium.launch({ channel: 'chromium', headless: !HEADED });
const context = await browser.newContext({
  viewport: { width: STAGE.width, height: STAGE.height + TIMELINE_H_GUESS },
  deviceScaleFactor: 1,
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('response', (res) => { if (!res.ok()) errors.push(`${res.status()} ${res.url()}`); });
await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));

let mutantServed = 0;
let mutantPath = null;
if (MUTATE) {
  const { file, body } = mutatedSource();
  mutantPath = servedAt(file);
  await page.route((url) => url.pathname === mutantPath, (route) => {
    mutantServed++;
    route.fulfill({ contentType: contentTypeFor(file), body });
  });
  console.log(`[timeline] MUTATED BUILD: ${MUTATE} in ${file} at ${mutantPath} - this run is expected to FAIL`);
}

await page.goto(`${URL_BASE}/edit?take=${encodeURIComponent(TAKE)}`, { waitUntil: 'load' });
await page.waitForFunction(() => !!globalThis.__kinect);

if (MUTATE && mutantServed === 0) {
  console.log(`\n[timeline] DID NOT RUN - ${MUTATE} was staged for ${mutantPath} and the page never `
    + 'requested it, so this run would have measured the unmutated build');
  process.exit(2);
}
await page.evaluate('globalThis.__kinect.setOutputSize?.("640x360")');
await page.waitForFunction(() => !!globalThis.__kinect.timeline.transport(), null, { timeout: 20000 });
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
  // The predicate answers *false* on a page with no renderer rather than throwing, because
  // a throw inside `waitForFunction` is not caught by it: the twenty seconds a wait is
  // given are never spent, and the failure arrives instantly wearing the shape of a
  // finding. `docs/instruments.md` records that costing a round on its own.
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
if (gpu.buffer[0] !== STAGE.width || gpu.buffer[1] !== STAGE.height) {
  throw new Error(
    `the stage came out ${gpu.buffer.join('x')} and this file's figures are ${STAGE.width}x${STAGE.height}: `
    + 'the strip height or the letterbox moved and every number below would be measured somewhere else',
  );
}

console.log(`[timeline] ${gpu.renderer}`);
console.log(`[timeline] stage ${gpu.buffer.join('x')}, take ${TAKE}: ${TIMES.length} frames, `
  + `${DURATION.toFixed(2)}s source, median gap ${(() => {
    const g = TIMES.slice(1).map((t, i) => t - TIMES[i]).sort((a, b) => a - b);
    return (g[g.length >> 1] * 1000).toFixed(0);
  })()}ms (${((TIMES.length - 1) / DURATION).toFixed(2)} fps mean)`);

const BLACKWALL_LOOK = JSON.parse(
  readFileSync(new URL('../presets-builtin/blackwall.json', import.meta.url), 'utf8'),
).values;
await page.evaluate(`globalThis.__kinect.applyPreset(${JSON.stringify(BLACKWALL_LOOK)})`);
const DEPTH_LOOK = JSON.parse(
  readFileSync(new URL('../presets-builtin/depth.json', import.meta.url), 'utf8'),
).values;
const RGB_LOOK = JSON.parse(
  readFileSync(new URL('../presets-builtin/rgb.json', import.meta.url), 'utf8'),
).values;
const BLACKWALL = { look: BLACKWALL_LOOK };

const CASCADE_PATH = new URL('../presets-builtin/cascade.json', import.meta.url);
const CASCADE_SHIPPED = existsSync(CASCADE_PATH)
  ? JSON.parse(readFileSync(CASCADE_PATH, 'utf8')).values
  : { ...BLACKWALL_LOOK, 'rain.amount': 0.8, 'rain.speed': 0.55, 'rain.span': 1.3, 'rain.trail': 0.45 };

const CASCADE_LOOK = {
  ...CASCADE_SHIPPED,
  trails: BLACKWALL_LOOK.trails,
  cell: (CASCADE_SHIPPED.cell ?? 0.055) * 3,
};

const arm = (opts) => page.evaluate(`(${ARM})(${JSON.stringify(opts)})`);
const diff = (a, b) => page.evaluate(`globalThis.__tl.diff(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
const show = (d) => `max ${d.max}/255, mean ${d.mean.toFixed(4)}, ${d.pct.toFixed(3)}% of pixels differ`;


console.log('\n== 1. the same program position, reached two ways ==');
const TARGET_SEC = NEEDS_TAKE_SEC;
{
  const config = { ...BLACKWALL, rate: 1, fps: 30, targetSec: TARGET_SEC, frames: null };
  const played = await arm({ ...config, kind: 'playback', label: 'played' });
  const seeked = await arm({ ...config, kind: 'seek', label: 'seeked' });
  const control = await arm({ ...config, kind: 'seek', frames: 0, label: 'control' });

  const plan = seeked.seek.plan;
  console.log(`  method: Blackwall, rate 1.00x, 30 fps out, target ${TARGET_SEC}s = output frame `
    + `${seeked.seek.target}. Pre-roll computed at ${plan.frames} frames `
    + `(surface ${plan.surface}, trails ${plan.trails}).`);
  console.log(`  playback rendered ${played.delta.renders} output frames and advanced the surface `
    + `memory ${played.delta.stateAdvances} times; the seek rendered ${seeked.delta.renders} and `
    + `advanced it ${seeked.delta.stateAdvances}; the control rendered ${control.delta.renders}.`);

  // The arms have to have done visibly different work, or "identical" is a
  // statement about one arm run twice.
  check(played.delta.renders === seeked.seek.target + 1,
    'playback rendered every output frame from the start of the edit',
    `${played.delta.renders} of ${seeked.seek.target + 1}`);
  check(seeked.delta.renders === plan.frames + 1,
    'the seek rendered the pre-roll and the target and nothing else',
    `${seeked.delta.renders} of ${plan.frames + 1}`);
  check(seeked.delta.resets === 1, 'the seek cleared both accumulators exactly once',
    `${seeked.delta.resets} resets`);
  check(seeked.seek.clamped === false, 'the pre-roll was not clipped by the head of the take',
    `start ${seeked.seek.start}, target ${seeked.seek.target}`);
  check(played.delta.renders > seeked.delta.renders * 4,
    'the two arms did substantially different amounts of work');
  check(played.camera === seeked.camera && played.camera === control.camera,
    'the camera is identical across all three arms', played.camera === seeked.camera ? '' : 'navigation drifted');

  const same = await diff('played', 'seeked');
  const apart = await diff('played', 'control');
  console.log(`\n  playback vs seek       ${show(same)}${same.max === 0 ? '  (byte-identical)' : ''}`);
  console.log(`  playback vs no pre-roll ${show(apart)}`);

  check(same.max <= SAME_MAX, `a seek lands within ${SAME_MAX}/255 of the playback`, show(same));
  check(apart.max >= CONTROL_MIN && apart.pct >= CONTROL_MIN_PCT,
    'the control lands somewhere else, so the equality above is about something',
    show(apart));
  check(apart.max > same.max * 8 + 8, 'the two verdicts are separated rather than adjacent',
    `control max ${apart.max} against ${same.max}`);
}


console.log('\n== 1b. clearing the accumulators empties both of them ==');
{
  const cleared = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const tl = globalThis.__tl;
    const t = k.timeline.transport();
    await tl.configure(${JSON.stringify({ look: BLACKWALL_LOOK, rate: 1, fps: 30 })});
    await t.seek(${TARGET_SEC});
    const before = k.stateStats();

    // Every point clipped away, so the cloud contributes nothing and whatever
    // comes out of the chain is the feedback paths on their own.
    k.params.apply({ near: 9.5, far: 9.5 });
    k.renderProgramFrame(t.programSec);
    tl.grab('stale');
    const stale = tl.brightest('stale');

    k.resetAccumulators();
    const after = k.stateStats();
    k.renderProgramFrame(t.programSec);
    tl.grab('blank');
    const blank = tl.brightest('blank');

    k.params.apply({ near: 0.05, far: 6 });
    return { before, after, stale, blank };
  })()`);

  console.log(`  surface memory: ${cleared.before.ghostsDrawn}% of pixels ghosting before the clear, `
    + `${cleared.after.ghostsDrawn}% after, and ${cleared.after.swappedLast50ms}% at age zero`);
  console.log(`  afterimage, rendered with every point clipped away: brightest channel `
    + `${cleared.stale}/255 before the clear, ${cleared.blank}/255 after`);
  check(cleared.before.ghostsDrawn > 0 && cleared.stale >= 48,
    'the control holds: both paths were carrying an image beforehand',
    `${cleared.before.ghostsDrawn}% ghosting, ${cleared.stale}/255`);
  check(cleared.after.ghostsDrawn === 0 && cleared.after.swappedLast50ms === 100,
    'the surface memory is empty afterwards');
  check(cleared.blank <= 16, 'and so is the afterimage', `${cleared.blank}/255`);
}


console.log('\n== 1c. the image at a program position is the frame the index names ==');
{
  // Depth mode with interpolation off, so the image is a function of the current
  // depth texture and nothing else - no colour, no blend against the previous
  // frame, no age term, no clock.
  const FLAT = { ...DEPTH_LOOK, fade: 0, wake: 0, trails: 0, bloom: 0, 'glitch.amount': 0, 'blackwall.scan': 0, 'noise.amount': 0, 'rgbsplit.amount': 0, 'raster.amount': 0, 'grain.amount': 0, 'vignette.amount': 0, 'duotone.amount': 0 };
  const look = { ...FLAT, interpolate: false };
  const PAIR = 100;
  const CURRENT = PAIR + 1;
  const sourceSec = TIMES[PAIR] + (TIMES[PAIR + 1] - TIMES[PAIR]) * 0.25;
  const programSec = sourceSec; // rate 1

  const golden = `async (n) => {
    const k = globalThis.__kinect;
    const tl = globalThis.__tl;
    // A bare request, not the source's cache: a shared fetch path could hand both
    // arms the same wrong frame.
    const buf = await (await fetch('/capture/${TAKE}/frame/' + n)).arrayBuffer();
    const depthBytes = new DataView(buf).getUint32(0, true);
    k.drive.injectDepth(new Uint16Array(buf.slice(16, 16 + depthBytes)));
    k.renderer.render(k.scene, k.viewCamera());
    return tl.sha(tl.grab('golden-' + n));
  }`;

  await page.evaluate(`globalThis.__tl.configure(${JSON.stringify({ look, rate: 1, fps: 30 })})`);
  const reached = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const t = k.timeline.transport();
    await t.seek(${programSec});
    return { applied: t.source.applied, hash: await globalThis.__tl.sha(globalThis.__tl.grab('reached')) };
  })()`);
  await page.evaluate(`(${golden})(${CURRENT})`);
  await page.evaluate(`(${golden})(${CURRENT - 1})`);

  const match = await diff('reached', `golden-${CURRENT}`);
  const neighbour = await diff('reached', `golden-${CURRENT - 1}`);
  console.log(`  source ${sourceSec.toFixed(4)}s brackets frames ${PAIR}/${PAIR + 1} by this tool's own `
    + `parse of the index; the page walked through frame ${reached.applied}`);
  console.log(`  against frame ${CURRENT}'s bytes pushed straight into the texture: ${show(match)}`);
  console.log(`  against its neighbour frame ${CURRENT - 1}: ${show(neighbour)}`);
  check(reached.applied === CURRENT, 'the walk consumed the frame the index says it should',
    `${reached.applied} against ${CURRENT}`);
  check(match.max === 0, 'and the pixels are the ones that frame\'s bytes produce', show(match));
  check(neighbour.max > SAME_MAX,
    'while the neighbouring frame produces a different image, so this can tell them apart',
    show(neighbour));
}


console.log('\n== 1d. the timeline binds colour, not just depth ==');
{
  const state = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    await globalThis.__tl.configure(${JSON.stringify({ look: RGB_LOOK, rate: 1, fps: 30 })});
    await k.timeline.transport().seek(${TARGET_SEC});
    return k.timeline.read();
  })()`);
  // Asserted because nothing else here would notice its absence: every comparison
  // is between two arms of the same page, so a timeline that never bound a JPEG
  // would pass all of them with both arms rendering grey.
  console.log(`  hasColor reads ${state.hasColor} after a seek to ${TARGET_SEC}s in RGB mode`);
  check(state.hasColor === 1, 'a decoded colour frame is bound after a seek');
}


console.log('\n== 2. pre-roll length is a function of fade, wake, damp and output fps ==');
const PREROLL_CASES = [
  { label: 'Blackwall, 30 fps, 1.00x', look: {}, rate: 1, fps: 30 },
  { label: 'Blackwall, 60 fps, 1.00x', look: {}, rate: 1, fps: 60 },
  { label: 'Blackwall, 30 fps, 0.50x', look: {}, rate: 0.5, fps: 30 },
  { label: 'trails 0.95, 30 fps, 1.00x', look: { trails: 0.95 }, rate: 1, fps: 30 },
  { label: 'trails 0.95, 60 fps, 1.00x', look: { trails: 0.95 }, rate: 1, fps: 60 },
  { label: 'trails 0, wake 0, 30 fps', look: { trails: 0, wake: 0 }, rate: 1, fps: 30 },
];
const plans = [];
{
  console.log('  method: read straight off the transport after configuring it, so what is');
  console.log('  tabulated is what a seek at that setting would actually run.');
  console.log('\n  configuration                surface  trails  = frames   program s');
  for (const c of PREROLL_CASES) {
    const plan = await page.evaluate(`(async (o) => {
      const k = globalThis.__kinect;
      await globalThis.__tl.configure(o);
      return k.timeline.transport().preroll(${TARGET_SEC});
    })(${JSON.stringify({ look: { ...BLACKWALL_LOOK, ...c.look }, rate: c.rate, fps: c.fps })})`);
    plans.push({ ...c, plan });
    console.log(`  ${c.label.padEnd(28)} ${String(plan.surface).padStart(6)}  `
      + `${String(plan.trails).padStart(6)}  ${String(plan.frames).padStart(8)}   ${plan.sec.toFixed(3)}`);
  }

  const at = (label) => plans.find((p) => p.label === label).plan;
  check(at('Blackwall, 30 fps, 1.00x').trails !== at('trails 0.95, 30 fps, 1.00x').trails,
    'the afterimage half moves with damp',
    `${at('Blackwall, 30 fps, 1.00x').trails} at 0.5 against ${at('trails 0.95, 30 fps, 1.00x').trails} at 0.95`);
  check(at('Blackwall, 30 fps, 1.00x').surface !== at('Blackwall, 60 fps, 1.00x').surface,
    'the fade-and-wake half moves with output frame rate',
    `${at('Blackwall, 30 fps, 1.00x').surface} at 30 fps against ${at('Blackwall, 60 fps, 1.00x').surface} at 60`);
  check(at('Blackwall, 30 fps, 1.00x').surface !== at('Blackwall, 30 fps, 0.50x').surface,
    'and with the retime slope, because fade and wake are source milliseconds',
    `${at('Blackwall, 30 fps, 1.00x').surface} at 1.00x against ${at('Blackwall, 30 fps, 0.50x').surface} at 0.50x`);
  check(at('trails 0, wake 0, 30 fps').frames < at('Blackwall, 30 fps, 1.00x').frames,
    'a look with less to remember costs less to seek to',
    `${at('trails 0, wake 0, 30 fps').frames} against ${at('Blackwall, 30 fps, 1.00x').frames}`);
  check(new Set(plans.map((p) => p.plan.frames)).size >= 4,
    'the six configurations do not all produce one number',
    `${new Set(plans.map((p) => p.plan.frames)).size} distinct lengths`);
}


async function smallestSufficient(config, played, ceiling) {
  const test = async (frames) => {
    await arm({ ...config, kind: 'seek', frames, label: 'bisect' });
    return (await diff(played, 'bisect')).max <= SAME_MAX;
  };
  if (await test(0)) return { needed: 0, below: null };
  let bad = 0;
  let good = ceiling;
  while (bad + 1 < good) {
    const mid = (bad + good) >> 1;
    if (await test(mid)) good = mid;
    else bad = mid;
  }
  return { needed: good, below: bad };
}

console.log('\n== 2b. the computed length suffices, and no one constant would ==');
const NEEDS = [];
for (const c of [
  { label: 'Blackwall, 30 fps', look: {}, rate: 1, fps: 30 },
  { label: 'Blackwall, 60 fps', look: {}, rate: 1, fps: 60 },
  { label: 'trails 0.95, 30 fps', look: { trails: 0.95 }, rate: 1, fps: 30 },
]) {
  const config = { look: { ...BLACKWALL_LOOK, ...c.look }, rate: c.rate, fps: c.fps, targetSec: TARGET_SEC };
  const played = await arm({ ...config, kind: 'playback', frames: null, label: `p-${c.label}` });
  const full = await arm({ ...config, kind: 'seek', frames: null, label: `f-${c.label}` });
  const same = await diff(`p-${c.label}`, `f-${c.label}`);
  const { needed, below } = await smallestSufficient(config, `p-${c.label}`, full.seek.plan.frames);
  NEEDS.push({ ...c, computed: full.seek.plan, needed, played: played.delta.renders });

  console.log(`\n  ${c.label}: computed ${full.seek.plan.frames} `
    + `(surface ${full.seek.plan.surface}, trails ${full.seek.plan.trails}); `
    + `playback rendered ${played.delta.renders}`);
  console.log(`    at the computed length ${show(same)}`);
  console.log(`    shortest that still reproduces it: ${needed} frames`
    + `${below === null ? '' : `, and ${below} does not`}`);
  check(same.max <= SAME_MAX, `${c.label}: the computed pre-roll reproduces the playback`, show(same));
  check(needed > 0, `${c.label}: a pre-roll is required at all`, `${needed} frames needed`);
  check(full.seek.plan.frames >= needed, `${c.label}: the computed length covers what is needed`,
    `${full.seek.plan.frames} computed against ${needed} needed`);
}
{
  const cheapest = Math.min(...NEEDS.map((n) => n.computed.frames));
  const dearest = Math.max(...NEEDS.map((n) => n.needed));
  check(dearest > cheapest,
    'no one constant would serve every configuration',
    `${dearest} frames genuinely needed at ${NEEDS.find((n) => n.needed === dearest).label}, `
    + `against a computed ${cheapest} at the cheapest`);
}


console.log('\n== 2c. the same equality at the longest persistence the sliders allow ==');
{
  const config = { look: { ...BLACKWALL_LOOK, ...{ fade: 1500, wake: 4000, trails: 0 } }, rate: 1, fps: 30, targetSec: TARGET_SEC };
  const played = await arm({ ...config, kind: 'playback', frames: null, label: 'p-longest' });
  const seeked = await arm({ ...config, kind: 'seek', frames: null, label: 'f-longest' });
  const past = await diff('p-longest', 'f-longest');
  const clamp = await page.evaluate('globalThis.__kinect.uniforms.fadeTime.value + 0');
  console.log(`  fade 1500 + wake 4000 = 5500ms of persistence, ${seeked.seek.plan.frames} pre-roll `
    + `frames computed against ${played.delta.renders} rendered by the playback`);
  console.log(`  ${show(past)}`);
  console.log(`  (Blackwall's 670ms, which every other equality here is proved at, is a `
    + `factor of eight inside it; fadeTime reads back at ${clamp}s so the look really was applied)`);
  check(clamp === 1.5, 'the longest fade the registry allows really was applied', `${clamp}s`);
  check(past.max <= SAME_MAX,
    'a seek reproduces a playback at the worst look the parameter space allows',
    show(past));
  check(seeked.seek.capped === false && seeked.seek.clamped === false,
    'and it did so on a full-length pre-roll, neither clipped by the head nor capped by the cache',
    JSON.stringify({ clamped: seeked.seek.clamped, capped: seeked.seek.capped, shortfall: seeked.seek.shortfall }));
}


console.log('\n== 2d. a pre-roll wider than the frame cache ==');
{
  const config = { look: { ...BLACKWALL_LOOK, ...{ trails: 0.97 } }, rate: 4, fps: 24, targetSec: 7.0 };
  const seeked = await arm({ ...config, kind: 'seek', frames: null, label: 'capped' });
  const state = seeked.state;
  console.log(`  trails 0.97 at 4.00x with 24 fps out: ${seeked.seek.plan.frames} frames computed, `
    + `${seeked.seek.frames} run, ${seeked.seek.shortfall} dropped`);
  console.log(`  ${seeked.seek.sourceFrames} source frames fetched, cache holding ${state.cached}`);
  check(seeked.seek.capped === true, 'the seek reports that the cache capped it',
    JSON.stringify({ capped: seeked.seek.capped, shortfall: seeked.seek.shortfall }));
  check(seeked.seek.shortfall > 0 && seeked.seek.frames < seeked.seek.plan.frames,
    'and it really did render fewer frames than it computed');
  check(state.cached <= 192, 'the cache stayed inside its ceiling', `${state.cached} frames`);
  check(seeked.delta.renders === seeked.seek.frames + 1,
    'the seek completed rather than throwing', `${seeked.delta.renders} renders`);
}


console.log('\n== 3. draft scrub against accurate seek ==');
{
  await page.evaluate(`globalThis.__tl.configure(${JSON.stringify({ look: BLACKWALL_LOOK, rate: 1, fps: 30 })})`);

  // A fixed pseudo-random walk rather than evenly spaced positions: a drag lands
  // wherever the hand is, and evenly spaced targets would let a prefetch that
  // only ever reads forward look better than it is.
  let seed = 20260731;
  const nextSec = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return 1 + (seed / 4294967296) * (DURATION - 2);
  };
  const positions = Array.from({ length: SAMPLES + WARMUP }, nextSec);

  console.log(`  method: ${SAMPLES} samples per arm after ${WARMUP} discarded, the same position`);
  console.log('  given to both arms and the arms alternated sample by sample, so any drift on the');
  console.log('  machine lands on both. Timed inside the page around the whole operation - the');
  console.log('  fetch, the JPEG decode, the upload and the render - with the frame cache in');
  console.log('  whatever state the previous samples left it. Fetch counts are reported beside');
  console.log('  the times because a warm cache is most of the difference between two runs.');

  const timings = await page.evaluate(`(async (positions) => {
    const k = globalThis.__kinect;
    const t = k.timeline.transport();
    const out = { draft: [], seek: [], draftFetch: 0, seekFetch: 0, draftReq: 0, seekReq: 0 };
    for (let i = 0; i < positions.length; i++) {
      const at = positions[i];
      let before = globalThis.__tl.counters();
      let t0 = performance.now();
      await t.draft(at);
      const draftMs = performance.now() - t0;
      const draftDelta = globalThis.__tl.since(before);

      before = globalThis.__tl.counters();
      t0 = performance.now();
      await t.seek(at);
      const seekMs = performance.now() - t0;
      const seekDelta = globalThis.__tl.since(before);

      if (i >= ${WARMUP}) {
        out.draft.push(draftMs);
        out.seek.push(seekMs);
        out.draftFetch += draftDelta.framesFetched;
        out.seekFetch += seekDelta.framesFetched;
        out.draftReq += draftDelta.requests;
        out.seekReq += seekDelta.requests;
        out.renders = seekDelta.renders;
        out.draftRenders = draftDelta.renders;
      }
    }
    return out;
  })(${JSON.stringify(positions)})`);

  const n = timings.draft.length;
  console.log(`\n  draft scrub     p50 ${ms(pct(timings.draft, 50))}   p90 ${ms(pct(timings.draft, 90))}`
    + `   ${(timings.draftFetch / n).toFixed(1)} frames fetched per sample in `
    + `${(timings.draftReq / n).toFixed(1)} requests`);
  console.log(`  accurate seek   p50 ${ms(pct(timings.seek, 50))}   p90 ${ms(pct(timings.seek, 90))}`
    + `   ${(timings.seekFetch / n).toFixed(1)} frames fetched per sample in `
    + `${(timings.seekReq / n).toFixed(1)} requests`);
  console.log(`  a draft renders ${timings.draftRenders} frame, a seek renders ${timings.renders}`);

  check(timings.draftRenders === 1, 'a draft is one render with no pre-roll at all',
    `${timings.draftRenders} renders`);
  check(pct(timings.draft, 50) < pct(timings.seek, 50),
    'a draft costs less than an accurate seek at the same position');

  const parts = await page.evaluate(`(async (positions) => {
    const k = globalThis.__kinect;
    const t = k.timeline.transport();
    const out = { fetch: [], render: [], reset: [] };
    for (let i = 0; i < positions.length; i++) {
      const at = positions[i];
      const pair = t.sourceFrameAt(at);
      // Cold on purpose: the two bracketing frames are dropped so the fetch and
      // the JPEG decode are both paid, which is what a drag onto a position it
      // has not been to costs.
      for (const k2 of [pair, pair + 1]) {
        t.source.cache.get(k2)?.bitmap?.close();
        t.source.cache.delete(k2);
      }
      let t0 = performance.now();
      await t.source.ensure(pair, pair + 1);
      const fetchMs = performance.now() - t0;

      t0 = performance.now();
      k.resetAccumulators();
      const resetMs = performance.now() - t0;

      t.source.seekTo(pair);
      t0 = performance.now();
      k.renderProgramFrame(at);
      k.drive.readPixels();          // forces the GPU to have finished
      const renderMs = performance.now() - t0;

      if (i >= ${WARMUP}) {
        out.fetch.push(fetchMs);
        out.reset.push(resetMs);
        out.render.push(renderMs);
      }
    }
    return out;
  })(${JSON.stringify(positions)})`);

  console.log('\n  step by step, cold cache, the two bracketing frames dropped before each sample');
  console.log('  and the render timed with a readback behind it so the GPU has actually finished:');
  console.log(`    fetch + decode, 2 frames   p50 ${ms(pct(parts.fetch, 50))}   p90 ${ms(pct(parts.fetch, 90))}`);
  console.log(`    clear both accumulators    p50 ${ms(pct(parts.reset, 50))}   p90 ${ms(pct(parts.reset, 90))}`);
  console.log(`    one render + readback      p50 ${ms(pct(parts.render, 50))}   p90 ${ms(pct(parts.render, 90))}`);
}


console.log('\n== 3b. a draft is independent of how the playhead got there ==');
{
  const HERE = 8.0;
  const configure = JSON.stringify({ look: BLACKWALL_LOOK, rate: 1, fps: 30 });
  const result = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const tl = globalThis.__tl;
    const t = k.timeline.transport();
    await tl.configure(${configure});

    // Reached from ahead of it, having played a long way.
    await t.seek(0);
    await t.runTo(t.frameAt(20.0));
    await t.draft(${HERE});
    tl.grab('draft-after-play');

    // And reached from behind it, off a bare seek to the head.
    await t.seek(1.0);
    await t.draft(${HERE});
    tl.grab('draft-after-seek');

    // The accurate image at the same place, for the other half of the claim.
    const seek = await t.seek(${HERE});
    tl.grab('accurate-here');

    // And the bypass stated as something that can fail: a draft holds fade, wake
    // and trails at zero for the length of its one frame, so a draft taken with
    // the three of them at their loudest has to be the same image as a draft
    // taken with them already at zero. Loudest rather than Blackwall's, because
    // Blackwall's 120ms fade is shorter than the gap the draft's two steps
    // advance and almost every point has finished ramping in by then - the
    // difference would be real but only a fraction of a percent of the frame.
    // At a 1500ms fade nothing has, so a draft that failed to bypass would come
    // back at a tenth of the brightness.
    await tl.configure(${JSON.stringify({ look: { ...BLACKWALL_LOOK, ...{ fade: 1500, wake: 4000, trails: 0.95 } }, rate: 1, fps: 30 })});
    await t.draft(${HERE});
    tl.grab('draft-loud');
    const restored = k.params.values(['fade', 'wake', 'trails']);
    await tl.configure(${JSON.stringify({ look: { ...BLACKWALL_LOOK, ...{ fade: 0, wake: 0, trails: 0 } }, rate: 1, fps: 30 })});
    await t.draft(${HERE});
    tl.grab('draft-zeroed');
    return { plan: seek.plan, restored };
  })()`);

  const history = await diff('draft-after-play', 'draft-after-seek');
  const versus = await diff('draft-after-seek', 'accurate-here');
  console.log(`  two drafts of ${HERE}s, one reached from 20.0s and one from 1.0s: ${show(history)}`);
  console.log(`  the draft against the accurate image at the same position: ${show(versus)}`);
  check(history.max === 0, 'a draft is byte-identical whatever the playhead did before it', show(history));
  check(versus.max >= CONTROL_MIN && versus.pct >= CONTROL_MIN_PCT,
    'and it is not the accurate image, so a pre-roll is being skipped', show(versus));

  const bypass = await diff('draft-loud', 'draft-zeroed');
  console.log('  a draft at fade 1500, wake 4000, trails 0.95 against one with all three at zero: '
    + `${show(bypass)}`);
  check(bypass.max === 0, 'a draft is the same image whatever the accumulator parameters say',
    show(bypass));
  check(result.restored.fade === 1500 && result.restored.wake === 4000 && result.restored.trails === 0.95,
    'and the registry is exactly where the draft found it afterwards',
    JSON.stringify(result.restored));
  console.log(`  (the accurate image there costs ${result.plan.frames} pre-roll frames)`);
}



console.log('\n== 3c. a draft that did not move the playhead rebuilds nothing ==');
{
  const HERE = 8.0;
  const result = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const tl = globalThis.__tl;
    const t = k.timeline.transport();
    await tl.configure(${JSON.stringify({ mode: 4, look: { fade: 400, wake: 900, trails: 0.85 }, rate: 1, fps: 30 })});

    // An accurate seek leaves the accumulators loaded, which is the state this is
    // about: the first draft of an orbit lands on top of one. A draft over a
    // freshly cleared set of buffers could not tell the two paths apart at all.
    await t.seek(${HERE});
    const parked = tl.counters();
    await t.draft(${HERE});
    const still = tl.since(parked);
    tl.grab('draft-stayed');

    // The same position again, this time arrived at, so the walk is genuinely
    // rebuilt. This is the control for the row above - without it, a build whose
    // counters never moved would read as the saving working perfectly.
    await t.draft(${HERE} - 0.5);
    const away = tl.counters();
    await t.draft(${HERE});
    const moved = tl.since(away);
    tl.grab('draft-arrived');

    return { still, moved, applied: t.source.applied };
  })()`);

  console.log(`  a draft where the playhead already was: ${result.still.drafts} draft, `
    + `${result.still.stateAdvances} state advances, ${result.still.resets} resets`);
  console.log(`  a draft that arrived from 0.5s away:    ${result.moved.drafts} draft, `
    + `${result.moved.stateAdvances} state advances, ${result.moved.resets} resets`);
  check(result.still.drafts === 1 && result.still.stateAdvances === 0 && result.still.resets === 0,
    'a draft at the position the playhead is parked at walks nothing and clears nothing',
    `${result.still.stateAdvances} advances, ${result.still.resets} resets`);
  check(result.moved.stateAdvances === 2 && result.moved.resets === 1,
    'and one that moved still rebuilds the pair, so the row above is a saving not a hole',
    `${result.moved.stateAdvances} advances, ${result.moved.resets} resets`);

  const same = await diff('draft-stayed', 'draft-arrived');
  console.log(`  the two drafts of ${HERE}s, one that rebuilt the walk and one that skipped it: `
    + `${show(same)}`);
  check(same.max === 0, 'and it is the same image as one that did rebuild it', show(same));
}


console.log('\n== 4. playback at a rate lands on the source times it should ==');
for (const rate of [0.5, 1.0, 2.0]) {
  const fps = 30;
  const probes = [2.0, 5.0, 9.0].filter((sec) => sec * rate < DURATION - 0.5);
  const seen = await page.evaluate(`(async (o) => {
    const k = globalThis.__kinect;
    const t = k.timeline.transport();
    await globalThis.__tl.configure(o);
    await t.seek(0);
    const out = [];
    for (const sec of o.probes) {
      await t.runTo(t.frameAt(sec));
      out.push({
        programSec: t.programSec,
        applied: t.source.applied,
        mixT: k.uniforms.mixT.value,
        sinceFrameSec: k.uniforms.sinceFrameSec.value,
      });
    }
    return out;
  })(${JSON.stringify({ look: BLACKWALL_LOOK, rate, fps, probes: [] })
    .replace('"probes":[]', `"probes":${JSON.stringify(probes)}`)})`);

  let worstT = 0;
  let worstMix = 0;
  for (const [i, got] of seen.entries()) {
    // Computed here from the index this tool fetched, never read off the page.
    const wantSource = got.programSec * rate;
    const b = bracketOf(wantSource);
    const wantMix = (wantSource - TIMES[b]) / (TIMES[b + 1] - TIMES[b]);
    worstT = Math.max(worstT, Math.abs(got.applied - (b + 1)));
    worstMix = Math.max(worstMix, Math.abs(got.mixT - wantMix));
    if (i === 0) {
      console.log(`  ${rate.toFixed(2)}x  program ${got.programSec.toFixed(3)}s -> source `
        + `${wantSource.toFixed(3)}s, frames ${b}/${b + 1} at mixT ${wantMix.toFixed(4)}; `
        + `the page holds frame ${got.applied} at mixT ${got.mixT.toFixed(4)}`);
    }
  }
  check(worstT === 0 && worstMix < 1e-6,
    `${rate.toFixed(2)}x reaches the source frames and blend the index says it should`,
    `${probes.length} probes, worst frame error ${worstT}, worst mixT error ${worstMix.toExponential(1)}`);
}


console.log('\n== 4b. 60 fps out of a capture whose median gap is 64ms ==');
{
  const FLAT = { ...DEPTH_LOOK, fade: 0, wake: 0, trails: 0, bloom: 0, 'glitch.amount': 0, 'blackwall.scan': 0, 'noise.amount': 0, 'rgbsplit.amount': 0, 'raster.amount': 0, 'grain.amount': 0, 'vignette.amount': 0, 'duotone.amount': 0 };
  const walk = `(async (o) => {
    const k = globalThis.__kinect;
    const tl = globalThis.__tl;
    const t = k.timeline.transport();
    await tl.configure(o);
    await t.seek(6.0);
    const out = [];
    for (let i = 0; i < 24; i++) {
      await t.runTo(t.frame + 1);
      const label = 'w' + i;
      out.push({
        applied: t.source.applied,
        mixT: k.uniforms.mixT.value,
        programSec: t.programSec,
        hash: await tl.sha(tl.grab(label)),
      });
    }
    return out;
  })`;

  const on = await page.evaluate(`${walk}(${JSON.stringify({ look: { ...FLAT, interpolate: true }, rate: 1, fps: 60 })})`);
  const pairs = [];
  for (let i = 1; i < on.length; i++) {
    if (on[i].applied === on[i - 1].applied) pairs.push([i - 1, i]);
  }
  const distinct = pairs.filter(([a, b]) => on[a].hash !== on[b].hash).length;
  console.log(`  method: Depth mode with fade, wake, trails, bloom, glitch, Blackwall scan, noise and the whole`);
  console.log('  grade at zero, so the blend fraction is the only thing left that can move the image.');
  console.log(`  24 output frames at 60 fps from 6.0s: ${pairs.length} consecutive pairs land on the`);
  console.log(`  same two source frames, ${distinct} of them producing a different image.`);
  console.log(`  mixT walks ${on.slice(0, 6).map((f) => f.mixT.toFixed(3)).join(' ')} ...`);

  const off = await page.evaluate(`${walk}(${JSON.stringify({ look: { ...FLAT, interpolate: false }, rate: 1, fps: 60 })})`);
  const offPairs = [];
  for (let i = 1; i < off.length; i++) {
    if (off[i].applied === off[i - 1].applied) offPairs.push([i - 1, i]);
  }
  const offDistinct = offPairs.filter(([a, b]) => off[a].hash !== off[b].hash).length;
  console.log(`  the same walk with interpolation switched off: ${offDistinct} of ${offPairs.length} differ`);

  check(pairs.length >= 8, 'the output rate genuinely outruns the capture rate',
    `${pairs.length} of 23 steps stayed inside one source pair`);
  check(distinct === pairs.length, 'every output frame inside a source pair is its own image');
  check(offDistinct === 0,
    'and with interpolation off they repeat, so the measurement is sensitive to it',
    `${offDistinct} differed`);
  check(on.every((f) => f.mixT >= 0 && f.mixT <= 1) && on.some((f) => f.mixT > 0.02 && f.mixT < 0.98),
    'the blend fraction takes interior values rather than snapping to a frame');
}


console.log('\n== 5. a look change while paused rebuilds the image and the estimate ==');
{
  // `#stage` rather than `canvas`: step 5 put the camera path and the top-down on
  // a second canvas over this one, deliberately outside the rendered frame, and a
  // bare tag selector now matches both. This is the same element it always was.
  const canvas = page.locator('#stage');
  const image = async () => createHash('sha256').update(await canvas.screenshot()).digest('hex').slice(0, 16);
  const planned = () => page.evaluate('globalThis.__kinect.timeline.transport().preroll()');
  const chip = async () => {
    const plan = await planned();
    return `${plan.frames} frames / ${plan.sec.toFixed(2)} s (surface ${plan.surface}, trails ${plan.trails})`;
  };
  const settle = () => page.evaluate('globalThis.__kinect.timeline.settled()');
  const renders = () => page.evaluate('globalThis.__kinect.timeline.counters.renders');
  const slide = (id, value) => page.evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  })()`);

  // The speed slider needs its own, because its travel is logarithmic and its `value`
  // is therefore a position rather than a rate. Writing 1.20 into it lands at 4x - the
  // top of the range - and every assertion downstream would go on passing about a rate
  // nobody asked for. So the rate goes through the page's own mapping, and the rate
  // that came out is checked against the rate that went in rather than assumed.
  const slideRate = async (rate) => {
    await page.evaluate(`(() => {
      const el = document.getElementById('tRate');
      el.value = String(__kinect.editor.rateSlider.toValue(${rate}));
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    })()`);
    const landed = await page.evaluate('__kinect.timeline.retime.rate');
    if (Math.abs(landed - rate) > 1e-6) {
      throw new Error(`asked the speed slider for ${rate}x and the page went to ${landed}x`);
    }
  };

  await page.evaluate(`(async () => {
    await globalThis.__tl.configure(${JSON.stringify({ look: RGB_LOOK, rate: 1, fps: 30 })});
    await globalThis.__kinect.timeline.transport().seek(8.0);
  })()`);
  await settle();
  const neutralImage = await image();
  const neutralChip = await chip();

  // (a) One registry write, and the image follows it.
  const beforeDepth = await renders();
  await page.evaluate("globalThis.__kinect.params.set('readDepth', 1)");
  await settle();
  const depthRenders = (await renders()) - beforeDepth;
  const depthImage = await image();
  check(depthRenders > 0,
    'writing one reading rebuilds the image, like any other registry write',
    `${depthRenders} renders`);
  check(depthImage !== neutralImage, 'and the rebuilt image is a different one');

  // (b) A whole look at once, which is the reported reproduction exactly.
  await page.evaluate(`globalThis.__kinect.applyPreset(${JSON.stringify(RGB_LOOK)})`);
  await settle();
  const beforeBlackwall = await renders();
  await page.evaluate(`globalThis.__kinect.applyPreset(${JSON.stringify(BLACKWALL_LOOK)})`);
  await settle();
  const blackwallRenders = (await renders()) - beforeBlackwall;
  const blackwallImage = await image();
  const blackwallChip = await chip();
  const blackwallPlan = await planned();
  console.log(`  neutral at 8.0s reads "${neutralChip}"`);
  console.log(`  after applying the Blackwall look and touching nothing else: "${blackwallChip}"`);
  check(blackwallRenders > 0, 'applying a look rebuilds the image',
    `${blackwallRenders} renders`);
  // One image, not one per parameter: the Blackwall look is seventeen registry writes,
  // and repainting on each would render sixteen looks that never existed on the way to
  // the one that does.
  check(blackwallRenders === blackwallPlan.frames + 1,
    'and does it once for the whole look rather than once per parameter',
    `${blackwallRenders} renders against a ${blackwallPlan.frames}-frame pre-roll`);
  check(blackwallImage !== neutralImage, 'and the rebuilt image is a different one');
  check(blackwallChip !== neutralChip, 'and recomputes the pre-roll estimate',
    `"${neutralChip}" then "${blackwallChip}"`);

  // (c) The control that makes the above mean something. Nudging the rate away
  // and back was what used to correct both surfaces, so if the repaint really
  // happened it has already done everything the nudge would do.
  await slideRate(1.2);
  await settle();
  await slideRate(1);
  await settle();
  const nudgedImage = await image();
  const nudgedChip = await chip();
  check(nudgedImage === blackwallImage && nudgedChip === blackwallChip,
    'and a rate nudge afterwards changes neither, so nothing was left waiting for one',
    nudgedImage === blackwallImage ? '' : `${blackwallImage} then ${nudgedImage}`);

  // (d) The grading move itself: a slider, dragged on the panel. `wake` because
  // it moves both surfaces at once - the image through the surface memory and the
  // estimate through the fade-and-wake half of the pre-roll.
  await page.locator('#panelTabLook').click();
  const beforeWake = await renders();
  await slide('wake', 2500);
  await settle();
  const wakeRenders = (await renders()) - beforeWake;
  const wakeImage = await image();
  const wakeChip = await chip();
  const wakePlan = await planned();
  console.log(`  after dragging wake to 2500 on the panel: "${wakeChip}"`);
  check(wakeRenders > 0, 'dragging a look slider rebuilds the image', `${wakeRenders} renders`);
  check(wakeImage !== blackwallImage, 'and the rebuilt image is a different one');
  check(wakePlan.frames > blackwallPlan.frames,
    'and the estimate follows it up',
    `${blackwallPlan.frames} frames to ${wakePlan.frames}`);
}


console.log('\n== 6. the rain falls with the program clock, not with the frames drawn ==');
{
  const config = { look: CASCADE_LOOK, rate: 1, fps: 30, targetSec: TARGET_SEC, frames: null };
  const played = await arm({ ...config, kind: 'playback', label: 'rainPlayed' });
  const seeked = await arm({ ...config, kind: 'seek', label: 'rainSeeked' });
  const control = await arm({ ...config, kind: 'seek', frames: 0, label: 'rainControl' });

  const plan = seeked.seek.plan;
  console.log(`  method: ${existsSync(CASCADE_PATH) ? 'cascade.json' : 'Blackwall with the rain raised'}`
    + `, rate 1.00x, 30 fps out, target ${TARGET_SEC}s. Playback rendered ${played.delta.renders} `
    + `output frames, the seek ${seeked.delta.renders} (a ${plan.frames}-frame pre-roll), the `
    + `control ${control.delta.renders}.`);

  const raining = await page.evaluate('globalThis.__kinect.uniforms.rain.value');
  check(raining > 0.1, 'the look under this section actually has rain in it',
    `rain reads ${raining} at the uniform`);

  const reaches = await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    const tl = globalThis.__tl;
    const held = k.uniforms.rainPhase.value;
    k.uniforms.rainPhase.value = held + 0.37;
    k.renderer.render(k.scene, k.viewCamera());
    tl.grab('rainNudged');
    k.uniforms.rainPhase.value = held;
    k.renderer.render(k.scene, k.viewCamera());
    tl.grab('rainHeld');
    return { held, nudged: held + 0.37 };
  })()`);
  const nudge = await diff('rainHeld', 'rainNudged');
  console.log(`  the clock alone, moved ${(reaches.nudged - reaches.held).toFixed(2)}s under a `
    + `still frame: ${show(nudge)}`);
  check(nudge.max >= RAIN_CONTROL_MIN && nudge.pct >= 1.0,
    'moving the rain clock and nothing else moves this picture, so the equality below is '
    + 'about a term that reaches pixels rather than about two identical frames', show(nudge));

  const clocks = [['playback', played], ['seek', seeked], ['no pre-roll', control]];
  const off = clocks.filter(([, a]) => Math.abs(a.rainPhaseAfter - TARGET_SEC) > 1e-6);
  console.log(`  rain clock per arm: ${clocks.map(([n, a]) => `${n} ${a.rainPhaseBefore.toFixed(3)}`
    + ` -> ${a.rainPhaseAfter.toFixed(3)}`).join(', ')}`);
  check(off.length === 0,
    `every arm ends with the rain clock reading the program time it was asked for, ${TARGET_SEC}s, `
    + 'whatever it inherited from the arm before it',
    off.length ? off.map(([n, a]) => `${n} ended at ${a.rainPhaseAfter.toFixed(4)}`).join(', ')
      : `all three at ${TARGET_SEC.toFixed(3)}`);

  // The arms did different work, or "identical" is a statement about one arm run twice.
  check(played.delta.renders > seeked.delta.renders * 4,
    'the two arms did substantially different amounts of work',
    `${played.delta.renders} renders against ${seeked.delta.renders}`);
  check(played.delta.renders === seeked.seek.target + 1,
    'playback rendered every output frame from the start of the edit and no more',
    `${played.delta.renders} of ${seeked.seek.target + 1}`);
  check(seeked.delta.renders === plan.frames + 1,
    'and the seek rendered the pre-roll and the target and nothing else',
    `${seeked.delta.renders} of ${plan.frames + 1}`);
  check(played.camera === seeked.camera && played.camera === control.camera,
    'the camera is identical across all three arms');

  const same = await diff('rainPlayed', 'rainSeeked');
  const apart = await diff('rainPlayed', 'rainControl');
  console.log(`\n  playback vs seek        ${show(same)}${same.max === 0 ? '  (byte-identical)' : ''}`);
  console.log(`  playback vs no pre-roll ${show(apart)}`);

  check(same.max <= RAIN_SAME_MAX,
    `a seek lands within ${RAIN_SAME_MAX}/255 of the playback with the rain falling`, show(same));
  check(apart.max >= RAIN_CONTROL_MIN && apart.pct >= RAIN_CONTROL_MIN_PCT
    && apart.mean >= RAIN_CONTROL_MIN_MEAN,
    'the control lands somewhere else across the frame rather than at one pixel, so the '
    + 'equality above is about something', show(apart));
  check(apart.max > same.max * 8 + 8, 'the two verdicts are separated rather than adjacent',
    `control max ${apart.max} against ${same.max}`);
}


if (SHOTS) {
  await page.evaluate(`(async () => {
    const k = globalThis.__kinect;
    await globalThis.__tl.configure(${JSON.stringify({ look: BLACKWALL_LOOK, rate: 1, fps: 30 })});
    await k.timeline.transport().seek(${TARGET_SEC});
  })()`);
  await page.screenshot({ path: join(SHOTS, 'timeline-check.png') });
  console.log(`\n[timeline] screenshot written to ${join(SHOTS, 'timeline-check.png')}`);
}


if (errors.length) console.log(`\n[timeline] page errors:\n  ${errors.join('\n  ')}`);
check(errors.length === 0, 'the page logged no errors');

await browser.close();
console.log(`\n[timeline] ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
