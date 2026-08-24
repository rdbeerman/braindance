/**
 * The document format's version, in one place because two copies of a constant
 * that must agree is the drift this design keeps refusing.
 *
 * Both sides need it and they need the *same* one. The page stamps it on every
 * project and preset it saves and refuses to open anything else; the server stamps
 * it again as documents are written to disk, so a file that reached the store some
 * other way still carries it. A check that caught the two disagreeing would only be
 * proving they can, which is not the same as there being one number.
 *
 * It lives under `web/` because that is the side with a delivery constraint: the
 * browser can only import what the server serves, and `web/` is served. Node has no
 * such constraint and reaches for it by path.
 *
 * ---
 *
 * **Version 1 means every screen-space term is expressed against a 1080p
 * reference.** `pointSize` above all: it is pixels at 1080p now and was pixels at
 * the drawing buffer before step 6, so the same number means two different sizes
 * either side of that change, and both built-in presets were rebased by 1080/600 to
 * follow it. There are no documents older than version 1, which is exactly why the
 * field went in when it did - once files exist there is no way to add it
 * retroactively, and a document whose units cannot be recovered is one that renders
 * wrong with nothing to say why.
 *
 * A version rather than an authored buffer height, and the difference is what a
 * loader can *do* with it. An authored height answers one question - what to scale
 * `pointSize` by - and from here on would record 1080 in every file forever, a
 * constant that looks like data. A version answers "can this build faithfully
 * interpret this document", which is the question that recurs: the next thing to
 * move will be a track kind, an easing rule or an audio reference, and none of those
 * is a scale factor. So a file this build does not recognise is refused, naming the
 * version it found, rather than opened on a best guess.
 *
 * **Version 2 adds clip in/out points in program seconds.** They are composition,
 * not look, so they sit in the project and not in a preset. `in` defaults to 0 and
 * `out` defaults to null, meaning the end of the clip. The version is the same
 * "can this build faithfully interpret this document" signal as before.
 *
 * **Version 3 splits the document into look and composition.** Look holds the
 * mode, static params and keyed tracks for look parameters; composition holds the
 * retime curve and the camera track. Deliverables (in/out points, output fps,
 * output size and codec) now live in their own store, not inside the project.
 * Saved projects also carry an undo history (`history.stack` and
 * `history.baseline`) so a reload can restore it.
 *
 * **Version 4 dissolves the mode into five reading weights.** `look.mode` is gone
 * from the project and `mode` is gone from the preset; what replaces both is five
 * ordinary look parameters - `readRgb`, `readDepth`, `readGhost`, `readContour`,
 * `readBlackwall` - which travel with every other value and need no special case.
 *
 * This is the version that most needs to be a refusal rather than a best guess, and
 * for a reason the earlier ones did not have. A version 3 document read by this build
 * would parse: its `values` are all still parameters this registry knows, so
 * `params.apply` would write every one of them without complaint, and the reading
 * would simply be missing - leaving whatever the previous document happened to
 * select. A file that renders as somebody else's shading, silently, is worse than one
 * that fails to open. There is no way across: the conversion this repo used to ship was
 * deleted once every document it could act on had already been converted, so the gate is
 * a refusal and nothing else. A loader that could read both shapes was never on the table
 * either - that is the second implementation this design keeps refusing.
 *
 * **Version 5 makes an ease handle a list of control points.** A version 4 key carried
 * one pair per side - `easeOut: [0.42, 0]` - and a version 5 key carries a list of them,
 * `easeOut: [[0.42, 0]]`, which is the same cubic with its degree written down. What the
 * list buys is a segment that can be a quintic: two control points a side with ordinates
 * 0, 0, 1, 1 is exactly `6u^5 - 15u^4 + 10u^3`, the one shape whose *acceleration*
 * reaches zero at a key and not merely its rate, which is what a camera departing a
 * keyed pose needs and what no cubic pinned at both ends can express.
 *
 * This one has to be a refusal for the reason version 4 did and one more besides. The
 * two shapes are not distinguishable by inspection - `[0.42, 0]` is a two-element array
 * and so is `[[0.2, 0], [0.4, 0]]` - so a build that guessed would read a quintic's
 * first control point as an entire cubic and render a move nobody authored, silently and
 * at every key at once. There is no sniff that separates them and deliberately none is
 * attempted, and with the converter gone there is no way across either - a version 4
 * document is refused and stays refused.
 *
 * **Only a project changes shape here, and a preset is bumped without being rewritten.**
 * A preset is `{version, values}` and holds no keys at all - see `refusePresetBody` -
 * so its handles are not anywhere to convert. The version is shared between the two
 * document kinds, so it moves for both regardless, which is the same cost the comment
 * above `aspect` in `serialiseProjectBody` declines to pay for a field presets have
 * nothing to do with. It is paid here because the thing that moved is the *format* of
 * something both kinds could carry, rather than a field only one of them has.
 *
 * **Version 6 names the look's parameters by the effect they belong to.** A version 5
 * document said `glyphTone`; a version 6 document says `glyph.tone`, carries a
 * `requires` list naming the effects its values are built from, and leaves out every
 * effect it holds at inert defaults. The dot is load-bearing rather than cosmetic: it
 * is what lets a reader tell a typo from an effect this machine does not have, and
 * the `requires` list is what lets it say *which* effect is missing instead of
 * refusing the whole document for one unknown name. There is no way across, as ever -
 * the renames are one-to-one and a converter could exist, which is exactly why this
 * paragraph records that one deliberately does not: every document this project holds
 * was re-authored at 6, and a reader of both shapes is the second implementation this
 * design keeps refusing.
 */
export const PROJECT_VERSION = 6;

/**
 * The sentence a document from the wrong version gets, in one place because the two
 * doors were saying different things about the same file - and one of them was false.
 *
 * **This build carries no migration, and the refusal says so rather than sending anybody
 * looking for one.** There used to be a one-shot rewriter under `tools/` that converted
 * documents on disk, and four bands here that told a version 3 or 4 document which steps
 * stood between it and this one. Both are gone: every document this project holds is
 * re-authored at the current version, so the converter was a one-way rewriter of authored work that nothing
 * could exercise - the most dangerous shape a piece of untested code can have, since its
 * *successful* outcome is that the original is gone. Deleting it is the greenfield call,
 * and the cost is stated rather than hidden: a version 3 or 4 document, if one exists
 * anywhere, is now unopenable and stays that way.
 *
 * **The gate itself stays, and it is not the same question.** A version field is not
 * about old documents - it is about *any* document this build cannot faithfully read,
 * and the live case is a file from a *later* build, which is the one nobody can migrate
 * from in advance. A version 3 document read by a build that had no gate would parse
 * perfectly: its values are all still parameters this registry knows, `params.apply`
 * would write every one without complaint, and only the reading would be missing, leaving
 * whatever the previous document happened to select. A file that renders as somebody
 * else's shading, silently, is worse than one that fails to open. That argument does not
 * weaken when the converter goes; it is the whole reason the field exists.
 *
 * **Two bands rather than four, and the two that survive are the two that were never about
 * a conversion.** The four used to be a version 4 document, a version 3 document, versions
 * 1 and 2, and everything else - and the first three existed to name which migration steps
 * stood between the file and this build, so they went with the migration. What is left is
 * the distinction a reader can still *act* on: a document older than anything this build
 * reads is a file to leave alone, and a document from a later build is a build to upgrade
 * to. Those are different next steps, and collapsing them would be the failure the
 * paragraph above this one describes - a refusal that diagnoses the wrong thing is worse
 * than one that says only "no", because it is followed.
 *
 * **Three, once a malformed version is counted, and the third is here because the first
 * draft of this got it wrong.** A comparison is the natural way to split older from newer,
 * and `undefined > 5` is `false` - so a document with no version field at all, or one
 * carrying a string, falls to whichever side the comparison defaults to and is told
 * something specific and untrue about its age. That draft's own comment claimed it tested
 * for a number first; the code did not, which is the shape `docs/instruments.md` names as
 * worse than no comment, because the comment is the thing a reader checks instead of the
 * line. A version that is not a finite number is its own answer now, and it is the honest
 * one: the field is missing or is not a version, which says nothing about old or new.
 *
 * The version is quoted rather than described so that a file from a later build reports its
 * own number instead of being told something about a format that predates it.
 */
export function versionRefusal(what, version) {
  const across = !Number.isFinite(version)
    ? 'its version field is absent or is not a number, so it is not a document this build can '
      + 'place at all - which says nothing about whether it is older or newer'
    : version > PROJECT_VERSION
      ? 'it is from a later build than this one, so nothing here knows what it means - this build is '
        + 'the thing to move, not the document'
      : `nothing in this build reads a document that old and there is no path from here to `
        + `${PROJECT_VERSION}, because this repo ships no conversion`;
  return `${what} is version ${JSON.stringify(version)} and this build reads version ${PROJECT_VERSION}: ${across}`;
}

/**
 * The generation of the capture format this build writes and reads, in one place for
 * the same reason the document's version is - except that the artifact it stamps
 * cannot be re-authored.
 *
 * A project can be rebuilt from a look somebody still remembers and an index can be
 * rebuilt from the capture it indexes. The capture is the shoot: whatever the room
 * was doing at that moment exists as those bytes and nowhere else. So the argument
 * `PROJECT_VERSION` makes - a build that cannot faithfully interpret a file refuses
 * it rather than rendering somebody else's meaning silently - is the same argument
 * here with the stakes moved, because a document read wrong can be read again and a
 * take reprojected wrong is a take nobody will ever notice was reprojected wrong.
 *
 * The failure this exists for needs no adversary. Change the depth quantisation, or
 * move `registration.undistortDepth` on the no-colour path, and every take written
 * afterwards is byte-indistinguishable in *structure* from every take written before:
 * same magic, same two message types, same hello keys. One geometry model then runs
 * over two populations and the older half of the archive is quietly wrong, with
 * nothing on screen to attribute it to.
 *
 * ---
 *
 * **Version 1 is the format as it settled**: u16 millimetre depth on the sensor's own
 * 512x424 grid, colour registered into that grid, and the intrinsics in the hello. It
 * is `1` rather than a larger number because nothing has moved the depth quantisation
 * or the registration path since the format settled - a version field that lies is
 * worse than none, so if a geometry change ever turns out to already be in the
 * archive, this number is wrong and saying so is the only honest repair.
 *
 * **Three bands, and the first is the one that keeps the existing archive readable.**
 *
 * A hello carrying no `format` key at all is honestly generation zero and opens.
 * Every take on disk today is one, the field cannot be added to them retroactively -
 * nothing in this program rewrites a capture, deliberately - and `describeTake`
 * already reads `startedAt` by exactly this presence-sniff for exactly this reason.
 * Presence-sniffing works once, which is what this field is for: it is the last time
 * an absent key has to mean anything.
 *
 * A hello carrying `CAPTURE_FORMAT` opens, because this build wrote it.
 *
 * Anything else is refused - a later number, or a `format` that is not a number at
 * all. Refused rather than unprojected on this build's assumptions, and naming what
 * it found, because a take from a generation this build has never heard of is
 * geometry nobody can check, which is the same case the no-hello refusal covers one
 * band earlier.
 *
 * **Bumping this number is a decision about every earlier one, and the comparison below
 * is deliberately strict so that it cannot be made by default.** `format === CAPTURE_FORMAT`
 * means the day this becomes 2, every generation-1 take is refused unless the same commit
 * says what happens to them - an accept set, or a refusal somebody chose. That is the
 * right way round for the one artifact that cannot be made again: locking the archive out
 * should be something a person wrote down, never something that fell out of an increment.
 */
export const CAPTURE_FORMAT = 1;

/**
 * The sentence a take from a format this build cannot read gets, and the predicate
 * behind it: empty when the take may be opened, the reason when it may not.
 *
 * One function rather than a comparison at each door, and `versionRefusal` above is
 * the precedent - two doors saying different things about one file is how one of them
 * ends up false. There are four doors here rather than two. `describeTake` decides
 * `openable`, the gallery's badge says why, its dead Open button says why, and
 * `openTake` refuses in the editor; the first three are cheap to satisfy by inlining
 * a comparison, and an inlined comparison drifts the first time the band gains a
 * member. It will gain one: recording HD colour into takes is a third message type,
 * which is a format change by any reading.
 *
 * `what` is a noun phrase the caller owns, because the gallery is talking about a
 * tile the reader is looking at and the editor is talking about an id in a URL.
 */
export function captureFormatRefusal(what, format) {
  // **Absent and an explicit null are one answer, and that is a choice rather than a
  // constraint.** JSON distinguishes them perfectly well and `'format' in hello` would
  // read the difference, so the honest statement is what the difference would cost and
  // buy. Costs: a second channel through the listing, since `describeTake` ships a value
  // and not the key's presence, so the browser would need a declared-flag or a sentinel
  // beside it. Buys: protection against a writer broken twice over - one that learned
  // the field, stamps a literal null instead of a number, *and* moved the geometry. A
  // null-stamping writer whose geometry is unchanged is opened on this build's
  // assumptions, which is exactly what generation zero gets anyway.
  //
  // Refusing the literal null is the defensible other reading and costs no take on disk
  // today, since none of them carry the key at all. It is written down here rather than
  // settled because the wire cost is real and the hazard needs both failures at once.
  if (format === null || format === undefined) return '';
  if (format === CAPTURE_FORMAT) return '';
  return `${what} was written in capture format ${JSON.stringify(format)} and this build reads `
    + `format ${CAPTURE_FORMAT}: nothing here knows what geometry that generation recorded, and a `
    + 'take is the one thing in this program that cannot be made again, so it is refused rather '
    + 'than unprojected on assumptions that may not be its own';
}

/**
 * What may be a take id, a document name, or anything else this program joins to a
 * path - and it is here, beside the version, for the same delivery reason.
 *
 * It began in `server/library.js` and was moved when the gallery grew a rename box.
 * A rename that only learns its name was refused after a round trip is a rename that
 * spells the rule out in an error message; a box that greys its own button says the
 * same thing before the request. Those are two statements of one rule, and the
 * failure mode of two copies is not that they disagree loudly - it is that the page
 * quietly accepts something the server refuses, or refuses something the server would
 * have taken, and the operator learns which by trying. So there is one regular
 * expression and both sides import it.
 *
 * **The page's copy is a courtesy and never a gate.** `server/library.js` asserts it
 * on every path it forms, because a request does not have to come from this page at
 * all - a node's manifest and a `curl` are both callers, and neither ran any
 * JavaScript this repo wrote.
 *
 * The leading character rules out `..` on its own; the rest rules out a separator. An
 * underscore is allowed so the editor's reserved auto-save name `__working__` is a
 * valid document name.
 */
export const VALID_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * The sensor's depth grid, and it is filed here for the delivery reason above rather
 * than for the document-format one.
 *
 * Nothing about 512x424 is a property of the document format, so a reader arriving at
 * the top of this file has every right to wonder what a sensor dimension is doing
 * beside a version number. The answer is the second half of the header's argument and
 * not the first: the browser can only import what the server serves, `web/` is what
 * gets served, and Node has no such constraint and reaches for it by path. That is the
 * whole of why this file exists as a shared home, and the grid needs exactly that home
 * for exactly that reason - `web/main.js` and `web/library.js` are pages,
 * `server/capture.js` is not, and all three have to mean the same grid.
 *
 * It was declared four times before this, twice inside `web/main.js` alone under two
 * different names 1,646 lines apart, and spelled out as bare literals a fifth time in
 * the monitor's cost line - under a comment promising the number was "stated from the
 * grid rather than from a table, so the number cannot drift from what the sender is
 * actually building". It was stated from two literals typed a third time, which is the
 * duplication having already started saying something untrue.
 *
 * **`native/grabber.cpp` declares the pair a second time and that one is correct.** No
 * JavaScript import reaches a C++ translation unit, so the grabber has no way to be a
 * reader of this and is the one honest second declaration. It is what the hello
 * carries, so a device with a different grid changes both files and nothing between
 * them.
 *
 * The proof tools keep their own copies too, and deliberately: a check that imported
 * the constant it asserts would be holding a `512` against itself.
 */
export const DEPTH_W = 512;
export const DEPTH_H = 424;

/**
 * How many cells that grid has, which is here because its two readers have nothing else
 * in common.
 *
 * `web/main.js` measures an arriving frame's depth block against it and refuses one that
 * is not that many samples, and divides by it to turn a count of returns into a share of
 * the sensor; `web/point-cloud.js` allocates two vertices per cell and addresses every
 * point by it. The first is a statement about the wire and the second is a statement about
 * the renderer, so filing it under either one would have the other importing a module it
 * has no other business with - which is the same delivery argument the grid above it is
 * filed here on, one derivation further along.
 *
 * It is a declaration rather than `DEPTH_W * DEPTH_H` written at each site for the reason
 * that pair is one: a second spelling of a derived constant is the same drift as a second
 * spelling of what it derives from, and it takes a multiplication rather than a glance to
 * see. `server/capture.js` still writes the product out where it refuses a depth block,
 * and that is a third spelling this could absorb rather than a claim that it has.
 */
export const POINTS = DEPTH_W * DEPTH_H;

/**
 * How many decimal places a number is written to, which is how far the registry rounds a
 * value after snapping it onto its slider's grid.
 *
 * **It is here rather than beside its one caller because it is the only piece of that
 * arithmetic a bare-node test can reach.** `normalise` in `web/main.js` snaps a value onto
 * `step` and then rounds to the decimals `min` and `step` imply, which is what keeps a
 * value set headlessly and the same value set through a slider from landing a hair apart -
 * and `web/main.js` is a browser module with a top-level fetch in it, so the rule could
 * only ever be exercised through a GPU browser. Pulled out, it is a pure function of a
 * number and `test/param-grid.test.mjs` holds it to the cases below.
 *
 * **A dot in the decimal spelling was the whole of the rule and JavaScript stops writing
 * one.** `String(x)` switches to exponent notation below 1e-6, so `String(1e-7)` is
 * `"1e-7"` with no dot anywhere in it - which read as zero decimals, and a parameter
 * declaring that step had every value it ever held rounded to a whole number. The range
 * collapsed to its integer positions with every control still moving and every slider
 * still showing a number, which is the shape that gets found by somebody wondering why an
 * effect only has two settings. The exponent is read now, so the count is what the value
 * actually needs: `1e-7` is seven places, `1.5e-7` is eight, and `1e+21` is none because
 * there is nothing after the point.
 *
 * Capped at the 100 places `toFixed` will accept, because a step below 1e-100 would
 * otherwise turn a rounding into a `RangeError` on the first write. The install door
 * refuses a step finer than 1e-6 long before that, so the cap is for the values that do
 * not come through a door - a core parameter declared here in this repo.
 */
export const decimalsOf = (x) => {
  const s = String(x);
  const e = s.search(/[eE]/);
  if (e < 0) {
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
  }
  const mantissa = s.slice(0, e);
  const dot = mantissa.indexOf('.');
  const fraction = dot < 0 ? 0 : mantissa.length - dot - 1;
  return Math.min(100, Math.max(0, fraction - Number(s.slice(e + 1))));
};
