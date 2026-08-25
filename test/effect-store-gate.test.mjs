// The boot gate against a user root somebody has put packages into, under bare node.
//
// **`test/effect-door.test.mjs` cannot ask this and it is worth saying why rather than
// leaving two files that look like one.** That one is about `doorRefusal`, which is a pure
// function of an envelope and the two spines - no filesystem, no store, no roots. What this
// file is about is the thing the door cannot see from inside itself: a package that is
// perfectly correct on its own account and takes one of its neighbours down, which is a
// property of the *set* the store settles on and only exists once there are two roots and a
// rename to make. So the fixtures here are directories, the subject is
// `EffectStore.refuseIncompatiblePackages`, and the assertions are about what is left standing
// afterwards.
//
// The user root is a fresh temporary directory each time. The builtin root is the repo's own
// `effects-builtin/`, which is read and never written - the store only ever renames inside its
// user root, and a test that pointed both at the same place would be one bug away from moving
// a shipped package.
//
// Still bare node: no server, no port, no browser. What a browser adds is the last row of
// `effect-check` section 12, which is the same gate asked of a page that has to come up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EffectStore } from '../server/effect-store.js';
import { cloudSpine } from '../web/cloud-shader.js';
import { gradeSpine } from '../web/grade-shader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN = join(ROOT, 'effects-builtin');
const SPINES = { cloud: cloudSpine, grade: gradeSpine };

const builtinManifest = (id) => JSON.parse(readFileSync(join(BUILTIN, id, 'manifest.json'), 'utf8'));

/**
 * One package written into a user root the way an install would have left it: the manifest
 * pretty-printed, and every chunk the manifest names beside it.
 *
 * Chunk text defaults to the builtin's, so a fixture states only what it changed - which is
 * what makes these forks rather than fresh packages, and what makes a row about the one field
 * the fork moved.
 */
const stageFork = (dir, id, manifest, chunkEdits = {}) => {
  const at = join(dir, id);
  rmSync(at, { recursive: true, force: true });
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const c of manifest.chunks ?? []) {
    const shipped = readFileSync(join(BUILTIN, id, c.file), 'utf8');
    writeFileSync(join(at, c.file), chunkEdits[c.file] ? chunkEdits[c.file](shipped) : shipped);
  }
  return at;
};

/** The ids a user root is actually serving: directories, minus every aside, which carries a dot. */
const standing = (dir) => readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.includes('.'))
  .map((e) => e.name)
  .sort();

const asides = (dir) => readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.endsWith('.incompatible'))
  .map((e) => e.name)
  .sort();

/**
 * A verbatim fork of a shipped package at a new version, which every row here needs as its
 * control: it changes nothing but the version string, so a gate that set it aside is refusing
 * a package rather than validating one.
 */
const verbatim = (id) => ({ ...builtinManifest(id), version: '2.0.0' });

/**
 * The `rain` fork this whole file is about: the `vRain` varying dropped, and the two places
 * the rain's own chunks read it edited out so that nothing about the package itself is wrong.
 *
 * That is what makes it the shape the gate could not see. `doorRefusal` walks the *candidate's*
 * chunks for identifiers this build has not got, and there is nothing left in these to find;
 * `forkRefusal` catches a fork that dropped a parameter, and every parameter is here. So the
 * door answers null, the fork shadows the shipped rain, and the builtin glyph goes on reading
 * `vRain` out of its own `index.frag.glsl` with nothing anywhere declaring it. The cloud
 * program does not link, `web/main.js` throws while it is still evaluating, and no `__kinect`
 * publishes - on a machine where every package passed the door it was held to.
 */
const rainWithoutTheVarying = () => {
  const manifest = verbatim('rain');
  manifest.varyings = [];
  return { manifest, chunkEdits: {
    'cell.vert.glsl': (text) => text.replace(/^.*\bvRain\b.*$/gm, '  // the varying this fork dropped'),
    'lift.frag.glsl': (text) => text.replace(/fract\(vRain\)/g, '0.5'),
  } };
};

const withStore = (stage, assertions) => {
  const dir = mkdtempSync(join(tmpdir(), 'effect-store-gate-'));
  try {
    stage(dir);
    const store = new EffectStore(dir, BUILTIN, SPINES);
    store.claimUserRoot();
    assertions(store, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// **The finding.** Before this, the gate validated each candidate against the standing set and
// never re-asked the standing set afterwards - so a shadow that removed something a neighbour
// reads was promoted, and the neighbour it broke was a builtin nobody looked at again.
test('a fork that takes a neighbour down with it is set aside, and the neighbour is not', () => {
  const { manifest, chunkEdits } = rainWithoutTheVarying();
  withStore((dir) => stageFork(dir, 'rain', manifest, chunkEdits), (store, dir) => {
    assert.deepEqual(standing(dir), [],
      'the fork is set aside: nothing is left serving out of the user root');
    assert.equal(asides(dir).length, 1, `one aside, and the user root holds ${asides(dir).join(', ')}`);
    assert.match(asides(dir)[0], /^rain\./, 'and the aside is the fork rather than anything else');
    // Renamed and never deleted, which is the promise a fork is authored work rests on.
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, asides(dir)[0], 'manifest.json'), 'utf8')).version, '2.0.0',
      'the fork is still on disk under its aside, whole, to be repaired and moved back');
    // And the id answers from the shipped package again, which is the reading that says the
    // gate did something rather than nothing.
    assert.equal(store.read('rain').builtin, true, 'the id is handed back to the package this build ships');
    assert.equal(store.list().length, readdirSync(BUILTIN).length,
      'and every shipped package is still listed - the gate refused one package, not everything near it');
  });
});

// **The must-accept control, and without it the row above passes on a gate that quarantines
// every fork there is.** The same package, forked verbatim at a new version: nothing is dropped,
// nothing is renamed, and it has to be standing when the gate is done.
test('a fork that changes nothing is left exactly where it is', () => {
  withStore((dir) => stageFork(dir, 'rain', verbatim('rain')), (store, dir) => {
    assert.deepEqual(standing(dir), ['rain'], 'the healthy fork is still serving out of the user root');
    assert.deepEqual(asides(dir), [], 'and nothing was renamed aside');
    assert.equal(store.read('rain').builtin, false, 'the store answers for it as the user\'s copy');
    assert.equal(store.read('rain').manifest.version, '2.0.0', 'at the version the fork declares');
  });
});

// **Which of two forks loses, asked where the answer is not arbitrary.** The gate blames the
// package that changed, so a healthy fork standing beside a destructive one has to survive it -
// and this is the row that separates "sets aside the one that broke something" from "sets aside
// whatever it was walking when the set stopped assembling".
//
// `glyph` is the neighbour the rain fork actually breaks, so a verbatim glyph fork is the
// package with the most reason to be blamed by a gate that got the attribution wrong: it is the
// one whose chunks the door would report the missing name against.
test('the fork that changed is the one set aside, not the one it broke', () => {
  const { manifest, chunkEdits } = rainWithoutTheVarying();
  withStore((dir) => {
    stageFork(dir, 'glyph', verbatim('glyph'));
    stageFork(dir, 'rain', manifest, chunkEdits);
  }, (store, dir) => {
    assert.deepEqual(standing(dir), ['glyph'], 'the glyph fork survives and the rain fork does not');
    assert.equal(asides(dir).length, 1, `one aside, and the user root holds ${asides(dir).join(', ')}`);
    assert.match(asides(dir)[0], /^rain\./, 'and it is the rain, which is the package that changed');
    assert.equal(store.read('glyph').manifest.version, '2.0.0', 'the glyph fork is what the store answers with');
    assert.equal(store.read('rain').builtin, true, 'and the rain answers from the shipped package');
  });
});

// **A package called `refuse`, which this build once could not serve and now simply serves.**
// The refusal route was `POST /effects/refuse` first, and a literal segment under `/effects/`
// outranks the `:id` read beside it — so this package was listed by `GET /effects` and then
// answered 405 when the page fetched it, which is `readEffectPackages` throwing, no `__kinect`,
// both surfaces dark. Reproduced against a running server, `DELETE` refused too, and the boot
// gate silent because nothing in the door had an opinion about the id.
//
// The first repair reserved the word at the door and quarantined this package. The repair that
// landed moved the route to `POST /effect-refusals`, so nothing under `/effects/` is claimed and
// there is no word to reserve — and `refuse` is an ordinary effect id again. This row is the
// regression test for that: the package stands, the store serves it, and nobody's work is
// quarantined over a routing collision that no longer exists.
//
// It is the id `refuse` specifically rather than an arbitrary name, because that is the one the
// collision was about. A row using some other id would pass on the build that had the defect.
test('a package called refuse is an ordinary package again', () => {
  const named = { ...builtinManifest('thermal'), id: 'refuse', title: 'A package named for what was once a route' };
  withStore((dir) => {
    const at = join(dir, 'refuse');
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'manifest.json'), `${JSON.stringify(named, null, 2)}\n`);
    for (const c of named.chunks ?? []) {
      writeFileSync(join(at, c.file), readFileSync(join(BUILTIN, 'thermal', c.file), 'utf8'));
    }
    writeFileSync(join(at, 'witness.marker'), 'somebody\'s package, under a name this build once took\n');
    stageFork(dir, 'rain', verbatim('rain'));
  }, (store, dir) => {
    assert.deepEqual(standing(dir), ['rain', 'refuse'], 'both packages stand: nothing about either id is refused');
    assert.deepEqual(asides(dir), [], 'and nothing was renamed aside, because there is no reserved name any more');
    assert.equal(store.read('refuse')?.manifest.title, named.title, 'the store answers for it as an ordinary package');
    assert.ok(store.list().some((e) => e.id === 'refuse'),
      'and the listing carries it, which is what the page fetches next — the request that used to be answered 405');
    assert.ok(existsSync(join(dir, 'refuse', 'witness.marker')), 'with its files exactly where they were');
  });
});

// **A build whose own shipped package this build's door refuses, which is the one condition
// under which the whole-set pass would be an over-refusal machine.** Every member of the
// settled set is asked, and a builtin that was already refused before any fork existed would
// come back refused for every candidate in turn - so the first fork on such a machine would be
// quarantined under a sentence blaming somebody's authored work for a fault in the build. The
// gate takes a baseline with no fork in the room and excuses what it finds there.
//
// **Staged against a copied builtin root, because there is no other way to ask.** On a correct
// build this condition is unreachable - `test/effect-door.test.mjs` runs the whole shipped set
// through the same door - so a row that used the repo's own `effects-builtin/` could not go red
// whatever the code did, which is the vacuous conjunct `docs/instruments.md` keeps recording.
// The copy is a temporary directory and the repo's own root is only ever read.
test('a fork is not quarantined for a builtin this build was already refusing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'effect-store-gate-'));
  const brokenBuiltins = mkdtempSync(join(tmpdir(), 'effect-store-builtin-'));
  try {
    cpSync(BUILTIN, brokenBuiltins, { recursive: true });
    // An identifier that is nowhere in this build, which is a rule the door already has and
    // is the cheapest way to make one shipped package fail its own door without making it
    // unreadable - the store still parses it, lists it and serves it.
    const heat = join(brokenBuiltins, 'thermal/heat.frag.glsl');
    writeFileSync(heat, `${readFileSync(heat, 'utf8')}  col = vec3(qqNotHere);\n`);

    const at = join(dir, 'rain');
    mkdirSync(at, { recursive: true });
    const manifest = verbatim('rain');
    writeFileSync(join(at, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const c of manifest.chunks ?? []) {
      writeFileSync(join(at, c.file), readFileSync(join(BUILTIN, 'rain', c.file), 'utf8'));
    }

    const store = new EffectStore(dir, brokenBuiltins, SPINES);
    store.claimUserRoot();
    assert.deepEqual(standing(dir), ['rain'],
      'the fork is standing, because the fault was in the build rather than in the fork');
    assert.deepEqual(asides(dir), [], 'and nothing was renamed aside');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(brokenBuiltins, { recursive: true, force: true });
  }
});

// **A fork that reads a name only another fork declares, which is the property the promotion
// loop repeats to convergence for and the one a stricter rule is most likely to undo.** The
// install door offers a candidate every other installed package's varyings, so installing a
// rain fork with a new varying and then a glyph fork that reads it is a pair this build's own
// door takes one at a time - and a gate that swept once would meet glyph first, find the name
// nowhere, and quarantine a package that has been working since the day it landed.
//
// **The varying has to be one the shipped set has not got, and this row said `vRain` first.**
// That proved nothing: the builtin rain declares `vRain`, so a glyph fork doored while the
// rain fork was still pending found the name on the shipped package standing in its place and
// passed on the first sweep. The row stayed green under a mutation that reduced the loop to
// one pass, which is the vacuous conjunct `docs/instruments.md` keeps recording. `vDrizzle`
// exists nowhere but in the fork that declares it, so the second sweep is the only thing that
// can promote the fork that reads it.
test('a fork reading a name only another fork declares is promoted on the second pass', () => {
  const rain = verbatim('rain');
  rain.varyings = [...rain.varyings, { name: 'vDrizzle', type: 'float', init: '0.0', order: 210 }];
  const glyph = verbatim('glyph');
  withStore((dir) => {
    stageFork(dir, 'glyph', glyph, {
      // Multiplied by zero, so the fork reads the name and draws exactly what the shipped
      // glyph draws - the row is about which packages are standing, and a fixture that also
      // changed the picture would be two claims in one.
      'index.frag.glsl': (text) => `${text}  falloff *= 1.0 - 0.0 * vDrizzle;\n`,
    });
    stageFork(dir, 'rain', rain);
  }, (store, dir) => {
    assert.deepEqual(standing(dir), ['glyph', 'rain'], 'both forks are standing');
    assert.deepEqual(asides(dir), [], 'and neither was renamed aside');
    assert.equal(store.list().filter((e) => !e.builtin).length, 2,
      'and the store is serving both of them as user packages');
  });
});
