// The window of program time the strip is drawn against, driven directly.
//
// **What this covers that `editor-check` cannot afford to.** Seven of its mutations are
// about this object - `zoom-about-centre`, `pointer-ignores-view`, `marks-ignore-view`,
// `mini-ignores-edges`, `mini-wheel-uses-ruler`, `zoom-pans-at-the-clamp` and
// `window-clamp-ratchets` - and every one of them costs a server, a browser, a 75-second
// capture and a pointer gesture, because until now the arithmetic could only be reached
// through a wheel. Two of the seven are pure arithmetic over two numbers, and those two are
// here: the clamp that must not ratchet, and the zoom that must not pan at the end of its
// travel. The other five are about which surface a gesture landed on and where a marker was
// drawn, which is a picture and stays a picture.
//
// The clamp row is the sharpest of them, and it is here in the shape the defect actually
// had: a round trip through two speeds. The browser arm needs a rate slider driven twice
// and an undo depth read between them; here it is a duration that changes under a window
// that was asked for once. Both arms assert the same thing, and neither replaces the other
// - what the browser proves is that the ruler on screen is drawn through this.
//
// **Each of the two carries the pre-fix arithmetic beside it**, written out longhand and
// asserted to give a different answer. Without that these rows would be comparing the
// module against itself: a clamp that never moves anything passes "the trip comes back"
// trivially, and a zoom that does nothing passes "a notch at the minimum is a no-op".
//
// Run by `npm run test:unit`, which needs no server, no sensor and no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_VIEW_SEC, ZOOM_PER_NOTCH, TICK_STEPS, tickLabel, makeViewWindow,
} from '../web/view-window.js';

// A window over a program of `sec` seconds, with a bed 1000px wide starting at x=100.
// Both readings are suppliers in the real program because both move; here the length is a
// box this file writes into, which is what lets a speed change be a single assignment.
const windowOver = (sec) => {
  const state = { sec, rect: { left: 100, width: 1000 } };
  const view = makeViewWindow({
    durationSec: () => state.sec,
    bedRect: () => state.rect,
  });
  return { view, state };
};

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('the ladder every rung of a ruler comes off divides the rung above it', () => {
  // The comment on `TICK_STEPS` says every rung divides the one above it or is half of it,
  // and that is what makes a zoom walk the labels through the ladder instead of relabelling
  // from scratch on each notch. Nothing asserted it while the array sat in the middle of a
  // fifteen-thousand-line module, so a rung inserted by hand could have broken the property
  // the comment claims and nothing would have said so.
  for (let i = 1; i < TICK_STEPS.length; i++) {
    const ratio = TICK_STEPS[i] / TICK_STEPS[i - 1];
    assert.ok(ratio > 1, `rung ${i} (${TICK_STEPS[i]}) does not climb from ${TICK_STEPS[i - 1]}`);
    assert.ok(near(ratio, Math.round(ratio), 1e-9) || near(ratio, 1.5, 1e-9) || near(ratio, 2.5, 1e-9),
      `rung ${TICK_STEPS[i]} is ${ratio} of ${TICK_STEPS[i - 1]}, which is neither a whole multiple nor one of the two half-steps the ladder uses`);
  }
});

test('a tick reads as a clock over a minute and as seconds under one', () => {
  assert.equal(tickLabel(5, 1), '5s');
  assert.equal(tickLabel(0.5, 0.5), '0.5s');
  assert.equal(tickLabel(1 / 30, 1 / 30), '0.03s');
  // Over a minute the label is `m:ss`, and the seconds keep the same number of decimals the
  // step does - a two-decimal rung under a minute cannot become a whole second over one, or
  // the labels either side of 60 would disagree about how precisely they are placed.
  assert.equal(tickLabel(90, 30), '1:30');
  assert.equal(tickLabel(90.5, 0.5), '1:30.5');
  assert.equal(tickLabel(3600, 600), '60:00');
});

test('a wheel notch is about eight to a factor of ten, which is what the constant claims', () => {
  // The comment on `ZOOM_PER_NOTCH` says "about eight notches per factor of ten", which is
  // the whole justification for the number being 1.33 rather than 2 or 1.05. Asserted as a
  // band rather than an equality, because the claim is about the feel of a flick.
  const notches = Math.log(10) / Math.log(ZOOM_PER_NOTCH);
  assert.ok(notches > 7 && notches < 9, `${notches.toFixed(2)} notches per decade`);
});

test('a position and a time are inverses of each other, under a window that is not the whole clip', () => {
  const { view } = windowOver(60);
  view.set(0.25, 0.4);
  for (const p of [0, 12.5, 50, 87.5, 100]) {
    assert.ok(near(view.pct(view.secAtPct(p)), p, 1e-9), `${p}% -> ${view.secAtPct(p)}s -> ${view.pct(view.secAtPct(p))}%`);
  }
  // And the window's own edges are 0 and 100, which is what makes `pct` a position across
  // the bed rather than across the clip - the seam `marks-ignore-view` attacks from the
  // other side.
  assert.ok(near(view.pct(view.startSec), 0));
  assert.ok(near(view.pct(view.endSec), 100));
  assert.ok(near(view.spanSec, 0.15 * 60, 1e-9), `${view.spanSec}`);
});

test('the pointer reads through the window rather than through the clip', () => {
  const { view } = windowOver(60);
  view.set(0.5, 0.75);
  // The left edge of the bed is the start of the window, the right edge is its end, and the
  // middle is the middle of the window - not of the clip. A build that divided by the
  // duration would answer 0, 30 and 60 here, which is the defect `pointer-ignores-view`
  // plants and the reason it looks plausible on screen.
  assert.ok(near(view.timeAt(100), 30), `${view.timeAt(100)}`);
  assert.ok(near(view.timeAt(600), 37.5), `${view.timeAt(600)}`);
  assert.ok(near(view.timeAt(1100), 45), `${view.timeAt(1100)}`);
  // Off either end is clamped to the window it is over, because a pointer that has left the
  // bed under a capture is still a position and has to be a time inside the program.
  assert.equal(view.timeAt(-500), 30);
  assert.equal(view.timeAt(9000), 45);
});

test('a window is never narrower than MIN_VIEW_SEC, however many notches ask', () => {
  const { view } = windowOver(60);
  for (let i = 0; i < 40; i++) view.zoomAbout(0.5, ZOOM_PER_NOTCH);
  assert.ok(near(view.spanSec, MIN_VIEW_SEC, 1e-9), `${view.spanSec}s against a floor of ${MIN_VIEW_SEC}s`);
  // A short program cannot have a window bigger than itself, so the floor is a fraction of
  // the whole clip there rather than a number of seconds.
  const short = windowOver(0.1);
  for (let i = 0; i < 40; i++) short.view.zoomAbout(0.5, ZOOM_PER_NOTCH);
  assert.ok(short.view.whole, `${short.view.a}..${short.view.b}`);
});

test('a notch at the minimum window does nothing rather than panning', () => {
  const { view } = windowOver(60);
  for (let i = 0; i < 40; i++) view.zoomAbout(0.5, ZOOM_PER_NOTCH);
  const at = { a: view.a, b: view.b };
  const moved = view.zoomAbout(0.5, ZOOM_PER_NOTCH);
  assert.equal(moved, false, `the window reported moving from ${at.a} to ${view.a}`);
  assert.ok(near(view.a, at.a) && near(view.b, at.b), `${at.a}..${at.b} -> ${view.a}..${view.b}`);

  // The pre-fix arithmetic, written out longhand: the span is taken without the clamp and
  // the start is derived from the factor rather than from the span that survives. At the
  // minimum window `set` refuses the span and keeps the start computed for it, so the
  // window holds its width and slides right - a gesture that could not zoom pans instead.
  // Without this the row above would pass on a `zoomAbout` that did nothing at all.
  const anchor = 0.5;
  const wouldBeSpan = (at.b - at.a) / ZOOM_PER_NOTCH;
  const wouldBeStart = anchor - (anchor - at.a) / ZOOM_PER_NOTCH;
  const { view: other } = windowOver(60);
  other.set(wouldBeStart, wouldBeStart + wouldBeSpan);
  assert.ok(!near(other.a, at.a, 1e-12),
    `the pre-fix start lands at ${other.a} where the clamped one holds ${at.a}, so this row is about the clamp`);
});

test('a round trip through two speeds comes back to the same window', () => {
  // The measurement the clamp's comment carries, run: at 0.1x the whole clip is 480s and
  // the minimum window is a fraction of 0.00052; at 4x the same clip is 12s and that
  // fraction is 0.0208 of it. A clamp applied to its own previous output keeps the widened
  // fraction, so coming back to 0.1x leaves the window ten seconds wide where it started at
  // a quarter of one - forty times wider, after a gesture that returns exactly.
  const { view, state } = windowOver(480);
  view.zoomAbout(0.5, 1e9);
  const asked = { a: view.wantA, b: view.wantB };
  assert.ok(near(view.spanSec, MIN_VIEW_SEC, 1e-9), `${view.spanSec}s at 0.1x`);

  state.sec = 12;
  view.reclamp();
  assert.ok(near(view.spanSec, MIN_VIEW_SEC, 1e-9), `${view.spanSec}s at 4x`);
  assert.ok(view.b - view.a > asked.b - asked.a,
    `the clamp did not bind at 4x, so the trip back proves nothing: ${view.b - view.a} against ${asked.b - asked.a}`);

  state.sec = 480;
  view.reclamp();
  assert.ok(near(view.spanSec, MIN_VIEW_SEC, 1e-9),
    `${view.spanSec}s back at 0.1x, where the window started at ${MIN_VIEW_SEC}s`);
  assert.ok(near(view.a, asked.a, 1e-12) && near(view.b, asked.b, 1e-12),
    `${asked.a}..${asked.b} -> ${view.a}..${view.b}`);

  // The accumulating clamp beside it - which is exactly what `window-clamp-ratchets` plants,
  // `view.set(view.a, view.b)` in place of `view.reclamp()`. It re-asks for what the clamp
  // last allowed rather than for what was wanted, so the widening at 4x survives the trip.
  const ratchet = windowOver(480);
  ratchet.view.zoomAbout(0.5, 1e9);
  const began = ratchet.view.b - ratchet.view.a;
  ratchet.state.sec = 12;
  ratchet.view.set(ratchet.view.a, ratchet.view.b);
  ratchet.state.sec = 480;
  ratchet.view.set(ratchet.view.a, ratchet.view.b);
  assert.ok(ratchet.view.spanSec > MIN_VIEW_SEC * 30,
    `the accumulating clamp came back to ${ratchet.view.spanSec}s, so this row is not about the difference between the two`);
  assert.ok(ratchet.view.b - ratchet.view.a > began * 30,
    `${began} -> ${ratchet.view.b - ratchet.view.a}`);
});

test('a zoom holds the fraction it was given where it already was', () => {
  const { view } = windowOver(100);
  view.set(0.2, 0.8);
  const anchor = 0.35;
  const before = view.pct(anchor * 100);
  view.zoomAbout(anchor, 2);
  assert.ok(near(view.pct(anchor * 100), before, 1e-9),
    `the anchor sat at ${before}% and now sits at ${view.pct(anchor * 100)}%`);
  assert.ok(near(view.b - view.a, 0.3, 1e-12), `${view.b - view.a}`);
});

test('the window stays inside the clip however it is asked to move', () => {
  const { view } = windowOver(100);
  view.set(0.5, 0.7);
  view.panBy(-10);
  assert.ok(view.a >= 0 && view.b <= 1, `${view.a}..${view.b}`);
  assert.ok(near(view.b - view.a, 0.2, 1e-12), 'a pan that hit the edge kept its width');
  view.panBy(10);
  assert.ok(view.a >= 0 && view.b <= 1, `${view.a}..${view.b}`);
  assert.ok(near(view.b, 1, 1e-12), `${view.b}`);
  assert.equal(view.fit(), true);
  assert.ok(view.whole && view.a === 0 && view.b === 1);
  assert.equal(view.fit(), false, 'fitting an already-whole window reports that nothing moved');
});

test('framing a range leaves a margin, so the two markers are not on the very edges', () => {
  const { view } = windowOver(100);
  view.frame(40, 60);
  assert.ok(view.startSec < 40 && view.endSec > 60, `${view.startSec}..${view.endSec}`);
  // A zero-length range still gets a window rather than a point, because the pad has the
  // same floor the window does.
  view.frame(50, 50);
  assert.ok(view.spanSec >= 2 * MIN_VIEW_SEC - 1e-9, `${view.spanSec}`);
});

test('a marker just outside the window is still drawn, because its corner is inside', () => {
  const { view } = windowOver(100);
  view.set(0.4, 0.6);
  assert.equal(view.holds(50), true);
  assert.equal(view.holds(40.5), true);
  // The margin is 2% of the window each side, which is 0.4s of a 20s window here.
  assert.equal(view.holds(39.7), true);
  assert.equal(view.holds(35), false);
  assert.equal(view.holds(80), false);
});

test('a window over nothing still divides, which is what the floor is for', () => {
  // `main.js` builds this before a take is open and the length reads 1; the floor is what
  // keeps a caller that arrives even earlier from dividing by zero. Every reading has to be
  // finite there, because the first paint runs before anything guards it.
  const { view, state } = windowOver(0);
  assert.ok(Number.isFinite(view.duration) && view.duration > 0, `${view.duration}`);
  assert.ok(Number.isFinite(view.pct(0)) && Number.isFinite(view.secAtPct(50)) && Number.isFinite(view.minSpan()));
  state.sec = -5;
  assert.ok(view.duration > 0, `${view.duration}`);
});
