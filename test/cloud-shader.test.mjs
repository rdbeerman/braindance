// Every uniform the cloud's two programs declare, against the object that feeds them.
//
// **This is the obligation the split created, so it arrives with the split rather than
// after it.** The GLSL lives in `web/cloud-shader.js` and the `uniforms` table lives in
// `web/point-cloud.js`, and nothing pairs them at runtime: three.js writes the keys it is
// given and ignores the rest, so a uniform declared in the shader with no key is read as
// zero with nothing on the console, and a key with no declaration is a write per frame
// that reaches no pixel. Both are silent, and both are exactly what a move of nine hundred
// lines out of one file makes easy - and the table has since made the same journey, which
// is the second half of why this row exists.
//
// Read as text on both sides, which is the honest way and not a shortcut. The shader is
// text by nature. The table could in principle be imported, but `web/point-cloud.js`
// reaches the scene through `web/scene.js`, which builds a renderer as it evaluates, so it
// cannot be loaded outside a browser at all - and a test that ran the module would be
// asserting against what the registry has already overwritten rather than against what is
// declared. So both sides are scanned, and the scan is made to fail loudly when it matches
// nothing: an empty extraction passing an equality against another empty extraction is the
// shape this repo keeps case files about.
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
 * Every key of the `uniforms` table in `point-cloud.js`.
 *
 * Bounded by the literal's own braces rather than scanned over the whole file, so a
 * `key: { value }` pair in some unrelated object cannot join the list, and keys are taken
 * at exactly one level in from the literal for the same reason: the nested `{ value: ... }`
 * is one deeper, and so is every property of the material built underneath it.
 *
 * The two indents this reads are the table's position inside `buildPointCloud` rather than
 * a formatting preference. The table cannot be built while the module evaluates - four of
 * its cells come back from `buildTextures` and `stateTex` samples a target the surface
 * memory has not made yet - so it lives one scope in, and a scan anchored at column zero
 * would find nothing at all. Which is the case the row below exists to make loud.
 */
const keysInTable = () => {
  const source = readFileSync(join(WEB, 'point-cloud.js'), 'utf8');
  const start = source.indexOf('\n  uniforms = {\n');
  assert.notEqual(start, -1, 'point-cloud.js no longer assigns `uniforms = {` inside its build');
  const end = source.indexOf('\n  };\n', start);
  assert.notEqual(end, -1, 'the uniforms literal has no terminator at the build function\'s indent');
  const names = new Set();
  for (const line of source.slice(start, end).matchAll(/^ {4}([A-Za-z_]\w*):/gm)) names.add(line[1]);
  return names;
};

test('the scan finds both lists, so an equality below cannot pass on two empty sets', () => {
  // The falsification control for this file. Both sides are read by pattern, and a pattern
  // that stopped matching would leave two empty sets that are trivially equal - a green row
  // saying nothing at all. Sixty is well under the seventy-six there are and well over
  // anything a broken scan would return.
  assert.ok(declaredInGlsl().size > 60, `only ${declaredInGlsl().size} uniforms found in the GLSL`);
  assert.ok(keysInTable().size > 60, `only ${keysInTable().size} keys found in the uniforms literal`);
});

test('every uniform the shaders declare has a key, so none of them reads a silent zero', () => {
  const keys = keysInTable();
  const missing = [...declaredInGlsl()].filter((name) => !keys.has(name));
  assert.deepEqual(missing, [], `declared in the GLSL with no key in point-cloud.js: ${missing.join(', ')}`);
});

test('and every key is declared, so none of them is written to nothing', () => {
  const declared = declaredInGlsl();
  const orphan = [...keysInTable()].filter((name) => !declared.has(name));
  assert.deepEqual(orphan, [], `keys in point-cloud.js the GLSL never declares: ${orphan.join(', ')}`);
});
