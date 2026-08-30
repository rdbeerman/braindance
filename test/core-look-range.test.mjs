import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const calibrated = Object.freeze({
  bloom: [0, 1, 0.05],
});

const source = await readFile(new URL('../web/main.js', import.meta.url), 'utf8');
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the core bloom effect exposes only its calibrated authoring travel', () => {
  const actual = {};
  for (const name of Object.keys(calibrated)) {
    const match = source.match(new RegExp(
      `^\\s*['"]?${escaped(name)}['"]?: \\{[^\\n]*min: ([^,]+), max: ([^,]+), step: ([^,]+),`,
      'm',
    ));
    assert.ok(match, `${name} has no literal slider range in buildParams`);
    actual[name] = match.slice(1).map(Number);
  }
  assert.deepEqual(actual, calibrated);
});
