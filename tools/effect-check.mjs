#!/usr/bin/env node
// Installing an effect: the store's revisions, the door a package has to get through, and
// what happens on a page that is already up when one lands.
//
// **The failure this whole surface is built around is a page that will not boot.** A
// package is GLSL spliced into two programs and a table of parameters spliced into the
// registry, and both are assembled while `web/main.js` is still evaluating - so a package
// that does not assemble does not fail its install, it fails the *next page load*, with no
// `globalThis.__kinect` published, every tool in this suite reporting DID NOT RUN, and the
// only evidence a line in a console nobody has open. Everything below is about moving that
// failure to the moment of the install, and about proving that a page which was up when
// the install happened is still telling the truth afterwards.
//
// **Six claims, and each has something that must fail if it were not being done.**
//
//  1. **A revision is a hash of the bytes on disk.** Per file and over the set, computed
//     here from the staged tree and held against what the routes answer - so a store
//     serving a rev it made up, or one it cached, is a red row. The control is a byte:
//     one flipped in one chunk has to move that file's rev and its package's, and leave
//     every other package's alone. And a half-written package has to be invisible to
//     every read, which is what makes the install atomic rather than merely quick -
//     `temporaries-are-visible` is that row's control.
//  2. **The door refuses by name, and refuses on disk.** Fifteen hostile packages, one
//     per rule, each of which must come back with the sentence for its own rule and must
//     leave the user root exactly as it found it - no directory, no `.tmp`, no `.old`.
//     **The must-accept package is what makes that mean anything**: a door that refused
//     everything would pass all fifteen refusal rows at once, and the one package that
//     has to land is the row it could not pass.
//  3. **A page that is up adopts the install.** The group appears, the rows appear, the
//     uniform cell the package binds is minted, the assembled program carries its text -
//     and then `boot-check`'s own question is asked again on the rebuilt page: does every
//     control show the value the registry holds. That is the invariant an install is most
//     likely to break quietly, because a panel rebuilt without a value walk looks
//     completely normal. `rebuild-skips-the-panel` and `install-skips-the-uniform-cells`
//     are its two controls.
//  4. **Uninstalling parks and reinstalling restores, exactly.** Values and a keyframed
//     track go in, a playback hash is taken, the package is removed - the values park, the
//     badge says so - and it is put back, at which point the pool is empty and the same
//     three program positions hash to the same three images. A pixel identity rather than
//     a value comparison, because what is being claimed is that the *edit* survived and an
//     edit is what you can see. `reinstall-leaves-it-parked` is the control.
//  5. **And a build with nothing missing says nothing.** A badge that appeared on every
//     document would satisfy row 4's "the badge appeared" and mean nothing at all.
//  6. **An install this page cannot adopt leaves it whole rather than half-migrated.** A
//     fork adding a parameter makes the open document a subset of the new manifest, which
//     the loader refuses per effect - correctly - *after* the registry has been swapped.
//     The page has to go back: the registry it had, the signature it had, the pixels it
//     drew, the pool it was holding, and a save that still writes the parked keys byte for
//     byte. `rollback-keeps-the-new-registry` is the control, and it is worth reading which
//     rows it reddens: not the picture, because the added parameter is inert at its
//     default, and not the note, because the refusal is reported either way.
//  7. **Everything on the page that is not a parameter survives the rebuild too.** The
//     panel is regenerated whole, so every hand-written control inside a generated group,
//     the tab that was showing, the paint the collapse headers carry and the dialog that
//     picks a preset's subset are all things a rebuild can quietly replace with a working
//     copy of themselves that nothing is wired to. Each has its own mutation, because each
//     of them is invisible in a screenshot and none of them fails anything else.
//  8. **A rebuild costs what it has to cost and interrupts nothing it need not.** The
//     grade pass is gated on a list derived from the packages, so it has to be derived
//     again; a package that changed no GLSL must not warm and must not clear the
//     accumulators mid-playback; a package that did change GLSL must release the program it
//     replaced; and a rebuild must stand down when a gesture starts while it is reading
//     rather than when it started reading.
//  9. **A package this build cannot compile is a rollback, a sentence, and a package the
//     store stops serving.** The door checks vocabulary and cannot compile GLSL, so
//     identifier-valid text that is syntactically broken reaches the driver - where a link
//     failure is a log line and not an exception. Rolling back is only half of it: the
//     package survives the rollback, and the next page to open compiles it at boot, outside
//     any transaction, and publishes no `__kinect` at all. The only process in this program
//     with a GL context is the page, so the page is what tells the store, and the row that
//     matters is the fresh load booting afterwards rather than the store's answer.
//     `a-broken-shader-is-warm` and `a-link-failure-is-not-quarantined` are the controls for
//     the two halves, and `any-failure-is-quarantined` is the control for the direction that
//     does damage - a refusal about a *document* must never set a package aside, which is
//     what section 6 asks of the store after the completeness rule has refused a fork.
// 10. **A fork the door passed years ago is asked again at every start.** A package outlives
//     the build it was installed on, and an upgrade that drops or renames a joint leaves a
//     valid fork shadowing an upgraded builtin with nothing re-validating it - which is a
//     page that throws while evaluating and a machine whose editor never opens again. So a
//     doctored fork is written past the door, the server is restarted, and the store has to
//     hand the id back to the builtin, keep the fork aside with its files intact, say which
//     rule refused it, and let a page boot. `boot-adopts-a-stale-fork` is the control, and
//     the row that matters under it is the page rather than the store.
//
// **What is deliberately not here.** The export door on a clip whose look this build
// cannot draw, and the per-effect suppress beside it, belong to `export-check` - one
// claim, one place. This tool never renders a deliverable.
//
//   node tools/effect-check.mjs
//   node tools/effect-check.mjs --mutate temporaries-are-visible         # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-skips-the-panel         # must FAIL
//   node tools/effect-check.mjs --mutate install-skips-the-uniform-cells # must FAIL
//   node tools/effect-check.mjs --mutate reinstall-leaves-it-parked      # must FAIL
//   node tools/effect-check.mjs --mutate rollback-keeps-the-new-registry # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-remakes-the-buttons     # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-forgets-the-tab         # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-keeps-the-paint         # must FAIL
//   node tools/effect-check.mjs --mutate rebuild-keeps-the-picker        # must FAIL
//   node tools/effect-check.mjs --mutate gates-are-frozen-at-boot        # must FAIL
//   node tools/effect-check.mjs --mutate every-reload-warms              # must FAIL
//   node tools/effect-check.mjs --mutate swap-keeps-the-old-program      # must FAIL
//   node tools/effect-check.mjs --mutate poll-checks-once                # must FAIL
//   node tools/effect-check.mjs --mutate a-broken-shader-is-warm         # must FAIL
//   node tools/effect-check.mjs --mutate the-sweep-eats-the-last-copy    # must FAIL
//   node tools/effect-check.mjs --mutate package-files-follow-links      # must FAIL
//   node tools/effect-check.mjs --mutate poll-takes-any-body             # must FAIL
//   node tools/effect-check.mjs --mutate poll-guards-late                # must FAIL
//   node tools/effect-check.mjs --mutate reads-need-not-agree            # must FAIL
//   node tools/effect-check.mjs --mutate list-reads-need-not-agree-on-generation # must FAIL
//   node tools/effect-check.mjs --mutate package-read-need-not-match-the-list    # must FAIL
//   node tools/effect-check.mjs --mutate door-takes-any-expansion        # must FAIL
//   node tools/effect-check.mjs --mutate seeding-skips-existing-cells    # must FAIL
//   node tools/effect-check.mjs --mutate departed-uniforms-keep-their-value      # must FAIL
//   node tools/effect-check.mjs --mutate poll-retries-a-refused-set      # must FAIL
//   node tools/effect-check.mjs --mutate store-generation-never-moves    # must FAIL
//   node tools/effect-check.mjs --mutate adopt-outside-the-transaction    # must FAIL
//   node tools/effect-check.mjs --mutate every-failure-is-final          # must FAIL
//   node tools/effect-check.mjs --mutate boot-adopts-a-stale-fork        # must FAIL
//   node tools/effect-check.mjs --mutate the-gate-doors-a-package-against-its-neighbours # must FAIL
//   node tools/effect-check.mjs --mutate the-gate-runs-before-the-bind   # must FAIL
//   node tools/effect-check.mjs --mutate the-aside-keeps-the-whole-name  # must FAIL
//   node tools/effect-check.mjs --mutate a-refused-body-is-a-failed-read # must FAIL
//   node tools/effect-check.mjs --mutate the-gate-never-re-asks-the-set  # must FAIL
//   node tools/effect-check.mjs --mutate door-takes-an-array-binding     # must FAIL
//   node tools/effect-check.mjs --mutate hostdriven-takes-any-name       # must FAIL
//   node tools/effect-check.mjs --mutate door-takes-any-manifest         # must FAIL
//   node tools/effect-check.mjs --mutate a-refusal-moves-no-generation   # must FAIL
//   node tools/effect-check.mjs --mutate door-takes-a-gates-nothing-reads # must FAIL
//   node tools/effect-check.mjs --mutate a-link-failure-is-not-quarantined # must FAIL
//   node tools/effect-check.mjs --mutate any-failure-is-quarantined      # must FAIL
//
// It spawns its own server on a port nothing else in the suite uses and needs none
// running. A GPU browser, a free port 8281, no capture, no sensor and no ffmpeg.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const PORT = Number(flag('--port', '8281'));
const MUTATE = argv.includes('--mutate') ? flag('--mutate') : null;
const WORK = join(REPO, '.effect-check');
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * The mutations, and each one is a way of doing this feature that would look correct.
 *
 * `temporaries-are-visible` widens the id filter the store lists directories through, so
 * the `<id>.<seq>.tmp` a half-finished install leaves behind becomes an entry in
 * `/effects` and a package `rootFor` will resolve. That is the whole of what makes the
 * install atomic: the temporary names carry a dot and an effect id may not, so a crashed
 * install is invisible rather than merely unlikely to be read. A build without the filter
 * serves a package with no manifest to whatever asks next.
 *
 * `rebuild-skips-the-panel` builds the panel on the first run and never again, which is
 * the rebuild a person would write if they thought of the panel as boot furniture. Boot is
 * unaffected - the map is empty exactly once - so `boot-check` stays green and the page
 * carries on drawing; what breaks is the hotloaded page, where the registry has grown two
 * parameters that no row on the panel shows.
 *
 * `install-skips-the-uniform-cells` stops minting the JavaScript cell a new binding needs.
 * Every shipped package binds a uniform some hand-written table already holds, so nothing
 * about the sixteen notices; a seventeenth throws on the first write of its own parameter,
 * which the value walk performs, so the install fails rather than the slider.
 *
 * `reinstall-leaves-it-parked` widens the parking predicate to every dotted name, so a
 * value belonging to an effect that *is* installed parks anyway. The badge still appears
 * on the uninstall, which is what makes it worth having: a check reading only the badge
 * would call this build correct, and what fails is the restoration.
 *
 * `rollback-keeps-the-new-registry` is the half-rollback somebody writes who thinks of the
 * failure as being about the document: the loader is run again, and the packages it is run
 * against are the ones that just arrived rather than the ones this page had. The refusal is
 * still reported and the badge still says what is parked, so a check reading only the note
 * would call this build correct. What it leaves behind is the state the transaction exists
 * to prevent - a registry the server's, a pool the page's - and the two rows that can see
 * it are the registry's own contents and what a save writes, because the serialiser's
 * filter drops parked keys the moment their prefix reads installed. The image cannot see
 * it: the added parameter is inert at its default, so the picture is identical either way,
 * which is exactly why a pixel row is not enough to hold this property.
 */
const MUTATIONS = {
  'temporaries-are-visible': {
    file: 'server/effect-store.js',
    edits: [[
      '.filter((e) => e.isDirectory() && VALID_EFFECT_ID.test(e.name))',
      '.filter((e) => e.isDirectory())',
    ]],
  },
  'rebuild-skips-the-panel': {
    file: 'web/main.js',
    edits: [['\n  buildPanel();\n', '\n  if (!panelControls.size) buildPanel();\n']],
  },
  'install-skips-the-uniform-cells': {
    file: 'web/main.js',
    edits: [[
      "    table[bind.uniform] = { value: bind.transform === 'axisDeg' ? new THREE.Vector2() : 0 };",
      '    if (Object.hasOwn(table, bind.uniform)) table[bind.uniform] = { value: 0 };',
    ]],
  },
  'reinstall-leaves-it-parked': {
    file: 'web/main.js',
    edits: [[
      '  return id !== null && !effectInstalled(id);',
      '  return id !== null;',
    ]],
  },
  'rollback-keeps-the-new-registry': {
    file: 'web/main.js',
    edits: [[
      '      adoptEffectPackages(heldPackages, heldPrograms, held);',
      '      adoptEffectPackages(fetched, programs, held);',
    ]],
  },

  /**
   * `rebuild-remakes-the-buttons` takes the memo off the two closures that emit the
   * framing group's hand-written rows, which is what the panel generator did until an
   * install existed to notice. Every rebuild then makes fresh buttons carrying the right
   * ids and none of the wiring, and the visible `show crop box` stops toggling anything
   * while `ui` writes its status into a node that is no longer in the document. Nothing
   * throws, the panel looks exactly right, and the controls are dead.
   */
  'rebuild-remakes-the-buttons': {
    file: 'web/main.js',
    edits: [
      ["    before: panelOnce(() => [\n      panelButtonRow(['camSensor', 'sensor view']),",
        "    before: () => [\n      panelButtonRow(['camSensor', 'sensor view']),"],
      ["      panelButtonRow(['camLevelReset', 'reset rotation']),\n    ]),\n    after: panelOnce(() => [",
        "      panelButtonRow(['camLevelReset', 'reset rotation']),\n    ],\n    after: () => ["],
      ["      panelNote('recRange', 'preview only'),\n    ]),", "      panelNote('recRange', 'preview only'),\n    ],"],
    ],
  },

  /**
   * `rebuild-forgets-the-tab` drops the re-application of the showing tab from the end of
   * the generator. A generated group is a new element with `hidden` unset, so one install
   * puts every tab's groups on screen at once - which is a panel four times as long as it
   * should be and no error anywhere.
   */
  'rebuild-forgets-the-tab': {
    file: 'web/main.js',
    edits: [['\n  hideOffTab();\n\n  // And the dialog', '\n\n  // And the dialog']],
  },

  /**
   * `rebuild-keeps-the-paint` leaves `groupPainted` holding the state strings it wrote
   * against the elements the rebuild has just thrown away. A group whose values did not
   * move across the install is then skipped by the first refresh after it, so it comes back
   * without its `shut` class and without `aria-expanded` - open on screen while the page's
   * own model says it is collapsed, and stable there, because the next refresh agrees with
   * the map.
   */
  'rebuild-keeps-the-paint': {
    file: 'web/main.js',
    edits: [['\n  groupPainted.clear();', '']],
  },

  /**
   * `rebuild-keeps-the-picker` builds the preset subset dialog once and never again, which
   * is what it did when it was a top-level loop. An installed effect then gets no checkbox
   * - so its values are in every preset with no way to leave them out - and an uninstalled
   * one leaves a checkbox whose `change` handler reads `PARAMS` for a name the registry no
   * longer has.
   */
  'rebuild-keeps-the-picker': {
    file: 'web/main.js',
    edits: [['\n  buildPresetPicker();\n}', '\n  if (!presetPickBoxes.size) buildPresetPicker();\n}']],
  },

  /**
   * `gates-are-frozen-at-boot` computes the list of grade terms that hold the pass open
   * once, off the packages that happened to be installed while the module evaluated. Every
   * shipped grade effect is in that list, so nothing about the sixteen notices; a grade
   * effect installed afterwards writes its uniform into a pass that stays shut, and the
   * effect is silently absent with its slider moving and its value landing.
   */
  'gates-are-frozen-at-boot': {
    file: 'web/main.js',
    edits: [['  GRADE_GATES = gradeGatesOf(packages);\n', '  GRADE_GATES ??= gradeGatesOf(packages);\n']],
  },

  /**
   * `every-reload-warms` warms unconditionally, which is what the rebuild did before it
   * knew whether the programs had moved. A package that changed only its parameters
   * assembles into the identical two programs and there is nothing to compile - but the
   * warm ends in `resetAccumulators`, so the trails and the surface memory a page is
   * mid-playback on are cleared for an install that changed no pixel of the shader.
   */
  'every-reload-warms': {
    file: 'web/main.js',
    edits: [['    if (!sameProgram) warmPrograms();', '    warmPrograms();']],
  },

  /**
   * `swap-keeps-the-old-program` puts the program swap back to `needsUpdate` alone. Three
   * releases a program's reference only from a material's `dispose` event, so every
   * GLSL-changing install leaves a whole compiled program linked and cached - on a page
   * whose entire point is being installed into again without a reload.
   */
  'swap-keeps-the-old-program': {
    file: 'web/point-cloud.js',
    edits: [[
      '  if (material.vertexShader === program.vertexShader\n'
      + '    && material.fragmentShader === program.fragmentShader) return;\n'
      + '  material.dispose();\n',
      '',
    ]],
  },

  /**
   * `poll-checks-once` asks whether a rebuild may happen on the way into the tick and never
   * again. Several dozen requests happen after that, which is long enough for an export to
   * start or a preset gesture to open - and the rebuild then lands inside it, replacing two
   * shader programs and every value between one frame of a file nobody can watch being made
   * and the next.
   */
  'poll-checks-once': {
    file: 'web/main.js',
    edits: [[
      '  const blocked = effectRebuildBlocked();\n  if (blocked) return null;',
      '  const blocked = null;\n  if (blocked) return null;',
    ]],
  },

  /**
   * `a-broken-shader-is-warm` drops the throw at the end of the warm, leaving the link
   * failure where three.js puts it: a line in a console nobody has open. The install
   * succeeds, the document is carried across, the poll announces that the page has been
   * rebuilt from the new effects, and the cloud renders nothing at all.
   *
   * **The whole statement is anchored rather than its first line**, which is worth a
   * sentence because the anchor had to move once already. It used to quote a bare
   * `throw new Error(...)`, and the throw is a marked one now - `reloadEffects` reads
   * `shaderLinkFailure` to decide which failures may reach the refusal route, and a
   * classification that matched words in the sentence is what `effectRefusal`'s own comment
   * rejects by name, so the mark had to be minted here where the difference is known. Taking
   * the statement whole is what leaves nothing of it behind: a replacement that swapped only
   * the first line would leave a live call to the minter standing under a `void`, which
   * builds an error and does nothing with it and reads to the next person like code that
   * still matters.
   */
  'a-broken-shader-is-warm': {
    file: 'web/main.js',
    edits: [[
      "    throw shaderLinkFailure(\n"
      + "      `this build's shaders did not compile after the effects changed - ${linkFailures[0]}`,\n"
      + '      linkFailures[0],\n'
      + '    );',
      '    console.warn(`shaders did not compile: ${linkFailures[0]}`);',
    ]],
  },

  /**
   * `door-takes-a-gates-nothing-reads` drops the pair of rules that ask whether a `gates`
   * binding lands something the gate can actually read, which is how the door shipped. Both
   * shapes then install cleanly and the promise the author made is about nothing: a gating
   * binding on the point cloud is collected by no walk, and a gating binding through `axisDeg`
   * puts a `Vector2` where a number belongs, which held the grade pass shut for the life of the
   * page under the comparison `gradeNeeded` used to make and holds it open forever under the one
   * it makes now.
   *
   * Written from `server/effect-door.js`'s side because that is where the refusal is, and aimed
   * at the `if (bind.gates)` that guards both halves rather than at either sentence, so one
   * mutation takes the whole rule away. Reddens **one** row, measured - section 2's hostile
   * sweep - and the row now names both fixtures rather than the first of them, which is what
   * makes a single mutation over two rules readable at all.
   */
  'door-takes-a-gates-nothing-reads': {
    file: 'server/effect-door.js',
    edits: [[
      '    if (bind.gates) {\n      if (bind.on',
      '    if (false) {\n      if (bind.on',
    ]],
  },

  /**
   * `a-link-failure-is-not-quarantined` leaves the throw and the mark exactly where they are
   * and drops the one call that acts on them, which is the build this fix was written to
   * replace and is the state every green run before it was in. The page still refuses the
   * package, still rolls back, still says which shader did not compile - and the package sits
   * in the store afterwards, so the next browser to open compiles it at boot, where
   * `warmPrograms` runs outside any transaction and takes the module down with it.
   *
   * **Reddens four rows, measured, all of them in section 9, and the third is the point.** The
   * store still lists the package and there is no aside beside it, which is the mechanism; the
   * fresh page comes back `no __kinect published: this build's shaders did not compile`, which
   * is the damage; and the delete that follows answers 200 rather than 404, because the live
   * copy is still there to remove. Without the fresh-page row a build that called the route
   * and achieved nothing would pass everything above it.
   */
  'a-link-failure-is-not-quarantined': {
    file: 'web/main.js',
    edits: [[
      '  const setAside = failure?.shaderLinkFailure\n'
      + '    ? await setAsideUnlinkable(heldPackages, fetched, failure.linkLog)\n'
      + '    : null;',
      '  const setAside = null;',
    ]],
  },

  /**
   * `any-failure-is-quarantined` keeps the call and drops the mark test, so every failure the
   * rollback catches reaches the refusal route. That is the direction this fix does damage in
   * rather than merely fails in, and it is the harder half to notice: the page behaves
   * correctly in every reading a person takes of it - the refusal is right, the sentence is
   * right, the rollback is right - and a package nothing is wrong with has been renamed out of
   * the way behind all of it.
   *
   * The failure it turns loose is the one section 6 provokes on purpose: install a fork that
   * *adds* a parameter while a document holds that effect, and the per-effect completeness
   * rule refuses the subset. Nothing about the package is wrong there; what could not be done
   * is carrying *this document* onto it, and the operator's next move - opening a document
   * that names the new parameter - would have worked.
   *
   * **Reddens three rows, measured, and only the first is the finding.** Section 6's asks the
   * store whether the fork is still installed and comes back `GET /effects/probe answered 404,
   * user root holds probe.<seq>.incompatible` - a package renamed out of the way for a fault
   * in a clip, which is the whole of what this mutation is about. The two under it are section
   * 9's and are the fixture carrying forward rather than a second finding: both of them key on
   * there being exactly one `probe.*.incompatible` in the user root, and section 6's innocent
   * aside is sitting beside section 9's real one. Everything else in section 9 stays green -
   * the store still drops the package and the generation still moves by one - which is what
   * makes those two a count going wrong rather than a second thing being found.
   */
  'any-failure-is-quarantined': {
    file: 'web/main.js',
    edits: [[
      '  const setAside = failure?.shaderLinkFailure\n',
      '  const setAside = failure\n',
    ]],
  },

  /**
   * `adopt-outside-the-transaction` puts the adoption back where it was: before the `try`
   * the rollback hangs off, so a throw out of the adoption itself walks straight past it.
   * Everything the adoption replaces is already replaced by the time `buildPanel` refuses a
   * parameter naming no panel group, so what it leaves behind is the half-migrated page the
   * whole transaction exists to make unreachable - a registry with no panel drawn from it.
   */
  'adopt-outside-the-transaction': {
    file: 'web/main.js',
    edits: [
      ['  let failure = null;\n  try {',
        '  adoptEffectPackages(fetched, programs, held);\n  let failure = null;\n  try {'],
      ['    adoptEffectPackages(fetched, programs, held);\n', ''],
    ],
  },

  /**
   * `the-sweep-eats-the-last-copy` puts the sweep back to removing every aside it finds,
   * which is what destroys a package rather than tidying after one. A crash between the two
   * renames of an install leaves the old copy in `<id>.<seq>.old` and nothing at `<id>` -
   * and the sweep runs first thing in the next install of that id, so the operation that
   * would have restored it deletes it.
   */
  'the-sweep-eats-the-last-copy': {
    file: 'server/effect-store.js',
    edits: [
      ["      if (entry.name.endsWith('.old') && !liveHere) continue;\n", ''],
      ['    this.recoverInterruptedInstalls();\n', ''],
    ],
  },

  /**
   * `package-files-follow-links` puts `statSync` back where `lstatSync` is, so the file
   * route asks about what a name points at rather than about the name. The user root is the
   * one directory in this program a client can write into, and a link planted there is then
   * read and served from wherever it aims.
   */
  'package-files-follow-links': {
    file: 'server/effect-store.js',
    edits: [['    if (!existsSync(path) || !lstatSync(path).isFile()) return null;',
      '    if (!existsSync(path) || !statSync(path).isFile()) return null;']],
  },

  /**
   * `poll-takes-any-body` stops holding `GET /effects` to the shape every reader of it
   * assumes. A 200 carrying anything else - a proxy's error page, a half-written response -
   * then reaches the signature comparison, which throws out of the interval callback and
   * rejects a promise nothing is awaiting, once every six seconds for the life of the page.
   */
  'poll-takes-any-body': {
    file: 'web/main.js',
    // **Two edits, because one of them is not the defect.** Defusing the array check alone
    // leaves the entry loop iterating `undefined`, which throws a TypeError inside
    // `listEffects` - inside the poll's own catch, where it is handled - so the mutated
    // build behaved exactly like the fixed one and the run came back NOT CAUGHT on a
    // mutation that had not reproduced anything. Both have to go for the shipped shape to
    // come back: `listEffects` answers `undefined`, and the signature comparison a line
    // later is outside every catch there is.
    //
    // **Re-anchored when the listing grew its generation**, and the shape rule had to be one
    // condition rather than two for the reason this whole entry is about: a generation check
    // written as a second `if` would be a guard downstream of the line this edits, so the
    // mutated build would refuse the nonsense body anyway and the run would come back NOT
    // CAUGHT on a mutation that reproduced nothing.
    edits: [
      ['  if (!body || !Array.isArray(body.effects) || !Number.isFinite(body.generation)) {', '  if (body === undefined) {'],
      ['  for (const entry of body.effects) {', '  for (const entry of body.effects ?? []) {'],
    ],
  },

  /**
   * `poll-guards-late` raises the reentrancy guard after the list has come back rather than
   * on the way in, which is where it was. Two ticks then overlap - the interval does not
   * wait for the last one - and whichever finishes second wins, so with an install landing
   * between them the page settles on the packages it read first while its signature claims
   * the ones it read second, and the comparison agrees with itself from then on.
   */
  'poll-guards-late': {
    file: 'web/main.js',
    edits: [
      ['  if (effectReloading || effectRebuildBlocked()) return;\n  effectReloading = true;\n  try {',
        '  if (effectReloading || effectRebuildBlocked()) return;\n  try {'],
      ['    if (listedSignature === refusedEffectSignature) return;\n    await pollRebuild(listedSignature);',
        '    if (listedSignature === refusedEffectSignature) return;\n    effectReloading = true;\n    await pollRebuild(listedSignature);'],
    ],
  },

  /**
   * `reads-need-not-agree` takes the second list read off the end of the package fetch, so
   * a set is whatever the several dozen requests happened to return. An install landing
   * anywhere in that sequence is then served partly from before it and partly from after,
   * and the halves assemble into a program that compiles and draws something nobody wrote.
   */
  'reads-need-not-agree': {
    file: 'web/main.js',
    edits: [['    if (closed.generation === opened.generation && revSignature(closed.effects) === revSignature(opened.effects)) return packages;',
      '    if (opened) return packages;']],
  },

  /**
   * `list-reads-need-not-agree-on-generation` drops the generation term from that same
   * comparison and leaves the contents term standing, which is what the coherent read was
   * before it had one. The two are one line and two claims, and only this half can see a
   * change that is *undone*: a revision installed and removed again restores the bytes, so
   * every rev in the opening list and the closing list is identical across a window the page
   * read some of its chunks out of. The contents comparison passes that pair by construction
   * and the run then records the signature it opened with, so nothing later disagrees either.
   *
   * It is a separate spec from `reads-need-not-agree` rather than a second edit of it,
   * because a build with no comparison at all and a build comparing the wrong thing fail
   * differently and only one of them is the shape this term was added for.
   */
  'list-reads-need-not-agree-on-generation': {
    file: 'web/main.js',
    edits: [['    if (closed.generation === opened.generation && revSignature(closed.effects) === revSignature(opened.effects)) return packages;',
      '    if (revSignature(closed.effects) === revSignature(opened.effects)) return packages;']],
  },

  /**
   * `package-read-need-not-match-the-list` stops holding each package read to the revision
   * the list named it at, which is the half of a coherent read the two listings cannot cover
   * between them. A revision installed and removed again inside that one request hands the
   * page the other package's manifest and file index, and both listings still agree - so this
   * fails in exactly the window the generation term above closes from the outside, one
   * request in.
   */
  'package-read-need-not-match-the-list': {
    file: 'web/main.js',
    edits: [['    if (pkg?.rev !== rev) {', '    if (false) {']],
  },

  /**
   * `door-takes-any-expansion` drops the bound on how much text a manifest asks to have
   * spliced, leaving the two that count what it carries. A file counts once in both of those
   * and once per descriptor in the assembler, so a package can name a size neither of them
   * measures - and the fixture in section 2 is inside both of them and outside this one.
   */
  'door-takes-any-expansion': {
    file: 'server/effect-door.js',
    edits: [['  if (expandedBytes > MAX_PACKAGE_BYTES) {', '  if (false) {']],
  },

  /**
   * `seeding-skips-existing-cells` puts the uniform seeding back to minting only what is
   * missing, which is what it did while a binding's shape could not change. It can: a fork
   * that turns one `axisDeg` parameter plain and a later one plain into `axisDeg` writes a
   * number over the first cell's `Vector2` and then throws on `.set()` at the second - and
   * the rollback that exists for exactly that throw re-adopts through this same function,
   * finds both cells present, skips them, and dies on the number the forward attempt left.
   * The page is then holding a registry no document loads into and the only sentence left is
   * the one asking for a reload.
   */
  'seeding-skips-existing-cells': {
    file: 'web/main.js',
    edits: [['    if (uniformCellFits(table[bind.uniform], bind)) continue;',
      '    if (Object.hasOwn(table, bind.uniform)) continue;']],
  },

  /**
   * `departed-uniforms-keep-their-value` stops putting back a uniform the registry has
   * stopped binding. Nothing else writes those cells - a parameter's `apply` is the only
   * writer - so the term the departed binding used to drive runs at whatever the slider last
   * left in it, for the life of the page, with no control anywhere that can move it. The
   * shader text does not have to change for this: a manifest that rebinds one parameter onto
   * a different live uniform is the whole of it.
   */
  'departed-uniforms-keep-their-value': {
    file: 'web/main.js',
    edits: [['  restoreDepartedUniforms(wasBound, boundUniforms(EFFECT_PARAMS));',
      '  void wasBound;']],
  },

  /**
   * `poll-retries-a-refused-set` removes the block on a set this page has already failed to
   * adopt. The rollback puts the old signature back, deliberately, so the comparison above it
   * goes on saying the store has moved - and without this the same rebuild is attempted every
   * six seconds forever: every package refetched, both programs reassembled, the material
   * disposed, the accumulators reset, the same sentence printed, for as long as the store
   * holds a package this build cannot use.
   */
  'poll-retries-a-refused-set': {
    file: 'web/main.js',
    edits: [['    if (listedSignature === refusedEffectSignature) return;\n', '']],
  },

  /**
   * `every-failure-is-final` puts the block above back on *every* way a rebuild can fail,
   * which is how it shipped. A refusal and a read error are the same three lines from the
   * poll's side and nothing else in the error can tell them apart, so one server restart
   * between the listing and a package fetch - or one dropped socket on the two-machine shape
   * this program documents - blocked a revision that was never anything but good, until
   * something else moved the store.
   *
   * What must redden is the read-error pair at the end of section 9 and nothing beside it:
   * a genuine refusal is still remembered on this build, so the rows that ask about one stay
   * green, which is what separates the two halves of that block.
   */
  'every-failure-is-final': {
    file: 'web/main.js',
    edits: [[
      '    if (err.effectRefusal) refusedEffectSignature = listedSignature;',
      '    refusedEffectSignature = listedSignature;',
    ]],
  },

  /**
   * `boot-adopts-a-stale-fork` takes the store's boot gate off, which is every build of this
   * program before the gate existed. A package that got through the door once is served
   * forever, whatever this build's spines have done since - so a fork whose chunk names a
   * joint an upgrade removed goes on shadowing the builtin it forks, and the page that
   * fetches it throws inside `assembleShaders` while it is still evaluating.
   *
   * Aimed at the call rather than at the method body, so the gate is still there to be read
   * and simply is not asked - which is the shape the defect had: nothing re-validated,
   * rather than something validating wrongly. Section 12 is what must redden, and its last
   * row is the one that matters, because the four before it are about a store and that one
   * is about a page that will not boot.
   */
  'boot-adopts-a-stale-fork': {
    file: 'server/effect-store.js',
    edits: [['    this.refuseIncompatiblePackages();', '    void this.refuseIncompatiblePackages;']],
  },

  /**
   * `the-gate-doors-a-package-against-its-neighbours` puts the boot gate's second pass back
   * to asking the door about each candidate with *every* other package beside it, checked or
   * not, which is how it shipped. The door assembles `[...beside, candidate]` and reports the
   * assembler's message under the candidate's name, so one fork this build cannot assemble
   * made every fork on the machine come back "does not assemble" - and which of them was
   * blamed depended on the lexical order the walk happened to reach them in.
   *
   * What must redden is section 12's must-accept pair: the healthy fork of `rain` staged
   * beside the broken `thermal` is quarantined for its neighbour's joint, and the row
   * counting what is left standing sees an empty user root. Everything else in that section
   * stays green, because a store that quarantines too much still hands `thermal` back to the
   * builtin and still boots a page.
   */
  'the-gate-doors-a-package-against-its-neighbours': {
    file: 'server/effect-store.js',
    edits: [[
      '        const standing = new Map([...builtins, ...survivors]);\n'
      + '        standing.delete(candidate.id);\n'
      + '        const beside = [...standing.values()].sort((a, b) => (a.id < b.id ? -1 : 1));',
      '        const beside = this.loaded(candidate.id);',
    ]],
  },

  /**
   * `the-gate-runs-before-the-bind` puts the recovery and the boot gate back at construction,
   * which is where they were: every process that got as far as building a store ran them,
   * including one about to die on `EADDRINUSE` over a root another server was already
   * serving. The call in `listen` is left standing, so the winner still gates exactly once
   * and every other section is untouched - what the edit adds is the loser doing it too.
   *
   * What must redden is the last row of section 13 and only that: the second server renames
   * the fork in its own root before the bind fails, so a process that never answered a
   * request has quarantined a package it never validated.
   */
  'the-gate-runs-before-the-bind': {
    file: 'server/effect-store.js',
    edits: [['    this.generation = 0;\n  }', '    this.generation = 0;\n    this.claimUserRoot();\n  }']],
  },

  /**
   * `the-aside-keeps-the-whole-name` stops truncating the stem an aside is built from, which
   * is how it shipped - at a time when nothing bounded how long an id could be. `NAME_MAX` is
   * 255 bytes and the suffix is about thirty characters, so a directory installed by that
   * build under a two-hundred-character name cannot be renamed at all: `ENAMETOOLONG` out of
   * `renameSync`, out of the gate written to keep one broken package from taking the server
   * down.
   *
   * What must redden is the row in section 12 about the over-long directory. The server still
   * comes up on this build rather than dying, because the rename is caught and the package is
   * left where it is - which is the other half of the same repair and is why the row reads
   * both ends: the name it had is gone, and what it became is short enough to exist.
   */
  'the-aside-keeps-the-whole-name': {
    file: 'server/effect-store.js',
    edits: [['    const stem = id.slice(0, MAX_EFFECT_ID);', '    const stem = id;']],
  },

  /**
   * `a-refused-body-is-a-failed-read` puts back the frame that erased the mark on its way out
   * of the fetch. Every deterministic shape refusal a read can make - a listing that is not a
   * list, a manifest that is not an object, a `chunks` that arrived as a string - is minted
   * as a refusal at its throw site and then re-framed here for the chip, and a plain
   * `new Error` at that frame threw the classification away. The set the store is serving is
   * refetched whole every six seconds forever, which is the loop the block exists to stop.
   *
   * Aimed at the frame rather than at a throw site, because the frame is where every one of
   * them passes: an edit to one throw would leave the other two proving nothing. Section 14
   * is what must redden, and its second row is the one that matters - the first says the page
   * refused the package at all, which both builds do.
   */
  'a-refused-body-is-a-failed-read': {
    file: 'web/main.js',
    edits: [[
      '    const framed = `the installed effects changed and this page could not read them: ${err.message}`;\n'
      + '    throw err.effectRefusal ? effectRefusal(framed) : new Error(framed);',
      '    throw new Error(`the installed effects changed and this page could not read them: ${err.message}`);',
    ]],
  },

  /**
   * `store-generation-never-moves` stops the store counting its own changes, and it is the
   * control the two client-side mutations above cannot be: both of those edit `web/main.js`,
   * and the arm that drives them fabricates a moved generation in an interception - so a build
   * whose store never moved the number would satisfy every one of them while the coherent read
   * compared equal numbers forever and a real change-and-undo sailed through it. What must
   * redden is the pair of rows in section 2 that read it off the store across a real install
   * and a real uninstall, and what must stay green is section 8's arm, because the two measure
   * opposite ends of one wire.
   *
   * Two edits because there are two writers and each has to go: leaving either standing means
   * the pair of rows still sees a number move, on a store that has stopped counting half of
   * what it does.
   */
  /**
   * `the-gate-never-re-asks-the-set` puts the boot gate back to validating each candidate and
   * never re-asking the packages it has already accepted, which is how it shipped. That reads
   * as sufficient and is not: `doorRefusal` walks the *candidate's* chunks for names this build
   * has not got and `forkRefusal` catches a dropped parameter, so a fork that stops declaring a
   * varying its neighbour reads is correct about everything the gate asks it. It is promoted,
   * it shadows the shipped package, and the neighbour's program stops linking.
   *
   * Reddens **five** rows, measured. Four of them are section 15 and are what this is about:
   * the fork stands, the aside is not there, the log says nothing, and the page opened on that
   * store publishes no `__kinect` at all - the last of those is the finding and the three above
   * it are how it got there. The must-accept row beside them stays green, because a gate that
   * quarantines nothing leaves the healthy glyph fork alone too, and that is exactly what makes
   * it a control for over-refusal rather than for this.
   *
   * **The fifth is a cascade into section 16 and this comment said four until it was counted.**
   * That section drives the refusal route against a store section 15 was supposed to have
   * cleaned up, so with the rain fork still standing its row about the shipped set being all
   * that is left sees a user package and reddens. It is a consequence of the fixture surviving
   * rather than a second finding, and it is written down because a comment naming which rows
   * catch a mutation is a claim like any other.
   */
  'the-gate-never-re-asks-the-set': {
    file: 'server/effect-store.js',
    edits: [[
      '        if (!refusal) {\n          const resulting = new Map([...builtins, ...survivors]);',
      '        if (false) {\n          const resulting = new Map([...builtins, ...survivors]);',
    ]],
  },

  /**
   * `door-takes-an-array-binding` drops the rule that a binding may not aim at an array,
   * leaving the shape rule beside it. The two are not the same question: three.js takes its
   * uploader off the declaration, so an array uniform is handed the array setter and one
   * number, and the write succeeds into a cell no shader reads.
   *
   * Aimed at the refusal rather than at the reading that finds the dimension, because those
   * two fail differently and `test/effect-door.test.mjs` separates them: with the reading
   * undone the door accepts the package outright, and with only the refusal gone it refuses
   * under the shape sentence instead.
   *
   * So this reddens **one** row, measured - the refusal row, on the sentence rather than on the
   * acceptance - and the residue row beside it stays green, because the shape rule catches the
   * package a few lines later and it never reaches disk. This comment said two until it was
   * counted, on the assumption that a mutation of a refusal means a package lands. The one that
   * would land is the reading, and the reading has no mutation here because
   * `door-takes-any-manifest` and the bare-node rows already carry that shape.
   */
  'door-takes-an-array-binding': {
    file: 'server/effect-door.js',
    edits: [['    if (arrayed.length) {', '    if (false) {']],
  },

  /**
   * `hostdriven-takes-any-name` puts back the door that let a package list any uniform at all
   * as host-driven. `hostDriven` is the one exemption from the rule that something has to write
   * every uniform a package declares, and an exemption a package issues itself is the rule
   * gone: the shader reads zero for the life of the page and no control exists that could
   * have moved it.
   *
   * Reddens **two** rows of section 2, measured - the refusal and the residue, because nothing
   * else in this door has anything to say about the package and it lands on disk. The sweep
   * after them is what keeps it to two rather than carrying an installed fixture into section 3.
   */
  'hostdriven-takes-any-name': {
    file: 'server/effect-door.js',
    edits: [['    if (!HOST_DRIVEN_UNIFORMS.includes(u)) {', '    if (false) {']],
  },

  /**
   * `door-takes-any-manifest` drops the bound on the manifest, leaving the three that count
   * chunk text. A package can repeat a correct *parameter* rather than a correct chunk, so
   * those three see a small package while the store writes and hashes megabytes on every read
   * and every open page builds a control per parameter. Reddens **two** rows of section 2,
   * measured - the refusal and the residue, because the package lands on disk - on the same
   * argument `door-takes-any-expansion` does, and the sweep after them keeps it to two.
   */
  'door-takes-any-manifest': {
    file: 'server/effect-door.js',
    edits: [['  if (manifestBytes > MAX_MANIFEST_BYTES) {', '  if (false) {']],
  },

  /**
   * `a-refusal-moves-no-generation` stops the refusal route counting itself as a change of the
   * store. A set-aside id stops resolving from the user root and starts answering from the
   * builtin, and the page that just called the route is sitting on a rolled-back set waiting
   * for the next poll to hand it a working one - so a store that does not move the number is
   * a page whose recovery depends on the revisions happening to differ. Reddens one row of
   * section 16 and leaves the three beside it green, because the rename still happens.
   *
   * **Re-anchored once, and where it moved to is the mutation reading better than it did.** It
   * used to quote `EFFECTS.generation += 1` in the route, and the bump has since moved into
   * `setAsideForClient` so that the store's own history has one writer rather than a route
   * reaching into a field it does not own. Anchored on the assignment beside the rename it
   * belongs to, which is also what keeps it distinct from the two `store-generation-never-moves`
   * edits: three assignments of that field now exist in one file and each is quoted with the
   * line above it.
   */
  'a-refusal-moves-no-generation': {
    file: 'server/effect-store.js',
    edits: [[
      "    if (!this.setAside(id, reason)) return 'stuck';\n    this.generation += 1;",
      "    if (!this.setAside(id, reason)) return 'stuck';",
    ]],
  },

  'store-generation-never-moves': {
    file: 'server/effect-store.js',
    edits: [
      ['    this.generation += 1;\n    return { ...this.read(id), replaced };',
        '    return { ...this.read(id), replaced };'],
      ['    this.generation += 1;\n    return { removed: id, restored: existsSync(join(this.builtinDir, id)) };',
        '    return { removed: id, restored: existsSync(join(this.builtinDir, id)) };'],
    ],
  },
};

if (argv.includes('--mutate') && !MUTATIONS[MUTATE]) {
  console.log(`[effect] DID NOT RUN - no mutation named ${MUTATE ?? '(nothing was given)'};`
    + ` this tool knows ${Object.keys(MUTATIONS).join(', ')}`);
  process.exit(2);
}

// --- the port, asked of the kernel ------------------------------------------
//
// A tool that finds a stranger already listening is answered by the stranger and asserts
// against whatever fixture *that* process staged, which is a green run proving nothing.
// Asked before anything is staged, so the refusal costs nothing and names what is held.
const portHeld = await new Promise((resolve) => {
  const probe = spawn('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  probe.stdout.on('data', (c) => { out += c; });
  probe.on('close', () => resolve(out.trim()));
  probe.on('error', () => resolve(''));
});
if (portHeld) {
  console.log(`[effect] DID NOT RUN - something is already listening on ${PORT} (pid ${portHeld.split('\n').join(', ')}). `
    + 'A run answered by a stranger asserts against whatever that process staged.');
  process.exit(2);
}

// --- the staged tree ---------------------------------------------------------
//
// A mutation applied in place and restored afterwards leaves a mutated working tree behind
// any crash, which is the one state a proof tool must never produce. `server/` and `web/`
// are copied rather than linked for the same reason - through a symlink every mutation
// here would rewrite the repo's own source - and `effects-builtin/` joins them because the
// store refuses to boot without its shipped root and because this tool flips a byte inside
// it on purpose.
//
// `effects/` is made empty and handed to the server by name. **Both roots are passed
// explicitly rather than left to resolve**, which matters more here than anywhere else in
// the suite: this is the only tool that writes packages, and a root that resolved to the
// checkout would put its fixtures - and its fifteen hostile ones - into the repo.
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
// `presets-builtin` joins the list for the same class of reason `effects-builtin` does and
// is worth naming rather than leaving to be rediscovered: the page fetches the preset
// library while it boots, and a staged tree without the shipped root answers 500, which
// lands in `pageErrors` and reddens the last row of section 5 with a fault that has
// nothing to do with effects.
for (const dir of ['server', 'tools', 'web', 'effects-builtin', 'presets-builtin']) {
  cpSync(join(REPO, dir), join(WORK, dir), { recursive: true });
}
mkdirSync(join(WORK, 'effects'), { recursive: true });
for (const name of ['node_modules', 'vendor']) {
  const from = join(REPO, name);
  if (existsSync(from)) symlinkSync(from, join(WORK, name));
}
// `native/` is deliberately absent, so the server spawns no grabber and the depth textures
// stay whatever this tool plants in them. Section 4 hashes rendered frames, and a live
// socket wipes a plant in well under a second.
if (MUTATE) {
  const spec = MUTATIONS[MUTATE];
  const path = join(WORK, spec.file);
  let source = readFileSync(path, 'utf8');
  for (const [from, to] of spec.edits) {
    const hits = source.split(from).length - 1;
    if (hits !== 1) {
      console.log(`[effect] DID NOT RUN - the ${MUTATE} anchor matched ${hits} times in ${spec.file}, `
        + 'expected exactly 1, so nothing was mutated and this run would prove nothing');
      process.exit(2);
    }
    source = source.replace(from, to);
  }
  writeFileSync(path, source);
}

const USER_ROOT = join(WORK, 'effects');
const BUILTIN_ROOT = join(WORK, 'effects-builtin');

// --- harness -----------------------------------------------------------------
let checked = 0;
let failed = 0;
let crashed = null;
let untested = null;
const fired = [];
const ok = (label, pass, detail = '') => {
  checked++;
  if (!pass) { failed++; fired.push(label); }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const servers = [];
// **What the last start said, kept where a row can read it.** The store's boot gate
// announces a package it has refused, in the door's own sentence, and that announcement is
// half of what section 12 asserts - a gate that quietly renamed somebody's fork aside would
// satisfy every other row it has. Reset per start rather than accumulated, because the
// question is always what *this* start did.
let serverLog = '';
const start = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    join(WORK, 'server/index.js'), '--port', String(PORT),
    '--effects', USER_ROOT, '--builtin-effects', BUILTIN_ROOT,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  const log = [];
  serverLog = '';
  const onData = (c) => {
    log.push(c.toString());
    serverLog = log.join('');
    if (log.join('').includes('viewer on')) setTimeout(resolve, 200);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  setTimeout(() => reject(new Error(`server never came up:\n${log.join('')}`)), 15000);
});
const stopAll = async () => {
  for (const c of servers) c.kill('SIGKILL');
  servers.length = 0;
  await wait(150);
};

const getJson = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
};
const put = async (id, body) => {
  const res = await fetch(`${BASE}/effects/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const del = async (id) => {
  const res = await fetch(`${BASE}/effects/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
  });
  return { status: res.status, body: await res.json() };
};

/** Everything sitting in the user root, temporaries included - the residue test. */
const userRootHolds = () => (existsSync(USER_ROOT) ? readdirSync(USER_ROOT).sort() : []);

// --- the package this tool installs -------------------------------------------
//
// A whole effect rather than a stub: a master that is inert at zero, a second key under
// it, its own panel group anchored into the spine, a declaration chunk and a chunk that
// reaches a pixel. Everything section 3 and section 4 assert is about a package doing what
// a package does, and a fixture that declared parameters and no GLSL would leave the
// program swap, the minted uniform cell and the pixel identity all untested.
const probeManifest = () => ({
  format: 1,
  id: 'probe',
  version: '1.0.0',
  title: 'Probe',
  params: {
    amount: {
      def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe',
      panel: { group: 'probe', tab: 'look' },
      bind: { on: 'points', uniform: 'probeAmount' },
      role: 'master',
    },
    hue: {
      def: 0.5, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe hue',
      panel: { group: 'probe', tab: 'look' },
      bind: { on: 'points', uniform: 'probeHue' },
      under: 'amount',
    },
  },
  panelGroups: [
    { key: 'probe', label: 'Probe', tab: 'look', lookgroup: true, collapses: true, after: 'post', order: 900 },
  ],
  chunks: [
    { stage: 'f.decl', order: 900, file: 'decl.frag.glsl' },
    { stage: 'f.tone', order: 900, file: 'tone.frag.glsl' },
  ],
});
const probeChunks = () => ({
  'decl.frag.glsl': 'uniform float probeAmount, probeHue;\n',
  'tone.frag.glsl':
    '  if (probeAmount > 0.0) {\n'
    + '    col = mix(col, vec3(probeHue, 1.0 - probeHue, probeHue * 0.5), probeAmount);\n'
    + '  }\n',
});
const probePackage = () => ({ manifest: probeManifest(), chunks: probeChunks() });

/**
 * The same effect with one parameter more - the install a page holding this effect's
 * values cannot be carried onto.
 *
 * **A fork that adds is the one shape that turns a good install into a bad page.** A
 * document names every parameter of every effect it touches, because the loader's
 * per-effect completeness rule refuses half of one; so a document written against the two
 * parameters here names a subset of the three below, and the moment the third arrives the
 * loader refuses that document by its own rule. Nothing is wrong with the package, nothing
 * is wrong with the document, and the refusal is correct - what section 6 is about is
 * where the page is left standing when it fires.
 *
 * The added parameter reaches a pixel and is inert at its default, both deliberately: it
 * has to be a real parameter for the door to accept it and for the assembled program to
 * declare its uniform, and it has to change nothing at zero so the image the rollback
 * restores can be compared against the image before the install without the comparison
 * turning into a question about the fork's own look.
 */
const forkedProbe = () => {
  const pkg = probePackage();
  pkg.manifest.version = '2.0.0';
  pkg.manifest.params.glow = {
    def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe glow',
    panel: { group: 'probe', tab: 'look' },
    bind: { on: 'points', uniform: 'probeGlow' },
    under: 'amount',
  };
  pkg.chunks['decl.frag.glsl'] = 'uniform float probeAmount, probeHue, probeGlow;\n';
  pkg.chunks['tone.frag.glsl'] =
    '  if (probeAmount > 0.0) {\n'
    + '    col = mix(col, vec3(probeHue, 1.0 - probeHue, probeHue * 0.5), probeAmount);\n'
    + '    col += vec3(probeGlow * 0.25);\n'
    + '  }\n';
  return pkg;
};
const bent = (edit) => {
  const pkg = probePackage();
  edit(pkg);
  return pkg;
};

/**
 * A package holding one uniform cell of each shape there is, and the fork that swaps them.
 *
 * **The two shapes are the whole fixture.** A binding writes either a bare number or, under
 * `axisDeg`, `.value.set(sin, cos)` into a two-component cell - so the JavaScript object a
 * uniform table holds is a number for one and a `Vector2` for the other, and which one it has
 * to be is a fact about the *current* manifest. A manifest is a thing an install replaces,
 * and until this fixture existed nothing in the suite ever changed one of those shapes.
 *
 * Its own id and its own uniform names, because it has to be installed and removed inside a
 * section that is holding `probe` parked and section 7 primes state on top of what is left:
 * a fixture that reached for `probeHue` would be two packages binding one cell and the arm
 * would be about the collision rather than about the shape.
 */
const shapedProbe = () => ({
  manifest: {
    format: 1,
    id: 'probeshape',
    version: '1.0.0',
    title: 'Probe Shape',
    params: {
      amount: {
        def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe shape',
        panel: { group: 'post', tab: 'look' },
        bind: { on: 'points', uniform: 'probeShapeAmount' },
        role: 'master',
      },
      angle: {
        def: 0, min: 0, max: 360, step: 1, kind: 'scalar', label: 'probe shape angle',
        panel: { group: 'post', tab: 'look' },
        bind: { on: 'points', uniform: 'probeShapeAxis', transform: 'axisDeg' },
        under: 'amount',
      },
      tone: {
        def: 0.5, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe shape tone',
        panel: { group: 'post', tab: 'look' },
        bind: { on: 'points', uniform: 'probeShapeTone' },
        under: 'amount',
      },
    },
    chunks: [
      { stage: 'f.decl', order: 910, file: 'decl.frag.glsl' },
      { stage: 'f.tone', order: 910, file: 'tone.frag.glsl' },
    ],
  },
  chunks: {
    'decl.frag.glsl': 'uniform float probeShapeAmount, probeShapeTone;\nuniform vec2 probeShapeAxis;\n',
    'tone.frag.glsl':
      '  if (probeShapeAmount > 0.0) {\n'
      + '    col = mix(col, vec3(probeShapeTone, probeShapeAxis.x, probeShapeAxis.y), probeShapeAmount);\n'
      + '  }\n',
  },
});

/**
 * The same package with its two shapes exchanged and a parameter added, which is the install
 * a page holding this effect's values cannot be carried onto.
 *
 * **Both halves are load-bearing and they answer different halves of the claim.** The swap is
 * what corrupts the table: the value walk reaches `angle` first and writes a plain number
 * over a cell that was a `Vector2`, then reaches `tone` and calls `.set()` on a cell that was
 * a number. The added `glow` is what makes the *fixed* build reach the rollback at all -
 * without it a build that reshapes both cells adopts the fork cleanly, nothing rolls back,
 * and the row about a rollback surviving a reshaped table would be asserting nothing. With
 * it, the open document names three of four parameters, the loader's completeness rule
 * refuses it after the swap has landed, and the rollback runs back through cells the forward
 * attempt left in the fork's shapes - which is the state under test.
 *
 * Both uniforms are redeclared at the type their new binding writes, because the door refuses
 * a plain binding onto a `vec2` and an `axisDeg` binding onto a `float`. A fork that only
 * moved the transform would never be installed, so it could never reach the page.
 */
const reshapedProbe = () => {
  const pkg = shapedProbe();
  const p = pkg.manifest;
  p.version = '2.0.0';
  delete p.params.angle.bind.transform;
  Object.assign(p.params.angle, { min: 0, max: 1, step: 0.01, def: 0 });
  p.params.tone.bind.transform = 'axisDeg';
  Object.assign(p.params.tone, { min: 0, max: 360, step: 1, def: 0 });
  p.params.glow = {
    def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe shape glow',
    panel: { group: 'post', tab: 'look' },
    bind: { on: 'points', uniform: 'probeShapeGlow' },
    under: 'amount',
  };
  pkg.chunks['decl.frag.glsl'] = 'uniform float probeShapeAmount, probeShapeAxis, probeShapeGlow;\nuniform vec2 probeShapeTone;\n';
  pkg.chunks['tone.frag.glsl'] =
    '  if (probeShapeAmount > 0.0) {\n'
    + '    col = mix(col, vec3(probeShapeTone.x, probeShapeAxis, probeShapeTone.y), probeShapeAmount);\n'
    + '    col += vec3(probeShapeGlow * 0.25);\n'
    + '  }\n';
  return pkg;
};

/**
 * The same package with a different version and byte-identical chunks - a rev that moves
 * and two programs that do not.
 *
 * A retuned bound, a corrected label, a version bump: most of what a package author
 * actually changes is the manifest, and none of it reaches the GLSL. The store's rev is a
 * hash over every file, so the poll sees a change and rebuilds - and the rebuild has
 * nothing to compile. What it must therefore not do is warm, because the warm ends in
 * `resetAccumulators`.
 */
const retunedProbe = () => {
  const pkg = probePackage();
  pkg.manifest.version = '1.0.1';
  pkg.manifest.params.hue.label = 'probe hue, retuned';
  return pkg;
};

/**
 * A third revision of the same package, for an arm that needs the store to move *again*
 * after `retunedProbe` has already landed.
 *
 * A label and nothing else, like the one above it: the assembled programs are identical, so
 * an arm using this is about whether the page noticed rather than about what a warm costs.
 */
const relabelledProbe = () => {
  const pkg = probePackage();
  pkg.manifest.version = '1.0.2';
  pkg.manifest.params.hue.label = 'probe hue, once more';
  return pkg;
};

/**
 * The same package with one more line of GLSL, so the assembled programs genuinely move.
 *
 * `n` makes each call a different program, which is what the row about released programs
 * needs: three installs that compile three distinct programs, against a renderer whose
 * cache would otherwise hold all three.
 */
const recompiledProbe = (n) => {
  const pkg = probePackage();
  pkg.manifest.version = `1.1.${n}`;
  pkg.chunks['tone.frag.glsl'] =
    '  if (probeAmount > 0.0) {\n'
    + `    col = mix(col, vec3(probeHue, 1.0 - probeHue, probeHue * ${(0.5 + n * 0.01).toFixed(2)}), probeAmount);\n`
    + '  }\n';
  return pkg;
};

/**
 * A package whose every identifier this build has and whose GLSL does not compile.
 *
 * **This is the shape the door cannot see and must not be asked to.** The door checks that
 * a chunk names nothing the build has not got; it is not a compiler and reimplementing one
 * here would be the second implementation this repo keeps refusing. So `col` is the spine's
 * own colour and `probeAmount` is this package's own uniform - both perfectly well known -
 * and assigning a `float` to a `vec3` is a type error the driver refuses at compile time.
 * The install succeeds, the page fetches it, the programs assemble, and the link fails.
 */
const brokenProbe = () => {
  const pkg = probePackage();
  pkg.manifest.version = '9.0.0';
  pkg.chunks['tone.frag.glsl'] = '  col = probeAmount;\n';
  return pkg;
};

/**
 * A grade effect, because the pass the grade runs in is gated and the gate is a list.
 *
 * Five shipped effects declare `gates` and every one of them was installed while the page
 * booted, so a list computed once is right about all of them and wrong about the first
 * package to arrive afterwards. This is that package: it binds a uniform of its own on the
 * grade table with `gates` set, so raising it has to switch the pass on and nothing else
 * on the page can do it.
 *
 * Its group is `post`, which is one of this build's own - a package inventing a group would
 * be testing the panel where this is about the pass.
 */
const gradeProbeManifest = () => ({
  format: 1,
  id: 'probegrade',
  version: '1.0.0',
  title: 'Probe Grade',
  params: {
    amount: {
      def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe grade',
      panel: { group: 'post', tab: 'look' },
      bind: { on: 'grade', uniform: 'probeGradeAmount', gates: true },
      role: 'master',
    },
  },
  chunks: [
    { stage: 'g.decl', order: 900, file: 'decl.grade.glsl' },
    { stage: 'g.body', order: 900, file: 'body.grade.glsl' },
  ],
});
const gradeProbePackage = () => ({
  manifest: gradeProbeManifest(),
  chunks: {
    'decl.grade.glsl': 'uniform float probeGradeAmount;\n',
    'body.grade.glsl': '      col *= mix(1.0, 0.5, probeGradeAmount);\n',
  },
});

/**
 * A pinned run with no capture and no sensor: a handful of depth frames written here.
 *
 * The wire's own frame payload - depth byte count, colour byte count, a stamp, then the
 * millimetres - which is what `drive.pin` parses. Colour is left at zero bytes, exactly as
 * a pinned run does on a real take, because a JPEG decode is asynchronous and a hash taken
 * across one would be a hash of whether it had landed yet.
 *
 * The surface is a plane that leans, so the picture has depth in it: a flat wall renders
 * the same colour everywhere and a tone chunk mixing toward a colour would move every
 * pixel by the same amount, which is a picture two builds can agree about for the wrong
 * reason. The frames differ from each other so a track evaluated at three positions has
 * three images to be right about.
 */
const DEPTH_W = 512;
const DEPTH_H = 424;
const pinnedBuffer = () => {
  const FRAMES = 6;
  const depthBytes = DEPTH_W * DEPTH_H * 2;
  const out = Buffer.alloc(FRAMES * (16 + depthBytes));
  for (let f = 0; f < FRAMES; f++) {
    const at = f * (16 + depthBytes);
    out.writeUInt32LE(depthBytes, at);
    out.writeUInt32LE(0, at + 4);
    out.writeBigUInt64LE(BigInt(f * 33), at + 8);
    for (let y = 0; y < DEPTH_H; y++) {
      for (let x = 0; x < DEPTH_W; x++) {
        // 1.2m to 2.6m across the frame, drifting 40mm per frame so successive frames are
        // genuinely different geometry rather than the same one restamped.
        const mm = 1200 + Math.round((x / DEPTH_W) * 900 + (y / DEPTH_H) * 500) + f * 40;
        out.writeUInt16LE(mm, at + 16 + (y * DEPTH_W + x) * 2);
      }
    }
  }
  return out;
};

const POSITIONS = [0.1, 0.6, 1.2];

console.log(`[effect] ${MUTATE ? `MUTATED: ${MUTATE} (${MUTATIONS[MUTATE].file})` : 'unmutated tree'}\n`);

let browser = null;
try {
  let chromium;
  try {
    ({ chromium } = await import(join(REPO, 'node_modules/playwright/index.mjs')));
  } catch {
    untested = 'playwright is not installed, and three of the five sections are about a page';
    throw new Error(untested);
  }

  await start();

  // ======================================================= 1. what a revision is
  console.log('[effect] 1. the store\'s revisions, and a half-written package');

  const listed = await getJson('/effects');
  ok('the store lists the shipped packages', listed.status === 200 && listed.body.effects?.length >= 16,
    `${listed.body.effects?.length ?? 0} packages`);
  if (listed.status !== 200) throw new Error('the store would not list at all, so nothing below could be measured');

  // The oracle: the hashes this tool computes off the staged tree, which is the only
  // reading independent of the thing under test. A row comparing the store's rev against
  // the store's own recomputation would agree with any implementation, correct or not.
  let fileRevs = 0;
  let packageRevs = 0;
  let revMismatch = null;
  for (const entry of listed.body.effects) {
    const dir = join(BUILTIN_ROOT, entry.id);
    for (const file of entry.files) {
      const want = sha(readFileSync(join(dir, file.name)));
      if (file.rev !== want) revMismatch ??= `${entry.id}/${file.name}`;
      fileRevs++;
    }
    const want = sha(entry.files.map((f) => `${f.name} ${f.rev}\n`).join(''));
    if (entry.rev !== want) revMismatch ??= `${entry.id} (the package)`;
    packageRevs++;
  }
  ok('every file revision is the sha256 of the bytes on disk, and every package revision the hash over its file lines',
    revMismatch === null, revMismatch ? `first disagreement at ${revMismatch}` : `${fileRevs} files across ${packageRevs} packages`);

  // The control. A rev that was a name, a timestamp or a cached number would satisfy every
  // row above on a tree nobody had touched.
  const victim = join(BUILTIN_ROOT, 'thermal/heat.frag.glsl');
  const original = readFileSync(victim);
  const beforeFlip = await getJson('/effects/thermal');
  const witnessBefore = await getJson('/effects/edges');
  writeFileSync(victim, Buffer.concat([original, Buffer.from('\n')]));
  const afterFlip = await getJson('/effects/thermal');
  const witnessAfter = await getJson('/effects/edges');
  const revOf = (pkg, name) => pkg.body.files.find((f) => f.name === name)?.rev;
  ok('one byte changed on disk moves that file\'s revision',
    revOf(beforeFlip, 'heat.frag.glsl') !== revOf(afterFlip, 'heat.frag.glsl'),
    `${revOf(beforeFlip, 'heat.frag.glsl')?.slice(7, 19)} -> ${revOf(afterFlip, 'heat.frag.glsl')?.slice(7, 19)}`);
  ok('and its package\'s revision with it', beforeFlip.body.rev !== afterFlip.body.rev,
    `${beforeFlip.body.rev.slice(7, 19)} -> ${afterFlip.body.rev.slice(7, 19)}`);
  ok('and leaves every other package where it was, so a revision is about its own bytes',
    witnessBefore.body.rev === witnessAfter.body.rev, witnessAfter.body.rev.slice(7, 19));
  // The other half of the same flip, and it is the residual of the coherent read stated as
  // behaviour rather than left in prose. A revision follows the bytes whoever wrote them, so
  // the rows above move for a write this store did not make; the generation follows the
  // *store*, so it does not. That is the whole of what a page reading across an out-of-band
  // edit and its undo cannot see, and it is the price of a counter rather than a content hash
  // - which `docs/instruments.md` carries the argument for.
  const genAfterFlip = (await getJson('/effects')).body.generation;
  ok('and the generation beside them does not move, because nothing this store did made that byte change',
    genAfterFlip === listed.body.generation,
    `generation ${listed.body.generation} before the flip and ${genAfterFlip} after it`);
  writeFileSync(victim, original);
  const restored = await getJson('/effects/thermal');
  ok('and putting the byte back puts the revision back', restored.body.rev === beforeFlip.body.rev,
    restored.body.rev.slice(7, 19));

  // ================================================================= 2. the door
  console.log('\n[effect] 2. the door, and the package that has to get through it');

  const beforeInstall = (await getJson('/effects')).body;
  const accepted = await put('probe', probePackage());
  const afterInstall = (await getJson('/effects')).body;
  ok('a well-formed package lands - the row that stops every refusal below passing on a door that refuses everything',
    accepted.status === 200 && accepted.body.id === 'probe', `answered ${accepted.status}: ${accepted.body.error ?? 'installed'}`);
  const onDisk = existsSync(join(USER_ROOT, 'probe')) ? readdirSync(join(USER_ROOT, 'probe')).sort() : [];
  ok('and its files are the ones it sent, in the user root',
    onDisk.join(',') === 'decl.frag.glsl,manifest.json,tone.frag.glsl', onDisk.join(', ') || 'nothing');
  const shadowCheck = await getJson('/effects/probe');
  ok('and the store answers for it as a user package rather than a shipped one',
    shadowCheck.status === 200 && shadowCheck.body.builtin === false, `builtin=${shadowCheck.body.builtin}`);

  await del('probe');
  const afterRemove = (await getJson('/effects')).body;
  const cleanRoot = userRootHolds();
  ok('and removing it leaves the user root empty, so the refusals below start from nothing',
    cleanRoot.length === 0, cleanRoot.join(', ') || 'empty');

  // ---- and the number the listing carries beside those revisions
  //
  // **The store's own count of how many times it has changed, asserted against the store
  // rather than against a page.** Section 8 stages a change-and-undo by moving this number in
  // an interception, which measures what the *client* does with it and would pass perfectly on
  // a store that never moved it at all - at which point every listing agrees forever and the
  // read the whole term exists for is back to comparing bytes. So the two rows here read it
  // off the real thing, across the real install and the real uninstall this section already
  // performs.
  //
  // The second row is the whole design in one measurement: `probe` is not a builtin, so
  // removing it leaves the store holding exactly the packages and exactly the revisions it
  // held before the install - identical bytes on both sides of a window in which it answered
  // as something else - and the only thing that can tell the two moments apart is a number
  // that went up twice.
  const listingSignature = (body) => (body.effects ?? []).map((e) => `${e.id} ${e.rev}`).join('\n');
  ok('an install moves the store\'s generation and so does an uninstall',
    afterInstall.generation > beforeInstall.generation && afterRemove.generation > afterInstall.generation,
    `${beforeInstall.generation} -> ${afterInstall.generation} -> ${afterRemove.generation}`);
  ok('and the pair leaves every revision exactly where it was, which is the reading the generation exists to carry',
    listingSignature(afterRemove) === listingSignature(beforeInstall)
      && afterRemove.generation !== beforeInstall.generation,
    listingSignature(afterRemove) === listingSignature(beforeInstall)
      ? `${beforeInstall.effects.length} packages hashing identically across a change and its undo, `
        + `generation ${beforeInstall.generation} against ${afterRemove.generation}`
      : 'the revisions moved, so this pair is not the change-and-undo the row is about');

  // The shipped noise, whole, for the fork row.
  //
  // **A fork is held against what it forks, and reaching that rule takes some care.** Two
  // earlier rules stand in front of it: a fork sent without its own chunks is refused for
  // the chunk that did not arrive, and a fork of a package whose *own* GLSL declares the
  // dropped parameter's uniform is refused for a uniform nothing binds. `noise` has
  // neither problem - its chunk declares no uniforms of its own, they are all the spine's -
  // so dropping one of its parameters reaches the rule this row is about. That is a fact
  // about which package to use for the row, and it is written down because picking `rain`
  // here produced a green row for the wrong reason.
  const noiseDir = join(BUILTIN_ROOT, 'noise');
  const noiseManifest = JSON.parse(readFileSync(join(noiseDir, 'manifest.json'), 'utf8'));
  const noiseChunks = Object.fromEntries((noiseManifest.chunks ?? []).map((c) => [c.file, readFileSync(join(noiseDir, c.file), 'utf8')]));
  const forkedNoise = (edit) => {
    const manifest = JSON.parse(JSON.stringify(noiseManifest));
    edit(manifest);
    return { manifest, chunks: { ...noiseChunks } };
  };

  // One hostile package per rule. Each is the well-formed one with a single field wrong,
  // which is the shape a real broken package has - a fixture written to fail is a fixture
  // that can fail for a reason nobody intended.
  const hostile = [
    ['an id nothing could be', 'Probe1', probePackage(), /is not an effect id/],
    ['a manifest declaring another id', 'probe', bent((p) => { p.manifest.id = 'other'; }), /declaring id "other"/],
    ['a package format from a later build', 'probe', bent((p) => { p.manifest.format = 2; }), /package format 2/],
    ['a package that says no format at all', 'probe', bent((p) => { delete p.manifest.format; }), /declares no package format/],
    ['a chunk name that is a path', 'probe', bent((p) => {
      p.manifest.chunks[0].file = '../escape.glsl';
      p.chunks['../escape.glsl'] = p.chunks['decl.frag.glsl'];
      delete p.chunks['decl.frag.glsl'];
    }), /"\.\.\/escape\.glsl"/],
    ['two parameters claiming the role master', 'probe', bent((p) => {
      Object.assign(p.manifest.params.hue, { role: 'master', def: 0 });
    }), /2 parameters with the role master/],
    ['a master that is not inert at its default', 'probe', bent((p) => { p.manifest.params.amount.def = 0.5; }), /master and defaults to 0\.5/],
    ['a kind this registry does not implement', 'probe', bent((p) => { p.manifest.params.hue.kind = 'ramp'; }), /kind "ramp"/],
    ['a transform the applier has never heard of', 'probe', bent((p) => { p.manifest.params.hue.bind.transform = 'toKelvin'; }), /transform "toKelvin"/],
    ['a binding whose uniform no program declares', 'probe', bent((p) => { p.manifest.params.hue.bind.uniform = 'probeHueee'; }), /declares no such uniform/],
    ['a uniform declared and bound by nothing', 'probe', bent((p) => {
      p.chunks['decl.frag.glsl'] = 'uniform float probeAmount, probeHue, probeStray;\n';
    }), /"probeStray" and binds no parameter/],
    ['a chunk naming a joint no spine holds', 'probe', bent((p) => { p.manifest.chunks[1].stage = 'f.elsewhere'; }), /does not assemble/],
    ['an identifier that exists nowhere in this build', 'probe', bent((p) => {
      p.chunks['tone.frag.glsl'] = '  col = mix(col, vec3(qqNotHere), probeAmount);\n';
    }), /"qqNotHere"/],
    ['a varying whose initial value reads state', 'probe', bent((p) => {
      p.manifest.varyings = [{ name: 'vProbe', type: 'float', init: 'probeAmount', order: 900 }];
    }), /initialises to "probeAmount"/],
    ['a chunk the manifest names and did not send', 'probe', bent((p) => { delete p.chunks['tone.frag.glsl']; }), /its text did not arrive/],
    ['a file the manifest never names', 'probe', bent((p) => { p.chunks['spare.glsl'] = '// nothing\n'; }), /"spare\.glsl" and its manifest names no chunk/],
    ['a fork of a shipped package that drops one of its parameters', 'noise', forkedNoise((m) => {
      m.version = '2.0.0';
      delete m.params.speed;
    }), /drops noise\.speed/],
    // **The five rules about a package as a whole, which every rule above is satisfied by
    // however many times a package repeats a correct entry.** Each of these is refused under
    // bare node in `test/effect-door.test.mjs` as well, where the shipped sixteen are the
    // must-accept control; what these rows add is that the refusal happens on disk, through
    // the route, and leaves nothing behind.
    ['one joint naming one file over and over', 'probe', bent((p) => {
      // The reported shape was a thousand descriptors over one 493-byte chunk, which carries
      // 493 bytes and asks a driver to compile half a megabyte. It is refused for being a
      // repeat rather than for being large, so the count here is only about reaching the rule.
      //
      // **Fifty rather than a thousand, and the reduction is a measured finding rather than
      // tidying.** A descriptor costs about ninety bytes in the manifest, so the thousand-entry
      // fixture arrived as a 90,623-byte manifest - past the bound this door now puts on that,
      // which fires several rules earlier. The row went red naming the manifest size, on a
      // build where both rules were working: the fixture had stopped reaching the rule it is
      // named after. Fifty descriptors is about 6KB of manifest, comfortably inside every bound
      // here and outside none, so what refuses it is the repeat and nothing else.
      for (let i = 0; i < 50; i++) p.manifest.chunks.push({ stage: 'f.tone', order: 500 + i, file: 'tone.frag.glsl' });
    }), /spliced into "f\.tone" twice/],
    ['a manifest asking for more assembled text than it carries', 'probe', bent((p) => {
      // Sixty distinct files of three kilobytes on two stages each: 62 files and about 180KB
      // carried, both inside the bounds above, and about 360KB spliced, which is outside the
      // one that counts what a driver compiles.
      for (let i = 0; i < 60; i++) {
        p.chunks[`pad${i}.frag.glsl`] = `// ${'x'.repeat(3000)}\n`;
        p.manifest.chunks.push({ stage: 'f.tone', order: 600 + i, file: `pad${i}.frag.glsl` });
        p.manifest.chunks.push({ stage: 'f.decl', order: 600 + i, file: `pad${i}.frag.glsl` });
      }
    }), /splices \d+ bytes of chunk text/],
    ['a binding checked against the program its own table does not name', 'probe', bent((p) => {
      p.manifest.params.hue.bind.on = 'grade';
    }), /assembled grade program declares no such uniform/],
    ['a package declaring one panel group key twice', 'probe', bent((p) => {
      p.manifest.panelGroups.push({ ...p.manifest.panelGroups[0], label: 'Probe again', order: 901 });
    }), /declares the panel group "probe" twice/],
    ['a bound finer than this build\'s own rounding can write', 'probe', bent((p) => {
      p.manifest.params.hue.min = 1e-101;
    }), /declares min as 1e-101, which needs 100 decimal places/],
    // **A binding aimed at an array, which passed the shape rule by being read without its
    // dimension.** `uniform float probeWeights[4]` came back as `probeWeights` declared
    // `float`, which is exactly what a plain binding asks for - and three.js takes its
    // uploader off the declaration, so the array setter is handed one number. The write
    // succeeds and the shader goes on reading whatever the array held.
    ['a parameter bound to an array uniform', 'probe', bent((p) => {
      p.chunks['decl.frag.glsl'] = 'uniform float probeAmount, probeHue;\nuniform float probeWeights[4];\n';
      p.manifest.params.weights = {
        def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe weights',
        panel: { group: 'probe', tab: 'look' },
        bind: { on: 'points', uniform: 'probeWeights' },
        under: 'amount',
      };
    }), /no array kind/],
    // **A package excusing itself from the rule that something has to write every uniform.**
    // `hostDriven` is the one exception to it, and while the door took any name at all the
    // exception was self-issued: nothing in this build writes `probeClock`, so the shader
    // reads zero for the life of the page with no control anywhere that could move it.
    ['a host-driven uniform this build\'s render loop does not write', 'probe', bent((p) => {
      p.chunks['decl.frag.glsl'] = 'uniform float probeAmount, probeHue, probeClock;\n';
      p.manifest.hostDriven = ['probeClock'];
    }), /this build's render loop writes "rainPhase"/],
    // **And the size of the manifest itself, which the three bounds above cannot see.** They
    // count chunk text; this package repeats a correct *parameter* rather than a correct
    // chunk. Two hundred of them is about 60KB of manifest arriving with the same two small
    // files of GLSL, inside every rule in this door and inside the four megabytes the server
    // takes as a body - and the store then writes it, hashes it on every read, and every open
    // page builds a control per parameter out of it.
    ['a manifest that is enormous and carries almost no GLSL', 'probe', bent((p) => {
      for (let i = 0; i < 200; i++) {
        p.manifest.params[`k${i}`] = {
          def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: `probe knob number ${i}`,
          panel: { group: 'probe', tab: 'look' },
          bind: { on: 'points', uniform: 'probeHue' },
          under: 'amount',
        };
      }
    }), /carries a manifest of \d+ bytes/],
    // **A `gates` the gate can never read, in both of the shapes that reach it.** `gates` is a
    // promise about the *uniform* rather than a flag on the parameter: `gradeNeeded` in
    // `web/main.js` walks the gating bindings, reads the cell each names and holds the grade
    // pass open while any is not zero. So the promise is about nothing unless the binding lands
    // a number on the table that walk reads.
    //
    // The first fixture binds on the point cloud, whose uniforms `gradeGatesOf` never collects,
    // so the author has said their term holds the pass open and the pass has never heard of it.
    // The second lands a `Vector2` - `axisDeg` writes a sine and a cosine, which is a direction
    // and never the zero vector - and it is the one whose *symptom moved under an unrelated
    // fix*: against `> 0` the pass stayed shut for the life of the page, and against the
    // `!== 0` that predicate is now, an object is never strictly equal to zero, so the pass
    // runs full-screen forever. Neither reading of the comparison is wrong, which is exactly
    // why the pair is refused at the door rather than given a meaning in the page.
    //
    // `scanAxis` because it is a `vec2` some installed program declares, which is what gets
    // this fixture past the uniform rule and down to the one it is named after; a package
    // binding a neighbour's uniform is legal here and most of what ships does it.
    ['a gating binding on a table the gate never reads', 'probe', bent((p) => {
      p.manifest.params.hue.bind.gates = true;
    }), /declares gates and binds on "points"/],
    ['a gating binding whose value is a direction rather than an amount', 'probe', bent((p) => {
      p.manifest.params.hue.bind = {
        on: 'grade', uniform: 'scanAxis', transform: 'axisDeg', gates: true,
      };
      p.chunks['decl.frag.glsl'] = 'uniform float probeAmount;\n';
    }), /declares gates beside the axisDeg transform/],
  ];

  let refusedCount = 0;
  // **Every fixture that answered with the wrong rule, and this used to keep only the first.**
  // The row makes one claim per hostile package - each is refused *by the rule it is named
  // after* - so a row that can report one violation of N is a row that cannot say which of its
  // claims failed. What that costs is not tidiness: a refusal added to the door can fire ahead
  // of several existing fixtures at once, and with only the first reported the loop is see one,
  // fix it, re-run, see the next. It happened here - a new bound on manifest size caught a
  // thousand-descriptor fixture before it reached the repeat rule it is named after - and
  // recovering the attribution cost a two-arm experiment that the list below would have
  // answered outright.
  const wrongReasons = [];
  let residue = null;
  for (const [what, id, body, matches] of hostile) {
    const answer = await put(id, body);
    if (answer.status === 409 && matches.test(answer.body.error ?? '')) refusedCount++;
    // Truncated per entry, because a door that accepted one of these answers with the whole
    // package it just stored - and one of the fixtures here carries sixty files, so an un-cut
    // detail line buries the row name that says which rule stopped firing under a wall of
    // revisions. Cut harder now that several can be printed at once, since the useful part of
    // a door's sentence is its opening clause and the row has to stay one line.
    else wrongReasons.push(`${what}: ${answer.status} ${(answer.body.error ?? JSON.stringify(answer.body)).slice(0, 120)}`);
    const held = userRootHolds();
    if (held.length !== 0) residue ??= `${what} left ${held.join(', ')}`;
  }
  // The count stays in the row's name rather than only in its detail, because it is what
  // separates a tool that has gone stale from a build that has broken: a run naming 22 rules
  // against a tree carrying 25 is a fixture list nobody updated, and that reading is available
  // before anybody looks at which of them failed.
  ok(`every hostile package is refused with the sentence for its own rule - ${hostile.length} rules`,
    refusedCount === hostile.length,
    wrongReasons.length
      ? `${wrongReasons.length} of ${hostile.length} answered with the wrong rule - ${wrongReasons.join(' | ')}`
      : `${refusedCount} of ${hostile.length}`);
  ok('and none of them reaches the filesystem: no package, no .tmp, no .old left behind',
    residue === null, residue ?? `user root ${userRootHolds().join(', ') || 'empty'}`);
  // **Swept after the row that measures it, so a caught mutation cannot become a crash five
  // sections away.** On a clean build there is nothing here and this is a no-op; on a build
  // whose door has stopped refusing something the finding is already recorded above, and what
  // is left is a package the sections below never asked for - section 3 opens a page and
  // reads how many parameters it has, so a hostile fixture still installed would redden rows
  // about a page that is behaving correctly given what it was handed. The same reasoning
  // section 11 states for writing its own fixtures rather than inheriting them.
  for (const held of userRootHolds()) rmSync(join(USER_ROOT, held), { recursive: true, force: true });

  const stillShipped = await getJson('/effects');
  ok('and the shipped set is exactly what it was before the door was pushed at',
    stillShipped.body.effects?.length === listed.body.effects.length,
    `${stillShipped.body.effects?.length ?? 'no'} packages`);

  const refuseBuiltin = await del('noise');
  ok('a builtin nothing is forking refuses to be removed, by name',
    refuseBuiltin.status === 409 && /shipped with this build/.test(refuseBuiltin.body.error ?? ''),
    `${refuseBuiltin.status}: ${(refuseBuiltin.body.error ?? '').slice(0, 60)}`);

  // ================================================== 3. a page adopts an install
  console.log('\n[effect] 3. a page that is already up, adopting an install');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const pageErrors = [];
  // **Whether a package read is being failed on purpose right now.** One arm in section 9
  // plants a transport failure on `/effects/probe` to stage a read error rather than a
  // refusal, and the browser logs a failed request as a console error whatever the page then
  // does with it - which is the whole subject of that arm, so it must not also be a fault
  // reported by the row that asks whether the page complained about anything. Declared as a
  // window the arm opens and closes rather than as a rule widened for the run, so every
  // failed request outside it still counts.
  let failingPackageRead = false;
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location()?.url ?? '';
    if (failingPackageRead && /\/effects\//.test(where)) return;
    // **A package read that 404s while this tool is removing packages is the store
    // changing under a reader, which is a thing this build handles rather than a fault.**
    // `fetchEffectPackages` lists the store and then reads each id, and a `DELETE` landing
    // between those two answers 404 for an id the list had just named - which the read
    // refuses, the coherence check catches, and the next tick asks about again. The browser
    // logs every failed request as a console error whatever the page then does with it, and
    // this tool installs and removes packages several dozen times in a run where a person
    // would do it a handful of times a year. So exactly that shape is not collected, by
    // address rather than by message, and everything else still is.
    if (/\/effects\//.test(where) && /status of 404/.test(m.text())) return;
    pageErrors.push(where ? `${m.text()} (${where})` : m.text());
  });
  await page.goto(`${BASE}/record`, { waitUntil: 'load' });
  await page.waitForFunction('Boolean(globalThis.__kinect)', null, { timeout: 20000 });

  const before = await page.evaluate(() => ({
    params: globalThis.__kinect.params.names().length,
    groups: document.querySelectorAll('#panelBody > [data-group]').length,
    probeRows: document.querySelectorAll('[data-group="probe"] .row').length,
  }));
  ok('the page is up with no probe on it, so what happens below is the install rather than the page',
    before.probeRows === 0 && before.params > 0, `${before.params} parameters, ${before.groups} generated groups`);

  const installed = await put('probe', probePackage());
  ok('the package installs while that page is open', installed.status === 200,
    `${installed.status}: ${installed.body.error ?? 'installed'}`);

  const adopted = await page.evaluate(async () => {
    try {
      await globalThis.__kinect.effects.reload();
    } catch (err) {
      return { threw: String(err.message) };
    }
    const k = globalThis.__kinect;
    return {
      params: k.params.names().length,
      groups: document.querySelectorAll('#panelBody > [data-group]').length,
      probeRows: document.querySelectorAll('[data-group="probe"] .row').length,
      probeRowsHidden: [...document.querySelectorAll('[data-group="probe"] .row')]
        .filter((row) => row.hidden).length,
      probeRackEmpty: document.querySelector('[data-group="probe"]')?.classList.contains('rackempty') ?? null,
      groupLabel: document.querySelector('[data-group="probe"] .grouphead label')?.textContent ?? null,
      knows: k.params.names().includes('probe.amount') && k.params.names().includes('probe.hue'),
      cell: Object.hasOwn(k.uniforms, 'probeAmount') && Object.hasOwn(k.uniforms, 'probeHue'),
      inShader: k.effects.programs().cloud.fragmentShader.includes('probeHue'),
      appended: k.params.names('look').slice(-2),
    };
  });
  ok('the rebuild ran through the product\'s own path', !adopted.threw, adopted.threw ?? 'no throw');
  ok('the registry grew exactly the package\'s two parameters',
    adopted.params === before.params + 2 && adopted.knows, `${before.params} -> ${adopted.params}`);
  ok('and they are at the end of the look order, which is where the placement rule puts a package nothing has a layout for',
    JSON.stringify(adopted.appended) === JSON.stringify(['probe.amount', 'probe.hue']), JSON.stringify(adopted.appended));
  ok('the panel grew the package\'s own group and rows, but keeps a newly installed idle effect out of the sidebar',
    adopted.groups === before.groups + 1 && adopted.probeRows === 2
      && adopted.probeRowsHidden === adopted.probeRows && adopted.probeRackEmpty === true,
    `${adopted.groups} groups, ${adopted.probeRowsHidden} of ${adopted.probeRows} probe rows hidden, `
    + `rack empty=${adopted.probeRackEmpty}, heading ${JSON.stringify(adopted.groupLabel)}`);
  ok('the uniform cells its bindings need were minted, because no hand-written table holds them',
    adopted.cell === true, `probeAmount and probeHue ${adopted.cell ? 'present' : 'missing'}`);
  ok('and the assembled program carries its chunk text', adopted.inShader === true);

  await page.locator('.paneltab[data-panel-tab="look"]').click();
  await page.locator('#effectRackOpen').click();
  await page.locator('[data-effect-add="probe"]').click();
  const racked = await page.evaluate(() => {
    const row = document.getElementById('probe.amount')?.closest('.row, .checkrow');
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem('kinect.rackedEffects') ?? '[]'); } catch {}
    return { hidden: row?.hidden ?? null, stored, focused: document.activeElement?.id ?? null };
  });
  ok('and Add makes that hot-loaded effect available without a reload or a value change',
    racked.hidden === false && racked.stored.includes('probe'),
    `hidden=${racked.hidden}, stored=${JSON.stringify(racked.stored)}, focused=${JSON.stringify(racked.focused)}`);
  await page.locator('#effectRackOpen').click();
  await page.locator('[data-effect-remove="probe"]').click();
  await page.locator('#effectRackClose').click();
  await page.locator('.paneltab[data-panel-tab="record"]').click();

  // ---- and now boot-check's own question, on the page that has just been rebuilt
  //
  // **This is the row an install is most likely to break silently.** A rebuild that
  // replaced the registry and repainted nothing draws a completely normal panel showing
  // the values from before the install, and no picture anywhere is wrong. The three rows
  // below are `boot-check`'s three, asked of a page that got here by hotload rather than
  // by boot - the same question, the other door.
  const diff = await page.evaluate(() => {
    const k = globalThis.__kinect;
    const rows = [];
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el) continue;
      const registry = k.params.get(name);
      const control = el.type === 'checkbox' ? el.checked : Number(el.value);
      rows.push({ name, registry, control, agrees: String(registry) === String(control) });
    }
    return rows;
  });
  const diverge = diff.filter((r) => !r.agrees);
  ok('every control on the rebuilt page shows the value the registry holds for it',
    diff.length > 0 && diverge.length === 0,
    diverge.length
      ? `${diverge.length} of ${diff.length} diverge: ${diverge.slice(0, 5).map((r) => `${r.name} registry ${r.registry} vs control ${r.control}`).join('; ')}`
      : `${diff.length} of ${diff.length} agree`);

  // The comparison's own falsification, in run rather than by mutation: a diff whose two
  // sides could not disagree would pass on any build at all.
  const drive = await page.evaluate(() => {
    const k = globalThis.__kinect;
    let moved = 0;
    let followed = 0;
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el) continue;
      const want = el.type === 'checkbox'
        ? !k.params.get(name)
        : (String(k.params.get(name)) === el.min ? Number(el.max) : Number(el.min));
      k.params.set(name, want);
      moved++;
      const shown = el.type === 'checkbox' ? el.checked : Number(el.value);
      if (String(shown) === String(k.params.get(name))) followed++;
    }
    return { moved, followed };
  });
  ok('and the comparison can separate two states: a write through the registry moves the control it belongs to',
    drive.moved === diff.length && drive.followed === drive.moved,
    `${drive.followed} of ${drive.moved} followed`);

  // ============================================ 4. uninstall parks, reinstall restores
  console.log('\n[effect] 4. an uninstall parks the edit, and a reinstall gives it back');

  const buffer = pinnedBuffer();
  await page.route('**/__effect-pinned.bin', (route) => route.fulfill({
    status: 200, contentType: 'application/octet-stream', body: buffer,
  }));
  await page.evaluate(async () => {
    const res = await fetch('/__effect-pinned.bin');
    globalThis.__kinect.drive.pin(await res.arrayBuffer());
  });

  const authored = await page.evaluate(async (positions) => {
    const k = globalThis.__kinect;
    // Back to a known look first: the sweep above left every control at a bound.
    k.params.reset();
    k.params.set('probe.amount', 0.7);
    k.params.set('probe.hue', 0.3);
    k.keyframes.setTracks({ 'probe.amount': [{ t: 0, value: 0.15 }, { t: 1.4, value: 0.95 }] });
    const sha256 = async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    k.drive.reset();
    const hashes = [];
    for (const t of positions) {
      k.drive.stepTo(t);
      hashes.push(await sha256(k.drive.readPixels()));
    }
    return { hashes, track: k.keyframes.valueAt('probe.amount', 0.7), hue: k.params.get('probe.hue') };
  }, POSITIONS);
  ok('an edit is authored on the installed effect: two values and a track with keys',
    authored.hue === 0.3 && authored.track !== null,
    `hue ${authored.hue}, the track reads ${authored.track?.toFixed?.(3) ?? authored.track} at 0.7s`);
  ok('and the three program positions render three different images, so the identity below is about something',
    new Set(authored.hashes).size === POSITIONS.length,
    authored.hashes.map((h) => h.slice(0, 8)).join(' '));

  const removed = await del('probe');
  ok('the package is removed', removed.status === 200 && removed.body.removed === 'probe',
    `${removed.status}: ${removed.body.error ?? 'removed'}`);

  const parked = await page.evaluate(async () => {
    try {
      await globalThis.__kinect.effects.reload();
    } catch (err) {
      return { threw: String(err.message) };
    }
    const k = globalThis.__kinect;
    const badge = document.getElementById('tMissing');
    return {
      knows: k.params.names().includes('probe.amount'),
      groups: document.querySelectorAll('[data-group="probe"]').length,
      pool: k.library.parkedLook(),
      missing: k.library.missingEffects(),
      badgeHidden: badge?.hidden ?? null,
      badgeText: badge?.textContent ?? '',
    };
  });
  ok('the rebuild after the removal ran', !parked.threw, parked.threw ?? 'no throw');
  ok('the registry and the panel no longer carry the effect',
    parked.knows === false && parked.groups === 0, `${parked.groups} probe groups`);
  ok('its values and its track are parked rather than dropped',
    Object.keys(parked.pool?.params ?? {}).length === 2
      && Object.keys(parked.pool?.tracks ?? {}).length === 1,
    `${Object.keys(parked.pool?.params ?? {}).length} values, ${Object.keys(parked.pool?.tracks ?? {}).length} tracks: `
    + `${JSON.stringify(parked.pool?.params)}`);
  ok('and the badge says so, quoting the version the edit was authored against',
    parked.badgeHidden === false && /probe/.test(parked.badgeText) && /1\.0\.0/.test(parked.badgeText),
    `hidden=${parked.badgeHidden}, "${parked.badgeText.trim().slice(0, 70)}"`);
  ok('and the pool\'s counts are what the badge is drawn from',
    parked.missing?.length === 1 && parked.missing[0].values === 2 && parked.missing[0].tracks === 1,
    JSON.stringify(parked.missing));

  const reinstalled = await put('probe', probePackage());
  ok('the package is installed again', reinstalled.status === 200,
    `${reinstalled.status}: ${reinstalled.body.error ?? 'installed'}`);

  const restoredRun = await page.evaluate(async (positions) => {
    try {
      await globalThis.__kinect.effects.reload();
    } catch (err) {
      return { threw: String(err.message) };
    }
    const k = globalThis.__kinect;
    const sha256 = async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    k.drive.reset();
    const hashes = [];
    for (const t of positions) {
      k.drive.stepTo(t);
      hashes.push(await sha256(k.drive.readPixels()));
    }
    const badge = document.getElementById('tMissing');
    return {
      hashes,
      pool: k.library.parkedLook(),
      hue: k.params.get('probe.hue'),
      track: k.keyframes.valueAt('probe.amount', 0.7),
      badgeHidden: badge?.hidden ?? null,
    };
  }, POSITIONS);
  ok('the rebuild after the reinstall ran', !restoredRun.threw, restoredRun.threw ?? 'no throw');
  ok('the parked pool is empty again, so nothing was left behind by the effect coming back',
    Object.keys(restoredRun.pool?.params ?? {}).length === 0
      && Object.keys(restoredRun.pool?.tracks ?? {}).length === 0,
    JSON.stringify(restoredRun.pool?.params ?? {}));
  ok('the values and the track came back through the registry\'s own door',
    restoredRun.hue === 0.3 && Math.abs((restoredRun.track ?? 0) - (authored.track ?? -1)) < 1e-9,
    `hue ${restoredRun.hue}, the track reads ${restoredRun.track?.toFixed?.(6)} against ${authored.track?.toFixed?.(6)}`);
  ok('and the three positions render the same three images they rendered before the uninstall',
    JSON.stringify(restoredRun.hashes) === JSON.stringify(authored.hashes),
    restoredRun.hashes.map((h, i) => `${h.slice(0, 8)}${h === authored.hashes[i] ? '=' : '!='}${authored.hashes[i].slice(0, 8)}`).join(' '));

  // ==================================================== 5. and nothing missing, no badge
  console.log('\n[effect] 5. a document with everything it needs says nothing');

  const quiet = await page.evaluate(() => {
    const k = globalThis.__kinect;
    const badge = document.getElementById('tMissing');
    return {
      missing: k.library.missingEffects(),
      hidden: badge?.hidden ?? null,
      entries: document.querySelectorAll('#tMissing .missingfx').length,
    };
  });
  ok('with every effect the document names installed, the badge is not on screen',
    quiet.hidden === true && quiet.missing.length === 0 && quiet.entries === 0,
    `hidden=${quiet.hidden}, ${quiet.missing.length} missing, ${quiet.entries} entries drawn`);

  // ================= 6. an install the open document cannot be carried onto, and the way back
  //
  // **The install that succeeds on the server and cannot be adopted by this page.** Every
  // section above is about a rebuild that works; this one is about the one that does not,
  // and the claim is that the page is left whole rather than half-migrated. A fork adding a
  // parameter is the shape that produces it - the open document then names a subset of the
  // new manifest, and the loader's per-effect completeness rule refuses it, correctly and by
  // design. What must not happen is the page keeping the registry it just swapped in while
  // its parked pool still describes the build before last: those two disagreeing about which
  // names are live is a page no document can be saved from, and the serialiser reading a
  // stale parked copy over a value the registry is rendering is how that costs somebody
  // their work rather than their frame.
  //
  // **Driven through the poll rather than through `reload`**, because the note is one of the
  // things being asserted and the poll is the only thing in the product that writes it. The
  // rows below are the five separate facts a rollback has to leave true - the server did
  // adopt the install, the page said so by name, the registry is the one it had, the pixels
  // are the ones it drew, and a save still returns every parked key's own value - and they are
  // separate rows because a build can get any four of them right.
  console.log('\n[effect] 6. an install this page cannot carry the open document onto');

  // The reading taken on both sides of the install, as one function handed to the page
  // twice, so the before and the after cannot drift into being two different questions.
  const readPage = async (positions) => {
    const k = globalThis.__kinect;
    const sha256 = async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    k.drive.reset();
    const hashes = [];
    for (const t of positions) {
      k.drive.stepTo(t);
      hashes.push(await sha256(k.drive.readPixels()));
    }
    const badge = document.getElementById('tMissing');
    const note = document.getElementById('tNote');
    return {
      hashes,
      names: k.params.names(),
      signature: k.effects.signature(),
      pool: k.library.parkedLook(),
      body: k.library.serialiseProjectBody(),
      badgeHidden: badge?.hidden ?? null,
      badgeText: badge?.textContent ?? '',
      note: note?.textContent ?? '',
    };
  };

  /** Everything a document says about the parked effect, as one comparable string. */
  const parkedKeysOf = (body) => JSON.stringify({
    params: Object.fromEntries(Object.entries(body.look.params).filter(([n]) => n.startsWith('probe.'))),
    tracks: Object.fromEntries(Object.entries(body.look.tracks).filter(([n]) => n.startsWith('probe.'))),
    requires: (body.requires ?? []).filter((e) => e.id === 'probe'),
  });

  // Caught in the page rather than allowed out, which is sections 3 and 4's shape and is
  // load-bearing here for the same reason: a mutation that breaks the rebuild takes this
  // driver down with it, and a run that stops on the way into this section stops before
  // section 7 runs at all. `reinstall-leaves-it-parked` is the one that does it - it leaves
  // a document the loader will not take in either direction, so the rollback's own refusal
  // fires - and it should redden a row here and carry on, not end the run.
  await del('probe');
  const reParked = await page.evaluate(async () => {
    try {
      await globalThis.__kinect.effects.reload();
      return { threw: null };
    } catch (err) {
      return { threw: String(err.message) };
    }
  });
  ok('the effect comes off again and the page rebuilds without it', reParked.threw === null,
    reParked.threw ?? 'no throw');
  const beforeFork = await page.evaluate(readPage, POSITIONS);

  ok('the effect is uninstalled again, so the document is holding it parked when the install below lands',
    beforeFork.names.includes('probe.amount') === false
      && Object.keys(beforeFork.pool.params).length === 2
      && Object.keys(beforeFork.pool.tracks).length === 1
      && beforeFork.badgeHidden === false,
    `${Object.keys(beforeFork.pool.params).length} values and ${Object.keys(beforeFork.pool.tracks).length} tracks parked, `
    + `badge hidden=${beforeFork.badgeHidden}`);
  // **The control for the identity row below, and it is a cross-state one rather than the
  // three-distinct-images row section 4 uses.** With the effect parked there is nothing
  // keyed left to separate the three positions from each other: the pinned run is six
  // frames at 33ms, so 0.6s and 1.2s both show the last of them and hash the same, and
  // section 4's three images differed because `probe.amount` was ramping across them. What
  // has to be shown here is that these hashes are a live reading of the look rather than a
  // constant, so they are held against the same three positions taken while the effect was
  // installed and raised - which is the state the rollback must *not* have left the page in.
  ok('and the parked picture is not the picture the installed effect drew, so these hashes read the look rather than the frame',
    JSON.stringify(beforeFork.hashes) !== JSON.stringify(authored.hashes),
    `${beforeFork.hashes.map((h) => h.slice(0, 8)).join(' ')} against ${authored.hashes.map((h) => h.slice(0, 8)).join(' ')}`);

  const fork = await put('probe', forkedProbe());
  const forkServed = await getJson('/effects/probe');
  ok('the fork installs: the server takes a package that is this effect with one parameter more',
    fork.status === 200 && forkServed.status === 200 && forkServed.body.manifest?.version === '2.0.0',
    `${fork.status}: ${fork.body.error ?? 'installed'}, the store now serves version ${forkServed.body.manifest?.version}`);

  // **Driven by the poll and then waited for, because the poll on the page competes with
  // the poll this line calls.** `pollNow` is the interval's own body and the interval is
  // still running, so a tick that started six seconds ago can be mid-read when this line
  // arrives - and the reentrancy guard, correctly, sends this call straight back. What has
  // to be true either way is that the page ends up reporting the refusal, so that is what
  // is waited for rather than assumed to have happened by the time `pollNow` resolves.
  // A build that never reports still fails, one interval later.
  await page.evaluate(() => globalThis.__kinect.effects.pollNow());
  await page.waitForFunction(
    "document.getElementById('tNote')?.textContent?.length > 0", null, { timeout: 20000 },
  ).catch(() => {});
  const afterFork = await page.evaluate(readPage, POSITIONS);

  ok('the page reports the refusal by name, and says which set it is still running',
    /probe\.glow/.test(afterFork.note) && /still running the effects it had/.test(afterFork.note),
    `"${afterFork.note.trim().slice(0, 120)}"`);
  ok('and the registry is the one this page had rather than the one the server is serving',
    JSON.stringify(afterFork.names) === JSON.stringify(beforeFork.names),
    afterFork.names.includes('probe.glow')
      ? 'probe.glow reached the registry, so the swap was kept'
      : `${afterFork.names.length} parameters, the same ${beforeFork.names.length} as before the install`);
  ok('and the signature with it, so nothing is left claiming to be assembled from a set it refused',
    afterFork.signature === beforeFork.signature,
    afterFork.signature === beforeFork.signature ? 'unchanged' : 'the page moved to the new set');
  // **And the fork is still installed, which is the one thing in this rollback that is about
  // the store rather than about this page.** Section 9 has the page ask the store to set a
  // package aside when a program will not link, and this is the refusal that must never reach
  // that route: what failed here is the completeness rule, which is a fact about the pairing
  // of *this document* with that manifest and says nothing whatever about the package. A
  // build that quarantined on it would rename somebody's authored fork out of the way because
  // one clip on one machine could not be carried onto it - and the operator's next move,
  // opening a document that does not name `probe.glow`, would have worked. The mark on the
  // throw is what separates the two and `any-failure-is-quarantined` is the mutation that
  // takes it away.
  const forkStanding = await getJson('/effects/probe');
  ok('and the fork is still installed, because a page that could not carry its document across has said nothing about the package',
    forkStanding.status === 200 && forkStanding.body.builtin === false
      && !userRootHolds().some((name) => /^probe\..+\.incompatible$/.test(name)),
    `GET /effects/probe answered ${forkStanding.status}, user root holds ${userRootHolds().join(', ') || 'nothing'}`);
  ok('the parked pool is exactly what it was: the same values, the same track, the same entry',
    JSON.stringify(afterFork.pool) === JSON.stringify(beforeFork.pool),
    `${Object.keys(afterFork.pool.params).length} values, ${Object.keys(afterFork.pool.tracks).length} tracks`);
  ok('and the badge still quotes the version the edit was authored against rather than the one that just landed',
    afterFork.badgeHidden === false && /probe 1\.0\.0/.test(afterFork.badgeText),
    `hidden=${afterFork.badgeHidden}, "${afterFork.badgeText.trim().slice(0, 60)}"`);
  ok('the three positions render the same three images they rendered before the install',
    JSON.stringify(afterFork.hashes) === JSON.stringify(beforeFork.hashes),
    afterFork.hashes.map((h, i) => `${h.slice(0, 8)}${h === beforeFork.hashes[i] ? '=' : '!='}${beforeFork.hashes[i].slice(0, 8)}`).join(' '));
  ok('and a save afterwards writes the parked keys exactly as it wrote them before',
    parkedKeysOf(afterFork.body) === parkedKeysOf(beforeFork.body) && /probe\.amount/.test(parkedKeysOf(beforeFork.body)),
    parkedKeysOf(afterFork.body).slice(0, 110));

  // The document the rolled-back page writes, handed back to the loader that refused the
  // other one. A page whose pool and registry had gone out of step would write a document
  // its own reader refuses - `refuseRequires` runs in both directions - so this asks the
  // rollback for the property that actually matters rather than for the fields it left in
  // place.
  const reloadable = await page.evaluate(() => {
    const k = globalThis.__kinect;
    try {
      k.library.restoreProject(k.library.serialiseProjectBody());
      return { threw: null };
    } catch (err) {
      return { threw: String(err.message) };
    }
  });
  ok('and the document it writes is one this same page will take back', reloadable.threw === null,
    reloadable.threw ?? 'loaded');

  // The fork off again, so the store and the page hold the same set before section 7 - and
  // the row is worth having rather than being cleanup with an assertion stuck on it: the
  // signature is how the poll decides there is anything to do, and a page that had quietly
  // moved to the new set would converge here for the wrong reason.
  await del('probe');
  const converged = await page.evaluate(async () => {
    await globalThis.__kinect.effects.pollNow();
    return { signature: globalThis.__kinect.effects.signature() };
  });
  const storeNow = await getJson('/effects');
  const storeSignature = storeNow.body.effects.map((e) => `${e.id} ${e.rev}`).join('\n');
  ok('and with the fork taken back off, the page and the store are holding one set again',
    converged.signature === storeSignature, converged.signature === storeSignature ? 'agreed' : 'still apart');

  // ================================= 7. what a rebuild does to the rest of the panel
  //
  // **Everything on the panel that is not a parameter row, which is where a rebuild goes
  // wrong invisibly.** Sections 3 and 4 ask whether the parameters arrived and whether
  // their values are right, and a build can get both of those completely right while the
  // buttons beside them are dead, the tab that was showing has stopped being applied, the
  // collapse headers are painted for elements that no longer exist and the dialog that
  // picks a preset's subset is a statement of the registry from before the install. None
  // of those throws, none of them changes a pixel of the cloud, and each has its own
  // mutation below because each is a separate way of rebuilding the panel and forgetting
  // something.
  console.log('\n[effect] 7. the panel a rebuild leaves behind, beside the rows it rebuilt');

  // The state to be preserved is set up *before* the install, so what the rows below read
  // is a page that had been used rather than a page that had just booted - which is the
  // only state in which any of this is observable at all.
  const primed = await page.evaluate(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    // A stamp on the note the framing group emits, which is the sharpest reading of the
    // claim: the question is whether the element in the document after the rebuild is the
    // element `ui` is holding, and an attribute nothing else writes answers it directly.
    // The text beside it is the status line boot wrote through `ui.recRange` - a rebuilt
    // node carries the bare default the generator gives it and not this.
    const note = document.getElementById('recRange');
    note.dataset.effectCheckWitness = 'before-the-install';
    // A group the panel has painted shut, so `groupPainted` holds a state string for it
    // and the rebuild has something to get wrong. `post` because it is a core group that
    // survives every install below. The reset above puts every value at its default, which
    // is what derives a group closed, so the toggle is pressed only where the panel is
    // already showing it open - a click either way would otherwise be the gesture that
    // decides the state rather than the state itself.
    const post = document.querySelector('[data-group="post"]');
    if (!post.classList.contains('shut')) document.querySelector('[data-group-toggle="post"]').click();
    return {
      shown: k.cropBoxShown(),
      note: note.textContent,
      postShut: post.classList.contains('shut'),
      postExpanded: post.querySelector('.grouptoggle').getAttribute('aria-expanded'),
      lookNames: k.params.names('look').length,
      boxes: document.querySelectorAll('#ppGroups input[id^="pp-"]').length,
    };
  });
  ok('the page is in a state a rebuild can damage: a group shut by hand, a note carrying a status write, a stamp on it',
    primed.postShut === true && primed.postExpanded === 'false' && /capture keeps/.test(primed.note),
    `post shut=${primed.postShut} aria-expanded=${primed.postExpanded}, note ${JSON.stringify(primed.note.slice(0, 40))}`);

  await put('probe', probePackage());
  const rebuilt = await page.evaluate(async () => {
    await globalThis.__kinect.effects.reload();
    const k = globalThis.__kinect;
    // The control pressed rather than inspected. `show crop box` is one of the six the
    // framing group emits, and what it has to do is flip the flag the chrome draws from -
    // a listener on a detached node leaves the flag exactly where it was.
    const before = k.cropBoxShown();
    document.getElementById('cropBox').click();
    const after = k.cropBoxShown();
    const note = document.getElementById('recRange');
    const post = document.querySelector('[data-group="post"]');
    // The tab read off the button that says it is selected rather than off a reading the
    // page publishes for the purpose, which is `editor-check`'s own reading of the same
    // question: what a person can see is the panel, and the panel is what this asks.
    const active = document.querySelector('.paneltab[aria-selected="true"]')?.dataset.panelTab ?? null;
    const visible = [...document.querySelectorAll('#panelBody > [data-panel-tab]')]
      .filter((g) => !g.hidden);
    return {
      pressed: before !== after,
      pressedShows: after,
      aria: document.getElementById('cropBox').getAttribute('aria-pressed'),
      witness: note?.dataset.effectCheckWitness ?? null,
      noteText: note?.textContent ?? '',
      active,
      visibleTabs: [...new Set(visible.map((g) => g.dataset.panelTab))],
      offTab: visible.filter((g) => g.dataset.panelTab !== active)
        .map((g) => g.dataset.group || g.id),
      probeGroupHidden: document.querySelector('[data-group="probe"]')?.hidden ?? null,
      postShut: post.classList.contains('shut'),
      postExpanded: post.querySelector('.grouptoggle').getAttribute('aria-expanded'),
      boxes: [...document.querySelectorAll('#ppGroups input[type="checkbox"]')].map((b) => b.id),
      lookNames: k.params.names('look'),
    };
  });

  ok('a hand-written control inside a rebuilt group still works: pressing show crop box moves what the chrome draws from',
    rebuilt.pressed === true && rebuilt.aria === String(rebuilt.pressedShows),
    `the flag ${rebuilt.pressed ? 'moved' : 'did not move'}, the button reads aria-pressed=${rebuilt.aria}`);
  ok('and the node the page writes its status into is the node in the document, carrying what was written before the install',
    rebuilt.witness === 'before-the-install' && rebuilt.noteText === primed.note,
    `witness ${JSON.stringify(rebuilt.witness)}, note ${JSON.stringify(rebuilt.noteText.slice(0, 40))}`);

  ok('the tab that was showing is still the only one showing, over groups the rebuild has just made',
    rebuilt.offTab.length === 0 && rebuilt.probeGroupHidden === true,
    rebuilt.offTab.length
      ? `${rebuilt.offTab.length} groups from another tab are on screen: ${rebuilt.offTab.slice(0, 6).join(', ')}`
      : `${rebuilt.visibleTabs.join(', ')} showing under the ${rebuilt.active} tab, the probe's look group hidden`);

  ok('a group shut before the install is still shut after it, in the class the panel draws from and the attribute a reader hears',
    rebuilt.postShut === true && rebuilt.postExpanded === 'false',
    `shut=${rebuilt.postShut}, aria-expanded=${rebuilt.postExpanded}`);

  const pickedNames = rebuilt.boxes.filter((id) => id.startsWith('pp-')).map((id) => id.slice(3));
  ok('the preset subset dialog is a statement of the registry that exists now: the installed effect has its boxes',
    pickedNames.includes('probe.amount') && pickedNames.includes('probe.hue')
      && JSON.stringify([...pickedNames].sort()) === JSON.stringify([...rebuilt.lookNames].sort()),
    `${pickedNames.length} boxes against ${rebuilt.lookNames.length} look values, `
    + `probe ${pickedNames.filter((n) => n.startsWith('probe.')).join(' and ') || 'absent'}`);

  await del('probe');
  const unpicked = await page.evaluate(async () => {
    await globalThis.__kinect.effects.reload();
    const k = globalThis.__kinect;
    const boxes = [...document.querySelectorAll('#ppGroups input[type="checkbox"]')];
    // Every remaining box actually pressed, because the failure this closes is a handler
    // reading `PARAMS` for a name the registry no longer has - which is a throw out of a
    // tick rather than a box that looks wrong.
    let threw = null;
    for (const box of boxes) {
      try {
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change'));
      } catch (err) { threw ??= `${box.id}: ${err.message}`; }
    }
    return {
      names: boxes.filter((b) => b.id.startsWith('pp-')).map((b) => b.id.slice(3)),
      threw,
      count: document.getElementById('ppCount')?.textContent ?? '',
      lookNames: k.params.names('look'),
    };
  });
  ok('and the uninstalled effect has none, with every box left in the dialog still pressable',
    unpicked.names.includes('probe.amount') === false && unpicked.threw === null
      && JSON.stringify([...unpicked.names].sort()) === JSON.stringify([...unpicked.lookNames].sort()),
    unpicked.threw ?? `${unpicked.names.length} boxes against ${unpicked.lookNames.length} look values, readout "${unpicked.count}"`);

  // ============================ 8. what a rebuild costs, and what it must not interrupt
  //
  // **Four claims that are each about the rebuild rather than about its result.** The
  // grade pass is switched on by a list derived from the packages, so a set that arrives
  // later has to move it; a package that changed no GLSL must not pay for a warm, because
  // the warm ends by clearing the accumulators a page mid-playback is holding; a package
  // that did change GLSL must let go of the program it replaced, because three.js will not;
  // and a rebuild must ask whether it may land at the moment it would land rather than at
  // the moment it started reading.
  console.log('\n[effect] 8. the grade gate, the warm that must not happen, the program that must be let go, and the gesture that stands a rebuild down');

  const gradeInstall = await put('probegrade', gradeProbePackage());
  ok('a grade effect installs - one this build did not boot with, binding its own gating uniform',
    gradeInstall.status === 200, `${gradeInstall.status}: ${gradeInstall.body.error ?? 'installed'}`);

  const gated = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    await k.effects.reload();
    const atDefault = k.grade.enabled;
    k.params.set('probegrade.amount', 0.6);
    const raised = k.grade.enabled;
    return { atDefault, raised, value: k.grade.uniforms.probeGradeAmount?.value ?? null };
  });
  ok('the pass is shut with the new effect at its default, which is what a master being inert at zero means',
    gated.atDefault === false, `grade.enabled=${gated.atDefault}`);
  ok('and raising the installed effect opens it, so a package that arrived after boot is counted by existing',
    gated.raised === true && gated.value === 0.6,
    `grade.enabled=${gated.raised} with the uniform at ${gated.value}`);

  await del('probegrade');
  const ungated = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    await k.effects.reload();
    return { enabled: k.grade.enabled, value: k.grade.uniforms.probeGradeAmount?.value ?? null };
  });
  // The other direction, and it is a correctness row rather than a discriminating one:
  // five gated effects ship, a builtin cannot be uninstalled, and every one of them is
  // written by the value walk - so the walk's own re-ask already answers this on this
  // build. What it is here for is the state that has no gated parameter left at all,
  // which no mutation of this tree can reach and which the line in `adoptEffectPackages`
  // is what covers.
  //
  // **The second half of this row used to read `probeGradeAmount still 0.6` and that was the
  // defect, asserted.** Nothing writes a uniform except the parameter bound to it, so a
  // package coming off left its term standing at whatever the slider had last put there - and
  // this row said so approvingly, because the claim it carries is about the *gate* and the
  // cell was only ever incidental detail beside it. It is a live reading now: the uninstall
  // is the plainest case of a binding departing, and the pass being shut over a term still
  // holding 0.6 is one line of GLSL away from a grade nobody can switch off.
  ok('and taking it off shuts the pass again, on a uniform cell put back to the value it started at',
    ungated.enabled === false && ungated.value === 0,
    `grade.enabled=${ungated.enabled}, probeGradeAmount reads ${ungated.value}`);

  // ---- the warm, and the accumulators it clears
  //
  // **Read off `counters.resets`, which is the page's own count of how many times the
  // accumulators have been thrown away.** The obvious reading - how many frames the
  // rebuild rendered - is not deterministic here: `reloadEffects` awaits several dozen
  // requests, and the animation loop repaints during them, so a correct build shows a
  // handful of frames for reasons that have nothing to do with the warm. The reset counter
  // moves only where `resetAccumulators` runs, and on this path the only thing that runs
  // it is `warmPrograms`.
  await put('probe', probePackage());
  await page.evaluate(async () => { await globalThis.__kinect.effects.reload(); });

  await put('probe', retunedProbe());
  const quietReload = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = k.timeline.counters.resets;
    await k.effects.reload();
    return {
      resets: k.timeline.counters.resets - before,
      // Read off the row the panel drew rather than off the registry, because
      // `params.spec` answers with a projection that carries the bounds and not the words.
      // The label on screen is the thing the retune is about anyway.
      label: document.getElementById('probe.hue')?.closest('.row')?.querySelector('span')?.textContent ?? null,
      knows: k.params.names().includes('probe.hue'),
    };
  });
  ok('a package that changed only its manifest is adopted - the label the rebuild is about did move',
    quietReload.label === 'probe hue, retuned' && quietReload.knows,
    `the registry reads ${JSON.stringify(quietReload.label)}`);
  ok('and it threw no accumulator away doing it, because the assembled programs are the ones already compiled',
    quietReload.resets === 0,
    `${quietReload.resets} accumulator resets across a rebuild that changed no GLSL`);

  // The control, and it is the same reading taken across the case that *must* warm. A row
  // saying nothing happened, on its own, is satisfied by a build that had stopped
  // rebuilding at all.
  await put('probe', recompiledProbe(1));
  const loudReload = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = k.timeline.counters.resets;
    await k.effects.reload();
    return {
      resets: k.timeline.counters.resets - before,
      inShader: k.effects.programs().cloud.fragmentShader.includes('probeHue * 0.51'),
    };
  });
  ok('and a package that did change its GLSL does warm, which is what makes the row above a distinction rather than a build that stopped rebuilding',
    loudReload.resets === 1 && loudReload.inShader === true,
    `${loudReload.resets} resets, the new chunk text ${loudReload.inShader ? 'reached' : 'did not reach'} the assembled program`);

  // ---- the programs the swap replaces
  //
  // Counted off `renderer.info.programs`, which is the renderer's own cache and the only
  // reading here that is not this tool agreeing with itself. Three installs of three
  // distinct programs: three.js releases a program only from a material's `dispose` event,
  // so a build that swaps with `needsUpdate` alone holds one more program after every one
  // of them and a build that lets go holds what it started with.
  const beforeGrowth = await page.evaluate(() => {
    // Rendered first, so the count is taken after the driver has actually compiled what
    // the page is holding rather than before it has been asked for anything.
    globalThis.__kinect.drive.stepTo(0.4);
    return globalThis.__kinect.renderer.info.programs.length;
  });
  const growthCounts = [];
  for (let n = 2; n <= 4; n++) {
    await put('probe', recompiledProbe(n));
    growthCounts.push(await page.evaluate(async () => {
      const k = globalThis.__kinect;
      await k.effects.reload();
      k.drive.stepTo(0.4);
      return k.renderer.info.programs.length;
    }));
  }
  ok('three GLSL-changing installs do not grow the renderer\'s program cache, because the swap releases what it replaced',
    growthCounts.every((n) => n <= beforeGrowth),
    `${beforeGrowth} programs before, ${growthCounts.join(' then ')} after each of three installs`);

  // ---- a rebuild that must stand down where it stands
  //
  // **The gesture goes up while the rebuild is reading, which is the whole of what this
  // row is about.** A rebuild that only asked on its way in would pass a check that raised
  // the flag first; what has to be shown is that the answer is asked again after the last
  // fetch and before the first write. The package read is held open by the driver, the
  // preset dialog is opened in the page while it hangs, and then it is let go.
  //
  // The gesture is a preset subset rather than an export because this surface has no take
  // to export - and the three conditions are one predicate, `effectRebuildBlocked`, so the
  // arm that reaches it reaches all three. That is the reason a predicate exists rather
  // than three tests written out at two call sites.
  await put('probe', recompiledProbe(9));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/effects/probe', async (route) => {
    await held;
    await route.continue();
  });
  const deferred = page.evaluate(async () => {
    const k = globalThis.__kinect;
    const was = k.effects.signature();
    const answer = await k.effects.reload();
    return { answer, was, now: k.effects.signature(), names: k.params.names().length };
  });
  // Long enough for the reload to have reached the held request and not so long that a
  // slow machine reads as a finding: the assertion is on what the reload answers, and a
  // gesture that went up before the fetch started would be the poll's entry check firing
  // instead - which is why the flag is read back below.
  await wait(400);
  const gestureUp = await page.evaluate(() => {
    document.getElementById('tPresetSave').click();
    return globalThis.__kinect.library.presetGestureRunning();
  });
  release();
  const stoodDown = await deferred;
  await page.unroute('**/effects/probe');
  ok('a gesture opening while the rebuild was reading is a gesture the rebuild stands down for',
    gestureUp === true && stoodDown.answer === null && stoodDown.now === stoodDown.was,
    `the gesture was ${gestureUp ? 'up' : 'down'}, the rebuild answered ${JSON.stringify(stoodDown.answer)}, `
    + `the signature ${stoodDown.now === stoodDown.was ? 'did not move' : 'moved'}`);

  // **Waited for rather than counted in turns of the loop**, and the first spelling of this
  // was the latter: the cancel closes the dialog, the dialog's `close` event resolves the
  // picker's promise, and the flag comes down in a `finally` several hops after that - so a
  // `setTimeout(0)` read it on its way down about half the time. What is being asserted is
  // what happens once the gesture is genuinely over, so the gesture being over is a
  // precondition to wait for rather than a step to assume.
  await page.evaluate(() => { document.getElementById('ppCancel').click(); });
  const gestureDown = await page.waitForFunction(
    'globalThis.__kinect.library.presetGestureRunning() === false', null, { timeout: 10000 },
  ).then(() => true).catch(() => false);
  const storeAfterGesture = await getJson('/effects');
  const wantSignature = storeAfterGesture.body.effects.map((e) => `${e.id} ${e.rev}`).join('\n');
  // The same reason section 6 waits for its note: the interval on the page is still
  // running, so `pollNow` can be answered by its own reentrancy guard while the tick that
  // holds it does the work a moment later. What has to be true is that the page converges,
  // and a build that never does still fails an interval later.
  const resumedConverged = await page.evaluate(async () => { await globalThis.__kinect.effects.pollNow(); })
    .then(() => page.waitForFunction(
      (want) => globalThis.__kinect.effects.signature() === want, wantSignature, { timeout: 20000 },
    ))
    .then(() => true).catch(() => false);
  ok('and the same rebuild lands as soon as the gesture is over, so standing down deferred it rather than dropping it',
    gestureDown === true && resumedConverged === true,
    gestureDown ? (resumedConverged ? 'the page converged on the store' : 'the page never converged on the store')
      : 'the gesture never came down');

  // ---- what the poll does with an answer it cannot use
  //
  // **Three ways the converging read goes wrong that have nothing to do with the packages
  // being wrong**, and all three are silent. A body that is not a list of ids and revs used
  // to throw past every guard the poll had, once every six seconds for the life of the
  // page; two ticks overlapping let the older of two reads win and then agree with itself
  // forever; and a package set read across an install is one package from before it beside
  // another from after, spliced into a program that compiles and draws something nobody
  // wrote.
  console.log('    (and what the poll does with an answer it cannot use)');

  await page.route('**/effects', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ nope: 'this is not a store' }),
  }));
  const nonsense = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const was = { signature: k.effects.signature(), names: k.params.names().length };
    let threw = null;
    try { await k.effects.pollNow(); } catch (err) { threw = String(err.message); }
    return { threw, was, signature: k.effects.signature(), names: k.params.names().length };
  });
  await page.unroute('**/effects');
  ok('a 200 carrying a body this build cannot read is a tick that does nothing rather than a rejection every six seconds',
    nonsense.threw === null && nonsense.signature === nonsense.was.signature
      && nonsense.names === nonsense.was.names,
    nonsense.threw ? `the poll threw: ${nonsense.threw.slice(0, 90)}` : `the page kept its ${nonsense.names} parameters and its signature`);

  // Two ticks at once, with the list held open so the second arrives while the first is
  // still reading. The count is taken in the driver rather than in the page, because what
  // is being asked is how many times the store was read.
  //
  // **The read that is in flight is waited for rather than started**, and that is the
  // difference between this row and the one that failed on a third run in three. The
  // interval on the page is still going, so a call to `pollNow` can be answered by the very
  // guard this row is about - correctly - and then nothing is in flight at all, and a fixed
  // pause counts zero reads on a build that is working. Whoever starts the read is
  // immaterial to the claim: while one is in flight, a second must not start.
  let listCalls = 0;
  let releaseList;
  const listHeld = new Promise((resolve) => { releaseList = resolve; });
  await page.route('**/effects', async (route) => {
    listCalls += 1;
    if (listCalls === 1) await listHeld;
    await route.continue();
  });
  const firstTick = page.evaluate(() => globalThis.__kinect.effects.pollNow()).catch(() => {});
  // Up to one whole interval plus the read itself, because if the driver's own call is the
  // one the guard turns away then the tick that holds it is the one being waited for.
  let inFlight = false;
  for (let waited = 0; waited < 9000 && !inFlight; waited += 100) {
    inFlight = listCalls >= 1;
    if (!inFlight) await wait(100);
  }
  const secondTick = page.evaluate(() => globalThis.__kinect.effects.pollNow()).catch(() => {});
  await wait(400);
  const duringOverlap = listCalls;
  releaseList();
  await Promise.all([firstTick, secondTick]);
  await page.unroute('**/effects');
  ok('a second tick arriving while the first is still reading does not read too: the guard is up before the fetch rather than after it',
    inFlight === true && duringOverlap === 1,
    inFlight
      ? `${duringOverlap} reads of the store were in flight at once${listCalls > duringOverlap ? `, ${listCalls} in all` : ''}`
      : 'no read of the store ever went out, so nothing was held and this row measured nothing');

  // A set read across an install, staged by answering the *verification* read with a
  // signature that has moved. What the page must not do is assemble the two halves.
  await put('probe', recompiledProbe(5));
  // **The closing read is the first listing taken after a package read, and it used to be
  // "every second one".** Parity is the wrong handle because this arm shares the route with
  // the page: `pollNow` is the interval's own body and the interval never stops, so a tick
  // landing between the driver's two reads shifts the count and the closing read comes back
  // unmoved - at which point the rebuild succeeds and this row reddens on a build with
  // nothing wrong with it. Seen once, under `--mutate rebuild-forgets-the-tab`, as a second
  // red row five sections away from the mutation. The order inside one read is what actually
  // marks the two apart: the opening listing is asked before any package is, and the closing
  // one after all of them.
  //
  // **And the change has to be one only this comparison can see, which took a second reading
  // to get right.** The read retries once, so "every listing after the first package read"
  // moves the *opening* listing of the second attempt as well - and a rev in an opening
  // listing is caught one request later by the package that answers for a different revision,
  // which is the rule next door. Measured: with that spelling the row was green on a clean
  // build for the pin's reason and went red under `package-read-need-not-match-the-list`, a
  // mutation it has nothing to do with. So the marker is cleared as each closing read passes
  // and every attempt opens on an untouched listing, which puts the refusal back on the
  // comparison this row is named for.
  //
  // The residual is one microsecond-wide window: the page's own interval shares this route,
  // and a tick landing between the driver's last package read and its closing listing would
  // take the mutation instead. It cannot rebuild there - a tick's own listing is untouched,
  // so its signature matches and it stands down - and if it ever did steal one the row goes
  // red rather than quietly green, which is the direction to be wrong in.
  let listReads = 0;
  let closingReads = 0;
  let listAfterPackages = false;
  await page.route('**/effects/probe', async (route) => { listAfterPackages = true; await route.continue(); });
  await page.route('**/effects', async (route) => {
    listReads += 1;
    const res = await route.fetch();
    const body = await res.json();
    if (listAfterPackages) {
      body.effects[0].rev = `${body.effects[0].rev}-moved`;
      listAfterPackages = false;
      closingReads += 1;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const incoherent = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const was = k.effects.signature();
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, held: k.effects.signature() === was, knows: k.params.names().includes('probe.hue') };
  });
  await page.unroute('**/effects');
  await page.unroute('**/effects/probe');
  // `closingReads === 2` is the delivery half: the read retries once, so a run that refused
  // for this reason moved a rev in exactly two closing listings. A number other than two says
  // the fixture did not land where the sentence says it did, whatever the refusal reads like.
  ok('a store that moves while the page is reading it is refused rather than assembled from both halves',
    incoherent.threw !== null && /moved while this page was reading them/.test(incoherent.threw ?? '')
      && incoherent.held === true && closingReads === 2,
    incoherent.threw ? `"${incoherent.threw.slice(0, 100)}", the signature ${incoherent.held ? 'held' : 'moved'}, `
      + `${closingReads} of ${listReads} listings moved`
      : `the rebuild reported success on a set read across two revisions (${closingReads} of ${listReads} listings moved)`);
  const coherent = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    await k.effects.reload();
    return k.effects.programs().cloud.fragmentShader.includes('probeHue * 0.55');
  });
  ok('and the same set read with nothing moving is adopted, so the rule above is a distinction rather than a refusal to read at all',
    coherent === true, coherent ? 'the fifth recompiled chunk reached the assembled program' : 'the page did not adopt it');

  // ---- and a change the store made and unmade while the page was reading it
  //
  // **The row above compares revisions, and a revision is a hash of bytes, so a change that
  // is *undone* hashes back to what it was.** Install a fork and delete it again - which
  // restores the shipped package rather than removing anything - and the opening listing, the
  // closing listing and every revision in both of them are identical across a window in which
  // the store answered as something else. A read straddling that pair passes the comparison
  // by construction, assembles a program out of two revisions, and records the signature it
  // opened with, so no later tick ever finds anything to disagree with either. What the store
  // gained for it is a count of how many times it has changed, which is the axis that pair
  // moves along and the bytes do not.
  //
  // Staged by giving every read its own generation and leaving every revision exactly as the
  // store sent it, which is what an install and its undo look like from here. **Every read
  // rather than the closing one**, for the reason its neighbour above carries: the interval
  // on the page shares this route, so a tick landing between the driver's two reads shifts
  // any parity the interception counts on. A number that only goes up makes any two reads
  // disagree, which is what the row is about, and it is the shape a real counter has.
  let genReads = 0;
  const generationRoute = async (route) => {
    genReads += 1;
    const res = await route.fetch();
    const body = await res.json();
    body.generation += genReads;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  };
  await page.route('**/effects', generationRoute);
  const undone = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const was = k.effects.signature();
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, held: k.effects.signature() === was };
  });
  await page.unroute('**/effects', generationRoute);
  ok('a change the store made and unmade while the page was reading is refused, though every revision on both sides of it is identical',
    /moved while this page was reading them/.test(undone.threw ?? '')
      && /generation/.test(undone.threw ?? '') && undone.held === true,
    undone.threw ? `"${undone.threw.slice(-90)}", the signature ${undone.held ? 'held' : 'moved'}`
      : 'the rebuild reported success on a set read across a change and its undo');

  // The same window one request in, where neither listing can reach: a revision installed and
  // removed again inside the read of one package hands this page that package's manifest and
  // file index out of the other revision, and both listings still agree about everything.
  const movedRevRoute = async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.rev = `${body.rev}-moved`;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  };
  await page.route('**/effects/probe', movedRevRoute);
  const strayPackage = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const was = k.effects.signature();
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, held: k.effects.signature() === was };
  });
  await page.unroute('**/effects/probe', movedRevRoute);
  ok('and a package answering for a revision the listing did not name is refused too, naming the package and both revisions',
    /moved while this page was reading them/.test(strayPackage.threw ?? '')
      && /effect probe was listed at revision/.test(strayPackage.threw ?? '') && strayPackage.held === true,
    strayPackage.threw ? `"${strayPackage.threw.slice(-110)}", the signature ${strayPackage.held ? 'held' : 'moved'}`
      : 'the rebuild reported success on a package from another revision');

  // The control for both, and it is the same two interceptions with nothing moved. Without it
  // each row above passes on a build that refused any read it could see being intercepted,
  // and neither row would be about the disagreement it names.
  const passThroughList = async (route) => {
    const res = await route.fetch();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await res.json()) });
  };
  await page.route('**/effects', passThroughList);
  await page.route('**/effects/probe', passThroughList);
  const untouched = await page.evaluate(async () => {
    let threw = null;
    try { await globalThis.__kinect.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, knows: globalThis.__kinect.params.names().includes('probe.hue') };
  });
  await page.unroute('**/effects', passThroughList);
  await page.unroute('**/effects/probe', passThroughList);
  ok('while the same two reads with nothing moved are adopted, so both refusals are about the disagreement rather than about being read through',
    untouched.threw === null && untouched.knows === true,
    untouched.threw ?? 'the page adopted the set it was handed');

  // ---- a rebinding that abandons the uniform it used to drive
  //
  // **A binding is a manifest field, so an install can move one - and nothing writes a
  // uniform except the parameter bound to it.** A fork that points one parameter at a
  // different live uniform, with not one byte of its GLSL changed, therefore leaves the term
  // it used to drive frozen at whatever the slider last put there: the chunk goes on reading
  // it every frame, the control that could move it is now writing somewhere else, and there
  // is no gesture anywhere that puts the picture back.
  //
  // The shipped `thermal` is the fixture rather than a package written for it, because the
  // failure needs a uniform the *spine* declares: a package's own uniform left bound to
  // nothing is refused at the door one rule earlier, so a fixture that declared its own would
  // be testing that rule instead. `edges` is the other end - a live float on the same table,
  // bound by the shipped edges package, so the value has somewhere real to land.
  console.log('    (and a rebinding that leaves the uniform it moved off)');
  const thermalDir = join(BUILTIN_ROOT, 'thermal');
  const thermalManifest = JSON.parse(readFileSync(join(thermalDir, 'manifest.json'), 'utf8'));
  const reboundThermal = () => {
    const manifest = JSON.parse(JSON.stringify(thermalManifest));
    manifest.version = '2.0.0';
    manifest.params.amount.bind.uniform = 'edges';
    return {
      manifest,
      chunks: Object.fromEntries((thermalManifest.chunks ?? [])
        .map((c) => [c.file, readFileSync(join(thermalDir, c.file), 'utf8')])),
    };
  };

  // `drive.reset` before every `hashes`, because the pinned source refuses a backward step
  // over accumulators that have already consumed a later frame - which is the transport
  // saying, correctly, that a hash taken without it would be of a different state.
  const atRest = await page.evaluate(async (positions) => {
    globalThis.__kinect.params.reset();
    globalThis.__kinect.drive.reset();
    return globalThis.__kinect.drive.hashes(positions);
  }, POSITIONS);
  const raisedThermal = await page.evaluate(async (positions) => {
    globalThis.__kinect.params.set('thermal.amount', 0.6);
    globalThis.__kinect.drive.reset();
    return {
      hashes: await globalThis.__kinect.drive.hashes(positions),
      uniform: globalThis.__kinect.uniforms.thermal.value,
    };
  }, POSITIONS);
  ok('the term this rebinding abandons is one the picture can see, raised and reading its uniform',
    raisedThermal.uniform === 0.6 && JSON.stringify(raisedThermal.hashes) !== JSON.stringify(atRest),
    `thermal at ${raisedThermal.uniform}, ${raisedThermal.hashes.map((h) => h.slice(0, 8)).join(' ')} `
    + `against ${atRest.map((h) => h.slice(0, 8)).join(' ')} at rest`);

  await put('thermal', reboundThermal());
  const rebound = await page.evaluate(async (positions) => {
    const k = globalThis.__kinect;
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    // Back to the default the picture above was taken at, so what is left in the frame is
    // whatever the departed uniform is still holding rather than the value the control has.
    k.params.set('thermal.amount', 0);
    const departed = k.uniforms.thermal.value;
    const arrived = k.uniforms.edges.value;
    k.drive.reset();
    return { threw, departed, arrived, hashes: await k.drive.hashes(positions) };
  }, POSITIONS);
  ok('the fork that rebinds one parameter onto another live uniform installs and is adopted',
    !rebound.threw && rebound.arrived === 0, rebound.threw ?? `edges reads ${rebound.arrived}`);
  ok('the uniform the binding left reads the value the spine declared it with, rather than the one the slider last put there',
    rebound.departed === 0, `thermal reads ${rebound.departed} after the binding moved off it`);
  ok('and the picture follows the registry: with every control back at its default it is the picture the defaults drew',
    JSON.stringify(rebound.hashes) === JSON.stringify(atRest),
    rebound.hashes.map((h, i) => `${h.slice(0, 8)}${h === atRest[i] ? '=' : '!='}${atRest[i].slice(0, 8)}`).join(' '));

  await del('thermal');
  const thermalBack = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    k.params.reset();
    return { threw, uniform: k.uniforms.thermal.value };
  });
  ok('and the shipped package comes back when the fork is removed, with its own uniform driven again',
    thermalBack.threw === null && thermalBack.uniform === 0, thermalBack.threw ?? `thermal reads ${thermalBack.uniform}`);

  // ================================ 9. a package this build can store and cannot compile
  //
  // **The door is not a compiler and this is the gap that leaves.** Every identifier in the
  // chunk below is one this build has - `col` is the spine's own colour, `probeAmount` is
  // the package's own uniform - so the door has nothing to refuse it for, and it is a type
  // error the driver rejects at link time. WebGL reports that through a log rather than an
  // exception and three.js passes it on the same way, so the install succeeded, the
  // document was carried across, the poll said the page had been rebuilt, and the cloud
  // drew nothing at all with no sentence anywhere.
  console.log('\n[effect] 9. a package this build can store and cannot use');

  const broken = await put('probe', brokenProbe());
  ok('the server takes it: every name in it is one this build has, which is all the door can ask',
    broken.status === 200, `${broken.status}: ${broken.body.error ?? 'installed'}`);
  // The store as it stands with the package in it, read before the page is asked to adopt it,
  // because the quarantine below is a change to *this* and the only honest way to say a
  // counter moved is to have read it on the other side of the thing that moves it.
  const stored = await getJson('/effects');

  const refused = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = { names: k.params.names(), signature: k.effects.signature() };
    let threw = null;
    try {
      await k.effects.reload();
    } catch (err) { threw = String(err.message); }
    return {
      threw,
      names: k.params.names(),
      same: JSON.stringify(k.params.names()) === JSON.stringify(before.names),
      signature: k.effects.signature(),
      signatureHeld: k.effects.signature() === before.signature,
      note: document.getElementById('tNote')?.textContent ?? '',
      shader: k.effects.programs().cloud.fragmentShader.includes('col = probeAmount;'),
    };
  });
  ok('the page refuses it rather than adopting it, and says the shaders did not compile',
    refused.threw !== null && /did not compile/.test(refused.threw ?? ''),
    refused.threw ? `"${refused.threw.slice(0, 130)}"` : 'the rebuild reported success');
  ok('and it is back on the programs it was drawing with: the registry it had, the signature it had, and none of the broken text',
    refused.same === true && refused.signatureHeld === true && refused.shader === false,
    `${refused.names.length} parameters, the signature ${refused.signatureHeld ? 'held' : 'moved'}, `
    + `the broken line ${refused.shader ? 'reached the assembled program' : 'did not'}`);

  // **And then the half of this that is not about this page at all.** Rolling back puts this
  // browser right and leaves the package exactly where it was, so the next browser to open
  // compiles it at boot - where `warmPrograms` runs outside any transaction and takes the
  // module down with it, publishing no `__kinect` and leaving every tool in this suite
  // reporting that it did not run. Nothing on the server can see that coming, because the
  // door assembles and binds and is not a compiler: the only process in this program holding
  // a GL context is the page that just failed, which is why quarantining is something the
  // page does rather than something done to it. `setAsideUnlinkable` in `web/main.js` is the
  // caller and `serveEffectRefusal` in `server/index.js` is the route.
  //
  // **Only a link failure may do this, which is the constraint the row in section 6 holds.**
  // The same rollback catches a document this page could not carry across, and setting a
  // package aside for one of those would rename authored work out of the way for a fault in a
  // clip - so the throw carries a mark and the caller reads it. `any-failure-is-quarantined`
  // is the mutation for that direction and it reddens there rather than here.
  const afterRefusal = await getJson('/effects');
  const asides = userRootHolds().filter((name) => /^probe\..+\.incompatible$/.test(name));
  ok('the page has the store set the package aside, so the id stops answering with something that will not compile',
    (afterRefusal.body.effects ?? []).every((e) => e.id !== 'probe')
      && afterRefusal.body.generation === stored.body.generation + 1
      && asides.length === 1,
    `${(afterRefusal.body.effects ?? []).length} packages, generation ${stored.body.generation} -> `
    + `${afterRefusal.body.generation}, user root holds ${userRootHolds().join(', ') || 'nothing'}`);
  // Renamed and never deleted, for the reason the boot gate's aside is: a package that will
  // not compile on this build is somebody's authored work and a fork is repairable. The files
  // are counted rather than trusted, because a rename that dropped one would leave a
  // directory nobody can move back and every reading above would still be green.
  ok('and renamed rather than deleted, with every file it arrived with still in it',
    asides.length === 1
      && readdirSync(join(USER_ROOT, asides[0])).sort().join(', ') === 'decl.frag.glsl, manifest.json, tone.frag.glsl',
    asides.length === 1
      ? `${asides[0]} holds ${readdirSync(join(USER_ROOT, asides[0])).sort().join(', ')}`
      : `${asides.length} asides in the user root`);
  // **The row the two above exist for, and the one thing neither of them can say.** A store
  // that answered perfectly would still be beside the point if the surface it feeds did not
  // come up, and coming up is exactly what the quarantine is for: this is the fresh load that
  // was dying, asked of a browser rather than of a route. Without it a build that called the
  // route and achieved nothing would pass both rows above.
  const freshPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const freshErrors = [];
  freshPage.on('pageerror', (e) => freshErrors.push(String(e)));
  await freshPage.goto(`${BASE}/record`, { waitUntil: 'load' }).catch(() => {});
  const freshBooted = await freshPage.waitForFunction('Boolean(globalThis.__kinect)', null, { timeout: 20000 })
    .then(() => freshPage.evaluate(() => !globalThis.__kinect.params.names().includes('probe.amount')))
    .catch(() => null);
  ok('and a page opened fresh on that store boots, which is what the package surviving the rollback used to stop',
    freshBooted === true,
    freshBooted === null
      ? `no __kinect published: ${freshErrors[0]?.slice(0, 130) ?? 'nothing arrived on the page error channel'}`
      : `__kinect published, probe.amount ${freshBooted ? 'absent from' : 'in'} the registry`);
  await freshPage.close();

  // And the page that discovered it, converging on the store it just changed. The delete this
  // row used to open with has gone: the quarantine has already taken the live copy out of the
  // user root, so there is nothing left to remove and `DELETE /effects/probe` answers 404 -
  // which is the state being *left* rather than a failure, and is asked for here so a build
  // that quarantined nothing cannot reach this row's green through the old route.
  const mended = await del('probe');
  const mendedPage = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, knows: k.params.names().includes('probe.amount') };
  });
  ok('and the page rebuilds from what is left, so a build that cannot compile is a state to leave rather than one to be stuck in',
    mended.status === 404 && mendedPage.threw === null && mendedPage.knows === false,
    `DELETE answered ${mended.status}, ${mendedPage.threw ?? 'the page rebuilt without it'}`);
  // The aside swept, so the sections below stage their fixtures into the user root this one
  // found rather than into one carrying a leftover from section 9. The rows above are the
  // proof that it was there; keeping it would be a coupling nothing states.
  if (asides.length === 1) rmSync(join(USER_ROOT, asides[0]), { recursive: true, force: true });

  // ---- and a package that never went through the door at all
  //
  // **The rollback has to cover the adoption itself and not only what runs after it.** The
  // door refuses a parameter naming a panel group nothing holds, and the store is still a
  // directory: a package written into the user root by hand - a copy from another machine,
  // an editor, a script - reaches the page having been checked by nothing. It assembles
  // fine, because it declares no GLSL; what it does is make `buildPanel` throw on the stray
  // parameter, **after** the registry, the panel maps and the shader programs have already
  // been replaced. With the adoption outside the transaction that throw walked past the
  // rollback and left the page holding a registry with no panel drawn from it.
  //
  // Written straight into the root rather than sent through `PUT`, which is the only way to
  // reach this: the door's whole job is that this package cannot arrive that way.
  const outside = join(USER_ROOT, 'probebad');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'manifest.json'), `${JSON.stringify({
    format: 1,
    id: 'probebad',
    version: '1.0.0',
    title: 'Probe Bad',
    params: {
      amount: {
        def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'probe bad',
        panel: { group: 'nosuchgroup', tab: 'look' },
        bind: { on: 'points', uniform: 'probeBadAmount' },
        role: 'master',
      },
    },
  }, null, 2)}\n`);
  const unusable = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = { names: k.params.names(), signature: k.effects.signature() };
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    // The panel asked for from the document rather than from a map, because the state this
    // is about is a registry with no rows drawn from it - and a rebuilt panel that matched
    // the rolled-back registry is the whole claim.
    const rows = [...document.querySelectorAll('#panelBody [data-group] input')].map((i) => i.id);
    return {
      threw,
      same: JSON.stringify(k.params.names()) === JSON.stringify(before.names),
      signatureHeld: k.effects.signature() === before.signature,
      knows: k.params.names().includes('probebad.amount'),
      rowsMatchRegistry: k.params.names().filter((n) => rows.includes(n)).length === rows.length && rows.length > 0,
    };
  });
  ok('a package written past the door is refused by the page, and the refusal comes out of the adoption rather than out of the document',
    unusable.threw !== null && /nosuchgroup|name no panel group/.test(unusable.threw ?? ''),
    unusable.threw ? `"${unusable.threw.slice(0, 120)}"` : 'the rebuild reported success');
  ok('and the page is whole afterwards: the registry it had, the signature it had, and a panel whose rows are that registry',
    unusable.same === true && unusable.signatureHeld === true && unusable.knows === false
      && unusable.rowsMatchRegistry === true,
    `the registry ${unusable.same ? 'held' : 'moved'}, the signature ${unusable.signatureHeld ? 'held' : 'moved'}, `
    + `the panel's rows ${unusable.rowsMatchRegistry ? 'are all registry names' : 'do not match the registry'}`);
  rmSync(outside, { recursive: true, force: true });
  const afterOutside = await page.evaluate(async () => {
    let threw = null;
    try { await globalThis.__kinect.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, names: globalThis.__kinect.params.names().length };
  });
  ok('and removing it lets the page rebuild again, so the refusal is a state to leave rather than one to be stuck in',
    afterOutside.threw === null, afterOutside.threw ?? `${afterOutside.names} parameters`);

  // ---- and a set this page has refused is not asked about again every six seconds
  //
  // **A rollback puts the old signature back, which is what makes the poll's comparison go on
  // saying the store has moved.** That is true and it is not a reason to try the same rebuild
  // again: every attempt refetches every package, reassembles both programs, disposes the
  // material the page is drawing with and resets the accumulators, to arrive at the same
  // refusal and print the same sentence. Ten times a minute, for as long as the store holds a
  // package this build cannot use.
  //
  // **Placed here rather than beside the refusal in section 6, and the position is a measured
  // decision.** These two blocks lengthen whatever fixture chain they sit in, and section 6's
  // chain is the one three existing mutations are already breaking - with them here,
  // `reinstall-leaves-it-parked` reached the first unguarded `reload()` in section 7 and ended
  // the run at 60 of 107 assertions, where it had been finishing. Sections 10 and 11 are short
  // and the second of them closes the browser anyway, so a block that leaves the page unwell
  // costs least at the end of section 9. `docs/instruments.md` carries the reading.
  //
  // **Driven through the poll rather than `reload`, because the block is the poll's**: the
  // signature that failed is remembered by the tick that failed on it, and a `reload` an
  // operator asks for goes nowhere near it.
  const refusedFork = await put('probe', forkedProbe());
  await page.evaluate(() => globalThis.__kinect.effects.pollNow());
  await page.waitForFunction(
    "/probe\\.glow/.test(document.getElementById('tNote')?.textContent ?? '')", null, { timeout: 20000 },
  ).catch(() => {});
  const refusedNote = await page.evaluate(() => document.getElementById('tNote')?.textContent ?? '');
  ok('the fork the page cannot carry its document onto is installed again and refused again, which is the state the block is about',
    refusedFork.status === 200 && /probe\.glow/.test(refusedNote),
    `${refusedFork.status}: ${refusedFork.body.error ?? 'installed'}, the note reads "${refusedNote.trim().slice(0, 70)}"`);

  // **The rebuild attempts are counted in the driver rather than read off the page**, because
  // what is being asked is how many times the store was read - and the reading that separates
  // "no rebuild" from "no poll" is that the *listing* is still being fetched while the package
  // reads stay at zero. Without that half, a `pollNow` the reentrancy guard turned away would
  // pass this row on a build that had stopped polling entirely.
  let refusedListReads = 0;
  let refusedPackageReads = 0;
  await page.route('**/effects', async (route) => { refusedListReads += 1; await route.continue(); });
  await page.route('**/effects/probe', async (route) => { refusedPackageReads += 1; await route.continue(); });
  await page.evaluate(() => globalThis.__kinect.effects.pollNow());
  // Two listings rather than a fixed pause, because the interval is six seconds and the
  // driver's own call can be answered by the guard: what the row needs is a window in which
  // the poll demonstrably ran, and waiting for the listing is waiting for exactly that.
  for (let waited = 0; waited < 20000 && refusedListReads < 2; waited += 100) await wait(100);
  await page.evaluate(() => globalThis.__kinect.effects.pollNow());
  await wait(500);
  await page.unroute('**/effects');
  await page.unroute('**/effects/probe');
  ok('a set this page has already refused is not fetched again on every tick, while the poll itself goes on running',
    refusedListReads >= 2 && refusedPackageReads === 0,
    `${refusedListReads} listings read and ${refusedPackageReads} package reads in the window`);

  // The other direction, and it is what says the block is a set being held off rather than a
  // page that has stopped looking: a revision this page has *not* refused has to land.
  await put('probe', retunedProbe());
  const unblocked = await page.evaluate(() => globalThis.__kinect.effects.pollNow())
    .then(() => page.waitForFunction(
      "globalThis.__kinect.params.names().includes('probe.hue')", null, { timeout: 20000 },
    ))
    .then(() => true).catch(() => false);
  ok('and a revision it has not refused is adopted, so the block is keyed to the set rather than latched on the page',
    unblocked === true, unblocked ? 'the page adopted the next revision' : 'the page never adopted it');

  // ---- and a read that did not work is not a set this page has refused
  //
  // **The block above went up for every way a rebuild could fail, and only one of them is
  // about the set.** A refusal is this build saying it cannot use what the store holds, and
  // asking again costs a full refetch to be told so a second time. A *read* that did not
  // work says nothing at all about the other side of it: a server restarting between the
  // listing and one package fetch, a dropped socket, a proxy on the two-machine shape this
  // program documents. Each of those failed a revision that was never anything but good,
  // once, and the block then stood over it until something else moved the store - which on
  // a machine where an install happens a few times a year is until somebody reloads the
  // page. See `effectRefusal` in `web/main.js` for why the difference travels on a property
  // rather than on the words of a message.
  //
  // **Planted on the package route and deliberately not on the listing.** The page's own
  // six-second interval fetches `/effects` through any interception this tool installs, so a
  // one-shot failure planted there is as likely to be spent on a tick as on the read it was
  // meant for - `docs/instruments.md` carries the run that cost. Nothing but
  // `fetchEffectPackages` asks for `/effects/probe`, so a failure planted there lands on the
  // rebuild by construction.
  //
  // Driven through the poll rather than `reload`, for the reason the block above is: the
  // signature is remembered by the tick that failed on it.
  const signatureNow = async () => {
    const listed = await getJson('/effects');
    return (listed.body.effects ?? []).map((e) => `${e.id} ${e.rev}`).join('\n');
  };
  const moved = await put('probe', relabelledProbe());
  const movedSignature = await signatureNow();
  let failedReads = 0;
  failingPackageRead = true;
  const failOnce = async (route) => {
    if (failedReads === 0) { failedReads += 1; return route.abort('failed'); }
    return route.continue();
  };
  await page.route('**/effects/probe', failOnce);
  await page.evaluate(() => globalThis.__kinect.effects.pollNow());
  const afterFailedRead = await page.evaluate(() => globalThis.__kinect.effects.signature());
  await page.unroute('**/effects/probe', failOnce);
  failingPackageRead = false;
  // The fixture's own delivery, before anything is read off it: exactly one package read
  // was failed, and the page is still on the set it had. A row that skipped this would pass
  // on a run where the abort never landed, which is the shape a green interception arm has.
  ok('a revision this page has not seen is installed and one package read of it is failed, so the tick below follows a read error rather than a refusal',
    moved.status === 200 && failedReads === 1 && afterFailedRead !== movedSignature,
    `${moved.status}: ${moved.body.error ?? 'installed'}, ${failedReads} package read failed, and the page `
    + `${afterFailedRead === movedSignature ? 'adopted the revision anyway' : 'held the set it had'}`);
  await page.evaluate(() => globalThis.__kinect.effects.pollNow());
  const retried = await page.waitForFunction(
    (sig) => globalThis.__kinect.effects.signature() === sig, movedSignature, { timeout: 20000 },
  ).then(() => true).catch(() => false);
  ok('and the next tick adopts it, because a fetch that did not work is no evidence about the set on the other side of it',
    retried === true,
    retried ? 'the page came back to the store\'s current signature' : 'the page never came back to the store\'s signature');

  // ---- the uniform cells a half-migrated adoption leaves behind
  //
  // **Section 6 is about a rollback that works; this is about the table it rolls back
  // through.** A uniform cell is a number for a plain binding and a two-component vector for
  // an `axisDeg` one, and which shape it has to be is a fact about the manifest - so a fork
  // that exchanges two bindings' shapes writes a number over one cell and then throws on
  // `.set()` at the other, mid-walk, with the registry already swapped. That throw is exactly
  // what the transaction is for. What it used to meet was an adoption that minted only
  // missing cells: the rollback found both present, skipped them, and died on the number the
  // forward attempt had left - so the page came out of a rollback holding a registry no
  // document loads into, with nothing left to print but a request to reload.
  //
  // Its own package and its own uniform names, so nothing here touches what `probe` is doing
  // or what section 7 primes on top of it.
  const cellShapes = () => page.evaluate(() => {
    const shape = (cell) => {
      if (!cell) return 'missing';
      if (typeof cell.value === 'number') return 'number';
      return cell.value && typeof cell.value.set === 'function' ? 'vector' : 'other';
    };
    const k = globalThis.__kinect;
    return {
      axis: shape(k.uniforms.probeShapeAxis),
      tone: shape(k.uniforms.probeShapeTone),
      names: k.params.names().filter((n) => n.startsWith('probeshape.')),
    };
  });

  await put('probeshape', shapedProbe());
  const shaped = await page.evaluate(async () => {
    try { await globalThis.__kinect.effects.reload(); } catch (err) { return { threw: String(err.message) }; }
    const k = globalThis.__kinect;
    k.params.set('probeshape.amount', 0.4);
    k.params.set('probeshape.angle', 90);
    k.params.set('probeshape.tone', 0.25);
    return { threw: null, held: k.library.serialiseProjectBody().look.params['probeshape.angle'] ?? null };
  });
  const shapesBefore = await cellShapes();
  ok('a package binding one cell of each shape installs and is adopted, with the document holding its values',
    !shaped.threw && shaped.held === 90 && shapesBefore.names.length === 3,
    shaped.threw ?? `${shapesBefore.names.length} parameters, the document holds angle at ${shaped.held}`);
  ok('and the two cells are the two shapes this arm is about, which is what makes the swap below a swap',
    shapesBefore.axis === 'vector' && shapesBefore.tone === 'number',
    `probeShapeAxis is a ${shapesBefore.axis}, probeShapeTone is a ${shapesBefore.tone}`);

  await put('probeshape', reshapedProbe());
  const reshaped = await page.evaluate(async () => {
    const k = globalThis.__kinect;
    const before = k.params.names();
    let threw = null;
    try { await k.effects.reload(); } catch (err) { threw = String(err.message); }
    return { threw, same: JSON.stringify(k.params.names()) === JSON.stringify(before) };
  });
  const shapesAfter = await cellShapes();
  ok('the fork that swaps both shapes is refused by the document rather than by the table, so the rollback is what ran',
    /probeshape\.glow/.test(reshaped.threw ?? '') && /still running the effects it had/.test(reshaped.threw ?? ''),
    reshaped.threw ? `"${reshaped.threw.slice(0, 130)}"` : 'the rebuild reported success');
  ok('and the rollback finished rather than dying in the table it was rolling back through',
    !/reload the page/.test(reshaped.threw ?? '') && reshaped.same === true,
    reshaped.same ? 'the registry is the one this page had' : 'the registry moved');
  ok('the cells are the shapes the registry this page is holding demands, which is what a rollback through them has to leave',
    shapesAfter.axis === 'vector' && shapesAfter.tone === 'number',
    `probeShapeAxis is a ${shapesAfter.axis}, probeShapeTone is a ${shapesAfter.tone}`);

  // Off again, values first so nothing of it parks: the badge and the pool belong to `probe`
  // for the rest of this run, and a second parked effect would be this arm reaching into
  // rows that are not about it.
  await page.evaluate(() => {
    const k = globalThis.__kinect;
    for (const name of k.params.names().filter((n) => n.startsWith('probeshape.'))) {
      k.params.set(name, k.params.spec(name).default);
    }
  }).catch(() => {});
  await del('probeshape');
  const unshaped = await page.evaluate(async () => {
    let threw = null;
    try { await globalThis.__kinect.effects.reload(); } catch (err) { threw = String(err.message); }
    const k = globalThis.__kinect;
    return {
      threw,
      knows: k.params.names().some((n) => n.startsWith('probeshape.')),
      parked: Object.keys(k.library.parkedLook()?.params ?? {}).filter((n) => n.startsWith('probeshape.')).length,
    };
  });
  ok('and taking it back off leaves the page rebuilding cleanly with nothing of it parked',
    unshaped.threw === null && unshaped.knows === false && unshaped.parked === 0,
    unshaped.threw ?? `${unshaped.parked} probeshape values parked`);

  // =========================================== 10. what a crashed install leaves behind
  //
  // **Last, and the position is the finding rather than housekeeping.** Everything in
  // this block leaves a directory in the user root that is not a package, and under
  // `temporaries-are-visible` the store then cannot list at all - so a temporary staged
  // in section 1 would have reddened every row of every section after it with a fault
  // whose cause is five sections away. Put here, the mutation reddens the two rows it is
  // about and nothing else, which is the difference between a control that names a
  // property and one that fails everything.
  console.log('\n[effect] 10. and what a crashed install leaves behind is invisible until it is swept');

  // Taken here rather than reused from section 1, because the probe is installed by now
  // and the count moved with it - a comparison against the boot listing would fail on a
  // correct build for a reason that has nothing to do with temporaries.
  const beforeStale = await getJson('/effects');
  const stale = join(USER_ROOT, 'probe.99999.tmp');
  mkdirSync(stale, { recursive: true });
  writeFileSync(join(stale, 'manifest.json'), '{"this is": "not a package"}');
  ok('a half-written package is on disk, so the rows under this are about something',
    existsSync(stale), 'probe.99999.tmp staged in the user root');
  const withStale = await getJson('/effects');
  ok('a half-written package is in no listing - its name carries a dot and an effect id may not',
    withStale.status === 200
      && withStale.body.effects?.length === beforeStale.body.effects?.length
      && !withStale.body.effects.some((e) => e.id.includes('.')),
    `answered ${withStale.status} with ${withStale.body.effects?.length ?? 'no'} packages, `
    + `${beforeStale.body.effects?.length ?? 'no'} before it was staged`);
  const staleRead = await getJson('/effects/probe.99999.tmp');
  ok('and no read resolves it', staleRead.status === 404, `answered ${staleRead.status}`);
  const sweeping = await put('probe', probePackage());
  ok('and the next install of that id sweeps it, so a machine that crashed mid-install does not accumulate copies',
    sweeping.status === 200 && !existsSync(stale),
    `${sweeping.status}: ${sweeping.body.error ?? 'installed'}, user root ${userRootHolds().join(', ') || 'empty'}`);

  ok('the page reported no error through any of it', pageErrors.length === 0,
    pageErrors.slice(0, 2).join(' | '));

  // ============ 11. what somebody plants in the user root, and the window a crash lands in
  //
  // **The one place this store can lose work, and it is three lines wide.** `install`
  // swaps the old copy aside and then swaps the new one in, and between those two renames
  // the id resolves to nothing: a machine losing power there comes back with the only copy
  // of the package in `<id>.<seq>.old`, every read answering from the builtin as though it
  // had been uninstalled, and - before this - the next install of that id sweeping the
  // aside away as rubbish. The recovery that would have saved it was the thing that
  // destroyed it.
  //
  // **Driven by restarting the server, because the recovery is a fact about starting up.**
  // The browser is closed first: the page's own poll would report a store that stopped
  // answering, which is correct behaviour and has nothing to do with what is being asked
  // here. Everything below is HTTP against a store that has just been constructed over a
  // directory somebody crashed in.
  console.log('\n[effect] 11. an install interrupted between its two renames, and what the next start does about it');

  await browser.close();
  browser = null;

  // A file that is not a file, planted where only a client can write.
  //
  // **The name rule stops a path in the request and says nothing about a path already on
  // disk.** `VALID_FILE_NAME` refuses `../secret`, and it accepts `leak.txt` - so a link
  // called `leak.txt` sitting in a package directory was a name the route would build a
  // path out of, `statSync` would follow, `isFile()` would agree with, and `readFileSync`
  // would serve from wherever it aimed. The install door writes ordinary files and nothing
  // else, so what is asked here is that the read agrees: a package file is a regular file,
  // and a link is refused whether or not it points somewhere legitimate.
  //
  // **The package is written straight into the user root rather than installed**, and for
  // both of the reasons this block sits after the browser has been closed. Written, it
  // depends on no row above it - one mutation of this tool leaves the store unable to
  // install anything at all, and a row whose fixture is the previous row's output turns
  // that into a crash rather than into the two red rows it is about. And a package the page
  // would have to adopt has no business appearing in the store while a page is polling it.
  //
  // The ordinary file beside it is what stops these rows passing on a route that refused
  // everything, which is the same shape section 2's must-accept package has.
  const secret = join(WORK, 'not-a-package-file.txt');
  writeFileSync(secret, 'this text is outside both effect roots\n');
  const linkRoot = join(USER_ROOT, 'probelink');
  mkdirSync(linkRoot, { recursive: true });
  writeFileSync(join(linkRoot, 'manifest.json'), `${JSON.stringify({
    format: 1, id: 'probelink', version: '1.0.0', title: 'Probe Link', params: {},
  }, null, 2)}\n`);
  writeFileSync(join(linkRoot, 'notes.txt'), 'an ordinary file in a package directory\n');
  symlinkSync(secret, join(linkRoot, 'leak.txt'));
  const leaked = await fetch(`${BASE}/effects/probelink/file/leak.txt`);
  const leakedText = await leaked.text();
  ok('a symlink planted in a package directory is not a package file, whatever it points at',
    leaked.status === 404 && !leakedText.includes('outside both effect roots'),
    `answered ${leaked.status}${leakedText.includes('outside both effect roots') ? ' with the bytes it pointed at' : ''}`);
  const served = await fetch(`${BASE}/effects/probelink/file/notes.txt`);
  const servedText = await served.text();
  ok('and an ordinary file in the same directory still serves, so the rule above is about the kind rather than about the route',
    served.status === 200 && servedText.includes('an ordinary file in a package directory'),
    `answered ${served.status} with ${servedText.length} bytes`);
  const listedWithLink = await getJson('/effects/probelink');
  ok('and it is in no file index either, so nothing anywhere offers it',
    listedWithLink.status === 200
      && listedWithLink.body.files.some((f) => f.name === 'notes.txt')
      && !listedWithLink.body.files.some((f) => f.name === 'leak.txt'),
    listedWithLink.body.files?.map((f) => f.name).join(', ') ?? 'no index');
  rmSync(linkRoot, { recursive: true, force: true });

  await stopAll();

  // The crash, staged exactly as `install` would have left it: the package's own files in
  // an aside carrying the `.old` suffix, and nothing at the live id.
  //
  // Written rather than renamed out of whatever section 10 left behind, on the same
  // reasoning as the block above it: a fixture that is the previous row's output turns a
  // mutation that broke installing into a crash here instead of into the red rows it is
  // about.
  const crashedAside = join(USER_ROOT, 'probe.4711.tmpseq.old');
  rmSync(join(USER_ROOT, 'probe'), { recursive: true, force: true });
  rmSync(crashedAside, { recursive: true, force: true });
  mkdirSync(crashedAside, { recursive: true });
  writeFileSync(join(crashedAside, 'manifest.json'), `${JSON.stringify(probeManifest(), null, 2)}\n`);
  for (const [name, text] of Object.entries(probeChunks())) writeFileSync(join(crashedAside, name), text);
  writeFileSync(join(crashedAside, 'witness.marker'), 'the copy that was live when the machine went down\n');
  ok('a crashed install is staged: the package is in its aside and the id resolves to nothing',
    existsSync(crashedAside) && !existsSync(join(USER_ROOT, 'probe')),
    `user root holds ${userRootHolds().join(', ')}`);

  await start();
  const recovered = await getJson('/effects/probe');
  ok('the next start puts it back, so the copy a crash orphaned is the copy the store comes up on',
    recovered.status === 200 && recovered.body.builtin === false
      && existsSync(join(USER_ROOT, 'probe', 'witness.marker')),
    `answered ${recovered.status}, builtin=${recovered.body.builtin}, user root ${userRootHolds().join(', ')}`);
  ok('and the aside is gone rather than left beside the copy it became, so nothing accumulates',
    !existsSync(crashedAside), `user root ${userRootHolds().join(', ')}`);

  // **The control, and it is the direction the recovery must not run in.** A `remove` also
  // renames a directory aside before deleting it, so a crash there leaves the same shape -
  // and a recovery that could not tell the two apart would undo somebody's uninstall on
  // every restart. The suffix is what tells them apart, and this is the row that says so.
  const removedForGood = await del('probe');
  const goneAsides = userRootHolds();
  await stopAll();
  await start();
  const stillGone = await getJson('/effects/probe');
  ok('an uninstall is not a crashed install: the package stays removed across a restart',
    removedForGood.status === 200 && stillGone.status === 404,
    `after the restart the store answers ${stillGone.status} for probe, `
    + `user root ${userRootHolds().join(', ') || 'empty'} (was ${goneAsides.join(', ') || 'empty'})`);

  // ============ 12. a fork that outlived the build it was installed on
  //
  // **A package gets through the door once, against the build that was running that day.**
  // That is the whole of what an install door can promise, and a fork outlives the build it
  // was made on: this program's spines gain, lose and rename joints, and its shipped
  // packages gain parameters. Upgrade underneath a fork whose chunk names a joint the new
  // spine has dropped and nothing about the fork changes and nothing re-asks - it goes on
  // shadowing the upgraded builtin, so it is still what `/effects` answers with, and
  // `assembleShaders` throws while `web/main.js` is evaluating. No `__kinect` at all,
  // neither surface opening on that machine again, every tool here reporting DID NOT RUN,
  // and the only evidence a line in a console nobody has open. The machine that upgraded is
  // the machine that stops working.
  //
  // **The gate is the install door asked a second time rather than a second gate**, so
  // there is nothing here that can drift from what an install accepts. What is staged is a
  // fork *written past* that door, because the current door is exactly the thing that
  // refuses it - which is also the only shape an upgrade leaves behind.
  console.log('\n[effect] 12. a fork from an earlier build, met at the next start');

  await stopAll();

  // A fork of a *shipped* package rather than of `probe`, because the reading that says the
  // gate did something rather than nothing is the id going back to answering with the
  // builtin. The joint is renamed rather than the chunk broken, because that is the shape
  // the finding is about: the package was correct when it landed and the spine moved under
  // it. `witness.marker` is somebody's authored work standing in for all of it - the one
  // thing this build may not do about a package it cannot use is destroy it.
  const doctored = JSON.parse(readFileSync(join(BUILTIN_ROOT, 'thermal/manifest.json'), 'utf8'));
  doctored.version = '2.0.0';
  doctored.chunks = doctored.chunks.map((c) => ({ ...c, stage: 'f.thisjointwentaway' }));
  const staleFork = join(USER_ROOT, 'thermal');
  rmSync(staleFork, { recursive: true, force: true });
  mkdirSync(staleFork, { recursive: true });
  writeFileSync(join(staleFork, 'manifest.json'), `${JSON.stringify(doctored, null, 2)}\n`);
  writeFileSync(join(staleFork, 'heat.frag.glsl'), readFileSync(join(BUILTIN_ROOT, 'thermal/heat.frag.glsl'), 'utf8'));
  writeFileSync(join(staleFork, 'witness.marker'), 'the author\'s own copy of a package this build cannot use\n');

  // **A second fork beside it with nothing wrong with it, which is the control this section
  // did not have.** Every row below reads a store that has quarantined something, and a gate
  // that renamed *every* user package aside would satisfy all of them: thermal would answer
  // from the builtin, the page would boot, the aside would be there. What says the gate is a
  // gate rather than a wall is a fork it must keep - and keeping it is exactly what the gate
  // failed to do, because the door assembles `[...beside, candidate]` and reports the
  // assembler's message under the candidate's name. Doored beside an unvalidated thermal,
  // this healthy package came back "rain does not assemble" and both were set aside.
  //
  // `rain` rather than any other, because it sorts before `thermal`: a walk in lexical order
  // reaches the healthy one first, with the broken one still in `beside`, which is the
  // arrangement that made the blame land on the wrong package. It is a verbatim fork at a new
  // version - every parameter kept, every chunk copied byte for byte - so nothing about it
  // can be refused except by contamination from its neighbour.
  const healthy = JSON.parse(readFileSync(join(BUILTIN_ROOT, 'rain/manifest.json'), 'utf8'));
  healthy.version = '2.0.0';
  const healthyFork = join(USER_ROOT, 'rain');
  rmSync(healthyFork, { recursive: true, force: true });
  mkdirSync(healthyFork, { recursive: true });
  writeFileSync(join(healthyFork, 'manifest.json'), `${JSON.stringify(healthy, null, 2)}\n`);
  for (const c of healthy.chunks ?? []) {
    writeFileSync(join(healthyFork, c.file), readFileSync(join(BUILTIN_ROOT, 'rain', c.file), 'utf8'));
  }

  // **And a directory with a name longer than an id may be, which used to stop the server
  // booting rather than be refused by it.** `NAME_MAX` is 255 bytes and every aside this
  // program makes is the id plus about thirty characters, so a package installed by a build
  // whose id rule had no length in it could not be renamed at all: `ENAMETOOLONG` out of
  // `renameSync`, out of the gate, out of the process. A gate written to stop one broken
  // package taking the program down cannot be the thing that does it.
  // **240 characters, sized against `NAME_MAX` rather than picked for looking long.** The
  // first attempt at this fixture was 100, and it proved nothing: the aside is the name plus
  // about thirty characters, so 100 renames to 128 and lands well inside the 255 a filesystem
  // takes - the mutation that removes the truncation renamed it perfectly well and the row
  // stayed green on a build with the defect in it. A fixture has to sit *outside* the bound it
  // is about and inside every other one: 240 is a directory a filesystem will make and an
  // aside it will not, and truncating brings it back to 94.
  const overlong = 'z'.repeat(240);
  const overlongDir = join(USER_ROOT, overlong);
  rmSync(overlongDir, { recursive: true, force: true });
  mkdirSync(overlongDir, { recursive: true });
  writeFileSync(join(overlongDir, 'manifest.json'), `${JSON.stringify({
    format: 1, id: overlong, version: '1.0.0', title: 'A name from a build with no bound on one', params: {},
  }, null, 2)}\n`);

  ok('a fork this build can no longer assemble is staged where a fork installed by an earlier build would be, beside a healthy one and a name too long to rename',
    existsSync(join(staleFork, 'manifest.json')) && existsSync(join(healthyFork, 'manifest.json'))
      && existsSync(join(overlongDir, 'manifest.json')),
    `user root holds ${userRootHolds().map((n) => (n.length > 20 ? `${n.slice(0, 12)}…(${n.length})` : n)).join(', ')}`);

  await start();

  // **The must-accept row, and it is the one every other row in this section is silent
  // about.** A gate that quarantined the lot passes all of them.
  const servedRain = await getJson('/effects/rain');
  ok('the healthy fork beside it is still served, so the gate refuses a package rather than everything standing next to one',
    servedRain.status === 200 && servedRain.body.builtin === false
      && servedRain.body.manifest?.version === '2.0.0',
    `answered ${servedRain.status}, builtin=${servedRain.body.builtin}, `
    + `version ${JSON.stringify(servedRain.body.manifest?.version)}`);
  ok('and it is the only user package left standing, so exactly one of the three staged directories is serving',
    userRootHolds().filter((n) => !n.includes('.')).join(',') === 'rain',
    `user root holds ${userRootHolds().map((n) => (n.length > 20 ? `${n.slice(0, 12)}…(${n.length})` : n)).join(', ')}`);

  // The over-long name, which can only be moved by truncating it. Asserted by both ends: it
  // is gone from the name it had, and what it became is short enough to exist.
  const overlongAsides = userRootHolds().filter((n) => n.startsWith('z') && n.endsWith('.incompatible'));
  ok('the directory whose name is longer than an id is set aside under a truncated one, rather than throwing out of the gate and taking the boot with it',
    !existsSync(overlongDir) && overlongAsides.length === 1 && overlongAsides[0].length < 255,
    `${existsSync(overlongDir) ? `it still holds its own ${overlong.length}-character name` : 'its own name is gone'}, `
    + `and the user root holds ${overlongAsides.length} aside for it${overlongAsides[0] ? ` at ${overlongAsides[0].length} characters` : ''}`);

  const servedThermal = await getJson('/effects/thermal');
  ok('the next start hands the id back to the package this build ships, rather than serving a fork it cannot assemble',
    servedThermal.status === 200 && servedThermal.body.builtin === true
      && servedThermal.body.manifest?.version === '1.0.0',
    `answered ${servedThermal.status}, builtin=${servedThermal.body.builtin}, `
    + `version ${JSON.stringify(servedThermal.body.manifest?.version)}`);

  const setAsides = userRootHolds().filter((n) => /^thermal\..*\.incompatible$/.test(n));
  ok('and the fork is renamed aside rather than deleted, with its files exactly as they were',
    setAsides.length === 1
      && existsSync(join(USER_ROOT, setAsides[0], 'witness.marker'))
      && readFileSync(join(USER_ROOT, setAsides[0], 'manifest.json'), 'utf8').includes('f.thisjointwentaway'),
    `user root holds ${userRootHolds().join(', ') || 'empty'}`);

  // The aside is invisible to every read for the same reason a half-written install is, and
  // by the same rule: an effect id has no dot in it, so the listing drops the name and no
  // per-id route can resolve it. Asserted rather than inherited, because the suffix is new
  // and the rule it relies on is one line in a regular expression.
  const asideRead = await getJson(`/effects/${setAsides[0] ?? 'thermal.0.incompatible'}`);
  const listedAfterAside = await getJson('/effects');
  ok('and the aside is a name no read resolves and no listing carries, by the rule that hides a half-written install',
    setAsides.length === 1 && asideRead.status === 404
      && !(listedAfterAside.body.effects ?? []).some((e) => e.id.includes('.')),
    `the aside answered ${asideRead.status}, and the listing carries `
    + `${(listedAfterAside.body.effects ?? []).length} ids, none of them dotted`);

  ok('and the start said so, carrying the door\'s own sentence rather than a summary of it',
    /effect thermal was installed by an earlier build/.test(serverLog)
      && /does not assemble/.test(serverLog) && /\.incompatible/.test(serverLog),
    (serverLog.split('\n').find((l) => /^effect thermal/.test(l))
      ?? `nothing about thermal in ${serverLog.length} bytes of server log`).slice(0, 160));

  // **The row the four above exist for.** Everything so far is HTTP against a store, and a
  // store answering perfectly would still be beside the point if the surface it feeds did
  // not come up - the failure this gate is about is the assembler throwing while
  // `web/main.js` is still evaluating, which publishes no `__kinect` at all. So the last
  // thing asked is the first thing that broke, and it is asked of a browser rather than of
  // a route.
  browser = await chromium.launch();
  const bootPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const bootErrors = [];
  bootPage.on('pageerror', (e) => bootErrors.push(String(e)));
  await bootPage.goto(`${BASE}/record`, { waitUntil: 'load' }).catch(() => {});
  const booted = await bootPage.waitForFunction('Boolean(globalThis.__kinect)', null, { timeout: 20000 })
    .then(() => bootPage.evaluate(() => globalThis.__kinect.params.names().includes('thermal.amount')))
    .catch(() => null);
  ok('and a page opened on that store boots, with the shipped package in its registry - which is the failure the whole gate is about',
    booted === true,
    booted === null
      ? `no __kinect published: ${bootErrors[0]?.slice(0, 130) ?? 'nothing arrived on the page error channel'}`
      : `__kinect published, thermal.amount ${booted ? 'in' : 'missing from'} the registry`);

  // ============ 13. the process that is not going to serve does not quarantine anything
  //
  // **The gate renames directories, and it used to do it at construction - which is before
  // the port is held.** Every process that got as far as building a store ran it, including
  // one about to die on `EADDRINUSE` because a server was already serving that same root. So
  // starting a second server by hand on a machine that already had one renamed the live
  // one's packages out from under it, and it could rename a revision installed since the
  // loser started reading: a fresh, good install quarantined by a process that never
  // validated it and never answered a request.
  //
  // **The port is the lock, because the deployment already has one.** Two servers on one
  // effects root is two servers on one port, and the kernel settles that - so the gate is
  // called from inside `listen`'s callback and the loser exits having touched nothing. What
  // makes that sufficient is that everything the gate does is synchronous `fs`: the socket
  // is accepting by then, but a request handler is a callback on a later turn, so no route
  // is answered out of a store that has not been gated.
  //
  // **Its own user root, and that is the whole fixture.** The loser has to be pointed at a
  // directory holding something the gate would quarantine, and the root the winner is
  // serving has already been gated - so a second server aimed there would find nothing to
  // do and the row would pass on every build there has ever been.
  console.log('\n[effect] 13. a second server on a held port renames nothing');

  const loserRoot = join(WORK, 'effects-loser');
  rmSync(loserRoot, { recursive: true, force: true });
  const loserFork = join(loserRoot, 'thermal');
  mkdirSync(loserFork, { recursive: true });
  writeFileSync(join(loserFork, 'manifest.json'), `${JSON.stringify(doctored, null, 2)}\n`);
  writeFileSync(join(loserFork, 'heat.frag.glsl'), readFileSync(join(BUILTIN_ROOT, 'thermal/heat.frag.glsl'), 'utf8'));
  writeFileSync(join(loserFork, 'witness.marker'), 'the copy a process that never served must not touch\n');
  ok('a second effects root is staged holding a fork this build refuses, and a server is already listening on the port',
    existsSync(join(loserFork, 'witness.marker')) && readdirSync(loserRoot).join(',') === 'thermal',
    `the loser's root holds ${readdirSync(loserRoot).join(', ')}`);

  const loser = spawn(process.execPath, [
    join(WORK, 'server/index.js'), '--port', String(PORT),
    '--effects', loserRoot, '--builtin-effects', BUILTIN_ROOT,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const loserOut = [];
  loser.stdout.on('data', (c) => loserOut.push(c.toString()));
  loser.stderr.on('data', (c) => loserOut.push(c.toString()));
  // Killed rather than waited out if it somehow serves, so a build where the bind succeeded
  // is a red row and a named one rather than a run that hangs here for the rest of the day.
  let loserDeadline = null;
  const loserCode = await Promise.race([
    new Promise((done) => { loser.on('close', done); }),
    new Promise((done) => { loserDeadline = setTimeout(() => { loser.kill('SIGKILL'); done('never exited'); }, 20000); }),
  ]);
  clearTimeout(loserDeadline);
  const loserSaid = loserOut.join('');
  // The fixture's own delivery: it lost the bind rather than exiting for some other reason,
  // because a process that died on a bad flag would leave the directory alone too.
  ok('the second server loses the port and exits without serving, which is the only reason it must not have gated anything',
    loserCode !== 0 && loserCode !== 'never exited' && /EADDRINUSE/.test(loserSaid),
    `exited ${loserCode}, and its output ${/EADDRINUSE/.test(loserSaid) ? 'names EADDRINUSE' : `does not name EADDRINUSE: ${loserSaid.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 110) ?? '(nothing)'}`}`);
  // **The row the fixture exists for.** A gate that ran at construction has already renamed
  // this by the time the bind fails, so the directory is gone from its own name and an
  // `.incompatible` is sitting beside it - written by a process that never answered a
  // request and never validated what it was renaming.
  ok('and the fork in its root is exactly where it was, because a process that never held the port never gated anything',
    existsSync(join(loserFork, 'witness.marker')) && readdirSync(loserRoot).join(',') === 'thermal',
    `the loser's root holds ${readdirSync(loserRoot).join(', ') || 'nothing'}`);

  // ============ 14. a package this store is serving that this page cannot read
  //
  // **A refusal and a read error are told apart by whether asking again could answer
  // differently, and that line does not run along "the fetch worked".** A 200 carrying a
  // manifest whose `chunks` is a string is served content: the store answers exactly the
  // same thing on the next tick and the tick after it, so a page that treats it as a read
  // that did not work refetches every package every six seconds for the life of the page,
  // which is the loop the refused-signature block exists to stop.
  //
  // **Written straight into the user root while the server is up, and both halves of that
  // are the fixture.** The install door refuses this manifest, so it cannot arrive through a
  // route; the boot gate refuses it too, so it cannot survive a restart. What is left is the
  // one way a store comes to be serving it - something wrote the directory - and that is
  // also how a page meets a package written by a build that read the field differently.
  console.log('\n[effect] 14. a package the store serves and this page refuses, asked once');

  const shapeless = join(USER_ROOT, 'shapeless');
  rmSync(shapeless, { recursive: true, force: true });
  mkdirSync(shapeless, { recursive: true });
  writeFileSync(join(shapeless, 'manifest.json'), `${JSON.stringify({
    format: 1,
    id: 'shapeless',
    version: '1.0.0',
    title: 'Shapeless',
    params: {
      amount: {
        def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', label: 'shapeless',
        panel: { group: 'style', tab: 'look' }, bind: { on: 'points', uniform: 'thermal' }, role: 'master',
      },
    },
    chunks: 'this is not a list of chunks',
  }, null, 2)}\n`);
  const listedShapeless = await getJson('/effects');
  const shapelessListed = (listedShapeless.body.effects ?? []).some((e) => e.id === 'shapeless');
  // **Every driver call here is guarded, and the guard is the repair `docs/instruments.md`
  // prescribes for exactly this position.** A mutation elsewhere in this tool can leave the
  // page with no `__kinect` at all - `temporaries-are-visible` puts a half-written install in
  // the listing, so the page cannot assemble and never publishes - and an unguarded
  // `evaluate` on that page throws out of the section and ends the run, which turns three
  // rows that would have gone red into three rows nobody measured. Caught, the rows below
  // read a page that answered nothing and redden, which is the true consequence of a build
  // whose page does not come up and is a cascade rather than a truncation.
  const poll = () => bootPage.evaluate(() => globalThis.__kinect.effects.pollNow()).catch(() => {});
  await poll();
  // Waited for by the state rather than by a pause: the poll's own interval shares this
  // control with the driver, so a `pollNow` the reentrancy guard turned away leaves the row
  // below reading a page that has not tried yet. The note is what the failed rebuild writes.
  const shapelessNote = await bootPage.waitForFunction(
    "/shapeless/.test(document.getElementById('tNote')?.textContent ?? '')", null, { timeout: 20000 },
  ).then(() => bootPage.evaluate(() => document.getElementById('tNote')?.textContent ?? '')).catch(() => '');
  ok('the store is serving a package whose manifest this page refuses, and the page says so rather than adopting it',
    shapelessListed && /shapeless/.test(shapelessNote),
    `the listing ${shapelessListed ? 'carries' : 'does not carry'} shapeless, and the note reads "${shapelessNote.trim().slice(0, 90)}"`);

  // **Counted in the driver rather than read off the page**, for the reason section 9's
  // block is: what separates "no rebuild" from "no poll" is that the listing is still being
  // fetched while the package reads stay at zero. A row whose subject is an absence needs
  // something present in the same breath, or a page that had stopped polling - or crashed -
  // is the strongest evidence for it.
  let shapelessListReads = 0;
  let shapelessPackageReads = 0;
  await bootPage.route('**/effects', async (route) => { shapelessListReads += 1; await route.continue(); });
  await bootPage.route('**/effects/shapeless', async (route) => { shapelessPackageReads += 1; await route.continue(); });
  await poll();
  for (let waited = 0; waited < 20000 && shapelessListReads < 2; waited += 100) await wait(100);
  await poll();
  await wait(500);
  await bootPage.unroute('**/effects');
  await bootPage.unroute('**/effects/shapeless');
  ok('and it is not fetched again on every tick, because a body this build refuses is served content rather than a read that did not work',
    shapelessListReads >= 2 && shapelessPackageReads === 0,
    `${shapelessListReads} listings read and ${shapelessPackageReads} package reads in the window`);

  // **The other direction, and it has to be a set the page has not seen rather than the one
  // it had.** Taking the package away puts the store back at the bytes and the generation it
  // was at when this page booted, so a row asking whether the page "recovered" would be
  // asking whether it still holds what it never let go of - true on a page that had crashed
  // in the same breath. So the block is lifted by installing something instead: a revision
  // this page has not refused has to be adopted, which needs the poll running, the fetch
  // working and the rebuild landing.
  rmSync(shapeless, { recursive: true, force: true });
  const afterShapeless = await put('probe', probePackage());
  const adoptedAfter = await poll()
    .then(() => bootPage.waitForFunction(
      "globalThis.__kinect.params.names().includes('probe.amount')", null, { timeout: 20000 },
    ))
    .then(() => true).catch(() => false);
  ok('and a revision this page has not refused is still adopted afterwards, so the block is keyed to the set rather than latched on the page',
    afterShapeless.status === 200 && adoptedAfter === true,
    `${afterShapeless.status}: ${afterShapeless.body.error ?? 'installed'}, and the page `
    + `${adoptedAfter ? 'adopted it' : 'never adopted it'}`);

  await browser.close();
  browser = null;

  // ============ 15. a fork that is correct about itself and wrong about the set
  //
  // **Section 12 asks whether the gate refuses a package this build cannot assemble. This
  // asks the half that is not about the package at all.** The gate validated each candidate
  // against the packages standing beside it and never re-asked those packages afterwards, so
  // a shadow could be promoted and take one of them down: `doorRefusal` walks the
  // *candidate's* chunks for names this build has not got, and `forkRefusal` catches a fork
  // that dropped a parameter, and neither of them looks at a varying the fork stopped
  // declaring.
  //
  // So the fixture is a `rain` fork with `vRain` gone and its own two references to it edited
  // out. Nothing about the package is wrong - clean chunks, every parameter kept, the door
  // answers null - and the builtin glyph goes on reading `vRain` out of its
  // `index.frag.glsl` with nothing anywhere declaring it. The cloud program does not link,
  // `web/main.js` throws while it is still evaluating, and no `__kinect` publishes.
  //
  // **`test/effect-store-gate.test.mjs` holds the same property under bare node and this is
  // not that row twice.** That one reads directories; this one is the failure itself - a page
  // that has to come up on the store the gate settled, which is the only reading that says
  // the quarantine was for the right reason. And it is reached through the real server, with
  // the real restart, on the tree this tool staged.
  console.log('\n[effect] 15. a fork that is correct about itself and takes its neighbour down');

  await stopAll();
  for (const held of userRootHolds()) rmSync(join(USER_ROOT, held), { recursive: true, force: true });

  // The healthy fork is `glyph` and it is the package the rain fork actually breaks, which
  // makes it the one a gate with the attribution backwards would blame: it is the package
  // whose chunk the door reports the missing name against. It has to be standing at the end.
  const healthyGlyph = JSON.parse(readFileSync(join(BUILTIN_ROOT, 'glyph/manifest.json'), 'utf8'));
  healthyGlyph.version = '2.0.0';
  const glyphFork = join(USER_ROOT, 'glyph');
  mkdirSync(glyphFork, { recursive: true });
  writeFileSync(join(glyphFork, 'manifest.json'), `${JSON.stringify(healthyGlyph, null, 2)}\n`);
  for (const c of healthyGlyph.chunks ?? []) {
    writeFileSync(join(glyphFork, c.file), readFileSync(join(BUILTIN_ROOT, 'glyph', c.file), 'utf8'));
  }

  const strippedRain = JSON.parse(readFileSync(join(BUILTIN_ROOT, 'rain/manifest.json'), 'utf8'));
  strippedRain.version = '2.0.0';
  strippedRain.varyings = [];
  const rainFork = join(USER_ROOT, 'rain');
  mkdirSync(rainFork, { recursive: true });
  writeFileSync(join(rainFork, 'manifest.json'), `${JSON.stringify(strippedRain, null, 2)}\n`);
  for (const c of strippedRain.chunks ?? []) {
    const shipped = readFileSync(join(BUILTIN_ROOT, 'rain', c.file), 'utf8');
    writeFileSync(join(rainFork, c.file), c.file === 'cell.vert.glsl'
      ? shipped.replace(/^.*\bvRain\b.*$/gm, '  // the varying this fork dropped')
      : shipped.replace(/fract\(vRain\)/g, '0.5'));
  }
  writeFileSync(join(rainFork, 'witness.marker'), 'the author\'s own copy of a fork this build cannot keep\n');

  ok('a fork with nothing wrong with it and a fork that drops a varying its neighbour reads are both staged',
    existsSync(join(rainFork, 'manifest.json')) && existsSync(join(glyphFork, 'manifest.json'))
      && !/vRain/.test(readFileSync(join(rainFork, 'cell.vert.glsl'), 'utf8')),
    `user root holds ${userRootHolds().join(', ')}`);

  await start();

  const settledRain = await getJson('/effects/rain');
  ok('the fork that broke its neighbour is the one set aside, and the id answers from the shipped package again',
    settledRain.status === 200 && settledRain.body.builtin === true,
    `answered ${settledRain.status}, builtin=${settledRain.body.builtin}, `
    + `version ${JSON.stringify(settledRain.body.manifest?.version)}`);
  // **The must-accept row, and it is the one the row above is silent about.** A gate that
  // quarantined both would satisfy it: rain would answer from the builtin, and a page would
  // come up.
  const settledGlyph = await getJson('/effects/glyph');
  ok('and the fork it broke is left exactly where it was, because the package that changed is the package that goes',
    settledGlyph.status === 200 && settledGlyph.body.builtin === false
      && settledGlyph.body.manifest?.version === '2.0.0',
    `answered ${settledGlyph.status}, builtin=${settledGlyph.body.builtin}, `
    + `version ${JSON.stringify(settledGlyph.body.manifest?.version)}`);
  const rainAsides = userRootHolds().filter((n) => /^rain\..*\.incompatible$/.test(n));
  ok('the fork is renamed aside rather than deleted, with the author\'s own file still in it',
    rainAsides.length === 1 && existsSync(join(USER_ROOT, rainAsides[0], 'witness.marker')),
    `user root holds ${userRootHolds().join(', ') || 'empty'}`);
  ok('and the start said which package it could no longer assemble, rather than only which one it moved',
    /effect rain was installed by an earlier build/.test(serverLog)
      && /can no longer assemble glyph/.test(serverLog) && /vRain/.test(serverLog),
    (serverLog.split('\n').find((l) => /^effect rain/.test(l))
      ?? `nothing about rain in ${serverLog.length} bytes of server log`).slice(0, 170));

  // **The row the four above exist for**, on the same argument section 12 makes: everything
  // so far is HTTP against a store, and the failure this gate is about is the assembler
  // throwing while `web/main.js` is still evaluating. A store that answered perfectly and a
  // page that never published `__kinect` is the build this whole surface is arranged to
  // prevent.
  browser = await chromium.launch();
  const settledPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const settledErrors = [];
  settledPage.on('pageerror', (e) => settledErrors.push(String(e)));
  await settledPage.goto(`${BASE}/record`, { waitUntil: 'load' }).catch(() => {});
  const settledBoot = await settledPage.waitForFunction('Boolean(globalThis.__kinect)', null, { timeout: 20000 })
    .then(() => settledPage.evaluate(() => globalThis.__kinect.params.names().includes('rain.speed')))
    .catch(() => null);
  ok('and a page opened on the store the gate settled boots, which is the failure the whole pass is about',
    settledBoot === true,
    settledBoot === null
      ? `no __kinect published: ${settledErrors[0]?.slice(0, 130) ?? 'nothing arrived on the page error channel'}`
      : `__kinect published, rain.speed ${settledBoot ? 'in' : 'missing from'} the registry`);

  // ============ 16. the route a page uses to say what it could not compile
  //
  // **This build has no GLSL compiler and the door is not one.** A package whose chunks name
  // only identifiers this build has can still be GLSL that will not link - a missing brace, a
  // `vec3` assigned to a `float` - and what that produces is a log line inside the driver.
  // So the only thing in this program that ever learns a package cannot be compiled is a page
  // that tried, and `POST /effect-refusals` is where it says so. Section 9 is the page half of
  // this; these rows are the route's own contract, driven over HTTP, because a route that is
  // only ever exercised through its one caller is a route whose skipped and refused answers
  // nobody has read.
  console.log('\n[effect] 16. the route a page uses to say a package would not compile');

  const beforeRefuse = await getJson('/effects');
  const quarantined = await fetch(`${BASE}/effect-refusals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ['glyph', 'thermal', 'nosuchpackage'], reason: 'link failed:\n  not a compiler' }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  ok('a page naming a package it could not compile has the user copy set aside, and the id answers from the builtin again',
    quarantined.status === 200 && quarantined.body.setAside?.join(',') === 'glyph'
      && (await getJson('/effects/glyph')).body.builtin === true,
    `${quarantined.status}: set aside ${JSON.stringify(quarantined.body.setAside)}`);
  // **An id with no user copy is skipped rather than quarantined, per id.** A page that failed to
  // link has the ids it was assembling from and no reason to know which root each came out
  // of, so a 4xx over the builtin in the list would leave it unable to tell which of the
  // three went through. `setAside` renames inside the user root and nothing else, so a
  // builtin is not a rule written into the route - it is the one thing the rename cannot
  // reach.
  ok('and a builtin and a name that is nowhere are each skipped with a reason rather than refusing the whole call',
    quarantined.body.skipped?.length === 2
      && quarantined.body.skipped.every((s) => /no copy of it in the user root/.test(s.why))
      && quarantined.body.skipped.map((s) => s.id).sort().join(',') === 'nosuchpackage,thermal',
    `skipped ${JSON.stringify(quarantined.body.skipped?.map((s) => s.id))}`);
  const afterRefuse = await getJson('/effects');
  ok('the store counts it as a change of its own, because what every open page is holding a listing of has moved',
    afterRefuse.body.generation === beforeRefuse.body.generation + 1,
    `generation ${beforeRefuse.body.generation} -> ${afterRefuse.body.generation}`);
  ok('and the shipped set is all still there, so a route that renames one directory renamed one directory',
    afterRefuse.body.effects?.length === beforeRefuse.body.effects.length
      && (afterRefuse.body.effects ?? []).every((e) => e.builtin),
    `${afterRefuse.body.effects?.length ?? 'no'} packages, `
    + `${(afterRefuse.body.effects ?? []).filter((e) => !e.builtin).length} of them from the user root`);
  // The reason is a page's own sentence off the network, so it is cut and flattened before it
  // reaches a log line - a driver's link log is whatever the driver felt like emitting, and a
  // newline in it is a forged line in somebody's terminal.
  ok('the page\'s reason reaches the log as one line rather than as whatever a driver emitted',
    /a page that adopted it reports that it does not compile: link failed: not a compiler/.test(serverLog),
    (serverLog.split('\n').find((l) => /does not compile/.test(l)) ?? 'nothing in the log about it').slice(0, 150));

  const noList = await fetch(`${BASE}/effect-refusals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'x' }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const tooMany = await fetch(`${BASE}/effect-refusals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: new Array(afterRefuse.body.effects.length + 1).fill('glyph') }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  ok('a body with no list and a list longer than the store has packages are both refused by name',
    noList.status === 400 && tooMany.status === 400 && /not about this store/.test(tooMany.body.error ?? ''),
    `${noList.status} and ${tooMany.status}: ${(tooMany.body.error ?? '').slice(0, 80)}`);
  // **The route is a `write`, so it stands behind the same gate every other consequence does**,
  // and a GET has to say what it takes rather than report itself as something that is not there.
  const getRefuse = await fetch(`${BASE}/effect-refusals`);
  const getRefuseSaid = (await getRefuse.json()).error ?? '';
  const putRefuse = await fetch(`${BASE}/effect-refusals`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(probePackage()),
  });
  ok('the namespace answers for itself: a GET says what it takes, and a PUT does not install a package into it',
    getRefuse.status === 405 && /takes POST/.test(getRefuseSaid)
      && putRefuse.status === 405 && !userRootHolds().includes('effect-refusals'),
    `GET ${getRefuse.status} "${getRefuseSaid.slice(0, 70)}", PUT ${putRefuse.status}, `
    + `user root holds ${userRootHolds().join(', ') || 'nothing'}`);
  // **And the id this route used to steal is an id like any other, which is the row the move
  // out of `/effects/` exists for.** The route was `POST /effects/refuse` first, and the table
  // is walked in order, so that literal outranked the `:id` entry beside it: a package
  // genuinely called `refuse` was listed by `GET /effects` and then answered 405 when a page
  // fetched it - `readEffectPackages` throwing, no `__kinect`, both surfaces dark - and it
  // could not be uninstalled either, because the `DELETE` was 405 too. That is not the shape
  // `/jobs/claim` gets away with beside `/jobs/:id`: a job id is minted by the queue and nobody
  // can make a job called `claim`, while an effect id is a directory name and `mkdir` is the
  // whole of what it takes. Reserving the word at the door was the first repair and it is the
  // guard rather than the fix, so this asks the question the guard is about: install the
  // package, read it back, see it listed, take it away again.
  const asRefuse = await put('refuse', bent((p) => { p.manifest.id = 'refuse'; }));
  const readRefuse = await getJson('/effects/refuse');
  const listsRefuse = ((await getJson('/effects')).body.effects ?? []).some((e) => e.id === 'refuse');
  const dropRefuse = await del('refuse');
  ok('and a package genuinely called refuse installs, serves, lists and uninstalls, because nothing under /effects/ is claimed',
    asRefuse.status === 200 && readRefuse.status === 200 && readRefuse.body.manifest?.id === 'refuse'
      && listsRefuse === true && dropRefuse.status === 200 && !userRootHolds().includes('refuse'),
    `PUT ${asRefuse.status}, GET ${readRefuse.status} for id ${JSON.stringify(readRefuse.body.manifest?.id)}, `
    + `${listsRefuse ? 'listed' : 'not listed'}, DELETE ${dropRefuse.status}, `
    + `user root holds ${userRootHolds().join(', ') || 'nothing'}`);

  await browser.close();
  browser = null;
} catch (err) {
  crashed = err;
  console.log(`\n  FAIL  the run did not finish: ${err.stack ?? err.message}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopAll();
  rmSync(WORK, { recursive: true, force: true });
}

console.log(`\n[effect] ${checked} assertions, ${failed} failed`);
if (untested) {
  console.log(`[effect] UNTESTED - ${untested}.`);
  process.exit(2);
}
/**
 * **The count decides, and it decides before the crash does.**
 *
 * A mutation here can leave the page half-adopted - `install-skips-the-uniform-cells`
 * throws inside the value walk, so the registry is replaced and the panel is not - and a
 * driver reaching into that page throws in turn. The obvious verdict order puts the crash
 * first and reports DID NOT RUN over seven failed assertions that had already fired, which
 * is the exact shape `docs/instruments.md` files under a census of exit codes: a caught
 * mutation reported as a run that proved nothing, and the tool then reads as broken while
 * it is working.
 *
 * So a mutated run with failures is caught however it ended, and it says that it ended
 * early, because the rows after the crash did not run and the count is a floor rather than
 * the whole picture. A run with no failures is the other way round: crashed means DID NOT
 * RUN, and finishing cleanly means the mutation was not caught at all.
 */
if (MUTATE && failed > 0) {
  console.log(`[effect] caught, as required (${failed} assertion${failed === 1 ? '' : 's'} fired)`);
  if (crashed) console.log(`[effect] and the run ended early: ${crashed.message.split('\n')[0]} - the count is a floor`);
  console.log(`[effect] rows that fired: ${fired.join(' | ')}`);
  process.exit(1);
}
if (crashed) {
  console.log(`[effect] DID NOT RUN - ${crashed.message.split('\n')[0]}. Nothing here is a finding: re-run it.`);
  process.exit(2);
}
if (MUTATE) {
  console.log('[effect] NOT CAUGHT - the check passed a build it should have rejected');
  process.exit(1);
}
if (failed) { console.log('[effect] FAIL'); process.exit(1); }
console.log('[effect] PASS');
process.exit(0);
