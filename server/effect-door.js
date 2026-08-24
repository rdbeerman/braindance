// The door an effect package has to get through before a byte of it lands on disk.
//
// **Everything a broken package could do, it does at boot, on somebody else's machine.**
// A package is GLSL spliced into two programs plus a table of parameters spliced into the
// registry, and both of those are assembled while `web/main.js` is still evaluating - so a
// package that does not assemble does not fail an install, it fails the *next page load*,
// with no `__kinect` published, every proof tool reporting DID NOT RUN, and the only
// evidence a console line in a browser nobody has open. That is the failure this file
// exists to move: a package is refused here, by name, with the reason, and the store never
// writes it.
//
// **Every refusal names the silent failure it stands in front of**, in the voice the
// assembler's own refusals use, because a message saying "invalid manifest" tells the
// author to go and read this file and a message saying which uniform their slider would
// have failed to move tells them what to fix.
//
// **The door does not reimplement assembly, and that is the load-bearing part.** The
// joints a chunk may name, which services open scopes, what a slot collides with, whether
// two packages declare one varying - all of that is `assembleShaders`, and the door asks it
// by *running* it against the set that would exist after the install. A second copy of
// those rules here would be the second implementation this repo keeps refusing, and it
// would drift in the direction that matters: the door would accept what the page then
// throws on. So what is written out below is only what assembly cannot see - the parameter
// vocabulary, the manifest's own shape, the two ends of a uniform binding, and the
// identifiers a chunk reaches for.
//
// Pure and synchronous: it is handed the candidate, the packages that would sit beside it
// and the spines, and it answers a sentence or null. Nothing here touches the filesystem,
// which is what lets `server/effect-store.js` call it before it has made a directory and
// lets `test/effect-door.test.mjs` run the whole shipped set through it under bare node.

import { MANIFEST_FORMAT, EFFECT_PARAM_KINDS, EFFECT_BIND_TABLES, EFFECT_BIND_TRANSFORMS } from '../web/effect-manifests.js';
import { assembleShaders } from '../web/shader-assembly.js';

// The same two shapes `server/effect-store.js` enforces on what it reads, restated here
// rather than imported, because the door runs *before* the store has anything to read and
// the store runs on what is already on disk. Two callers of one rule would be an import;
// two rules asked at two different moments of one id's life is this.
const VALID_EFFECT_ID = /^[a-z][a-z0-9]*$/;
const VALID_FILE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

// A GLSL name, which is what a uniform binding, a varying and an identifier all are.
const GLSL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The parameter key a manifest declares, which becomes the half of a dotted registry name
// after the dot. No dot of its own, because `effectOf` in `web/main.js` splits on the first
// one - `rain.head.gap` would be read as the `rain` package's `head.gap` key by the
// registry and as the `rain.head` package's `gap` key by anything splitting from the right,
// and the two readings are a name that means different things to different halves of one
// program.
const VALID_PARAM_KEY = /^[a-z][A-Za-z0-9]*$/;

/**
 * The GLSL a package may write in, as vocabulary rather than as grammar.
 *
 * **This is not a parser and must not be read as one.** What the identifier rule below
 * needs is the set of names that mean something without the package having declared them,
 * so that anything left over is a name the author expected to find and this build does not
 * have. Types and keywords are here because they appear where identifiers appear;
 * the builtins are here because a chunk calling `mix` is calling the language.
 *
 * A name missing from these lists is a false refusal, which is the loud direction: the
 * author sees "this build has no `roundEven`" and the list gains an entry. A name here
 * that GLSL does not have costs nothing, because the driver would refuse it at compile
 * time anyway. That asymmetry is why the lists are generous rather than exact.
 */
const GLSL_TYPES = [
  'void', 'bool', 'int', 'uint', 'float', 'double',
  'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4',
  'uvec2', 'uvec3', 'uvec4', 'dvec2', 'dvec3', 'dvec4',
  'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4',
  'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
  'sampler2D', 'isampler2D', 'usampler2D', 'sampler3D', 'samplerCube',
  'sampler2DArray', 'sampler2DShadow', 'samplerCubeShadow',
];

const GLSL_KEYWORDS = [
  'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'discard',
  'const', 'uniform', 'in', 'out', 'inout', 'attribute', 'varying',
  'flat', 'smooth', 'noperspective', 'centroid', 'layout', 'location', 'precision',
  'highp', 'mediump', 'lowp', 'struct', 'switch', 'case', 'default', 'true', 'false',
  'define', 'ifdef', 'ifndef', 'endif', 'version', 'else', 'elif', 'undef', 'error',
];

const GLSL_BUILTINS = [
  // The trigonometric and exponential families, whole, because a package reaching for
  // `atanh` and finding it refused would be this list's fault rather than the package's.
  'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
  // The common ones, which is where nearly every chunk in the shipped set lives.
  'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil', 'fract', 'mod', 'modf',
  'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'isnan', 'isinf',
  'floatBitsToInt', 'floatBitsToUint', 'intBitsToFloat', 'uintBitsToFloat', 'fma',
  'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward', 'reflect', 'refract',
  'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
  'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual',
  'any', 'all', 'not',
  'texture', 'textureProj', 'textureLod', 'textureOffset', 'texelFetch', 'texelFetchOffset',
  'textureGrad', 'textureSize', 'textureGather', 'textureQueryLod',
  // The ES 1.00 spellings, because the two programs this build compiles are not the same
  // language: the point cloud's pair is `GLSL3` and the grade pass is whatever three.js
  // compiles a `ShaderPass` as, which is ES 1.00 - so the shipped raster and streak
  // chunks call `texture2D` where the cloud's call `texture`. A door knowing only one of
  // them would refuse half the packages that ship.
  'texture2D', 'texture2DProj', 'texture2DLod', 'textureCube', 'textureCubeLod',
  'dFdx', 'dFdy', 'fwidth',
  'packSnorm2x16', 'unpackSnorm2x16', 'packUnorm2x16', 'unpackUnorm2x16',
  'bitfieldExtract', 'bitfieldInsert', 'bitCount', 'findLSB', 'findMSB', 'uaddCarry', 'usubBorrow',
  // The builtin variables of the two stages this program has.
  'gl_Position', 'gl_PointSize', 'gl_VertexID', 'gl_InstanceID',
  'gl_FragCoord', 'gl_FrontFacing', 'gl_PointCoord', 'gl_FragDepth',
];

const LANGUAGE = new Set([...GLSL_TYPES, ...GLSL_KEYWORDS, ...GLSL_BUILTINS]);
const TYPE_SET = new Set(GLSL_TYPES);

/**
 * GLSL with its comments taken out, so a name mentioned in prose is not a name used in
 * code.
 *
 * The chunks in this repo carry more comment than code - the glyph field's alphabet is
 * thirty lines of table under forty of argument - and every noun in those paragraphs would
 * otherwise be an identifier the rule below has to account for. Stripped rather than
 * excluded case by case, which is the same move `syntax-check` makes and for the same
 * reason: a rule whose exemption list is written from the subject cannot be falsified by
 * the subject.
 */
const withoutComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

/**
 * Every identifier a piece of GLSL actually reads or writes.
 *
 * Two things are dropped and each is a bug this scan had while it was being written. A
 * match preceded by a dot is a swizzle or a field - `wc.xz` is one identifier and not two,
 * and counting `xz` would refuse every chunk in the shipped set. A match preceded by a
 * digit is the tail of a literal: `0x00080800u` scans as `x00080800u` under any rule that
 * does not look left, and the glyph field's alphabet is sixty-four of them.
 */
const identifiersIn = (text) => {
  const src = withoutComments(text);
  const found = new Set();
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const before = m.index === 0 ? '' : src[m.index - 1];
    if (before === '.' || /[0-9]/.test(before)) continue;
    found.add(m[0]);
  }
  return found;
};

/**
 * Every name a piece of GLSL declares: uniforms, varyings, functions, constants and
 * locals.
 *
 * **Vocabulary and not scope**, which is the approximation this rule is built on and is
 * worth stating rather than leaving to be found. A name declared inside `main` counts as
 * declared for a chunk spliced into the declaration block, so a chunk reaching a local it
 * cannot see passes here and fails in the driver. What the rule closes is the other case -
 * a name that exists nowhere in the build at all - and that one has no other reader: it
 * compiles to a link error on a page nobody has open, where a scope error at least names
 * the line.
 *
 * The declaration forms are the four that appear: a preprocessor define, a qualified
 * declaration list (`uniform float a, b, c;`), a typed declaration or function head
 * (`vec3 heatRamp(float t)`, `uvec2 GLYPHS[64]`), and a loop counter, which the typed form
 * already covers.
 */
const declaredIn = (text) => {
  const src = withoutComments(text);
  const names = new Set();
  for (const m of src.matchAll(/#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
  // A qualified list declares every name between the type and the semicolon, which is how
  // `uniform float cropL, cropR, cropB, cropT;` declares four things rather than one.
  const qualified = /\b(?:uniform|in|out|attribute|varying)\b(?:\s+(?:flat|smooth|noperspective|centroid|highp|mediump|lowp))*\s+[A-Za-z_][A-Za-z0-9_]*\s+([^;]*);/g;
  for (const m of src.matchAll(qualified)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (name) names.add(name[1]);
    }
  }
  // A type followed by a name is a declaration or a function head, and both of them
  // introduce the name. Written against the type list rather than against a grammar,
  // because the alternative is the hand-rolled lexer `docs/instruments.md` files nine
  // rounds of one seam under.
  const typed = new RegExp(`\\b(?:${GLSL_TYPES.join('|')})\\s+([A-Za-z_][A-Za-z0-9_]*)`, 'g');
  for (const m of src.matchAll(typed)) names.add(m[1]);
  return names;
};

/** Every `uniform` one piece of GLSL declares, which is one direction of the binding check. */
const uniformsIn = (text) => {
  const src = withoutComments(text);
  const names = new Set();
  const decl = /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?[A-Za-z_][A-Za-z0-9_]*\s+([^;]*);/g;
  for (const m of src.matchAll(decl)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (name) names.add(name[1]);
    }
  }
  return names;
};

/** Every verbatim segment of every spine, as one string per program name. */
const spineTextByProgram = (spines) => Object.fromEntries(
  Object.entries(spines).map(([name, spine]) => [
    name,
    [...spine.vertex, ...spine.fragment]
      .map((entry) => [entry.text, entry.fallback, entry.open, entry.body, entry.close].filter((t) => typeof t === 'string').join('\n'))
      .join('\n'),
  ]),
);

/**
 * Which assembled program a binding's table writes into.
 *
 * `bind.on` names a uniform table and the tables are one per program, so this is the same
 * fact read from the other end - `points` is the cloud's pair and `grade` is the grade
 * pass. Written out because it is the one place the two vocabularies meet, and a build
 * that grew a third program would fail here by name rather than by a binding quietly
 * checked against the wrong text.
 */
const PROGRAM_OF_TABLE = { points: 'cloud', grade: 'grade' };

const isInert = (value) => value === 0 || value === false;

/**
 * Whether a varying's `init` is a constant expression.
 *
 * The init is written into the prologue above the early returns, so it is what a shed point
 * carries when nothing else writes the varying - which means it has to be a value rather
 * than a computation over state that does not exist yet. Numbers and constructor calls over
 * numbers, and nothing else: `0.0`, `vec3(0.0)`, `vec2(0.0, 1.0)`. An init reading a
 * uniform would compile and would make a shed point's value depend on a slider, which is a
 * look changing where the design says nothing is drawn.
 */
const isConstantExpression = (init) => {
  if (typeof init !== 'string' || init.trim().length === 0) return false;
  const src = init.trim();
  if (/^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?[uf]?$/.test(src)) return true;
  const call = src.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)$/);
  if (!call || !TYPE_SET.has(call[1])) return false;
  return call[2].split(',').every((arg) => /^\s*[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?[uf]?\s*$/.test(arg));
};

/**
 * The one entry point: a sentence saying why this package is refused, or null.
 *
 * `candidate` is the wire envelope with its id attached - `{ id, manifest, chunks }`, the
 * chunks a map of file name to text. `beside` is every package that would be installed
 * alongside it once this one lands, the candidate excluded, in the shape `/effects/:id`
 * answers with. `spines` is the map of program name to spine the page assembles from.
 *
 * The order of the rules is the order they can be asked in: shape before vocabulary,
 * vocabulary before assembly, assembly before the two GLSL cross-checks, because each of
 * those reads something the one before it has just established is there. A rule that ran
 * out of order would report a missing `params` object as a chunk naming no stage.
 */
export function doorRefusal(candidate, { beside = [], spines }) {
  const { id, manifest, chunks } = candidate;

  // ---- the id and the envelope
  if (typeof id !== 'string' || !VALID_EFFECT_ID.test(id)) {
    return `${JSON.stringify(id)} is not an effect id - an id is the namespace its parameters carry, `
      + 'so it is lowercase letters and digits with nothing in it that could read as a path';
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return `effect ${id} arrives with no manifest object - a package is a manifest and its chunks, and half of that is not a package`;
  }
  if (!chunks || typeof chunks !== 'object' || Array.isArray(chunks)) {
    return `effect ${id} arrives with no chunks map - a package with no chunks section still sends an empty one, because "no chunks" and "the chunks did not arrive" are different packages`;
  }
  if (manifest.id !== id) {
    return `effect ${id} carries a manifest declaring id ${JSON.stringify(manifest.id)} - the id is the namespace `
      + 'its parameters carry, so the two disagreeing means one of them is wrong and this door cannot know which';
  }

  // ---- the format, refused rather than adapted
  //
  // The whole of what this build will do about a package from a later one. A field this
  // build reads as a number that a later build reads as a range, or a default this build
  // takes as inert that a later one gates on, is a look rendering as something nobody
  // authored - and there is no reader to write for a format that does not exist yet.
  if (!Number.isInteger(manifest.format) || manifest.format < 1) {
    return `effect ${id} declares no package format - this build reads generation ${MANIFEST_FORMAT}, `
      + 'and a package that does not say which generation it is written in is one this door cannot place';
  }
  if (manifest.format > MANIFEST_FORMAT) {
    return `effect ${id} is package format ${manifest.format} and this build reads ${MANIFEST_FORMAT} - `
      + 'a package from a later build is refused rather than adapted, because a field this build '
      + 'thinks it understands may mean something else there';
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    return `effect ${id} declares no version - a document's \`requires\` quotes it and the badge on a `
      + 'machine without this package prints it, so a package with no version is one nobody can be told to install';
  }
  if (typeof manifest.title !== 'string' || manifest.title.length === 0) {
    return `effect ${id} declares no title - the package list is what a person picks from, and an entry with no name is a row nobody can read`;
  }

  // ---- the file names, held before any path is built out of them
  //
  // The store validates what it reads and this validates what it is about to write, and
  // the second is the one that decides whether a directory traversal ever gets a chance:
  // a name with a separator in it reaches `join` and lands the bytes wherever it likes.
  const declaredFiles = new Set((manifest.chunks ?? []).map((c) => c?.file));
  for (const file of [...declaredFiles, ...Object.keys(chunks)]) {
    if (typeof file !== 'string' || !VALID_FILE_NAME.test(file) || file.includes('..')) {
      return `effect ${id} names the chunk file ${JSON.stringify(file)} - a package file is a bare name `
        + 'in the package\'s own directory, and anything carrying a separator or a parent step is a write outside it';
    }
  }
  if (Object.hasOwn(chunks, 'manifest.json')) {
    return `effect ${id} sends a chunk called manifest.json - the manifest travels in its own field, and a second one `
      + 'in the chunk map would be the file the store reads back disagreeing with the one this door checked';
  }
  for (const file of declaredFiles) {
    if (typeof chunks[file] !== 'string') {
      return `effect ${id} declares the chunk ${JSON.stringify(file)} and its text did not arrive - `
        + 'a package assembled without one of its chunks is a program with a block missing';
    }
  }
  for (const file of Object.keys(chunks)) {
    if (!declaredFiles.has(file)) {
      return `effect ${id} sends the file ${JSON.stringify(file)} and its manifest names no chunk for it - `
        + 'a file nothing splices is text this build would store, serve and never compile, which is the shape a stale copy has';
    }
  }

  // ---- the parameters
  if (!manifest.params || typeof manifest.params !== 'object' || Array.isArray(manifest.params)
      || Object.keys(manifest.params).length === 0) {
    return `effect ${id} declares no parameters - an effect with nothing to move is a package the registry `
      + 'would assemble no control from, and the panel group it asks for would be a heading with nothing under it';
  }
  let masters = 0;
  for (const [short, spec] of Object.entries(manifest.params)) {
    const name = `${id}.${short}`;
    if (!VALID_PARAM_KEY.test(short)) {
      return `effect ${id} declares the parameter key ${JSON.stringify(short)} - a key becomes the half of a `
        + 'dotted registry name after the dot, so a key carrying a dot of its own is a name that means two different things to two halves of this program';
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      return `${name} is not a parameter declaration - the registry reads a bounds, a kind and a binding off it`;
    }
    if (!EFFECT_PARAM_KINDS.includes(spec.kind)) {
      return `${name} is kind ${JSON.stringify(spec.kind)} and this registry implements ${EFFECT_PARAM_KINDS.join(' and ')} - `
        + 'a kind nothing normalises would take the scalar branch and turn whatever arrived into a number nobody meant';
    }
    if (typeof spec.label !== 'string' || spec.label.length === 0) {
      return `${name} carries no label - the panel draws the row from it, and a row with no words on it is a slider nobody can name`;
    }
    if (!spec.panel || typeof spec.panel.group !== 'string' || spec.panel.group.length === 0) {
      return `${name} names no panel group - the generator builds a row for every parameter that names one, `
        + 'so a parameter naming none is a look term with no control anywhere';
    }
    if (spec.kind === 'step') {
      if (typeof spec.def !== 'boolean') {
        return `${name} is a step parameter and its default is ${JSON.stringify(spec.def)} - a step takes a boolean, `
          + 'and a number here would be stored as a boolean by one door and refused by another';
      }
    } else {
      for (const field of ['def', 'min', 'max', 'step']) {
        if (!Number.isFinite(spec[field])) {
          return `${name} declares ${field} as ${JSON.stringify(spec[field])} - a scalar's bounds are finite numbers, `
            + 'and a missing one makes every value the registry snaps NaN';
        }
      }
      if (!(spec.min < spec.max)) {
        return `${name} declares min ${spec.min} and max ${spec.max} - a range that does not open is a slider that cannot move`;
      }
      if (!(spec.step > 0)) {
        return `${name} declares step ${spec.step} - the registry snaps every value onto this grid, and a step of zero divides by it`;
      }
      if (spec.def < spec.min || spec.def > spec.max) {
        return `${name} defaults to ${spec.def}, outside its own ${spec.min}..${spec.max} - a default the bounds `
          + 'clamp is a parameter that never sits where its own manifest says it starts';
      }
    }
    const bind = spec.bind;
    if (!bind || typeof bind !== 'object') {
      return `${name} carries no binding - a parameter that writes no uniform is a control that moves nothing`;
    }
    if (!EFFECT_BIND_TABLES.includes(bind.on)) {
      return `${name} binds on ${JSON.stringify(bind.on)} and this build holds ${EFFECT_BIND_TABLES.join(' and ')} - `
        + 'a table nothing resolves is a write into undefined on the first slider move';
    }
    if (typeof bind.uniform !== 'string' || !GLSL_NAME.test(bind.uniform)) {
      return `${name} binds the uniform ${JSON.stringify(bind.uniform)}, which is not a GLSL name`;
    }
    if (bind.transform !== undefined && !EFFECT_BIND_TRANSFORMS.includes(bind.transform)) {
      return `${name} names the transform ${JSON.stringify(bind.transform)} and the applier implements `
        + `${EFFECT_BIND_TRANSFORMS.join(' and ')} - an unknown transform throws on the first write rather than `
        + 'landing the value unconverted, so this is the same refusal one door earlier';
    }
    if (bind.gates !== undefined && typeof bind.gates !== 'boolean') {
      return `${name} declares gates as ${JSON.stringify(bind.gates)} - it says whether this term holds the grade pass open, which is a yes or a no`;
    }
    if (spec.role !== undefined) {
      if (spec.role !== 'master') {
        return `${name} declares the role ${JSON.stringify(spec.role)} - the only role this build knows is master, `
          + 'which is the term an effect is absent at';
      }
      masters += 1;
      if (!isInert(spec.def)) {
        return `${name} is ${id}'s master and defaults to ${JSON.stringify(spec.def)} - a master is what the effect `
          + 'is absent at, so a build with the package installed and every value at default has to draw exactly what a build without it draws';
      }
    }
  }
  if (masters > 1) {
    return `effect ${id} declares ${masters} parameters with the role master - one package is absent at one term, `
      + 'and two of them is two answers to whether this effect is contributing';
  }

  // ---- the varyings and the panel groups, which the assembler does not read for shape
  for (const v of manifest.varyings ?? []) {
    if (!v || !GLSL_NAME.test(v.name ?? '')) {
      return `effect ${id} declares a varying named ${JSON.stringify(v?.name)}, which is not a GLSL name`;
    }
    if (!TYPE_SET.has(v.type)) {
      return `effect ${id}'s ${v.name} is declared ${JSON.stringify(v.type)}, which is not a GLSL type - `
        + 'the same word is written into the vertex `out` and the fragment `in`, so a type nothing knows is a link error at boot';
    }
    if (!isConstantExpression(v.init)) {
      return `effect ${id}'s ${v.name} initialises to ${JSON.stringify(v.init)} - the init is written above the `
        + 'early returns, so it is what a shed point carries, and anything but a constant makes that depend on state the prologue has not computed';
    }
    if (!Number.isFinite(v.order)) {
      return `effect ${id}'s ${v.name} carries no numeric order, and where a varying sits decides the register layout of both stages`;
    }
  }
  for (const g of manifest.panelGroups ?? []) {
    if (!g || typeof g.key !== 'string' || !g.key.length) {
      return `effect ${id} declares a panel group with no key - the group's rows are found by it`;
    }
    if (typeof g.after !== 'string' || !g.after.length) {
      return `effect ${id}'s ${g.key} group anchors after ${JSON.stringify(g.after)} - a group with no anchor `
        + 'would be appended wherever the splice happened to end, which is a package author\'s placement decision quietly overridden';
    }
    if (!Number.isFinite(g.order)) {
      return `effect ${id}'s ${g.key} group carries no numeric order - two packages anchored at one place `
        + 'would then be laid out by whichever was fetched first';
    }
  }

  // ---- assembly, asked of the assembler
  //
  // Every joint rule in one call: a stage or a slot this spine does not hold, two packages
  // claiming one slot, two declaring one varying, a service consumed without a `when`, a
  // scope widened by a consumer that brings nothing to put inside it. Run against the set
  // that would exist *after* the install, because half of those are collisions and a
  // collision is a property of the set rather than of the package.
  const packages = [...beside, candidate];
  let programs;
  try {
    programs = assembleShaders(spines, packages);
  } catch (err) {
    return `effect ${id} does not assemble into this build's shaders: ${err.message}`;
  }

  // ---- the two ends of every uniform, per program
  //
  // **Both directions, and they are not the same question asked twice.** A binding whose
  // uniform no program declares is a slider that moves nothing - three.js writes a key the
  // shader never reads, every control works, and the picture does not change. A uniform a
  // chunk declares that no parameter binds is the mirror image: the shader reads zero
  // forever, because nothing on this side ever writes it.
  //
  // The first direction is asked against the assembled program and not against the
  // package's own chunks, and that is a departure worth naming rather than a looseness.
  // Thirteen of the sixteen shipped packages declare no GLSL at all - they are parameters
  // over terms the spine already computes, `thermal` and `edges` and the whole duotone run
  // - so a rule demanding a package declare its own uniform would refuse most of what ships.
  // What the binding actually promises is that *the program* has somewhere to put the
  // value, which is what this asks.
  const declaredHere = new Set();
  for (const text of Object.values(chunks)) for (const u of uniformsIn(text)) declaredHere.add(u);
  const spineText = spineTextByProgram(spines);
  const programUniforms = {};
  for (const [program, text] of Object.entries(spineText)) {
    programUniforms[program] = uniformsIn(text);
  }
  for (const pkg of packages) {
    for (const text of Object.values(pkg.chunks ?? {})) {
      // A chunk names a joint and never a program, so which program its uniforms land in
      // is decided by which spine holds that joint - and asking that here would be the
      // assembler reimplemented. Every chunk's uniforms are credited to every program
      // instead, which is looser in the direction that produces no false refusal: a
      // binding is being asked whether the value has anywhere to go, and a uniform
      // declared in the cloud and bound on the grade would pass here and fail the driver.
      for (const program of Object.keys(spineText)) {
        for (const u of uniformsIn(text)) programUniforms[program].add(u);
      }
    }
  }
  const boundHere = new Set();
  for (const [short, spec] of Object.entries(manifest.params)) {
    const program = PROGRAM_OF_TABLE[spec.bind.on];
    if (!programUniforms[program]?.has(spec.bind.uniform)) {
      return `${id}.${short} binds the uniform ${JSON.stringify(spec.bind.uniform)} and the assembled `
        + `${program} program declares no such uniform - the control would move, the value would be written, and nothing would read it`;
    }
    boundHere.add(spec.bind.uniform);
  }
  for (const u of declaredHere) {
    if (boundHere.has(u)) continue;
    // The other end of the same rule, and it has one legitimate shape: a uniform this
    // package reads and the host writes. The rain's phase is the shipped instance - the
    // render loop advances it once a frame, so it is the host's clock rather than
    // anybody's parameter - and a package declaring one says so, because the alternative
    // is that this direction cannot be enforced at all.
    if ((manifest.hostDriven ?? []).includes(u)) continue;
    return `effect ${id} declares the uniform ${JSON.stringify(u)} and binds no parameter to it - `
      + 'nothing on this side would ever write it, so the shader reads zero for the life of the page. '
      + 'A uniform this build\'s own render loop drives goes in `hostDriven`';
  }
  for (const u of manifest.hostDriven ?? []) {
    if (!declaredHere.has(u)) {
      return `effect ${id} lists ${JSON.stringify(u)} as host-driven and declares no such uniform - `
        + 'the list says which of this package\'s own declarations the host writes, so a name not among them is a claim about nothing';
    }
  }

  // ---- every identifier a chunk reaches for
  //
  // **The last thing between a package and a page that will not boot.** A chunk naming
  // something this build has not got compiles to nothing at all: the shader fails to
  // link, `buildPointCloud` throws while the module is still evaluating, `__kinect` never
  // publishes, and every tool in the suite reports DID NOT RUN. There is no console
  // anybody is watching at that moment, which is why the name is caught here.
  //
  // The core vocabulary is read out of the spine text rather than listed, so a term the
  // spine grows next year is available to a package by existing and a term it loses is
  // refused to one by the same act. A hand-written list here would be the copy that
  // drifts, and it would drift in the direction that refuses correct packages.
  //
  // **Every name the spine *reaches for*, not only the ones it declares**, and the
  // difference is three.js. `position`, `uv`, `modelMatrix`, `modelViewMatrix` and
  // `projectionMatrix` are injected into a `ShaderMaterial`'s source at compile time, so
  // they appear in no declaration anywhere in this repo and the vertex spine's very first
  // line reads one. Taking the spine's declarations alone refused the shipped glitch for
  // `position` and the shipped lattice for `modelMatrix` - two correct packages, for using
  // the same names the text they splice into uses. Reading usage covers the injected set
  // by the only route that does not hard-code somebody else's library, and it widens the
  // vocabulary by exactly the names the spine already compiles against.
  //
  // Usage for the spine and declarations for the candidate, which is the asymmetry that
  // keeps this rule from being vacuous: a package that could authorise a name by using it
  // would authorise every name it misspells.
  const spineNames = new Set();
  for (const text of Object.values(spineText)) for (const n of identifiersIn(text)) spineNames.add(n);
  const ownNames = new Set([
    ...(manifest.varyings ?? []).map((v) => v.name),
    ...Object.keys(manifest.params).map((short) => manifest.params[short].bind.uniform),
    ...(manifest.hostDriven ?? []),
  ]);
  // A package's chunks see each other: the glyph field's alphabet table and its two
  // helpers are declared in one file and read in another, and splitting a package's own
  // vocabulary per file would refuse that.
  for (const text of Object.values(chunks)) for (const n of declaredIn(text)) ownNames.add(n);
  // And the varyings every *other* installed package declares, because a chunk may read
  // one - the glyph field reads the rain's `vRain`, which is the whole of what its rain
  // key is. Only the varyings: a varying is a declared channel with a name the manifest
  // states, where another package's locals are an accident of its text.
  for (const pkg of beside) {
    for (const v of pkg.manifest?.varyings ?? []) ownNames.add(v.name);
  }
  for (const [file, text] of Object.entries(chunks)) {
    for (const name of identifiersIn(text)) {
      if (LANGUAGE.has(name) || spineNames.has(name) || ownNames.has(name)) continue;
      return `effect ${id}'s ${file} uses ${JSON.stringify(name)}, which is not one of its own declarations, `
        + 'not a name this build\'s shaders declare and not part of GLSL - a chunk naming something that is not '
        + 'there does not fail this install, it fails the next page load with nothing on screen to say why';
    }
  }

  return null;
}

/**
 * What a package would have to keep to be a fork of another, or null.
 *
 * A user package shadows a builtin of the same id, which is the fork mechanism and is
 * deliberate. What it must not do is drop a parameter, because the client's declaration
 * order is a hand-written layout fact that places every parameter of the shipped set by
 * name - and a name the order places that no installed package declares is a registry that
 * cannot assemble, which is a page that does not boot rather than a fork that looks odd.
 *
 * Asked here rather than in `doorRefusal` because it needs both roots, which is a fact
 * about the store rather than about the package.
 */
export function forkRefusal(candidate, shadowed) {
  const dropped = Object.keys(shadowed.manifest.params)
    .filter((short) => !Object.hasOwn(candidate.manifest.params, short));
  if (dropped.length === 0) return null;
  return `effect ${candidate.id} forks the shipped package and drops `
    + `${dropped.map((s) => `${candidate.id}.${s}`).join(', ')} - the registry's declaration order places `
    + `${dropped.length === 1 ? 'that name' : 'those names'} by hand, so a fork short of `
    + `${dropped.length === 1 ? 'it' : 'them'} is a build whose registry cannot assemble at all. A fork adds and retunes; it does not remove`;
}
