#!/usr/bin/env node
// The output to OBS: the webcam serves the colour camera, and the take never learns about it. Two outputs share one sink - a program-out page OBS opens as a
// browser source, and an MJPEG endpoint it opens as a media source - and they have different failure modes, so this file has different arms for them.
//
// The discriminator is geometric rather than perceptual. The wire already carries colour - type 2's registered 512x424 JPEG - and an implementation that
// upscaled that to 1080p would look almost right, so dimensions are the convenient probe and the wrong one. The colour camera sees 84.1 degrees where the
// registered frustum sees 70.6, and `fake-grabber --hd` plants a magenta left margin and a cyan right one in that difference, which no upscale can invent.
//
// It spawns its own server and needs none running; the stream is `tools/fake-grabber.mjs`, so no sensor is required, and ffmpeg builds and decodes the fixture.
// Section 5 needs a GPU browser and `--no-browser` drops it. Section 6 needs a non-internal IPv4 and exits 2 as UNPROVEN rather than passing quietly without
// one. What it does not prove is OBS: that a browser source renders WebGL at 1080p and that OBS samples it at canvas rate are facts measured with OBS in front of you.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageParser, TYPE_HELLO, TYPE_FRAME, TYPE_COLOR } from '../server/protocol.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const PORT = Number(flag('--port', '8361'));
const MUTATE = flag('--mutate');
const NO_BROWSER = argv.includes('--no-browser');
const WORK = join(REPO, '.vcam-check');
const SOURCE = join(REPO, 'captures', 'sample.knct');

// Where the fixture plants what the registered image cannot contain. Has to match `fake-grabber`'s `HD_MARGIN`, and is asserted below rather than assumed.
const MARGIN = Math.round(1920 * 0.12);
// How far a decoded margin may sit from the planted colour. JPEG at 4:2:0 moves a saturated edge by a few counts, and the two markers are 200-plus apart in every channel that distinguishes them.
const COLOUR_TOLERANCE = 40;

// This machine's own address, the only way to create a webcam subscriber that is not on loopback and therefore the only way section 6 can ask the refusal anything. Null on a machine that has none.
const LAN = Object.values(networkInterfaces()).flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? null;

const MUTATIONS = {
  // The pose goes back onto the camera without passing the registry, which is how it shipped: the `params` half of one socket patch is normalised and the `view`
  // half was not. Must redden the refusal row and leave the row under it green - a build that dropped `view` altogether would redden that one and be a different defect.
  'pose-skips-the-registry': {
    file: 'web/main.js',
    edits: [[
      "    try {\n"
      + "      view = params.normalise('camera', patch.view);\n"
      + "    } catch (err) {\n"
      + "      console.error(`[program-out] ${err.message}`);\n"
      + "      return;\n"
      + "    }\n",
      '    view = patch.view;\n',
    ]],
  },

  // The parameter half of the patch goes back to landing one name at a time with a catch per entry, so a patch from a mismatched build applies its good half and
  // draws the new mode against a stale value. Must redden the half-right-patch row alone, because a wholly valid patch lands identically either way.
  'patch-params-applied-one-at-a-time': {
    file: 'web/main.js',
    edits: [[
      '  if (patch.params) {\n'
      + '    try {\n'
      + '      params.apply(patch.params);\n'
      + '    } catch (err) {\n'
      + '      console.error(`[program-out] ${err.message}`);\n'
      + '      return;\n'
      + '    }\n'
      + '  }\n',
      '  if (patch.params) {\n'
      + '    for (const [name, value] of Object.entries(patch.params)) {\n'
      + '      try {\n'
      + '        params.set(name, value);\n'
      + '      } catch (err) {\n'
      + '        console.error(`[program-out] ${err.message}`);\n'
      + '      }\n'
      + '    }\n'
      + '  }\n',
    ]],
  },

  // The endpoint serves the registered colour scaled up to 1080p instead of the colour camera's own frame - the plausible wrong implementation. Placed at the
  // offer rather than at the socket, so the grabber, the negotiation and the take are untouched and sections 1, 3 and 4 keep passing.
  'hd-upscales-registered': {
    file: 'server/index.js',
    edits: [[
      'webcam.offer(Buffer.from(msg.payload.subarray(8)), Number(msg.payload.readBigUInt64LE(0)));',
      'webcam.offer(upscaledRegistered ?? Buffer.from(msg.payload.subarray(8)), Number(msg.payload.readBigUInt64LE(0)));',
    ], [
      '    recorder.write(msg.raw);\n  } else if (msg.type === TYPE_COLOR) {',
      '    try {\n'
      + '      const db = msg.payload.readUInt32LE(0);\n'
      + '      const cb = msg.payload.readUInt32LE(4);\n'
      + '      if (cb) {\n'
      + '        upscaledRegistered = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", "pipe:0",\n'
      + '          "-vf", "scale=1920:1080", "-frames:v", "1", "-q:v", "3", "-f", "mjpeg", "pipe:1"],\n'
      + '          { input: msg.payload.subarray(16 + db, 16 + db + cb), maxBuffer: 64 * 1024 * 1024 });\n'
      + '      }\n'
      + '    } catch { /* the mutation is best-effort */ }\n'
      + '    recorder.write(msg.raw);\n  } else if (msg.type === TYPE_COLOR) {',
    ], [
      "import { Webcam } from './webcam.js';",
      "import { Webcam } from './webcam.js';\nimport { execFileSync } from 'node:child_process';\nlet upscaledRegistered = null;",
    ]],
  },

  // The margins say the picture is the colour camera's; nothing said the bytes were. This decodes the colour payload and re-encodes it at the same size, so every
  // geometric row above still passes and only the bytes differ. Memoised, because a synchronous 1920x1080 re-encode per message starves the stream until a
  // different row reddens - and with ffmpeg missing the memo holds the original bytes, the mutation becomes a no-op and the run says NOT CAUGHT, loudly.
  'hd-reencodes-in-flight': {
    file: 'server/index.js',
    edits: [[
      'webcam.offer(Buffer.from(msg.payload.subarray(8)), Number(msg.payload.readBigUInt64LE(0)));',
      'webcam.offer(reencodedColour(Buffer.from(msg.payload.subarray(8))), Number(msg.payload.readBigUInt64LE(0)));',
    ], [
      "import { Webcam } from './webcam.js';",
      "import { Webcam } from './webcam.js';\nimport { execFileSync } from 'node:child_process';\n"
      + 'let reencodedOnce = null;\n'
      + 'function reencodedColour(jpeg) {\n'
      + '  if (reencodedOnce) return reencodedOnce;\n'
      + '  try {\n'
      + '    reencodedOnce = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", "pipe:0",\n'
      + '      "-frames:v", "1", "-q:v", "2", "-f", "mjpeg", "pipe:1"],\n'
      + '      { input: jpeg, maxBuffer: 64 * 1024 * 1024 });\n'
      + '  } catch { reencodedOnce = jpeg; }\n'
      + '  return reencodedOnce;\n'
      + '}',
    ]],
  },

  // The colour message reaches the recorder, so a take carries a third message type - which moves its content hash, the key the library joins two machines on.
  // This is the `nearClip` versus `--min-depth` failure class: it changes the footage in the one situation where nobody is watching for it.
  'hd-reaches-recorder': {
    file: 'server/index.js',
    edits: [[
      'webcam.offer(Buffer.from(msg.payload.subarray(8)), Number(msg.payload.readBigUInt64LE(0)));',
      'webcam.offer(Buffer.from(msg.payload.subarray(8)), Number(msg.payload.readBigUInt64LE(0)));\n'
      + '    recorder.write(msg.raw);',
    ]],
  },

  // The refusal keeps its monitors clause and loses its webcam one, so a take starts while somebody pulls ~50Mbit/s of MJPEG over the same radio the depth packets
  // compete for. Section 1's `a loopback subscriber does not refuse the take` is a row this mutation makes more true, which is why it could never stand in for this one.
  'refusal-ignores-webcam': {
    file: 'server/index.js',
    edits: [[
      "\n    ...webcam.subscribersCostingTheTake()\n"
      + "      .map(() => ({ kind: 'webcam', at: 'the colour camera at full rate' })),",
      '',
    ]],
  },
};

if (MUTATE && !MUTATIONS[MUTATE]) {
  console.error(`unknown mutation ${MUTATE} - have ${Object.keys(MUTATIONS).join(', ')}`);
  process.exit(2);
}
if (!existsSync(SOURCE)) {
  console.error(`no capture at ${SOURCE} - this check needs one to loop; see tools/make-fixture.js`);
  process.exit(2);
}

// A mutation applied in place and restored afterwards leaves a mutated working tree behind any crash, which is the one state a proof tool must never produce.
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
// `effects-builtin` is in this list because the effect store refuses to boot without its shipped root, so a staged tree without it is a server this tool can never
// start. It is copied rather than symlinked, so a mutation naming a chunk under it could not reach the repo's own source.
for (const dir of ['server', 'tools', 'web', 'effects-builtin']) {
  cpSync(join(REPO, dir), join(WORK, dir), { recursive: true });
}
for (const name of ['node_modules', 'vendor', 'captures']) {
  const from = join(REPO, name);
  if (existsSync(from)) symlinkSync(from, join(WORK, name));
}
mkdirSync(join(WORK, 'takes'), { recursive: true });
if (MUTATE) {
  const spec = MUTATIONS[MUTATE];
  const path = join(WORK, spec.file);
  let source = readFileSync(path, 'utf8');
  for (const [from, to] of spec.edits) {
    const hits = source.split(from).length - 1;
    if (hits !== 1) {
      console.error(`mutation ${MUTATE} matched ${hits} times in ${spec.file}, expected exactly 1 - refusing to run an unmutated server`);
      process.exit(2);
    }
    source = source.replace(from, to);
  }
  writeFileSync(path, source);
}

let checked = 0, failed = 0;
// Claims this machine could not be asked, each carrying its own remedy. A list rather than one string because two different absences reach here, and the verdict line used to append playwright's advice to whatever it was given.
const untested = [];
let crashed = null;
const ok = (label, pass, detail = '') => {
  checked++;
  if (!pass) failed++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, ms, what = 'condition') => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cond()) return true;
    await wait(50);
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what}`);
};
const servers = [];
const EMIT_LOG = join(WORK, 'emitted.log');

/**
 * Bring a server up and wait until there is a sensor behind it. The wait is on the resource rather than on a constant: `viewer on` prints inside
 * `httpServer.listen`'s callback, before `startLive` has spawned the grabber, and this grabber reads a 138MB capture and runs a 1080p encode first - 3.8 to 4.7
 * seconds on a loaded machine. `webcam.available` is the right predicate because `unavailable` asks whether there is a colour camera to serve and never whether
 * a frame has arrived, and it is readable without subscribing, which section 1's first row needs. A timeout throws and exits 2 as DID NOT RUN, because under
 * `--mutate` a harness that never got a sensor would otherwise be written down as the mutation being caught.
 */
const start = async (extra = []) => {
  const log = await new Promise((resolve, reject) => {
    const grabber = `${join(WORK, 'tools/fake-grabber.mjs')} --source ${SOURCE} --fps 30 --hd `
      + `--emit-log ${EMIT_LOG}`;
    const child = spawn(process.execPath, [
      join(WORK, 'server/index.js'), '--port', String(PORT),
      '--captures', join(WORK, 'takes'), '--grabber', grabber, ...extra,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    servers.push(child);
    const lines = [];
    const onData = (c) => {
      lines.push(c.toString());
      if (lines.join('').includes('viewer on')) resolve(() => lines.join(''));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    setTimeout(() => reject(new Error(`server never came up:\n${lines.join('')}`)), 15000);
  });
  await waitFor(async () => (await api('/record/state')).body?.webcam?.available === true,
    25000, 'the grabber to handshake and offer a colour camera');
  return log;
};
const stopAll = async () => {
  for (const c of servers) c.kill('SIGKILL');
  servers.length = 0;
  await wait(200);
};

const api = async (path, init) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = (path, body = {}) => api(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * An MJPEG subscriber that keeps the parts it was sent. Parsed off the boundary rather than by scanning for JPEG markers, because the thing being checked
 * includes the framing: a part whose declared length disagrees with its body is a stream OBS would resynchronise through and this would not notice.
 */
function subscribe(host = '127.0.0.1') {
  const state = { parts: [], done: false, controller: new AbortController() };
  state.ready = fetch(`http://${host}:${PORT}/camera.mjpg`, { signal: state.controller.signal })
    .then(async (res) => {
      state.status = res.status;
      if (res.status !== 200) { state.done = true; return state; }
      let buf = Buffer.alloc(0);
      (async () => {
        try {
          for await (const chunk of res.body) {
            buf = Buffer.concat([buf, Buffer.from(chunk)]);
            for (;;) {
              const head = buf.indexOf('--braindanceframe\r\n');
              if (head === -1) break;
              const blank = buf.indexOf('\r\n\r\n', head);
              if (blank === -1) break;
              const headers = buf.subarray(head, blank).toString('latin1');
              const m = /Content-Length: (\d+)/.exec(headers);
              if (!m) break;
              const len = Number(m[1]);
              const bodyAt = blank + 4;
              if (buf.length < bodyAt + len) break;
              state.parts.push(Buffer.from(buf.subarray(bodyAt, bodyAt + len)));
              buf = buf.subarray(bodyAt + len);
            }
          }
        } catch { /* aborted */ }
        state.done = true;
      })();
      return state;
    });
  state.stop = () => state.controller.abort();
  return state;
}

/**
 * What the writer says it emitted, as `type -> [{ hash, body }]`. `hash` is the whole payload; `body` is the part body a reader downstream receives, or null
 * where the two are the same thing. A colour payload is the u64 stamp then the JPEG, the stamp moves per frame, and the JPEG is the only part that reaches a subscriber.
 */
function emitted() {
  if (!existsSync(EMIT_LOG)) return new Map();
  const out = new Map();
  for (const line of readFileSync(EMIT_LOG, 'utf8').split('\n')) {
    if (!line) continue;
    const [type, , hash, body] = line.split(' ');
    const key = Number(type);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ hash, body: body && body !== '-' ? body : null });
  }
  return out;
}

/** The mean RGB of a region, through ffmpeg, so nothing here decodes a JPEG by hand. */
function meanRgb(jpeg, crop) {
  const raw = execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-vf', `crop=${crop},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { input: jpeg, maxBuffer: 16 * 1024 * 1024 });
  return [raw[0], raw[1], raw[2]];
}
const near = (got, want) => got.every((v, i) => Math.abs(v - want[i]) <= COLOUR_TOLERANCE);
const dims = (jpeg) => execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', 'pipe:0',
], { input: jpeg, maxBuffer: 16 * 1024 * 1024 }).toString().trim().split(',').map(Number);

console.log(`\n[vcam] ${MUTATE ? `mutation ${MUTATE}` : 'unmutated'}, port ${PORT}\n`);

try {
  console.log('1. the colour stream is asked for and stops again');
  {
    await start();
    await wait(1500);
    const before = emitted().get(TYPE_COLOR)?.length ?? 0;
    ok('no colour message is emitted while nothing is subscribed', before === 0,
      `${before} emitted`);

    const sub = subscribe();
    await sub.ready;
    await wait(1500);
    const during = emitted().get(TYPE_COLOR)?.length ?? 0;
    ok('subscribing starts it', during > 10, `${during} emitted`);
    ok('and the subscriber is actually being served parts', sub.parts.length > 10,
      `${sub.parts.length} parts`);

    // The take must be able to see it, which is the positive twin of the refusal: a check built only out of refusals passes against a server that refuses everything.
    const state = await api('/record/state');
    ok('the webcam is in the recorder\'s own accounting', Array.isArray(state.body?.webcam?.subscribers)
      && state.body.webcam.subscribers.length === 1,
    JSON.stringify(state.body?.webcam?.subscribers));
    // Loopback here, so it must NOT be refused - the exemption is what lets every proof tool in this repo drive the server over localhost.
    ok('a loopback subscriber does not refuse the take', state.body?.monitors?.wouldRefuse === false);

    sub.stop();
    // Past the linger, which exists because OBS retries a dead source hard.
    await wait(7500);
    const atStop = emitted().get(TYPE_COLOR)?.length ?? 0;
    await wait(1500);
    const after = emitted().get(TYPE_COLOR)?.length ?? 0;
    ok('leaving stops it again', after === atStop, `${atStop} -> ${after}`);
    await stopAll();
  }

  console.log('\n2. what is served is the colour camera and not the registered image');
  {
    rmSync(EMIT_LOG, { force: true });
    await start();
    const sub = subscribe();
    await sub.ready;
    await wait(2000);
    ok('the endpoint answered 200', sub.status === 200, `status ${sub.status}`);

    const frame = sub.parts.at(-1);
    if (!frame) {
      ok('a frame was served at all', false, 'no parts arrived');
    } else {
      const [w, h] = dims(frame);
      ok('it is the colour camera\'s native resolution', w === 1920 && h === 1080, `${w}x${h}`);

      // The discriminator: an upscale of the registered image is 1920x1080 too, and it cannot be magenta and cyan down the sides.
      const left = meanRgb(frame, `${MARGIN}:1080:0:0`);
      const right = meanRgb(frame, `${MARGIN}:1080:${1920 - MARGIN}:0`);
      ok('the left margin carries what the registered frustum cannot see',
        near(left, [255, 0, 255]), `rgb(${left})`);
      ok('and so does the right', near(right, [0, 255, 255]), `rgb(${right})`);
      // The middle has to be the room rather than more marker, or the two rows above would pass against a page that was simply magenta and cyan all over.
      const middle = meanRgb(frame, '400:400:760:340');
      ok('and the middle is the scene rather than more marker',
        !near(middle, [255, 0, 255]) && !near(middle, [0, 255, 255]), `rgb(${middle})`);

      // Passthrough, against the writer's own log rather than against the other served parts. The version this replaced hashed a part off `sub.parts` and asked
      // whether anything in `sub.parts` hashed to it, so it reduced to "a part arrived" and `--mutate hd-reencodes-in-flight` sailed through the whole section.
      const emittedBodies = new Set((emitted().get(TYPE_COLOR) ?? []).map((e) => e.body).filter(Boolean));
      const strangers = sub.parts.filter((p) => !emittedBodies.has(createHash('sha256').update(p).digest('hex')));
      ok('every served part is the same JPEG the writer emitted',
        emittedBodies.size > 0 && strangers.length === 0,
        `${strangers.length} of ${sub.parts.length} served parts are not in the emit log, `
        + `which logged ${emittedBodies.size} distinct colour bodies`);
      // Every part is byte-identical to every other, because the fixture emits one frame. On a sensor this row would not hold and is not the claim.
      const distinct = new Set(sub.parts.map((p) => createHash('sha256').update(p).digest('hex')));
      ok('and nothing re-encoded it on the way through', distinct.size === 1,
        `${distinct.size} distinct payloads across ${sub.parts.length} parts`);
    }
    sub.stop();
    await stopAll();
  }

  console.log('\n3. the take never learns the webcam exists');
  {
    rmSync(EMIT_LOG, { force: true });
    rmSync(join(WORK, 'takes'), { recursive: true, force: true });
    mkdirSync(join(WORK, 'takes'), { recursive: true });
    await start();
    const sub = subscribe();
    await sub.ready;
    await wait(800);

    const started = await post('/record/start');
    ok('a take starts with the webcam attached', started.status === 200, JSON.stringify(started.body));
    await wait(2500);
    const stopped = await post('/record/stop');
    ok('and stops', stopped.status === 200);
    sub.stop();
    await wait(400);

    const dir = join(WORK, 'takes');
    const file = execFileSync('sh', ['-c', `ls ${dir}/*.knct 2>/dev/null | head -1`]).toString().trim();
    if (!file) {
      ok('the take was written', false, `nothing in ${dir}`);
    } else {
      const parser = new MessageParser();
      const types = new Map();
      const frameHashes = [];
      for (const msg of parser.push(readFileSync(file))) {
        types.set(msg.type, (types.get(msg.type) ?? 0) + 1);
        if (msg.type === TYPE_FRAME) frameHashes.push(createHash('sha256').update(msg.payload).digest('hex'));
      }
      ok('the take carries a hello and frames', (types.get(TYPE_HELLO) ?? 0) === 1 && frameHashes.length > 10,
        `hello ${types.get(TYPE_HELLO) ?? 0}, frames ${frameHashes.length}`);
      // **The row the mutation has to trip.**
      ok('and carries no colour message at all', !types.has(TYPE_COLOR),
        `${types.get(TYPE_COLOR) ?? 0} colour messages in the take`);
      ok('and nothing but those two types', [...types.keys()].every((t) => t === TYPE_HELLO || t === TYPE_FRAME),
        `types ${[...types.keys()].join(', ')}`);

      // The payload hash here, not the body one: a type 2 frame goes into the file whole, so the payload is what a reader gets and the log's fourth column is a `-` for it.
      const emittedFrames = new Set((emitted().get(TYPE_FRAME) ?? []).map((e) => e.hash));
      const foreign = frameHashes.filter((h) => !emittedFrames.has(h));
      ok('and every frame in it is byte for byte one the writer emitted', foreign.length === 0,
        `${foreign.length} of ${frameHashes.length} frames are not in the emit log`);
    }
    await stopAll();
  }

  console.log('\n4. the origin rule reaches every route serving live sensor bytes');
  {
    await start();
    const table = await api('/library/routes');
    const live = (table.body?.routes ?? []).filter((r) => r.live);
    ok('the table declares at least one live route', live.length > 0,
      live.map((r) => r.path).join(', '));

    // Walked rather than named: an arm that asked about `/camera.mjpg` would test `/camera.mjpg`, and one that walks the table tests the rule.
    for (const route of live) {
      const foreign = await fetch(`http://127.0.0.1:${PORT}${route.path}`, {
        headers: { Origin: 'http://evil.example' },
      });
      ok(`${route.path} refuses a foreign origin`, foreign.status === 403, `status ${foreign.status}`);
      foreign.body?.cancel?.();

      const same = await fetch(`http://127.0.0.1:${PORT}${route.path}`, {
        headers: { Origin: `http://127.0.0.1:${PORT}` },
      });
      ok(`${route.path} allows its own origin`, same.status === 200, `status ${same.status}`);
      same.body?.cancel?.();
    }

    // The webcam says why rather than serving nothing, which is the difference between a setting somebody fixes and a bug somebody files.
    await post('/record/stop').catch(() => {});
    await stopAll();
  }

  console.log('\n5. the program-out page renders at its own size with no furniture');
  if (NO_BROWSER) {
    console.log('  (skipped: --no-browser)');
  } else {
    let chromium = null;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      try {
        const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
        ({ chromium } = await import(`file://${join(root, 'playwright/index.mjs')}`));
      } catch { /* reported below */ }
    }
    if (!chromium) {
      untested.push('playwright is not installed, so what the source actually draws was never asked'
        + ' - install playwright, or pass --no-browser and mean it');
    } else {
      await start();
      const browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader'],
      });
      // Deliberately not 1920x1080: the claim is that the output size comes from the setting rather than from the window, and a window that happened to match would pass whether or not anything worked.
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await page.goto(`http://127.0.0.1:${PORT}/program`);
      await page.waitForTimeout(4000);

      const seen = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        return {
          body: document.body.className,
          panel: getComputedStyle(document.getElementById('panel')).display,
          buffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
          readout: document.getElementById('programOutReadout')?.textContent ?? '',
          orbit: globalThis.__kinect?.controls?.enabled,
        };
      });

      ok('the page knows it is a source', seen.body.includes('program-out'), seen.body);
      ok('the buffer is the output size and not the window', seen.buffer?.[0] === 1920 && seen.buffer?.[1] === 1080,
        `${seen.buffer?.join('x')} in a 900x600 window`);
      ok('the panel is not in the shot', seen.panel === 'none', seen.panel);
      ok('and orbit cannot fight the pose being pushed to it', seen.orbit === false, String(seen.orbit));
      ok('the readout reports a delivered rate', /(\d+\.\d) fps/.test(seen.readout), seen.readout);
      const fps = Number(/([\d.]+) fps/.exec(seen.readout)?.[1] ?? 0);
      ok('and the source really is drawing', fps > 5, `${fps} fps`);
      ok('with no error on the page', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

      // The operator's two controls, driven from the operator's page - the only place they can be checked, because what they change is a different document.
      const operator = await browser.newPage({ viewport: { width: 900, height: 600 } });
      await operator.goto(`http://127.0.0.1:${PORT}/record`);
      await operator.waitForTimeout(2500);

      // Deliberately not a size anything defaults to, so a buffer that merely stayed put cannot be read as having followed.
      await operator.fill('#progSize', '1280x720');
      await operator.dispatchEvent('#progSize', 'change');
      await operator.selectOption('#progMode', 'mirror');
      await page.waitForTimeout(2500);

      const after = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        return {
          buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          readout: document.getElementById('programOutReadout')?.textContent ?? '',
        };
      });
      ok('setting the size on the operator page resizes the source\'s buffer',
        after.buffer[0] === 1280 && after.buffer[1] === 720, after.buffer.join('x'));
      ok('and switching to mirror reaches the source', after.readout.includes('mirror'),
        after.readout);

      // A parameter write goes through the registry's one write hook rather than a list of forwarded fields, so this row asks whether a parameter added later would arrive without anybody wiring it.
      await operator.evaluate('__kinect.params.set("pointSize", 4.2)');
      await page.waitForTimeout(1200);
      const forwarded = await page.evaluate('__kinect.params.get("pointSize")');
      ok('and a parameter write reaches it through the registry', forwarded === 4.2, String(forwarded));

      // A patch that is half right applies as nothing at all. The old foot walked `patch.params` through `params.set` one name at a time with a catch per entry,
      // so a refused name left the source drawing the new mode against a stale value. Driven at the source's own handler with a name no registry holds.
      const bloomHeld = await page.evaluate('__kinect.params.get("bloom")');
      await page.evaluate(`__kinect.applyProgramOut({ params: {
        bloom: ${JSON.stringify(bloomHeld === 0.25 ? 0.75 : 0.25)}, "a-parameter-no-build-has": 1,
      } })`);
      await page.waitForTimeout(300);
      const bloomAfterBad = await page.evaluate('__kinect.params.get("bloom")');
      ok('a patch carrying one refused parameter applies none of them, so the source never draws half of a frame nobody sent',
        bloomAfterBad === bloomHeld, `bloom ${bloomAfterBad}, held at ${bloomHeld}`);
      // The positive twin: refused and ignored have to be told apart, or this gate is indistinguishable from the params half of the patch being dropped.
      const bloomTarget = bloomHeld === 0.25 ? 0.75 : 0.25;
      await page.evaluate(`__kinect.applyProgramOut({ params: { bloom: ${JSON.stringify(bloomTarget)} } })`);
      await page.waitForTimeout(300);
      const bloomAfterGood = await page.evaluate('__kinect.params.get("bloom")');
      ok('  while a patch that is whole still lands through the registry',
        bloomAfterGood === bloomTarget, `bloom ${bloomAfterGood}, sent ${bloomTarget}`);
      await page.evaluate(`__kinect.applyProgramOut({ params: { bloom: ${JSON.stringify(bloomHeld)} } })`);

      // `params` goes through the registry's write path and is normalised, clamped and refused there; `view` was written straight onto the camera the output frame
      // is drawn with, and four finite numbers are not a rotation. Driven at the source's own handler rather than through the operator's camera: a camera object
      // holds a rotation and `controls.update()` renormalises whatever is written onto it, so the first version of this row read length 1.000000 on both builds.
      const poseBefore = await page.evaluate('__kinect.freeCamera.quaternion.toArray()');
      await page.evaluate(`__kinect.applyProgramOut({ view: {
        position: [9, 9, 9], quaternion: [0, 0, 0, 5], fov: 60,
      } })`);
      await page.waitForTimeout(300);
      const poseAfter = await page.evaluate(`(() => ({
        q: __kinect.freeCamera.quaternion.toArray(),
        p: __kinect.freeCamera.position.toArray(),
      }))()`);
      const len = Math.hypot(...poseAfter.q);
      ok('a pose that is not a rotation is refused at the source rather than drawn with',
        Math.abs(len - 1) < 1e-3 && Math.abs(poseAfter.p[0] - 9) > 1e-6,
        `quaternion length ${len.toFixed(6)} (was ${Math.hypot(...poseBefore).toFixed(6)}), position ${poseAfter.p.map((v) => v.toFixed(2)).join(', ')}`);
      // The positive twin: a build that ignored `view` entirely would pass the row above while breaking the whole mirror mode.
      await page.evaluate(`__kinect.applyProgramOut({ view: {
        position: [1.5, 0.25, 2.5], quaternion: [0, 0, 0, 1], fov: 60,
      } })`);
      await page.waitForTimeout(300);
      const moved = await page.evaluate('__kinect.freeCamera.position.toArray()');
      ok('while a pose that is one still reaches it, so the refusal is a gate rather than the mirror switched off',
        Math.abs(moved[0] - 1.5) < 1e-3 && Math.abs(moved[2] - 2.5) < 1e-3, moved.map((v) => v.toFixed(3)).join(', '));

      await browser.close();
      await stopAll();
    }
  }

  // Every other tool in this repo subscribes over `127.0.0.1` to a server started with no `--host`, so `Webcam.isLoopback` was true by construction and the rule
  // picking out costing subscribers ran against an empty set in every run of every check. This arm makes the object: `--host 0.0.0.0` and a subscriber arriving on
  // this machine's own LAN address. The control plane stays on loopback, because whether a remote caller may press record is section 4's question.
  console.log('\n6. a webcam subscriber that is not on loopback is charged to the take');
  if (!LAN) {
    untested.push('this machine has no non-internal IPv4, so there is no second address a webcam '
      + 'subscriber could arrive on and the refusal had nothing to refuse - run it on a machine '
      + 'with a LAN address');
    console.log('  (skipped: no non-internal IPv4 on this machine)');
  } else {
    await start(['--host', '0.0.0.0']);
    const remote = subscribe(LAN);
    await remote.ready;
    ok('a subscriber on this machine\'s LAN address is served', remote.status === 200, `status ${remote.status} on ${LAN}`);
    await waitFor(async () => ((await api('/record/state')).body?.webcam?.subscribers ?? []).length === 1,
      8000, 'the remote subscriber to appear in the recorder\'s accounting');

    const state = (await api('/record/state')).body;
    ok('and the recorder sees it as crossing the network rather than as loopback',
      state?.webcam?.subscribers?.every((s) => s.loopback === false) === true,
      JSON.stringify(state?.webcam?.subscribers));
    ok('so the take would be refused, with the webcam named as the reason',
      state?.monitors?.wouldRefuse === true
      && (state?.monitors?.costingTheTake ?? []).some((c) => c.kind === 'webcam'),
      JSON.stringify(state?.monitors?.costingTheTake));

    const refused = await post('/record/start');
    // Asserted on the consumer the refusal names, not on the word "webcam": the sentence ends with "detach the webcam" whatever it refused for, so a row reading /webcam/ would pass with the clause deleted.
    ok('and pressing record really is refused, saying which consumer it was',
      refused.status === 409 && String(refused.body?.error ?? '').includes('webcam at the colour camera at full rate'),
      `status ${refused.status}: ${String(refused.body?.error ?? '').slice(0, 90)}`);

    // Stopped unconditionally, because a run where the refusal did not fire has a take open and the positive twin below would then be refused for already recording.
    await post('/record/stop').catch(() => {});

    // The positive twin, and it is not optional: an arm built only out of refusals passes against a server that refuses everything.
    const forced = await post('/record/start', { acceptMonitorCost: true });
    ok('while an operator who accepts the cost can still start the take',
      forced.status === 200, `status ${forced.status}: ${JSON.stringify(forced.body).slice(0, 90)}`);
    await post('/record/stop').catch(() => {});

    remote.stop();
    await stopAll();
  }
} catch (err) {
  // A run that threw did not finish, and that is a different answer from a claim that failed. Under `--mutate` a harness timeout would otherwise be recorded as the mutation being caught.
  crashed = err;
  console.log(`\n  FAIL  the run did not finish: ${err.message}`);
} finally {
  await stopAll();
  rmSync(WORK, { recursive: true, force: true });
}

console.log(`\n[vcam] ${checked} assertions, ${failed} failed`
  + (NO_BROWSER ? ' - the renderer section was skipped, so what the source draws is untested here' : ''));
if (crashed) {
  console.log(`[vcam] DID NOT RUN - ${crashed.message}. Nothing here is a finding: re-run it.`);
  process.exit(2);
}
if (untested.length) {
  for (const reason of untested) console.log(`[vcam] UNPROVEN - ${reason}.`);
  process.exit(2);
}
if (MUTATE) {
  // Exit code alone cannot tell "the mutation was caught" from "the tool crashed before asserting anything", so the count is what the verdict is made of.
  if (failed === 0) { console.log('[vcam] NOT CAUGHT - the check passed a server it should have rejected'); process.exit(1); }
  console.log(`[vcam] caught, as required (${failed} assertion${failed === 1 ? '' : 's'} fired)`);
  process.exit(1);
}
if (failed) { console.log('[vcam] FAIL'); process.exit(1); }
console.log('[vcam] PASS');
process.exit(0);
