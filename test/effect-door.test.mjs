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
import { doorRefusal, forkRefusal } from '../server/effect-door.js';
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
