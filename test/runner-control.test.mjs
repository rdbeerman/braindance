// The control for the test runner itself: a suite that reports success without running anything
// looks exactly like a suite that passed. This plants a failing test, runs the real runner on it,
// and asserts the run came back red with the failure counted and named.

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

    // The child must not inherit `NODE_TEST_CONTEXT`: with it, Node reports the child as a
    // nested subtest and it exits 0 through a suite containing a failing test.
    const env = { ...process.env };
    for (const k of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS']) delete env[k];

    let code = 0;
    let output = '';
    try {
        // The reporter is named because without a tty Node picks one that prints no test names,
      // and the file rather than its directory because `node --test <dir>` discovers nothing on v26.
      output = execFileSync(
        process.execPath,
        ['--test', '--test-reporter=spec', join(dir, 'planted.test.mjs')],
        { encoding: 'utf8', stdio: 'pipe', env },
      );
    } catch (err) {
      code = err.status ?? -1;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }

    assert.notEqual(code, 0, 'the runner exited 0 on a suite containing a failing test');
    assert.match(output, /this must fail/,
      'the runner did not name the planted test, so it may never have run it');
    assert.match(output, /fail 1|failing tests|# fail 1/,
      `the runner did not count the failure. output was:\n${output.slice(0, 800)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
