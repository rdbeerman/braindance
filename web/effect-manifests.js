// From fetched packages to the registry's vocabulary, in one place.
//
// A manifest states a parameter the way the package author wrote it - short name,
// panel placement, binding under `bind` - and the registry wants the flat entry shape
// the deleted effect table module used to declare. This module is the one statement of
// that conversion, imported by `web/main.js` for the live page and by the gate test
// under bare node, because a test that re-implemented the conversion would be a
// second statement agreeing with itself: the property the gate holds is that the
// packages on disk and the table the registry assembles are one thing, and it can
// only hold that with one converter between them.
//
// Pure functions of their arguments, no fetch and no imports: what arrives came over
// `/effects` (the page) or off the directory (the test), and where it came from is
// exactly what must not matter.

/**
 * The flat table the registry assembles from, one entry per name in the order
 * given. The order is a full list of dotted names rather than of effect ids,
 * because the registry's declaration order interleaves below effect granularity -
 * `noise.region` sits in the region run beside the push and the mask it works
 * with, three entries away from its own master - and that placement is the
 * client's layout fact: the scramble coupling and the panel's row order both fall
 * out of it, and nothing in a package can know where the whole build wants each
 * parameter. Validated both ways: a name the order lists that no package
 * declares, and a package parameter the order never places, are refusals rather
 * than guesses, so the list and the shipped set are held equal at boot.
 */
export const tableFromPackages = (packages, order) => {
  const declared = new Map();
  for (const p of packages) {
    for (const [short, spec] of Object.entries(p.manifest.params)) {
      declared.set(`${p.id}.${short}`, spec);
    }
  }
  const missing = order.filter((name) => !declared.has(name));
  if (missing.length) {
    throw new Error(`the effect order names ${missing.join(', ')} and no installed package declares `
      + `${missing.length === 1 ? 'it' : 'them'} - the registry cannot assemble entries it has no parameters for`);
  }
  const unplaced = [...declared.keys()].filter((name) => !order.includes(name));
  if (unplaced.length) {
    throw new Error(`${unplaced.join(', ')} is installed and the effect order does not place `
      + `${unplaced.length === 1 ? 'it' : 'them'} - a parameter the registry silently skipped would be a control that exists nowhere`);
  }
  const table = {};
  for (const name of order) {
    const p = declared.get(name);
    const entry = {
      def: p.def, min: p.min, max: p.max, step: p.step, kind: p.kind, label: p.label,
      group: p.panel.group, on: p.bind.on, uniform: p.bind.uniform,
    };
    if (p.bind.transform !== undefined) entry.transform = p.bind.transform;
    if (p.bind.gates !== undefined) entry.gates = p.bind.gates;
    table[name] = Object.freeze(entry);
  }
  return Object.freeze(table);
};

/**
 * The panel spine with each package's own groups spliced in. A group a package
 * declares carries its anchor - `after` names a core group key - and an `order`
 * that decides among packages targeting one anchor, so the panel's shape never
 * depends on which order the packages were fetched in. An anchor the spine does
 * not hold is a refusal: a group silently appended at the end would be a package
 * author's placement decision quietly overridden.
 */
export const withEffectGroups = (coreGroups, packages) => {
  const inserts = new Map();
  for (const p of packages) {
    for (const g of p.manifest.panelGroups ?? []) {
      if (!coreGroups.some((c) => c.key === g.after)) {
        throw new Error(`effect ${p.id} anchors its ${g.key} group after ${JSON.stringify(g.after)}, which is not a core group`);
      }
      if (!inserts.has(g.after)) inserts.set(g.after, []);
      inserts.get(g.after).push(g);
    }
  }
  const merged = [];
  for (const core of coreGroups) {
    merged.push(core);
    const here = (inserts.get(core.key) ?? []).sort((a, b) => (a.order - b.order) || (a.key < b.key ? -1 : 1));
    for (const g of here) {
      const { after, order, ...group } = g;
      merged.push(group);
    }
  }
  return merged;
};
