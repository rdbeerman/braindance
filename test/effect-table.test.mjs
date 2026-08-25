// Where a parameter no layout order places ends up. Asked through `tableFromPackages`,
// because `placeParams` is module-local and the table's key order is the placement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableFromPackages } from '../web/effect-manifests.js';

const param = (label, uniform) => ({
  def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label,
  panel: { group: 'style', tab: 'look' },
  bind: { on: 'points', uniform },
});

// The packages are named against their placement: `zeta` arrives first and `alpha` second, so
// insertion order and lexical order disagree and a build that lost the sort reddens.
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

// The keys inside each package are out of alphabetical order on purpose: within a package the
// manifest's own order survives, which a pre-sorted fixture could not tell from a second sort.
const ARRIVAL = [pkg('zeta', ['gain', 'bias']), pkg('alpha', ['tone', 'hue'])];

test('two packages the order has never heard of are appended by id, lexically', () => {
  const names = Object.keys(tableFromPackages(ARRIVAL, []));
  assert.deepEqual(names, ['alpha.tone', 'alpha.hue', 'zeta.gain', 'zeta.bias']);
  const arrivalOrder = ARRIVAL.flatMap((p) => Object.keys(p.manifest.params).map((s) => `${p.id}.${s}`));
  assert.deepEqual(arrivalOrder, ['zeta.gain', 'zeta.bias', 'alpha.tone', 'alpha.hue']);
  assert.notDeepEqual(names, arrivalOrder,
    'the fixture has to disagree with its own arrival order, or these rows pass on a rule that does nothing');
});

test("and each package's own parameters stay contiguous and in manifest order", () => {
  const names = Object.keys(tableFromPackages(ARRIVAL, []));
  const ids = names.map((n) => n.slice(0, n.indexOf('.')));
  assert.deepEqual(ids, ['alpha', 'alpha', 'zeta', 'zeta']);
  assert.deepEqual(names.slice(0, 2), ['alpha.tone', 'alpha.hue']);
  assert.deepEqual(names.slice(2), ['zeta.gain', 'zeta.bias']);
});

test('a name the order places keeps its position, and the appendix follows the last of them', () => {
  const names = Object.keys(tableFromPackages(ARRIVAL, ['zeta.bias', 'alpha.hue']));
  assert.deepEqual(names, ['zeta.bias', 'alpha.hue', 'alpha.tone', 'zeta.gain']);
  assert.deepEqual(names.slice(0, 2), ['zeta.bias', 'alpha.hue']);
});

test('the order may not name a parameter no installed package declares', () => {
  assert.throws(
    () => tableFromPackages(ARRIVAL, ['zeta.gain', 'gamma.drift']),
    /the effect order names gamma\.drift/,
    'a name in the order with no declaration behind it is a registry entry that cannot be assembled',
  );
});
