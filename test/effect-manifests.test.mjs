// The manifests against the live table, both directions, under bare node.
//
// Step S2b of the effect-package refactor authors sixteen manifests from
// `web/effect-params.js`, and for one landing window the same forty-one parameters
// are stated twice: once in the table the registry still assembles from, once in the
// packages the registry will assemble from. Two statements of one thing drift - that
// is this repo's oldest lesson - so the window is held shut by this file: every
// manifest parameter must equal its table entry field for field, every table entry
// must appear in exactly one manifest, and the per-effect order must match, because
// the registry's declaration order is cut from the table in contiguous runs and the
// scramble table couples to it. When the registry flips to assembling from the
// manifests, the table side of this test is deleted with the table.
//
// The comparator is exercised against a tampered copy rather than trusted: a gate
// that cannot fail is a gate in name, and the tamper is one field one step off -
// the smallest drift the window could admit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECT_PARAMS } from '../web/effect-params.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN = join(ROOT, 'effects-builtin');

const readManifests = () => Object.fromEntries(
  readdirSync(BUILTIN, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [e.name, JSON.parse(readFileSync(join(BUILTIN, e.name, 'manifest.json'), 'utf8'))]),
);

// The table entry a manifest parameter implies, in the table's own vocabulary - the
// fields the registry consumes and nothing else, so `role`/`under`/`panelGroups`
// (presentation the manifests own outright) do not enter the equality.
const impliedEntry = (manifest, short) => {
  const p = manifest.params[short];
  const entry = {
    def: p.def, min: p.min, max: p.max, step: p.step, kind: p.kind, label: p.label,
    group: p.panel.group, on: p.bind.on, uniform: p.bind.uniform,
  };
  if (p.bind.transform !== undefined) entry.transform = p.bind.transform;
  if (p.bind.gates !== undefined) entry.gates = p.bind.gates;
  return entry;
};

const tableEntry = (spec) => {
  const entry = {
    def: spec.def, min: spec.min, max: spec.max, step: spec.step, kind: spec.kind, label: spec.label,
    group: spec.group, on: spec.on, uniform: spec.uniform,
  };
  if (spec.transform !== undefined) entry.transform = spec.transform;
  if (spec.gates !== undefined) entry.gates = spec.gates;
  return entry;
};

const compare = (manifests, table) => {
  const problems = [];
  const seen = new Set();
  for (const [id, manifest] of Object.entries(manifests)) {
    if (manifest.id !== id) problems.push(`${id}/manifest.json declares id ${JSON.stringify(manifest.id)}`);
    if (manifest.format !== 1) problems.push(`${id} declares format ${JSON.stringify(manifest.format)}`);
    const shorts = Object.keys(manifest.params);
    const tableOrder = Object.keys(table).filter((n) => n.startsWith(`${id}.`)).map((n) => n.slice(id.length + 1));
    if (JSON.stringify(shorts) !== JSON.stringify(tableOrder)) {
      problems.push(`${id} declares [${shorts}] where the table orders [${tableOrder}]`);
    }
    for (const short of shorts) {
      const name = `${id}.${short}`;
      seen.add(name);
      if (!Object.hasOwn(table, name)) { problems.push(`${name} is in no table entry`); continue; }
      const implied = impliedEntry(manifest, short);
      const declared = tableEntry(table[name]);
      if (JSON.stringify(implied) !== JSON.stringify(declared)) {
        problems.push(`${name}: manifest implies ${JSON.stringify(implied)}, table declares ${JSON.stringify(declared)}`);
      }
      // The door's own rule, held here while the door does not exist yet: a master
      // must default inert, because an effect's presence at defaults must not change
      // any document's render.
      if (manifest.params[short].role === 'master' && table[name].def !== 0 && table[name].def !== false) {
        problems.push(`${name} is a master defaulting to ${table[name].def}`);
      }
    }
  }
  for (const name of Object.keys(table)) {
    if (!seen.has(name)) problems.push(`${name} is in the table and in no manifest`);
  }
  return problems;
};

test('the sixteen manifests state exactly what the table states', () => {
  const manifests = readManifests();
  assert.equal(Object.keys(manifests).length, 16, 'sixteen builtin packages');
  const problems = compare(manifests, EFFECT_PARAMS);
  assert.deepEqual(problems, []);
});

test('the comparator refuses one field one step off', () => {
  const manifests = readManifests();
  const tampered = JSON.parse(JSON.stringify(manifests));
  tampered.rain.params.speed.def += tampered.rain.params.speed.step;
  const problems = compare(tampered, EFFECT_PARAMS);
  assert.ok(problems.some((p) => p.startsWith('rain.speed:')),
    `a one-step drift in rain.speed must be named, got: ${problems.join(' | ') || 'nothing'}`);
  // And the tamper is the only thing it found - a comparator drowning a real
  // finding in false ones is as unreadable as one finding nothing.
  assert.equal(problems.length, 1, problems.join(' | '));
});
