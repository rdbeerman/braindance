// How a sensor's tilt and roll compose into the one rotation the room is drawn through.
//
// A file of its own because the order of that composition is the whole content, and the
// order is what two proof tools are pointed at: `level-check --mutate level-order-swapped`
// plants the swap and grades a plane fit through it, and `registry-check` writes the same
// rotation out longhand and compares against where it lands. Both of them cost a browser,
// a server and either a capture or analytic planes pushed straight into a depth texture,
// which is a heavy way to ask a question that is four multiplications wide. Here a node
// test states the order in longhand and compares, with nothing running.
//
// It deliberately does not reach for the levelling group the rotation lands on, which is a
// clip's and lives behind `web/point-cloud.js` and so behind `web/scene.js`. That module builds
// a `WebGLRenderer` in its body and appends a canvas, so importing it would put a browser
// between this arithmetic and every test of it. The destination arrives as an argument instead,
// and the caller is the one holding a scene.

import * as THREE from 'three';

// A sensor is a thing somebody bolted to something, and nothing measures the angle it
// ended up at: libfreenect2's device API offers the two sets of camera intrinsics and
// no accelerometer, so a cloud shot from a dashboard mount arrives canted and there is
// no gravity vector anywhere to straighten it by. A human has to say which way is up.
//
// Two angles and not three. `roll` turns the picture in its frame, which is what a
// sensor rotated in its bracket does, and `tilt` pitches the room, which is what a
// sensor aimed downward does. The third would be yaw about the room's vertical, and
// that is not levelling at all - it is what dragging on the picture already does, so a
// slider for it would be a second way to say one thing.
//
// **The order is stated because the pair does not commute.** `Rx(tilt) * Rz(roll)`,
// which is three's own `XYZ` Euler with the middle angle left at zero. Read the other
// way round, neither slider does one visible thing any more: each starts moving the
// room along two axes at once and the panel stops being usable by eye.
//
// One Euler, reused. It is fully written on every call before it is read, and levelling
// is cheap to call on every write - which includes every frame of a clip that keys the
// pair - so the allocation is worth not making.
const tiltEuler = new THREE.Euler(0, 0, 0, 'XYZ');

/**
 * The two angles, in degrees, as the one rotation they mean. Written into `out` and
 * returned, so the caller decides what object carries it.
 *
 * The destination is a parameter rather than something this module imports, and that is
 * the load-bearing part of the signature rather than a style choice. The rotation lives on
 * each clip's own levelling group, and importing that binding to write it would drag a
 * renderer into every caller - including a test, which is the reason this file exists.
 */
function tiltQuaternion(tilt, roll, out) {
  tiltEuler.set(THREE.MathUtils.degToRad(tilt), 0, THREE.MathUtils.degToRad(roll));
  return out.setFromEuler(tiltEuler);
}

export { tiltQuaternion };
