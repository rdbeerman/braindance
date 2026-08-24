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
// Reads only, deliberately. Install and delete arrive with the surface that can
// exercise them end to end; a write path nothing can drive before commit is the
// class of code this repo refuses to carry.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
}
