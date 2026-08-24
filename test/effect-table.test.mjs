// Where a parameter no layout order places ends up, under bare node.
//
// **This rule had a gate and lost it.** `placeParams` decides the registry's declaration
// order: the names the client's own order lists, in that order, and then everything else -
// an appendix, taken by package id in lexical order, each package's unplaced parameters
// contiguous and in their manifest's own order. The between-package half of that was
// asserted by `test/effect-manifests.test.mjs`, which was scaffolding pinned to a
// historical revision and was retired with it, and `docs/proof-tools.md` recorded what
// went with it: the single-package case is exercised live by `tools/effect-check.mjs`,
// which installs a fork carrying a parameter the order has never heard of, and the
// ordering *between* two unplaced packages was "stated in the comment above the function
// and asserted nowhere". This is that gap closed, and it is closed at the same width the
// note describes rather than by restoring the gate: nothing here is pinned to a revision,
// to the shipped sixteen, or to anything but the rule.
//
// Through `tableFromPackages`, because `placeParams` is module-local - it stopped being
// exported when the gate that imported it went, and `tools/module-check.mjs` would report
// an export nothing reads. Reaching for it anyway would mean re-exporting a function for a
// test, which is the shape this repo refuses; the table's key order *is* the placement, so
// the public surface answers the question exactly.
//
// **What makes these rows able to fail is that the answer is not the arrival order.** The
// packages are handed over `zeta` first and the rule puts `alpha` first, so a build that
// had lost the sort - or never had it - returns the array it was given and reddens. That
// asymmetry is asserted in the file rather than left implicit, because a fixture whose
// expected output happens to equal its input is a test that passes on an empty rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableFromPackages } from '../web/effect-manifests.js';

// A parameter declaration with every field the table reads and nothing else, so a change
// to what `tableFromPackages` copies across fails these rows rather than being absorbed by
// a fixture that carried the field already.
const param = (label, uniform) => ({
  def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label,
  panel: { group: 'style', tab: 'look' },
  bind: { on: 'points', uniform },
});

// Named against their placement rather than against the alphabet, which is the whole
// point: the one that arrives first is called `zeta` and the one that arrives second is
// called `alpha`, so insertion order and lexical order disagree on every row below.
const pkg = (id, shorts) => ({
  id,
  manifest: {
    format: 1,
    id,
    version: '1.0.0',
    title: id,
    params: Object.fromEntries(shorts.map((s, i) => [s, param(`${id} ${s}`, `${id}${i}`)])),
  },
  chunks: {},
});

// `beta` declares its keys out of alphabetical order on purpose: within a package the
// manifest's own order is what survives, and a fixture whose keys were already sorted
// could not tell that from a second sort.
const ARRIVAL = [pkg('zeta', ['gain', 'bias']), pkg('alpha', ['tone', 'hue'])];

test('two packages the order has never heard of are appended by id, lexically', () => {
  const names = Object.keys(tableFromPackages(ARRIVAL, []));
  assert.deepEqual(names, ['alpha.tone', 'alpha.hue', 'zeta.gain', 'zeta.bias']);
  // The control for the row above, and the reason the packages are named the way they are:
  // the expected answer is not the order the packages were handed over in, so a build that
  // returned its input - which is what losing the sort looks like - fails rather than
  // agreeing by coincidence.
  const arrivalOrder = ARRIVAL.flatMap((p) => Object.keys(p.manifest.params).map((s) => `${p.id}.${s}`));
  assert.deepEqual(arrivalOrder, ['zeta.gain', 'zeta.bias', 'alpha.tone', 'alpha.hue']);
  assert.notDeepEqual(names, arrivalOrder,
    'the fixture has to disagree with its own arrival order, or these rows pass on a rule that does nothing');
});

test("and each package's own parameters stay contiguous and in manifest order", () => {
  const names = Object.keys(tableFromPackages(ARRIVAL, []));
  // Contiguity is the half a per-name comparison would miss: two packages interleaved
  // alphabetically - `alpha.hue, alpha.tone, zeta.bias, zeta.gain` - is a different rule
  // that agrees with the lexical one about which id comes first.
  const ids = names.map((n) => n.slice(0, n.indexOf('.')));
  assert.deepEqual(ids, ['alpha', 'alpha', 'zeta', 'zeta']);
  // And within a package the manifest decides, which the fixture can only say because its
  // keys are not in alphabetical order to begin with.
  assert.deepEqual(names.slice(0, 2), ['alpha.tone', 'alpha.hue']);
  assert.deepEqual(names.slice(2), ['zeta.gain', 'zeta.bias']);
});

test('a name the order places keeps its position, and the appendix follows the last of them', () => {
  const names = Object.keys(tableFromPackages(ARRIVAL, ['zeta.bias', 'alpha.hue']));
  assert.deepEqual(names, ['zeta.bias', 'alpha.hue', 'alpha.tone', 'zeta.gain']);
  // The placed pair is exactly the order handed in - not sorted, not re-derived - which is
  // what makes the order a layout fact the client owns rather than something a package can
  // move by being installed.
  assert.deepEqual(names.slice(0, 2), ['zeta.bias', 'alpha.hue']);
});

test('the order may not name a parameter no installed package declares', () => {
  assert.throws(
    () => tableFromPackages(ARRIVAL, ['zeta.gain', 'gamma.drift']),
    /the effect order names gamma\.drift/,
    'a name in the order with no declaration behind it is a registry entry that cannot be assembled',
  );
});
