// The levelling pair's composition, called directly. `Rx(tilt) * Rz(roll)` and its swap are the
// same rotation whenever either angle is zero, so every comparison moves both angles at once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tiltQuaternion } from '../web/world-tilt.js';

/** `Rx(tilt) * Rz(roll)` as x, y, z, w, from the half-angle form - written out longhand so it
 *  cannot agree with the module by construction. */
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
  // 13.5 and 27 are the values `registry-check`'s scrambled set and `level-check`'s surface B
  // use, so a disagreement here is a disagreement with what those tools plant.
  for (const [tilt, roll] of [[13.5, 27], [-42.25, 118.5], [90, -180], [7, 0.5]]) {
    const got = compose(tilt, roll);
    const want = levellingQuaternion(tilt, roll);
    assert.ok(nearAll(got, want), `tilt ${tilt} roll ${roll}: ${got} against ${want}`);
  }
});

test('the two orders are different rotations, which is what makes the order a claim', () => {
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
  const quarter = compose(0, 90);
  assert.ok(near(quarter[2], Math.SQRT1_2) && near(quarter[3], Math.SQRT1_2), `${quarter}`);
});

test('the target is the caller\'s object, written in place and handed back', () => {
  const out = new THREE.Quaternion();
  const returned = tiltQuaternion(13.5, 27, out);
  assert.equal(returned, out, 'the return is the object that was passed in');
  // Two calls into two objects, because the module reuses one Euler internally.
  const first = tiltQuaternion(13.5, 27, new THREE.Quaternion()).toArray();
  const second = tiltQuaternion(-60, 5, new THREE.Quaternion()).toArray();
  assert.ok(nearAll(first, levellingQuaternion(13.5, 27)), `${first}`);
  assert.ok(nearAll(second, levellingQuaternion(-60, 5)), `${second}`);
});
