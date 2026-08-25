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
 * The generation of the package format this build reads. A manifest declaring a
 * higher number is refused at the install door rather than adapted, on the same
 * argument `format.js` makes about a capture: a package written against a later
 * build may mean something different by a field this one thinks it understands,
 * and reading it anyway is how a look renders as something nobody authored. A
 * manifest declaring nothing is refused too, because unlike a capture there is no
 * archive of packages shot before the field existed - every package that has ever
 * existed carries it.
 */
export const MANIFEST_FORMAT = 1;

/**
 * The closed vocabularies a manifest is written in, stated once because both ends
 * consume them.
 *
 * The install door refuses a manifest outside these sets, and the client's applier
 * implements exactly them - and those have to be one statement rather than two
 * agreeing lists, because the failure a second list produces is precisely the one the
 * door exists to prevent. A transform the door allowed and the applier did not know
 * would install cleanly and throw on its first write; a kind the door allowed and
 * `normalise` did not know would take the scalar branch and turn a boolean into NaN.
 * So `effectApply` in `web/main.js` reads `EFFECT_BIND_TRANSFORMS` rather than
 * spelling its two names again, and the door reads the same binding.
 *
 * `kind` is two entries and not three: `pose` is the camera's, it is core rather than
 * an effect's, and there is no uniform a pose could be bound to. `on` names which of
 * the two uniform tables a write lands on - the point cloud's or the grade pass's -
 * which is the only choice a binding has about where it goes.
 *
 * Frozen, because they cross a module boundary and a closed set that anybody could push
 * onto is not a closed set - the door would go on reporting the vocabulary it was given
 * while accepting whatever had been added to it.
 */
export const EFFECT_PARAM_KINDS = Object.freeze(['scalar', 'step']);
export const EFFECT_BIND_TABLES = Object.freeze(['points', 'grade']);
export const EFFECT_BIND_TRANSFORMS = Object.freeze(['axisDeg', 'degToRad']);

/**
 * The panel groups the client's own spine holds, as a set, sorted so it reads as one.
 *
 * **The install door needs this and cannot reach the thing that declares it.**
 * `CORE_PANEL_GROUPS` in `web/main.js` is ten entries carrying prose, tab tags and
 * `before()`/`after()` closures that build DOM, so it lives in a browser module with a
 * top-level await in it and the server can never import it. What the door has to ask is
 * much smaller: a parameter naming a group that is neither its own package's nor one of
 * these is a row `buildPanel` would throw over *after* the registry had already swapped,
 * and a package group key colliding with one of these is the same failure from the other
 * end.
 *
 * **Two statements, held equal at boot rather than trusted**, which is the shape
 * `tableFromPackages` already uses for the declaration order: `withEffectGroups` compares
 * the keys it is handed against this list and refuses a disagreement by name, so a core
 * group added or renamed in `web/main.js` without this line following is a page that does
 * not boot with both sets printed - not a door quietly refusing a correct package, and not
 * a door quietly accepting a group key that collides. Membership only and never order: the
 * panel's order is a layout fact and belongs to the one list that carries the prose
 * arguing about it.
 */
export const CORE_PANEL_GROUP_KEYS = Object.freeze([
  'colour', 'displacement', 'framing', 'motion', 'points',
  'post', 'region', 'signal', 'style', 'viewer',
]);

/**
 * Every declared parameter name, in the order the registry declares them: the ones
 * the client's order places, in that order, and then everything else.
 *
 * **The placed set is byte-stable and the appendix is where a package the order has
 * never heard of goes.** The order is a hand-written layout fact about the eighteen
 * shipped effects - the scramble coupling coupled to it, the panel builds a group's
 * rows in it - so it may not be regenerated, reordered or grown by a package
 * arriving at runtime. But a nineteenth effect has to land somewhere, and until
 * this rule existed it landed in a refusal: `tableFromPackages` treated a declared
 * name the order did not place as a parameter the registry would silently skip, which
 * is the right answer for a manifest edit and the wrong one for an install.
 *
 * So the appendix, and the rule is written out here because "deterministic" has to
 * mean one arrangement rather than whatever `Object.keys` happened to yield. Packages
 * are taken by id in lexical order, each package's unplaced parameters keep their
 * manifest declaration order, and the whole appendix follows the last placed name.
 * Contiguous per package, because a package's own parameters are the one grouping a
 * manifest can be sure of - its master and the keys under it read as a unit on the
 * panel, and interleaving two packages the order does not know would be this file
 * inventing a layout decision it has just finished saying it cannot make.
 *
 * **A fork that adds a parameter appends it rather than seating it beside its
 * siblings**, and that is a consequence worth stating rather than discovering. Fork
 * `rain` with a fifth key and the four the order places stay exactly where they are;
 * the fifth goes to the appendix, so it is last in the rain group rather than next to
 * `trail`. Seating it would mean guessing which of the placed names it belongs after,
 * and a guess about layout is the thing the order exists to make somebody state.
 *
 * With the shipped eighteen installed the appendix is empty and this returns the
 * order unchanged, which is what keeps every number downstream of it - the registry's
 * declaration order, the panel's rows, the scramble table - the bytes they were.
 *
 * **Not exported, and it used to be.** The bare-node gate that imported it held the
 * appendix's arithmetic directly - two packages named against their ids, a fork adding
 * a fifth key - and that gate was scaffolding pinned to a historical revision, retired
 * with the extraction. What exercises this rule now is `effect-check`, which installs a
 * fork carrying a parameter the order has never heard of and drives the page with it, so
 * the single-package case is live and the between-package ordering above is stated here
 * and asserted nowhere. Anybody adding a second unplaced package should read that as the
 * gap it is.
 */
const placeParams = (packages, order) => {
  const placed = new Set(order);
  const appendix = [];
  for (const p of [...packages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    for (const short of Object.keys(p.manifest.params)) {
      const name = `${p.id}.${short}`;
      if (!placed.has(name)) appendix.push(name);
    }
  }
  return [...order, ...appendix];
};

/**
 * The flat table the registry assembles from, one entry per declared parameter, in
 * the order `placeParams` decides. The order handed in is a full list of dotted names
 * rather than of effect ids, because the registry's declaration order interleaves
 * below effect granularity - `noise.region` sits in the region run beside the push
 * and the mask it works with, three entries away from its own master - and that
 * placement is the client's layout fact: the scramble coupling and the panel's row
 * order both fall out of it, and nothing in a package can know where the whole build
 * wants each parameter.
 *
 * **One direction is still a refusal and the other became a placement**, and the two
 * used to be symmetric. A name the order lists that no installed package declares is
 * a registry that cannot assemble the entry, so it throws as it always did; the
 * install door is what keeps that unreachable, by refusing a fork that drops a
 * parameter the package it shadows declares. A declared name the order does not place
 * used to throw on the same reasoning and cannot any more, because that is exactly
 * what installing an effect nobody had written a layout for looks like - see
 * `placeParams` for where it goes instead.
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
  const table = {};
  for (const name of placeParams(packages, order)) {
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
  // The one place the door's copy of the core group keys is held to the list that
  // declares them. Compared as sets - see `CORE_PANEL_GROUP_KEYS` for why the order is
  // deliberately not part of it - and refused by name, because a door checking a group
  // vocabulary the page no longer has is a door that refuses correct packages and accepts
  // colliding ones, and neither of those says anything about itself.
  const held = [...coreGroups.map((g) => g.key)].sort();
  if (held.join(',') !== [...CORE_PANEL_GROUP_KEYS].sort().join(',')) {
    throw new Error(`the panel spine holds the groups ${held.join(', ')} and CORE_PANEL_GROUP_KEYS names `
      + `${[...CORE_PANEL_GROUP_KEYS].sort().join(', ')} - the install door reads the second one, so the two `
      + 'disagreeing is a door checking a vocabulary this page has not got');
  }
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
