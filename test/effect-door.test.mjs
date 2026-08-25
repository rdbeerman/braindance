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
import { MAX_EFFECT_ID, doorRefusal, forkRefusal } from '../server/effect-door.js';
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
