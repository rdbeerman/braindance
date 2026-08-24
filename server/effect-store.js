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
//
// **And it is asked again at every start, of what is already there, which is the same gate
// and not a second one.** A package passed the door against the build that was installed
// the day it landed, and a fork outlives the build it was made on: upgrade the program and
// the spine may have lost or renamed a joint that fork's GLSL names, or the builtin it
// shadows may have grown a parameter the fork does not carry. Nothing about the fork
// changes, it goes on shadowing the upgraded builtin, and the failure is the one this
// whole surface exists to move - `assembleShaders` throws while `web/main.js` is still
// evaluating, no `__kinect` publishes, and neither the recorder nor the editor opens on
// that machine again. See `refuseIncompatiblePackages`.

import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { doorRefusal, forkRefusal } from './effect-door.js';

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
   *
   * **The spines are demanded for the same reason the builtin root is**, and it is the
   * same sentence one step along: the boot gate below asks the install door about every
   * package already on disk, the door answers by running the assembler against the spines,
   * and a store handed none of them could not ask. Refused rather than skipped, because a
   * gate that quietly does nothing is worse than no gate - it is a gate everything
   * downstream is written as though it had.
   */
  constructor(dir, builtinDir, spines) {
    if (!existsSync(builtinDir) || !statSync(builtinDir).isDirectory()) {
      throw new Error(`the shipped effect directory ${builtinDir} does not exist - `
        + 'this build cannot serve a build without its builtin effects, so it refuses to boot '
        + 'rather than answer an empty list that reads as nothing installed');
    }
    if (!spines || typeof spines !== 'object' || Object.keys(spines).length === 0) {
      throw new Error('the effect store is constructed with the spines this build assembles from - '
        + 'they are what the install door runs the assembler against, so a store without them could '
        + 'not re-ask that door of the packages already on disk, and a boot gate that cannot ask is '
        + 'one nothing may be written as though it had');
    }
    this.dir = dir;
    this.builtinDir = builtinDir;
    this.spines = spines;
    // **How many times this store has changed, which is the one thing a revision cannot say.**
    //
    // A package rev is a hash of its bytes and the list of them is a hash of hashes, which is
    // exactly what a client wants for "am I holding the current package" and is silent about
    // the question underneath it: has the store moved *since I started reading*. Those two
    // come apart when a change is undone. Install a fork and delete it again - which restores
    // the shipped package, so the bytes are the bytes they were - and every revision on both
    // sides of that pair is identical. A page whose read straddles it opened on the shipped
    // package, fetched some of its chunks out of the fork, closed on the shipped package
    // again, and found both listings in perfect agreement. The mixed set then assembles into
    // a program nobody wrote, adopts, records the revision it opened with, and no later poll
    // ever disagrees with itself about it.
    //
    // A counter is what closes that, because the missing dimension is the store's own history
    // rather than its contents: `A -> B -> A` is three generations however many times the
    // bytes repeat. It is not durable and does not need to be - a restart drops it to zero, a
    // read straddling the restart sees two different numbers and retries, and the attempt
    // after it is answered wholly by the new process. Failing toward a retry is the direction
    // that costs an interval rather than a wrong program.
    //
    // **What it does not see is narrower than it first reads, and the narrowing is worth
    // writing down rather than leaving somebody to be reassured by the wide version.** A
    // change made to these directories by something that is *not* this store moves no counter,
    // so an edit and its undo are invisible here - but only where the sole requests answered
    // out of the changed state are chunk fetches. A listing that lands there disagrees on the
    // revisions, and a package read that lands there answers for a revision the opening
    // listing did not name, which the client holds it to. So the residual is one window,
    // between the manifest and the chunks, on a store nothing in the product writes to:
    // `install` and `remove` are the only writers, and the two places anything else does are
    // proof-tool fixtures standing a package up past the door on purpose.
    this.generation = 0;
    this.recoverInterruptedInstalls();
    // After the recovery and not before it: a package the recovery puts back is a package
    // this store now serves, so it is one the gate below has to have asked about. Neither
    // of them moves the generation, and that is right rather than an omission - both run
    // before anything can read this store, so there is no earlier number for a reader to
    // have been holding.
    this.refuseIncompatiblePackages();
  }

  /**
   * Every persisted user package asked the install door again, against *this* build - and
   * whatever it now refuses renamed aside rather than served.
   *
   * **A package got through the door once, against the build that was running the day it
   * was installed.** That is the whole of what the door can promise, and a fork outlives
   * the build it was made on: this program's spines gain, lose and rename joints, and its
   * shipped packages gain parameters. Upgrade underneath a fork whose chunk names a joint
   * the new spine has dropped - or whose shipped twin has grown a fifth key - and nothing
   * about the fork changes and nothing re-asks. It still shadows the builtin, so it is
   * still what `/effects` answers with, and `assembleShaders` throws while `web/main.js` is
   * evaluating: no `__kinect` at all, both surfaces dark, every tool in the suite reporting
   * DID NOT RUN, and the only evidence a line in a console nobody has open. The machine
   * that upgraded is the machine that stops working, which is the failure the whole install
   * design is arranged around, arriving through the one door nobody was asked at.
   *
   * **One gate asked twice rather than a second gate.** `doorRefusal` and `forkRefusal` are
   * the same two functions `PUT /effects/:id` runs, on the same envelope shape, against the
   * same set - so there is nothing here that can drift from what an install accepts. Only
   * the *user* root is walked: a builtin is this build's own package, checked by
   * `test/effect-door.test.mjs` running the whole shipped set through this door under bare
   * node, and a builtin this build cannot assemble is a broken build rather than a
   * migration.
   *
   * **Renamed aside and never deleted.** A fork is somebody's authored work - retuned
   * bounds, hand-written GLSL - and the honest answer to "this build cannot use it" is not
   * to destroy it. `<id>.<seq>.incompatible` is invisible to every read for the same reason
   * `.tmp` is, by the same rule: `VALID_EFFECT_ID` has no dot in it, so `idsIn` drops the
   * aside from the listing and `rootFor` cannot resolve the name. It is not swept either -
   * `sweepTemporaries` matches `.tmp`, `.old` and `.gone` and nothing else - so the copy
   * survives an install of the same id and is there to be moved back by hand once the
   * package is fixed.
   *
   * **Two passes, and the first one exists because the second can be handed a corpse.**
   * `packageOf` reads a manifest and its chunks off disk and throws on a package that
   * cannot be read as one at all - no manifest, a manifest that does not parse, an id that
   * disagrees with the directory, a chunk that is a link instead of a file. `loaded` walks
   * every package to build the set the door is asked against, so a single unreadable
   * package in the user root would throw while the door was being asked about an
   * *innocent* one, and the boot failure would have moved into the gate written to prevent
   * it. So pass one asides anything that cannot be read, and pass two asks the door of what
   * is left - by which point the only thing `loaded` can still throw on is a builtin, which
   * is the broken build the paragraph above declines to be helpful about.
   *
   * Announced rather than silent, in the voice `recoverInterruptedInstalls` uses and for
   * the reason it does: an id that used to answer with somebody's fork and now answers with
   * the shipped package is the correct outcome and is still a change nobody asked for, so
   * it is worth a line carrying the door's own sentence in the log of the start that made
   * it.
   *
   * It costs one assembly per *user* package, which is a string concatenation over the
   * shipped set and is paid once at boot. A machine with no forks pays nothing at all,
   * because the loop walks the user root and that root is where forks are.
   */
  refuseIncompatiblePackages() {
    for (const id of this.idsIn(this.dir)) {
      try {
        this.packageOf(id);
      } catch (err) {
        this.setAside(id, `it cannot be read as a package at all: ${err.message}`);
      }
    }
    for (const id of this.idsIn(this.dir)) {
      const candidate = this.packageOf(id);
      const shadowed = this.builtin(id);
      const refusal = doorRefusal(candidate, { beside: this.loaded(id), spines: this.spines })
        ?? (shadowed ? forkRefusal(candidate, shadowed) : null);
      if (refusal) this.setAside(id, refusal);
    }
  }

  /** One package out of the way, under a name no read resolves, with the reason said out loud. */
  setAside(id, refusal) {
    const aside = join(this.dir, `${id}.${process.pid}.${Date.now().toString(36)}.incompatible`);
    renameSync(join(this.dir, id), aside);
    console.warn(`effect ${id} was installed by an earlier build of this program and this one refuses it: `
      + `${refusal} - the package has been renamed to ${basename(aside)} rather than deleted, so it is still `
      + `there to be repaired and moved back, and ${existsSync(join(this.builtinDir, id))
        ? 'the shipped package answers for that id again'
        : 'nothing answers for that id now, so a document holding its values parks them'}`);
  }

  /**
   * The one window in `install` where a crash loses a package, closed at the next start.
   *
   * **`install` swaps the old copy aside and then swaps the new one in, and between those
   * two renames the id resolves to nothing.** The window is microseconds and it is real: a
   * machine losing power there comes back with `rain.4711.old` holding the only copy of the
   * user's package and nothing at `rain`. Every read then answered from the builtin - which
   * looks like an uninstall rather than like damage - and the next install of that id swept
   * the `.old` away, so the last good copy was destroyed by the recovery path of the very
   * operation that had orphaned it.
   *
   * So the aside is put back, here, before anything can read the store: a `.old` whose live
   * id is missing is by construction a crashed install and never anything else, because the
   * only other writer that renames a directory aside is `remove` and that one names its
   * aside `.gone` for exactly this reason. Two intents, two suffixes, and the question
   * "should this come back" is answered by the name rather than by a guess.
   *
   * Announced rather than silent. A package reappearing on its own is the correct outcome
   * and it is still a machine saying it crashed mid-install, which is worth a line in a log
   * somebody reads after the power comes back.
   */
  recoverInterruptedInstalls() {
    if (!existsSync(this.dir)) return;
    const asides = new Map();
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith('.old')) continue;
      const id = entry.name.slice(0, entry.name.indexOf('.'));
      if (!VALID_EFFECT_ID.test(id) || existsSync(join(this.dir, id))) continue;
      if (!asides.has(id)) asides.set(id, []);
      asides.get(id).push(entry.name);
    }
    for (const [id, names] of asides) {
      // The newest, because a machine that crashed twice mid-install left two and the
      // second one is the copy that was live when it went down. Ordered by name after the
      // timestamp so the choice is one arrangement rather than whatever the directory
      // happened to yield; the ones not chosen are swept by the next install of the id,
      // which can now see a live directory beside them.
      const newest = names
        .map((name) => ({ name, at: statSync(join(this.dir, name)).mtimeMs }))
        .sort((a, b) => (b.at - a.at) || (a.name < b.name ? 1 : -1))[0].name;
      renameSync(join(this.dir, newest), join(this.dir, id));
      console.warn(`effect ${id} was left with no installed copy and ${newest} beside it - `
        + 'an install was interrupted between swapping the old package aside and swapping the new one in, '
        + 'and the old package has been put back');
    }
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
    // A real directory and not a link to one, on `file`'s reasoning one level up: `idsIn`
    // already drops a link, because a symlink's `Dirent` answers `isSymbolicLink()` rather
    // than `isDirectory()`, and a `rootFor` asking only whether something is there would
    // resolve by name what the listing had refused by kind - a package in no list that
    // every per-id route still answers for.
    const real = (path) => existsSync(path) && lstatSync(path).isDirectory();
    if (real(join(this.dir, id))) return { root: this.dir, builtin: false };
    if (real(join(this.builtinDir, id))) return { root: this.builtinDir, builtin: true };
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

  /**
   * One file's bytes, or null - the name is validated before the path is built, and what
   * is at the end of it has to be an ordinary file rather than a link to one.
   *
   * **`lstat` and not `stat`, which is the difference between asking about the name and
   * asking about what the name points at.** `statSync` follows a symlink, so a link
   * planted in the user root - the one directory in this program a client can write into -
   * answered `isFile()` for whatever it aimed at and this route then read it and served
   * it: `/etc/passwd` through a package file called `notes.txt`. The name rule above stops
   * a path *in the request* and does nothing about a path already sitting on disk.
   *
   * A narrower rule than the realpath-and-containment pair `server/index.js` uses for the
   * static tree, and deliberately so. A file under `web/` may legitimately be a link, so
   * the question there is where it lands; a package file may not be one at all, because a
   * package is what the install door wrote and the door writes ordinary files. Refusing
   * the link itself needs no notion of where the roots are and cannot be walked around by
   * a link that happens to point back inside one.
   *
   * `read` is covered by the same rule from the other end: its listing keeps only entries
   * whose `Dirent` says `isFile()`, and a symlink's `Dirent` says `isSymbolicLink()`. So a
   * planted link is in no file index and is served by no route.
   */
  file(id, name) {
    if (!VALID_FILE_NAME.test(name)) return null;
    const where = this.rootFor(id);
    if (!where) return null;
    const path = join(where.root, id, name);
    if (!existsSync(path) || !lstatSync(path).isFile()) return null;
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
      .map((e) => this.packageOf(e.id));
  }

  /**
   * One installed package in the shape the install door takes: the manifest, and the text
   * of every chunk the manifest names.
   *
   * **Extracted out of `loaded` because the boot gate needs one package rather than the
   * set**, and because a second construction of this shape is a second answer to what a
   * package *is* on the way into the one function that refuses it. `refuseIncompatiblePackages`
   * asks for a candidate and `loaded` asks for everything beside it, and both are this.
   *
   * The chunk map is built from what the manifest names rather than from what the directory
   * holds, which is the same reading `builtin` makes and is deliberate here: a file the
   * manifest does not name is text nothing splices, and the door's rule about one of those
   * is about a package *arriving*, where an undeclared file is a stale copy somebody sent.
   * Off disk it is a file to leave alone.
   */
  packageOf(id) {
    const { manifest } = this.read(id);
    const chunks = {};
    for (const c of manifest.chunks ?? []) {
      const bytes = this.file(id, c.file);
      // `file` answers null for a name that is not an ordinary file, and a manifest
      // naming one is the one shape that reaches here: the store's own listing already
      // drops it, so without this the next line would be a `null.toString` with a stack
      // and no id in it. Named instead, because the set this assembles is what the
      // install door is asked about and a door that crashed would refuse nothing.
      if (!bytes) {
        throw new Error(`effect ${id} names the chunk ${JSON.stringify(c.file)} and there is no ordinary `
          + 'file of that name in its directory - a package file is what the install door wrote, and a link '
          + 'or a directory standing in for one is not something this store will read');
      }
      chunks[c.file] = bytes.toString('utf8');
    }
    return { id, manifest, chunks };
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
    // Bumped after the swap rather than before it, so the number a reader sees and the
    // directory it resolves are never one change apart in the direction that reads as
    // settled: a generation that moved before the rename would claim a change that had not
    // landed, where one that moves after it claims a change that has.
    this.generation += 1;
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
    // **`.gone` and not `.old`, and the suffix is the whole of what tells the two apart.**
    // `recoverInterruptedInstalls` puts a `.old` back when its live id is missing, which is
    // exactly the state a crash here would leave - so an aside named `.old` would be a
    // deletion the next start quietly undoes, and the operator's uninstall would come back
    // by itself. One suffix per intent: `.old` is a copy that should return if nothing
    // replaced it, `.gone` is a copy on its way out, and neither has to be guessed at.
    const aside = join(this.dir, `${id}.${seq}.gone`);
    // Renamed out of the way and then deleted, so the id stops resolving in one operation
    // rather than over however long it takes to unlink a directory of files.
    renameSync(mine, aside);
    rmSync(aside, { recursive: true, force: true });
    // The id stops resolving at the rename above, so the generation moves with it for the
    // same reason it moves after an install's second rename: what a reader is being told is
    // that the answer to every question about this store has changed since the last number.
    this.generation += 1;
    return { removed: id, restored: existsSync(join(this.builtinDir, id)) };
  }

  /**
   * Whatever a crashed install left behind for this id, swept before the next one starts.
   *
   * They are invisible to every read, so nothing is broken by their being there - what
   * they are is disk, and a machine that crashed mid-install ten times would carry ten
   * copies of a package with nothing ever looking at them.
   *
   * **`.old` is swept only while the live directory is there, and that condition is the
   * difference between housekeeping and data loss.** A `.old` with nothing at its live id
   * is the last copy of that package - the crash window `recoverInterruptedInstalls`
   * describes - and this sweep used to run first thing in `install`, so the operation that
   * would have restored it deleted it instead. With a live directory beside it a `.old` is
   * genuinely spare: the swap completed and this is the copy that was replaced.
   *
   * `.tmp` and `.gone` carry no such condition. A `.tmp` is a package that was still being
   * written when the machine went down, so it is incomplete by definition; a `.gone` is a
   * copy somebody asked to be rid of.
   */
  sweepTemporaries(id) {
    if (!existsSync(this.dir)) return;
    const liveHere = existsSync(join(this.dir, id));
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith(`${id}.`)) continue;
      if (!/\.(tmp|old|gone)$/.test(entry.name)) continue;
      if (entry.name.endsWith('.old') && !liveHere) continue;
      rmSync(join(this.dir, entry.name), { recursive: true, force: true });
    }
  }
}
