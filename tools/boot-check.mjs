#!/usr/bin/env node
// The post-boot state diff: for every parameter the registry declares, the control the
// panel drew shows the value the registry holds.
//
// **This is the instrument three documents deferred to and none of them built.**
// `module-check`'s own output, `docs/proof-tools.md` and `CLAUDE.md` all say the
// intra-module dead zone is "left to the post-boot state diff", and grepping the tree for
// one returned only those three notes about deferring to it. The reach they mean runs
// through property dispatch - `params.reset()` to `params.set` to `spec.apply` - which is
// not statically decidable, so a source scan that followed calls made through a name would
// redden on planted toys and stay green on the shape that has shipped. It has shipped
// twice, and the comments above `groupRevealChanged` and `transportWriting` are the two
// scars.
//
// **The silent form is the one this tool is for, and it is why the obvious comparison does
// not work.** `params.reset()` landing before the panel generator has filled its Maps
// writes every value into the registry, reaches no control, throws nothing, and boots a
// page whose sliders show their markup defaults - a whole session graded against controls
// that are lying. The tempting row is to read every registry value back after first paint
// and compare it against the registry's declared defaults. That cannot catch this. In the
// fault the registry ends up holding perfectly correct values; it is the *controls* that
// are wrong, so a diff against declared defaults compares defaults to defaults and reports
// nothing. Measured, with the fault put back: 73 of 80 controls diverge on the recorder and
// the registry is right about all 80.
//
// The comparison that catches it is registry-versus-control, which is what
// `writeControl` is for and what it silently declines to do:
//
//     function writeControl(name, value) {
//       const el = panelControls.get(name);
//       if (!el) return;                     // <- the whole fault, in one line
//
// **What an unwritten slider shows is not the parameter's default**, which is the second
// reason the declared-defaults comparison is worse than it looks. `panelRow` stamps `min`,
// `max` and `step` from the registry and never a `value`, so a range input the boot write
// never reached answers whatever the element makes of those attributes - `pointSize` 50.5
// against a registry holding 9, `tilt` and `roll` 50 against 0, `near` and `far` both 9.05.
// The divergence is large and it is large in a direction nothing about the registry
// predicts.
//
// **And it is measured rather than derived, because the arithmetic that looks right is
// wrong.** The obvious reading is the midpoint, `(min + max) / 2`. That is not what the
// element answers: `pointSize` spans 0.5 to 64, whose midpoint is 32.25, and the control
// reads 50.5. Measured across all 75 range controls here, the midpoint disagreed with the
// element on **75 of 75**. So the row below builds a detached input with the same `min`,
// `max` and `step`, reads its `value`, and uses that - the browser answering the question
// instead of this file predicting it. The first version predicted, and named thirteen
// parameters as indistinguishable where the fault actually leaves seven, overlapping on
// two: a number that reads like a measurement and is a picture of the wrong formula.
//
// **Homed on the recorder, and that is a claim about what this needs rather than a
// preference.** The panel is generated from the registry on both surfaces and the only
// `EDITING` gate inside the row loop is the keyframe diamond, so `/record` and `/edit` build
// the same 80 controls - measured, on both. What separates them is the cost of asking:
// `/edit` with no `?take=` redirects to `/gallery`, so the editor needs a capture to boot at
// all, while `/record` boots the full panel against a server with no grabber, no sensor and
// an empty captures directory. That is the state a fresh clone is in, so this tool can be
// run by somebody who has none of the hardware - which is most of the point of it.
//
// What that does not cover is said here rather than left to be assumed: nothing in this file
// looks at `/edit`, so a fault that reached only the editor's own boot path would pass. The
// two surfaces share the generator and the reset, so there is no such path today; there is
// also nothing asserting there is not.
//
//   node tools/boot-check.mjs
//   node tools/boot-check.mjs --mutate reset-before-the-panel-generator   # ... and must FAIL
//
// Needs a GPU browser and a free port. No capture, no sensor, no server already running.

import { spawn } from 'node:child_process';
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

// The document `/record` is served from, and the path the module is served at. Both are
// identity tests against `server/index.js`'s own routing rather than a suffix rule: a rule
// reading "ends in .html, so serve it as the page" hands `web/menu.html` over as the
// recorder's document, whereupon the route fires, the counter counts it, and every row
// below asserts against a page nobody wrote.
const RECORDER_PATH = '/record';

/**
 * The mutations, and there is one because there is one fault to put back.
 *
 * **`reset-before-the-panel-generator` is the shipped fault itself**, restored by moving
 * the boot write above the generator rather than by breaking the panel some other way. A
 * control that fails everything cannot say which question it was asking, and one that
 * reproduces a *different* defect wearing the same colour is worse than none.
 *
 * **Both halves live inside `adoptEffectPackages` now, and the mutation moved with them
 * rather than being replaced.** The page used to generate the panel while the module
 * evaluated and write `params.reset()` a few lines below it; installing an effect made
 * both of those things that happen again while the page is up, so they are two steps of
 * one function and boot is that function's first call. The fault is the same fault - the
 * values written before the controls they are meant to paint exist - and it is put back
 * the same way, by lifting `buildPanel()` from above the walk to below it.
 *
 * **It boots, which took some care and is the whole reason it is aimed here.** The obvious
 * spelling of this mutation is dangerous: the value walk writes every parameter while the
 * module is still evaluating, and `groupRevealChanged` and `transportWriting` are declared
 * as no-ops above the registry precisely so that write cannot reach `tracks` or
 * `withoutRepaint` in their temporal dead zone. A page that throws during module evaluation
 * publishes no `globalThis.__kinect` at all, every tool in the suite reports DID NOT RUN,
 * and an exit code with no assertion behind it is the outcome this repo has three times
 * written down as a bug found - `docs/instruments.md` names it under "A mutation whose only
 * effect is that the page refuses to boot is not a usable mutation". Swapping two adjacent
 * steps of one function stays on the safe side of that, because neither step moves across
 * a declaration: `writeControl` and `refreshReset` both return early when the panel has no
 * control by that name, which is exactly the state the mutated order puts them in.
 * Measured rather than reasoned about - the mutated build boots both surfaces with zero
 * page errors.
 */
const MUTATIONS = {
  'reset-before-the-panel-generator': {
    file: 'web/main.js',
    edits: [
      ['\n  buildPanel();\n', '\n'],
      [
        '    params.set(name, Object.hasOwn(held, name) ? held[name] : PARAMS[name].def);\n  }\n',
        '    params.set(name, Object.hasOwn(held, name) ? held[name] : PARAMS[name].def);\n  }\n  buildPanel();\n',
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
 * The mutated bytes, or null.
 *
 * Every edit has to match **exactly once**, and a miss is exit 2 rather than a failed
 * assertion. A replacement that silently matched nothing would run the unmutated page and
 * be recorded as the check having missed a bug it was never shown, and a red row on a
 * mutation run reads as a catch - so a mutation that never arrived has to be the harness
 * declining to run. A duplicate is as stale as a miss, which is why this counts rather than
 * asking whether the text appears.
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
  // Asked before anything spawns, because the alternative is being answered by a stranger.
  // A tool that finds somebody else already listening on its port asserts against whatever
  // fixture that process staged rather than the one this run staged, which is a green run
  // proving nothing - and `library-check` is the only tool in the suite that refuses this,
  // so everywhere else it has to be checked by hand. Exit 2: the harness declining to run.
  if (await portHeld(PORT)) {
    console.log(`[boot] DID NOT RUN - ${PORT} already has a listener, so this run would be answered by it`);
    console.log('[boot] pass --port a free one; another worktree is the usual cause');
    process.exit(2);
  }

  // An empty captures directory rather than the repo's, and that is the claim this tool
  // makes about itself: the recorder's panel is built from the registry and needs no
  // footage, so pointing it at a real `captures/` would let a fixture nobody controls
  // decide what boots. It also keeps the run off the take somebody else is shooting.
  work = mkdtempSync(join(tmpdir(), 'boot-check-'));
  // `--grabber` names a path that cannot exist - inside this run's own fresh temp
  // directory - because with no flag at all the server falls back to
  // `native/build/grabber`, and on a machine where that is built "needs no sensor"
  // quietly became "opens the Kinect": a UI-state check retuning, or contending for,
  // the device another process was shooting with. A spawn that fails is the branch
  // this tool has always exercised on CI - one error event, then the same backoff a
  // machine with no sensor lives in - so the deliberate absence makes the dev machine
  // run the run CI already runs. The path carries no spaces, which matters because
  // the flag is space-split into a binary and its arguments.
  server = spawn(process.execPath, [
    join(ROOT, 'server/index.js'), '--port', String(PORT), '--captures', work,
    '--grabber', join(work, 'no-grabber-in-a-boot-check'),
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));
  server.on('exit', (code) => log.push(`\n[server exited ${code}]`));

  // Polled until the route answers rather than waited out on a constant. `vcam-check`
  // records what a constant costs: `viewer on` prints inside `listen`'s callback, so a
  // fixed wait sized against that questions a server that is not ready and every row reads
  // as a finding about the page.
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
  // **Thrown rather than exited, and that is about the child rather than about style.**
  // `process.exit` here walked past `cleanup()`, so a server that was merely slow kept
  // running with the temporary captures directory under it - and then held 8391, which
  // makes every retry of this tool refuse itself as a foreign listener at the top of
  // `main`. The outer `.catch` kills the child, removes the directory and prints the same
  // `DID NOT RUN` verdict with exit 2, so the log tail travels inside the message: the
  // catch prints `err.message` and nothing else, and that tail is the whole diagnostic
  // this site exists for.
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
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  // The mutation is delivered by the file it names, at the path a browser asks for it at,
  // and the count of times the page actually asked is kept independently of the delivery.
  // `docs/instruments.md` has the case: a guard reading the same term the selection
  // computed cannot see the failure of that selection, so what is asserted below is the
  // number of requests the page made rather than whether a route was installed.
  let served = 0;
  if (mutation) {
    const path = `/${mutation.file.slice('web/'.length)}`;
    await page.route((url) => url.pathname === path, (route) => {
      served++;
      route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: mutation.body });
    });
  }

  await page.goto(`http://127.0.0.1:${PORT}${RECORDER_PATH}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!globalThis.__kinect', null, { timeout: 30000 });

  // Thrown for the reason the readiness failure above is, and with a browser open by now
  // there is a second resource to strand: the outer `.catch` closes it before `cleanup()`
  // runs, and a bare exit here left a headless Chromium behind as well as the server.
  if (mutation && served === 0) {
    throw new Error(`${MUTATE} was staged for ${mutation.file} and the page never requested it`);
  }

  // ------------------------------------------------------------------ 1. the population
  //
  // Read off the registry rather than off a list here, so a parameter added next year is
  // asked by existing. The split between "has a control" and "is a pose" is derived from
  // the registry's own `kind` for the same reason: naming `camera` as the exception would
  // be a deliberate exclusion, and a deliberate exclusion comes with a justification that
  // stops anybody looking twice - which is the rule that has cost this repo three holes.
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
        kind: k.params.spec ? k.params.spec(name).kind : null,
        pose: value !== null && typeof value === 'object',
        control: el ? el.type : null,
        registry: (value !== null && typeof value === 'object') ? null : value,
        shown: !el ? null : (el.type === 'checkbox' ? el.checked : el.value),
        unwritten,
      };
    });
    return { surface: k.surface(), rows };
  })()`);

  check(state.surface === 'record', 'the surface under test is the recorder', `surface ${state.surface}`);

  // A floor, because a row over a list passes on an empty list and this file already
  // depends on the list being the registry. `syntax-check` refuses to pass on finding no
  // files for the same reason.
  check(state.rows.length > 60, 'the registry published a panel-sized population',
    `${state.rows.length} parameters declared`);

  const scalars = state.rows.filter((r) => !r.pose);
  const poses = state.rows.filter((r) => r.pose);
  const missing = scalars.filter((r) => r.control === null);
  check(missing.length === 0, 'every parameter that is not a pose has a control the panel drew',
    missing.length ? `no control for ${missing.map((r) => r.name).join(', ')}` : `${scalars.length} controls`);
  // The other direction, so a build that stopped declaring poses does not quietly satisfy
  // the row above by having nothing left to exclude.
  const posedControls = poses.filter((r) => r.control !== null);
  check(posedControls.length === 0, 'and a pose is the only thing the panel does not draw a control for',
    `${poses.length} poses: ${poses.map((r) => r.name).join(', ') || 'none'}`);

  // ------------------------------------------------------- 2. the diff this file is for
  //
  // The claim, and the one row the shipped fault reddens.
  const disagree = scalars.filter((r) => String(r.registry) !== String(r.shown));
  check(disagree.length === 0, 'every control shows the value the registry holds for it',
    disagree.length
      ? `${disagree.length} of ${scalars.length} diverge: `
        + disagree.slice(0, 6).map((r) => `${r.name} registry ${r.registry} vs control ${r.shown}`).join('; ')
      : `${scalars.length} of ${scalars.length} agree`);

  // **What this row cannot separate, counted rather than left implied.** A parameter whose
  // stored value happens to equal what its own unwritten control would read is invisible to
  // the row above, because both builds show the same thing. Seven are on this build -
  // `additive`, `spin`, `right`, `top`, `ripple.amount`, `readRgb` and `trails` - and that number
  // is the measured set rather than a predicted one: it is exactly the set observed still
  // agreeing under `reset-before-the-panel-generator`, which is the check that the two agree
  // about what "indistinguishable" means. A tolerance that reports nothing is a blindfold, so
  // the names are printed and the day the count grows is a day somebody can see.
  const blind = scalars.filter((r) => String(r.registry) === String(r.unwritten));
  check(blind.length < scalars.length / 2, 'and the diff is not mostly blind: a minority of parameters sit where an unwritten control would',
    `${blind.length} of ${scalars.length} indistinguishable at boot: ${blind.map((r) => r.name).join(', ')}`);

  // --------------------------------------- 3. the row that proves the comparison can fail
  //
  // **A comparison that could not separate two states would pass on every build there is**,
  // so the row saying it *can* has to exist beside the one that uses it. This writes a value
  // that is neither the stored one nor the midpoint into every scalar and asks the controls
  // to have followed.
  //
  // It is deliberately not a second copy of the row above. The fault is in the *boot* write,
  // and by the time this runs the generator has filled `panelControls` either way - so a
  // mutated build passes this and fails the one above, which is what makes the two rows
  // different questions rather than one asked twice. Measured: under
  // `reset-before-the-panel-generator` this row is green.
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

  // The page said nothing, which is what separates a build that boots from one that boots
  // and complains. Kept last so a refusal raised by anything above is in the slice.
  check(errors.length === 0, 'and the page reported no errors while it booted',
    errors.length ? errors.slice(0, 3).join(' | ') : 'clean');
}

main()
  .then(async () => {
    if (browser) await browser.close();
    cleanup();
    console.log(`\n[boot] ${checked} assertions, ${failed} failed`);
    if (MUTATE) {
      // Exit code alone cannot tell a caught mutation from a tool that fell over before it
      // asserted anything, and this repo has been bitten by exactly that more than once.
      // The verdict is the sentence; the code is 1 either way, which is the convention the
      // other eight tools in this group use and which `docs/proof-tools.md` now says out
      // loud rather than leaving a reader to infer that a miss looks different.
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
    // A throw is `crashed` rather than `failed`, and the verdict is DID NOT RUN with exit 2
    // checked before the mutation verdict. `monitor-check` caught its own `catch` in
    // `failed++` and printed `caught, as required (1 assertion fired)` for a timeout that
    // had tested nothing at all - a proof tool must never count its own crash as a finding
    // in either direction.
    console.log(`\n[boot] ${checked} assertions, ${failed} failed`);
    console.log(`[boot] DID NOT RUN - ${err.message}. Nothing here is a finding: re-run it.`);
    process.exit(2);
  });
