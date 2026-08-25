// The install door against the sixteen packages this build ships, under bare node.
//
// **This is the must-accept control, and without it every refusal the door makes is
// worthless.** A door that refused everything would satisfy every hostile-package row
// `tools/effect-check.mjs` drives - each of those asks "is this refused", and a rule that
// always says yes passes all of them at once. The population that says the door is a door
// rather than a wall is the one set of packages that must certainly get through, and this
// repo has sixteen of them sitting on disk with no way to argue about whether they are
// correct: they are what the shipped build compiles.
//
// It caught four false refusals the first time it was run, and each was a fact about GLSL
// rather than about a package: `position` and `modelMatrix` are injected into a
// `ShaderMaterial` by three.js and appear in no declaration anywhere in this tree,
// `texture2D` is the ES 1.00 spelling the grade pass compiles against while the cloud's
// pair are GLSL3, and the rain declares one uniform its own parameters do not write
// because the render loop drives it. Three of those became vocabulary the door reads out
// of the spine, and the fourth became a manifest field.
//
// Under bare node with no server, no browser and no GPU, because the door is a pure
// function of an envelope and the two spines - which is what lets it run before the store
// has made a directory, and what lets this file run in CI with nothing installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_EFFECT_ID, RESERVED_EFFECT_IDS, doorRefusal, forkRefusal, reservedIdRefusal,
} from '../server/effect-door.js';
import { HOST_DRIVEN_UNIFORMS } from '../web/effect-manifests.js';
import { snapScalar } from '../web/format.js';
import { cloudSpine } from '../web/cloud-shader.js';
import { gradeSpine } from '../web/grade-shader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN = join(ROOT, 'effects-builtin');
const SPINES = { cloud: cloudSpine, grade: gradeSpine };

const load = (id) => {
  const dir = join(BUILTIN, id);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const chunks = {};
  for (const c of manifest.chunks ?? []) chunks[c.file] = readFileSync(join(dir, c.file), 'utf8');
  return { id, manifest, chunks };
};

const shipped = () => readdirSync(BUILTIN, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => load(e.name));

// The set as the store would hand it over on an install: everything else that is
// installed, with the candidate excluded, because a package replacing itself would
// collide with itself on every slot and varying it declares.
const beside = (all, id) => all.filter((p) => p.id !== id);

test('every shipped package gets through the door it is held to', () => {
  const all = shipped();
  assert.ok(all.length >= 16, `only ${all.length} packages on disk - this control would pass on almost nothing`);
  for (const pkg of all) {
    assert.equal(doorRefusal(pkg, { beside: beside(all, pkg.id), spines: SPINES }), null,
      `the shipped ${pkg.id} is refused by this build's own install door`);
  }
});

// One hostile shape per rule, so a rule that stops firing is a red row here rather than a
// hole nobody notices until `effect-check` next runs against a browser. The mutations are
// applied to a shipped package rather than to a fixture written for the purpose, so what
// the door is being asked is always "this, one field wrong" - which is the shape a real
// broken package has, and the shape a fixture built to fail never quite is.
const brokenBy = (id, edit) => {
  const all = shipped();
  const pkg = all.find((p) => p.id === id);
  const candidate = { id, manifest: JSON.parse(JSON.stringify(pkg.manifest)), chunks: { ...pkg.chunks } };
  edit(candidate);
  return doorRefusal(candidate, { beside: beside(all, id), spines: SPINES });
};

test('the door names what it refuses, one rule at a time', () => {
  const cases = [
    ['a manifest declaring another id', 'thermal', (c) => { c.manifest.id = 'edges'; }, /declaring id "edges"/],
    ['a format from a later build', 'thermal', (c) => { c.manifest.format = 99; }, /package format 99/],
    ['no format at all', 'thermal', (c) => { delete c.manifest.format; }, /declares no package format/],
    ['a kind nothing normalises', 'thermal', (c) => { c.manifest.params.amount.kind = 'ramp'; }, /kind "ramp"/],
    ['a transform the applier has not got', 'thermal', (c) => { c.manifest.params.amount.bind.transform = 'toKelvin'; }, /transform "toKelvin"/],
    ['a master that is not inert', 'thermal', (c) => { c.manifest.params.amount.def = 0.5; }, /master and defaults to 0\.5/],
    // Inert *and* in range, so this row reaches the count rather than being answered by
    // the bounds rule three lines above it - `rain.speed` starts at 0.05, and a master
    // has to default to 0.
    ['a second master', 'rain', (c) => { Object.assign(c.manifest.params.speed, { role: 'master', def: 0, min: 0 }); }, /2 parameters with the role master/],
    ['a binding no program declares', 'thermal', (c) => { c.manifest.params.amount.bind.uniform = 'thermalll'; }, /declares no such uniform/],
    ['a uniform no parameter writes', 'rain', (c) => { c.chunks['decl.frag.glsl'] += 'uniform float rainStray;\n'; }, /"rainStray" and binds no parameter/],
    ['a chunk file naming a path', 'thermal', (c) => { c.manifest.chunks[0].file = '../out.glsl'; c.chunks['../out.glsl'] = ''; }, /"\.\.\/out\.glsl"/],
    ['a joint no spine holds', 'thermal', (c) => { c.manifest.chunks[0].stage = 'f.elsewhere'; }, /does not assemble/],
    ['an identifier that is nowhere', 'thermal', (c) => { c.chunks['heat.frag.glsl'] += '  col = vec3(qqNotHere);\n'; }, /"qqNotHere"/],
    ['a varying init that reads state', 'rain', (c) => { c.manifest.varyings[0].init = 'rainPhase'; }, /initialises to "rainPhase"/],
    ['a panel group anchored nowhere named', 'rain', (c) => { delete c.manifest.panelGroups[0].after; }, /anchors after undefined/],
    ['a file the manifest never names', 'thermal', (c) => { c.chunks['spare.glsl'] = ''; }, /"spare\.glsl" and its manifest names no chunk/],
    ['a chunk whose text did not arrive', 'thermal', (c) => { delete c.chunks['heat.frag.glsl']; }, /its text did not arrive/],
  ];
  for (const [what, id, edit, matches] of cases) {
    const refusal = brokenBy(id, edit);
    assert.ok(refusal, `the door accepted ${what}`);
    assert.match(refusal, matches, `the door refused ${what} for the wrong reason: ${refusal}`);
  }
});

// **A field that is a list, handed something that is not one.** Every reader of `chunks`,
// `varyings`, `panelGroups` and `hostDriven` inside the door walks the field, so a manifest
// carrying an object, a string or a number where a list belongs reached `.map` or a
// `for ... of` on something that has neither and threw a `TypeError` out of a function
// whose whole contract is to answer a sentence. The install route reports that as a 500
// with a stack in it where every other malformed manifest gets a 409 saying what to fix,
// and the store's boot gate cannot survive it at all - a throw there is a server that does
// not start, which is the failure that gate exists to prevent arriving through the gate.
//
// Both directions per field, because a rule that refused every value of the field would
// pass the refusal half of this on all four and be a door that takes no package at all.
test('a manifest field that is a list is refused when it is not one', () => {
  const fields = [['thermal', 'chunks'], ['rain', 'varyings'], ['rain', 'panelGroups'], ['rain', 'hostDriven']];
  for (const [id, field] of fields) {
    // The package one field wrong is still the package: an identity edit has to come back
    // null, or the rows below are being read off a fixture that was already refused.
    assert.equal(brokenBy(id, () => {}), null, `the shipped ${id} is refused before this row changes anything`);
    // `null` is in the list on purpose. `?? []` reads it as "no chunks at all", so a
    // manifest that meant none and typed one would quietly have been taken - see the door's
    // own note on why that is refused rather than read as absent.
    for (const value of [{}, 'one', 3, null, true]) {
      const refusal = brokenBy(id, (c) => { c.manifest[field] = value; });
      assert.ok(refusal, `the door accepted ${id}'s ${field} as ${JSON.stringify(value)}`);
      assert.match(refusal, new RegExp(`declares ${field} as `),
        `the door refused ${id}'s ${field} as ${JSON.stringify(value)} for the wrong reason: ${refusal}`);
    }
  }
});

// The rules that are about a package as a whole rather than about one entry in it, and
// they are written out separately because they are the ones the per-entry rules leave a
// hole between: every rule above is satisfied as many times as a package repeats a correct
// entry, so a package of twenty thousand correct entries passes all of them.
test('the door bounds how much of a package it will take', () => {
  const wide = (n) => brokenBy('thermal', (c) => {
    for (let i = 0; i < n; i++) {
      c.manifest.chunks.push({ stage: 'f.tone', order: 500 + i, file: `pad${i}.frag.glsl` });
      c.chunks[`pad${i}.frag.glsl`] = '\n';
    }
  });
  // Sixty-five files rather than a thousand, because the row is about where the bound is
  // and a fixture far past it would pass on a build whose bound had moved anywhere at all.
  assert.equal(wide(60), null, 'a package inside the file bound is not refused by it');
  assert.match(wide(64), /carries 65 files/, 'a package past the file bound is refused by name');

  const heavy = (bytes) => brokenBy('thermal', (c) => {
    c.chunks['heat.frag.glsl'] += `\n// ${'x'.repeat(bytes)}\n`;
  });
  assert.equal(heavy(1024), null, 'a package inside the byte bound is not refused by it');
  assert.match(heavy(256 * 1024), /bytes of chunk text/, 'a package past the byte bound is refused by name');

  // **And how much of it there is once it is spliced, which neither bound above can see.**
  // A file counts once in both of them - the set and the map each hold one entry per name -
  // while the assembler emits a chunk once per descriptor naming it. So the carried size and
  // the assembled size come apart the moment a manifest names one file twice, and the arm is
  // built to sit *inside* both of the bounds above and outside this one: sixty files of
  // three kilobytes is 61 files and about 180KB carried, and putting each of them on two
  // stages doubles what a driver compiles.
  const spliced = (times) => brokenBy('thermal', (c) => {
    for (let i = 0; i < 60; i++) {
      c.chunks[`pad${i}.frag.glsl`] = `// ${'x'.repeat(3000)}\n`;
      for (let t = 0; t < times; t++) {
        c.manifest.chunks.push({ stage: t === 0 ? 'f.tone' : 'f.decl', order: 500 + i, file: `pad${i}.frag.glsl` });
      }
    }
  });
  assert.equal(spliced(1), null, 'the same bytes spliced once are inside every bound this door has');
  assert.match(spliced(2), /splices \d+ bytes of chunk text/,
    'and the same bytes spliced twice are refused, which is the multiplier the carried size cannot show');

  // The exact repeat, which the bound above deliberately does not have to catch: it is
  // refused for being a repeat rather than for being large, so a thousand descriptors over
  // one small chunk fails here rather than passing every bound in this file. Reported through
  // the assembler, because that is where the rule lives - a package written into the store
  // past this door meets it on the page.
  assert.match(brokenBy('thermal', (c) => {
    c.manifest.chunks.push({ ...c.manifest.chunks[0], order: 900 });
  }), /heat\.frag\.glsl is spliced into "f\.tone" twice/,
  'one joint naming one file twice is refused, whatever the orders say');
  assert.equal(brokenBy('thermal', (c) => {
    c.manifest.chunks.push({ stage: 'f.decl', order: 900, file: 'heat.frag.glsl' });
  }), null, 'and two different joints naming one file is not, which is what the rule above is a distinction from');
});

// **How long an id may be, which is a bound on a directory name rather than on taste.** An
// id is what the package's directory is called, and every copy this program renames out of
// the way is that name plus a suffix - so an id with no room left under `NAME_MAX` for one
// is a package that installs perfectly well and can never be moved afterwards. What that
// cost was the boot gate: it renames a refused package to `<id>.<seq>.incompatible`, the
// rename answered `ENAMETOOLONG`, and the throw came out of the gate written to stop a
// broken package taking the program down.
//
// **Both directions, and the accepting one is at the bound rather than well inside it**, so
// a build whose bound had drifted anywhere at all fails one of these two rows. The donor is
// dropped out of `beside` for the accepting row: renaming a shipped package's id leaves the
// original standing beside its own copy, which collides on every slot and varying it
// declares and would refuse the candidate for a reason that has nothing to do with its name.
test('an id is a directory name, so the door bounds how long it may be', () => {
  const all = shipped();
  const donor = all.find((p) => p.id === 'thermal');
  const renamed = (id) => doorRefusal(
    { id, manifest: { ...JSON.parse(JSON.stringify(donor.manifest)), id }, chunks: { ...donor.chunks } },
    { beside: beside(all, 'thermal'), spines: SPINES },
  );
  assert.equal(renamed('t'.repeat(MAX_EFFECT_ID)), null,
    `an id of exactly ${MAX_EFFECT_ID} characters is inside the bound and must not be refused by it`);
  assert.match(renamed('t'.repeat(MAX_EFFECT_ID + 1)), new RegExp(`declares an id of ${MAX_EFFECT_ID + 1} characters`),
    'and one character past it is refused by name, before it is a rename that cannot be made');
  // The shipped ids are the must-accept control for this bound the same way the whole set is
  // for the door: a bound that had crept down to something a real package trips over would
  // pass both rows above and refuse the build's own packages.
  for (const pkg of all) {
    assert.ok(pkg.id.length <= MAX_EFFECT_ID,
      `the shipped ${pkg.id} is ${pkg.id.length} characters, which this build's own door would refuse`);
  }
});

// **Which program a binding is checked against, which is a question the door used to answer
// by not asking.** Every chunk's uniforms were credited to every assembled program, so a
// binding naming the wrong table found its uniform anyway: the control moves, three.js writes
// the key, and no shader on that program ever reads it.
test('a binding is checked against the program its own table names', () => {
  assert.match(brokenBy('rain', (c) => { c.manifest.params.amount.bind.on = 'grade'; }),
    /rain\.amount binds the uniform "rain" and the assembled grade program declares no such uniform/,
    'a binding moved to the other table is refused, because the chunk declaring it feeds the cloud');
  assert.equal(brokenBy('rain', (c) => { c.manifest.params.amount.bind.on = 'points'; }), null,
    'and the shipped binding is not, which is what says the rule is about the program rather than the name');
});

// A package colliding with itself, which the core and beside-package collisions cannot see:
// `panelGroups` is read into a set, so one key declared twice is one group here and two
// spliced entries in `withEffectGroups`, and the generator then emits that group's rows twice.
test('a package may not declare one panel group key twice', () => {
  assert.match(brokenBy('rain', (c) => {
    c.manifest.panelGroups.push({ ...c.manifest.panelGroups[0], label: 'Rain again', order: 200 });
  }), /declares the panel group "rain" twice/, 'one key declared twice is refused by name');
});

// **Both ends of a binding, and the type is the end nothing downstream checks.** The rule
// above these asks whether the uniform exists; a value written through the wrong setter
// exists just as much, moves its control just as far, and changes nothing on screen.
test('a binding has to be the shape of the uniform it writes', () => {
  assert.match(
    // The raster's angle is the shipped `axisDeg`, which writes `.value.set(sin, cos)` into
    // a `vec2`. Dropping the transform makes it a plain binding writing one number into
    // that same `vec2`, which three.js uploads as whatever `.value.x` reads as.
    brokenBy('raster', (c) => { delete c.manifest.params.angle.bind.transform; }),
    /declares as vec2.*needs a float/s,
    'a plain binding onto a two-component uniform is refused',
  );
  assert.match(
    // And the mirror: `axisDeg` onto a float throws inside the applier on the first write,
    // with a message about `set` rather than about a manifest.
    brokenBy('thermal', (c) => { c.manifest.params.amount.bind.transform = 'axisDeg'; }),
    /declares as float.*needs a vec2/s,
    'an axisDeg binding onto a one-component uniform is refused',
  );
});

// A step finer than the registry's own rounding can express, which is a range that
// collapses rather than a range that is fine - see `decimalsOf` in `web/format.js` for the
// arithmetic and `test/param-grid.test.mjs` for what it does to the values.
test('a step has to be a grid this build can snap to', () => {
  assert.match(brokenBy('thermal', (c) => { c.manifest.params.amount.step = 1e-7; }),
    /declares step 1e-7 and the finest grid/, 'a step below the floor is refused by name');
  assert.equal(brokenBy('thermal', (c) => { c.manifest.params.amount.step = 1e-6; }), null,
    'a step at the floor is not refused by it');
});

// **And the bounds have to sit on the grid the step declares, which the rule above cannot
// see.** A step of 0.05 is a perfectly good grid and a default of 0.72 is inside perfectly
// good bounds, and the pair still describes a position the registry never holds: `normalise`
// snaps it to 0.70 on the first write, the panel compares the live value against the snapped
// default and finds them equal, and `groupDefaults` compares the *declared* one and finds
// them not - so an effect nobody touched reads as modified, its group derives open, and the
// save rule keeps it, which puts a `requires` entry for it into every document saved after
// the install.
//
// The door asks by running `snapScalar` - the same function the registry snaps with - rather
// than by testing the division against an epsilon, so there is one answer to "where does
// this land" and no second description of it to drift.
test('a bound off its own step grid is a number the registry never holds', () => {
  assert.match(brokenBy('noise', (c) => { c.manifest.params.speed.def = 0.72; }),
    /declares def 0\.72 and the registry would hold it at 0\.7/,
    'a default between two positions is refused, naming where it would actually land');
  assert.equal(brokenBy('noise', (c) => { c.manifest.params.speed.def = 0.75; }), null,
    'and a default on the grid is not - which is what says this rule is about the grid rather than about the value');

  // The top of the range is the one bound `snapScalar` alone answers wrongly about: it
  // clamps, so a `max` the snap steps past is put back onto itself. The door lifts the
  // ceiling by a step to ask the question with the clamp out of the way, and this row is
  // what says that lift is doing something - without it the assertion below passes on a
  // rule that never looked.
  assert.match(brokenBy('noise', (c) => { c.manifest.params.speed.max = 2.98; }),
    /runs to 2\.98, which is not on the 0\.05 grid 0 anchors/,
    'a ceiling off the grid is refused even though a value clamped to it is the ceiling');
  assert.equal(brokenBy('noise', (c) => { c.manifest.params.speed.max = 2.95; }), null,
    'and a ceiling on the grid is not');

  // **`min` still has no *grid* rule of its own and this row is why.** It anchors the grid, so
  // the snap returns it unchanged and the final clamp returns it again even where the rounding
  // would have moved it - a grid rule asking `min` could not go red on any input the checks
  // above admit, which is the vacuous conjunct `docs/instruments.md` keeps recording. What a
  // too-fine `min` actually breaks is every *other* value, because the places it implies are
  // used for all of them: on a 0.05 grid a `min` of 1e-101 takes a default of 0.7 to
  // 0.7000000000000001.
  //
  // **That reading used to be this row's assertion, and it is the symptom rather than the
  // fault.** It also left a residual written down instead of closed - a package whose `def`
  // sits exactly *on* such a `min` snaps to itself and got through. Both are the same
  // question, which is whether the number naming a bound is one this build's rounding can
  // express, and `MIN_PARAM_PLACES` asks it directly. So the refusal names `min` now, and the
  // reading that used to stand here is asserted one row down where it is still the truth
  // about the arithmetic.
  assert.match(brokenBy('noise', (c) => { c.manifest.params.speed.min = 1e-101; }),
    /declares min as 1e-101, which needs 100 decimal places/,
    'a floor finer than the rounding this build can express is refused by name rather than through its symptom');
  assert.match(brokenBy('noise', (c) => { c.manifest.params.speed.min = 1e-101; c.manifest.params.speed.def = 1e-101; }),
    /declares min as 1e-101/,
    'and a default sitting exactly on such a floor is refused too, which is the residual this rule closed');
  // The arithmetic the row above used to assert, kept because the place rule is only worth
  // having if what it prevents is real. Run directly rather than through the door, since the
  // door now refuses the manifest before `snapScalar` is ever asked about it.
  assert.equal(snapScalar({ min: 1e-101, max: 3, step: 0.05 }, 0.7), 0.7000000000000001,
    'a floor past the rounding cap moves every other value, which is what the refusal is about');
  assert.equal(snapScalar({ min: 0, max: 3, step: 0.05 }, 0.7), 0.7,
    'and the same value on an ordinary floor does not, so the reading above is about the floor');

  // The bound is a place count rather than a magnitude, so a small number written in few
  // places is fine and a number needing seven is not - which is the distinction that would
  // vanish if this were a comparison against 1e-6.
  assert.equal(brokenBy('noise', (c) => { c.manifest.params.speed.min = 0.000001; c.manifest.params.speed.step = 0.000001; c.manifest.params.speed.def = 0.000002; c.manifest.params.speed.max = 0.000005; }), null,
    'a parameter at the finest grid this build snaps to is not refused by the place rule');
  assert.match(brokenBy('noise', (c) => { c.manifest.params.speed.max = 2.9500001; }),
    /declares max as 2\.9500001, which needs 7 decimal places/,
    'and one place past it is refused, naming the field and the count');
});

// **Where a row would land, which nothing asks until the registry has already swapped.**
// Both of these throw inside `buildPanel` - after the new registry is in place - so on a
// page they arrive as a rollback reporting that a document could not be carried across,
// which says nothing at all about a group key having been misspelled.
test('a package may only put its rows in a group that exists, and may not claim one twice', () => {
  assert.match(brokenBy('thermal', (c) => { c.manifest.params.amount.panel.group = 'stlye'; }),
    /asks for the panel group "stlye"/, 'a parameter naming no group anybody holds is refused');
  assert.equal(brokenBy('rain', (c) => { c.manifest.params.amount.panel.group = 'post'; }), null,
    'a parameter naming a core group is what thirteen shipped packages do');
  assert.equal(brokenBy('rain', (c) => { c.manifest.params.amount.panel.group = 'rain'; }), null,
    'and a parameter naming its own package\'s group is what the other three do');

  assert.match(brokenBy('rain', (c) => {
    c.manifest.panelGroups[0].key = 'post';
    for (const p of Object.values(c.manifest.params)) p.panel.group = 'post';
  }), /already\s+holds one under that key/, 'a package group colliding with a core group is refused');
  assert.match(brokenBy('rain', (c) => {
    c.manifest.panelGroups[0].key = 'glitch';
    for (const p of Object.values(c.manifest.params)) p.panel.group = 'glitch';
  }), /effect glitch already declares/, 'a package group colliding with another package\'s is refused, naming the other package');
});

// **An array is a uniform with room for the value and is still not somewhere to put it.** The
// shape rule above reads the declared type, and the reading it was built on threw away the
// dimension: `uniform float weights[4]` came back as `weights` declared `float`, which is
// exactly what a plain binding asks for. Three.js takes its uploader off the declaration, so
// the array setter is handed one number, the write succeeds, and the shader goes on reading
// whatever the array was initialised with - a control that moves and a picture that does not,
// which is the failure both halves of the binding rule exist to refuse.
//
// Both spellings, because GLSL ES 3.00 takes the dimension on either side of the name and only
// one of them used to be read at all: `float[4] weights` declared nothing here, so the rule
// about a uniform nothing binds could not see it either.
test('a binding may not aim at an array, whichever side the dimension is written on', () => {
  const arrayed = (declaration) => brokenBy('thermal', (c) => {
    c.manifest.chunks.push({ stage: 'f.decl', order: 700, file: 'weights.frag.glsl' });
    c.chunks['weights.frag.glsl'] = `${declaration}\n`;
    c.manifest.params.weights = {
      kind: 'scalar', label: 'Weights', def: 0, min: 0, max: 1, step: 0.05,
      panel: { group: 'colour' }, bind: { on: 'points', uniform: 'thermalWeights' },
    };
  });
  assert.match(arrayed('uniform float thermalWeights[4];'), /declares as float\[4\].*no array kind/s,
    'a scalar bound to an array declared after the name is refused, naming the dimension it found');
  assert.match(arrayed('uniform float[4] thermalWeights;'), /declares as float\[4\].*no array kind/s,
    'and the type-level spelling of the same declaration is refused identically, which is the half that used to declare nothing at all');
  // The must-accept control for the reading rather than for the rule: the same package with
  // the same new uniform and no dimension on it goes through, so the refusal above is about
  // the brackets and not about anything else the fixture does.
  assert.equal(arrayed('uniform float thermalWeights;'), null,
    'and the same declaration without a dimension is not refused, which is what says this rule is about the array');
});

// **An id the HTTP surface has already claimed, which is a rule about the id rather than about
// the package.** A literal segment under `/effects/` outranks the `:id` pattern beside it, so a
// package called `refuse` is listed by `GET /effects` and then answered 405 when the client
// fetches it — `readEffectPackages` throws, the top-level await fails, no `__kinect` publishes.
// Reproduced against a real server before this rule existed: the listing carried it, `GET
// /effects/refuse` answered `405 it takes POST`, `DELETE` answered 405 as well so it could not
// even be removed, and the boot gate said nothing at all because nothing in this door had an
// opinion about the id beyond its shape and its length.
test('an id the route table has claimed is not an id a package may have', () => {
  const all = shipped();
  const donor = all.find((p) => p.id === 'thermal');
  // The donor is dropped from `beside` for the same reason the id-length rows drop it: leaving
  // the original standing beside its own copy collides on every slot and varying it declares,
  // and the candidate would be refused for something that has nothing to do with its name.
  const named = (id) => doorRefusal(
    { id, manifest: { ...JSON.parse(JSON.stringify(donor.manifest)), id }, chunks: { ...donor.chunks } },
    { beside: beside(all, 'thermal'), spines: SPINES },
  );
  // **The live list is empty, so every assertion driven through the door over it runs zero
  // times.** That is not a hypothetical worry: emptying the list is a mutation that was run
  // against the previous version of this row, and it left the row green while the rule it tests
  // was gone. The rule is asked directly instead, with a reserved id in hand, so it is proved on
  // data that exists — `reservedIdRefusal` is the same code path `doorRefusal` calls.
  assert.match(reservedIdRefusal('verify', ['verify']),
    /effect verify takes an id this build's HTTP surface has already claimed/,
    'the reserved-id rule does not refuse an id on the list it was handed, so nothing here proves it works');
  assert.match(reservedIdRefusal('verify', ['verify', 'check']), /The reserved names are verify, check/,
    'and it names the whole set, because an author who trips it needs to know which names are gone');
  // The must-accept half, one character off in each direction: a rule matching by prefix would
  // pass the rows above and take ids away from packages that never collided with anything.
  assert.equal(reservedIdRefusal('verifier', ['verify']), null, 'an id that merely starts with a reserved one is not reserved');
  assert.equal(reservedIdRefusal('verif', ['verify']), null, 'and neither is one a reserved name starts with');

  // And the live list, driven through the whole door. Today it is empty and this loop is a
  // no-op, which is exactly why the four rows above exist — but it is what would fire if the
  // list ever grew, and it is where a real reserved id would be proved refused end to end.
  for (const id of RESERVED_EFFECT_IDS) {
    assert.match(named(id), new RegExp(`effect ${id} takes an id this build's HTTP surface has already claimed`),
      `a package at the reserved id ${id} is accepted, so the store will list one the page cannot read`);
  }
  // The shipped set, which is the control that says the list has not grown into a name a real
  // package uses. Live data, and it does not depend on the list being non-empty.
  for (const pkg of all) {
    assert.equal(named(pkg.id) && reservedIdRefusal(pkg.id), null,
      `the shipped ${pkg.id} sits on a reserved id, so this build refuses its own package`);
  }
});

// **The reserved list held to the table it is a second spelling of.** `server/index.js` derives
// the same set off `ROUTES` at module load and refuses to boot if the two disagree, which is the
// authority; this asks it again where no server starts, so a route added under `/effects/` fails
// the unit suite rather than waiting for somebody to run one. Read as text rather than imported,
// because importing that module builds a server and binds a port.
test('RESERVED_EFFECT_IDS is what the route table actually claims', () => {
  const claimedIn = (paths) => [...new Set(
    paths.map((p) => p.match(/^\/effects\/([^/:]+)$/)?.[1]).filter((s) => s !== undefined),
  )].sort();

  const server = readFileSync(join(ROOT, 'server/index.js'), 'utf8');
  const paths = [...server.matchAll(/path:\s*'(\/effects\/[^']*)'/g)].map((m) => m[1]);
  // Non-vacuous by construction: the scan has to have found the per-id route, or it is reading
  // nothing and the comparison below is between two empty lists for the wrong reason.
  assert.ok(paths.includes('/effects/:id'),
    `the scan found ${paths.length} effect route paths and none of them is the per-id read, so it is not reading the table`);
  assert.deepEqual(claimedIn(paths), [...RESERVED_EFFECT_IDS].sort(),
    'the route table claims a different set of effect ids than the door reserves - a package under a claimed id '
    + 'is listed by GET /effects and refused when the page fetches it, which is a page that does not boot');

  // **And the extraction shown to find something, because today it correctly finds nothing.**
  // Both sides of the comparison above are empty, so it passes on a build where the route table
  // claims nothing — which is the state this build is in and the state it should stay in. What
  // it must not do is pass because the extraction is broken. The same function is handed a path
  // list with a literal segment in it, which is what the table would look like the day somebody
  // registers one.
  assert.deepEqual(claimedIn(['/effects', '/effects/:id', '/effects/verify', '/effects/:id/file/:name']),
    ['verify'],
    'the extraction does not pick a literal segment out of the route paths, so the comparison above '
    + 'is between two empty lists whatever the table holds');
});

// **A `gates` the gate cannot read, which is the array rule's question asked one field over.**
// `gates` is a promise about the uniform rather than a flag on the parameter: `gradeNeeded` in
// `web/main.js` walks the gating bindings, reads the cell each names, and holds the grade pass
// open while any is not zero. So the binding has to land a number, on the table that function
// reads.
//
// The axisDeg half is the one that bites twice. It lands a `Vector2`, which is never the zero
// vector, so under the `> 0` this shipped with the pass stayed shut forever and under the
// `!== 0` it has now an object is never strictly equal to zero and it runs full-screen forever.
// The symptom flipped when somebody fixed something unrelated, which is the argument for
// refusing the binding rather than teaching the predicate about it.
test('a gating binding has to be something the gate can read', () => {
  // The raster's angle is the shipped axisDeg, on the grade table, with no gate on it.
  assert.match(brokenBy('raster', (c) => { c.manifest.params.angle.bind.gates = true; }),
    /declares gates beside the axisDeg transform/,
    'a gate on a two-component direction is refused, because there is no zero for it to be at');
  // The other side of the same rule: the gate collects only grade-table bindings, so a gate on
  // the point cloud's table is a claim the pass never sees.
  assert.match(brokenBy('rain', (c) => { c.manifest.params.amount.bind.gates = true; }),
    /declares gates and binds on "points"/,
    'a gate on the point cloud\'s table is refused, because nothing collects it');

  // **Three near-misses, and without them the two rows above pass on a door that refuses every
  // `gates` there is.** A plain grade binding with a gate is what all seven shipped gated
  // parameters are; `degToRad` lands a number and zero radians is zero degrees, so it gates
  // perfectly well; and `axisDeg` with no gate is the shipped raster untouched.
  assert.equal(brokenBy('raster', (c) => { c.manifest.params.amount.bind.gates = true; }), null,
    'a plain grade binding that gates is what the shipped set already does');
  // Added as a parameter of its own rather than by repointing the shipped `angle`, which was
  // the first attempt and proved nothing: moving `angle` off `scanAxis` leaves that uniform
  // declared with nothing binding it, so the fixture came back refused by a rule two hundred
  // lines away and the row would have been green on a build with no gate rule at all.
  assert.equal(brokenBy('raster', (c) => {
    c.manifest.params.tilt = {
      def: 0, min: 0, max: 1, step: 0.05, kind: 'scalar', label: 'raster tilt',
      panel: { group: 'raster', tab: 'look' },
      bind: { on: 'grade', uniform: 'scanTilt', transform: 'degToRad', gates: true },
      under: 'amount',
    };
    c.chunks['decl.grade.glsl'] = `${c.chunks['decl.grade.glsl']}uniform float scanTilt;\n`;
  }), null, 'and degToRad lands a number, so it gates like any other scalar');
  assert.equal(brokenBy('raster', () => {}), null,
    'and the shipped raster, whose angle is axisDeg with no gate on it, is untouched by this rule');

  // The must-accept control for the set: every gated parameter that ships is a plain grade
  // binding, so a rule that had crept wider would fail here rather than in a browser.
  for (const pkg of shipped()) {
    for (const [short, spec] of Object.entries(pkg.manifest.params)) {
      if (!spec.bind?.gates) continue;
      assert.equal(spec.bind.on, 'grade', `the shipped ${pkg.id}.${short} gates on ${spec.bind.on}`);
      assert.equal(spec.bind.transform, undefined,
        `the shipped ${pkg.id}.${short} gates through the ${spec.bind.transform} transform`);
    }
  }
});

// **The exemption from the rule that something has to write every uniform, held to what this
// build actually writes.** `hostDriven` excuses a uniform from having a parameter behind it,
// and while any name at all could go in the list the excuse was self-issued: a package could
// declare a clock of its own, list it, install cleanly, and read zero from it for the life of
// the page with no control anywhere that could have moved it. That is the exact failure the
// two-ended rule stands in front of, reached through the sentence that lets a package out of
// it.
test('hostDriven names a uniform this build really drives, not any uniform at all', () => {
  assert.equal(brokenBy('rain', () => {}), null, 'the shipped rain is accepted before this row changes anything');
  assert.match(brokenBy('rain', (c) => {
    c.chunks['decl.vert.glsl'] += 'uniform float rainOwnClock;\n';
    c.manifest.hostDriven.push('rainOwnClock');
  }), /lists "rainOwnClock" as host-driven and this build's render loop writes "rainPhase"/,
  'a package inventing its own host-driven uniform is refused, naming what the host does write');
  // The must-accept half: the shipped list is one name and it has to keep going through, or
  // the row above is passing on a door that refuses every `hostDriven` entry there is.
  assert.deepEqual([...HOST_DRIVEN_UNIFORMS], ['rainPhase'],
    'the host-driven set is the one name the rain needs - a set that had grown would need this row read again');

  // **The other end of the constant, which no import can hold, and it is asked in both
  // directions.** The render loop writes one named cell rather than iterating a list, so the
  // two statements are held together here rather than by a shared symbol.
  const main = readFileSync(join(ROOT, 'web/main.js'), 'utf8');
  const written = new Set(
    [...main.matchAll(/\buniforms\.([A-Za-z_][A-Za-z0-9_]*)\.value\s*(?:=[^=]|\.set\b)/g)].map((m) => m[1]),
  );

  // Direction one: a name on the list that the page never assigns to. That is the door going on
  // excusing a uniform nothing writes, which is the whole hole the constant closes.
  for (const name of HOST_DRIVEN_UNIFORMS) {
    assert.ok(written.has(name),
      `${name} is listed as host-driven and nothing in web/main.js writes it, so the door is excusing a uniform that reads zero`);
  }

  // **Direction two, and it is asked against the packages rather than against the writes**,
  // because "is this a host clock" is not a question a scan of `web/main.js` can answer: the
  // page assigns to dozens of cells and almost all of them are the spine's own - `mixT`,
  // `spanSec`, `time`. What makes a write host-driven is the *other* end, that the uniform is
  // declared by a package rather than by a spine, and that is knowable off disk. So the rule is:
  // a uniform some shipped package declares, that `web/main.js` writes, has to be on the list.
  // A name that appears on both sides and not in the constant is a host clock somebody wired up
  // without saying so, and the door would then refuse the package that declares it - which is
  // the loud direction, and is still the two statements disagreeing.
  // **Comments stripped first, which this row did not do and which produced a false finding.**
  // The chunks in this repo carry more comment than code, and two of them name the spine's own
  // read uniforms in prose - the glitch's flare chunk and the duotone's tone chunk each quote a
  // pinned build's `readRgb, readDepth, readContour` reading. A declaration pattern whose tail
  // runs to the next semicolon walks straight through a paragraph, so both came back as
  // package-declared, both are written by `web/main.js`, and the row failed naming `readDepth`
  // on a build with nothing wrong with it. `withoutComments` in `server/effect-door.js` is the
  // same two substitutions and exists for the same reason.
  const withoutComments = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const declaredByPackages = new Set();
  for (const pkg of shipped()) {
    for (const raw of Object.values(pkg.chunks)) {
      const text = withoutComments(raw);
      for (const m of text.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?[A-Za-z_][A-Za-z0-9_]*\s+([^;]*);/g)) {
        for (const part of m[1].split(',')) {
          const nm = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
          if (nm) declaredByPackages.add(nm[1]);
        }
      }
    }
  }
  const unlisted = (writes, declared, listed) => [...writes]
    .filter((n) => declared.has(n) && !listed.includes(n));
  assert.deepEqual(unlisted(written, declaredByPackages, HOST_DRIVEN_UNIFORMS), [],
    'web/main.js writes a uniform a shipped package declares that HOST_DRIVEN_UNIFORMS does not name - '
    + 'that is a host clock wired up without the door being told, and the door will refuse the package that declares it');

  // **And the same predicate shown to fire, because on this build it cannot.** The only name in
  // both scans is `rainPhase` and it is on the list, so the assertion above is green on the
  // corpus that exists whatever the rule says - taking the name off the list does not reach it
  // either, because the shipped rain is then refused and the identity row at the top of this
  // test fails first. A conjunct that no input can redden is the vacuous one
  // `docs/instruments.md` keeps recording, so the rule is asked once more against a triple built
  // to trip it.
  assert.deepEqual(
    unlisted(new Set(['rainPhase', 'someClock']), new Set(['someClock']), ['rainPhase']),
    ['someClock'],
    'the direction-two rule does not flag a name that is written, package-declared and unlisted, so the row above proves nothing');

  // **What neither direction reaches, said out loud rather than left to be assumed.** Both read
  // `web/main.js` as text through one spelling of the write, so a build that started assigning
  // through a computed key would pass direction one while writing nothing this row can see and
  // fail direction two by finding nothing at all. And direction two is over the *shipped*
  // packages only, because a package installed at runtime is not on disk when this runs - a
  // fork declaring a uniform the host happens to write is outside this rule and is caught by
  // the door instead, which refuses it for having no parameter behind it.
  assert.ok(declaredByPackages.size > 0 && written.size > 0,
    `this row read ${declaredByPackages.size} package-declared uniforms and ${written.size} writes in web/main.js - `
    + 'either being empty means the scan found nothing and both directions above were vacuous');
});

// **How big the manifest may be, which every bound above it is silent about.** The three that
// were here count chunk text, and a package can repeat a correct *parameter* rather than a
// correct chunk: twelve thousand of them, each individually valid, arriving with one small
// file of GLSL and inside the four megabytes the server takes as a body. What it costs is the
// store writing and hashing those bytes on every poll, and a DOM control per parameter on
// every page that adopts it.
test('the door bounds the manifest as well as the chunks it names', () => {
  const withParams = (n) => brokenBy('thermal', (c) => {
    for (let i = 0; i < n; i++) {
      c.manifest.params[`k${i}`] = {
        kind: 'scalar', label: `Knob number ${i} of a manifest nobody wrote by hand`,
        def: 0, min: 0, max: 1, step: 0.05,
        panel: { group: 'colour' }, bind: { on: 'points', uniform: 'thermal' },
      };
    }
  });
  // Sized around the bound rather than far past it, so a build whose bound had drifted anywhere
  // at all fails one of these two rows. Measured, a parameter of this shape costs 309 bytes in
  // the spelling the store writes: 95 of them is 29,857 bytes and 115 is 36,067, which straddles
  // the 32,768 this build takes with about ten per cent either side.
  assert.equal(withParams(95), null, 'a manifest inside the bound is not refused by it');
  assert.match(withParams(115), /carries a manifest of \d+ bytes/,
    'and one past it is refused by name, counting the bytes the store would write');
  // The reported shape, so the row is about the thing that was found rather than about a
  // fixture built to trip a number: none of the bounds that count chunk text can see it, and
  // it is comfortably inside the request limit.
  assert.match(withParams(12000), /carries a manifest of \d+ bytes/,
    'the twelve thousand parameters that fit in a request body are refused');

  // The must-accept control, which is what says the bound is not merely low: every manifest
  // this build ships is inside it, measured the way the store writes them.
  for (const pkg of shipped()) {
    const bytes = Buffer.byteLength(`${JSON.stringify(pkg.manifest, null, 2)}\n`, 'utf8');
    assert.ok(bytes <= 32 * 1024,
      `the shipped ${pkg.id} carries a ${bytes}-byte manifest, which this build's own door would refuse`);
  }
});

test('a fork may add and retune, and may not drop', () => {
  const all = shipped();
  const noise = all.find((p) => p.id === 'noise');
  const whole = { id: 'noise', manifest: JSON.parse(JSON.stringify(noise.manifest)), chunks: noise.chunks };
  whole.manifest.version = '2.0.0';
  whole.manifest.params.amount.max = 2;
  assert.equal(forkRefusal(whole, noise), null, 'a fork that keeps every key is what forking is for');

  const short = { id: 'noise', manifest: JSON.parse(JSON.stringify(noise.manifest)), chunks: noise.chunks };
  delete short.manifest.params.speed;
  assert.match(forkRefusal(short, noise), /drops noise\.speed/,
    'a fork short of a placed name is a registry that cannot assemble');
});
