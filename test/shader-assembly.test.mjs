// Every program this page compiles, assembled out of the spines and the shipped packages,
// held to the rules that decide where each chunk's text lands. It says each chunk goes where
// its manifest names, not that the assembled shader is correct - `registry-check` is what
// says the terms reach pixels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { cloudSpine } from '../web/cloud-shader.js';
import { gradeSpine } from '../web/grade-shader.js';
import { moshSpine } from '../web/mosh-shader.js';
import { assembleShaders } from '../web/shader-assembly.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN = join(ROOT, 'effects-builtin');

const SPINES = { cloud: cloudSpine, grade: gradeSpine, mosh: moshSpine };

// A claim rather than a convention: the flip control below requires the program a chunk's
// name promises to be the only one that moves.
const NAMES = {
  '.vert.glsl': ['cloud', 'vertexShader'],
  '.frag.glsl': ['cloud', 'fragmentShader'],
  '.grade.glsl': ['grade', 'fragmentShader'],
  '.mosh.glsl': ['mosh', 'fragmentShader'],
};

const shippedPackages = () => readdirSync(BUILTIN, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .map((id) => {
    const manifest = JSON.parse(readFileSync(join(BUILTIN, id, 'manifest.json'), 'utf8'));
    const chunks = {};
    for (const c of manifest.chunks ?? []) {
      chunks[c.file] = readFileSync(join(BUILTIN, id, c.file), 'utf8');
    }
    return { id, manifest, chunks };
  });

test('one byte moved in any chunk moves the program it belongs to, and only that one', async () => {
  const packages = shippedPackages();
  const strings = (built) => Object.entries(built)
    .flatMap(([program, p]) => [[`${program}.vertexShader`, p.vertexShader], [`${program}.fragmentShader`, p.fragmentShader]]);
  const before = strings(assembleShaders(SPINES, packages));
  let flipped = 0;
  for (const pkg of packages) {
    for (const [file, text] of Object.entries(pkg.chunks)) {
      const at = text.search(/\S/);
      assert.ok(at >= 0, `${pkg.id}/${file} is whitespace, so a flip in it could not be seen`);
      const mutated = `${text.slice(0, at)}${text[at] === 'x' ? 'y' : 'x'}${text.slice(at + 1)}`;
      assert.notEqual(mutated, text, `${pkg.id}/${file} did not change under the flip`);
      const named = Object.entries(NAMES).filter(([suffix]) => file.endsWith(suffix));
      assert.equal(named.length, 1,
        `${pkg.id}/${file} names ${named.length} of the known programs, so which one it belongs to is a guess`);
      const [wantProgram, wantShader] = named[0][1];
      const staged = packages.map((p) => (p === pkg ? { ...p, chunks: { ...p.chunks, [file]: mutated } } : p));
      const after = strings(assembleShaders(SPINES, staged));
      const moved = after.filter(([, text], i) => text !== before[i][1]).map(([which]) => which);
      assert.deepEqual(moved, [`${wantProgram}.${wantShader}`],
        `${pkg.id}/${file} was flipped and ${moved.length === 0 ? 'no program moved - it reaches none of them'
          : `the programs that moved are ${moved.join(', ')} rather than the ${wantProgram}.${wantShader} its name promises`}`);
      flipped++;
    }
  }
  // Raise this whenever a package moves its GLSL out. A manifest that silently lost its
  // `chunks` section takes arms away, and a floor left behind still clears.
  assert.ok(flipped >= 29, `only ${flipped} chunk files were flipped, so this control ran on almost nothing`);
});

test('the numbers place the text, and the order the packages arrive in does not', () => {
  const spines = {
    only: {
      vertex: [
        { text: 'head\n' },
        { stage: 'run' },
        { service: 'gate', open: 'if (', body: ') {\n', close: '}\n' },
      ],
      fragment: [{ text: 'frag\n' }],
    },
  };
  const pkg = (id, order, gateOrder) => ({
    id,
    manifest: {
      consumes: [{ service: 'gate', when: `${id}On`, gateOrder }],
      chunks: [
        { stage: 'run', order, file: 'run.vert.glsl' },
        { stage: 'gate', file: 'gate.vert.glsl' },
      ],
    },
    chunks: { 'run.vert.glsl': `${id}-run\n`, 'gate.vert.glsl': `  ${id}-gate\n` },
  });
  // The names run against the orders on purpose - `zeta` goes first - and the packages are
  // handed in alphabetically, so directory order cannot pass for the declared order.
  const packages = [pkg('alpha', 200, 200), pkg('zeta', 100, 100)];
  const { only } = assembleShaders(spines, packages);
  assert.equal(only.vertexShader,
    'head\nzeta-run\nalpha-run\nif (zetaOn || alphaOn) {\n  zeta-gate\n  alpha-gate\n}\n',
    'the assembler placed the chunks by the order the packages arrived in rather than by the numbers they declare');
});

test('a stage takes any number of chunks, and any number means any number of different ones', () => {
  const spines = { only: { vertex: [{ stage: 'a' }, { stage: 'b' }], fragment: [{ text: '' }] } };
  const twice = {
    id: 'repeat',
    manifest: { chunks: [{ stage: 'a', order: 1, file: 'x.glsl' }, { stage: 'a', order: 2, file: 'x.glsl' }] },
    chunks: { 'x.glsl': 'X\n' },
  };
  assert.throws(() => assembleShaders(spines, [twice]),
    /repeat's x\.glsl is spliced into "a" twice/,
    'one stage naming one file twice assembled without complaint, so the same text is compiled twice');

  const shared = {
    id: 'shared',
    manifest: { chunks: [{ stage: 'a', order: 1, file: 'x.glsl' }, { stage: 'b', order: 1, file: 'x.glsl' }] },
    chunks: { 'x.glsl': 'X\n' },
  };
  assert.equal(assembleShaders(spines, [shared]).only.vertexShader, 'X\nX\n',
    'and one file on two joints is still spliced into both, which is what the rule above is a distinction from');
});

test('a joint name means one place across every spine, so a second spine cannot shadow one', () => {
  const spine = (text) => ({ vertex: [{ text }, { stage: 'shared' }], fragment: [{ text }] });
  assert.throws(
    () => assembleShaders({ first: spine('a\n'), second: spine('b\n') }, []),
    /declare "shared" twice/,
    'two spines declaring one joint name assembled without complaint, so the joints are being collected per spine');
});
