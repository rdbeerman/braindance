export const RATE_MIN = 0.1;
export const RATE_MAX = 4;

export function usableClipRate(value) {
  return Number.isFinite(value) && value >= RATE_MIN && value <= RATE_MAX;
}

/** The lower or upper integer midpoint of an inclusive safe-integer interval. */
export function integerMidpoint(lo, hi, upper = false) {
  return lo + Math.floor((hi - lo + (upper ? 1 : 0)) / 2);
}

/** Counts the union of inclusive frame ranges requested from each take. */
export function frameLoadByTake(spans) {
  const ranges = new Map();
  for (const span of spans) {
    const list = ranges.get(span.take) ?? [];
    list.push([span.from, span.to]);
    ranges.set(span.take, list);
  }

  const loads = new Map();
  for (const [take, list] of ranges) {
    list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let frames = 0;
    let from = null;
    let to = null;
    for (const [nextFrom, nextTo] of list) {
      if (from === null) {
        from = nextFrom;
        to = nextTo;
      } else if (nextFrom <= to + 1) {
        to = Math.max(to, nextTo);
      } else {
        frames += to - from + 1;
        from = nextFrom;
        to = nextTo;
      }
    }
    if (from !== null) frames += to - from + 1;
    loads.set(take, frames);
  }
  return loads;
}

export const snapshotClipKeys = (tracks) => [...tracks]
  .flatMap((track) => track.keys.map((key) => [key, key.t]));

/** Rescales clip-local key times around the retime curve's rate pivot. */
export function rescaleClipKeys(snapshot, factor, pivot = 0) {
  for (const [key, time] of snapshot) key.t = pivot + (time - pivot) * factor;
}
