// Does settle()'s drain scale with the take rather than with the buffer ceiling? Reproduces
// the drain against the real shape at four take lengths, interleaved rather than in
// increasing order. Control: the same lengths drained through a head index instead of shift().

const FRAME = 486 * 1024;
const LENGTHS = [27_000, 54_000, 108_000, 216_000];
const REPS = 3;

function buildQueue(n) {
  const q = new Array(n);
  for (let i = 0; i < n; i++) q[i] = (i + 1) * FRAME;
  return q;
}

// The drain exactly as server/recorder.js has it.
function drainByShift(inFlight, written) {
  let frames = 0;
  while (inFlight.length && inFlight[0] <= written) {
    inFlight.shift();
    frames++;
  }
  return frames;
}

// The same answer, taken with a moving head rather than by moving the array.
function drainByIndex(inFlight, written) {
  let head = 0;
  let frames = 0;
  while (head < inFlight.length && inFlight[head] <= written) {
    head++;
    frames++;
  }
  return frames;
}

const results = new Map();
for (const n of LENGTHS) results.set(n, { shift: [], index: [] });

// Interleaved, so allocator state and GC pressure land on both arms alike.
for (let rep = 0; rep < REPS; rep++) {
  for (const n of LENGTHS) {
    const written = n * FRAME;

    const qa = buildQueue(n);
    let t = process.hrtime.bigint();
    const a = drainByShift(qa, written);
    const shiftMs = Number(process.hrtime.bigint() - t) / 1e6;

    const qb = buildQueue(n);
    t = process.hrtime.bigint();
    const b = drainByIndex(qb, written);
    const indexMs = Number(process.hrtime.bigint() - t) / 1e6;

    if (a !== n || b !== n) throw new Error(`drained ${a}/${b} of ${n} - the probe is not draining the queue`);
    results.get(n).shift.push(shiftMs);
    results.get(n).index.push(indexMs);
  }
}

const median = (xs) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
console.log(`method: ${REPS} interleaved repetitions per length, median reported, no warmup discarded`);
console.log(`        ${(FRAME / 1024).toFixed(0)}KB frames, drained in one call with the disk fully caught up\n`);
console.log('frames    take @30fps   shift()      head index   ratio');
let prev = null;
for (const n of LENGTHS) {
  const s = median(results.get(n).shift);
  const i = median(results.get(n).index);
  const grow = prev ? (s / prev).toFixed(2) : '-';
  console.log(
    `${String(n).padStart(7)}   ${(n / 30 / 60).toFixed(1).padStart(5)} min   ${s.toFixed(1).padStart(8)}ms   ${i.toFixed(2).padStart(8)}ms   ${grow.padStart(5)}x per doubling`,
  );
  prev = s;
}
console.log('\nA doubling that costs ~4x is quadratic; ~2x is linear.');
