// Every uniform the cloud's two programs declare, against the object that feeds them.
//
// **This is the obligation the split created, so it arrives with the split rather than
// after it.** The GLSL lives in `web/cloud-shader.js` and the `uniforms` object lives in
// `web/main.js`, and nothing pairs them at runtime: three.js writes the keys it is given
// and ignores the rest, so a uniform declared in the shader with no key is read as zero
// with nothing on the console, and a key with no declaration is a write per frame that
// reaches no pixel. Both are silent, and both are exactly what a move of nine hundred
// lines out of one file makes easy.
//
// Read as text on both sides, which is the honest way and not a shortcut. The shader is
// text by nature. The object could in principle be imported, but `main.js` builds a
// renderer in its first fifty lines and cannot be loaded outside a browser at all - and a
// test that ran the module would be asserting against what the registry has already
// overwritten rather than against what is declared. So both sides are scanned, and the
// scan is made to fail loudly when it matches nothing: an empty extraction passing an
// equality against another empty extraction is the shape this repo keeps case files about.
//
// What this does not claim is that a uniform is ever *written* with a value that means
// anything - that is `registry-check`, which drives each parameter through the registry
// and compares pixels. This one only says the two lists are the same list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

/**
 * Every name declared by a `uniform` line in the two programs.
 *
 * One declaration carries several names - `uniform vec2 focal, center, resolution;` is
 * three - which is why this splits on the comma rather than taking one name per line.
 */
const declaredInGlsl = () => {
  const source = readFileSync(join(WEB, 'cloud-shader.js'), 'utf8');
  const names = new Set();
  for (const line of source.matchAll(/^\s*uniform\s+\w+\s+([^;]+);/gm)) {
    for (const name of line[1].split(',')) names.add(name.trim());
  }
  return names;
};

/**
 * Every key of the `uniforms` object literal in `main.js`.
 *
 * Bounded by the literal's own braces at column zero rather than scanned over the whole
 * file, so a `key: { value }` pair in some unrelated object cannot join the list. Keys are
 * taken at exactly one level of indentation for the same reason: the nested `{ value: ... }`
 * is at two, and so is every property of the objects further down the file.
 */
const keysInMain = () => {
  const source = readFileSync(join(WEB, 'main.js'), 'utf8');
  const start = source.indexOf('\nconst uniforms = {\n');
  assert.notEqual(start, -1, 'main.js no longer declares `const uniforms = {` at column zero');
  const end = source.indexOf('\n};\n', start);
  assert.notEqual(end, -1, 'the uniforms literal has no terminator at column zero');
  const names = new Set();
  for (const line of source.slice(start, end).matchAll(/^ {2}([A-Za-z_]\w*):/gm)) names.add(line[1]);
  return names;
};

test('the scan finds both lists, so an equality below cannot pass on two empty sets', () => {
  // The falsification control for this file. Both sides are read by pattern, and a pattern
  // that stopped matching would leave two empty sets that are trivially equal - a green row
  // saying nothing at all. Sixty is well under the seventy-six there are and well over
  // anything a broken scan would return.
  assert.ok(declaredInGlsl().size > 60, `only ${declaredInGlsl().size} uniforms found in the GLSL`);
  assert.ok(keysInMain().size > 60, `only ${keysInMain().size} keys found in the uniforms literal`);
});

test('every uniform the shaders declare has a key, so none of them reads a silent zero', () => {
  const keys = keysInMain();
  const missing = [...declaredInGlsl()].filter((name) => !keys.has(name));
  assert.deepEqual(missing, [], `declared in the GLSL with no key in main.js: ${missing.join(', ')}`);
});

test('and every key is declared, so none of them is written to nothing', () => {
  const declared = declaredInGlsl();
  const orphan = [...keysInMain()].filter((name) => !declared.has(name));
  assert.deepEqual(orphan, [], `keys in main.js the GLSL never declares: ${orphan.join(', ')}`);
});
