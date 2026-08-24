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
// **Six claims, and each has something that must fail if it were not being done.**
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
//  6. **An install this page cannot adopt leaves it whole rather than half-migrated.** A
//     fork adding a parameter makes the open document a subset of the new manifest, which
//     the loader refuses per effect - correctly - *after* the registry has been swapped.
//     The page has to go back: the registry it had, the signature it had, the pixels it
//     drew, the pool it was holding, and a save that still writes the parked keys byte for
//     byte. `rollback-keeps-the-new-registry` is the control, and it is worth reading which
//     rows it reddens: not the picture, because the added parameter is inert at its
//     default, and not the note, because the refusal is reported either way.
//  7. **Everything on the page that is not a parameter survives the rebuild too.** The
//     panel is regenerated whole, so every hand-written control inside a generated group,
//     the tab that was showing, the paint the collapse headers carry and the dialog that
//     picks a preset's subset are all things a rebuild can quietly replace with a working
//     copy of themselves that nothing is wired to. Each has its own mutation, because each
//     of them is invisible in a screenshot and none of them fails anything else.
//  8. **A rebuild costs what it has to cost and interrupts nothing it need not.** The
//     grade pass is gated on a list derived from the packages, so it has to be derived
//     again; a package that changed no GLSL must not warm and must not clear the
//     accumulators mid-playback; a package that did change GLSL must release the program it
//     replaced; and a rebuild must stand down when a gesture starts while it is reading
//     rather than when it started reading.
//  9. **A package this build cannot compile is a rollback and a sentence, not a black
//     frame.** The door checks vocabulary and cannot compile GLSL, so identifier-valid text
//     that is syntactically broken reaches the driver - where a link failure is a log line
//     and not an exception. `a-broken-shader-is-warm` is the control.
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
//   node tools/effect-check.mjs --mutate rollback-keeps-the-new-registry # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-remakes-the-buttons     # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-forgets-the-tab         # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-keeps-the-paint         # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-keeps-the-picker        # must FAIL
//   node tools/effect-check.mjs --mutate gates-are-frozen-at-boot        # must FAIL
//   node tools/effect-check.mjs --mutate every-reload-warms              # must FAIL
//   node tools/effect-check.mjs --mutate swap-keeps-the-old-program      # must FAIL
//   node tools/effect-check.mjs --mutate poll-checks-once                # must FAIL
//   node tools/effect-check.mjs --mutate a-broken-shader-is-warm         # must FAIL
//   node tools/effect-check.mjs --mutate the-sweep-eats-the-last-copy    # must FAIL
//   node tools/effect-check.mjs --mutate package-files-follow-links      # must FAIL
//   node tools/effect-check.mjs --mutate poll-takes-any-body             # must FAIL
//   node tools/effect-check.mjs --mutate poll-guards-late                # must FAIL
//   node tools/effect-check.mjs --mutate reads-need-not-agree            # must FAIL
//   node tools/effect-check.mjs --mutate adopt-outside-the-transaction    # must FAIL
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
 *
 * `rollback-keeps-the-new-registry` is the half-rollback somebody writes who thinks of the
 * failure as being about the document: the loader is run again, and the packages it is run
 * against are the ones that just arrived rather than the ones this page had. The refusal is
 * still reported and the badge still says what is parked, so a check reading only the note
 * would call this build correct. What it leaves behind is the state the transaction exists
 * to prevent - a registry the server's, a pool the page's - and the two rows that can see
 * it are the registry's own contents and what a save writes, because the serialiser's
 * filter drops parked keys the moment their prefix reads installed. The image cannot see
 * it: the added parameter is inert at its default, so the picture is identical either way,
 * which is exactly why a pixel row is not enough to hold this property.
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
  'rollback-keeps-the-new-registry': {
    file: 'web/main.js',
    edits: [[
      '      adoptEffectPackages(heldPackages, heldPrograms, held);',
      '      adoptEffectPackages(fetched, programs, held);',
    ]],
  },

  /**
   * `rebuild-remakes-the-buttons` takes the memo off the two closures that emit the
   * framing group's hand-written rows, which is what the panel generator did until an
   * install existed to notice. Every rebuild then makes fresh buttons carrying the right
   * ids and none of the wiring, and the visible `show crop box` stops toggling anything
   * while `ui` writes its status into a node that is no longer in the document. Nothing
   * throws, the panel looks exactly right, and the controls are dead.
   */
  'rebuild-remakes-the-buttons': {
    file: 'web/main.js',
    edits: [
      ["    before: panelOnce(() => [\n      panelButtonRow(['camSensor', 'sensor view']),",
        "    before: () => [\n      panelButtonRow(['camSensor', 'sensor view']),"],
      ["      panelButtonRow(['camLevelReset', 'reset rotation']),\n    ]),\n    after: panelOnce(() => [",
        "      panelButtonRow(['camLevelReset', 'reset rotation']),\n    ],\n    after: () => ["],
      ["      panelNote('recRange', 'preview only'),\n    ]),", "      panelNote('recRange', 'preview only'),\n    ],"],
    ],
  },

  /**
   * `rebuild-forgets-the-tab` drops the re-application of the showing tab from the end of
   * the generator. A generated group is a new element with `hidden` unset, so one install
   * puts every tab's groups on screen at once - which is a panel four times as long as it
   * should be and no error anywhere.
   */
  'rebuild-forgets-the-tab': {
    file: 'web/main.js',
    edits: [['\n  hideOffTab();\n\n  // And the dialog', '\n\n  // And the dialog']],
  },

  /**
   * `rebuild-keeps-the-paint` leaves `groupPainted` holding the state strings it wrote
   * against the elements the rebuild has just thrown away. A group whose values did not
   * move across the install is then skipped by the first refresh after it, so it comes back
   * without its `shut` class and without `aria-expanded` - open on screen while the page's
   * own model says it is collapsed, and stable there, because the next refresh agrees with
   * the map.
   */
  'rebuild-keeps-the-paint': {
    file: 'web/main.js',
    edits: [['\n  groupPainted.clear();\n  panelRowsEmitted = 0;', '\n  panelRowsEmitted = 0;']],
  },

  /**
   * `rebuild-keeps-the-picker` builds the preset subset dialog once and never again, which
   * is what it did when it was a top-level loop. An installed effect then gets no checkbox
   * - so its values are in every preset with no way to leave them out - and an uninstalled
   * one leaves a checkbox whose `change` handler reads `PARAMS` for a name the registry no
   * longer has.
   */
  'rebuild-keeps-the-picker': {
    file: 'web/main.js',
    edits: [['\n  buildPresetPicker();\n}', '\n  if (!presetPickBoxes.size) buildPresetPicker();\n}']],
  },

  /**
   * `gates-are-frozen-at-boot` computes the list of grade terms that hold the pass open
   * once, off the packages that happened to be installed while the module evaluated. Every
   * shipped grade effect is in that list, so nothing about the sixteen notices; a grade
   * effect installed afterwards writes its uniform into a pass that stays shut, and the
   * effect is silently absent with its slider moving and its value landing.
   */
  'gates-are-frozen-at-boot': {
    file: 'web/main.js',
    edits: [['  GRADE_GATES = gradeGatesOf(packages);\n', '  GRADE_GATES ??= gradeGatesOf(packages);\n']],
  },

  /**
   * `every-reload-warms` warms unconditionally, which is what the rebuild did before it
   * knew whether the programs had moved. A package that changed only its parameters
   * assembles into the identical two programs and there is nothing to compile - but the
   * warm ends in `resetAccumulators`, so the trails and the surface memory a page is
   * mid-playback on are cleared for an install that changed no pixel of the shader.
   */
  'every-reload-warms': {
    file: 'web/main.js',
    edits: [['    if (!sameProgram) warmPrograms();', '    warmPrograms();']],
  },

  /**
   * `swap-keeps-the-old-program` puts the program swap back to `needsUpdate` alone. Three
   * releases a program's reference only from a material's `dispose` event, so every
   * GLSL-changing install leaves a whole compiled program linked and cached - on a page
   * whose entire point is being installed into again without a reload.
   */
  'swap-keeps-the-old-program': {
    file: 'web/point-cloud.js',
    edits: [[
      '  if (material.vertexShader === program.vertexShader\n'
      + '    && material.fragmentShader === program.fragmentShader) return;\n'
      + '  material.dispose();\n',
      '',
    ]],
  },

  /**
   * `poll-checks-once` asks whether a rebuild may happen on the way into the tick and never
   * again. Several dozen requests happen after that, which is long enough for an export to
   * start or a preset gesture to open - and the rebuild then lands inside it, replacing two
   * shader programs and every value between one frame of a file nobody can watch being made
   * and the next.
   */
  'poll-checks-once': {
    file: 'web/main.js',
    edits: [[
      '  const blocked = effectRebuildBlocked();\n  if (blocked) return null;',
      '  const blocked = null;\n  if (blocked) return null;',
    ]],
  },

  /**
   * `a-broken-shader-is-warm` drops the throw at the end of the warm, leaving the link
   * failure where three.js puts it: a line in a console nobody has open. The install
   * succeeds, the document is carried across, the poll announces that the page has been
   * rebuilt from the new effects, and the cloud renders nothing at all.
   */
  'a-broken-shader-is-warm': {
    file: 'web/main.js',
    edits: [[
      "    throw new Error(`this build's shaders did not compile after the effects changed - ${linkFailures[0]}`);",
      "    console.warn(`shaders did not compile: ${linkFailures[0]}`);",
    ]],
  },

  /**
   * `adopt-outside-the-transaction` puts the adoption back where it was: before the `try`
   * the rollback hangs off, so a throw out of the adoption itself walks straight past it.
   * Everything the adoption replaces is already replaced by the time `buildPanel` refuses a
   * parameter naming no panel group, so what it leaves behind is the half-migrated page the
   * whole transaction exists to make unreachable - a registry with no panel drawn from it.
   */
  'adopt-outside-the-transaction': {
    file: 'web/main.js',
    edits: [
      ['  let failure = null;\n  try {',
        '  adoptEffectPackages(fetched, programs, held);\n  let failure = null;\n  try {'],
      ['    adoptEffectPackages(fetched, programs, held);\n', ''],
    ],
  },

  /**
   * `the-sweep-eats-the-last-copy` puts the sweep back to removing every aside it finds,
   * which is what destroys a package rather than tidying after one. A crash between the two
   * renames of an install leaves the old copy in `<id>.<seq>.old` and nothing at `<id>` -
   * and the sweep runs first thing in the next install of that id, so the operation that
   * would have restored it deletes it.
   */
  'the-sweep-eats-the-last-copy': {
    file: 'server/effect-store.js',
    edits: [
      ["      if (entry.name.endsWith('.old') && !liveHere) continue;\n", ''],
      ['    this.recoverInterruptedInstalls();\n', ''],
    ],
  },

  /**
   * `package-files-follow-links` puts `statSync` back where `lstatSync` is, so the file
   * route asks about what a name points at rather than about the name. The user root is the
   * one directory in this program a client can write into, and a link planted there is then
   * read and served from wherever it aims.
   */
  'package-files-follow-links': {
    file: 'server/effect-store.js',
    edits: [['    if (!existsSync(path) || !lstatSync(path).isFile()) return null;',
      '    if (!existsSync(path) || !statSync(path).isFile()) return null;']],
  },

  /**
   * `poll-takes-any-body` stops holding `GET /effects` to the shape every reader of it
   * assumes. A 200 carrying anything else - a proxy's error page, a half-written response -
   * then reaches the signature comparison, which throws out of the interval callback and
   * rejects a promise nothing is awaiting, once every six seconds for the life of the page.
   */
  'poll-takes-any-body': {
    file: 'web/main.js',
    // **Two edits, because one of them is not the defect.** Defusing the array check alone
    // leaves the entry loop iterating `undefined`, which throws a TypeError inside
    // `listEffects` - inside the poll's own catch, where it is handled - so the mutated
    // build behaved exactly like the fixed one and the run came back NOT CAUGHT on a
    // mutation that had not reproduced anything. Both have to go for the shipped shape to
    // come back: `listEffects` answers `undefined`, and the signature comparison a line
    // later is outside every catch there is.
    edits: [
      ['  if (!body || !Array.isArray(body.effects)) {', '  if (body === undefined) {'],
      ['  for (const entry of body.effects) {', '  for (const entry of body.effects ?? []) {'],
    ],
  },

  /**
   * `poll-guards-late` raises the reentrancy guard after the list has come back rather than
   * on the way in, which is where it was. Two ticks then overlap - the interval does not
   * wait for the last one - and whichever finishes second wins, so with an install landing
   * between them the page settles on the packages it read first while its signature claims
   * the ones it read second, and the comparison agrees with itself from then on.
   */
  'poll-guards-late': {
    file: 'web/main.js',
    edits: [
      ['  if (effectReloading || effectRebuildBlocked()) return;\n  effectReloading = true;\n  try {',
        '  if (effectReloading || effectRebuildBlocked()) return;\n  try {'],
      ['    if (revSignature(listed) === effectSignature) return;\n    await pollRebuild();',
        '    if (revSignature(listed) === effectSignature) return;\n    effectReloading = true;\n    await pollRebuild();'],
    ],
  },

  /**
   * `reads-need-not-agree` takes the second list read off the end of the package fetch, so
   * a set is whatever the several dozen requests happened to return. An install landing
   * anywhere in that sequence is then served partly from before it and partly from after,
   * and the halves assemble into a program that compiles and draws something nobody wrote.
   */
  'reads-need-not-agree': {
    file: 'web/main.js',
    edits: [['    if (revSignature(await listEffects()) === revSignature(opened)) return packages;',
      '    if (opened) return packages;']],
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

/**
 * The same effect with one parameter more - the install a page holding this effect's
 * values cannot be carried onto.
 *
 * **A fork that adds is the one shape that turns a good install into a bad page.** A
 * document names every parameter of every effect it touches, because the loader's
 * per-effect completeness rule refuses half of one; so a document written against the two
 * parameters here names a subset of the three below, and the moment the third arrives the
 * loader refuses that document by its own rule. Nothing is wrong with the package, nothing
 * is wrong with the document, and the refusal is correct - what section 6 is about is
 * where the page is left standing when it fires.
 *
 * The added parameter reaches a pixel and is inert at its default, both deliberately: it
 * has to be a real parameter for the door to accept it and for the assembled program to
 * declare its uniform, and it has to change nothing at zero so the image the rollback
 * restores can be compared against the image before the install without the comparison
 * turning into a question about the fork's own look.
 */
const forkedProbe = () => {
  const pkg = probePackage();
  pkg.manifest.version = '2.0.0';
  pkg.manifest.params.glow = {
    def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe glow',
    panel: { group: 'probe', tab: 'look' },
    bind: { on: 'points', uniform: 'probeGlow' },
    under: 'amount',
  };
  pkg.chunks['decl.frag.glsl'] = 'uniform float probeAmount, probeHue, probeGlow;\n';
  pkg.chunks['tone.frag.glsl'] =
    '  if (probeAmount > 0.0) {\n'
    + '    col = mix(col, vec3(probeHue, 1.0 - probeHue, probeHue * 0.5), probeAmount);\n'
    + '    col += vec3(probeGlow * 0.25);\n'
    + '  }\n';
  return pkg;
};
const bent = (edit) => {
  const pkg = probePackage();
  edit(pkg);
  return pkg;
};

/**
 * The same package with a different version and byte-identical chunks - a rev that moves
 * and two programs that do not.
 *
 * A retuned bound, a corrected label, a version bump: most of what a package author
 * actually changes is the manifest, and none of it reaches the GLSL. The store's rev is a
 * hash over every file, so the poll sees a change and rebuilds - and the rebuild has
 * nothing to compile. What it must therefore not do is warm, because the warm ends in
 * `resetAccumulators`.
 */
const retunedProbe = () => {
  const pkg = probePackage();
  pkg.manifest.version = '1.0.1';
  pkg.manifest.params.hue.label = 'probe hue, retuned';
  return pkg;
};

/**
 * The same package with one more line of GLSL, so the assembled programs genuinely move.
 *
 * `n` makes each call a different program, which is what the row about released programs
 * needs: three installs that compile three distinct programs, against a renderer whose
 * cache would otherwise hold all three.
 */
const recompiledProbe = (n) => {
  const pkg = probePackage();
  pkg.manifest.version = `1.1.${n}`;
  pkg.chunks['tone.frag.glsl'] =
    '  if (probeAmount > 0.0) {\n'
    + `    col = mix(col, vec3(probeHue, 1.0 - probeHue, probeHue * ${(0.5 + n * 0.01).toFixed(2)}), probeAmount);\n`
    + '  }\n';
  return pkg;
};

/**
 * A package whose every identifier this build has and whose GLSL does not compile.
 *
 * **This is the shape the door cannot see and must not be asked to.** The door checks that
 * a chunk names nothing the build has not got; it is not a compiler and reimplementing one
 * here would be the second implementation this repo keeps refusing. So `col` is the spine's
 * own colour and `probeAmount` is this package's own uniform - both perfectly well known -
 * and assigning a `float` to a `vec3` is a type error the driver refuses at compile time.
 * The install succeeds, the page fetches it, the programs assemble, and the link fails.
 */
const brokenProbe = () => {
  const pkg = probePackage();
  pkg.manifest.version = '9.0.0';
  pkg.chunks['tone.frag.glsl'] = '  col = probeAmount;\n';
  return pkg;
};

/**
 * A grade effect, because the pass the grade runs in is gated and the gate is a list.
 *
 * Five shipped effects declare `gates` and every one of them was installed while the page
 * booted, so a list computed once is right about all of them and wrong about the first
 * package to arrive afterwards. This is that package: it binds a uniform of its own on the
 * grade table with `gates` set, so raising it has to switch the pass on and nothing else
 * on the page can do it.
 *
 * Its group is `post`, which is one of this build's own - a package inventing a group would
 * be testing the panel where this is about the pass.
 */
const gradeProbeManifest = () => ({
  format: 1,
  id: 'probegrade',
  version: '1.0.0',
  title: 'Probe Grade',
  params: {
    amount: {
      def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe grade',
      panel: { group: 'post', tab: 'look' },
      bind: { on: 'grade', uniform: 'probeGradeAmount', gates: true },
      role: 'master',
    },
  },
  chunks: [
    { stage: 'g.decl', order: 900, file: 'decl.grade.glsl' },
    { stage: 'g.body', order: 900, file: 'body.grade.glsl' },
  ],
});
const gradeProbePackage = () => ({
  manifest: gradeProbeManifest(),
  chunks: {
    'decl.grade.glsl': 'uniform float probeGradeAmount;\n',
    'body.grade.glsl': '      col *= mix(1.0, 0.5, probeGradeAmount);\n',
  },
});

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
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location()?.url ?? '';
    // **A package read that 404s while this tool is removing packages is the store
    // changing under a reader, which is a thing this build handles rather than a fault.**
    // `fetchEffectPackages` lists the store and then reads each id, and a `DELETE` landing
    // between those two answers 404 for an id the list had just named - which the read
    // refuses, the coherence check catches, and the next tick asks about again. The browser
    // logs every failed request as a console error whatever the page then does with it, and
    // this tool installs and removes packages several dozen times in a run where a person
    // would do it a handful of times a year. So exactly that shape is not collected, by
    // address rather than by message, and everything else still is.
    if (/\/effects\//.test(where) && /status of 404/.test(m.text())) return;
    pageErrors.push(where ? `${m.text()} (${where})` : m.text());
  });
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

  // ================= 6. an install the open document cannot be carried onto, and the way back
  //
  // **The install that succeeds on the server and cannot be adopted by this page.** Every
  // section above is about a rebuild that works; this one is about the one that does not,
  // and the claim is that the page is left whole rather than half-migrated. A fork adding a
  // parameter is the shape that produces it - the open document then names a subset of the
  // new manifest, and the loader's per-effect completeness rule refuses it, correctly and by
  // design. What must not happen is the page keeping the registry it just swapped in while
  // its parked pool still describes the build before last: those two disagreeing about which
  // names are live is a page no document can be saved from, and the serialiser reading a
  // stale parked copy over a value the registry is rendering is how that costs somebody
  // their work rather than their frame.
  //
  // **Driven through the poll rather than through `reload`**, because the note is one of the
  // things being asserted and the poll is the only thing in the product that writes it. The
  // rows below are the five separate facts a rollback has to leave true - the server did
  // adopt the install, the page said so by name, the registry is the one it had, the pixels
  // are the ones it drew, and a save still returns every parked key's own value - and they are
  // separate rows because a build can get any four of them right.
  console.log('\n[effect] 6. an install this page cannot carry the open document onto');

  // The reading taken on both sides of the install, as one function handed to the page
  // twice, so the before and the after cannot drift into being two different questions.
  const readPage = async (positions) => {
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
    const note = document.getElementById('tNote');
    return {
      hashes,
      names: k.params.names(),
      signature: k.effects.signature(),
      pool: k.library.parkedLook(),
      body: k.library.serialiseProjectBody(),
      badgeHidden: badge?.hidden ?? null,
      badgeText: badge?.textContent ?? '',
      note: note?.textContent ?? '',
    };
  };

  /** Everything a document says about the parked effect, as one comparable string. */
  const parkedKeysOf = (body) => JSON.stringify({
    params: Object.fromEntries(Object.entries(body.look.params).filter(([n]) => n.startsWith('probe.'))),
    tracks: Object.fromEntries(Object.entries(body.look.tracks).filter(([n]) => n.startsWith('probe.'))),
    requires: (body.requires ?? []).filter((e) => e.id === 'probe'),
  });

  // Caught in the page rather than allowed out, which is sections 3 and 4's shape and is
  // load-bearing here for the same reason: a mutation that breaks the rebuild takes this
  // driver down with it, and a run that stops on the way into this section stops before
  // section 7 runs at all. `reinstall-leaves-it-parked` is the one that does it - it leaves
  // a document the loader will not take in either direction, so the rollback's own refusal
  // fires - and it should redden a row here and carry on, not end the run.
  await del('probe');
  const reParked = await page.evaluate(async () => {
    try {
      await globalThis.__kinect.effects.reload();
      return { threw: null };
    } catch (err) {
      return { threw: String(err.message) };
    }
  });
  ok('the effect comes off again and the page rebuilds without it', reParked.threw === null,
    reParked.threw ?? 'no throw');
  const beforeFork = await page.evaluate(readPage, POSITIONS);

  ok('the effect is uninstalled again, so the document is holding it parked when the install below lands',
    beforeFork.names.includes('probe.amount') === false
      && Object.keys(beforeFork.pool.params).length === 2
      && Object.keys(beforeFork.pool.tracks).length === 1
      && beforeFork.badgeHidden === false,
    `${Object.keys(beforeFork.pool.params).length} values and ${Object.keys(beforeFork.pool.tracks).length} tracks parked, `
    + `badge hidden=${beforeFork.badgeHidden}`);
  // **The control for the identity row below, and it is a cross-state one rather than the
  // three-distinct-images row section 4 uses.** With the effect parked there is nothing
  // keyed left to separate the three positions from each other: the pinned run is six
  // frames at 33ms, so 0.6s and 1.2s both show the last of them and hash the same, and
  // section 4's three images differed because `probe.amount` was ramping across them. What
  // has to be shown here is that these hashes are a live reading of the look rather than a
  // constant, so they are held against the same three positions taken while the effect was
  // installed and raised - which is the state the rollback must *not* have left the page in.
  ok('and the parked picture is not the picture the installed effect drew, so these hashes read the look rather than the frame',
    JSON.stringify(beforeFork.hashes) !== JSON.stringify(authored.hashes),
    `${beforeFork.hashes.map((h) => h.slice(0, 8)).join(' ')} against ${authored.hashes.map((h) => h.slice(0, 8)).join(' ')}`);

  const fork = await put('probe', forkedProbe());
  const forkServed = await getJson('/effects/probe');
  ok('the fork installs: the server takes a package that is this effect with one parameter more',
    fork.status === 200 && forkServed.status === 200 && forkServed.body.manifest?.version === '2.0.0',
    `${fork.status}: ${fork.body.error ?? 'installed'}, the store now serves version ${forkServed.body.manifest?.version}`);

  // **Driven by the poll and then waited for, because the poll on the page competes with
  // the poll this line calls.** `pollNow` is the interval's own body and the interval is
  // still running, so a tick that started six seconds ago can be mid-read when this line
  // arrives - and the reentrancy guard, correctly, sends this call straight back. What has
  // to be true either way is that the page ends up reporting the refusal, so that is what
  // is waited for rather than assumed to have happened by the time `pollNow` resolves.
  // A build that never reports still fails, one interval later.
  await page.evaluate(() => globalThis.__kinect.effects.pollNow());
  await page.waitForFunction(
    "document.getElementById('tNote')?.textContent?.length > 0", null, { timeout: 20000 },
  ).catch(() => {});
  const afterFork = await page.evaluate(readPage, POSITIONS);

  ok('the page reports the refusal by name, and says which set it is still running',
    /probe\.glow/.test(afterFork.note) && /still running the effects it had/.test(afterFork.note),
    `"${afterFork.note.trim().slice(0, 120)}"`);
  ok('and the registry is the one this page had rather than the one the server is serving',
    JSON.stringify(afterFork.names) === JSON.stringify(beforeFork.names),
    afterFork.names.includes('probe.glow')
      ? 'probe.glow reached the registry, so the swap was kept'
      : `${afterFork.names.length} parameters, the same ${beforeFork.names.length} as before the install`);
  ok('and the signature with it, so nothing is left claiming to be assembled from a set it refused',
    afterFork.signature === beforeFork.signature,
    afterFork.signature === beforeFork.signature ? 'unchanged' : 'the page moved to the new set');
  ok('the parked pool is exactly what it was: the same values, the same track, the same entry',
    JSON.stringify(afterFork.pool) === JSON.stringify(beforeFork.pool),
    `${Object.keys(afterFork.pool.params).length} values, ${Object.keys(afterFork.pool.tracks).length} tracks`);
  ok('and the badge still quotes the version the edit was authored against rather than the one that just landed',
    afterFork.badgeHidden === false && /probe 1\.0\.0/.test(afterFork.badgeText),
    `hidden=${afterFork.badgeHidden}, "${afterFork.badgeText.trim().slice(0, 60)}"`);
  ok('the three positions render the same three images they rendered before the install',
    JSON.stringify(afterFork.hashes) === JSON.stringify(beforeFork.hashes),
    afterFork.hashes.map((h, i) => `${h.slice(0, 8)}${h === beforeFork.hashes[i] ? '=' : '!='}${beforeFork.hashes[i].slice(0, 8)}`).join(' '));
  ok('and a save afterwards writes the parked keys exactly as it wrote them before',
    parkedKeysOf(afterFork.body) === parkedKeysOf(beforeFork.body) && /probe\.amount/.test(parkedKeysOf(beforeFork.body)),
    parkedKeysOf(afterFork.body).slice(0, 110));

  // The document the rolled-back page writes, handed back to the loader that refused the
  // other one. A page whose pool and registry had gone out of step would write a document
  // its own reader refuses - `refuseRequires` runs in both directions - so this asks the
  // rollback for the property that actually matters rather than for the fields it left in
  // place.
  const reloadable = await page.evaluate(() => {
    const k = globalThis.__kinect;
    try {
      k.library.restoreProject(k.library.serialiseProjectBody());
      return { threw: null };
    } catch (err) {
      return { threw: String(err.message) };
    }
  });
  ok('and the document it writes is one this same page will take back', reloadable.threw === null,
    reloadable.threw ?? 'loaded');

  // The fork off again, so the store and the page hold the same set before section 7 - and
  // the row is worth having rather than being cleanup with an assertion stuck on it: the
  // signature is how the poll decides there is anything to do, and a page that had quietly
  // moved to the new set would converge here for the wrong reason.
  await del('probe');
  const converged = await page.evaluate(async () => {
    await globalThis.__kinect.effects.pollNow();
    return { signature: globalThis.__kinect.effects.signature() };
  });
  const storeNow = await getJson('/effects');
  const storeSignature = storeNow.body.effects.map((e) => `${e.id} ${e.rev}`).join('\n');
  ok('and with the fork taken back off, the page and the store are holding one set again',
    converged.signature === storeSignature, converged.signature === storeSignature ? 'agreed' : 'still apart');

  // ================================= 7. what a rebuild does to the rest of the panel
  //
  // **Everything on the panel that is not a parameter row, which is where a rebuild goes
  // wrong invisibly.** Sections 3 and 4 ask whether the parameters arrived and whether
  // their values are right, and a build can get both of those completely right while the
  // buttons beside them are dead, the tab that was showing has stopped being applied, the
  // collapse headers are painted for elements that no longer exist and the dialog that
  // picks a preset's subset is a statement of the registry from before the install. None
  // of those throws, none of them changes a pixel of the cloud, and each has its own
  // mutation below because each is a separate way of rebuilding the panel and forgetting
  // something.
  console.log('\n[effect] 7. the panel a rebuild leaves behind, beside the rows it rebuilt');

  // The state to be preserved is set up *before* the install, so what the rows below read
  // is a page that had been used rather than a page that had just booted - which is the
  // only state in which any of this is observable at all.
  const primed = await page.evaluate(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    // A stamp on the note the framing group emits, which is the sharpest reading of the
    // claim: the question is whether the element in the document after the rebuild is the
    // element `ui` is holding, and an attribute nothing else writes answers it directly.
    // The text beside it is the status line boot wrote through `ui.recRange` - a rebuilt
    // node carries the bare default the generator gives it and not this.
    const note = document.getElementById('recRange');
    note.dataset.effectCheckWitness = 'before-the-install';
    // A group the panel has painted shut, so `groupPainted` holds a state string for it
    // and the rebuild has something to get wrong. `post` because it is a core group that
    // survives every install below. The reset above puts every value at its default, which
    // is what derives a group closed, so the toggle is pressed only where the panel is
    // already showing it open - a click either way would otherwise be the gesture that
    // decides the state rather than the state itself.
    const post = document.querySelector('[data-group="post"]');
    if (!post.classList.contains('shut')) document.querySelector('[data-group-toggle="post"]').click();
    return {
      shown: k.cropBoxShown(),
      note: note.textContent,
      postShut: post.classList.contains('shut'),
      postExpanded: post.querySelector('.grouptoggle').getAttribute('aria-expanded'),
      lookNames: k.params.names('look').length,
      boxes: document.querySelectorAll('#ppGroups input[id^="pp-"]').length,
    };
  });
  ok('the page is in a state a rebuild can damage: a group shut by hand, a note carrying a status write, a stamp on it',
    primed.postShut === true && primed.postExpanded === 'false' && /capture keeps/.test(primed.note),
    `post shut=${primed.postShut} aria-expanded=${primed.postExpanded}, note ${JSON.stringify(primed.note.slice(0, 40))}`);

  await put('probe', probePackage());
  const rebuilt = await page.evaluate(async () => {
    await globalThis.__kinect.effects.reload();
    const k = globalThis.__kinect;
    // The control pressed rather than inspected. `show crop box` is one of the six the
    // framing group emits, and what it has to do is flip the flag the chrome draws from -
    // a listener on a detached node leaves the flag exactly where it was.
    const before = k.cropBoxShown();
    document.getElementById('cropBox').click();
    const after = k.cropBoxShown();
    const note = document.getElementById('recRange');
    const post = document.querySelector('[data-group="post"]');
    // The tab read off the button that says it is selected rather than off a reading the
    // page publishes for the purpose, which is `editor-check`'s own reading of the same
    // question: what a person can see is the panel, and the panel is what this asks.
    const active = document.querySelector('.paneltab[aria-selected="true"]')?.dataset.panelTab ?? null;
    const visible = [...document.querySelectorAll('#panelBody > [data-panel-tab]')]
      .filter((g) => !g.hidden);
    return {
      pressed: before !== after,
      pressedShows: after,
      aria: document.getElementById('cropBox').getAttribute('aria-pressed'),
      witness: note?.dataset.effectCheckWitness ?? null,
      noteText: note?.textContent ?? '',
      active,
      visibleTabs: [...new Set(visible.map((g) => g.dataset.panelTab))],
      offTab: visible.filter((g) => g.dataset.panelTab !== active)
        .map((g) => g.dataset.group || g.id),
      probeGroupHidden: document.querySelector('[data-group="probe"]')?.hidden ?? null,
      postShut: post.classList.contains('shut'),
      postExpanded: post.querySelector('.grouptoggle').getAttribute('aria-expanded'),
      boxes: [...document.querySelectorAll('#ppGroups input[type="checkbox"]')].map((b) => b.id),
      lookNames: k.params.names('look'),
    };
  });

  ok('a hand-written control inside a rebuilt group still works: pressing show crop box moves what the chrome draws from',
    rebuilt.pressed === true && rebuilt.aria === String(rebuilt.pressedShows),
    `the flag ${rebuilt.pressed ? 'moved' : 'did not move'}, the button reads aria-pressed=${rebuilt.aria}`);
  ok('and the node the page writes its status into is the node in the document, carrying what was written before the install',
    rebuilt.witness === 'before-the-install' && rebuilt.noteText === primed.note,
    `witness ${JSON.stringify(rebuilt.witness)}, note ${JSON.stringify(rebuilt.noteText.slice(0, 40))}`);

  ok('the tab that was showing is still the only one showing, over groups the rebuild has just made',
    rebuilt.offTab.length === 0 && rebuilt.probeGroupHidden === true,
    rebuilt.offTab.length
      ? `${rebuilt.offTab.length} groups from another tab are on screen: ${rebuilt.offTab.slice(0, 6).join(', ')}`
      : `${rebuilt.visibleTabs.join(', ')} showing under the ${rebuilt.active} tab, the probe's look group hidden`);

  ok('a group shut before the install is still shut after it, in the class the panel draws from and the attribute a reader hears',
    rebuilt.postShut === true && rebuilt.postExpanded === 'false',
    `shut=${rebuilt.postShut}, aria-expanded=${rebuilt.postExpanded}`);

  const pickedNames = rebuilt.boxes.filter((id) => id.startsWith('pp-')).map((id) => id.slice(3));
  ok('the preset subset dialog is a statement of the registry that exists now: the installed effect has its boxes',
    pickedNames.includes('probe.amount') && pickedNames.includes('probe.hue')
      && JSON.stringify([...pickedNames].sort()) === JSON.stringify([...rebuilt.lookNames].sort()),
    `${pickedNames.length} boxes against ${rebuilt.lookNames.length} look values, `
    + `probe ${pickedNames.filter((n) => n.startsWith('probe.')).join(' and ') || 'absent'}`);

  await del('probe');
  const unpicked = await page.evaluate(async () => {
    await globalThis.__kinect.effects.reload();
    const k = globalThis.__kinect;
    const boxes = [...document.querySelectorAll('#ppGroups input[type="checkbox"]')];
    // Every remaining box actually pressed, because the failure this closes is a handler
    // reading `PARAMS` for a name the registry no longer has - which is a throw out of a
    // tick rather than a box that looks wrong.
    let threw = null;
    for (const box of boxes) {
      try {
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change'));
      } catch (err) { threw ??= `${box.id}: ${err.message}`; }
    }
    return {
      names: boxes.filter((b) => b.id.startsWith('pp-')).map((b) => b.id.slice(3)),
      threw,
      count: document.getElementById('ppCount')?.textContent ?? '',
      lookNames: k.params.names('look'),
    };
  });
  ok('and the uninstalled effect has none, with every box left in the dialog still pressable',
    unpicked.names.includes('probe.amount') === false && unpicked.threw === null
      && JSON.stringify([...unpicked.names].sort()) === JSON.stringify([...unpicked.lookNames].sort()),
    unpicked.threw ?? `${unpicked.names.length} boxes against ${unpicked.lookNames.length} look values, readout "${unpicked.count}"`);

  // ============================ 8. what a rebuild costs, and what it must not interrupt
  //
  // **Four claims that are each about the rebuild rather than about its result.** The
  // grade pass is switched on by a list derived from the packages, so a set that arrives
  // later has to move it; a package that changed no GLSL must not pay for a warm, because
  // the warm ends by clearing the accumulators a page mid-playback is holding; a package
  // that did change GLSL must let go of the program it replaced, because three.js will not;
  // and a rebuild must ask whether it may land at the moment it would land rather than at
  // the moment it started reading.
  console.log('\n[effect] 8. the grade gate, the warm that must not happen, the program that must be let go, and the gesture that stands a rebuild down');

  const gradeInstall = await put('probegrade', gradeProbePackage());
  ok('a grade effect installs - one this build did not boot with, binding its own gating uniform',
    gradeInstall.status === 200, `${gradeInstall.status}: ${gradeInstall.body.error ?? 'installed'}`);

  const gated = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    await k.effects.reload();
    const atDefault = k.grade.enabled;
    k.params.set('probegrade.amount', 0.6);
    const raised = k.grade.enabled;
    return { atDefault, raised, value: k.grade.uniforms.probeGradeAmount?.value ?? null };
  });
  ok('the pass is shut with the new effect at its default, which is what a master being inert at zero means',
    gated.atDefault === false, `grade.enabled=${gated.atDefault}`);
  ok('and raising the installed effect opens it, so a package that arrived after boot is counted by existing',
    gated.raised === true && gated.value === 0.6,
    `grade.enabled=${gated.raised} with the uniform at ${gated.value}`);

  await del('probegrade');
  const ungated = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    await k.effects.reload();
    return { enabled: k.grade.enabled, value: k.grade.uniforms.probeGradeAmount?.value ?? null };
  });
  // The other direction, and it is a correctness row rather than a discriminating one:
  // five gated effects ship, a builtin cannot be uninstalled, and every one of them is
  // written by the value walk - so the walk's own re-ask already answers this on this
  // build. What it is here for is the state that has no gated parameter left at all,
  // which no mutation of this tree can reach and which the line in `adoptEffectPackages`
  // is what covers.
  ok('and taking it off shuts the pass again, on a uniform cell that is still carrying the value it was raised to',
    ungated.enabled === false && ungated.value === 0.6,
    `grade.enabled=${ungated.enabled}, probeGradeAmount still ${ungated.value}`);

  // ---- the warm, and the accumulators it clears
  //
  // **Read off `counters.resets`, which is the page's own count of how many times the
  // accumulators have been thrown away.** The obvious reading - how many frames the
  // rebuild rendered - is not deterministic here: `reloadEffects` awaits several dozen
  // requests, and the animation loop repaints during them, so a correct build shows a
  // handful of frames for reasons that have nothing to do with the warm. The reset counter
  // moves only where `resetAccumulators` runs, and on this path the only thing that runs
  // it is `warmPrograms`.
  await put('probe', probePackage());
  await page.evaluate(async () => { await globalThis.__kinect.effects.reload(); });

  await put('probe', retunedProbe());
  const quietReload = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = k.timeline.counters.resets;
    await k.effects.reload();
    return {
      resets: k.timeline.counters.resets - before,
      // Read off the row the panel drew rather than off the registry, because
      // `params.spec` answers with a projection that carries the bounds and not the words.
      // The label on screen is the thing the retune is about anyway.
      label: document.getElementById('probe.hue')?.closest('.row')?.querySelector('span')?.textContent ?? null,
      knows: k.params.names().includes('probe.hue'),
    };
  });
  ok('a package that changed only its manifest is adopted - the label the rebuild is about did move',
    quietReload.label === 'probe hue, retuned' && quietReload.knows,
    `the registry reads ${JSON.stringify(quietReload.label)}`);
  ok('and it threw no accumulator away doing it, because the assembled programs are the ones already compiled',
    quietReload.resets === 0,
    `${quietReload.resets} accumulator resets across a rebuild that changed no GLSL`);

  // The control, and it is the same reading taken across the case that *must* warm. A row
  // saying nothing happened, on its own, is satisfied by a build that had stopped
  // rebuilding at all.
  await put('probe', recompiledProbe(1));
  const loudReload = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = k.timeline.counters.resets;
    await k.effects.reload();
    return {
      resets: k.timeline.counters.resets - before,
      inShader: k.effects.programs().cloud.fragmentShader.includes('probeHue * 0.51'),
    };
  });
  ok('and a package that did change its GLSL does warm, which is what makes the row above a distinction rather than a build that stopped rebuilding',
    loudReload.resets === 1 && loudReload.inShader === true,
    `${loudReload.resets} resets, the new chunk text ${loudReload.inShader ? 'reached' : 'did not reach'} the assembled program`);

  // ---- the programs the swap replaces
  //
  // Counted off `renderer.info.programs`, which is the renderer's own cache and the only
  // reading here that is not this tool agreeing with itself. Three installs of three
  // distinct programs: three.js releases a program only from a material's `dispose` event,
  // so a build that swaps with `needsUpdate` alone holds one more program after every one
  // of them and a build that lets go holds what it started with.
  const beforeGrowth = await page.evaluate(() => {
    // Rendered first, so the count is taken after the driver has actually compiled what
    // the page is holding rather than before it has been asked for anything.
    globalThis.__kinect.drive.stepTo(0.4);
    return globalThis.__kinect.renderer.info.programs.length;
  });
  const growthCounts = [];
  for (let n = 2; n <= 4; n++) {
    await put('probe', recompiledProbe(n));
    growthCounts.push(await page.evaluate(async () => {
      const k = globalThis.__kinect;
      await k.effects.reload();
      k.drive.stepTo(0.4);
      return k.renderer.info.programs.length;
    }));
  }
  ok('three GLSL-changing installs do not grow the renderer\'s program cache, because the swap releases what it replaced',
    growthCounts.every((n) => n <= beforeGrowth),
    `${beforeGrowth} programs before, ${growthCounts.join(' then ')} after each of three installs`);

  // ---- a rebuild that must stand down where it stands
  //
  // **The gesture goes up while the rebuild is reading, which is the whole of what this
  // row is about.** A rebuild that only asked on its way in would pass a check that raised
  // the flag first; what has to be shown is that the answer is asked again after the last
  // fetch and before the first write. The package read is held open by the driver, the
  // preset dialog is opened in the page while it hangs, and then it is let go.
  //
  // The gesture is a preset subset rather than an export because this surface has no take
  // to export - and the three conditions are one predicate, `effectRebuildBlocked`, so the
  // arm that reaches it reaches all three. That is the reason a predicate exists rather
  // than three tests written out at two call sites.
  await put('probe', recompiledProbe(9));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/effects/probe', async (route) => {
    await held;
    await route.continue();
  });
  const deferred = page.evaluate(async () => {
    const k = globalThis.__kinect;
    const was = k.effects.signature();
    const answer = await k.effects.reload();
    return { answer, was, now: k.effects.signature(), names: k.params.names().length };
  });
  // Long enough for the reload to have reached the held request and not so long that a
  // slow machine reads as a finding: the assertion is on what the reload answers, and a
  // gesture that went up before the fetch started would be the poll's entry check firing
  // instead - which is why the flag is read back below.
  await wait(400);
  const gestureUp = await page.evaluate(() => {
    document.getElementById('tPresetSave').click();
    return globalThis.__kinect.library.presetGestureRunning();
  });
  release();
  const stoodDown = await deferred;
  await page.unroute('**/effects/probe');
  ok('a gesture opening while the rebuild was reading is a gesture the rebuild stands down for',
    gestureUp === true && stoodDown.answer === null && stoodDown.now === stoodDown.was,
    `the gesture was ${gestureUp ? 'up' : 'down'}, the rebuild answered ${JSON.stringify(stoodDown.answer)}, `
    + `the signature ${stoodDown.now === stoodDown.was ? 'did not move' : 'moved'}`);

  // **Waited for rather than counted in turns of the loop**, and the first spelling of this
  // was the latter: the cancel closes the dialog, the dialog's `close` event resolves the
  // picker's promise, and the flag comes down in a `finally` several hops after that - so a
  // `setTimeout(0)` read it on its way down about half the time. What is being asserted is
  // what happens once the gesture is genuinely over, so the gesture being over is a
  // precondition to wait for rather than a step to assume.
  await page.evaluate(() => { document.getElementById('ppCancel').click(); });
  const gestureDown = await page.waitForFunction(
    'globalThis.__kinect.library.presetGestureRunning() === false', null, { timeout: 10000 },
  ).then(() => true).catch(() => false);
  const storeAfterGesture = await getJson('/effects');
  const wantSignature = storeAfterGesture.body.effects.map((e) => `${e.id} ${e.rev}`).join('\n');
  // The same reason section 6 waits for its note: the interval on the page is still
  // running, so `pollNow` can be answered by its own reentrancy guard while the tick that
  // holds it does the work a moment later. What has to be true is that the page converges,
  // and a build that never does still fails an interval later.
  const resumedConverged = await page.evaluate(async () => { await globalThis.__kinect.effects.pollNow(); })
    .then(() => page.waitForFunction(
      (want) => globalThis.__kinect.effects.signature() === want, wantSignature, { timeout: 20000 },
    ))
    .then(() => true).catch(() => false);
  ok('and the same rebuild lands as soon as the gesture is over, so standing down deferred it rather than dropping it',
    gestureDown === true && resumedConverged === true,
    gestureDown ? (resumedConverged ? 'the page converged on the store' : 'the page never converged on the store')
      : 'the gesture never came down');

  // ---- what the poll does with an answer it cannot use
  //
  // **Three ways the converging read goes wrong that have nothing to do with the packages
  // being wrong**, and all three are silent. A body that is not a list of ids and revs used
  // to throw past every guard the poll had, once every six seconds for the life of the
  // page; two ticks overlapping let the older of two reads win and then agree with itself
  // forever; and a package set read across an install is one package from before it beside
  // another from after, spliced into a program that compiles and draws something nobody
  // wrote.
  console.log('    (and what the poll does with an answer it cannot use)');

  await page.route('**/effects', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ nope: 'this is not a store' }),
  }));
  const nonsense = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const was = { signature: k.effects.signature(), names: k.params.names().length };
    let threw = null;
    try { await k.effects.pollNow(); } catch (err) { threw = String(err.message); }
    return { threw, was, signature: k.effects.signature(), names: k.params.names().length };
  });
  await page.unroute('**/effects');
  ok('a 200 carrying a body this build cannot read is a tick that does nothing rather than a rejection every six seconds',
    nonsense.threw === null && nonsense.signature === nonsense.was.signature
      && nonsense.names === nonsense.was.names,
    nonsense.threw ? `the poll threw: ${nonsense.threw.slice(0, 90)}` : `the page kept its ${nonsense.names} parameters and its signature`);

  // Two ticks at once, with the list held open so the second arrives while the first is
  // still reading. The count is taken in the driver rather than in the page, because what
  // is being asked is how many times the store was read.
  //
  // **The read that is in flight is waited for rather than started**, and that is the
  // difference between this row and the one that failed on a third run in three. The
  // interval on the page is still going, so a call to `pollNow` can be answered by the very
  // guard this row is about - correctly - and then nothing is in flight at all, and a fixed
  // pause counts zero reads on a build that is working. Whoever starts the read is
  // immaterial to the claim: while one is in flight, a second must not start.
  let listCalls = 0;
  let releaseList;
  const listHeld = new Promise((resolve) => { releaseList = resolve; });
  await page.route('**/effects', async (route) => {
    listCalls += 1;
    if (listCalls === 1) await listHeld;
    await route.continue();
  });
  const firstTick = page.evaluate(() => globalThis.__kinect.effects.pollNow()).catch(() => {});
  // Up to one whole interval plus the read itself, because if the driver's own call is the
  // one the guard turns away then the tick that holds it is the one being waited for.
  let inFlight = false;
  for (let waited = 0; waited < 9000 && !inFlight; waited += 100) {
    inFlight = listCalls >= 1;
    if (!inFlight) await wait(100);
  }
  const secondTick = page.evaluate(() => globalThis.__kinect.effects.pollNow()).catch(() => {});
  await wait(400);
  const duringOverlap = listCalls;
  releaseList();
  await Promise.all([firstTick, secondTick]);
  await page.unroute('**/effects');
  ok('a second tick arriving while the first is still reading does not read too: the guard is up before the fetch rather than after it',
    inFlight === true && duringOverlap === 1,
    inFlight
      ? `${duringOverlap} reads of the store were in flight at once${listCalls > duringOverlap ? `, ${listCalls} in all` : ''}`
      : 'no read of the store ever went out, so nothing was held and this row measured nothing');

  // A set read across an install, staged by answering the *verification* read with a
  // signature that has moved. What the page must not do is assemble the two halves.
  await put('probe', recompiledProbe(5));
  let listReads = 0;
  await page.route('**/effects', async (route) => {
    listReads += 1;
    const res = await route.fetch();
    const body = await res.json();
    // Every second read is the one taken after the packages have been fetched, and moving
    // a rev in it is exactly what an install landing mid-read looks like from here.
    if (listReads % 2 === 0) body.effects[0].rev = `${body.effects[0].rev}-moved`;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const incoherent = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const was = k.effects.signature();
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, held: k.effects.signature() === was, knows: k.params.names().includes('probe.hue') };
  });
  await page.unroute('**/effects');
  ok('a store that moves while the page is reading it is refused rather than assembled from both halves',
    incoherent.threw !== null && /moved while this page was reading them/.test(incoherent.threw ?? '')
      && incoherent.held === true,
    incoherent.threw ? `"${incoherent.threw.slice(0, 110)}", the signature ${incoherent.held ? 'held' : 'moved'}`
      : 'the rebuild reported success on a set read across two revisions');
  const coherent = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    await k.effects.reload();
    return k.effects.programs().cloud.fragmentShader.includes('probeHue * 0.55');
  });
  ok('and the same set read with nothing moving is adopted, so the rule above is a distinction rather than a refusal to read at all',
    coherent === true, coherent ? 'the fifth recompiled chunk reached the assembled program' : 'the page did not adopt it');

  // ================================ 9. a package this build can store and cannot compile
  //
  // **The door is not a compiler and this is the gap that leaves.** Every identifier in the
  // chunk below is one this build has - `col` is the spine's own colour, `probeAmount` is
  // the package's own uniform - so the door has nothing to refuse it for, and it is a type
  // error the driver rejects at link time. WebGL reports that through a log rather than an
  // exception and three.js passes it on the same way, so the install succeeded, the
  // document was carried across, the poll said the page had been rebuilt, and the cloud
  // drew nothing at all with no sentence anywhere.
  console.log('\n[effect] 9. a package this build can store and cannot use');

  const broken = await put('probe', brokenProbe());
  ok('the server takes it: every name in it is one this build has, which is all the door can ask',
    broken.status === 200, `${broken.status}: ${broken.body.error ?? 'installed'}`);

  const refused = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = { names: k.params.names(), signature: k.effects.signature() };
    let threw = null;
    try {
      await k.effects.reload();
    } catch (err) { threw = String(err.message); }
    return {
      threw,
      names: k.params.names(),
      same: JSON.stringify(k.params.names()) === JSON.stringify(before.names),
      signature: k.effects.signature(),
      signatureHeld: k.effects.signature() === before.signature,
      note: document.getElementById('tNote')?.textContent ?? '',
      shader: k.effects.programs().cloud.fragmentShader.includes('col = probeAmount;'),
    };
  });
  ok('the page refuses it rather than adopting it, and says the shaders did not compile',
    refused.threw !== null && /did not compile/.test(refused.threw ?? ''),
    refused.threw ? `"${refused.threw.slice(0, 130)}"` : 'the rebuild reported success');
  ok('and it is back on the programs it was drawing with: the registry it had, the signature it had, and none of the broken text',
    refused.same === true && refused.signatureHeld === true && refused.shader === false,
    `${refused.names.length} parameters, the signature ${refused.signatureHeld ? 'held' : 'moved'}, `
    + `the broken line ${refused.shader ? 'reached the assembled program' : 'did not'}`);

  const mended = await del('probe');
  const mendedPage = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, knows: k.params.names().includes('probe.amount') };
  });
  ok('and taking the package back off restores the page, so a build that cannot compile is a state to leave rather than one to be stuck in',
    mended.status === 200 && mendedPage.threw === null && mendedPage.knows === false,
    mendedPage.threw ?? 'the page rebuilt without it');

  // ---- and a package that never went through the door at all
  //
  // **The rollback has to cover the adoption itself and not only what runs after it.** The
  // door refuses a parameter naming a panel group nothing holds, and the store is still a
  // directory: a package written into the user root by hand - a copy from another machine,
  // an editor, a script - reaches the page having been checked by nothing. It assembles
  // fine, because it declares no GLSL; what it does is make `buildPanel` throw on the stray
  // parameter, **after** the registry, the panel maps and the shader programs have already
  // been replaced. With the adoption outside the transaction that throw walked past the
  // rollback and left the page holding a registry with no panel drawn from it.
  //
  // Written straight into the root rather than sent through `PUT`, which is the only way to
  // reach this: the door's whole job is that this package cannot arrive that way.
  const outside = join(USER_ROOT, 'probebad');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'manifest.json'), `${JSON.stringify({
    format: 1,
    id: 'probebad',
    version: '1.0.0',
    title: 'Probe Bad',
    params: {
      amount: {
        def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe bad',
        panel: { group: 'nosuchgroup', tab: 'look' },
        bind: { on: 'points', uniform: 'probeBadAmount' },
        role: 'master',
      },
    },
  }, null, 2)}\n`);
  const unusable = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = { names: k.params.names(), signature: k.effects.signature() };
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    // The panel asked for from the document rather than from a map, because the state this
    // is about is a registry with no rows drawn from it - and a rebuilt panel that matched
    // the rolled-back registry is the whole claim.
    const rows = [...document.querySelectorAll('#panelBody [data-group] input')].map((i) => i.id);
    return {
      threw,
      same: JSON.stringify(k.params.names()) === JSON.stringify(before.names),
      signatureHeld: k.effects.signature() === before.signature,
      knows: k.params.names().includes('probebad.amount'),
      rowsMatchRegistry: k.params.names().filter((n) => rows.includes(n)).length === rows.length && rows.length > 0,
    };
  });
  ok('a package written past the door is refused by the page, and the refusal comes out of the adoption rather than out of the document',
    unusable.threw !== null && /nosuchgroup|name no panel group/.test(unusable.threw ?? ''),
    unusable.threw ? `"${unusable.threw.slice(0, 120)}"` : 'the rebuild reported success');
  ok('and the page is whole afterwards: the registry it had, the signature it had, and a panel whose rows are that registry',
    unusable.same === true && unusable.signatureHeld === true && unusable.knows === false
      && unusable.rowsMatchRegistry === true,
    `the registry ${unusable.same ? 'held' : 'moved'}, the signature ${unusable.signatureHeld ? 'held' : 'moved'}, `
    + `the panel's rows ${unusable.rowsMatchRegistry ? 'are all registry names' : 'do not match the registry'}`);
  rmSync(outside, { recursive: true, force: true });
  const afterOutside = await page.evaluate(async () => {
    let threw = null;
    try { await globalThis.__kinect.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, names: globalThis.__kinect.params.names().length };
  });
  ok('and removing it lets the page rebuild again, so the refusal is a state to leave rather than one to be stuck in',
    afterOutside.threw === null, afterOutside.threw ?? `${afterOutside.names} parameters`);

  // =========================================== 10. what a crashed install leaves behind
  //
  // **Last, and the position is the finding rather than housekeeping.** Everything in
  // this block leaves a directory in the user root that is not a package, and under
  // `temporaries-are-visible` the store then cannot list at all - so a temporary staged
  // in section 1 would have reddened every row of every section after it with a fault
  // whose cause is five sections away. Put here, the mutation reddens the two rows it is
  // about and nothing else, which is the difference between a control that names a
  // property and one that fails everything.
  console.log('\n[effect] 10. and what a crashed install leaves behind is invisible until it is swept');

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

  // ============ 11. what somebody plants in the user root, and the window a crash lands in
  //
  // **The one place this store can lose work, and it is three lines wide.** `install`
  // swaps the old copy aside and then swaps the new one in, and between those two renames
  // the id resolves to nothing: a machine losing power there comes back with the only copy
  // of the package in `<id>.<seq>.old`, every read answering from the builtin as though it
  // had been uninstalled, and - before this - the next install of that id sweeping the
  // aside away as rubbish. The recovery that would have saved it was the thing that
  // destroyed it.
  //
  // **Driven by restarting the server, because the recovery is a fact about starting up.**
  // The browser is closed first: the page's own poll would report a store that stopped
  // answering, which is correct behaviour and has nothing to do with what is being asked
  // here. Everything below is HTTP against a store that has just been constructed over a
  // directory somebody crashed in.
  console.log('\n[effect] 11. an install interrupted between its two renames, and what the next start does about it');

  await browser.close();
  browser = null;

  // A file that is not a file, planted where only a client can write.
  //
  // **The name rule stops a path in the request and says nothing about a path already on
  // disk.** `VALID_FILE_NAME` refuses `../secret`, and it accepts `leak.txt` - so a link
  // called `leak.txt` sitting in a package directory was a name the route would build a
  // path out of, `statSync` would follow, `isFile()` would agree with, and `readFileSync`
  // would serve from wherever it aimed. The install door writes ordinary files and nothing
  // else, so what is asked here is that the read agrees: a package file is a regular file,
  // and a link is refused whether or not it points somewhere legitimate.
  //
  // **The package is written straight into the user root rather than installed**, and for
  // both of the reasons this block sits after the browser has been closed. Written, it
  // depends on no row above it - one mutation of this tool leaves the store unable to
  // install anything at all, and a row whose fixture is the previous row's output turns
  // that into a crash rather than into the two red rows it is about. And a package the page
  // would have to adopt has no business appearing in the store while a page is polling it.
  //
  // The ordinary file beside it is what stops these rows passing on a route that refused
  // everything, which is the same shape section 2's must-accept package has.
  const secret = join(WORK, 'not-a-package-file.txt');
  writeFileSync(secret, 'this text is outside both effect roots\n');
  const linkRoot = join(USER_ROOT, 'probelink');
  mkdirSync(linkRoot, { recursive: true });
  writeFileSync(join(linkRoot, 'manifest.json'), `${JSON.stringify({
    format: 1, id: 'probelink', version: '1.0.0', title: 'Probe Link', params: {},
  }, null, 2)}\n`);
  writeFileSync(join(linkRoot, 'notes.txt'), 'an ordinary file in a package directory\n');
  symlinkSync(secret, join(linkRoot, 'leak.txt'));
  const leaked = await fetch(`${BASE}/effects/probelink/file/leak.txt`);
  const leakedText = await leaked.text();
  ok('a symlink planted in a package directory is not a package file, whatever it points at',
    leaked.status === 404 && !leakedText.includes('outside both effect roots'),
    `answered ${leaked.status}${leakedText.includes('outside both effect roots') ? ' with the bytes it pointed at' : ''}`);
  const served = await fetch(`${BASE}/effects/probelink/file/notes.txt`);
  const servedText = await served.text();
  ok('and an ordinary file in the same directory still serves, so the rule above is about the kind rather than about the route',
    served.status === 200 && servedText.includes('an ordinary file in a package directory'),
    `answered ${served.status} with ${servedText.length} bytes`);
  const listedWithLink = await getJson('/effects/probelink');
  ok('and it is in no file index either, so nothing anywhere offers it',
    listedWithLink.status === 200
      && listedWithLink.body.files.some((f) => f.name === 'notes.txt')
      && !listedWithLink.body.files.some((f) => f.name === 'leak.txt'),
    listedWithLink.body.files?.map((f) => f.name).join(', ') ?? 'no index');
  rmSync(linkRoot, { recursive: true, force: true });

  await stopAll();

  // The crash, staged exactly as `install` would have left it: the package's own files in
  // an aside carrying the `.old` suffix, and nothing at the live id.
  //
  // Written rather than renamed out of whatever section 10 left behind, on the same
  // reasoning as the block above it: a fixture that is the previous row's output turns a
  // mutation that broke installing into a crash here instead of into the red rows it is
  // about.
  const crashedAside = join(USER_ROOT, 'probe.4711.tmpseq.old');
  rmSync(join(USER_ROOT, 'probe'), { recursive: true, force: true });
  rmSync(crashedAside, { recursive: true, force: true });
  mkdirSync(crashedAside, { recursive: true });
  writeFileSync(join(crashedAside, 'manifest.json'), `${JSON.stringify(probeManifest(), null, 2)}\n`);
  for (const [name, text] of Object.entries(probeChunks())) writeFileSync(join(crashedAside, name), text);
  writeFileSync(join(crashedAside, 'witness.marker'), 'the copy that was live when the machine went down\n');
  ok('a crashed install is staged: the package is in its aside and the id resolves to nothing',
    existsSync(crashedAside) && !existsSync(join(USER_ROOT, 'probe')),
    `user root holds ${userRootHolds().join(', ')}`);

  await start();
  const recovered = await getJson('/effects/probe');
  ok('the next start puts it back, so the copy a crash orphaned is the copy the store comes up on',
    recovered.status === 200 && recovered.body.builtin === false
      && existsSync(join(USER_ROOT, 'probe', 'witness.marker')),
    `answered ${recovered.status}, builtin=${recovered.body.builtin}, user root ${userRootHolds().join(', ')}`);
  ok('and the aside is gone rather than left beside the copy it became, so nothing accumulates',
    !existsSync(crashedAside), `user root ${userRootHolds().join(', ')}`);

  // **The control, and it is the direction the recovery must not run in.** A `remove` also
  // renames a directory aside before deleting it, so a crash there leaves the same shape -
  // and a recovery that could not tell the two apart would undo somebody's uninstall on
  // every restart. The suffix is what tells them apart, and this is the row that says so.
  const removedForGood = await del('probe');
  const goneAsides = userRootHolds();
  await stopAll();
  await start();
  const stillGone = await getJson('/effects/probe');
  ok('an uninstall is not a crashed install: the package stays removed across a restart',
    removedForGood.status === 200 && stillGone.status === 404,
    `after the restart the store answers ${stillGone.status} for probe, `
    + `user root ${userRootHolds().join(', ') || 'empty'} (was ${goneAsides.join(', ') || 'empty'})`);
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
