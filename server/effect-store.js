// The effect packages on disk, read the way the preset store reads documents: a
// shipped root and a user root over it, the user's copy shadowing the shipped one by
// id, so a shipped effect is always the current one, a fork lands in the user's
// directory, and deleting the fork brings the shipped package back. What is different
// from `DocumentStore` - and why this is its own class rather than a fourth
// construction of it - is the shape of the thing stored: a package is a directory of
// files (a manifest beside its shader chunks), not one JSON body, so revision has to
// be computed over the set and a read has to say which files exist before a client
// can fetch them one by one.
//
// **Install writes into the user root and never into the shipped one**, which is the
// whole of the fork mechanism: `PUT /effects/rain` lands a package at `effects/rain`,
// `rootFor` starts answering from there, and `DELETE /effects/rain` removes that copy and
// brings the shipped one back. Nothing this program does can edit or remove
// `effects-builtin/`, so there is always a package to fall back to and no install can
// destroy what the build shipped with.
//
// What lands is what the door passed. `server/effect-door.js` is asked before a directory
// exists, so a refused package never reaches the filesystem at all - there is no state
// where a half-checked package sits where the store reads.

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// The same shape `VALID_ID` enforces for takes, restated for effect ids and package
// file names rather than imported: an id is the namespace prefix a parameter carries
// (`rain.speed` names the `rain` package), so it is lowercase letters and digits with
// nothing that could read as a path. File names allow the dot an extension needs and
// nothing else - a name with a separator in it is refused before the filesystem ever
// sees it, which is what makes the file route safe to hand a client-chosen string.
const VALID_EFFECT_ID = /^[a-z][a-z0-9]*$/;
const VALID_FILE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class EffectStore {
  /**
   * The builtin root is demanded at construction rather than discovered per read,
   * because a server that boots without its shipped effects would answer `/effects`
   * with an empty list that reads as "nothing installed" - a green-looking answer to
   * a broken deployment. The user root may be absent; it is where forks and installs
   * will land, and an empty directory and a missing one mean the same thing to a
   * reader.
   */
  constructor(dir, builtinDir) {
    if (!existsSync(builtinDir) || !statSync(builtinDir).isDirectory()) {
      throw new Error(`the shipped effect directory ${builtinDir} does not exist - `
        + 'this build cannot serve a build without its builtin effects, so it refuses to boot '
        + 'rather than answer an empty list that reads as nothing installed');
    }
    this.dir = dir;
    this.builtinDir = builtinDir;
  }

  /** The ids one root holds: every directory whose name is a valid effect id. */
  idsIn(root) {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && VALID_EFFECT_ID.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  /**
   * Where one id resolves from: the user's copy wins, the builtin answers
   * otherwise, and an id in neither is null rather than a throw so the route can
   * shape the 404.
   */
  rootFor(id) {
    if (!VALID_EFFECT_ID.test(id)) return null;
    if (existsSync(join(this.dir, id))) return { root: this.dir, builtin: false };
    if (existsSync(join(this.builtinDir, id))) return { root: this.builtinDir, builtin: true };
    return null;
  }

  /**
   * One package, whole: the parsed manifest, the file index with per-file
   * revisions, and the package revision over the set. Per-file revs are hashes of
   * the on-disk bytes, and the package rev is a hash over the sorted `name hash`
   * lines - one number for provenance, per-file numbers for a client fetching
   * chunks one at a time and for a tool proving that what was served is what is on
   * disk. Never a re-serialisation: a manifest that round-trips through JSON.parse
   * and back is a different byte stream with the same meaning, and provenance is
   * about bytes.
   */
  read(id) {
    const where = this.rootFor(id);
    if (!where) return null;
    const dir = join(where.root, id);
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && VALID_FILE_NAME.test(e.name))
      .map((e) => e.name)
      .sort();
    if (!names.includes('manifest.json')) {
      throw new Error(`effect ${id} at ${dir} has no manifest.json - a package without its manifest is not a package`);
    }
    const files = names.map((name) => ({ name, rev: `sha256:${sha256(readFileSync(join(dir, name)))}` }));
    const rev = `sha256:${sha256(files.map((f) => `${f.name} ${f.rev}\n`).join(''))}`;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    } catch (err) {
      throw new Error(`effect ${id}'s manifest.json does not parse: ${err.message}`);
    }
    if (manifest.id !== id) {
      throw new Error(`effect ${id}'s manifest declares id ${JSON.stringify(manifest.id)} - `
        + 'the directory name is the namespace parameters carry, so the two disagreeing means '
        + 'one of them is wrong and this store cannot know which');
    }
    return { id, manifest, files, rev, builtin: where.builtin };
  }

  /**
   * The list a client assembles from: every id either root holds, each read whole so
   * the answer carries revisions - a list that named ids without revs would make the
   * client fetch every package to learn nothing changed. Shadowing is stated per
   * entry rather than implied, because which root answered is the difference between
   * "the shipped effect" and "somebody's fork of it".
   */
  list() {
    const ids = [...new Set([...this.idsIn(this.builtinDir), ...this.idsIn(this.dir)])].sort();
    return ids.map((id) => {
      const { manifest, files, rev, builtin } = this.read(id);
      return { id, version: manifest.version, title: manifest.title, rev, builtin, files };
    });
  }

  /** One file's bytes, or null - the name is validated before the path is built. */
  file(id, name) {
    if (!VALID_FILE_NAME.test(name)) return null;
    const where = this.rootFor(id);
    if (!where) return null;
    const path = join(where.root, id, name);
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    return readFileSync(path);
  }

  /**
   * The shipped package behind an id, whatever is shadowing it - or null.
   *
   * The one read that deliberately skips the user root, and the install door is its only
   * caller: a fork has to be held against what it forks, and `read` would hand back the
   * fork itself once one is in place.
   */
  builtin(id) {
    if (!VALID_EFFECT_ID.test(id) || !existsSync(join(this.builtinDir, id))) return null;
    const dir = join(this.builtinDir, id);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const chunks = {};
    for (const c of manifest.chunks ?? []) chunks[c.file] = readFileSync(join(dir, c.file), 'utf8');
    return { id, manifest, chunks };
  }

  /**
   * Every installed package with its chunk text, which is the set the door assembles
   * against and the shape `assembleShaders` reads.
   *
   * `except` drops one id, because the question the door asks is what the build would look
   * like *with the candidate in place of* whatever is there now - and reading the id being
   * replaced would assemble the old package beside the new one, which collides with itself
   * on every slot and varying it declares.
   */
  loaded(except = null) {
    return this.list()
      .filter((e) => e.id !== except)
      .map((e) => {
        const { manifest } = this.read(e.id);
        const chunks = {};
        for (const c of manifest.chunks ?? []) chunks[c.file] = this.file(e.id, c.file).toString('utf8');
        return { id: e.id, manifest, chunks };
      });
  }

  /**
   * A package into the user root, atomically - and "atomically" here means that no reader
   * ever sees a directory that is neither the old package nor the new one.
   *
   * **A package is a directory, so there is no rename of one file to make this safe.** The
   * three writes below are the shape that has one: build the whole thing under a name no
   * reader can resolve, swap the old one aside, swap the new one in. A crash at any point
   * leaves either the old package or the new one where `rootFor` looks, and whatever
   * temporary directories are lying around are swept by the next install.
   *
   * **The temporary names carry dots, and that is what makes them invisible rather than a
   * convention.** `VALID_EFFECT_ID` has no dot in it, so `idsIn` filters `rain.4711.tmp`
   * out of the listing and `rootFor` cannot resolve it - a half-written package is not a
   * package this store can be asked for, by the same rule that decides what an id is. A
   * suffix that read as an id would put the crashed copy in the list beside the good one.
   *
   * The old copy is removed after the swap rather than before it, because the window
   * between the two renames is the only moment nothing is in place, and doing the removal
   * first would widen it to however long a recursive delete takes.
   */
  install(id, manifest, chunks) {
    if (!VALID_EFFECT_ID.test(id)) throw new Error(`${JSON.stringify(id)} is not an effect id`);
    mkdirSync(this.dir, { recursive: true });
    this.sweepTemporaries(id);
    const seq = `${process.pid}.${Date.now().toString(36)}`;
    const tmp = join(this.dir, `${id}.${seq}.tmp`);
    const aside = join(this.dir, `${id}.${seq}.old`);
    const live = join(this.dir, id);
    mkdirSync(tmp, { recursive: true });
    try {
      // The manifest is written from the object rather than from whatever text arrived,
      // because the store's own `read` parses this file and the door checked the parsed
      // object - re-serialising is the one way the bytes on disk and the thing that was
      // checked cannot be two different documents.
      writeFileSync(join(tmp, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      for (const [name, text] of Object.entries(chunks)) {
        if (!VALID_FILE_NAME.test(name)) throw new Error(`${JSON.stringify(name)} is not a package file name`);
        writeFileSync(join(tmp, name), text);
      }
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
    const replaced = existsSync(live);
    if (replaced) renameSync(live, aside);
    try {
      renameSync(tmp, live);
    } catch (err) {
      // The one window worth unwinding: the new copy did not go in, so the old one goes
      // back rather than leaving the id resolving to nothing on a machine that had a
      // working package a millisecond ago.
      if (replaced) renameSync(aside, live);
      rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
    if (replaced) rmSync(aside, { recursive: true, force: true });
    return { ...this.read(id), replaced };
  }

  /**
   * The user's copy of an id, removed - and only ever the user's copy.
   *
   * Deleting a fork restores the shipped package, because the builtin root was never
   * touched and `rootFor` simply starts answering from it again. Deleting a package that
   * exists only in the user root uninstalls it, and the clients then park what their
   * documents hold under it, which is the same condition a document from a machine with
   * more installed already produces.
   *
   * A builtin with no fork is refused by name rather than silently doing nothing, because
   * "there was nothing of yours to remove" and "this build refuses to remove what it
   * shipped with" are different answers and only one of them is about the request.
   */
  remove(id) {
    if (!VALID_EFFECT_ID.test(id)) return { error: `${JSON.stringify(id)} is not an effect id`, status: 400 };
    const mine = join(this.dir, id);
    if (!existsSync(mine)) {
      if (existsSync(join(this.builtinDir, id))) {
        return {
          error: `effect ${id} is shipped with this build and nothing is forking it - `
            + 'a builtin is what an install falls back to, so removing one would leave an id that '
            + 'this build can never answer again',
          status: 409,
        };
      }
      return { error: `no effect ${id} here - GET /effects lists what is installed`, status: 404 };
    }
    this.sweepTemporaries(id);
    const seq = `${process.pid}.${Date.now().toString(36)}`;
    const aside = join(this.dir, `${id}.${seq}.old`);
    // Renamed out of the way and then deleted, so the id stops resolving in one operation
    // rather than over however long it takes to unlink a directory of files.
    renameSync(mine, aside);
    rmSync(aside, { recursive: true, force: true });
    return { removed: id, restored: existsSync(join(this.builtinDir, id)) };
  }

  /**
   * Whatever a crashed install left behind for this id, swept before the next one starts.
   *
   * They are invisible to every read, so nothing is broken by their being there - what
   * they are is disk, and a machine that crashed mid-install ten times would carry ten
   * copies of a package with nothing ever looking at them.
   */
  sweepTemporaries(id) {
    if (!existsSync(this.dir)) return;
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(`${id}.`) && /\.(tmp|old)$/.test(entry.name)) {
        rmSync(join(this.dir, entry.name), { recursive: true, force: true });
      }
    }
  }
}
