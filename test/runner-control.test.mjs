// The control for the test runner itself.
//
// `CLAUDE.md` asks every proof tool for something that must FAIL if the thing under test
// were not doing the work, and the question applies to a test runner as much as to a
// check: a suite that reports success without running anything looks exactly like a
// suite that passed. That is not hypothetical here - `syntax-check`'s own header records
// `node --check` silently ceasing to detect broken files on a tree whose `package.json`
// has no `type`, which is the same failure one layer down.
//
// So this plants a test that must fail, runs the real runner on it in a directory of its
// own, and asserts the run came back red with the failure counted. If somebody
// misconfigures the runner so that failures stop being reported - a bad glob, a swallowed
// exit code, a reporter that prints and returns 0 - every other file in here goes quietly
// green and this one goes red.
//
// One control at the runner level rather than a mutation per test, deliberately. The
// per-test mutations the proof tools carry exist because driving a browser is indirect
// enough to pass while testing nothing; a test that imports a function and asserts on its
// return value has a much smaller version of that problem, and paying the mutation cost
// per test here would buy little and cost a lot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the runner reports a planted failure, so a green run here means something', () => {
  const dir = mkdtempSync(join(tmpdir(), 'braindance-runner-control-'));
  try {
    writeFileSync(join(dir, 'planted.test.mjs'), [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('this must fail', () => { assert.equal(1, 2); });",
      '',
    ].join('\n'));

    // **The child must not inherit `NODE_TEST_CONTEXT`.** Node sets it on processes the
    // test runner spawns, and a child that sees it reports as a nested subtest rather
    // than as a run of its own - it exited 0 through a suite containing a failing test,
    // which is precisely the reading this control exists to refuse. Measured on v26:
    // with the variable inherited the assertion below fails against exit 0; with it
    // removed the same run exits 1 and names the planted test. Any future variable in
    // that family belongs here too, which is why the deletion is written as a list.
    const env = { ...process.env };
    for (const k of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS']) delete env[k];

    let code = 0;
    let output = '';
    try {
      // The reporter is named rather than left to default. Without a tty Node picks one
      // that prints no test names at all, so the assertion below - that the planted test
      // was actually named, and not merely that something somewhere failed - had nothing
      // to match against and this control failed for a reason that was not the runner.
      // **The file, not its directory.** On v26 `node --test <dir>` does not discover
      // anything - it tries to load the directory itself as a module and dies in the CJS
      // resolver, which exits non-zero with no test ever run. That is the shape this
      // control is built to refuse, and it produced it: the first assertion passed on an
      // error that had nothing to do with the planted failure. `npm test` passes the
      // files for the same reason.
      output = execFileSync(
        process.execPath,
        ['--test', '--test-reporter=spec', join(dir, 'planted.test.mjs')],
        { encoding: 'utf8', stdio: 'pipe', env },
      );
    } catch (err) {
      code = err.status ?? -1;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }

    // Both halves, because either on its own can be true of a run that did nothing: a
    // non-zero exit could be a crash before the file was read, and the word "fail" could
    // come from a summary line printed over zero tests.
    assert.notEqual(code, 0, 'the runner exited 0 on a suite containing a failing test');
    assert.match(output, /this must fail/,
      'the runner did not name the planted test, so it may never have run it');
    assert.match(output, /fail 1|failing tests|# fail 1/,
      `the runner did not count the failure. output was:\n${output.slice(0, 800)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
