import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('the menu names destinations without explanatory captions', () => {
  const menu = source('web/menu.html');
  assert.doesNotMatch(menu, /class="sum"/);
  assert.doesNotMatch(menu, /class="why"/);
  assert.match(menu, /<span class="what">Media library<\/span>/);
});

test('the visible product name is Media library', () => {
  assert.match(source('web/projects.html'), />Media library<\/a>/);
  assert.match(source('web/library.html'), /<title>Braindance · Media library<\/title>/);
  assert.match(source('web/library.html'), />Media library<\/a>/);
  assert.match(source('web/take-picker.js'), /'Open Media library', '\/library'/);
  assert.match(source('README.md'), /### 2\. Find it in the media library/);
});

test('dialogs and work surfaces do not carry static helper prose', () => {
  const editor = source('web/index.html');
  const presetDialog = editor.match(/<dialog id="presetPick"[\s\S]*?<\/dialog>/)?.[0] ?? '';

  for (const id of ['hint', 'projectNote', 'obsNote']) {
    assert.doesNotMatch(editor, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(editor, /<div class="diverged"[\s\S]*?<p>/);
  assert.doesNotMatch(presetDialog, /<p>/);
  assert.doesNotMatch(source('web/projects.html'), /id="nBody"/);
  assert.doesNotMatch(source('web/library.html'), /id="nBody"|class="vkeys"/);
});
