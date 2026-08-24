// The assembled effect table against the one the registry used to declare, under
// bare node.
//
// Step S3 deleted the effect table module: the registry assembles its forty-one
// effect entries from the shipped manifests through `tableFromPackages` now. What
// held the manifests honest while the table existed was a field-for-field equality
// against it; what holds them honest after its deletion is the same equality
// against the table as git history holds it - materialised from the revision that
// created it, through a `data:` URL, which is the whole reason that module was
// written import-free. Same fixture, same claim, no second implementation: the
// conversion under test is the very function the page runs.
//
// This gate is scaffolding by design. It pins the manifests to a historical
// revision, so the first intentional change to an effect parameter breaks it -
// at which point it is deleted with a reason, and what remains is the live
// coupling (registry-check's set equality and scramble order) that survives
// intentional change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeParams, tableFromPackages } from '../web/effect-manifests.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN = join(ROOT, 'effects-builtin');

// Pinned by content marker rather than by hash, because a hash dies under
// filter-repo: the revision is the first one that exported the table.
const TABLE_REV = execFileSync('git',
  ['log', '-S', 'export const EFFECT_PARAMS', '--reverse', '--format=%H', '--', 'web/effect-params.js'],
  { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')[0];

const oldTable = async () => {
  const src = execFileSync('git', ['show', `${TABLE_REV}:web/effect-params.js`], { cwd: ROOT, encoding: 'utf8' });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  return mod.EFFECT_PARAMS;
};

const packagesOnDisk = () => readdirSync(BUILTIN, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ id: e.name, manifest: JSON.parse(readFileSync(join(BUILTIN, e.name, 'manifest.json'), 'utf8')) }));

// The order is read off the historical table itself - its own key order, which
// interleaves below effect granularity - rather than restated here, so the
// reference decides and this file cannot drift from it.
const orderOf = (table) => Object.keys(table);

test('the manifests assemble into the table the registry declared', async () => {
  const reference = await oldTable();
  const assembled = tableFromPackages(packagesOnDisk(), orderOf(reference));
  // Stringified, deliberately: key order is part of the claim - the registry's
  // declaration order is cut from this table in runs, and the scramble coupling
  // is itself a stringified equality.
  assert.equal(JSON.stringify(assembled), JSON.stringify(reference));
});

test('the equality refuses one field one step off', async () => {
  const reference = await oldTable();
  const packages = packagesOnDisk();
  const rain = packages.find((p) => p.id === 'rain');
  rain.manifest.params.speed.def += rain.manifest.params.speed.step;
  const assembled = tableFromPackages(packages, orderOf(reference));
  assert.notEqual(JSON.stringify(assembled), JSON.stringify(reference),
    'a one-step drift in rain.speed must break the equality');
});

// ---- where a package the order has never heard of goes
//
// Installing an effect is the case the order list cannot be written for, and the
// rule that answers it is `placeParams`. The two claims worth holding are that the
// shipped set is untouched by the rule existing, and that a package the order does
// not name lands in one defined place rather than wherever the objects were walked.
// Both are asked under bare node, because both are arithmetic over two lists.

const pkg = (id, keys) => ({ id, manifest: { params: Object.fromEntries(keys.map((k) => [k, {}])) } });

test('the placed set is byte-stable, whatever else is installed', async () => {
  const order = orderOf(await oldTable());
  const shipped = packagesOnDisk();
  assert.deepEqual(placeParams(shipped, order), order,
    'the shipped sixteen are all placed, so the rule must return the order unchanged');
  const placed = placeParams([...shipped, pkg('zzprobe', ['amount'])], order);
  assert.deepEqual(placed.slice(0, order.length), order,
    'a seventeenth effect must not move any of the forty-one the order places');
});

test('an unplaced package lands contiguous, in manifest order, after everything placed', () => {
  const order = ['a.one', 'a.two'];
  const packages = [
    pkg('a', ['one', 'two']),
    pkg('zeta', ['master', 'depth']),
    pkg('beta', ['gain']),
  ];
  assert.deepEqual(placeParams(packages, order), [
    'a.one', 'a.two',
    // Packages by id, which is the only ordering two manifests can be compared by,
    // and each package's own keys in the order it declared them - `master` before
    // `depth`, which is neither alphabetical nor the order they were handed in.
    'beta.gain', 'zeta.master', 'zeta.depth',
  ]);
});

test('a fork that adds a key appends it rather than seating it beside its siblings', () => {
  const order = ['rain.amount', 'rain.speed'];
  const placed = placeParams([pkg('rain', ['amount', 'speed', 'gust'])], order);
  assert.deepEqual(placed, ['rain.amount', 'rain.speed', 'rain.gust']);
});

test('the registry still refuses a placed name no package declares', () => {
  assert.throws(() => tableFromPackages([pkg('a', ['one'])], ['a.one', 'a.two']),
    /a\.two/, 'a name the order places and nothing declares has no entry to assemble');
});
