// Every program this page compiles, assembled out of the spines and the shipped packages,
// against the literals the two files used to hold.
//
// **This is the gate the whole extraction rests on, and it is an equality rather than a
// resemblance.** Moving GLSL out of two files and into twenty is a refactor exactly as long
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
// this compares against. Before a split lands that is `HEAD` itself, whose blob still
// carries the literals while the working tree no longer does; after it lands it is the
// commit before the removal. Both are the same question - the last revision holding the
// monolith - asked without ever writing a hash down. The two programs are pinned
// separately, because they were cut in different commits and each names its own marker.
//
// **The two monoliths are read differently, and the difference is forced rather than
// chosen.** `web/cloud-shader.js` imports nothing at any revision, so its literals are
// evaluated whole through a `data:` module - which is exact by construction, escape
// sequences included. `web/post-chain.js` imports three.js and three of its addons, and a
// `data:` module cannot resolve a bare specifier at all, so that one is read by cutting the
// template literal out of the source and evaluating the cut on its own. What makes that
// safe is asserted rather than assumed: the file carries no backslash anywhere, so no
// literal in it can hold an escaped backtick, and the first backtick after the property name
// therefore opens the literal and the next one closes it.
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
import { gradeSpine } from '../web/grade-shader.js';
import { assembleShaders } from '../web/shader-assembly.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN = join(ROOT, 'effects-builtin');

const SPINES = { cloud: cloudSpine, grade: gradeSpine };

// What a chunk's name says about where its text ends up, and it is a claim rather than a
// convention: the control below flips a byte in every chunk and requires the program its
// name promises to move while every other program stands still, so a file misnamed is a red
// row rather than a chunk quietly compiled into the wrong shader.
const NAMES = {
  '.vert.glsl': ['cloud', 'vertexShader'],
  '.frag.glsl': ['cloud', 'fragmentShader'],
  '.grade.glsl': ['grade', 'fragmentShader'],
};

// Each monolith by the string only it contains, and by the file that used to hold it.
//
// The cloud's marker is the export declaration itself rather than a piece of GLSL, because
// GLSL is exactly what moved into the chunk files and a marker that moved with it would
// resolve to the wrong side of the split. The grade has no export to name - its literal sat
// inside an object - so its marker is the one line of that shader which is neither a term
// nor a comment: the hash function, which moved to the spine entire and so is absent from
// `web/post-chain.js` at every revision after the cut and present at every one before it.
const MONOLITHS = {
  cloud: { file: 'web/cloud-shader.js', marker: 'export const vertexShader' },
  grade: {
    file: 'web/post-chain.js',
    marker: 'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
  },
};

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/**
 * The newest revision whose file still holds the marker.
 *
 * `git log -S` lists the commits where the marker's count changed, newest first - the one
 * that introduced it and, once the split is committed, the one that removed it. Asking
 * `HEAD` first is what makes this exact before the split lands: the working tree has
 * already dropped the marker while `HEAD`'s blob still carries it, and the `-S` walk on
 * its own would answer with the commit that *introduced* the literals, months of shader
 * work ago.
 */
const revBeforeSplit = (program) => {
  const { file, marker } = MONOLITHS[program];
  if (git('show', `HEAD:${file}`).includes(marker)) return 'HEAD';
  const touched = git('log', '-S', marker, '--format=%H', '--', file)
    .split('\n').map((s) => s.trim()).filter(Boolean);
  assert.ok(touched.length, `no commit in this history changes the count of ${JSON.stringify(marker)} in ${file}`);
  return `${touched[0]}^`;
};

/**
 * One program as that revision holds it, evaluated rather than parsed.
 *
 * The cloud's file imports nothing at all - which is asserted rather than assumed, since a
 * relative specifier inside a `data:` module has no base to resolve against and would throw
 * a message about the URL rather than about the file - so the whole module evaluates and its
 * two exports are read straight off.
 *
 * The grade's cannot: it imports three.js, and stubbing that out to get at a string would be
 * a second three.js living in a test. So each of its two literals is cut from the source
 * between the backtick that follows its property name and the next backtick, and the cut is
 * evaluated on its own. **The cut is only the whole literal if no backtick in the file is
 * escaped**, so the absence of any backslash at all is asserted first - and the evaluation
 * is kept rather than trusting the cut to be its own value, because that is the half that
 * would go wrong silently if one ever arrived.
 */
const monolithAt = async (program, rev) => {
  const { file, marker } = MONOLITHS[program];
  const source = git('show', `${rev}:${file}`);
  assert.ok(source.includes(marker), `${rev} does not hold ${JSON.stringify(marker)}, so the marker resolved to the wrong revision`);
  if (program === 'cloud') {
    assert.equal(source.match(/^\s*import\s/m), null, `${rev}'s ${file} imports something, so it cannot be evaluated as a data: module`);
    const { vertexShader, fragmentShader } = await evaluate(source);
    return { vertexShader, fragmentShader };
  }
  assert.equal(source.includes('\\'), false,
    `${rev}'s ${file} carries a backslash, so a backtick in it could be escaped and this cut could end in the middle of a literal`);
  const cut = async (label) => {
    const at = source.indexOf(`${label}: /* glsl */ \``);
    assert.ok(at >= 0, `${rev}'s ${file} declares no ${label} literal, so the marker resolved to the wrong revision`);
    const from = source.indexOf('`', at) + 1;
    const to = source.indexOf('`', from);
    assert.ok(to > from, `${rev}'s ${file} has an unterminated ${label} literal`);
    const text = source.slice(from, to);
    assert.ok(text.length > 0, `${rev}'s ${label} literal is empty, so this comparison would run on nothing`);
    const { value } = await evaluate(`export const value = \`${text}\`;`);
    return value;
  };
  return { vertexShader: await cut('vertexShader'), fragmentShader: await cut('fragmentShader') };
};

const evaluate = (source) => import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);

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

test('the spines and the shipped packages assemble to the programs the monoliths held', async () => {
  const after = assembleShaders(SPINES, shippedPackages());
  for (const program of Object.keys(MONOLITHS)) {
    const rev = revBeforeSplit(program);
    const before = await monolithAt(program, rev);
    assert.equal(after[program].vertexShader, before.vertexShader,
      `the assembled ${program} vertex program is not the one ${rev} holds`);
    assert.equal(after[program].fragmentShader, before.fragmentShader,
      `the assembled ${program} fragment program is not the one ${rev} holds`);
  }
});

test('one byte moved in any chunk moves the program it belongs to, and only that one', async () => {
  // The falsification control, and it flips a byte in **every** chunk rather than in one:
  // a chunk that never reached the output would leave the equality above green while
  // contributing nothing, and one arm aimed at one file cannot see the rest. The arms are
  // enumerated from the manifests rather than listed here, so a package that declares a
  // chunk is asked about it by existing - which is what kept this control whole when the
  // glitch and the lattice moved out after the glyph field and the rain, and again when the
  // region family, the tone run and the grade pass followed them. The direction is asserted
  // as well as the difference, because a chunk spliced into the wrong program is a thing
  // this assembler could do and the equality alone would only say that something moved.
  //
  // **Every other program has to stand still, not just the sibling shader.** While there was
  // one spine, "the other one" was a pair and the assertion could name it; there are four
  // assembled strings now, so the arm walks them all and requires the one the file's name
  // promises to be the only one that moved. A chunk landing in a second program is what that
  // catches, and it is the same defect `syntax-check`'s count rule watches for from the
  // other end.
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
      // Rule 2: confirm the mutation did something before believing what it caught.
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
  // The floor under the loop: a scan that found no chunks would run zero arms and pass. It
  // is raised whenever a package moves its GLSL out, because a floor left at the count of
  // the commit that wrote it stops being a floor the moment the next package arrives - a
  // manifest that silently lost its `chunks` section would take four arms away and still
  // clear eleven. Eleven with the glyph field and the rain, fifteen with the glitch and the
  // lattice, nineteen with the region family's four, and twenty-nine with the tone run's
  // three and the grade pass's seven.
  assert.ok(flipped >= 29, `only ${flipped} chunk files were flipped, so this control ran on almost nothing`);
});

test('the numbers place the text, and the order the packages arrive in does not', () => {
  // **The two arms above could not see the sort until the tone run moved out, and that was
  // measured rather than assumed.** Taking `stages.sort(byOrder)` out of the assembler
  // entirely used to leave both of them green: the packages are read in directory order, and
  // every shipped stage's declared order happened to be that same order - glitch before
  // lattice on `v.displace`, glyph before rain on the two declaration stages and on
  // `f.tone`, noise before push before ripple on `v.regionDisplace`. Six stages, six
  // coincidences, and each one arrived honestly, because a package is named after the effect
  // and the effects were written in roughly the order they run. So a build that lost the sort
  // would draw the identical picture and a different one the first time somebody added a
  // package whose name sorted the wrong way - a defect that ships and then waits.
  //
  // Two of the shipped stages disagree with the alphabet now. `f.tone` runs thermal, edges,
  // duotone, glitch, rain against a directory handing them over as duotone, edges, glitch,
  // rain, thermal, and `g.body` runs streak, raster, grain, vignette against grain, raster,
  // streak, vignette - so the arms above would redden on a build that lost the sort. This
  // one stays anyway, and not out of caution: what it asserts is that the *numbers* decide,
  // where those two stages assert only that the current numbers and the current alphabet
  // disagree, which is a fact about the sixteen packages installed today and would go away
  // the moment somebody renamed one.
  //
  // A fixture rather than a shipped set is the only thing that can hold the general claim.
  // So the two packages here are named against their orders - the one that goes first is
  // called `zeta` and the one that goes second `alpha` - and the same inversion is put
  // through the gate, where `gateOrder` and the id disagree the same way. The gate's half is
  // live on the shipped set as well, since the region's push consumes at 100 where its noise
  // consumes at 200.
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
  // Handed in alphabetically, which is the order the directory and `/effects` both give.
  const packages = [pkg('alpha', 200, 200), pkg('zeta', 100, 100)];
  const { only } = assembleShaders(spines, packages);
  assert.equal(only.vertexShader,
    'head\nzeta-run\nalpha-run\nif (zetaOn || alphaOn) {\n  zeta-gate\n  alpha-gate\n}\n',
    'the assembler placed the chunks by the order the packages arrived in rather than by the numbers they declare');
});

test('a joint name means one place across every spine, so a second spine cannot shadow one', () => {
  // The refusal the one-call shape exists for, asserted rather than described. Two spines
  // offering the same joint name is not a conflict either of them can see on its own - each
  // is a well-formed spine - and the chunk that names it would be spliced into both, which
  // compiles and draws twice. Assembling every spine together is what makes the collision
  // visible at all, so the collision is what proves the collecting is happening.
  const spine = (text) => ({ vertex: [{ text }, { stage: 'shared' }], fragment: [{ text }] });
  assert.throws(
    () => assembleShaders({ first: spine('a\n'), second: spine('b\n') }, []),
    /declare "shared" twice/,
    'two spines declaring one joint name assembled without complaint, so the joints are being collected per spine');
});
