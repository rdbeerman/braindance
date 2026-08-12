#!/usr/bin/env node
// The module boundaries in `web/`: that the import graph has no cycle in it, that every
// import names a file this server can serve and a binding that file exports, and that
// mutable state crosses a boundary as a live exported `let` or a setter rather than as an
// object anybody who imports it can write into. No server, no browser, no sensor and no
// dependencies - the same class as `syntax-check`, and for the same reason: every failure
// this tool is about is a failure to *boot*, so an instrument that needs the page running
// cannot see any of them.
//
//   node tools/module-check.mjs [--root <dir>] [--mutate <name>]
//
// **Why this exists at all.** `web/main.js` was one ES module of fifteen thousand lines and
// is being taken apart - 13,206 with twelve modules beside it as this line is written, and
// the number is here so a reader can tell how far in they are. A module that throws while it evaluates publishes no
// `globalThis.__kinect`, and then every tool in the suite reports DID NOT RUN with no
// assertion behind its exit code - which this repo has written down three times as a bug
// found rather than as a bug caught. An import cycle, a specifier naming a file that is
// not there, and a named import of something the other side does not export are the three
// ways a split produces exactly that, and all three are decidable from the source with
// nothing running.
//
// `web/scene.js` opens with the claim that "Nothing here imports back into this file,
// which is what keeps that order a fact rather than a convention". Until this tool that
// sentence was a convention with a paragraph in front of it. Rule 1 is what makes it a
// fact, and `--mutate cycle-planted` is the arm that says so, because it puts the very
// import that comment forbids into the file the comment is at the top of.
//
// **What rule 2 covers, and - said here rather than left to be discovered - what it does
// not.** The rule as it was posed was "no module's top-level statements reach an imported
// binding before it is initialized". For the modules under `web/` that is *entailed by
// rule 1* rather than a second question: ES modules evaluate their dependencies to
// completion before the importer's body runs, so with an acyclic graph an imported binding
// cannot be in its temporal dead zone when a top-level statement reads it. Top-level
// `await` does not change that in an acyclic graph either - the dependency still settles
// first - and a dynamic `import()` resolves against a module that has already finished. So
// what is left of the rule, and what is asserted below, is the part that is *not* implied:
// that the specifier resolves at all, that it does not escape the directory this server
// will serve, that the name imported is a name the other side exports, and that two
// spellings of one file are one node in the graph rather than two.
//
// The reach that the fifteen-thousand-line file has actually been bitten by is a different
// animal and is **not tested here**. Both faults - the comments above `groupRevealChanged`
// and `transportWriting` in `web/main.js` - are a top-level statement reaching, through a
// chain of calls, a `const` declared further down *the same module*. That is an
// intra-module dead zone, not a boundary, and following it needs the call graph:
// `params.reset()` reaches `params.set`, which reaches `spec.apply`, which is a property
// on an object in a registry. Property dispatch is not statically decidable, so a check
// that followed only calls made through a name would redden on planted toys and stay green
// on the shape that has twice shipped - the instrument that gives false confidence, which
// this repo has a document full of. It is left to the empirical arm instead: boot the page
// before and after a phase of the split and diff the post-boot state, which sees the
// silent version of the same fault as well - `params.reset()` landing before the panel
// generator has filled its Maps writes every value into the registry, reaches no control,
// throws nothing, and leaves a page whose sliders show their markup defaults.
//
// **Where the enumeration comes from.** Modules are walked out of `web/` rather than
// listed, and the pages are read for their `<script type="module">` elements, so a module
// added next year is asked by existing and a page that starts loading one is too. Both
// halves of the scope are set separately, which is the distinction `docs/instruments.md`
// draws about the grid scan: the walk is wide, and the question - is this an ES module -
// is narrow. `type="module"` is one exact spelling in the HTML specification, unlike the
// sixteen essences that mean "this is a classic script", so there is no list to keep up
// with here.
//
// **Three of the mechanisms here cannot be falsified by the subject**, and each one gets a
// tree of its own rather than an argument. The cycle detector is the first, because `web/`
// is acyclic and is meant to stay that way, so the probe carries a three-module cycle, a
// self-loop, a cycle spelled through the server's root-relative form, and a diamond that is
// *not* a cycle - the diamond being the one that matters, since a depth-first search using
// one `visited` set instead of separating "on the stack" from "finished" calls a diamond a
// cycle and fails a clean tree. The two prohibitions in rule 2 are the second: this tree has
// no dynamic `import()` and no specifier that climbs out of the directory, so both rows range
// over an empty population and a resolver that never returned either answer would print the
// same green row, which is why the probe carries one of each. Rule 3 is the third and the
// worst of them - every object `web/` exports is in the exemption table, so a planted write
// lands on an entry and comes back excused, and the tree imports nothing under a rename, a
// namespace or a default, which is three of the four ways a binding arrives. Measured on the
// version before this one: with the exemption audit's `covers` conjunct forced true, a
// `writesInto` that returned nothing and a `shapeOfInit` that answered `primitive` each left
// a clean run green at thirty assertions. Both are now asserted as exact sets over a tree
// built to hold one of every spelling. The same resolver, the same collector and the same
// rule-3 pass run over the probes and over `web/`, because an arm that exercises a second
// mechanism is measuring the second mechanism.
//
// **Every `import` and every `export` token has to be claimed by a form this scan
// understands, and one that is not is a failed assertion.** The first version read the two
// keywords with a short list of regular expressions and took whatever matched, so a
// spelling the list did not carry contributed nothing and said nothing about having
// contributed nothing - and there were three of them: `export default`, an export list
// written without its terminating semicolon, and one written indented. Measured against a
// synthetic root, a module exporting a state object as `export default { frames: 0 }` left
// the run green at its usual thirty assertions with that module contributing zero exports.
// The paragraph that used to sit here reasoned that a missed export "can only ever
// manufacture a failure, never hide one", on the argument that the importer's named-import
// row would redden - which is false whenever nothing imports the binding *by name*, and a
// default import, a namespace import and a side-effect import each guarantee exactly that.
// So the two keywords are now enumerated first and classified second, and a token no form
// claimed reddens a row naming the file and the line. A spelling nobody thought of costs an
// assertion rather than an edge.
//
// **Rule 4 is the one the first version of this tool passed a tree that was wrong.** It ran
// 57 assertions, zero failed, PASS, on a `web/main.js` carrying six imports nothing in the
// file used - `vertexShader` and `fragmentShader` from `./cloud-shader.js`, `BloomPass` from
// `./bloom-pass.js`, and `easeParam`, `easeAt` and `easeSlopeAt` from `./curve.js`. Three
// went dead when the code that used them moved out one commit after their module was made,
// and three were dead already. Nothing here saw any of them, because the two neighbouring
// questions - is this file reached at all, and does this name exist on the other side - are
// both answered yes by a dead import: the file is reached, the name is exported, and the
// declaration is a fetch and an instantiation for a binding no line reads. So rule 4 asks the
// two directions nothing else asks. **No module imports a name it does not use**, and **no
// module exports a name nothing imports**, and both halves are built out of the two things
// rule 2 already had in hand - the edge list and `exportsByModule` - which is what made the
// hole embarrassing rather than expensive.
//
// The consumer set for the second half is **the whole repository and not `web/`**, which is
// not a widening for tidiness: seven of this tree's exports have no importer inside `web/`
// at all and are read from three directories outside it. `server/library.js` imports
// `POLLED_NODE_FIELDS`, `tools/fake-grabber.mjs` and `tools/library-check.mjs` import
// `CAPTURE_FORMAT`, and four more are held only by `test/`. A row that counted `web/`
// consumers would have reddened seven honest exports on its first run, and the fix for a row
// that cries wolf is always to delete the row.
//
// **The first version of rule 4 held both halves in one run and never joined them**, and that
// is the second thing this file has passed a wrong tree over. A dead import reddened the
// import row and was then counted, further down the same run, as the reader keeping the far
// side's export alive - so the run held the two facts and printed one. Measured on the real
// tree rather than forced: at `883f070^` it reddened `web/main.js` for not reading
// `easeSlopeAt` and printed the export row green about `web/curve.js`, whose only importer
// anywhere in that checkout was that identical dead line. The export became findable only
// because a person had removed the import by hand first. So the use question is asked once,
// of every declaration that carries a name across this directory's edge wherever it is
// written, and its answer feeds both halves: a binding no line reads fails the import row and
// asks the far side for nothing. One plant of that pair reddens two rows on purpose - both
// sentences are true and each has to be fixed - which is what `dead-import-is-not-a-consumer`
// is the arm for.
//
// The same join is what put the outside walk under the use question. Fifty-five name-level
// bindings arrive from `server/`, `tools/` and `test/`, and a consumer nobody asked the
// question of cannot be trusted to be one: an export whose only importer lived outside `web/`
// and was itself dead read as asked-for, which is the six-dead-imports defect one directory
// over. A namespace binding went the same way for the same reason - it used to mark every
// export of its target consumed, which switched the export row off for `web/clip-range.js`
// entirely, so it is now narrowed to the names it actually reaches.
//
// **What the use question can still get wrong, and the two it no longer can.** It is a
// question about a name and not about a scope, so a name written in code position that is not
// a reference reads as one.
//
// A hit inside a **quoted string body** used to be the first of those. The blanking that
// removes comments keeps string bodies, because the specifier of every import lives in one
// and taking them out would take the graph with them - so the mask is asked instead of the
// text, and a hit at a string-body position is not a use. Measured over this tree: the strict
// reading takes hits off four names, `grade`, `afterimage`, `bloom` and `material`, which are
// words the quoted parameter ids say too, and leaves every swept name still read in code, so
// it closed the hole at no cost. What is *not* true, and this file said it was, is that a name
// mentioned only in a GLSL literal survived: template text is left at mask 0 by `codeMask` and
// blanked to spaces by `parse`, so the twelve hundred lines of GLSL here were never a masking
// surface, and a plant named only inside a template literal is caught with the strict reading
// and without it.
//
// A **property key** was the second, and it is decided by the two neighbours rather than by a
// lookahead: the nearest code character before the hit is `{` or `,` and the nearest after it
// is `:`. That is the object-literal key and the destructuring pattern key and nothing else -
// `case name:` has a word before it, `a ? b : c` has a `?`, `{ [name]: 1 }` has a `[`, and the
// shorthand `{ name }` has no colon at all. Measured, it takes no name off the swept set here,
// which is what makes it free in the one file that is full of registries and menu tables.
//
// What is left open is the **method shorthand**, `{ poll(gl) { ... } }`, found by a control
// coming back NOT CAUGHT: `web/main.js:9860` defines one, and it made an alias of `poll` look
// read. It is not closable by widening the rule above, and the measurement says so rather than
// the argument - excluding a hit followed by `:` or by `(` at the head of a line calls
// **twelve** live imports unused, `writeClipRange`, `tiltQuaternion` and `pollRecordState`
// among them, because a call written as its own statement is at the head of a line too.
// Telling those apart needs a scope analysis rather than a search, which is a different
// instrument. Re-measured after the two closures above: the `poll` alias still comes back NOT
// CAUGHT, so the limitation is where it was and is exactly this wide.
//
// It is a false negative, which is the direction an instrument may be wrong in: it costs a
// dead import this row does not find rather than a clean tree it fails. Naming it is the
// difference between a limitation and a hole - and a limitation belongs in a comment, never
// inside a control, where it reads as the rule not working.
//
// **Where this scan guesses, it guesses toward reporting.** Deciding what is code and what
// is a comment, a string or a regular expression is a lexer's job, and this carries a small
// one rather than a pair of regexes - the same argument, and the same shape, as `numbersIn`
// in `tools/library-check.mjs`, whose header records nine rounds of correcting a question
// about a token being asked of a character. Wrong toward reading something that is not code,
// this reports an import that is not there and fails a clean tree, which somebody sees.
// Wrong the other way it drops an edge and goes quiet, which is the direction that does not
// announce itself, so every ambiguous case is resolved toward the first.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : REPO;

// Every mutation is written in the `{ file, edits }` shape `syntax-check`'s anchor row reads,
// and every one of them is delivered by the same mechanism the clean run uses: this tool only
// ever reads source, so `read()` below is the single door and there is no second delivery to
// drift from the first. Four of them land outside `web/` - in `server/`, `tools/` and `test/`
// - which is not an exception to the subject but a consequence of it: rule 4's consumer set is
// the whole checkout, so the file that keeps an export alive, or fails to, is often not one of
// the modules under test. The table is self-contained on purpose - it references no
// neighbouring const - so the anchor row can read it by cutting the declaration alone rather
// than importing this file's prefix.
const MUTATIONS = {
  // Rule 1's control, and it plants the import `web/scene.js`'s own header says does not
  // exist. A side-effect import rather than a named one, so the only row that can go red
  // is the cycle row - a named import would additionally redden the export-name row and a
  // control that reddens two claims cannot say which question was being asked.
  'cycle-planted': {
    file: 'web/scene.js',
    edits: [["import * as THREE from 'three';", "import * as THREE from 'three';\nimport './main.js';"]],
  },

  // The same cycle written the way this server's other page writes its imports. The
  // resolver has to fold `/main.js` and `./main.js` onto one module or this edge lands on
  // a node of its own and the graph stays a tree - a cycle reported as acyclic, green, and
  // about nothing. It is a separate control from the one above rather than a second edit
  // inside it, because the two fail differently: any resolver catches the first and only
  // one that knows what the static server does with a leading slash catches this.
  'cycle-through-a-second-spelling': {
    file: 'web/scene.js',
    edits: [["import * as THREE from 'three';", "import * as THREE from 'three';\nimport '/main.js';"]],
  },

  // Rule 2's first half: a specifier naming a file that is not in the tree. The browser
  // fetches it, gets this server's 404, and the importing module never evaluates - which
  // is the no-`__kinect` signature arriving before a single line of the module has run.
  'import-of-a-missing-file': {
    file: 'web/main.js',
    edits: [["import { pollRecordState } from './record-poll.js';", "import { pollRecordState } from './record-poll-moved.js';"]],
  },

  // Rule 2's second half, and the closest thing to the "import-time reach" this tool can
  // honestly claim: a named import of a binding the other side does not export. That fails
  // at instantiation, before any module in the graph evaluates, so nothing publishes and
  // every tool in the suite reports DID NOT RUN. It is the single most likely fault when
  // one file becomes twenty, because a name moves between modules and one of its two
  // spellings gets missed.
  'import-names-a-missing-export': {
    file: 'web/main.js',
    edits: [["import { pollRecordState } from './record-poll.js';", "import { pollRecordState, pollRecorderState } from './record-poll.js';"]],
  },

  // The floor under the canonicalisation rule, which needs a control of its own because a
  // floor nobody has fired is a floor nobody has proved. Today `web/format.js` and
  // `web/record-poll.js` are each imported under two spellings - `./x.js` from `main.js`
  // and `/x.js` from `library.js` - and that is what exercises the fold. Take the second
  // spelling away and the fold is untested, which the row has to say rather than pass.
  'one-spelling-for-every-module': {
    file: 'web/library.js',
    edits: [
      ["import { DEPTH_H, DEPTH_W, VALID_ID } from '/format.js';", "import { DEPTH_H, DEPTH_W, VALID_ID } from './format.js';"],
      ["import { pollRecordState } from '/record-poll.js';", "import { pollRecordState } from './record-poll.js';"],
    ],
  },

  // Rule 3's first half: a new export that is an object literal anybody importing it can
  // write into, with nothing in the exemption table about it. This is the shape the split
  // must not reach for - a `state` object handed across a boundary is every one of the
  // thirty-four tangled bindings surviving the refactor with a dot in front of it.
  //
  // This one, and the two below it that plant the same object under a different keyword,
  // redden **two** rows since rule 4 arrived: the shape row here, and rule 4's export row,
  // because a planted export nothing imports is also a name only one end wanted. Measured
  // rather than predicted - `[module] 61 assertions, 2 failed` on each of the three. The
  // blast radius is recorded rather than removed, because both rows are true of the plant
  // and each of the two claims has a control of its own that reddens exactly one row;
  // making these plants imported somewhere would need a second edit in a second file, which
  // is more machinery for a control than the overlap costs.
  'exported-mutable-object': {
    file: 'web/format.js',
    edits: [['export const DEPTH_W = 512;', 'export const DEPTH_W = 512;\nexport const SENSOR_STATE = { frames: 0 };']],
  },

  // Rule 3's second half, from the other end: the write itself, into a binding this module
  // imported and does not own. A memo hung on somebody else's *function*, which is chosen
  // over writing into one of the objects already in the table for a reason - every object
  // this tree exports is exempted, so a plant aimed at one of those is answered by the
  // exemption and the run comes back NOT CAUGHT with the tool behaving correctly. Measured:
  // `EASE_OUT_LINEAR[0] = 1 / 3;` was the first spelling of this control and passed 30
  // assertions, because `web/curve.js::EASE_OUT_LINEAR` is exempt. Aiming at a function
  // says the sweep ranges over every name an import brings in rather than over the ones the
  // table already knows about, which is the wider claim.
  //
  // The plant hangs off `WORKING_PROJECT` rather than off anything the write is about,
  // and that is deliberate: what these three need is a top-level statement position in
  // `web/main.js` after its imports, so the anchor should be the most inert line that
  // offers one. It used to be `const POINTS = DEPTH_W * DEPTH_H;`, which moved to
  // `web/format.js` when the point cloud came out of this file - a scaffolding line
  // following the code it happened to sit next to, which is exactly why an anchor that
  // is part of what a mutation asserts is a better anchor than a convenient one.
  'imported-object-written-across-the-boundary': {
    file: 'web/main.js',
    edits: [["const WORKING_PROJECT = '__working__';", "const WORKING_PROJECT = '__working__';\nscalarAt.cache = new Map();"]],
  },

  // The same fault as the entry above under the one keyword that used to excuse it. The
  // classification asked what a binding was declared as before it asked what it held, so
  // `export let x = {}` went into the live-let bucket without the shape ever being
  // consulted and the sanctioned channel was one keyword wide. Measured on the tool as it
  // was: this plant, and a namespace import writing a property on it from another module,
  // both came back green - which is a state object crossing a boundary and being written
  // from the far end, the whole of what rule 3 exists to refuse.
  'state-crosses-as-a-live-let': {
    file: 'web/format.js',
    edits: [['export const DEPTH_H = 424;', 'export const DEPTH_H = 424;\nexport let SENSOR_STATE = { frames: 0 };']],
  },

  // And the same object again in the export form that used to contribute nothing at all.
  // Nothing has to import a default for it to be a channel, which is why the export scan
  // now enumerates the keyword rather than matching a list of shapes: measured on the tool
  // as it was, this module contributed zero exports and the run stayed green at thirty
  // assertions with the count beside it unchanged.
  'state-crosses-as-a-default': {
    file: 'web/format.js',
    edits: [['export const CAPTURE_FORMAT = 1;', 'export const CAPTURE_FORMAT = 1;\nexport default { frames: 0 };']],
  },

  // An export form the scan cannot take apart, which is what the token audit is for. A
  // destructuring declarator is legal and binds names this scan does not follow, so it is
  // named rather than silently contributing no exports - the failure being closed is a
  // spelling nobody thought of leaving the tree with less in it than the tree has.
  'export-form-nothing-claims': {
    file: 'web/format.js',
    edits: [['export const PROJECT_VERSION = 4;', 'export const PROJECT_VERSION = 4;\nexport const { major, minor } = { major: 1, minor: 0 };']],
  },

  // A barrel, refused rather than followed. Resolving one needs a second resolver - which
  // name arrives from which module, through however many hops - and the one-implementation
  // rule forbids the shape anyway, so the honest answer is to name the file.
  'a-barrel-re-export': {
    file: 'web/record-poll.js',
    edits: [["export const POLLED_NODE_FIELDS = ['writingId'];", "export const POLLED_NODE_FIELDS = ['writingId'];\nexport { DEPTH_W } from '/format.js';"]],
  },

  // The write from the far end, spelled through a namespace. Aimed at the same function
  // the control above is aimed at, and for the same reason - every object this tree exports
  // is exempted, so a plant aimed at one of those is answered by the table. Measured on the
  // tool as it was: this came back green while the unaliased spelling of the identical
  // write reddened, because the sweep read a declaration for the names on the far side and
  // a namespace import has none.
  'write-through-a-namespace': {
    file: 'web/main.js',
    edits: [
      ["import { pollRecordState } from './record-poll.js';", "import { pollRecordState } from './record-poll.js';\nimport * as recordPoll from './record-poll.js';"],
      ["const WORKING_PROJECT = '__working__';", "const WORKING_PROJECT = '__working__';\nrecordPoll.pollRecordState.cache = new Map();"],
    ],
  },

  // The same write again under a rename, which is the ordinary way a fifteen-thousand-line
  // split resolves a name collision and so the spelling most likely to appear during the
  // refactor this tool was written for. The sweep used to search for the exported name
  // while the text holds the local one, and found nothing, in silence.
  'write-through-a-rename': {
    file: 'web/main.js',
    edits: [
      ["import { pollRecordState } from './record-poll.js';", "import { pollRecordState as poll } from './record-poll.js';"],
      ["const WORKING_PROJECT = '__working__';", "const WORKING_PROJECT = '__working__';\npoll.cache = new Map();"],
    ],
  },

  // And the same write from a page's inline module, which is a module like any other and
  // was the one the sweep could not reach: an inline module's id is `page#moduleN` and the
  // sweep looked its text up in the map of files, found nothing, and skipped it while the
  // floor beside it went on counting the edge as swept.
  'write-from-a-page': {
    file: 'web/menu.html',
    edits: [[
      "const LAST_OPENED = 'kinect.lastOpened';",
      "const LAST_OPENED = 'kinect.lastOpened';\nimport { pollRecordState } from '/record-poll.js';\npollRecordState.cache = new Map();",
    ]],
  },

  // The exemption table's own rot, which is the failure an exemption list has instead of a
  // bug: what the entry was written for stops being an export, the entry goes on sitting
  // there naming nothing, and the next reader takes the list as a description of the tree.
  //
  // The keyword comes off rather than the name changing, and that is not cosmetic. Renaming
  // it was the first spelling and reddened *two* rows, because the renamed binding is then
  // an exported object with no exemption of its own - a second red row about a second fact,
  // which is the blast radius that makes a control unable to say which question it asked.
  // Un-exporting leaves the table's entry as the only thing wrong.
  'exemption-outlives-its-export': {
    file: 'web/record-poll.js',
    edits: [["export const POLLED_NODE_FIELDS = ['writingId'];", "const POLLED_NODE_FIELDS = ['writingId'];"]],
  },

  // The table's other half, and the one that had no arm at all. An entry that still names
  // a real export but no longer covers anything is the standing filter `docs/instruments.md`
  // warns about - and here it was carrying more than that, because with `web/` unable to
  // falsify either rule-3 classifier, `covers` was the only assertion left standing over
  // both of them. Measured: forcing `covers` true left every one of the eight controls
  // above still catching, and composing that forcing with a `writesInto` that returned
  // nothing, or a `shapeOfInit` that answered `primitive`, left the clean run green.
  // `exemption-outlives-its-export` cannot serve here: un-exporting the binding falsifies
  // `known` as well, and the row reports that branch instead.
  //
  // The pair is a control-point pair promoted to the number it is made of, which leaves it
  // exported, imported and read exactly as before while its shape stops being an object -
  // so the entry names something and covers nothing, and one row goes red.
  'exemption-covers-nothing': {
    file: 'web/curve.js',
    edits: [['const EASE_IN_LINEAR = [2 / 3, 2 / 3];', 'const EASE_IN_LINEAR = 2 / 3;']],
  },

  // Rule 4's first half, and it is the defect this tool shipped rather than a shape invented
  // to be caught: a name brought across a boundary that no line on this side reads. The
  // binding is a real export of the module it is asked of, so the row above stays green and
  // this control reddens one claim - which is the whole reason it is `POLLED_NODE_FIELDS`
  // rather than an invented name. `web/main.js` mentions it nowhere else, and the six that
  // shipped were each exactly this.
  'import-nothing-uses': {
    file: 'web/main.js',
    edits: [["import { pollRecordState } from './record-poll.js';", "import { pollRecordState, POLLED_NODE_FIELDS } from './record-poll.js';"]],
  },

  // The same half asked of the spelling a sweep gets wrong by looking at the wrong end of an
  // `as`. The rename leaves the far-side name written all over the file - `pollRecordState`
  // is still called below - while the binding this module actually declares is `recordPoll`
  // and nothing reads it, so a check searching for the name the import *asks for* finds
  // plenty and passes a module that will throw on its first call. `docs/instruments.md` has
  // this exact fault under "a sweep ranges over the names an import binds, not the names it
  // asks for", where it cost rule 3 three of the four ways a binding arrives.
  //
  // The alias is `recordPoll` because the first one was `poll`, and that came back NOT
  // CAUGHT: `web/main.js:9860` defines a method called `poll` in an object literal, which is
  // a name written in code position and not a reference to anything, and a use question
  // asked of a name rather than of a scope cannot tell the two apart. That is a false
  // negative this tool has and the header says so; what it must not do is sit inside a
  // control, where it reads as the rule not working.
  'import-used-under-its-far-side-name': {
    file: 'web/main.js',
    edits: [["import { pollRecordState } from './record-poll.js';", "import { pollRecordState as recordPoll } from './record-poll.js';"]],
  },

  // Rule 4's second half: a name let out of a module that nothing anywhere asks for. A
  // number rather than an object, so the rule 3 rows stay green and this reddens one claim,
  // and it sits in `web/format.js` because that is the module whose exports are read from the
  // most directions - if anything were going to answer this by accident it would be there.
  'export-nothing-imports': {
    file: 'web/format.js',
    edits: [['export const CAPTURE_FORMAT = 1;', 'export const CAPTURE_FORMAT = 1;\nexport const SENSOR_EPOCH = 0;']],
  },

  // And the half of that second question `web/` cannot ask, because the consumer that keeps
  // the export alive is outside it. `server/library.js` is the only importer of
  // `POLLED_NODE_FIELDS` anywhere, so taking the name off that one import declaration - and
  // leaving the module still imported, by the other name it exports - lets the export out to
  // nothing. It separates a join done per name from one done per module: a check that marked
  // every export of a module consumed the moment anything imported the module would read this
  // tree as unchanged and come back NOT CAUGHT.
  //
  // **Two rows, and the second one is the point.** The name this substitutes in is not read
  // by `server/library.js` either, so the import row names the dead import and the export row
  // names the export it stopped holding up. Both sentences are true about the same edit, and
  // a control that reddened only one of them would be a control for a rule 4 whose two halves
  // never met - which is exactly the version this replaced.
  'consumer-outside-web-drops-the-name': {
    file: 'server/library.js',
    edits: [["import { POLLED_NODE_FIELDS } from '../web/record-poll.js';", "import { pollRecordState } from '../web/record-poll.js';"]],
  },

  // The join itself, planted from the direction the tool shipped blind to: the import stays
  // exactly where it is and the one line that *reads* it stops. Before the two halves were
  // joined this run came back green at every row - the import row had nothing to say about a
  // file outside `web/`, and the export row counted the surviving declaration as the reader
  // keeping `POLLED_NODE_FIELDS` alive. It is the shape `883f070^` was actually in, one
  // directory over, and it reddens the same two rows for the same reason as the control above.
  'dead-import-is-not-a-consumer': {
    file: 'server/library.js',
    edits: [[
      'const missing = POLLED_NODE_FIELDS.filter((f) => body[f] === undefined);',
      "const missing = ['writingId'].filter((f) => body[f] === undefined);",
    ]],
  },

  // A dead import declared outside `web/`, where the name has other live readers so the
  // export row stays green and this reddens one claim. `tools/fake-grabber.mjs` spells
  // `DEPTH_W` nowhere, and `server/capture.js` and `web/main.js` both read it, so what is
  // wrong with the tree afterwards is one declaration in one file - which is the shape a
  // dead import has, and the shape the use question was never asked of outside `web/`.
  'outside-consumer-imports-a-name-it-never-reads': {
    file: 'tools/fake-grabber.mjs',
    edits: [["import { CAPTURE_FORMAT } from '../web/format.js';", "import { CAPTURE_FORMAT, DEPTH_W } from '../web/format.js';"]],
  },

  // The bare-specifier half of the import row, which had no arm at all: measured by forcing
  // `for (const edge of [...inTree, ...tree.bareEdges])` down to `inTree` alone, the clean run
  // stayed green at 60 assertions and every one of the twenty controls then declared still
  // caught, while the row went on printing "17 bare declarations" in its detail. So the half
  // that asks whether `OutputPass` went dead when a pass moved out was carried by a sentence
  // rather than by a check.
  //
  // Nothing resolves a bare specifier - `three` is not a file under `web/` - so the far side
  // is never consulted and the spelling of the planted name is not checked against anything.
  // A plausible pass name rather than a real one is the honest way to write that down: what is
  // being planted is a binding no line of the module reads.
  'dead-bare-import': {
    file: 'web/post-chain.js',
    edits: [[
      "import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';",
      "import { OutputPass, ClearPass } from 'three/addons/postprocessing/OutputPass.js';",
    ]],
  },

  // A name whose only occurrences in the importing module sit inside quoted strings. `main.js`
  // says `duotone` five times and every one of them is a parameter id in a string body, so
  // before the read question was asked at a code position this binding read as used and the
  // declaration came back green. A rename rather than an invented line, the same way the
  // far-side-name control is one: nothing is added to the file, and what changes is which name
  // the declaration binds.
  'import-used-only-in-a-string': {
    file: 'web/main.js',
    edits: [["import { pollRecordState } from './record-poll.js';", "import { pollRecordState as duotone } from './record-poll.js';"]],
  },

  // The same, for a name whose only occurrences are property keys. `main.js` writes `fov:` in
  // five object literals and nowhere else, which is a name in code position with no dot in
  // front of it - the shape that keeps a dead import green in the one file that is full of
  // registries and menu tables. What must not serve here is the method shorthand, `poll(gl) {`
  // at `web/main.js:9860`: measured with the alias put back to `poll`, this run comes back
  // NOT CAUGHT, and that limitation belongs in the header rather than inside a control.
  'import-used-only-as-an-object-key': {
    file: 'web/main.js',
    edits: [["import { pollRecordState } from './record-poll.js';", "import { pollRecordState as fov } from './record-poll.js';"]],
  },

  // A dead export in the one module this checkout reaches through a namespace import. Before
  // the reach was narrowed to the names it actually asks for, `test/clip-range.test.mjs`'s
  // `import * as clip` marked every export of this module consumed, so the export row was
  // switched off for the whole file and this plant read as unchanged: measured, the identical
  // line appended to `web/view-window.js` reddened the row and appended here it did not. A
  // number rather than an object, so the rule 3 rows stay green and this reddens one claim.
  'namespace-hides-a-dead-export': {
    file: 'web/clip-range.js',
    edits: [['export let clipOut = null;', 'export let clipOut = null;\nexport const CLIP_EPSILON = 1e-6;']],
  },

  // And the branch the narrowing needs to have: a reach through the namespace that names no
  // export. `Object.keys` is the ordinary spelling of it - `{ ...clip }`, `for (const k in
  // clip)` and handing the binding to a function are the same thing - and a narrowing that
  // consumed nothing for those would redden every export of the module on a tree doing
  // something legitimate. It consumes all of them, exactly as the old join did, and the row
  // says so, so a module going blind costs an assertion rather than passing in silence.
  'namespace-reach-cannot-be-named': {
    file: 'test/clip-range.test.mjs',
    edits: [[
      'const { clipBoundOrThrow, writeClipRange } = clip;',
      'const { clipBoundOrThrow, writeClipRange } = clip;\nconst reached = Object.keys(clip);',
    ]],
  },
};

// Resolved before anything is read, so a name nobody implemented costs a second rather
// than a whole walk and a verdict about the wrong thing.
const mutateAt = argv.indexOf('--mutate');
const MUTATE = mutateAt === -1 ? null : argv[mutateAt + 1];
if (mutateAt !== -1 && !MUTATIONS[MUTATE]) {
  console.log(`DID NOT RUN - no mutation named ${MUTATE ?? '(nothing was given)'}; this tool knows ${Object.keys(MUTATIONS).join(', ')}`);
  process.exit(2);
}

// The one door every read goes through, so the mutated run and the clean run differ in the
// substitution and in nothing else. An anchor that no longer matches is exit 2 and not a
// failed assertion, for the reason `docs/instruments.md` gives at length: a mutation that
// changed nothing comes back green and gets written down as the control passing.
let mutationApplied = 0;
const read = (rel) => {
  const file = join(ROOT, rel);
  if (!existsSync(file)) return null;
  let src = readFileSync(file, 'utf8');
  if (!MUTATE || MUTATIONS[MUTATE].file !== rel) return src;
  for (const [from, to] of MUTATIONS[MUTATE].edits) {
    if (!src.includes(from)) {
      console.log(`DID NOT RUN - the ${MUTATE} anchor "${from}" is not in ${rel}, so nothing was mutated and this run would prove nothing`);
      process.exit(2);
    }
    src = src.replace(from, to);
    mutationApplied++;
  }
  return src;
};

let checked = 0;
let failed = 0;
const ok = (claim, cond, detail) => {
  checked++;
  if (cond) console.log(`  ok    ${claim}${detail === undefined ? '' : ` - ${detail}`}`);
  else { failed++; console.log(`  FAIL  ${claim}${detail === undefined ? '' : ` - ${detail}`}`); }
};

// ---------- what is code and what only looks like it
//
// One pass producing two things: a mask saying what each character is, and a rewrite of the
// source with everything that is *not* code and *not* a string body blanked to spaces,
// newlines kept so every line number still means what it says.
//
// Three states rather than two, and the third one is what makes this work at all. A comment
// has to be **removed before the match**, not tested after it: `web/main.js` carries a
// paragraph containing the word `import` a few lines above a real import declaration, and a
// regular expression reaching from that word to the `from` on the declaration below matches
// leftmost-first - so the match begins inside prose, the mask says prose, the declaration is
// skipped and its edge silently leaves the graph. Measured before this was split out, and it
// cost `web/scene.js` and `web/curve.js` their edges while every row still read green. A
// string *body* is the other way round: it has to survive, because the specifier lives in
// one, so it is kept in the text and refused only as a place a match may begin.
//
// Delimiters - the quotes, the backticks, the slashes that open and close a pattern - count
// as code, so a classification that asks "what does this initializer start with" gets `'`
// for a string and `/` for a pattern and needs no second question.
//
// Template *text* is not code and template *expressions* are, which is the one place the
// two interleave; the brace depth says where a `${` ends. The `/` question - pattern or
// quotient - is decided by the previous token rather than the previous character, because
// `return /x/` ends in a letter and a letter ends a value, and reading that as division
// swallows the rest of the line. Left ambiguous is a `/` after `}`, which this reads as
// division: wrong that way a pattern's body is scanned as code and an import written inside
// one would be over-reported, which fails loudly, where the other reading skips to the next
// slash and takes real code with it.
//
// The brace depth is carried out beside the mask, recorded at every position the lexer
// stops at, which is every token start. It is what tells a keyword from a property name:
// `export` and `import` are reserved words and cannot be identifiers, but a *property* may
// be called either - `web/main.js` has `export: 'menuExport'` in a menu table and
// `export: { run: exportClip, ... }` in a surface's API, both legal and neither an export.
// A declaration is legal only at the top level of a module, so depth zero is the whole
// distinction and it is exact rather than a lookahead that has to guess at `:` and `(`.
const CODE = 1;
const STRING_BODY = 2;
const codeMask = (src) => {
  const mask = new Uint8Array(src.length);
  const depths = new Uint16Array(src.length);
  const stack = [];
  const inTemplate = () => stack[stack.length - 1]?.kind === 'template';
  const ID_START = /[\p{ID_Start}$_]/u;
  const ID_PART = /[\p{ID_Continue}$\u200C\u200D]/u;
  const REGEX_AFTER = new Set(['return', 'throw', 'case', 'yield', 'typeof', 'instanceof',
    'in', 'of', 'delete', 'void', 'new', 'do', 'else', 'await']);
  let depth = 0;
  let prev = '';
  let prevWord = '';
  let i = 0;
  const code = (from, to) => { for (let k = from; k < to; k++) mask[k] = 1; };
  while (i < src.length) {
    const c = src[i];
    depths[i] = depth;
    if (inTemplate()) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); mask[i] = 1; prev = '`'; prevWord = ''; i++; continue; }
      if (c === '$' && src[i + 1] === '{') {
        stack.push({ kind: 'code', depth });
        depth++;
        code(i, i + 2);
        prev = '{';
        prevWord = '';
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      mask[i] = 1;
      i++;
      const from = i;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      for (let k = from; k < i && k < src.length; k++) mask[k] = STRING_BODY;
      mask[i] = 1;
      i++;
      prev = c;
      prevWord = '';
      continue;
    }
    if (c === '`') { stack.push({ kind: 'template' }); mask[i] = 1; i++; prevWord = ''; continue; }
    if (ID_START.test(String.fromCodePoint(src.codePointAt(i)))) {
      let j = i;
      while (j < src.length) {
        const letter = String.fromCodePoint(src.codePointAt(j));
        if (!ID_PART.test(letter)) break;
        j += letter.length;
      }
      code(i, j);
      prevWord = src.slice(i, j);
      prev = 'a';
      i = j;
      continue;
    }
    // Transparent to the value question in both positions, which is what stops
    // `counter++ / 2` reading as a pattern and swallowing the line.
    if ((c === '+' || c === '-') && src[i + 1] === c) { code(i, i + 2); i += 2; continue; }
    if (c === '/' && (!/[\w$)\]}'"`]/.test(prev) || REGEX_AFTER.has(prevWord))) {
      mask[i] = 1;
      i++;
      let klass = false;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') klass = true;
        else if (src[i] === ']') klass = false;
        else if (src[i] === '/' && !klass) break;
        else if (src[i] === '\n') break;
        i++;
      }
      mask[i] = 1;
      i++;
      // A finished pattern is a value, so the next slash is a quotient.
      prev = ')';
      prevWord = '';
      continue;
    }
    if (c === '{') { depth++; mask[i] = 1; prev = c; prevWord = ''; i++; continue; }
    if (c === '}') {
      depth--;
      const top = stack[stack.length - 1];
      mask[i] = 1;
      if (top?.kind === 'code' && top.depth === depth) { stack.pop(); prevWord = ''; i++; continue; }
      prev = c;
      prevWord = '';
      i++;
      continue;
    }
    mask[i] = 1;
    if (!/\s/.test(c)) { prev = c; prevWord = ''; }
    i++;
  }
  return { mask, depths };
};

// The text every scan below runs over: code and string bodies as written, everything else a
// space, and newlines kept so a line number taken here is a line number in the file.
const parsed = new Map();
const parse = (src) => {
  if (parsed.has(src)) return parsed.get(src);
  const { mask, depths } = codeMask(src);
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = mask[i] === 0 ? (src[i] === '\n' ? '\n' : ' ') : src[i];
  }
  const answer = { scan: out.join(''), mask, depths };
  parsed.set(src, answer);
  return answer;
};

const lineAt = (src, index) => src.slice(0, index).split('\n').length;

// **The one cross-check on the brace counter**, and it is here because the filter it guards
// replaced a loud failure with a quiet one. Depth is what tells a declaration from a
// property called `export`, and depth comes from counting `{` and `}` in code position - so
// a counter that drifts once makes every later top-level keyword in that file read as
// nested, and a keyword that reads as nested is skipped without a row, because it never
// reaches the audit that would have named it. The drift is not hypothetical: this lexer
// leaves one case ambiguous on purpose, a `/` after `}`, which it reads as division, and
// this tree carries twelve hundred lines of GLSL in template literals - 900 of them in
// `web/cloud-shader.js` and 183 in `web/post-chain.js` - and a great many patterns for that
// to land in. Every top-level declaration in this tree is written at
// column zero and no property key is, so a keyword at column zero that depth calls nested is
// the counter having shifted, and it is reported rather than dropped.
const atColumnZero = (src, index) => index === 0 || src[index - 1] === '\n';

// ---------- what a module imports
//
// Static declarations and re-exports, plus a dynamic `import()` whose specifier is a
// literal - all three are edges in the graph, and a dynamic one whose specifier is not a
// literal is reported rather than skipped, because a specifier nothing can read is a node
// this graph does not contain and would not know it was missing.
//
// **A declaration is read for the bindings it makes, not for a list of names**, and that
// distinction is the whole of what the write sweep in rule 3 can see. `{ a as b }` names
// `a` over there and binds `b` here; `* as ns` binds one object whose properties are the
// other module's exports; `import d from` binds the other module's `default` under a name
// of this module's choosing. The first version kept only the far-side spelling, which is
// correct for asking whether the target exports the name and wrong for everything else -
// it hands the sweep a binding the importing file does not contain, and the sweep then
// searches for a name that is not in the text and finds nothing. Measured, each against the
// unaliased spelling of the identical write which the sweep does redden: a rename on
// import, a namespace import and a default import all came back green.
const IMPORT_RE = /\bimport\s*(?:([^'";()]*?)\bfrom\s*)?(['"])([^'"]*)\2/g;
const REEXPORT_RE = /\bexport\s+([^'";]*?)\bfrom\s*(['"])([^'"]*)\2/g;
const DYNAMIC_RE = /\bimport\s*\(\s*(?:(['"])([^'"]*)\1)?/g;
// The two keywords, counted so a form no parse below claimed can be named rather than
// dropped. `import.meta` is the one occurrence of the word that opens no declaration.
const IMPORT_TOKEN_RE = /(?<![.\w$])import\b/g;
const IMPORT_META_RE = /(?<![.\w$])import\s*\.\s*meta\b/g;

/**
 * The bindings an import clause makes: everything between `import` and `from`.
 *
 * `imported` is the name on the far side - the one the target has to export - and `local`
 * is the name this module's own text uses. They differ under `as`, and for a namespace
 * import there is no far-side name at all, only an object whose properties are every
 * export the target has.
 */
const clauseBindings = (raw) => {
  const out = [];
  let rest = (raw ?? '').trim();
  if (!rest) return out;
  const named = /\{([\s\S]*?)\}/.exec(rest);
  if (named) {
    for (const part of named[1].split(',').map((p) => p.trim()).filter(Boolean)) {
      const [imported, local = imported] = part.split(/\s+as\s+/).map((p) => p.trim());
      if (!imported || !local) continue;
      out.push({ imported, local, kind: imported === 'default' ? 'default' : 'named' });
    }
    rest = `${rest.slice(0, named.index)} ${rest.slice(named.index + named[0].length)}`;
  }
  const ns = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(rest);
  if (ns) {
    out.push({ imported: '*', local: ns[1], kind: 'namespace' });
    rest = `${rest.slice(0, ns.index)} ${rest.slice(ns.index + ns[0].length)}`;
  }
  // Whatever is left of the clause is the default binding, which is written bare.
  for (const part of rest.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (/^[A-Za-z_$][\w$]*$/.test(part)) out.push({ imported: 'default', local: part, kind: 'default' });
  }
  return out;
};

/**
 * The bindings a re-export clause names, which is a different question with the same
 * syntax: `export { a as b } from './x'` asks the target for `a` and binds nothing here,
 * so there is a far-side name to check and no local name to sweep. `export *` names
 * nothing at all and is refused by a row of its own rather than resolved.
 */
const reexportBindings = (raw) => {
  const text = (raw ?? '').trim();
  if (/^\*/.test(text)) return [{ imported: '*', local: null, kind: 'star' }];
  return clauseBindings(text).map((b) => ({ ...b, local: null }));
};

const importsIn = (source) => {
  const { scan: src, mask, depths } = parse(source);
  const out = [];
  const claimed = new Set();
  for (const [re, bindingsOf] of [[IMPORT_RE, clauseBindings], [REEXPORT_RE, reexportBindings]]) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      if (mask[m.index] !== CODE) continue;
      if (re === IMPORT_RE) claimed.add(m.index);
      out.push({
        spec: m[3],
        bindings: bindingsOf(m[1]),
        line: lineAt(src, m.index),
        dynamic: false,
        // Where the declaration itself sits, which rule 4 needs and nothing else does: a
        // binding's local name is written inside its own import clause, so a search for a
        // use that ran over the whole file would find the declaration and call every import
        // used. The span is the clause and the specifier together, from the keyword to the
        // closing quote.
        span: [m.index, m.index + m[0].length],
      });
    }
  }
  DYNAMIC_RE.lastIndex = 0;
  for (const m of src.matchAll(DYNAMIC_RE)) {
    if (mask[m.index] !== CODE) continue;
    claimed.add(m.index);
    out.push({ spec: m[2] ?? null, bindings: [], line: lineAt(src, m.index), dynamic: true, span: [m.index, m.index + m[0].length] });
  }
  IMPORT_META_RE.lastIndex = 0;
  for (const m of src.matchAll(IMPORT_META_RE)) if (mask[m.index] === CODE) claimed.add(m.index);
  const unclaimed = [];
  const drifted = [];
  IMPORT_TOKEN_RE.lastIndex = 0;
  for (const m of src.matchAll(IMPORT_TOKEN_RE)) {
    if (mask[m.index] !== CODE) continue;
    // The two forms that are legal below the top level - `import()` and `import.meta` -
    // are claimed above wherever they sit, so an unclaimed token inside braces is a
    // property called `import` rather than a declaration nothing read. Unless it is at
    // column zero, which no property key in this tree is and which a declaration always
    // is: see `atColumnZero` below for what that case means.
    if (depths[m.index] !== 0) {
      if (!claimed.has(m.index) && atColumnZero(src, m.index)) drifted.push(lineAt(src, m.index));
      continue;
    }
    if (!claimed.has(m.index)) unclaimed.push(lineAt(src, m.index));
  }
  return { imports: out, unclaimed, drifted };
};

// ---------- where a specifier points
//
// Root-relative throughout, because that is what this server does with a path: `PAGES`
// aside, `filePath = join(WEB_DIR, urlPath)` in `server/index.js` is the whole of the
// static mapping, so `/format.js` is `web/format.js` and nothing else. `./format.js`
// resolves against the importing module's own directory the way the browser does. Both
// spellings land on the same node, which is the whole reason the fold is asserted below
// rather than assumed.
const resolveSpec = (spec, from) => {
  if (spec === null) return { kind: 'unreadable' };
  if (!spec.startsWith('.') && !spec.startsWith('/')) return { kind: 'bare' };
  const base = spec.startsWith('/') ? [] : from.split('/').slice(0, -1);
  const parts = [...base];
  for (const part of spec.replace(/^\//, '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (parts.length === 0) return { kind: 'escapes' }; parts.pop(); continue; }
    parts.push(part);
  }
  return { kind: 'in-tree', path: parts.join('/') };
};

// ---------- the graph, and the cycles in it
//
// Three colours rather than one `visited` set. With one set a diamond - two paths from the
// same module onto the same dependency - reads as a cycle, which would fail a clean tree
// and is exactly what the probe below is built to catch.
//
// A ring is a list of **edges** rather than of modules, and it is reported with the
// specifier each edge was written as. Naming the members alone would make the two cycle
// controls indistinguishable in a sweep log - both plant the same ring and differ only in
// how the closing edge is spelled, which is the entire question the second one asks.
const cyclesIn = (edges) => {
  const out = new Map();
  const bySource = new Map();
  for (const e of edges) {
    if (!bySource.has(e.from)) bySource.set(e.from, []);
    bySource.get(e.from).push(e);
  }
  const state = new Map();
  const nodeStack = [];
  // `edgeStack[i]` is the edge this walk took out of `nodeStack[i]`, so the ring that
  // closes onto a node still on the stack is that node's slice of it plus the closing edge.
  const edgeStack = [];
  const visit = (node) => {
    state.set(node, 'open');
    nodeStack.push(node);
    for (const edge of bySource.get(node) ?? []) {
      if (state.get(edge.to) === 'open') {
        const at = nodeStack.indexOf(edge.to);
        const ring = [...edgeStack.slice(at), edge];
        const key = ringText(ring);
        if (!out.has(key)) out.set(key, ring);
      } else if (!state.has(edge.to)) {
        edgeStack.push(edge);
        visit(edge.to);
        edgeStack.pop();
      }
    }
    nodeStack.pop();
    state.set(node, 'done');
  };
  for (const node of new Set([...bySource.keys(), ...edges.map((e) => e.to)])) {
    if (!state.has(node)) visit(node);
  }
  return [...out.values()];
};

const ringText = (ring, prefix = '') => ring
  .map((e) => `${prefix}${e.from} -> ${prefix}${e.to} via ${JSON.stringify(e.spec)}`)
  .join(', ');

// ---------- what a module declares and what it lets out
//
// The four modules already out of `main.js` export through a trailing `export { ... }`
// list, so an exported name has to be resolved back to its own declaration before anything
// can be said about its shape - and that resolution is where a scanner slip silently
// reclassifies something, which is why the classification is printed per bucket rather
// than summarised as a verdict.
const DECLARATION_RE = /^(?:export\s+)?(?:(const|let|var)\s+([A-Za-z_$][\w$]*)|(?:async\s+)?(function)\s*\*?\s*([A-Za-z_$][\w$]*)|(class)\s+([A-Za-z_$][\w$]*))/gm;
// The keyword itself. Nothing below matches an export *form* until this has found the
// token, so the set of forms is enumerable and a form nothing recognises is a failed
// assertion rather than a name that quietly never existed. `export` is a reserved word and
// cannot be an identifier, but a *property* may be called anything: the lookbehind refuses
// `obj.export` and the brace depth refuses `{ export: 'menuExport' }`, which `web/main.js`
// has twice and which is a legal object rather than an export nobody read.
const EXPORT_TOKEN_RE = /(?<![.\w$])export\b/g;

// What the value of a binding is, from the first thing its initializer starts with. A
// primitive cannot carry state across a boundary; a function or a class is behaviour; a
// frozen object cannot be written into. Everything else - a literal, a constructed
// instance, a pattern, or the result of a call this cannot see inside - is an object
// somebody can write a property onto, and gets classified as one. That last case is the
// guess, and it guesses toward reporting.
const shapeOfInit = (src, from, to) => {
  let i = from;
  while (i < to && /\s/.test(src[i])) i++;
  if (i >= to) return 'unset';
  const rest = src.slice(i, to);
  if (/^Object\s*\.\s*freeze\s*\(/.test(rest)) return 'frozen';
  if (/^(?:async\s+)?function\b/.test(rest) || /^class\b/.test(rest)) return 'behaviour';
  if (/^(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(rest)) return 'behaviour';
  if (/^(?:new|await)\b/.test(rest)) return 'object';
  const c = src[i];
  if (c === '{' || c === '[' || c === '/') return 'object';
  if (c === "'" || c === '"' || c === '`') return 'primitive';
  if (/[\d.]/.test(c)) return 'primitive';
  if (/^(?:true|false|null|undefined|NaN|Infinity)\b/.test(rest)) return 'primitive';
  return 'object';
};

const declarationsIn = (src, mask) => {
  const out = new Map();
  DECLARATION_RE.lastIndex = 0;
  for (const m of src.matchAll(DECLARATION_RE)) {
    if (mask[m.index] !== CODE) continue;
    const kind = m[1] ?? m[3] ?? m[5];
    const name = m[2] ?? m[4] ?? m[6];
    if (out.has(name)) continue;
    let shape = 'behaviour';
    if (m[1]) {
      // From the `=` to the `;` that ends the statement at depth zero. A declaration list
      // with two declarators would take the first one's initializer; none exists in `web/`
      // and one added later would be classified by its first name, which over-reports the
      // shape rather than under-reporting it.
      let i = m.index;
      let depth = 0;
      let eq = -1;
      let end = src.length;
      for (; i < src.length; i++) {
        if (mask[i] !== CODE) continue;
        const c = src[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === '=' && depth === 0 && eq === -1 && src[i + 1] !== '=' && src[i + 1] !== '>') eq = i + 1;
        else if (c === ';' && depth === 0) { end = i; break; }
      }
      shape = eq === -1 ? 'unset' : shapeOfInit(src, eq, end);
    }
    out.set(name, { kind, shape, line: lineAt(src, m.index) });
  }
  return out;
};

/**
 * The declarators of one `const`/`let`/`var` statement, split at the commas that are at
 * depth zero, each with the shape of its own initializer.
 *
 * Written out rather than left to the declaration scan above, which keys on the first name
 * of a statement: `export const a = 1, b = {};` exports two names and the scan that took
 * the first would have said one, silently, which is the direction this tool does not
 * accept anywhere else.
 */
const declaratorsIn = (src, mask, from, to) => {
  const out = [];
  const cuts = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    if (mask[i] !== CODE) continue;
    const c = src[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { cuts.push([start, i]); start = i + 1; }
  }
  cuts.push([start, to]);
  for (const [a, b] of cuts) {
    const head = /^\s*([A-Za-z_$][\w$]*)\s*/.exec(src.slice(a, b));
    // A destructuring declarator binds names this scan does not take apart. Reported as a
    // form it cannot classify rather than skipped, which is the loud direction.
    if (!head) { out.push({ name: null, shape: null, line: lineAt(src, a), text: src.slice(a, b).trim() }); continue; }
    let eq = -1;
    let d = 0;
    for (let i = a + head[0].length; i < b; i++) {
      if (mask[i] !== CODE) continue;
      const c = src[i];
      if ('([{'.includes(c)) d++;
      else if (')]}'.includes(c)) d--;
      else if (c === '=' && d === 0 && src[i + 1] !== '=' && src[i + 1] !== '>') { eq = i + 1; break; }
    }
    out.push({ name: head[1], shape: eq === -1 ? 'unset' : shapeOfInit(src, eq, b), line: lineAt(src, a + head[0].indexOf(head[1])) });
  }
  return out;
};

/**
 * Everything a module lets out, by walking the `export` keyword and asking what follows it.
 *
 * The five forms are the five the language has: a declaration, a list, a list with a
 * `from` on it, a star, and a default. Anything else comes back in `unclaimed` and reddens
 * a row, because the failure this replaced was a form that matched no regular expression
 * in the list and therefore contributed nothing at all - a module with no exports, which
 * every row downstream reads as a module with nothing to say about it.
 */
const exportsOf = (source) => {
  const { scan: src, mask, depths } = parse(source);
  const declared = declarationsIn(src, mask);
  const out = [];
  const unclaimed = [];
  const drifted = [];
  const tokens = [];
  EXPORT_TOKEN_RE.lastIndex = 0;
  for (const m of src.matchAll(EXPORT_TOKEN_RE)) {
    if (mask[m.index] !== CODE) continue;
    if (depths[m.index] !== 0) {
      if (atColumnZero(src, m.index)) drifted.push(lineAt(src, m.index));
      continue;
    }
    tokens.push(m.index);
  }
  // A statement runs to the `;` that closes it at depth zero, and never past the next
  // `export` keyword - a bound that costs nothing where the semicolons are written and
  // stops one omitted semicolon swallowing the rest of the file.
  const statementEnd = (from, ceiling) => {
    let depth = 0;
    for (let i = from; i < ceiling; i++) {
      if (mask[i] !== CODE) continue;
      const c = src[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ';' && depth === 0) return i;
    }
    return ceiling;
  };
  const braceEnd = (from) => {
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      if (mask[i] !== CODE) continue;
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return src.length;
  };
  for (let t = 0; t < tokens.length; t++) {
    const at = tokens[t];
    const ceiling = tokens[t + 1] ?? src.length;
    const line = lineAt(src, at);
    let i = at + 'export'.length;
    while (i < src.length && /\s/.test(src[i])) i++;
    const rest = src.slice(i, ceiling);
    const decl = /^(const|let|var)\s+/.exec(rest);
    if (decl) {
      const end = statementEnd(i, ceiling);
      for (const d of declaratorsIn(src, mask, i + decl[0].length, end)) {
        if (d.name === null) { unclaimed.push(`${line} (a destructuring declarator this scan does not take apart: ${d.text.slice(0, 40)})`); continue; }
        out.push({ name: d.name, local: d.name, kind: decl[1], shape: d.shape, line: d.line, form: 'declaration' });
      }
      continue;
    }
    const fn = /^(?:(?:async\s+)?function\s*\*?\s*|class\s+)([A-Za-z_$][\w$]*)/.exec(rest);
    if (fn) {
      out.push({ name: fn[1], local: fn[1], kind: /^class\b/.test(rest) ? 'class' : 'function', shape: 'behaviour', line, form: 'declaration' });
      continue;
    }
    if (/^default\b/.test(rest)) {
      const from = i + 'default'.length;
      out.push({ name: 'default', local: null, kind: 'default', shape: shapeOfInit(src, from, statementEnd(from, ceiling)), line, form: 'default' });
      continue;
    }
    if (rest.startsWith('{')) {
      const close = braceEnd(i);
      const after = src.slice(close + 1, ceiling);
      const from = /^\s*from\s*['"]([^'"]*)['"]/.exec(after);
      for (const part of src.slice(i + 1, close).split(',').map((p) => p.trim()).filter(Boolean)) {
        const [local, exported = local] = part.split(/\s+as\s+/).map((p) => p.trim());
        if (!local || !exported) continue;
        if (from) { out.push({ name: exported, local: null, kind: null, shape: null, line, form: 're-export', spec: from[1] }); continue; }
        out.push({ name: exported, local, ...(declared.get(local) ?? { kind: null, shape: null, line }), form: 'list' });
      }
      continue;
    }
    if (rest.startsWith('*')) {
      const as = /^\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(rest);
      const spec = /from\s*['"]([^'"]*)['"]/.exec(rest.slice(0, statementEnd(i, ceiling) - i));
      out.push({ name: as ? as[1] : '*', local: null, kind: null, shape: null, line, form: 're-export', spec: spec ? spec[1] : null, star: true });
      continue;
    }
    unclaimed.push(`${line} (export ${rest.slice(0, 24).replace(/\s+/g, ' ').trim()})`);
  }
  return { names: out, unclaimed, drifted };
};

// ---------- who writes into somebody else's object
//
// An assignment, a compound assignment, an increment or a `delete` reaching a property or
// an element of a binding this module imported. A method call is not this - `scene.add`,
// `renderer.setSize` and `VALID_ID.test` are the APIs those objects publish - so the
// question is narrowed to a write, which is the thing an importer is not entitled to make.
//
// A local binding shadowing an imported name inside a function would be attributed to the
// import here, which is the over-reporting direction and fails loudly.
const OPS = String.raw`(?:\+\+|--|=(?![=>])|\+=|-=|\*=|\/=|%=|\*\*=|\?\?=|\|\|=|&&=|<<=|>>=|>>>=|&=|\|=|\^=)`;
// An identifier is legal JavaScript and a regular expression is not the same language: `$`
// is an anchor and every name in this tree is allowed to contain one. A name spelled into a
// pattern unescaped anchors at the end of the string instead of matching, which finds
// nothing and says nothing about having found nothing - the silent direction. One helper
// rather than three spellings, because every sweep below builds its pattern from a name.
const rxName = (name) => name.replace(/\$/g, '\\$');
const writesInto = (source, name) => {
  const { scan: src, mask } = parse(source);
  const member = String.raw`(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]\n]*\])`;
  const re = new RegExp(String.raw`(?<![.\w$])${rxName(name)}(?:${member})+\s*${OPS}`, 'g');
  const hits = [];
  for (const m of src.matchAll(re)) {
    if (mask[m.index] !== CODE) continue;
    hits.push(lineAt(src, m.index));
  }
  const del = new RegExp(String.raw`(?<![.\w$])delete\s+${rxName(name)}(?:${member})+`, 'g');
  for (const m of src.matchAll(del)) {
    if (mask[m.index] !== CODE) continue;
    hits.push(lineAt(src, m.index));
  }
  return [...new Set(hits)].sort((a, b) => a - b);
};

/**
 * The same question asked through a namespace import, which is where the far-side name
 * lives in the *first* property rather than in the binding: `ns.state.frames = 1` is a
 * write into the target's `state`, and the sweep that only knew how to look at a binding
 * saw a write into `ns` and had nothing to say about which export it landed on.
 *
 * A computed reach - `ns[whichever].frames = 1` - names an export this scan cannot decide,
 * and is reported under `*`, which no exemption can hold, so it fails rather than passes.
 */
const writesThroughNamespace = (source, ns) => {
  const { scan: src, mask } = parse(source);
  const member = String.raw`(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]\n]*\])`;
  const found = new Map();
  const note = (name, line) => {
    if (!found.has(name)) found.set(name, new Set());
    found.get(name).add(line);
  };
  // Zero members is `ns.state = x`, which a module namespace refuses at run time and is a
  // write across the boundary either way, so it is reported under the same name.
  const named = new RegExp(String.raw`(?<![.\w$])${rxName(ns)}\s*\.\s*([A-Za-z_$][\w$]*)(?:${member})*\s*${OPS}`, 'g');
  for (const m of src.matchAll(named)) {
    if (mask[m.index] !== CODE) continue;
    note(m[1], lineAt(src, m.index));
  }
  const deleted = new RegExp(String.raw`(?<![.\w$])delete\s+${rxName(ns)}\s*\.\s*([A-Za-z_$][\w$]*)(?:${member})+`, 'g');
  for (const m of src.matchAll(deleted)) {
    if (mask[m.index] !== CODE) continue;
    note(m[1], lineAt(src, m.index));
  }
  const computed = new RegExp(String.raw`(?<![.\w$])${rxName(ns)}\s*\[[^\]\n]*\](?:${member})*\s*${OPS}`, 'g');
  for (const m of src.matchAll(computed)) {
    if (mask[m.index] !== CODE) continue;
    note('*', lineAt(src, m.index));
  }
  return [...found.entries()].map(([name, lines]) => ({ name, lines: [...lines].sort((a, b) => a - b) }));
};

// ---------- the exemptions, each with the reason it is one
//
// Keyed on the module that owns the binding, so an exemption follows the declaration rather
// than the import site. Every entry has to still name something this tree exports **and**
// still cover something a rule flagged: an entry that names nothing is a list rotting, and
// an entry that covers nothing is the standing filter `docs/instruments.md` warns about -
// indistinguishable from a filter that has quietly stopped removing the thing it was
// written for. `--mutate exemption-outlives-its-export` is the arm for the first half.
const EXEMPTIONS = [
  {
    module: 'web/scene.js',
    binding: 'renderer',
    why: "three.js's own renderer. Configuring it - the drawing buffer, the pixel ratio, where its canvas sits - is the interface three.js publishes, and there is no setter-shaped alternative that is not a wrapper around the same writes.",
  },
  {
    module: 'web/scene.js',
    binding: 'scene',
    why: 'The scene graph. `scene.add(cloud)` is the publication channel three.js defines, and a scene nobody may add to is not a scene.',
  },
  {
    module: 'web/scene.js',
    binding: 'freeCamera',
    why: 'A three.js camera. Its pose and its field of view are written by the navigation and by the sensor view, which is what a camera object is for.',
  },
  {
    module: 'web/scene.js',
    binding: 'programCamera',
    why: 'The same, for the camera the transport poses from program time rather than from a hand.',
  },
  {
    module: 'web/scene.js',
    binding: 'viewCamera',
    // Not here to make a row green: this is the one binding the shape-before-keyword order
    // newly reached, and it is one of the two cameras above rather than a fourth kind of
    // thing. The live `let` is still doing its job - `useViewCamera` moves it and no
    // importer can - and what the entry declares is the half a `let` was never covering.
    why: 'Whichever of the two cameras above the viewport is drawing, moved by `useViewCamera` because an importer cannot assign to what it imports. The binding is live and the object it holds is a three.js camera, which is exactly what the two entries above say is the channel.',
  },
  {
    module: 'web/scene.js',
    binding: 'controls',
    why: 'OrbitControls, built after the canvas exists. Damping and `enabled` are switched by the surfaces that take the pointer over, which is the only way that library offers.',
  },
  {
    module: 'web/scene.js',
    binding: 'worldTilt',
    why: 'A three.js Quaternion carrying the levelling rotation. Four surfaces read it and the plane fit writes it, and three.js maths objects are written in place by design - `setFromEuler` returns the same object.',
  },
  {
    module: 'web/scene.js',
    binding: 'WORLD_UP',
    why: 'A three.js Vector3 naming the room vertical. Read-only in practice and a constant by intent, but a Vector3 cannot be frozen without breaking every three.js call that takes one as scratch.',
  },
  {
    module: 'web/scene.js',
    binding: 'DEFAULT_POSE',
    why: 'The pose a camera reset returns to, built by a call this scan cannot see inside. Copied out of rather than written into, and it is here because the classification guesses toward reporting rather than because a write was found.',
  },
  {
    module: 'web/format.js',
    binding: 'POINTS',
    // Not an object at all, and it is the first export in `web/` whose initializer is
    // neither a literal nor a constructor - so it is the first to land on `shapeOfInit`'s
    // last line, which answers `object` for anything it cannot place. That default is the
    // deliberate one this file's header describes: guessing toward reporting fails a clean
    // tree, where guessing the other way drops the binding out of the sweep in silence.
    // Closing the class properly means teaching the classifier that arithmetic over
    // identifiers is a number, which is a new branch in an instrument and wants its own
    // control and its own commit rather than a line inside a module extraction.
    why: 'The product of `DEPTH_W` and `DEPTH_H`, which is a number. Nothing writes it and nothing could - it is here because an initializer that opens on an identifier falls to this scan\'s report-rather-than-drop default, the same reason `web/scene.js::DEFAULT_POSE` is listed.',
  },
  {
    module: 'web/format.js',
    binding: 'VALID_ID',
    why: 'A regular expression with no `g` or `y` flag, so it carries no `lastIndex` between calls and there is no state in it to share.',
  },
  {
    module: 'web/curve.js',
    binding: 'EASE_OUT_LINEAR',
    why: 'A two-element control-point pair, read as a constant by every caller. An array literal rather than two exported numbers because it is passed straight into the easing functions as a pair.',
  },
  {
    module: 'web/curve.js',
    binding: 'EASE_IN_LINEAR',
    why: 'The same pair for the other side of a segment.',
  },
  {
    module: 'web/record-poll.js',
    binding: 'POLLED_NODE_FIELDS',
    why: 'The list of node fields a poll compares, read by `server/library.js` to decide which ones a manifest must carry. A list, iterated and never written.',
  },
  {
    module: 'web/export-sizes.js',
    binding: 'EXPORT_SIZES',
    why: 'Every output resolution the product offers, grouped by ratio. The whole point of the file is that this is one list rather than two - the menu, the ratio buttons and the export all read it and none of them writes it, and a build that wanted a different size would be adding an entry here rather than assigning one at run time.',
  },
  {
    module: 'web/view-window.js',
    binding: 'TICK_STEPS',
    why: 'The ladder a ruler picks its spacing from, in seconds. Searched with `find` by the one function that builds ticks and written by nothing - the property the array carries is that every rung divides the one above it, which a build wanting different gradations would change here rather than assign at run time.',
  },
  {
    module: 'web/plan-geometry.js',
    binding: 'INSET',
    why: 'Where the top-down inset sits and how big it is, in stage pixels. Read by the rect it is built into and by the stats overlay stacked under it; a literal that has never been written since the plan view was drawn.',
  },
  {
    module: 'web/plan-geometry.js',
    binding: 'TOP_CENTRE',
    why: 'The world x/z the plan view is centred on. Read by the two directions of the same coordinate change and by nothing else, and a pair of numbers rather than a point because it is not a place in three dimensions.',
  },
  // The four passes below are one entry repeated, and the reason they are four entries is
  // that an exemption follows a binding rather than a kind. Each is a three.js `Pass`, and
  // `enabled` plus whatever uniforms the pass declares is the whole of the interface that
  // library publishes - the same argument as `web/scene.js`'s renderer and cameras above.
  // Wrapping them would put the registry inside `post-chain.js`: every one of these writes
  // is a look parameter's `apply`, which reads a slider, decides whether its pass is worth
  // running and writes both in one line, and a setter per term would be that registry
  // spelled twice. `composer` deliberately has no entry - nothing writes a property on it,
  // only calls its methods, and an exemption covering nothing is the standing filter the
  // audit below refuses.
  {
    module: 'web/post-chain.js',
    binding: 'renderPass',
    why: "three.js's own RenderPass. `camera` is repointed by the one function that decides which of the two cameras the viewport draws, which is what that field is for.",
  },
  {
    module: 'web/post-chain.js',
    binding: 'afterimage',
    why: 'The trails pass. `enabled` and `uniforms.damp` are written by the trails parameter\'s apply, together and in one line, because a damp of zero is a pass not worth running.',
  },
  {
    module: 'web/post-chain.js',
    binding: 'bloom',
    why: 'The glow. `strength` and `enabled` are written by the bloom parameter the same way, and `setSize` is called by `resize` with what `bloomChainSize` answers.',
  },
  {
    module: 'web/post-chain.js',
    binding: 'grade',
    why: 'The one combined grade pass. Eight look parameters write their term into `uniforms` and four of them gate `enabled` on whether any term is up, which is the reason the pass is one rather than four.',
  },
  // The one entry in this table that is not a three.js object with a published interface,
  // and the only one that needed arguing rather than citing. A uniform is a cell the GPU
  // reads: `uniforms.pointSize.value = v` is not state leaking out of the module that owns
  // it, it is the sole mechanism three.js offers for telling a shader anything, and a
  // parameter written any other way reaches no pixel. Roughly seventy of the registry's
  // `apply` closures are one such write, so a setter per term would be the registry spelled
  // twice - and the second spelling is the thing that drifts, which is the fault this rule
  // exists to prevent rather than a shape it should force.
  //
  // The other three exports of that module deliberately have no entry. `geometry`, `material`
  // and `cloud` are reached only through their own methods - `setDrawRange`, `copy`,
  // `toArray` - so the sweep flags none of them, and an entry naming one would name a real
  // export while covering nothing, which is the standing filter `--mutate
  // exemption-covers-nothing` is the arm for.
  {
    module: 'web/point-cloud.js',
    binding: 'uniforms',
    why: "The cloud's uniform table. A uniform is a cell the GPU reads and writing `.value` on one is the whole of the interface three.js publishes for driving a shader, so the registry's look parameters land here directly; the alternative is a setter per parameter, which is the registry declared a second time in the module it drives.",
  },
];

// ---------- the walk
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const WEB = join(ROOT, 'web');
if (!existsSync(WEB) || !existsSync(join(ROOT, 'package.json'))) {
  console.log(`DID NOT RUN - ${ROOT} has no web/ or no package.json, so this is not a checkout of this repo`);
  process.exit(2);
}

console.log('[module] the modules under web/, and the pages that start them');

const files = walk(WEB).map((p) => relative(WEB, p).split('\\').join('/')).sort();
const jsFiles = files.filter((f) => /\.m?js$/.test(f));
const htmlFiles = files.filter((f) => /\.html$/.test(f));

// A page's module scripts. `type="module"` is one exact spelling in the HTML specification
// and is matched case-insensitively, which is the whole of the rule - unlike the sixteen
// MIME essences that mean "classic script", there is no list here to fall behind.
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ATTR = (attrs, name) => {
  const m = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};

// One reader for a page, so the probe below finds its inline module the same way the tree
// does rather than through a second copy of this loop.
const scriptsIn = (page, html) => {
  const entries = [];
  const inline = [];
  SCRIPT_RE.lastIndex = 0;
  let n = 0;
  for (const m of html.matchAll(SCRIPT_RE)) {
    const type = (ATTR(m[1], 'type') ?? '').trim().toLowerCase();
    if (type !== 'module') continue;
    const src = ATTR(m[1], 'src');
    if (src) entries.push({ page, spec: src, line: lineAt(html, m.index) });
    else inline.push({ id: `${page}#module${n++}`, page, body: m[2], line: lineAt(html, m.index) });
  }
  return { entries, inline };
};

const sources = new Map();
for (const rel of jsFiles) sources.set(rel, read(`web/${rel}`));

const inlineModules = [];
const entryPoints = [];
const pageText = new Map();
let moduleScripts = 0;
for (const page of htmlFiles) {
  const html = read(`web/${page}`);
  pageText.set(page, html);
  const { entries, inline } = scriptsIn(page, html);
  moduleScripts += entries.length + inline.length;
  entryPoints.push(...entries);
  inlineModules.push(...inline);
}

ok('the walk found the modules web/ ships', jsFiles.length > 0, `${jsFiles.length}: ${jsFiles.join(', ')}`);
ok('and the pages that start them', htmlFiles.length > 0, `${htmlFiles.length}: ${htmlFiles.join(', ')}`);
ok('and every page was read for its module scripts, so a page that starts one is asked by existing',
  moduleScripts > 0, `${moduleScripts} script elements of type=module, ${entryPoints.length} with a src and ${inlineModules.length} inline`);

// ---------- rule 1: the import graph over web/ has no cycle in it
console.log('\n[module] rule 1: the relative-import graph is acyclic');

// Everything one walk produces, in one object, so the probe below can be walked by the
// same function rather than by a copy of it that agrees with it today.
const newSink = () => ({
  edges: [], bareSpecs: [], unresolved: [], escaping: [], unreadable: [], unclaimedImports: [],
  drifted: [], spellings: new Map(), relativeSpecs: 0, dynamicSeen: 0, staticDeclarations: 0,
  // An import of a package rather than of a file. It is not an edge in this graph - the
  // graph is about `web/` - but the bindings it makes are declared in a module under `web/`
  // and can go dead exactly the way an in-tree one can, so rule 4's use question is asked of
  // `OutputPass` and `FullScreenQuad` on the same footing as of anything else.
  bareEdges: [],
  // Every import declaration in a body, by the id an edge names its source with. A local
  // name is written inside its own clause, so rule 4 has to blank all of them before it can
  // ask whether a name is read anywhere - and all of them rather than the one declaration
  // under the question, because two imports of one name from two modules would otherwise
  // each be a use of the other.
  importSpans: new Map(),
});
// The populations the prohibitions below range over, **counted where the walk happens**
// rather than filtered out of a collection afterwards, and the distinction is not
// bookkeeping. The write sweep's floor was `inTree.filter(e => e.names.length).length`,
// computed over every in-tree edge while the sweep itself skipped the edges whose importing
// text it did not hold - so a page's inline module was never swept and the number said
// seven where six were swept, which reads in a log as the sweep having widened. A floor
// that over-counts its own population is worse than no floor at all, and the only repair
// that closes the class rather than the instance is to increment at the point of the work.
//
// One collector for a module's body and for a page's inline module, because two of them
// drift: the first version wrote the inline case out a second time and left it out of the
// sweep. `inline` is the one honest difference between them - a page has as many base URLs
// as `PAGES` gives it, `index.html` being served at `/record`, `/edit` and `/program`, so a
// relative specifier written inside an inline module resolves against the routing rather
// than against the tree and this tool has no honest answer for it. An absolute path has
// exactly one.
const collect = (fromId, src, sink, known, { inline = false } = {}) => {
  const { imports, unclaimed, drifted } = importsIn(src);
  for (const line of unclaimed) sink.unclaimedImports.push(`${fromId}:${line}`);
  for (const line of drifted) sink.drifted.push(`${fromId}:${line} import`);
  for (const imp of imports) {
    if (imp.dynamic) sink.dynamicSeen++;
    else sink.staticDeclarations++;
    if (!sink.importSpans.has(fromId)) sink.importSpans.set(fromId, []);
    sink.importSpans.get(fromId).push(imp.span);
    if (imp.spec !== null && imp.spec.startsWith('.')) sink.relativeSpecs++;
    if (inline && imp.spec !== null && imp.spec.startsWith('.')) {
      sink.unresolved.push(`${fromId}:${imp.line} ${imp.spec} (relative, and an inline module has no single base URL)`);
      continue;
    }
    const where = resolveSpec(imp.spec, fromId);
    if (where.kind === 'bare') {
      sink.bareSpecs.push(`${fromId}:${imp.line} ${imp.spec}`);
      sink.bareEdges.push({ from: fromId, to: null, spec: imp.spec, line: imp.line, bindings: imp.bindings });
      continue;
    }
    if (where.kind === 'unreadable') { sink.unreadable.push(`${fromId}:${imp.line}`); continue; }
    if (where.kind === 'escapes') { sink.escaping.push(`${fromId}:${imp.line} ${imp.spec}`); continue; }
    if (!known.has(where.path)) sink.unresolved.push(`${fromId}:${imp.line} ${imp.spec}`);
    if (!sink.spellings.has(where.path)) sink.spellings.set(where.path, new Set());
    sink.spellings.get(where.path).add(imp.spec);
    sink.edges.push({ from: fromId, to: where.path, spec: imp.spec, line: imp.line, bindings: imp.bindings });
  }
};

// Every text this run holds, keyed the way an edge names its source, so the sweep in rule 3
// has a body for every edge rather than a body for the ones that happen to be files. The
// pages are in here as well as their inline modules: a page's own edge is its
// `<script src>`, which binds nothing and so sweeps to nothing, but an edge whose text this
// map does not hold is a hole in the sweep's population and the row below says there are
// none rather than quietly walking past two of them.
const bodies = new Map(sources);
for (const inline of inlineModules) bodies.set(inline.id, inline.body);
for (const [page, html] of pageText) bodies.set(page, html);

const tree = newSink();
const { edges, bareSpecs, unresolved, escaping, unreadable, unclaimedImports, spellings } = tree;
for (const [rel, src] of sources) collect(rel, src, tree, sources);
for (const inline of inlineModules) collect(inline.id, inline.body, tree, sources, { inline: true });
for (const entry of entryPoints) {
  const where = resolveSpec(entry.spec, entry.page);
  if (where.kind !== 'in-tree' || !sources.has(where.path)) {
    unresolved.push(`${entry.page}:${entry.line} ${entry.spec} (a page's own module script)`);
    continue;
  }
  if (!spellings.has(where.path)) spellings.set(where.path, new Set());
  spellings.get(where.path).add(entry.spec);
  edges.push({ from: entry.page, to: where.path, spec: entry.spec, line: entry.line, bindings: [], entry: true });
}

const inTree = edges.filter((e) => sources.has(e.to));
ok('the graph ranges over real edges rather than passing on an empty one',
  inTree.length > 0, `${inTree.length} in-tree edges, ${bareSpecs.length} bare specifiers left outside it`);

const cycles = cyclesIn(edges);
ok('no module under web/ imports its way back to itself',
  cycles.length === 0,
  cycles.length === 0
    ? `${new Set(edges.map((e) => e.from)).size} importers over ${sources.size} modules`
    : cycles.map((ring) => ringText(ring, 'web/')).join(' | '));

// A module nothing loads and nothing imports is a file that got left behind by a move, and
// after a split of fifteen thousand lines that is the ordinary accident rather than an
// exotic one.
const reachable = new Set();
const reach = (node) => {
  if (reachable.has(node)) return;
  reachable.add(node);
  for (const e of edges) if (e.from === node) reach(e.to);
};
for (const entry of entryPoints) reach(entry.page);
for (const inline of inlineModules) reach(inline.id);
const orphans = [...sources.keys()].filter((rel) => !reachable.has(rel));
ok('and every module under web/ is reached from a page, directly or through another module',
  orphans.length === 0 && reachable.size > 0,
  orphans.length ? `nothing loads ${orphans.map((o) => `web/${o}`).join(', ')}` : `${[...sources.keys()].length} modules, all reached`);

// ---------- the detector, over shapes web/ does not have
//
// `web/` is acyclic and is meant to stay that way, so nothing in the tree can falsify the
// detector. The tree is built instead and walked by the same collector and searched by the
// same search, asserting the exact rings rather than membership - a search that reported one
// cycle where there are three would pass a membership test.
//
// The two prohibitions in rule 2 are here for a second reason. `web/` holds no dynamic
// `import()` at all and no specifier that climbs out of the directory, so both rows range
// over an empty population on the real tree and a `resolveSpec` that never returned either
// answer would print the identical green row. They are one file each here, so the branch
// that decides them fires on every run.
{
  const probe = mkdtempSync(join(tmpdir(), 'module-check-probe-'));
  try {
    mkdirSync(join(probe, 'nested'), { recursive: true });
    const write = (name, body) => writeFileSync(join(probe, name), body);
    write('a.js', "import { b } from './b.js';\n");
    write('b.js', "import { c } from './nested/c.js';\n");
    write('nested/c.js', "import { a } from '../a.js';\n");
    write('self.js', "import './self.js';\n");
    write('d1.js', "import './d2.js';\nimport './d3.js';\n");
    write('d2.js', "import './d4.js';\n");
    write('d3.js', "import './d4.js';\n");
    write('d4.js', 'export const leaf = 1;\n');
    write('x.js', "import '/y.js';\n");
    write('y.js', "import './x.js';\n");
    // A file whose only `import` lines are inside a comment and a template, which is what
    // separates a scan that knows what code is from one that greps for a keyword.
    write('quiet.js', "// import './a.js';\nconst doc = `\\nimport './b.js';\\n`;\nexport const quiet = doc;\n");
    // A dynamic import whose specifier is a literal, which is an edge, beside one whose
    // specifier is a name, which is a node this graph does not contain and cannot know it
    // is missing. `import.meta` sits with them because it is the one place the keyword
    // opens no declaration at all and the token audit has to know that.
    write('dyn.js', "const which = './b.js';\nimport(which);\nimport('./a.js');\nexport const where = import.meta.url;\n");
    write('out.js', "import '../outside.js';\n");
    // A declaration this scan cannot read, which is what a form nobody thought of looks
    // like from in here. The prohibition it fires would otherwise range over an empty
    // population on every tree that exists, since every form the language has today is
    // claimed - and a prohibition nothing has ever made fire is a branch nobody has run.
    write('unread.js', 'import { a } from 0;\n');

    const probeFiles = walk(probe).map((p) => relative(probe, p).split('\\').join('/')).sort();
    const probeSources = new Map(probeFiles.map((rel) => [rel, readFileSync(join(probe, rel), 'utf8')]));
    const probeSink = newSink();
    for (const [rel, src] of probeSources) collect(rel, src, probeSink, probeSources);
    const probeEdges = probeSink.edges;
    const rings = cyclesIn(probeEdges).map((r) => ringText(r)).sort();
    ok('the search finds a three-module ring, a self-loop and a ring spelled through the server root, and calls the diamond acyclic',
      rings.length === 3
      && rings.includes('a.js -> b.js via "./b.js", b.js -> nested/c.js via "./nested/c.js", nested/c.js -> a.js via "../a.js"')
      && rings.includes('self.js -> self.js via "./self.js"')
      && rings.includes('x.js -> y.js via "/y.js", y.js -> x.js via "./x.js"'),
      rings.join(' | ') || 'no cycle found at all');
    ok('and the diamond contributes edges rather than a ring, so the search is not a single visited set',
      probeEdges.some((e) => e.from === 'd2.js' && e.to === 'd4.js')
      && probeEdges.some((e) => e.from === 'd3.js' && e.to === 'd4.js')
      && !rings.some((r) => r.includes('d4.js')),
      `${probeEdges.length} edges over ${probeFiles.length} probe files`);
    ok('and an import written inside a comment or a template is not an edge',
      !probeEdges.some((e) => e.from === 'quiet.js'),
      probeEdges.filter((e) => e.from === 'quiet.js').map((e) => e.to).join(', ') || 'none, as required');
    ok('and a dynamic import() is read: the literal one is an edge and the one whose specifier is a name is refused as unreadable',
      probeSink.dynamicSeen === 2
      && probeEdges.some((e) => e.from === 'dyn.js' && e.to === 'a.js' && e.spec === './a.js')
      && probeSink.unreadable.length === 1 && probeSink.unreadable[0].startsWith('dyn.js:'),
      `${probeSink.dynamicSeen} dynamic imports, unreadable: ${probeSink.unreadable.join(', ') || 'none, which is the failure this row exists for'}`);
    ok('and a specifier that climbs out of the tree is refused rather than resolved to a path outside it',
      probeSink.escaping.length === 1 && probeSink.escaping[0].startsWith('out.js:'),
      probeSink.escaping.join(', ') || 'nothing escaped, so the branch that decides it never ran');
    ok('and the one import keyword no form claimed is named, while import.meta and a dynamic import beside it are not',
      probeSink.unclaimedImports.length === 1 && probeSink.unclaimedImports[0].startsWith('unread.js:'),
      `${probeSink.unclaimedImports.join(', ') || 'nothing was named, so the branch that names it never ran'} - over ${probeSink.staticDeclarations} declarations and ${probeSink.dynamicSeen} dynamic imports`);
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

// ---------- rule 2: an import names something that will be there
console.log('\n[module] rule 2: every import resolves, and names something the other side exports');

ok('every relative or root-relative specifier names a file this tree holds',
  unresolved.length === 0, unresolved.length ? unresolved.join('; ') : `${inTree.length} checked`);
ok('and every import keyword in the tree opened a form this scan claimed rather than one it walked past',
  unclaimedImports.length === 0,
  unclaimedImports.length
    ? unclaimedImports.join('; ')
    : `none unclaimed, over ${tree.staticDeclarations} declarations and ${tree.dynamicSeen} dynamic imports`);
ok('and none of them escapes web/, which this server answers 403 for rather than serving',
  escaping.length === 0, escaping.length ? escaping.join('; ') : `none, over ${tree.relativeSpecs} relative specifiers`);
ok('and no dynamic import() carries a specifier nothing can read, which would be a node outside this graph',
  unreadable.length === 0, unreadable.length ? unreadable.join('; ') : `none, over ${tree.dynamicSeen} dynamic import${tree.dynamicSeen === 1 ? '' : 's'} - a prohibition this tree has an empty population for, which is why the probe above carries one of each`);

// The fold that lets `./format.js` and `/format.js` be one node has to be exercised by the
// tree or it is a mechanism nothing measures. Today `web/format.js` and
// `web/record-poll.js` are each imported both ways, which is what makes the canonicalisation
// load-bearing rather than decorative.
const folded = [...spellings.entries()].filter(([, s]) => s.size > 1);
ok('at least one module is imported under two spellings, so the fold onto one node is exercised rather than assumed',
  folded.length > 0,
  folded.length
    ? folded.map(([path, s]) => `web/${path} as ${[...s].join(' and ')}`).join('; ')
    : 'every module is imported one way only, so a resolver that folded nothing would pass this run');

const exportsByModule = new Map();
const unclaimedExports = [];
for (const [rel, src] of sources) {
  const { names, unclaimed, drifted } = exportsOf(src);
  exportsByModule.set(rel, names);
  for (const u of unclaimed) unclaimedExports.push(`web/${rel}:${u}`);
  for (const d of drifted) tree.drifted.push(`web/${rel}:${d} export`);
}
// A page's inline module can carry the keyword too, and an export nothing can import is
// dead either way - but it is read here so the audit ranges over every text this run holds
// rather than over the ones that are files.
for (const inline of inlineModules) {
  const { unclaimed, drifted } = exportsOf(inline.body);
  for (const u of unclaimed) unclaimedExports.push(`${inline.id}:${u}`);
  for (const d of drifted) tree.drifted.push(`${inline.id}:${d} export`);
}

const missingNames = [];
let importedBindings = 0;
let bindingDeclarations = 0;
for (const edge of inTree) {
  const has = new Set((exportsByModule.get(edge.to) ?? []).map((e) => e.name));
  let any = false;
  for (const b of edge.bindings) {
    // A namespace binds the whole module object and names nothing on the far side, so
    // there is nothing here for it to get wrong. The write sweep is where it is asked.
    if (b.kind === 'namespace' || b.kind === 'star') continue;
    importedBindings++;
    any = true;
    if (!has.has(b.imported)) {
      missingNames.push(`web/${edge.from}:${edge.line} imports ${b.kind === 'default' ? 'the default of' : b.imported} from`
        + ` web/${edge.to}, which does not export ${b.kind === 'default' ? 'one' : 'it'}`);
    }
  }
  if (any) bindingDeclarations++;
}
ok('every named import is a name the module it comes from exports',
  missingNames.length === 0 && importedBindings > 0,
  missingNames.length
    ? missingNames.join('; ')
    : `${importedBindings} bindings across ${bindingDeclarations} declarations`);

ok('and every export keyword in the tree opened a form this scan claimed, so a spelling nobody thought of costs an assertion rather than an export',
  unclaimedExports.length === 0,
  unclaimedExports.length
    ? unclaimedExports.join('; ')
    : `none unclaimed, over ${[...exportsByModule.values()].reduce((n, l) => n + l.length, 0)} exported names`);

// A barrel is refused rather than followed. Resolving one would need a second resolver -
// which name arrives from which module, through however many hops - and this repo's
// one-implementation rule forbids the shape anyway, so the honest answer is to name the
// file. The rows above would otherwise read a re-exported name as a binding with no
// declaration, which is a true sentence about the wrong fault.
const barrels = [];
for (const [rel, list] of exportsByModule) {
  for (const e of list) {
    if (e.form !== 're-export') continue;
    barrels.push(`web/${rel}:${e.line} re-exports ${e.star ? '*' : e.name}${e.spec ? ` from ${e.spec}` : ''}`);
  }
}
ok('and no module re-exports another module\'s binding, which is the barrel the one-implementation rule refuses',
  barrels.length === 0,
  barrels.length ? barrels.join('; ') : `none, over ${[...exportsByModule.values()].reduce((n, l) => n + l.length, 0)} exported names`);

// The audit above decides "declaration or property key" by brace depth, so a brace counter
// that drifted would skip a real declaration without a row - a quieter version of exactly
// the fault the audit was written to close. Column zero is the cross-check: every top-level
// declaration in this tree is written there and no property key is.
ok('and no import or export written at column zero was read as nested, which is what a drifted brace counter looks like',
  tree.drifted.length === 0,
  tree.drifted.length ? tree.drifted.join('; ') : `none, over ${sources.size} modules and ${inlineModules.length} inline module${inlineModules.length === 1 ? '' : 's'}`);

console.log('  note  the intra-module dead zone is NOT tested here - a top-level statement reaching, through property dispatch,');
console.log('        a const declared further down the same module is not statically decidable, and this tool needs nothing.');
console.log('        That is the fault the comments above groupRevealChanged and transportWriting in web/main.js record, and');
console.log('        it belongs to the post-boot state diff rather than to a source scan. See the header for why.');

// ---------- rule 3: what crosses a boundary, and in what
console.log('\n[module] rule 3: mutable state crosses as a live let or a setter, never as a writable object');

/**
 * Both halves of rule 3 over one tree: which exports are objects an importer can write
 * into, and which modules write into a binding they did not declare.
 *
 * A function taking its tree as an argument rather than a block reading the tree above,
 * because `web/` cannot falsify either half - every object it exports is in the exemption
 * table, so a plant aimed at one is answered by the table, and the classifier and the sweep
 * were both left standing on the exemption audit's `covers` conjunct as their only control.
 * Measured: with `covers` forced true, a `writesInto` returning nothing and a `shapeOfInit`
 * answering `primitive` each left a clean run green at thirty assertions. The probe below
 * runs this same function over a tree built to hold one of every spelling, so both are
 * falsified on every run instead.
 */
const rule3 = ({ bodies: text, edges: graph, exportsByModule: exported, exemptions, prefix }) => {
  const exempt = new Map(exemptions.map((e) => [`${e.module}::${e.binding}`, e]));
  const used = new Set();
  const buckets = { primitive: 0, behaviour: 0, 'live-let': 0, frozen: 0, exempted: 0, 're-exported': 0, unresolved: 0 };
  const writable = [];
  const crossWrites = [];
  const skipped = [];
  let totalExports = 0;
  let sweptBindings = 0;
  let sweptDeclarations = 0;
  for (const [rel, list] of exported) {
    for (const e of list) {
      totalExports++;
      const key = `${prefix}${rel}::${e.name}`;
      if (e.form === 're-export') { buckets['re-exported']++; continue; }
      if (e.kind === null) { buckets.unresolved++; writable.push({ key, text: `${key} is exported with no declaration this scan could find, so nothing here knows what crosses` }); continue; }
      if (e.kind === 'function' || e.kind === 'class' || e.shape === 'behaviour') { buckets.behaviour++; continue; }
      if (e.shape === 'primitive') { buckets.primitive++; continue; }
      if (e.shape === 'frozen') { buckets.frozen++; continue; }
      // **The shape decides before the keyword does**, and the order is the whole of the
      // claim this row makes. The first version asked the keyword first and let every
      // `export let x = {}` into the live-let bucket without ever consulting the shape - so
      // the sanctioned channel was one keyword wide and a state object went across it with
      // no entry saying why, which is the shape the split must not reach for. A live `let`
      // is sanctioned because an importer cannot *assign* to what it imports; it says
      // nothing about the object the binding currently holds, and writing a property on
      // that object is the same fault under a different keyword.
      if (e.shape === 'object') {
        if (exempt.has(key)) { buckets.exempted++; used.add(key); continue; }
        writable.push({
          key,
          text: `${key} is ${e.kind === 'default' ? 'the default export,' : `a ${e.kind}`} holding an object (${prefix}${rel}:${e.line}), and no exemption declares why that is the channel`,
        });
        continue;
      }
      // What is left is a binding with no initializer to read - `let controls;`, assigned
      // once the canvas exists. The binding is the sanctioned channel and the object it
      // ends up holding is invisible to a scan of its declaration, so it is the sweep below
      // that has to carry it. That sentence was written before the sweep could see a
      // rename, a namespace or a default import, which is to say it was false when written.
      if (e.kind === 'let' || e.kind === 'var') { buckets['live-let']++; continue; }
      if (exempt.has(key)) { buckets.exempted++; used.add(key); continue; }
      writable.push({ key, text: `${key} is a ${e.kind} this scan reads as ${e.shape} (${prefix}${rel}:${e.line}), and no exemption declares why that is the channel` });
    }
  }
  for (const edge of graph) {
    const src = text.get(edge.from);
    // An edge whose importing text this run does not hold is a hole in the population, and
    // a hole that reduces a count silently is how the inline-module case stayed unswept.
    if (src === undefined) { skipped.push(`${prefix}${edge.from}:${edge.line} -> ${prefix}${edge.to}`); continue; }
    let any = false;
    for (const b of edge.bindings) {
      if (!b.local) continue;
      sweptBindings++;
      any = true;
      const direct = b.kind === 'namespace' ? null : writesInto(src, b.local);
      const hits = b.kind === 'namespace'
        ? writesThroughNamespace(src, b.local)
        : (direct.length ? [{ name: b.imported, lines: direct }] : []);
      for (const hit of hits) {
        const key = `${prefix}${edge.to}::${hit.name}`;
        if (exempt.has(key)) { used.add(key); continue; }
        const how = b.kind === 'namespace'
          ? `reaches through the namespace ${b.local} it imports from`
          : `imports${b.local === b.imported ? '' : ` as ${b.local}`} from`;
        crossWrites.push({
          from: edge.from,
          to: edge.to,
          name: hit.name,
          text: `${prefix}${edge.from} writes into ${hit.name === 'default' ? 'the default export of' : hit.name}, which it ${how} ${prefix}${edge.to}, at ${hit.lines.join(', ')}`,
        });
      }
    }
    if (any) sweptDeclarations++;
  }
  return { buckets, writable, crossWrites, skipped, used, totalExports, sweptBindings, sweptDeclarations };
};

/**
 * What each exemption is still doing: naming an export this tree has, and covering
 * something a rule flagged. The second conjunct is the one with teeth - an entry that
 * covers nothing is the standing filter `docs/instruments.md` warns about, and it is also
 * the only thing standing over both classifiers when the tree cannot falsify them.
 */
const auditExemptions = (entries, exported, used, prefix, moduleExists) => entries.map((entry) => {
  const key = `${entry.module}::${entry.binding}`;
  const rel = entry.module.startsWith(prefix) ? entry.module.slice(prefix.length) : entry.module;
  const known = (exported.get(rel) ?? []).some((e) => e.name === entry.binding);
  const covers = used.has(key);
  const said = entry.why.trim().length > 0;
  return {
    key,
    pass: known && covers && said,
    detail: !moduleExists(entry.module)
      ? `${entry.module} is gone, so this entry is about a module that no longer exists`
      : !known
        ? `${entry.module} no longer exports ${entry.binding}, so this entry names nothing`
        : !covers
          ? 'nothing was flagged that it exempts, so it is a filter that would go on covering whatever matched it next'
          : entry.why.slice(0, 96),
  };
});

const r3 = rule3({ bodies, edges: inTree, exportsByModule, exemptions: EXEMPTIONS, prefix: 'web/' });
ok('the classification ranges over the exports this tree has rather than passing on an empty set',
  r3.totalExports > 0,
  `${r3.totalExports} exports: ${Object.entries(r3.buckets).map(([k, v]) => `${v} ${k}`).join(', ')}`);
ok('no module exports a writable object without an exemption saying why that is the channel',
  r3.writable.length === 0, r3.writable.length ? r3.writable.map((w) => w.text).join('; ') : 'none');
ok('and every in-tree edge was swept from a body this run holds, so the count below is what was walked',
  r3.skipped.length === 0,
  r3.skipped.length ? r3.skipped.join('; ') : `${bodies.size} bodies for ${inTree.length} edges, none skipped`);
ok('and no module writes a property or an element of a binding it imported, outside the same table',
  r3.crossWrites.length === 0,
  r3.crossWrites.length
    ? r3.crossWrites.map((c) => c.text).join('; ')
    : `${r3.sweptBindings} bindings across ${r3.sweptDeclarations} declarations swept`);

ok('the exemption table has entries in it, so the two rows above are not exempting everything by holding nothing',
  EXEMPTIONS.length > 0, `${EXEMPTIONS.length} entries`);
for (const verdict of auditExemptions(EXEMPTIONS, exportsByModule, r3.used, 'web/', (m) => existsSync(join(ROOT, m)))) {
  ok(`the exemption for ${verdict.key} still names an export this tree has, and still covers something`,
    verdict.pass, verdict.detail);
}

// ---------- rule 3, over the spellings web/ does not have
//
// Everything above ran over a tree that cannot falsify any of it. `web/` exports seven
// objects and all seven are in the table, so a planted write lands on an exemption and
// comes back excused; it exports nothing as a default and imports nothing under a rename or
// a namespace, so three of the four ways a binding arrives are never exercised; and both
// classifiers were therefore standing on the exemption audit's `covers` conjunct as their
// only control. This is the tree where all of that fires, and it is asserted as **exact
// sets** rather than as counts, because a sweep that flagged four things where these five
// are would pass any floor.
{
  const S = [
    'export default { frames: 0 };',
    'export let live = { n: 0 };',
    'export const cursor = { at: 0 };',
    'export const sealed = Object.freeze({ a: 1 });',
    'export const count = 3;',
    'export function fn() { return count; }',
    'const HANDLE = { a: 1 };',
    // No terminating semicolon and an alias on the way out, which is the export form the
    // first scan read as no exports at all.
    'export { HANDLE as handle }',
    '',
  ].join('\n');
  const W = [
    "import d from './s.js';",
    "import * as ns from './s.js';",
    "import { handle as h, count, cursor } from './s.js';",
    'd.frames = 1;',
    'ns.live.n = 2;',
    'h.a = 3;',
    'ns.fn.memo = 4;',
    // Read and called rather than written, which is what an importer is entitled to do and
    // what separates this sweep from one that greps for a name.
    'const seen = cursor.at + count;',
    'cursor.toString();',
    'ns.fn(seen);',
    '',
  ].join('\n');
  const PAGE = [
    '<body>',
    '<script type="module">',
    "import { handle } from '/s.js';",
    'handle.a = 9;',
    '</script>',
    '</body>',
    '',
  ].join('\n');

  const probeSources = new Map([['s.js', S], ['w.js', W]]);
  const { inline } = scriptsIn('p.html', PAGE);
  const probeBodies = new Map(probeSources);
  for (const m of inline) probeBodies.set(m.id, m.body);
  const sink = newSink();
  for (const [rel, src] of probeSources) collect(rel, src, sink, probeSources);
  for (const m of inline) collect(m.id, m.body, sink, probeSources, { inline: true });
  const probeExports = new Map([...probeSources].map(([rel, src]) => [rel, exportsOf(src).names]));

  const bare = rule3({ bodies: probeBodies, edges: sink.edges, exportsByModule: probeExports, exemptions: [], prefix: '' });
  const flagged = bare.writable.map((w) => w.key).sort();
  ok('every shape of exported object is flagged: a default, a live let holding one, a const, and one let out under a rename by a list with no semicolon',
    flagged.length === 4
    && flagged.join(' | ') === 's.js::cursor | s.js::default | s.js::handle | s.js::live',
    `${flagged.join(', ') || 'nothing was flagged at all'} - and beside them ${bare.buckets.primitive} primitive, ${bare.buckets.behaviour} behaviour, ${bare.buckets.frozen} frozen`);

  const written = bare.crossWrites.map((c) => `${c.from}::${c.name}`).sort();
  ok('and the write sweep sees every spelling an import brings a binding in under - a rename, a namespace, a default, and a page\'s inline module',
    written.join(' | ') === 'p.html#module0::handle | w.js::default | w.js::fn | w.js::handle | w.js::live',
    written.join(', ') || 'nothing was flagged at all');
  ok('and a read or a method call through those same bindings is not a write',
    !written.some((w) => w.endsWith('::cursor') || w.endsWith('::count')),
    `cursor is read and called and count is read, and neither is flagged: ${written.filter((w) => w.endsWith('::cursor') || w.endsWith('::count')).join(', ') || 'none'}`);
  ok('and no edge of that tree was skipped for want of a body, which is what the count over the real tree means',
    bare.skipped.length === 0 && bare.sweptDeclarations === 4,
    `${bare.sweptBindings} bindings across ${bare.sweptDeclarations} declarations, ${bare.skipped.length} skipped`);
  // The same run with the page's inline module taken out of the map of bodies, which is
  // precisely the state the sweep was in before this: the edge is in the graph, its text is
  // not in hand, and the old code took the `continue`. The row above can only mean what it
  // says if this one names what went missing rather than quietly sweeping one edge fewer.
  const blind = rule3({
    bodies: probeSources, edges: sink.edges, exportsByModule: probeExports, exemptions: [], prefix: '',
  });
  ok('and an edge whose text this run does not hold is named rather than dropped out of the count',
    blind.skipped.length === 1 && blind.skipped[0].startsWith('p.html#module0')
    && blind.sweptDeclarations === bare.sweptDeclarations - 1,
    `${blind.skipped.join(', ') || 'nothing was named, so the branch that names it never ran'} - ${blind.sweptDeclarations} declarations swept where the whole map gives ${bare.sweptDeclarations}`);

  // The audit's three verdicts, each fired by an entry written to earn it. Without this the
  // `covers` conjunct has no control at all: forcing it true leaves every mutation in the
  // table still catching, because each of them falsifies something else as well.
  const probeTable = [
    { module: 's.js', binding: 'handle', why: 'names a real export and covers both a flagged shape and a flagged write' },
    { module: 's.js', binding: 'count', why: 'names a real export and covers nothing, because a primitive is never flagged' },
    { module: 's.js', binding: 'departed', why: 'names nothing this tree exports' },
  ];
  const held = rule3({ bodies: probeBodies, edges: sink.edges, exportsByModule: probeExports, exemptions: probeTable, prefix: '' });
  const verdicts = auditExemptions(probeTable, probeExports, held.used, '', () => true);
  ok('and the exemption audit separates an entry that covers something from one that covers nothing and one that names nothing',
    verdicts[0].pass === true
    && verdicts[1].pass === false && /nothing was flagged that it exempts/.test(verdicts[1].detail)
    && verdicts[2].pass === false && /no longer exports/.test(verdicts[2].detail),
    verdicts.map((v) => `${v.key}: ${v.pass ? 'covers something' : v.detail.slice(0, 44)}`).join(' | '));
  // The brace counter's own control, and it is the one case this lexer leaves ambiguous on
  // purpose: a `/` after `}` is read as division, so the pattern's body is scanned as code
  // and the `{` inside it is counted. Everything after that in the file sits at a depth that
  // is one too deep, and a top-level `export` written there would be taken for a property
  // key and skipped in silence. Planted rather than argued about, because the column-zero
  // cross-check is the only thing standing between that and an export nobody reads.
  const drifting = 'if (a) { b(); }\n/x{/.test(a);\nexport const after = 1;\n';
  const shifted = exportsOf(drifting);
  ok('and an export at column zero that the brace counter puts inside braces is named rather than skipped',
    shifted.drifted.length === 1 && shifted.names.length === 0,
    shifted.drifted.length
      ? `line ${shifted.drifted.join(', ')}, and ${shifted.names.length} exports read off a file that has one`
      : 'nothing was named, so either the counter did not drift or the cross-check did not fire');

  ok('and an exemption answers the write it was written for rather than the run at large',
    held.crossWrites.every((c) => c.name !== 'handle') && held.writable.every((w) => w.key !== 's.js::handle')
    && held.crossWrites.some((c) => c.name === 'live'),
    `${held.writable.length} shapes and ${held.crossWrites.length} writes left after one entry, where the bare table left ${bare.writable.length} and ${bare.crossWrites.length}`);
}

// ---------- rule 4: a name crosses a boundary because both ends wanted it
console.log('\n[module] rule 4: every import is read, and every export is asked for');

// **One question, asked once of every declaration that carries a name across this
// directory's edge, and both halves of the rule read the same answer.** Does the file that
// wrote the declaration read the name it binds? The import half fails on the bindings that
// answer no; the export half counts as a consumer only the ones that answer yes.
//
// That join is the repair for the shape this rule shipped with. The two halves used to be
// computed in one run and never compared, so a dead import reddened the import row and was
// then counted, five lines later, as the reader keeping the far side's export alive - and
// the run held both facts while saying only one of them. It is not hypothetical: at
// `883f070^` this tool reddened `web/main.js` for not reading `easeSlopeAt` and printed the
// export row green about `web/curve.js`, whose only importer anywhere in that checkout was
// that same dead line. The export became findable only because a person removed the import
// first. A name moved out of a module leaves a dead import and a dead export behind, and
// unjoined they conceal each other, which is why one plant of that pair reddens two rows
// here on purpose: both sentences are true and each has to be fixed.
//
// The population is every such declaration wherever it is written - `web/` modules, a page's
// inline module, a bare-specifier declaration in one of them, and a file outside `web/` that
// imports out of it. The last of those is not generosity either. The consumer set for the
// export half has to be the whole repository, because seven of this tree's exports have no
// importer inside `web/` at all; and a consumer nobody asked the use question of is a
// consumer that cannot be trusted to be one. Measured: 55 name-level bindings arrive from
// `server/`, `tools/` and `test/`, and a join that took them on faith let a dead export whose
// only importer was itself dead read as asked-for, which is the same defect one directory
// over.

// The text a use is looked for in, and the mask that says what each position of it is: the
// same scan every rule above runs over - comments blanked, string bodies kept, newlines in
// place - with every import declaration in the file blanked out on top of that. All of them
// rather than the one under the question, because two declarations importing the same name
// from two modules would otherwise each read as a use of the other, which is the shape a
// name-moved-between-modules refactor produces and so exactly the one that must not pass.
// Blanking writes spaces rather than cutting, so every index into this text is still an index
// into the mask and into the file.
const surfaces = new Map();
const useSurface = (key, src, spans) => {
  if (surfaces.has(key)) return surfaces.get(key);
  const { scan, mask } = parse(src);
  const chars = scan.split('');
  for (const [from, to] of spans) {
    for (let i = from; i < to && i < chars.length; i++) if (chars[i] !== '\n') chars[i] = ' ';
  }
  const answer = { text: chars.join(''), mask };
  surfaces.set(key, answer);
  return answer;
};

// **A use is a hit in code position that is not a property key**, and both halves of that
// were measured rather than argued.
//
// String bodies survive the blanking above because the specifier of every import lives in one
// and taking them out would take the graph with them, so the mask is asked instead of the
// text: a hit at a position the lexer calls a string body is not a use. Measured over this
// tree, that reading takes hits off four names - `grade`, `afterimage`, `bloom` and
// `material`, which are words the quoted parameter ids say too - and leaves every swept name
// still read in code, so it closes the hole at no cost. Template *text* was never part of
// this: `codeMask` leaves it at mask 0 and `parse` blanks it to spaces, so the twelve hundred
// lines of GLSL in this tree are not a masking surface and never were. The sentence that used
// to sit here said the opposite, and a plant of a dead import named only inside a template
// literal is caught either way, which is how that was found.
//
// A property key is the other half, and it is the one this file is full of surfaces for:
// `{ fov: 1 }` writes a name in code position with no dot in front of it, so the lookbehind
// that refuses `obj.fov` cannot refuse it, and a registry or a menu table using the same word
// as an import keeps a dead import green. It is decided by the two neighbours rather than by
// a lookahead - the nearest code character before the hit is `{` or `,` and the nearest after
// it is `:` - which is the object-literal key and the destructuring pattern key and nothing
// else: `case name:` has a word before it, `a ? b : c` has a `?`, `{ [name]: 1 }` has a `[`,
// and the shorthand `{ name }` has no colon at all. The neighbours are read through the mask
// as well, because a `,` inside a surviving string body would otherwise serve as one.
// Measured: it takes no name off the swept set on this tree, where the wider lookahead this
// header used to reject - any hit followed by `:` or by `(` at the head of a line - called
// twelve live imports dead.
//
// What is still open, and it is a comment rather than a control because a limitation inside a
// control reads as the rule not working: the **method shorthand**, `{ poll(gl) { ... } }`,
// which is a name in code position followed by `(` and is indistinguishable from a call
// written as its own statement. `web/main.js` has one, and it is why the far-side-name
// control below aliases to `recordPoll` rather than to `poll`. Telling those apart needs a
// scope analysis rather than a search, which is a different instrument.
const codeAt = (surface, i) => (i >= 0 && i < surface.text.length && surface.mask[i] === CODE);
const nextCode = (surface, from, step) => {
  let i = from;
  while (i >= 0 && i < surface.text.length && /\s/.test(surface.text[i])) i += step;
  return i;
};
const isPropertyKey = (surface, at, name) => {
  const before = nextCode(surface, at - 1, -1);
  if (!codeAt(surface, before) || (surface.text[before] !== '{' && surface.text[before] !== ',')) return false;
  const after = nextCode(surface, at + name.length, 1);
  return codeAt(surface, after) && surface.text[after] === ':';
};
const readsName = (surface, name) => {
  const re = new RegExp(String.raw`(?<![.\w$])${rxName(name)}(?![\w$])`, 'g');
  for (const m of surface.text.matchAll(re)) {
    if (surface.mask[m.index] !== CODE) continue;
    if (isPropertyKey(surface, m.index, name)) continue;
    return lineAt(surface.text, m.index);
  }
  return null;
};

/**
 * Which exports a namespace binding actually reaches, and where it reaches the module in a
 * way this scan cannot put a name to.
 *
 * A namespace import binds one object whose properties are every export the target has, and
 * the join used to take that as a request for all of them. It is not one: `test/clip-range.
 * test.mjs` is the only namespace importer in this checkout, and marking all four of
 * `web/clip-range.js`'s exports consumed the moment it appeared switched the export row off
 * for that whole module - add an export nothing wants and the row stays green, which is the
 * blind spot measured before this narrowing went in. So a dotted reach asks for that one
 * name, a destructure off the binding asks for the names in its pattern, and everything else
 * is a reach this scan cannot name.
 *
 * That last bucket is a catch-all rather than the computed-index case alone, and it has to
 * be: `Object.keys(ns)`, `{ ...ns }`, `for (const k in ns)` and handing the binding to a
 * function all reach exports without naming one, and a narrowing that consumed nothing for
 * them would redden every export of that module on a tree doing something legitimate. It
 * consumes everything, the way the old join did for all of them, **and says so in a row of
 * its own** - so a module going blind costs an assertion rather than passing in silence.
 */
const readsThroughNamespace = (surface, ns) => {
  const names = new Set();
  const opaque = [];
  const re = new RegExp(String.raw`(?<![.\w$])${rxName(ns)}(?![\w$])`, 'g');
  for (const m of surface.text.matchAll(re)) {
    if (surface.mask[m.index] !== CODE) continue;
    const dotted = /^\s*\.\s*([A-Za-z_$][\w$]*)/.exec(surface.text.slice(m.index + ns.length, m.index + ns.length + 120));
    if (dotted) { names.add(dotted[1]); continue; }
    const pattern = /\{([^{}]*)\}\s*=\s*$/.exec(surface.text.slice(0, m.index));
    // A rest element takes whatever the pattern did not name, which is the same unnameable
    // reach as the ones below rather than a shorter list.
    if (pattern && !pattern[1].includes('...')) {
      for (const part of pattern[1].split(',')) {
        const key = part.split(':')[0].split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(key)) names.add(key);
      }
      continue;
    }
    opaque.push(lineAt(surface.text, m.index));
  }
  return { names, opaque };
};

// ---------- who imports out of web/ from outside it
//
// **The consumer set is the repository and not `web/`**, and that is load-bearing rather
// than generous. Seven of this tree's exports have no importer inside `web/` at all:
// `server/library.js` imports `POLLED_NODE_FIELDS`, `tools/fake-grabber.mjs` and
// `tools/library-check.mjs` import `CAPTURE_FORMAT`, and four more are held only by unit
// tests under `test/`. A row that counted `web/` consumers would have called seven honest
// exports dead on its first run, and a row that cries wolf gets deleted rather than fixed.
//
// The walk is wide and the read is narrow, which is the direction this scan is allowed to be
// wrong in. A directory it fails to walk costs a consumer and reddens an export that is
// alive, which somebody sees; a directory it walks that it should not - `node_modules`, the
// vendored upstream in `third_party` - would manufacture a consumer and keep a dead export
// green, which is the silent direction. So the skip list holds only trees that cannot import
// out of `web/` by construction, and everything else in the checkout is walked whether or not
// this file has heard of it.
const OUTSIDE_SKIP = new Set(['node_modules', 'vendor', 'third_party', 'web']);
const outsideFiles = [];
const walkOutside = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { if (!OUTSIDE_SKIP.has(entry.name)) walkOutside(p); continue; }
    // JavaScript only. A page outside `web/` is not something this server serves, and
    // running the module scan over arbitrary HTML would invent consumers rather than miss
    // them, which is the wrong direction for this half.
    if (/\.[mc]?js$/.test(entry.name)) outsideFiles.push(relative(ROOT, p).split('\\').join('/'));
  }
};
walkOutside(ROOT);
outsideFiles.sort();

// Every declaration the use question is asked of, gathered before any of it is asked so the
// question is one loop over one list rather than three loops that agree today. `kind` is
// carried per declaration because the row below counts its population where the sweep
// happens: a floor computed over a collection the sweep then skips part of is the fault
// `docs/instruments.md` records against rule 3's, and it is the fault this row had - it went
// on printing the bare-specifier half of its population while a version that never asked one
// of them read exactly the same.
//
// Counting there is why the in-tree number the row prints is **26 against rule 2's 28 edges**,
// and the gap is not a lost population: the two edges are `web/index.html`'s and
// `web/library.html`'s `<script src>`, which bind no name and so have nothing for this
// question to be about. An edge dropped for want of a body would be a different thing
// entirely and is named in `unsweptEdges` below rather than left to be read out of a count -
// measured on this tree, zero of them.
const crossings = [];
const unsweptEdges = [];
for (const edge of [...inTree, ...tree.bareEdges]) {
  const src = bodies.get(edge.from);
  // An edge asked of a body this run does not hold would be a name silently not asked about.
  // Folded into the row below rather than given one of its own, because that row can only
  // mean what it says if it was asked of every declaration.
  if (src === undefined) { unsweptEdges.push(`web/${edge.from}:${edge.line}`); continue; }
  crossings.push({
    kind: edge.to === null ? 'bare' : 'in-tree',
    where: `web/${edge.from}`,
    surface: useSurface(edge.from, src, tree.importSpans.get(edge.from) ?? []),
    target: edge.to,
    spec: edge.spec,
    line: edge.line,
    bindings: edge.bindings,
  });
}
let outsideImports = 0;
for (const rel of outsideFiles) {
  const src = read(rel);
  if (src === null) continue;
  const { imports } = importsIn(src);
  const surface = useSurface(rel, src, imports.map((imp) => imp.span));
  for (const imp of imports) {
    if (imp.spec === null || (!imp.spec.startsWith('.') && !imp.spec.startsWith('/'))) continue;
    const where = resolveSpec(imp.spec, rel);
    if (where.kind !== 'in-tree' || !where.path.startsWith('web/')) continue;
    const target = where.path.slice('web/'.length);
    if (!sources.has(target)) continue;
    outsideImports++;
    crossings.push({
      kind: 'outside', where: rel, surface, target, spec: imp.spec, line: imp.line, bindings: imp.bindings,
    });
  }
}

const consumers = new Map();
const consumeName = (rel, name, where) => {
  const key = `${rel}::${name}`;
  if (!consumers.has(key)) consumers.set(key, new Set());
  consumers.get(key).add(where);
};
const consumeEverything = (rel, where) => {
  for (const e of exportsByModule.get(rel) ?? []) consumeName(rel, e.name, where);
};

const unusedImports = [];
const opaqueReaches = [];
const asked = { 'in-tree': 0, bare: 0, outside: 0 };
let sweptImportNames = 0;
let liveBindings = 0;
let deadBindings = 0;
let namespaceBindings = 0;
for (const c of crossings) {
  let any = false;
  const exported = c.target === null ? null : new Set((exportsByModule.get(c.target) ?? []).map((e) => e.name));
  for (const b of c.bindings) {
    // A re-export binds nothing on this side, so there is no name here to read - and it does
    // ask the far side for one, so it counts as a consumer unasked. `export * from` asks for
    // all of them. Both are refused outright by the barrel row above, which is the row that
    // says what to do about them; this branch is what keeps that mutation reddening one claim
    // rather than two.
    if (!b.local) {
      if (c.target === null) continue;
      if (b.kind === 'star') consumeEverything(c.target, c.where);
      else consumeName(c.target, b.imported, c.where);
      continue;
    }
    // A name the other side does not export is already named by rule 2's row, and asking a
    // second question about the same binding would make one plant redden two rows - the
    // blast radius that stops a control saying which claim it was about. The class stays
    // closed: a dead import of a name that exists is caught here, and one of a name that
    // does not is caught there.
    //
    // For a declaration outside `web/` that skip is a scope boundary rather than a handoff,
    // and it is named here rather than left to be discovered: rule 2's row ranges over the
    // in-tree edges, so a test or a tool importing a name `web/` has *stopped* exporting is
    // asked by neither row. Measured on this tree, none of the 55 outside bindings names a
    // missing export, so the branch is inert today - and what would find one is
    // `npm run test:unit` for the files it runs, which is not all of them.
    if (exported && b.kind !== 'namespace' && !exported.has(b.imported)) continue;
    any = true;
    sweptImportNames++;
    if (readsName(c.surface, b.local) === null) {
      deadBindings++;
      unusedImports.push(`${c.where}:${c.line} imports ${b.kind === 'namespace' ? `the namespace ${b.local}` : b.local}`
        + ` from ${c.target === null ? c.spec : `web/${c.target}`}, and no line of ${c.where} reads it`);
      // **The join.** A binding no line reads asks the far side for nothing, so it does not
      // enter the consumer map and cannot hold an export up.
      continue;
    }
    liveBindings++;
    if (c.target === null) continue;
    if (b.kind === 'namespace') {
      namespaceBindings++;
      const { names, opaque } = readsThroughNamespace(c.surface, b.local);
      if (opaque.length) {
        opaqueReaches.push(`${c.where}:${opaque.join(', ')} reaches web/${c.target} through ${b.local} without naming an export`);
        consumeEverything(c.target, c.where);
        continue;
      }
      for (const name of names) consumeName(c.target, name, c.where);
      continue;
    }
    consumeName(c.target, b.imported, c.where);
  }
  if (any) asked[c.kind]++;
}
ok('no module imports a name it does not use',
  unusedImports.length === 0 && unsweptEdges.length === 0 && sweptImportNames > 0,
  unusedImports.length || unsweptEdges.length
    ? [...unusedImports, ...unsweptEdges.map((e) => `${e} was asked of a body this run does not hold`)].join('; ')
    : `${sweptImportNames} names across ${asked['in-tree']} in-tree, ${asked.bare} bare and ${asked.outside} outside-web declarations, each counted where it was asked`);

ok('and every namespace import reaches its target by name, so no module\'s exports go unasked behind one',
  opaqueReaches.length === 0,
  opaqueReaches.length
    ? opaqueReaches.join('; ')
    : `${namespaceBindings} namespace binding${namespaceBindings === 1 ? '' : 's'} into web/, and every reach through one of them names an export`);

const unconsumed = [];
const outsideOnly = [];
let consideredExports = 0;
for (const [rel, list] of exportsByModule) {
  for (const e of list) {
    // A re-export is refused outright by the barrel row above rather than joined here.
    if (e.form === 're-export') continue;
    consideredExports++;
    const by = consumers.get(`${rel}::${e.name}`);
    if (!by) { unconsumed.push(`web/${rel}:${e.line} exports ${e.name}, and nothing in this checkout imports it and reads it`); continue; }
    if (![...by].some((w) => w.startsWith('web/'))) outsideOnly.push(`web/${rel}::${e.name} from ${[...by].join(', ')}`);
  }
}
ok('no module exports a name nothing imports',
  unconsumed.length === 0 && consideredExports > 0,
  unconsumed.length
    ? unconsumed.join('; ')
    : `${consideredExports} exports, every one of them asked for by one of ${liveBindings} bindings that read what they bring across`
      + `, with ${deadBindings} dead one${deadBindings === 1 ? '' : 's'} counting for nothing`);

ok('and the consumers counted include the ones outside web/, which is where the only reader of some of these exports lives',
  outsideImports > 0 && outsideOnly.length > 0,
  outsideOnly.length
    ? `${outsideFiles.length} files outside web/ walked, ${outsideImports} of their declarations import out of web/,`
      + ` and ${outsideOnly.length} exports have no reader inside it: ${outsideOnly.join('; ')}`
    : `${outsideImports} imports out of web/ from ${outsideFiles.length} files outside it, and no export depends on them -`
      + ' so a scan that stopped at web/ would pass this run and the widening is untested');

console.log(`\n[module] ${checked} assertions, ${failed} failed`);
if (MUTATE && mutationApplied === 0) {
  console.log(`[module] DID NOT RUN - ${MUTATE} names ${MUTATIONS[MUTATE].file}, which nothing in this run read, so nothing was mutated`);
  process.exit(2);
}
if (MUTATE) {
  // Exit code alone cannot tell a caught mutation from a tool that fell over before it
  // asserted anything, and this repo has been bitten by exactly that more than once.
  if (failed === 0) { console.log('[module] NOT CAUGHT - the check passed a tree it should have refused'); process.exit(1); }
  console.log(`[module] caught, as required (${failed} assertion${failed === 1 ? '' : 's'} fired)`);
  process.exit(1);
}
if (failed) { console.log('[module] FAIL'); process.exit(1); }
console.log('[module] PASS');
process.exit(0);
