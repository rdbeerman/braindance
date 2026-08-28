// The render queue: jobs on disk, claimed by workers, one at a time. A job is a project body, the
// captures its clips are cut on named by content hash, and output settings, so it is
// self-contained. It is pinned to the renderer class that ran it, because bit-exactness does not
// survive a different GPU and a project names its footage by hash so that a re-render reproduces
// the original.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateExport } from './export.js';
import { listJsonNames } from './library.js';
import { effectIdsIn, requiresEntryRefusal, requiresListRefusal } from '../web/format.js';

// 2 since a job carries one hash per clip where it used to carry a single capture. The worker
// refuses an envelope from another version rather than reading a field that is not there.
export const JOB_VERSION = 2;

const VALID_JOB_ID = /^job-[0-9a-f]{16}$/;

/** What a capture may be named by. An id is a filename; only the hash names the bytes. */
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;

export const STATES = ['queued', 'running', 'done', 'failed'];

const isTerminal = (state) => state === 'done' || state === 'failed';

// Whether a worker of class `have` may run a job pinned to `want`. Exact strings, because the
// failure guarded against is two rasterisers that nearly agree.
export const rendererMatches = (want, have) => want === null || want === undefined || want === have;

// The comparison above is `===`, so a non-string pins a job to something no worker can equal.
const MAX_RENDERER_CHARS = 256;
const validRenderer = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_RENDERER_CHARS;

// What expires is the silence rather than the job, because a render may run for hours.
export const STALE_MS = 120_000;

export class JobStore {
  constructor(dir, { now = Date.now, staleMs = STALE_MS } = {}) {
    this.dir = dir;
    this.now = now;
    this.staleMs = staleMs;
    // Every state transition goes through here, one at a time: `claim` and `finish` both have
    // an `await` between the decision and the write, so without this two workers claim one job.
    this.gate = Promise.resolve();
    // The chain advances even when `fn` rejects, or one refused claim would wedge the queue.
    this.serialise = (fn) => {
      const run = this.gate.then(fn, fn);
      this.gate = run.then(() => {}, () => {});
      return run;
    };
    this.writes = 0;
  }

  pathFor(id) {
    if (!VALID_JOB_ID.test(id)) throw new Error(`unusable job id ${JSON.stringify(id)}`);
    return join(this.dir, `${id}.json`);
  }

    // Two enqueues inside one millisecond hash the same, which is why `enqueue` salts.
  idFor(record) {
    const h = createHash('sha256').update(JSON.stringify(record)).digest('hex');
    return `job-${h.slice(0, 16)}`;
  }

  async list() {
    // Absent really is empty, but only absent: swallowing every failure parked the worker on an
    // unreadable directory and let `enqueue` write a duplicate into it.
    const files = await listJsonNames(this.dir, { what: 'job queue directory' });
    const out = [];
    for (const file of files) {
      try {
        out.push(JSON.parse(await readFile(join(this.dir, file), 'utf8')));
      } catch { /* a job record this build cannot read is not a reason to hide the rest */ }
    }
    return out;
  }

  async read(id) {
    return JSON.parse(await readFile(this.pathFor(id), 'utf8'));
  }

  // Written aside and renamed, or a crash leaves a file describing a job nobody enqueued.
  async #put(job) {
    const path = this.pathFor(job.id);
    this.writes++;
    await mkdir(this.dir, { recursive: true });
    const text = `${JSON.stringify(job, null, 2)}\n`;
    await writeFile(`${path}.tmp`, text);
    await rename(`${path}.tmp`, path);
    return job;
  }

  /** Enqueue a render. A capture named by anything but content hash is refused. */
  async enqueue({ project, deliverable = null, captures, renderer = null, output, width, height, fps, codec = 'h264', suppressEffects = [] }) {
    // The document *body*, never the store's `{ name, rev, body }` envelope.
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new Error('a job needs a project document body');
    }
    if (project.version === undefined) {
      throw new Error(
        'a job\'s project has no version, so it is the store envelope rather than the document body: '
        + 'pass what serialiseProjectBody() returns, not { name, rev, body }',
      );
    }
    if (!Array.isArray(captures) || captures.length === 0
      || !captures.every((h) => typeof h === 'string' && CONTENT_HASH.test(h))) {
      throw new Error(
        `a job names its captures by content hash, one per clip, got ${JSON.stringify(captures)}`,
      );
    }
    if (renderer !== null && renderer !== undefined && !validRenderer(renderer)) {
      throw new Error(
        `a job pins its renderer class as a string of at most ${MAX_RENDERER_CHARS} characters, `
        + `got ${JSON.stringify(renderer)} - and a pin nothing can equal is a job nothing can claim`,
      );
    }
    const clipList = Array.isArray(project.clips) ? project.clips : [];
    // Derived from the clips rather than copied from the caller, for the reason `requires` is:
    // the caller's list is a claim about the document rather than the document, and a claim that
    // disagrees with it is answered here by name rather than a browser and a minute of GPU later.
    // One entry per clip and in project order, repeats kept: two clips of one take is an edit this
    // list has to be able to spell, and two clips whose footage is swapped is a different edit that
    // has to read differently.
    const cut = clipList.map((clip) => (clip && typeof clip === 'object' && !Array.isArray(clip)
      ? clip.take?.hash : undefined));
    const takeless = cut
      .map((hash, at) => (typeof hash === 'string' && CONTENT_HASH.test(hash) ? null : at))
      .filter((at) => at !== null);
    if (clipList.length === 0 || takeless.length) {
      throw new Error(clipList.length === 0
        ? 'a job\'s project holds no clips, so there is no footage for this render to be against'
        : `a job's project has ${takeless.length} clip(s) naming no content hash to be cut on, at `
          + `position ${takeless.join(', ')}: a clip with nothing to draw is one the page refuses `
          + 'once the browser is already open, and the queue can say it before that costs anything');
    }
    const short = (hash) => `${String(hash).slice(0, 22)}…`;
    if (captures.length !== cut.length || captures.some((hash, at) => hash !== cut[at])) {
      throw new Error(
        'a job disagrees with its own project about the footage it renders, so the queue cannot say '
        + `what this render is against: the job names ${captures.map(short).join(', ')} and its `
        + `clips are cut on ${cut.map(short).join(', ')} - the list is one entry per clip in project `
        + 'order, so a different length or a different order is a hand edit to finish before the '
        + 'job is queued',
      );
    }
    // Derived from the look's own namespaces rather than copied from `project.requires`, which is
    // caller data - an empty list used to be recorded as one, and the refusal then arrived from
    // `restoreProject` a browser and a minute of GPU later.
    const shape = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : []);
    // Both blocks, because an effect binding the cloud is a clip's and one binding the grade is
    // the project's: reading `look` alone would call every point effect unclaimed.
    const blocks = [project.look, ...clipList];
    const used = effectIdsIn(blocks.flatMap((b) => [...shape(b?.params), ...shape(b?.tracks)]));
    if (project.requires !== undefined) {
      const listShape = requiresListRefusal('a job\'s project', project.requires);
      if (listShape) throw new Error(listShape);
      for (const entry of project.requires) {
        const bad = requiresEntryRefusal('a job\'s project', entry);
        if (bad) throw new Error(bad);
      }
    }
    const carried = project.requires ?? [];
    const claimed = carried.map((e) => (e && typeof e === 'object' ? e.id : undefined));
    // The comparisons below read membership and a set, so neither can see a repeated id.
    const duplicated = [...new Set(
      claimed.filter((id, at) => typeof id === 'string' && claimed.indexOf(id) !== at),
    )];
    if (duplicated.length) {
      throw new Error(
        `a job's project claims ${duplicated.join(', ')} more than once in its requires list, so there is no `
        + 'one answer to which version of ' + (duplicated.length === 1 ? 'that effect' : 'those effects')
        + ' this render needs - the list is derived from the values on save, one entry per effect, and a '
        + 'repeat is a hand edit to finish before the job is queued',
      );
    }
    const unlisted = used.filter((id) => !claimed.includes(id));
    const unclaimed = [...new Set(claimed)].filter((id) => typeof id === 'string' && !used.includes(id));
    if (unlisted.length || unclaimed.length) {
      throw new Error(
        'a job\'s project disagrees with its own requires list, so the queue cannot say what this '
        + `render needs: ${[
          unlisted.length ? `it names ${unlisted.join(', ')} values that the list does not claim` : null,
          unclaimed.length ? `the list claims ${unclaimed.join(', ')} and no value is named under ${unclaimed.length === 1 ? 'it' : 'them'}` : null,
        ].filter(Boolean).join(', and ')} - the list is derived from the values on save, so a gap `
        + 'between them is a hand edit to finish before the job is queued',
      );
    }
    const requires = used.map((id) => ({ ...carried.find((e) => e?.id === id) }));
    // Unlike `requires` this is the caller's, because it is a decision rather than a fact.
    if (!Array.isArray(suppressEffects)
      || !suppressEffects.every((id) => typeof id === 'string' && /^[a-z][a-z0-9]*$/.test(id))) {
      throw new Error(
        `a job's suppressEffects is a list of effect ids, got ${JSON.stringify(suppressEffects)} - `
        + 'an id is lowercase letters and digits, the prefix an effect\'s parameters carry',
      );
    }
    const { width: w, height: h, fps: f } = validateExport({ name: output, width, height, fps, codec });
    return this.serialise(async () => {
      const live = await this.list();
      // Two jobs writing one file is one job's work thrown away. A finished job's name is free
      // again, because replacing an export you already have is what re-exporting means.
      const holder = live.find((j) => j.output === String(output) && (j.state === 'queued' || j.state === 'running'));
      if (holder) {
        throw new Error(`output ${JSON.stringify(String(output))} is already reserved by ${holder.id} (${holder.state}), and two jobs writing one file is one render thrown away`);
      }
      const created = this.now();
      const body = {
        version: JOB_VERSION,
        project,
        deliverable,
        requires,
        suppressEffects: [...suppressEffects],
        captures: [...cut],
        renderer: renderer ?? null,
        output: String(output),
        artifactPath: null,
        width: w,
        height: h,
        fps: f,
        codec,
        state: 'queued',
        created,
        claimed: null,
        finished: null,
        worker: null,
        error: null,
        attempts: 0,
        lease: null,
      };
      // The salt is the collision counter rather than random, keeping the id a
      // function of the record.
      let id = this.idFor({ ...body, salt: 0 });
      for (let salt = 1; live.some((j) => j.id === id); salt++) id = this.idFor({ ...body, salt });
      return this.#put({ id, ...body });
    });
  }

  // Hand the oldest claimable job to a worker of this class, or a refusal naming what blocked it -
  // a queue this worker cannot run is a different answer from an empty queue.
  claim({ worker, renderer }) {
    if (!validRenderer(renderer)) {
      return Promise.reject(new Error(
        'a worker claims with the renderer class it will render on, as a string of at most '
        + `${MAX_RENDERER_CHARS} characters, not ${JSON.stringify(renderer ?? null)}`,
      ));
    }
    return this.serialise(async () => {
      const all = (await this.list()).filter((j) => j.state === 'queued').sort((a, b) => a.created - b.created);
      const mine = all.filter((j) => rendererMatches(j.renderer, renderer));
      if (mine.length === 0) {
        const blocked = all.map((j) => ({ id: j.id, wants: j.renderer }));
        return { job: null, blocked, queued: all.length };
      }
      const job = mine[0];
      job.state = 'running';
      job.claimed = this.now();
      // So a worker that dies before its first heartbeat still gets the full window.
      job.heartbeat = job.claimed;
      job.worker = worker ?? null;
      job.attempts += 1;
      // A token the finisher has to present, random rather than derived because the read routes
      // strip it and keep every other field a forger would need.
      job.lease = randomBytes(16).toString('hex');
      job.renderer = renderer;
      await this.#put(job);
      return { job, blocked: [], queued: all.length };
    });
  }

  // Report an outcome against the lease the claim handed out. Running inside the gate is what
  // stops two reports both passing the terminal-state guard.
  finish(id, { state, error = null, output = null, frames = null, lease = null }) {
    return this.serialise(async () => {
      if (state !== 'done' && state !== 'failed') throw new Error(`a job finishes done or failed, not ${state}`);
      if (output !== null && typeof output !== 'string') throw new Error('a job\'s output is a string or nothing');
      const job = await this.read(id);
      if (isTerminal(job.state)) {
        throw new Error(`job ${id} is already ${job.state}, so this report is from a worker that lost a race`);
      }
      if (job.state !== 'running') {
        throw new Error(`job ${id} is ${job.state}, so nothing is rendering it and there is no outcome to report`);
      }
      // `job.lease &&` accepted a report from anybody when the lease was missing, and a record is
      // a file a hand or an older build can write.
      if (typeof job.lease !== 'string' || job.lease === '') {
        throw new Error(`job ${id} says it is running with no lease, which is not a state a claim can produce - the record is unusable rather than finishable`);
      }
      if (lease !== job.lease) {
        throw new Error(`job ${id} is held by another claim, so this report is not the one running it`);
      }
      job.state = state;
      job.error = error;
      job.finished = this.now();
      job.lease = null;
      // Kept apart from `output` so the output *name* stays the base name a retry can ask for.
      if (typeof output === 'string' && output.length > 0) job.artifactPath = output;
      if (Number.isFinite(frames)) job.frames = frames;
      return this.#put(job);
    });
  }

  // Put a finished-or-running job back on the queue, still pinned to its renderer class.
  requeue(id) {
    return this.serialise(async () => {
      const job = await this.read(id);
      // A running job is refused unless it has gone quiet: refusing every one of them left a
      // worker killed mid-render holding its job and its output name forever.
      if (job.state === 'running') {
        const quietFor = this.now() - (job.heartbeat ?? job.claimed ?? 0);
        if (quietFor < this.staleMs) {
          throw new Error(
            `job ${id} is running on ${job.worker ?? 'a worker'} and was heard from ${Math.round(quietFor / 1000)}s ago, `
            + `so requeueing it would put a second machine on the same render: let it finish, or wait for it to go quiet for ${Math.round(this.staleMs / 1000)}s`,
          );
        }
      }
      const live = await this.list();
      const holder = live.find((j) => j.id !== id && j.output === job.output
        && (j.state === 'queued' || j.state === 'running'));
      if (holder) {
        throw new Error(`output ${JSON.stringify(job.output)} is already reserved by ${holder.id} (${holder.state}), so this retry would collide`);
      }
      job.state = 'queued';
      job.claimed = null;
      job.finished = null;
      job.worker = null;
      job.error = null;
      job.lease = null;
      job.heartbeat = null;
      job.artifactPath = null;
      return this.#put(job);
    });
  }

  // A claim saying it is still there, held to the same lease `finish` is.
  heartbeat(id, { lease = null } = {}) {
    return this.serialise(async () => {
      const job = await this.read(id);
      if (job.state !== 'running') throw new Error(`job ${id} is ${job.state}, so there is no claim to keep alive`);
      if (typeof job.lease !== 'string' || lease !== job.lease) {
        throw new Error(`job ${id} is held by another claim, so this is not the one rendering it`);
      }
      job.heartbeat = this.now();
      return this.#put(job);
    });
  }

  async remove(id) {
    const path = this.pathFor(id);
    this.writes++;
    await unlink(path);
    return { removed: id };
  }
}
