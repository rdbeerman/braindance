#!/usr/bin/env node
// A capture, synthesised, so that a clone with no Kinect can run the suite.
//
// **The gap this closes is that a fresh clone cannot produce a capture at all.** Twelve
// proof tools root at `captures/sample.knct`; `captures/` is gitignored, the sensor has not
// been manufactured since 2017, and nothing in the tree generated one - so `make-fixture`,
// which loops a capture into a longer capture, had nothing to loop. `docs/proof-tools.md`
// already decided a synthetic stand-in is allowed and says which rows it would cost. This
// is the thing that decision was waiting for.
//
//   node tools/make-sample.mjs captures/sample.knct
//   node tools/make-sample.mjs captures/sample.knct --frames 284 --fps 30
//   npm run fixtures                                  # this, then make-fixture
//
// **It is written to be the same *shape* as the capture this repo actually holds, not a
// plausible file.** That was read off the real one rather than guessed, and three of its
// properties are load-bearing:
//
//   - **Its hello carries nine keys and not thirteen** - `serial`, `firmware`, `width`,
//     `height`, `fx`, `fy`, `cx`, `cy`, `color`. No `format`, so it is a generation-zero
//     take, which is what every take shot before that field existed is and what
//     `library-check`'s `generation-zero-take` fixture is about. A stand-in declaring
//     `format: 1` would be a different generation from the file it stands in for.
//   - **No `startedAt`**, so `describeTake` dates it by mtime and reports
//     `dateSource: 'mtime'`. `docs/proof-tools.md` predicted a synthetic sample would fail
//     the file-date fallback row for carrying one; omitting it is what makes that row pass,
//     and the fixture depends on some takes having no wall clock.
//   - **A real JPEG in every frame, around the size the real one carries.** The same page
//     predicted a stand-in would fail the two decimation rows "by construction", because a
//     sample with no colour block has no JPEG to carry through. One of those rows asserts
//     `colorBytes / total > 0.35` at divisor 4, where the decimated depth is 27,136 bytes -
//     so a colour block under about 15KB fails it however valid the file is. That is why
//     this tool encodes a real image rather than emitting a colour-free capture, and why
//     the encoder below exists at all.
//
// **The depth is synthesised geometry rather than noise**, because the readers unproject it
// and a cloud of noise is a fixture nobody can look at to see whether a change was an
// improvement. A back wall, a floor running away from the camera, and a sphere crossing the
// frame - plus a band of zeroes, since `0 = no reading` is a value every reader has to
// handle and a fixture with none of them tests the happy path only.
//
// **It is written mirrored, because the wire format is.** libfreenect2 delivers depth and
// colour flipped left-for-right to match the Microsoft SDK's selfie-view convention, the
// grabber `memcpy`s the buffer through untouched, and the correction is one sign in the
// unprojection - `X = -(col + 0.5 - cx) / fx * z`. So a generator that placed the sphere at
// the column arithmetic naively suggests would produce a file whose room is the mirror of
// every real capture, and `level-check` section 8 exists because a rig built out of
// reflection-invariant quantities cannot see that. The scene is placed by inverting that
// same expression, so the sphere really is where this file says it is.
//
// **What it does not do**, said here rather than left to be discovered: it does not
// simulate a sensor. There is no depth jitter, no confidence gate chattering on a flat
// wall, no dropped frames and no colour camera halving its rate in dim light. Anything
// measuring those needs the real capture, and a number taken against this file has to say
// so - `docs/measurement.md`'s rule that a fixture is a term in the assertion applies to
// this one hardest, because it is the one that looks most like footage.

import { createWriteStream, existsSync, statSync } from 'node:fs';
import { encodeMessage, TYPE_HELLO, TYPE_FRAME } from '../server/protocol.js';
import { DEPTH_W, DEPTH_H } from '../web/format.js';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const OUT = positional[0];
if (!OUT) {
  console.error('usage: make-sample.mjs <out.knct> [--frames N] [--fps F] [--quality Q] [--force]');
  console.error('  writes a synthetic generation-zero capture: real geometry, a real JPEG per frame,');
  console.error('  and no sensor required. See the header for which rows a stand-in cannot answer.');
  console.error('  refuses to overwrite an existing capture unless --force.');
  process.exit(2);
}

// **It refuses to overwrite, and this is the one refusal in the file that is not about
// correctness.** The path this tool is run at is `captures/sample.knct`, which on a machine
// with a Kinect attached is real footage - and a capture is the one artifact in this program
// that cannot be shot again, which is the sentence the wire format's own specification is
// built around when it declines to rewrite a take to add a key. `npm run fixtures` names that
// path, so without this the difference between a clone bootstrapping itself and a maintainer
// destroying a shoot is one command that looks identical from the outside.
//
// Refusing by default rather than prompting, because the case that needs protecting is the
// unattended one: a script, a CI job or an agent running `npm run fixtures` to get a suite
// green has nobody at the keyboard to answer a prompt. The refusal prints the size and the
// date of what it declined to write over, so an operator can tell 138MB of footage from a
// stand-in they made this morning.
//
// **Three spellings, because there are three different things somebody means**, and
// collapsing them is what made the first version of this guard break the thing it was added
// to protect. `--force` is "replace it, I know what it is". `--if-missing` is "make sure one
// exists" and is what `npm run fixtures` asks for - a machine holding real footage and no
// `fixture-1g` needs the loop built and the capture left alone, and a bare refusal there
// stopped the chain and left the contributor with neither. The default is neither of those:
// a hand-typed `make-sample captures/sample.knct` over a real take is the case this whole
// paragraph exists for, and it stops.
if (existsSync(OUT) && !argv.includes('--force')) {
  const st = statSync(OUT);
  if (argv.includes('--if-missing')) {
    console.log(`[make-sample] ${OUT} already exists (${(st.size / 1024 / 1024).toFixed(1)}MB), leaving it alone`);
    process.exit(0);
  }
  console.error(`[make-sample] refusing to overwrite ${OUT}`);
  console.error(`[make-sample]   ${(st.size / 1024 / 1024).toFixed(1)}MB, last written ${st.mtime.toISOString()}`);
  console.error('[make-sample] a capture cannot be shot again. Move it aside, or pass --force if it is a stand-in,');
  console.error('[make-sample] or --if-missing if you only wanted one to exist.');
  process.exit(2);
}
// 284 frames at 30fps, which is the frame count and the rate the capture in this tree
// carries - 284 over 9.42s at 30.03fps. Sized by frame count rather than by duration for
// the reason `docs/proof-tools.md` gives about the real sample: duration is the thing that
// differs between two files nobody committed.
const FRAMES = Number(flag('--frames', '284'));
const FPS = Number(flag('--fps', '30'));
const QUALITY = Number(flag('--quality', '82'));

// **Refused here rather than trusted to fail somewhere useful, because none of these fail
// anywhere at all.** `Number('nope')` is NaN, `i < NaN` is false on the first test, and the
// generation loop is skipped entirely - so `--frames nope` wrote a 162-byte file holding
// only the hello, printed its ordinary success line and exited 0. Measured, on the shipped
// build, before this was added.
//
// What makes that worth a refusal rather than a curiosity is the next command somebody
// runs: `npm run fixtures` calls this with `--if-missing`, which leaves an existing capture
// alone on purpose so a machine holding real footage keeps it. A zero-frame sample is an
// existing capture, so the guard that protects footage protects this instead, and
// `make-fixture` then loops nothing into a fixture and twelve tools root at it. The
// failure surfaces as proof tools disagreeing about a build with nothing wrong with it.
//
// The output is not opened until this has passed, so a refused run leaves whatever was
// already at that path untouched - which is the same promise the overwrite guard makes.
for (const [name, value, ok, wants] of [
  ['--frames', FRAMES, Number.isInteger(FRAMES) && FRAMES > 0, 'a whole number of frames above zero'],
  ['--fps', FPS, Number.isFinite(FPS) && FPS > 0, 'a rate above zero'],
  ['--quality', QUALITY, Number.isInteger(QUALITY) && QUALITY >= 1 && QUALITY <= 100, 'a JPEG quality from 1 to 100'],
]) {
  if (!ok) {
    console.error(`[make-sample] ${name} needs ${wants}, and was given ${JSON.stringify(flag(name, ''))}`
      + ` - which reads as ${value}. Nothing was written.`);
    process.exit(2);
  }
}

// The sensor's own intrinsics, taken from the capture this stands in for so that anything
// reading `fx`/`cx` out of the hello gets numbers a real device produced. Hardcoded
// intrinsics skew the cloud in a way that is hard to spot and hard to attribute, which is
// the reason the hello carries them at all - so a stand-in inventing round ones would be
// planting exactly that.
const FX = 366.031494;
const FY = 366.031494;
const CX = 257.775909;
const CY = 206.784195;

// ---------------------------------------------------------------------------- the scene
//
// Depth in millimetres on the sensor's grid, `0` meaning no reading. Every surface is
// analytic, so what the file contains is known rather than measured - which is the property
// `level-check` gets out of planting planes and the reason its rows can grade a fit against
// a normal it chose.

/**
 * One frame of depth, at phase `t` in [0, 1).
 *
 * The column-to-world-X step is the mirrored one and it is the whole reason this function
 * is not the obvious loop: `worldX = -(col + 0.5 - CX) / FX * z`, so a positive world X is
 * a *low* column. Placing the sphere by solving that for `col` is what keeps the archive
 * single-valued - see the header.
 */
function depthFrame(t) {
  const depth = new Uint16Array(DEPTH_W * DEPTH_H);
  // The sphere crosses from the room's left to its right and back, so a take carries motion
  // in both directions and a check reading a signed displacement cannot pass on a fixture
  // that only ever moves one way.
  const sweep = Math.sin(t * Math.PI * 2);
  const ballX = sweep * 0.55;          // metres, world, +X is the room's right
  const ballY = 0.12 * Math.cos(t * Math.PI * 4);
  const ballZ = 1.55 + 0.18 * sweep;
  const BALL_R = 0.28;

  for (let row = 0; row < DEPTH_H; row++) {
    // The vertical axis is not mirrored - only the horizontal is - so this is the plain
    // unprojection with y growing up.
    const ny = -(row + 0.5 - CY) / FY;
    for (let col = 0; col < DEPTH_W; col++) {
      const nx = -(col + 0.5 - CX) / FX;
      // The back wall at z = 3.2m, and the floor at y = -1.05m. A ray hits the floor when
      // `ny * z = -1.05`, which only happens looking downwards.
      let z = 3.2;
      if (ny < -1e-6) {
        const floorZ = -1.05 / ny;
        if (floorZ < z) z = floorZ;
      }
      // The sphere, solved along the ray rather than drawn as a disc, so its depth really
      // is a curved surface and a normal fit over it means something.
      const dx = nx;
      const dy = ny;
      const len = Math.hypot(dx, dy, 1);
      const ux = dx / len;
      const uy = dy / len;
      const uz = 1 / len;
      const ocx = -ballX;
      const ocy = -ballY;
      const ocz = -ballZ;
      const b = 2 * (ux * ocx + uy * ocy + uz * ocz);
      const c = ocx * ocx + ocy * ocy + ocz * ocz - BALL_R * BALL_R;
      const disc = b * b - 4 * c;
      if (disc > 0) {
        const hit = (-b - Math.sqrt(disc)) / 2;
        if (hit > 0.3) {
          const hz = uz * hit;
          if (hz < z) z = hz;
        }
      }
      // A band of no-reading, because `0 = no reading` is a value every reader has to
      // handle and a fixture without any tests the happy path only. Placed on the wall
      // rather than over the sphere so it cannot be confused with an occlusion.
      const shadow = row > 70 && row < 96 && col > 300 && col < 470 && z > 3.0;
      depth[row * DEPTH_W + col] = shadow ? 0 : Math.round(Math.min(z, 8.0) * 1000);
    }
  }
  return depth;
}

/** The same scene as an RGB image, so the colour and the depth agree about the room. */
function colorFrame(depth, t) {
  const rgb = new Uint8Array(DEPTH_W * DEPTH_H * 3);
  for (let i = 0; i < DEPTH_W * DEPTH_H; i++) {
    const mm = depth[i];
    const row = Math.floor(i / DEPTH_W);
    const col = i % DEPTH_W;
    let r;
    let g;
    let b;
    if (mm === 0) {
      r = 10; g = 12; b = 16;
    } else if (mm > 3100) {
      // The wall, with a slow vertical gradient and a stripe pattern, so the JPEG carries
      // real high-frequency content rather than compressing to almost nothing. A flat
      // image would encode to a couple of kilobytes and fail the decimation row this tool's
      // header explains.
      const stripe = ((col >> 4) + (row >> 5)) & 1 ? 24 : 0;
      r = 96 + stripe + (row >> 3);
      g = 104 + stripe + (row >> 4);
      b = 118 + stripe;
    } else if (mm > 1900) {
      const check = ((col >> 5) ^ (row >> 5)) & 1 ? 30 : 0;
      r = 70 + check; g = 62 + check; b = 54 + check;
    } else {
      // The sphere: lit from the upper left of the room, which after the mirror is the
      // upper right of the buffer. Written with the same sign the depth used so the two
      // cannot disagree about which side the light is on.
      const shade = 1 - Math.min(1, (mm - 1200) / 900);
      r = Math.round(40 + 200 * shade);
      g = Math.round(60 + 150 * shade);
      b = Math.round(90 + 90 * shade);
    }
    // **Fine texture, and it is here for the size rather than for the look.** A synthetic
    // room made of flat regions encodes to almost nothing: measured at 13.7KB a frame
    // without this, against the 58KB the real capture carries, and the decimation row
    // needs the colour block to be more than 35% of a divisor-4 message - which is 27,136
    // bytes of depth, so anything under about 14.6KB fails it however valid the file is.
    // What a real photograph has that a gradient does not is high-frequency detail in
    // every block, so that is what this adds.
    //
    // Deterministic rather than random: a hash of the pixel index, so two runs of this
    // tool produce the same file. `Math.random()` here would make every checkout's fixture
    // a different one, which is the failure this whole tool exists to stop being invisible.
    const h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    const grain = ((h >>> 24) & 31) - 16;
    // A slow global drift so consecutive frames are not byte-identical - a take whose
    // frames all hash the same cannot tell a reader that seeks from one that does not.
    const drift = Math.round(6 * Math.sin(t * Math.PI * 2));
    rgb[i * 3] = Math.max(0, Math.min(255, r + drift + grain));
    rgb[i * 3 + 1] = Math.max(0, Math.min(255, g + drift + grain));
    rgb[i * 3 + 2] = Math.max(0, Math.min(255, b + grain));
  }
  return rgb;
}

// ------------------------------------------------------------------- a baseline JPEG
//
// **Written here rather than shelled out to, and that is the point of it.** The alternative
// was ffmpeg, and this tool is the bootstrap: a generator that needed a system package
// installed would fail exactly the person it exists for, and a generator that used ffmpeg
// *when present* would produce different bytes on different machines - which is
// `docs/instruments.md`'s "a fixture that is gitignored is a term in the assertion" with
// the term varying per host. Every machine gets the same file from the same arguments.
//
// Baseline sequential, 4:4:4, one Huffman table pair shared by all three components, which
// the format permits and which halves the table data this file has to carry correctly.
// The tables are JPEG Annex K's, which is the published set - reaching for it rather than
// writing a plausible one is the rule `docs/instruments.md` states three times over.

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

const QUANT_BASE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

const DC_BITS = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

/** `bits`/`values` to a `code -> [length, bits]` map, by the standard canonical walk. */
function huffTable(bits, values) {
  const table = new Map();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len]; i++) table.set(values[k++], [len, code++]);
    code <<= 1;
  }
  return table;
}
const DC_TABLE = huffTable(DC_BITS, DC_VALS);
const AC_TABLE = huffTable(AC_BITS, AC_VALS);

/** The quantisation table at this quality, by the conventional libjpeg scaling. */
function quantAt(quality) {
  const q = Math.max(1, Math.min(100, quality));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  return QUANT_BASE.map((v) => Math.max(1, Math.min(255, Math.floor((v * scale + 50) / 100))));
}

/** A growable bit sink that byte-stuffs `0xFF`, which entropy-coded JPEG data requires. */
class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.bits = 0;
  }

  write(length, value) {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      this.bits++;
      if (this.bits === 8) {
        this.bytes.push(this.acc & 0xff);
        // A literal 0xFF inside the scan would be read as the start of a marker, so the
        // format requires a zero byte after it. Missing this produces a file that is valid
        // for most images and corrupt for the ones that happen to emit the byte, which is
        // the worst possible distribution of a bug.
        if ((this.acc & 0xff) === 0xff) this.bytes.push(0x00);
        this.acc = 0;
        this.bits = 0;
      }
    }
  }

  /** Pad the final partial byte with ones, which is what the format specifies. */
  flush() {
    while (this.bits) this.write(1, 1);
  }
}

/** The magnitude category of a coefficient, and the value bits the format wants with it. */
function magnitude(v) {
  const a = Math.abs(v);
  let size = 0;
  while (size < 16 && a >= (1 << size)) size++;
  // A negative coefficient is written as the one's complement of its magnitude in `size`
  // bits, which is the format's own encoding and not a sign bit.
  return [size, v < 0 ? v + (1 << size) - 1 : v];
}

/** Forward DCT over one 8x8 block, written directly from the definition. */
const COS = (() => {
  const t = new Float64Array(64);
  for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) t[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return t;
})();
function fdct(block, out) {
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * COS[u * 8 + x] * COS[v * 8 + y];
      const cu = u === 0 ? Math.SQRT1_2 : 1;
      const cv = v === 0 ? Math.SQRT1_2 : 1;
      out[v * 8 + u] = 0.25 * cu * cv * sum;
    }
  }
}

/**
 * An RGB image to a baseline JPEG.
 *
 * Not subsampled. 4:2:0 would be the usual choice and is deliberately not taken: it halves
 * the chroma resolution and needs a second block geometry, and what this file is for is a
 * colour block of realistic size that decodes to the room the depth describes. 4:4:4 is
 * simpler to get right and produces the larger file, which is the direction that matters
 * here for the reason the header gives.
 */
function encodeJpeg(rgb, width, height, quality) {
  const quant = quantAt(quality);
  const out = [];
  const u8 = (b) => out.push(b & 0xff);
  const u16 = (v) => { out.push((v >> 8) & 0xff, v & 0xff); };
  const marker = (m) => { u8(0xff); u8(m); };

  marker(0xd8);                                   // SOI
  // A JFIF APP0, with no EXIF anywhere - which `docs/instruments.md` records mattering
  // once already, when the mirror question was settled off a frame carrying JFIF and no
  // orientation tag that anything downstream could have been applying.
  marker(0xe0); u16(16);
  u8(0x4a); u8(0x46); u8(0x49); u8(0x46); u8(0x00);
  u8(1); u8(1); u8(0); u16(1); u16(1); u8(0); u8(0);

  marker(0xdb); u16(67); u8(0);                   // DQT, one table, all components share it
  for (let i = 0; i < 64; i++) u8(quant[ZIGZAG[i]]);

  marker(0xc0); u16(17); u8(8);                   // SOF0, 8-bit
  u16(height); u16(width); u8(3);
  for (let c = 1; c <= 3; c++) { u8(c); u8(0x11); u8(0); }

  marker(0xc4); u16(2 + 1 + 16 + DC_VALS.length); u8(0x00);
  for (let i = 1; i <= 16; i++) u8(DC_BITS[i]);
  for (const v of DC_VALS) u8(v);
  marker(0xc4); u16(2 + 1 + 16 + AC_VALS.length); u8(0x10);
  for (let i = 1; i <= 16; i++) u8(AC_BITS[i]);
  for (const v of AC_VALS) u8(v);

  marker(0xda); u16(12); u8(3);
  for (let c = 1; c <= 3; c++) { u8(c); u8(0x00); }
  u8(0); u8(63); u8(0);

  // Colour conversion up front rather than per block, because a block straddling the right
  // or bottom edge repeats the last real pixel and doing that on the planes keeps the edge
  // rule in one place.
  const planes = [new Float64Array(width * height), new Float64Array(width * height), new Float64Array(width * height)];
  for (let i = 0; i < width * height; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    planes[0][i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    planes[1][i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    planes[2][i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  const bw = new BitWriter();
  const block = new Float64Array(64);
  const coef = new Float64Array(64);
  const prevDc = [0, 0, 0];
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let c = 0; c < 3; c++) {
        const plane = planes[c];
        for (let y = 0; y < 8; y++) {
          const sy = Math.min(height - 1, by + y);
          for (let x = 0; x < 8; x++) {
            const sx = Math.min(width - 1, bx + x);
            block[y * 8 + x] = plane[sy * width + sx];
          }
        }
        fdct(block, coef);
        const q = new Int32Array(64);
        for (let i = 0; i < 64; i++) q[i] = Math.round(coef[ZIGZAG[i]] / quant[ZIGZAG[i]]);

        const diff = q[0] - prevDc[c];
        prevDc[c] = q[0];
        const [dcSize, dcBits] = magnitude(diff);
        const [dcLen, dcCode] = DC_TABLE.get(dcSize);
        bw.write(dcLen, dcCode);
        if (dcSize) bw.write(dcSize, dcBits);

        let run = 0;
        for (let i = 1; i < 64; i++) {
          if (q[i] === 0) { run++; continue; }
          // A run of more than fifteen zeroes is written as ZRL blocks, because the run
          // length in a coefficient symbol is four bits and silently truncating it
          // produces a file that decodes to the wrong image rather than one that fails.
          while (run > 15) { const [l, cc] = AC_TABLE.get(0xf0); bw.write(l, cc); run -= 16; }
          const [size, bits] = magnitude(q[i]);
          const [len, code] = AC_TABLE.get((run << 4) | size);
          bw.write(len, code);
          bw.write(size, bits);
          run = 0;
        }
        if (run > 0) { const [l, cc] = AC_TABLE.get(0x00); bw.write(l, cc); }
      }
    }
  }
  bw.flush();
  const head = Buffer.from(out);
  const scan = Buffer.from(bw.bytes);
  return Buffer.concat([head, scan, Buffer.from([0xff, 0xd9])]);
}

// ---------------------------------------------------------------------------- the write

// Nine keys, in the order the real capture carries them. `JSON.stringify` over a literal
// rather than a hand-built string, because a hello that is not JSON is a take nothing can
// parse and the grabber has its own paragraph about refusing to emit one.
const hello = JSON.stringify({
  serial: '000000000000',
  firmware: 'synthetic',
  width: DEPTH_W,
  height: DEPTH_H,
  fx: FX,
  fy: FY,
  cx: CX,
  cy: CY,
  color: true,
});

const stream = createWriteStream(OUT);
// **One error handler for the stream rather than one per write.** A `once('error')` armed
// inside `write` is only ever removed by an error, and the fast path resolves on
// `stream.write` returning true without one arriving - so the default 284 frames armed 284
// of them and node printed `MaxListenersExceededWarning` from the eleventh frame on. The
// backpressured path leaks the same way, since only `drain` settles it. Latched here
// instead: the failure is remembered, every write in flight is rejected, and every write
// after it refuses before touching the stream. A plain `on('error')` with no rejection
// would be worse than the leak it removes - it would turn a full disk from a loud failure
// into a `drain` that never comes, which is this tool hanging with no output at all.
let writeFailure = null;
const waiting = new Set();
stream.on('error', (err) => {
  writeFailure = err;
  for (const rej of waiting) rej(err);
  waiting.clear();
});
const write = (buf) => new Promise((res, rej) => {
  // Awaited rather than fired and forgotten: a 138MB file written without watching the
  // drain buffers the whole thing in memory, and this tool is the one somebody runs on a
  // machine they have not sized for it.
  if (writeFailure) { rej(writeFailure); return; }
  if (stream.write(buf)) { res(); return; }
  waiting.add(rej);
  stream.once('drain', () => { waiting.delete(rej); res(); });
});

await write(encodeMessage(TYPE_HELLO, Buffer.from(hello, 'utf8')));

// Stamps are monotonic milliseconds from an arbitrary origin, which is what the sensor's
// `steady_clock` gives - they are not a wall clock and nothing may read them as one. The
// origin is fixed rather than taken from `Date.now()`, so two runs of this tool with the
// same arguments produce byte-identical files and a fixture cannot quietly differ between
// two checkouts.
const STAMP_ORIGIN = 875_649_822;
let colorTotal = 0;
for (let i = 0; i < FRAMES; i++) {
  const t = i / FRAMES;
  const depth = depthFrame(t);
  const jpeg = encodeJpeg(colorFrame(depth, t), DEPTH_W, DEPTH_H, QUALITY);
  colorTotal += jpeg.length;
  const depthBytes = depth.byteLength;
  const payload = Buffer.alloc(16 + depthBytes + jpeg.length);
  payload.writeUInt32LE(depthBytes, 0);
  payload.writeUInt32LE(jpeg.length, 4);
  payload.writeBigUInt64LE(BigInt(STAMP_ORIGIN + Math.round((i * 1000) / FPS)), 8);
  Buffer.from(depth.buffer, depth.byteOffset, depthBytes).copy(payload, 16);
  jpeg.copy(payload, 16 + depthBytes);
  await write(encodeMessage(TYPE_FRAME, payload));
  if ((i + 1) % 50 === 0 || i + 1 === FRAMES) {
    process.stderr.write(`[make-sample] ${i + 1}/${FRAMES} frames\n`);
  }
}

await new Promise((res) => stream.end(res));
console.log(`[make-sample] ${OUT}: ${FRAMES} frames at ${FPS}fps, `
  + `${(FRAMES / FPS).toFixed(2)}s, mean colour ${(colorTotal / FRAMES / 1024).toFixed(1)}KB a frame`);
console.log('[make-sample] generation zero, no startedAt - a stand-in, not footage; say so when reporting a number from it');
