#!/usr/bin/env node
// Step 8's proof: the queue only hands a job to a machine that can reproduce it, and a job
// carries enough to be reproduced at all. Every refusal here has a positive twin, because a
// queue that refused every claim would satisfy "a mismatched worker is turned away" perfectly -
// and a refusal is asserted by what it said, naming the blocked job and the class it wants,
// rather than by an absence an empty queue would also produce.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_VERSION } from '../web/format.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, dflt = null) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
const has = (name) => argv.includes(name);
const PORT = Number(flag('--port', '8231'));
const PROXY_PORT = Number(flag('--proxy-port', String(PORT + 1)));
const MUTATE = flag('--mutate');
const WORK = join(REPO, '.jobs-check');
const SAMPLE = flag('--source', join(REPO, 'captures', 'sample.knct'));
// Not skipped by default: a queue whose jobs never turn into a file proves nothing.
const SKIP_RENDER = has('--no-render');

const METAL = 'ANGLE Metal / Apple M2 Max';
const V3D = 'ANGLE (Broadcom, V3D 7.1.10.2, OpenGL ES 3.1)';

// Each names source text and must match exactly once, aimed one property at a time.
const MUTATIONS = {
  'claim-ignores-renderer': { file: 'server/jobs.js', edits: [[
    'export const rendererMatches = (want, have) => want === null || want === undefined || want === have;',
    'export const rendererMatches = () => true;',
  ]] },
  'claim-hides-blocked': { file: 'server/jobs.js', edits: [[
    '        const blocked = all.map((j) => ({ id: j.id, wants: j.renderer }));\n        return { job: null, blocked, queued: all.length };',
    '        return { job: null, blocked: [], queued: 0 };',
  ]] },
  'enqueue-accepts-any-capture': { file: 'server/jobs.js', edits: [[
    "    if (typeof capture !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(capture)) {",
    '    if (false) {',
  ]] },
  'finish-accepts-any-state': { file: 'server/jobs.js', edits: [[
    "      if (isTerminal(job.state)) {\n        throw new Error(`job ${id} is already ${job.state}, so this report is from a worker that lost a race`);\n      }\n      if (job.state !== 'running') {",
    '      if (false) {',
  ], [
    "      if (typeof job.lease !== 'string' || job.lease === '') {",
    '      if (false) {',
  ]] },
  'transitions-not-serialised': { file: 'server/jobs.js', edits: [[
    '    this.serialise = (fn) => {\n      const run = this.gate.then(fn, fn);\n      this.gate = run.then(() => {}, () => {});\n      return run;\n    };',
    '    this.serialise = (fn) => Promise.resolve().then(fn);',
  ]] },
  'jobs-serve-lease': { file: 'server/index.js', edits: [[
    'const withoutLease = ({ lease, ...job }) => job;',
    'const withoutLease = (job) => job;',
  ]] },
  'lease-optional-when-absent': { file: 'server/jobs.js', edits: [[
    "      if (typeof job.lease !== 'string' || job.lease === '') {",
    '      if (false) {',
  ]] },
  'finish-ignores-lease': { file: 'server/jobs.js', edits: [[
    '      if (lease !== job.lease) {',
    '      if (false) {',
  ]] },
  'requeue-refuses-all-running': { file: 'server/jobs.js', edits: [[
    '        const quietFor = this.now() - (job.heartbeat ?? job.claimed ?? 0);\n        if (quietFor < this.staleMs) {',
    '        const quietFor = 0;\n        if (true) {',
  ]] },
  'heartbeat-ignores-lease': { file: 'server/jobs.js', edits: [[
    "      if (typeof job.lease !== 'string' || lease !== job.lease) {\n        throw new Error(`job ${id} is held by another claim, so this is not the one rendering it`);\n      }",
    '      if (false) { throw new Error(\'unreachable\'); }',
  ]] },
  'static-serves-nothing': { file: 'server/index.js', edits: [[
    '    const stat = statSync(resolved);',
    "    const stat = statSync(resolved); throw new Error('serving nothing');",
  ]] },
  'requeue-clears-renderer': { file: 'server/jobs.js', edits: [[
    "      job.state = 'queued';\n      job.claimed = null;",
    "      job.state = 'queued';\n      job.renderer = null;\n      job.claimed = null;",
  ]] },
  'codec-read-through-prototype': { file: 'server/export.js', edits: [[
    '  const spec = Object.hasOwn(CODECS, codec) ? CODECS[codec] : null;\n  if (!spec) throw new Error(`unknown codec ${codec}`);',
    '  const spec = CODECS[codec];\n  if (!CODECS[codec]) throw new Error(`unknown codec ${codec}`);',
  ]] },
  'worker-door-waved-open': { file: 'tools/render-worker.mjs', edits: [[
    "    return (job.requires ?? []).filter((e) => !installed.has(e.id) && !allowed.has(e.id));",
    '    return [];',
  ]] },
  'envelope-takes-the-callers-requires': { file: 'server/jobs.js', edits: [
    [
      "codec = 'h264', suppressEffects = [] }) {",
      "codec = 'h264', suppressEffects = [], requires: asked = null }) {",
    ],
    [
      '    const requires = used.map((id) => ({ ...carried.find((e) => e?.id === id) }));',
      '    const requires = asked ?? used.map((id) => ({ ...carried.find((e) => e?.id === id) }));',
    ],
  ] },
  'envelope-trusts-the-documents-requires': { file: 'server/jobs.js', edits: [
    [
      '    if (unlisted.length || unclaimed.length) {',
      '    if (false) {',
    ],
    [
      '    const requires = used.map((id) => ({ ...carried.find((e) => e?.id === id) }));',
      '    const requires = Array.isArray(project.requires) ? project.requires.map((e) => ({ ...e })) : [];',
    ],
  ] },
  'envelope-takes-a-repeated-requires-id': { file: 'server/jobs.js', edits: [[
    '    if (duplicated.length) {',
    '    if (false) {',
  ]] },
  'queue-takes-any-requires-shape': { file: 'server/jobs.js', edits: [
    [
      '    if (project.requires !== undefined) {\n'
      + "      const listShape = requiresListRefusal('a job\\'s project', project.requires);\n"
      + '      if (listShape) throw new Error(listShape);\n'
      + '      for (const entry of project.requires) {\n'
      + "        const bad = requiresEntryRefusal('a job\\'s project', entry);\n"
      + '        if (bad) throw new Error(bad);\n'
      + '      }\n'
      + '    }\n',
      '',
    ],
    [
      '    const carried = project.requires ?? [];',
      '    const carried = Array.isArray(project.requires) ? project.requires : [];',
    ],
  ] },
  'preflight-snapshot-is-taken-once': { file: 'tools/render-worker.mjs', edits: [[
    '  const readInstalledEffects = async () => {\n',
    '  let snapshotOnce = null;\n'
    + '  const readInstalledEffects = async () => {\n'
    + '    if (!snapshotOnce) snapshotOnce = await readEffectsNow();\n'
    + '    return snapshotOnce;\n'
    + '  };\n'
    + '  const readEffectsNow = async () => {\n',
  ]] },
  'preflight-asks-once': { file: 'tools/render-worker.mjs', edits: [[
    '  const EFFECT_READ_TRIES = 4;', '  const EFFECT_READ_TRIES = 1;',
  ]] },
  'preflight-reads-a-failure-as-an-empty-store': { file: 'tools/render-worker.mjs', edits: [[
    '        const res = await fetch(`${URL_}/effects`, { signal: AbortSignal.timeout(5000) });\n'
    + '        if (!res.ok) throw new Error(`it answered ${res.status}`);\n'
    + '        const body = await res.json();\n'
    + '        if (!body || !Array.isArray(body.effects)) {\n'
    + "          throw new Error('it answered a body that is not a list of installed packages');\n"
    + '        }\n'
    + '        for (const e of body.effects) {\n'
    + '          if (!e || typeof e.id !== \'string\') throw new Error(`it listed the entry ${JSON.stringify(e)}, which names no id`);\n'
    + '        }\n'
    + '        return {\n'
    + '          installed: new Set(body.effects.map((e) => e.id)),\n'
    + '          versions: new Map(body.effects.map((e) => [e.id, e.version])),\n'
    + '        };',
    '        const listing = (await (await fetch(`${URL_}/effects`)).json()).effects ?? [];\n'
    + '        return {\n'
    + '          installed: new Set(listing.map((e) => e.id)),\n'
    + '          versions: new Map(listing.map((e) => [e.id, e.version])),\n'
    + '        };',
  ]] },
  'heartbeat-stops-on-first-error': { file: 'tools/render-worker.mjs', edits: [[
    '      const beatOnce = () => { heartbeat().catch((err) => missedBeat(err.message)); };',
    '      const beatOnce = () => { heartbeat().catch((err) => { stopBeating(); console.error(`[worker] ${job.id} heartbeat: ${err.message}`); }); };',
  ]] },
};
if (MUTATE && !MUTATIONS[MUTATE]) {
  console.error(`unknown mutation ${MUTATE} - have ${Object.keys(MUTATIONS).join(', ')}`);
  process.exit(2);
}

let assertions = 0;
let failures = 0;
let crashed = null;
// Kept as well as counted: a mutation is caught only if the rows that reddened are its own.
const fired = [];
const check = (ok, label, detail = '') => {
  assertions++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) { failures++; fired.push(label.trim()); }
  return ok;
};
const section = (title) => console.log(`\n[jobs] ${title}`);

// Staged as a copy, never an edit-and-restore, so a crash cannot leave a mutated tree behind.
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const root = join(WORK, 'root');
mkdirSync(root, { recursive: true });
cpSync(join(REPO, 'server'), join(root, 'server'), { recursive: true });
cpSync(join(REPO, 'web'), join(root, 'web'), { recursive: true });
// `effects-builtin` is staged because the store declines the absence of its shipped root, so a
// tree without it is a server this check can never start. Copied rather than symlinked.
cpSync(join(REPO, 'effects-builtin'), join(root, 'effects-builtin'), { recursive: true });
// The worker is staged too, and the render row spawns the staged copy: spawned from the repo
// path, a mutation naming `tools/render-worker.mjs` would edit a file nothing runs.
mkdirSync(join(root, 'tools'), { recursive: true });
cpSync(join(REPO, 'tools/render-worker.mjs'), join(root, 'tools/render-worker.mjs'));
for (const name of ['node_modules', 'vendor']) {
  const from = join(REPO, name);
  if (existsSync(from)) symlinkSync(from, join(root, name));
}
if (MUTATE) {
  const spec = MUTATIONS[MUTATE];
  const path = join(root, spec.file);
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

const caps = join(WORK, 'captures');
const jobsDir = join(WORK, 'jobs');
const deliverablesDir = join(WORK, 'deliverables');
const exportsDir = join(root, 'exports');
mkdirSync(caps, { recursive: true });
mkdirSync(deliverablesDir, { recursive: true });
if (!existsSync(SAMPLE)) {
  console.error(`no capture at ${SAMPLE} - this check needs one take to render`);
  process.exit(2);
}
symlinkSync(SAMPLE, join(caps, 'sample.knct'));

const servers = [];
const proxies = [];
const startServer = async () => {
  const child = spawn(process.execPath, [join(root, 'server/index.js'),
    '--port', String(PORT), '--captures', caps, '--jobs', jobsDir,
    // No `--replay`: a replaying server pushes frames at the page continuously, and a repaint
    // landing inside the export's first seek made `ExportTransport` count it one run in four.
    '--projects', join(WORK, 'projects'), '--presets', join(WORK, 'presets'),
    '--deliverables', deliverablesDir],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  const log = [];
  child.stdout.on('data', (c) => log.push(c.toString()));
  child.stderr.on('data', (c) => log.push(c.toString()));
  for (let i = 0; i < 200; i++) {
    await new Promise((done) => { setTimeout(done, 100); });
    try {
      const r = await fetch(`${URL_}/library/takes`);
      if (r.ok) return () => log.join('');
    } catch { /* not up yet */ }
  }
  throw new Error(`server never came up:\n${log.join('')}`);
};
const URL_ = `http://localhost:${PORT}`;
const stopServers = () => { for (const c of servers) c.kill('SIGKILL'); servers.length = 0; };

const post = async (path, body, headers = {}) => {
  const res = await fetch(URL_ + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = async (path) => (await fetch(URL_ + path)).json();

const HASH_A = `sha256:${'a'.repeat(64)}`;
// A document `restoreProject` accepts field for field, with all five readings spelled out
// because the loader refuses a project that names fewer than five.
const PROJECT = {
  version: PROJECT_VERSION,
  look: {
    params: {
      readRgb: 1, readDepth: 0, readGhost: 0, readContour: 0, readBlackwall: 0,
    },
    tracks: {},
  },
  composition: {
    retime: { rate: 1, keys: [] },
    camera: [],
  },
  // 16:9 throughout, since `restoreProject` refuses a shape `EXPORT_SIZES` has no resolution
  // for and `exportClip` skips its own check whenever a width and height are supplied.
  outputSize: '1280x720',
  appliedPreset: null,
};
// The same project under an effect nothing here ships, which stages a document from a machine
// carrying something this one lacks. Loadable rather than broken, because the worker's door is
// about a job it cannot draw whole.
const PARKED_PROJECT = {
  ...PROJECT,
  requires: [{ id: 'sparkle', version: '1.0.0' }],
  look: {
    params: {
      ...PROJECT.look.params,
      'sparkle.amount': 0.6,
      'sparkle.size': 3.25,
      'sparkle.hue': 210,
      'sparkle.jitter': 0.125,
    },
    tracks: {
      'sparkle.amount': [
        { t: 0, value: 0, easeOut: [[0.42, 0]], easeIn: [[0.58, 1]] },
        { t: 2, value: 0.9, easeOut: [[0.42, 0]], easeIn: [[0.58, 1]] },
      ],
      'sparkle.hue': [{ t: 0.5, value: 10, easeOut: [[0.1, 0.2]], easeIn: [[0.3, 0.4]] }],
    },
  },
};

// The same project over an effect this build does ship, at a version it does not. Every one of
// rain's four parameters is named, because a document naming a subset is one the loader refuses.
const SKEW_PROJECT = {
  ...PROJECT,
  requires: [{ id: 'rain', version: '9.9.9' }],
  look: {
    params: {
      ...PROJECT.look.params,
      'rain.amount': 0.4,
      'rain.speed': 0.55,
      'rain.span': 1.3,
      'rain.trail': 0.45,
    },
    tracks: {},
  },
};

// Version 2 and no `outputFps`: the rate moved onto the project, so a deliverable naming one is
// a version 1 document and `applyDeliverable` refuses it.
const DELIVERABLE = {
  version: 2,
  in: 0,
  out: null,
  outputSize: '1280x720',
  codec: 'h264',
};
// Unique per call. As the constant `check` every later enqueue got a 400 for a name another
// live job had reserved, and a refusal arriving for a neighbouring reason reads like this one.
let outputSeq = 0;
const enqueue = (over = {}) => post('/jobs', {
  project: PROJECT, deliverable: DELIVERABLE, capture: HASH_A, output: `check${++outputSeq}`, width: 640, height: 360, fps: 30, ...over,
});
const refusedBecause = (res, needle) => res.status === 400 && String(res.body.error ?? '').includes(needle);

/**
 * A forwarding proxy that interferes with one kind of request and carries everything else
 * verbatim: `interfere(req, res, state)` handles a request and answers true, or leaves it alone
 * and answers false. It carries the whole render because the worker has one `--url`, and headers
 * go across verbatim - `Host` included, since `originAllowed` compares it against the `Origin`.
 */
async function startInterferingProxy(listenPort, targetPort, interfere) {
  const state = { dropped: 0, failed: 0, served: 0 };
  const target = { host: '127.0.0.1', port: targetPort };
  const proxy = createServer((req, res) => {
    if (interfere(req, res, state)) return;
    const up = request({ ...target, path: req.url, method: req.method, headers: req.headers }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    });
    up.on('error', () => res.destroy());
    req.pipe(up);
  });
  proxy.on('upgrade', (req, socket, head) => {
    const up = connect(target, () => {
      // Rebuilt from `rawHeaders` rather than the parsed map, so a header that arrived twice
      // still does: the origin guard counts duplicate `Host` headers and refuses on them.
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      // Whatever the client sent past the header block; without it the export's `begin` is lost.
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  await new Promise((done, fail) => {
    proxy.once('error', fail);
    proxy.listen(listenPort, '127.0.0.1', done);
  });
  return {
    state,
    url: `http://localhost:${listenPort}`,
    close: () => new Promise((done) => {
      proxy.closeAllConnections?.();
      proxy.close(() => done());
    }),
  };
}

/** The first heartbeat dropped on the floor with no answer at all. */
const dropsOneHeartbeat = (req, res, state) => {
  if (state.dropped > 0 || req.method !== 'POST' || !/^\/jobs\/[^/]+\/heartbeat$/.test(req.url ?? '')) return false;
  state.dropped++;
  req.socket.destroy();
  return true;
};

/**
 * The worker's own `/effects` reads answered badly, and the browser's left alone. `Referer` is
 * what tells the two apart, since the page the worker opens polls `/effects` through this same
 * proxy. `answer` is what a caught read gets, and `times` is how many are caught.
 */
const failsWorkerEffectReads = ({ times = 1, answer = null } = {}) => (req, res, state) => {
  if (req.method !== 'GET' || !/^\/effects\/?$/.test(req.url ?? '')) return false;
  if (req.headers.referer !== undefined) return false;
  state.served++;
  if (state.failed >= times) return false;
  state.failed++;
  res.writeHead(answer === null ? 500 : 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(answer ?? { error: 'the store could not be read' }));
  return true;
};

try {
  const serverLog = await startServer();

  section('a job is self-contained, or it is not a job');
  const good = await enqueue();
  check(good.status === 200 && good.body.state === 'queued', 'a job with a project body and a content-hashed capture is accepted',
    `${good.status} ${good.body.id ?? good.body.error}`);
  check(good.body.renderer === null, 'and it starts unpinned, because the first job has no class to reproduce yet');
  const byId = await enqueue({ capture: 'sample' });
  check(refusedBecause(byId, 'content hash'),
    'a capture named by take id is refused - an id is a filename and two machines can hold different footage under one',
    `${byId.status} ${(byId.body.error ?? '').slice(0, 60)}`);
  const envelope = await enqueue({ project: { name: 'p', rev: 'sha256:x', body: PROJECT } });
  check(refusedBecause(envelope, 'envelope'),
    'and so is the store envelope in place of the document body, rather than being unwrapped on a guess',
    `${envelope.status} ${(envelope.body.error ?? '').slice(0, 50)}`);
  const badNames = ['../../server/index', '/tmp/absolute', '', 'a b', '.hidden'];
  const refusedNames = [];
  for (const output of badNames) {
    const r = await enqueue({ output });
    if (refusedBecause(r, 'bad output name')) refusedNames.push(output);
  }
  check(refusedNames.length === badNames.length,
    'an output that is not a plain file name is refused at enqueue, not three layers later by the thing that writes the file',
    `${refusedNames.length} of ${badNames.length} refused`);
  // A key off `Object.prototype` is not a codec and truthiness could not tell, so a job took the
  // enqueue and died a minute later inside `begin`.
  const inherited = [];
  // Every job this block leaves behind, because under this row's control the four below are
  // admitted and four stray jobs would redden the precondition, renderer and race rows too.
  const strays = [];
  for (const codec of ['toString', 'constructor', 'valueOf', '__proto__']) {
    const r = await enqueue({ codec });
    if (refusedBecause(r, 'unknown codec')) inherited.push(codec);
    else if (typeof r.body.id === 'string') strays.push(r.body.id);
  }
  check(inherited.length === 4,
    'a codec named off Object.prototype is refused with the same "unknown codec" a typo gets, rather than admitted and discovered by the export socket a minute later',
    `${inherited.length} of 4 refused: ${inherited.join(' ')}`);
  const goodCodec = await enqueue({ codec: 'h264' });
  const oddH264 = await enqueue({ codec: 'h264', width: 641, height: 360 });
  check(goodCodec.status === 200 && refusedBecause(oddH264, 'even dimensions'),
    'while h264 is still accepted, and still refuses an odd dimension - the rule travels with the entry now, not with the name',
    `${goodCodec.status}, then ${oddH264.status} ${(oddH264.body.error ?? '').slice(0, 40)}`);
  const lossless = await enqueue({ codec: 'lossless', width: 641, height: 360 });
  check(lossless.status === 200,
    'and lossless takes the odd dimension it has no reason to refuse, so that rule is a property of the codec rather than of every export',
    `${lossless.status} ${(lossless.body.error ?? '').slice(0, 40)}`);
  // The effects a job's look is built from, derived from the document rather than taken from
  // the caller, so a worker can answer "can this machine draw this" before it opens a page.
  const withParked = await enqueue({ project: PARKED_PROJECT, output: 'check-parked-envelope' });
  check(withParked.status === 200
    && JSON.stringify(withParked.body.requires) === JSON.stringify(PARKED_PROJECT.requires),
  'a job\'s envelope carries the effects its project requires, entry for entry',
  `${withParked.status} ${JSON.stringify(withParked.body.requires ?? withParked.body.error)}`);
  const lying = await enqueue({
    project: PARKED_PROJECT, output: 'check-parked-lying', requires: [{ id: 'nothing', version: '9.9.9' }],
  });
  check(lying.status === 200
    && JSON.stringify(lying.body.requires) === JSON.stringify(PARKED_PROJECT.requires),
  'and it is derived from the document rather than accepted from the caller, so a job cannot lie about what it needs',
  `asked for nothing 9.9.9, recorded ${JSON.stringify(lying.body.requires ?? lying.body.error)}`);
  const understated = await enqueue({
    project: { ...PARKED_PROJECT, requires: [] },
    output: 'check-parked-understated',
  });
  check(refusedBecause(understated, 'sparkle'),
    'a project whose values name an effect its own requires list does not claim is refused at the queue, by name',
    `${understated.status} ${(understated.body.error ?? JSON.stringify(understated.body.requires)).slice(0, 120)}`);
  const overstated = await enqueue({
    project: { ...PARKED_PROJECT, requires: [...PARKED_PROJECT.requires, { id: 'nothing', version: '9.9.9' }] },
    output: 'check-parked-overstated',
  });
  check(refusedBecause(overstated, 'nothing'),
    'and one whose list claims an effect no value is named under is refused the same way',
    `${overstated.status} ${(overstated.body.error ?? JSON.stringify(overstated.body.requires)).slice(0, 120)}`);
  // One id twice, which neither disagreement row can see: the envelope keeps whichever entry
  // came first and drops the other.
  const repeated = await enqueue({
    project: {
      ...PARKED_PROJECT,
      requires: [{ id: 'sparkle', version: '1.0.0' }, { id: 'sparkle', version: '2.0.0' }],
    },
    output: 'check-parked-repeated',
  });
  check(refusedBecause(repeated, 'sparkle')
    && /more than once/.test(repeated.body.error ?? ''),
  'a project claiming one effect twice in its requires list is refused at the queue, naming the id',
  `${repeated.status} ${(repeated.body.error ?? JSON.stringify(repeated.body.requires)).slice(0, 130)}`);
  const carriedWhole = await enqueue({
    project: { ...PARKED_PROJECT, requires: [{ id: 'sparkle', version: '2.5.0', rev: 'abc123' }] },
    output: 'check-parked-pinned',
  });
  check(carriedWhole.status === 200
    && JSON.stringify(carriedWhole.body.requires) === JSON.stringify([{ id: 'sparkle', version: '2.5.0', rev: 'abc123' }]),
  'and where the two agree the document\'s own entry is carried whole, version and rev included, because neither is derivable here',
  `${carriedWhole.status} ${JSON.stringify(carriedWhole.body.requires ?? carriedWhole.body.error)}`);
  // The rule is the loader's own, `requiresEntryRefusal` in `web/format.js`, so these rows hold
  // that the queue asks it rather than that a second copy of it agrees.
  const misshapenRequires = [
    ['a requires that is not a list at all', { id: 'sparkle', version: '1.0.0' }, 'requires belong'],
    ['an entry that is not an object', ['sparkle'], 'requires entry'],
    ['an entry with nothing in it', [{}], 'not an effect id'],
    ['an id that could never name a package', [{ id: 'Sparkle!', version: '1.0.0' }], 'not an effect id'],
    ['an entry carrying no version', [{ id: 'sparkle' }], 'a version is a non-empty string'],
    ['a rev that is not a string', [{ id: 'sparkle', version: '1.0.0', rev: 7 }], 'a rev is a non-empty string'],
    ['a stray key beside the two that belong', [{ id: 'sparkle', version: '1.0.0', extra: 'why' }], 'has no place there'],
  ];
  const misshapenIds = [];
  for (const [what, requires, needle] of misshapenRequires) {
    const res = await enqueue({
      project: { ...PARKED_PROJECT, requires },
      output: `check-requires-${misshapenIds.length}`,
    });
    if (typeof res.body.id === 'string') misshapenIds.push(res.body.id);
    check(refusedBecause(res, needle),
      `  a job's project carrying ${what} is refused at the queue, naming that rule`,
      `${res.status} ${(res.body.error ?? JSON.stringify(res.body.requires)).slice(0, 110)}`);
  }
  const wellShaped = await enqueue({
    project: { ...PARKED_PROJECT, requires: [{ id: 'sparkle', version: '1.0.0', rev: 'sha256:beef' }] },
    output: 'check-requires-ok',
  });
  check(wellShaped.status === 200
    && JSON.stringify(wellShaped.body.requires) === JSON.stringify([{ id: 'sparkle', version: '1.0.0', rev: 'sha256:beef' }]),
  '  while an entry carrying every field the rule allows is taken whole, so the shape rules refuse a shape rather than a list',
  `${wellShaped.status} ${JSON.stringify(wellShaped.body.requires ?? wellShaped.body.error)}`);

  const badSuppress = await enqueue({ project: PARKED_PROJECT, output: 'check-parked-bad', suppressEffects: ['Sparkle!'] });
  const goodSuppress = await enqueue({ project: PARKED_PROJECT, output: 'check-parked-good', suppressEffects: ['sparkle'] });
  check(refusedBecause(badSuppress, 'suppressEffects')
    && goodSuppress.status === 200
    && JSON.stringify(goodSuppress.body.suppressEffects) === '["sparkle"]',
  'a suppression is a list of effect ids, refused when it is not one and carried when it is',
  `${badSuppress.status} ${(badSuppress.body.error ?? '').slice(0, 60)}; then ${goodSuppress.status} `
  + `${JSON.stringify(goodSuppress.body.suppressEffects ?? goodSuppress.body.error)}`);

  // Everything this block queued goes back off, because the section below asserts exactly one
  // job is queued. Unlinked rather than removed through a route, since no route deletes a job.
  for (const id of [...strays, ...misshapenIds, goodCodec.body.id, lossless.body.id,
    withParked.body.id, lying.body.id, understated.body.id, overstated.body.id,
    repeated.body.id, carriedWhole.body.id, wellShaped.body.id, goodSuppress.body.id]) {
    if (typeof id === 'string') rmSync(join(jobsDir, `${id}.json`), { force: true });
  }

  section('the queue hands a job only to a machine that can reproduce it');
  // A precondition, because the section below reasons about what is left in the queue: without
  // it a mutation two sections up reads as the renderer pinning being broken.
  const beforePin = (await get('/jobs')).jobs;
  check(beforePin.length === 1 && beforePin[0].id === good.body.id,
    'exactly one job survived the refusals above, so what follows is about the renderer class and not about a stray job',
    `${beforePin.length}: ${beforePin.map((j) => j.output).join(', ')}`);
  const pinned = await enqueue({ output: 'pinned', renderer: V3D });
  check(pinned.status === 200 && pinned.body.renderer === V3D, 'a job can be pinned to a renderer class at enqueue');
  const c1 = await post('/jobs/claim', { worker: 'mac', renderer: METAL });
  check(c1.status === 200 && c1.body.job?.id === good.body.id,
    'a Metal worker is given the unpinned job, which is the positive half of every refusal below',
    c1.body.job?.id ?? JSON.stringify(c1.body).slice(0, 70));
  check(c1.body.job?.renderer === METAL && c1.body.job?.state === 'running',
    'and the claim stamps the class it will render on, which is the provenance the field exists for');
  check(c1.body.job?.attempts === 1, 'attempts moves on the claim, so a job retried forever is visible as a number rather than a mood');

  const c2 = await post('/jobs/claim', { worker: 'mac', renderer: METAL });
  check(c2.status === 409 && c2.body.job === null,
    'with only a V3D job left, a Metal worker is refused rather than handed it',
    `${c2.status}`);
  check((c2.body.blocked ?? []).some((b) => b.id === pinned.body.id && b.wants === V3D),
    'and the refusal NAMES the job and the class it wants - an empty queue and a queue full of somebody else\'s work are different answers',
    JSON.stringify(c2.body.blocked ?? []).slice(0, 80));
  const c3 = await post('/jobs/claim', { worker: 'pi', renderer: V3D });
  check(c3.status === 200 && c3.body.job?.id === pinned.body.id,
    'a V3D worker gets it, so the refusal above was about the class and not about the job being unclaimable');

  section('two jobs cannot be aimed at one file');
  const first = await enqueue({ output: 'contested' });
  const second = await enqueue({ output: 'contested' });
  check(first.status === 200 && refusedBecause(second, 'already reserved'),
    'a second live job cannot reserve an output the first one is still going to write',
    `${first.status} then ${second.status} ${(second.body.error ?? '').slice(0, 40)}`);
  const firstClaim = (await post('/jobs/claim', { worker: 'tidy', renderer: METAL })).body.job;
  await post(`/jobs/${firstClaim.id}/finish`, { state: 'failed', error: 'tidying', lease: firstClaim.lease });
  const reuse = await enqueue({ output: 'contested' });
  check(reuse.status === 200,
    'and the name frees up once nothing live holds it, because re-exporting over a file you already have is the ordinary case',
    `${reuse.status}`);
  const reuseClaim = (await post('/jobs/claim', { worker: 'tidy', renderer: METAL })).body.job;
  await post(`/jobs/${reuseClaim.id}/finish`, { state: 'failed', error: 'tidying', lease: reuseClaim.lease });

  section('the transitions are atomic, which a sequential drive cannot see');
  // A check that never issues two requests at once cannot tell an atomic transition from one
  // that merely works when nobody is looking.
  const raceJobs = [];
  for (let i = 0; i < 4; i++) raceJobs.push((await enqueue({ output: `race${i}` })).body);
  const claims = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    post('/jobs/claim', { worker: `racer${i}`, renderer: METAL })));
  const handed = claims.filter((c) => c.body.job).map((c) => c.body.job.id);
  check(handed.length === new Set(handed).size,
    'eight workers claiming at once never receive the same job twice - a list-then-write hands one job to two machines',
    `${handed.length} handed, ${new Set(handed).size} distinct`);
  check(handed.length === raceJobs.length,
    'and all four queued jobs were handed out rather than lost to the same race', `${handed.length} of ${raceJobs.length}`);

  const victim = claims.find((c) => c.body.job).body.job;
  const reports = await Promise.all([
    post(`/jobs/${victim.id}/finish`, { state: 'done', output: 'winner', lease: victim.lease }),
    post(`/jobs/${victim.id}/finish`, { state: 'failed', error: 'loser', lease: victim.lease }),
  ]);
  const accepted = reports.filter((r) => r.status === 200);
  check(accepted.length === 1,
    'two outcome reports fired together, and exactly one is taken - read-check-write lets the second overwrite the first',
    `${accepted.length} accepted of 2`);

  section('an outcome comes from the claim that is running it');
  const unclaimed = (await enqueue({ output: 'never-rendered' })).body;
  const forged = await post(`/jobs/${unclaimed.id}/finish`, { state: 'done', output: 'never-rendered' });
  check(forged.status === 409,
    'a queued job cannot be marked done by anyone who knows its id - nothing has rendered it, so there is no outcome to report',
    `${forged.status}`);
  check((await get(`/jobs/${unclaimed.id}`)).state === 'queued', 'and it is still queued afterwards');
  const held = (await post('/jobs/claim', { worker: 'holder', renderer: METAL })).body.job;
  const noLease = await post(`/jobs/${held.id}/finish`, { state: 'done' });
  check(noLease.status === 409, 'and a report with no lease is refused while a claim holds it', `${noLease.status}`);
  // A capability that is published is not a capability: with the lease in what the read routes
  // return, anyone could GET the job and forge the outcome.
  const readBack = await get(`/jobs/${held.id}`);
  const listed = (await get('/jobs')).jobs.find((j) => j.id === held.id);
  check(!('lease' in readBack) && !('lease' in (listed ?? {})),
    'and the lease is not in what the read routes serve, or copying it out of a GET is all forging one takes',
    `GET ${'lease' in readBack ? 'leaks' : 'clean'}, list ${'lease' in (listed ?? {}) ? 'leaks' : 'clean'}`);
  check(readBack.state === 'running' && readBack.id === held.id,
    'while the rest of the record is still served, so that row is about the lease and not about the route being empty');

  // A record the queue could not have written, written by hand: a claim always leaves a lease,
  // so the guard against a leaseless running record is otherwise unreachable.
  const plantedId = `job-${'ab'.repeat(8)}`;
  writeFileSync(join(jobsDir, `${plantedId}.json`), `${JSON.stringify({
    id: plantedId, version: 1, project: PROJECT, capture: HASH_A, renderer: METAL,
    output: 'planted', width: 64, height: 36, fps: 30, codec: 'h264',
    state: 'running', created: 1, claimed: 2, finished: null, worker: 'ghost',
    error: null, attempts: 1, lease: null,
  }, null, 2)}\n`);
  const ghost = await post(`/jobs/${plantedId}/finish`, { state: 'done', output: 'planted' });
  check(ghost.status === 409,
    'a running record carrying no lease cannot be finished by anybody - that is a record no claim could have written, so it is unusable rather than open',
    `${ghost.status} ${(ghost.body.error ?? '').slice(0, 60)}`);
  const rightLease = await post(`/jobs/${held.id}/finish`, { state: 'done', lease: held.lease });
  check(rightLease.status === 200, 'while the claim that holds the lease is taken, which is the positive half of that');

  section('a finished job is finished');
  const fin = await post(`/jobs/${good.body.id}/finish`, { state: 'done', output: 'check', lease: c1.body.job.lease });
  check(fin.status === 200 && fin.body.state === 'done', 'a worker reports an outcome and the record takes it');
  const again = await post(`/jobs/${good.body.id}/finish`, { state: 'failed', error: 'the loser of a race', lease: c1.body.job.lease });
  check(again.status === 409, 'a second report on the same job is refused, so two workers racing cannot leave the last one to speak as the record',
    `${again.status}`);
  check((await get(`/jobs/${good.body.id}`)).state === 'done', 'and the record still says what the first one said');

  section('a retry is a retry, not a different render');
  const running = (await post('/jobs/claim', { worker: 'still-going', renderer: METAL })).body.job;
  if (running) {
    const rqLive = await post(`/jobs/${running.id}/requeue`, {});
    check(rqLive.status === 404 || rqLive.status === 409,
      'a job that is still rendering cannot be requeued, or a second worker joins the first on the same edit',
      `${rqLive.status}`);
    await post(`/jobs/${running.id}/finish`, { state: 'failed', error: 'tidying the fixture', lease: running.lease });
  }
  // The deadlock the running-refusal created: a killed worker's job was refused by `requeue` and
  // stayed out of `claim`. What expires is the silence, because a render may run for hours.
  const deadId = `job-${'cd'.repeat(8)}`;
  writeFileSync(join(jobsDir, `${deadId}.json`), `${JSON.stringify({
    id: deadId, version: 1, project: PROJECT, capture: HASH_A, renderer: METAL,
    output: 'orphan', width: 64, height: 36, fps: 30, codec: 'h264',
    state: 'running', created: 1, claimed: 1, heartbeat: 1, finished: null,
    worker: 'killed-mid-render', error: null, attempts: 1, lease: 'lease-that-died-with-it',
  }, null, 2)}\n`);
  const rescued = await post(`/jobs/${deadId}/requeue`, {});
  check(rescued.status === 200 && rescued.body.state === 'queued',
    'a job whose worker died and stopped saying anything can be put back on the queue, or nothing could ever reach it again',
    `${rescued.status} ${rescued.body.state ?? (rescued.body.error ?? '').slice(0, 60)}`);
  check(rescued.body.lease === null && rescued.body.heartbeat === null,
    'and the dead claim\'s lease goes with it, so the worker that vanished cannot report on it if it comes back');
  const liveClaim = (await post('/jobs/claim', { worker: 'alive', renderer: METAL })).body.job;
  const beat = await post(`/jobs/${liveClaim.id}/heartbeat`, { lease: liveClaim.lease });
  check(beat.status === 200, 'a live worker can say it is still there', `${beat.status}`);
  check(!('lease' in beat.body), 'and the heartbeat does not hand the lease back out either');
  const forgedBeat = await post(`/jobs/${liveClaim.id}/heartbeat`, { lease: 'not-the-lease' });
  check(forgedBeat.status === 409, 'while anybody else keeping a dead job looking alive is refused - that would be the deadlock from the other side',
    `${forgedBeat.status}`);
  const stillRunning = await post(`/jobs/${liveClaim.id}/requeue`, {});
  check(stillRunning.status === 404 || stillRunning.status === 409,
    'and a job that just spoke is still refused, so the exception is about silence and not about running',
    `${stillRunning.status}`);
  await post(`/jobs/${liveClaim.id}/finish`, { state: 'failed', error: 'tidying', lease: liveClaim.lease });

  const rq = await post(`/jobs/${good.body.id}/requeue`, {});
  check(rq.status === 200 && rq.body.state === 'queued', 'a done job can go back on the queue');
  check(rq.body.renderer === METAL,
    'and it stays pinned to the class it was rendered on - a retry that could land anywhere is a second render of the same edit, not a retry',
    String(rq.body.renderer).slice(0, 40));
  const c4 = await post('/jobs/claim', { worker: 'pi', renderer: V3D });
  check(c4.status === 409, 'so the V3D worker cannot pick up the Metal retry', `${c4.status}`);

  section('the queue is behind the same guard every mutating route is');
  const noType = await fetch(`${URL_}/jobs`, { method: 'POST', body: '{}' });
  check(noType.status === 415, 'an enqueue without a JSON content type is refused', `${noType.status}`);
  const crossOrigin = await fetch(`${URL_}/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}',
  });
  check(crossOrigin.status === 403, 'and one from another page is refused before it is read', `${crossOrigin.status}`);
  const getClaim = await fetch(`${URL_}/jobs/claim`);
  check(getClaim.status === 405,
    'a GET of /jobs/claim is 405 and not 404 - the route exists, and reading it as a job id would say it does not',
    `${getClaim.status}`);

  section('the namespace the table owns is not answerable by the file tree');
  // A 404 from a route table winning and a 404 from a broken file server are the same three
  // digits, so the identical file under an undeclared namespace has to come back.
  for (const ns of ['jobs', 'not-a-declared-namespace']) {
    mkdirSync(join(root, 'web', ns, 'probe'), { recursive: true });
    writeFileSync(join(root, 'web', ns, 'probe', 'leak.js'), '// planted\n');
  }
  const servedElsewhere = await fetch(`${URL_}/not-a-declared-namespace/probe/leak.js`);
  check(servedElsewhere.status === 200,
    'a file under a namespace the table does not declare is served off disk, which is what makes the next row mean anything',
    `${servedElsewhere.status}`);
  const shadow = await fetch(`${URL_}/jobs/probe/leak.js`);
  check(shadow.status === 404,
    'and the identical file at web/jobs/ is the API\'s 404, because the owned namespaces come from the route table rather than a list',
    `${shadow.status}`);
  rmSync(join(root, 'web', 'jobs'), { recursive: true, force: true });

  if (!SKIP_RENDER) {
    section('and a job becomes a file, through the page\'s own export door');
    const { takes } = await get('/library/takes');
    const take = takes[0];
    if (!take) throw new Error('no take in the staged library to render');
    const real = await enqueue({ capture: take.hash, output: 'jobs-check-render', width: 320, height: 180 });
    check(real.status === 200, 'a job against real footage is queued', real.body.id ?? real.body.error);
    const worker = spawn(process.execPath, [join(root, 'tools/render-worker.mjs'),
      '--url', URL_, '--name', 'jobs-check', '--drain', '--max', '1'], { stdio: 'ignore' });
    const code = await new Promise((done) => worker.on('close', done));
    const record = await get(`/jobs/${real.body.id}`);
    check(code === 0 && record.state === 'done',
      'the worker claims it, renders it headless and reports done', `exit ${code}, state ${record.state}${record.error ? `, ${record.error.slice(0, 70)}` : ''}`);
    check(/ANGLE/.test(String(record.renderer)),
      'and the class on the record is the one the browser actually reported, not one the worker was told',
      String(record.renderer).slice(0, 46));

    // The door, asserted rather than assumed: a worker adopting with a bare
    // `setActiveDeliverable` would render every job here and nothing would say a gate had gone.
    const refusedJob = await enqueue({
      capture: take.hash,
      output: 'jobs-check-refused',
      width: 320,
      height: 180,
      deliverable: { ...DELIVERABLE, version: 1, outputFps: 30 },
    });
    check(refusedJob.status === 200,
      'a job carrying a deliverable this build cannot read is queued, because the queue is not where that is decided',
      refusedJob.body.id ?? refusedJob.body.error);
    const refuser = spawn(process.execPath, [join(root, 'tools/render-worker.mjs'),
      '--url', URL_, '--name', 'jobs-check-refuse', '--drain', '--max', '1'], { stdio: 'ignore' });
    await new Promise((done) => refuser.on('close', done));
    const refusedRecord = await get(`/jobs/${refusedJob.body.id}`);
    check(refusedRecord.state === 'failed',
      '  and the worker refuses it instead of rendering it, so the version gate reaches the path that runs unattended',
      `state ${refusedRecord.state}${refusedRecord.error ? `, ${refusedRecord.error.slice(0, 80)}` : ''}`);
    check(/version 1/.test(String(refusedRecord.error ?? '')),
      '  and the reason it carries is the version rather than something it failed at later',
      String(refusedRecord.error ?? 'no reason recorded').slice(0, 100));
    // The precondition first, because if `sparkle` is ever shipped both rows below stop being
    // about a missing effect while still passing.
    const packages = (await get('/effects')).effects ?? [];
    check(!packages.some((p) => p.id === 'sparkle'),
      'sparkle is not a package this build ships, which is what makes the two rows below about a missing effect',
      `${packages.length} installed: ${packages.map((p) => p.id).join(', ')}`);
    const missingJob = await enqueue({
      capture: take.hash, output: 'jobs-check-missing', width: 320, height: 180, project: PARKED_PROJECT,
    });
    check(missingJob.status === 200,
      'a job whose look names an effect this worker has not got is queued, because the queue is not where that is decided either',
      missingJob.body.id ?? missingJob.body.error);
    const doorman = spawn(process.execPath, [join(root, 'tools/render-worker.mjs'),
      '--url', URL_, '--name', 'jobs-check-missing', '--drain', '--max', '1'], { stdio: 'ignore' });
    await new Promise((done) => doorman.on('close', done));
    const missingRecord = await get(`/jobs/${missingJob.body.id}`);
    check(missingRecord.state === 'failed',
      '  and the worker refuses it rather than rendering a file with a layer of the look absent',
      `state ${missingRecord.state}${missingRecord.error ? `, ${missingRecord.error.slice(0, 80)}` : ''}`);
    // The reason is the assertion and not the outcome: `exportClip` refuses the same clip from
    // the other end, so a build with this door waved open still comes back `failed`.
    check(/sparkle 1\.0\.0/.test(String(missingRecord.error ?? ''))
      && /this worker has no/.test(String(missingRecord.error ?? '')),
    '  and the reason enumerates the effect and the version off the envelope, before any page was opened',
    String(missingRecord.error ?? 'no reason recorded').slice(0, 120));

    const allowedJob = await enqueue({
      capture: take.hash,
      output: 'jobs-check-suppressed',
      width: 320,
      height: 180,
      project: PARKED_PROJECT,
      deliverable: { ...DELIVERABLE, out: 0.5 },
      suppressEffects: ['sparkle'],
    });
    const allowed = spawn(process.execPath, [join(root, 'tools/render-worker.mjs'),
      '--url', URL_, '--name', 'jobs-check-suppressed', '--drain', '--max', '1'], { stdio: 'ignore' });
    await new Promise((done) => allowed.on('close', done));
    const allowedRecord = await get(`/jobs/${allowedJob.body.id}`);
    check(allowedRecord.state === 'done' && Number(allowedRecord.frames) > 0,
      '  while the same job carrying suppressEffects for it renders, so the door refuses a job rather than every job',
      `state ${allowedRecord.state}, ${allowedRecord.frames ?? 0} frames`
      + `${allowedRecord.error ? `, ${allowedRecord.error.slice(0, 70)}` : ''}`);

    let probed = '';
    try {
      probed = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,nb_frames',
        '-of', 'default=nw=1', record.artifactPath], { encoding: 'utf8' });
    } catch (err) { probed = `ffprobe failed: ${err.message}`; }
    check(/width=320/.test(probed) && /height=180/.test(probed),
      'the file it wrote is a video at the size the job asked for, which is the only thing a metadata check cannot fake',
      probed.trim().replace(/\n/g, ' '));
    // Compared against the count the worker reported and never against the take's frame count:
    // the sample was shot at about 9.3fps, so a 284-frame take exports to 911 frames at 30.
    const probedFrames = Number(probed.match(/nb_frames=(\d+)/)?.[1] ?? 0);
    check(probedFrames > 1 && probedFrames === record.frames,
      'and it holds every frame the export declared, not one frame at the right size',
      `${probedFrames} in the file, ${record.frames} declared, from a ${take.frames}-frame take`);

    section('a dropped connection does not silence a claim that is still rendering');
    // The whole render goes through the proxy, because a worker has one `--url`. A row here
    // failing about the export, the page or a closed target is the proxy, not the heartbeat.
    const proxy = await startInterferingProxy(PROXY_PORT, PORT, dropsOneHeartbeat);
    proxies.push(proxy);
    const beaten = await enqueue({ capture: take.hash, output: 'jobs-check-heartbeat', width: 320, height: 180 });
    const beatWorker = spawn(process.execPath, [join(root, 'tools/render-worker.mjs'),
      '--url', proxy.url, '--name', 'jobs-check-beat', '--drain', '--max', '1', '--beat', '1000'],
    { stdio: 'ignore' });
    const beatCode = await new Promise((done) => { beatWorker.on('close', done); });
    const beatRecord = await get(`/jobs/${beaten.body.id}`);
    check(proxy.state.dropped === 1,
      'the proxy dropped exactly one heartbeat on the floor, so what follows is about a worker that lost a connection rather than about one that never had a beat to lose',
      `${proxy.state.dropped} dropped`);
    check(beatCode === 0 && beatRecord.state === 'done',
      'the job still renders and still finishes done, which a worker that gave up on the first failure also does',
      `exit ${beatCode}, state ${beatRecord.state}${beatRecord.error ? `, ${beatRecord.error.slice(0, 70)}` : ''}`);
    // The discriminating row, and the one above deliberately is not: `claim` stamps `heartbeat`
    // equal to `claimed`, so strictly greater is a beat that landed after the drop.
    check(beatRecord.heartbeat > beatRecord.claimed,
      'and it went on saying so afterwards - a beat that stops for good on one dropped connection leaves a live render looking dead to the queue',
      `heartbeat ${beatRecord.heartbeat ?? 'null'} against claimed ${beatRecord.claimed ?? 'null'}`
      + `, ${((beatRecord.heartbeat ?? 0) - (beatRecord.claimed ?? 0)) / 1000}s apart`);
    await proxy.close();

    section('the store a worker answers from is read per job, not per worker');
    // A worker takes up to sixteen jobs and used to answer for all of them out of one reading of
    // `/effects`. Two jobs with the store moved between them is the only arrangement in which a
    // reading and a memory differ; neither renders, because the skew line comes first.
    for (const job of (await get('/jobs')).jobs ?? []) {
      if (job.state === 'queued') rmSync(join(jobsDir, `${job.id}.json`), { force: true });
    }
    const stillQueued = ((await get('/jobs')).jobs ?? []).filter((j) => j.state === 'queued');
    check(stillQueued.length === 0,
      'the queue holds nothing else claimable before this arm starts, so the worker below waits for its second job rather than being turned away from somebody else\'s',
      `${stillQueued.length} still queued${stillQueued.length ? `: ${stillQueued.map((j) => `${j.id} wants ${j.renderer}`).join(', ')}` : ''}`);
    const rainBefore = ((await get('/effects')).effects ?? []).find((e) => e.id === 'rain');
    check(rainBefore?.version === '1.0.0' && rainBefore?.builtin === true,
      'rain ships with this build at 1.0.0 and nothing is forking it, which is what the two readings below are read against',
      `rain ${rainBefore ? `${rainBefore.version}, builtin=${rainBefore.builtin}` : 'is not installed'}`);
    const skewA = await enqueue({ project: SKEW_PROJECT, capture: HASH_A, output: 'jobs-check-skew-a' });
    const preflight = spawn(process.execPath, [join(root, 'tools/render-worker.mjs'),
      '--url', URL_, '--name', 'jobs-check-preflight', '--max', '2', '--poll', '300'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    const preflightLog = [];
    preflight.stdout.on('data', (c) => preflightLog.push(c.toString()));
    preflight.stderr.on('data', (c) => preflightLog.push(c.toString()));
    const exited = new Promise((done) => { preflight.on('close', done); });
    const settledA = await (async () => {
      for (let waited = 0; waited < 180000; waited += 250) {
        const rec = await get(`/jobs/${skewA.body.id}`).catch(() => ({}));
        if (rec.state === 'done' || rec.state === 'failed') return rec;
        await new Promise((done) => { setTimeout(done, 250); });
      }
      return {};
    })();
    check(/no take on this worker hashes/.test(String(settledA.error ?? '')),
      '  the first job reaches the preflight and then fails at the take, so the line it printed is a preflight rather than a render',
      `state ${settledA.state ?? 'never settled'}${settledA.error ? `, ${settledA.error.slice(0, 70)}` : ''}`);
    // Every parameter is kept, so the install door takes the fork and the programs do not move.
    const rainPkg = await get('/effects/rain');
    const rainChunks = {};
    for (const c of rainPkg.manifest?.chunks ?? []) {
      if (rainChunks[c.file] === undefined) {
        rainChunks[c.file] = await (await fetch(`${URL_}/effects/rain/file/${encodeURIComponent(c.file)}`)).text();
      }
    }
    const forkRes = await fetch(`${URL_}/effects/rain`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: { ...rainPkg.manifest, version: '3.1.4' }, chunks: rainChunks }),
    });
    const forkBody = await forkRes.json().catch(() => ({}));
    check(forkRes.status === 200 && forkBody.manifest?.version === '3.1.4',
      '  and rain is forked to 3.1.4 while that worker is between claims, which is the only thing that moves between the two readings',
      `${forkRes.status} ${forkBody.error ?? `version ${forkBody.manifest?.version}`}`);
    const skewB = await enqueue({ project: SKEW_PROJECT, capture: HASH_A, output: 'jobs-check-skew-b' });
    // Cleared rather than left to fire, because a pending timer holds the event loop open.
    let preflightDeadline = null;
    const preflightCode = await Promise.race([
      exited,
      new Promise((done) => {
        preflightDeadline = setTimeout(() => { preflight.kill('SIGKILL'); done('timed out'); }, 180000);
      }),
    ]);
    clearTimeout(preflightDeadline);
    const printed = preflightLog.join('');
    check(new RegExp(`${skewA.body.id} renders with rain 1\\.0\\.0 where the job asks for 9\\.9\\.9`).test(printed),
      '  the first job is told which version it will draw on, off the store as it stood when that job was claimed',
      (printed.split('\n').find((l) => l.includes(`${skewA.body.id} renders with`)) ?? 'no skew line for the first job').slice(0, 130));
    // The discriminating row: a worker that read the store once is right about the first job by
    // construction and cannot be right about the second.
    check(new RegExp(`${skewB.body.id} renders with rain 3\\.1\\.4 where the job asks for 9\\.9\\.9`).test(printed),
      '  and the second job is told 3.1.4, so the preflight is a reading taken per job rather than a snapshot taken per worker',
      (printed.split('\n').find((l) => l.includes(`${skewB.body.id} renders with`)) ?? 'no skew line for the second job').slice(0, 130));
    check(preflightCode !== 'timed out',
      '  and the worker took both jobs and exited, so both readings above are its whole account of the run',
      `exit ${preflightCode}, ${printed.split('\n').filter((l) => l.includes('renders with')).length} skew lines printed`);

    section('a queue call that did not work is not a store with nothing in it');
    // Every way the preflight's question can fail used to read as "nothing is installed":
    // `.json()` parses a 500's error body and `?? []` takes a missing key as an empty listing.
    // Two fixtures, because a blip a retry clears and a 200 carrying an error body differ.
    for (const job of (await get('/jobs')).jobs ?? []) {
      if (job.state === 'queued') rmSync(join(jobsDir, `${job.id}.json`), { force: true });
    }
    const rainNow = ((await get('/effects')).effects ?? []).find((e) => e.id === 'rain');
    check(typeof rainNow?.version === 'string',
      'rain is installed on this worker at a version this arm reads off the store rather than assuming, since the arm above forks it',
      `rain ${rainNow ? `is at ${rainNow.version}` : 'is not installed'}`);
    const blipProxy = await startInterferingProxy(PROXY_PORT, PORT, failsWorkerEffectReads({ times: 1 }));
    proxies.push(blipProxy);
    const blipped = await enqueue({ project: SKEW_PROJECT, capture: HASH_A, output: 'jobs-check-effects-blip' });
    const blipWorker = spawn(process.execPath, [join(root, 'tools/render-worker.mjs'),
      '--url', blipProxy.url, '--name', 'jobs-check-effects-blip', '--drain', '--max', '1'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    const blipLog = [];
    blipWorker.stdout.on('data', (c) => blipLog.push(c.toString()));
    blipWorker.stderr.on('data', (c) => blipLog.push(c.toString()));
    await new Promise((done) => { blipWorker.on('close', done); });
    const blipRecord = await get(`/jobs/${blipped.body.id}`);
    const blipPrinted = blipLog.join('');
    const blipError = String(blipRecord.error ?? '');
    await blipProxy.close();
    check(blipProxy.state.failed === 1,
      'exactly one referer-less GET /effects was answered 500, so what follows is about the read the worker makes rather than about a tick of the page\'s poll',
      `${blipProxy.state.failed} answered 500 of ${blipProxy.state.served} referer-less reads seen`);
    check(/no take on this worker hashes/.test(blipError),
      'and the job still reaches the take resolution, so one failed read of the store does not fail a job the worker had already claimed',
      `state ${blipRecord.state ?? 'never settled'}${blipError ? `, ${blipError.slice(0, 90)}` : ''}`);
    // The discriminating row, about which sentence rather than which outcome: a build that
    // refused here would also come back `failed`, and a read that did not work is not a package
    // this worker has not got.
    check(!/this worker has no/.test(blipError) && !/this worker has no/.test(blipPrinted),
      'and it is never told the worker has no rain, which is the sentence a failed queue call used to come back as',
      blipError ? blipError.slice(0, 110) : 'no error recorded at all');
    check(new RegExp(`${blipped.body.id} renders with rain ${rainNow?.version?.replace(/\./g, '\\.')} where the job asks for 9\\.9\\.9`).test(blipPrinted),
      '  and the skew line quotes the version this machine holds, so the retry read a real listing rather than being waved through with an empty one',
      (blipPrinted.split('\n').find((l) => l.includes('renders with')) ?? 'no skew line printed at all').slice(0, 130));

    // The fixture a status check cannot see: a proxy reporting its own failure with a 200
    // answers `res.ok` true and parses.
    const outageProxy = await startInterferingProxy(PROXY_PORT, PORT,
      failsWorkerEffectReads({ times: 99, answer: { error: 'this proxy could not reach the store' } }));
    proxies.push(outageProxy);
    const outaged = await enqueue({ project: SKEW_PROJECT, capture: HASH_A, output: 'jobs-check-effects-outage' });
    const outageWorker = spawn(process.execPath, [join(root, 'tools/render-worker.mjs'),
      '--url', outageProxy.url, '--name', 'jobs-check-effects-outage', '--drain', '--max', '1'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    const outageLog = [];
    outageWorker.stdout.on('data', (c) => outageLog.push(c.toString()));
    outageWorker.stderr.on('data', (c) => outageLog.push(c.toString()));
    await new Promise((done) => { outageWorker.on('close', done); });
    const outageRecord = await get(`/jobs/${outaged.body.id}`);
    const outageError = String(outageRecord.error ?? '');
    await outageProxy.close();
    check(outageProxy.state.failed >= 2,
      'every referer-less GET /effects is answered 200 with a body that is not a listing, and the worker asked more than once',
      `${outageProxy.state.failed} answered that way`);
    check(/could not read/.test(outageError) && /\/effects/.test(outageError),
      'so the job fails naming the read it could not make, which is the one fact whoever reads the queue needs',
      `state ${outageRecord.state ?? 'never settled'}${outageError ? `, ${outageError.slice(0, 110)}` : ''}`);
    check(!/this worker has no/.test(outageError),
      '  and not as a worker missing a package, which is what a 200 carrying an error body used to be read as',
      outageError ? outageError.slice(0, 110) : 'no error recorded at all');
  } else {
    console.log('  ...   render row skipped by --no-render, so nothing here proves a job becomes a file');
  }

} catch (err) {
  crashed = err;
  console.log(`\n  FAIL  the run did not finish: ${err.message}`);
} finally {
  stopServers();
  for (const p of proxies) p.close();
  rmSync(WORK, { recursive: true, force: true });
  rmSync(exportsDir, { recursive: true, force: true });
}

console.log(`\n[jobs] ${assertions} assertions, ${failures} failed`);
/**
 * The count decides, and it decides before the crash does: a mutation here damages the queue the
 * rows below go on to drive, so putting the crash first would report `DID NOT RUN` over a caught
 * mutation. A mutated run with failures is caught however it ended, and says it ended early
 * because the count is a floor; with no failures, crashed means `DID NOT RUN`.
 */

if (MUTATE && failures > 0) {
  console.log(`[jobs] caught, as required (${failures} assertion${failures === 1 ? '' : 's'} fired)`);
  if (crashed) console.log(`[jobs] and the run ended early: ${crashed.message} - the count is a floor`);
  console.log(`[jobs] rows that fired: ${fired.join(' | ')}`);
  process.exit(1);
}
if (crashed) {
  console.log(`[jobs] DID NOT RUN - ${crashed.message}. Nothing here is a finding: re-run it.`);
  process.exit(2);
}
if (MUTATE) {
  console.log('[jobs] NOT CAUGHT - the check passed a queue it should have rejected');
  process.exit(1);
}
console.log(failures === 0 ? '[jobs] PASS' : `[jobs] FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
