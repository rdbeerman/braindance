// The levelling pair's composition, called directly.
//
// **The order is the only thing worth testing here, and a test that got the order wrong
// would still pass on most inputs.** `Rx(tilt) * Rz(roll)` and `Rz(roll) * Rx(tilt)` are
// the same rotation whenever either angle is zero, which is why `level-check` plants a
// surface at roll 27 rather than leaning it away from the sensor - a fixture that tips
// along one axis alone is carried onto the vertical by both orders and can see nothing.
// So every comparison below moves both angles at once, and there is one row whose whole
// job is to say the two orders differ, because that row failing is what it means for this
// file to have stopped testing anything.
//
// The oracle is written out longhand rather than read back from the module, for the
// reason `registry-check` gives about its own copy: a test that asked the implementation
// what order it used would agree with it by construction and could never see the swap.
// This is the third statement of that order in the repo, and the three are deliberately
// independent - `level-check` says the order has a visible consequence, `registry-check`
// says which order reaches the cloud the renderer draws, and this one says the arithmetic
// is right without a browser in the room.
//
// Run by `npm run test:unit`, which needs no server, no sensor and no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tiltQuaternion } from '../web/world-tilt.js';

/**
 * `Rx(tilt) * Rz(roll)` as x, y, z, w, from the half-angle form.
 *
 * The same four products `registry-check.mjs` uses, so the two agree about what is being
 * claimed rather than about how it is spelled.
 */
const levellingQuaternion = (tiltDeg, rollDeg) => {
  const t = (tiltDeg * (Math.PI / 180)) / 2;
  const r = (rollDeg * (Math.PI / 180)) / 2;
  const st = Math.sin(t); const ct = Math.cos(t);
  const sr = Math.sin(r); const cr = Math.cos(r);
  return [st * cr, -st * sr, ct * sr, ct * cr];
};

const compose = (tilt, roll) => tiltQuaternion(tilt, roll, new THREE.Quaternion()).toArray();

const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const nearAll = (got, want, tol = 1e-12) => got.every((v, i) => near(v, want[i], tol));

test('the pair composes as Rx(tilt) * Rz(roll), with both angles moving at once', () => {
  // 13.5 and 27 are the values `registry-check`'s scrambled set and `level-check`'s
  // surface B use, so a disagreement here is a disagreement with what those tools plant.
  for (const [tilt, roll] of [[13.5, 27], [-42.25, 118.5], [90, -180], [7, 0.5]]) {
    const got = compose(tilt, roll);
    const want = levellingQuaternion(tilt, roll);
    assert.ok(nearAll(got, want), `tilt ${tilt} roll ${roll}: ${got} against ${want}`);
  }
});

test('the two orders are different rotations, which is what makes the order a claim', () => {
  // The falsification row. Under `ZYX` the module would return this instead, and every
  // comparison above would fail - so if this one ever passes trivially, the test above is
  // asserting something both orders satisfy and has stopped covering the swap.
  const swapped = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(13.5), 0, THREE.MathUtils.degToRad(27), 'ZYX'),
  ).toArray();
  const got = compose(13.5, 27);
  assert.ok(!nearAll(got, swapped, 1e-6), `the orders agreed at ${got}, so nothing here can see the swap`);
});

test('either angle alone is the same rotation under both orders, which is why the fixtures lean twice', () => {
  for (const [tilt, roll] of [[31, 0], [0, 31]]) {
    const swapped = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(tilt), 0, THREE.MathUtils.degToRad(roll), 'ZYX'),
    ).toArray();
    assert.ok(nearAll(compose(tilt, roll), swapped),
      `tilt ${tilt} roll ${roll} distinguished the orders, which no single-axis lean can do`);
  }
});

test('the angles are degrees, and neutral is the identity', () => {
  assert.deepEqual(compose(0, 0).map((v) => Number(v.toFixed(12))), [0, 0, 0, 1]);
  // A quarter turn of roll is sin(45 deg) on z and w. Read in radians instead, 90 would
  // be 5157 degrees and land nowhere near this.
  const quarter = compose(0, 90);
  assert.ok(near(quarter[2], Math.SQRT1_2) && near(quarter[3], Math.SQRT1_2), `${quarter}`);
});

test('the target is the caller\'s object, written in place and handed back', () => {
  const out = new THREE.Quaternion();
  const returned = tiltQuaternion(13.5, 27, out);
  assert.equal(returned, out, 'the return is the object that was passed in');
  // Two calls into two objects, because the module reuses one Euler internally: the
  // second call must not have moved the first answer.
  const first = tiltQuaternion(13.5, 27, new THREE.Quaternion()).toArray();
  const second = tiltQuaternion(-60, 5, new THREE.Quaternion()).toArray();
  assert.ok(nearAll(first, levellingQuaternion(13.5, 27)), `${first}`);
  assert.ok(nearAll(second, levellingQuaternion(-60, 5)), `${second}`);
});
