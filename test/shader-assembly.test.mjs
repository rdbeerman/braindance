// Every program this page compiles, assembled out of the spines and the shipped packages,
// held to the rules that decide where each chunk's text lands.
//
// **This gate used to be an equality against git history, and that half of it is gone.**
// While the GLSL was moving out of two files and into twenty, the only claim a refactor
// gets to make is that the text reaching the driver did not move, and the ways it can move
// quietly are not exotic: a chunk boundary off by one line, a blank line the spine keeps
// and the chunk also carries, an indent normalised on the way through, a generated
// declaration written `out float x;` where the file said something else. None of those
// breaks a compile and none of them shows up in a picture anybody would look twice at - the
// shader still runs, it just is not the shader that was graded. So the assembled strings
// were held byte for byte against the monoliths as `git show` served them, resolved by
// content marker rather than by hash.
//
// That arm was scaffolding and its own header said so: it pinned the shipped packages to a
// historical revision, so the first intentional change to a shader would break it, and it
// is deleted at the end of the extraction rather than carried into the next edit. What
// replaces it is not weaker and it is not this file: the ten-look probe renders the shipped
// looks through the real page and hashes the framebuffer, and it has come back equal to the
// same recorded baseline at every landing point of this refactor. `docs/performance.md`
// carries that result with its method, which is where a byte-identity claim about *pixels*
// belongs - a picture is the only place a shader that quietly stopped being the graded one
// would show, and a string equality against a deleted file cannot survive the next retune.
//
// **What stays here is everything the probe cannot see**, because it is structure rather
// than pixels and the shipped set answers most of it by coincidence. A chunk that reaches no
// program at all, a chunk spliced into two, a stage placed by the order the packages arrived
// in rather than by the numbers they declare, two spines offering one joint name - each of
// those draws a correct picture today and a wrong one the first time somebody installs a
// package whose id sorts the wrong way. So the arms below are live: they assemble the shipped
// spines and packages, perturb one thing, and require the difference the rules promise.
//
// What this does not claim is that the assembled shader is *correct*. It says the assembler
// puts each chunk where its manifest says, and `registry-check` is what says the terms reach
// pixels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('one byte moved in any chunk moves the program it belongs to, and only that one', async () => {
  // The falsification control, and it flips a byte in **every** chunk rather than in one:
  // a chunk that never reached the output would contribute nothing and no other arm here
  // would notice, and one arm aimed at one file cannot see the rest. The arms are
  // enumerated from the manifests rather than listed here, so a package that declares a
  // chunk is asked about it by existing - which is what kept this control whole when the
  // glitch and the lattice moved out after the glyph field and the rain, and again when the
  // region family, the tone run and the grade pass followed them. The direction is asserted
  // as well as the difference, because a chunk spliced into the wrong program is a thing
  // this assembler could do and a bare "something moved" would not tell them apart.
  //
  // **Both sides of the comparison are this tree's own assembly**, taken before the flip
  // and again after it. That is what is left once the equality against the monoliths goes:
  // the reference used to be a historical string, and asking the same question against the
  // unflipped live build is the form that survives the next intentional shader change. The
  // claim narrows honestly with it - this says each chunk reaches exactly the program its
  // filename names, and it no longer says which bytes those are.
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
  // **This is the only arm in the file that can see the sort at all, and that became true
  // when the equality against the monoliths went.** Taking `stages.sort(byOrder)` out of the
  // assembler is invisible to the flip control above by construction: that arm assembles the
  // tree twice with the same assembler and compares the two, so a rule dropped from the
  // assembler is dropped from both sides and the difference it reads is unchanged. Only a
  // reference the assembler did not produce can catch a missing rule, and the reference used
  // to be the historical monoliths - which is what this arm now stands in for, measured
  // rather than assumed: dropping the sort leaves the flip control green and reddens this.
  //
  // The shipped set cannot hold the claim either, and for a while it could not even see the
  // defect. Every shipped stage's declared order used to agree with directory order - glitch
  // before lattice on `v.displace`, glyph before rain on the two declaration stages and on
  // `f.tone`, noise before push before ripple on `v.regionDisplace`. Six stages, six
  // coincidences, and each one arrived honestly, because a package is named after the effect
  // and the effects were written in roughly the order they run. So a build that lost the sort
  // would draw the identical picture and a different one the first time somebody added a
  // package whose name sorted the wrong way - a defect that ships and then waits. Two shipped
  // stages disagree with the alphabet today: `f.tone` runs thermal, edges, duotone, glitch,
  // rain against a directory handing them over as duotone, edges, glitch, rain, thermal, and
  // `g.body` runs streak, raster, grain, vignette against grain, raster, streak, vignette.
  // But that is a fact about the sixteen packages installed today and goes away the moment
  // somebody renames one, so it is not something to rest a rule on.
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
