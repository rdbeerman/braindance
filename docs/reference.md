# Reference

Command line, controls, the five readings and presets. [README.md](../README.md) has the
usage path; this is the detail behind it.

## Command line

Options pass through to the grabber:

```bash
node server/index.js --pipeline cpu     # CPU depth instead of OpenCL
node server/index.js --no-color         # depth only, no colour stream
node server/index.js --port 9000
node server/index.js --record           # a flag, not a path - takes are named and
                                        # placed in captures/ by the recorder
node server/index.js --replay captures/session.knct
node server/index.js --host 0.0.0.0     # reachable from other machines - see below
node server/index.js --effects ~/fx     # where an installed effect package lands
node server/index.js --builtin-effects ./effects-builtin  # what the build ships with
```

**The two effect roots are the fork mechanism, so pointing one of them somewhere else
moves what shadows what.** `--builtin-effects` is the shipped set and nothing in this
program writes into it; `--effects` is the writable root an install lands in, and an id
present in both resolves from there. Both default to directories beside the checkout, and
the flags exist because a proof tool needs a search path it controls rather than the one
the developer happens to have installed packages into. A server whose builtin root is
missing refuses to boot rather than answering an empty list, since a broken install must
not read as nothing-installed.

**`--record` arms the *first* take rather than offering the recorder.** The flag is read
once at boot and spent when you stop that take; arming again is the record button. So
`npm run record` writes from the moment the server is up, and `npm start` is the one that
lets you decide when.

`--replay` loops a recorded capture, for iterating on shaders with the sensor unplugged. It
replays the *recorded* arrival spacing rather than a uniform 30fps: a degraded link runs
p50 64ms against p90 222ms, so even pacing would hand the viewer the one cadence that never
happens.

## Reaching it from another machine

**There is no authentication anywhere in this program**, so whoever can reach the port can
arm the recorder and start or stop a take. The server binds `127.0.0.1` unless you pass
`--host`, and says on stdout when it did.

Mutating routes and the WebSocket upgrade require a same-origin `Origin` and an address
rather than a hostname. The socket is included because `WebSocket` is exempt from the
same-origin policy and sends no preflight; the hostname half exists because comparing
`Origin` against `Host` was measured reaching every mutating route on the default loopback
bind through DNS rebinding. It stops hostile pages and nothing else: curl and other machines
on the Wi-Fi send no origin and are allowed everything. `tools/guard-check.mjs` proves both
halves, and [SECURITY.md](../SECURITY.md) has the threat model.

## Viewer and timeline controls

Drag to orbit, scroll to zoom, right-drag to pan, `H` hides the panel.

The ruler shows a *window* of the clip, because a fifteen-minute take across one screen puts
a keyframe against gradations forty times coarser than the thing being placed. Scroll to
zoom about the pointer, `+`/`-` about the playhead, `,`/`.` to pan, `F` to fit the clip, `Z`
to frame the trim. The overview underneath is always the whole clip: drag its box to pan, an
edge to zoom, click to go there.

**Easing a move.** Select a key and the `key options` row shapes the segments either side of
it: `lin`, `in`, `out`, `smooth`, `glide` and `hold`, or drag the handles in the lane for
anything in between. `in` writes the incoming side and `out` the outgoing one, so they are two
different numbers rather than two halves of one, and `hold` reaches into the next key because
holding a value across a segment means flattening both ends of it.

`ends` is the odd one and the one you probably want on a camera: it is about the *track*
rather than about the selected key, shaping the move's departure and its arrival in one press
and leaving every key between them alone. Press it from anywhere on the track.

This works on the camera track as well as on the look scalars, and what it shapes there is
*when* the camera arrives rather than where it goes. The route stays the Catmull-Rom through
your keys whatever the handles say — easing remaps the traversal and moves no key — which is
why the composition track can have a lane at all without contradicting the rule that a camera
move cannot be judged from a graph. The camera lane draws that remap directly: one ramp per
segment, rising from the key it leaves to the key it reaches, so a linear segment is a plain
diagonal and an eased one visibly is not. Judge the result in the world instead — the beads
on the path are sampled at equal intervals of program time, so they bunch where the camera is
slow and spread where it is fast.

**A camera move starts and stops at speed until you ease it, and `ends` is the one press that
fixes it.** The spline holds the end pose beyond the outer keys while its tangent there is
half the first segment's average velocity, so an unshaped move departs the first key and
arrives at the last with a step in speed rather than a ramp — measured on three keys dollying
4m over 4s, 0 to 0.63 m/s across a single 30fps output frame at the start, and 0.31 to 0 at
the end. After `ends` the same move departs at 0.0007 m/s and arrives at 0.0005, which is two
hundred times smaller and below anything a frame can show.

This used to be two presses of `smooth`, one on the first key and one on the last, with an
inviting wrong move in between: `smooth` on an *interior* key brings the camera to a near halt
as it passes, so easing "the whole move" by pressing every key produced a stutter at each one.
That still works and is still what you want when a deliberate pause at a key is the intent —
`ends` exists because the common case should not require knowing any of it.

**`glide` is `smooth` one degree up, and the difference is acceleration rather than speed.** A
cubic can bring the camera's *rate* to zero at a key but never its acceleration, so a `smooth`
departure still steps from no acceleration to some. `glide` puts two control points on each
side of the segment instead of one, which makes the timing curve the quintic
`6u⁵ − 15u⁴ + 10u³` — the shape whose first *and* second derivatives vanish at both ends. It
costs a slightly faster midpoint, 1.875× the average rate against the cubic's 1.724×. `ends`
applies the glide shape, so the one-press fix is already the C2 one.

**`+pt` and `−pt` set how many control points a key's handles carry**, which is the degree of
the segments either side. `+pt` is exact: the extra handle appears, every other one shifts to
keep the curve exactly where it was, and not a rendered frame changes — so it is safe to press
while judging a move. `−pt` cannot be exact, because a curve of one degree is not generally a
curve of the degree below, so removing a point moves the shape. Four points a side is the
ceiling. The retime curve is deliberately excluded from both: the argument that a handle
inside the unit box cannot run source time backwards is an argument about a cubic, and it does
not survive the extra degree.

**Glitch** tears bands of the feed sideways, and it is seven controls rather than
one because the interesting looks live off the diagonal. `amount` is the master and the one
worth keyframing — it scales density and shove together, so corruption fades in and out on a
single track. `density` is what fraction of the bands tear at a full master and `shove m` is
how far one travels, in metres in the room: sparse-and-violent and dense-and-subtle are the
two ends those give you, and neither is reachable from a single slider. `flare` is the cyan
a torn band burns, per metre it was shoved, so a bigger tear lights harder on its own.
`band rows` is the height of a band in the sensor's own scanlines — 424 over that many bands,
so 35 at the default of 12 — and `rate hz` is how often the torn set is redrawn, where 0
freezes the pattern where it stands rather than switching it off.

`axis` is which way the bands run, from the sensor's rows at 0 to its columns at 1, and the
fractions between are the point: at 0.5 the bands cross the frame on a diagonal, which is a
look neither end reaches. It is a blend of the two image axes rather than an angle in degrees,
because the bands are cut in the sensor's frame where 512 columns meet 424 rows and a band is
a run of scanlines rather than a distance — there is no square in which an angle would mean
what an angle means. The raster's `angle` under Post is the one that gets degrees, because it
runs in screen space where the pixels are square. Turning the axis changes which bands tear
and not which way they slide: the shove stays along sensor x, so a column of bands shears
across itself rather than along itself, and there is no separate shear control because the
pair that could disagree buys nothing the references show.

The tear is applied in the sensor's frame before the camera sees it, so it is only
screen-horizontal from head-on: orbit around a torn band and it shoves in depth instead, and
a levelled room tears along the angle the mount was really at. That is the effect saying the
*volume* is corrupt rather than the picture, and it is why the group sits at the displacement
stage next to what moves points rather than in `Post` next to `raster.amount`.

**`lattice.amount`** rebuilds the volume on a grid: every axis quantised to `cell m`, so surfaces
break into steps and the cloud reads as something being reconstructed rather than something
that was measured. It is the last displacement applied, after the tear, so what gets snapped
is where the point actually ends up — a grid cut before the turbulence would be smoothly
pushed back off itself. **It snaps in the levelled frame**, so the cells line up with the room
rather than with the bracket: level a canted mount afterwards and the grid does not re-cut.
The cell is metres in the room like the other displacements, so a look gives the same grid at
any export size.

**`glyph.amount`** draws every point as a character rather than as a round splat, and it has no grid
of its own — it rides `lattice.amount` and `cell`, which already cut the room into cubes and
move each point to the centre of the cube it falls in. One cell draws one character, so the
characters stand in the room at the size the room gives them and recede with it, which is
what a pass stamping text onto the finished frame could not draw at all. The master
crossfades the mark rather than switching it: at 0.5 every cell is a dot with a character
glowing inside it, and the sprite grows from `pointSize` to cell-sized along the same blend,
so one character comes to stand for one cube of room.

**Riding the lattice is why glyphs read as characters only near `lattice.amount` 1.0.** The lattice
is a blend from the measured surface to the reconstructed one rather than a switch, so at 0.5
each point sits halfway to its cell centre and you get several copies of one character
smeared along that path. At `lattice.amount` 1.0 with `glyph.amount` 0 you have the `voxel` recipe fully
engaged — every point on its cell centre, drawn as a round splat — and raising `glyph.amount` turns
those dots into characters without moving one of them. The shipped `voxel` document is not that
picture, and the difference is worth knowing before you reach for it as a reference: it names
`lattice.amount` 0.55 on a 3.5cm cell, halfway along the blend this paragraph opened on, so it keeps
some of the smear deliberately.
**At `lattice.amount` 0 with `glyph.amount` 1 the picture is mush**, because every one of the 217,088 points
draws a cell-sized character at its own unquantised position — that is authoring rather than a
defect, and nothing gates one control on the other.

**Three keys decide which character a cell draws, and they add and wrap rather than mixing.**
`tone key` reads the luminance the cell is about to draw at, `hash key` reads a hash of the
cell itself, and `rain key` reads the falling counter passing through it; the three weights
sum into one index into a table of sixty-four 8x8 bitmasks and wrap. They sum rather than
blend the way the five readings do because character indices do not average — character 3
half-and-half with character 9 is character 6, an unrelated symbol rather than anything
between the two. All three are weights from 0 to 1, and `hash key` is the only one of them
that defaults to 1 rather than to 0 — so raising `glyph.amount` on its own gives the field one key,
the cell's, which is the reading the reference frames have. It reaches nothing while `glyph.amount`
is 0.

**The table is sorted by ink**, punctuation at the sparse end and dense kana at the other, so
the tone key reads it as a tone ramp and the hash key reads the same table as noise with
neither having to choose. What that costs is a latin ramp: a luminance sweep runs through
kana, so the picture is ASCII art drawn in an alphabet that is not ASCII. There is no depth
key because the readings already have one — put `readDepth` up and the colour ramp is
distance, which the tone key then reads as a depth band.

**The mark crossfades back to the round splat at whichever floor it hits first: the look's own,
between sixteen and eight reference pixels, or what the buffer can actually resolve**, so the
near room is text and the far room is texture. At full `glyph.amount` on `cascade`'s 5.5cm cell the
look's band is 4.0 to 8.0 metres out, the same metres at 1080p and in a 4K export; a buffer
shorter than 1080 pulls the boundary nearer because eight framebuffer pixels stop existing
sooner, which is the buffer being honest about what it can draw rather than the look changing.
The reason the floor exists at all is that an 8x8 bitmask sampled
across eight pixels is a different random set of bits every time the camera moves rather than a
small character, which bloom then amplifies. Clamping the
sprite to a legible minimum instead would keep far cells readable and stop them being
cell-sized, which collapses the recession at depth into the flat screen grid a cell-per-cube
was chosen over. A keyed camera `fov` sweeps the band the same way walking closer does — a
zoom makes characters resolve out of texture mid-clip — and that is the recession being true
rather than a defect: the marks are objects in the room at a size the room gives them, and a
narrower field gives every object more pixels.

**`rain.amount`** is a term of its own rather than a setting inside the glyph field, and it works
over round splats. It computes one scalar per point out of world height and program time,
brightens what a drop head passes, and the glyph field's `rain key` reads that same scalar to
scramble the character — one source and two consumers, the arrangement `duotone` already has,
so a wave descending through a room is reachable for any look that is not drawing text and
`voxel` gets it for nothing. `fall m/s` is how fast a head descends, `head gap m` how many
metres of column separate one head from the next, and `trail m` how many metres of afterglow
sit above it: 0.55, 1.3 and 0.45 by default. Only `trail m` belongs to `rain.amount` alone — `fall
m/s` and `head gap m` shape the drop coordinate *both* consumers read, so with `rain.amount` at 0 and
`glyph.amount` and `rain key` up they still move the picture, by changing which character the passing
counter scrambles a cell to. With both masters at 0 none of the three reaches a pixel, which
is what keeps a look that never asked for any of this rendering the frame it always did. A head
every `head gap` metres rather than one head that wraps is what keeps two or three running in
a column at once, and the trail sitting *above* the head is what makes it read as falling
rather than as a band sliding through. Nothing in it accumulates — the value is a pure
function of program time and world position, so a seek lands on exactly the frame playback
would have drawn there, which `timeline-check` holds.

**The two groups sit at the two stages they belong to rather than together.** `Glyph` is
immediately after `Points`, because what mark gets drawn is what `Points` is about, and `Rain`
is beside `Style`, because what colour a point takes is what `Style` is about — so the rain's
home does not depend on glyphs being switched on. The cost that accepts is that the
falling-code look is authored in two places on the panel, and `cascade` is the shipped
document that holds it: the lattice at 1.0 on a 5.5cm cell, `glyph.amount` at 1.0, the hash key full
and the rain key at 0.6, the rain at 0.8 falling 0.55 m/s with heads 1.3m apart, over a depth
reading with a green duotone, a toe and bloom on top.

**`ripple.amount`** is the region read a fourth way, after displacing, scrambling and masking: a wave
travelling out along the radius, in metres at a full weight, so the volume breathes where
`push` only swells it. `ripple per m` is its spacing and `ripple hz` its speed — and the wave
advances in eighths of a cycle rather than sliding, which is the character rather than a
limitation: the surface arrives at each step instead of gliding between them, so it reads as
machinery rather than as breathing. A speed of 0 freezes it where it stands rather than
switching it off, the way `rate hz` does under Glitch, and both keyframe.

`turbulence` displaces points with a noise field. `near`/`far` is the most useful control
for isolating a person from the room. `cull speckle` drops points whose neighbours disagree,
cleaning up the sensor's edge noise (sigma ~= 3.5 + 1.3*d mm, so 4.6mm at 0.75m and 10mm at
4.25m). `render %` scales the drawing buffer and is the one control that reliably buys back
frame time, for the reason [rendering cost](performance.md#rendering-cost) gives.

Two controls decide how much white lands on the geometry, and they are the first to reach
for if the look is blown out. **`scan`** keys off distance rather than screen position, so
it crosses an angled surface as a drifting diagonal band; wide and hot it reads as a light
leak, so it is kept narrow and cyan. **`rim`** brightens depth discontinuities and gives the
subject its edge, but under additive blending plus bloom it washes broad surfaces white, so
turn it down before turning down bloom.

**The five Post terms share one pass, and the pass carries the tonemap.** `rgb split`,
`raster.amount`, `grain.amount`, `streak.amount` and `vignette.amount` each switch it on, because a full-screen read and
write that changes nothing is worth skipping. What rides along with it is the highlight rolloff
and the black-toe crush, so a look with all five at zero is not the same image without five
effects: it also has lifted blacks and no rolloff, and additive accumulation clips to flat
white where it would otherwise keep its hue. Raising any one of the five brings the grade back.
The vignette used to be part of that bundle and is now its own control, which is why a project
saved before it existed loses its corner falloff until it names one.

**`streak.amount`** bleeds light across the frame. Each pixel gathers back along the streak's axis and
keeps the brightest thing it finds, decayed by distance, so a highlight smears the way a sensor
smears one down a column of wells — sixteen taps at geometric spacing, reaching about 168 pixels
at the 1080p reference. `streak angle` beside it is which way, in degrees, and **0 is straight
down**, which is what this term did when it did nothing else: a look authored before the control
existed names no angle and keeps the fall it was graded with, to the bit. Positive turns the
smear clockwise on the glass, so 90 runs it across to the left, 180 sends it up and -90 across to
the right, and the same half-turn is reachable either way round. It is degrees rather than the
axis blend `axis` under Glitch gets, because this runs in the grade pass in screen space where
the pixels are square and an angle means what an angle means, where the tear is quantised in the
sensor's own frame and has no square to mean it in. It is a gather over the current frame rather
than a buffer that accumulates across frames: a buffer would smear along whatever the camera did
last, so an orbit would drag every streak sideways and a seek would arrive carrying the streak
the scrub built rather than the one playback would have.

**`trails`** is the buffer that paragraph rules out, and the one look term whose length is
counted in frames rather than in seconds. It hands its value straight to the afterimage pass's
damp, and that pass multiplies the picture it is holding once per rendered frame with nothing
in the expression about how long a frame lasted, so what the control sets is a number of
frames and not a duration: at 0.9 the trail is down to 12% after twenty of them, which is
0.83s of a 24fps deliverable and 0.33s of a 60fps one. `fade` and `wake` are in milliseconds
for the reason [surface memory](architecture.md#surface-memory) gives, and this term is the
exception to that rather than a second expression of it — so a look graded at one output rate
does not keep its trail at another. It is the only term this applies to, because
`AfterimagePass` in `web/post-chain.js` is the only pass in the chain that carries anything
from one render to the next.

## The edit, and what comes out of it

Two menus, because there are two questions and one of them used to answer both. **File >
Project settings** holds the shape the stage is letterboxed to and the rate the frames come
out at, and both are undoable document state. **Output > Export** holds the resolution, the
format, the output name and a readout of the trim the press will take, and all of those
belong to a deliverable — one of several files you might make from the edit.

**The shape is the edit's because the camera was keyed against a frame.** A 65:24 shot
reopened at 16:9 is a different shot with the same keys, which is the class of silent
reinterpretation the point-size rebase already taught this repo to refuse. The resolution is
*not* the edit's, and that is the same argument read the other way: every screen-space term
is expressed against 1080p and bloom's chain is frozen at 600 whatever the buffer is, so
1920x1080 and 1280x720 of one edit are the same picture and neither needs re-keying. So the
resolution menu offers only sizes of the project's shape — a size of another shape would be
a reframe, and reframing is what Project settings is for.

A project stores the shape as the reduced integer pair rather than as a ratio, and the two
are not interchangeable: the "1.90:1 DCI" the menu prints is really 1.8963, so a document
carrying that decimal would record a shape 0.2% away from the one the clip was composed
for and the editor would reframe it on the next open. `2048x1080` reduces to `[256, 135]`
exactly, and every other group in the table reduces exactly too.

**The rate is the edit's because `trails` is counted in output frames**, for the reason the
paragraph above gives — the same document at two rates is two different looks, so a rate
chosen per deliverable would mean two files of one edit carrying two grades with nothing on
screen saying so. Moving it also made a rate change undoable, which it had never been: the
handler committed to the stack, and the snapshot it compared held nothing for it to notice.

A deliverable saved by an older build names an output rate this build would ignore, so it is
refused at the picker rather than read — set the rate in Project settings and save it again.
A *project* saved by an older build carries an `outputSize` instead of a shape, and that one
is read rather than refused: its ratio is the shape it was framed at, and its pixels are
handed to the deliverable, so it renders exactly what it rendered before. A hand-typed size
of a shape the table has nothing for keeps its own size and lights no shape button, which is
honest rather than tidy — the stage really is that shape.

### A clip that needs an effect this build has not got

A look parameter is named after the effect it belongs to — `rain.speed`, `glyph.tone` — and a
document lists the effects it is built from. Open a clip whose list names one this machine
does not have, and the clip **opens**: the installed part renders, and the values and keys
under the missing effect are parked, which means they are carried and never evaluated. Saving
writes them back exactly as they arrived, so working on somebody else's clip on a machine
without their effects costs nothing and destroys nothing. A name this build simply does not
know is still refused, and so is a name whose effect *is* here with a key that is not — a
typo and a half-installed package are both broken, and only a whole effect that is absent
gets parked.

The application bar says so while such a clip is open: `missing: rain 1.0.0 — 4 values, 2
tracks parked`, one entry per missing effect, quoting the version the document was authored
against and counting what is being carried. Beside each entry is a **suppress** toggle.

**Export is refused while anything the clip needs is missing**, and the refusal names the
effects and their versions. That is the point of parking rather than the price of it: a video
leaves this machine and nothing in it says a layer of the look was absent when it was made, so
the one artifact that cannot explain itself is the one this build will not produce by accident.
Pressing **suppress** on an entry is the operator saying that this render may go without that
effect. It is per effect — suppress one while another is still missing and the export is still
refused, naming the other — and it is session state rather than document state, so it never
travels with the clip. The render's own record, the `.job.json` beside the video, carries a
`suppressed` list of the ids and versions it went without, and keeps the parked values, so the
file says what was skipped instead of pretending the clip never asked.

A queued render is the same rule with nobody watching. The job carries the effects its project
requires, and a worker that has not got one of them **fails the job with a reason naming it**
rather than rendering, unless the job was queued with `suppressEffects` covering it.

### Installing an effect, and taking one away

`PUT /effects/<id>` installs a package and `DELETE /effects/<id>` removes one. The body is
`{manifest, chunks}` — the manifest as JSON and a map of file name to GLSL text — and the id in
the path is the namespace its parameters carry, so a manifest declaring a different one is
refused rather than guessed at.

**An install lands in `effects/` and never in `effects-builtin/`**, which is the whole of the
fork mechanism: a package installed under a shipped id shadows it, and deleting that copy brings
the shipped one back. Nothing reachable from the network can edit or remove what the build shipped
with, so there is always a package to fall back to — and a `DELETE` aimed at a builtin nothing is
forking is refused by name rather than silently doing nothing. Deleting a package that exists only
in `effects/` uninstalls it, at which point every open document's values under it park exactly as
they would on a machine that never had it.

**A package that this build could not compile is refused at the door, and the refusal names the
rule it broke.** That matters more than it sounds: a package is GLSL spliced into two shader
programs and a table of parameters spliced into the registry, and both of those are assembled
while the page is still loading — so a bad package that landed would not fail its install, it
would fail the *next page load*, with nothing on screen and the only evidence in a console nobody
has open. So the door runs before a byte is written: the id and the manifest have to agree, the
package format has to be one this build reads (a later one is refused rather than adapted), a file
name has to be a bare name in the package's own directory, at most one parameter may be the
master and its default has to be the value the effect is absent at, the kind and the binding have
to be ones the registry implements, every uniform a parameter binds has to be declared by some
program and every uniform the package declares has to be bound by one of its own parameters or
listed under `hostDriven`, every joint a chunk names has to exist in a spine, and every identifier
a chunk reaches for has to be something this build has. Four more rules are about the package as a
whole rather than about one entry in it, because every rule above is satisfied as many times as a
package repeats a correct entry: a package holds at most 64 files and 256 KiB of chunk text (the
widest that ships holds eight files and under 17 kilobytes, and every read of the store hashes
every file of every package), a binding has to be the *shape* of the uniform it writes — `axisDeg`
needs a `vec2` and everything else a `float` — a step may not be finer than `1e-6`, which is a
grid neither the rounding nor a 32-bit float can resolve, and a parameter may only name a panel
group this build holds or one its own package declares, with a package group key that collides
with either refused by name. A refused package leaves nothing behind.

**A page that is open when an install happens rebuilds itself.** Both shader programs are
reassembled and swapped, the registry and the panel are rebuilt from the new set, and every value
is written back through the same door a slider uses — so the controls show what the registry
holds, the values in flight are where they were, and a newly installed effect's parked values
come back and apply. What you were looking at survives it: the tab that was up stays up, a group
you had collapsed stays collapsed, and the preset picker still lists what it listed. Each of
those was read once at boot before, so after the first install the panel either lost them or went
on reporting a state it no longer had. A package that changed no GLSL is adopted without recompiling anything,
which is what keeps a retune from clearing the trails on a page mid-playback. Other browsers
converge on their own within a few seconds; the poll stands down while an export, a preset
gesture or a keyframe evaluation is running, because a rebuild between two frames of a render is
a file that changes look halfway through — and it asks again after its last read, so a gesture
that starts while it is reading defers it rather than being run over by it.

**A package this build stores and cannot compile is a rollback and a sentence.** The door checks
vocabulary and is not a compiler, so GLSL that is syntactically broken while naming only things
this build has gets through it — and a shader that will not link is a log line in WebGL rather
than an exception. The page detects it while it warms the swapped programs and refuses the
install: it goes back to the effects it was drawing with, keeps the document it had, and says
which shader did not compile.

A fork may add parameters and retune the ones it inherits. It may not **drop** one: the panel's
declaration order places every shipped parameter by hand, so a fork short of one is a build whose
registry cannot assemble at all, and that is refused at the door with the names it dropped.

## Levelling a canted mount

A sensor bolted to a dashboard shoots a room that arrives on its side, and nothing measures
the angle, since libfreenect2 exposes camera intrinsics and no accelerometer. `tilt` and
`roll` under Framing rotate the *room* rather than the camera, so the turntable's pole, the
top-down inset, auto-orbit's axis and the exported frame all come level together. Set them
by eye against the top-down, which is where a canted room reads as canted, and **Reset
rotation** zeroes both in one press. There is no third angle because yaw is what dragging on
the picture already does.

Crop faces and the region stay in sensor metres and are tested before the model matrix, so a
box shrunk onto a subject stays there when the room levels underneath it. `level-check`
holds that as a bit-identity.

**Show crop box** draws the six faces in the picture and in the top-down, and puts a handle
on each face you can drag with the pointer. It is a viewer control and writes nothing: the
drag itself writes, through the same registry door the sliders use, so a dragged face keys,
undoes and presets exactly as a typed one does. A face is offered a handle in a view that can
show it moving, which is why the top-down carries `left`, `right`, `near` and `far` and not
`bottom`/`top`, and why the far plane has no handle when you are looking straight down the
axis it moves along — turn the orbit and it appears. While the box is on screen the points it
cuts draw faintly rather than vanishing, so you can see what a face is about to remove and
drag it onto something deliberately. None of that reaches an exported frame or the OBS
output, which `export-check` asserts as byte-identity.

**`crop`** is whether the box bites, over all six faces at once, and it is a look value like
any other — it keys, it presets, and it exports what you see. It releases by not testing
rather than by moving the planes, so `near` and `far` still normalise the depth ramp while
the crop is off and the picture you get back is the room, not a re-grade of it. Use it to
check what a tight box removed without losing the numbers; **revert all to default** is the
other way back and throws them away. With the crop released the box draws dashed and grey.

## The five readings

Five readings of the take, split on the panel into what colours a point and what is then
made of it. Each is a weight from 0 to 1, so they mix.

| Reading | What it does |
| --- | --- |
| colour (source) | registered colour mapped onto the depth points |
| depth (source) | cool-to-warm ramp across the clip range |
| ghost (treatment) | luminance shell that glows along depth discontinuities |
| contour (treatment) | topographic bands sweeping through depth |
| blackwall (treatment) | crimson containment volume, cyan scan sweep, torn datastream bands |

![The five readings on one frame of one take: colour, depth, ghost and contour in a
grid, and Blackwall full width beneath them.](../media/shading-modes.png)

All five are the same frame from the same pose, each at its own brightness: the room was
shot unlit, so colour and contour read a signal the sensor barely produced while Blackwall
blends additively into bloom and blows out early.

**They are weights and not a mode.** The shader sums whichever are non-zero and divides by
the sum of the weights, so colour at 0.6 against depth at 0.4 is a 60/40 blend. Each is an
ordinary registry parameter, so each keyframes, and a single reading at 1.0 is arithmetically
the identity; `registry-check` hashes each reading's framebuffer against the mode it replaced.

Seven constants that were literals inside the old shader branch are registry parameters too,
so they keyframe: the colour's saturation, the depth ramp's gamma, the ghost shell's rim
exponent and fill, the contour's bands per metre and line thickness, and the Blackwall scan
speed. Each defaults to the literal it replaced.

**The duotone sits on top of all five**, beside `thermal.amount` and `edges.amount` and for their reason:
a term written into one reading is inert in every other. It is a tonal transform rather than
a tint, because its two poles carry luminance as well as hue — the near one runs toward black
and the far one toward hot, so one term gives both the depth-keyed palette and the near-black
figure against a burning core. A plain global toe cannot draw that second thing at all, since
it darkens near and far alike, which is why there is no separate silhouette control to look
for. `duotone depth` is how far the image lands between the poles, `duotone hue` turns both of
them together, and `duotone split` is the depth they meet at, as a fraction of the clip range
— so the crossover is a place in the room rather than a fraction of the frame. The pair itself
is baked, the way `heatRamp` and `depthRamp` are: what is parameterised is how you use them.

**`duotone motion`** keys those same two poles on speed as well, so whatever is moving through
the room comes out hot against a room graded by distance. It is the reading the depth key
cannot draw on its own: a subject and the wall behind it are graded by where they stand, so a
person walking through a scene is exactly as cold as the air they walk through until something
keys on the walking. The speed is axial and is measured from the two depth frames the renderer
already holds rather than from a flow pass, so what it sees is what the sensor sees — somebody
walking toward it rather than across it. A point reaches the hot pole at 1200 mm/s, about the
axial speed of an ordinary walk, and the amount pushes toward that pole rather than adding to
it, so the far half of a room is already hot and has nothing to gain while the effect keeps its
room where the picture is near-black, which is where a subject usually is. `snap mm` bounds it
at both ends: a jump larger than it reads as a different surface rather than as fast motion,
which is what stops every silhouette burning, and the same threshold caps the fastest speed a
pair can express at `snap mm` over the gap between the two frames — 7500 mm/s at the default
over a 30fps stream, and proportionally less over a slower link.

**The scanlines term is a raster now**, with three settings under it in a `Raster` group of
its own. `angle` turns it — at 0 it is the horizontal scanline it has always been, at 90 the
dense vertical column grille the reference frames slice a picture into — and because it keys,
a raster can rotate under the playhead. `pitch` is the line frequency, promoted from a literal
and defaulting to it — and **the settings worth having are below that default, not above it**,
because the wave is sized against 1080p and 1.3 is already about 220 cycles across the frame.
That is a television scanline; the wide bands the reference frames cut a picture into want
something under 0.6, and 0.1 is bands you can read across the room. The slider runs to 4 rather
than further because a line thinner than the pixel drawing it is aliasing rather than a raster.
`hardness` squares the wave into a grille with dark gaps between the
lines, and it is the one that makes the other two worth having: an angle over a sine only ever
buys rotated softness, where the references are hard line grilles.

They are settings of `raster.amount` rather than terms beside it, so only the master gates the
grade pass — raise the angle with the master at zero and nothing happens, which is deliberate,
since switching a full-screen pass on to draw nothing is the no-op the gate exists to refuse.
The angle is one parameter behind a two-component uniform, computed in double on the way
through for the reason `contourWidth`'s two band edges are: taking the sine in the shader is
allowed to be a couple of thousandths off, and a raster meant to run along y then leaks a
whisker of x.

`crush` is the toe under the grade's Reinhard curve, promoted from a literal and defaulting to
it. It is a sub-control of the grade pass rather than a fifth term gating it — raise it on its
own and nothing happens, because the pass only runs when the split, the scanlines, the grain
or the vignette asks for it. That asymmetry is deliberate: its default is not zero, so gating
on it would hold the pass open for every look there has ever been.

The panel is generated from the registry at boot. A parameter is one entry naming its group
and label, and the row, bounds, readout and keyframe control are built from that, so an
effect cannot get a control the registry does not own. The generator refuses to boot if the
rows it emitted are not the parameters that were declared.

## Presets

Selecting Blackwall used to apply twelve post-chain values with it. They are separate now: a
preset is look values and nothing else, so applying one never moves your camera.

A preset is `{ version, values }`, plus a `requires` list when the look touches any effect,
and the keys it names in `values` are its scope. A parameter's key is dotted by the effect it
belongs to — `glyph.tone`, `raster.pitch` — and a core value that belongs to no effect stays
bare, like `pointSize` or `readDepth`. `requires` is `[{ id, version }]`, one entry per effect
the values touch, derived from them rather than typed: a look that never raises the rain
carries no entry for it. Ten ship read-only from `presets-builtin/` and are marked `·` in the
picker. Five of them — `rgb`, `depth`,
`ghost`, `contour` and `blackwall` — are one per reading and differ in little else, so they
are where a grade starts, with `blackwall.json` carrying the twelve values the old mode
wrote. The other five — `ember`, `grille`, `voxel`, `tearline` and `cascade` — are graded
looks in their own right: the first four read Blackwall and `cascade` reads depth, and each
spends a duotone, a raster and a toe on top of that reading, so applying one takes a finished
grade rather than clearing the desk.
Nothing in the format marks the difference and nothing should — they are all documents, and
the split is editorial. A preset naming two values is equally valid, and applying it leaves
everything else where the grade left it.

**All ten name the whole look**: the 36 core values every look owes regardless of which
effects it uses, plus every parameter of each effect the document itself touches — so picking
one gives you that look whatever was on screen before it. Applying a whole look resets every
effect the document does not claim back to that effect's own defaults, which is what makes
leaving an effect out and writing it in at its defaults describe the same look; a document
naming four core-only readings owes 36 values, and one naming Blackwall's five effects owes
36 plus their 14. Framing — levelling, the clip planes, the crop box — is the shot rather
than the look, so no shipped document names it and picking one never reframes what you
framed. `none` is the one entry that does reach the framing, because it is the way back to
the defaults rather than an eleventh look. `library-check` holds the rule against the
registry: a new core value fails all ten until each names it, and a new parameter added to an
effect fails only the documents whose `requires` already claims that effect — an effect
nothing has reached yet fails nothing, because nothing claims it.

Saving and exporting both ask which values go in, every box ticked by default, so a sparse
preset takes deliberate effort. A whole-look save still sheds what it can: an effect sitting
wholly at its own defaults leaves no trace in the saved file, because the whole-look apply
above restores that same effect to those same defaults whenever the document does not claim
it — lossless by construction rather than by argument. A subset save sheds nothing, because a
picked value at its default is still a value somebody chose. The boxes derive from the
registry, so a parameter added later appears under its own heading by existing.

**The five reading weights tick and untick together.** A file naming any reading has to name
all five, because the ones it omits stay at whatever the clip was already wearing, and two
fifths of a blend renders as a mixture nobody authored. A file naming none of them is a look
that is not about the reading, which is fine. `refusePresetBody` refuses everything in
between.

**A partial preset does not stamp the clip**, because the stamp answers "what look is this
clip wearing" and a document short even one of the values its own core and effects call for
did not answer it. The two surfaces that report an apply say which of the two happened, and a
document naming the whole look stamps whether it also names the framing or not — the framing
is not part of the answer.

**Saving over a shipped name forks it**: the write lands in your library and shadows the
built-in, and deleting the fork brings the shipped look back.

`export` writes the look on screen (not the document the picker names, which diverge the
moment you move a slider) as `<name>.braindance-preset.json`, and `import` reads one back.
The bytes are the document, so a look is something you can commit, mail, or edit in a text
editor.

An imported file is validated against the registry before it is saved: a scalar carrying a
string fails at the key that is wrong instead of writing a plausible-looking look, and
`__proto__` is refused as an unknown parameter. A file is the one door nothing upstream
validates, so `editor-check` section 12 drives the round trip in a browser, with
`import-skips-normalise` as the mutation that must break it.

Documents from before the readings are version 3 and will not open, and there is nothing to
run: the one-shot conversion this repo used to ship was deleted once every document it could
act on had already been converted. This build reads version 6 alone — a version 5 document
still spelled its parameters bare (`glyphTone` rather than `glyph.tone`) and carried no
`requires` list, so it is refused the same way a version 3 or 4 one is, and there is no
conversion for it either: every document this project holds was re-authored at 6. A file from
any older version is refused, naming its own version, and stays refused.
