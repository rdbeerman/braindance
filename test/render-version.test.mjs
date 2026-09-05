import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderVersion } from '../server/render-version.js';

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'render-version-'));
  const web = join(root, 'web');
  const three = join(root, 'three');
  mkdirSync(join(web, 'nested'), { recursive: true });
  mkdirSync(join(three, 'build'), { recursive: true });
  mkdirSync(join(three, 'examples', 'jsm', 'postprocessing'), { recursive: true });
  writeFileSync(join(web, 'main.js'), 'export const a = 1;\n');
  writeFileSync(join(web, 'index.html'), '<html></html>\n');
  writeFileSync(join(web, 'nested', 'look.json'), '{}\n');
  writeFileSync(join(web, 'notes.txt'), 'not shipped\n');
  writeFileSync(join(three, 'build', 'three.module.js'), 'export const THREE = 1;\n');
  writeFileSync(join(three, 'examples', 'jsm', 'postprocessing', 'Pass.js'), 'export class Pass {}\n');
  writeFileSync(join(three, 'package.json'), '{"version":"0.185.1"}\n');
  return { web, three };
}

// A same-second rewrite keeps its mtime on coarse filesystems, so push it forward by hand.
function rewrite(path, text) {
  writeFileSync(path, text);
  const later = Date.now() / 1000 + 5;
  utimesSync(path, later, later);
}

test('the renderer version is stable across calls and changes with any shipped file', async () => {
  const { web, three } = tree();
  const first = await renderVersion(web, three);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(await renderVersion(web, three), first);
  rewrite(join(web, 'main.js'), 'export const a = 2;\n');
  const second = await renderVersion(web, three);
  assert.notEqual(second, first, 'a web file');
  rewrite(join(three, 'examples', 'jsm', 'postprocessing', 'Pass.js'), 'export class Pass { render() {} }\n');
  const third = await renderVersion(web, three);
  assert.notEqual(third, second, 'a three module');
  rewrite(join(three, 'package.json'), '{"version":"0.186.0"}\n');
  const fourth = await renderVersion(web, three);
  assert.notEqual(fourth, third, 'the three version');
});

test('a file outside the shipped extensions does not enter the version', async () => {
  const { web, three } = tree();
  const before = await renderVersion(web, three);
  rewrite(join(web, 'notes.txt'), 'still not shipped\n');
  assert.equal(await renderVersion(web, three), before);
});

test('an unchanged tree answers from the memo without reading a file', async () => {
  const { web, three } = tree();
  const digest = await renderVersion(web, three);
  // Unreadable but statable: a call that reads contents throws, a call that trusts the memo does not.
  chmodSync(join(web, 'main.js'), 0o000);
  try {
    assert.equal(await renderVersion(web, three), digest);
    rewrite(join(web, 'index.html'), '<html><body></body></html>\n');
    await assert.rejects(renderVersion(web, three), /EACCES|EPERM/, 'a changed tree reads every file again');
  } finally {
    chmodSync(join(web, 'main.js'), 0o644);
  }
});
