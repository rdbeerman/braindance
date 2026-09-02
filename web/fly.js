// Where the six fly keys point the camera, and how far one frame of holding them moves it.
//
// Outside `main.js` so a node test can state the directions in longhand: the pole Q and E climb
// is the caller's, not the camera's own vertical, and that is the part a browser cannot see.

import * as THREE from 'three';

export const FLY_SPEED_MPS = 1;
export const FLY_FAST = 3;
export const FLY_STALL_S = 0.1;

// Which way each key pushes. The first four are camera-space and turn with the view; the last
// two take the pole the caller passes, so they climb the room rather than the picture.
const FLY_KEYS = new Map([
  ['KeyW', { local: [0, 0, -1] }],
  ['KeyS', { local: [0, 0, 1] }],
  ['KeyA', { local: [-1, 0, 0] }],
  ['KeyD', { local: [1, 0, 0] }],
  ['KeyE', { pole: 1 }],
  ['KeyQ', { pole: -1 }],
]);

const flyAxis = new THREE.Vector3();

/** Whether a key code is one of the six fly keys. */
function isFlyKey(code) {
  return FLY_KEYS.has(code);
}

/**
 * Where the held key codes point: a unit vector in world space, or zero. Written into `out`
 * and returned, so the caller decides what object carries it.
 */
function flyDirection(held, quaternion, up, out) {
  out.set(0, 0, 0);
  for (const [code, push] of FLY_KEYS) {
    if (!held.has(code)) continue;
    if (push.pole) out.addScaledVector(flyAxis.copy(up).normalize(), push.pole);
    else out.add(flyAxis.fromArray(push.local).applyQuaternion(quaternion));
  }
  // Normalised, so a diagonal is no faster than one key and W against S is nothing at all.
  return out.lengthSq() < 1e-12 ? out.set(0, 0, 0) : out.normalize();
}

/**
 * One frame's displacement into `out`: direction x speed x the elapsed seconds, shift tripling
 * it. The cap is why a stalled tab does not teleport the camera on the frame it comes back.
 */
function flyStep(held, fast, dtSec, quaternion, up, out) {
  flyDirection(held, quaternion, up, out);
  const speed = FLY_SPEED_MPS * (fast ? FLY_FAST : 1);
  return out.multiplyScalar(speed * Math.min(Math.max(dtSec, 0), FLY_STALL_S));
}

export { isFlyKey, flyDirection, flyStep };
