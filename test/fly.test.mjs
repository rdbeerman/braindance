// The fly keys' directions and one frame's displacement, called directly. The rows that matter
// are the two a browser cannot separate: Q and E climb the pole they are handed rather than the
// camera's own vertical, and a frame that arrives after a stall moves the cap and not the gap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FLY_SPEED_MPS, FLY_FAST, FLY_STALL_S, isFlyKey, flyDirection, flyStep,
} from '../web/fly.js';

const UP = new THREE.Vector3(0, 1, 0);
const held = (...codes) => new Set(codes);
const dir = (codes, quaternion = new THREE.Quaternion()) => (
  flyDirection(codes, quaternion, UP, new THREE.Vector3()).toArray()
);
const step = (codes, fast, dt, quaternion = new THREE.Quaternion(), up = UP) => (
  flyStep(codes, fast, dt, quaternion, up, new THREE.Vector3())
);

const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const nearAll = (got, want, tol = 1e-12) => got.every((v, i) => near(v, want[i], tol));

/** Pitched down by `deg`, which is a rotation about the camera's local X. */
const pitched = (deg) => new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-deg),
);

test('the six keys are fly keys and nothing else is', () => {
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']) {
    assert.equal(isFlyKey(code), true, code);
  }
  for (const code of ['KeyZ', 'KeyF', 'KeyR', 'ArrowUp', 'Space', 'ShiftLeft', 'w', '']) {
    assert.equal(isFlyKey(code), false, code);
  }
});

test('W is the view direction, S is its opposite, and D is the camera\'s local +X', () => {
  assert.ok(nearAll(dir(held('KeyW')), [0, 0, -1]), `${dir(held('KeyW'))}`);
  assert.ok(nearAll(dir(held('KeyS')), [0, 0, 1]), `${dir(held('KeyS'))}`);
  assert.ok(nearAll(dir(held('KeyD')), [1, 0, 0]), `${dir(held('KeyD'))}`);
  assert.ok(nearAll(dir(held('KeyA')), [-1, 0, 0]), `${dir(held('KeyA'))}`);
  // Turned a quarter turn about the pole, so a camera-space direction is a different world one.
  const yawed = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
  assert.ok(nearAll(dir(held('KeyW'), yawed), [-1, 0, 0], 1e-9), `${dir(held('KeyW'), yawed)}`);
  assert.ok(nearAll(dir(held('KeyD'), yawed), [0, 0, -1], 1e-9), `${dir(held('KeyD'), yawed)}`);
});

test('E is the pole it was handed and not the camera\'s own vertical, however the camera is aimed', () => {
  const down = pitched(40);
  // The control: at this pitch the camera's local Y is 40 degrees off the pole, so a build
  // reading the camera's vertical answers somewhere else entirely.
  const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(down);
  assert.ok(localY.dot(UP) < 0.8, `the camera is not pitched: local Y dots the pole at ${localY.dot(UP)}`);
  assert.ok(nearAll(dir(held('KeyE'), down), [0, 1, 0], 1e-12), `${dir(held('KeyE'), down)}`);
  assert.ok(nearAll(dir(held('KeyQ'), down), [0, -1, 0], 1e-12), `${dir(held('KeyQ'), down)}`);
  // And a pole that is not the world's +Y is followed just as exactly, which is what levelling
  // and the sensor view hand in.
  const canted = new THREE.Vector3(0.3, 0.9, -0.2);
  const want = canted.clone().normalize().toArray();
  const got = flyDirection(held('KeyE'), down, canted, new THREE.Vector3()).toArray();
  assert.ok(nearAll(got, want, 1e-12), `${got} against ${want}`);
});

test('opposite keys cancel and a diagonal stays one unit long', () => {
  assert.deepEqual(dir(held('KeyW', 'KeyS')), [0, 0, 0]);
  assert.deepEqual(dir(held('KeyA', 'KeyD')), [0, 0, 0]);
  assert.deepEqual(dir(held('KeyQ', 'KeyE')), [0, 0, 0]);
  assert.deepEqual(dir(held()), [0, 0, 0]);
  const diagonal = dir(held('KeyW', 'KeyD'));
  assert.ok(near(Math.hypot(...diagonal), 1), `${diagonal} is ${Math.hypot(...diagonal)} long`);
  assert.ok(nearAll(diagonal, [Math.SQRT1_2, 0, -Math.SQRT1_2]), `${diagonal}`);
  const corner = dir(held('KeyW', 'KeyD', 'KeyE'));
  assert.ok(near(Math.hypot(...corner), 1), `${corner} is ${Math.hypot(...corner)} long`);
});

test('the target is the caller\'s object, written in place and handed back', () => {
  const out = new THREE.Vector3(9, 9, 9);
  assert.equal(flyDirection(held('KeyW'), new THREE.Quaternion(), UP, out), out);
  assert.ok(nearAll(out.toArray(), [0, 0, -1]), `${out.toArray()}`);
  const moved = new THREE.Vector3();
  assert.equal(flyStep(held('KeyW'), false, 0.05, new THREE.Quaternion(), UP, moved), moved);
});

test('a frame moves direction x speed x dt, and the first frame of a hold moves nothing', () => {
  // `nearAll` and not a deep equal: a direction of -1 scaled by zero is -0, which is the same
  // displacement and a different value.
  assert.ok(nearAll(step(held('KeyW'), false, 0).toArray(), [0, 0, 0]), 'dt 0 moved something');
  assert.ok(nearAll(step(held(), false, 0.05).toArray(), [0, 0, 0]), 'nothing held moved something');
  const tenth = step(held('KeyW'), false, 0.05);
  assert.ok(near(tenth.length(), 0.05 * FLY_SPEED_MPS), `${tenth.length()} m over 50 ms`);
  assert.ok(nearAll(tenth.toArray(), [0, 0, -0.05 * FLY_SPEED_MPS]), `${tenth.toArray()}`);
  // A negative delta is a clock that went backwards, which moves nothing rather than backwards.
  assert.ok(nearAll(step(held('KeyW'), false, -1).toArray(), [0, 0, 0]),
    `a negative delta moved ${step(held('KeyW'), false, -1).toArray()}`);
});

test('a frame after a stall moves the cap and not the gap', () => {
  const stalled = step(held('KeyW'), false, 5);
  assert.ok(near(stalled.length(), FLY_STALL_S * FLY_SPEED_MPS),
    `${stalled.length()} m over a 5 s gap, where the cap allows ${FLY_STALL_S * FLY_SPEED_MPS}`);
  assert.ok(stalled.length() < 0.2, `${stalled.length()} m is a teleport`);
  // The cap is a cap and not a floor: a frame inside it keeps its own length.
  const inside = step(held('KeyW'), false, FLY_STALL_S / 2);
  assert.ok(near(inside.length(), (FLY_STALL_S / 2) * FLY_SPEED_MPS), `${inside.length()}`);
});

test('shift multiplies the distance and leaves the direction alone', () => {
  const slow = step(held('KeyW'), false, 0.05);
  const fast = step(held('KeyW'), true, 0.05);
  assert.ok(near(fast.length(), slow.length() * FLY_FAST),
    `${fast.length()} against ${slow.length()} x ${FLY_FAST}`);
  assert.ok(near(fast.length(), 0.05 * FLY_SPEED_MPS * FLY_FAST), `${fast.length()}`);
  assert.ok(nearAll(fast.clone().normalize().toArray(), slow.clone().normalize().toArray()),
    `${fast.toArray()} against ${slow.toArray()}`);
  // And it multiplies the capped frame too, rather than the cap swallowing it.
  assert.ok(near(step(held('KeyW'), true, 5).length(), FLY_STALL_S * FLY_SPEED_MPS * FLY_FAST),
    `${step(held('KeyW'), true, 5).length()}`);
});
