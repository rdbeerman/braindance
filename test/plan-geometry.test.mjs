// The top-down inset's coordinate change, and the projection beside it, called directly.
//
// **What this covers that `level-check` does not.** Its four plan arms - `plan-ignores-tilt`,
// `plan-skips-vertical-crop`, `plan-box-ignores-tilt`, `plan-x-not-mirrored` - are all
// about `drawPlanCloud`, which reads a depth frame off the CPU and paints into a 2D
// context, and none of them come here. What is here is the pair of directions of one
// coordinate change, and the property nothing in the repo asserted while they sat two
// hundred lines apart: that `planPoint` and `planWorld` are inverses. A drag on the plan
// reads a pointer through `planWorld` and the node is drawn back through `planPoint`, so
// the two disagreeing is a node that slides out from under the cursor - visible on screen
// and invisible to every check that only ever draws.
//
// Run by `npm run test:unit`, which needs no server, no sensor and no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  INSET, TOP_SPAN, TOP_CENTRE, PLAN_STRIDE, FRUSTUM_LEN,
  planScale, planPoint, planWorld, projectThrough,
} from '../web/plan-geometry.js';

// The rect `main.js` builds out of `INSET` for a 1920x1080 stage: the inset sits in the
// top-right corner, one margin in from both edges. Written out here rather than imported,
// because `insetRect` reads the renderer and this file has none - so this is the shape of
// what it returns rather than the thing itself.
const rect = {
  x: 1920 - INSET.w - INSET.margin, y: INSET.margin, w: INSET.w, h: INSET.h, stage: { w: 1920, h: 1080 },
};

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('the constants are the sizes the plan was drawn for', () => {
  assert.ok(INSET.w > 0 && INSET.h > 0 && INSET.margin > 0, JSON.stringify(INSET));
  assert.ok(TOP_SPAN > 0, `${TOP_SPAN}`);
  assert.ok(Number.isInteger(PLAN_STRIDE) && PLAN_STRIDE >= 1, `${PLAN_STRIDE}`);
  assert.ok(FRUSTUM_LEN > 0, `${FRUSTUM_LEN}`);
  // The centre is deeper into the room than the sensor, which is the whole reason it is
  // not the origin: at z 0 the sensor sits on the frame's edge and the plan is unreadable.
  assert.ok(TOP_CENTRE.z < 0, `${TOP_CENTRE.z}`);
});

test('the plan is scaled off its height, so TOP_SPAN metres fill the shorter axis', () => {
  assert.ok(near(planScale(rect), rect.h / TOP_SPAN), `${planScale(rect)}`);
  // Twice as tall a box shows the same metres at twice the pixels, which is what makes
  // the span a property of the room rather than of the inset.
  assert.ok(near(planScale({ ...rect, h: rect.h * 2 }), 2 * planScale(rect)));
});

test('the centre of the world lands in the centre of the box', () => {
  const p = planPoint(rect, TOP_CENTRE.x, TOP_CENTRE.z);
  assert.ok(near(p.x, rect.x + rect.w / 2), `${p.x}`);
  assert.ok(near(p.y, rect.y + rect.h / 2), `${p.y}`);
});

test('screen up is deeper into the room, and screen right is world +x', () => {
  const middle = planPoint(rect, TOP_CENTRE.x, TOP_CENTRE.z);
  // Canvas y grows downward, so a point further from the sensor - more negative z - has
  // to draw above the centre, which is a smaller y. Getting this backwards mirrors the
  // plan front to back and reads as a room turned inside out.
  const deeper = planPoint(rect, TOP_CENTRE.x, TOP_CENTRE.z - 1);
  assert.ok(deeper.y < middle.y, `${deeper.y} against ${middle.y}`);
  const right = planPoint(rect, TOP_CENTRE.x + 1, TOP_CENTRE.z);
  assert.ok(right.x > middle.x, `${right.x} against ${middle.x}`);
});

test('planPoint and planWorld are inverses, which is what a drag on the plan needs', () => {
  for (const [x, z] of [[0, 0], [1.25, -4.5], [-2, -0.75], [3.5, -6.25]]) {
    const p = planPoint(rect, x, z);
    const back = planWorld(rect, p.x, p.y);
    assert.ok(near(back.x, x) && near(back.z, z), `${x},${z} came back ${back.x},${back.z}`);
  }
  // And the other way round, starting from a pixel: a pointer lands on a pixel first and
  // the node is drawn back from the world position that pixel meant.
  for (const [px, py] of [[rect.x, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x + 40, rect.y + 91]]) {
    const w = planWorld(rect, px, py);
    const p = planPoint(rect, w.x, w.z);
    assert.ok(near(p.x, px) && near(p.y, py), `${px},${py} came back ${p.x},${p.y}`);
  }
});

test('a point straight ahead projects to the middle of the stage', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 60);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  const stage = { x: 0, y: 0, w: 1920, h: 1080 };
  const p = projectThrough([0, 0, -2], camera, stage);
  assert.ok(p, 'a point two metres in front of the camera projected to nothing');
  assert.ok(near(p.x, 960, 1e-6) && near(p.y, 540, 1e-6), `${p.x},${p.y}`);
});

test('a point behind the camera is null rather than a mirrored point in front of it', () => {
  // The one case the arithmetic cannot answer by rule: `project` divides by w, w is
  // negative behind the camera, and the division flips the sign - so a point at your back
  // arrives on screen in front of you, plausibly placed and completely wrong. This is why
  // the function has a z test in it at all.
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 60);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  const stage = { x: 0, y: 0, w: 1920, h: 1080 };
  assert.equal(projectThrough([0, 0, 2], camera, stage), null);
  assert.equal(projectThrough([0.4, 0.3, 5], camera, stage), null);
  // And past the far plane, which is the other side of the same unit cube.
  assert.equal(projectThrough([0, 0, -100], camera, stage), null);
});

test('the projection is offset by the rect, so the same point moves with the box', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 60);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  const at = projectThrough([0.2, -0.1, -2], camera, { x: 0, y: 0, w: 1920, h: 1080 });
  const moved = projectThrough([0.2, -0.1, -2], camera, { x: 100, y: 40, w: 1920, h: 1080 });
  assert.ok(near(moved.x - at.x, 100, 1e-6) && near(moved.y - at.y, 40, 1e-6),
    `${at.x},${at.y} against ${moved.x},${moved.y}`);
});
