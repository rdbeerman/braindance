// The trim a deliverable covers: what a bound is allowed to be, and what the pair is held
// to once it is written.
//
// **What this covers that `editor-check` does at a much higher price.** Its two rows here -
// `clip-range-unclamped` and `clip-bound-coerces-nonnumeric` - each need a server, a
// browser, a 75-second capture and a deliverable PUT through the project store, and what
// they assert at the end is arithmetic over two numbers and a duration. They still earn
// their place, because what they prove is that the transport and the readout are reached
// through this and that a refusal arrives on the page rather than in a stack trace. What is
// here is the property those rows are about, asked directly and asked of the cases a
// document has no way to produce: every combination of a bound that is not a time.
//
// **The pair is module state, so every row resets it.** That is not a wart to work around -
// it is the shape the program has, one clip range that the transport, the export and the
// two markers all read, and a test that could construct its own would be testing a
// different object from the one the editor uses.
//
// Run by `npm run test:unit`, which needs no server, no sensor and no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as clip from '../web/clip-range.js';

const { clipBoundOrThrow, writeClipRange } = clip;

// Back to the whole program, with no length to clamp against, which is the state the
// editor is in before a take opens.
const reset = () => writeClipRange({ in: 0, out: null }, null);

test('a bound is a finite number of program seconds, and null only at the out point', () => {
  reset();
  assert.equal(clipBoundOrThrow(0, 'in'), 0);
  assert.equal(clipBoundOrThrow(12.5, 'out'), 12.5);
  assert.equal(clipBoundOrThrow(-3, 'in'), -3, 'the predicate answers what a time is, and the clamp answers where it may be');
  assert.equal(clipBoundOrThrow(null, 'out'), null);
  // `null` at the in point has no reading to recover: "from the start" is a number and it
  // is zero, so a null there is a document that lost a value rather than one that meant
  // something by it.
  assert.throws(() => clipBoundOrThrow(null, 'in'), /in point is null/);
  for (const bad of [NaN, Infinity, -Infinity, '4', 'start', undefined, {}, [], true]) {
    assert.throws(() => clipBoundOrThrow(bad, 'out'), /not a program time/s,
      `${JSON.stringify(bad) ?? String(bad)} was accepted as an out point`);
  }
});

test('a bound that is not a time is refused before either end is written', () => {
  reset();
  writeClipRange({ in: 2, out: 8 }, 20);
  assert.throws(() => writeClipRange({ in: 'start', out: 9 }, 20), /not a program time/s);
  // **Both ends still hold what they held.** This is the whole reason the refusal is in
  // front of the clamp rather than inside it: the clamp is arithmetic, and arithmetic on
  // something that is not a number does not fail, it spreads - `Math.max(clipIn, ...)`
  // carries a NaN in the in point straight into an out point that was perfectly good.
  assert.equal(clip.clipIn, 2);
  assert.equal(clip.clipOut, 8);
  // **And the bad end second, which is the order that separates "refused" from "refused
  // before anything was written".** A build that asked and wrote one bound at a time passes
  // the case above - the first question throws and nothing has happened yet - and leaves
  // this one half applied, with a new in point and the old out point beside it. Measured:
  // with the two questions moved onto their own assignments, the row above stayed green and
  // only this one moved.
  assert.throws(() => writeClipRange({ in: 5, out: 'end' }, 20), /not a program time/s);
  assert.equal(clip.clipIn, 2, 'the in point was written by a call that was going to be refused');
  assert.equal(clip.clipOut, 8);
});

test('a field left out keeps whatever it held, which is how a marker drag writes one end', () => {
  reset();
  writeClipRange({ in: 3, out: 9 }, 20);
  writeClipRange({ in: 4 }, 20);
  assert.equal(clip.clipIn, 4);
  assert.equal(clip.clipOut, 9);
  writeClipRange({ out: 7 }, 20);
  assert.equal(clip.clipIn, 4);
  assert.equal(clip.clipOut, 7);
});

test('the pair is held inside the program that is open', () => {
  // The `editor-check-past` document, which is what arrives when a trim authored at 1x is
  // adopted onto the same take played at 2x: both bounds land past the end of the program.
  // Unheld, the in point ends up above the out point, `frameAt` composes to a constant and
  // every position the editor can ask for comes back as the same frame.
  reset();
  writeClipRange({ in: 60, out: 120 }, 30);
  assert.ok(clip.clipIn <= clip.clipOut, `in ${clip.clipIn} against out ${clip.clipOut}`);
  assert.equal(clip.clipIn, 30);
  assert.equal(clip.clipOut, 30);

  // A negative in point is a document too, and it is the other end of the same rule.
  reset();
  writeClipRange({ in: -5, out: 10 }, 30);
  assert.equal(clip.clipIn, 0);
  assert.equal(clip.clipOut, 10);

  // The out point held up against the in point rather than the other way round: dragging
  // the in marker past the out one takes the out one with it, which is the state two
  // markers dragged together already reach.
  reset();
  writeClipRange({ in: 4, out: 9 }, 30);
  writeClipRange({ in: 20 }, 30);
  assert.equal(clip.clipIn, 20);
  assert.equal(clip.clipOut, 20);
});

test('null stays null, because "to the end" is a statement rather than a time', () => {
  reset();
  writeClipRange({ in: 2, out: null }, 30);
  assert.equal(clip.clipOut, null,
    'a duration written in here would freeze "the whole clip" at the length it had today');
  // And it survives the program getting longer, which is what a retime does to it.
  writeClipRange({ in: 2 }, 300);
  assert.equal(clip.clipOut, null);
});

test('with no take open the pair is written and not clamped', () => {
  reset();
  writeClipRange({ in: 90, out: 200 }, null);
  assert.equal(clip.clipIn, 90);
  assert.equal(clip.clipOut, 200);
  // And the clamp lands the moment a program exists, which is the door a project file
  // loaded before a take comes through.
  writeClipRange({}, 30);
  assert.equal(clip.clipIn, 30);
  assert.equal(clip.clipOut, 30);
});

test('the invariant holds over every document a caller can hand it', () => {
  const durations = [1, 30, 75.6, 480];
  const bounds = [-10, 0, 0.5, 12, 29.999, 30, 75.6, 1e6];
  for (const dur of durations) {
    for (const inn of bounds) {
      for (const out of [...bounds, null]) {
        reset();
        writeClipRange({ in: inn, out }, dur);
        const held = `in ${inn} out ${out} over ${dur}s -> ${clip.clipIn}/${clip.clipOut}`;
        assert.ok(clip.clipIn >= 0 && clip.clipIn <= dur, held);
        if (clip.clipOut !== null) {
          assert.ok(clip.clipOut >= clip.clipIn && clip.clipOut <= dur, held);
        } else {
          assert.equal(out, null, `${held} - only a null asked for may stay null`);
        }
      }
    }
  }
});

test('a marker drag previews what its own release will commit', () => {
  // The two expressions the ruler's markers use, run through the same door the release
  // uses. **This row is here because they did not.** Before the pair moved into a module
  // the drag assigned the two bindings directly, so the out marker dragged left of the in
  // point with no out point set followed the pointer - and the release, which did pass the
  // door, clamped it back up to the in point. Measured on that build: a drag to 2s with the
  // in point at 5s drew the marker at 2s and released at 5s.
  const dur = 30;
  reset();
  writeClipRange({ in: 5, out: null }, dur);
  const t = 2;
  // The out marker's own clamp at its own end, which decides where a *pointer* may put a
  // marker, followed by the door, which decides what the pair may be at all.
  writeClipRange({ out: clip.clipOut === null ? t : Math.max(clip.clipIn, Math.min(t, dur)) }, dur);
  assert.equal(clip.clipOut, 5, 'the preview lands where the release lands');
  // The release, arriving at the same pointer position, agrees.
  writeClipRange({ out: Math.max(clip.clipIn, Math.min(t, dur)) }, dur);
  assert.equal(clip.clipOut, 5);

  // And the in marker, whose own clamp already held it against the out point, is unmoved by
  // the door - which is why this change is one marker's preview and not both.
  reset();
  writeClipRange({ in: 5, out: 20 }, dur);
  writeClipRange({ in: Math.max(0, Math.min(9, clip.clipOut ?? dur)) }, dur);
  assert.equal(clip.clipIn, 9);
  assert.equal(clip.clipOut, 20);
});
