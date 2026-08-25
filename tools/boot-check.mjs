#!/usr/bin/env node
// The post-boot state diff: for every parameter the registry declares, the control the panel
// drew shows the value the registry holds. The comparison has to be registry-versus-control -
// in the fault the registry holds correct values and only the controls are wrong, so a diff
// against declared defaults compares defaults to defaults and reports nothing. Homed on the
// recorder, which boots the full panel with no grabber, no sensor and no capture; nothing here
// looks at `/edit`. Needs a GPU browser and a free port.

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

// Identity tests against `server/index.js`'s own routing rather than a suffix rule: "ends in .html,
// so serve it as the page" hands `web/menu.html` over as the recorder's document, and every row
// below then asserts against a page nobody wrote.
const RECORDER_PATH = '/record';

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
        '    params.set(name, Object.hasOwn(held, name) ? held[name] : PARAMS[name].def);\n  }\n',
        '    params.set(name, Object.hasOwn(held, name) ? held[name] : PARAMS[name].def);\n  }\n  buildPanel();\n',
      ],
    ],
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

  // An empty captures directory rather than the repo's, so a fixture nobody controls cannot decide
  // what boots - and the run stays off the take somebody else is shooting.
  work = mkdtempSync(join(tmpdir(), 'boot-check-'));
  // `--grabber` names a path that cannot exist, because with no flag at all the server falls back
  // to `native/build/grabber` and on a machine where that is built "needs no sensor" quietly became
  // "opens the Kinect". The path carries no spaces: the flag is space-split into a binary
  // and its arguments.
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
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  // The count of requests the page actually made, kept independently of the delivery: a guard
  // reading the same term the selection computed cannot see the failure of that selection.
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
  check(posedControls.length === 0, 'and a pose is the only thing the panel does not draw a control for',
    `${poses.length} poses: ${poses.map((r) => r.name).join(', ') || 'none'}`);

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
  check(disagree.length === 0, 'every control shows the value the registry holds for it',
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

  // Kept last so a refusal raised by anything above is in the slice.
  check(errors.length === 0, 'and the page reported no errors while it booted',
    errors.length ? errors.slice(0, 3).join(' | ') : 'clean');
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
