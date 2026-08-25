#!/usr/bin/env node
// Parses and typechecks the two C++ files this repo ships, in all four combinations of the
// two macros grabber.cpp branches on. No sensor, no prefix, no link step: a call to a
// function present in the headers and absent from the library is as green here as a correct
// one. Exit 1 means a claim failed; exit 2 means the harness did not run.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUTATE = argv.includes('--mutate') ? argv[argv.indexOf('--mutate') + 1] : null;

const MUTATIONS = {
  'grabber-syntax-error': {
    file: 'native/grabber.cpp',
    edits: [['  std::string logLevel = "warning";', '  std::string logLevel = ;']],
  },

  // A wrong argument type, because `-fsyntax-only` is a semantic pass and this is the row that says so.
  'grabber-type-error': {
    file: 'native/grabber.cpp',
    edits: [['  HdEncoder hdEncoder(jpegQuality);', '  HdEncoder hdEncoder("high");']],
  },

  'opencl-branch-broken': {
    file: 'native/grabber.cpp',
    edits: [[
      '    pipeline = new libfreenect2::OpenCLPacketPipeline();',
      '    pipeline = new libfreenect2::OpenCLPacketPipelineThatDoesNotExist();',
    ]],
  },

  // The arm that earns the matrix: it is compiled out of every build on the machine this runs from.
  'opengl-branch-broken': {
    file: 'native/grabber.cpp',
    edits: [[
      '    pipeline = new libfreenect2::OpenGLPacketPipeline();',
      '    pipeline = new libfreenect2::OpenGLPacketPipelineThatDoesNotExist();',
    ]],
  },

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

const CXX = process.env.CXX || 'c++';
if (spawnSync(CXX, ['--version'], { encoding: 'utf8' }).status !== 0) {
  cannotRun(`no C++ compiler: ${CXX} --version did not answer. Set CXX= to one that does.`);
}

// turbojpeg is keg-only under Homebrew, resolved the same way and order as native/CMakeLists.txt.
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

// `#cmakedefine X` becomes `#define X` when the feature is on and a comment when it is off,
// which is what CMake does with it. What is left over is dropped rather than left to choke on.
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
  // What generate_export_header writes, reduced to what an unlinked translation unit can observe.
  writeFileSync(join(dir, 'libfreenect2/export.h'),
    '#ifndef LIBFREENECT2_EXPORT_H\n#define LIBFREENECT2_EXPORT_H\n'
    + '#define LIBFREENECT2_EXPORT\n#define LIBFREENECT2_NO_EXPORT\n#define LIBFREENECT2_DEPRECATED\n'
    + '#endif\n');
};

// A mutation is a literal substitution that has to match exactly once, and is refused loudly otherwise.
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

// A compiler that had stopped rejecting broken code would make every row below a green light
// wired to nothing, so the mechanism is shown to work on this machine before it is used.
const canary = join(TMP, 'canary.cpp');
writeFileSync(canary, 'int main() { int x = ; }\n');
if (parse(canary, []).ok) {
  cannotRun(`${CXX} -fsyntax-only accepted a file with a syntax error in it,`
    + ' so every check below would pass whatever the source said. Nothing was checked.');
}
console.log(`  ok   ${CXX} rejects a planted syntax error, so this run can mean something`);

// The two macros grabber.cpp branches on. `cpu only` is what a CPU-only libfreenect2 gives you.
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

// The harness branches on neither macro, so one arm is the whole of it.
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
