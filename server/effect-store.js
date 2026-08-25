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
import { MAX_EFFECT_ID, doorRefusal, forkRefusal } from './effect-door.js';

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
  }

  /**
   * The two things this store does *to* its user root, run once and only by the process
   * that is going to serve out of it.
   *
   * **Constructing this store writes nothing, and that is the whole of what this method
   * is.** Both of the calls below rename directories: the recovery puts a crashed
   * install's aside back, and the gate renames a package this build cannot use out of the
   * way. Run at construction - which is where they were - they ran in *every* process that
   * got as far as building a store, including the one that was about to die on
   * `EADDRINUSE` because a server was already serving that same root. That process
   * renamed under the live one's feet, and it could rename a revision that had been
   * installed since it started reading: a fresh, good install quarantined by a second
   * process that never validated it and never answered a request.
   *
   * **The port is the lock, because the deployment already has one.** Two servers on one
   * root is exactly two servers on one port, and the kernel settles that argument for us -
   * so this is called from inside `listen`'s callback, after the bind has succeeded, and
   * the loser of the race exits having touched nothing. No lock file, no pid file, nothing
   * to be left behind by a machine that lost power holding it.
   *
   * **Nothing can be answered out of an unsettled store, and the reason is narrow enough
   * to be worth stating rather than assumed.** The socket is accepting by the time this
   * runs, so a client's bytes may already be in the kernel's buffer - but a request
   * handler is a callback on a later turn of the event loop, and everything below is
   * synchronous `fs`. So the whole of this method happens before the first `request`
   * event is dispatched. It is the synchrony that makes the ordering sufficient: an
   * `await` anywhere in here would open exactly the window this note says is closed.
   */
  claimUserRoot() {
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
   * **The second pass validates one candidate at a time against what has already been
   * validated, and never against a peer that has not been.** Handing the door
   * `loaded(id)` - which is every other package on disk, checked or not - made one broken
   * fork answer for its neighbours: the door assembles `[...beside, candidate]` and reports
   * the assembler's message under the *candidate's* name, so a healthy `alpha` doored
   * beside an unvalidated `zeta` whose chunk names a joint this build dropped came back
   * "alpha does not assemble", and both were quarantined. Which of the two was blamed
   * depended on the lexical order the walk happened to reach them in, so the same pair of
   * directories cost one package or two according to what they were called. Here a
   * candidate is asked against the builtins - minus the ones a survivor shadows - plus the
   * survivors, and a package that passes joins `beside` for the next one.
   *
   * **Run to convergence rather than in one sweep, because a single sweep would refuse
   * what the install door accepts.** A package may legitimately read another's varying -
   * the glyph field reads the rain's `vRain`, which is the whole of what its rain key is -
   * and the door offers a candidate every *other* installed package's varyings, so
   * installing a self-contained `zeta` and then an `alpha` that reads its varying is a pair
   * this build's own door lets through. One lexical sweep meets `alpha` while `zeta` is
   * still unvalidated, finds the name nowhere, and quarantines a package that has been
   * working since the day it landed - the boot gate refusing what the install door took,
   * which is the drift the whole "one gate asked twice" arrangement exists to make
   * impossible. So the pass repeats while it is still promoting anybody, and what is left
   * when it stops promoting is what is genuinely refused, each under the sentence it was
   * last refused with.
   *
   * **A collision between two user packages is blamed on the lexically later one, and that
   * is a choice rather than an accident.** Two forks claiming one slot cannot both stand;
   * the first round validates the earlier id against the builtins alone, so it survives,
   * and the later one then collides against a survivor and is the one renamed aside. It is
   * deterministic, it is the same answer on every machine holding those two directories,
   * and it is arbitrary - there is no fact in either package about which of them should
   * lose. The residual it leaves is a *mutually* dependent pair, each reading a name the
   * other declares: neither can ever be promoted, so both are set aside. That state is
   * unreachable through the install door, which takes them one at a time and would have
   * refused whichever arrived first, so it is hand placement or nothing.
   *
   * **A promotion is only allowed if the set it produces still stands, which is the half
   * this gate did not ask.** Everything above validates the *candidate*: the door is handed
   * the packages that would sit beside it and reports what the candidate cannot do. What it
   * never re-asked is the packages already accepted, and a shadow can invalidate one of them
   * without being wrong about anything of its own. `doorRefusal` walks the candidate's chunks
   * for identifiers this build has not got and `forkRefusal` catches a fork that dropped a
   * parameter - neither looks at a *varying* the fork stopped declaring. So a `rain` fork that
   * removes `vRain`, with its own two references to it removed as well, is a package with
   * nothing wrong with it: clean chunks, every parameter kept, the door answers null. It then
   * shadows the shipped rain, the builtin glyph goes on reading `vRain` out of its
   * `index.frag.glsl`, and nothing in the assembled pair declares the name. The cloud program
   * fails to link, `web/main.js` throws while it is still evaluating, and no `__kinect`
   * publishes - the failure this whole gate exists to move, arriving through the one package
   * it validated and the two it did not re-ask. Reachable through `PUT /effects/rain` as well
   * as by hand placement, because the install door has the same shape and the same hole.
   *
   * So a candidate is promoted only when every member of the resulting set still passes the
   * door with the rest of that set beside it, and a candidate that breaks somebody is refused
   * under a sentence naming both ends: which package it broke and what the door said about it.
   * The blame lands where the change is, which is the point - the builtins are this build's
   * own packages and the survivors were standing a moment ago, so the only thing that moved
   * is the candidate.
   *
   * **Except where a builtin was already refused before any fork was in the room**, which is
   * asked once at the top and is what keeps this from being an over-refusal machine. Without
   * it, a build that shipped a package its own door refuses would quarantine every fork on
   * every machine, each under a sentence blaming somebody's authored work for a fault it had
   * nothing to do with. `test/effect-door.test.mjs` makes that unreachable on a correct build
   * by running the whole shipped set through this door under bare node; this is what happens
   * on an incorrect one, and the honest answer there is the log line the paragraph above
   * declines to be more helpful than.
   *
   * The walk over the resulting set is in id order rather than in map order, because the first
   * refusal found is the sentence the package is set aside under and "whichever the iteration
   * reached first" is the arbitrariness this method already spent a paragraph removing.
   *
   * **Two mutually-dependent forks are still both set aside, and now for the ordinary
   * reason.** Neither can be promoted first, so neither is ever promoted - unchanged by the
   * rule above, which only ever refuses more.
   *
   * It costs one door pass per builtin once, and then one per candidate plus one per member of
   * the set that candidate would produce, per round - so with the eighteen packages this build
   * ships and one fork of one of them in the user root, 36 passes where it used to be one.
   * Measured on this rig by timing `claimUserRoot` itself, twelve runs of each arm interleaved
   * rather than one arm after the other, medians: **17.68ms with one fork and 0.057ms with
   * none.** The second number is the one that matters - a machine with no forks pays nothing
   * at all, because the walk is over the user root, the baseline pass is skipped when that root
   * has nothing readable in it, and the user root is where forks are.
   */
  refuseIncompatiblePackages() {
    // **Pass one, and it has no rule of its own about the length of a name.** A directory
    // called more characters than `MAX_EFFECT_ID` is one no install of this build could have
    // written, and it is refused by the door in the pass below like everything else, under
    // the door's own sentence - a length test here as well would be that rule spelled twice,
    // and `setAside` truncates whatever it is handed, so the rename the length was ever
    // about goes through from either pass.
    const readable = [];
    for (const id of this.idsIn(this.dir)) {
      try {
        readable.push(this.packageOf(id));
      } catch (err) {
        this.setAside(id, `it cannot be read as a package at all: ${err.message}`);
      }
    }

    // Nothing readable in the user root is nothing this gate can set aside, and every pass
    // below walks a set built out of that root - so the whole of the rest of this method is
    // about forks, and a machine with none of them stops here having read one directory
    // listing. Stated as a return rather than left to the loops, because the baseline pass
    // just below is the one thing here that would otherwise cost something on a machine with
    // nothing to gate.
    if (!readable.length) return;

    // Read once for the whole gate rather than per candidate, and read from the shipped
    // root by name: `packageOf` resolves through `rootFor`, which answers with the user's
    // copy, so asking it for a builtin a candidate's unvalidated neighbour shadows would
    // hand back the neighbour - the very package this pass is refusing to trust.
    const builtins = new Map(this.idsIn(this.builtinDir).map((id) => [id, this.builtin(id)]));

    // What one member of a standing set is doored against: everything else in it, in the
    // order `list()` answers and therefore the order the page assembles from.
    const besideIn = (standing, id) => [...standing.values()]
      .filter((p) => p.id !== id)
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    // **The baseline: this build's own packages, asked of each other, with no fork in the
    // room.** Anything refused here was refused before any user package existed, so it is a
    // fault in the build rather than something a candidate did - and the rule below has to
    // know the difference, or the first fork on a machine with a broken builtin is quarantined
    // for it. Held by identity rather than by id, because a survivor shadowing one of these
    // ids is a different package and gets asked on its own account.
    const bornRefused = new Set();
    for (const [id, pkg] of builtins) {
      const refusal = doorRefusal(pkg, { beside: besideIn(builtins, id), spines: this.spines });
      if (!refusal) continue;
      bornRefused.add(pkg);
      console.warn(`effect ${id} is shipped with this build and this build's own install door refuses it: `
        + `${refusal} - nothing here can set a builtin aside, so it goes on being served; what this line `
        + 'exists for is that a fork standing beside it must not be quarantined in its place');
    }

    const survivors = new Map();
    const refusals = new Map();
    let pending = readable;
    let promoted = true;
    while (promoted && pending.length) {
      promoted = false;
      const stillPending = [];
      for (const candidate of pending) {
        // A survivor shadows the builtin of its id by landing second in this map, which is
        // the same rule `rootFor` applies and is why the two are built as one map rather
        // than as two lists. The candidate's own id goes entirely - the question the door
        // asks is what the build looks like *with the candidate in place of* whatever holds
        // that id now, and leaving the builtin in would collide the fork with what it forks.
        //
        // Sorted by id afterwards, which is the order `list()` answers in and therefore the
        // order the page assembles from. A stage concatenates its chunks in the order the
        // packages arrive, so a gate that assembled the same set in a different order would
        // be asking about a program the page will not build.
        const standing = new Map([...builtins, ...survivors]);
        standing.delete(candidate.id);
        const beside = [...standing.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
        const shadowed = builtins.get(candidate.id) ?? null;
        let refusal = doorRefusal(candidate, { beside, spines: this.spines })
          ?? (shadowed ? forkRefusal(candidate, shadowed) : null);
        // **And the other direction, which is what a shadow can do to the packages it is not
        // about.** Everything above asks whether the candidate works beside the set; this asks
        // whether the set still works beside the candidate, and the two are different questions
        // because the door reads one package's chunks and the whole set's declarations. A fork
        // that stops declaring a varying its neighbour reads is correct on its own account and
        // takes the neighbour's program down with it. See this method's own note for the
        // shipped instance and for why a builtin the baseline already refused is skipped
        // rather than charged to whoever happens to be standing next to it.
        if (!refusal) {
          const resulting = new Map([...builtins, ...survivors]);
          resulting.set(candidate.id, candidate);
          for (const id of [...resulting.keys()].sort()) {
            const member = resulting.get(id);
            if (member === candidate || bornRefused.has(member)) continue;
            const broke = doorRefusal(member, { beside: besideIn(resulting, id), spines: this.spines });
            if (!broke) continue;
            refusal = `with it installed this build can no longer assemble ${id}: ${broke}. Nothing is `
              + `wrong with ${id} on its own - it stood a moment ago and stands again once ${candidate.id} `
              + 'is out of the way, so the package being set aside is the one that changed';
            break;
          }
        }
        if (refusal) {
          refusals.set(candidate.id, refusal);
          stillPending.push(candidate);
          continue;
        }
        survivors.set(candidate.id, candidate);
        promoted = true;
      }
      pending = stillPending;
    }
    for (const candidate of pending) this.setAside(candidate.id, refusals.get(candidate.id));
  }

  /**
   * One package out of the way, under a name no read resolves, with the reason said out
   * loud - and a package that cannot be moved left where it is rather than taking the
   * server down with it.
   *
   * **The stem is truncated because the aside is longer than the id it is made from.**
   * `NAME_MAX` is 255 bytes and this appends about thirty characters to the name, so a
   * directory called two hundred and forty characters of anything - which an older build
   * would have installed, since the id rule had no length in it - threw `ENAMETOOLONG` out
   * of `renameSync`, out of the gate, out of the constructor, and the server did not start.
   * A gate written to stop one broken package taking the program down cannot be the thing
   * that does it. See `MAX_EFFECT_ID` for the arithmetic.
   *
   * **The sequence is bumped rather than trusted.** The name carries a pid and a
   * millisecond, which are unique enough for one process asiding one package and are not a
   * guarantee: two truncated stems that agree in their first 64 characters, or a second
   * package refused inside the same millisecond, collide - and a rename onto an existing
   * directory answers `ENOTEMPTY` as readily as `EEXIST`, so both are retried.
   *
   * **And a rename that still will not go leaves the package where it is, loudly.** The
   * alternative is throwing, which is a server that will not boot over a package that is
   * merely broken - and this program's whole install design is arranged around the machine
   * that upgraded being the machine that still comes up. A build serving a package it has
   * announced it cannot use is a page that fails with a sentence in the log naming exactly
   * why; a build that will not start is a machine with nothing to read at all.
   */
  /**
   * One package set aside on a client's word, with the generation moved to match - which is the
   * whole of what this adds over `setAside` and is why it exists rather than the route reaching
   * in to do both.
   *
   * **The counter is the store's own history and the store is the only thing that may move it.**
   * `install` and `remove` bump it and each carries the argument for where in the operation the
   * bump sits; a route doing `EFFECTS.generation += 1` after calling `setAside` made a third
   * writer of a field two methods here already own, and the next one would have been written the
   * same way. So the composite is a method: ask whether there is a user copy, rename it, move
   * the number.
   *
   * **The boot gate deliberately does not come through here.** It calls `setAside` directly and
   * moves nothing, because it runs before the socket has dispatched a request and there is no
   * earlier number for any reader to be holding - see `claimUserRoot`. This is the other case:
   * pages are open, one of them has just failed to compile a package and rolled back, and what
   * it needs is for the next poll to disagree with the listing it is holding so it is handed the
   * set without the broken package in it.
   *
   * Three outcomes rather than a boolean, because the caller answers per id and "there was
   * nothing of yours here" and "it would not move" are different sentences: `absent` is an id
   * with no copy in the user root, which is what a builtin looks like from here, `stuck` is a
   * rename that would not go, and `aside` is the one that moved.
   *
   * The user root is read per call rather than snapshotted by the caller, which is what makes an
   * id named twice answer honestly: the second one finds the first already renamed and comes
   * back `absent` rather than being sent into a rename of a directory that is no longer there.
   */
  setAsideForClient(id, reason) {
    if (!this.idsIn(this.dir).includes(id)) return 'absent';
    if (!this.setAside(id, reason)) return 'stuck';
    this.generation += 1;
    return 'aside';
  }

  setAside(id, refusal) {
    const stem = id.slice(0, MAX_EFFECT_ID);
    const seq = `${process.pid}.${Date.now().toString(36)}`;
    let lastErr = null;
    for (let bump = 0; bump < 16; bump++) {
      const aside = join(this.dir, `${stem}.${seq}${bump ? `.${bump}` : ''}.incompatible`);
      if (existsSync(aside)) continue;
      try {
        renameSync(join(this.dir, id), aside);
      } catch (err) {
        lastErr = err;
        if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY') continue;
        break;
      }
      console.warn(`effect ${id} was installed by an earlier build of this program and this one refuses it: `
        + `${refusal} - the package has been renamed to ${basename(aside)} rather than deleted, so it is still `
        + `there to be repaired and moved back, and ${existsSync(join(this.builtinDir, id))
          ? 'the shipped package answers for that id again'
          : 'nothing answers for that id now, so a document holding its values parks them'}`);
      return true;
    }
    console.warn(`effect ${id} was installed by an earlier build of this program and this one refuses it: `
      + `${refusal} - and it could not be renamed out of the way either: ${lastErr?.message ?? 'every name this store tried was taken'}. `
      + 'It is still where it was and this server is still serving it, because a build that comes up with a package '
      + 'it has said it cannot use is one somebody can read this line on. Move the directory by hand');
    return false;
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
