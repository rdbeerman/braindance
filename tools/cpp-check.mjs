#!/usr/bin/env node
// Parses and typechecks the two C++ files this repo ships, in every pipeline
// configuration they can be built in. No sensor, no prefix, no link step - which is
// what makes it the one thing that can ask a question about `native/` on a fresh clone.
//
//   node tools/cpp-check.mjs
//   node tools/cpp-check.mjs --mutate grabber-syntax-error   # ... and must FAIL mutated
//
// **The gap this closes is that there was no gate at all.** 64 JavaScript files get
// `node --check` on two Node versions every push; `native/grabber.cpp` - the only writer
// of the artifact this whole program exists to produce, and the one file here that
// cannot be re-shot - got a regex in `syntax-check`'s citation walk and nothing else. A
// typo in it is discovered by somebody rebuilding on a machine with a Kinect on the bus,
// which is one machine, sometimes.
//
// **State the limit rather than letting the green tick imply more than it earned: this
// parses and typechecks, it does not link and it does not run.** A call to a function
// that exists in the headers and not in the library is exactly as green here as a
// correct one, and no behaviour is exercised at all. What it catches is the class that
// actually costs an afternoon on hardware - a broken statement, a wrong argument type, a
// name that does not exist in the vendored headers - and it catches it in the seconds
// after the edit rather than at the far end of a build.
//
// **One configuration is not a check of a file this full of `#ifdef`.** `grabber.cpp`
// picks its default pipeline off which processors the library was compiled with, and
// takes a different branch per processor in three places. Parsed with OpenCL alone -
// the macOS station's build - the OpenGL arms are text the compiler never reads, so a
// break in the Pi's branch would sit green here until somebody rebuilt on the Pi. So it
// runs the four combinations of the two macros the file actually branches on, and
// `--mutate opengl-branch-broken` is the control that says the matrix reaches them:
// against a single-configuration gate that mutation passes.
//
// The two headers CMake generates are templated here rather than being taken from a
// build, because a gate that needs `vendor/prefix` needs the thing it exists to run
// without. `config.h` comes from the vendored `config.h.in` with this run's macros
// substituted, and `export.h` is the visibility shim CMake's `generate_export_header`
// writes - three empty defines, because nothing is being exported out of a translation
// unit that is never linked.
//
// Exit 1 means a claim failed. Exit **2** means the harness did not run - no compiler,
// no turbojpeg headers, a mutation whose anchor no longer matches. That split is the
// same one every tool here keeps: **count the failed assertions and read which ones
// fired**, because a run reporting zero failed assertions and a non-zero exit is a
// crash to investigate rather than a catch to record.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUTATE = argv.includes('--mutate') ? argv[argv.indexOf('--mutate') + 1] : null;

// ------------------------------------------------------------------- mutations
//
// Every entry is a bug being put back rather than an invented break, and the two
// branch entries are the ones that carry the coverage claim: each is a name that does
// not exist, planted inside an `#ifdef` arm, so it can only be seen by a run that
// compiled that arm. A tool that parsed one configuration would report both green.
const MUTATIONS = {
  // The plain case, in code every configuration compiles: does this tool read
  // `grabber.cpp` at all. Without it the two branch mutations below would be the only
  // controls, and both of them would also pass on a tool that read no file whatsoever.
  'grabber-syntax-error': {
    file: 'native/grabber.cpp',
    edits: [['  std::string logLevel = "warning";', '  std::string logLevel = ;']],
  },

  // A wrong argument type, and the reason it is here rather than a second broken
  // statement: `-fsyntax-only` is a *semantic* pass and this is the row that says so.
  // A gate that tokenised without typechecking would take `HdEncoder("high")` happily,
  // and the class it would then be blind to - an argument in the wrong unit, a pointer
  // where a value belongs - is most of what a C++ mistake in this file looks like.
  'grabber-type-error': {
    file: 'native/grabber.cpp',
    edits: [['  HdEncoder hdEncoder(jpegQuality);', '  HdEncoder hdEncoder("high");']],
  },

  // The OpenCL arm, which on this machine is the one that gets compiled and so is the
  // weakest of the two as a control - it would redden even a single-configuration gate,
  // as long as that configuration was the Mac's. Kept anyway, because the pair is what
  // makes the claim symmetric and because the default arm is machine-dependent: a gate
  // configured off whatever the host happens to have is a gate whose coverage moves.
  'opencl-branch-broken': {
    file: 'native/grabber.cpp',
    edits: [[
      '    pipeline = new libfreenect2::OpenCLPacketPipeline();',
      '    pipeline = new libfreenect2::OpenCLPacketPipelineThatDoesNotExist();',
    ]],
  },

  // And the OpenGL arm, which is the control that actually earns the matrix. It is the
  // Pi's pipeline, it is compiled out of every build on the machine this is usually run
  // from, and it is where a break would live longest before anybody noticed.
  'opengl-branch-broken': {
    file: 'native/grabber.cpp',
    edits: [[
      '    pipeline = new libfreenect2::OpenGLPacketPipeline();',
      '    pipeline = new libfreenect2::OpenGLPacketPipelineThatDoesNotExist();',
    ]],
  },

  // The second file, asked for on its own. `reg-runner.cpp` is the oracle half of the
  // registration differential - the thing that says our `Registration::apply` is
  // upstream's, bit for bit - so a tool that quietly checked one file and reported both
  // would leave the harness the whole comparison rests on unparsed.
  'harness-syntax-error': {
    file: 'native/harness/reg-runner.cpp',
    edits: [['#include <cstdio>', '#include <cstdio>\nint broken( = ;']],
  },
};

if (MUTATE && !MUTATIONS[MUTATE]) {
  console.error(`unknown mutation ${MUTATE} - have ${Object.keys(MUTATIONS).join(', ')}`);
  process.exit(2);
}

let failed = 0;
let asserted = 0;
const check = (ok, what) => {
  asserted++;
  if (ok) console.log(`  ok   ${what}`);
  else { failed++; console.log(`  FAIL ${what}`); }
};
const cannotRun = (why) => { console.error(`[cpp-check] ${why}`); process.exit(2); };

// ------------------------------------------------------------------- the toolchain

const CXX = process.env.CXX || 'c++';
if (spawnSync(CXX, ['--version'], { encoding: 'utf8' }).status !== 0) {
  cannotRun(`no C++ compiler: ${CXX} --version did not answer. Set CXX= to one that does.`);
}

// turbojpeg is an ordinary system package on Linux and keg-only under Homebrew, so it is
// off the default search path on macOS - the same asymmetry `native/CMakeLists.txt`
// resolves, resolved the same way and in the same order so the two cannot disagree about
// which headers the grabber is being checked against.
const turbojpegInclude = () => {
  const pc = spawnSync('pkg-config', ['--cflags-only-I', 'libturbojpeg'], { encoding: 'utf8' });
  if (pc.status === 0) {
    const dir = pc.stdout.trim().replace(/^-I/, '').split(/\s+/)[0];
    if (dir && existsSync(join(dir, 'turbojpeg.h'))) return dir;
  }
  for (const dir of ['/opt/homebrew/opt/jpeg-turbo/include', '/usr/local/opt/jpeg-turbo/include',
    '/usr/include', '/usr/local/include']) {
    if (existsSync(join(dir, 'turbojpeg.h'))) return dir;
  }
  return null;
};
const TURBOJPEG = turbojpegInclude();
if (!TURBOJPEG) {
  cannotRun('turbojpeg.h not found - install libturbojpeg0-dev or `brew install jpeg-turbo`.'
    + ' Nothing was checked.');
}

const VENDOR_INCLUDE = join(REPO, 'third_party/libfreenect2/include');
const CONFIG_IN = join(VENDOR_INCLUDE, 'libfreenect2/config.h.in');
if (!existsSync(CONFIG_IN)) {
  cannotRun(`${CONFIG_IN} is missing, so there is no header to template and nothing was checked`);
}

const TMP = mkdtempSync(join(tmpdir(), 'cpp-check-'));

// ------------------------------------------------------------------- the two headers
//
// `#cmakedefine X` becomes `#define X` when the feature is on and a comment when it is
// off, which is exactly what CMake does with it. Everything left over is dropped rather
// than left as a `#cmakedefine` line the preprocessor would choke on.
const writeConfig = (dir, features) => {
  const on = new Set([...features, 'LIBFREENECT2_THREADING_STDLIB', 'LIBFREENECT2_WITH_CXX11_SUPPORT']);
  const text = readFileSync(CONFIG_IN, 'utf8')
    .replace(/@PROJECT_VER@/g, '0.2.1')
    .replace(/@PROJECT_VER_MAJOR@/g, '0')
    .replace(/@PROJECT_VER_MINOR@/g, '2')
    .replace(/@TegraJPEG_LIBRARIES@/g, '')
    .split('\n')
    .map((line) => {
      const m = /^#cmakedefine\s+(\w+)/.exec(line);
      if (!m) return line;
      return on.has(m[1]) ? `#define ${m[1]}` : `/* ${m[1]} off in this arm */`;
    })
    .join('\n');
  mkdirSync(join(dir, 'libfreenect2'), { recursive: true });
  writeFileSync(join(dir, 'libfreenect2/config.h'), text);
  // What `generate_export_header` writes for a shared build, reduced to what a
  // translation unit that is never linked can observe: three names that expand to
  // nothing. Anything more would be this file having an opinion about visibility, which
  // is a property of the built library rather than of whether this source is well formed.
  writeFileSync(join(dir, 'libfreenect2/export.h'),
    '#ifndef LIBFREENECT2_EXPORT_H\n#define LIBFREENECT2_EXPORT_H\n'
    + '#define LIBFREENECT2_EXPORT\n#define LIBFREENECT2_NO_EXPORT\n#define LIBFREENECT2_DEPRECATED\n'
    + '#endif\n');
};

// ------------------------------------------------------------------- the source
//
// A mutation is a literal substitution that has to match exactly once. Refused loudly
// otherwise and with exit 2, because an anchor that has quietly stopped matching reports
// the check as having missed a bug it was never shown.
const sourceFor = (rel) => {
  const original = readFileSync(join(REPO, rel), 'utf8');
  if (!MUTATE || MUTATIONS[MUTATE].file !== rel) return original;
  let text = original;
  for (const [from, to] of MUTATIONS[MUTATE].edits) {
    const hits = text.split(from).length - 1;
    if (hits !== 1) {
      cannotRun(`mutation ${MUTATE} anchors on text appearing ${hits} times in ${rel}, not once`
        + ' - re-anchor it. Nothing was checked.');
    }
    text = text.replace(from, to);
  }
  return text;
};

const staged = (rel) => {
  const at = join(TMP, rel.replace(/\//g, '__'));
  writeFileSync(at, sourceFor(rel));
  return at;
};

const parse = (path, includes) => {
  const r = spawnSync(CXX, ['-fsyntax-only', '-std=c++11',
    ...includes.flatMap((d) => ['-I', d]), path], { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
};

// ------------------------------------------------------------------- the canary
//
// **A compiler that has stopped rejecting broken code would make every row below a green
// light wired to nothing**, so the mechanism is shown to work on this machine before it
// is used. `syntax-check` buys the same thing for `node --check`, and it bought it after
// finding a tree state where `node --check` silently accepted a broken file - so this is
// a lesson already paid for once rather than a precaution.
const canary = join(TMP, 'canary.cpp');
writeFileSync(canary, 'int main() { int x = ; }\n');
if (parse(canary, []).ok) {
  cannotRun(`${CXX} -fsyntax-only accepted a file with a syntax error in it,`
    + ' so every check below would pass whatever the source said. Nothing was checked.');
}
console.log(`  ok   ${CXX} rejects a planted syntax error, so this run can mean something`);

// ------------------------------------------------------------------- the matrix
//
// The two macros `grabber.cpp` branches on, in all four combinations. `none` is not a
// hypothetical build - it is what a CPU-only libfreenect2 gives you, which is the
// fallback the file's own comment names.
const ARMS = [
  ['cpu only', []],
  ['opengl', ['LIBFREENECT2_WITH_OPENGL_SUPPORT']],
  ['opencl', ['LIBFREENECT2_WITH_OPENCL_SUPPORT']],
  ['opengl+opencl', ['LIBFREENECT2_WITH_OPENGL_SUPPORT', 'LIBFREENECT2_WITH_OPENCL_SUPPORT']],
];

const GRABBER = staged('native/grabber.cpp');
const RUNNER = staged('native/harness/reg-runner.cpp');

console.log('\nnative/grabber.cpp, per pipeline configuration');
for (const [label, features] of ARMS) {
  const dir = join(TMP, `inc-${label.replace(/[^a-z]/g, '')}`);
  writeConfig(dir, features);
  const r = parse(GRABBER, [dir, VENDOR_INCLUDE, TURBOJPEG]);
  check(r.ok, `grabber.cpp parses and typechecks with ${label}`);
  if (!r.ok) console.log(r.out.split('\n').slice(0, 12).map((l) => `       ${l}`).join('\n'));
}

// The harness takes no `#ifdef` on either macro, so one arm is the whole of it and
// saying so is cheaper than four identical rows implying coverage that is not a matrix.
console.log('\nnative/harness/reg-runner.cpp, which branches on neither macro');
{
  const dir = join(TMP, 'inc-runner');
  writeConfig(dir, ['LIBFREENECT2_WITH_OPENCL_SUPPORT']);
  const r = parse(RUNNER, [dir, VENDOR_INCLUDE]);
  check(r.ok, 'reg-runner.cpp parses and typechecks');
  if (!r.ok) console.log(r.out.split('\n').slice(0, 12).map((l) => `       ${l}`).join('\n'));
}

console.log(`\n${asserted} assertions, ${failed} failed`);
console.log('parse and typecheck only - nothing was linked and nothing ran;'
  + ' see CLAUDE.md "Proof tools" for what actually exercises the grabber');
process.exit(failed ? 1 : 0);
