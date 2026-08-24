#!/usr/bin/env node
// Installing an effect: the store's revisions, the door a package has to get through, and
// what happens on a page that is already up when one lands.
//
// **The failure this whole surface is built around is a page that will not boot.** A
// package is GLSL spliced into two programs and a table of parameters spliced into the
// registry, and both are assembled while `web/main.js` is still evaluating - so a package
// that does not assemble does not fail its install, it fails the *next page load*, with no
// `globalThis.__kinect` published, every tool in this suite reporting DID NOT RUN, and the
// only evidence a line in a console nobody has open. Everything below is about moving that
// failure to the moment of the install, and about proving that a page which was up when
// the install happened is still telling the truth afterwards.
//
// **Five claims, and each has something that must fail if it were not being done.**
//
//  1. **A revision is a hash of the bytes on disk.** Per file and over the set, computed
//     here from the staged tree and held against what the routes answer - so a store
//     serving a rev it made up, or one it cached, is a red row. The control is a byte:
//     one flipped in one chunk has to move that file's rev and its package's, and leave
//     every other package's alone. And a half-written package has to be invisible to
//     every read, which is what makes the install atomic rather than merely quick -
//     `temporaries-are-visible` is that row's control.
//  2. **The door refuses by name, and refuses on disk.** Fifteen hostile packages, one
//     per rule, each of which must come back with the sentence for its own rule and must
//     leave the user root exactly as it found it - no directory, no `.tmp`, no `.old`.
//     **The must-accept package is what makes that mean anything**: a door that refused
//     everything would pass all fifteen refusal rows at once, and the one package that
//     has to land is the row it could not pass.
//  3. **A page that is up adopts the install.** The group appears, the rows appear, the
//     uniform cell the package binds is minted, the assembled program carries its text -
//     and then `boot-check`'s own question is asked again on the rebuilt page: does every
//     control show the value the registry holds. That is the invariant an install is most
//     likely to break quietly, because a panel rebuilt without a value walk looks
//     completely normal. `rebuild-skips-the-panel` and `install-skips-the-uniform-cells`
//     are its two controls.
//  4. **Uninstalling parks and reinstalling restores, exactly.** Values and a keyframed
//     track go in, a playback hash is taken, the package is removed - the values park, the
//     badge says so - and it is put back, at which point the pool is empty and the same
//     three program positions hash to the same three images. A pixel identity rather than
//     a value comparison, because what is being claimed is that the *edit* survived and an
//     edit is what you can see. `reinstall-leaves-it-parked` is the control.
//  5. **And a build with nothing missing says nothing.** A badge that appeared on every
//     document would satisfy row 4's "the badge appeared" and mean nothing at all.
//
// **What is deliberately not here.** The export door on a clip whose look this build
// cannot draw, and the per-effect suppress beside it, belong to `export-check` - one
// claim, one place. This tool never renders a deliverable.
//
//   node tools/effect-check.mjs
//   node tools/effect-check.mjs --mutate temporaries-are-visible         # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-skips-the-panel         # must FAIL
//   node tools/effect-check.mjs --mutate install-skips-the-uniform-cells # must FAIL
//   node tools/effect-check.mjs --mutate reinstall-leaves-it-parked      # must FAIL
//
// It spawns its own server on a port nothing else in the suite uses and needs none
// running. A GPU browser, a free port 8281, no capture, no sensor and no ffmpeg.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const PORT = Number(flag('--port', '8281'));
const MUTATE = argv.includes('--mutate') ? flag('--mutate') : null;
const WORK = join(REPO, '.effect-check');
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * The mutations, and each one is a way of doing this feature that would look correct.
 *
 * `temporaries-are-visible` widens the id filter the store lists directories through, so
 * the `<id>.<seq>.tmp` a half-finished install leaves behind becomes an entry in
 * `/effects` and a package `rootFor` will resolve. That is the whole of what makes the
 * install atomic: the temporary names carry a dot and an effect id may not, so a crashed
 * install is invisible rather than merely unlikely to be read. A build without the filter
 * serves a package with no manifest to whatever asks next.
 *
 * `rebuild-skips-the-panel` builds the panel on the first run and never again, which is
 * the rebuild a person would write if they thought of the panel as boot furniture. Boot is
 * unaffected - the map is empty exactly once - so `boot-check` stays green and the page
 * carries on drawing; what breaks is the hotloaded page, where the registry has grown two
 * parameters that no row on the panel shows.
 *
 * `install-skips-the-uniform-cells` stops minting the JavaScript cell a new binding needs.
 * Every shipped package binds a uniform some hand-written table already holds, so nothing
 * about the sixteen notices; a seventeenth throws on the first write of its own parameter,
 * which the value walk performs, so the install fails rather than the slider.
 *
 * `reinstall-leaves-it-parked` widens the parking predicate to every dotted name, so a
 * value belonging to an effect that *is* installed parks anyway. The badge still appears
 * on the uninstall, which is what makes it worth having: a check reading only the badge
 * would call this build correct, and what fails is the restoration.
 */
const MUTATIONS = {
  'temporaries-are-visible': {
    file: 'server/effect-store.js',
    edits: [[
      '.filter((e) => e.isDirectory() && VALID_EFFECT_ID.test(e.name))',
      '.filter((e) => e.isDirectory())',
    ]],
  },
  'rebuild-skips-the-panel': {
    file: 'web/main.js',
    edits: [['\n  buildPanel();\n', '\n  if (!panelControls.size) buildPanel();\n']],
  },
  'install-skips-the-uniform-cells': {
    file: 'web/main.js',
    edits: [[
      "    table[bind.uniform] = { value: bind.transform === 'axisDeg' ? new THREE.Vector2() : 0 };",
      '    if (Object.hasOwn(table, bind.uniform)) table[bind.uniform] = { value: 0 };',
    ]],
  },
  'reinstall-leaves-it-parked': {
    file: 'web/main.js',
    edits: [[
      '  return id !== null && !effectInstalled(id);',
      '  return id !== null;',
    ]],
  },
};

if (argv.includes('--mutate') && !MUTATIONS[MUTATE]) {
  console.log(`[effect] DID NOT RUN - no mutation named ${MUTATE ?? '(nothing was given)'};`
    + ` this tool knows ${Object.keys(MUTATIONS).join(', ')}`);
  process.exit(2);
}

// --- the port, asked of the kernel ------------------------------------------
//
// A tool that finds a stranger already listening is answered by the stranger and asserts
// against whatever fixture *that* process staged, which is a green run proving nothing.
// Asked before anything is staged, so the refusal costs nothing and names what is held.
const portHeld = await new Promise((resolve) => {
  const probe = spawn('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  probe.stdout.on('data', (c) => { out += c; });
  probe.on('close', () => resolve(out.trim()));
  probe.on('error', () => resolve(''));
});
if (portHeld) {
  console.log(`[effect] DID NOT RUN - something is already listening on ${PORT} (pid ${portHeld.split('\n').join(', ')}). `
    + 'A run answered by a stranger asserts against whatever that process staged.');
  process.exit(2);
}

// --- the staged tree ---------------------------------------------------------
//
// A mutation applied in place and restored afterwards leaves a mutated working tree behind
// any crash, which is the one state a proof tool must never produce. `server/` and `web/`
// are copied rather than linked for the same reason - through a symlink every mutation
// here would rewrite the repo's own source - and `effects-builtin/` joins them because the
// store refuses to boot without its shipped root and because this tool flips a byte inside
// it on purpose.
//
// `effects/` is made empty and handed to the server by name. **Both roots are passed
// explicitly rather than left to resolve**, which matters more here than anywhere else in
// the suite: this is the only tool that writes packages, and a root that resolved to the
// checkout would put its fixtures - and its fifteen hostile ones - into the repo.
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
// `presets-builtin` joins the list for the same class of reason `effects-builtin` does and
// is worth naming rather than leaving to be rediscovered: the page fetches the preset
// library while it boots, and a staged tree without the shipped root answers 500, which
// lands in `pageErrors` and reddens the last row of section 5 with a fault that has
// nothing to do with effects.
for (const dir of ['server', 'tools', 'web', 'effects-builtin', 'presets-builtin']) {
  cpSync(join(REPO, dir), join(WORK, dir), { recursive: true });
}
mkdirSync(join(WORK, 'effects'), { recursive: true });
for (const name of ['node_modules', 'vendor']) {
  const from = join(REPO, name);
  if (existsSync(from)) symlinkSync(from, join(WORK, name));
}
// `native/` is deliberately absent, so the server spawns no grabber and the depth textures
// stay whatever this tool plants in them. Section 4 hashes rendered frames, and a live
// socket wipes a plant in well under a second.
if (MUTATE) {
  const spec = MUTATIONS[MUTATE];
  const path = join(WORK, spec.file);
  let source = readFileSync(path, 'utf8');
  for (const [from, to] of spec.edits) {
    const hits = source.split(from).length - 1;
    if (hits !== 1) {
      console.log(`[effect] DID NOT RUN - the ${MUTATE} anchor matched ${hits} times in ${spec.file}, `
        + 'expected exactly 1, so nothing was mutated and this run would prove nothing');
      process.exit(2);
    }
    source = source.replace(from, to);
  }
  writeFileSync(path, source);
}

const USER_ROOT = join(WORK, 'effects');
const BUILTIN_ROOT = join(WORK, 'effects-builtin');

// --- harness -----------------------------------------------------------------
let checked = 0;
let failed = 0;
let crashed = null;
let untested = null;
const fired = [];
const ok = (label, pass, detail = '') => {
  checked++;
  if (!pass) { failed++; fired.push(label); }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const servers = [];
const start = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(WORK, 'server/index.js'), '--port', String(PORT),
    '--effects', USER_ROOT, '--builtin-effects', BUILTIN_ROOT,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  const log = [];
  const onData = (c) => {
    log.push(c.toString());
    if (log.join('').includes('viewer on')) setTimeout(resolve, 200);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  setTimeout(() => reject(new Error(`server never came up:\n${log.join('')}`)), 15000);
});
const stopAll = async () => {
  for (const c of servers) c.kill('SIGKILL');
  servers.length = 0;
  await wait(150);
};

const getJson = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
};
const put = async (id, body) => {
  const res = await fetch(`${BASE}/effects/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const del = async (id) => {
  const res = await fetch(`${BASE}/effects/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
  });
  return { status: res.status, body: await res.json() };
};

/** Everything sitting in the user root, temporaries included - the residue test. */
const userRootHolds = () => (existsSync(USER_ROOT) ? readdirSync(USER_ROOT).sort() : []);

// --- the package this tool installs -------------------------------------------
//
// A whole effect rather than a stub: a master that is inert at zero, a second key under
// it, its own panel group anchored into the spine, a declaration chunk and a chunk that
// reaches a pixel. Everything section 3 and section 4 assert is about a package doing what
// a package does, and a fixture that declared parameters and no GLSL would leave the
// program swap, the minted uniform cell and the pixel identity all untested.
const probeManifest = () => ({
  format: 1,
  id: 'probe',
  version: '1.0.0',
  title: 'Probe',
  params: {
    amount: {
      def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe',
      panel: { group: 'probe', tab: 'look' },
      bind: { on: 'points', uniform: 'probeAmount' },
      role: 'master',
    },
    hue: {
      def: 0.5, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe hue',
      panel: { group: 'probe', tab: 'look' },
      bind: { on: 'points', uniform: 'probeHue' },
      under: 'amount',
    },
  },
  panelGroups: [
    { key: 'probe', label: 'Probe', tab: 'look', lookgroup: true, collapses: true, after: 'post', order: 900 },
  ],
  chunks: [
    { stage: 'f.decl', order: 900, file: 'decl.frag.glsl' },
    { stage: 'f.tone', order: 900, file: 'tone.frag.glsl' },
  ],
});
const probeChunks = () => ({
  'decl.frag.glsl': 'uniform float probeAmount, probeHue;\n',
  'tone.frag.glsl':
    '  if (probeAmount > 0.0) {\n'
    + '    col = mix(col, vec3(probeHue, 1.0 - probeHue, probeHue * 0.5), probeAmount);\n'
    + '  }\n',
});
const probePackage = () => ({ manifest: probeManifest(), chunks: probeChunks() });
const bent = (edit) => {
  const pkg = probePackage();
  edit(pkg);
  return pkg;
};

/**
 * A pinned run with no capture and no sensor: a handful of depth frames written here.
 *
 * The wire's own frame payload - depth byte count, colour byte count, a stamp, then the
 * millimetres - which is what `drive.pin` parses. Colour is left at zero bytes, exactly as
 * a pinned run does on a real take, because a JPEG decode is asynchronous and a hash taken
 * across one would be a hash of whether it had landed yet.
 *
 * The surface is a plane that leans, so the picture has depth in it: a flat wall renders
 * the same colour everywhere and a tone chunk mixing toward a colour would move every
 * pixel by the same amount, which is a picture two builds can agree about for the wrong
 * reason. The frames differ from each other so a track evaluated at three positions has
 * three images to be right about.
 */
const DEPTH_W = 512;
const DEPTH_H = 424;
const pinnedBuffer = () => {
  const FRAMES = 6;
  const depthBytes = DEPTH_W * DEPTH_H * 2;
  const out = Buffer.alloc(FRAMES * (16 + depthBytes));
  for (let f = 0; f < FRAMES; f++) {
    const at = f * (16 + depthBytes);
    out.writeUInt32LE(depthBytes, at);
    out.writeUInt32LE(0, at + 4);
    out.writeBigUInt64LE(BigInt(f * 33), at + 8);
    for (let y = 0; y < DEPTH_H; y++) {
      for (let x = 0; x < DEPTH_W; x++) {
        // 1.2m to 2.6m across the frame, drifting 40mm per frame so successive frames are
        // genuinely different geometry rather than the same one restamped.
        const mm = 1200 + Math.round((x / DEPTH_W) * 900 + (y / DEPTH_H) * 500) + f * 40;
        out.writeUInt16LE(mm, at + 16 + (y * DEPTH_W + x) * 2);
      }
    }
  }
  return out;
};

const POSITIONS = [0.1, 0.6, 1.2];

console.log(`[effect] ${MUTATE ? `MUTATED: ${MUTATE} (${MUTATIONS[MUTATE].file})` : 'unmutated tree'}\n`);

let browser = null;
try {
  let chromium;
  try {
    ({ chromium } = await import(join(REPO, 'node_modules/playwright/index.mjs')));
  } catch {
    untested = 'playwright is not installed, and three of the five sections are about a page';
    throw new Error(untested);
  }

  await start();

  // ======================================================= 1. what a revision is
  console.log('[effect] 1. the store\'s revisions, and a half-written package');

  const listed = await getJson('/effects');
  ok('the store lists the shipped packages', listed.status === 200 && listed.body.effects?.length >= 16,
    `${listed.body.effects?.length ?? 0} packages`);
  if (listed.status !== 200) throw new Error('the store would not list at all, so nothing below could be measured');

  // The oracle: the hashes this tool computes off the staged tree, which is the only
  // reading independent of the thing under test. A row comparing the store's rev against
  // the store's own recomputation would agree with any implementation, correct or not.
  let fileRevs = 0;
  let packageRevs = 0;
  let revMismatch = null;
  for (const entry of listed.body.effects) {
    const dir = join(BUILTIN_ROOT, entry.id);
    for (const file of entry.files) {
      const want = sha(readFileSync(join(dir, file.name)));
      if (file.rev !== want) revMismatch ??= `${entry.id}/${file.name}`;
      fileRevs++;
    }
    const want = sha(entry.files.map((f) => `${f.name} ${f.rev}\n`).join(''));
    if (entry.rev !== want) revMismatch ??= `${entry.id} (the package)`;
    packageRevs++;
  }
  ok('every file revision is the sha256 of the bytes on disk, and every package revision the hash over its file lines',
    revMismatch === null, revMismatch ? `first disagreement at ${revMismatch}` : `${fileRevs} files across ${packageRevs} packages`);

  // The control. A rev that was a name, a timestamp or a cached number would satisfy every
  // row above on a tree nobody had touched.
  const victim = join(BUILTIN_ROOT, 'thermal/heat.frag.glsl');
  const original = readFileSync(victim);
  const beforeFlip = await getJson('/effects/thermal');
  const witnessBefore = await getJson('/effects/edges');
  writeFileSync(victim, Buffer.concat([original, Buffer.from('\n')]));
  const afterFlip = await getJson('/effects/thermal');
  const witnessAfter = await getJson('/effects/edges');
  const revOf = (pkg, name) => pkg.body.files.find((f) => f.name === name)?.rev;
  ok('one byte changed on disk moves that file\'s revision',
    revOf(beforeFlip, 'heat.frag.glsl') !== revOf(afterFlip, 'heat.frag.glsl'),
    `${revOf(beforeFlip, 'heat.frag.glsl')?.slice(7, 19)} -> ${revOf(afterFlip, 'heat.frag.glsl')?.slice(7, 19)}`);
  ok('and its package\'s revision with it', beforeFlip.body.rev !== afterFlip.body.rev,
    `${beforeFlip.body.rev.slice(7, 19)} -> ${afterFlip.body.rev.slice(7, 19)}`);
  ok('and leaves every other package where it was, so a revision is about its own bytes',
    witnessBefore.body.rev === witnessAfter.body.rev, witnessAfter.body.rev.slice(7, 19));
  writeFileSync(victim, original);
  const restored = await getJson('/effects/thermal');
  ok('and putting the byte back puts the revision back', restored.body.rev === beforeFlip.body.rev,
    restored.body.rev.slice(7, 19));

  // ================================================================= 2. the door
  console.log('\n[effect] 2. the door, and the package that has to get through it');

  const accepted = await put('probe', probePackage());
  ok('a well-formed package lands - the row that stops every refusal below passing on a door that refuses everything',
    accepted.status === 200 && accepted.body.id === 'probe', `answered ${accepted.status}: ${accepted.body.error ?? 'installed'}`);
  const onDisk = existsSync(join(USER_ROOT, 'probe')) ? readdirSync(join(USER_ROOT, 'probe')).sort() : [];
  ok('and its files are the ones it sent, in the user root',
    onDisk.join(',') === 'decl.frag.glsl,manifest.json,tone.frag.glsl', onDisk.join(', ') || 'nothing');
  const shadowCheck = await getJson('/effects/probe');
  ok('and the store answers for it as a user package rather than a shipped one',
    shadowCheck.status === 200 && shadowCheck.body.builtin === false, `builtin=${shadowCheck.body.builtin}`);

  await del('probe');
  const cleanRoot = userRootHolds();
  ok('and removing it leaves the user root empty, so the refusals below start from nothing',
    cleanRoot.length === 0, cleanRoot.join(', ') || 'empty');

  // The shipped noise, whole, for the fork row.
  //
  // **A fork is held against what it forks, and reaching that rule takes some care.** Two
  // earlier rules stand in front of it: a fork sent without its own chunks is refused for
  // the chunk that did not arrive, and a fork of a package whose *own* GLSL declares the
  // dropped parameter's uniform is refused for a uniform nothing binds. `noise` has
  // neither problem - its chunk declares no uniforms of its own, they are all the spine's -
  // so dropping one of its parameters reaches the rule this row is about. That is a fact
  // about which package to use for the row, and it is written down because picking `rain`
  // here produced a green row for the wrong reason.
  const noiseDir = join(BUILTIN_ROOT, 'noise');
  const noiseManifest = JSON.parse(readFileSync(join(noiseDir, 'manifest.json'), 'utf8'));
  const noiseChunks = Object.fromEntries((noiseManifest.chunks ?? []).map((c) => [c.file, readFileSync(join(noiseDir, c.file), 'utf8')]));
  const forkedNoise = (edit) => {
    const manifest = JSON.parse(JSON.stringify(noiseManifest));
    edit(manifest);
    return { manifest, chunks: { ...noiseChunks } };
  };

  // One hostile package per rule. Each is the well-formed one with a single field wrong,
  // which is the shape a real broken package has - a fixture written to fail is a fixture
  // that can fail for a reason nobody intended.
  const hostile = [
    ['an id nothing could be', 'Probe1', probePackage(), /is not an effect id/],
    ['a manifest declaring another id', 'probe', bent((p) => { p.manifest.id = 'other'; }), /declaring id "other"/],
    ['a package format from a later build', 'probe', bent((p) => { p.manifest.format = 2; }), /package format 2/],
    ['a package that says no format at all', 'probe', bent((p) => { delete p.manifest.format; }), /declares no package format/],
    ['a chunk name that is a path', 'probe', bent((p) => {
      p.manifest.chunks[0].file = '../escape.glsl';
      p.chunks['../escape.glsl'] = p.chunks['decl.frag.glsl'];
      delete p.chunks['decl.frag.glsl'];
    }), /"\.\.\/escape\.glsl"/],
    ['two parameters claiming the role master', 'probe', bent((p) => {
      Object.assign(p.manifest.params.hue, { role: 'master', def: 0 });
    }), /2 parameters with the role master/],
    ['a master that is not inert at its default', 'probe', bent((p) => { p.manifest.params.amount.def = 0.5; }), /master and defaults to 0\.5/],
    ['a kind this registry does not implement', 'probe', bent((p) => { p.manifest.params.hue.kind = 'ramp'; }), /kind "ramp"/],
    ['a transform the applier has never heard of', 'probe', bent((p) => { p.manifest.params.hue.bind.transform = 'toKelvin'; }), /transform "toKelvin"/],
    ['a binding whose uniform no program declares', 'probe', bent((p) => { p.manifest.params.hue.bind.uniform = 'probeHueee'; }), /declares no such uniform/],
    ['a uniform declared and bound by nothing', 'probe', bent((p) => {
      p.chunks['decl.frag.glsl'] = 'uniform float probeAmount, probeHue, probeStray;\n';
    }), /"probeStray" and binds no parameter/],
    ['a chunk naming a joint no spine holds', 'probe', bent((p) => { p.manifest.chunks[1].stage = 'f.elsewhere'; }), /does not assemble/],
    ['an identifier that exists nowhere in this build', 'probe', bent((p) => {
      p.chunks['tone.frag.glsl'] = '  col = mix(col, vec3(qqNotHere), probeAmount);\n';
    }), /"qqNotHere"/],
    ['a varying whose initial value reads state', 'probe', bent((p) => {
      p.manifest.varyings = [{ name: 'vProbe', type: 'float', init: 'probeAmount', order: 900 }];
    }), /initialises to "probeAmount"/],
    ['a chunk the manifest names and did not send', 'probe', bent((p) => { delete p.chunks['tone.frag.glsl']; }), /its text did not arrive/],
    ['a file the manifest never names', 'probe', bent((p) => { p.chunks['spare.glsl'] = '// nothing\n'; }), /"spare\.glsl" and its manifest names no chunk/],
    ['a fork of a shipped package that drops one of its parameters', 'noise', forkedNoise((m) => {
      m.version = '2.0.0';
      delete m.params.speed;
    }), /drops noise\.speed/],
  ];

  let refusedCount = 0;
  let wrongReason = null;
  let residue = null;
  for (const [what, id, body, matches] of hostile) {
    const answer = await put(id, body);
    if (answer.status === 409 && matches.test(answer.body.error ?? '')) refusedCount++;
    else wrongReason ??= `${what}: ${answer.status} ${answer.body.error ?? JSON.stringify(answer.body)}`;
    const held = userRootHolds();
    if (held.length !== 0) residue ??= `${what} left ${held.join(', ')}`;
  }
  ok(`every hostile package is refused with the sentence for its own rule - ${hostile.length} rules`,
    refusedCount === hostile.length, wrongReason ?? `${refusedCount} of ${hostile.length}`);
  ok('and none of them reaches the filesystem: no package, no .tmp, no .old left behind',
    residue === null, residue ?? `user root ${userRootHolds().join(', ') || 'empty'}`);

  const stillShipped = await getJson('/effects');
  ok('and the shipped set is exactly what it was before the door was pushed at',
    stillShipped.body.effects?.length === listed.body.effects.length,
    `${stillShipped.body.effects?.length ?? 'no'} packages`);

  const refuseBuiltin = await del('noise');
  ok('a builtin nothing is forking refuses to be removed, by name',
    refuseBuiltin.status === 409 && /shipped with this build/.test(refuseBuiltin.body.error ?? ''),
    `${refuseBuiltin.status}: ${(refuseBuiltin.body.error ?? '').slice(0, 60)}`);

  // ================================================== 3. a page adopts an install
  console.log('\n[effect] 3. a page that is already up, adopting an install');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.goto(`${BASE}/record`, { waitUntil: 'load' });
  await page.waitForFunction('Boolean(globalThis.__kinect)', null, { timeout: 20000 });

  const before = await page.evaluate(() => ({
    params: globalThis.__kinect.params.names().length,
    groups: document.querySelectorAll('#panelBody > [data-group]').length,
    probeRows: document.querySelectorAll('[data-group="probe"] .row').length,
  }));
  ok('the page is up with no probe on it, so what happens below is the install rather than the page',
    before.probeRows === 0 && before.params > 0, `${before.params} parameters, ${before.groups} generated groups`);

  const installed = await put('probe', probePackage());
  ok('the package installs while that page is open', installed.status === 200,
    `${installed.status}: ${installed.body.error ?? 'installed'}`);

  const adopted = await page.evaluate(async () => {
    try {
      await globalThis.__kinect.effects.reload();
    } catch (err) {
      return { threw: String(err.message) };
    }
    const k = globalThis.__kinect;
    return {
      params: k.params.names().length,
      groups: document.querySelectorAll('#panelBody > [data-group]').length,
      probeRows: document.querySelectorAll('[data-group="probe"] .row').length,
      groupLabel: document.querySelector('[data-group="probe"] .grouphead label')?.textContent ?? null,
      knows: k.params.names().includes('probe.amount') && k.params.names().includes('probe.hue'),
      cell: Object.hasOwn(k.uniforms, 'probeAmount') && Object.hasOwn(k.uniforms, 'probeHue'),
      inShader: k.effects.programs().cloud.fragmentShader.includes('probeHue'),
      appended: k.params.names('look').slice(-2),
    };
  });
  ok('the rebuild ran through the product\'s own path', !adopted.threw, adopted.threw ?? 'no throw');
  ok('the registry grew exactly the package\'s two parameters',
    adopted.params === before.params + 2 && adopted.knows, `${before.params} -> ${adopted.params}`);
  ok('and they are at the end of the look order, which is where the placement rule puts a package nothing has a layout for',
    JSON.stringify(adopted.appended) === JSON.stringify(['probe.amount', 'probe.hue']), JSON.stringify(adopted.appended));
  ok('the panel grew the package\'s own group, with a row for each parameter',
    adopted.groups === before.groups + 1 && adopted.probeRows === 2,
    `${adopted.groups} groups, ${adopted.probeRows} probe rows, heading ${JSON.stringify(adopted.groupLabel)}`);
  ok('the uniform cells its bindings need were minted, because no hand-written table holds them',
    adopted.cell === true, `probeAmount and probeHue ${adopted.cell ? 'present' : 'missing'}`);
  ok('and the assembled program carries its chunk text', adopted.inShader === true);

  // ---- and now boot-check's own question, on the page that has just been rebuilt
  //
  // **This is the row an install is most likely to break silently.** A rebuild that
  // replaced the registry and repainted nothing draws a completely normal panel showing
  // the values from before the install, and no picture anywhere is wrong. The three rows
  // below are `boot-check`'s three, asked of a page that got here by hotload rather than
  // by boot - the same question, the other door.
  const diff = await page.evaluate(() => {
    const k = globalThis.__kinect;
    const rows = [];
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el) continue;
      const registry = k.params.get(name);
      const control = el.type === 'checkbox' ? el.checked : Number(el.value);
      rows.push({ name, registry, control, agrees: String(registry) === String(control) });
    }
    return rows;
  });
  const diverge = diff.filter((r) => !r.agrees);
  ok('every control on the rebuilt page shows the value the registry holds for it',
    diff.length > 0 && diverge.length === 0,
    diverge.length
      ? `${diverge.length} of ${diff.length} diverge: ${diverge.slice(0, 5).map((r) => `${r.name} registry ${r.registry} vs control ${r.control}`).join('; ')}`
      : `${diff.length} of ${diff.length} agree`);

  // The comparison's own falsification, in run rather than by mutation: a diff whose two
  // sides could not disagree would pass on any build at all.
  const drive = await page.evaluate(() => {
    const k = globalThis.__kinect;
    let moved = 0;
    let followed = 0;
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el) continue;
      const want = el.type === 'checkbox'
        ? !k.params.get(name)
        : (String(k.params.get(name)) === el.min ? Number(el.max) : Number(el.min));
      k.params.set(name, want);
      moved++;
      const shown = el.type === 'checkbox' ? el.checked : Number(el.value);
      if (String(shown) === String(k.params.get(name))) followed++;
    }
    return { moved, followed };
  });
  ok('and the comparison can separate two states: a write through the registry moves the control it belongs to',
    drive.moved === diff.length && drive.followed === drive.moved,
    `${drive.followed} of ${drive.moved} followed`);

  // ============================================ 4. uninstall parks, reinstall restores
  console.log('\n[effect] 4. an uninstall parks the edit, and a reinstall gives it back');

  const buffer = pinnedBuffer();
  await page.route('**/__effect-pinned.bin', (route) => route.fulfill({
    status: 200, contentType: 'application/octet-stream', body: buffer,
  }));
  await page.evaluate(async () => {
    const res = await fetch('/__effect-pinned.bin');
    globalThis.__kinect.drive.pin(await res.arrayBuffer());
  });

  const authored = await page.evaluate(async (positions) => {
    const k = globalThis.__kinect;
    // Back to a known look first: the sweep above left every control at a bound.
    k.params.reset();
    k.params.set('probe.amount', 0.7);
    k.params.set('probe.hue', 0.3);
    k.keyframes.setTracks({ 'probe.amount': [{ t: 0, value: 0.15 }, { t: 1.4, value: 0.95 }] });
    const sha256 = async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    k.drive.reset();
    const hashes = [];
    for (const t of positions) {
      k.drive.stepTo(t);
      hashes.push(await sha256(k.drive.readPixels()));
    }
    return { hashes, track: k.keyframes.valueAt('probe.amount', 0.7), hue: k.params.get('probe.hue') };
  }, POSITIONS);
  ok('an edit is authored on the installed effect: two values and a track with keys',
    authored.hue === 0.3 && authored.track !== null,
    `hue ${authored.hue}, the track reads ${authored.track?.toFixed?.(3) ?? authored.track} at 0.7s`);
  ok('and the three program positions render three different images, so the identity below is about something',
    new Set(authored.hashes).size === POSITIONS.length,
    authored.hashes.map((h) => h.slice(0, 8)).join(' '));

  const removed = await del('probe');
  ok('the package is removed', removed.status === 200 && removed.body.removed === 'probe',
    `${removed.status}: ${removed.body.error ?? 'removed'}`);

  const parked = await page.evaluate(async () => {
    try {
      await globalThis.__kinect.effects.reload();
    } catch (err) {
      return { threw: String(err.message) };
    }
    const k = globalThis.__kinect;
    const badge = document.getElementById('tMissing');
    return {
      knows: k.params.names().includes('probe.amount'),
      groups: document.querySelectorAll('[data-group="probe"]').length,
      pool: k.library.parkedLook(),
      missing: k.library.missingEffects(),
      badgeHidden: badge?.hidden ?? null,
      badgeText: badge?.textContent ?? '',
    };
  });
  ok('the rebuild after the removal ran', !parked.threw, parked.threw ?? 'no throw');
  ok('the registry and the panel no longer carry the effect',
    parked.knows === false && parked.groups === 0, `${parked.groups} probe groups`);
  ok('its values and its track are parked rather than dropped',
    Object.keys(parked.pool?.params ?? {}).length === 2
      && Object.keys(parked.pool?.tracks ?? {}).length === 1,
    `${Object.keys(parked.pool?.params ?? {}).length} values, ${Object.keys(parked.pool?.tracks ?? {}).length} tracks: `
    + `${JSON.stringify(parked.pool?.params)}`);
  ok('and the badge says so, quoting the version the edit was authored against',
    parked.badgeHidden === false && /probe/.test(parked.badgeText) && /1\.0\.0/.test(parked.badgeText),
    `hidden=${parked.badgeHidden}, "${parked.badgeText.trim().slice(0, 70)}"`);
  ok('and the pool\'s counts are what the badge is drawn from',
    parked.missing?.length === 1 && parked.missing[0].values === 2 && parked.missing[0].tracks === 1,
    JSON.stringify(parked.missing));

  const reinstalled = await put('probe', probePackage());
  ok('the package is installed again', reinstalled.status === 200,
    `${reinstalled.status}: ${reinstalled.body.error ?? 'installed'}`);

  const restoredRun = await page.evaluate(async (positions) => {
    try {
      await globalThis.__kinect.effects.reload();
    } catch (err) {
      return { threw: String(err.message) };
    }
    const k = globalThis.__kinect;
    const sha256 = async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    k.drive.reset();
    const hashes = [];
    for (const t of positions) {
      k.drive.stepTo(t);
      hashes.push(await sha256(k.drive.readPixels()));
    }
    const badge = document.getElementById('tMissing');
    return {
      hashes,
      pool: k.library.parkedLook(),
      hue: k.params.get('probe.hue'),
      track: k.keyframes.valueAt('probe.amount', 0.7),
      badgeHidden: badge?.hidden ?? null,
    };
  }, POSITIONS);
  ok('the rebuild after the reinstall ran', !restoredRun.threw, restoredRun.threw ?? 'no throw');
  ok('the parked pool is empty again, so nothing was left behind by the effect coming back',
    Object.keys(restoredRun.pool?.params ?? {}).length === 0
      && Object.keys(restoredRun.pool?.tracks ?? {}).length === 0,
    JSON.stringify(restoredRun.pool?.params ?? {}));
  ok('the values and the track came back through the registry\'s own door',
    restoredRun.hue === 0.3 && Math.abs((restoredRun.track ?? 0) - (authored.track ?? -1)) < 1e-9,
    `hue ${restoredRun.hue}, the track reads ${restoredRun.track?.toFixed?.(6)} against ${authored.track?.toFixed?.(6)}`);
  ok('and the three positions render the same three images they rendered before the uninstall',
    JSON.stringify(restoredRun.hashes) === JSON.stringify(authored.hashes),
    restoredRun.hashes.map((h, i) => `${h.slice(0, 8)}${h === authored.hashes[i] ? '=' : '!='}${authored.hashes[i].slice(0, 8)}`).join(' '));

  // ==================================================== 5. and nothing missing, no badge
  console.log('\n[effect] 5. a document with everything it needs says nothing');

  const quiet = await page.evaluate(() => {
    const k = globalThis.__kinect;
    const badge = document.getElementById('tMissing');
    return {
      missing: k.library.missingEffects(),
      hidden: badge?.hidden ?? null,
      entries: document.querySelectorAll('#tMissing .missingfx').length,
    };
  });
  ok('with every effect the document names installed, the badge is not on screen',
    quiet.hidden === true && quiet.missing.length === 0 && quiet.entries === 0,
    `hidden=${quiet.hidden}, ${quiet.missing.length} missing, ${quiet.entries} entries drawn`);

  // =========================================== 6. what a crashed install leaves behind
  //
  // **Last, and the position is the finding rather than housekeeping.** Everything in
  // this block leaves a directory in the user root that is not a package, and under
  // `temporaries-are-visible` the store then cannot list at all - so a temporary staged
  // in section 1 would have reddened every row of every section after it with a fault
  // whose cause is four sections away. Put here, the mutation reddens the two rows it is
  // about and nothing else, which is the difference between a control that names a
  // property and one that fails everything.
  console.log('\n[effect] 6. and what a crashed install leaves behind is invisible until it is swept');

  // Taken here rather than reused from section 1, because the probe is installed by now
  // and the count moved with it - a comparison against the boot listing would fail on a
  // correct build for a reason that has nothing to do with temporaries.
  const beforeStale = await getJson('/effects');
  const stale = join(USER_ROOT, 'probe.99999.tmp');
  mkdirSync(stale, { recursive: true });
  writeFileSync(join(stale, 'manifest.json'), '{"this is": "not a package"}');
  ok('a half-written package is on disk, so the rows under this are about something',
    existsSync(stale), 'probe.99999.tmp staged in the user root');
  const withStale = await getJson('/effects');
  ok('a half-written package is in no listing - its name carries a dot and an effect id may not',
    withStale.status === 200
      && withStale.body.effects?.length === beforeStale.body.effects?.length
      && !withStale.body.effects.some((e) => e.id.includes('.')),
    `answered ${withStale.status} with ${withStale.body.effects?.length ?? 'no'} packages, `
    + `${beforeStale.body.effects?.length ?? 'no'} before it was staged`);
  const staleRead = await getJson('/effects/probe.99999.tmp');
  ok('and no read resolves it', staleRead.status === 404, `answered ${staleRead.status}`);
  const sweeping = await put('probe', probePackage());
  ok('and the next install of that id sweeps it, so a machine that crashed mid-install does not accumulate copies',
    sweeping.status === 200 && !existsSync(stale),
    `${sweeping.status}: ${sweeping.body.error ?? 'installed'}, user root ${userRootHolds().join(', ') || 'empty'}`);

  ok('the page reported no error through any of it', pageErrors.length === 0,
    pageErrors.slice(0, 2).join(' | '));
} catch (err) {
  crashed = err;
  console.log(`\n  FAIL  the run did not finish: ${err.stack ?? err.message}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopAll();
  rmSync(WORK, { recursive: true, force: true });
}

console.log(`\n[effect] ${checked} assertions, ${failed} failed`);
if (untested) {
  console.log(`[effect] UNTESTED - ${untested}.`);
  process.exit(2);
}
/**
 * **The count decides, and it decides before the crash does.**
 *
 * A mutation here can leave the page half-adopted - `install-skips-the-uniform-cells`
 * throws inside the value walk, so the registry is replaced and the panel is not - and a
 * driver reaching into that page throws in turn. The obvious verdict order puts the crash
 * first and reports DID NOT RUN over seven failed assertions that had already fired, which
 * is the exact shape `docs/instruments.md` files under a census of exit codes: a caught
 * mutation reported as a run that proved nothing, and the tool then reads as broken while
 * it is working.
 *
 * So a mutated run with failures is caught however it ended, and it says that it ended
 * early, because the rows after the crash did not run and the count is a floor rather than
 * the whole picture. A run with no failures is the other way round: crashed means DID NOT
 * RUN, and finishing cleanly means the mutation was not caught at all.
 */
if (MUTATE && failed > 0) {
  console.log(`[effect] caught, as required (${failed} assertion${failed === 1 ? '' : 's'} fired)`);
  if (crashed) console.log(`[effect] and the run ended early: ${crashed.message.split('\n')[0]} - the count is a floor`);
  console.log(`[effect] rows that fired: ${fired.join(' | ')}`);
  process.exit(1);
}
if (crashed) {
  console.log(`[effect] DID NOT RUN - ${crashed.message.split('\n')[0]}. Nothing here is a finding: re-run it.`);
  process.exit(2);
}
if (MUTATE) {
  console.log('[effect] NOT CAUGHT - the check passed a build it should have rejected');
  process.exit(1);
}
if (failed) { console.log('[effect] FAIL'); process.exit(1); }
console.log('[effect] PASS');
process.exit(0);
