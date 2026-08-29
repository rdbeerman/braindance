// Where a depth texel is in the room, and which texel is under the pointer.
//
// The forward map is here rather than in `main.js` because three things have to agree about
// it - the vertex shader unprojects with the same two uniforms, the top-down inset draws the
// cloud from it, and the orbit pivot picks a range with it - and a second spelling is a second
// place for the next correction to be forgotten.
//
// Pure arithmetic over numbers and three.js vectors, in the shape of `web/plan-geometry.js`:
// no renderer, no textures, no scene. Everything it needs arrives as an argument, so the pick
// can be driven under bare node against a grid written by hand.

import * as THREE from 'three';
import { DEPTH_H, DEPTH_W } from './format.js';

// This module's own scratch. Both are fully written before they are read on every use, so
// there is no state in either to share, and an exported vector two modules write into is the
// writable crossing `module-check` rule 3 refuses.
const scratch = new THREE.Vector3();
const scratchWorld = new THREE.Vector3();
const viewProjection = new THREE.Matrix4();
const tiltMatrix = new THREE.Matrix4();

/**
 * One depth sample as a point in sensor metres, written into `out` as `(x, y, -z)`.
 *
 * libfreenect2's pinhole model. Returns the positive distance along the optical axis, or 0
 * for a sample with no return - which is what the crop test and the shader's empty-sample
 * test both read, so a caller never has to know that 0 means "no return" twice over.
 */
export function sensorPoint(out, mm, col, row, fx, fy, cx, cy) {
  if (mm === 0) return 0;
  const z = mm * 0.001;
  out.set((-(col + 0.5 - cx) / fx) * z, -((row + 0.5 - cy) / fy) * z, -z);
  return z;
}

// How far from the pointer a sample may land and still be a candidate, in stage pixels, and how
// coarsely the grid is swept looking for one. The two are not independent: a stride-2 sweep of a
// surface two metres out lands its samples about 6.3 stage pixels apart at 1080p, so a radius of
// six admits exactly one of them and every rule below about outvoting a stray texel becomes a
// rule about a population of one. Twelve is the smallest radius that reliably has company in it,
// and it is still about a fingertip on the stage.
export const PICK_RADIUS_PX = 12;
export const PICK_STRIDE = 2;

// How deep a cluster of candidates is allowed to be before it is two surfaces rather than one.
//
// **The nearest candidate is not the answer, and taking the median of the cluster around it is
// not either.** A lone bright texel on a dark surface reads as a spike metres in front of it,
// and a spike is alone: it is its own cluster of one, so a median taken across it returns the
// spike itself. What discards it is company - the clusters are walked from the front and the
// first one holding more than one sample wins, so a real surface outvotes a stray texel and a
// genuinely thin object still wins outright as long as the sweep found it twice.
export const PICK_TOLERANCE_M = 0.15;

/**
 * The distance from the camera to whatever is under a point on the stage, or null.
 *
 * Swept on the CPU rather than raycast or read back off the GPU: one depth texel is one vertex
 * and the unprojection happens in the vertex stage, so there is no CPU geometry to raycast
 * against, and a 1x1 readback would be a second program alongside the assembled cloud shader
 * and a pipeline stall on every press.
 *
 * **The sweep is undisplaced.** `noise`, `regionPush`, `ripple`, `glitch` and the lattice move
 * points in the vertex stage and the mosh drags the whole picture off the geometry underneath,
 * so with any of those up this answers where the surface really is rather than where the eye is
 * aimed. For a pivot that is the better answer - a pivot that jitters with the glitch is not a
 * pivot - but it is a difference between what is drawn and what is picked, and it will not feel
 * like one during a heavy mosh.
 */
export function pickDepth({
  depth, focal, center, tilt, camera, stage, x, y,
  croppedOut = () => false,
  radiusPx = PICK_RADIUS_PX,
  stride = PICK_STRIDE,
  tolerance = PICK_TOLERANCE_M,
}) {
  const hit = sweep({ depth, focal, center, tilt, camera, stage, x, y, croppedOut, radiusPx, stride, tolerance });
  if (hit || stride === 1) return hit;
  // One retry at every texel before giving up, because at stride 2 a surface far enough away
  // that its texels land more than six pixels apart is a surface a press slips between.
  //
  // The whole grid rather than a window around the pointer: which texels land near the pointer
  // is what the sweep is computing, so there is no texel-space window to open without first
  // inverting the projection. Four times the samples of a run that already measures well under
  // the budget, on the small fraction of presses that miss.
  return sweep({ depth, focal, center, tilt, camera, stage, x, y, croppedOut, radiusPx, stride: 1, tolerance });
}

function sweep({ depth, focal, center, tilt, camera, stage, x, y, croppedOut, radiusPx, stride, tolerance }) {
  const { x: fx, y: fy } = focal;
  const { x: cx, y: cy } = center;
  // The tilt, the view and the projection folded into one matrix, so the inner loop is a
  // multiply, a divide and two compares rather than three transforms.
  camera.updateMatrixWorld();
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(tiltMatrix.makeRotationFromQuaternion(tilt));
  const radius2 = radiusPx * radiusPx;
  const eye = camera.position;
  const candidates = [];
  let samples = 0;
  for (let row = 0; row < DEPTH_H; row += stride) {
    for (let col = 0; col < DEPTH_W; col += stride) {
      const z = sensorPoint(scratch, depth[row * DEPTH_W + col], col, row, fx, fy, cx, cy);
      if (z === 0) continue;
      // A press must not pivot on geometry the renderer discarded.
      if (croppedOut(scratch.x, scratch.y, z)) continue;
      scratchWorld.copy(scratch).applyQuaternion(tilt);
      scratch.applyMatrix4(viewProjection);
      // `applyMatrix4` divides by w, and w is negative behind the camera - which flips the sign
      // and puts a point at your back on screen in front of you. z outside the unit cube is the
      // readable form of that test, the same one `projectThrough` makes.
      if (scratch.z < -1 || scratch.z > 1) continue;
      samples++;
      const px = stage.x + ((scratch.x + 1) / 2) * stage.w - x;
      const py = stage.y + ((1 - scratch.y) / 2) * stage.h - y;
      if (px * px + py * py > radius2) continue;
      candidates.push({ distance: eye.distanceTo(scratchWorld), world: scratchWorld.toArray() });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  let cluster = null;
  for (let start = 0; start < candidates.length; start++) {
    let end = start;
    while (end + 1 < candidates.length
      && candidates[end + 1].distance - candidates[start].distance <= tolerance) end++;
    if (cluster === null) cluster = [start, end];
    if (end > start) { cluster = [start, end]; break; }
    start = end;
  }
  // The middle of whichever cluster won, so the distance is a value the surface actually holds
  // rather than its front edge.
  const chosen = candidates[cluster[0] + ((cluster[1] - cluster[0]) >> 1)];
  return {
    distance: chosen.distance,
    world: chosen.world,
    samples,
    candidates: candidates.length,
    cluster: cluster[1] - cluster[0] + 1,
  };
}
