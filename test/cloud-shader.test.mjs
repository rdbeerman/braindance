// Every uniform each assembled program declares, against the object that feeds it.
//
// **This is the obligation the split created, so it arrives with the split rather than
// after it.** The GLSL lives in `web/cloud-shader.js` and `web/grade-shader.js` and, since
// the effects began carrying their own, in the chunk files under `effects-builtin/`; the
// tables live in `web/point-cloud.js` and `web/post-chain.js`, and nothing pairs them at
// runtime: three.js writes the keys it is given and ignores the rest, so a uniform declared
// in the shader with no key is read as zero with nothing on the console, and a key with no
// declaration is a write per frame that reaches no pixel. Both are silent, and both are
// exactly what a move of a thousand lines out of two files makes easy - and both tables have
// since made the same journey, which is the second half of why this row exists.
//
// **Two programs and two tables, paired separately and never pooled.** The cloud's uniforms
// and the grade's are different populations feeding different passes, and a single set
// unioned across both would go green on a grade term that had drifted into the point cloud's
// table: the name would be declared somewhere and keyed somewhere, and neither somewhere
// would be the same shader. The pairing is per program, so a term in the wrong table is a
// red row on both sides at once.
//
// Read as text on the table side, which is the honest way and not a shortcut. The tables
// could in principle be imported, but `web/point-cloud.js` reaches the scene through
// `web/scene.js`, which builds a renderer as it evaluates, and `web/post-chain.js` reaches
// the same renderer - so neither can be loaded outside a browser at all, and a test that ran
// either module would be asserting against what the registry has already overwritten rather
// than against what is declared. So the tables are scanned, and each scan is made to fail
// loudly when it matches nothing: an empty extraction passing an equality against another
// empty extraction is the shape this repo keeps case files about.
//
// **The shader side is assembled rather than scanned**, which is the half that changed when
// the grade pass moved out. A file scan cannot say which program a chunk feeds without
// reading its name, and it counts text a slot fallback carries that nothing ever compiles -
// two more things to be right about, for a question the assembler answers exactly. What the
// driver is handed is what gets scanned, so a declaration in the `v.mask` or `g.fetch`
// fallback is correctly absent here, and a chunk that reaches no program contributes nothing
// rather than demanding a key.
//
// What this does not claim is that a uniform is ever *written* with a value that means
// anything - that is `registry-check`, which drives each parameter through the registry
// and compares pixels. This one only says the two lists are the same list. Nor does it claim
// a chunk is spliced at all: that is `test/shader-assembly.test.mjs`, which flips a byte in
// each chunk in turn and requires the program its name promises to move.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { cloudSpine } from '../web/cloud-shader.js';
import { gradeSpine } from '../web/grade-shader.js';
import { assembleShaders } from '../web/shader-assembly.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const BUILTIN = join(ROOT, 'effects-builtin');

/**
 * Where each program's uniform table lives, and what bounds it.
 *
 * The indents are the tables' positions in their files rather than a formatting preference.
 * The cloud's cannot be built while its module evaluates - four of its cells come back from
 * `buildTextures` and `stateTex` samples a target the surface memory has not made yet - so
 * it lives one scope in; the grade's holds two constructed defaults and nothing else, so it
 * sits at the top level. A scan anchored at the wrong column finds nothing at all, which is
 * the case the floor row below exists to make loud.
 */
const TABLES = {
  cloud: { file: 'point-cloud.js', open: '\n  uniforms = {\n', close: '\n  };\n', key: /^ {4}([A-Za-z_]\w*):/gm, floor: 60 },
  grade: { file: 'post-chain.js', open: '\nconst GRADE_UNIFORMS = {\n', close: '\n};\n', key: /^ {2}([A-Za-z_]\w*):/gm, floor: 8 },
};

const shippedPackages = () => readdirSync(BUILTIN, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .map((id) => {
    const manifest = JSON.parse(readFileSync(join(BUILTIN, id, 'manifest.json'), 'utf8'));
    const chunks = {};
    for (const c of manifest.chunks ?? []) chunks[c.file] = readFileSync(join(BUILTIN, id, c.file), 'utf8');
    return { id, manifest, chunks };
  });

const PROGRAMS = assembleShaders({ cloud: cloudSpine, grade: gradeSpine }, shippedPackages());

/**
 * Every name declared by a `uniform` line in one assembled program.
 *
 * One declaration carries several names - `uniform vec2 focal, center, resolution;` is
 * three - which is why this splits on the comma rather than taking one name per line. Both
 * shaders of the program together, because a term declared in the vertex stage and read in
 * the fragment stage is one uniform with one key: the glyph field's master is declared in
 * both, since it grows the sprite up there and crossfades the mark down here.
 */
const declaredInGlsl = (program) => {
  const names = new Set();
  for (const source of [PROGRAMS[program].vertexShader, PROGRAMS[program].fragmentShader]) {
    for (const line of source.matchAll(/^\s*uniform\s+\w+\s+([^;]+);/gm)) {
      for (const name of line[1].split(',')) names.add(name.trim());
    }
  }
  return names;
};

/**
 * Every key of one program's uniform table.
 *
 * Bounded by the literal's own braces rather than scanned over the whole file, so a
 * `key: { value }` pair in some unrelated object cannot join the list, and keys are taken
 * at exactly one level in from the literal for the same reason: the nested `{ value: ... }`
 * is one deeper, and so is every property of whatever is built underneath it.
 */
const keysInTable = (program) => {
  const { file, open, close, key } = TABLES[program];
  const source = readFileSync(join(WEB, file), 'utf8');
  const start = source.indexOf(open);
  assert.notEqual(start, -1, `web/${file} no longer declares ${JSON.stringify(open.trim())}, so this scan reads nothing`);
  const end = source.indexOf(close, start);
  assert.notEqual(end, -1, `web/${file}'s ${program} uniform literal has no terminator at its own indent`);
  const names = new Set();
  for (const line of source.slice(start, end).matchAll(key)) names.add(line[1]);
  return names;
};

for (const program of Object.keys(TABLES)) {
  test(`the ${program} scan finds both lists, so an equality below cannot pass on two empty sets`, () => {
    // The falsification control for this file. Both sides are read by pattern, and a pattern
    // that stopped matching would leave two empty sets that are trivially equal - a green row
    // saying nothing at all. Each floor is well under what its program holds and well over
    // anything a broken scan would return. Neither is raised to catch a scan that lost the
    // packages and kept the spine: the row that names that failure is the third one below,
    // which lists the keys as writes reaching nothing rather than printing a count.
    const { floor } = TABLES[program];
    assert.ok(declaredInGlsl(program).size > floor, `only ${declaredInGlsl(program).size} uniforms found in the ${program} GLSL`);
    assert.ok(keysInTable(program).size > floor, `only ${keysInTable(program).size} keys found in the ${program} uniforms literal`);
  });

  test(`every uniform the ${program} program declares has a key, so none of them reads a silent zero`, () => {
    const keys = keysInTable(program);
    const missing = [...declaredInGlsl(program)].filter((name) => !keys.has(name));
    assert.deepEqual(missing, [], `declared in the ${program} GLSL with no key in web/${TABLES[program].file}: ${missing.join(', ')}`);
  });

  test(`and every ${program} key is declared, so none of them is written to nothing`, () => {
    const declared = declaredInGlsl(program);
    const orphan = [...keysInTable(program)].filter((name) => !declared.has(name));
    assert.deepEqual(orphan, [], `keys in web/${TABLES[program].file} the ${program} GLSL never declares: ${orphan.join(', ')}`);
  });
}
