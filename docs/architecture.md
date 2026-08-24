# Architecture

How the program is put together, and the two coordinate decisions that everything else
follows from. [README.md](../README.md) has the usage path; this is the layer under it.

```
Kinect v2 ──USB3──▶ native/grabber ──framed stdout──▶ server/index.js ──WebSocket──▶ web/main.js
                    (libfreenect2 +                   (fan-out, drop-to-latest)     (GPU unprojection,
                     OpenCL depth,                                                   217k points +
                     TurboJPEG colour)                                               surface memory)
```

A native grabber pulls depth and registered colour from
[libfreenect2](https://github.com/OpenKinect/libfreenect2), a Node server fans the frames
out over WebSocket, and a Three.js viewer unprojects them on the GPU using the sensor's own
intrinsics. On top sit a recorder, a take library that reconciles between two machines, a
keyframe editor with a retime curve, and a render queue that exports through ffmpeg.

Depth and colour are captured on separate listeners: the colour camera halves to 15fps in
dim light while depth stays at 30, and a synced listener would throw away every other depth
frame waiting for it. Depth runs at its own rate and reuses the most recent colour, at worst
one interval stale. The grabber logs both counts, and beside them the frames libfreenect2
handed over having already marked its own solve as failed —
`600 frames (293 colour, 0 bad depth, 0 bad colour)`. A lagging colour rate is the one thing
that explains a stale-looking image, and the two refusal counts are the one thing that
separates a machine whose GPU readback is failing from a degraded USB link: a refused depth
frame does not advance the frame count, so the rate drops either way and only these say which.
They are printed whether or not they are zero, because a build that has stopped counting and a
run with nothing to count would otherwise read identically.

## The four surfaces

The reasoning behind each one lives in the comments of the file that implements it.

**The viewer** is the live cloud, and the recorder shares the surface because arming a take
is something you do while watching.

**The recorder** waits for the sensor's hello, then streams frames straight to disk in the
wire's own framing, so a capture is byte-identical to what the grabber emitted. It refuses a
take it lacks the disk space to finish. Its preview clip range is cosmetic and deliberately
cannot reach the grabber's `--min-depth`/`--max-depth`, which clip on the GPU before a frame
exists.

**The library** joins takes across two machines on content hash rather than filename,
because two machines can hold genuinely different takes under one name. Takes can be pulled
down, and a copy reclaimed on the node after the local one is re-hashed. Warnings
(truncated, no sensor hello, no whole frame, still recording) are badges over the poster
with their sentence in the ⋯ menu, because the node's panel has no hover.

**Renaming moves a label and never a reference.** A project records its take as
`{id, hash}` and the loader compares only the hash, so a rename carries the capture, its
marks and its index to a new name and every project still opens. Two renames aimed at one
name are refused by the kernel rather than by a stale reading, so the loser keeps its
footage.

**Showing a take in the file manager is the only route that starts a process**, so it sits
behind the same origin gate as everything else with a consequence, is refused unless the
browser is on the server's machine, and is refused for the take being recorded, since a file
manager stats, indexes and previews the file the recorder is writing to.

**The editor** keyframes the camera through the recorded volume on its own track and the
look on others, with a retime curve mapping program time onto source time. Seeking to a
frame and playing to that frame produce the same image, which `tools/timeline-check.mjs`
proves.

**The render queue** produces video from finished edits, claimed by a worker pinned to the
renderer class it will draw with. [Get a video out](../README.md#5-get-a-video-out) has the
rest.

## The effect store

The look is not one program. Every effect is a package — a manifest and the GLSL chunks it
splices into the shaders — and the page assembles both point-cloud programs, the grade pass, the
parameter registry and the panel out of whatever the store holds. `server/effect-store.js` serves
them and `web/shader-assembly.js` joins them.

**Two roots, and the user's copy wins.** `effects-builtin/` is what the build ships with and
nothing in this program writes into it; `effects/` is where an install lands. An id present in
both resolves from the user's, which *is* the fork mechanism: install a package under a shipped
id and it shadows the shipped one, delete that copy and the shipped one answers again. The
shipped set is therefore always available to fall back to, which is why removing a builtin
nothing forks is refused rather than performed. It is the same shape the preset store uses, and
what makes it its own class rather than a fourth construction of that one is what is stored: a
package is a directory of files, so a revision has to be computed over the set and a read has to
say which files exist before a client can fetch them one at a time.

```
GET    /effects              every id either root holds, each with its files and revisions
GET    /effects/:id          one package: the parsed manifest, the file index, the revision
GET    /effects/:id/file/:n  one file's bytes, as text/plain
PUT    /effects/:id          { manifest, chunks: { <file>: <text> } }  installs into effects/
DELETE /effects/:id          removes the user's copy only
```

A revision is a hash of the bytes: `sha256` per file, and the package's own over the sorted
`name hash` lines. Never a re-serialisation — a manifest that round-trips through `JSON.parse`
is a different byte stream with the same meaning, and provenance is about bytes.

**An install is atomic because a package is a directory.** The whole thing is written under
`<id>.<seq>.tmp`, any existing copy is renamed to `<id>.<seq>.old`, the new one is renamed in and
the old one deleted. Those suffixes carry a dot and an effect id may not, so a crashed install is
invisible to every read by the same rule that decides what an id is — and the next install of
that id sweeps what it left.

**Between those two renames the id resolves to nothing, and that window is the one place this
store can lose work.** A machine losing power there comes back with the only copy of the package
in its aside and nothing at the live id, which reads as an uninstall rather than as damage — so
the store puts it back when it is constructed, before anything can read it, and the sweep removes
an aside only while there is a live directory beside it to measure against. An uninstall renames
aside too, and its aside is named `<id>.<seq>.gone` for exactly this reason: one suffix per
intent, so "should this come back" is answered by the name rather than guessed at, and a recovery
that could not tell the two apart would undo somebody's uninstall on every restart.

**A package file is an ordinary file.** `effects/` is the one directory in this program a client
can write into, so the file route asks what a name *is* rather than what it points at — a symlink
planted there is refused whether or not it aims somewhere legitimate, which is a narrower rule
than the realpath-and-containment pair the static tree uses and needs no notion of where the roots
are.

What may be written at all is decided before any of it: the door in
`server/effect-door.js` runs the real assembler against the set that would exist after the
install, and a package that would not assemble, would bind a uniform no program declares or would
name an identifier this build has not got is refused with the reason and never reaches disk.
A parameter whose `def` or `max` is not on the step grid its own `min` anchors is refused there
too, and the door asks by running `snapScalar` — the arithmetic the registry snaps with — rather
than by describing it: a default the snap would move is a number the manifest states and the
program never holds, which makes an untouched effect read as modified from the first paint and
puts a `requires` entry for it into every document saved afterwards. The
alternative is a package that installs cleanly and breaks the *next* page load, where the only
evidence is a console nobody has open.

### Assembly: a spine with joints, and the chunks that fill them

`web/cloud-shader.js` and `web/grade-shader.js` each export a **spine** — verbatim GLSL segments
with named joints between them — and `web/shader-assembly.js` concatenates a spine with whatever
the installed packages bring. Neither module imports anything and neither interpolates: a chunk's
text is spliced between two segments exactly as it arrived, because every transformation on the
way is a byte that could move without breaking a compile or showing in a picture anybody would
look twice at.

A joint is one of four kinds, and the kind decides what filling it means:

- a **stage** takes any number of chunks, concatenated by the `order` each declares — which is
  why two packages can both add uniforms to one declaration block;
- a **slot** takes at most one claimant and carries the text to use when nothing claims it, so a
  slot is a *replacement* and an uninstalled effect is exact identity by construction;
- a **service** is a value the spine computes under a gate its consumers generate, the condition
  built from each consumer's own `when` clause and joined in `gateOrder`, so a term that reads
  the value without joining the gate is inert rather than broken;
- **varyings** are generated from the packages' declarations in all three places at once — the
  `out` list, the `in` list and the initialisation — so one declaration is the only statement of
  the fact.

Joint names are collected across every spine at once rather than per spine, so two spines
offering one name is a refusal rather than a chunk quietly spliced into both. A chunk naming a
joint nothing holds is refused by name, for the same reason the alternative design was rejected:
tagging each chunk with its program's name means a tag nobody spelled right lands the chunk in no
program at all, the page boots, and the effect is simply gone.

### Hotload is boot, run a second time

`adoptEffectPackages` rebuilds the shader programs, the parameter registry, the panel and the
uniform cells from a set of packages, and ends by walking every value back through `params.set`.
Boot is its first call. There is no separate install path, which is the point: a code path that
only runs after an install is a code path nobody exercises until it matters.

Parking and unparking are the serialise/restore round trip rather than two loops. An arriving
effect finds its values in the document and applies them; a departing one finds them unrecognised
and parks them, and the badge, the validation and the suppression prune all fall out of code that
already existed. Pages converge by comparing revision lines every few seconds, standing down
while an export, a preset gesture or a track evaluation is running, and asking again after the
last read so a gesture that starts mid-poll defers it rather than being run over.

**A hotload that fails part-way puts the page back.** The door is not a compiler — GLSL that is
syntactically broken while naming only identifiers this build has gets past it, and a shader that
will not link is a log line rather than an exception — so the page warms the swapped programs and
treats a link failure as a throw. Restoring the open document can throw too, reachably: install a
fork that adds a parameter while a document holds that effect and the completeness rule refuses
the subset. Either way the page re-adopts the packages and the programs it was holding and
restores the document it had, synchronously and without the network, because the moment there is
nothing left to fall back to is the wrong moment to need a fetch. The corner where the rollback
itself fails says to reload the page and repaints nothing, since a panel painted over a state no
document describes is a page that looks well and is not.

### A document may name an effect this build has not got

The refusal splits three ways on one predicate. A bare name core does not know is a typo, and a
dotted name whose package *is* installed but lacks the suffix is a half-package: both refuse. A
dotted name whose prefix is not installed **parks** — the viewer loads, the installed part renders
pixel-identically, and the values and tracks under that prefix go to a pool nothing evaluates and
nothing destroys. The serialiser merges the pool back without inspecting it, so a load-save round
trip through a build lacking the effect returns every parked key holding exactly the value it
arrived with — nothing renormalised, nothing rebuilt, nothing dropped and nothing added beside it
— and `requires` carries the document's own entries whole so version and revision survive. Presets
exclude the pool by construction: a project merges it back and a preset must not.

**Per key and not per byte, which this page said the other way round for a while.** Two things in
the round trip move bytes without touching a value: the parked keys are appended after the
installed ones, so a document that interleaved them comes back re-ordered, and every number goes
through `JSON.parse`, which reads `1e0` and writes `1`. A load and save on a machine missing an
effect therefore changes the file and moves its revision. That is accepted — what the parking
promises is that the work is intact, not that the file is the one it was — and the distinction is
worth keeping straight, because `tools/library-check.mjs` proves the value property and no arm
anywhere proves the byte one.

**An effect that is here at another version is surfaced and never refused.** `requires` carries
a version and the loader compares it against what is installed, but a version string says nothing
about which direction is compatible, so refusing would make every retune of an effect a wall in
front of every clip on the machine. The clip loads, the installed version draws it, and the bar
carries `document requires glyph 1.0.0, installed is 2.0.0` — a line and no control, because
there is nothing to decide and export is not refused for it. The notice does not survive the next
save, which is the derived field working rather than a loss: the list records what the document
was last built from, and this machine has now built it.

Export refuses by default while anything is parked, naming the ids and versions, because a video
leaves this machine and nothing in it says a layer of the look was absent. Suppressing is the
operator saying this render may go without that effect, per effect and per session, and the
deliverable's sidecar records what was skipped rather than rewriting the clip.

## Program time is the edit coordinate

Source time is a position inside the capture; program time a position inside the output.
They advance together at normal speed and diverge under a ramp, a hold or a reverse, so
every keyframe has to be stamped in one of them. Every track here, including the retime
curve, is in program time, and rendering is forward-only: `programTime = k / outputFps`,
evaluate the tracks, `sourceMs = retime(programTime)`, binary-search the index.

- **Export needs no inverse.** Keying in source time would force export to invert the retime
  curve, which requires it to stay monotonic, so a hold or a reverse breaks it outright.
- **The camera keeps its own pace when the footage slows**, which is the creative point: a
  photographer's movement is independent of what they are filming. This is about the retime
  *curve*, where a ramp leaves the program length alone so a camera key at program 10s stays
  there. The speed control is different: it changes the clip's output length, so every
  program time is reparameterised together, camera track included.
- **`fade` and `wake` stay in source time**, because they drive surface memory, which
  advances per source frame. Dividing by the local retime slope would divide by zero at a
  hold, snapping every trail off exactly where a freeze should hold it.
- **`outputFps` is the project's, not the deliverable's**, and the line above is why: it is
  the denominator of the edit's own coordinate, so two deliverables at two rates would be
  two different edits rather than one edit written out twice. `trails` makes it visible —
  it is the one look term whose length is counted in output frames rather than in seconds,
  because `AfterimagePass` multiplies the picture it holds once per rendered frame with
  nothing in the expression about how long a frame lasted. At damp 0.9 a trail is down to
  12% after twenty frames, which is 0.83s at 24fps and 0.33s at 60.

The shape the stage is letterboxed to is document state for the same reason and the pixel
count is not. A project carries `aspect` as a reduced integer pair — `[16, 9]`, `[256, 135]`
— because the camera was keyed against a frame, so reopening a 65:24 edit at 16:9 would be a
different shot with the same keys. A deliverable carries the resolution, because every
screen-space term is expressed against 1080p and bloom's chain is frozen at 600 whatever the
buffer is, so two sizes of one shape reopen identically. Both fields are additive and neither
bumps `PROJECT_VERSION`, which presets share: absent `aspect` means the shape of the legacy
`outputSize` beside it, and absent `outputFps` means 30. Deliverables have their own version
and it is 2 — a version 1 document names a rate this build ignores, so it would parse
perfectly and render the wrong file, which is what a version gate is for.

Frame index was rejected as a coordinate because capture frames are not evenly spaced in
time, so constant motion through index space is visibly variable motion through real time.

## Surface memory

A ray landing on a different surface between frames is a death and a birth, and teleporting
the point was the loudest artifact in the image: 3.14% of pixels flip valid/zero every frame
pair, 44x more than the snap threshold ever touches. A ping-pong float target remembers
where each ray used to be and how long ago it swapped.

- **`fade`** cross-fades the transition, the new point ramping in as the old one thins out.
  120ms by default, and the correctness half.
- **`wake`** lets a hard transition linger past the fade, shedding a trail from moving
  silhouettes. 0 by default, 550ms under Blackwall.

Wake length keys off the local depth spread rather than the raw transition, which keeps a
static scene from shimmering. Measured live, of 2.56% of pixels swapping per 50ms, 2.36%
classify soft (the depth solve's confidence gate chattering on a flat wall) against 0.20%
hard.

Both are in milliseconds, so a better frame rate does not silently shorten the look. At zero
the ghost geometry leaves the draw range and the original 217088-point draw is restored
exactly; `__kinect.stateStats()` reads the memory back.

## Frame interpolation

The sensor delivers 30fps on a healthy USB topology while the display runs at 120Hz, so the
vertex shader blends between the last two depth frames rather than holding each one until
the next arrives.

- **Blend time comes from measured arrival spacing** kept as an EMA, not an assumed 30fps,
  because guessing the interval wrong on a degraded link stutters worse than not blending at
  all. The blend clamps at 1.0 so a late frame holds on the newest data rather than
  extrapolating past it.
- **Discontinuities snap instead of lerping.** A hand crossing in front of a wall jumps
  metres between frames, and interpolating that draws a smear through empty space for the
  whole interval. Above `snap mm` the point jumps to the new depth.

Both are verified against synthetic depth planes rendered offscreen: a 1200 mm jump lands
exactly on the new depth, a 100 mm drift interpolates to the midpoint. Worth re-checking
against real motion, since the sample this was written against is nearly static (0.06% of
pixels exceed the snap threshold between frames).

## Wire format

One framing for the live stream, the recording and the replay, so a capture file
is byte-identical to what the grabber emits:

```
[u32 magic 'KNCT'][u32 type][u32 payloadLen][payload]

type 1  hello  UTF-8 JSON, once, before any frame:
               { format, serial, firmware, width, height, fx, fy, cx, cy,
                 color, minDepth, maxDepth, lowLight, startedAt }
type 2  frame  [u32 depthBytes][u32 colorBytes][u64 timestampMs]
               [u16 depth[512*424] millimetres, 0 = no reading]
               [JPEG of the registered 512x424 colour image]
type 3  colour [u64 timestampMs][JPEG of the native 1920x1080 colour image]
               Live only, and only while something is subscribed.
```

**`format` is the generation of the capture format, and a take carrying no `format` key is
generation zero.** Nothing migrates old captures, because rewriting a capture to add a key
is the one operation this design will not perform on an artifact that cannot be shot again.
A take declaring nothing opens, a take declaring this build's generation opens, and anything
else is refused rather than unprojected on assumptions that may not be its own.
`web/format.js` owns the number, `native/grabber.cpp` carries the only other spelling, and
`tools/syntax-check.mjs` requires the two equal and this key list to be exactly what the
grabber emits.

**Four of the other keys are load-bearing.** `startedAt` is the only durable capture date a
take has, since frame stamps are `steady_clock` and monotonic since boot; a writer that omits
it lands every take dated by mtime, so the gallery's ordering silently becomes "when it was
last copied", and it degrades quietly because `describeTake` reports `dateSource: 'mtime'`
rather than an error. `minDepth` and `maxDepth` say how much of the world the file was
allowed to contain, and the editor paints its preview range from them. `lowLight` says
whether the colour camera was run long-exposure.

**`startedAt` means one thing on the wire and a narrower thing in a file, and the difference
is the whole reason the field works.** The grabber says hello once per process, so the value
it sends is when *the grabber* came up. Written straight through, that put a byte-identical
date on every take of a session and none of them was when its own take was shot — two takes
nine minutes apart came back indistinguishable, on the one field the gallery sorts and prints.
So `Recorder.open` replaces it: the hello it writes into a take carries when *that take*
began, which is the clock it already has to stamp the take with anyway. On the wire the key
is the session's; in a `.knct` it is the take's, and a take is the only thing a file is about.

The key is reused rather than joined by a second one, and that is a deliberate trade. One
reader consumes it — `describeTake`, for `capturedAt` — so there is no caller that could want
the session start out of a file and get the take start instead. A new key would have been the
tidier spelling and it would have had to be emitted by `native/grabber.cpp` to satisfy
`syntax-check`'s hello-key comparison, which would mean the C++ emitting a field only the Node
recorder can fill in. Takes shot before this carry the session stamp and nothing in the file
distinguishes them from takes shot after, so their dates stay as they were: wrong in the same
way, and not detectable without a marker that was deliberately not added.

**Type 3 is live-only, so "byte-identical" means identical to the type 1 and 2 subsequence.**
The colour message is dropped at the recorder, because a third message type in the file would
move every take's content hash, which is the key the library joins two machines on.
`vcam-check --mutate hd-reaches-recorder` keeps that true.

Measured over a real capture: 434,176 bytes of depth plus a 49-59KB JPEG, 486KB per frame. At
30fps that is 14.6MB/s, or 117Mbit/s per connected browser: fine over ethernet, right at the
practical ceiling of Wi-Fi.

The grabber writes frames to stdout and every log line to stderr, because one stray log line
on stdout would desync the stream permanently. The browser needs `fx/fy/cx/cy` from the hello
to unproject, and hardcoded intrinsics skew the cloud in a way that is hard to spot and hard
to attribute.

**Every frame in this format is horizontally mirrored, and the readers undo it rather than the
writer.** libfreenect2 delivers depth, IR and colour flipped left-for-right on purpose, to
match the Microsoft SDK's selfie-view convention, and the grabber `memcpy`s the buffer through
untouched, so the sensor's frame reaches the file exactly as the driver produced it. The
correction is one sign in the unprojection — `X = -(col + 0.5 - cx) / fx * z`, with `cx` used
exactly as the hello reports it, because the grid width cancels out of the algebra. That is one
sign away from `Registration::getPointXYZ`, which pairs the same mirrored image with an x that
grows right and therefore describes a reflection of the room; `server/protocol.js` carries the
derivation and the warning not to copy upstream back in.

**Undoing it in the readers rather than in the grabber is what keeps the archive
single-valued.** Flipping columns before the wire would leave every take shot before the change
mirrored and every take after it not, with nothing in the file to tell them apart — the split
that `format` exists to prevent, arriving through a different door. Correcting on the way out
means one geometry for the whole archive, old takes included. The cost is that the sign is
stated by five readers (the vertex shader, the top-down, the gallery poster, and the oracles in
`export-check` and `monitor-check`) plus this specification, and `level-check` section 8 is what
holds them to one answer.
