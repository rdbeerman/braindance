// The cloud's two programs, assembled out of the spine and the shipped packages, against
// the two literals the file used to hold.
//
// **This is the gate the whole extraction rests on, and it is an equality rather than a
// resemblance.** Moving GLSL out of one file and into fifteen is a refactor exactly as long
// as the text that reaches the driver does not move, and the ways it can move quietly are
// not exotic: a chunk boundary off by one line, a blank line the spine keeps and the chunk
// also carries, an indent normalised on the way through, a generated declaration written
// `out float x;` where the file said something else. None of those breaks a compile and
// none of them shows up in a picture anybody would look twice at - the shader still runs,
// it just is not the shader that was graded. So the assembled strings are held byte for
// byte against `git show`, and the falsification control below flips one byte in each
// chunk file in turn to prove the equality is reading them at all.
//
// **The revision is resolved by content and never by hash.** Preparing this repository for
// release rewrote its history once already, which moved every hash after the first
// rewritten commit and left a pinned sha naming nothing - a tool that dies inside `git
// show` exits non-zero with nothing asserted, which reads exactly like a check that ran and
// failed. So the marker is a string only the monolithic file contains, `git log -S` names
// the commits where its count changed, and the newest revision still holding it is the one
// this compares against. Before the split lands that is `HEAD` itself, whose blob still
// carries the literals while the working tree no longer does; after it lands it is the
// commit before the removal. Both are the same question - the last revision holding the
// monolith - asked without ever writing a hash down.
//
// What this does not claim is that the assembled shader is *correct*. It says the split
// changed nothing, which is the only claim a refactor gets to make, and `registry-check`
// is what says the terms reach pixels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { cloudSpine } from '../web/cloud-shader.js';
import { assembleShaders } from '../web/shader-assembly.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN = join(ROOT, 'effects-builtin');

// A string the monolithic file contains and the spine does not. The export declaration
// itself rather than a piece of GLSL, because GLSL is exactly what moved into the chunk
// files and a marker that moved with it would resolve to the wrong side of the split.
const MARKER = 'export const vertexShader';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/**
 * The newest revision whose `web/cloud-shader.js` still holds the marker.
 *
 * `git log -S` lists the commits where the marker's count changed, newest first - the one
 * that introduced it and, once the split is committed, the one that removed it. Asking
 * `HEAD` first is what makes this exact before the split lands: the working tree has
 * already dropped the marker while `HEAD`'s blob still carries it, and the `-S` walk on
 * its own would answer with the commit that *introduced* the literals, months of shader
 * work ago.
 */
const revBeforeSplit = () => {
  if (git('show', `HEAD:web/cloud-shader.js`).includes(MARKER)) return 'HEAD';
  const touched = git('log', '-S', MARKER, '--format=%H', '--', 'web/cloud-shader.js')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  assert.ok(touched.length, `no commit in this history changes the count of ${JSON.stringify(MARKER)} in web/cloud-shader.js`);
  return `${touched[0]}^`;
};

/**
 * The two literals as that revision holds them, evaluated rather than parsed.
 *
 * Through a `data:` URL because the file imports nothing at all - which is asserted rather
 * than assumed, since a relative specifier inside a `data:` module has no base to resolve
 * against and would throw a message about the URL rather than about the file.
 */
const literalsAt = async (rev) => {
  const source = git('show', `${rev}:web/cloud-shader.js`);
  assert.ok(source.includes(MARKER), `${rev} does not hold ${JSON.stringify(MARKER)}, so the marker resolved to the wrong revision`);
  assert.equal(source.match(/^\s*import\s/m), null, `${rev}'s web/cloud-shader.js imports something, so it cannot be evaluated as a data: module`);
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const { vertexShader, fragmentShader } = await import(url);
  return { vertexShader, fragmentShader };
};

/**
 * Every shipped package, in the shape `/effects/:id` answers with: the manifest, and the
 * text of every chunk it names.
 *
 * Read off the directory rather than fetched, which is the whole reason `assembleShaders`
 * takes its packages as an argument and imports nothing - the page gets them over HTTP and
 * this gets them off disk, and where they came from is exactly what must not matter.
 */
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

test('the spine and the shipped packages assemble to the two programs the monolith held', async () => {
  const rev = revBeforeSplit();
  const before = await literalsAt(rev);
  const after = assembleShaders(cloudSpine, shippedPackages());
  assert.equal(after.vertexShader, before.vertexShader,
    `the assembled vertex program is not the one ${rev} holds`);
  assert.equal(after.fragmentShader, before.fragmentShader,
    `the assembled fragment program is not the one ${rev} holds`);
});

test('one byte moved in any chunk moves the program it belongs to, and only that one', async () => {
  // The falsification control, and it flips a byte in **every** chunk rather than in one:
  // a chunk that never reached the output would leave the equality above green while
  // contributing nothing, and one arm aimed at one file cannot see the rest. The arms are
  // enumerated from the manifests rather than listed here, so a package that declares a
  // chunk is asked about it by existing - which is what kept this control whole when the
  // glitch and the lattice moved out after the glyph field and the rain. The
  // direction is asserted as well as the difference, because a chunk spliced into the
  // wrong program is a thing this assembler could do and the equality alone would only say
  // that something moved.
  const rev = revBeforeSplit();
  const before = await literalsAt(rev);
  const packages = shippedPackages();
  let flipped = 0;
  for (const pkg of packages) {
    for (const [file, text] of Object.entries(pkg.chunks)) {
      const at = text.search(/\S/);
      assert.ok(at >= 0, `${pkg.id}/${file} is whitespace, so a flip in it could not be seen`);
      const mutated = `${text.slice(0, at)}${text[at] === 'x' ? 'y' : 'x'}${text.slice(at + 1)}`;
      // Rule 2: confirm the mutation did something before believing what it caught.
      assert.notEqual(mutated, text, `${pkg.id}/${file} did not change under the flip`);
      const staged = packages.map((p) => (p === pkg ? { ...p, chunks: { ...p.chunks, [file]: mutated } } : p));
      const after = assembleShaders(cloudSpine, staged);
      const vert = /\.vert\./.test(file);
      const frag = /\.frag\./.test(file);
      assert.ok(vert !== frag, `${pkg.id}/${file} says neither .vert. nor .frag., so which program it belongs to is a guess`);
      assert.notEqual(vert ? after.vertexShader : after.fragmentShader,
        vert ? before.vertexShader : before.fragmentShader,
        `${pkg.id}/${file} was flipped and the ${vert ? 'vertex' : 'fragment'} program did not move - it reaches no program at all`);
      assert.equal(vert ? after.fragmentShader : after.vertexShader,
        vert ? before.fragmentShader : before.vertexShader,
        `${pkg.id}/${file} was flipped and the ${vert ? 'fragment' : 'vertex'} program moved, so it is spliced into the program its name denies`);
      flipped++;
    }
  }
  // The floor under the loop: a scan that found no chunks would run zero arms and pass. It
  // is raised whenever a package moves its GLSL out, because a floor left at the count of
  // the commit that wrote it stops being a floor the moment the next package arrives - a
  // manifest that silently lost its `chunks` section would take four arms away and still
  // clear eleven. Eleven with the glyph field and the rain, fifteen with the glitch and the
  // lattice, nineteen with the region family's four.
  assert.ok(flipped >= 19, `only ${flipped} chunk files were flipped, so this control ran on almost nothing`);
});

test('the numbers place the text, and the order the packages arrive in does not', () => {
  // **The two arms above cannot see the sort, and that was measured rather than assumed.**
  // Taking `stages.sort(byOrder)` out of the assembler entirely leaves both of them green:
  // the packages are read in directory order, and every shipped stage's declared order
  // happens to be that same order - glitch before lattice on `v.displace`, glyph before rain
  // on the two declaration stages and on `f.tone`, noise before push before ripple on
  // `v.regionDisplace`. Six stages, six coincidences, and each one arrived honestly, because
  // a package is named after the effect and the effects were written in roughly the order
  // they run. So a build that lost the sort would draw the identical picture today and a
  // different one the first time somebody adds a package whose name sorts the wrong way -
  // which is a defect that ships and then waits.
  //
  // A fixture rather than a shipped set is the only thing that can hold it, for the reason
  // above: what has to be asserted is that the *numbers* decide, and the shipped numbers
  // agree with the alphabet. So the two packages here are named against their orders - the
  // one that goes first is called `zeta` and the one that goes second `alpha` - and the same
  // inversion is put through the gate, where `gateOrder` and the id disagree the same way.
  // The gate's half is live on the shipped set as well, since the region's push consumes at
  // 100 where its noise consumes at 200; the stage's half exists only here.
  const spine = {
    vertex: [
      { text: 'head\n' },
      { stage: 'run' },
      { service: 'gate', open: 'if (', body: ') {\n', close: '}\n' },
    ],
    fragment: [{ text: 'frag\n' }],
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
  // Handed in alphabetically, which is the order the directory and `/effects` both give.
  const packages = [pkg('alpha', 200, 200), pkg('zeta', 100, 100)];
  const { vertexShader } = assembleShaders(spine, packages);
  assert.equal(vertexShader,
    'head\nzeta-run\nalpha-run\nif (zetaOn || alphaOn) {\n  zeta-gate\n  alpha-gate\n}\n',
    'the assembler placed the chunks by the order the packages arrived in rather than by the numbers they declare');
});
