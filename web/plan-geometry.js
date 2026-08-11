// How a place in the room becomes a pixel in the top-down inset, and how a world point
// projects through a camera onto the stage.
//
// Pure arithmetic over numbers and three.js vectors. The drawing that uses it stays in
// `main.js` - the plan's own scatter, the camera path, the frustum, the crop box - and it
// stays there because all of it needs a 2D context and the depth frame that is already on
// the CPU. What crosses is the coordinate change, which is the half a node test can hold:
// `planPoint` and `planWorld` are inverses, and nothing asserted that while the two of
// them sat inside a fifteen-thousand-line module with a canvas in it.
//
// **`insetRect` did not come, and that is a departure from the plan this split was written
// against, reported rather than quietly made.** It was to be lifted here taking a `{w, h}`
// stage instead of reading the renderer. Measured against the tree: that is seven call
// sites in `main.js`, plus `__kinect.editor.chrome.inset`, which is published as a
// zero-argument function and is called with no arguments by the body `keyframe-check`
// plants for `--mutate chrome-in-frame`. A signature change there turns a mutation that
// must be caught into a page that throws inside the render loop, which is a control
// reporting a crash instead of a catch. The one thing that would have bought is an
// assertion about where the inset sits, and the constant it is built from is here, so
// there is still exactly one statement of that.

import * as THREE from 'three';

const INSET = { w: 176, h: 118, margin: 8 };
// Metres across the plan view's shorter axis.
const TOP_SPAN = 7;
// Centred a little deeper than the orbit target, so the sensor at the origin sits
// inside the frame rather than on its edge - the plan is unreadable without it,
// because everything in it is a distance from there.
const TOP_CENTRE = { x: 0, z: -2.6 };
// Every fourth pixel each way, so the plan is thirteen thousand points rather than
// two hundred and seventeen thousand. At a hundred and eighteen pixels tall the
// rest would land on top of each other anyway, and this runs on the main thread on
// every paint.
const PLAN_STRIDE = 4;
const FRUSTUM_LEN = 0.55;

// This module's own scratch, not one shared with the caller's. A `Vector3` exported for
// two modules to write into is the writable object `module-check` rule 3 refuses, and it
// would need an exemption to buy an allocation that is not happening either way: both
// this one and the one `main.js` keeps are fully written before they are read on every
// call, so there is no state in either to share.
const scratchVec = new THREE.Vector3();

/** World x/z to a point in the plan view, and back. Screen up is deeper into the room. */
function planScale(rect) { return rect.h / TOP_SPAN; }

function planPoint(rect, x, z) {
  const s = planScale(rect);
  return {
    x: rect.x + rect.w / 2 + (x - TOP_CENTRE.x) * s,
    y: rect.y + rect.h / 2 + (z - TOP_CENTRE.z) * s,
  };
}

function planWorld(rect, px, py) {
  const s = planScale(rect);
  return {
    x: TOP_CENTRE.x + (px - rect.x - rect.w / 2) / s,
    z: TOP_CENTRE.z + (py - rect.y - rect.h / 2) / s,
  };
}

/** A point projected through a perspective camera into stage pixels, or null behind it. */
function projectThrough(position, camera, rect) {
  scratchVec.fromArray(position).project(camera);
  // `project` divides by w, and w is negative behind the camera - which flips the
  // sign and puts a point that is behind you on screen in front of you. z outside
  // the unit cube is the readable form of that test.
  if (scratchVec.z < -1 || scratchVec.z > 1) return null;
  return {
    x: rect.x + ((scratchVec.x + 1) / 2) * rect.w,
    y: rect.y + ((1 - scratchVec.y) / 2) * rect.h,
    z: scratchVec.z,
  };
}

export {
  INSET,
  TOP_SPAN,
  TOP_CENTRE,
  PLAN_STRIDE,
  FRUSTUM_LEN,
  planScale,
  planPoint,
  planWorld,
  projectThrough,
};
