// Proves the sidecar index, the content hash and the HTTP frame API.
// Proves the sidecar index, the content hash and the HTTP frame API. The scan builds an index
// and a hash without ever holding the file, the index is checked against `MessageParser` rather
// than against a second copy of the scanner's own logic, and a frame pulled over HTTP is
// checked by an independent positioned read at offsets the parser produced.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat, unlink, copyFile, utimes } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { MessageParser, HEADER_BYTES, TYPE_FRAME } from '../server/protocol.js';
import { buildIndex, loadIndex, indexPathFor, captureIdFor } from '../server/capture.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const URL_BASE = flag('--url', 'http://localhost:8080');
const SCRATCH = flag('--scratch', '/tmp');
const RUNS = Number(flag('--runs', '4'));
const SAMPLES = Number(flag('--samples', '64'));
const WARMUP = Number(flag('--warmup', '8'));
const FIXTURES = (flag('--fixtures') ?? 'captures/sample.knct,captures/fixture-1g.knct,captures/fixture-large.knct')
  .split(',')
  .filter(Boolean);

const pct = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const ms = (x) => `${x.toFixed(2)} ms`;
const gb = (x) => `${(x / 1e9).toFixed(2)} GB`;

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

// A second walk of the same bytes, framed by the parser the live server uses.
async function parserWalk(path) {
  const parser = new MessageParser();
  const frames = [];
  const hash = createHash('sha256');
  let consumed = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 4 << 20 })) {
    hash.update(chunk);
    for (const msg of parser.push(chunk)) {
      if (msg.type === TYPE_FRAME) {
        frames.push({
          offset: consumed + HEADER_BYTES,
          length: msg.payload.length,
          stampMs: Number(msg.payload.readBigUInt64LE(8)),
        });
      }
      consumed += msg.raw.length;
    }
  }
  return { frames, hash: `sha256:${hash.digest('hex')}` };
}


async function scanCost(path) {
  const size = (await stat(path)).size;
  const times = [];
  let index = null;
  for (let r = 0; r < RUNS; r++) {
    await unlink(indexPathFor(path)).catch(() => {});
    const t0 = performance.now();
    index = await buildIndex(path);
    times.push(performance.now() - t0);
  }
  // Run 1 is reported apart from the rest but is not a cold read: this is the warm-cache ceiling.
  const rest = times.slice(1);
  // Resident set after the scan, so "the scan never holds the file" is enforced rather than asserted.
  return { size, index, first: times[0], rest, restP50: pct(rest, 50), rss: process.memoryUsage().rss };
}


async function getBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function timedGet(url) {
  const t0 = performance.now();
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return { dt: performance.now() - t0, bytes: buf.length };
}


console.log(`index-check  node ${process.version}  url ${URL_BASE}\n`);

const scans = new Map();

console.log('== scan cost, index and hash ==');
console.log(`method: ${RUNS} runs per capture, sidecar deleted before each so every run is`);
console.log('a real scan. All runs are page-cache warm - purging needs root and this machine');
console.log('holds every fixture at once - so these are the CPU-bound ceiling, not a disk read.\n');
for (const path of FIXTURES) {
  const s = await scanCost(path);
  scans.set(path, s);
  const n = s.index.frames.offset.length;
  console.log(
    `${path}\n  ${gb(s.size)}  ${n} frames  ${s.index.hash}\n` +
    `  run 1 ${(s.first / 1000).toFixed(2)}s  p50 ${(s.restP50 / 1000).toFixed(2)}s ` +
    `(${(s.size / 1e6 / (s.restP50 / 1000)).toFixed(0)} MB/s)  ` +
    `runs 2..${RUNS} [${s.rest.map((t) => (t / 1000).toFixed(2)).join(', ')}]s\n` +
    `  truncated=${s.index.truncated}  sidecar ${((JSON.stringify(s.index).length) / 1e3).toFixed(0)} KB` +
    `  rss after scan ${(s.rss / 1e6).toFixed(0)} MB`,
  );
}

{
  // The claim is that the working set does not track file size, so the check is the shape of the curve.
  const small = scans.get(FIXTURES[0]);
  const large = scans.get(FIXTURES[FIXTURES.length - 1]);
  const RSS_CEILING = 512e6;
  const RSS_DELTA = 128e6;
  check(
    large.rss < RSS_CEILING,
    `scanning ${gb(large.size)} leaves ${(large.rss / 1e6).toFixed(0)} MB resident, under the ${RSS_CEILING / 1e6} MB ceiling`,
  );
  check(
    large.rss - small.rss < RSS_DELTA,
    `${(large.size / small.size).toFixed(0)}x the bytes costs ` +
    `${((large.rss - small.rss) / 1e6).toFixed(0)} MB more resident, under the ${RSS_DELTA / 1e6} MB bound`,
  );
}

console.log('\n== hash stability and sensitivity ==');
for (const path of FIXTURES) {
  const first = scans.get(path).index;
  const repeat = await buildIndex(path);
  check(repeat.hash === first.hash, `${path}: hash stable across rebuilds (${first.hash.slice(0, 23)}…)`);
  check(
    JSON.stringify(repeat.frames) === JSON.stringify(first.frames),
    `${path}: index identical across rebuilds`,
  );
}

{
  // Flipped inside a payload rather than a framing header, which would move what the scanner parses too.
  const src = FIXTURES[0];
  const copy = `${SCRATCH}/index-check-flip.knct`;
  await copyFile(src, copy);
  const before = await buildIndex(copy);
  const target = before.frames.offset[1] + 40;
  const fh = await open(copy, 'r+');
  const one = Buffer.alloc(1);
  await fh.read(one, 0, 1, target);
  one[0] ^= 0xff;
  await fh.write(one, 0, 1, target);
  await fh.close();
  const after = await buildIndex(copy);
  check(after.hash !== before.hash, `one payload byte at ${target} changes the hash`);
  check(
    JSON.stringify(after.frames) === JSON.stringify(before.frames),
    'the same byte leaves every offset, stamp and length untouched',
  );
  await unlink(copy).catch(() => {});
  await unlink(indexPathFor(copy)).catch(() => {});
}

{
  // A same-size substitution is the one staleness case byte length cannot see, so mtime is checked beside it.
  const copy = `${SCRATCH}/index-check-stale.knct`;
  await copyFile(FIXTURES[0], copy);
  const before = await buildIndex(copy);
  // Read the mtime back rather than assuming the one set: Date carries milliseconds, the filesystem nanoseconds.
  const target = Math.floor((await stat(copy)).mtimeMs) + 5000;
  await utimes(copy, new Date(target), new Date(target));
  const landed = (await stat(copy)).mtimeMs;
  const after = await loadIndex(copy);
  check(
    after.mtimeMs === landed && after.mtimeMs !== before.mtimeMs,
    'a capture touched without changing size rebuilds rather than reusing the sidecar',
  );
  check(after.bytes === before.bytes, 'and the rebuild finds the same bytes');
  await unlink(copy).catch(() => {});
  await unlink(indexPathFor(copy)).catch(() => {});
}

{
  // The sidecar exists so a writer that died mid-take leaves a usable file, so cut one mid-frame and check.
  const src = FIXTURES[0];
  const whole = await loadIndex(src);
  const keep = 100;
  const cutAt = whole.frames.offset[keep] + Math.floor(whole.frames.length[keep] / 2);
  const copy = `${SCRATCH}/index-check-cut.knct`;
  await copyFile(src, copy);
  const fh = await open(copy, 'r+');
  await fh.truncate(cutAt);
  await fh.close();
  const cut = await buildIndex(copy);
  check(cut.truncated === true, `a take cut inside frame ${keep} reports truncated`);
  check(cut.frames.offset.length === keep, `it indexes the ${keep} whole frames that landed (got ${cut.frames.offset.length})`);
  check(
    cut.frames.offset.every((o, i) => o === whole.frames.offset[i] && cut.frames.length[i] === whole.frames.length[i]),
    'and every surviving offset and length matches the intact take',
  );
  await unlink(copy).catch(() => {});
  await unlink(indexPathFor(copy)).catch(() => {});
}

console.log('\n== index agrees with the stream parser ==');
for (const path of FIXTURES) {
  const idx = scans.get(path).index;
  const walk = await parserWalk(path);
  const n = idx.frames.offset.length;
  check(walk.frames.length === n, `${path}: ${n} frames, parser found ${walk.frames.length}`);
  let bad = 0;
  for (let i = 0; i < Math.min(n, walk.frames.length); i++) {
    const w = walk.frames[i];
    if (w.offset !== idx.frames.offset[i] || w.length !== idx.frames.length[i] || w.stampMs !== idx.frames.stampMs[i]) bad++;
  }
  check(bad === 0, `${path}: every offset, length and stamp agrees (${bad} mismatches)`);
  check(walk.hash === idx.hash, `${path}: content hash agrees with an independent digest`);
}

console.log('\n== frame API is byte-identical to the file ==');
const BIG = FIXTURES[FIXTURES.length - 1];
{
  const capture = await loadIndex(BIG);
  const id = captureIdFor(BIG);
  const n = capture.frames.offset.length;
  const walk = await parserWalk(BIG);
  const fh = await open(BIG, 'r');

  const served = JSON.parse((await getBytes(`${URL_BASE}/capture/${id}/index`)).toString('utf8'));
  check(served.hash === capture.hash, `${id}: /index serves the sidecar's hash`);
  check(served.frames.offset.length === n, `${id}: /index serves ${n} frames`);

  // One deliberately past the 2 GiB mark, which is the offset a whole-file read could not reach at all.
  const past2Gib = walk.frames.findIndex((f) => f.offset > 2 ** 31);
  const picks = [0, Math.floor(Math.random() * (n - 2)) + 1, past2Gib, n - 1];
  for (const k of picks) {
    // Offsets come from the parser walk, so a wrong index cannot make a frame agree with itself.
    const w = walk.frames[k];
    const onDisk = Buffer.alloc(w.length);
    await fh.read(onDisk, 0, w.length, w.offset);
    const overHttp = await getBytes(`${URL_BASE}/capture/${id}/frame/${k}`);
    check(
      overHttp.length === onDisk.length && overHttp.equals(onDisk),
      `frame ${k} of ${n} (${w.length} bytes at ${w.offset}) is byte-identical over HTTP`,
    );
  }

  // A run comes back framed, so it has to parse back into the payloads the single-frame endpoint serves.
  const a = Math.floor(n / 2);
  const b = a + 7;
  const run = await getBytes(`${URL_BASE}/capture/${id}/frames/${a}-${b}`);
  const runParser = new MessageParser();
  const got = [...runParser.push(run)].filter((m) => m.type === TYPE_FRAME);
  check(got.length === b - a + 1, `frames/${a}-${b} parses back to ${b - a + 1} frames (got ${got.length})`);
  let runBad = 0;
  for (let i = 0; i < got.length; i++) {
    const w = walk.frames[a + i];
    const onDisk = Buffer.alloc(w.length);
    await fh.read(onDisk, 0, w.length, w.offset);
    if (!got[i].payload.equals(onDisk)) runBad++;
  }
  check(runBad === 0, `every payload in the run is byte-identical (${runBad} mismatches)`);

  check((await fetch(`${URL_BASE}/capture/${id}/frame/${n}`)).status === 404, 'a frame past the end is 404');
  check((await fetch(`${URL_BASE}/capture/${id}/frames/${n - 1}-${n - 4}`)).status === 404, 'a backwards range is 404');
  // Encoded so the separators survive URL normalisation and the whole thing arrives as one path segment.
  const traversal = await fetch(`${URL_BASE}/capture/..%2f..%2fetc%2fpasswd/index`);
  check(traversal.status === 404, `a traversing id is refused by the id guard (${traversal.status})`);
  check((await fetch(`${URL_BASE}/capture/nosuch/index`)).status === 404, 'an unknown capture is 404');

  await fh.close();
}

console.log('\n== the run endpoint survives the file moving underneath it ==');
{
  // The run used to be reopened by path while everything else read a retained handle: ENOENT inside a stream, after the headers had gone out, killed the process.
  const id = `index-check-victim-${process.pid}`;
  const victim = `captures/${id}.knct`;
  const replacement = `${SCRATCH}/index-check-replacement.knct`;

  const src = FIXTURES[0];
  const srcIndex = await loadIndex(src);
  await copyFile(src, victim);
  // Same length, one byte different inside frame 0's payload, so a wrong answer can only mean the wrong file.
  await copyFile(src, replacement);
  const rfh = await open(replacement, 'r+');
  const one = Buffer.alloc(1);
  await rfh.read(one, 0, 1, srcIndex.frames.offset[0] + 40);
  one[0] ^= 0xff;
  await rfh.write(one, 0, 1, srcIndex.frames.offset[0] + 40);
  await rfh.close();

  const original = await getBytes(`${URL_BASE}/capture/${id}/frame/0`);
  check(original.length === srcIndex.frames.length[0], `${id}: opened and served frame 0`);

  await unlink(victim);
  const afterDelete = await getBytes(`${URL_BASE}/capture/${id}/frame/0`);
  check(afterDelete.equals(original), 'with the file deleted, /frame still serves it off the retained handle');
  const runAfterDelete = await getBytes(`${URL_BASE}/capture/${id}/frames/0-3`);
  const deletedRun = [...new MessageParser().push(runAfterDelete)].filter((m) => m.type === TYPE_FRAME);
  check(deletedRun.length === 4 && deletedRun[0].payload.equals(original), 'and /frames does too, rather than killing the server');

  await copyFile(replacement, victim);
  const afterSwap = await getBytes(`${URL_BASE}/capture/${id}/frame/0`);
  const runAfterSwap = await getBytes(`${URL_BASE}/capture/${id}/frames/0-3`);
  const swappedRun = [...new MessageParser().push(runAfterSwap)].filter((m) => m.type === TYPE_FRAME);
  check(
    afterSwap.equals(original) && swappedRun[0].payload.equals(original),
    'after a same-name re-record, /frame and /frames still agree with each other',
  );

  const alive = await fetch(`${URL_BASE}/capture/${id}/index`);
  check(alive.status === 200, `the server is still up afterwards (${alive.status})`);
  check((await fetch(`${URL_BASE}/%zz`)).status === 400, 'a malformed percent escape is 400, not a dead process');

  await unlink(victim).catch(() => {});
  await unlink(indexPathFor(victim)).catch(() => {});
  await unlink(replacement).catch(() => {});
  await unlink(indexPathFor(replacement)).catch(() => {});
}

console.log('\n== per-frame fetch latency over loopback ==');
{
  const id = captureIdFor(BIG);
  const idx = await loadIndex(BIG);
  const n = idx.frames.offset.length;
  console.log(
    `method: ${id}, ${n} frames, ${SAMPLES} samples per arm, first ${WARMUP} discarded,\n` +
    'arms alternated sample by sample, node fetch over loopback, file warm in the page cache.',
  );
  const random = [];
  const sequential = [];
  let seq = 0;
  let bytes = 0;
  for (let i = 0; i < SAMPLES + WARMUP; i++) {
    const r = await timedGet(`${URL_BASE}/capture/${id}/frame/${Math.floor(Math.random() * n)}`);
    const s = await timedGet(`${URL_BASE}/capture/${id}/frame/${seq++ % n}`);
    if (i >= WARMUP) {
      random.push(r.dt);
      sequential.push(s.dt);
      bytes = r.bytes;
    }
  }
  console.log(`\n  payload ${(bytes / 1024).toFixed(0)} KB`);
  console.log(`  random interior   p50 ${ms(pct(random, 50))}   p90 ${ms(pct(random, 90))}`);
  console.log(`  sequential walk   p50 ${ms(pct(sequential, 50))}   p90 ${ms(pct(sequential, 90))}`);

  // A prefetch run is why the range endpoint exists: eight frames one at a time against the same eight as a run.
  const RUN = 8;
  const perFrame = [];
  const asRun = [];
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(Math.random() * (n - RUN));
    let t0 = performance.now();
    for (let k = 0; k < RUN; k++) await getBytes(`${URL_BASE}/capture/${id}/frame/${a + k}`);
    perFrame.push(performance.now() - t0);
    t0 = performance.now();
    await getBytes(`${URL_BASE}/capture/${id}/frames/${a}-${a + RUN - 1}`);
    asRun.push(performance.now() - t0);
  }
  console.log(`\n  ${RUN} frames, one request each   p50 ${ms(pct(perFrame.slice(4), 50))}   p90 ${ms(pct(perFrame.slice(4), 90))}`);
  console.log(`  ${RUN} frames, one range request  p50 ${ms(pct(asRun.slice(4), 50))}   p90 ${ms(pct(asRun.slice(4), 90))}`);
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
