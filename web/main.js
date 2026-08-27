import * as THREE from 'three';
import {
  DEPTH_H, DEPTH_W, POINTS, PROJECT_VERSION, effectIdsIn, effectOf, snapScalar,
  versionRefusal, captureFormatRefusal, requiresEntryRefusal, requiresListRefusal,
} from './format.js';
import { pollRecordState } from './record-poll.js';
// The renderer, imported first: its body appends the canvas, so import order is boot order.
import {
  renderer, scene, freeCamera, programCamera, viewCamera, controls, worldTilt, WORLD_UP,
  DEFAULT_POSE, onNav, setNavigationUp, useViewCamera,
} from './scene.js';
import {
  EASE_OUT_LINEAR, EASE_IN_LINEAR, SEGMENT_POINT_CEILING, copyHandle, easeAt, elevate, keyBefore,
  HOLD_ENDS, EXTEND_ENDS, scalarAt, segmentSlope, scalarSlopeAt, stepAt, hermite, tangentAt,
  handleRefusal, foldRefusal, foldFreeX,
} from './curve.js';
import { tiltQuaternion } from './world-tilt.js';
import {
  EXPORT_SIZES, DEFAULT_EXPORT_SIZE, reduceAspect, exportAspects, sizesForAspect,
} from './export-sizes.js';
import {
  INSET, TOP_CENTRE, PLAN_STRIDE, FRUSTUM_LEN, planScale, planPoint, planWorld, projectThrough,
} from './plan-geometry.js';
import { ZOOM_PER_NOTCH, TICK_STEPS, tickLabel, makeViewWindow } from './view-window.js';
import { clipIn, clipOut, clipBoundOrThrow, writeClipRange } from './clip-range.js';
import {
  EFFECT_BIND_TRANSFORMS, EFFECT_GATED_TABLES, EFFECT_BOUNDED_TABLES, effectBindUniformType,
  tableFromPackages, withEffectGroups,
} from './effect-manifests.js';
import { bloomChainSize } from './bloom-pass.js';
import {
  depthCurr, colorPrev, colorCurr, buildTextures, bindDepth, bindColor, plantColor,
} from './gpu-textures.js';
import {
  statePrev, stateNext, buildSurfaceMemory, stepSurfaceMemory, refuseAgeCeiling,
} from './surface-memory.js';
import {
  composer, renderPass, afterimage, mosh, bloom, grade, buildPostChain, setGradeProgram,
  setMoshProgram,
} from './post-chain.js';
import {
  geometry, uniforms, material, cloud, buildPointCloud, setAdditive, setCloudProgram,
  CLIP_NEAR_DEFAULT, CLIP_FAR_DEFAULT, CROP_LIMIT, cropReach, croppedOut,
} from './point-cloud.js';
import { cloudSpine } from './cloud-shader.js';
import { gradeSpine } from './grade-shader.js';
import { moshSpine } from './mosh-shader.js';
import { moshFramesBack, moshRefreshes } from './mosh-pass.js';
import { assembleShaders } from './shader-assembly.js';

const revSignature = (effects) => effects.map((e) => `${e.id} ${e.rev}`).join('\n');

/** A read that met the store mid-change, as against a fetch that failed. */
const tornRead = (why) => Object.assign(new Error(why), { tornRead: true });

/**
 * A rebuild that failed because this build refuses the set, not because it could not read it.
 */
const effectRefusal = (why) => Object.assign(new Error(why), { effectRefusal: true });

/** A rebuild that failed because a shader program would not link. */
const shaderLinkFailure = (why, log) => Object.assign(new Error(why), {
  shaderLinkFailure: true,
  linkLog: log,
});

/** `GET /effects`, with the answer held to the shape every reader of it assumes. */
async function listEffects() {
  const res = await fetch('/effects');
  if (!res.ok) throw new Error(`GET /effects answered ${res.status} - the registry cannot assemble without its packages`);
  const body = await res.json();
  if (!body || !Array.isArray(body.effects) || !Number.isFinite(body.generation)) {
    throw effectRefusal('GET /effects answered a body that is not a list of installed packages and a generation - '
      + 'this page reads both of those there, and something else at that address is not a store this build can converge on');
  }
  for (const entry of body.effects) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.rev !== 'string') {
      throw effectRefusal(`GET /effects listed the entry ${JSON.stringify(entry)} - every entry is an id and the `
        + 'revision of the package behind it, and the comparison that decides whether this page is up to date is over exactly those two');
    }
  }
  return { effects: body.effects, generation: body.generation };
}

// Reads the packages a listing names. Boot and the post-install rebuild share it.
async function readEffectPackages(effects) {
  return Promise.all(effects.map(async ({ id, rev }) => {
    const res = await fetch(`/effects/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`GET /effects/${id} answered ${res.status} - the registry cannot assemble without its packages`);
    const pkg = await res.json();
    // The package has to be the one the list named, or the read met an install mid-flight.
    if (pkg?.rev !== rev) {
      throw tornRead(`effect ${id} was listed at revision ${rev} and answered for at ${pkg?.rev} - `
        + 'the store changed between the list this read opened with and the package it then asked for');
    }
    if (!pkg.manifest || typeof pkg.manifest !== 'object' || Array.isArray(pkg.manifest)) {
      throw effectRefusal(`GET /effects/${id} answered with no manifest object - a package is a manifest and `
        + 'its chunks, and this page assembles both shader programs out of what the manifest names');
    }
    if (pkg.manifest.chunks !== undefined && !Array.isArray(pkg.manifest.chunks)) {
      throw effectRefusal(`effect ${id} was served with its chunks as ${JSON.stringify(pkg.manifest.chunks)} - `
        + 'a manifest\'s chunks are the list this page walks to fetch the text it splices, and a package '
        + 'that has none of them leaves the key out rather than putting something else there');
    }
    for (const c of pkg.manifest.chunks ?? []) {
      if (!c || typeof c.file !== 'string') {
        throw effectRefusal(`effect ${id} declares the chunk entry ${JSON.stringify(c)}, which names no file - `
          + 'the file name is what the next request is built out of, so an entry without one asks this page for a URL nobody wrote');
      }
    }
    // A manifest may point two joints at one file, so the same bytes are fetched once.
    const names = [...new Set((pkg.manifest.chunks ?? []).map((c) => c.file))];
    const texts = await Promise.all(names.map(async (name) => {
      const chunk = await fetch(`/effects/${encodeURIComponent(id)}/file/${encodeURIComponent(name)}`);
      if (!chunk.ok) throw new Error(`GET /effects/${id}/file/${name} answered ${chunk.status} - the cloud's shaders cannot be assembled without it`);
      return chunk.text();
    }));
    pkg.chunks = Object.fromEntries(names.map((name, i) => [name, texts[i]]));
    return pkg;
  }));
}

/** Every installed package as one moment, retried when the listing changes underneath it. */
async function fetchEffectPackages() {
  let disagreement = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const opened = await listEffects();
    let packages;
    try {
      packages = await readEffectPackages(opened.effects);
    } catch (err) {
      if (!err.tornRead) throw err;
      disagreement = err.message;
      continue;
    }
    const closed = await listEffects();
    if (closed.generation === opened.generation && revSignature(closed.effects) === revSignature(opened.effects)) return packages;
    disagreement = `the store was at generation ${opened.generation} when this read opened and ${closed.generation} when it closed`;
  }
  throw new Error('the installed effects moved while this page was reading them, twice - a set read across '
    + 'an install is one package from before it beside another from after, which assembles into a program '
    + `nobody wrote, so this page keeps the set it has and asks again (${disagreement})`);
}

// `let`, because `PUT` and `DELETE /effects/:id` rebuild the set in place.
let effectPackages = await fetchEffectPackages();

// Every program this page compiles, in one call, so a refusal covers every spine.
const SPINES = { cloud: cloudSpine, grade: gradeSpine, mosh: moshSpine };
let shaderPrograms = assembleShaders(SPINES, effectPackages);

// Which of the two surfaces this page is, decided by the path.
const EDITING = location.pathname === '/edit';

/**
 * True when OBS has opened this page as a browser source: no controls and no take of its own.
 */
const PROGRAM_OUT = location.pathname === '/program';

// In one place, because the auto-save writer and the recovery offer have to agree about it.
const WORKING_PROJECT = '__working__';

// Which project the menu's Editor entry resumes. Client state rather than document state.
const LAST_OPENED = 'kinect.lastOpened';
let openedProjectName = null;

function rememberOpened() {
  if (!openTakeHash) return;
  try {
    localStorage.setItem(LAST_OPENED, JSON.stringify({
      takeHash: openTakeHash,
      takeId: openTakeId,
      project: openedProjectName,
    }));
  } catch {
    // Private browsing, or a full quota. Resuming is a convenience, so this stays quiet.
  }
}

const statusEl = document.getElementById('status');
const appStatusEl = document.getElementById('appStatus');
// Read here because `resize` runs at boot and needs the strip's height.
const timelineEl = document.getElementById('timeline');

const sourceCells = buildTextures();

buildSurfaceMemory();

buildPointCloud(sourceCells, shaderPrograms.cloud);

// The point-size ceiling this GPU will actually rasterise, which no parameter can raise.
{
  const gl = renderer.getContext();
  const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  // One rather than zero: the shader clamps to `[1, pointCeiling]` and would invert.
  if (pointRange && pointRange[1] >= 1) uniforms.pointCeiling.value = pointRange[1];
}

// Which way is up in the room, in degrees. Nothing measures the angle it was bolted at.
const worldTiltAngles = { tilt: 0, roll: 0 };

function applyWorldTilt() {
  tiltQuaternion(worldTiltAngles.tilt, worldTiltAngles.roll, worldTilt);
  cloud.quaternion.copy(worldTilt);
  // Levelling says this frame is the room's, so it takes the pole off the sensor view.
  setNavigationUp(WORLD_UP);
}

buildPostChain(shaderPrograms.grade, shaderPrograms.mosh);

let renderScale = 1;

// The drawing buffer an export has taken over, or null while the window owns it.
let outputSize = null;

/** The aspect the editor frames at, which is the aspect the export will be. */
let projectAspect = [16, 9];
const targetAspect = () => projectAspect[0] / projectAspect[1];

// The shape buttons in the Project settings dialog, null until boot builds them.
let aspectButtons = null;

/** The resolution each shape was last on. Session state, never saved. */
const sizeForShape = new Map();

// Where the letterboxed stage sits. Written by `resize`, read by the overlay.
const stageBox = { left: 0, top: 0 };

/** The rates the output can be, and the only list of them. */
const OUTPUT_RATES = [24, 30, 60, 120];

/** The default shape, taken off the default size so there is still one list. */
const defaultAspect = () => reduceAspect(...DEFAULT_EXPORT_SIZE.split('x').map(Number));

/** A `WIDTHxHEIGHT` string as the shape it is, or `[0, 0]` when it is not a size. */
function aspectOfSize(text) {
  const [w, h] = String(text).split('x').map(Number);
  return w > 0 && h > 0 ? reduceAspect(w, h) : [0, 0];
}

const sameAspect = (a, b) => a[0] === b[0] && a[1] === b[1];

/** The size a shape opens on, or null for a shape the table has nothing for. */
function openingSizeForAspect(aspect) {
  const sizes = sizesForAspect(aspect).map(([w, h]) => `${w}x${h}`);
  if (sizes.includes(DEFAULT_EXPORT_SIZE)) return DEFAULT_EXPORT_SIZE;
  return sizes[0] ?? null;
}

/** Rebuilds the resolution menu as every size the table holds for the project's shape. */
function buildResolutionMenu(select, keep) {
  if (!select) return select;
  const sizes = sizesForAspect(projectAspect).map(([w, h]) => `${w}x${h}`);
  select.replaceChildren();
  for (const value of sizes) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  if (keep && !sizes.includes(keep)) {
    const option = document.createElement('option');
    option.value = keep;
    option.textContent = `${keep} (from the project)`;
    select.appendChild(option);
  }
  return select;
}

/** The shape controls are another view over `EXPORT_SIZES`, never another list. */
function buildAspectSegments(container) {
  if (!container) return [];
  const buttons = exportAspects().map(({ ratio, aspect }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.ratio = ratio;
    button.dataset.aspect = aspect.join('x');
    button.textContent = ratio.replace(' DCI', '');
    button.addEventListener('click', () => {
      if (setProjectAspect(aspect)) history.commit();
      paintAspectSelection(buttons);
    });
    container.appendChild(button);
    return button;
  });
  paintAspectSelection(buttons);
  return buttons;
}

/** Lights the shape button the document is on, or none when the table does not offer it. */
function paintAspectSelection(buttons) {
  for (const button of buttons) {
    const aspect = button.dataset.aspect.split('x').map(Number);
    button.setAttribute('aria-pressed', String(sameAspect(aspect, projectAspect)));
  }
}

/** Adopts a shape: the editor reframes to it and the project remembers it. */
function setProjectAspect(aspect, { fromDocument = false } = {}) {
  const [w, h] = reduceAspect(aspect[0], aspect[1]);
  if (!(w > 0 && h > 0)) return false;
  const leaving = projectAspect.join(':');
  projectAspect = [w, h];
  ensureActiveDeliverable();
  if (!sameAspect(aspectOfSize(activeDeliverable.outputSize), projectAspect)) {
    // The size this shape was last on beats the size it opens on, since a shape
    // change replaces one.
    sizeForShape.set(leaving, activeDeliverable.outputSize);
    const remembered = sizeForShape.get(projectAspect.join(':'));
    const fits = remembered && sameAspect(aspectOfSize(remembered), projectAspect);
    activeDeliverable.outputSize = (fits ? remembered : openingSizeForAspect(projectAspect))
      ?? activeDeliverable.outputSize;
  }
  buildResolutionMenu(ui?.exportSize, activeDeliverable.outputSize);
  if (ui?.exportSize) ui.exportSize.value = activeDeliverable.outputSize;
  if (aspectButtons) paintAspectSelection(aspectButtons);
  void fromDocument;
  paintDeliverable();
  resize();
  return true;
}

/** Adopts an output size. It reframes nothing: every size offered has the stage's shape. */
function setDeliverableSize(text) {
  const [w, h] = String(text).split('x').map(Number);
  if (!(w > 0 && h > 0)) return false;
  ensureActiveDeliverable();
  activeDeliverable.outputSize = `${w}x${h}`;
  if (ui?.exportSize && ui.exportSize.value !== `${w}x${h}`) {
    buildResolutionMenu(ui.exportSize, `${w}x${h}`);
    ui.exportSize.value = `${w}x${h}`;
  }
  paintDeliverable();
  return true;
}

// Which camera the viewport draws. Navigation is off under the program camera.
function setViewCamera(cam) {
  useViewCamera(cam);
  renderPass.camera = cam;
  controls.enabled = cam === freeCamera;
}

let stageResizes = 0;

// The transport, or null until a take is open.
let timeline = null;

/** Who owns the transport's play state, so a resume queued before a newer pause is dropped. */
let transportGen = 0;
const takeTransport = () => {
  transportGen += 1;
  dropRateGesture();
  return transportGen;
};

/** Drops a speed gesture whose document has been replaced underneath it. */
const dropRateGesture = () => {
  if (rateGesture) rateGesture = null;
};

/** Stops the transport and claims it, so a resume queued by an older owner is dropped. */
const pauseTransport = () => {
  takeTransport();
  timeline.pause();
};

function resize() {
  stageResizes++;
  const wasBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  const availW = innerWidth;
  const appBarHeight = document.getElementById('appBar')?.offsetHeight ?? 0;
  const dockHeight = document.body.classList.contains('panelcollapsed')
    ? document.getElementById('panelDock')?.offsetHeight ?? 0
    : 0;
  const availH = Math.max(1, innerHeight - timelineEl.offsetHeight - appBarHeight - dockHeight);
  const fitH = Math.max(1, Math.min(availH, Math.round(availW / targetAspect())));
  const fitW = Math.max(1, Math.round(fitH * targetAspect()));
  const width = outputSize ? outputSize.w : fitW;
  const height = outputSize ? outputSize.h : fitH;
  // An export's aspect comes from the output asked for, never from the window.
  for (const cam of [freeCamera, programCamera]) {
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
  }
  const ratio = outputSize ? 1 : Math.min(devicePixelRatio, 2) * renderScale;
  renderer.setPixelRatio(ratio);
  // The canvas keeps its CSS box while an export runs. Only the buffer becomes the output's.
  renderer.setSize(width, height, !outputSize);
  composer.setPixelRatio(ratio);
  composer.setSize(width, height);
  if (!outputSize) {
    stageBox.left = Math.round((availW - fitW) / 2);
    stageBox.top = appBarHeight + Math.round((availH - fitH) / 2);
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.left = `${stageBox.left}px`;
    renderer.domElement.style.top = `${stageBox.top}px`;
  }
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  // Sized off a fixed reference rather than off this buffer. `bloom-pass.js` carries why.
  const chain = bloomChainSize(buf.x, buf.y);
  bloom.setSize(chain.width, chain.height);
  grade.uniforms.resolution.value.set(buf.x, buf.y);
  mosh.uniforms.resolution.value.set(buf.x, buf.y);
  uniforms.bufferHeight.value = buf.y;
  // Everything above reallocates the drawing buffer and nothing above redraws into it.
  const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (buffer.x !== wasBuffer.x || buffer.y !== wasBuffer.y) requestRepaint();
}
addEventListener('resize', () => {
  // A window that got shorter can put the strip over its ceiling.
  applyLaneHeight();
  resize();
  // The ruler takes its tick step from the bed's width, so a width change has to rebuild it.
  if (timeline) buildRuler();
});
resize();

function postEnabled() {
  return afterimage.enabled || mosh.enabled || bloom.enabled || grade.enabled;
}

// Two vertices per point while the surface memory is shedding, one otherwise.
function updateDrawRange() {
  const shedding = uniforms.fadeTime.value > 0 || uniforms.wakeTime.value > 0;
  geometry.setDrawRange(0, shedding ? POINTS * 2 : POINTS);
}

// Which uniform table each binding writes into. A map rather than a ternary per site, so a
// build that grows a fourth table adds one entry here instead of another branch at five sites -
// and a table nothing resolves throws on the write rather than landing the value in undefined.
// Built here rather than at the top of the file because every one of the three is a live
// binding the boot sequence above has just assigned.
const UNIFORM_TABLES = Object.freeze({
  points: uniforms, grade: grade.uniforms, mosh: mosh.uniforms,
});

/** The pass a gating term on each table holds open. */
const PASS_OF_TABLE = Object.freeze({ grade, mosh });

/** The terms whose being up makes each gated pass worth running, read off the packages. */
let PASS_GATES;
const passGatesOf = (packages) => Object.fromEntries(EFFECT_GATED_TABLES.map((table) => [
  table,
  packages.flatMap((pkg) => Object.values(pkg.manifest.params ?? {})
    .filter((p) => p.bind?.on === table && p.bind.gates)
    .map((p) => p.bind.uniform)),
]));

function passNeeded(table) {
  const held = UNIFORM_TABLES[table];
  return PASS_GATES[table].some((name) => held[name].value !== 0);
}

/**
 * The dotted registry names of the terms that hold a pass with memory open.
 *
 * Read off the manifests rather than written down, for the reason `passGatesOf` is: a package id
 * hard-coded in here is a fork installed under another name whose pre-roll silently stops being
 * computed, with nothing red anywhere.
 */
const moshMastersOf = (packages) => packages.flatMap((pkg) => Object.entries(pkg.manifest.params ?? {})
  .filter(([, p]) => EFFECT_BOUNDED_TABLES.includes(p.bind?.on) && p.bind.gates)
  .map(([short]) => `${pkg.id}.${short}`));

/** The term saying how long the mosh pass's memory lasts, by both its names, or null. */
const moshBoundOf = (packages) => packages.flatMap((pkg) => Object.entries(pkg.manifest.params ?? {})
  .filter(([, p]) => EFFECT_BOUNDED_TABLES.includes(p.bind?.on) && p.bind.bounds)
  .map(([short, p]) => ({ name: `${pkg.id}.${short}`, uniform: p.bind.uniform })))[0] ?? null;

let MOSH_MASTERS = [];
let MOSH_BOUND = null;

/** Whether the mosh pass is doing anything at a program position, and for how long it remembers. */
const moshLiveAt = (programSec) => MOSH_MASTERS.some((name) => valueAtProgram(name, programSec) !== 0);
const moshPeriodAt = (programSec) => (MOSH_BOUND ? valueAtProgram(MOSH_BOUND.name, programSec) : 0);

// The look terms a draft puts down for the length of its one frame. Three of them are the core's
// own accumulators and the rest are whatever the packages brought that accumulates, because a
// draft is one frame rendered out of order and a term whose value depends on the frame before it
// has nothing to read.
const BYPASSED_CORE = Object.freeze(['fade', 'wake', 'trails']);
let BYPASSED = [...BYPASSED_CORE];
let BYPASS_ZERO = Object.fromEntries(BYPASSED.map((name) => [name, 0]));
let BYPASSED_SET = new Set(BYPASSED);

/** How far outside the cloud the fitted faces sit, as a share of the extent they bound. */
const CROP_FIT_PAD = 0.15;

/** Fits the four lateral faces to the take's own cloud. */
async function fitCropToTake(id, near, far) {
  const res = await fetch(`/capture/${encodeURIComponent(id)}/extent`
    + `?near=${encodeURIComponent(near)}&far=${encodeURIComponent(far)}`);
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const extent = await res.json();
  if (!extent.x || !extent.y) return null;
  const padded = ([lo, hi]) => {
    const m = (hi - lo) * CROP_FIT_PAD;
    return [lo - m, hi + m];
  };
  const [left, right] = padded(extent.x);
  const [bottom, top] = padded(extent.y);
  // Through `params.set`, so the fit is a document edit like any other.
  const wrote = {};
  for (const [name, value] of [['left', left], ['right', right], ['bottom', bottom], ['top', top]]) {
    wrote[name] = params.set(name, value);
  }
  return { ...wrote, frames: extent.frames, samples: extent.samples };
}

// Where each effect parameter lands in declaration order, which is the panel's layout.
const EFFECT_PARAM_ORDER = [
  'glyph.amount', 'glyph.tone', 'glyph.hash', 'glyph.rain',
  'ghost.amount', 'ghost.rim', 'ghost.fill',
  'contour.amount', 'contour.bands', 'contour.width',
  'blackwall.amount', 'blackwall.sweep', 'blackwall.scan',
  'noise.amount', 'noise.scale', 'noise.speed', 'lattice.amount',
  'glitch.amount', 'glitch.density', 'glitch.shove', 'glitch.tint',
  'glitch.bands', 'glitch.axis', 'glitch.rate', 'push.amount',
  'noise.region', 'mask.amount', 'ripple.amount', 'ripple.freq',
  'ripple.speed', 'thermal.amount', 'edges.amount', 'duotone.amount',
  'duotone.hue', 'duotone.split', 'duotone.span', 'duotone.motion',
  'rain.amount', 'rain.speed', 'rain.span', 'rain.trail',
  'rgbsplit.amount', 'raster.amount', 'raster.angle', 'raster.pitch',
  'raster.hard', 'grain.amount', 'streak.amount', 'streak.angle',
  'halation.amount', 'halation.radius', 'halation.threshold', 'halation.tint',
  'stock.amount', 'stock.balance', 'stock.split', 'stock.latitude',
  'vignette.amount',
  'datamosh.amount', 'datamosh.reach', 'datamosh.decay', 'datamosh.splay',
  'datamosh.line', 'datamosh.grain', 'datamosh.refresh',
];

// The list places the shipped set and is never a census of what is installed.
let EFFECT_PARAMS;

// The names the list above does not place: a newly installed package's parameters.
const effectAppendix = () => Object.keys(EFFECT_PARAMS).slice(EFFECT_PARAM_ORDER.length);

// A group is in use when its own parameters are up. `reveals` is the escape hatch.
const CORE_PANEL_GROUPS = [
  { key: 'colour', label: 'Colour', tab: 'look', collapses: true },
  { key: 'style', label: 'Style', tab: 'look', lookgroup: true, collapses: true },
  {
    key: 'framing',
    label: '',
    tab: 'framing',
    collapses: false,
    // Levelling is document state: the bracket's angle belongs to the take.
    before: panelOnce(() => [
      panelButtonRow(['camSensor', 'sensor view']),
      panelButtonRow(['cropBox', 'show crop box']),
      ...(EDITING ? [panelButtonRow(['cropFit', 'fit box to take'])] : []),
      panelButtonRow(['camLevelReset', 'reset rotation']),
    ]),
    after: panelOnce(() => [
      panelButtonRow(['cropReset', 'revert all to default']),
      panelNote('recRange', 'preview only'),
    ]),
  },
  { key: 'signal', label: 'Signal', tab: 'look', lookgroup: true, collapses: true },
  { key: 'displacement', label: 'Displacement', tab: 'region', lookgroup: true, collapses: true },
  // One region in the room, read three ways. Everything here is metres in the sensor frame.
  { key: 'region', label: 'Region (metres)', tab: 'region', lookgroup: true, collapses: true },
  { key: 'points', label: 'Points', tab: 'look', lookgroup: true, collapses: true },
  { key: 'motion', label: 'Motion', tab: 'look', lookgroup: true, collapses: true },
  { key: 'post', label: 'Post', tab: 'look', lookgroup: true, collapses: true },
  // The two parameters that are not part of the clip. Tagged `view`, with no keyframe control.
  {
    key: 'viewer',
    label: 'Viewer',
    tab: 'camera',
    lookgroup: true,
    collapses: true,
    after: panelOnce(() => [panelNote('viewNote', 'Not saved with the clip and not exported: these '
      + 'change what you are looking at, not what the frame is.')]),
  },
];

// The spine plus every group the installed packages declare, spliced at their anchors.
let PANEL_GROUPS;

/** The write one effect parameter's binding describes, as the closure the registry stores. */
function effectApply(bind) {
  const table = () => UNIFORM_TABLES[bind.on];
  let write;
  if (bind.transform === 'axisDeg') {
    write = (v) => {
      const r = THREE.MathUtils.degToRad(v);
      table()[bind.uniform].value.set(Math.sin(r), Math.cos(r));
    };
  } else if (bind.transform === 'centeredEdges') {
    // Subtract in JavaScript's double precision, then upload the two answers as floats. Doing
    // this arithmetic in the shader rounds the width first and moves the lower edge by one ulp.
    write = (v) => { table()[bind.uniform].value.set(0.5 - v, 0.5 + v); };
  } else if (bind.transform === 'degToRad') {
    write = (v) => { table()[bind.uniform].value = THREE.MathUtils.degToRad(v); };
  } else if (bind.transform) {
    throw new Error(
      `the binding for ${bind.uniform} names the transform ${JSON.stringify(bind.transform)}, `
      + `which this applier does not know - it implements ${EFFECT_BIND_TRANSFORMS.join(' and ')}, `
      + 'and an unknown one would land its value unconverted',
    );
  } else {
    write = (v) => { table()[bind.uniform].value = v; };
  }
  if (!bind.gates) return write;
  return (v) => { write(v); PASS_OF_TABLE[bind.on].enabled = passNeeded(bind.on); };
}

/** One run of `EFFECT_PARAMS`, as entries ready to spread into `PARAMS`. */
const effectSlice = (first, last) => {
  const names = Object.keys(EFFECT_PARAMS);
  const from = names.indexOf(first);
  const to = names.indexOf(last);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`${first}..${last} is not a run of the assembled effect table in that order`);
  }
  return Object.fromEntries(names.slice(from, to + 1).map((name) => {
    const bind = EFFECT_PARAMS[name];
    const entry = {
      def: bind.def, min: bind.min, max: bind.max, step: bind.step, kind: bind.kind,
      tag: 'look', group: bind.group, label: bind.label, apply: effectApply(bind),
    };
    if (bind.reading !== undefined) entry.reading = bind.reading;
    if (bind.under !== undefined) entry.under = bind.under;
    return [name, entry];
  }));
};

/** The registry, rebuilt. `PARAMS` is a function of which packages are installed. */
const buildParams = () => ({
  // Pixels at 1080p, not pixels.
  pointSize: { def: 9, min: 0.5, max: 64, step: 0.1, kind: 'scalar', tag: 'look',
    group: 'points', label: 'size',
    apply: (v) => { uniforms.pointSize.value = v; } },
  opacity: { def: 1, min: 0.05, max: 1, step: 0.01, kind: 'scalar', tag: 'look',
    group: 'points', label: 'opacity',
    apply: (v) => { uniforms.opacity.value = v; } },
  exposure: { def: 1.15, min: 0.05, max: 6, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'colour', label: 'brightness',
    apply: (v) => { uniforms.exposure.value = v; } },
  additive: { def: false, kind: 'step', tag: 'look',
    group: 'points', label: 'additive glow', apply: setAdditive },

  ...effectSlice('glyph.amount', 'glyph.rain'),

  // The mount's cant, in degrees. Document state, because the angle belongs to the take.
  tilt: { def: 0, min: -90, max: 90, step: 0.5, kind: 'scalar', tag: 'look',
    group: 'framing', label: 'tilt',
    apply: (v) => { worldTiltAngles.tilt = v; applyWorldTilt(); } },
  roll: { def: 0, min: -180, max: 180, step: 0.5, kind: 'scalar', tag: 'look',
    group: 'framing', label: 'roll',
    apply: (v) => { worldTiltAngles.roll = v; applyWorldTilt(); } },
  near: { def: CLIP_NEAR_DEFAULT, min: 0.05, max: 9.5, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'framing', label: 'near',
    apply: (v) => { uniforms.nearClip.value = v; } },
  far: { def: CLIP_FAR_DEFAULT, min: 0.05, max: 9.5, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'framing', label: 'far',
    apply: (v) => { uniforms.farClip.value = v; } },

  // Whether the box cuts at all. Not a second spelling of the faces being at their bounds.
  crop: { def: true, kind: 'step', tag: 'look',
    group: 'framing', label: 'crop',
    apply: (on) => { uniforms.cropOn.value = on ? 1 : 0; } },

  left: { def: -CROP_LIMIT, min: -CROP_LIMIT, max: CROP_LIMIT, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'framing', label: 'left',
    apply: (v) => { uniforms.cropL.value = v; } },
  right: { def: CROP_LIMIT, min: -CROP_LIMIT, max: CROP_LIMIT, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'framing', label: 'right',
    apply: (v) => { uniforms.cropR.value = v; } },
  bottom: { def: -CROP_LIMIT, min: -CROP_LIMIT, max: CROP_LIMIT, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'framing', label: 'bottom',
    apply: (v) => { uniforms.cropB.value = v; } },
  top: { def: CROP_LIMIT, min: -CROP_LIMIT, max: CROP_LIMIT, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'framing', label: 'top',
    apply: (v) => { uniforms.cropT.value = v; } },

  interpolate: { def: true, kind: 'step', tag: 'look',
    group: 'signal', label: 'interpolate frames',
    apply: (on) => { uniforms.interpolate.value = on ? 1 : 0; } },
  snapDelta: { def: 250, min: 20, max: 1200, step: 10, kind: 'scalar', tag: 'look',
    group: 'signal', label: 'snap mm',
    apply: (v) => { uniforms.snapDelta.value = v; } },

  // Fade is the cross-fade, wake is how much longer a hard transition lingers on it.
  fade: { def: 120, min: 0, max: 1500, step: 10, kind: 'scalar', tag: 'look',
    group: 'motion', label: 'fade',
    apply: (v) => { uniforms.fadeTime.value = v / 1000; updateDrawRange(); } },
  wake: { def: 0, min: 0, max: 4000, step: 10, kind: 'scalar', tag: 'look',
    group: 'motion', label: 'wake',
    apply: (v) => { uniforms.wakeTime.value = v / 1000; updateDrawRange(); } },

  ...effectSlice('noise.amount', 'lattice.amount'),
  // In metres of the room, like every other displacement and unlike the screen-space terms.
  'cell': { def: 0.05, min: 0.005, max: 0.5, step: 0.005, kind: 'scalar', tag: 'look',
    group: 'displacement', label: 'cell m',
    apply: (v) => { uniforms.latticeCell.value = v; } },

  ...effectSlice('glitch.amount', 'glitch.rate'),

  // One region, authored once and read three ways. Three scalars rather than a `point` kind.
  regionX: { def: 0, min: -3, max: 3, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'region', label: 'x',
    apply: (v) => { uniforms.regionCentre.value.x = v; } },
  regionY: { def: 0, min: -3, max: 3, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'region', label: 'y',
    apply: (v) => { uniforms.regionCentre.value.y = v; } },
  regionZ: { def: -2, min: -6, max: 0, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'region', label: 'z',
    apply: (v) => { uniforms.regionCentre.value.z = v; } },
  regionW: { def: 0, min: 0, max: 3, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'region', label: 'width',
    apply: (v) => { uniforms.regionHalf.value.x = v; } },
  regionH: { def: 0, min: 0, max: 3, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'region', label: 'height',
    apply: (v) => { uniforms.regionHalf.value.y = v; } },
  regionD: { def: 0, min: 0, max: 3, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'region', label: 'depth',
    apply: (v) => { uniforms.regionHalf.value.z = v; } },
  regionRound: { def: 0.5, min: 0, max: 2, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'region', label: 'radius',
    apply: (v) => { uniforms.regionRound.value = v; } },
  regionSoft: { def: 0.2, min: 0.01, max: 1, step: 0.01, kind: 'scalar', tag: 'look',
    group: 'region', label: 'falloff',
    apply: (v) => { uniforms.regionSoft.value = v; } },

  ...effectSlice('push.amount', 'ripple.speed'),
  // View state rather than an edit: the controls advance it on the program clock.
  spin: { def: false, kind: 'step', tag: 'view',
    group: 'viewer', label: 'auto-orbit',
    apply: (on) => { controls.autoRotate = on; } },

  // The five readings of the take, as look parameters that mix rather than modes that exclude.
  readRgb: { def: 1, min: 0, max: 1, step: 0.01, kind: 'scalar', tag: 'look', reading: true,
    group: 'colour', label: 'colour',
    apply: (v) => { uniforms.readRgb.value = v; } },
  readDepth: { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar', tag: 'look', reading: true,
    group: 'colour', label: 'depth',
    apply: (v) => { uniforms.readDepth.value = v; } },
  // The three reading effects: ghost, contour, blackwall. Each blends into the colour
  // the same way RGB and Depth do above, and carries its own tuning parameters.
  ...effectSlice('ghost.amount', 'ghost.fill'),
  ...effectSlice('contour.amount', 'contour.width'),
  ...effectSlice('blackwall.amount', 'blackwall.scan'),

  rgbSaturation: { def: 1, min: 0, max: 2, step: 0.01, kind: 'scalar', tag: 'look',
    group: 'colour', label: 'saturation',
    apply: (v) => { uniforms.rgbSaturation.value = v; } },
  depthGamma: { def: 1, min: 0.25, max: 4, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'colour', label: 'gamma',
    apply: (v) => { uniforms.depthGamma.value = v; } },
  rim: { def: 0.55, min: 0, max: 1, step: 0.01, kind: 'scalar', tag: 'look',
    group: 'style', label: 'rim',
    apply: (v) => { uniforms.rimAmount.value = v; } },
  ...effectSlice('thermal.amount', 'duotone.motion'),

  ...effectSlice('rain.amount', 'rain.trail'),
  // A post pass costs a full-screen read and write, so a zero value switches it off.
  bloom: { def: 0, min: 0, max: 6, step: 0.05, kind: 'scalar', tag: 'look',
    group: 'post', label: 'bloom',
    apply: (v) => { bloom.strength = v; bloom.enabled = v > 0; } },
  trails: { def: 0, min: 0, max: 0.97, step: 0.01, kind: 'scalar', tag: 'look',
    group: 'motion', label: 'trails',
    apply: (v) => { afterimage.uniforms.damp.value = v; afterimage.enabled = v > 0; } },
  ...effectSlice('rgbsplit.amount', 'vignette.amount'),
  // The toe under the grade's Reinhard curve, and the one term that does not gate the pass.
  crush: { def: 0.018, min: 0, max: 0.2, step: 0.001, kind: 'scalar', tag: 'look',
    group: 'post', label: 'crush',
    apply: (v) => { grade.uniforms.crush.value = v; } },
  ...effectSlice('datamosh.amount', 'datamosh.refresh'),

  denoise: { def: true, kind: 'step', tag: 'look',
    group: 'signal', label: 'cull speckle',
    apply: (on) => { uniforms.denoise.value = on ? 1 : 0; } },
  edgeTol: { def: 120, min: 10, max: 1200, step: 10, kind: 'scalar', tag: 'look',
    group: 'signal', label: 'edge tol',
    apply: (v) => { uniforms.edgeTol.value = v; } },
  renderScale: { def: 100, min: 40, max: 200, step: 5, kind: 'scalar', tag: 'view',
    group: 'viewer', label: 'render %',
    apply: (v) => { renderScale = v / 100; resize(); } },

  ...(effectAppendix().length ? effectSlice(effectAppendix()[0], effectAppendix().at(-1)) : {}),

  camera: { def: DEFAULT_POSE, kind: 'pose', tag: 'composition',
    apply: (p) => {
      programCamera.position.fromArray(p.position);
      programCamera.quaternion.fromArray(p.quaternion);
      if (programCamera.fov !== p.fov) {
        programCamera.fov = p.fov;
        programCamera.updateProjectionMatrix();
      }
    } },
});

/** The registry itself, with the readings read off it rather than written down again. */
let PARAMS;
let READINGS;

/** Which of the five readings a document does not name, asked at both doors. */
function missingReadings(values) {
  return READINGS.filter((n) => !Object.hasOwn(values, n));
}

/** Everything the registry has to be true of, asked of the table that has just been built. */
function refuseRegistryDisagreement() {
  for (const name of READINGS) {
    const uniform = effectOf(name) === null ? name : EFFECT_PARAMS[name]?.uniform;
    if (!uniform || !Object.hasOwn(uniforms, uniform)) {
      throw new Error(`the reading ${name} binds no point uniform: its slider would move nothing`);
    }
  }

  for (const name of Object.keys(EFFECT_PARAMS)) {
    if (!Object.hasOwn(PARAMS, name)) {
      throw new Error(
        `${name} is declared by an installed effect and reaches no registry entry: it would `
        + 'be a look term with no slider and no track, and a document naming it would be refused',
      );
    }
  }
  for (const name of Object.keys(PARAMS)) {
    if (effectOf(name) !== null && !Object.hasOwn(EFFECT_PARAMS, name)) {
      throw new Error(
        `${name} is an effect parameter written out in the registry rather than declared in `
        + 'a manifest: it is a second copy of a binding, and the copy is what drifts',
      );
    }
  }

  // The age ceiling has to cover the longest persistence the two sliders can ask for.
  refuseAgeCeiling((PARAMS.fade.max + PARAMS.wake.max) / 1000);
}

// Checks every value for what it is rather than coercing it into something.
function normalise(name, spec, value) {
  if (spec.kind === 'pose') {
    // Shape alone is not enough: a short position array leaves the camera's z NaN.
    const finite = (xs, n) => Array.isArray(xs) && xs.length === n && xs.every(Number.isFinite);
    if (!finite(value?.position, 3) || !finite(value?.quaternion, 4) || !Number.isFinite(value?.fov)) {
      throw new Error(
        `${name} is a pose: it needs a 3-number position, a 4-number quaternion and a `
        + `numeric fov, got ${JSON.stringify(value)}`,
      );
    }
    // Four finite numbers is not a rotation, so the quaternion is checked for length too.
    const len = Math.hypot(...value.quaternion);
    if (Math.abs(len - 1) > 1e-3) {
      throw new Error(
        `${name} has a quaternion of length ${len.toFixed(6)}: a rotation is unit length, `
        + `and interpolating through [${value.quaternion.join(', ')}] would render a `
        + 'camera move nobody authored',
      );
    }
    return {
      position: value.position.slice(),
      quaternion: value.quaternion.slice(),
      fov: value.fov,
    };
  }
  if (typeof spec.def === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${name} is a step parameter: it takes a boolean, got ${JSON.stringify(value)}`);
    return value;
  }
  const v = value;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${name} is a scalar: it takes a finite number, got ${JSON.stringify(value)}`);
  }
  return snapScalar(spec, v);
}

const values = new Map();
const panelControls = new Map();
// Declared here rather than beside the button that fills it, because `writeControl` reads it.
const resetButtons = new Map();

let activePanelTab = EDITING ? 'look' : 'record';

const presetPickBoxes = new Map();
const presetPickGroups = [];

/** What the panel last painted per group, so a refresh writes only where the answer moved. */
const groupPainted = new Map();
const effectRackPainted = new Map();

// What each parameter is worth in an untouched project. Through `normalise`, never raw `def`.
const groupDefaults = new Map();

/** What a reset puts back, asked of the same function that decides what `set` stores. */
function resetTarget(name) {
  const spec = specOf(name);
  return normalise(name, spec, spec.def);
}

/** Whether this row is offering a reset, re-derived from the write that moved the value. */
function refreshReset(name, value) {
  const button = resetButtons.get(name);
  if (!button) return;
  const modified = value !== resetTarget(name);
  button.dataset.modified = modified ? 'yes' : 'no';
  // `disabled` rather than `hidden`: the slot is reserved, so a row cannot change height.
  button.disabled = !modified;
}

function writeControl(name, value) {
  const el = panelControls.get(name);
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = value;
  } else {
    el.value = String(value);
    // Read the value back off the element, so the readout says exactly what the slider says.
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.value;
  }
  refreshReset(name, value);
}

// Announced after every registry write, so whatever is showing the image can rebuild it.
let paramWritten = () => {};

// The other announcement a write makes: whether a panel group is worth showing at all.
let groupRevealChanged = () => {};

// Registry writes the transport makes on its own behalf rather than on a user's.
let transportWriting = false;

/** `PARAMS[name]` is not a membership test: it inherits `toString` and the rest. */
function specOf(name) {
  if (!Object.hasOwn(PARAMS, name)) throw new Error(`unknown parameter ${JSON.stringify(name)}`);
  return PARAMS[name];
}

const params = {
  spec(name) {
    const spec = specOf(name);
    return {
      default: spec.def, min: spec.min, max: spec.max, step: spec.step,
      kind: spec.kind, tag: spec.tag, under: spec.under ?? null,
    };
  },
  names(tag) {
    return Object.keys(PARAMS).filter((n) => !tag || PARAMS[n].tag === tag);
  },
  get(name) {
    const spec = specOf(name);
    const v = values.get(name);
    return spec.kind === 'pose' ? { ...v, position: [...v.position], quaternion: [...v.quaternion] } : v;
  },
  /** What `set` would store, without storing it. */
  normalise(name, value) {
    return normalise(name, specOf(name), value);
  },
  /** The single write path. UI, presets and the tracks all go through here. */
  set(name, value) {
    const spec = specOf(name);
    const v = normalise(name, spec, value);
    values.set(name, v);
    spec.apply(v);
    writeControl(name, v);
    paramWritten(name, spec.tag);
    // `paramWritten` says the image changed. This says a group may have appeared or gone.
    if (!transportWriting) groupRevealChanged();
    return v;
  },
  /** A bulk write. */
  apply(next) {
    refuseDuringEvaluation('a bulk write');
    // Checked in full first, because a write that throws halfway leaves an unauthored look.
    const checked = Object.entries(next).map(([name, value]) => [name, this.normalise(name, value)]);
    for (const [name, value] of checked) this.set(name, value);
    return this;
  },
  /** A plain serialisable object. A project, a preset and an export job all start here. */
  values(names = this.names().filter((n) => PARAMS[n].tag !== 'view')) {
    return Object.fromEntries(names.map((n) => [n, this.get(n)]));
  },
  /** Defaults, not a serialisation, so this one does cover view state. */
  reset(names = Object.keys(PARAMS)) {
    for (const name of names) this.set(name, PARAMS[name].def);
    return this;
  },
};

// One keyframe control per look parameter, built in the same pass as its row.
const keyButtons = new Map();

function makeKeyButton(name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kf';
  button.setAttribute('aria-label', `${name} keyframe`);
  button.appendChild(document.createElement('i'));
  button.addEventListener('click', () => toggleKey(name));
  button.dataset.kf = 'none';
  keyButtons.set(name, button);
  return button;
}

// The reset glyph, drawn as a stroked path so it takes its colour from the state around it.
function resetGlyph() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Decorative: the button's label already carries the whole of what this means.
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5']) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * One reset control per keyframable slider. It writes through `params.set` and nothing else.
 */
function makeResetButton(name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reset';
  button.dataset.reset = name;
  button.setAttribute('aria-label', `${name} reset to default`);
  button.append(resetGlyph());
  button.addEventListener('click', () => {
    retainEffectFor(name);
    params.set(name, resetTarget(name));
    history.commit();
    // The press removes its own control, which would otherwise take focus out of the tab order.
    const slider = panelControls.get(name);
    slider.focus();
    if (document.activeElement !== slider) {
      const toggle = button.closest('.group')?.querySelector('.grouptoggle');
      if (toggle) toggle.focus();
    }
  });
  button.dataset.modified = 'no';
  button.disabled = true;
  resetButtons.set(name, button);
  return button;
}

// The panel is a view on the registry and holds no parameter data of its own.
const panelNode = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

const panelButtonRow = (...buttons) => {
  const row = panelNode('div', 'btnrow');
  for (const [id, text] of buttons) {
    const button = panelNode('button', null, text);
    button.type = 'button';
    button.id = id;
    row.append(button);
  }
  return row;
};

/** A group's hand-written furniture, built once and re-parented on every rebuild. */
function panelOnce(build) {
  let made = null;
  return () => (made ??= build());
}

const panelNote = (id, text) => {
  const note = panelNode('div', null, text);
  note.id = id;
  return note;
};

/** One row, in the shape the CSS and the proof tools already expect. */
function panelRow(name, spec) {
  const input = document.createElement('input');
  input.id = name;
  if (spec.kind === 'step') {
    input.type = 'checkbox';
    const label = panelNode('label', 'check');
    label.append(input, ` ${spec.label}`);
    return { input, node: label };
  }
  input.type = 'range';
  // Stamped from the registry: two copies of a slider's bounds is two things to keep in step.
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  const row = panelNode('div', 'row');
  const out = document.createElement('output');
  out.style.cursor = 'pointer';
  // Clicking the readout opens it for direct number entry.
  out.addEventListener('click', () => {
    const currentValue = out.textContent;
    const edit = document.createElement('input');
    edit.type = 'text';
    edit.value = currentValue;
    edit.style.cssText = 'width: 42px; text-align: right; font: inherit; background: transparent; color: var(--accent); border: 0; outline: 0; padding: 0; margin: 0;';
    // One way out, and whether it writes is an argument to it.
    let editing = true;
    const close = (write) => {
      if (!editing) return;
      editing = false;
      const parsed = parseFloat(edit.value);
      // Put the output back first so `writeControl` can find it.
      edit.replaceWith(out);
      if (!write || isNaN(parsed)) return;
      const clamped = Math.max(spec.min, Math.min(spec.max, parsed));
      input.value = String(clamped);
      out.textContent = input.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    edit.addEventListener('blur', () => close(true));
    edit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    });
    out.replaceWith(edit);
    edit.focus();
    edit.select();
  });
  row.append(panelNode('span', null, spec.label), input, out);
  return { input, node: row };
}

// Where a generated group lands: the grade at the end, everything a shoot needs above it.
function panelAnchor(group) {
  const id = group.lookgroup ? 'gradeAnchor' : 'sensorGroup';
  const anchor = document.getElementById(id);
  if (!anchor) throw new Error(`the panel group ${group.key} has no anchor: no #${id} in the markup`);
  return anchor;
}

// Placing after a fixed anchor reverses the order that placing before it preserves.
const panelTail = new Map();
function panelPlace(group, groupNode) {
  const anchor = panelAnchor(group);
  if (!group.lookgroup) { anchor.before(groupNode); return; }
  (panelTail.get(anchor) || anchor).after(groupNode);
  panelTail.set(anchor, groupNode);
}

// What the collapse rule has to find again: the group's node, its parameters, its elements.
const panelGroupNodes = new Map();
const panelGroupParams = new Map();
const panelGroupElements = new Map();
const panelEffectRows = new Map();
// Rows whose visibility depends on a parent parameter being non-zero. Keyed by the
// parent name (e.g. 'ghost.amount'), value is an array of row elements. When the parent
// is 0 the rows are hidden; when it's positive they're shown. This is how reading
// tuning parameters (ghost.rim, contour.bands, etc.) appear only when their reading is
// active.
const panelUnderRows = new Map();

// One head per group, whether or not the group can be shut.
function panelHead(group) {
  const head = panelNode('div', 'grouphead');
  const label = panelNode('label', null, group.label);
  head.append(label);
  if (!group.collapses) return { head, button: null, mark: null };

  label.style.cursor = 'pointer';
  label.addEventListener('click', () => toggleGroup(group.key));

  // How many parameters here carry something, shown only while the group is shut.
  const mark = panelNode('span', 'groupmark');
  const button = panelNode('button', 'grouptoggle');
  button.type = 'button';
  button.dataset.groupToggle = group.key;
  button.id = `${group.key}Toggle`;
  button.append(panelNode('i', 'groupchevron'));
  button.addEventListener('click', () => toggleGroup(group.key));
  head.append(mark, button);
  return { head, button, mark };
}

let panelRowsEmitted = 0;

/** The panel, generated out of the registry. Rebuilt whole rather than patched. */
function buildPanel() {
  for (const node of document.querySelectorAll('#panelBody > [data-group]')) node.remove();
  panelControls.clear();
  keyButtons.clear();
  resetButtons.clear();
  panelGroupNodes.clear();
  panelGroupParams.clear();
  panelGroupElements.clear();
  panelEffectRows.clear();
  panelUnderRows.clear();
  panelTail.clear();
  groupDefaults.clear();
  // `refreshGroups` skips a group whose state string has not moved, so this clears with it.
  groupPainted.clear();
  effectRackPainted.clear();
  panelRowsEmitted = 0;
  for (const group of PANEL_GROUPS) {
  const groupNode = panelNode('div', group.lookgroup ? 'group lookgroup' : 'group');
  // A data attribute and not an id: the hand-written groups already own their ids.
  groupNode.dataset.group = group.key;
  groupNode.dataset.panelTab = group.tab;
  panelGroupElements.set(group.key, groupNode);
  const { head, button: headButton, mark: headMark } = panelHead(group);
  if (group.label || group.collapses) groupNode.append(head);
  if (group.before) groupNode.append(...group.before());
  const names = [];
  panelGroupParams.set(group.key, names);
  if (group.collapses) {
    panelGroupNodes.set(group.key, { group, node: groupNode, button: headButton, mark: headMark });
  }

  let rows = 0;
  for (const [name, spec] of Object.entries(PARAMS)) {
    if (spec.group !== group.key) continue;
    const { input, node: row } = panelRow(name, spec);
    panelControls.set(name, input);
    if (input.type === 'checkbox') {
      // A checkbox has no drag, so `change` is the write and the end of the interaction.
      input.addEventListener('change', () => { writeFromControl(name, input.checked); history.commit(); });
    } else {
      // The conversion belongs to the control: a slider's value is text because
      // the DOM says so.
      input.addEventListener('input', () => writeFromControl(name, Number(input.value)));
      // The other half of the `input`/`change` split: one undo snapshot when the drag ends.
      input.addEventListener('change', () => history.commit());
    }

    // The two controls that ride beside a look row, gated by different questions.
    let mountedRow = row;
    if (spec.tag === 'look') {
      const keyButton = EDITING ? makeKeyButton(name) : null;
      const beside = [...(keyButton ? [keyButton] : []), makeResetButton(name)];
      if (input.type === 'checkbox') {
        // A button inside the control's own `<label>` would toggle the checkbox.
        const checkrow = panelNode('div', 'checkrow');
        checkrow.append(row, ...beside);
        groupNode.append(checkrow);
        mountedRow = checkrow;
      } else {
        row.append(...beside);
        groupNode.append(row);
      }
    } else {
      groupNode.append(row);
    }
    rows++;
    panelRowsEmitted++;
    const owner = effectOf(name);
    if (owner) {
      if (!panelEffectRows.has(owner)) panelEffectRows.set(owner, []);
      panelEffectRows.get(owner).push(mountedRow);
    }
    // A row that depends on another parameter being non-zero. The reading tuning params
    // are hidden until their reading is active, so ghost.rim only appears when ghost.amount > 0.
    if (spec.under) {
      if (!panelUnderRows.has(spec.under)) panelUnderRows.set(spec.under, []);
      panelUnderRows.get(spec.under).push(mountedRow);
    }
    names.push(name);
  }
  // A heading with nothing under it is a group key misspelled on one side.
  if (rows === 0) throw new Error(`the panel group ${group.key} holds no parameter`);

  if (group.after) groupNode.append(...group.after());
  panelPlace(group, groupNode);
  }

  const owned = params.names().filter((n) => PARAMS[n].tag !== 'composition');
  const stray = owned.filter((n) => !PANEL_GROUPS.some((g) => g.key === PARAMS[n].group));
  if (stray.length) {
    throw new Error(`${stray.join(', ')} name no panel group, so the panel would be missing `
      + `${stray.length} of ${owned.length} controls`);
  }
  // Composition is edited in the world, so a composition parameter with a row is a mistake.
  const crossed = params.names('composition').filter((n) => PARAMS[n].group || PARAMS[n].label);
  if (crossed.length) throw new Error(`composition parameter ${crossed.join(', ')} declares a panel group`);
  if (panelRowsEmitted !== owned.length) {
    throw new Error(`the panel generator emitted ${panelRowsEmitted} rows for ${owned.length} `
      + 'parameters: a panel that is not the registry is a look nothing can reach');
  }

  for (const names of panelGroupParams.values()) {
    for (const name of names) groupDefaults.set(name, params.normalise(name, PARAMS[name].def));
  }

  // The tab that was up, put back over the groups that have just been made.
  hideOffTab();

  // The preset subset dialog is a second view of this panel and goes stale in the same way.
  buildPresetPicker();
}

let effectSignature;

/** The store signature this page has already tried and failed to be rebuilt from, or null. */
let refusedEffectSignature = null;

/** A uniform cell for every binding the registry holds, minted where the tables have none. */
const uniformCellFits = (cell, bind) => Boolean(cell)
  && (cell.value instanceof THREE.Vector2) === (effectBindUniformType(bind.transform) === 'vec2');

function seedUniformCells() {
  for (const name of Object.keys(EFFECT_PARAMS)) {
    const bind = EFFECT_PARAMS[name];
    const table = UNIFORM_TABLES[bind.on];
    if (uniformCellFits(table[bind.uniform], bind)) continue;
    table[bind.uniform] = {
      value: effectBindUniformType(bind.transform) === 'vec2' ? new THREE.Vector2() : 0,
    };
  }
}

/** Which uniform every parameter writes, keyed on the table as well as the name. */
const boundUniforms = (table) => new Map(Object.values(table ?? {})
  .map((bind) => [`${bind.on} ${bind.uniform}`, bind]));

/** What each uniform table held before any parameter had ever been written into it. */
const snapshotUniformValues = (table) => new Map(Object.entries(table)
  .map(([name, cell]) => [name, cell?.value instanceof THREE.Vector2 ? cell.value.clone() : cell?.value]));
const PRISTINE_UNIFORMS = Object.fromEntries(Object.entries(UNIFORM_TABLES)
  .map(([table, held]) => [table, snapshotUniformValues(held)]));

/** Every uniform a parameter used to write and none writes now, put back where it started. */
function restoreDepartedUniforms(was, now) {
  for (const [key, bind] of was) {
    if (now.has(key)) continue;
    const table = UNIFORM_TABLES[bind.on];
    const cell = table[bind.uniform];
    if (!cell) continue;
    const pristine = PRISTINE_UNIFORMS[bind.on]?.get(bind.uniform);
    if (pristine === undefined) {
      cell.value = effectBindUniformType(bind.transform) === 'vec2' ? new THREE.Vector2() : 0;
    }
    else cell.value = pristine instanceof THREE.Vector2 ? pristine.clone() : pristine;
  }
}

/** The programs, the registry, the panel and every value, from one set of packages. */
function adoptEffectPackages(packages, programs, held = {}) {
  const wasBound = boundUniforms(EFFECT_PARAMS);
  effectPackages = packages;
  shaderPrograms = programs;
  // What the store looked like when these were read, so the poll compares against it.
  effectSignature = revSignature(packages);

  // The materials are mutated rather than replaced: everything downstream holds them.
  setCloudProgram(programs.cloud);
  setGradeProgram(programs.grade);
  setMoshProgram(programs.mosh);

  EFFECT_PARAMS = tableFromPackages(packages, EFFECT_PARAM_ORDER);
  PANEL_GROUPS = withEffectGroups(CORE_PANEL_GROUPS, packages);
  // Which terms hold each gated pass open, re-derived from the set that just arrived, and
  // which of them the transport has to put down while it drafts.
  PASS_GATES = passGatesOf(packages);
  MOSH_MASTERS = moshMastersOf(packages);
  MOSH_BOUND = moshBoundOf(packages);
  BYPASSED = [...BYPASSED_CORE, ...MOSH_MASTERS];
  BYPASS_ZERO = Object.fromEntries(BYPASSED.map((name) => [name, 0]));
  BYPASSED_SET = new Set(BYPASSED);
  PARAMS = buildParams();
  READINGS = Object.keys(PARAMS).filter((n) => PARAMS[n].reading);
  refuseRegistryDisagreement();
  seedUniformCells();
  restoreDepartedUniforms(wasBound, boundUniforms(EFFECT_PARAMS));

  for (const name of [...values.keys()]) {
    if (!Object.hasOwn(PARAMS, name)) values.delete(name);
  }

  buildPanel();

  // Every parameter, through the one write path, in registry order.
  for (const name of Object.keys(PARAMS)) {
    params.set(name, Object.hasOwn(held, name) ? held[name] : PARAMS[name].def);
  }

  // Asked again, because a gated parameter's own write cannot answer for a term that left.
  for (const table of EFFECT_GATED_TABLES) PASS_OF_TABLE[table].enabled = passNeeded(table);
}

adoptEffectPackages(effectPackages, shaderPrograms);

/** How much of the driver's log travels to the store, in characters. */
const REFUSE_REASON_MAX = 400;

/** Asks the store to set aside the packages this link failure can be attributed to. */
async function setAsideUnlinkable(before, after, log) {
  const held = new Map(before.map((p) => [p.id, p.rev]));
  const ids = after.filter((p) => held.get(p.id) !== p.rev).map((p) => p.id);
  if (ids.length === 0) return null;
  // On one line, because they land in a log where a newline is a new record.
  const line = String(log ?? '').replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim();
  const named = ids.length > 1 ? `one of ${ids.join(', ')}: ` : '';
  const reason = `${named}${line}`.slice(0, REFUSE_REASON_MAX);
  try {
    const res = await fetch('/effect-refusals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, reason }),
    });
    if (!res.ok) {
      console.warn(`could not set aside ${ids.join(', ')}: POST /effect-refusals answered ${res.status}`);
      return null;
    }
    const body = await res.json();
    const setAside = Array.isArray(body?.setAside) ? body.setAside : [];
    for (const skip of Array.isArray(body?.skipped) ? body.skipped : []) {
      console.warn(`the store kept ${skip?.id}: ${skip?.why}`);
    }
    return setAside.length ? setAside : null;
  } catch (err) {
    console.warn(`could not set aside ${ids.join(', ')}: ${err.message}`);
    return null;
  }
}

/** The store read again, and everything on this page rebuilt from what it says. */
async function reloadEffects() {
  // Read from the live bindings before anything moves: these are what the renderer holds.
  const heldPackages = effectPackages;
  const heldPrograms = shaderPrograms;
  // Every value in flight, view state included, so an install does not move a slider.
  const held = params.values(params.names());
  let fetched;
  let programs;
  let open;
  try {
    fetched = await fetchEffectPackages();
  } catch (err) {
    const framed = `the installed effects changed and this page could not read them: ${err.message}`;
    throw err.effectRefusal ? effectRefusal(framed) : new Error(framed);
  }
  try {
    programs = assembleShaders(SPINES, fetched);
    open = serialiseProjectBody();
  } catch (err) {
    throw effectRefusal(`the installed effects changed and this page could not read them: ${err.message}`);
  }

  const blocked = effectRebuildBlocked();
  if (blocked) return null;

  // Whether the programs actually moved, decided before anything is swapped.
  const sameProgram = programs.cloud.vertexShader === heldPrograms.cloud.vertexShader
    && programs.cloud.fragmentShader === heldPrograms.cloud.fragmentShader
    && programs.grade.vertexShader === heldPrograms.grade.vertexShader
    && programs.grade.fragmentShader === heldPrograms.grade.fragmentShader;

  let failure = null;
  try {
    adoptEffectPackages(fetched, programs, held);
    // Compiled here rather than on the frame that first reaches them, which would stall it.
    if (!sameProgram) warmPrograms();
    restoreProject(open);
  } catch (err) {
    failure = err;
    try {
      adoptEffectPackages(heldPackages, heldPrograms, held);
      restoreProject(open);
    } catch (stuck) {
      // The corner with no repair: the document loaded onto neither registry.
      throw effectRefusal(
        'the installed effects changed, this page could not carry the open document across to them, '
        + `and it could not put itself back either - reload the page: ${stuck.message}`,
      );
    }
  }
  refreshGroups();
  requestRepaint();
  const setAside = failure?.shaderLinkFailure
    ? await setAsideUnlinkable(heldPackages, fetched, failure.linkLog)
    : null;
  // Thrown after the repaint, so the page the operator is looking at is the rolled-back one.
  if (failure) {
    throw effectRefusal(
      'the server installed the effects it was asked for, but this page could not carry the open '
      + `document across to them, so it is still running the effects it had: ${failure.message}`
      + (setAside
        ? ` (${setAside.join(', ')} set aside, so the next rebuild is without ${setAside.length > 1 ? 'them' : 'it'})`
        : ''),
    );
  }
  refusedEffectSignature = null;
  return fetched.map((p) => ({ id: p.id, version: p.manifest.version, rev: p.rev }));
}

/** Every client converges by polling, because one installing does not tell the others. */
const EFFECT_POLL_MS = 6000;
let effectReloading = false;

/** Why a rebuild may not happen right now, by name, or null. */
function effectRebuildBlocked() {
  if (exporting) return 'an export is running';
  if (presetGesture) return 'a preset gesture is open';
  if (evaluating) return 'a track is being evaluated';
  return null;
}

// The last complaint, so a store answering the same nonsense is reported once.
let lastPollComplaint = null;

async function pollEffects() {
  // The guard goes up at the top of the tick, or two ticks overlap before the list lands.
  if (effectReloading || effectRebuildBlocked()) return;
  effectReloading = true;
  try {
    let listed;
    try {
      listed = await listEffects();
    } catch (err) {
      if (err.message !== lastPollComplaint) {
        lastPollComplaint = err.message;
        console.warn('could not read the installed effects:', err.message);
      }
      return;
    }
    lastPollComplaint = null;
    const listedSignature = revSignature(listed.effects);
    if (listedSignature === effectSignature) return;
    // The set this page has already failed to adopt, asked once rather than every six seconds.
    if (listedSignature === refusedEffectSignature) return;
    await pollRebuild(listedSignature);
  } finally {
    effectReloading = false;
  }
}

async function pollRebuild(listedSignature) {
  try {
    if (await reloadEffects() === null) return;
    say('the installed effects changed - this page has been rebuilt from them');
  } catch (err) {
    if (err.effectRefusal) refusedEffectSignature = listedSignature;
    console.warn('could not rebuild from the installed effects:', err.message);
    say(err.message);
  }
}
setInterval(pollEffects, EFFECT_POLL_MS);

const panelTabsEl = document.getElementById('panelTabs');
const panelTabButtons = [...panelTabsEl.querySelectorAll('.paneltab')];

/** Every group on screen shown or hidden by whether it belongs to the tab that is up. */
function hideOffTab() {
  const tab = activePanelTab;
  for (const group of document.querySelectorAll('#panelBody > [data-panel-tab]')) {
    group.hidden = group.dataset.panelTab !== tab;
  }
}

function setPanelTab(tab) {
  if (!['record', 'camera', 'framing', 'look', 'region'].includes(tab)) return false;
  activePanelTab = tab;
  for (const button of panelTabButtons) {
    button.setAttribute('aria-selected', String(button.dataset.panelTab === tab));
  }
  hideOffTab();
  document.getElementById('panelBody').scrollTop = 0;
  return true;
}

for (const button of panelTabButtons) {
  button.addEventListener('click', () => setPanelTab(button.dataset.panelTab));
}

function showInspector() {
  panelTabsEl.hidden = false;
  setPanelTab(activePanelTab);
}

if (!EDITING) setPanelTab(activePanelTab);

// Applying a preset is a user action and can never be an evaluation-time effect.
let evaluating = false;

// Runs a bulk write without a repaint per value in it.
function withoutRepaint(write) {
  const outer = transportWriting;
  transportWriting = true;
  try {
    return write();
  } finally {
    transportWriting = outer;
    if (!outer) groupRevealChanged();
  }
}

function refuseDuringEvaluation(what) {
  if (evaluating) {
    throw new Error(`${what} during evaluation: a preset is a user action, not a track`);
  }
}

/** Copies a set of look values in. The only bulk write a user gesture performs. */
function applyPreset(preset) {
  refuseDuringEvaluation('preset applied');
  params.apply(preset);
}

// The export settings. Separate from the project, so one edit can spawn several.
const DELIVERABLE_VERSION = 2;

let activeDeliverable = null;

function ensureActiveDeliverable() {
  if (activeDeliverable) return;
  activeDeliverable = {
    version: DELIVERABLE_VERSION,
    in: 0,
    out: null,
    outputSize: openingSizeForAspect(projectAspect) ?? DEFAULT_EXPORT_SIZE,
    codec: 'h264',
    // Empty rather than the take's id: the field reads empty as that id, and
    // writing it freezes it.
    name: '',
  };
}

function setActiveDeliverable(deliverable) {
  activeDeliverable = deliverable;
}

function applyDeliverable(deliverable) {
  // Asked before anything is touched, so an unreadable document is refused whole.
  if (deliverable.version !== DELIVERABLE_VERSION) {
    const named = Number.isFinite(deliverable.outputFps)
      ? ` it was written at ${deliverable.outputFps}fps, which is the only record of that rate,`
      : '';
    throw new Error(
      `this deliverable is version ${JSON.stringify(deliverable.version)} and this build writes `
      + `${DELIVERABLE_VERSION}: the output rate lives on the project now, so a version 1 document `
      + `would render at a rate nothing on screen agrees with -${named} so set the rate in Project `
      + 'settings and save the deliverable again',
    );
  }
  clipBoundOrThrow(deliverable.in, 'in');
  clipBoundOrThrow(deliverable.out, 'out');
  if (!sameAspect(aspectOfSize(deliverable.outputSize), projectAspect)) {
    throw new Error(
      `this deliverable renders ${deliverable.outputSize}, which is not the ${projectAspect.join(':')} `
      + 'this project is framed at: the shape belongs to the edit, so change it in Project settings '
      + 'rather than through a deliverable',
    );
  }
  dropRateGesture();
  setActiveDeliverable(deliverable);
  setClipInOut({ in: deliverable.in, out: deliverable.out });
  setDeliverableSize(deliverable.outputSize);
  // The output name travels with the deliverable, so two cannot write over each other.
  if (ui.exportName) ui.exportName.value = deliverable.name ?? '';
  timingChanged();
  paintDeliverable();
  paintExportFormats();
  paintExportName();
}

/** A trim, then told to the deliverable, the readout beside it, and the transport. */
function setClipInOut(values) {
  // `null` rather than a duration when nothing is open: there is no program to hold it.
  writeClipRange(values, timeline ? timeline.duration : null);
  ensureActiveDeliverable();
  activeDeliverable.in = clipIn;
  activeDeliverable.out = clipOut;
  paintDeliverable();
  if (timeline) {
    // Compared on the output grid, because that is the only place the playhead can be.
    const frameIn = timeline.frameOf(clipIn);
    const frameOut = clipOut === null ? null : timeline.frameOf(clipOut);
    if (timeline.frame < frameIn) timeline.seek(clipIn).catch(showTimelineError);
    else if (frameOut !== null && timeline.frame > frameOut) timeline.seek(clipOut).catch(showTimelineError);
    else timeline.paint();
  }
}

const slerpA = new THREE.Quaternion();
const slerpB = new THREE.Quaternion();

function poseAt(keys, t) {
  const n = keys.length;
  if (n === 1) return keys[0].value;
  const i = keyBefore(keys, t);
  if (i < 0) return keys[0].value;
  if (i >= n - 1) return keys[n - 1].value;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return b.value;
  // The ease handles, which make this a timing control rather than a second path editor.
  const u = easeAt(a.easeOut, b.easeIn, (t - a.t) / span);

  const position = [0, 1, 2].map((axis) => hermite(
    a.value.position[axis], b.value.position[axis],
    tangentAt(keys, i, axis), tangentAt(keys, i + 1, axis),
    span, u,
  ));

  // Slerp rather than a Catmull-Rom through the quaternions.
  slerpA.fromArray(a.value.quaternion);
  slerpB.fromArray(b.value.quaternion);
  slerpA.slerp(slerpB, u);

  return {
    position,
    quaternion: slerpA.toArray(),
    fov: a.value.fov + (b.value.fov - a.value.fov) * u,
  };
}

class Track {
  constructor(name) {
    this.name = name;
    this.kind = params.spec(name).kind;
    this.keys = [];
  }

  get length() { return this.keys.length; }

  /** The key at `t`, within half an output frame, or null. */
  keyAt(t, tol) {
    for (const key of this.keys) if (Math.abs(key.t - t) <= tol) return key;
    return null;
  }

  /** Writes a key at `t`, replacing one already there. Returns it. */
  setKey(t, value, tol) {
    const existing = this.keyAt(t, tol);
    if (existing) {
      existing.value = value;
      return existing;
    }
    const key = { t, value, easeOut: copyHandle(EASE_OUT_LINEAR), easeIn: copyHandle(EASE_IN_LINEAR) };
    this.keys.push(key);
    this.sort();
    return key;
  }

  removeKey(key) {
    const i = this.keys.indexOf(key);
    if (i >= 0) this.keys.splice(i, 1);
  }

  sort() { this.keys.sort((x, y) => x.t - y.t); }

  valueAt(t) {
    if (this.kind === 'step') return stepAt(this.keys, t);
    if (this.kind === 'pose') return poseAt(this.keys, t);
    return scalarAt(this.keys, t, HOLD_ENDS);
  }

  serialise() {
    return this.keys.map((k) => ({
      t: k.t, value: k.value, easeOut: copyHandle(k.easeOut), easeIn: copyHandle(k.easeIn),
    }));
  }
}

// Only tracks with keys exist. An empty one is a parameter with a single value.
const tracks = new Map();

function trackFor(name) {
  let track = tracks.get(name);
  if (!track) {
    track = new Track(name);
    tracks.set(name, track);
  }
  return track;
}

function dropTrackIfEmpty(name) {
  const track = tracks.get(name);
  if (track && track.keys.length === 0) tracks.delete(name);
}

// Which groups you have overruled, and nothing else. Client state rather than document state.
const PANEL_GROUPS_OPEN = 'kinect.panelGroupsOpen';

const groupOverride = new Map();
try {
  // The string is checked before the parse: `getItem` answers null when nothing is stored.
  const saved = localStorage.getItem(PANEL_GROUPS_OPEN);
  if (saved !== null && saved.trim() !== '') {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Each entry checked rather than the object adopted: a person can edit this file.
      for (const [key, want] of Object.entries(parsed)) {
        if (typeof want === 'boolean') groupOverride.set(key, want);
      }
    }
  }
} catch {
  // Private browsing, or an entry somebody has damaged. Every group answers for itself.
}

function storeGroupOverride() {
  try {
    localStorage.setItem(PANEL_GROUPS_OPEN, JSON.stringify(Object.fromEntries(groupOverride)));
  } catch {
    // Private browsing or policy again. The panel still collapses, it just will not remember.
  }
}

// Which installed effects are kept in the inspector. Panel state, not project state.
const EFFECT_RACKED = 'kinect.rackedEffects';
const rackedEffects = new Set();
try {
  const saved = localStorage.getItem(EFFECT_RACKED);
  if (saved !== null && saved.trim() !== '') {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === 'string' && id) rackedEffects.add(id);
    }
  }
} catch {
  // The values and tracks stay authoritative when storage is unavailable or damaged.
}

function storeRackedEffects() {
  try {
    localStorage.setItem(EFFECT_RACKED, JSON.stringify([...rackedEffects].sort()));
  } catch {
    // The rack still works for this page. Only the preference is lost on reload.
  }
}

function retainEffectFor(name) {
  const id = effectOf(name);
  if (!id || rackedEffects.has(id)) return;
  rackedEffects.add(id);
  storeRackedEffects();
}

function effectTouched(id) {
  return effectParamNames(id).some(paramTouched);
}

function effectPresent(id) {
  return rackedEffects.has(id) || effectTouched(id);
}

function effectGroups(id) {
  const keys = new Set(effectParamNames(id).map((name) => PARAMS[name].group));
  return PANEL_GROUPS.filter((group) => keys.has(group.key));
}

function refreshEffectRack() {
  let moved = false;
  const installed = new Set(effectIds());
  for (const id of [...effectRackPainted.keys()]) {
    if (!installed.has(id)) effectRackPainted.delete(id);
  }
  for (const id of installed) {
    const present = effectPresent(id);
    if (effectRackPainted.get(id) === present) continue;
    effectRackPainted.set(id, present);
    for (const row of panelEffectRows.get(id) ?? []) row.hidden = !present;
    moved = true;
  }
  if (!moved) return;

  // A package group leaves with its last effect row. Mixed groups stay, being clip controls.
  for (const [key, node] of panelGroupElements) {
    const visible = (panelGroupParams.get(key) ?? []).some((name) => {
      const id = effectOf(name);
      return id === null || effectPresent(id);
    });
    node.classList.toggle('rackempty', !visible);
  }
}

function effectRackEntry(id) {
  const names = effectParamNames(id);
  const moved = names.filter((name) => params.get(name) !== groupDefaults.get(name));
  const keys = names.reduce((count, name) => count + (tracks.get(name)?.keys.length ?? 0), 0);
  return { names, moved, keys };
}

// Reading tuning rows appear only when their parent reading is active. Called whenever
// the readings change, which is every look write that touches one of them.
function refreshUnderRows() {
  for (const [parent, rows] of panelUnderRows) {
    const visible = params.get(parent) > 0;
    for (const row of rows) row.hidden = !visible;
  }
}

let effectRackConfirming = null;

function addEffectToRack(id) {
  if (!effectInstalled(id)) return false;
  rackedEffects.add(id);
  storeRackedEffects();
  for (const group of effectGroups(id)) {
    if (!group.collapses) continue;
    groupOverride.set(group.key, true);
    groupOverrideDirty = true;
  }
  refreshPanel();
  paintEffectRackDialog();
  document.getElementById('effectRackSearch')?.focus();
  return true;
}

function removeEffectFromRack(id) {
  if (!effectInstalled(id)) return false;
  const { names } = effectRackEntry(id);
  effectRackConfirming = null;
  rackedEffects.delete(id);
  storeRackedEffects();

  // Values and tracks leave as one document edit. The rack choice itself stays outside undo.
  withoutRepaint(() => {
    for (const name of names) params.set(name, resetTarget(name));
  });
  for (const name of names) tracks.delete(name);
  if (selection && names.includes(selection.owner)) selection = null;
  lanesChanged();
  requestRepaint();
  history.commit();
  paintEffectRackDialog();
  document.getElementById('effectRackSearch')?.focus();
  return true;
}

function paintEffectRackDialog() {
  const list = document.getElementById('effectRackList');
  const search = document.getElementById('effectRackSearch');
  if (!list || !search) return;
  const query = search.value.trim().toLocaleLowerCase();
  const packages = effectPackages
    .map((entry) => ({ id: entry.id, title: entry.manifest.title || entry.id }))
    .filter(({ id, title }) => !query
      || id.toLocaleLowerCase().includes(query)
      || title.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  list.replaceChildren();
  if (packages.length === 0) {
    list.append(panelNode('div', 'effect-rack-empty', 'No installed effects match.'));
    return;
  }

  for (const { id, title } of packages) {
    const entry = effectRackEntry(id);
    const row = panelNode('div', 'effect-rack-row');
    row.dataset.effectRack = id;
    const name = panelNode('div', 'effect-rack-name');
    const detail = [];
    if (entry.moved.length) detail.push(`${entry.moved.length} changed`);
    if (entry.keys) detail.push(`${entry.keys} ${entry.keys === 1 ? 'key' : 'keys'}`);
    if (!detail.length) detail.push(`${entry.names.length} ${entry.names.length === 1 ? 'control' : 'controls'}`);
    name.append(panelNode('b', null, title), panelNode('small', null, `${id} · ${detail.join(' · ')}`));

    const actions = panelNode('div', 'effect-rack-actions');
    if (!effectPresent(id)) {
      const add = panelNode('button', 'dialog-secondary', 'add');
      add.type = 'button';
      add.dataset.effectAdd = id;
      add.setAttribute('aria-label', `add ${title} to the sidebar`);
      add.addEventListener('click', () => addEffectToRack(id));
      actions.append(add);
    } else if (effectRackConfirming === id) {
      const cancel = panelNode('button', 'dialog-secondary', 'cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => {
        effectRackConfirming = null;
        paintEffectRackDialog();
        document.querySelector(`[data-effect-remove="${CSS.escape(id)}"]`)?.focus();
      });
      const remove = panelNode('button', 'dialog-secondary', 'reset & remove');
      remove.type = 'button';
      remove.dataset.effectConfirmRemove = id;
      remove.setAttribute('aria-label', `reset and remove ${title}`);
      remove.addEventListener('click', () => removeEffectFromRack(id));
      actions.append(cancel, remove);
    } else {
      const remove = panelNode('button', 'dialog-secondary', 'remove');
      remove.type = 'button';
      remove.dataset.effectRemove = id;
      remove.setAttribute('aria-label', `remove ${title} from the sidebar`);
      remove.addEventListener('click', () => {
        const now = effectRackEntry(id);
        if (now.moved.length || now.keys) {
          effectRackConfirming = id;
          paintEffectRackDialog();
          document.querySelector(`[data-effect-confirm-remove="${CSS.escape(id)}"]`)?.focus();
        } else {
          removeEffectFromRack(id);
        }
      });
      actions.append(remove);
    }
    row.append(name, actions);
    list.append(row);
  }
}


/** Whether a parameter carries evidence: keys on its track, or a value off the default. */
function paramTouched(name) {
  if ((tracks.get(name)?.keys.length ?? 0) > 0) return true;
  return params.get(name) !== groupDefaults.get(name);
}

/** A group stays open while it carries work or belongs to a racked effect. */
function revealsItself(key) {
  const names = panelGroupParams.get(key) ?? [];
  if (names.some(paramTouched)) return true;
  return names.some((name) => {
    const id = effectOf(name);
    return id !== null && rackedEffects.has(id);
  });
}

/** What the document says about a group, which is the derived half of whether it is open. */
function groupRevealed(group) {
  return group.reveals ? group.reveals() : revealsItself(group.key);
}

/** The predicate: what the document derives, unless a person has said otherwise. */
function groupIsOpen(group) {
  return groupOverride.get(group.key) ?? groupRevealed(group);
}

function groupTouchedCount(key) {
  return (panelGroupParams.get(key) ?? []).filter(paramTouched).length;
}

/** How often the panel has re-derived which groups are open, since boot. */
let groupRefreshes = 0;
let groupOverrideDirty = false;
// Where the store rule's two terms last stood, per group, read as `override/derived`.
const groupSeen = new Map();
function refreshGroups() {
  groupRefreshes++;
  for (const [key, { group, node, button, mark }] of panelGroupNodes) {
    const inUse = groupRevealed(group);
    const want = groupOverride.get(key);
    const pair = `${want}/${inUse}`;
    const settled = groupSeen.get(key);
    if (settled !== undefined && settled !== pair && want === inUse) {
      groupOverride.delete(key);
      groupOverrideDirty = true;
    }
    groupSeen.set(key, `${groupOverride.get(key)}/${inUse}`);
    // Nothing here may author an override.
    const open = groupIsOpen(group);
    const touched = groupTouchedCount(key);
    const state = `${open}/${inUse}/${touched}`;
    if (groupPainted.get(key) === state) continue;
    groupPainted.set(key, state);

    node.classList.toggle('shut', !open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', `${open ? 'collapse' : 'expand'} ${group.label}`);
    mark.hidden = open || !inUse;
    mark.textContent = touched > 0 ? String(touched) : '';
    mark.title = touched > 0
      ? `${touched} of these are set to something` : 'this group is in use';
  }
  // Once at the end and only where the map moved, since `setItem` serialises the whole thing.
  if (groupOverrideDirty) {
    groupOverrideDirty = false;
    storeGroupOverride();
  }
}

function toggleGroup(key) {
  const entry = panelGroupNodes.get(key);
  if (!entry) return;
  groupOverride.set(key, !groupIsOpen(entry.group));
  groupOverrideDirty = true;
  refreshGroups();
}

function refreshPanel() {
  refreshEffectRack();
  refreshUnderRows();
  refreshGroups();
}

groupRevealChanged = refreshPanel;
refreshPanel();

// Every track written through the one door, at one program position.
let borrowed = null;

function evaluateTracks(t) {
  if (tracks.size === 0) return;
  withoutRepaint(() => {
    for (const track of tracks.values()) {
      if (track.keys.length === 0) continue;
      if (borrowed && borrowed.has(track.name)) continue;
      params.set(track.name, track.valueAt(t));
    }
  });
}

/** What a parameter is worth at a program position rather than right now. */
function valueAtProgram(name, t) {
  const track = tracks.get(name);
  if (!track || track.keys.length === 0) return params.get(name);
  return params.normalise(name, track.valueAt(t));
}

// How near an existing key has to be to count as the same key: half an output frame.
const playheadSec = () => (timeline ? timeline.programSec : 0);
const keyTolerance = () => 0.5 / (timeline ? timeline.outputFps : 30);

/** A parameter written from its control. With keys, this writes the key at the playhead. */
function writeFromControl(name, value) {
  retainEffectFor(name);
  const applied = params.set(name, value);
  const track = tracks.get(name);
  if (track && track.keys.length > 0) {
    track.setKey(playheadSec(), applied, keyTolerance());
    lanesChanged();
  }
}

/** Adds a key at the playhead, or removes the one already there. */
function toggleKey(name) {
  retainEffectFor(name);
  const track = trackFor(name);
  const existing = track.keyAt(playheadSec(), keyTolerance());
  if (existing) {
    track.removeKey(existing);
    dropTrackIfEmpty(name);
  } else {
    // The current value, so planting the first key on a track never changes the image.
    track.setKey(playheadSec(), params.get(name), keyTolerance());
  }
  lanesChanged();
  requestRepaint();
  history.commit();
}

/** The values and tracks of effects this build lacks, as the document wrote them. */
let parkedLook = { params: {}, tracks: {}, requires: [] };

/** The effects the document was authored against at a version not installed here. */
let effectVersionSkew = [];

/** What the operator has said to render without. Session state, not in the document. */
let suppressedEffects = new Set();

/** The parked pool less anything the registry has since started answering for. */
const writableParked = () => ({
  params: Object.fromEntries(Object.entries(parkedLook.params).filter(([n]) => isParkedName(n))),
  tracks: Object.fromEntries(Object.entries(parkedLook.tracks).filter(([n]) => isParkedName(n))),
  requires: parkedLook.requires.filter((entry) => !effectInstalled(entry.id)),
});

/** `suppressed` is for the export path: a render records which effects it went without. */
function serialiseProjectBody({ suppressed = null } = {}) {
  const lookNames = params.names('look');
  const lookParams = params.values(lookNames);
  // The save rule: an effect held at defaults with nothing keyed is not a use of it.
  for (const id of effectIds()) {
    const mine = effectParamNames(id);
    // A reading package stays whole even at its defaults. Version 6 requires all five reading
    // weights, and a document that sheds three because they moved behind package ids is a
    // document this same build refuses on restore.
    if (mine.some((n) => PARAMS[n].reading)) continue;
    const keyed = mine.some((n) => tracks.get(n)?.keys.length);
    const moved = mine.some((n) => lookParams[n] !== PARAMS[n].def);
    if (keyed || moved) continue;
    for (const n of mine) delete lookParams[n];
  }
  const kept = Object.keys(lookParams);
  const parked = writableParked();
  const requires = [...requiresFor(kept), ...parked.requires];
  return {
    version: PROJECT_VERSION,
    ...(requires.length ? { requires } : {}),
    ...(suppressed ? { suppressed } : {}),
    look: {
      // Look parameters only, so a snapshot or a render job carries no camera and no scale.
      params: { ...lookParams, ...parked.params },
      tracks: {
        ...Object.fromEntries(
          kept
            .filter((n) => tracks.has(n))
            .map((n) => [n, tracks.get(n).serialise()]),
        ),
        ...parked.tracks,
      },
    },
    composition: {
      retime: retime.serialise(),
      camera: tracks.get('camera')?.serialise() ?? [],
    },
    // The framing the clip was composed for, as the shape rather than as a size.
    aspect: [...projectAspect],
    // Off the deliverable because it is not free: `trails` is counted in output frames.
    outputFps: timeline ? timeline.outputFps : 30,
    appliedPreset,
  };
}

function serialiseProject() {
  return {
    ...serialiseProjectBody(),
    // Saved with the project so undo survives a reload. Never inside a snapshot or a job.
    history: { stack: [...history.stack], baseline: history.baseline },
  };
}

/** A key as it arrives from outside, checked into a key this editor can hold. */
function restoreKey(owner, k, kind) {
  if (!Number.isFinite(k?.t)) {
    throw new Error(`${owner} has a key at t=${JSON.stringify(k?.t)}: a key time has to be a finite number`);
  }
  const [loY, hiY] = kind === 'retime' || !KINDS[kind].overshoots ? [0, 1] : [-1, 2];
  const handle = (side, points, fallback) => {
    if (points === undefined) return copyHandle(fallback);
    const ok = Array.isArray(points)
      && points.length >= 1 && points.length <= SEGMENT_POINT_CEILING
      && points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
    if (!ok) {
      throw new Error(`${owner}'s key at ${k.t}s has a ${side} handle of ${JSON.stringify(points)}: it takes `
        + `1 to ${SEGMENT_POINT_CEILING} control points, each two finite numbers`);
    }
    const why = handleRefusal(points, loY, hiY);
    if (why) {
      throw new Error(`${owner}'s key at ${k.t}s has a ${side} handle with ${why}`);
    }
    return copyHandle(points);
  };
  return {
    t: k.t,
    value: k.value,
    easeOut: handle('easeOut', k.easeOut, EASE_OUT_LINEAR),
    easeIn: handle('easeIn', k.easeIn, EASE_IN_LINEAR),
  };
}

/** Refuses a restored track whose timing curve folds, one segment at a time. */
function refuseFolds(owner, keys) {
  for (let i = 0; i + 1 < keys.length; i++) {
    if (keys[i + 1].t < keys[i].t) {
      throw new Error(`${owner} holds a key at ${keys[i + 1].t}s after one at ${keys[i].t}s: keys are `
        + 'stored ascending, and the binary search the evaluators run over this track answers '
        + 'wrongly rather than failing on one that is not');
    }
    if (keys[i + 1].t === keys[i].t) continue;
    const why = foldRefusal(keys[i].easeOut, keys[i + 1].easeIn);
    if (why) {
      throw new Error(`${owner}'s segment between ${keys[i].t}s and ${keys[i + 1].t}s has ${why}`);
    }
  }
}

/** The one door a whole document comes through, including a file from outside this page. */
function restoreProject(project) {
  if (!project || typeof project !== 'object') {
    throw new Error(`a project is an object, got ${JSON.stringify(project)}`);
  }
  // The version gate first, because everything below it is interpreted in the version.
  if (project.version !== PROJECT_VERSION) {
    throw new Error(versionRefusal('this project', project.version));
  }
  if (!project.look || typeof project.look !== 'object') {
    throw new Error('a project carries a look object');
  }
  if (!project.composition || typeof project.composition !== 'object') {
    throw new Error('a project carries a composition object');
  }
  const aspectShape = Array.isArray(project.aspect) && project.aspect.length === 2
    // `isSafeInteger` rather than `isInteger`: above 2^53 the integers stop being distinct.
    && project.aspect.every((n) => Number.isSafeInteger(n) && n > 0);
  if (project.aspect !== undefined && !aspectShape) {
    throw new Error(`aspect is ${JSON.stringify(project.aspect)}: it reads as [width, height] in whole positive numbers`);
  }
  // Still checked because a project written before the shape moved still reads it.
  if (project.outputSize !== undefined && !/^[1-9][0-9]*x[1-9][0-9]*$/.test(String(project.outputSize))) {
    throw new Error(`outputSize is ${JSON.stringify(project.outputSize)}: it reads as WIDTHxHEIGHT`);
  }
  // A shape with no resolution to offer is refused, which stops a document becoming a trap.
  const framedAt = project.aspect
    ?? (project.outputSize === undefined ? defaultAspect() : aspectOfSize(String(project.outputSize)));
  const framedShape = reduceAspect(framedAt[0], framedAt[1]);
  if (sizesForAspect(framedShape).length === 0) {
    throw new Error(
      `this project is framed at ${framedShape.join(':')}, which this build offers no resolution for - `
      + `it renders ${exportAspects().map((a) => a.ratio).join(', ')}, so there is no size to `
      + 'export it at and no menu entry to pick one from',
    );
  }
  // Against the list the control is built from, so a document naming 25 is refused.
  if (project.outputFps !== undefined && !OUTPUT_RATES.includes(project.outputFps)) {
    throw new Error(
      `outputFps is ${JSON.stringify(project.outputFps)}: this build offers ${OUTPUT_RATES.join(', ')}`,
    );
  }
  if (!project.look.params || typeof project.look.params !== 'object') {
    throw new Error('a project look carries a params object');
  }
  const shortReadings = missingReadings(project.look.params);
  if (shortReadings.length) {
    throw new Error(
      `this project names no ${shortReadings.join(', ')}: a version ${PROJECT_VERSION} look carries `
      + 'all five reading weights, and the ones it leaves out would come back as defaults rather '
      + 'than as the look it was saved with',
    );
  }
  if (!project.look.tracks || typeof project.look.tracks !== 'object') {
    throw new Error('a project look carries a tracks object, empty if nothing is keyed');
  }
  refuseRequires('this project', project.requires, [
    ...Object.keys(project.look.params),
    ...Object.keys(project.look.tracks),
  ]);
  // Where the missing-effect split happens, as one predicate rather than a special case.
  const parkedNames = new Set(
    [...Object.keys(project.look.params), ...Object.keys(project.look.tracks)].filter(isParkedName),
  );
  const parkedIds = [...new Set([...parkedNames].map(effectOf))];
  const parkedRequires = parkedIds.map((id) => (project.requires ?? []).find((e) => e.id === id));
  const versionSkew = (project.requires ?? [])
    .filter((e) => typeof e?.id === 'string' && effectInstalled(e.id))
    .map((e) => ({ id: e.id, wanted: e.version, installed: versionOf(e.id) }))
    .filter((e) => e.wanted !== e.installed);
  const touched = effectIdsIn([...Object.keys(project.look.params), ...Object.keys(project.look.tracks)]);
  for (const id of touched.filter((n) => !parkedIds.includes(n))) {
    const short = effectParamNames(id).filter((n) => !Object.hasOwn(project.look.params, n));
    if (short.length) {
      throw new Error(
        `this project names part of ${id} but not ${short.join(', ')}: a document carries every `
        + 'parameter of an effect it uses, and the ones it leaves out would come back as defaults '
        + 'rather than as the look it was saved with',
      );
    }
  }
  if (!project.composition.retime || !Array.isArray(project.composition.retime.keys) || !Number.isFinite(project.composition.retime.rate) || project.composition.retime.rate <= 0) {
    throw new Error('a project composition carries a retime with a positive rate and an array of keys');
  }
  if (!Array.isArray(project.composition.camera)) {
    throw new Error('a project composition carries a camera track as an array of keys');
  }

  // Built whole first, so a project that fails halfway leaves the editor on its own clip.
  const restoredLook = [];
  const parkedTracks = {};
  for (const [name, keys] of Object.entries(project.look.tracks)) {
    if (!Array.isArray(keys)) throw new Error(`look track ${name} is not an array of keys`);
    // A track under a missing effect is parked before it is asked anything.
    if (parkedNames.has(name)) {
      parkedTracks[name] = keys;
      continue;
    }
    // Unknown names are refused rather than dropped: a discarded track is a lost edit.
    const spec = params.spec(name);
    // A known name not tagged `look` is refused too: the serialiser never writes one.
    if (spec.tag !== 'look') {
      throw new Error(
        `the track on ${JSON.stringify(name)} is on a ${spec.tag} parameter: a project carries `
        + 'look tracks only, which is what this build writes and the only kind it can evaluate '
        + 'without resizing the drawing buffer from inside the render loop',
      );
    }
    if (keys.length === 0) continue;
    const restored = keys.map((k) => {
      const key = restoreKey(`track ${name}`, k, params.spec(name).kind);
      key.value = params.normalise(name, key.value);
      return key;
    });
    refuseFolds(`track ${name}`, restored);
    restoredLook.push([name, restored]);
  }

  const applied = {};
  const parkedValues = {};
  for (const [name, value] of Object.entries(project.look.params)) {
    if (parkedNames.has(name)) {
      parkedValues[name] = value;
      continue;
    }
    params.spec(name);
    applied[name] = value;
  }

  const restoredCamera = project.composition.camera.map((k) => {
    const key = restoreKey('track camera', k, params.spec('camera').kind);
    key.value = params.normalise('camera', key.value);
    return key;
  });
  refuseFolds('track camera', restoredCamera);

  const restoredRetime = project.composition.retime.keys.map((k) => {
    const key = restoreKey('the retime curve', k, 'retime');
    if (!Number.isFinite(key.value)) {
      throw new Error(`the retime key at ${key.t}s maps to ${JSON.stringify(key.value)}: source time is a number`);
    }
    return key;
  });
  refuseFolds('the retime curve', restoredRetime);
  // The fourth door onto the curve, and the one a file from outside comes through.
  retime.assertMonotonic(restoredRetime);

  const stamp = project.appliedPreset ?? null;
  if (stamp !== null && (typeof stamp.name !== 'string' || typeof stamp.rev !== 'string')) {
    throw new Error(`appliedPreset is ${JSON.stringify(stamp)}: it is null, or a name and a rev`);
  }

  // A deliverable's document carries what its render went without. Checked, then left alone.
  if (project.suppressed !== undefined) {
    const ok = Array.isArray(project.suppressed) && project.suppressed.every((e) => e
      && typeof e === 'object' && !Array.isArray(e)
      && typeof e.id === 'string' && /^[a-z][a-z0-9]*$/.test(e.id)
      && typeof e.version === 'string' && e.version.length > 0);
    if (!ok) {
      throw new Error(
        `this project carries ${JSON.stringify(project.suppressed)} where its suppressed list belongs: `
        + 'it is a list of { id, version } entries naming the effects a render was allowed to go '
        + 'without, and it is a record of that render rather than anything this editor adopts',
      );
    }
  }

  if (project.history !== undefined) {
    if (!project.history || typeof project.history !== 'object' || !Array.isArray(project.history.stack)) {
      throw new Error('a project history is an object with a stack array');
    }
    if (project.history.baseline !== null && typeof project.history.baseline !== 'string') {
      throw new Error('a project history baseline is a string or null');
    }
  }

  // Defaults first, so an absent key means the default rather than what the session left.
  const legacySize = project.outputSize === undefined ? null : String(project.outputSize);
  if (legacySize !== null && project.aspect === undefined) {
    ensureActiveDeliverable();
    activeDeliverable.outputSize = legacySize;
  }
  setProjectAspect(
    project.aspect ?? (legacySize === null ? defaultAspect() : aspectOfSize(legacySize)),
    { fromDocument: true },
  );

  // `timeline.frame` counts output frames, so a new rate moves it unless it is held.
  if (timeline) {
    const held = timeline.programSec;
    timeline.outputFps = project.outputFps ?? 30;
    timeline.frame = timeline.frameAt(held);
  }

  params.reset(params.names('look'));
  params.apply(applied);
  appliedPreset = stamp;
  parkedLook = {
    params: parkedValues,
    tracks: parkedTracks,
    requires: parkedRequires,
  };
  effectVersionSkew = versionSkew;
  // Pruned rather than cleared, because undo arrives here too.
  suppressedEffects = new Set([...suppressedEffects].filter((id) => parkedIds.includes(id)));
  paintMissingEffects();

  tracks.clear();
  for (const [name, keys] of restoredLook) trackFor(name).keys = keys;
  trackFor('camera').keys = restoredCamera;

  retime.rate = project.composition.retime.rate;
  retime.keys = restoredRetime;

  timingChanged();

  if (project.history) {
    history.stack = [...project.history.stack];
    // A null baseline is accepted above: it is what the recorder holds before `begin` runs.
    history.baseline = project.history.baseline ?? history.snapshot();
  }
}

// Whole snapshots, because a command stack needs every mutation path to cooperate.
const UNDO_LIMIT = 100;

/** Every write to the working document, in the order asked. The server does not order them. */
let workingWrites = Promise.resolve();
function writeWorking(body) {
  const wrote = workingWrites.then(() => fetch(`/projects/${WORKING_PROJECT}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  workingWrites = wrote.catch(() => {});
  return wrote;
}

const history = {
  stack: [],
  // What the document was at the last interaction, so a no-op commit costs nothing.
  baseline: null,
  restoring: false,

  get depth() { return this.stack.length; },

  snapshot() { return JSON.stringify(serialiseProjectBody()); },

  /** Starts the stack from whatever the clip already is. */
  begin() {
    this.stack.length = 0;
    this.baseline = this.snapshot();
  },

  commit() {
    if (this.restoring) return false;
    // The recorder has no clip, so there is nothing here to undo and nothing to save.
    if (!EDITING) return false;
    // The same poisoning arrives on the editor by a road the guard above cannot see.
    if (this.baseline === null) return false;
    const now = this.snapshot();
    if (now === this.baseline) return false;
    this.stack.push(this.baseline);
    if (this.stack.length > UNDO_LIMIT) this.stack.shift();
    this.baseline = now;
    if (effectVersionSkew.length) {
      effectVersionSkew = [];
      paintMissingEffects();
    }
    // Auto-save after every change. Fire-and-forget, so a failed save blocks nothing.
    const workingBody = { ...serialiseProject(), take: { id: openTakeId, hash: openTakeHash } };
    writeWorking(workingBody).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        say(`auto-save failed: ${text.slice(0, 80)}`);
      }
    }).catch((err) => {
      say(`auto-save failed: ${err.message}`);
    });
    return true;
  },

  undo() {
    const previous = this.stack.pop();
    if (previous === undefined) return false;
    // The accumulators walk forward one output frame at a time and cannot be walked back.
    const gen = takeTransport();
    const resume = timeline ? timeline.playing : false;
    if (resume) timeline.pause();
    const wasRate = retime.rate;
    const wasIn = clipIn;
    const wasOut = clipOut;
    this.restoring = true;
    try {
      restoreProject(JSON.parse(previous));
      this.baseline = previous;
    } finally {
      this.restoring = false;
    }
    if (retime.rate !== wasRate) {
      reparameteriseProgramTime(wasRate / retime.rate, { clipIn: wasIn, clipOut: wasOut, keys: [] });
    }
    // The playhead deliberately does not move. Undo is about what the clip is.
    if (resume) {
      timeline.seek(timeline.programSec)
        .then(() => { if (gen === transportGen) return timeline.play(); })
        .catch(showTimelineError);
    } else {
      requestRepaint();
    }
    return true;
  },
};

let framesSeen = 0;
let lastFpsAt = performance.now();
let fps = 0;

// Viewport fps: how fast `renderProgramFrame` runs, live or recorded.
let viewportRenders = 0;
let lastViewportFpsAt = performance.now();
let viewportFps = 0;
let sensorLabel = '';
let sensorState = '';
let decodeBusy = false;
let pendingColor = null;
let retiringBitmap = null;
let streamDetached = false;

function setStatus() {
  if (sensorState) {
    const note = document.createElement('span');
    note.textContent = sensorState;
    note.style.color = '#e8a33d';
    statusEl.replaceChildren(note);
    if (appStatusEl) appStatusEl.textContent = sensorState;
  } else {
    statusEl.replaceChildren();
    if (appStatusEl) appStatusEl.textContent = '';
  }
}

async function pumpColorDecode() {
  if (decodeBusy || !pendingColor) return;
  decodeBusy = true;
  const bytes = pendingColor;
  pendingColor = null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    // The decode is asynchronous, so one can finish after a pinned run took the textures.
    if (streamDetached) {
      bitmap.close();
      return;
    }
    const dropped = retiringBitmap;
    retiringBitmap = colorPrev.image instanceof ImageBitmap ? colorPrev.image : null;

    bindColor(bitmap);

    // Only close a bitmap once it is two swaps old and certainly unbound.
    if (dropped) dropped.close();
  } catch {
    /** a torn JPEG from a dropped USB packet: skip this frame */
  } finally {
    decodeBusy = false;
    if (pendingColor) pumpColorDecode();
  }
}

function handleFrame(buffer) {
  const view = new DataView(buffer);
  const depthBytes = view.getUint32(0, true);
  const colorBytes = view.getUint32(4, true);
  const stampMs = Number(view.getBigUint64(8, true));
  const offset = 16; // u32 + u32 + u64 timestamp

  bindDepth(new Uint16Array(buffer, offset, depthBytes / 2));

  const now = performance.now();
  livePairs.push(stampMs, now);

  if (colorBytes > 0) {
    pendingColor = new Uint8Array(buffer, offset + depthBytes, colorBytes);
    pumpColorDecode();
  }

  framesSeen++;
  if (now - lastFpsAt >= 1000) {
    fps = (framesSeen * 1000) / (now - lastFpsAt);
    framesSeen = 0;
    lastFpsAt = now;
    setStatus();
  }

  // The output's clock is the sensor, and this is where that is decided.
  if (PROGRAM_OUT) programOutFrame();
}

// Camera settings live on the sensor, so the checkboxes mirror what the server reports.
const colorCamEl = document.getElementById('colorCam');
const lowLightEl = document.getElementById('lowLight');
let socket = null;

function sendCamera(patch) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ camera: patch }));
}

function showCamera(state) {
  colorCamEl.checked = state.color;
  lowLightEl.checked = state.lowLight;
  // Exposure is meaningless with the colour camera off, so the control says so.
  lowLightEl.disabled = !state.color;
  lowLightEl.parentElement.classList.toggle('disabled', !state.color);
}

colorCamEl.addEventListener('change', () => sendCamera({ color: colorCamEl.checked }));
lowLightEl.addEventListener('change', () => sendCamera({ lowLight: lowLightEl.checked }));

const monDivisorEl = document.getElementById('monDivisor');
const monStrideEl = document.getElementById('monStride');
const monAcceptCostEl = document.getElementById('monAcceptCost');
const monNoteEl = document.getElementById('monNote');

// The last setting the server confirmed, which is what the record button consults.
let monitorState = { divisor: 1, stride: 1, loopback: true, granted: true, wouldRefuseRecording: false };

function sendMonitor() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const body = { divisor: Number(monDivisorEl.value), stride: Number(monStrideEl.value) };
  if (monAcceptCostEl?.checked) body.acceptMonitorCost = true;
  socket.send(JSON.stringify({ monitor: body }));
}

function showMonitor(state) {
  monitorState = state;
  monDivisorEl.value = String(state.divisor);
  monStrideEl.value = String(state.stride);
  monDivisorEl.nextElementSibling.value = String(state.divisor);
  monStrideEl.nextElementSibling.value = String(state.stride);
  if (monAcceptCostEl) {
    monAcceptCostEl.parentElement.style.display = state.loopback ? 'none' : '';
  }

  // The stride reads as a position, so it needs a real ordinal rather than a "th" glued on.
  const ordinal = (n) => {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th'
      : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
    return `${n}${suffix}`;
  };

  // The depth block scales with the divisor squared and the colour block does not move at all.
  const depthKB = Math.ceil(DEPTH_W / state.divisor) * Math.ceil(DEPTH_H / state.divisor) * 2 / 1000;
  const perFrame = depthKB + 52;
  const rate = perFrame * (30 / state.stride) / 1000;
  const parts = [];
  if (!state.granted) parts.push('ungranted');
  parts.push(`depth ÷${state.divisor}, every ${state.stride === 1 ? 'frame' : `${ordinal(state.stride)} frame`}`);
  parts.push(`about ${perFrame.toFixed(0)}KB a frame, ${rate.toFixed(1)} MB/s`);
  if (state.refused) parts.push(`refused: ${state.refused}`);
  if (state.wouldRefuseRecording) {
    parts.push(`a take will refuse to start at this setting - finer than the ÷${state.cap.divisor} `
      + `×${state.cap.stride} a recording allows, and the frames it costs never reach the file`);
  } else if (state.granted && !state.loopback) {
    parts.push('coarse enough to record through');
  }
  parts.push('the recording is always full fidelity whatever this says');
  monNoteEl.textContent = `${parts.join(' · ')}.`;
  monNoteEl.classList.toggle('warn', Boolean(!state.granted || state.wouldRefuseRecording || state.refused));
}

for (const el of [monDivisorEl, monStrideEl]) el.addEventListener('input', sendMonitor);

let programOutMode = 'camera';
/** The output's pixel size, which is deliberately not the window's. */
let programOutSize = { w: 1920, h: 1080 };
let programOutDrawn = 0;
let programOutMissed = 0;
let programOutFps = 0;
let programOutLastAt = 0;
let programOutSince = 0;

const progModeEl = document.getElementById('progMode');
const progSizeEl = document.getElementById('progSize');
const progNoteEl = document.getElementById('progNote');

/** Send a patch to whatever program-out sources are listening. Operator side. */
function sendProgramOut(patch) {
  if (PROGRAM_OUT) return; // a source does not tell other sources what to draw
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ programOut: patch }));
}

/** The operator's whole state, sent when a source connects or the operator changes mode. */
function sendProgramOutState() {
  sendProgramOut({
    mode: programOutMode,
    size: programOutSize,
    params: params.values(),
    view: cameraPose(freeCamera),
  });
}

function cameraPose(cam) {
  return {
    position: cam.position.toArray(),
    quaternion: cam.quaternion.toArray(),
    fov: cam.fov,
  };
}

/** Apply a patch. Source side. */
function applyProgramOut(patch) {
  if (!PROGRAM_OUT) return;
  // Normalised before any field is applied: a refusal after a mode switch is not a refusal.
  const mode = patch.mode === 'mirror' || patch.mode === 'camera' ? patch.mode : programOutMode;
  let view = null;
  if (patch.view && mode === 'mirror') {
    try {
      view = params.normalise('camera', patch.view);
    } catch (err) {
      console.error(`[program-out] ${err.message}`);
      return;
    }
  }
  if (patch.params) {
    try {
      params.apply(patch.params);
    } catch (err) {
      console.error(`[program-out] ${err.message}`);
      return;
    }
  }
  if (patch.size && Number.isInteger(patch.size.w) && Number.isInteger(patch.size.h)
      && patch.size.w > 0 && patch.size.h > 0) {
    programOutSize = { w: patch.size.w, h: patch.size.h };
    outputSize = { ...programOutSize };
    resize();
  }
  if (patch.mode === 'mirror' || patch.mode === 'camera') {
    programOutMode = patch.mode;
    setViewCamera(programOutMode === 'mirror' ? freeCamera : programCamera);
  }
  if (view) {
    freeCamera.position.fromArray(view.position);
    freeCamera.quaternion.fromArray(view.quaternion);
    if (freeCamera.fov !== view.fov) {
      freeCamera.fov = view.fov;
      freeCamera.updateProjectionMatrix();
    }
  }
}

/** Draw one output frame, called when a depth frame arrives rather than on a clock. */
function programOutFrame() {
  const now = performance.now();
  renderProgramFrame(liveTransport.positionAt(now));
  programOutDrawn++;
  if (programOutLastAt) {
    // The interval is measured and never assumed, because the stream is irregular.
    const expected = livePairs.deliveryMs;
    const gaps = Math.round((now - programOutLastAt) / expected) - 1;
    if (gaps > 0) programOutMissed += gaps;
  }
  programOutLastAt = now;
  if (now - programOutSince >= 1000) {
    programOutFps = (programOutDrawn * 1000) / (now - programOutSince);
    programOutDrawn = 0;
    programOutSince = now;
    paintProgramOutReadout();
  }
}

/** The output's own health, on the output. The other two surfaces have no use for it. */
let programOutReadout = null;
function paintProgramOutReadout() {
  if (!programOutReadout) return;
  // A source fed by a coarsened stream says so.
  const decim = monitorState && (monitorState.divisor > 1 || monitorState.stride > 1)
    ? `  ÷${monitorState.divisor} ×${monitorState.stride}`
    : '';
  programOutReadout.textContent = `PROGRAM OUT  ${programOutMode}  `
    + `${programOutSize.w}x${programOutSize.h}  ${programOutFps.toFixed(1)} fps  `
    + `${programOutMissed} missed${decim}`;
}

/** The operator's two controls, and the URLs to paste into OBS. Not wired on a source. */
if (!PROGRAM_OUT && progModeEl) {
  progModeEl.addEventListener('change', () => {
    programOutMode = progModeEl.value;
    sendProgramOutState();
  });
  progSizeEl.addEventListener('change', () => {
    const m = /^\s*([1-9][0-9]*)\s*x\s*([1-9][0-9]*)\s*$/.exec(progSizeEl.value);
    if (!m) {
      progSizeEl.value = `${programOutSize.w}x${programOutSize.h}`;
      return;
    }
    programOutSize = { w: Number(m[1]), h: Number(m[2]) };
    progSizeEl.value = `${programOutSize.w}x${programOutSize.h}`;
    sendProgramOut({ size: programOutSize });
  });
  progNoteEl.textContent = `browser source: ${location.origin}/program  ·  `
    + `webcam: ${location.origin}/camera.mjpg`;
}

function connect() {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.binaryType = 'arraybuffer';
  socket = ws;

  ws.onopen = () => {
    sensorLabel = 'waiting for sensor…';
    setStatus();
    // Asked for rather than waited for: OBS reconnects a browser source on its own schedule.
    if (PROGRAM_OUT) ws.send(JSON.stringify({ programOut: { hello: true } }));
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const msg = JSON.parse(event.data);

      if (msg.status) {
        sensorState = {
          live: '', starting: 'sensor starting…', lost: 'sensor lost — restarting',
          // Not a fault to wait out: this is the editing station and the
          // footage is on the node.
          absent: 'no sensor on this machine',
        }[msg.status] ?? msg.status;
        if (msg.status !== 'live') fps = 0;
        setStatus();
        return;
      }

      if (msg.camera) {
        showCamera(msg.camera);
        return;
      }

      // Any client can arm or stop a take, so every monitor has to see the state change.
      if (msg.recording) {
        recordState = msg.recording;
        paintRecord(null);
        chromeStale = true;
        drawChrome();
        return;
      }

      // What the server granted this monitor, which is not always what it asked for.
      if (msg.monitor) {
        showMonitor(msg.monitor);
        return;
      }

      // What the operator wants drawn. Ignored on any page that is not a source.
      if (msg.programOut) {
        if (msg.programOut.hello) {
          if (!PROGRAM_OUT) sendProgramOutState();
        } else {
          applyProgramOut(msg.programOut);
        }
        return;
      }

      // The hello is recognised rather than reached by falling through.
      if (typeof msg.serial === 'string' && Number.isFinite(msg.fx)) {
        uniforms.focal.value.set(msg.fx, msg.fy);
        uniforms.center.value.set(msg.cx, msg.cy);
        if (!msg.color) uniforms.hasColor.value = 0;
        sensorLabel = `${msg.serial} · fw ${msg.firmware}`;
        paintPreviewRange(msg.minDepth, msg.maxDepth);
        setStatus();
        console.log('sensor intrinsics', msg);
        return;
      }

      // Loud rather than ignored: a message this page cannot read means the server is ahead.
      console.warn('unrecognised message on the frame socket', msg);
    } else {
      handleFrame(event.data);
    }
  };

  ws.onclose = () => {
    if (streamDetached) return;
    sensorLabel = 'disconnected — retrying';
    setStatus();
    setTimeout(connect, 1000);
  };

  ws.onerror = () => ws.close();
}

// Live acquisition has to be able to go away: a render pulls its frames from a file.
function detachStream() {
  streamDetached = true;
  socket?.close();
  // The socket closing does not stop a frame that has already been parsed.
  pendingColor = null;
  sensorLabel = 'stream detached';
  setStatus();
}

const NOMINAL_GAP_MS = 1000 / 30;
// Past this, a stamp step is a take boundary rather than a stall.
const DISCONTINUITY_MS = 5000;
const noop = () => {};

// What the instruments read instead of taking the transport's word for anything.
const counters = {
  renders: 0, stateAdvances: 0, resets: 0, drafts: 0, seeks: 0, requests: 0, framesFetched: 0,
  navigationRedraws: 0, navigationHistoryClears: 0,
  laneRebuilds: 0, laneRepositions: 0, laneFallbacks: 0,
};

// The one function mapping program time to source time.
const retime = {
  rate: 1,
  keys: [],

  sourceSecAt(programSec) {
    const keys = this.keys;
    if (keys.length === 0) return programSec * this.rate;
    if (keys.length === 1) return keys[0].value + (programSec - keys[0].t) * this.rate;
    return scalarAt(keys, programSec, EXTEND_ENDS);
  },

  // The local slope, in source seconds per program second.
  slopeAt(programSec) {
    if (this.keys.length < 2) return this.rate;
    return scalarSlopeAt(this.keys, programSec);
  },

  /**
   * How many output frames back the curve reaches to cover `sourceSpanSec` ending
   * at `programSec`.
   */
  framesBackFor(programSec, sourceSpanSec, outputFps, ceiling) {
    if (!(sourceSpanSec > 0)) return { frames: 0, covered: true };
    const at = this.sourceSecAt(programSec);
    const limit = Math.max(0, Math.floor(ceiling));
    for (let n = 1; n <= limit; n++) {
      if (at - this.sourceSecAt(programSec - n / outputFps) >= sourceSpanSec - 1e-9) {
        return { frames: n, covered: true };
      }
    }
    return { frames: limit, covered: false };
  },

  /** The program position a source position sits at. */
  programSecAt(sourceSec) {
    const keys = this.keys;
    if (keys.length === 0) return sourceSec / this.rate;
    if (keys.length === 1) return keys[0].t + (sourceSec - keys[0].value) / this.rate;
    if (sourceSec <= keys[0].value) {
      const slope = segmentSlope(keys, 0, 0);
      return slope > 0 ? keys[0].t - (keys[0].value - sourceSec) / slope : keys[0].t;
    }
    for (let i = 0; i < keys.length - 1; i++) {
      if (keys[i + 1].value < sourceSec) continue;
      // Bisected rather than solved: an eased cubic has no useful closed-form inverse.
      let lo = keys[i].t;
      let hi = keys[i + 1].t;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (this.sourceSecAt(mid) < sourceSec) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    const last = keys[keys.length - 1];
    const slope = segmentSlope(keys, keys.length - 2, 1);
    return slope > 0 ? last.t + (sourceSec - last.value) / slope : last.t;
  },

  // How long a program is, given a source that long.
  programDurationFor(sourceSec) { return Math.max(0, this.programSecAt(sourceSec)); },

  /** Refuses a curve that runs downhill. Equal values are a hold and are legal. */
  assertMonotonic(keys) {
    for (const key of keys) {
      // Handles first, because a curve can run downhill without any pair of key
      // values doing so.
      for (const [side, h] of [['easeOut', key.easeOut], ['easeIn', key.easeIn]]) {
        if (h.length !== 1) {
          throw new Error(
            `the retime key at program ${key.t}s has a ${side} handle of ${h.length} control `
            + 'points: the retime curve is a cubic, because the proof that a handle inside the '
            + 'unit box cannot run source time backwards is a proof about a cubic and about '
            + 'nothing else',
          );
        }
        if (!h[0].every((c) => c >= 0 && c <= 1)) {
          throw new Error(
            `the retime key at program ${key.t}s has a ${side} handle at `
            + `[${h[0].join(', ')}]: a handle outside the unit box bends the curve back on `
            + 'itself inside the segment, and source time cannot run backwards',
          );
        }
      }
    }
    for (let i = 1; i < keys.length; i++) {
      if (keys[i].value < keys[i - 1].value) {
        throw new Error(
          `the retime curve falls from ${keys[i - 1].value}s to ${keys[i].value}s between `
          + `program ${keys[i - 1].t}s and ${keys[i].t}s: source time cannot run backwards, `
          + 'because neither accumulator can',
        );
      }
    }
    return keys;
  },

  serialise() {
    return {
      rate: this.rate,
      keys: this.keys.map((k) => ({
        t: k.t, value: k.value, easeOut: copyHandle(k.easeOut), easeIn: copyHandle(k.easeIn),
      })),
    };
  },
};

/** Every program time, rescaled by `k`, which is what changing the slope does to them. */
function reparameteriseProgramTime(k, was) {
  for (const [key, t] of was.keys) key.t = t * k;
  setClipInOut({ in: was.clipIn * k, out: was.clipOut === null ? null : was.clipOut * k });
}

/** Where a later rescale reads its times from. Live objects, and the `t` they had. */
const programTimeSnapshot = () => ({
  clipIn,
  clipOut,
  keys: [...tracks.values()].flatMap((track) => track.keys.map((key) => [key, key.t])),
});

class LivePairSource {
  constructor() {
    this.tA = 0;
    this.tB = 0;
    this.arrivedAtMs = 0;
    // Two smoothed intervals with different jobs, and conflating them is the mistake to avoid.
    this.sourceGapMs = NOMINAL_GAP_MS;
    this.deliveryMs = NOMINAL_GAP_MS;
    this.lastStampMs = null;
    this.lastWallMs = 0;
    this.pendingGapMs = 0;
    this.pendingFrames = 0;
  }

  /** One arrival, after its depth has been swapped into the current texture. */
  push(stampMs, wallMs) {
    const raw = this.lastStampMs === null ? 0 : stampMs - this.lastStampMs;
    this.lastStampMs = stampMs;

    // A replay loops and a restart opens a new take, so a stamp can go backwards or leap.
    const gap = (raw > 0 && raw < DISCONTINUITY_MS) ? raw : this.sourceGapMs;
    if (raw > 5 && raw < 500) this.sourceGapMs = this.sourceGapMs * 0.8 + raw * 0.2;

    const delivered = this.lastWallMs ? wallMs - this.lastWallMs : 0;
    // Clamped so one stall does not stretch the blend across the next second.
    if (delivered > 5 && delivered < 500) this.deliveryMs = this.deliveryMs * 0.8 + delivered * 0.2;
    this.lastWallMs = wallMs;

    this.tA = this.tB;
    this.tB += gap;
    this.arrivedAtMs = wallMs;
    this.pendingGapMs += gap;
    this.pendingFrames++;
  }

  at(programSec) {
    const steps = [];
    if (this.pendingFrames > 0) {
      steps.push({ gapSec: this.pendingGapMs / 1000, makeCurrent: noop });
      this.pendingGapMs = 0;
      this.pendingFrames = 0;
    }

    // This half of the seam is in milliseconds and the indexed half is in seconds.
    const spanMs = Math.max(1, this.tB - this.tA);
    const offsetMs = Math.min(Math.max(programSec * 1000 - this.tA, 0), spanMs);
    return { steps, mixT: offsetMs / spanMs, sinceFrameSec: offsetMs / 1000, spanSec: spanMs / 1000 };
  }
}

class LiveTransport {
  constructor(source) { this.source = source; }

  /** The one transport that reads a wall clock, and only to place the playhead in the gap. */
  positionAt(wallMs) {
    const s = this.source;
    if (!s.arrivedAtMs) return 0;
    // Walk across the pair over one expected delivery interval, then hold.
    const frac = Math.min(1, (wallMs - s.arrivedAtMs) / Math.max(1, s.deliveryMs));
    return (s.tA + frac * (s.tB - s.tA)) / 1000;
  }
}

const livePairs = new LivePairSource();
const liveTransport = new LiveTransport(livePairs);
let pairSource = livePairs;

// One ping-pong step of the surface memory, advanced by exactly one source frame.
function advanceSurfaceState(dtSec) {
  counters.stateAdvances++;
  // The upper bound is the discontinuity gate and nothing tighter, or it undoes that gate.
  stepSurfaceMemory(
    Math.min(DISCONTINUITY_MS / 1000, Math.max(0.001, dtSec)),
    uniforms.snapDelta.value,
  );
  uniforms.stateTex.value = statePrev.texture;
}

let lastProgramTime = 0;

// What the mosh pass's last rendered frame was: whether the history behind it is worth reading
// at all, and the refresh period in force when it was drawn. The second is remembered rather
// than re-derived because the period keyframes, so the step between two frames is measured with
// the value each end actually had.
let moshFresh = true;
let moshWasLive = false;
let lastMoshPeriod = 0;

// Screen-space history belongs to the camera pose that produced it.
let renderedCamera = null;
const renderedCameraPosition = new THREE.Vector3();
const renderedCameraQuaternion = new THREE.Quaternion();
const renderedProjection = new THREE.Matrix4();

function renderedCameraChanged() {
  const changed = renderedCamera !== null && (
    renderedCamera !== viewCamera
    || !renderedCameraPosition.equals(viewCamera.position)
    || !renderedCameraQuaternion.equals(viewCamera.quaternion)
    || !renderedProjection.equals(viewCamera.projectionMatrix)
  );
  renderedCamera = viewCamera;
  renderedCameraPosition.copy(viewCamera.position);
  renderedCameraQuaternion.copy(viewCamera.quaternion);
  renderedProjection.copy(viewCamera.projectionMatrix);
  return changed;
}

function clearFeedback(targets, refusal) {
  if (!targets.every((target) => target?.isWebGLRenderTarget)) throw new Error(refusal);
  const color = new THREE.Color();
  renderer.getClearColor(color);
  const alpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  try {
    for (const target of targets) {
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
    }
  } finally {
    renderer.setRenderTarget(null);
    renderer.setClearColor(color, alpha);
  }
}

function clearAfterimage() {
  // Three exposes no reset on the afterimage pass, so its two buffers are reached for directly.
  clearFeedback(
    [afterimage._textureComp, afterimage._textureOld],
    'afterimage internals moved: camera history can no longer be cleared safely',
  );
}

// Clears every feedback path. None of them walks backwards, so a seek pre-rolls forward.
function resetAccumulators() {
  counters.resets++;
  clearFeedback(
    [statePrev, stateNext, afterimage._textureComp, afterimage._textureOld, ...mosh.history],
    'afterimage internals moved: the accumulator reset is no longer complete',
  );
  lastProgramTime = 0;
  // Cleared history is black, and a mosh chunk reading it would draw black rather than nothing,
  // so the next frame is a refresh whatever the period says.
  moshFresh = true;
}

// Where an export takes its bytes. One position, since the readback shares the task.
let frameSink = null;

// One image at one program position. Both transports drive exactly this call.
function renderProgramFrame(t) {
  counters.renders++;
  viewportRenders++;
  const now = performance.now();
  if (now - lastViewportFpsAt >= 1000) {
    viewportFps = (viewportRenders * 1000) / (now - lastViewportFpsAt);
    viewportRenders = 0;
    lastViewportFpsAt = now;
  }
  chromeStale = true;
  evaluating = true;
  try {
    // The one place program time becomes source time.
    const frame = pairSource.at(retime.sourceSecAt(t));
    for (const step of frame.steps) {
      step.makeCurrent();
      advanceSurfaceState(step.gapSec);
    }

    uniforms.mixT.value = frame.mixT;
    uniforms.sinceFrameSec.value = frame.sinceFrameSec;
    // The gap the two bound frames are separated by, which turns a depth
    // difference into a speed.
    uniforms.spanSec.value = frame.spanSec;
    uniforms.time.value = t;
    grade.uniforms.time.value = t;
    mosh.uniforms.time.value = t;
    uniforms.rainPhase.value = t;

    // Every track, look and camera alike, through the registry rather than onto the uniforms.
    evaluateTracks(t);

    // Source history stays valid while the camera is still. A changed camera is
    // a new projection.
    if (renderedCameraChanged()) {
      clearAfterimage();
      counters.navigationHistoryClears++;
    }

    // Whether this is the frame the mosh pass draws exactly what it was handed. Asked before
    // `lastProgramTime` moves, because it is a question about the step between two frames: the
    // period in force at each end, and the two ends of the step. The other two answers are
    // states the pass cannot be asked about - a cleared history, and a pass that was switched
    // off while the frames it would have remembered went by.
    const moshPeriod = MOSH_BOUND ? mosh.uniforms[MOSH_BOUND.uniform].value : 0;
    mosh.uniforms.moshIFrame.value = (moshFresh || !moshWasLive
      || moshRefreshes(lastProgramTime, lastMoshPeriod, t, moshPeriod)) ? 1 : 0;
    moshFresh = false;
    moshWasLive = mosh.enabled;
    lastMoshPeriod = moshPeriod;

    const dt = Math.max(0, t - lastProgramTime);
    lastProgramTime = t;

    // The delta goes in explicitly: the composer falls back to its own clock when called bare.
    const timing = statsVisible;
    const timerGl = timing ? renderer.getContext() : null;
    if (timing) gpuTimer.begin(timerGl);
    if (postEnabled()) composer.render(dt);
    else renderer.render(scene, viewCamera);
    if (timing) gpuTimer.end(timerGl);

    if (frameSink !== null && t === frameSink.t) {
      const gl = renderer.getContext();
      gl.readPixels(
        0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
        gl.RGBA, gl.UNSIGNED_BYTE, frameSink.pixels,
      );
      frameSink.hits++;
    }
  } finally {
    evaluating = false;
  }
}

// Navigation's own clock, kept out of the seam.
let lastNavTime = 0;

// Auto-orbit gets the program delta, so the same orbit renders the same at any speed.
function advanceNavigation(t) {
  controls.update(Math.max(0, t - lastNavTime));
  lastNavTime = t;
}

/** How often the live cloud is allowed to be drawn, in hertz. */
let cloudDrawHz = 15;
let lastCloudDrawAt = 0;

function liveLoop() {
  const now = performance.now();
  const t = liveTransport.positionAt(now);
  advanceNavigation(t);
  if (cloudDrawHz > 0 && now - lastCloudDrawAt < 1000 / cloudDrawHz) {
    if (chromeOn) drawChrome();
    if (programOutMode === 'mirror') streamMirrorPose();
    return;
  }
  lastCloudDrawAt = now;
  renderProgramFrame(t);
  if (chromeOn) drawChrome();
  if (programOutMode === 'mirror') streamMirrorPose();
}

// The last pose sent, so a still camera sends nothing at all.
let mirrorSentAt = 0;
let mirrorLastPose = '';
function streamMirrorPose() {
  const now = performance.now();
  if (now - mirrorSentAt < 1000 / 30) return;
  const pose = cameraPose(freeCamera);
  const key = JSON.stringify(pose);
  if (key === mirrorLastPose) return;
  mirrorLastPose = key;
  mirrorSentAt = now;
  sendProgramOut({ view: pose });
}

// How many frames stay decoded: the memory ceiling in the browser, not on the GPU.
const CACHE_FRAMES = 192;
// The most frames one call may ask to have resident at once, kept below the cache.
const MAX_SPAN_FRAMES = CACHE_FRAMES - 16;
// How many frames one range request covers. The response is buffered whole, so it is capped.
const RUN_FRAMES = 32;
// How far ahead playback keeps the cache filled, in output frames.
const PREFETCH_FRAMES = 30;
const KNCT_MAGIC = 0x4b4e4354;
const KNCT_HEADER = 12;

// The walk every source that can address a capture by time performs, written once.
class StampedPairSource {
  /** @param times source seconds from the first frame, ascending. */
  constructor(times) {
    if (times.length < 2) throw new Error(`a pair source needs two frames, got ${times.length}`);
    this.times = times;
    this.applied = -1;
  }

  get count() { return this.times.length; }

  get duration() { return this.times[this.times.length - 1]; }

  /** The frame at or before `sourceSec`, as the lower half of a bracketing pair. */
  bracket(sourceSec) {
    let lo = 0;
    let hi = this.count - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.times[mid] <= sourceSec) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Puts the walk back at frame `i`, so the next `at` emits `i` and `i + 1` as its steps. */
  seekTo(i) {
    this.applied = Math.max(-1, Math.min(this.count - 2, i) - 1);
  }

  rewind() { this.applied = -1; }

  /** One frame's bytes in front of the shader. Where they come from is the subclass. */
  // eslint-disable-next-line no-unused-vars
  makeCurrent(k) {
    throw new Error(`${this.constructor.name} does not say where its frames come from`);
  }

  at(sourceSec) {
    const times = this.times;
    const i = this.bracket(sourceSec);

    if (i + 1 < this.applied) {
      throw new Error(
        `backward seek to ${sourceSec}s without a reset: the accumulators have `
        + `already consumed frame ${this.applied}`,
      );
    }

    const steps = [];
    for (let k = this.applied + 1; k <= i + 1; k++) {
      // Clamped: stamps that are not strictly ascending would age the surface memory backwards.
      const gapSec = k === 0 ? NOMINAL_GAP_MS / 1000 : Math.max(0, times[k] - times[k - 1]);
      steps.push({ gapSec, makeCurrent: () => this.makeCurrent(k) });
    }
    this.applied = i + 1;

    const span = Math.max(1e-6, times[i + 1] - times[i]);
    const offset = Math.min(Math.max(sourceSec - times[i], 0), span);
    return { steps, mixT: offset / span, sinceFrameSec: offset, spanSec: span };
  }
}

class IndexedPairSource extends StampedPairSource {
  static async open(id) {
    const res = await fetch(`/capture/${encodeURIComponent(id)}/index`);
    if (!res.ok) throw new Error(`capture ${id}: ${res.status} ${res.statusText}`);
    return new IndexedPairSource(id, await res.json());
  }

  constructor(id, index) {
    const stamps = index.frames.stampMs;
    if (stamps.length < 2) throw new Error(`capture ${id} has ${stamps.length} frames, need two to bracket`);
    super(stamps.map((s) => (s - stamps[0]) / 1000));
    this.id = id;
    this.index = index;
    this.cache = new Map();
    this.pending = null;
  }

  resident(a, b) {
    for (let k = Math.max(0, a); k <= Math.min(this.count - 1, b); k++) {
      if (!this.cache.has(k)) return false;
    }
    return true;
  }

  /** Puts frames a..b in the cache. Serialised, so a prefetch racing a seek fetches once. */
  ensure(a, b) {
    const run = () => this.fetchSpan(a, b);
    this.pending = (this.pending ?? Promise.resolve()).then(run, run);
    return this.pending;
  }

  async fetchSpan(a, b) {
    const from = Math.max(0, a);
    const to = Math.min(this.count - 1, b);
    if (to - from + 1 > MAX_SPAN_FRAMES) {
      throw new Error(
        `a span of ${to - from + 1} frames does not fit a cache of ${CACHE_FRAMES}: `
        + 'the caller has to clamp it and say what it dropped',
      );
    }
    const runs = [];
    for (let k = from; k <= to; k++) {
      if (this.cache.has(k)) continue;
      const last = runs[runs.length - 1];
      if (last && last[1] === k - 1 && last[1] - last[0] + 1 < RUN_FRAMES) last[1] = k;
      else runs.push([k, k]);
    }
    for (const [lo, hi] of runs) {
      await this.fetchRun(lo, hi);
      this.trim(from, to);
    }
  }

  /** A run in one request where there is a run to have. */
  async fetchRun(lo, hi) {
    counters.requests++;
    const single = lo === hi;
    const url = single
      ? `/capture/${encodeURIComponent(this.id)}/frame/${lo}`
      : `/capture/${encodeURIComponent(this.id)}/frames/${lo}-${hi}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    const buffer = await res.arrayBuffer();

    // A single frame is the payload alone; a run is the file's slice, framing and all.
    const decodes = [];
    if (single) {
      decodes.push(this.take(lo, buffer, 0, buffer.byteLength));
    } else {
      const view = new DataView(buffer);
      let off = 0;
      for (let k = lo; k <= hi; k++) {
        if (off + KNCT_HEADER > buffer.byteLength) {
          throw new Error(`run ${lo}-${hi} ended at frame ${k}: the response was short`);
        }
        const magic = view.getUint32(off, true);
        if (magic !== KNCT_MAGIC) {
          throw new Error(`run ${lo}-${hi} desynced at frame ${k}: magic 0x${magic.toString(16)}`);
        }
        const len = view.getUint32(off + 8, true);
        decodes.push(this.take(k, buffer, off + KNCT_HEADER, len));
        off += KNCT_HEADER + len;
      }
    }
    await Promise.all(decodes);
    counters.framesFetched += decodes.length;
  }

  /** One payload into the cache. The depth block is copied out or it pins the run's buffer. */
  async take(k, buffer, offset, length) {
    const view = new DataView(buffer, offset, length);
    const depthBytes = view.getUint32(0, true);
    const colorBytes = view.getUint32(4, true);
    if (depthBytes !== POINTS * 2) {
      throw new Error(`frame ${k} carries ${depthBytes} depth bytes, expected ${POINTS * 2}`);
    }
    const depth = new Uint16Array(buffer.slice(offset + 16, offset + 16 + depthBytes));
    let bitmap = null;
    if (colorBytes > 0) {
      const jpeg = new Uint8Array(buffer, offset + 16 + depthBytes, colorBytes);
      try {
        bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
      } catch {
        /** a torn JPEG from a dropped USB packet: this frame renders depth only */
      }
    }
    this.cache.set(k, { depth, bitmap });
  }

  /** Drops the oldest frames outside the span asked for, skipping the two bound bitmaps. */
  trim(keepFrom, keepTo) {
    if (this.cache.size <= CACHE_FRAMES) return;
    const bound = [colorPrev.image, colorCurr.image];
    for (const k of this.cache.keys()) {
      if (this.cache.size <= CACHE_FRAMES) break;
      if (k >= keepFrom && k <= keepTo) continue;
      const frame = this.cache.get(k);
      if (frame.bitmap && bound.includes(frame.bitmap)) continue;
      frame.bitmap?.close();
      this.cache.delete(k);
    }
  }

  makeCurrent(k) {
    const frame = this.cache.get(k);
    if (!frame) throw new Error(`frame ${k} is not resident: ensure() was not awaited`);
    bindDepth(frame.depth);
    // Colour arrives at half the depth rate, so a frame without a JPEG leaves the pair alone.
    if (frame.bitmap) bindColor(frame.bitmap);
  }

}

// 1% of the previous image. Three's pass zeroes anything under 0.1 outright.
const AFTERIMAGE_RESIDUAL = 0.01;

// The most output frames one tick may render to catch up.
const CATCHUP_FRAMES = 4;
// How far behind real time playback has to fall before it says so.
const SEEK_REPLANS = 2;
// How many stand-downs in a row before this is a seek that cannot converge.
const SEEK_OVERTAKEN_LIMIT = 12;

class TimelineTransport {
  constructor(source) {
    this.source = source;
    this.outputFps = 30;
    // The playhead is an integer output frame, so playback and a seek walk the same grid.
    this.frame = 0;
    this.playing = false;
    // A play awaiting the seek a draft forces is one the toggle has to be able to cancel.
    this.pendingPlay = false;
    this.playGen = 0;
    this.nextDueMs = 0;
    // Raised by a draft, because a draft is deliberately not the true image.
    this.drafted = false;
    this.prefetching = null;
    this.lastSeek = null;
    this.lastCostMs = 0;
    // How far playback is behind real time, in wall milliseconds. Reported, never skipped.
    this.behindMs = 0;
    this.overtaken = 0;
    this.queue = null;
    this.working = false;
    this.faults = 0;
  }

  get programSec() { return this.frame / this.outputFps; }

  /** Program seconds. The retime answers it, because only the retime knows how. */
  get duration() { return retime.programDurationFor(this.source.duration); }

  get lastFrame() { return Math.max(0, Math.floor(this.duration * this.outputFps)); }

  /** Clip range in program seconds, read from the document. */
  get clipInSec() { return Math.max(0, Number(clipIn) || 0); }
  get clipOutSec() { return clipOut === null ? this.duration : Math.min(this.duration, clipOut); }

  /** Program seconds onto the output grid, bounded by the take and by nothing else. */
  frameOf(programSec) {
    return Math.max(0, Math.min(this.lastFrame, Math.round(programSec * this.outputFps)));
  }

  frameAt(programSec) {
    return this.frameOf(Math.max(this.clipInSec, Math.min(this.clipOutSec, programSec)));
  }

  sourceFrameAt(programSec) {
    return this.source.bracket(retime.sourceSecAt(programSec));
  }

  /** Everything that produces an image runs alone, in the order it was asked for. */
  async exclusive(work) {
    const run = async () => {
      this.working = true;
      try {
        return await work();
      } catch (err) {
        this.faults++;
        throw err;
      } finally {
        this.working = false;
      }
    };
    const mine = (this.queue ?? Promise.resolve()).then(run, run);
    // The chain must never reject, or one failure is inherited by everything behind it.
    this.queue = mine.catch(() => {});
    return mine;
  }

  /** Resolves once nothing this transport started is still running. */
  idle() { return this.queue ?? Promise.resolve(); }

  /** How many output frames have to be rendered and discarded ahead of a seek. */
  preroll(programSec = this.programSec) {
    // Read from the tracks at the target: the uniforms hold whatever the last render left.
    const surfaceSec = (valueAtProgram('fade', programSec)
      + valueAtProgram('wake', programSec)) / 1000;
    const back = retime.framesBackFor(programSec, surfaceSec, this.outputFps, this.lastFrame);
    const back2 = this.trailsFramesBack(programSec);
    const trails = back2.frames;
    const back3 = this.moshFramesBack(programSec);
    const frames = Math.max(back.frames, trails, back3.frames);
    return {
      surface: back.frames,
      surfaceCovered: back.covered,
      trails,
      trailsCovered: back2.covered,
      mosh: back3.frames,
      moshCovered: back3.covered,
      frames,
      sec: frames / this.outputFps,
    };
  }

  /**
   * How many output frames back the mosh pass is decoded from: the nearest frame it refreshes on,
   * which is where its history stops mattering. The walk itself is in `web/mosh-pass.js`, beside
   * the pass whose memory it bounds and where bare node can reach it.
   */
  moshFramesBack(programSec) {
    return moshFramesBack(
      programSec, this.outputFps, moshLiveAt, moshPeriodAt, Math.max(1, this.lastFrame),
    );
  }

  /** How many output frames back the afterimage is rebuilt from for nothing before to show. */
  trailsFramesBack(programSec) {
    if (!(valueAtProgram('trails', programSec) > 0)) return { frames: 0, covered: true };
    const ceiling = Math.max(1, this.lastFrame);
    let product = 1;
    for (let n = 1; n <= ceiling; n++) {
      product *= valueAtProgram('trails', programSec - (n - 1) / this.outputFps);
      if (product <= AFTERIMAGE_RESIDUAL) return { frames: n, covered: true };
    }
    return { frames: ceiling, covered: false };
  }

  /**
   * The true image at a program position: clear both paths, render forward from
   * far enough back.
   */
  seek(programSec, options = {}) {
    return this.exclusive(() => this.seekNow(programSec, options));
  }

  /** An accurate render at wherever the playhead is when this runs, not when it was called. */
  seekHere(options = {}) {
    return this.exclusive(() => this.seekNow(this.programSec, options));
  }

  /** `seekHere` plus the question a seek does not ask: whether anything still needs drawing. */
  repaintHere(askedAtRenders = counters.renders, askedAtFaults = this.faults) {
    return this.exclusive(() => {
      const overtaken = counters.renders !== askedAtRenders && this.faults === askedAtFaults;
      if (overtaken && !this.drafted) return null;
      return this.seekNow(this.programSec);
    });
  }

  /** Which output frames a seek renders and which source frames they need. */
  planSeek(programSec, frames) {
    const target = this.frameAt(programSec);
    const t = target / this.outputFps;
    const plan = this.preroll(t);
    const asked = frames ?? plan.frames;
    let length = asked;
    let start = Math.max(0, target - length);
    const to = this.sourceFrameAt(t) + 1;
    let from = this.sourceFrameAt(start / this.outputFps);

    if (to - from + 1 > MAX_SPAN_FRAMES) {
      from = to - MAX_SPAN_FRAMES + 1;
      start = Math.min(target, Math.ceil(retime.programSecAt(this.source.times[from]) * this.outputFps));
      length = target - start;
    }
    return { target, t, plan, asked, length, start, from, to };
  }

  async seekNow(programSec, options = {}) {
    // Planned, fetched, then planned again: the retime curve can move under the await.
    let planned = this.planSeek(programSec, options.frames);
    for (let attempt = 0; !this.source.resident(planned.from, planned.to); attempt++) {
      if (attempt >= SEEK_REPLANS) {
        // Overtaken, not broken: the hand that moved the curve has already queued a repaint.
        this.overtaken++;
        if (this.overtaken > SEEK_OVERTAKEN_LIMIT) {
          this.overtaken = 0;
          throw new Error(
            `${SEEK_OVERTAKEN_LIMIT} seeks in a row were overtaken before they could land: `
            + 'the span a seek plans is not becoming resident, which is not a moving curve',
          );
        }
        requestRepaint();
        return null;
      }
      await this.source.ensure(planned.from, planned.to);
      planned = this.planSeek(programSec, options.frames);
    }
    const { target, t, plan, asked, from, to } = planned;
    const { length, start } = planned;

    const began = performance.now();
    counters.seeks++;
    resetAccumulators();
    this.source.seekTo(from);
    advanceNavigation(t);
    for (let k = start; k <= target; k++) renderProgramFrame(k / this.outputFps);

    this.lastCostMs = performance.now() - began;
    this.overtaken = 0;
    this.frame = target;
    this.drafted = false;
    this.lastSeek = {
      target, start, frames: length, plan,
      clamped: asked > target,
      capped: length < Math.min(asked, target),
      shortfall: Math.min(asked, target) - length,
      sourceFrames: to - from + 1,
    };
    this.paint();
    return this.lastSeek;
  }

  /** One frame with the accumulators bypassed, for the length of a drag. */
  draft(programSec) {
    return this.exclusive(() => this.draftNow(programSec));
  }

  async draftNow(programSec) {
    let target = this.frameAt(programSec);
    let t = target / this.outputFps;
    let i = this.sourceFrameAt(t);
    for (let attempt = 0; !this.source.resident(i, i + 1); attempt++) {
      if (attempt >= SEEK_REPLANS) {
        throw new Error(`the retime curve moved under ${SEEK_REPLANS} plans of a draft at ${programSec}s`);
      }
      await this.source.ensure(i, i + 1);
      target = this.frameAt(programSec);
      t = target / this.outputFps;
      i = this.sourceFrameAt(t);
    }

    const began = performance.now();
    // Borrow, render and hand back, asking for no repaint: these writes are the transport's.
    withoutRepaint(() => {
      const held = params.values(BYPASSED);
      params.apply(BYPASS_ZERO);
      borrowed = BYPASSED_SET;
      try {
        // The reset is what lets a drag go backwards.
        if (target !== this.frame || this.source.applied !== i + 1) {
          resetAccumulators();
          this.source.seekTo(i);
        }
        advanceNavigation(t);
        renderProgramFrame(t);
        drawChrome();
      } finally {
        borrowed = null;
        params.apply(held);
      }
    });

    this.lastCostMs = performance.now() - began;
    counters.drafts++;
    this.frame = target;
    this.drafted = true;
    this.paint();
    return this.lastCostMs;
  }

  /** Rebuilds the parked viewport after navigation, without the scrub draft's look. */
  redrawHere() {
    return this.exclusive(() => this.redrawNow(this.programSec));
  }

  async redrawNow(programSec) {
    counters.navigationRedraws++;
    const target = this.frameAt(programSec);
    const t = target / this.outputFps;
    const source = this.sourceFrameAt(t);
    if (this.drafted || valueAtProgram('trails', t) > 0 || moshLiveAt(t)
        || target !== this.frame || this.source.applied !== source + 1) {
      return this.seekNow(t);
    }

    const began = performance.now();
    advanceNavigation(t);
    renderProgramFrame(t);
    this.lastCostMs = performance.now() - began;
    this.frame = target;
    this.drafted = false;
    this.paint();
    return this.lastCostMs;
  }

  /** One output frame forward, or false if there is nothing to advance to. */
  step() {
    const next = this.frame + 1;
    if (next > this.lastFrame) return false;
    const t = next / this.outputFps;
    if (t > this.clipOutSec + 1e-9) return false;
    const want = this.sourceFrameAt(t) + 1;
    // A span that runs backwards is unwalkable, and the residency test cannot tell.
    if (want < this.source.applied) {
      throw new Error(
        `playback at ${t.toFixed(3)}s wants source frame ${want} while the accumulators have `
        + `consumed ${this.source.applied}: the retime curve runs backwards here`,
      );
    }
    if (!this.source.resident(this.source.applied + 1, want)) return false;
    advanceNavigation(t);
    renderProgramFrame(t);
    this.frame = next;
    return true;
  }

  /** One turn of the animation loop, and the only place in this file that catches broadly. */
  tick(nowMs = performance.now()) {
    try {
      this.tickNow(nowMs);
    } catch (err) {
      this.playing = false;
      this.paint();
      showTimelineError(err);
    }
  }

  tickNow(nowMs) {
    if (!this.playing) return;
    if (this.working) {
      this.prefetch();
      return;
    }
    // Every frame that has come due is rendered, up to a cap. Only the last reaches the screen.
    let rendered = 0;
    while (nowMs >= this.nextDueMs && rendered < CATCHUP_FRAMES) {
      if (!this.step()) break;
      this.nextDueMs += 1000 / this.outputFps;
      rendered++;
    }
    if (rendered > 0) this.paint();
    else if (this.frame >= this.lastFrame || this.programSec >= this.clipOutSec - 1e-9) this.pause();
    this.behindMs = Math.max(0, nowMs - this.nextDueMs);
    this.prefetch();
  }

  /** The fetch in flight, or null when the window ahead is already resident. */
  prefetch() {
    if (this.prefetching) return this.prefetching;
    const ahead = Math.min(
      this.sourceFrameAt((this.frame + PREFETCH_FRAMES) / this.outputFps) + 1,
      this.source.applied + MAX_SPAN_FRAMES - 1,
    );
    if (this.source.resident(this.source.applied, ahead)) return null;
    const fetching = this.source.ensure(this.source.applied, ahead)
      .catch((err) => showTimelineError(err))
      .finally(() => { if (this.prefetching === fetching) this.prefetching = null; });
    this.prefetching = fetching;
    return fetching;
  }

  /** Playback with the wall clock out: every output frame in order, as fast as bytes arrive. */
  runTo(toFrame) {
    return this.exclusive(() => this.runToNow(toFrame));
  }

  async runToNow(toFrame) {
    const limit = Math.min(toFrame, this.lastFrame);
    let stalls = 0;
    while (this.frame < limit) {
      if (this.step()) {
        stalls = 0;
        continue;
      }
      if (++stalls > 200) throw new Error(`playback stalled at output frame ${this.frame}`);
      await (this.prefetch() ?? new Promise((r) => setTimeout(r, 0)));
    }
    this.paint();
    return this.frame;
  }

  async play() {
    if (this.playing || this.pendingPlay) return;
    this.behindMs = 0;
    const gen = this.playGen;
    this.pendingPlay = true;
    try {
      // A draft is not what playback would have produced, so it cannot seed the afterimage.
      if (this.drafted) await this.seek(this.programSec);
      // Keep playback inside the clip's in/out points.
      if (this.programSec < this.clipInSec || this.programSec > this.clipOutSec) {
        await this.seek(this.clipInSec);
      }
    } finally {
      this.pendingPlay = false;
    }
    if (gen !== this.playGen) {
      this.paint();
      return;
    }
    this.playing = true;
    this.nextDueMs = performance.now();
    this.paint();
  }

  pause() {
    this.playGen += 1;
    this.playing = false;
    this.paint();
  }

  paint() { paintTimeline(this); }
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  // Marked handled, so a failure nobody awaits yet surfaces at the next await.
  promise.catch(() => {});
  return { promise, resolve, reject };
};

/** The wire and its flow control. Raw RGBA out, and the server acks each frame. */
class ExportSink {
  constructor(begin) {
    this.ready = deferred();
    this.done = deferred();
    this.window = 1;
    this.sent = 0;
    this.acked = 0;
    this.waiting = null;
    this.failure = null;
    this.finished = false;
    const socket = new WebSocket(`ws://${location.host}/export`);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(JSON.stringify({ begin }));
    socket.onmessage = (event) => this.receive(JSON.parse(event.data));
    socket.onerror = () => this.fail(new Error('the export socket failed'));
    socket.onclose = () => this.fail(new Error('the export socket closed before the encode finished'));
    this.socket = socket;
  }

  receive(msg) {
    if (msg.error) {
      this.fail(new Error(msg.error));
    } else if (msg.ready) {
      this.window = msg.ready.window;
      this.ready.resolve(msg.ready);
    } else if (msg.ack) {
      this.acked = msg.ack;
      const waiter = this.waiting;
      this.waiting = null;
      waiter?.resolve();
    } else if (msg.done) {
      this.finished = true;
      this.done.resolve(msg.done);
    }
  }

  fail(err) {
    if (this.failure || this.finished) return;
    this.failure = err;
    this.ready.reject(err);
    this.done.reject(err);
    this.waiting?.reject(err);
    this.socket.close();
  }

  /** Hands one frame to the wire and returns once the pipe has room for the next. */
  async send(pixels) {
    if (this.failure) throw this.failure;
    // `send` queues a copy, which lets the readback reuse one buffer for the whole export.
    this.socket.send(pixels);
    this.sent++;
    while (!this.failure && this.sent - this.acked >= this.window) {
      this.waiting = deferred();
      await this.waiting.promise;
    }
  }

  async finish() {
    if (this.failure) throw this.failure;
    this.socket.send(JSON.stringify({ end: true }));
    return this.done.promise;
  }
}

class ExportTransport {
  constructor(transport, options) {
    this.transport = transport;
    this.width = options.width;
    this.height = options.height;
    this.fps = options.fps;
    this.from = options.from;
    this.to = options.to;
    this.onProgress = options.onProgress ?? (() => {});
    // One buffer for the run. `readPixels` stalls the pipeline, which is accepted at export.
    this.pixels = new Uint8Array(options.width * options.height * 4);
  }

  /** Every frame in order, each read back in the same task as the render that made it. */
  async run(sink) {
    for (let n = this.from; n <= this.to; n++) {
      const at = n / this.fps;
      frameSink = { t: at, pixels: this.pixels, hits: 0 };
      let hits = 0;
      try {
        if (n === this.from) await this.transport.seek(at);
        else await this.transport.runTo(n);
      } finally {
        hits = frameSink.hits;
        frameSink = null;
      }
      if (hits !== 1) {
        throw new Error(`the render at ${at.toFixed(6)}s reached the export ${hits} times, not once`);
      }
      await sink.send(this.pixels);
      this.onProgress(n - this.from + 1, this.to - this.from + 1);
    }
    return this.to - this.from + 1;
  }
}

// Whether an export owns the renderer. Nothing else may draw while one does.
let exporting = false;

const rendererClass = () => {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
};

/** A `WIDTHxHEIGHT` string as a pair, with 0 for whichever half is not a size. */
function parseSize(text) {
  const [w, h] = String(text).split('x').map(Number);
  return { w: w > 0 ? w : 0, h: h > 0 ? h : 0 };
}

async function exportClip(options = {}) {
  if (!timeline) throw new Error('there is no clip open to export');
  if (exporting) throw new Error('an export is already running');
  // A clip whose look this build cannot render whole is refused before anything is encoded.
  const suppress = new Set(options.suppressEffects ?? []);
  const missing = missingEffects();
  const blocking = missing.filter((m) => !suppress.has(m.id));
  if (blocking.length) {
    throw new Error(
      `this clip requires ${blocking.map((m) => `${m.id} ${m.version}`).join(', ')}, which `
      + `${blocking.length === 1 ? 'is' : 'are'} not installed here: its values are parked and `
      + 'nothing is drawing them, so a render would be a file missing part of the look with '
      + `nothing in it to say so. Install ${blocking.length === 1 ? 'it' : 'them'}, or suppress `
      + `${blocking.length === 1 ? 'it' : 'each of them'} in the badge to render without.`,
    );
  }
  const suppressed = missing
    .filter((m) => suppress.has(m.id))
    .map(({ id, version }) => ({ id, version }));
  ensureActiveDeliverable();
  const d = activeDeliverable;
  const requested = options.outputSize ?? d.outputSize;
  const deliverableSize = parseSize(requested);
  const width = Math.trunc(options.width ?? deliverableSize.w);
  const height = Math.trunc(options.height ?? deliverableSize.h);
  const effective = reduceAspect(width, height);
  if (!sameAspect(effective, projectAspect)) {
    const asked = options.width === undefined && options.height === undefined
      ? `the deliverable renders ${requested}`
      : `this render was asked for at ${width}x${height}`;
    throw new Error(
      `this clip is framed at ${projectAspect.join(':')} and ${asked}, which is `
      + `${effective.join(':')}: pick a resolution of the project's shape in Export, or change `
      + 'the shape in Project settings',
    );
  }
  const fps = options.fps ?? timeline.outputFps;
  const codec = options.codec ?? d.codec ?? 'h264';

  const restore = {
    outputFps: timeline.outputFps,
    programSec: timeline.programSec,
    chrome: chromeOn,
    camera: viewCamera,
  };

  exporting = true;
  pauseTransport();
  try {
    // The rate first, because every position below is named on the output rate's grid.
    timeline.outputFps = fps;
    const inSec = options.in !== undefined ? options.in : d.in;
    const outSec = options.out !== undefined ? options.out : d.out;
    const inFrame = timeline.frameAt(Number(inSec) || 0);
    const outFrame = timeline.frameAt(outSec === null ? timeline.duration : outSec);
    const from = Math.max(inFrame, Math.min(outFrame, Math.trunc(options.from ?? inFrame)));
    const to = Math.max(inFrame, Math.min(outFrame, Math.trunc(options.to ?? outFrame)));
    if (to < from) throw new Error(`an export of frames ${from}..${to} has nothing in it`);

    // Composition comes from the camera track, so the export sees what the program camera does.
    setViewCamera(programCamera);
    chromeOn = false;
    placeChrome();
    outputSize = { w: width, h: height };
    resize();

    const gl = renderer.getContext();
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
      throw new Error(
        `the drawing buffer is ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} after asking for `
        + `${width}x${height}: the output size did not reach the renderer`,
      );
    }

    const run = new ExportTransport(timeline, {
      width, height, fps, from, to, onProgress: options.onProgress,
    });
    const sink = new ExportSink({
      name: options.name ?? exportBaseName(),
      width,
      height,
      fps,
      frames: to - from + 1,
      codec,
      project: serialiseProjectBody(suppressed.length ? { suppressed } : {}),
      capture: timeline.source.index.hash,
      renderer: rendererClass(),
    });
    await sink.ready.promise;
    await run.run(sink);
    return await sink.finish();
  } finally {
    exporting = false;
    outputSize = null;
    resize();
    chromeOn = restore.chrome;
    placeChrome();
    setViewCamera(restore.camera);
    timeline.outputFps = restore.outputFps;
    timeline.frame = timeline.frameAt(restore.programSec);
    timingChanged();
    requestRepaint();
  }
}

// Deliberately small: the scrubber, the playhead, play/pause, speed, and the two clocks.
const ui = {
  root: timelineEl,
  play: document.getElementById('tPlay'),
  program: document.getElementById('tProgram'),
  source: document.getElementById('tSource'),
  rate: document.getElementById('tRate'),
  rateOut: document.getElementById('tRateOut'),
  rateKey: document.getElementById('tRateKey'),
  fps: document.getElementById('tFps'),
  bed: document.getElementById('tBed'),
  rail: document.getElementById('tRail'),
  beds: document.getElementById('tBeds'),
  // The two containers the lane rebuild owns and empties.
  railLanes: document.getElementById('tRailLanes'),
  lanes: document.getElementById('tLanes'),
  ruler: document.getElementById('tRuler'),
  grip: document.getElementById('tGrip'),
  mini: document.getElementById('tMini'),
  miniRange: document.getElementById('tMiniRange'),
  miniMarks: document.getElementById('tMiniMarks'),
  miniHead: document.getElementById('tMiniHead'),
  miniWin: document.getElementById('tMiniWin'),
  playhead: document.getElementById('tPlayhead'),
  in: document.getElementById('tIn'),
  out: document.getElementById('tOut'),
  shadeIn: document.getElementById('tShadeIn'),
  shadeOut: document.getElementById('tShadeOut'),
  note: document.getElementById('tNote'),
  camKey: document.getElementById('camKey'),
  camClear: document.getElementById('camClear'),
  camView: document.getElementById('camView'),
  tCamKey: document.getElementById('tCamKey'),
  tCamView: document.getElementById('tCamView'),
  camSensor: document.getElementById('camSensor'),
  camLevelReset: document.getElementById('camLevelReset'),
  cropBox: document.getElementById('cropBox'),
  cropFit: document.getElementById('cropFit'),
  cropReset: document.getElementById('cropReset'),
  // Empty in the markup and filled by `setProjectAspect`, which knows this project's sizes.
  exportSize: document.getElementById('tExportSize'),
  projectAspects: document.getElementById('projectAspects'),
  exportFormats: document.getElementById('exportFormats'),
  exportDialog: document.getElementById('exportDialog'),
  exportGo: document.getElementById('tExport'),
  exportNote: document.getElementById('tExportNote'),
  exportName: document.getElementById('tExportName'),
  exportNameChip: document.getElementById('tExportNameChip'),
  exportSave: document.getElementById('tExportSave'),
  exportTrim: document.getElementById('tExportTrim'),
  ease: document.getElementById('tEase'),
  prevKey: document.getElementById('tPrevKey'),
  nextKey: document.getElementById('tNextKey'),
  deleteKey: document.getElementById('tDeleteKey'),
  addPoint: document.getElementById('tAddPoint'),
  dropPoint: document.getElementById('tDropPoint'),
  deliverable: document.getElementById('tDeliverable'),
  deliverableNew: document.getElementById('tDeliverableNew'),
  deliverableReadout: document.getElementById('tDeliverableReadout'),
  marks: document.getElementById('tMarks'),
  markCount: document.getElementById('tMarkCount'),
  mark: document.getElementById('tMark'),
  preset: document.getElementById('tPreset'),
  presetSave: document.getElementById('tPresetSave'),
  presetExport: document.getElementById('tPresetExport'),
  presetImport: document.getElementById('tPresetImport'),
  presetFile: document.getElementById('tPresetFile'),
  pickDialog: document.getElementById('presetPick'),
  pickTitle: document.getElementById('ppTitle'),
  pickName: document.getElementById('ppName'),
  pickGroups: document.getElementById('ppGroups'),
  pickCount: document.getElementById('ppCount'),
  pickCancel: document.getElementById('ppCancel'),
  pickGo: document.getElementById('ppGo'),
  resume: document.getElementById('tResume'),
  resumeWhen: document.getElementById('tResumeWhen'),
  resumeOpen: document.getElementById('tResumeOpen'),
  missing: document.getElementById('tMissing'),
  recGo: document.getElementById('recGo'),
  recMark: document.getElementById('recMark'),
  recNote: document.getElementById('recNote'),
  recSpace: document.getElementById('recSpace'),
  recRange: document.getElementById('recRange'),
};

// Built from `OUTPUT_RATES` rather than the markup, so there is one list of rates.
for (const rate of OUTPUT_RATES) ui.fps?.appendChild(new Option(String(rate), String(rate)));

/** The badge that says which effects this document names and this build has not got. */
function paintMissingEffects() {
  if (!ui.missing) return;
  const missing = missingEffects();
  const skew = effectVersionSkew;
  ui.missing.hidden = missing.length === 0 && skew.length === 0;
  const notices = skew.map((s) => {
    const entry = document.createElement('span');
    entry.className = 'missingfx';
    entry.dataset.skew = s.id;
    const line = document.createElement('b');
    line.textContent = `document requires ${s.id} ${s.wanted}, installed is ${s.installed}`;
    entry.append(line);
    return entry;
  });
  ui.missing.replaceChildren(...notices, ...missing.map((m) => {
    const entry = document.createElement('span');
    entry.className = 'missingfx';
    entry.dataset.effect = m.id;
    const line = document.createElement('b');
    const values = `${m.values} value${m.values === 1 ? '' : 's'}`;
    const parked = `${m.tracks} track${m.tracks === 1 ? '' : 's'} parked`;
    line.textContent = `missing: ${m.id} ${m.version} — ${values}, ${parked}`;
    const go = document.createElement('button');
    go.type = 'button';
    go.dataset.suppress = m.id;
    go.textContent = 'suppress';
    go.setAttribute('aria-pressed', String(m.suppressed));
    go.title = m.suppressed
      ? `Exports may render without ${m.id}. Press again to require it.`
      : `Export is refused while ${m.id} is missing. Press to let a render go without it.`;
    entry.append(line, go);
    return entry;
  }));
}

// One listener on the chip, because the painter rebuilds the buttons every time this fires.
ui.missing?.addEventListener('click', (event) => {
  const id = event.target?.dataset?.suppress;
  if (!id) return;
  if (suppressedEffects.has(id)) suppressedEffects.delete(id);
  else suppressedEffects.add(id);
  paintMissingEffects();
  say(suppressedEffects.has(id)
    ? `${id} suppressed: an export will render without it`
    : `${id} required again: an export is refused while it is missing`);
});

aspectButtons = buildAspectSegments(ui.projectAspects);

/** The codec keys are the server's: `CODECS` in `server/export.js` is where one is declared. */
const EXPORT_CODECS = ['h264', 'prores', 'pngseq'];

function paintExportFormats() {
  const codec = activeDeliverable?.codec ?? 'h264';
  for (const button of ui.exportFormats.querySelectorAll('button[data-codec]')) {
    button.setAttribute('aria-pressed', String(button.dataset.codec === codec));
  }
}

function setExportCodec(codec) {
  // Refused here rather than trusted, because the value comes off an attribute in the markup.
  if (!EXPORT_CODECS.includes(codec)) {
    throw new Error(`unknown export codec ${JSON.stringify(codec)}: the dialog offers ${EXPORT_CODECS.join(', ')}`);
  }
  ensureActiveDeliverable();
  activeDeliverable.codec = codec;
  paintDeliverable();
  paintExportFormats();
}

for (const button of ui.exportFormats.querySelectorAll('button[data-codec]')) {
  button.addEventListener('click', () => setExportCodec(button.dataset.codec));
}

// The chips strip hides its scrollbar, so the bar keeps its height and the lanes hold still.
for (const chips of document.querySelectorAll('.tchips')) {
  const sayMore = () => chips.classList.toggle('more', chips.scrollWidth > chips.clientWidth + 1);
  new ResizeObserver(sayMore).observe(chips);
  new MutationObserver(sayMore).observe(chips, { subtree: true, childList: true, characterData: true });
  sayMore();
}

const sayExport = (text) => {
  ui.exportNote.textContent = text;
  ui.exportNote.title = text;
};

/** The editor's one line of prose, and the only way anything writes it. */
function say(text) {
  if (!ui.note) return;
  ui.note.textContent = text;
  ui.note.title = text;
}

const timecode = (sec) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};

function showTimelineError(err) {
  say(String(err?.message ?? err));
  console.error('[timeline]', err);
}

// The window of program time the strip is drawn against.
const view = makeViewWindow({
  durationSec: () => (laneDrag ? laneDrag.duration : (timeline ? timeline.duration : 1)),
  bedRect: () => ui.bed.getBoundingClientRect(),
});

/** What the chosen deliverable is, and what the press will take out of the clip. */
function paintDeliverable() {
  if (!ui.deliverableReadout) return;
  if (!activeDeliverable) {
    ui.deliverableReadout.textContent = 'none';
    if (ui.exportTrim) ui.exportTrim.textContent = '—';
    return;
  }
  const out = activeDeliverable.out ?? view.duration;
  const outStr = activeDeliverable.out === null ? 'end' : timecode(out);
  ui.deliverableReadout.textContent = `${activeDeliverable.outputSize} ${activeDeliverable.codec}`;
  if (ui.exportTrim) {
    ui.exportTrim.textContent = `${timecode(activeDeliverable.in)} - ${outStr} · `
      + `${Math.max(0, out - activeDeliverable.in).toFixed(2)}s at ${timeline ? timeline.outputFps : 30}fps`;
  }
}

/** Where on the ruler things are: the playhead, the two cuts, and the shading outside them. */
function paintStripPositions() {
  const dur = view.duration;
  const inPct = view.pct(Math.min(clipIn, dur));
  const outPct = view.pct(Math.min(clipOut ?? dur, dur));
  ui.playhead.style.left = `${view.pct(timeline ? timeline.programSec : 0)}%`;
  ui.in.style.left = `${inPct}%`;
  ui.out.style.left = `${outPct}%`;
  const lo = Math.max(0, Math.min(100, inPct));
  const hi = Math.max(0, Math.min(100, outPct));
  ui.shadeIn.style.left = '0%';
  ui.shadeIn.style.width = `${lo}%`;
  ui.shadeOut.style.left = `${hi}%`;
  ui.shadeOut.style.width = `${Math.max(0, 100 - hi)}%`;
  paintMinimap();
}

function paintTimeline(t) {
  const program = t.programSec;
  ui.play.textContent = t.playing ? '❙❙' : '▶';
  ui.play.setAttribute('aria-label', t.playing ? 'Pause' : 'Play');
  ui.program.textContent = timecode(program);
  ui.source.textContent = timecode(retime.sourceSecAt(program));
  if (!ui.exportName.placeholder) ui.exportName.placeholder = t.source.id;
  paintStripPositions();
  paintDeliverable();
  paintLanes();
  drawChrome();
}

/** The ruler, drawn across the visible window rather than across the clip. */
function buildRuler() {
  const span = Math.max(1e-6, view.spanSec);
  const width = Math.max(1, ui.bed.clientWidth);
  const wanted = span / Math.max(2, width / 90);
  const step = TICK_STEPS.find((s) => s >= wanted) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks = [];
  // Only the ticks the window holds are built, so window width sets the cost, not take length.
  const first = Math.ceil(view.startSec / step - 1e-9) * step;
  for (let s = first; s <= view.endSec + 1e-9; s += step) {
    const tick = document.createElement('div');
    tick.className = 'ttick';
    tick.style.left = `${view.pct(s)}%`;
    const label = document.createElement('label');
    label.textContent = tickLabel(s, step);
    tick.appendChild(label);
    ticks.push(tick);
  }
  ui.ruler.replaceChildren(...ticks);
}

// The overview strip: the whole clip with the visible window on it, in whole-clip coordinates
// rather than through `view.pct`, because it exists to say where the window is.
function paintMinimap() {
  if (!ui.mini) return;
  const dur = view.duration;
  const pct = (t) => `${Math.max(0, Math.min(100, (t / dur) * 100))}%`;
  // `left` stays the plain percentage, and the clamp that keeps the box in the track rides
  // on `margin-left`.
  const leftPct = view.a * 100;
  ui.miniWin.style.left = `${leftPct}%`;
  ui.miniWin.style.marginLeft = `min(0px, calc(100% - ${leftPct}% - var(--tminiwin-min)))`;
  ui.miniWin.style.width = `${(view.b - view.a) * 100}%`;
  ui.miniHead.style.left = pct(timeline ? timeline.programSec : 0);
  const from = Math.min(clipIn, dur);
  const to = Math.min(clipOut ?? dur, dur);
  ui.miniRange.style.left = pct(from);
  ui.miniRange.style.width = `${Math.max(0, ((to - from) / dur) * 100)}%`;
}

/** The window moved. Everything drawn against it is redrawn and nothing else is. */
function viewChanged() {
  if (!timeline) return;
  buildRuler();
  paintMarks();
  paintStripPositions();
  lanesMoved();
}

// A drag resolves at whatever rate drafts come back, never queuing more than one.
let draftWanted = null;
let draftBusy = false;

async function pumpDraft() {
  if (draftBusy || draftWanted === null || !timeline || exporting) return;
  draftBusy = true;
  const t = draftWanted;
  draftWanted = null;
  try {
    await timeline.draft(t);
  } catch (err) {
    showTimelineError(err);
  } finally {
    draftBusy = false;
  }
}

// A look change at a parked playhead has to rebuild the image, and rebuild it accurately.
let repaintWanted = false;
let repaintBusy = false;
let repaintScheduled = false;
let repaintAskedAt = 0;
let repaintAskedAtFaults = 0;

async function pumpRepaint() {
  if (repaintBusy || !repaintWanted || !timeline) return;
  repaintBusy = true;
  repaintWanted = false;
  const askedAt = repaintAskedAt;
  const askedAtFaults = repaintAskedAtFaults;
  try {
    await timeline.repaintHere(askedAt, askedAtFaults);
  } catch (err) {
    showTimelineError(err);
  } finally {
    repaintBusy = false;
    if (repaintWanted) pumpRepaint();
  }
}

/** Rebuilds the image and the readouts at wherever the playhead is parked. */
function requestRepaint() {
  if (!timeline || timeline.playing || scrubbing || orbiting || exporting) return;
  repaintWanted = true;
  repaintAskedAt = counters.renders;
  repaintAskedAtFaults = timeline.faults;
  if (repaintScheduled) return;
  repaintScheduled = true;
  // Deferred to the end of the task, so a bulk write asks for one image rather than many.
  queueMicrotask(() => {
    repaintScheduled = false;
    pumpRepaint();
  });
}

paramWritten = (name, tag) => {
  // Every parameter write reaches the program-out source through here.
  sendProgramOut({ params: { [name]: params.get(name) } });
  if (tag === 'view' || transportWriting) return;
  requestRepaint();
};

const programAtPointer = (e) => view.timeAt(e.clientX);

let scrubbing = false;

ui.bed.addEventListener('pointerdown', (e) => {
  if (!timeline) return;
  if (selectedMark) { selectedMark = null; paintMarks(); }
  ui.bed.setPointerCapture(e.pointerId);
  scrubbing = true;
  pauseTransport();
  draftWanted = programAtPointer(e);
  pumpDraft();
});

ui.bed.addEventListener('pointermove', (e) => {
  if (!scrubbing) return;
  draftWanted = programAtPointer(e);
  pumpDraft();
});

for (const type of ['pointerup', 'pointercancel']) {
  ui.bed.addEventListener(type, (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    // The queued position goes first, which is the fix for the gesture this transport is for.
    draftWanted = null;
    // Releasing asks for the true image, so this is the one gesture that pays for a pre-roll.
    timeline.seek(programAtPointer(e)).catch(showTimelineError);
  });
}

// The least of the window the stage keeps.
const MIN_STAGE_SHARE = 0.35;
// Where the splitter sits before anybody drags it: as tall as the lanes need, up to this.
const DEFAULT_LANES_SHARE = 0.35;
// Client state: how tall you like the strip belongs to this browser, not to the clip.
const LANES_HEIGHT = 'kinect.lanesHeight';

let laneStackHeight = 0;
let userLaneHeight = null;
try {
  // Asked of the string: `getItem` answers null when nothing was stored, and
  // `Number(null)` is 0.
  const saved = localStorage.getItem(LANES_HEIGHT);
  const px = Number(saved);
  if (saved !== null && saved.trim() !== '' && Number.isFinite(px) && px >= 0) userLaneHeight = px;
} catch {
  // Private browsing or storage disabled by policy. The default is a good height.
}

/** The tallest the lanes may be here, so the stage keeps its share of the window. */
function laneHeightCeiling() {
  // `--timeline-h` is the strip's fixed part, read off the element rather than repeated here.
  const fixed = parseFloat(getComputedStyle(ui.root).getPropertyValue('--timeline-h')) || 0;
  return Math.max(0, Math.round(innerHeight * (1 - MIN_STAGE_SHARE)) - fixed);
}

/** `--tlanes-h`, from the two things that decide it, in the one place that writes it. */
function applyLaneHeight() {
  const wanted = userLaneHeight ?? Math.round(innerHeight * DEFAULT_LANES_SHARE);
  const reachable = Math.min(laneStackHeight, laneHeightCeiling());
  const height = Math.min(laneStackHeight, Math.max(0, Math.min(wanted, laneHeightCeiling())));
  ui.root.style.setProperty('--tlanes-h', `${height}px`);
  ui.grip.setAttribute('aria-valuenow', String(height));
  ui.grip.setAttribute('aria-valuemax', String(Math.max(0, reachable)));
}

ui.lanes.addEventListener('scroll', () => {
  ui.railLanes.scrollTop = ui.lanes.scrollTop;
});

/** The splitter. `resize()` is throttled to an animation frame, not run per pointer event. */
let gripDrag = null;
let gripFrame = 0;

ui.grip.addEventListener('pointerdown', (e) => {
  ui.grip.setPointerCapture(e.pointerId);
  ui.grip.classList.add('dragging');
  gripDrag = {
    y: e.clientY,
    from: parseFloat(getComputedStyle(ui.root).getPropertyValue('--tlanes-h')) || 0,
  };
});

ui.grip.addEventListener('pointermove', (e) => {
  if (!gripDrag) return;
  // Upwards is taller, which is the direction the edge is being dragged.
  userLaneHeight = Math.max(0, gripDrag.from + (gripDrag.y - e.clientY));
  applyLaneHeight();
  if (gripFrame) return;
  gripFrame = requestAnimationFrame(() => {
    gripFrame = 0;
    resize();
    placeChrome();
  });
});

/** The same splitter from the keyboard. A step is a lane row rather than a pixel. */
const LANE_KEY_STEP = 22;

ui.grip.addEventListener('keydown', (e) => {
  const from = parseFloat(getComputedStyle(ui.root).getPropertyValue('--tlanes-h')) || 0;
  const ceiling = Math.min(laneStackHeight, laneHeightCeiling());
  const to = e.key === 'ArrowUp' ? from + LANE_KEY_STEP
    : e.key === 'ArrowDown' ? from - LANE_KEY_STEP
      : e.key === 'PageUp' ? from + LANE_KEY_STEP * 4
        : e.key === 'PageDown' ? from - LANE_KEY_STEP * 4
          : e.key === 'Home' ? 0
            : e.key === 'End' ? Math.max(0, ceiling)
              : null;
  if (to === null) return;
  e.preventDefault();
  userLaneHeight = Math.max(0, to);
  applyLaneHeight();
  resize();
  placeChrome();
  rememberLaneHeight();
});

/** Where the splitter has been put, kept for this browser rather than for the clip. */
function rememberLaneHeight() {
  try {
    localStorage.setItem(LANES_HEIGHT, String(userLaneHeight));
  } catch {
    // Storage is a convenience here, and the gesture already worked.
  }
}

for (const type of ['pointerup', 'pointercancel']) {
  ui.grip.addEventListener(type, () => {
    if (!gripDrag) return;
    gripDrag = null;
    ui.grip.classList.remove('dragging');
    if (gripFrame) cancelAnimationFrame(gripFrame);
    gripFrame = 0;
    resize();
    placeChrome();
    rememberLaneHeight();
  });
}

/**
 * Where the pointer is as a fraction of the clip, which is what zoom and pan are expressed in.
 */
function clipFractionAt(surface, clientX) {
  const r = (surface === ui.mini ? ui.mini : ui.bed).getBoundingClientRect();
  const f = r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0.5;
  return surface === ui.mini ? f : view.a + f * (view.b - view.a);
}

/** A wheel event's two deltas in pixels, whatever unit the browser chose to report. */
const wheelPixels = (e) => {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return { x: e.deltaX * LANE_KEY_STEP, y: e.deltaY * LANE_KEY_STEP };
  }
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return {
      x: e.deltaX * Math.max(1, globalThis.innerWidth),
      y: e.deltaY * Math.max(1, globalThis.innerHeight),
    };
  }
  return { x: e.deltaX, y: e.deltaY };
};

const onStripWheel = (surface) => (e) => {
  if (!timeline) return;
  const delta = wheelPixels(e);
  // A wheel that started in the lane scroller, on its axis, belongs to it and not the zoom.
  if (Math.abs(delta.y) >= Math.abs(delta.x)
    && ui.lanes.contains(e.target)
    && ui.lanes.scrollHeight > ui.lanes.clientHeight) return;
  e.preventDefault();
  // A trackpad reports both axes and a mouse one, so the dominant axis picks the gesture.
  if (Math.abs(delta.x) > Math.abs(delta.y)) {
    const width = Math.max(1, (surface === ui.mini ? ui.mini : ui.bed).clientWidth);
    const d = (delta.x / width) * (surface === ui.mini ? 1 : view.b - view.a);
    if (!view.set(view.a + d, view.b + d)) return;
  } else {
    const factor = ZOOM_PER_NOTCH ** (-delta.y / 100);
    if (!view.zoomAbout(clipFractionAt(surface, e.clientX), factor)) return;
  }
  viewChanged();
};

for (const surface of [ui.beds, ui.mini]) {
  surface.addEventListener('wheel', onStripWheel(surface), { passive: false });
}

/** The overview's gestures: drag to pan, drag an edge to zoom, click to bring the window. */
let miniDrag = null;

ui.mini.addEventListener('pointerdown', (e) => {
  if (!timeline) return;
  const rect = ui.mini.getBoundingClientRect();
  if (rect.width <= 0) return;
  const at = (e.clientX - rect.left) / rect.width;
  const edge = e.target.classList.contains('w') ? 'w' : e.target.classList.contains('e') ? 'e' : null;
  const inside = e.target === ui.miniWin || edge !== null;
  ui.mini.setPointerCapture(e.pointerId);
  if (!inside) {
    const half = (view.b - view.a) / 2;
    view.set(at - half, at + half);
    viewChanged();
  }
  miniDrag = { edge, at, a: view.a, b: view.b };
});

ui.mini.addEventListener('pointermove', (e) => {
  if (!miniDrag) return;
  const rect = ui.mini.getBoundingClientRect();
  const at = (e.clientX - rect.left) / Math.max(1, rect.width);
  const d = at - miniDrag.at;
  const moved = miniDrag.edge === 'w'
    ? view.set(Math.min(miniDrag.a + d, miniDrag.b - view.minSpan()), miniDrag.b)
    : miniDrag.edge === 'e' ? view.set(miniDrag.a, miniDrag.b + d)
      : view.set(miniDrag.a + d, miniDrag.b + d);
  if (moved) viewChanged();
});

for (const type of ['pointerup', 'pointercancel']) {
  ui.mini.addEventListener(type, () => { miniDrag = null; });
}

let handleDrag = null;

for (const handle of [ui.in, ui.out]) {
  handle.addEventListener('pointerdown', (e) => {
    if (!timeline) return;
    handle.setPointerCapture(e.pointerId);
    handleDrag = handle === ui.in ? 'in' : 'out';
    pauseTransport();
    e.stopPropagation();
  });
  handle.addEventListener('pointermove', (e) => {
    if (handleDrag !== (handle === ui.in ? 'in' : 'out')) return;
    const t = programAtPointer(e);
    if (handle === ui.in) {
      writeClipRange({ in: Math.max(0, Math.min(t, clipOut ?? timeline.duration)) }, timeline.duration);
    } else {
      writeClipRange({ out: clipOut === null ? t : Math.max(clipIn, Math.min(t, timeline.duration)) }, timeline.duration);
    }
    timeline.paint();
  });
  for (const type of ['pointerup', 'pointercancel']) {
    handle.addEventListener(type, (e) => {
      if (handleDrag !== (handle === ui.in ? 'in' : 'out')) return;
      handleDrag = null;
      const t = programAtPointer(e);
      if (handle === ui.in) {
        setClipInOut({ in: Math.max(0, Math.min(t, clipOut ?? timeline.duration)) });
      } else {
        setClipInOut({ out: Math.max(clipIn, Math.min(t, timeline.duration)) });
      }
      history.commit();
    });
  }
}

ui.play.addEventListener('click', () => {
  if (!timeline) return;
  // `pauseTransport` rather than `timeline.pause()`, so the pause takes the transport with it.
  if (timeline.playing || timeline.pendingPlay) pauseTransport();
  else timeline.play().catch(showTimelineError);
});

/** Parks the playhead somewhere, stopping first. Seeks clamp into the clip range. */
function goTo(sec) {
  if (!timeline) return;
  pauseTransport();
  timeline.seek(Math.max(0, Math.min(sec, timeline.duration))).catch(showTimelineError);
}

/** Puts one end of the export range where the playhead is. */
function setClipRangeFromPlayhead(which) {
  if (!timeline) return;
  const t = timeline.programSec;
  if (which === 'in') setClipInOut({ in: Math.max(0, Math.min(t, clipOut ?? timeline.duration)) });
  else setClipInOut({ out: Math.max(clipIn, Math.min(t, timeline.duration)) });
  history.commit();
}

function clearClipRange() {
  // `null` rather than the duration, so the range still means to the end if the program grows.
  setClipInOut({ in: 0, out: null });
  history.commit();
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const isTyping = (el) => el instanceof HTMLElement && (TYPING_TAGS.has(el.tagName) || el.isContentEditable);

const SHORTCUTS = 'space play/pause · arrows step a frame, with shift a second · '
  + 'home/end · i/o set in/out, with shift jump to them · option-x uses the whole clip · '
  + 'del removes the selected key · '
  + 'm marks, [/] jump to the previous and next mark · '
  + '+/- zoom the ruler, ,/. pan it, f fits the clip, z frames in..out · '
  + 'cmd-z undoes · h hides the panel';

/** The editor's keyboard, and the guard that has to come with it. */
addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  if (e.defaultPrevented) return;

  if (e.key === 'h' || e.key === 'H') {
    setPanelCollapsed(!document.body.classList.contains('panelcollapsed'));
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    history.undo();
    return;
  }
  if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey && !EDITING && ui.recGo && !ui.recGo.disabled) {
    e.preventDefault();
    ui.recGo.click();
    return;
  }
  if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey && !EDITING && ui.recMark && !ui.recMark.disabled) {
    e.preventDefault();
    (async () => {
      const body = await (await fetch('/record/mark', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })).json();
      ui.recNote.textContent = body.error ?? `${body.label} at ${(body.sourceMs / 1000).toFixed(1)}s`;
    })();
    return;
  }
  // Everything below is about a clip, and the recorder has none.
  if (!EDITING || !timeline) return;
  if (e.code === 'KeyX' && e.altKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    clearClipRange();
    return;
  }
  // Any modifier but shift belongs to the browser or the OS. Shift is a frame against a second.
  const composed = e.key.length === 1 && e.getModifierState('AltGraph');
  if ((e.metaKey || e.ctrlKey || e.altKey) && !composed) return;

  const step = (frames) => {
    pauseTransport();
    timeline.seek(Math.max(0, Math.min((timeline.frame + frames) / timeline.outputFps, timeline.duration)))
      .catch(showTimelineError);
  };

  switch (e.key) {
    case ' ':
      // A focused button owns the space bar: that is how a button is pressed without a mouse.
      if (e.target instanceof HTMLElement && e.target.closest('button, [role=button]')) return;
      // Or the page scrolls under the strip.
      e.preventDefault();
      // `pendingPlay` beside `playing`, because a play warming up from a draft is one
      // this press stops.
      if (timeline.playing || timeline.pendingPlay) pauseTransport();
      else timeline.play().catch(showTimelineError);
      return;
    case 'ArrowRight': e.preventDefault(); step(e.shiftKey ? timeline.outputFps : 1); return;
    case 'ArrowLeft': e.preventDefault(); step(e.shiftKey ? -timeline.outputFps : -1); return;
    case 'Home': e.preventDefault(); goTo(timeline.clipInSec); return;
    case 'End': e.preventDefault(); goTo(timeline.clipOutSec); return;
    case 'i': case 'I':
      e.preventDefault();
      if (e.shiftKey) goTo(clipIn);
      else setClipRangeFromPlayhead('in');
      return;
    case 'o': case 'O':
      e.preventDefault();
      if (e.shiftKey) goTo(clipOut ?? timeline.duration);
      else setClipRangeFromPlayhead('out');
      return;
    case 'Delete': case 'Backspace':
      e.preventDefault();
      if (selectedMark) { deleteMark(selectedMark).catch(showTimelineError); return; }
      deleteSelectedKey();
      return;
    case 'm': case 'M': e.preventDefault(); markHere().catch(showTimelineError); return;
    case '[': case ']': {
      e.preventDefault();
      const here = timeline.programSec;
      const seconds = markSecondsInOrder().filter(reachableInClip);
      const to = e.key === '['
        ? seconds.filter((s) => s < here - 1e-6).pop()
        : seconds.find((s) => s > here + 1e-6);
      if (to !== undefined) goTo(to);
      return;
    }
    case '+': case '=':
      e.preventDefault();
      if (view.zoomAbout(timeline.programSec / view.duration, ZOOM_PER_NOTCH)) viewChanged();
      return;
    case '-': case '_':
      e.preventDefault();
      if (view.zoomAbout(timeline.programSec / view.duration, 1 / ZOOM_PER_NOTCH)) viewChanged();
      return;
    case ',': case '<': e.preventDefault(); if (view.panBy(-0.25)) viewChanged(); return;
    case '.': case '>': e.preventDefault(); if (view.panBy(0.25)) viewChanged(); return;
    case 'f': case 'F': e.preventDefault(); if (view.fit()) viewChanged(); return;
    case 'z': case 'Z':
      e.preventDefault();
      if (view.frame(clipIn, clipOut ?? view.duration)) viewChanged();
      return;
    case '?': e.preventDefault(); say(SHORTCUTS); return;
    default:
  }
});

// The slider's own coordinate, not the rate: it is linear and program length goes as 1/rate.
const RATE_MIN = 0.1;
const RATE_MAX = 4;

/** How wide the 1.00x detent is, in pixels of the control it lives on. */
const DETENT_PX = 3;

const rawRateFromSlider = (v) => (
  RATE_MIN * (RATE_MAX / RATE_MIN) ** Math.min(1, Math.max(0, Number(v) || 0))
);
/** Whether a slider position is inside the detent, the band being a number of pixels. */
const insideDetent = (v) => {
  const width = ui.rate.getBoundingClientRect().width || 92;
  return Math.abs(Number(v) - sliderFromRate(1)) <= DETENT_PX / Math.max(1, width);
};

/**
 * The rate a position means, with the detent applied to a gesture that came in from outside.
 */
const rateFromSlider = (v) => {
  const holding = rateGesture ? rateGesture.detentArmed === false : false;
  return !holding && insideDetent(v) ? 1 : Number(rawRateFromSlider(v).toFixed(3));
};

const sliderFromRate = (rate) => (
  Math.log(Math.min(RATE_MAX, Math.max(RATE_MIN, rate)) / RATE_MIN)
  / Math.log(RATE_MAX / RATE_MIN)
);

ui.rate.value = String(sliderFromRate(retime.rate));

/** What a speed gesture holds still, captured once when it starts. */
let rateGesture = null;

function beginRateGesture({ fromKey = false } = {}) {
  if (rateGesture || !timeline) return;
  const gen = takeTransport();
  rateGesture = {
    // Whether a key is holding this open, which decides whether `change` may end it.
    fromKey,
    gen,
    // Disarmed for a gesture that begins inside the band at something other than 1.00x.
    detentArmed: retime.rate === 1 || !insideDetent(sliderFromRate(retime.rate)),
    source: retime.sourceSecAt(timeline.programSec),
    wasPlaying: timeline.playing,
    // The parameterisation the gesture started in. Every time is rescaled from these.
    rate: retime.rate,
    times: programTimeSnapshot(),
    applied: false,
  };
  timeline.pause();
}

/** Ends the gesture, whichever event gets here first. */
function endRateGesture() {
  if (!rateGesture) return;
  if (!timeline) { rateGesture = null; return; }
  const { wasPlaying, applied, rate: began, gen } = rateGesture;
  if (!applied) {
    rateGesture = null;
    if (wasPlaying) timeline.play().catch(showTimelineError);
    return;
  }
  const rate = rateFromSlider(ui.rate.value);
  const program = applyRate(rate);
  rateGesture = null;
  draftWanted = null;
  timingChanged();
  timeline.seek(program)
    .then(() => { if (wasPlaying && gen === transportGen) return timeline.play(); })
    .catch(showTimelineError);
  if (rate !== began) history.commit();
}

/** Puts the slope at `rate` and carries the document with it. The order is load-bearing. */
function applyRate(rate) {
  retime.rate = rate;
  rateGesture.applied = true;
  const program = programHoldingAnchor();
  // `frameOf` rather than `frameAt`, which clamps to a clip range that is stale here.
  timeline.frame = timeline.frameOf(program);
  reparameteriseProgramTime(rateGesture.rate / rate, rateGesture.times);
  return program;
}

/** Where the anchored frame sits now that the slope has changed. */
function programHoldingAnchor() {
  return Math.max(0, Math.min(retime.programSecAt(rateGesture.source), timeline.duration));
}

ui.rate.addEventListener('pointerdown', () => beginRateGesture());
// The keys a range input answers, named rather than left unconditional.
const RATE_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
]);
ui.rate.addEventListener('keydown', (e) => { if (RATE_KEYS.has(e.key)) beginRateGesture({ fromKey: e.key }); });
for (const type of ['pointerup', 'pointercancel', 'blur']) {
  ui.rate.addEventListener(type, endRateGesture);
}
// A `keyup` ends this gesture only when it is the key holding it open.
ui.rate.addEventListener('keyup', (e) => {
  if (rateGesture && rateGesture.fromKey === e.key) endRateGesture();
});
// `change` ends a gesture only when no key holds one, since a held key repeats per repeat.
ui.rate.addEventListener('change', () => { if (!rateGesture?.fromKey) endRateGesture(); });

ui.rate.addEventListener('input', () => {
  if (!timeline) return;
  beginRateGesture();
  if (rateGesture && !rateGesture.detentArmed && !insideDetent(ui.rate.value)) {
    rateGesture.detentArmed = true;
  }
  const program = applyRate(rateFromSlider(ui.rate.value));
  timingChanged({ moved: true });
  draftWanted = program;
  pumpDraft();
});

// The output rate, which is project state now and undoable because of it.
ui.fps?.addEventListener('change', () => {
  if (!timeline) return;
  const held = timeline.programSec;
  const fps = Number(ui.fps.value);
  timeline.outputFps = fps;
  paintDeliverable();
  const gen = takeTransport();
  const wasPlaying = timeline.playing;
  timeline.pause();
  timingChanged();
  timeline.seek(held)
    .then(() => { if (wasPlaying && gen === transportGen) return timeline.play(); })
    .catch(showTimelineError);
  history.commit();
});

// Orbiting while the playhead is parked differs from scrubbing in two ways that matter.
let orbiting = false;
// Damping outlives the pointer: on release the camera has not travelled the residual.
let orbitSettling = false;
// A flag rather than a position, since reading the transport from a control event is the loop.
let orbitRedrawWanted = false;
// Through `onNav`, because the object does not outlive a change of navigation's up.
onNav('start', () => { orbiting = true; orbitSettling = false; });
onNav('change', () => {
  if ((!orbiting && !orbitSettling) || !timeline || timeline.playing) return;
  orbitRedrawWanted = true;
});
onNav('end', () => {
  orbiting = false;
  if (!timeline || timeline.playing) return;
  orbitSettling = true;
});

/** Hands the camera what the damping still owes it, so a reader gets the pose it will keep. */
function finishOrbitDrift() {
  const damped = controls.enableDamping;
  controls.enableDamping = false;
  // Zero rather than no argument: `update()` bare falls back to a fixed auto-rotate step.
  controls.update(0);
  controls.enableDamping = damped;
}

/** The only thing that continues a drag at a parked playhead, once per animation frame. */
function pumpParkedDraft() {
  if (!timeline || timeline.playing || exporting) {
    draftWanted = null;
    orbitRedrawWanted = false;
    orbitSettling = false;
    return;
  }
  if (draftWanted !== null) {
    pumpDraft();
    return;
  }
  if (orbitRedrawWanted && !draftBusy) {
    orbitRedrawWanted = false;
    draftBusy = true;
    timeline.redrawHere()
      .catch(showTimelineError)
      .finally(() => { draftBusy = false; });
    return;
  }
  if (orbitSettling && !draftBusy) {
    orbitSettling = false;
    // The damping is finished before the seek, because these flags cannot see the end of it.
    finishOrbitDrift();
    timeline.seekHere().catch(showTimelineError);
  }
}

/**
 * What a track kind is, declared once rather than asked as `row.kind !== 'scalar'` per site.
 */
const KINDS = {
  scalar: {
    eases: true,
    laneH: 34,
    range: (spec) => ({ min: spec.min, max: spec.max }),
    ends: (keys, seg) => ({ lo: keys[seg].value, hi: keys[seg + 1].value }),
    at: (owner, t) => tracks.get(owner).valueAt(t),
    keyValue: (keys, i) => keys[i].value,
    axisIsValue: true,
    overshoots: true,
    moved: (a, b) => Math.abs(b.value - a.value) > 1e-9,
  },
  step: {
    eases: false,
    laneH: 22,
    range: () => ({ min: 0, max: 1 }),
    ends: () => ({ lo: 0, hi: 1 }),
    at: () => 0.5,
    keyValue: () => 0.5,
    axisIsValue: false,
    overshoots: false,
    moved: () => false,
  },
  pose: {
    eases: true,
    laneH: 34,
    range: () => ({ min: 0, max: 1 }),
    ends: () => ({ lo: 0, hi: 1 }),
    at: (owner, t) => poseLaneFraction(keysOf(owner), t),
    keyValue: (keys, i) => (keys.length < 2 ? 0.5 : (i === keys.length - 1 ? 1 : 0)),
    axisIsValue: false,
    overshoots: false,
    moved: (a, b) => poseMoved(a.value, b.value),
  },
};

/** Whether two poses differ at all, in place, in aim, or in field of view. */
const poseMoved = (a, b) => Math.abs(a.fov - b.fov) > 1e-9
  || a.position.some((v, i) => Math.abs(v - b.position[i]) > 1e-9)
  || a.quaternion.some((v, i) => Math.abs(v - b.quaternion[i]) > 1e-9);

/** How far through its segment a pose track is, eased, which is what a pose lane draws. */
const poseLaneFraction = (keys, t) => {
  const n = keys.length;
  if (n < 2) return 0.5;
  const i = keyBefore(keys, t);
  if (i < 0) return 0;
  if (i >= n - 1) return 1;
  const span = keys[i + 1].t - keys[i].t;
  if (span <= 0) return 1;
  return easeAt(keys[i].easeOut, keys[i + 1].easeIn, (t - keys[i].t) / span);
};

const RETIME_LANE_H = 40;
// How far a curve is sampled across a lane. A smoothness choice rather than a pixel count.
const CURVE_SAMPLES = 120;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Which key is selected, as `{owner, key}`: an index would move when a track re-sorts.
let selection = null;

const svg = (name, attrs) => {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** The value range a lane draws against. */
function laneRange(owner) {
  if (owner === 'retime') {
    const total = Math.max(1e-6, timeline ? timeline.source.duration : 1);
    return { min: 0, max: total };
  }
  const spec = params.spec(owner);
  return KINDS[spec.kind].range(spec);
}

function laneRows() {
  const rows = [];
  if (retime.keys.length > 0) {
    rows.push({ owner: 'retime', label: 'retime', kind: 'scalar', height: RETIME_LANE_H });
  }
  for (const name of ['camera', ...params.names('look')]) {
    const track = tracks.get(name);
    if (!track || track.keys.length === 0) continue;
    rows.push({ owner: name, label: name, kind: track.kind, height: KINDS[track.kind].laneH });
  }
  return rows;
}

const keysOf = (owner) => (owner === 'retime' ? retime.keys : (tracks.get(owner)?.keys ?? []));

function laneReadout(owner) {
  if (owner === 'retime') return `${retime.slopeAt(playheadSec()).toFixed(2)}×`;
  const value = params.get(owner);
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return value >= 100 ? value.toFixed(0) : value.toFixed(2);
  return `${keysOf(owner).length} keys`;
}

/** Rebuilds the lane rows. Called when lanes or keys change, never per frame or per move. */
function rebuildLanes() {
  counters.laneRebuilds++;
  ui.railLanes.replaceChildren();
  ui.lanes.replaceChildren();
  const rows = laneRows();

  for (const row of rows) {
    const rail = document.createElement('div');
    rail.className = 'trow';
    rail.style.height = `${row.height}px`;
    const label = document.createElement('span');
    label.textContent = row.label;
    const value = document.createElement('b');
    value.dataset.readout = row.owner;
    value.textContent = laneReadout(row.owner);
    rail.append(label, value);
    ui.railLanes.appendChild(rail);

    const bed = document.createElement('div');
    bed.className = 'trow';
    bed.style.height = `${row.height}px`;
    const lane = document.createElement('div');
    lane.className = 'tlane';
    lane.dataset.owner = row.owner;
    lane.__row = row;
    bed.appendChild(lane);
    ui.lanes.appendChild(bed);
    drawLane(lane, row);
  }

  laneStackHeight = rows.reduce((n, r) => n + r.height + 1, 0);
  applyLaneHeight();
  resize();
  placeChrome();
}

/** The same lanes, moved rather than rebuilt. */
function repositionLanes() {
  for (const lane of ui.lanes.querySelectorAll('.tlane')) {
    const row = lane.__row;
    if (!row) return false;
    const keys = keysOf(row.owner);
    const nodes = lane.querySelectorAll('.tkey');
    if (nodes.length !== keys.length) return false;
    for (const node of nodes) {
      if (!keys.includes(node.__key)) return false;
      node.style.left = `${view.pct(node.__key.t)}%`;
      node.style.top = `${keyY(row, node.__key)}%`;
      // Hidden, not removed: `repositionLanes` refuses when node and key counts disagree.
      node.hidden = !view.holds(node.__key.t);
    }
    for (const handle of lane.querySelectorAll('.thandle')) {
      const i = keys.indexOf(handle.__key);
      const seg = handle.__side === 'easeOut' ? i : i - 1;
      if (i < 0 || seg < 0 || seg >= keys.length - 1) return false;
      // A segment that went flat under the drag has no shape left to edit, so its handle goes.
      if (!segmentHasShape(keys, seg, row.kind)) return false;
      const points = handle.__side === 'easeOut' ? keys[seg].easeOut : keys[seg + 1].easeIn;
      if (handle.__index >= points.length) return false;
      const point = handlePoint(row, keys, seg, handle.__side, handle.__index);
      handle.__seg = seg;
      handle.style.left = `${view.pct(point.t)}%`;
      handle.style.top = `${point.y}%`;
      handle.hidden = !view.holds(point.t);
    }
    const curve = lane.querySelector('polyline');
    if (curve) curve.setAttribute('points', lanePoints(row.owner));
  }
  return true;
}

/** The curve a lane draws, as a `points` attribute in the 0..1000 by 0..100 viewBox. */
function lanePoints(owner) {
  const { min, max } = laneRange(owner);
  const span = Math.max(1e-9, max - min);
  const at = owner === 'retime'
    ? (t) => retime.sourceSecAt(t)
    : (t) => KINDS[tracks.get(owner).kind].at(owner, t);
  const points = [];
  // Sampled across the visible window rather than the clip, so nothing is drawn outside it.
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = view.startSec + (i / CURVE_SAMPLES) * view.spanSec;
    const y = 100 - ((at(t) - min) / span) * 100;
    points.push(`${(i / CURVE_SAMPLES) * 1000},${Math.max(-20, Math.min(120, y)).toFixed(2)}`);
  }
  return points.join(' ');
}

/** Whether a segment has a shape to edit. It has none when its two keys hold one value. */
const segmentHasShape = (keys, seg, kind) => KINDS[kind].moved(keys[seg], keys[seg + 1]);

function drawLane(lane, row) {
  const keys = keysOf(row.owner);
  const x = (t) => view.pct(t);

  if (KINDS[row.kind].eases) {
    const box = svg('svg', { viewBox: '0 0 1000 100', preserveAspectRatio: 'none' });
    box.appendChild(svg('polyline', {
      points: lanePoints(row.owner), fill: 'none', stroke: 'var(--accent)',
      'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke',
    }));
    lane.appendChild(box);
  }

  for (const key of keys) {
    const node = document.createElement('div');
    node.className = 'tkey';
    if (selection && selection.key === key) node.classList.add('sel');
    node.style.left = `${x(key.t)}%`;
    node.style.top = `${keyY(row, key)}%`;
    node.hidden = !view.holds(key.t);
    node.dataset.role = 'key';
    lane.appendChild(node);
    node.__key = key;
    node.__row = row;
  }

  if (!KINDS[row.kind].eases || !selection || keys.indexOf(selection.key) < 0) return;
  // Handles only on the selected key, and only where there is a segment for them to shape.
  const i = keys.indexOf(selection.key);
  for (const side of ['easeOut', 'easeIn']) {
    const seg = side === 'easeOut' ? i : i - 1;
    if (seg < 0 || seg >= keys.length - 1) continue;
    // A flat segment gets none, for the reason `segmentHasShape` gives.
    if (!segmentHasShape(keys, seg, row.kind)) continue;
    const points = side === 'easeOut' ? keys[seg].easeOut : keys[seg + 1].easeIn;
    for (let index = 0; index < points.length; index++) {
      const handle = document.createElement('div');
      handle.className = 'thandle';
      const point = handlePoint(row, keys, seg, side, index);
      handle.style.left = `${x(point.t)}%`;
      handle.style.top = `${point.y}%`;
      handle.hidden = !view.holds(point.t);
      handle.dataset.role = 'handle';
      handle.__key = selection.key;
      handle.__row = row;
      handle.__side = side;
      handle.__seg = seg;
      handle.__index = index;
      lane.appendChild(handle);
    }
  }
}

/** A key's vertical place in its lane, as a percentage from the top. */
function keyY(row, key) {
  const keys = keysOf(row.owner);
  const { min, max } = laneRange(row.owner);
  const v = KINDS[row.kind].keyValue(keys, keys.indexOf(key));
  return Math.max(0, Math.min(100, 100 - ((v - min) / Math.max(1e-9, max - min)) * 100));
}

/** Where one of an ease handle's control points sits, in seconds and lane percentage. */
function handlePoint(row, keys, seg, side, index) {
  const a = keys[seg];
  const b = keys[seg + 1];
  const h = (side === 'easeOut' ? a.easeOut : b.easeIn)[index];
  const { min, max } = laneRange(row.owner);
  const { lo, hi } = KINDS[row.kind].ends(keys, seg);
  const value = lo + (hi - lo) * h[1];
  return {
    t: a.t + (b.t - a.t) * h[0],
    y: Math.max(-15, Math.min(115, 100 - ((value - min) / Math.max(1e-9, max - min)) * 100)),
  };
}

/** How far along the segment a control point may go, as the two points either side. */
function handleSpan(keys, seg, side, index) {
  const out = keys[seg].easeOut;
  const inn = keys[seg + 1].easeIn;
  const at = (k) => (k < 0 ? 0 : (k >= out.length + inn.length ? 1
    : (k < out.length ? out[k][0] : inn[k - out.length][0])));
  const k = side === 'easeOut' ? index : out.length + index;
  const here = at(k);
  return { lo: Math.min(at(k - 1), at(k + 1), here), hi: Math.max(at(k - 1), at(k + 1), here) };
}

/** Holds a retime key inside its neighbours, in both time and value. */
function clampRetimeKey(keys, key) {
  const i = keys.indexOf(key);
  // The curve is anchored at the origin, so its first key holds still in time.
  if (i === 0) key.t = 0;
  else {
    const after = i < keys.length - 1 ? keys[i + 1].t : Infinity;
    key.t = Math.max(keys[i - 1].t + KEY_GAP_SEC, Math.min(after - KEY_GAP_SEC, key.t));
  }
  const floor = i > 0 ? keys[i - 1].value : 0;
  const ceiling = i < keys.length - 1 ? keys[i + 1].value : timeline.source.duration;
  key.value = Math.max(floor, Math.min(ceiling, key.value));
}

// The least program time two retime keys may be apart.
const KEY_GAP_SEC = 1 / 240;

/** Readouts only. Structure is `rebuildLanes`, and the two are kept apart on purpose. */
function paintLanes() {
  for (const el of ui.rail.querySelectorAll('b[data-readout]')) {
    el.textContent = laneReadout(el.dataset.readout);
  }
  for (const [name, btn] of keyButtons) paintKeyButton(name, btn);
  paintRateKey();
  paintMarkButton();
  paintEase();
}

/** A lane appeared, moved or went away. */
function lanesChanged() {
  rebuildLanes();
  paintLanes();
  groupRevealChanged();
}

/** A key or a handle moved and the set of them did not. The cheap half of the pair. */
function lanesMoved() {
  counters.laneRepositions++;
  if (!repositionLanes()) {
    counters.laneFallbacks++;
    rebuildLanes();
  }
  paintLanes();
}

/** The retime curve or the output rate moved, so every position on the ruler did. */
function timingChanged({ moved = false } = {}) {
  if (!timeline) return;
  // Re-clamped against a duration this may have changed: the window is stored as fractions.
  view.reclamp();
  if (rateFromSlider(ui.rate.value) !== retime.rate) {
    ui.rate.value = String(sliderFromRate(retime.rate));
  }
  ui.rateOut.textContent = `${retime.rate.toFixed(2)}×`;
  // The slider is the one-key curve, so once the curve has keys it has nothing to say.
  ui.rate.disabled = retime.keys.length > 0;
  if (ui.fps) ui.fps.value = String(timeline.outputFps);
  buildRuler();
  paintMarks();
  paintStripPositions();
  if (moved) lanesMoved();
  else lanesChanged();
}

// The take's marks, fetched when it opens. They belong to the take, not to a project.
let takeMarks = [];
let openTakeId = null;
let selectedMark = null; // The currently selected mark object, or null

// Where a mark may sit. One past the end stacks at the edge rather than being dropped.
const clampToClip = (sec, total) => Math.max(0, Math.min(total, sec));

/**
 * Whether a seek here would land where it was asked: `frameAt` clamps every seek into in..out.
 */
const reachableInClip = (programSec) => !timeline
  || (programSec >= timeline.clipInSec - 1e-6 && programSec <= timeline.clipOutSec + 1e-6);

const markSecondsInOrder = () => {
  const total = view.duration;
  return takeMarks
    .map((m) => clampToClip(retime.programSecAt(m.sourceMs / 1000), total))
    .sort((a, b) => a - b);
};

function paintMarks() {
  const host = ui.marks;
  if (!host) return;
  host.replaceChildren();
  if (!timeline) return;
  const total = view.duration;
  for (const mark of takeMarks) {
    // Marks are source milliseconds and the ruler is program seconds, so ticks go
    // through the curve.
    const program = retime.programSecAt(mark.sourceMs / 1000);
    const el = document.createElement('button');
    el.type = 'button';
    el.innerHTML = '<svg width="10" height="12" viewBox="0 0 10 12" fill="none"><path d="M1 1l8 0 0 7-4 3-4-3z" fill="currentColor"/></svg>';
    // A mark the edit never reaches is drawn at the edge in the dim colour rather than dropped.
    const beyond = program >= total - 1e-9 && mark.sourceMs / 1000 > retime.sourceSecAt(total) + 1e-9;
    const selected = selectedMark?.id === mark.id;
    el.className = (beyond ? 'tmk beyond' : 'tmk') + (selected ? ' sel' : '');
    const at = clampToClip(program, total);
    el.style.left = `${view.pct(at)}%`;
    el.hidden = !view.holds(at);
    el.title = `${mark.label ?? mark.id} · source ${(mark.sourceMs / 1000).toFixed(2)}s`;
    // The clamped second, never the mark's own source second.
    let dragging = false;
    let dragStartX = 0;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      // Select this mark, clear keyframe selection.
      selectedMark = mark;
      if (selection) { selection = null; lanesChanged(); }
      // Styled directly, because `paintMarks()` would destroy this element and break the drag.
      for (const sib of host.querySelectorAll('.tmk.sel')) sib.classList.remove('sel');
      el.classList.add('sel');
      dragging = false;
      dragStartX = e.clientX;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      if (!dragging && Math.abs(e.clientX - dragStartX) > 3) {
        dragging = true;
      }
      if (dragging) {
        const programSec = Math.max(0, Math.min(view.duration, view.timeAt(e.clientX)));
        el.style.left = `${view.pct(programSec)}%`;
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      el.releasePointerCapture(e.pointerId);
      if (dragging) {
        const programSec = Math.max(0, Math.min(view.duration, view.timeAt(e.clientX)));
        const sourceSec = retime.sourceSecAt(programSec);
        const newSourceMs = Math.round(sourceSec * 1000);
        moveMark(mark, newSourceMs).catch(showTimelineError);
      } else {
        if (!reachableInClip(at)) {
          say('that mark is outside the clip range, so the edit cannot reach it');
          return;
        }
        goTo(at);
      }
    });
    el.addEventListener('lostpointercapture', () => {
      if (dragging) paintMarks();
    });
    host.appendChild(el);
  }
  // The same marks on the overview, in whole-clip coordinates.
  if (ui.miniMarks) {
    ui.miniMarks.replaceChildren(...takeMarks.map((mark) => {
      const el = document.createElement('span');
      const program = retime.programSecAt(mark.sourceMs / 1000);
      el.style.left = `${Math.max(0, Math.min(100, (program / total) * 100))}%`;
      return el;
    }));
  }
}

async function loadMarks(id) {
  selectedMark = null;
  try {
    const res = await fetch(`/capture/${encodeURIComponent(id)}/marks`);
    takeMarks = res.ok ? (await res.json()).marks : [];
  } catch {
    takeMarks = [];
  }
  paintMarks();
  paintMarkButton();
}

/** Flags the moment at the playhead, in source milliseconds: a mark describes the footage. */
async function markHere() {
  if (!openTakeId || !timeline) return;
  const sourceMs = Math.round(retime.sourceSecAt(timeline.programSec) * 1000);
  const rec = { id: `m${Date.now().toString(36)}`, sourceMs, label: `mark ${takeMarks.length + 1}`, at: Date.now() };
  const res = await fetch(`/capture/${encodeURIComponent(openTakeId)}/marks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marks: [rec] }),
  });
  takeMarks = (await res.json()).marks;
  paintMarks();
  paintMarkButton();
}

/** Deletes the given mark by writing a tombstone. */
async function deleteMark(mark) {
  if (!openTakeId || !mark) return;
  const rec = { id: mark.id, deleted: true, at: Date.now() };
  const res = await fetch(`/capture/${encodeURIComponent(openTakeId)}/marks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marks: [rec] }),
  });
  takeMarks = (await res.json()).marks;
  if (selectedMark?.id === mark.id) selectedMark = null;
  paintMarks();
  paintMarkButton();
}

/** Moves a mark to a new source position. */
async function moveMark(mark, newSourceMs) {
  if (!openTakeId || !mark) return;
  if (mark.sourceMs === newSourceMs) { paintMarks(); return; }
  const rec = { ...mark, sourceMs: newSourceMs, at: Date.now() };
  const res = await fetch(`/capture/${encodeURIComponent(openTakeId)}/marks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marks: [rec] }),
  });
  if (!res.ok) { paintMarks(); return; }
  takeMarks = (await res.json()).marks;
  if (selectedMark?.id === mark.id) {
    selectedMark = takeMarks.find((m) => m.id === mark.id) ?? null;
  }
  paintMarks();
  paintMarkButton();
}

/** Where the look on screen came from, or null. A copy plus a stamp, not a reference. */
let appliedPreset = null;

/** A preset is look values, and that is the whole of it. */
function presetFromCurrentLook(names) {
  // The parked pool is not in here, and it is absent by construction rather than by a filter.
  const values = params.values(names ?? params.names('look'));
  // The save rule: a whole look sheds every effect it holds at defaults.
  if (wholeLookTag(values)) {
    for (const id of effectIdsIn(Object.keys(values))) {
      const mine = effectParamNames(id);
      if (mine.some((n) => PARAMS[n].reading)) continue;
      if (mine.every((n) => values[n] === PARAMS[n].def)) {
        for (const n of mine) delete values[n];
      }
    }
  }
  const requires = requiresFor(Object.keys(values));
  return { version: PROJECT_VERSION, ...(requires.length ? { requires } : {}), values };
}

/** Every look parameter of one effect, in declaration order. */
function effectParamNames(id) {
  return params.names('look').filter((n) => effectOf(n) === id);
}

/** The ids of every effect the registry currently declares. */
function effectIds() {
  return effectIdsIn(params.names('look'));
}

/** Whether an id names a package this build has, off the registry and not the listing. */
const effectInstalled = (id) => effectIds().includes(id);

/** Whether a look name belongs to an effect this build does not have. */
const isParkedName = (name) => {
  const id = effectOf(name);
  return id !== null && !effectInstalled(id);
};

/** What the open document needs and this build has not got, as the badge reads it. */
const missingEffects = () => parkedLook.requires.map((entry) => ({
  id: entry.id,
  version: entry.version,
  values: Object.keys(parkedLook.params).filter((n) => effectOf(n) === entry.id).length,
  tracks: Object.keys(parkedLook.tracks).filter((n) => effectOf(n) === entry.id).length,
  suppressed: suppressedEffects.has(entry.id),
}));

/** The core half of a whole look: the look tag less framing and less effect parameters. */
const coreLookNames = () => params.names('look')
  .filter((n) => PARAMS[n].group !== 'framing' && effectOf(n) === null);

const wholeLookNames = (values) => [
  ...coreLookNames(),
  ...effectIdsIn(Object.keys(values)).flatMap((id) => effectParamNames(id)),
];

/** Whether a document says what the whole look is, rather than adjusting part of one. */
const wholeLookTag = (values) => wholeLookNames(values).every((n) => Object.hasOwn(values, n));

/** The `requires` list against what the document touches, in both directions. */
function refuseRequires(what, requires, names) {
  const used = effectIdsIn(names);
  if (requires === undefined) {
    if (used.length) {
      throw new Error(
        `${what} names ${used.join(', ')} values but carries no requires list: a document says `
        + 'which effects its look is built from, so a reader on a machine without one of them '
        + 'can name what is missing instead of rendering something else under this name',
      );
    }
    return;
  }
  const listShape = requiresListRefusal(what, requires);
  if (listShape) throw new Error(listShape);
  const seen = new Set();
  for (const entry of requires) {
    const bad = requiresEntryRefusal(what, entry);
    if (bad) throw new Error(bad);
    if (seen.has(entry.id)) {
      throw new Error(`${what} requires ${entry.id} twice: one entry per effect, because two versions of one effect cannot both be what the look was built from`);
    }
    seen.add(entry.id);
  }
  const unlisted = used.filter((id) => !seen.has(id));
  if (unlisted.length) {
    throw new Error(
      `${what} names ${unlisted.join(', ')} values but its requires list does not claim ${unlisted.length === 1 ? 'it' : 'them'}: `
      + 'the list is derived from the values on save, so a gap between them is a hand edit to finish',
    );
  }
  const unused = [...seen].filter((id) => !used.includes(id));
  if (unused.length) {
    throw new Error(
      `${what} requires ${unused.join(', ')} but names no value under ${unused.length === 1 ? 'it' : 'them'}: `
      + 'an effect the look never touches is not required by it, so either its values were deleted by hand or the entry was added by one',
    );
  }
}

/** What version of an effect this build has, off the package that answered for it. */
const versionOf = (id) => effectPackages.find((p) => p.id === id)?.manifest.version ?? 'unknown';

/** The requires list a set of value names derives, one entry per effect touched. */
const requiresFor = (names) => effectIdsIn(names).map((id) => ({ id, version: versionOf(id) }));

/** One box written, and the four that may have to move with it. */
function presetPickSet(name, on) {
  for (const n of (PARAMS[name].reading ? READINGS : [name])) presetPickBoxes.get(n).checked = on;
}

/**
 * The group headings and the count, read back off the boxes rather than tracked beside them.
 */
function presetPickSync() {
  for (const group of presetPickGroups) {
    const on = group.members.filter((n) => presetPickBoxes.get(n).checked).length;
    group.box.checked = on === group.members.length;
    group.box.indeterminate = on > 0 && on < group.members.length;
  }
  const picked = presetPickNames();
  ui.pickCount.textContent = `${picked.length} of ${presetPickBoxes.size} look values`;
  ui.pickGo.disabled = picked.length === 0;
}

const presetPickNames = () => [...presetPickBoxes.keys()].filter((n) => presetPickBoxes.get(n).checked);

/** The subset picker, rebuilt with the panel and shown by both doors a look leaves by. */
function buildPresetPicker() {
  const host = document.getElementById('ppGroups');
  host.replaceChildren();
  presetPickBoxes.clear();
  presetPickGroups.length = 0;
  for (const group of PANEL_GROUPS) {
    const members = params.names('look').filter((n) => PARAMS[n].group === group.key);
    if (!members.length) continue;
    const groupNode = document.createElement('div');
    groupNode.className = 'ppgroup';
    const head = document.createElement('label');
    head.className = 'check pphead';
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.id = `ppg-${group.key}`;
    head.append(all, ` ${group.label}`);
    groupNode.append(head);
    all.addEventListener('change', () => {
      for (const name of members) presetPickSet(name, all.checked);
      presetPickSync();
    });

    for (const name of members) {
      const row = document.createElement('label');
      row.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      // Prefixed, because the panel's own control for this parameter owns the bare name.
      input.id = `pp-${name}`;
      input.checked = true;
      row.append(input, ` ${PARAMS[name].label}`);
      groupNode.append(row);
      presetPickBoxes.set(name, input);
      input.addEventListener('change', () => { presetPickSet(name, input.checked); presetPickSync(); });
    }
    host.append(groupNode);
    presetPickGroups.push({ box: all, members });
  }

  for (const name of READINGS) {
    if (!presetPickBoxes.has(name)) {
      throw new Error(`the reading ${name} has no box in the preset subset dialog: ticking any of the five would throw`);
    }
  }
}

ui.pickCancel.addEventListener('click', () => ui.pickDialog.close());

/** Opens the picker and answers with a name and a subset, or null. Every box starts ticked. */
function pickPresetSubset({ title, verb, name }) {
  return new Promise((resolve) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    for (const input of presetPickBoxes.values()) input.checked = true;
    presetPickSync();
    ui.pickTitle.textContent = title;
    ui.pickGo.textContent = verb;
    ui.pickName.value = name;

    let picked = null;
    const confirm = () => {
      // A document is named before it is written: an unnamed one is neither entry nor filename.
      const chosen = ui.pickName.value.trim();
      if (!chosen) { ui.pickName.focus(); return; }
      picked = { name: chosen, names: presetPickNames() };
      ui.pickDialog.close();
    };
    const typed = (e) => {
      if (e.key !== 'Enter' || ui.pickGo.disabled) return;
      e.preventDefault();
      confirm();
    };
    const settle = () => {
      ui.pickGo.removeEventListener('click', confirm);
      ui.pickName.removeEventListener('keydown', typed);
      ui.pickDialog.removeEventListener('close', settle);
      if (opener?.isConnected && !opener.disabled) opener.focus();
      resolve(picked);
    };
    ui.pickGo.addEventListener('click', confirm);
    ui.pickName.addEventListener('keydown', typed);
    ui.pickDialog.addEventListener('close', settle);
    ui.pickDialog.showModal();
    ui.pickName.focus();
    ui.pickName.select();
  });
}

/** Everything about a preset that can be refused without writing anything. */
function refusePresetBody(name, body) {
  if (body?.version !== PROJECT_VERSION) {
    throw new Error(versionRefusal(`preset ${name}`, body?.version));
  }
  // The envelope, checked with the same suspicion as what is inside it.
  const PRESET_KEYS = ['version', 'requires', 'values'];
  const stray = Object.keys(body).filter((k) => !PRESET_KEYS.includes(k));
  if (stray.length) {
    throw new Error(
      `preset ${name} carries ${stray.join(', ')}, which a version ${PROJECT_VERSION} preset has no `
      + `place for: a preset is ${PRESET_KEYS.join(', ')} and nothing else, so a key beside them is `
      + 'either a field an older version had or a typo, and both would be read as neither',
    );
  }
  if (!body.values || typeof body.values !== 'object') {
    throw new Error(`preset ${name} carries no values object, so there is no look in it to apply`);
  }
  if (Array.isArray(body.values)) {
    throw new Error(
      `preset ${name} carries a list where its values should be: a look is an object of `
      + 'parameter names against values, so a list has nothing in it this program can name',
    );
  }
  if (Object.keys(body.values).length === 0) {
    throw new Error(
      `preset ${name} has a values object with nothing in it, so its scope is nothing: `
      + 'applying it would write no value and move no pixel. Name the values this look is '
      + 'made of, or delete the document rather than keep one that describes no look',
    );
  }

  // The values, checked against the registry without reaching it.
  for (const [key, value] of Object.entries(body.values)) {
    const { tag } = params.spec(key);
    if (tag !== 'look') {
      throw new Error(
        `preset ${name} names ${key}, which is a ${tag} parameter: a preset carries look values `
        + 'and nothing else, so that it can be applied to any clip without moving anything else',
      );
    }
    params.normalise(key, value);
  }

  refuseRequires(`preset ${name}`, body.requires, Object.keys(body.values));

  const missing = missingReadings(body.values);
  if (missing.length && missing.length !== READINGS.length) {
    const named = READINGS.filter((n) => !missing.includes(n));
    throw new Error(
      `preset ${name} names ${named.join(', ')} but not ${missing.join(', ')}: the reading `
      + 'weights are all or none, because a file naming some of them blends what it says with '
      + `whatever the clip was already wearing. Name the other ${missing.length}, or take `
      + `${named.length === 1 ? 'the one it has' : `all ${named.length} it has`} out and leave `
      + 'the reading to whoever is grading',
    );
  }
}

/** Applies a saved preset, stamping it only if the document said what the whole look is. */
function applyStoredPreset(doc) {
  refuseDuringEvaluation('a stored preset applied');
  refusePresetBody(doc.name, doc.body);
  const values = doc.body.values ?? {};
  const stamped = wholeLookTag(values);
  // A whole look says what all of it is, so effects it never mentions are at their defaults.
  if (stamped) {
    const named = new Set(effectIdsIn(Object.keys(values)));
    const resets = {};
    for (const id of effectIds()) {
      if (named.has(id)) continue;
      for (const n of effectParamNames(id)) resets[n] = PARAMS[n].def;
    }
    params.apply({ ...resets, ...values });
  } else {
    params.apply(values);
  }
  if (stamped) appliedPreset = { name: doc.name, rev: doc.rev };
  requestRepaint();
  history.commit();
  return { stamped, written: Object.keys(values).length, look: wholeLookNames(values).length };
}

/** The documents of one kind, or the server's reason there are none. */
const documentsIn = async (kind) => {
  const res = await fetch(`/${kind}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body?.[kind])) {
    throw new Error(body?.error ?? `${kind} could not be listed: HTTP ${res.status}`);
  }
  return body[kind];
};

/** The delete glyph, a stroked path so it takes its colour from around it. `lucide/trash-2`. */
function trashGlyph() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Decorative: the button's own label already says which preset this deletes.
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6']) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const TYPE_AHEAD_MS = 700;
const pickers = [];

function definePicker(trigger, list, { adds = null, note = null, autoApply = false } = {}) {
  const picker = { trigger, list, adds, note, autoApply, docs: [], typed: '', typedAt: 0 };
  pickers.push(picker);

  trigger.addEventListener('click', () => (list.hidden ? openPicker(picker) : closePicker(picker)));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker(picker);
    }
  });
  list.addEventListener('keydown', (event) => pickerKey(picker, event));
  // On the list and not each option, so an option from a later rebuild is driven by existing.
  list.addEventListener('click', (event) => {
    const remove = event.target.closest('.pickerdelete');
    const option = event.target.closest('.pickeroption');
    if (remove && option) {
      event.stopPropagation();
      deletePreset(picker, option.dataset.name);
      return;
    }
    if (option) choosePicker(picker, option.dataset.name, { close: true });
  });
  return picker;
}

function openPicker(picker) {
  for (const other of pickers) if (other !== picker) closePicker(other);
  picker.list.hidden = false;
  picker.trigger.setAttribute('aria-expanded', 'true');
  const here = picker.list.querySelector('.pickeroption.here') ?? picker.list.querySelector('.pickeroption');
  if (here) here.focus();
  else picker.list.focus();
}

function closePicker(picker, { restoreFocus = false } = {}) {
  if (picker.list.hidden) return;
  picker.list.hidden = true;
  picker.trigger.setAttribute('aria-expanded', 'false');
  // The caret must land somewhere visible: a list shutting on focus strands it on the body.
  if (restoreFocus || picker.list.contains(document.activeElement)) picker.trigger.focus();
}

/** Every option currently in the list, in the order a keyboard walks them. */
const pickerOptions = (picker) => [...picker.list.querySelectorAll('.pickeroption')];

function pickerKey(picker, event) {
  const options = pickerOptions(picker);
  if (!options.length) return;
  const at = options.indexOf(document.activeElement.closest('.pickeroption'));
  const move = (to) => {
    event.preventDefault();
    options[Math.max(0, Math.min(options.length - 1, to))].focus();
  };
  if (event.key === 'ArrowDown') return move(at + 1);
  if (event.key === 'ArrowUp') return move(at - 1);
  if (event.key === 'Home') return move(0);
  if (event.key === 'End') return move(options.length - 1);
  if (event.key === 'Escape') {
    event.preventDefault();
    return closePicker(picker, { restoreFocus: true });
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const option = document.activeElement.closest('.pickeroption');
    if (option) choosePicker(picker, option.dataset.name, { close: true });
    return;
  }
  // Type-ahead. One printable character at a time, accumulated inside a window.
  if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
  const now = performance.now();
  picker.typed = now - picker.typedAt > TYPE_AHEAD_MS ? event.key : picker.typed + event.key;
  picker.typedAt = now;
  const wanted = picker.typed.toLowerCase();
  const hit = options.find((option) => option.dataset.name.toLowerCase().startsWith(wanted));
  if (hit) {
    event.preventDefault();
    hit.focus();
  }
}

/** Write a name onto the trigger and repaint the list. The display half only. */
function showPickerChoice(picker, name) {
  picker.trigger.value = name ?? '';
  paintPicker(picker);
}

/** The operator chose this entry: show it, and on a picker that applies, apply it. */
function choosePicker(picker, name, { close = false } = {}) {
  showPickerChoice(picker, name);
  if (close) closePicker(picker, { restoreFocus: true });
  if (picker.autoApply) {
    if (name) {
      withPresetGesture(picker.note ?? ui.note, () => whileWriting(async () => {
        try {
          const doc = await (await fetch(`/presets/${encodeURIComponent(name)}`)).json();
          const { stamped, written } = applyStoredPreset(doc);
          say(stamped
            ? `applied ${doc.name} · ${doc.rev.slice(7, 15)}`
            : `applied ${written} values from ${doc.name}, which names part of a look rather than the whole of one`);
        } catch (err) {
          showPickerChoice(picker, appliedPreset?.name ?? '');
          showTimelineError(err);
        }
      }));
    } else {
      // "none" selected: reset every look parameter to its default, and clear the stamp.
      appliedPreset = null;
      params.reset(params.names('look'));
      history.commit();
      say('reset to defaults');
    }
  }
}

function paintPicker(picker) {
  const chosen = picker.trigger.value;
  picker.trigger.querySelector('.pickervalue').textContent = chosen || 'none';
  for (const option of pickerOptions(picker)) {
    const here = option.dataset.name === chosen;
    option.classList.toggle('here', here);
    option.setAttribute('aria-selected', String(here));
  }
}

function buildPicker(picker, docs) {
  picker.docs = docs;
  const noneOption = document.createElement('div');
  noneOption.className = 'pickeroption';
  noneOption.setAttribute('role', 'option');
  noneOption.setAttribute('aria-selected', 'false');
  noneOption.tabIndex = -1;
  noneOption.dataset.name = '';
  noneOption.dataset.builtin = 'false';
  const noneLabel = document.createElement('span');
  noneLabel.className = 'pickerlabel';
  noneLabel.textContent = 'none';
  noneOption.append(noneLabel);

  const rows = docs.map((doc) => {
    const option = document.createElement('div');
    option.className = 'pickeroption';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.tabIndex = -1;
    option.dataset.name = doc.name;
    option.dataset.builtin = String(Boolean(doc.builtin));
    const label = document.createElement('span');
    label.className = 'pickerlabel';
    label.textContent = doc.name;
    option.append(label);
    if (!doc.builtin) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pickerdelete';
      remove.setAttribute('aria-label', `Delete preset ${doc.name}`);
      remove.tabIndex = -1;
      remove.append(trashGlyph());
      option.append(remove);
    }
    return option;
  });
  picker.list.replaceChildren(noneOption, ...rows);
  if (picker.adds) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'pickeradd';
    add.id = picker.adds;
    add.setAttribute('aria-label', 'Save the current look as a new preset');
    add.textContent = '+';
    add.addEventListener('click', () => {
      closePicker(picker, { restoreFocus: true });
      ui.presetSave.click();
    });
    picker.list.append(add);
  }
  paintPicker(picker);
}

/** Delete a user preset, and put the caret somewhere afterwards. */
async function deletePreset(picker, name) {
  const options = pickerOptions(picker);
  const at = options.findIndex((option) => option.dataset.name === name);
  const successor = options[at + 1]?.dataset.name ?? options[at - 1]?.dataset.name ?? null;
  await withPresetGesture(picker.note ?? ui.note, () => whileWriting(async () => {
    // The content type is declared even with no body: every route that changes something asks.
    const res = await fetch(`/presets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).trim() || res.statusText}`);
    if (picker.trigger.value === name) picker.trigger.value = '';
    await refreshPresets();
  })).catch((err) => {
    if (picker.note) picker.note.textContent = `could not delete ${name}: ${err.message}`;
    else showTimelineError(err);
    console.error(err);
  });
  if (picker.list.hidden) return;
  const back = successor
    ? picker.list.querySelector(`.pickeroption[data-name="${CSS.escape(successor)}"]`)
    : null;
  if (back) back.focus();
  else closePicker(picker, { restoreFocus: true });
}

definePicker(ui.preset, document.getElementById('tPresetList'), { adds: 'tPresetAdd', autoApply: true });

addEventListener('pointerdown', (event) => {
  for (const picker of pickers) {
    if (!picker.list.hidden && !picker.trigger.contains(event.target) && !picker.list.contains(event.target)) {
      closePicker(picker);
    }
  }
});

async function refreshPresets() {
  const list = await documentsIn('presets');
  // Both selectors, because the preset library is one library.
  for (const picker of pickers) {
    buildPicker(picker, list);
    if (appliedPreset && list.some((doc) => doc.name === appliedPreset.name)) {
      showPickerChoice(picker, appliedPreset.name);
    } else {
      paintPicker(picker);
    }
  }
  return list;
}

/** A preset as a file, both ways. The document is the file format. */
function exportPresetFile(name, body) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.braindance-preset.json`;
  a.click();
  // Revoked on the next turn, because the fetch of the blob is not synchronous.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function importPresetFile(file) {
  const text = await file.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file.name} is not JSON: ${err.message}`);
  }
  const name = file.name.replace(/\.braindance-preset\.json$|\.json$/i, '');
  refuseDuringEvaluation('a preset imported');
  refusePresetBody(name, body);
  const res = await fetch(`/presets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const saved = await res.json();
  if (saved.error) throw new Error(saved.error);
  applyStoredPreset({ name: saved.name, rev: saved.rev, body });
  return saved;
}

/**
 * The document the resume chip is offering, held because the name it came from
 * does not stay still.
 */
let offeredWorkingBody = null;

function offerWorkingDocument(projects) {
  if (ui.resume) ui.resume.hidden = true;
  offeredWorkingBody = null;
  const working = projects?.find((doc) => doc.name === WORKING_PROJECT);
  if (!working) return;
  // Matched on hash, not id: a rename frees an id and a later take can be renamed into it.
  if (!openTakeHash || working.body?.take?.hash !== openTakeHash) return;
  const body = { ...working.body };
  delete body.history;
  delete body.take;
  if (JSON.stringify(body) === history.baseline) return;
  if (!ui.resume) return;
  offeredWorkingBody = JSON.parse(JSON.stringify(working.body));
  if (ui.resumeWhen) ui.resumeWhen.textContent = `autosaved ${new Date(working.savedAt).toLocaleString()}`;
  ui.resume.hidden = false;
}

async function refreshProjects() {
  return documentsIn('projects');
}

async function refreshDeliverables() {
  const list = await documentsIn('deliverables');
  if (ui.deliverable) {
    const current = ui.deliverable.value;
    ui.deliverable.replaceChildren(new Option('—', ''));
    for (const doc of list) ui.deliverable.appendChild(new Option(doc.name, doc.name));
    if (list.some((d) => d.name === current)) ui.deliverable.value = current;
  }
  return list;
}

/** Moves the picker and what it names together, so a refusal can put the picker back. */
function showAdoptedDeliverable(name) {
  if (!ui.deliverable) return;
  ui.deliverable.value = name;
  ui.deliverable.dataset.adopted = name;
}

async function saveDeliverable(name, deliverable) {
  const res = await fetch(`/deliverables/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deliverable),
  });
  const saved = await res.json();
  if (saved.error) throw new Error(saved.error);
  return saved;
}

// One pointer path for keys and handles, since they differ only in what a drag writes.
let laneDrag = null;

const laneProgramAt = (clientX) => view.timeAt(clientX);

// Known gap: an undo between this pointerdown and its pointerup rebuilds every track.
ui.beds.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.tkey, .thandle');
  if (!el || !timeline) return;
  e.preventDefault();
  e.stopPropagation();

  // A second press on the same key removes it, before the capture, so it never drags.
  if (el.dataset.role === 'key') {
    const now = performance.now();
    if (lastKeyClick.key === el.__key && now - lastKeyClick.at < DOUBLE_CLICK_MS) {
      lastKeyClick = { key: null, at: 0 };
      selection = { owner: el.__row.owner, key: el.__key };
      deleteSelectedKey();
      return;
    }
    lastKeyClick = { key: el.__key, at: now };
  }

  ui.beds.setPointerCapture(e.pointerId);
  const lane = el.closest('.tlane');
  laneDrag = {
    el, row: el.__row, key: el.__key, side: el.__side, seg: el.__seg, index: el.__index,
    role: el.dataset.role, rect: lane.getBoundingClientRect(),
    duration: timeline.duration,
  };
  if (selectedMark) { selectedMark = null; paintMarks(); }
  selection = { owner: el.__row.owner, key: el.__key };
  lanesChanged();
});

ui.beds.addEventListener('pointermove', (e) => {
  if (!laneDrag) return;
  const { row, key, rect } = laneDrag;
  const keys = keysOf(row.owner);
  const { min, max } = laneRange(row.owner);
  const frac = Math.min(1.15, Math.max(-0.15, (e.clientY - rect.top) / Math.max(1, rect.height)));
  const value = min + (1 - frac) * (max - min);

  if (laneDrag.role === 'key') {
    key.t = Math.max(0, laneProgramAt(e.clientX));
    if (KINDS[row.kind].axisIsValue) key.value = value;
    if (row.owner === 'retime') clampRetimeKey(keys, key);
    else {
      if (KINDS[row.kind].axisIsValue) {
        // Through the registry's snapping without writing, so a key and a slider agree.
        key.value = params.normalise(row.owner, key.value);
      }
      // A look track sorts, since its keys may be dragged past one another. The retime cannot.
      tracks.get(row.owner).keys.sort((x, y) => x.t - y.t);
    }
    if (row.owner === 'retime') paintMarks();
  } else {
    const a = keys[laneDrag.seg];
    const b = keys[laneDrag.seg + 1];
    const dt = Math.max(1e-9, b.t - a.t);
    // Off the kind, not the key values: a pose value is an object and subtracting is `NaN`.
    const { lo, hi } = KINDS[row.kind].ends(keys, laneDrag.seg);
    const dv = hi - lo;
    const h = (laneDrag.side === 'easeOut' ? a.easeOut : b.easeIn)[laneDrag.index];
    // x stays inside the segment: a handle past either end folds the timing curve back.
    const span = handleSpan(keys, laneDrag.seg, laneDrag.side, laneDrag.index);
    // The span first and the curve last: ordering suffices only if the polygon starts ordered.
    h[0] = foldFreeX(a.easeOut, b.easeIn, laneDrag.side, laneDrag.index, h[0],
      Math.min(span.hi, Math.max(span.lo, (laneProgramAt(e.clientX) - a.t) / dt)));
    // `dv` is non-zero by construction: a handle exists only where there was a shape.
    if (segmentHasShape(keys, laneDrag.seg, row.kind)) h[1] = (value - lo) / dv;
    // A look handle may overshoot. The retime's may not.
    if (row.owner === 'retime' || !KINDS[row.kind].overshoots) h[1] = Math.min(1, Math.max(0, h[1]));
    else h[1] = Math.min(2, Math.max(-1, h[1]));
  }
  lanesMoved();
  requestRepaint();
});

for (const type of ['pointerup', 'pointercancel']) {
  ui.beds.addEventListener(type, () => {
    if (!laneDrag) return;
    const wasRetime = laneDrag.row.owner === 'retime';
    laneDrag = null;
    if (wasRetime) timingChanged();
    else lanesChanged();
    history.commit();
  });
}

/** Removes a retime key, refusing the one removal that would leave the curve headless. */
function removeRetimeKey(key) {
  const i = retime.keys.indexOf(key);
  if (i < 0) return false;
  if (i === 0 && retime.keys.length > 1) {
    say('the first retime key anchors the start of the clip - '
      + 'remove the ones after it first');
    return false;
  }
  retime.keys.splice(i, 1);
  if (retime.keys.length === 1 && retime.keys[0].t === 0) retime.keys.length = 0;
  return true;
}

/** Removes whichever key is selected in a lane. */
function deleteSelectedKey() {
  if (!timeline || !selection) return false;
  const { owner, key } = selection;
  // A stale selection is not an error: an undo rebuilds every track from a snapshot.
  if (!keysOf(owner).includes(key)) { selection = null; return false; }

  if (owner === 'retime') {
    if (!removeRetimeKey(key)) return false;
    selection = null;
    timingChanged();
  } else {
    retainEffectFor(owner);
    tracks.get(owner).removeKey(key);
    // A track with no keys is not a track. The parameter keeps the value it holds now.
    dropTrackIfEmpty(owner);
    selection = null;
    lanesChanged();
  }
  requestRepaint();
  history.commit();
  return true;
}

/** The shapes a handle drag is usually reaching for, as one press each. */
const EASE_PRESETS = {
  linear: { out: EASE_OUT_LINEAR, in: EASE_IN_LINEAR },
  in: { in: [[0.58, 1]] },
  out: { out: [[0.42, 0]] },
  smooth: { out: [[0.42, 0]], in: [[0.58, 1]] },
  glide: { out: [[0.2, 0], [0.4, 0]], in: [[0.6, 1], [0.8, 1]] },
  ends: { firstOut: [[0.2, 0], [0.4, 0]], lastIn: [[0.6, 1], [0.8, 1]] },
  hold: { out: [[1, 0]], nextIn: [[1, 0]] },
};

/** The selected key, if a preset could shape it. Null covers three different no answers. */
function selectionEaseState() {
  if (!timeline || !selection) return null;
  const keys = keysOf(selection.owner);
  const i = keys.indexOf(selection.key);
  if (i < 0) return null;
  const row = laneRows().find((r) => r.owner === selection.owner);
  if (!row || !KINDS[row.kind].eases) return null;
  const before = i > 0 && segmentHasShape(keys, i - 1, row.kind);
  const after = i < keys.length - 1 && segmentHasShape(keys, i, row.kind);
  return before || after ? { keys, i, kind: row.kind } : null;
}

function applyEasePreset(name) {
  const state = selectionEaseState();
  const spec = EASE_PRESETS[name];
  if (!state || !spec) return false;
  const { keys, i, kind } = state;
  if (spec.out) keys[i].easeOut = copyHandle(spec.out);
  if (spec.in) keys[i].easeIn = copyHandle(spec.in);
  if (spec.nextIn && i < keys.length - 1) keys[i + 1].easeIn = copyHandle(spec.nextIn);
  if (spec.firstOut && segmentHasShape(keys, 0, kind)) {
    keys[0].easeOut = copyHandle(spec.firstOut);
  }
  if (spec.lastIn && segmentHasShape(keys, keys.length - 2, kind)) {
    keys[keys.length - 1].easeIn = copyHandle(spec.lastIn);
  }
  if (selection.owner === 'retime') retime.assertMonotonic(retime.keys);
  lanesChanged();
  requestRepaint();
  history.commit();
  return true;
}

for (const btn of ui.ease.querySelectorAll('button[data-ease]')) {
  btn.addEventListener('click', () => {
    const owner = selection?.owner ?? '';
    if (applyEasePreset(btn.dataset.ease)) say(`${btn.dataset.ease} ease on ${owner}`);
  });
}

/** Whether the selected key's handles may grow or shrink, and on how many sides. */
function pointSides(delta, state) {
  if (!state || selection.owner === 'retime') return [];
  const { keys, i, kind } = state;
  const sides = [];
  if (i < keys.length - 1 && segmentHasShape(keys, i, kind)) sides.push('easeOut');
  if (i > 0 && segmentHasShape(keys, i - 1, kind)) sides.push('easeIn');
  return sides.filter((side) => {
    const n = keys[i][side].length;
    return delta > 0 ? n < SEGMENT_POINT_CEILING : n > 1;
  });
}

/** Adds or removes a control point on every shapeable side of the selected key. */
function changePointCount(delta) {
  const state = selectionEaseState();
  const sides = pointSides(delta, state);
  if (sides.length === 0) return false;
  const { keys, i } = state;
  for (const side of sides) {
    const seg = side === 'easeOut' ? i : i - 1;
    const a = keys[seg];
    const b = keys[seg + 1];
    if (delta > 0) {
      const up = elevate(a.easeOut, b.easeIn, side);
      a.easeOut = up.easeOut;
      b.easeIn = up.easeIn;
    } else if (side === 'easeOut') {
      a.easeOut = a.easeOut.slice(0, -1);
    } else {
      b.easeIn = b.easeIn.slice(1);
    }
  }
  lanesChanged();
  requestRepaint();
  history.commit();
  return true;
}

for (const [button, delta] of [[ui.addPoint, 1], [ui.dropPoint, -1]]) {
  button.addEventListener('click', () => {
    const owner = selection?.owner ?? '';
    if (!changePointCount(delta)) return;
    const { keys, i } = selectionEaseState();
    say(`${delta > 0 ? 'added' : 'removed'} an ease control point on ${owner}: `
      + `${keys[i].easeOut.length} out, ${keys[i].easeIn.length} in`);
  });
}

// Only meaningful while a key is selected, so the row goes quiet rather than writing nothing.
function paintEase() {
  const selected = Boolean(selection && keysOf(selection.owner).includes(selection.key));
  const easeState = selectionEaseState();
  const shapeable = Boolean(easeState);
  ui.ease.classList.toggle('off', !selected);
  for (const btn of ui.ease.querySelectorAll('button[data-ease]')) btn.disabled = !shapeable;
  ui.deleteKey.disabled = !selected;
  ui.addPoint.disabled = pointSides(1, easeState).length === 0;
  ui.dropPoint.disabled = pointSides(-1, easeState).length === 0;
  ui.prevKey.disabled = neighbourKeyTime(-1) === null;
  ui.nextKey.disabled = neighbourKeyTime(1) === null;
}

/** The nearest key strictly before or after the playhead on the selected track, or null. */
function neighbourKeyTime(direction) {
  if (!timeline) return null;
  // The fallback is what makes these a way to reach a key rather than dead until
  // one is selected.
  const owner = selection?.owner ?? 'retime';
  const now = playheadSec();
  const tol = keyTolerance();
  const times = keysOf(owner)
    .map((k) => k.t)
    .filter((t) => (direction < 0 ? t < now - tol : t > now + tol));
  if (times.length === 0) return null;
  return direction < 0 ? Math.max(...times) : Math.min(...times);
}

for (const [button, direction] of [[ui.prevKey, -1], [ui.nextKey, 1]]) {
  button.addEventListener('click', () => {
    const t = neighbourKeyTime(direction);
    if (t === null) return;
    goTo(t);
  });
}

ui.deleteKey.addEventListener('click', () => { deleteSelectedKey(); });

/**
 * The double click that removes a key, tracked by hand rather than by a `dblclick` listener.
 */
let lastKeyClick = { key: null, at: 0 };
const DOUBLE_CLICK_MS = 400;

function paintKeyButton(name, btn) {
  const track = tracks.get(name);
  const state = !track || track.keys.length === 0
    ? 'none'
    : (track.keyAt(playheadSec(), keyTolerance()) ? 'here' : 'some');
  btn.dataset.kf = state;
}

ui.rateKey?.addEventListener('click', () => {
  if (!timeline) return;
  const t = playheadSec();
  const tol = keyTolerance();
  const existing = retime.keys.find((k) => Math.abs(k.t - t) <= tol);
  // Through the same door the lane's delete uses, so the origin rule is stated once.
  if (existing) {
    if (!removeRetimeKey(existing)) return;
  } else {
    // The source time the curve already maps to, so planting a key never moves the image.
    if (retime.keys.length === 0 && t > 0) {
      retime.keys.push({
        t: 0, value: retime.sourceSecAt(0),
        easeOut: copyHandle(EASE_OUT_LINEAR), easeIn: copyHandle(EASE_IN_LINEAR),
      });
    }
    retime.keys.push({
      t, value: retime.sourceSecAt(t),
      easeOut: copyHandle(EASE_OUT_LINEAR), easeIn: copyHandle(EASE_IN_LINEAR),
    });
    retime.keys.sort((x, y) => x.t - y.t);
  }
  timingChanged();
  requestRepaint();
  history.commit();
});

function paintRateKey() {
  if (!ui.rateKey) return;
  const t = playheadSec();
  const tol = keyTolerance();
  ui.rateKey.dataset.kf = retime.keys.length === 0
    ? 'none'
    : (retime.keys.some((k) => Math.abs(k.t - t) <= tol) ? 'here' : 'some');
}

/** Updates the mark button icon: filled when the playhead is on a mark, stroked otherwise. */
function paintMarkButton() {
  if (!ui.mark) return;
  const t = playheadSec();
  const tol = keyTolerance();
  const onMark = takeMarks.some((m) => {
    const program = retime.programSecAt(m.sourceMs / 1000);
    return Math.abs(program - t) <= tol;
  });
  const svg = ui.mark.querySelector('svg');
  if (!svg) return;
  const path = svg.querySelector('path');
  if (!path) return;
  if (onMark) {
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('stroke', 'none');
  } else {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
  }
}

// The furniture is drawn on a canvas of its own over the picture, since a camera move needs it.
const chromeCanvas = document.createElement('canvas');
chromeCanvas.id = 'chrome';
chromeCanvas.hidden = true;
document.body.appendChild(chromeCanvas);
const chromeCtx = chromeCanvas.getContext('2d');

// Reused across the plan's inner loop, which runs on the main thread on every paint.
const planVec = new THREE.Vector3();

// Whether the furniture is on screen. Off in the live viewer, which has no clip to compose.
let chromeOn = false;
let topViewVisible = true;
let statsVisible = false;
/** How long the GPU actually spent on the last frames, in milliseconds. */
const gpuTimer = {
  ext: null,
  probed: false,
  inFlight: [],
  samples: [],
  active: false,

  supported(gl) {
    if (!this.probed) {
      this.probed = true;
      this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    }
    return this.ext !== null;
  },

  begin(gl) {
    if (this.active || !this.supported(gl)) return;
    // Drained here and not only from the chrome paint: the two are not on the same clock.
    this.poll(gl);
    // Two in flight covers the latency, and only one TIME_ELAPSED query may be open at a time.
    if (this.inFlight.length >= 2) return;
    const query = gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.inFlight.push(query);
    this.active = true;
  },

  end(gl) {
    if (!this.active) return;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.active = false;
  },

  /** Drains whatever has become available. Called from the chrome paint, not the seam. */
  poll(gl) {
    if (!this.ext || this.active) return;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const query = this.inFlight[i];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!disjoint) {
        this.samples.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        if (this.samples.length > 30) this.samples.shift();
      }
      gl.deleteQuery(query);
      this.inFlight.splice(i, 1);
    }
  },

  /** The median rather than the mean: one descheduled frame outweighs the other twenty-nine. */
  median() {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
  },
};

// The crop box and its handles, and the faint pass that shows what the box is cutting.
let showCropBox = false;
// Whether anything has rendered since the furniture was last drawn.
let chromeStale = false;

// How faintly a cut point draws, and the one function allowed to write the uniform.
const CROP_FAINT = 0.14;
function syncCropOutside() {
  uniforms.cropOutside.value = chromeOn && showCropBox ? CROP_FAINT : 0;
}

const scratchVec = new THREE.Vector3();

function stageSize() {
  const size = renderer.getSize(new THREE.Vector2());
  return { w: size.x, h: size.y };
}

function insetRect() {
  const { w, h } = stageSize();
  return { x: w - INSET.w - INSET.margin, y: INSET.margin, w: INSET.w, h: INSET.h, stage: { w, h } };
}

function cameraKeys() {
  const track = tracks.get('camera');
  return track ? track.keys : [];
}

/** The sampled camera path, in world space. Empty below two keys: a point is not a path. */
const PATH_SAMPLES = 120;

function pathPoints() {
  const keys = cameraKeys();
  if (keys.length < 2) return [];
  const from = keys[0].t;
  const to = keys[keys.length - 1].t;
  const out = [];
  for (let i = 0; i < PATH_SAMPLES; i++) {
    out.push(poseAt(keys, from + ((to - from) * i) / (PATH_SAMPLES - 1)).position);
  }
  return out;
}

/** The program camera's frustum as world-space segments, off the camera the registry posed. */
function frustumSegments() {
  programCamera.updateMatrixWorld(true);
  const half = Math.tan((programCamera.fov * Math.PI) / 360) * FRUSTUM_LEN;
  const wide = half * programCamera.aspect;
  const corners = [[-wide, -half], [wide, -half], [wide, half], [-wide, half]].map(([x, y]) => scratchVec
    .set(x, y, -FRUSTUM_LEN).applyMatrix4(programCamera.matrixWorld).toArray());
  const apex = programCamera.position.toArray();
  const segments = corners.map((corner) => [apex, corner]);
  for (let i = 0; i < 4; i++) segments.push([corners[i], corners[(i + 1) % 4]]);
  return segments;
}

function strokePolyline(points) {
  let started = false;
  chromeCtx.beginPath();
  for (const p of points) {
    if (!p) { started = false; continue; }
    if (started) chromeCtx.lineTo(p.x, p.y);
    else chromeCtx.moveTo(p.x, p.y);
    started = true;
  }
  chromeCtx.stroke();
}

function drawNodes(project) {
  const keys = cameraKeys();
  keys.forEach((key, i) => {
    const p = project(key.value.position);
    if (!p) return;
    chromeCtx.beginPath();
    chromeCtx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    chromeCtx.fillStyle = '#0d1014';
    chromeCtx.fill();
    chromeCtx.strokeStyle = selection && selection.owner === 'camera' && cameraKeys()[i] === selection.key
      ? '#e8ecf1' : '#5ad1c4';
    chromeCtx.lineWidth = 1.4;
    chromeCtx.stroke();
  });
}

// One bead every fourth sample. A legibility choice rather than a resolution.
const BEAD_EVERY = 4;

/**
 * Which of the path's samples get a bead, in world space. Equal time, so gaps read as speed.
 */
function beadPoints(points) {
  const out = [];
  for (let i = 0; i < points.length; i += BEAD_EVERY) out.push(points[i]);
  return out;
}

function drawBeads(points, project) {
  chromeCtx.fillStyle = 'rgba(90, 209, 196, 0.55)';
  for (const point of beadPoints(points)) {
    const p = project(point);
    if (!p) continue;
    chromeCtx.beginPath();
    chromeCtx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
    chromeCtx.fill();
  }
}

/** The point cloud from above, straight off the depth texture's own array. */
function drawPlanCloud(rect) {
  const depth = depthCurr.image.data;
  const fx = uniforms.focal.value.x;
  const fy = uniforms.focal.value.y;
  const cx = uniforms.center.value.x;
  const cy = uniforms.center.value.y;
  const s = planScale(rect);
  chromeCtx.fillStyle = 'rgba(232, 236, 241, 0.55)';
  for (let row = 0; row < DEPTH_H; row += PLAN_STRIDE) {
    for (let col = 0; col < DEPTH_W; col += PLAN_STRIDE) {
      const mm = depth[row * DEPTH_W + col];
      if (mm === 0) continue;
      const z = mm * 0.001;
      // libfreenect2's pinhole model, off the same two uniforms the vertex shader
      // unprojects with.
      const wx = (-(col + 0.5 - cx) / fx) * z;
      const wy = -((row + 0.5 - cy) / fy) * z;
      // All four lateral faces, so the plan does not draw points the renderer discards.
      if (croppedOut(wx, wy, z)) continue;
      // A canted room drawn about the sensor's axes is a slanted section labelled TOP-DOWN.
      planVec.set(wx, wy, -z).applyQuaternion(worldTilt);
      const px = rect.x + rect.w / 2 + (planVec.x - TOP_CENTRE.x) * s;
      const py = rect.y + rect.h / 2 + (planVec.z - TOP_CENTRE.z) * s;
      if (px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h) continue;
      chromeCtx.fillRect(px, py, 1, 1);
    }
  }
}

// Indexed `axis * 2 + side`, side 0 being the low face.
const CROP_FACES = [
  { param: 'left', axis: 0, side: 0, flip: false },
  { param: 'right', axis: 0, side: 1, flip: false },
  { param: 'bottom', axis: 1, side: 0, flip: false },
  { param: 'top', axis: 1, side: 1, flip: false },
  { param: 'far', axis: 2, side: 0, flip: true },
  { param: 'near', axis: 2, side: 1, flip: true },
];

// A corner is three bits, one per axis, set when that axis is at its high bound.
const CROP_EDGES = [];
for (let axis = 0; axis < 3; axis++) {
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  for (const sb of [0, 1]) {
    for (const sc of [0, 1]) {
      const from = (sb << b) | (sc << c);
      CROP_EDGES.push({ from, to: from | (1 << axis), faces: [b * 2 + sb, c * 2 + sc] });
    }
  }
}

// The four corners of each face, in ring order, as indices into the corner array.
const CROP_FACE_CORNERS = CROP_FACES.map(({ axis, side }) => {
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  const base = side << axis;
  return [base, base | (1 << b), base | (1 << b) | (1 << c), base | (1 << c)];
});

const cropCorners = Array.from({ length: 8 }, () => new THREE.Vector3());
const cropSegA = new THREE.Vector3();
const cropSegB = new THREE.Vector3();
const cropCentre = new THREE.Vector3();
const cropNormal = new THREE.Vector3();
const cropProbe = new THREE.Vector3();
const cropEye = new THREE.Vector3();

let cropDrag = null;

/** The box's low and high bounds per axis, in sensor metres. */
function cropBoxBounds() {
  return {
    lo: [uniforms.cropL.value, uniforms.cropB.value, -uniforms.farClip.value],
    hi: [uniforms.cropR.value, uniforms.cropT.value, -uniforms.nearClip.value],
  };
}

/** The eight corners of the box, in the room's frame. The rotation is why this exists. */
function cropBoxCorners() {
  const { lo, hi } = cropBoxBounds();
  for (let i = 0; i < 8; i++) {
    cropCorners[i].set(
      (i & 1) ? hi[0] : lo[0],
      (i & 2) ? hi[1] : lo[1],
      (i & 4) ? hi[2] : lo[2],
    ).applyQuaternion(worldTilt);
  }
  return cropCorners;
}

/** A face's outward normal in the room's frame, written into `out`. */
function cropFaceNormal(face, out) {
  return out
    .set(face.axis === 0 ? 1 : 0, face.axis === 1 ? 1 : 0, face.axis === 2 ? 1 : 0)
    .multiplyScalar(face.side === 1 ? 1 : -1)
    .applyQuaternion(worldTilt);
}

/** How a room-space point lands in the view, in stage pixels. One signature for both views. */
function cropProjector(plan, rect) {
  if (plan) return (p) => planPoint(rect, p.x, p.z);
  const stage = { x: 0, y: 0, ...stageSize() };
  return (p) => projectThrough(p.toArray(), viewCamera, stage);
}

/** A segment of the box, clipped so it can be drawn at all. */
function cropSegment(a, b, plan, rect, project) {
  if (plan) return [project(a), project(b)];
  const va = cropSegA.copy(a).applyMatrix4(viewCamera.matrixWorldInverse);
  const vb = cropSegB.copy(b).applyMatrix4(viewCamera.matrixWorldInverse);
  // View space looks down -z, so a point in front of the near plane has z below it.
  const near = -(viewCamera.near + 1e-4);
  if (va.z > near && vb.z > near) return null;
  if (va.z > near) va.lerp(vb, (va.z - near) / (va.z - vb.z));
  else if (vb.z > near) vb.lerp(va, (vb.z - near) / (vb.z - va.z));
  const { w, h } = stageSize();
  const at = (v) => {
    v.applyMatrix4(viewCamera.projectionMatrix);
    return { x: (w * (v.x + 1)) / 2, y: (h * (1 - v.y)) / 2 };
  };
  return [at(va), at(vb)];
}

/** Sutherland-Hodgman against one half-plane, used for both the near plane and the frame. */
function clipPolygon(points, inside, intersect) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const prev = points[(i + points.length - 1) % points.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) out.push(intersect(prev, cur));
    if (curIn) out.push(cur);
  }
  return out;
}

/** The middle of a projected face: the area centroid, or the mean where there is no area. */
function polygonCentroid(points) {
  if (points.length === 0) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(area) > 1e-6) return { x: cx / (3 * area), y: cy / (3 * area) };
  let mx = 0;
  let my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  return { x: mx / points.length, y: my / points.length };
}

// Below this a face is too edge-on to drag: a metre would travel fewer pixels than this.
const CROP_LEVERAGE_MIN = 6;
const CROP_GRAB_PX = 11;

/** Where each face's handle sits and how far a metre of it travels on screen. */
function cropHandles(plan, rect) {
  if (!showCropBox) return [];
  const corners = cropBoxCorners();
  const project = cropProjector(plan, rect);
  const frame = plan
    ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
    : { x: 0, y: 0, ...stageSize() };
  const near = -(viewCamera.near + 1e-4);
  const out = [];
  for (let f = 0; f < CROP_FACES.length; f++) {
    const face = CROP_FACES[f];
    let poly = CROP_FACE_CORNERS[f].map((i) => corners[i]);
    if (!plan) {
      // Clipped in view space, then projected: a quad straddling the eye has no projection.
      poly = poly.map((p) => p.clone().applyMatrix4(viewCamera.matrixWorldInverse));
      poly = clipPolygon(poly, (p) => p.z <= near, (a, b) => a.clone().lerp(b, (a.z - near) / (a.z - b.z)));
      if (poly.length < 3) continue;
      poly = poly.map((p) => {
        const q = p.clone().applyMatrix4(viewCamera.projectionMatrix);
        return { x: frame.w * (q.x + 1) / 2, y: frame.h * (1 - q.y) / 2 };
      });
    } else {
      poly = poly.map((p) => project(p));
      if (poly.some((p) => !p)) continue;
    }
    for (const [inside, cut] of [
      [(p) => p.x >= frame.x, (a, b) => lerpPoint(a, b, (frame.x - a.x) / (b.x - a.x))],
      [(p) => p.x <= frame.x + frame.w, (a, b) => lerpPoint(a, b, (frame.x + frame.w - a.x) / (b.x - a.x))],
      [(p) => p.y >= frame.y, (a, b) => lerpPoint(a, b, (frame.y - a.y) / (b.y - a.y))],
      [(p) => p.y <= frame.y + frame.h, (a, b) => lerpPoint(a, b, (frame.y + frame.h - a.y) / (b.y - a.y))],
    ]) {
      poly = clipPolygon(poly, inside, cut);
      if (poly.length < 3) break;
    }
    const at = polygonCentroid(poly);
    if (!at) continue;

    // How far one metre along the face's own normal moves that point, as a screen vector.
    const normal = cropFaceNormal(face, cropNormal);
    let centre = cropFaceCentre(f, corners, cropCentre);
    let a = project(centre);
    if (!a) {
      for (const i of CROP_FACE_CORNERS[f]) {
        a = project(corners[i]);
        if (a) { centre = cropCentre.copy(corners[i]); break; }
      }
    }
    if (!a) continue;
    // A quarter of a metre, so the probe stays in front of the camera, and
    // scaled back up after.
    const b = project(cropProbe.copy(centre).addScaledVector(normal, 0.25));
    if (!b) continue;
    const sx = (b.x - a.x) * 4;
    const sy = (b.y - a.y) * 4;
    if (Math.hypot(sx, sy) < CROP_LEVERAGE_MIN) continue;
    out.push({ face: f, param: face.param, at, sx, sy });
  }
  return out;
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The middle of a face, in the room's frame. */
function cropFaceCentre(f, corners, out) {
  const ring = CROP_FACE_CORNERS[f];
  out.set(0, 0, 0);
  for (const i of ring) out.add(corners[i]);
  return out.multiplyScalar(0.25);
}

/** The box, its faces shaded by which way they face, and its handles. */
function drawCropBox(plan, rect) {
  const corners = cropBoxCorners();
  const project = cropProjector(plan, rect);
  const cutting = uniforms.cropOn.value === 1;

  // Front-facing is decided from the eye in the picture and from straight above in the plan.
  if (plan) cropEye.set(0, 1000, 0);
  else viewCamera.getWorldPosition(cropEye);
  const frontFacing = CROP_FACES.map((face, f) => {
    const centre = cropFaceCentre(f, corners, cropCentre);
    const normal = cropFaceNormal(face, cropNormal);
    return normal.dot(cropProbe.copy(cropEye).sub(centre)) > 0;
  });

  chromeCtx.save();
  const hue = cutting ? '240, 176, 74' : '150, 160, 172';
  if (!cutting) chromeCtx.setLineDash([4, 3]);
  for (const edge of CROP_EDGES) {
    const back = !frontFacing[edge.faces[0]] && !frontFacing[edge.faces[1]];
    const seg = cropSegment(corners[edge.from], corners[edge.to], plan, rect, project);
    if (!seg || !seg[0] || !seg[1]) continue;
    chromeCtx.strokeStyle = `rgba(${hue}, ${back ? 0.28 : 0.9})`;
    chromeCtx.lineWidth = back ? 0.75 : 1.2;
    chromeCtx.beginPath();
    chromeCtx.moveTo(seg[0].x, seg[0].y);
    chromeCtx.lineTo(seg[1].x, seg[1].y);
    chromeCtx.stroke();
  }

  chromeCtx.setLineDash([]);
  for (const handle of cropHandles(plan, rect)) {
    const held = cropDrag && cropDrag.param === handle.param;
    chromeCtx.beginPath();
    chromeCtx.rect(handle.at.x - 3.5, handle.at.y - 3.5, 7, 7);
    chromeCtx.fillStyle = '#0d1014';
    chromeCtx.fill();
    chromeCtx.strokeStyle = held ? '#e8ecf1' : `rgba(${hue}, 0.95)`;
    chromeCtx.lineWidth = 1.4;
    chromeCtx.stroke();
  }

  // On the recorder the box is a preview and has to say so.
  if (!plan && !EDITING) {
    chromeCtx.fillStyle = `rgba(${hue}, 0.9)`;
    chromeCtx.font = '9px ui-monospace, Menlo, monospace';
    chromeCtx.fillText('CROP BOX · PREVIEW ONLY, NOT WHAT IS RECORDED', 8, 16);
  }
  chromeCtx.restore();
}

function drawChrome() {
  if (!chromeOn || !chromeStale) return;
  chromeStale = false;
  const { w, h } = stageSize();
  const dpr = Math.min(devicePixelRatio, 2);
  if (chromeCanvas.width !== Math.round(w * dpr) || chromeCanvas.height !== Math.round(h * dpr)) {
    chromeCanvas.width = Math.round(w * dpr);
    chromeCanvas.height = Math.round(h * dpr);
  }
  chromeCanvas.style.width = `${w}px`;
  chromeCanvas.style.height = `${h}px`;
  // Onto the letterboxed stage, so the furniture lands on the pixels it annotates.
  chromeCanvas.style.left = `${stageBox.left}px`;
  chromeCanvas.style.top = `${stageBox.top}px`;
  chromeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  chromeCtx.clearRect(0, 0, w, h);

  const stage = { x: 0, y: 0, w, h };
  const path = pathPoints();

  // Over the picture: the path, its nodes and the shot the program camera has. Editor only.
  if (EDITING) {
    chromeCtx.lineWidth = 1.4;
    chromeCtx.strokeStyle = 'rgba(90, 209, 196, 0.85)';
    strokePolyline(path.map((p) => projectThrough(p, viewCamera, stage)));
    drawBeads(path, (p) => projectThrough(p, viewCamera, stage));
    chromeCtx.strokeStyle = 'rgba(255, 157, 90, 0.9)';
    chromeCtx.lineWidth = 1;
    for (const [a, b] of frustumSegments()) {
      strokePolyline([projectThrough(a, viewCamera, stage), projectThrough(b, viewCamera, stage)]);
    }
    drawNodes((p) => projectThrough(p, viewCamera, stage));
  }

  const rect = insetRect();

  // Outside the `EDITING` branch deliberately: the recorder has a box and no path.
  if (showCropBox) drawCropBox(false, rect);

  if (topViewVisible) {
  chromeCtx.save();
  chromeCtx.beginPath();
  chromeCtx.rect(rect.x, rect.y, rect.w, rect.h);
  chromeCtx.fillStyle = 'rgba(13, 16, 20, 0.92)';
  chromeCtx.fill();
  chromeCtx.clip();

  chromeCtx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  chromeCtx.lineWidth = 1;
  const origin = planPoint(rect, 0, 0);
  for (let m = 1; m <= 6; m++) {
    chromeCtx.beginPath();
    chromeCtx.arc(origin.x, origin.y, m * planScale(rect), Math.PI, 2 * Math.PI);
    chromeCtx.stroke();
  }

  drawPlanCloud(rect);

  if (showCropBox) drawCropBox(true, rect);

  chromeCtx.strokeStyle = 'rgba(90, 209, 196, 0.9)';
  chromeCtx.lineWidth = 1.4;
  strokePolyline(path.map((p) => planPoint(rect, p[0], p[2])));
  drawBeads(path, (p) => planPoint(rect, p[0], p[2]));
  chromeCtx.strokeStyle = 'rgba(255, 157, 90, 0.9)';
  chromeCtx.lineWidth = 1;
  for (const [a, b] of frustumSegments()) {
    strokePolyline([planPoint(rect, a[0], a[2]), planPoint(rect, b[0], b[2])]);
  }
  drawNodes((p) => planPoint(rect, p[0], p[2]));

  chromeCtx.fillStyle = '#e8ecf1';
  chromeCtx.fillRect(origin.x - 3, origin.y - 1.5, 6, 3);

  chromeCtx.restore();
  chromeCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  chromeCtx.lineWidth = 1;
  chromeCtx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  chromeCtx.fillStyle = '#6d7683';
  chromeCtx.font = '9px ui-monospace, Menlo, monospace';
  chromeCtx.fillText('TOP-DOWN', rect.x + 5, rect.y + rect.h - 5);
  }

  // Stats overlay, below the top-down view or in its place when hidden.
  if (statsVisible) {
    const statsY = topViewVisible ? rect.y + rect.h + INSET.margin : rect.y;
    const statsH = 178;
    const statsRect = { x: rect.x, y: statsY, w: rect.w, h: statsH };

    chromeCtx.fillStyle = 'rgba(13, 16, 20, 0.92)';
    chromeCtx.fillRect(statsRect.x, statsRect.y, statsRect.w, statsRect.h);
    chromeCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    chromeCtx.lineWidth = 1;
    chromeCtx.strokeRect(statsRect.x + 0.5, statsRect.y + 0.5, statsRect.w - 1, statsRect.h - 1);

    chromeCtx.font = '9px ui-monospace, Menlo, monospace';
    const lineH = 11;
    const col1 = statsRect.x + 8;
    const col2 = statsRect.x + 90;
    let y = statsRect.y + 12;

    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('PERF', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    chromeCtx.fillText(`${fps.toFixed(1)} fps in`, col2, y); y += lineH;
    gpuTimer.poll(renderer.getContext());
    const gpuMs = gpuTimer.median();
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('gpu', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    // Three states rather than two: a zero would read as free in the two non-measurements.
    chromeCtx.fillText(
      gpuTimer.supported(renderer.getContext())
        ? (gpuMs === null ? 'sampling' : `${gpuMs.toFixed(2)} ms`)
        : 'unavailable',
      col2, y,
    ); y += lineH;
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('viewport', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    chromeCtx.fillText(`${viewportFps.toFixed(1)} fps`, col2, y); y += lineH;
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('renders', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    chromeCtx.fillText(`${counters.renders}`, col2, y); y += lineH;
    if (timeline) {
      const footageFps = timeline.source.count / timeline.source.duration;
      chromeCtx.fillStyle = '#6d7683';
      chromeCtx.fillText('footage', col1, y);
      chromeCtx.fillStyle = '#e8ecf1';
      chromeCtx.fillText(`${footageFps.toFixed(1)} fps`, col2, y); y += lineH;
    }
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('frames in', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    chromeCtx.fillText(`${framesSeen}`, col2, y); y += lineH;

    // Resolution
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('output', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    // The deliverable's size, not the project's shape, because this row is headed output.
    chromeCtx.fillText(`${activeDeliverable?.outputSize ?? '—'}`, col2, y); y += lineH;
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('buffer', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    chromeCtx.fillText(`${Math.round(uniforms.bufferHeight.value)}p`, col2, y); y += lineH;

    // Geometry
    const drawCount = geometry.drawRange.count;
    const shedding = drawCount > POINTS;
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('points', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    chromeCtx.fillText(`${(drawCount / 1000).toFixed(0)}k${shedding ? ' +shed' : ''}`, col2, y); y += lineH;

    // Post effects
    const posts = [afterimage.enabled && 'trail', mosh.enabled && 'mosh',
      bloom.enabled && 'bloom', grade.enabled && 'grade'].filter(Boolean);
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('post', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    chromeCtx.fillText(posts.length ? posts.join(' ') : 'none', col2, y); y += lineH;

    // Timeline
    if (timeline) {
      chromeCtx.fillStyle = '#6d7683';
      chromeCtx.fillText('time', col1, y);
      chromeCtx.fillStyle = '#e8ecf1';
      chromeCtx.fillText(`${timeline.programSec.toFixed(2)}s${timeline.playing ? ' \u25B6' : ''}`, col2, y); y += lineH;
      chromeCtx.fillStyle = '#6d7683';
      chromeCtx.fillText('tracks', col1, y);
      chromeCtx.fillStyle = '#e8ecf1';
      chromeCtx.fillText(`${tracks.size}`, col2, y); y += lineH;
    }

    // Undo
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('undo', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    chromeCtx.fillText(`${history.depth}`, col2, y); y += lineH;

    // Camera position
    chromeCtx.fillStyle = '#6d7683';
    chromeCtx.fillText('cam xyz', col1, y);
    chromeCtx.fillStyle = '#e8ecf1';
    const cp = viewCamera.position;
    chromeCtx.fillText(`${cp.x.toFixed(1)} ${cp.y.toFixed(1)} ${cp.z.toFixed(1)}`, col2, y);
  }

  // Recording indicator: a red outline around the viewport while recording.
  if (recordState.recording) {
    const inset = 2;
    chromeCtx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
    chromeCtx.lineWidth = 4;
    chromeCtx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  }
}

function placeChrome() {
  chromeCanvas.hidden = !chromeOn;
  syncCropOutside();
  if (!chromeOn) return;
  chromeStale = true;
  drawChrome();
}
addEventListener('resize', placeChrome);

// Projected to the screen rather than raycast, so the same code serves both views.
const NODE_GRAB_PX = 9;

/** Where a node lands, in stage pixels, in whichever view is asked for. */
function nodeScreenPoint(position, plan) {
  if (plan) {
    const rect = insetRect();
    return planPoint(rect, position[0], position[2]);
  }
  return projectThrough(position, viewCamera, { x: 0, y: 0, ...stageSize() });
}

/** Which view a pointer is in. The plan wins where they overlap, since it is on top. */
function viewUnder(clientX, clientY) {
  const canvas = renderer.domElement.getBoundingClientRect();
  const x = clientX - canvas.left;
  const y = clientY - canvas.top;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;
  const inset = insetRect();
  const plan = topViewVisible
    && x >= inset.x && x <= inset.x + inset.w && y >= inset.y && y <= inset.y + inset.h;
  return { plan, x, y };
}

function nodeUnder(view) {
  let best = null;
  cameraKeys().forEach((key, i) => {
    const p = nodeScreenPoint(key.value.position, view.plan);
    if (!p) return;
    const d = Math.hypot(p.x - view.x, p.y - view.y);
    if (d <= NODE_GRAB_PX && (!best || d < best.d)) best = { key, i, d, depth: p.z ?? 0 };
  });
  return best;
}

let nodeDrag = null;

// Captured on the window and not the canvas, because OrbitControls listens on the canvas.
addEventListener('pointerdown', (e) => {
  if (!chromeOn || e.target !== renderer.domElement) return;
  // Before the hit test, because the hit carries a depth read through the camera.
  finishOrbitDrift();
  const view = viewUnder(e.clientX, e.clientY);
  if (!view) return;
  const hit = nodeUnder(view);
  if (!hit) return;
  e.preventDefault();
  e.stopPropagation();
  renderer.domElement.setPointerCapture(e.pointerId);
  controls.enabled = false;
  selection = { owner: 'camera', key: hit.key };
  nodeDrag = { plan: view.plan, hit, pointerId: e.pointerId };
}, true);

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!nodeDrag) return;
  const canvas = renderer.domElement.getBoundingClientRect();
  const x = e.clientX - canvas.left;
  const y = e.clientY - canvas.top;
  const p = nodeDrag.hit.key.value.position;
  // The plan view moves a node across the floor and leaves its height alone.
  if (nodeDrag.plan) {
    const world = planWorld(insetRect(), x, y);
    p[0] = world.x;
    p[2] = world.z;
  } else {
    const size = stageSize();
    scratchVec.set((x / size.w) * 2 - 1, 1 - (y / size.h) * 2, nodeDrag.hit.depth).unproject(viewCamera);
    p[0] = scratchVec.x;
    p[1] = scratchVec.y;
    p[2] = scratchVec.z;
  }
  requestRepaint();
});

for (const type of ['pointerup', 'pointercancel']) {
  renderer.domElement.addEventListener(type, () => {
    if (!nodeDrag) return;
    nodeDrag = null;
    controls.enabled = viewCamera === freeCamera;
    history.commit();
  });
}

/** The nearest crop handle to a press, in whichever view the press landed in. */
function cropHandleUnder(view) {
  const rect = insetRect();
  let best = null;
  for (const handle of cropHandles(view.plan, rect)) {
    const d = Math.hypot(handle.at.x - view.x, handle.at.y - view.y);
    if (d <= CROP_GRAB_PX && (!best || d < best.d)) best = { ...handle, d };
  }
  return best;
}

addEventListener('pointerdown', (e) => {
  if (!showCropBox || !chromeOn || nodeDrag) return;
  if (e.target !== renderer.domElement || e.button !== 0) return;
  finishOrbitDrift();
  const view = viewUnder(e.clientX, e.clientY);
  if (!view) return;
  const hit = cropHandleUnder(view);
  if (!hit) return;
  e.preventDefault();
  e.stopPropagation();
  renderer.domElement.setPointerCapture(e.pointerId);
  controls.enabled = false;
  // The projection is read once and held for the gesture.
  cropDrag = {
    param: hit.param,
    face: hit.face,
    sx: hit.sx,
    sy: hit.sy,
    x: view.x,
    y: view.y,
    from: params.get(hit.param),
    pointerId: e.pointerId,
  };
  chromeStale = true;
  requestRepaint();
}, true);

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!cropDrag) return;
  const canvas = renderer.domElement.getBoundingClientRect();
  const x = e.clientX - canvas.left;
  const y = e.clientY - canvas.top;
  // How far the pointer travelled along the face's own normal, in metres.
  const { sx, sy } = cropDrag;
  const metres = ((x - cropDrag.x) * sx + (y - cropDrag.y) * sy) / (sx * sx + sy * sy);
  const face = CROP_FACES[cropDrag.face];
  // Outward is +axis for the high face of a pair and -axis for the low one.
  const coord = face.side === 1 ? metres : -metres;
  params.set(cropDrag.param, cropDrag.from + (face.flip ? -coord : coord));
  chromeStale = true;
  // Never a render here: `renderProgramFrame` advances navigation, so it would ask for another.
  requestRepaint();
});

for (const type of ['pointerup', 'pointercancel']) {
  renderer.domElement.addEventListener(type, () => {
    if (!cropDrag) return;
    cropDrag = null;
    controls.enabled = viewCamera === freeCamera;
    history.commit();
    chromeStale = true;
    requestRepaint();
  });
}

function keyCameraHere() {
  if (!timeline) return;
  const track = trackFor('camera');
  // The pose you are looking from, which makes orbiting to a shot and keying it one gesture.
  finishOrbitDrift();
  freeCamera.updateMatrixWorld(true);
  track.setKey(playheadSec(), {
    position: freeCamera.position.toArray(),
    quaternion: freeCamera.quaternion.toArray(),
    fov: freeCamera.fov,
  }, keyTolerance());
  lanesChanged();
  requestRepaint();
  history.commit();
}
ui.camKey.addEventListener('click', keyCameraHere);
ui.tCamKey?.addEventListener('click', keyCameraHere);

ui.camClear.addEventListener('click', () => {
  const track = tracks.get('camera');
  const key = track?.keyAt(playheadSec(), keyTolerance());
  if (!key) return;
  track.removeKey(key);
  dropTrackIfEmpty('camera');
  lanesChanged();
  requestRepaint();
  history.commit();
});

// How far down the optical axis the orbit target lands.
const SENSOR_VIEW_DISTANCE = 2.2;

/** Puts the free camera where the Kinect is, looking the way the Kinect looks. */
function sensorView() {
  const fx = uniforms.focal.value.x;
  const fy = uniforms.focal.value.y;
  // Half-angles as tangents, which is the form the containment test needs anyway.
  const tanH = (DEPTH_W / 2) / fx;
  const tanV = (DEPTH_H / 2) / fy;
  // Fit rather than fill: `fov` is the vertical angle and the horizontal follows from aspect.
  finishOrbitDrift();
  const aspect = freeCamera.aspect;
  const binding = aspect >= tanH / tanV ? 'vertical' : 'horizontal';
  const fovV = binding === 'vertical' ? 2 * Math.atan(tanV) : 2 * Math.atan(tanH / aspect);
  freeCamera.fov = THREE.MathUtils.radToDeg(fovV);
  freeCamera.position.set(0, 0, 0);
  freeCamera.updateProjectionMatrix();
  params.set('spin', false);
  // Posed in the sensor's frame, not the levelled one: the button means what the sensor shot.
  setNavigationUp(new THREE.Vector3(0, 1, 0).applyQuaternion(worldTilt));
  controls.target.set(0, 0, -SENSOR_VIEW_DISTANCE).applyQuaternion(worldTilt);
  controls.update();
  requestRepaint();
  return {
    fov: freeCamera.fov,
    binding,
    aspect,
    intrinsics: { fx, fy, cx: uniforms.center.value.x, cy: uniforms.center.value.y },
    position: freeCamera.position.toArray(),
    target: controls.target.toArray(),
  };
}

ui.camSensor.addEventListener('click', () => { sensorView(); });

/** Writes both world-rotation controls as one interaction. */
function writeWorldRotation(tilt, roll) {
  writeFromControl('roll', roll);
  writeFromControl('tilt', tilt);
  history.commit();
  requestRepaint();
  return { tilt: params.get('tilt'), roll: params.get('roll') };
}

function resetWorldRotation() {
  return writeWorldRotation(0, 0);
}

ui.camLevelReset.addEventListener('click', () => { resetWorldRotation(); });

ui.cropReset.addEventListener('click', () => {
  params.reset(['left', 'right', 'bottom', 'top', 'crop']);
  requestRepaint();
  history.commit();
});

if (ui.cropFit) {
  ui.cropFit.addEventListener('click', async () => {
    if (!openTakeId) return;
    ui.cropFit.disabled = true;
    try {
      const fitted = await fitCropToTake(openTakeId, params.get('near'), params.get('far'));
      if (!fitted) {
        say('nothing inside the near/far range to fit the box to');
        return;
      }
      requestRepaint();
      history.commit();
      say(`box fitted to ${fitted.frames} frames: `
        + `${fitted.left.toFixed(2)} to ${fitted.right.toFixed(2)} across, `
        + `${fitted.bottom.toFixed(2)} to ${fitted.top.toFixed(2)} up`);
    } catch (err) {
      say(`the crop box could not be fitted to this take: ${err.message}`);
    } finally {
      ui.cropFit.disabled = false;
    }
  });
}

// Show the box, its handles, and what it is cutting. Three effects and one control.
ui.cropBox.addEventListener('click', () => {
  showCropBox = !showCropBox;
  ui.cropBox.setAttribute('aria-pressed', String(showCropBox));
  syncCropOutside();
  chromeStale = true;
  drawChrome();
  requestRepaint();
});
ui.cropBox.setAttribute('aria-pressed', 'false');

/** Mirrored from `VALID_NAME` in `server/export.js`, which is the copy that is enforced. */
const EXPORT_NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const CAN_SAVE_AS = typeof globalThis.showSaveFilePicker === 'function';

/** What the render will be called. The field, or the take's id when it is empty. */
function exportBaseName() {
  const typed = ui.exportName.value.trim();
  return typed || (timeline ? timeline.source.id : 'export');
}

function paintExportName() {
  const typed = ui.exportName.value.trim();
  const ok = typed === '' || EXPORT_NAME_OK.test(typed);
  ui.exportNameChip.classList.toggle('bad', !ok);
  ui.exportGo.disabled = exporting || !ok;
  return ok;
}

/** The typed name, into the document that is supposed to remember it. */
function takeExportName() {
  ensureActiveDeliverable();
  activeDeliverable.name = ui.exportName.value;
  paintDeliverable();
}

ui.exportName.addEventListener('input', () => {
  takeExportName();
  paintExportName();
});

// The last render. `output` is a server path, `href` the same file over HTTP.
let lastExport = null;

// When a copy can be handed over, stated once.
const canSaveExportCopy = () => Boolean(lastExport) && CAN_SAVE_AS && lastExport.frameExt == null;

function paintExportSave() {
  // A sequence is a directory, and this button hands over one file.
  const sequence = lastExport?.frameExt != null;
  ui.exportSave.disabled = !canSaveExportCopy();
  ui.exportSave.title = !CAN_SAVE_AS
    ? 'This browser has no file picker - the render is in the exports directory on the server'
    : sequence
      ? `${lastExport.file} is a directory of ${lastExport.frameExt} frames - it is in the exports directory on the server`
      : (lastExport ? `Save a copy of ${lastExport.file}` : 'Render something first');
}

ui.exportGo.addEventListener('click', async () => {
  if (exporting) return;
  if (!paintExportName()) {
    sayExport('that name would not be a filename - letters, digits, dot, dash and underscore');
    return;
  }
  ui.exportGo.disabled = true;
  lastExport = null;
  paintExportSave();
  const { outputSize } = activeDeliverable || {};
  sayExport(`export ${outputSize ?? '1920x1080'} starting`);
  try {
    const done = await exportClip({
      suppressEffects: [...suppressedEffects],
      onProgress: (n, total) => {
        sayExport(`export ${Math.round((n / total) * 100)}% · frame ${n}/${total}`);
      },
    });
    lastExport = { href: done.href, file: done.href.split('/').pop(), frameExt: done.frameExt ?? null };
    sayExport(`${lastExport.file} · ${done.frames} frames · ${(done.bytes / 1e6).toFixed(1)} MB `
      + `in ${(done.elapsedMs / 1000).toFixed(1)}s`);
  } catch (err) {
    sayExport(`export failed: ${err.message}`);
    showTimelineError(err);
  } finally {
    paintExportName();
    paintExportSave();
  }
});

// Called rather than clicked, by the button beside the render and by Output > Export.
async function saveExportCopy() {
  if (!lastExport) return;
  try {
    // The picker opens before any await: `showSaveFilePicker` needs transient user activation.
    const handle = await globalThis.showSaveFilePicker({ suggestedName: lastExport.file });
    const res = await fetch(lastExport.href);
    if (!res.ok) throw new Error(`the render could not be read back: HTTP ${res.status}`);
    const writable = await handle.createWritable();
    // Streamed rather than buffered, because a 4K render is gigabytes.
    await res.body.pipeTo(writable);
    sayExport(`saved a copy of ${lastExport.file}`);
  } catch (err) {
    // Cancelling the sheet is an answer, not a failure.
    if (err?.name === 'AbortError') return;
    sayExport(`save failed: ${err.message}`);
  }
}

ui.exportSave.addEventListener('click', saveExportCopy);

paintExportSave();

ui.exportSize.addEventListener('change', () => {
  setDeliverableSize(ui.exportSize.value);
});
setProjectAspect(defaultAspect(), { fromDocument: true });

ui.mark.addEventListener('click', () => { markHere().catch(showTimelineError); });

/** `near`/`far` are viewer uniforms and must never reach `--min-depth`/`--max-depth`. */
function paintPreviewRange(minDepth, maxDepth) {
  const kept = Number.isFinite(minDepth) && Number.isFinite(maxDepth)
    ? `capture keeps ${minDepth.toFixed(2)}-${maxDepth.toFixed(2)}m`
    : 'capture keeps everything the sensor resolves';
  ui.recRange.textContent = `preview only · ${kept}`;
}

// Every control that starts a preset gesture, named once so a fifth is covered by being added.
const PRESET_WRITERS = [ui.presetSave, ui.presetExport, ui.presetImport];

let presetGesture = false;

/** One preset gesture at a time, whichever control started it. */
async function withPresetGesture(note, run) {
  if (presetGesture) {
    note.textContent = 'a preset gesture is still running, so this one did not start';
    return false;
  }
  presetGesture = true;
  try {
    await run();
  } finally {
    presetGesture = false;
  }
  return true;
}

/** The controls held down while a request is unanswered, and the caret handed back after. */
async function whileWriting(run) {
  const held = document.activeElement;
  for (const el of PRESET_WRITERS) el.disabled = true;
  try {
    return await run();
  } finally {
    for (const el of PRESET_WRITERS) el.disabled = false;
    const stranded = document.activeElement === null || document.activeElement === document.body;
    if (stranded && PRESET_WRITERS.includes(held) && held.isConnected) held.focus();
  }
}

/** Pick a subset, then do one thing with it, inside the one gesture the program allows. */
async function withPresetSubset(ask, run) {
  await withPresetGesture(ui.note, async () => {
    try {
      const picked = await pickPresetSubset(ask);
      if (!picked) return;
      await whileWriting(() => run(picked));
    } catch (err) {
      showTimelineError(err);
    }
  });
}

// Named by the user: a library whose entries are "preset 3" is one nobody uses twice.
ui.presetSave.addEventListener('click', () => withPresetSubset(
  { title: 'Save this look', verb: 'save', name: appliedPreset?.name ?? 'look-1' },
  async (picked) => {
    const body = presetFromCurrentLook(picked.names);
    const res = await fetch(`/presets/${encodeURIComponent(picked.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const saved = await res.json();
    if (saved.error) throw new Error(saved.error);
    if (wholeLookTag(body.values)) appliedPreset = { name: saved.name, rev: saved.rev };
    await refreshPresets();
    say(`saved ${saved.name} · ${saved.rev.slice(7, 15)}`
      + (wholeLookTag(body.values) ? '' : ` · ${picked.names.length} of ${params.names('look').length} values`));
    history.commit();
  },
));

ui.presetExport.addEventListener('click', () => withPresetSubset(
  {
    title: 'Export this look',
    verb: 'export',
    name: ui.preset.value || appliedPreset?.name || 'look',
  },
  async (picked) => {
    exportPresetFile(picked.name, presetFromCurrentLook(picked.names));
    say(`exported ${picked.name}.braindance-preset.json`);
  },
));

// Two halves of one control: a file input cannot be styled into the strip.
ui.presetImport.addEventListener('click', () => ui.presetFile.click());
ui.presetFile.addEventListener('change', () => {
  const file = ui.presetFile.files?.[0];
  // Cleared before the await, so choosing the same file twice still fires `change`.
  ui.presetFile.value = '';
  if (!file) return;
  return withPresetGesture(ui.note, () => whileWriting(async () => {
    try {
      const saved = await importPresetFile(file);
      await refreshPresets();
      showPickerChoice(pickers.find((p) => p.trigger === ui.preset), saved.name);
      say(`imported ${saved.name} · ${saved.rev.slice(7, 15)}`);
    } catch (err) {
      showTimelineError(err);
    }
  }));
});

/** Save the open edit under a name the operator gives. File > Save as and Shift+Cmd+S. */
async function saveProjectAs() {
  const name = prompt('save this edit as', openedProjectName || `${openTakeId ?? 'clip'}-edit`);
  if (!name) return;
  try {
    // The take is named by content hash, which makes a project a self-contained render job.
    const body = { ...serialiseProject(), take: { id: openTakeId, hash: openTakeHash } };
    const res = await fetch(`/projects/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const saved = await res.json();
    if (saved.error) throw new Error(saved.error);
    openedProjectName = saved.name;
    say(`saved ${saved.name} · ${saved.bytes} bytes`);
    rememberOpened();
  } catch (err) {
    showTimelineError(err);
  }
}

ui.resumeOpen?.addEventListener('click', async () => {
  try {
    const accepted = offeredWorkingBody;
    await loadProjectNamed(WORKING_PROJECT, accepted);
    // Written back before the snapshot is dropped, or recovery lasts only as long as the tab.
    const kept = await writeWorking(accepted);
    if (!kept.ok) throw new Error(`restored on screen, but the auto-save could not be rewritten: ${(await kept.text().catch(() => '')).slice(0, 80)}`);
    if (ui.resume) ui.resume.hidden = true;
    offeredWorkingBody = null;
    say('restored the autosaved edit');
  } catch (err) {
    showTimelineError(err);
  }
});

ui.deliverable?.addEventListener('change', async () => {
  const name = ui.deliverable.value;
  if (!name) return;
  try {
    const doc = await (await fetch(`/deliverables/${encodeURIComponent(name)}`)).json();
    if (doc.error) throw new Error(doc.error);
    applyDeliverable(doc.body);
    showAdoptedDeliverable(name);
    say(`deliverable ${name}`);
  } catch (err) {
    ui.deliverable.value = ui.deliverable.dataset.adopted ?? '';
    showTimelineError(err);
  }
});

ui.deliverableNew?.addEventListener('click', async () => {
  const name = prompt('name this deliverable', `deliverable-${Date.now()}`);
  if (!name) return;
  ensureActiveDeliverable();
  try {
    await saveDeliverable(name, activeDeliverable);
    await refreshDeliverables();
    showAdoptedDeliverable(name);
    say(`saved deliverable ${name}`);
  } catch (err) {
    showTimelineError(err);
  }
});

/** Every element the shell drives, looked up so that a missing one names itself. */
function shellElements(ids) {
  const found = {};
  const missing = [];
  for (const [key, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el === null) missing.push(`#${id}`);
    found[key] = el;
  }
  if (missing.length > 0) {
    const what = `${EDITING ? 'editor' : 'record'} surface is missing ${missing.join(', ')}`;
    if (statusEl !== null) statusEl.textContent = what;
    throw new Error(`${what} - the page cannot finish starting, so nothing below this ran`);
  }
  return found;
}

const shell = shellElements({
  surfaceName: 'surfaceName',
  saveProject: 'menuSaveProject',
  projectSettings: 'menuProjectSettings',
  wholeClip: 'menuWholeClip',
  export: 'menuExport',
  obs: 'menuObs',
  cameraReset: 'menuCameraReset',
  showSidebar: 'menuShowSidebar',
  dockRec: 'dockRec',
  dockMark: 'dockMark',
  dockCentre: 'dockCentre',
  dockSensor: 'dockSensor',
  topView: 'menuTopView',
  lookImport: 'menuLookImport',
  lookExport: 'menuLookExport',
  state: 'menuState',
  effectRackOpen: 'effectRackOpen',
  effectRackPanel: 'effectRackPanel',
  effectRackClose: 'effectRackClose',
  effectRackSearch: 'effectRackSearch',
  effectRackList: 'effectRackList',
  exportClose: 'exportClose',
  projectDialog: 'projectDialog',
  projectClose: 'projectClose',
  projectDone: 'projectDone',
  obsDialog: 'obsDialog',
  obsClose: 'obsClose',
  obsDone: 'obsDone',
  obsProgram: 'obsProgramMode',
  obsViewport: 'obsViewportMode',
  obsResolution: 'obsResolution',
  obsCustomSize: 'obsCustomSize',
  obsBrowserUrl: 'obsBrowserUrl',
  obsWebcamUrl: 'obsWebcamUrl',
  obsCopyBrowser: 'obsCopyBrowser',
  obsCopyWebcam: 'obsCopyWebcam',
  obsOpen: 'obsOpen',
  obsStatus: 'obsStatus',
  obsStatusText: 'obsStatusText',
});

// `menus` is a query rather than an id, so it sits outside the table above.
shell.menus = [...document.querySelectorAll('.appmenu')];

shell.surfaceName.textContent = EDITING ? 'Editor' : 'Record';
for (const control of [
  shell.saveProject, shell.projectSettings, shell.wholeClip, shell.export,
  shell.lookImport, shell.lookExport,
]) {
  control.disabled = !EDITING;
}

function closeApplicationMenus({ restore = false } = {}) {
  for (const menu of shell.menus) {
    const trigger = menu.querySelector('.appmenu-trigger');
    const popover = menu.querySelector('.appmenu-popover');
    const wasOpen = !popover.hidden;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restore && wasOpen) trigger.focus();
  }
}

for (const menu of shell.menus) {
  const trigger = menu.querySelector('.appmenu-trigger');
  const popover = menu.querySelector('.appmenu-popover');
  trigger.addEventListener('click', () => {
    const opening = popover.hidden;
    closeApplicationMenus();
    popover.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) popover.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  });
}

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.appmenu')) closeApplicationMenus();
});

function openDialog(dialog) {
  // A menu command is hidden before the modal opens, and focus cannot be restored to it.
  const active = document.activeElement;
  const returnFocus = active instanceof HTMLElement
    ? active.closest('.appmenu')?.querySelector('.appmenu-trigger') ?? active
    : null;
  closeApplicationMenus();
  if (!dialog.open) {
    const restoreFocus = () => {
      dialog.removeEventListener('close', restoreFocus);
      returnFocus?.focus();
    };
    dialog.addEventListener('close', restoreFocus);
    dialog.showModal();
  }
}

shell.projectSettings.addEventListener('click', () => openDialog(shell.projectDialog));
function closeEffectRack({ restore = false } = {}) {
  shell.effectRackPanel.hidden = true;
  shell.effectRackOpen.setAttribute('aria-expanded', 'false');
  effectRackConfirming = null;
  if (restore) shell.effectRackOpen.focus();
}

function openEffectRack() {
  effectRackConfirming = null;
  shell.effectRackSearch.value = '';
  paintEffectRackDialog();
  shell.effectRackPanel.hidden = false;
  shell.effectRackOpen.setAttribute('aria-expanded', 'true');
  shell.effectRackSearch.focus();
}

shell.effectRackOpen.addEventListener('click', () => {
  if (shell.effectRackPanel.hidden) openEffectRack();
  else closeEffectRack({ restore: true });
});
shell.effectRackClose.addEventListener('click', () => closeEffectRack({ restore: true }));
shell.effectRackSearch.addEventListener('input', () => {
  effectRackConfirming = null;
  paintEffectRackDialog();
});
shell.wholeClip.addEventListener('click', () => {
  closeApplicationMenus();
  clearClipRange();
});
shell.export.addEventListener('click', () => openDialog(ui.exportDialog));
shell.saveProject.addEventListener('click', () => {
  closeApplicationMenus();
  saveProjectAs();
});
shell.lookImport.addEventListener('click', () => {
  closeApplicationMenus();
  ui.presetImport.click();
});
shell.lookExport.addEventListener('click', () => {
  closeApplicationMenus();
  ui.presetExport.click();
});

shell.cameraReset.addEventListener('click', () => {
  closeApplicationMenus();
  finishOrbitDrift();
  controls.reset();
  requestRepaint();
});

/** Collapse the settings to the dock, or bring them back. One writer for one class. */
function setPanelCollapsed(collapsed) {
  document.body.classList.toggle('panelcollapsed', collapsed);
  // "Show inspector" checked means visible, so the boolean inverts.
  shell.showSidebar.setAttribute('aria-checked', String(!collapsed));
  // The cloud's viewport is the window minus the panel, so collapsing changes the canvas.
  resize();
}

shell.showSidebar.addEventListener('click', () => {
  closeApplicationMenus();
  setPanelCollapsed(!document.body.classList.contains('panelcollapsed'));
});

if (new URLSearchParams(location.search).get('panel') === 'collapsed') setPanelCollapsed(true);

// The dock presses the real controls rather than repeating what they do.
shell.dockRec.addEventListener('click', () => ui.recGo.click());
shell.dockMark.addEventListener('click', () => ui.recMark.click());
shell.dockCentre.addEventListener('click', () => shell.cameraReset.click());
shell.dockSensor.addEventListener('click', () => ui.camSensor.click());

shell.topView.addEventListener('click', () => {
  topViewVisible = !topViewVisible;
  shell.topView.setAttribute('aria-checked', String(topViewVisible));
  chromeStale = true;
  drawChrome();
  closeApplicationMenus();
});

function setObsMode(mode) {
  const value = mode === 'viewport' ? 'mirror' : 'camera';
  if (progModeEl.value !== value) {
    progModeEl.value = value;
    progModeEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  shell.obsProgram.setAttribute('aria-pressed', String(value === 'camera'));
  shell.obsViewport.setAttribute('aria-pressed', String(value === 'mirror'));
}

/** The footer's dot, driven by what the server is actually serving. */
const OBS_POLL_MS = 2000;
let obsPollTimer = null;
let obsPollInFlight = false;

async function refreshObsStatus() {
  // One question at a time, or a tick landing on an unanswered one paints the older answer.
  if (obsPollInFlight) return;
  obsPollInFlight = true;
  try {
    const state = await (await fetch('/record/state')).json();
    const webcam = state?.webcam ?? {};
    const n = (webcam.subscribers ?? []).length;
    shell.obsStatus.classList.toggle('live', n > 0);
    // A server with no colour camera is a third state and not a quiet kind of idle.
    shell.obsStatusText.textContent = webcam.unavailable
      ? webcam.unavailable
      : (n === 0
        ? 'idle - nothing is reading'
        : `streaming to ${n} ${n === 1 ? 'source' : 'sources'}`);
  } catch {
    // Say so rather than holding the last answer: a stale count reads as a live stream.
    shell.obsStatus.classList.remove('live');
    shell.obsStatusText.textContent = 'status unavailable';
  } finally {
    obsPollInFlight = false;
  }
}

function startObsStatusPoll() {
  stopObsStatusPoll();
  refreshObsStatus();
  obsPollTimer = setInterval(refreshObsStatus, OBS_POLL_MS);
}

function stopObsStatusPoll() {
  if (obsPollTimer !== null) clearInterval(obsPollTimer);
  obsPollTimer = null;
}

// On the dialog's `close` and not the done button: Escape and the glyph are doors too.
shell.obsDialog.addEventListener('close', stopObsStatusPoll);

function paintObsDialog() {
  shell.obsBrowserUrl.value = new URL('/program', location.href).href;
  shell.obsWebcamUrl.value = new URL('/camera.mjpg', location.href).href;
  for (const option of shell.obsResolution.querySelectorAll('option[data-current]')) option.remove();
  if (![...shell.obsResolution.options].some((option) => option.value === progSizeEl.value)) {
    const option = document.createElement('option');
    option.value = progSizeEl.value;
    option.textContent = `${progSizeEl.value} · current`;
    option.dataset.current = '';
    shell.obsResolution.appendChild(option);
  }
  shell.obsResolution.value = progSizeEl.value;
  shell.obsCustomSize.hidden = true;
  setObsMode(progModeEl.value === 'mirror' ? 'viewport' : 'program');
  startObsStatusPoll();
}

shell.obs.addEventListener('click', () => {
  paintObsDialog();
  openDialog(shell.obsDialog);
});
shell.obsProgram.addEventListener('click', () => setObsMode('program'));
shell.obsViewport.addEventListener('click', () => setObsMode('viewport'));
shell.obsResolution.addEventListener('change', () => {
  // `custom` names no size: it reveals the field beside it and hands it the caret.
  if (shell.obsResolution.value === 'custom') {
    shell.obsCustomSize.hidden = false;
    shell.obsCustomSize.value = progSizeEl.value;
    shell.obsCustomSize.focus();
    shell.obsCustomSize.select();
    return;
  }
  shell.obsCustomSize.hidden = true;
  progSizeEl.value = shell.obsResolution.value;
  progSizeEl.dispatchEvent(new Event('change', { bubbles: true }));
});

shell.obsCustomSize.addEventListener('change', () => {
  progSizeEl.value = shell.obsCustomSize.value;
  progSizeEl.dispatchEvent(new Event('change', { bubbles: true }));
  paintObsDialog();
});

// Into the span, never onto the node that holds it.
function sayObs(message) {
  shell.obsStatusText.textContent = message;
}

async function copyObsValue(input) {
  try {
    await navigator.clipboard.writeText(input.value);
    sayObs('copied');
  } catch {
    input.select();
    const copied = document.execCommand('copy');
    sayObs(copied ? 'copied' : 'copy unavailable');
  }
}

shell.obsCopyBrowser.addEventListener('click', () => copyObsValue(shell.obsBrowserUrl));
shell.obsCopyWebcam.addEventListener('click', () => copyObsValue(shell.obsWebcamUrl));
shell.obsOpen.addEventListener('click', () => {
  globalThis.open(shell.obsBrowserUrl.value, '_blank', 'noopener');
  sayObs('source opened');
});

shell.state.addEventListener('click', () => {
  closeApplicationMenus();
  statsVisible = !statsVisible;
  shell.state.setAttribute('aria-checked', String(statsVisible));
  chromeStale = true;
  drawChrome();
});

shell.exportClose.addEventListener('click', () => ui.exportDialog.close());
shell.projectClose.addEventListener('click', () => shell.projectDialog.close());
shell.projectDone.addEventListener('click', () => shell.projectDialog.close());
shell.obsClose.addEventListener('click', () => shell.obsDialog.close());
shell.obsDone.addEventListener('click', () => shell.obsDialog.close());

addEventListener('keydown', (event) => {
  // Asked first, Escape included: a key another control consumed is not this handler's.
  if (event.defaultPrevented) return;
  if (event.key === 'Escape') {
    if (!shell.effectRackPanel.hidden) {
      event.preventDefault();
      closeEffectRack({ restore: true });
      return;
    }
    closeApplicationMenus({ restore: true });
    return;
  }
  // `isTyping` stays below Escape: shutting a menu is right wherever the caret is.
  if (isTyping(event.target) || !(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === 'o' && EDITING) {
    event.preventDefault();
    location.assign('/gallery');
  } else if (key === 's' && event.shiftKey && EDITING) {
    event.preventDefault();
    saveProjectAs();
  } else if (key === 'e' && EDITING) {
    event.preventDefault();
    shell.export.click();
  }
});

/** Loads a project file onto the open take. This is the untrusted door. */
async function loadProjectNamed(name, offered = null) {
  const doc = offered === null
    ? await (await fetch(`/projects/${encodeURIComponent(name)}`)).json()
    : { body: offered };
  if (doc.error) throw new Error(doc.error);
  const take = doc.body.take;
  if (take && openTakeHash && take.hash && take.hash !== openTakeHash) {
    throw new Error(
      `project ${name} was built on ${take.id} (${take.hash.slice(0, 22)}…) and the open take `
      + `hashes ${openTakeHash.slice(0, 22)}…: this is different footage, so the edit would `
      + 'render against material it was never authored against',
    );
  }
  const gen = takeTransport();
  const resume = timeline ? timeline.playing : false;
  if (resume) timeline.pause();
  restoreProject(doc.body);
  if (suppressedEffects.size) {
    suppressedEffects.clear();
    paintMissingEffects();
  }
  // Restored from the file where it was saved, and otherwise restarted from the document.
  if (doc.body.history) {
    history.stack = [...doc.body.history.stack];
    history.baseline = doc.body.history.baseline;
  } else {
    history.begin();
  }
  // A loaded project gets a default deliverable unless one is selected, so export has a target.
  ensureActiveDeliverable();
  applyDeliverable(activeDeliverable);
  await timeline.seek(timeline.programSec);
  if (resume && gen === transportGen) timeline.play();
  // The working document is crash recovery, not a named edit for the menu to reopen directly.
  openedProjectName = name === WORKING_PROJECT ? null : name;
  say(`opened ${name}`);
  rememberOpened();
  return doc;
}

// Record, mark and remaining time. On the live viewer and nowhere else.
let recordState = { armed: false, recording: false, takeId: null, startedAt: null };

function paintRecord(storage) {
  if (!ui.recGo) return;
  const rec = recordState.recording;
  // A server that cannot record says so on the button rather than failing when pressed.
  const blocked = recordState.cannotRecord ?? null;
  ui.recGo.disabled = Boolean(blocked);
  ui.recGo.title = blocked ?? '';
  ui.recGo.textContent = rec ? 'stop' : 'record';
  ui.recGo.setAttribute('aria-pressed', String(rec));
  ui.recMark.disabled = !rec;
  shell.dockRec.disabled = ui.recGo.disabled;
  shell.dockRec.title = ui.recGo.title;
  shell.dockRec.textContent = ui.recGo.textContent;
  shell.dockRec.setAttribute('aria-pressed', String(rec));
  shell.dockMark.disabled = ui.recMark.disabled;
  const costly = recordState.monitors?.costingTheTake ?? [];
  const monitorWarning = !rec && costly.length
    ? `${costly.length} consumer${costly.length > 1 ? 's are' : ' is'} reading over the network `
      + `(${costly.map((c) => `${c.kind} at ${c.at}`).join(', ')}) - a take will refuse to start until `
      + `monitors are at ÷${recordState.monitors.cap.divisor} ×${recordState.monitors.cap.stride} `
      + 'or coarser and the webcam is detached'
    : null;
  ui.recNote.textContent = blocked ?? monitorWarning ?? (rec
    ? `${recordState.takeId} · ${recordState.frames} frames`
      + (recordState.dropped ? ` · ${recordState.dropped} dropped to a slow disk` : '')
    : (recordState.armed ? 'armed, waiting for the sensor' : 'not recording'));
  if (storage) {
    // A directory that is not there is a different problem from one that is full.
    ui.recSpace.textContent = storage.error ?? `${storage.label} left at current settings`;
    // Load-bearing rather than polish: with manual-only deletion the card genuinely fills.
    ui.recSpace.classList.toggle('low', Boolean(storage.error) || storage.secondsLeft < 15 * 60);
  }
}

// This page's tick of the shared poll, so the record button can ask again at once.
let askRecordState = async () => {};

if (ui.recGo) {
  ui.recGo.addEventListener('click', async () => {
    ui.recGo.disabled = true;
    try {
      // A route that changes something refuses a request that does not declare JSON.
      const res = await fetch(recordState.recording || recordState.armed ? '/record/stop' : '/record/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const body = await res.json();
      if (body.error) ui.recNote.textContent = body.error;
    } finally {
      ui.recGo.disabled = false;
      await askRecordState();
    }
  });
  ui.recMark.addEventListener('click', async () => {
    const body = await (await fetch('/record/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).json();
    ui.recNote.textContent = body.error ?? `${body.label} at ${(body.sourceMs / 1000).toFixed(1)}s`;
  });
}

// Everything below the shooting controls, revealed rather than removed.
function toggleCameraView() {
  const program = viewCamera === freeCamera;
  setViewCamera(program ? programCamera : freeCamera);
  ui.camView.setAttribute('aria-pressed', String(program));
  ui.tCamView?.setAttribute('aria-pressed', String(program));
  requestRepaint();
}
ui.camView.addEventListener('click', toggleCameraView);
ui.tCamView?.addEventListener('click', toggleCameraView);

/** The open take's content hash, which is how a project names its footage. */
let openTakeHash = null;

let takeOpened = false;

async function openTake(id) {
  const source = await IndexedPairSource.open(id);
  const res = await fetch(`/capture/${encodeURIComponent(id)}/hello`);
  if (!res.ok) {
    throw new Error(
      `take ${id} carries no sensor hello (${res.status}): its intrinsics are unknown, and `
      + 'unprojecting it on the boot defaults would put every point out by tens of millimetres '
      + 'with nothing on screen to show it',
    );
  }
  const hello = await res.json();
  // Which generation wrote this, before anything reads a field out of it.
  const wrongFormat = captureFormatRefusal(`take ${id}`, hello.format ?? null);
  if (wrongFormat) throw new Error(wrongFormat);
  // Positive rather than finite, and inside the frame rather than merely a number.
  const usable = hello.fx > 0 && hello.fy > 0
    && hello.cx > 0 && hello.cx < DEPTH_W
    && hello.cy > 0 && hello.cy < DEPTH_H;
  if (!usable) {
    throw new Error(
      `take ${id} has an unusable hello: ${JSON.stringify(hello)} - focal lengths must be `
      + `positive and the centre must lie inside the ${DEPTH_W}x${DEPTH_H} depth frame`,
    );
  }
  uniforms.focal.value.set(hello.fx, hello.fy);
  uniforms.center.value.set(hello.cx, hello.cy);
  // The range this take was shot at, a property of the file rather than of the grabber.
  paintPreviewRange(hello.minDepth, hello.maxDepth);
  detachStream();
  sensorLabel = `take ${id} · ${source.count} frames · ${source.duration.toFixed(2)}s`;
  setStatus();

  pairSource = source;
  timeline = new TimelineTransport(source);
  // A new take gets the whole clip. The window is deliberately not saved anywhere.
  view.fit();
  document.body.classList.add('editing');
  ui.root.hidden = false;
  showInspector();
  chromeOn = true;
  placeChrome();
  openTakeId = id;
  openTakeHash = source.index.hash;
  openedProjectName = null;
  rememberOpened();
  await fitCropToTake(id, params.get('near'), params.get('far'))
    .catch((err) => { say(`the crop box could not be fitted to this take: ${err.message}`); });
  // Awaited, so the first paint of the ruler already has the ticks on it.
  await loadMarks(id);
  // Softly, but never silently.
  const unavailable = [];
  const listed = {};
  for (const [what, refresh] of [['presets', refreshPresets], ['projects', refreshProjects],
    ['deliverables', refreshDeliverables]]) {
    listed[what] = await refresh().catch((err) => { unavailable.push(`${what} (${err.message})`); return null; });
  }
  if (unavailable.length) say(`library unavailable: ${unavailable.join('; ')}`);
  ensureActiveDeliverable();
  applyDeliverable(activeDeliverable);
  timingChanged();
  // The stack starts from whatever the clip already is, so the first undo has
  // somewhere to land.
  history.begin();
  if (listed.projects) offerWorkingDocument(listed.projects);
  // The take's first accurate frame. A repaint, because the playhead may have moved by now.
  await timeline.repaintHere();
  // With the playhead parked `tick` returns at once, so this is what continues a drag.
  renderer.setAnimationLoop(() => { timeline.tick(); pumpParkedDraft(); });
  takeOpened = true;
  return timeline;
}

// A run of capture frames pinned from a file, with no socket and no wall clock.
class PinnedPairSource extends StampedPairSource {
  constructor(buffer) {
    const view = new DataView(buffer);
    const frames = [];
    for (let off = 0; off + 16 <= buffer.byteLength;) {
      const depthBytes = view.getUint32(off, true);
      const colorBytes = view.getUint32(off + 4, true);
      frames.push({
        depth: new Uint16Array(buffer, off + 16, depthBytes / 2),
        stampMs: Number(view.getBigUint64(off + 8, true)),
      });
      off += 16 + depthBytes + colorBytes;
    }
    const first = frames[0].stampMs;
    super(frames.map((f) => (f.stampMs - first) / 1000));
    this.frames = frames;
  }

  makeCurrent(k) {
    bindDepth(this.frames[k].depth);
  }
}

let pinnedPairs = null;

/** Compile every program the look can reach, before the first frame anybody sees. */
function warmPrograms() {
  const was = {
    after: afterimage.enabled, mosh: mosh.enabled, bloom: bloom.enabled, grade: grade.enabled,
  };
  const wasAdditive = uniforms.softEdge.value === 1;
  // A shader that will not compile is not an exception anywhere, which is why this hook exists.
  const linkFailures = [];
  const priorHook = renderer.debug.onShaderError;
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    const log = gl.getProgramInfoLog(program)?.trim() ?? '';
    const stage = gl.getShaderInfoLog(vertexShader)?.trim()
      ? `vertex: ${gl.getShaderInfoLog(vertexShader).trim()}`
      : `fragment: ${gl.getShaderInfoLog(fragmentShader)?.trim() ?? ''}`;
    linkFailures.push(`${log || 'the program did not link'} (${stage})`);
  };
  try {
    afterimage.enabled = true;
    mosh.enabled = true;
    bloom.enabled = true;
    grade.enabled = true;
    // Both blending states: `setAdditive` flips `material.needsUpdate` and blend
    // is its own object.
    setAdditive(!wasAdditive);
    composer.render(0);
    setAdditive(wasAdditive);
    composer.render(0);
  } catch (err) {
    console.warn('could not warm the shader programs:', err.message);
  } finally {
    renderer.debug.onShaderError = priorHook;
    afterimage.enabled = was.after;
    mosh.enabled = was.mosh;
    bloom.enabled = was.bloom;
    grade.enabled = was.grade;
    resetAccumulators();
  }
  if (linkFailures.length) {
    throw shaderLinkFailure(
      `this build's shaders did not compile after the effects changed - ${linkFailures[0]}`,
      linkFailures[0],
    );
  }
}
warmPrograms();

// Which transport owns the loop is decided once, here, and the two are exclusive.
const REQUESTED_TAKE = new URLSearchParams(location.search).get('take');
const REQUESTED_PROJECT = new URLSearchParams(location.search).get('project');

if (EDITING && !REQUESTED_TAKE) {
  location.replace('/gallery');
} else if (EDITING) {
  openTake(REQUESTED_TAKE)
    .catch((err) => {
      sensorLabel = `cannot open take ${REQUESTED_TAKE}`;
      setStatus();
      showTimelineError(err);
      throw err;
    })
    .then(() => (REQUESTED_PROJECT ? loadProjectNamed(REQUESTED_PROJECT) : null))
    .catch((err) => {
      // The take opened and the project did not, so the editor stays on the take.
      if (openTakeId) showTimelineError(new Error(`project ${REQUESTED_PROJECT}: ${err.message}`));
    });
} else if (PROGRAM_OUT) {
  // A live socket like the viewer, and no animation loop, because `handleFrame` draws.
  document.body.classList.add('program-out');
  controls.enabled = false;
  chromeOn = false;
  // `resize()` ran before this branch added program-out, so the canvas sat below no appbar.
  renderer.domElement.style.top = '0px';
  renderer.domElement.style.left = '0px';
  outputSize = { ...programOutSize };
  resize();
  setViewCamera(programCamera);

  programOutReadout = document.createElement('div');
  programOutReadout.id = 'programOutReadout';
  programOutReadout.textContent = 'PROGRAM OUT  waiting for the operator';
  document.body.appendChild(programOutReadout);

  connect();
  // Nothing renders until a frame lands, so OBS would otherwise capture an empty buffer.
  renderProgramFrame(0);
} else {
  // Opened here, because `handleFrame` pushes into the pair source above.
  connect();
  renderer.setAnimationLoop(liveLoop);
  chromeOn = true;
  placeChrome();
  refreshPresets().catch((err) => {
    console.error('preset library unavailable:', err.message);
  });
  paintPreviewRange(NaN, NaN);
  // The remaining-time readout, on the surface an operator watches. Polled, not pushed.
  askRecordState = pollRecordState((state) => {
    recordState = state;
    paintRecord(state.storage);
    chromeStale = true;
    drawChrome();
  });
}

// Handles for profiling and for poking at the scene from the console.
globalThis.__kinect = {
  renderer, composer, scene, freeCamera, programCamera, uniforms, material,
  bloom, afterimage, mosh, grade, geometry, resetAccumulators, renderProgramFrame,

  // A getter and not the object: the object is replaced when navigation's up changes.
  get controls() { return controls; },

  worldTilt: () => cloud.quaternion.toArray(),
  resetWorldRotation,

  /** The installed effects, and the rebuild an install triggers. */
  effects: {
    reload: reloadEffects,
    pollNow: pollEffects,
    packages: () => effectPackages.map((p) => ({ id: p.id, version: p.manifest.version, rev: p.rev })),
    signature: () => effectSignature,
    programs: () => JSON.parse(JSON.stringify(shaderPrograms)),
  },

  // The live cloud's draw-rate cap, in hertz, readable and settable so the rate can be swept.
  get cloudDrawHz() { return cloudDrawHz; },
  set cloudDrawHz(hz) { cloudDrawHz = Number(hz); },

  /** What the GPU spent on recent frames, plus how the reading came about. */
  gpu: () => ({
    supported: gpuTimer.supported(renderer.getContext()),
    timing: statsVisible,
    samples: gpuTimer.samples.length,
    ms: gpuTimer.median(),
  }),

  sensorView,
  surface: () => (EDITING ? 'edit' : 'record'),

  // What the crop planes must clear, from the intrinsics the page unprojects with.
  cropReach,

  cropBoxCorners: () => cropBoxCorners().map((v) => v.toArray()),
  cropHandles: (plan = false) => cropHandles(plan, insetRect())
    .map(({ param, at, sx, sy }) => ({ param, x: at.x, y: at.y, sx, sy })),
  cropBoxShown: () => showCropBox,
  applyProgramOut,
  undoDepth: () => history.depth,
  // `history.begin()` is the last thing `openTake` does that a document can observe.
  takeOpened: () => history.baseline !== null,
  cropOutside: () => uniforms.cropOutside.value,

  // The sizes the export menu offers, and the way to adopt one.
  exportSizes: () => EXPORT_SIZES.flatMap((g) => g.sizes.map(([w, h]) => ({ ratio: g.ratio, w, h }))),
  setOutputSize: (text) => setProjectAspect(aspectOfSize(text), { fromDocument: true })
    && setDeliverableSize(text),
  outputSize: () => ({
    aspect: [...projectAspect],
    size: activeDeliverable?.outputSize ?? null,
  }),

  params, applyPreset,
  readings: () => READINGS.slice(),

  coreLookNames,
  wholeLookNames,
  effectOf,
  effectIds,
  effectParamNames,

  groupRefreshes: () => groupRefreshes,

  keyframes: {
    /** A handle as a tool hands one over, refused rather than repaired. */
    handleFrom(points, side, name) {
      const list = points ?? EASE_OUT_LINEAR;
      const ok = Array.isArray(list) && list.length >= 1
        && list.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
      if (!ok) {
        throw new Error(`${name}'s ${side} is ${JSON.stringify(points)}: since version 5 a handle is a `
          + 'list of control points, so a bare pair means a fixture written against version 4');
      }
      return copyHandle(list);
    },
    /** Writes a whole set of tracks at once. The keys are the tool's, not the page's. */
    setTracks(spec) {
      tracks.clear();
      for (const [name, keys] of Object.entries(spec)) {
        if (keys.length === 0) continue;
        const track = trackFor(name);
        track.keys = keys.map((k) => ({
          t: k.t,
          value: k.value,
          easeOut: this.handleFrom(k.easeOut ?? EASE_OUT_LINEAR, 'easeOut', name),
          easeIn: this.handleFrom(k.easeIn ?? EASE_IN_LINEAR, 'easeIn', name),
        }));
        track.sort();
      }
      lanesChanged();
    },
    setRetime({ rate = 1, keys = [] }) {
      retime.rate = rate;
      // Built, then checked, then stored: the guard reads the handles a key will have.
      const built = keys.map((k) => ({
        t: k.t,
        value: k.value,
        easeOut: this.handleFrom(k.easeOut ?? EASE_OUT_LINEAR, 'easeOut', 'the retime'),
        easeIn: this.handleFrom(k.easeIn ?? EASE_IN_LINEAR, 'easeIn', 'the retime'),
      }));
      retime.assertMonotonic(built);
      retime.keys = built;
      timingChanged();
    },
    /** What a track says at a program position, without rendering anything. */
    valueAt(name, t) { return tracks.get(name)?.valueAt(t) ?? null; },
    names() { return [...tracks.keys()]; },
    toggle: toggleKey,
    lanes: () => laneRows().map((r) => ({ owner: r.owner, kind: r.kind, keys: keysOf(r.owner).length })),
    project: serialiseProject,
    undo: {
      depth: () => history.depth,
      commit: () => history.commit(),
      pop: () => history.undo(),
      begin: () => history.begin(),
    },
    /** The furniture, so a check can prove it is out of the frame and not merely small. */
    chrome: {
      on: () => chromeOn,
      topView: () => topViewVisible,
      set(on) { chromeOn = on; placeChrome(); },
      inset: insetRect,
    },
    camera: {
      keys: () => cameraKeys().map((k) => ({ t: k.t, value: k.value })),
      /** Where a path node lands on screen, which is what a drag has to hit. */
      project(i, plan) { return nodeScreenPoint(cameraKeys()[i].value.position, plan); },
    },
  },
  /** The interaction layer's own state, for a check that drives controls and reads back. */
  editor: {
    clipRange: () => ({ in: clipIn, out: clipOut }),
    setClipRange: (inVal, outVal) => { setClipInOut({ in: inVal, out: outVal }); history.commit(); },
    // The speed slider's travel is logarithmic, so its `value` is a position and not a rate.
    rateSlider: { toValue: sliderFromRate, toRate: rateFromSlider },
    /** The strip's height and what bounds it, so a check can drive the splitter. */
    strip: () => ({
      lanes: parseFloat(getComputedStyle(ui.root).getPropertyValue('--tlanes-h')) || 0,
      stacked: laneStackHeight,
      ceiling: laneHeightCeiling(),
      height: ui.root.getBoundingClientRect().height,
      scrollTop: ui.lanes.scrollTop,
      railScrollTop: ui.railLanes.scrollTop,
      scrollable: ui.lanes.scrollHeight > ui.lanes.clientHeight + 1,
    }),
    stageResizes: () => stageResizes,
    /** The window the strip is drawn against, and the mapping both ways through it. */
    view: {
      window: () => ({
        a: view.a, b: view.b, startSec: view.startSec, endSec: view.endSec,
        spanSec: view.spanSec, duration: view.duration, whole: view.whole,
      }),
      pct: (t) => view.pct(t),
      secAtPct: (p) => view.secAtPct(p),
      set(a, b) { if (view.set(a, b)) viewChanged(); return { a: view.a, b: view.b }; },
      fit() { if (view.fit()) viewChanged(); },
    },
    // The take's marks as the strip draws them, planted without writing a sidecar.
    setMarks(list) {
      takeMarks = list.map((m) => ({ ...m }));
      paintMarks();
      paintMarkButton();
    },
    selection: () => (selection ? { owner: selection.owner, t: selection.key.t } : null),
    select(owner, index) {
      const keys = keysOf(owner);
      selection = keys[index] ? { owner, key: keys[index] } : null;
      lanesChanged();
      return Boolean(selection);
    },
    easeOf: (owner, i) => {
      const k = keysOf(owner)[i];
      return k ? { easeOut: copyHandle(k.easeOut), easeIn: copyHandle(k.easeIn) } : null;
    },
    easePresets: () => Object.keys(EASE_PRESETS),
    easedKinds: () => Object.keys(KINDS).filter((k) => KINDS[k].eases),
    pathBeads: () => beadPoints(pathPoints()),
    shortcuts: () => SHORTCUTS,
    exportName: () => ({ base: exportBaseName(), valid: EXPORT_NAME_OK.source, canSaveAs: CAN_SAVE_AS }),
    lastExport: () => (lastExport ? { ...lastExport } : null),
  },

  setViewCamera,
  viewCamera: () => viewCamera,

  // The timeline, and the counters read instead of taking the transport's word for it.
  timeline: {
    open: openTake,
    transport: () => timeline,
    retime,
    counters,
    /** Resolves once every scheduled repaint has run and the transport's queue has drained. */
    async settled() {
      for (let i = 0; i < 200; i++) {
        // A macrotask, so a repaint on the microtask queue has been enqueued by the
        // time this returns.
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        await timeline?.idle();
        if (!repaintWanted && !repaintBusy && !repaintScheduled && !timeline?.working
          && draftWanted === null && !draftBusy && !orbitRedrawWanted && !orbitSettling) return;
      }
      throw new Error('the transport never settled');
    },
    /** A snapshot, so a reader cannot accidentally hold a live object. */
    read() {
      if (!timeline) return null;
      const t = timeline;
      return {
        frame: t.frame,
        programSec: t.programSec,
        sourceSec: retime.sourceSecAt(t.programSec),
        outputFps: t.outputFps,
        rate: retime.rate,
        duration: t.duration,
        lastFrame: t.lastFrame,
        playing: t.playing,
        drafted: t.drafted,
        settling: orbitSettling,
        lastSeek: t.lastSeek,
        lastCostMs: t.lastCostMs,
        overtaken: t.overtaken,
        behindMs: t.behindMs,
        preroll: t.preroll(),
        applied: t.source.applied,
        cached: t.source.cache.size,
        mixT: uniforms.mixT.value,
        sinceFrameSec: uniforms.sinceFrameSec.value,
        hasColor: uniforms.hasColor.value,
      };
    },
  },

  library: {
    PROJECT_VERSION,
    restoreProject,
    serialiseProject,
    serialiseProjectBody,
    loadProject: loadProjectNamed,
    applyStoredPreset,
    presetFromCurrentLook,
    refreshPresets,
    setActiveDeliverable,
    applyDeliverable,
    activeDeliverable: () => activeDeliverable,
    appliedPreset: () => appliedPreset,
    presetGestureRunning: () => presetGesture,
    missingEffects,
    effectVersionSkew: () => effectVersionSkew.map((s) => ({ ...s })),
    /** The parked pool itself, so a round-trip row can compare what went in and out. */
    parkedLook: () => JSON.parse(JSON.stringify(parkedLook)),
    marks: () => takeMarks.map((m) => ({ ...m })),
    markHere,
    takeId: () => openTakeId,
    takeHash: () => openTakeHash,
    opened: () => takeOpened,
    /** Where each mark ticks on the ruler, as the page actually drew it. */
    markTicks: () => [...document.querySelectorAll('#tMarks .tmk')].map((el) => ({
      left: Number.parseFloat(el.style.left),
      beyond: el.classList.contains('beyond'),
    })),
  },

  export: {
    run: exportClip,
    running: () => exporting,
    rendererClass,
  },

  // Pin the inputs, step the playhead to an exact position, read the pixels back.
  drive: {
    /** Detaches the live loop and feeds a run of capture frame payloads instead. */
    pin(buffer) {
      // Cleared here and not in `pumpParkedDraft`, which a pinned run never reaches.
      draftWanted = null;
      orbitRedrawWanted = false;
      orbitSettling = false;
      renderer.setAnimationLoop(null);
      detachStream();
      pinnedPairs = new PinnedPairSource(buffer);
      pairSource = pinnedPairs;
      // Colour decode is asynchronous, so a pinned run leaves it out rather than racing it.
      uniforms.hasColor.value = 0;
      return pinnedPairs.times.slice();
    },
    /** A colour image the caller supplies, for the one arm that cannot work without one. */
    plantColor,
    times() { return pinnedPairs.times.slice(); },
    /** One frame's depth straight into the current texture, bypassing every pair source. */
    injectDepth(depth) { bindDepth(depth); },
    /** Clears only screen-space history, for a proof arm that keeps surface memory. */
    clearAfterimage() { clearAfterimage(); },
    reset() {
      pinnedPairs?.rewind();
      resetAccumulators();
    },
    stepTo(t) { renderProgramFrame(t); },
    /** Must be called in the same task as the render: the buffer is not preserved. */
    readPixels() {
      const gl = renderer.getContext();
      const { drawingBufferWidth: w, drawingBufferHeight: h } = gl;
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    },
    async hashes(times) {
      const out = [];
      for (const t of times) {
        renderProgramFrame(t);
        const pixels = this.readPixels();
        const digest = await crypto.subtle.digest('SHA-256', pixels);
        out.push(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''));
      }
      return out;
    },
  },

  // Reads the surface memory back off the GPU.
  stateStats() {
    const buf = new Float32Array(POINTS * 4);
    renderer.readRenderTargetPixels(statePrev, 0, 0, DEPTH_W, DEPTH_H, buf);
    let ghosts = 0, hard = 0, soft = 0, fresh = 0;
    const life = uniforms.fadeTime.value + uniforms.wakeTime.value;
    for (let i = 0; i < POINTS; i++) {
      const ghost = buf[i * 4], age = buf[i * 4 + 1], strength = buf[i * 4 + 2];
      if (ghost > 0 && age < uniforms.fadeTime.value + uniforms.wakeTime.value * strength) ghosts++;
      if (age < 0.05) {
        fresh++;
        if (strength > 0.5) hard++; else soft++;
      }
    }
    const pct = (n) => +((n / POINTS) * 100).toFixed(2);
    return { ghostsDrawn: pct(ghosts), swappedLast50ms: pct(fresh), hard: pct(hard), soft: pct(soft), life };
  },
};
