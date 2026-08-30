// The projects page: the list you land on, and the one that says which edit to continue. A row
// shows a picture of the cut and dragging it walks program time rather than one take's frames,
// so the capture changes at a cut. The look does not come along - nothing here holds the grade,
// the effects or the camera, and a project skims as raw geometry.

import { documentNameRefusal } from './format.js';
import { retimeProgramSecAt, retimeSourceSecAt } from './curve.js';
import { createSkim } from './take-draw.js';
import { pickTakes } from './take-picker.js';

// How many clips this build composites. The editor's `CLIP_CEILING` is the gate a document is
// held to; this is the same number said to the picker so a pick cannot make a project the editor
// would then refuse.
const CLIP_CEILING = 8;

// Bounded for the reason `web/library.js` bounds its poll: `/library/all` waits on the capture
// node, and a node that has gone away would otherwise leave the page reading forever.
const LISTING_TIMEOUT_MS = 15000;

const listEl = document.getElementById('list');
const noteEl = document.getElementById('note');
const dlg = document.getElementById('confirm');

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
// The wall clock in the reader's zone; `toISOString` is UTC and reads two hours early.
const stamp = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const say = (text) => { noteEl.textContent = text; };

// Every field `paint` reads, because `paint` runs against this before the first listing lands.
let projects = [];
let localTakes = [];

/** The local take a clip's footage hash names, or null for a clip whose footage is not here. */
const takeFor = (clip) => (clip.take?.hash
  ? localTakes.find((t) => t.hash === clip.take.hash) ?? null
  : null);

/**
 * How much program time a clip runs for.
 *
 * A trim is the answer where the document states one. Where it does not - which is what
 * `serialiseProjectBody` writes for any clip nobody trimmed - the clip runs for everything its
 * curve affords of the take behind it, so the span is knowable only while the take is here. A
 * missing untrimmed clip is a hole of no width, because the document never recorded how long
 * that clip ran; only the footage did.
 */
function spanOf(clip, take) {
  if (clip.length !== null && Number.isFinite(clip.length)) return Math.max(0, clip.length);
  if (!take || !(take.durationSec > 0)) return 0;
  const afforded = retimeProgramSecAt(clip.retime, take.durationSec);
  return Number.isFinite(afforded) ? Math.max(0, afforded) : 0;
}

/** Each clip with where it sits in program time and what it resolved to, in document order. */
function layout(body) {
  return body.clips.map((clip) => {
    const take = takeFor(clip);
    return { clip, take, start: Math.max(0, clip.start), span: spanOf(clip, take) };
  });
}

const lengthOf = (spans) => spans.reduce((a, s) => Math.max(a, s.start + s.span), 0);

/**
 * The clip covering a program second, or null in a gap between clips.
 *
 * The last one covering it, because clips are stored in start order and this build composites up
 * to eight at once - so where two overlap, the one that came in most recently is the one a proxy
 * shows. A render draws them all; this is a picture of the cut rather than a small render of it.
 */
function clipAt(spans, programSec) {
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i];
    if (programSec >= s.start && programSec < s.start + s.span) return s;
  }
  return null;
}

/**
 * The frame of a take a program second lands on. Source seconds become an index through the
 * take's own `frames` and `durationSec`, which is the uniform relation `createSkim`'s `seconds`
 * getter already runs in the other direction - the same approximation the library tile makes,
 * and the right accuracy for a surface that is a proxy rather than a small render.
 */
function frameAt(span, programSec) {
  const { clip, take } = span;
  const sourceSec = retimeSourceSecAt(clip.retime, programSec - span.start);
  if (!Number.isFinite(sourceSec) || !(take.durationSec > 0)) return 0;
  const at = sourceSec / take.durationSec;
  return Math.round(Math.max(0, Math.min(1, at)) * Math.max(0, take.frames - 1));
}

/** The takes a project names and has not got, by the id the document remembers them under. */
const missingIn = (body) => body.clips
  .filter((clip) => clip.take && !takeFor(clip))
  .map((clip) => clip.take.id);

/**
 * Why this page cannot draw a project, or null. `DocumentStore.list` already drops a file that
 * does not parse, and a file that parses into something that is not an edit is a different case:
 * it is listed, so it is this page's to degrade rather than to throw over the whole list.
 */
function bodyRefusal(body) {
  if (!body || typeof body !== 'object') return 'this file does not hold an object';
  if (!Array.isArray(body.clips)) return 'this file carries no clips array, so it is not an edit';
  if (body.clips.some((c) => !c || typeof c !== 'object' || !c.retime
    || !Array.isArray(c.retime.keys) || !Number.isFinite(c.retime.rate))) {
    return 'a clip in it carries no retime curve, so there is no way to place its footage in time';
  }
  return null;
}

/** The shape a project was framed at, as a ratio a person reads. */
const shapeOf = (body) => (Array.isArray(body.aspect) && body.aspect.length === 2
  ? body.aspect.join(':')
  : String(body.outputSize ?? '—'));


async function jsonOf(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

/** A button, built rather than interpolated, because a label is not markup either. */
function addButton(host, label, cls, onClick, { item = null, title = '' } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  if (title) b.title = title;
  b.dataset.act = item ?? label.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  b.addEventListener('click', onClick);
  host.appendChild(b);
  return b;
}


function closeMenus(except = null) {
  for (const menu of document.querySelectorAll('.menu:not([hidden])')) {
    if (menu === except) continue;
    // Focus comes back to the toggle whenever the menu holding it is hidden: hiding an ancestor
    // of the focused element drops focus to the body.
    const toggle = menu.parentElement.querySelector('[aria-haspopup="menu"]');
    const heldFocus = menu.contains(document.activeElement);
    menu.hidden = true;
    toggle?.setAttribute('aria-expanded', 'false');
    if (heldFocus && toggle && !toggle.disabled) toggle.focus();
  }
}

// On `pointerdown` so a button elsewhere is not pressed twice, and captured so a handler that
// stops propagation cannot leave a menu open.
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.menu') || e.target.closest('[aria-haspopup="menu"]')) return;
  closeMenus();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.menu:not([hidden])');
  if (!open) return;
  e.stopPropagation();
  e.preventDefault();
  const toggle = open.parentElement.querySelector('[aria-haspopup="menu"]');
  closeMenus();
  toggle?.focus();
}, true);

/**
 * Puts a menu on the side of its button that has room, and caps it at the room there. Measured
 * on open and bounded by the scroll container's box, which is the list: anchoring it below the ⋯
 * is right for most of the list and wrong for the last row, where the container clips it.
 */
function placeMenu(menu, toggle) {
  const host = menu.offsetParent ?? menu.parentElement;
  const clip = (menu.closest('.list') ?? document.documentElement).getBoundingClientRect();
  const button = toggle.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const GAP = 6;
  const above = button.top - clip.top - GAP;
  const below = clip.bottom - button.bottom - GAP;
  const up = above >= below;
  menu.style.maxHeight = `${Math.max(0, Math.round(up ? above : below))}px`;
  if (up) {
    menu.style.top = 'auto';
    menu.style.bottom = `${Math.round(hostBox.bottom - button.top + GAP)}px`;
  } else {
    menu.style.bottom = 'auto';
    menu.style.top = `${Math.round(button.bottom - hostBox.top + GAP)}px`;
  }
}

function buildMenu(row, toggle, project) {
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.role = 'menu';
  menu.hidden = true;
  const items = [
    { item: 'rename', label: 'Rename…', cls: 'mi', run: () => askRename(project) },
    { item: 'duplicate', label: 'Duplicate', cls: 'mi', run: () => duplicate(project) },
    { item: 'delete', label: 'Delete…', cls: 'mi danger', run: () => askDelete(project) },
  ];
  for (const entry of items) {
    const b = addButton(menu, entry.label, entry.cls, () => {
      closeMenus();
      // An async wrapper and not `Promise.resolve(entry.run())`: a synchronous throw out of
      // `run` escapes the second form entirely, which is a menu item that does nothing and says
      // nothing about why.
      (async () => entry.run())().catch((err) => say(err.message));
    }, { item: entry.item });
    b.dataset.item = entry.item;
    b.role = 'menuitem';
  }
  row.appendChild(menu);
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = menu.hidden;
    closeMenus(menu);
    menu.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) placeMenu(menu, toggle);
  });
  return menu;
}


const openProject = (name) => { location.href = `/edit?project=${encodeURIComponent(name)}`; };

function buildRow(project) {
  const body = project.body;
  const refusal = bodyRefusal(body);
  if (refusal) return buildUnreadableRow(project, refusal);
  const spans = layout(body);
  const length = lengthOf(spans);
  const missing = missingIn(body);

  const row = document.createElement('article');
  row.className = 'row';
  row.dataset.name = project.name;
  row.dataset.rev = project.rev;
  row.dataset.clips = String(body.clips.length);
  row.dataset.missing = String(missing.length);
  row.dataset.length = length.toFixed(3);

  row.innerHTML = `
    <div class="pic">
      <div class="skim"><canvas></canvas><span class="t">00:00</span><span class="hole"></span></div>
      <div class="bar"><span class="done"></span><span class="pos"></span></div>
    </div>
    <div class="meta">
      <div class="top"><span class="name"></span><span class="when"></span></div>
      <div class="facts">
        <span>${body.clips.length} clip${body.clips.length === 1 ? '' : 's'}</span>
        <span class="shape"></span>
        <span>${Number(body.outputFps ?? 30)} fps</span>
        <span>${mmss(length)}</span>
      </div>
      <div class="dark"></div>
    </div>
    <div class="rowacts"></div>`;

  // A project name is text somebody typed and the name rule admits a space: interpolated, it
  // would be markup. The library page has the same note about a take's id, and the reason it
  // has it is that `<img src=x onerror=...>.knct` once ran script on this origin.
  const nameEl = row.querySelector('.name');
  nameEl.textContent = project.name;
  nameEl.title = project.name;
  row.querySelector('.when').textContent = stamp(project.savedAt);
  row.querySelector('.shape').textContent = shapeOf(body);

  if (missing.length) {
    const dark = row.querySelector('.dark');
    const what = document.createElement('span');
    what.className = 'what';
    // Named rather than counted: the person has to know which footage to go and get.
    what.textContent = missing.length === body.clips.length
      ? `No footage here. This project is cut on ${missing.join(', ')}.`
      : `${missing.length} of ${body.clips.length} clips have no footage here: ${missing.join(', ')}.`;
    dark.appendChild(what);
    addButton(dark, 'Open Media library', 'act small', (e) => {
      e.stopPropagation();
      location.href = '/library';
    }, { item: 'to-library' });
  }

  const more = addButton(row.querySelector('.rowacts'), '⋯', 'act more', () => {}, { item: 'more' });
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-label', `More actions for ${project.name}`);
  more.title = 'rename, duplicate and delete';
  buildMenu(row, more, project);

  // Opening is the row's own act, so the row is the control. A role rather than a `<button>`,
  // because the poster inside it is also the scrub surface and a button would put a native
  // activation on the pointer path.
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `Open ${project.name}`);
  row.tabIndex = 0;
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openProject(project.name);
  });
  row.addEventListener('click', (e) => {
    if (e.target.closest('.menu, .act, .skim, .bar')) return;
    openProject(project.name);
  });

  attachSkim(row, spans, length);
  return row;
}

/**
 * A project this page cannot draw, said on its own row. It keeps its name, its date and its
 * menu - deleting or renaming a file this build cannot read is exactly what somebody wants to
 * do about it - and it carries no picture, because there is nothing to place in time.
 */
function buildUnreadableRow(project, refusal) {
  const row = document.createElement('article');
  row.className = 'row';
  row.dataset.name = project.name;
  row.dataset.rev = project.rev;
  row.dataset.unreadable = refusal;
  row.innerHTML = `
    <div class="pic"><div class="skim"><span class="hole"></span></div></div>
    <div class="meta">
      <div class="top"><span class="name"></span><span class="when"></span></div>
      <div class="dark"><span class="what"></span></div>
    </div>
    <div class="rowacts"></div>`;
  row.querySelector('.name').textContent = project.name;
  row.querySelector('.when').textContent = stamp(project.savedAt);
  row.querySelector('.hole').textContent = 'cannot be drawn';
  row.querySelector('.what').textContent = `This project cannot be opened here: ${refusal}.`;
  const more = addButton(row.querySelector('.rowacts'), '\u22ef', 'act more', () => {}, { item: 'more' });
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-label', `More actions for ${project.name}`);
  buildMenu(row, more, project);
  return row;
}

/**
 * The row's picture and its bar. The bar measures the edit rather than a take, which is why the
 * skim is built with no bar at all: `createSkim` fills the one it is given from the position
 * within whichever capture it is drawing, and the capture here changes partway along.
 */
function attachSkim(row, spans, length) {
  const skimEl = row.querySelector('.skim');
  const barEl = row.querySelector('.bar');
  const label = row.querySelector('.t');
  const hole = row.querySelector('.hole');
  const posEl = barEl.querySelector('.pos');
  const doneEl = barEl.querySelector('.done');

  // One block per clip at its own place in program time, so the width of a hole is how much of
  // the edit it costs - visible without dragging anything.
  for (const s of spans) {
    if (!(s.span > 0) || !(length > 0)) continue;
    const seg = document.createElement('span');
    seg.className = `seg${s.take ? '' : ' dark'}`;
    seg.style.left = `${(s.start / length) * 100}%`;
    seg.style.width = `${(s.span / length) * 100}%`;
    seg.dataset.clip = s.clip.id;
    barEl.insertBefore(seg, doneEl);
  }

  const skim = createSkim({
    canvas: row.querySelector('canvas'),
    surface: skimEl,
    onDraw: (n, requested) => {
      if (requested) return;
      // Counted, because "the picture is drawn" is otherwise unobservable from outside.
      row.dataset.draws = String(Number(row.dataset.draws ?? 0) + 1);
    },
  });
  row.__skim = skim;

  // The take on the canvas right now, so a seek inside one clip does not re-`show` and throw the
  // frame away. Identity and not the id: two clips of one take share the object.
  let shown = null;
  let at = 0;

  const seek = (programSec) => {
    at = Math.max(0, Math.min(length, programSec));
    const hit = clipAt(spans, at);
    const take = hit?.take ?? null;
    if (take !== shown) {
      skim.show(take);
      shown = take;
    }
    label.textContent = `${mmss(at)} / ${mmss(length)}`;
    hole.textContent = hit ? (take ? '' : `${hit.clip.take?.id ?? 'this clip'} is not on this machine`) : 'no clip here';
    posEl.style.left = `${length > 0 ? (at / length) * 100 : 0}%`;
    doneEl.style.width = `${length > 0 ? (at / length) * 100 : 0}%`;
    row.dataset.at = at.toFixed(3);
    row.dataset.showing = take?.id ?? '';
    // A take that is not here has no frames, so the skim clears the canvas and goes on answering
    // seeks - which is what makes a hole one behaviour rather than two.
    skim.setIndex(take ? frameAt(hit, at) : 0);
  };

  const fromX = (clientX, el) => {
    const r = el.getBoundingClientRect();
    seek(((clientX - r.left) / r.width) * length);
  };

  // Moving across the picture scrubs; a press that goes nowhere opens the project. Four pixels
  // rather than zero because a finger never holds still - the library tile's gesture, arriving
  // somewhere else.
  let pressX = null;
  let dragged = false;
  skimEl.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && !e.buttons) return;
    if (pressX !== null && Math.abs(e.clientX - pressX) > 4) dragged = true;
    fromX(e.clientX, skimEl);
  });
  skimEl.addEventListener('pointerdown', (e) => {
    skimEl.setPointerCapture(e.pointerId);
    pressX = e.clientX;
    dragged = false;
    fromX(e.clientX, skimEl);
  });
  skimEl.addEventListener('pointerup', (e) => {
    const tap = pressX !== null && !dragged && Math.abs(e.clientX - pressX) <= 4;
    pressX = null;
    if (tap) openProject(row.dataset.name);
  });
  // A captured pointer can end without a `pointerup` - the browser fires `pointercancel` - and
  // `pressX` left set makes the next move over this row scrub with no button held.
  skimEl.addEventListener('pointercancel', () => { pressX = null; dragged = false; });
  skimEl.addEventListener('pointerleave', () => { pressX = null; });
  barEl.addEventListener('pointerdown', (e) => fromX(e.clientX, barEl));
  barEl.addEventListener('pointermove', (e) => { if (e.buttons) fromX(e.clientX, barEl); });

  requestAnimationFrame(() => seek(0));
}


function paint() {
  closeMenus();
  for (const row of listEl.querySelectorAll('.row')) row.__skim?.release();
  listEl.replaceChildren();
  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const p = document.createElement('p');
    p.textContent = 'No projects.';
    empty.appendChild(p);
    listEl.appendChild(empty);
  }
  for (const project of projects) listEl.appendChild(buildRow(project));
  const n = projects.length;
  document.getElementById('sum').innerHTML = `<b>${n}</b> project${n === 1 ? '' : 's'}`;
}

// Which listing is newest: a refresh on the wire when Delete is pressed can resolve later.
let refreshGeneration = 0;

async function refresh() {
  const mine = ++refreshGeneration;
  const [listing, library] = await Promise.all([
    jsonOf('/projects/all'),
    // The library is read for one thing: which take each clip's hash resolves to. A failure here
    // is not a reason to hide the projects, so it degrades to no local takes - which reads as
    // every project being dark, and says so on every row rather than showing an empty page.
    jsonOf('/library/all', { signal: AbortSignal.timeout(LISTING_TIMEOUT_MS) })
      .catch(() => ({ takes: [] })),
  ]);
  if (mine !== refreshGeneration) return;
  localTakes = (library.takes ?? []).filter((t) => t.state !== 'remote');
  // By `savedAt`, newest first, and nothing is stored to know it: the listing carries the file's
  // mtime and every edit autosaves, so the project at the top is the one last worked on.
  projects = [...(listing.projects ?? [])].sort((a, b) => b.savedAt - a.savedAt);
  paint();
}


const names = () => new Set(projects.map((p) => p.name));

/** The next free `Untitled N`. A name allocation and not a count: `Untitled 2` can be free. */
function nextUntitled(taken) {
  for (let n = 1; ; n++) {
    if (!taken.has(`Untitled ${n}`)) return `Untitled ${n}`;
  }
}

/**
 * Finder's rule: `Untitled 4` becomes `Untitled 4 copy`, then `copy 2`, `copy 3`. A copy of a
 * copy keeps the one base rather than growing `copy copy`.
 */
function copyName(name, taken) {
  const already = /^(.*) copy(?: (\d+))?$/.exec(name);
  const base = already ? already[1] : name;
  if (!taken.has(`${base} copy`)) return `${base} copy`;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base} copy ${n}`)) return `${base} copy ${n}`;
  }
}

/**
 * Creates a document under the first free name `pick` offers, and again under the next one if the
 * server says that name is taken.
 *
 * `rev=absent` is what makes this safe rather than the listing being fresh: two tabs both
 * choosing `Untitled 1` are answered by the file, so the loser is told and takes the next name.
 * Bounded, because a create that keeps being refused for some other reason is a loop.
 */
async function createUnder(pick, body) {
  const taken = names();
  for (let tries = 0; tries < 12; tries++) {
    const name = pick(taken);
    const res = await fetch(`/projects/${encodeURIComponent(name)}?rev=absent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const answer = await res.json().catch(() => null);
    if (res.ok && !answer?.error) return name;
    if (res.status !== 409) throw new Error(answer?.error ?? `HTTP ${res.status}`);
    // The name went while this was being decided. Take it out of the reckoning and try the next.
    taken.add(name);
  }
  throw new Error('twelve names in a row were taken while this copy was being made');
}

async function duplicate(project) {
  say('');
  const to = await createUnder((taken) => copyName(project.name, taken), project.body);
  // Landing in the copy: forking is how somebody declines to keep something once there is no
  // save to withhold, so the copy is where the next edit is going.
  openProject(to);
}


let confirmAction = null;
document.getElementById('cCancel').addEventListener('click', () => dlg.close());
document.getElementById('cGo').addEventListener('click', () => {
  dlg.close();
  Promise.resolve(confirmAction?.()).catch((err) => say(err.message));
});

function askDelete(project) {
  const body = document.getElementById('cBody');
  body.innerHTML = '<b class="pid"></b>';
  body.querySelector('.pid').textContent = project.name;
  document.getElementById('cWarn').textContent = 'Footage is kept. This cannot be undone.';
  document.getElementById('cGo').textContent = 'Delete';
  document.getElementById('cGo').disabled = false;
  // The rev goes with it, so a confirm built against one listing cannot delete a project that
  // has moved on since it was drawn.
  confirmAction = async () => {
    // The JSON content type is load-bearing on every route that changes something, DELETE
    // included: a page you merely visit can send a cross-origin request without asking
    // permission, but it cannot declare `application/json` while doing it.
    const res = await fetch(`/projects/${encodeURIComponent(project.name)}?rev=${encodeURIComponent(project.rev)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    const answer = await res.json().catch(() => null);
    if (!res.ok || answer?.error) throw new Error(answer?.error ?? `HTTP ${res.status}`);
    await refresh();
  };
  dlg.showModal();
}


const renameDlg = document.getElementById('rename');
const renameInput = document.getElementById('pName');
const renameWhy = document.getElementById('pWhy');
const renameGo = document.getElementById('pGo');
let renaming = null;

/**
 * The rename box, and a modal rather than `window.prompt` because a name is typed and the
 * refusal has to be readable while it is being typed. `documentNameRefusal` comes from
 * `web/format.js`, which `server/library.js` imports too: the server's copy is the gate and this
 * one greys the button out early.
 */
function askRename(project) {
  renaming = project;
  renameInput.value = project.name;
  validateRename();
  renameDlg.showModal();
  renameInput.focus();
  renameInput.select();
}

function validateRename() {
  if (!renaming) return false;
  const typed = renameInput.value.trim();
  let why = documentNameRefusal('project', typed) ?? '';
  if (!why && typed === renaming.name) why = 'that is already its name';
  else if (!why && names().has(typed)) why = `${typed} is taken by another project`;
  renameWhy.textContent = why;
  renameInput.classList.toggle('bad', Boolean(why) && Boolean(typed));
  renameGo.disabled = Boolean(why);
  return !why;
}

renameInput.addEventListener('input', validateRename);
renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && validateRename()) commitRename();
});
document.getElementById('pCancel').addEventListener('click', () => renameDlg.close());
renameGo.addEventListener('click', () => commitRename());

async function commitRename() {
  if (!validateRename()) return;
  const project = renaming;
  const to = renameInput.value.trim();
  renameDlg.close();
  say('');
  try {
    // One call rather than create-then-delete, which would leave a window with the project filed
    // under both names. The rev is the one the listing gave, so a tab that renamed first wins.
    await jsonOf(`/projects/${encodeURIComponent(project.name)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, rev: project.rev }),
    });
    await refresh();
  } catch (err) {
    say(err.message);
  }
}


document.getElementById('newProject').addEventListener('click', async () => {
  say('');
  const takes = await pickTakes({
    ceiling: CLIP_CEILING,
    title: 'New project',
    confirmLabel: 'Make the project',
  });
  if (!takes) return;
  // The editor mints the document, because the body carries a look block whose parameter list is
  // the live registry's - this page has no registry and a copy of one would be the second
  // implementation this repo refuses. So the picked takes travel by id, in pick order, and the
  // page that can write a valid document writes it.
  location.href = `/edit?new=${takes.map((t) => encodeURIComponent(t.id)).join(',')}`;
});


try {
  await refresh();
} catch (err) {
  say(`the projects could not be listed: ${err.message}`);
  paint();
}

// Everything a proof tool reads off this page, as the page's own state rather than as a scrape.
globalThis.__projects = {
  state: () => ({ projects, localTakes }),
  refresh,
  nextUntitled: () => nextUntitled(names()),
  copyName: (name) => copyName(name, names()),
  emptyLine: () => listEl.querySelector('.empty p')?.textContent ?? null,

  rows: () => [...listEl.querySelectorAll('.row')].map((el) => ({
    name: el.dataset.name,
    rev: el.dataset.rev,
    clips: Number(el.dataset.clips),
    missing: Number(el.dataset.missing),
    length: Number(el.dataset.length),
    when: el.querySelector('.when').textContent,
    facts: [...el.querySelectorAll('.facts span')].map((s) => s.textContent),
    dark: el.querySelector('.dark .what')?.textContent ?? null,
    darkAct: el.querySelector('.dark .act')?.textContent ?? null,
    segments: [...el.querySelectorAll('.bar .seg')].map((s) => ({
      clip: s.dataset.clip, left: s.style.left, width: s.style.width, dark: s.classList.contains('dark'),
    })),
    menu: [...el.querySelectorAll('.menu .mi')].map((b) => b.dataset.item),
  })),

  // The take on the canvas right now, which is the whole of what "the skim crosses a cut" means.
  showing: (name) => {
    const el = listEl.querySelector(`.row[data-name="${CSS.escape(name)}"]`);
    return el ? { take: el.dataset.showing, at: Number(el.dataset.at), hole: el.querySelector('.hole').textContent } : null;
  },

  draws: (name) => Number(listEl.querySelector(`.row[data-name="${CSS.escape(name)}"]`)?.dataset.draws ?? 0),

  async drawn(name, atLeast = 1) {
    for (let i = 0; i < 200; i++) {
      if (this.draws(name) >= atLeast) return this.draws(name);
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error(`row ${name} never drew ${atLeast} frames`);
  },

  /** Drags the row's picture to a fraction of the edit and answers with what it landed on. */
  async skimTo(name, t) {
    const el = listEl.querySelector(`.row[data-name="${CSS.escape(name)}"]`);
    const skim = el.querySelector('.skim');
    const r = skim.getBoundingClientRect();
    skim.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: r.left + r.width * t, clientY: r.top + r.height / 2, bubbles: true, pointerId: 1,
    }));
    // The picture only lands after a fetch, so the caller waits on a draw rather than on this.
    return {
      take: el.dataset.showing,
      at: Number(el.dataset.at),
      label: el.querySelector('.t').textContent,
      hole: el.querySelector('.hole').textContent,
      draws: this.draws(name),
    };
  },

  // Two frames a second apart have almost the same mean, so only the signature sees a change.
  picture(name) {
    const canvas = listEl.querySelector(`.row[data-name="${CSS.escape(name)}"] canvas`);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let h = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i];
      h = Math.imul(h ^ data[i], 16777619) >>> 0;
    }
    return { mean: sum / (data.length / 4), signature: h.toString(16) };
  },

  openMenu: (name) => {
    const el = listEl.querySelector(`.row[data-name="${CSS.escape(name)}"]`);
    if (el.querySelector('.menu').hidden) el.querySelector('.act.more').click();
    const menu = el.querySelector('.menu');
    const box = menu.getBoundingClientRect();
    const clip = listEl.getBoundingClientRect();
    return {
      open: !menu.hidden,
      items: [...menu.querySelectorAll('.mi')].map((b) => ({ item: b.dataset.item, label: b.textContent })),
      inside: box.top >= clip.top - 0.5 && box.bottom <= clip.bottom + 0.5,
    };
  },
  clickMenuItem: (name, item) => {
    const el = listEl.querySelector(`.row[data-name="${CSS.escape(name)}"]`);
    if (el.querySelector('.menu').hidden) el.querySelector('.act.more').click();
    el.querySelector(`.mi[data-item="${item}"]`).click();
  },

  rename: {
    type: (text) => {
      renameInput.value = text;
      renameInput.dispatchEvent(new Event('input', { bubbles: true }));
      return { why: renameWhy.textContent, blocked: renameGo.disabled, bad: renameInput.classList.contains('bad') };
    },
    commit: () => { renameGo.click(); },
    isOpen: () => renameDlg.open,
    close: () => renameDlg.close(),
  },

  confirm: () => ({
    open: dlg.open,
    title: document.getElementById('cTitle').textContent,
    body: document.getElementById('cBody').textContent,
    warn: document.getElementById('cWarn').textContent,
  }),
  confirmGo: () => { document.getElementById('cGo').click(); },
  confirmCancel: () => { document.getElementById('cCancel').click(); },

  newProject: () => { document.getElementById('newProject').click(); },
  note: () => noteEl.textContent,
};
