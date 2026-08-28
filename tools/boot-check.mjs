#!/usr/bin/env node
// The post-boot state diff: for every parameter the registry declares, the control the panel
// drew shows the value the registry holds for the selected clip. The clip is in the claim
// because a clip value now has one per clip, and a panel showing the wrong clip's number is a
// build where the registry is right and the operator is grading blind. The comparison has to be
// registry-versus-control -
// in the fault the registry holds correct values and only the controls are wrong, so a diff
// against declared defaults compares defaults to defaults and reports nothing. Homed on the
// recorder, which boots the full panel with no grabber and no sensor.
//
// The second claim, off the same server: a document is adopted whole or not at all. Both doors a
// document comes through - the synchronous `restoreProject` and the fetching `loadProjectNamed` -
// are asked to refuse a bad one with the editor still holding what it had, and the take door is
// asked to refuse footage without leaving it cached as opened. That needs `/edit` and one
// capture, so this tool synthesises its own into the temporary directory it boots the server on.
// Needs a GPU browser and a free port.

import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const PORT = Number(flag('--port', '8391'));
const HEADED = argv.includes('--headed');
const MUTATE = argv.includes('--mutate') ? flag('--mutate') : null;

// Identity tests against `server/index.js`'s own routing rather than a suffix rule: "ends in .html,
// so serve it as the page" hands `web/menu.html` over as the recorder's document, and every row
// below then asserts against a page nobody wrote.
const RECORDER_PATH = '/record';

/** The take this run synthesises for itself, and the project it writes naming it. */
const PROBE_TAKE = 'bootprobe';
const NULL_TAKE_PROJECT = 'bootprobenulltake';

// `reset-before-the-panel-generator` is the shipped fault itself, put back by lifting
// `buildPanel()` from above the value walk to below it. It has to boot: a mutation that throws
// during module evaluation publishes no `globalThis.__kinect`, every tool in the suite reports DID
// NOT RUN, and an exit code with no assertion behind it is not a usable mutation.
const MUTATIONS = {
  'reset-before-the-panel-generator': {
    file: 'web/main.js',
    edits: [
      ['\n  buildPanel();\n', '\n'],
      [
        '      params.set(name, Object.hasOwn(was, name) ? was[name] : PARAMS[name].def);\n    }\n  });\n',
        '      params.set(name, Object.hasOwn(was, name) ? was[name] : PARAMS[name].def);\n    }\n  });\n  buildPanel();\n',
      ],
    ],
  },
  // The pre-fix build exactly: the panel was written by value writes alone, so selecting a clip
  // left every clip-scope control showing the clip that had been selected before it. Must redden
  // only the selection rows below - the boot diff is against one clip and passes either way.
  'panel-does-not-follow-the-selection': {
    file: 'web/main.js',
    edits: [[
      '  paintClipPanel();\n  paintGizmo();\n  // The retime binding',
      '  paintGizmo();\n  // The retime binding',
    ]],
  },
  // Package rows exist because the registry owns them, but none belongs in a fresh sidebar. Must
  // redden exactly the package-row visibility assertion below.
  'effect-rack-shows-every-effect': {
    file: 'web/main.js',
    edits: [[
      'function effectPresent(id) {\n  return rackedEffects.has(id) || effectTouched(id);\n}',
      'function effectPresent(id) {\n  return true;\n}',
    ]],
  },
  // The pre-fix build exactly: the document door normalised a block's track keys and copied its
  // plain values in raw, so a clip value that is not a number was caught by `params.apply` with
  // the project's look and every earlier clip already written. Must redden exactly one row,
  // measured - the one about what the editor is left holding, and only that one, because the
  // refusal still arrives and still names the parameter, just too late to matter.
  'document-door-takes-a-clip-parameter-raw': {
    file: 'web/main.js',
    edits: [[
      '    applied[name] = params.normalise(name, value);\n',
      '    applied[name] = value;\n',
    ]],
  },
  // The falsification control for the section above it: the door's normalise hoisted above the
  // parked `continue`, so a value belonging to an effect this build has not got is held to a spec
  // that does not exist here. Must redden the two rows about what the parked pool came back
  // holding, and the row above them that says the document was taken at all - `specOf` throws
  // `unknown parameter` rather than returning nothing, so this refuses the document outright.
  'the-door-normalises-a-parked-value': {
    file: 'web/main.js',
    edits: [[
      '    if (parkedNames.has(name)) {\n      parked.params[name] = value;\n      continue;\n    }\n',
      '    const held = params.normalise(name, value);\n    if (parkedNames.has(name)) {\n      parked.params[name] = held;\n      continue;\n    }\n',
    ]],
  },
  // And the pre-fix build's other half: a clip naming no take was accepted by `checkProject`,
  // and the refusal sat inside the loop over the clips whose footage changed - which a null take
  // landing in a slot with no source is filtered out of before it gets there. Must redden four
  // rows, measured: the two carrying the claim, one per shape, and the two beside them that
  // redden because the document this one accepted took their fixture away - the edit grows a clip
  // pointed at the live stream, and the gallery page comes up on a look it should never have
  // applied. The recorder's own null-take row must stay green.
  'document-door-takes-a-clip-with-no-take': {
    file: 'web/main.js',
    edits: [[
      '      if (EDITING) {\n        throw new Error(\n',
      '      if (false) {\n        throw new Error(\n',
    ]],
  },
  // The take door as it shipped: the take was cached and stamped with its hello before either
  // refusal read it, so a take refused for its capture format stayed in `openTakes` reading as
  // open and the synchronous restore adopted it. Must redden exactly one row, measured, and the
  // two control rows above it have to stay green - they are what says the refusal happened at
  // all, and a mutation that reddened those would be one that broke the fixture.
  'a-refused-take-stays-cached': {
    file: 'web/main.js',
    edits: [
      [
        '  const take = openTakes.get(id) ?? await IndexedTake.open(id);\n  const res = await fetch(',
        '  const take = openTakes.get(id) ?? await IndexedTake.open(id);\n  openTakes.set(id, take);\n  const res = await fetch(',
      ],
      [
        '  const hello = await res.json();\n  // Which generation wrote this, before anything is done with the take it describes.\n',
        '  const hello = await res.json();\n  take.hello = hello;\n',
      ],
      [
        '  take.hello = hello;\n  openTakes.set(id, take);\n  return { id, take, hello };\n',
        '  return { id, take, hello };\n',
      ],
    ],
  },
};

if (argv.includes('--mutate') && !MUTATIONS[MUTATE]) {
  console.log(`[boot] DID NOT RUN - no mutation named ${MUTATE ?? '(nothing was given)'};`
    + ` this tool knows ${Object.keys(MUTATIONS).join(', ')}`);
  process.exit(2);
}

/**
 * The mutated bytes, or null. Every edit has to match exactly once, and a miss is exit 2
 * rather than a failed assertion: a replacement matching nothing would run the unmutated page
 * and be recorded as the check having missed a bug it was never shown.
 */
function mutatedSource() {
  if (!MUTATE) return null;
  const spec = MUTATIONS[MUTATE];
  let src = readFileSync(join(ROOT, spec.file), 'utf8');
  for (const [from, to] of spec.edits) {
    const hits = src.split(from).length - 1;
    if (hits !== 1) {
      console.log(`[boot] DID NOT RUN - the ${MUTATE} anchor matched ${hits} times in ${spec.file},`
        + ' so nothing was mutated and this run would prove nothing');
      process.exit(2);
    }
    src = src.replace(from, to);
  }
  return src;
}

const mutation = MUTATE ? { file: MUTATIONS[MUTATE].file, body: mutatedSource() } : null;
if (MUTATE) {
  console.log(`[boot] MUTATED BUILD: ${MUTATE} in ${mutation.file} - this run is expected to FAIL`);
} else {
  console.log('[boot] unmutated tree');
}

let checked = 0;
let failed = 0;
const fired = [];
const check = (ok, line, detail = '') => {
  checked++;
  if (ok) {
    console.log(`  ok    ${line}${detail ? ` - ${detail}` : ''}`);
  } else {
    failed++;
    fired.push(line);
    console.log(`  FAIL  ${line}${detail ? ` - ${detail}` : ''}`);
  }
};

/**
 * Everything a page has said about something going wrong: the note the operator sees and the
 * console line beside it, which is how a refused document arrives - the two entry points catch
 * and report rather than throwing into nothing.
 */
const reported = async (page, errors) => [
  await page.evaluate('document.getElementById("tNote")?.textContent ?? ""'),
  ...errors,
].join(' | ');

/**
 * Waits until a page has said the thing under test. Waited on the sentence rather than on the
 * first console line to arrive: a stray warning would release a wait for any error at all and
 * leave the row reading a page that had not finished refusing yet. Running out is not itself a
 * finding - the assertion reads the same text and reddens with whatever the page did say.
 */
const settle = async (page, errors, says, ms = 20000) => {
  const deadline = Date.now() + ms;
  let said = await reported(page, errors);
  while (Date.now() < deadline && !says.test(said)) {
    await new Promise((r) => setTimeout(r, 100));
    said = await reported(page, errors);
  }
  return said;
};

/** Whether something already holds the port, asked of the kernel rather than of a fetch. */
const portHeld = (port) => new Promise((done) => {
  const sock = createConnection({ host: '127.0.0.1', port });
  const settle = (held) => { sock.destroy(); done(held); };
  sock.on('connect', () => settle(true));
  sock.on('error', () => settle(false));
  setTimeout(() => settle(false), 400);
});

let server = null;
let browser = null;
let work = null;
const cleanup = () => {
  if (server && !server.killed) server.kill('SIGKILL');
  if (work) { try { rmSync(work, { recursive: true, force: true }); } catch { /* going away anyway */ } }
};

async function main() {
  // Asked before anything spawns: a tool answered by a stranger already on its port asserts against
  // whatever fixture that process staged, which is a green run proving nothing. Exit 2 is the
  // harness declining to run.
  if (await portHeld(PORT)) {
    console.log(`[boot] DID NOT RUN - ${PORT} already has a listener, so this run would be answered by it`);
    console.log('[boot] pass --port a free one; another worktree is the usual cause');
    process.exit(2);
  }

  // A captures directory of this run's own rather than the repo's, so a fixture nobody controls
  // cannot decide what boots - and the run stays off the take somebody else is shooting. The one
  // capture in it is synthesised here, because the take door cannot be asked to refuse footage
  // without footage to refuse.
  work = mkdtempSync(join(tmpdir(), 'boot-check-'));
  const made = spawnSync(process.execPath, [
    join(ROOT, 'tools/make-sample.mjs'), join(work, `${PROBE_TAKE}.knct`), '--frames', '12',
  ], { cwd: ROOT, encoding: 'utf8' });
  if (made.status !== 0) {
    throw new Error(`make-sample could not stage ${PROBE_TAKE}: ${(made.stderr || made.stdout || '').trim()}`);
  }
  // The projects directory too, and for a sharper reason than tidiness: the checkout's
  // `projects/` is where the editor's own autosave lives and where every other tool on this
  // machine stages documents, so writing this run's fixture there would hand the next tool a
  // document it did not stage.
  // `--grabber` names a path that cannot exist, because with no flag at all the server falls back
  // to `native/build/grabber` and on a machine where that is built "needs no sensor" quietly became
  // "opens the Kinect". The path carries no spaces: the flag is space-split into a binary
  // and its arguments.
  server = spawn(process.execPath, [
    join(ROOT, 'server/index.js'), '--port', String(PORT), '--captures', work,
    '--projects', join(work, 'projects'),
    '--grabber', join(work, 'no-grabber-in-a-boot-check'),
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));
  server.on('exit', (code) => log.push(`\n[server exited ${code}]`));

  // Polled until the route answers rather than waited out on a constant: `viewer on` prints inside
  // `listen`'s callback, so a fixed wait sized against that questions a server that is not ready.
  const deadline = Date.now() + 30000;
  let up = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/record/state`);
      if (res.ok) { up = true; break; }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  // Thrown rather than exited: `process.exit` here walked past `cleanup()`, so a merely slow server
  // kept running with the temporary captures directory under it and held 8391, which makes every
  // retry refuse itself as a foreign listener. The outer `.catch` prints `err.message`, and that
  // log tail is the whole diagnostic.
  if (!up) {
    throw new Error(`the server did not answer on ${PORT} within 30s\n${
      log.join('').split('\n').slice(-8).join('\n')}`);
  }

  browser = await chromium.launch({
    channel: 'chromium',
    headless: !HEADED,
    args: ['--disable-features=LocalNetworkAccessChecks'],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

  // The count of requests the pages actually made, kept independently of the delivery: a guard
  // reading the same term the selection computed cannot see the failure of that selection.
  let served = 0;

  /**
   * A page with the mutated module staged on it and an error list of its own. Every page this
   * tool opens comes through here, because a mutation routed onto only the first one would leave
   * the sections below asserting against the shipped build under a mutated run's banner.
   */
  const openPage = async (where, hello = null) => {
    const it = await context.newPage();
    const errors = [];
    it.on('pageerror', (err) => errors.push(String(err)));
    it.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    if (mutation) {
      const path = `/${mutation.file.slice('web/'.length)}`;
      await it.route((url) => url.pathname === path, (route) => {
        served++;
        route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: mutation.body });
      });
    }
    // The sensor hello rewritten on its way to the page, for the section that asks the take door
    // to refuse footage. Fetched through rather than invented, so the take under test is the one
    // on disk and the single field named here is the whole of the difference.
    if (hello) {
      await it.route((url) => url.pathname === `/capture/${PROBE_TAKE}/hello`, async (route) => {
        const real = await (await route.fetch()).json();
        // Awaited, because this handler has already done async work before it answers: a
        // `fulfill` that loses its race to a closing page rejects with nobody holding it, and an
        // unhandled rejection reads as a crash with zero failed assertions behind it.
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...real, ...hello }) });
      });
    }
    await it.goto(`http://127.0.0.1:${PORT}${where}`, { waitUntil: 'domcontentloaded' });
    await it.waitForFunction('!!globalThis.__kinect', null, { timeout: 30000 });
    return { page: it, errors };
  };

  const { page, errors } = await openPage(RECORDER_PATH);

  // Thrown rather than exited for the reason above, and with a browser open by now there is a
  // second resource to strand.
  if (mutation && served === 0) {
    throw new Error(`${MUTATE} was staged for ${mutation.file} and the page never requested it`);
  }

  // Read off the registry rather than off a list, so a parameter added next year is asked by
  // existing. The has-a-control/is-a-pose split is derived from the registry's own `kind` for
  // the same reason.
  const state = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    const names = k.params.names();
    const rows = names.map((name) => {
      const el = document.getElementById(name);
      const value = k.params.get(name);
      // What this control would read if nothing had ever written to it, asked of a
      // detached element carrying the same attributes rather than computed. See the
      // header: every arithmetic guess at this is wrong, on every control here.
      let unwritten = null;
      if (el) {
        const clone = document.createElement('input');
        clone.type = el.type;
        if (el.type !== 'checkbox') {
          // Set in the order the generator sets them, because what the element answers
          // depends on the attributes it has been given at the moment it is asked.
          clone.min = el.min;
          clone.max = el.max;
          clone.step = el.step;
        }
        unwritten = el.type === 'checkbox' ? clone.checked : clone.value;
      }
      return {
        name,
        effect: k.effectOf(name),
        kind: k.params.spec ? k.params.spec(name).kind : null,
        tag: k.params.spec ? k.params.spec(name).tag : null,
        pose: value !== null && typeof value === 'object',
        control: el ? el.type : null,
        registry: (value !== null && typeof value === 'object') ? null : value,
        shown: !el ? null : (el.type === 'checkbox' ? el.checked : el.value),
        rowHidden: el?.closest('.row, .checkrow')?.hidden ?? null,
        unwritten,
      };
    });
    return { surface: k.surface(), rows };
  })()`);

  check(state.surface === 'record', 'the surface under test is the recorder', `surface ${state.surface}`);

  // A floor, because a row over a list passes on an empty list.
  check(state.rows.length > 60, 'the registry published a panel-sized population',
    `${state.rows.length} parameters declared`);

  const scalars = state.rows.filter((r) => !r.pose);
  const poses = state.rows.filter((r) => r.pose);
  const missing = scalars.filter((r) => r.control === null);
  check(missing.length === 0, 'every parameter that is not a pose has a control the panel drew',
    missing.length ? `no control for ${missing.map((r) => r.name).join(', ')}` : `${scalars.length} controls`);
  // The other direction, so a build that stopped declaring poses does not quietly satisfy the row
  // above by having nothing left to exclude.
  const posedControls = poses.filter((r) => r.control !== null);
  check(posedControls.length === 0,
    'and a position-and-rotation value is the only thing the panel does not draw a control for, '
    + 'because those are dragged in the world',
    `${poses.length} of them: ${poses.map((r) => `${r.name} (${r.kind})`).join(', ') || 'none'}`);

  const packageRows = scalars.filter((r) => r.effect !== null);
  const coreRows = scalars.filter((r) => r.effect === null && r.tag === 'look');
  const hiddenCoreRows = coreRows.filter((r) => r.rowHidden !== false);
  check(packageRows.length > 0 && packageRows.every((r) => r.rowHidden === true),
    'every installed package effect starts out of the sidebar',
    `${packageRows.filter((r) => r.rowHidden === true).length} of ${packageRows.length} rows hidden`);
  check(coreRows.length > 0 && hiddenCoreRows.length === 0,
    'and every basic clip control remains in it',
    `${coreRows.length - hiddenCoreRows.length} of ${coreRows.length} rows retained`
      + (hiddenCoreRows.length ? `; hidden: ${hiddenCoreRows.map((r) => r.name).join(', ')}` : ''));

  // The claim, and the one row the shipped fault reddens.
  const disagree = scalars.filter((r) => String(r.registry) !== String(r.shown));
  check(disagree.length === 0, 'every control shows the value the registry holds for the selected clip',
    disagree.length
      ? `${disagree.length} of ${scalars.length} diverge: `
        + disagree.slice(0, 6).map((r) => `${r.name} registry ${r.registry} vs control ${r.shown}`).join('; ')
      : `${scalars.length} of ${scalars.length} agree`);

  // A parameter whose stored value happens to equal what its own unwritten control would read is
  // invisible to the row above. Seven are on this build, and the names are printed rather than
  // tolerated silently, so the day the count grows is a day somebody can see.
  const blind = scalars.filter((r) => String(r.registry) === String(r.unwritten));
  check(blind.length < scalars.length / 2, 'and the diff is not mostly blind: a minority of parameters sit where an unwritten control would',
    `${blind.length} of ${scalars.length} indistinguishable at boot: ${blind.map((r) => r.name).join(', ')}`);

  // A comparison that could not separate two states would pass on every build there is, so the row
  // saying it can has to exist beside the one that uses it. Not a second copy of the row above: the
  // fault is in the boot write, and by the time this runs the generator has filled
  // `panelControls` either way.
  const drive = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    const moved = [];
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el) continue;
      // A value away from wherever it is now, chosen off the control's own bounds so it is
      // in range for every parameter without this file holding a table of them.
      const want = el.type === 'checkbox'
        ? !k.params.get(name)
        : (String(k.params.get(name)) === el.min ? Number(el.max) : Number(el.min));
      k.params.set(name, want);
      const shown = el.type === 'checkbox' ? el.checked : el.value;
      const held = k.params.get(name);
      if (String(held) !== String(shown)) moved.push({ name, held, shown });
    }
    return { swept: k.params.names().filter((n) => document.getElementById(n)).length, moved };
  })()`);
  check(drive.swept === scalars.length, 'the write sweep reached every control the population row found',
    `${drive.swept} swept against ${scalars.length} found`);
  check(drive.moved.length === 0, 'and a write through the registry moves the control it belongs to',
    drive.moved.length
      ? `${drive.moved.length} did not follow: `
        + drive.moved.slice(0, 6).map((r) => `${r.name} registry ${r.held} vs control ${r.shown}`).join('; ')
      : `${drive.swept} followed`);

  // The other half of the claim: the boot diff above is over one clip, so it cannot tell a panel
  // that follows the selection from one that shows whichever clip was written to last. Two clips
  // holding different numbers is what separates them. The recorder has no picker and does not
  // need one - a clip naming no take is a clip, and the restore door takes one.
  const followed = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    const doc = k.library.serialiseProjectBody();
    const first = JSON.parse(JSON.stringify(doc.clips[0]));
    const second = JSON.parse(JSON.stringify(doc.clips[0]));
    second.id = 'bootc2';
    // Eight of them and not one, so the sweep row below has a population to catch rather than a
    // single value; a checkbox in the list because a control's state is read two different ways.
    // Both ends of each travel, so neither number is what an unwritten control reads.
    const apart = {
      pointSize: [3.5, 41.5], opacity: [0.2, 0.9], exposure: [0.5, 4], additive: [false, true],
      rgbSaturation: [0.3, 1.7], edgeTol: [60, 900], denoise: [true, false], snapDelta: [40, 900],
    };
    for (const [name, [lo, hi]] of Object.entries(apart)) {
      first.params[name] = lo;
      second.params[name] = hi;
    }
    doc.clips = [first, second];
    k.library.restoreProject(doc);
    const read = (id) => {
      k.editor.selectClipRow(id);
      const swept = k.params.names().filter((n) => k.params.spec(n).scope === 'clip'
        && document.getElementById(n));
      const diverge = swept.filter((n) => {
        const el = document.getElementById(n);
        const shown = el.type === 'checkbox' ? el.checked : el.value;
        return String(k.params.get(n)) !== String(shown);
      });
      return {
        id: k.editor.clipSelection(),
        shown: document.getElementById('pointSize').value,
        registry: k.params.get('pointSize'),
        swept: swept.length,
        diverge,
      };
    };
    // Back to the first, because a panel painted once on the way in would pass a one-way walk.
    return { a: read(first.id), b: read(second.id), back: read(first.id) };
  })()`);

  const { a, b, back } = followed;
  check(a.registry !== b.registry && a.id !== b.id,
    'the two clips under this section hold different values, so the rows below are a comparison',
    `${a.id} holds ${a.registry}, ${b.id} holds ${b.registry}`);
  check(String(a.registry) === a.shown && String(b.registry) === b.shown && a.shown !== b.shown,
    'and selecting a clip shows that clip\'s value in the control rather than the last one written',
    `${a.id} shows ${a.shown}, ${b.id} shows ${b.shown}`);
  check(String(back.registry) === back.shown && back.shown === a.shown,
    'and selecting back shows the first clip again, so the panel follows the selection rather than '
    + 'being painted once on the way in',
    `back on ${back.id} showing ${back.shown} against ${a.shown}`);
  const missed = [...new Set([...a.diverge, ...b.diverge, ...back.diverge])];
  check(a.swept > 20 && missed.length === 0,
    'and every clip-scope control repaints, not only the one this section set',
    missed.length ? `${missed.length} of ${a.swept} did not follow: ${missed.slice(0, 6).join(', ')}`
      : `${a.swept} controls agreed with the selection at all three selections`);

  // Kept last of the recorder's own rows so a refusal raised by anything above is in the slice.
  check(errors.length === 0, 'and the page reported no errors while it booted',
    errors.length ? errors.slice(0, 3).join(' | ') : 'clean');

  console.log('\n[boot] the synchronous door adopts a whole document or none of it');
  {
    // A value the clip block carries as a plain parameter rather than as a track, because that is
    // the half of the block the door used to copy in raw. It goes in the *third* clip: the fault
    // is a document accepted at the door and refused halfway through being written, so a bad
    // value in the first clip would throw before anything of it had been applied and would pass a
    // build with the hole still in it.
    const door = await page.evaluate(`(() => {
      const k = globalThis.__kinect;
      const staged = (count, size, opacity) => {
        const doc = k.library.serialiseProjectBody();
        doc.clips = [];
        for (let i = 0; i < count; i++) {
          const clip = JSON.parse(JSON.stringify(k.library.serialiseProjectBody().clips[0]));
          clip.id = 'door' + i;
          clip.start = 0;
          clip.params.pointSize = size[i];
          clip.params.opacity = opacity[i];
          doc.clips.push(clip);
        }
        return doc;
      };
      const held = () => {
        const body = k.library.serialiseProjectBody();
        return body.clips.map((c) => [c.id, c.params.pointSize, c.params.opacity]);
      };
      k.library.restoreProject(staged(2, [33.5, 12.5], [0.9, 0.4]));
      const good = held();
      // Every value in it different from the document standing, so a refusal that had written
      // part of this one shows up in the comparison rather than landing on the same numbers.
      const bad = staged(3, [41.5, 7.5, 'large'], [0.2, 0.65, 0.5]);
      let refusal = null;
      try { k.library.restoreProject(bad); } catch (e) { refusal = e.message; }
      return { good, refusal, after: held(), wanted: bad.clips.map((c) => c.id) };
    })()`);

    check(door.good.length === 2 && door.good[0][1] !== door.good[1][1],
      'a two-clip document restores and the clips hold the two looks it names, so the rows below '
      + 'are about the refusal rather than about the fixture',
      JSON.stringify(door.good));
    check(door.refusal !== null && /pointSize/.test(door.refusal),
      'and a document whose third clip carries a clip value that is not a number is refused, by name',
      door.refusal === null ? 'it was ACCEPTED' : door.refusal.slice(0, 120));
    check(JSON.stringify(door.after) === JSON.stringify(door.good),
      'and the editor still holds the document it had, rather than the clips of the refused one '
      + 'that were written before the bad value was reached',
      `wanted ${JSON.stringify(door.wanted)}; holding ${JSON.stringify(door.after)} `
      + `against ${JSON.stringify(door.good)}`);
  }

  console.log('\n[boot] a document round-trips to the look it was saved with');
  {
    // Two claims in one section, and the second is why the first is not enough on its own: the
    // door normalises what it accepts, `params.apply` normalises it again on the way in, and a
    // snap that moved a value the second time would round-trip a document to a different look
    // without ever refusing anything.
    const trip = await page.evaluate(`(() => {
      const k = globalThis.__kinect;
      // Off the registry rather than off a list, so a scalar added next year is asked by existing.
      const scalars = k.params.names().filter((n) => {
        const s = k.params.spec(n);
        return s.scope === 'clip' && s.tag === 'look' && typeof s.default === 'number'
          && Number.isFinite(s.step) && s.step > 0;
      });
      // A third of a step past the default: off the grid for every one of them, and inside the
      // bounds without this file holding a table of what those are.
      const fed = Object.fromEntries(scalars.map((n) => [n, k.params.spec(n).default + k.params.spec(n).step / 3]));
      // What the slider path lands on, which is the only answer the document path is allowed to
      // give: one registry, and a document is not a second way to store a value.
      const bySlider = Object.fromEntries(scalars.map((n) => [n, k.params.set(n, fed[n])]));
      const doc = k.library.serialiseProjectBody();
      for (const n of scalars) doc.clips[0].params[n] = fed[n];
      let refusal = null;
      try { k.library.restoreProject(doc); } catch (e) { refusal = e.message; }
      const byDoor = Object.fromEntries(scalars.map((n) => [n, k.params.get(n)]));
      const drifted = scalars.filter((n) => byDoor[n] !== bySlider[n]);
      const offGrid = scalars.filter((n) => fed[n] !== bySlider[n]);
      // Serialised, restored and serialised again. Byte-identical or the look moved.
      const a = JSON.stringify(k.library.serialiseProjectBody());
      k.library.restoreProject(JSON.parse(a));
      const b = JSON.stringify(k.library.serialiseProjectBody());
      k.library.restoreProject(JSON.parse(b));
      const c = JSON.stringify(k.library.serialiseProjectBody());
      return { swept: scalars.length, refusal, drifted, offGrid: offGrid.length, stable: a === b && b === c, bytes: a.length };
    })()`);

    check(trip.swept > 20 && trip.offGrid > 20,
      'the sweep found a panel-sized population of stepped clip scalars and the value it feeds '
      + 'each one is off its grid, so the rows below are about snapping rather than about copying',
      `${trip.offGrid} of ${trip.swept} land somewhere other than the number fed in`);
    check(trip.refusal === null,
      'and a document carrying an off-grid number is accepted rather than refused: the door snaps '
      + 'what is in range, and refuses only what is not a number at all',
      trip.refusal === null ? 'accepted' : trip.refusal.slice(0, 120));
    check(trip.drifted.length === 0,
      'and every one of them lands where the same number written through a slider lands, so the '
      + 'door normalising on the way in did not snap a value twice',
      trip.drifted.length ? `${trip.drifted.length} differ: ${trip.drifted.slice(0, 6).join(', ')}`
        : `${trip.swept} agree with the slider path`);
    check(trip.stable,
      'and a document saved, restored and saved again is byte-identical, twice over',
      trip.stable ? `${trip.bytes} bytes, unchanged across two round trips` : 'the bytes moved');
  }

  console.log('\n[boot] and a value under an effect this build has not got comes back as it arrived');
  {
    // The other half of the door's new rule, and the half that has to *not* happen: a parked
    // parameter's spec is the manifest this build has not got, so there is nothing to hold it to
    // and normalising one would refuse a document this build is meant to hold open. The control
    // is the same value under a name the registry does answer for - refused - so the survival
    // below is the door deciding rather than the door checking nothing.
    const parked = await page.evaluate(`(() => {
      const k = globalThis.__kinect;
      // A shape no spec would accept: a string where a scalar goes, and a track key whose time is
      // not a number. Both are refused on sight for a name the registry knows.
      const VALUE = 'a value with no spec to hold it to';
      const KEYS = [{ t: 'not a time', value: VALUE }];
      // The control carries the value alone. Its track half would be refused a step earlier, by
      // the key restorer over a time that is not a number, and a control caught by the row before
      // the one under test is a control that proved nothing about it.
      const staged = (name, id, track) => {
        const doc = k.library.serialiseProjectBody();
        doc.clips[0].params[name] = VALUE;
        if (track) doc.clips[0].tracks[track] = KEYS;
        if (id) doc.requires = [...(doc.requires ?? []), { id, version: '1.0.0' }];
        return doc;
      };
      // A core clip value, off the registry rather than named here. It has to be one the document
      // already carries: an effect parameter added to a block that names none of its siblings is
      // refused by the completeness check two loops earlier, which would catch the control
      // before the line under test ever ran.
      const installed = k.params.names().find((n) => k.effectOf(n) === null
        && k.params.spec(n).scope === 'clip' && k.params.spec(n).tag === 'look');
      let refusedInstalled = null;
      try { k.library.restoreProject(staged(installed, null, null)); } catch (e) { refusedInstalled = e.message; }
      let refusedParked = null;
      try {
        k.library.restoreProject(staged('nosuch.amount', 'nosuch', 'nosuch.wobble'));
      } catch (e) { refusedParked = e.message; }
      const pool = k.library.parkedLook();
      const back = k.library.serialiseProjectBody();
      return {
        installed,
        refusedInstalled,
        refusedParked,
        held: pool.clips[0]?.params['nosuch.amount'] ?? null,
        heldTrack: JSON.stringify(pool.clips[0]?.tracks['nosuch.wobble'] ?? null),
        wroteBack: back.clips[0].params['nosuch.amount'] ?? null,
        wroteBackTrack: JSON.stringify(back.clips[0].tracks['nosuch.wobble'] ?? null),
        wanted: VALUE,
        wantedTrack: JSON.stringify(KEYS),
        listed: (back.requires ?? []).some((e) => e.id === 'nosuch'),
      };
    })()`);

    check(parked.refusedInstalled !== null && parked.refusedInstalled.startsWith(parked.installed),
      `the same value under ${parked.installed}, which the registry does answer for, is refused by name`,
      parked.refusedInstalled === null ? 'it was ACCEPTED' : parked.refusedInstalled.slice(0, 120));
    check(parked.refusedParked === null,
      'and under an effect this build has not got the document is taken, because the spec that '
      + 'would refuse it is the manifest this build is missing',
      parked.refusedParked === null ? 'restored' : parked.refusedParked.slice(0, 140));
    check(parked.held === parked.wanted && parked.heldTrack === parked.wantedTrack,
      'the parked pool holds the value and the track exactly as the document wrote them',
      `value ${JSON.stringify(parked.held)}, track ${parked.heldTrack}`);
    check(parked.wroteBack === parked.wanted && parked.wroteBackTrack === parked.wantedTrack && parked.listed,
      'and the save writes them back out unchanged, still claimed by a requires entry, so a build '
      + 'that has the effect reads what was authored rather than what this one could make of it',
      `value ${JSON.stringify(parked.wroteBack)}, track ${parked.wroteBackTrack}, `
      + `requires ${parked.listed ? 'names nosuch' : 'lost the entry'}`);
  }

  console.log('\n[boot] a clip naming no take is the recorder\'s own document and it restores');
  {
    // The over-refusal guard, and the reason the take rule below is the editor's rather than the
    // format's: the recorder draws the live stream and its own save writes `take: null`, so a door
    // that refused that would refuse the document this very page just wrote.
    const live = await page.evaluate(`(() => {
      const k = globalThis.__kinect;
      const doc = k.library.serialiseProjectBody();
      let refusal = null;
      try { k.library.restoreProject(doc); } catch (e) { refusal = e.message; }
      return { takes: doc.clips.map((c) => c.take), refusal, surface: k.surface() };
    })()`);
    check(live.surface === 'record' && live.takes.every((t) => t === null),
      'the recorder saves its clips naming no take, so the row below is about that document',
      `${live.takes.length} clip(s), takes ${JSON.stringify(live.takes)}`);
    check(live.refusal === null,
      'and the door takes it back, because a clip with nothing to draw is the recorder\'s ordinary '
      + 'state rather than a broken document',
      live.refusal === null ? 'restored' : live.refusal.slice(0, 140));
  }

  console.log('\n[boot] the editor opens the take this run staged');
  // The control for both sections below: without it a refusal reported there could be a broken
  // fixture reading as a working door.
  const opened = await openPage(`/edit?take=${PROBE_TAKE}`);
  await opened.page.waitForFunction('globalThis.__kinect.library.opened() === true', null, { timeout: 30000 })
    .catch(() => { /* the control rows below say so */ });
  const bootErrors = [...opened.errors];
  const control = await opened.page.evaluate(`(() => {
    const k = globalThis.__kinect;
    return { surface: k.surface(), take: k.library.takeId(), editing: document.body.classList.contains('editing') };
  })()`);
  check(control.surface === 'edit' && control.take === PROBE_TAKE && control.editing,
    `the editor comes up on ${PROBE_TAKE}, so the two sections below are about a take this build can open`,
    `surface ${control.surface}, take ${control.take}, chrome ${control.editing ? 'up' : 'down'}`);
  check(bootErrors.length === 0, 'and it reported no errors opening it',
    bootErrors.length ? bootErrors.slice(0, 2).join(' | ') : 'clean');

  console.log('\n[boot] a clip naming no take is refused by the editor\'s document door');
  {
    // Two shapes, because the refusal used to live inside the loop over the clips whose footage
    // changed and each shape walks past that loop differently. This is the one where the slot the
    // clip lands in holds nothing yet: the edit is one clip long, the document is two, and
    // `clips[1]` is undefined - so a null take compared against nothing found is a comparison of
    // null with null, and the loop skips the clip it was there to refuse.
    const staged = await opened.page.evaluate(`(async () => {
      const k = globalThis.__kinect;
      const doc = k.library.serialiseProjectBody();
      doc.clips[0].params.pointSize = 41.5;
      const put = await fetch('/projects/${NULL_TAKE_PROJECT}', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...doc, clips: [{ ...doc.clips[0], take: null }] }),
      });
      const grown = k.library.serialiseProjectBody();
      const second = JSON.parse(JSON.stringify(grown.clips[0]));
      second.id = 'bootnull';
      second.take = null;
      second.start = 0;
      grown.clips = [grown.clips[0], second];
      let refusal = null;
      try { await k.library.loadProject('bootprobe-inline', grown); } catch (e) { refusal = e.message; }
      const body = k.library.serialiseProjectBody();
      return {
        stored: put.ok,
        refusal,
        clips: body.clips.map((c) => [c.id, c.take === null ? 'no take' : c.take.id]),
      };
    })()`);
    check(staged.stored, `the null-take document was written to /projects/${NULL_TAKE_PROJECT}, so the section below has one to open`,
      staged.stored ? 'stored' : 'the PUT was refused');
    // Not "it was refused": the build with the hole in it refuses this document too, several
    // layers downstream, when the composite reaches a clip nothing gave footage to. What
    // separates the two is which of them said it and what it said - so the row is about the
    // sentence, and the row below it is about what the edit is left holding.
    check(staged.refusal !== null && /names no take/.test(staged.refusal),
      'a document whose second clip names no take is answered by the door, naming the clip and '
      + 'what it is missing, rather than by whatever the composite raises later on reaching it',
      staged.refusal === null ? 'it was ACCEPTED and nothing was said at all'
        : staged.refusal.slice(0, 140));
    check(staged.clips.length === 1 && staged.clips[0][1] === PROBE_TAKE,
      'and the edit still holds the one clip it had, rather than a second one pointed at the live '
      + 'stream because nothing gave it footage',
      JSON.stringify(staged.clips));
  }

  console.log('\n[boot] and a document opened from the gallery cannot bring the editor up on it');
  {
    // The second shape: the same document arriving through the query string, where the clip it
    // refuses is the one the editor is about to paint itself around. This is the page-killing
    // half - `paintOpenTake` reads `clip.take.id` - and the look row is what says the document was
    // written before it died rather than refused at the door.
    const gallery = await openPage(`/edit?project=${NULL_TAKE_PROJECT}`);
    // Waited on the prefix both answers share rather than on the one under test, so the row below
    // is the verdict and this is only the wait for the page to have given one.
    const spoke = await settle(gallery.page, gallery.errors, new RegExp(`project ${NULL_TAKE_PROJECT}: .`));
    const said = await gallery.page.evaluate(`(() => {
      const k = globalThis.__kinect;
      return {
        editing: document.body.classList.contains('editing'),
        pointSize: k.params.get('pointSize'),
        def: k.params.spec('pointSize').default,
      };
    })()`);
    check(/names no take/.test(spoke),
      'the page says which clip named no take, rather than reporting a type error raised by the '
      + 'painter that went on to dereference it',
      spoke.slice(0, 200) || 'the page said nothing at all');
    check(said.pointSize === said.def,
      'and nothing of the document was applied: the look is where the registry starts, not where '
      + 'the refused document said',
      `pointSize ${said.pointSize} against the default ${said.def}, and the document names 41.5`);
    await gallery.page.close();
  }

  console.log('\n[boot] a take the format door refused is not left open behind it');
  {
    // The take door refuses on the capture format, and the question is what it leaves behind: a
    // take cached under a hello that was rejected reads as already open, and the synchronous
    // restore below adopts what the fetching one refused. The document is the same one the
    // control page opened, so a refusal here is about the format and about nothing else.
    const refused = await openPage(`/edit?take=${PROBE_TAKE}`, { format: 99 });
    // Both builds refuse here and only differ in what they leave behind, so the wait is on the
    // refusal itself and the rows below are about the state after it.
    const why = await settle(refused.page, refused.errors, /capture format 99/);
    const door = await refused.page.evaluate(`(async () => {
      const k = globalThis.__kinect;
      const { takes } = await (await fetch('/library/takes')).json();
      const hash = (takes.find((t) => t.id === '${PROBE_TAKE}') ?? {}).hash ?? null;
      const doc = k.library.serialiseProjectBody();
      doc.clips[0].take = hash === null ? null : { id: '${PROBE_TAKE}', hash };
      let adopted = 'ACCEPTED';
      try { k.library.restoreProject(doc); } catch (e) { adopted = e.message; }
      return { hash, adopted, take: k.library.takeId(), opened: k.library.opened() };
    })()`);
    check(/capture format 99/.test(why),
      'the take door refuses footage written in a capture format this build does not read',
      why.slice(0, 200) || 'the page said nothing at all');
    check(door.hash !== null && door.opened === false,
      'and the library still lists that take by hash, so the document below names real footage '
      + 'that this page has no business holding open',
      `hash ${door.hash === null ? 'not listed' : door.hash.slice(0, 22)}, editor ${door.opened ? 'up' : 'down'}`);
    check(door.adopted !== 'ACCEPTED' && /opening footage is a fetch/.test(door.adopted),
      'and the synchronous door refuses a document cut on it rather than finding it already open: '
      + 'a take refused for its format is not a take this page holds',
      door.adopted === 'ACCEPTED'
        ? `it was ACCEPTED and the clip is now on ${door.take}`
        : door.adopted.slice(0, 140));
    await refused.page.close();
  }
  await opened.page.close();
}

main()
  .then(async () => {
    if (browser) await browser.close();
    cleanup();
    console.log(`\n[boot] ${checked} assertions, ${failed} failed`);
    if (MUTATE) {
      // Exit code alone cannot tell a caught mutation from a tool that fell over before it asserted
      // anything; the verdict is the sentence and the code is 1 either way.
      if (failed === 0) {
        console.log('[boot] NOT CAUGHT - the check passed a build it should have rejected');
        process.exit(1);
      }
      console.log(`[boot] caught, as required (${failed} assertion${failed === 1 ? '' : 's'} fired)`);
      console.log(`[boot] rows that fired: ${fired.join(' | ')}`);
      process.exit(1);
    }
    if (failed) { console.log('[boot] FAIL'); process.exit(1); }
    console.log('[boot] PASS');
    process.exit(0);
  })
  .catch(async (err) => {
    if (browser) await browser.close().catch(() => {});
    cleanup();
    // A throw is `crashed` rather than `failed`: a proof tool must never count its own crash as a
    // finding in either direction.
    console.log(`\n[boot] ${checked} assertions, ${failed} failed`);
    console.log(`[boot] DID NOT RUN - ${err.message}. Nothing here is a finding: re-run it.`);
    process.exit(2);
  });
