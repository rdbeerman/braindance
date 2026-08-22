# The glyph field

**This document is scaffolding and is meant to be deleted.** It records a design that has
been decided and not yet built, which is the one state this repo keeps prose in: the long
design document that preceded the shipped program was deleted the day the thing it
described worked, because a drawing of a surface that exists is a second representation
that can only drift out of step with the first. The same rule applies here. When the glyph
field ships, whatever survives of this belongs in `docs/reference.md` beside the readings
and the raster, and this file goes.

Until then, **nothing described here is shipped behaviour**, and `docs/reference.md`
remains the honest account of what the program does.

## What it is

A drawing rule for the point cloud in which every point is a character rather than a
round splat. It comes out of the reference the idea started from — a room built out of
falling green code — and the thing that makes that reference work is that the characters
recede: they are objects standing in the room at a size the room gives them, not a grid
ruled over the glass. A pass that stamped characters onto the finished frame could not
draw that at all, which is why this is a change to how a point is drawn and not a
full-screen effect.

Three variants were built as a throwaway probe against a real take and compared. The one
being designed here is the one that won: **the cube**, in which the room is cut into
cube-shaped cells and each cell draws one character.

## The grid is the lattice that already exists

**The glyph field does not get a grid of its own. It rides `lattice` and `latticeCell`.**

Those two already cut the room into cubes and move each point to the centre of the cube it
falls in — that is the whole of what the cube variant needs — and they already solve the
part that is easy to get wrong. **The snap happens in the levelled frame rather than the
sensor's**, so a canted bracket does not cut the grid on the diagonal and leave the floor
stepping across the picture. The rotation it snaps in is `mat3(modelMatrix)`, the transform
three already hands the shader, so it cannot drift from the levelling the way a uniform
derived beside it could, and `registry-check` holds the cloud to carrying no scale and no
translation so that the transpose used to get back stays exact.

The probe duplicated all of that with a constant of its own, and shipping that duplicate
would have put two independent world-cell quantisers in one shader with nothing keeping
their reasoning in step — the second path this design keeps refusing. Riding the existing
one also costs the presets nothing: no new cell size, no new snap, and nine shipped looks
that do not have to learn two more values.

**What comes with that decision is that glyphs read as characters only near `lattice` 1.0.**
The lattice is a blend from the measured surface to the fully reconstructed one, not a
switch, so at 0.5 each point sits halfway between where it was measured and the centre of
its cell — which for round splats is the surface arriving and for characters is several
copies of one character smeared along that path. That is either a transition worth having
or a look nobody authors, and it is not a defect to be fixed by adding a second snap.

## One cell, four hundred points, one character

**The energy normalisation loses its floor**, so that the pile-up it already cancels keeps
being cancelled once the sprite grows to the cell.

At full lattice every point in a cell lands on a bit-identical position, and there are more
of them than the probe's arithmetic suggested. The sensor's focal length is 366 pixels, so
a texel spans `z / 366` metres — 2.7mm at one metre — and a 5.5cm cell on a wall a metre away
therefore holds about 400 of them. At two metres it holds 100, at three metres 45.

**Everything below is conditional on the sprite reaching cell size**, which is settled under
"The sprite grows into its cell as the master rises" near the end of this document, and which
holds only at `glyph` 1.0 and only inside the distance band the next section bounds. Read the
two together or this one reads as a guarantee when it is a special case.

The shader already defends against this and, once the sprite is cell-sized, it wins outright.
Each point's alpha is divided by its area, `alpha *= clamp(116.64 / (vSize * vSize), 0.05,
1.0)`, so every point contributes the same *total* energy however large its sprite is. What
lands on a pixel is then the number of sources covering it over the area they are spread
across — and with the sprite exactly the size of the cell those two terms are the same term.
**At `glyph` 1.0 the lattice changes brightness by nothing at all**, whether a cell was drawn
by four hundred points or by one.

**What breaks it is the clamp band, and growing the sprite pushes the near field straight out
of the bottom of it.** In reference pixels a 5.5cm cell measures `63.7 / z` at the program
camera's 50-degree field, so it passes `vSize` 48.3 — where the 0.05 floor takes over — at
**1.32 metres**. That is not an edge case, it is where a person stands. Past that point the
normalisation has stopped scaling while the point count keeps climbing, so a subject walking
toward the sensor blows out. The ceiling at the other end bites below `vSize` 10.8, which is
5.9 metres and past the far clip, and the fallback to dots covers it anyway.

**This was misread the first time, in the direction that matters.** The floor looked harmless
while the sprite was `pointSize`-sized, because `pointSize` 9 only reaches `vSize` 48 within
19cm — nearer than a Kinect v2 will range. Growing the sprite to the cell moved the same
threshold out by a factor of seven, into the middle of the shot. The number that mattered was
never the floor's value; it was the sprite size the floor is measured against, and that was
settled two decisions later.

**Below `glyph` 1.0 the pile-up is genuinely uncancelled, and that gets fixed too.** The
sprite is smaller than the cell there, so the marks pile up by the ratio between them — and
this is not a new defect. `voxel.json` has been in exactly that state since it shipped, being
the only built-in look that raises `lattice` (0.55) with `additive` on and a `pointSize` of
6.5 well under its 3.5cm cell.

The normalisation therefore has to account for the cell rather than only for the sprite. What
the existing term assumes is that sources are spread at the sprite's own scale, which the
lattice breaks by collapsing them onto cells. Pulling points a fraction `L` of the way to their
cell centre leaves a cluster spanning `cell * (1 - L)`, so brightness runs up as `1 / (1 - L)^2`
until the cluster is smaller than the sprite, after which it saturates at the fully coincident
case. The compensating factor is therefore

```
alpha *= max((1.0 - lattice) * (1.0 - lattice), (spriteWorld / cell) * (spriteWorld / cell))
```

which is exactly 1 at `lattice` 0, exactly `(sprite/cell)^2` at `lattice` 1, and — the property
that makes the whole design hang together — exactly 1 again at `glyph` 1.0, where the sprite
*is* the cell. The correction and the glyph field do not interact at all at full strength.

**This is a derivation and not a measurement, so it is not yet true.** It is written down to
be checked rather than to be trusted; this repo has carried inherited estimates that came out
40% wrong the moment somebody profiled them.

**Eight of the nine shipped looks are provably untouched**, because all eight sit at
`lattice` 0 where the factor is exactly 1 — so they must render byte-identical frames and a
check should assert that rather than assume it. Only `voxel` moves. At its 0.55 the factor is
`(1 - 0.55)^2 = 0.2025`, so it darkens to about a fifth and wants roughly five times the
exposure back. That re-grade is a hand judgement about what `voxel` was meant to look like,
and it needs the same treatment the last preset padding got: read the value back out of the
registry with the look on screen rather than typing a number into the document.

## The characters are bits in the source, not an atlas

**A character is an 8x8 bitmask held as two unsigned ints in the shader source**, and there
is no texture, no atlas image and no fetch.

The renderer loads no static image today. Every texture it binds is built out of frame
bytes in `web/gpu-textures.js`, so an atlas would be the first file the render path ever
went and got: a route on the server to serve it, a load order to get right, a question
about what the shader draws in the frames before it arrives, and the same question again
inside the headless browser `tools/render-worker.mjs` drives — where a missing asset is a
deliverable with no characters in it rather than a visible error. A table in the source has
none of those states, because it is there the moment the shader compiles.

8x8 rather than the probe's 5x6, and that is the whole reason for the size. 5x6 draws latin,
digits and symbols and cannot draw kana, which would put the reference look's actual alphabet
permanently out of reach. 8x8 is what the home computers of the eighties drew kana at, so the
grid is the smallest one that keeps the option. Two unsigned ints carry a character exactly.

The other thing a table in the source buys is that the alphabet is reviewable: a bitmask is
a diff a person can read, where an atlas is a binary nobody looks inside.

## One alphabet, sorted by ink

**The 64 characters sit in one table ordered by how much ink each of them carries** —
punctuation at the sparse end, dense kana at the other.

Four keys were wanted for which character a cell draws: the depth band it falls in, the
luminance of the point, a hash of the cell that holds still, and a counter that scrambles
as the rain passes. Two of those want an ordered alphabet and two want an arbitrary one. A
luminance ramp is ASCII art and only works if the index means ink, so a bright cell draws a
dense character and a dark one draws a sparse one; a hash and a scramble counter want the
index to mean nothing, because looking like noise is their whole job. Summed into one index
the way the five readings sum into one colour, the hash would destroy the ramp it was added
to.

Sorting the table by ink dissolves that rather than resolving it. The luminance key reads
the table as tone, the hash key reads the same table as noise, and both readings are true of
it at once, so no parameter has to choose between them — which matters because a chooser
would be an enum, and this registry has refused those since the region's shape control,
on the grounds that an enum cannot keyframe and a slider can.

**What it costs is a latin tone ramp.** A luminance sweep now runs through kana, so the
picture is ASCII art drawn in an alphabet that is not ASCII. That is a look rather than a
defect, but it is the one thing this arrangement puts out of reach.

## The master crossfades the mark, it does not move anything

**`glyph` blends the sprite's mask from the round falloff toward the character**, so at 0.5
every cell is a dot with a character glowing inside it.

The lattice already moved the point, so there is nothing left for this control to do to
geometry — it decides what shape gets drawn where the lattice put it. Blending rather than
switching is what every other master in this registry does: `lattice` blends, the five
readings blend, `glitch` fades, and a control that only had two states would be a checkbox
wearing a slider and could not keyframe into anything.

The composition falls out for free: at `lattice` 1.0 with `glyph` at 0 you get exactly the
`voxel` look that ships today, and raising `glyph` turns its dots into characters without
moving one of them.

## Three keys, added and wrapped

**Which character a cell draws is decided by three weights that add into one index and
wrap**: `tone` off the luminance the cell is about to draw at, `hash` off the cell itself,
and `rain` off the falling counter passing through it.

```
idx = fract(tone * luminance + hash * cellHash + rain * rainStep) * 64.0
```

They add and wrap rather than mixing the way the five readings do, and the difference is
forced rather than stylistic: **character indices do not average.** Character 3 blended
half-and-half with character 9 is character 6, which is an unrelated symbol rather than
anything between the two. A sum wrapped into the table is the only composition that leaves
each weight meaning "how much does this move the character", and it keeps the property the
readings have, that a weight at zero contributes exactly nothing.

**A fourth key for the depth band was dropped because the readings already have one.** Put
`readDepth` up and the colour ramp is distance, so the tone key reads it as a depth band
without a second control existing to do it — and two controls drawing one picture is the
second path that drifts. What that costs is a depth key on footage with no colour signal at
all, where the reading has nothing to ramp; that case is reachable by putting `readDepth`
up anyway, since the ramp is synthesised from the depth rather than measured.

**The index moves to the fragment stage**, which the probe did not do. Luminance does not
exist at vertex time, so the cell's hash seed and its rain phase cross as varyings and the
index is worked out beside the colour, where the bitmask lookup already lives. Nothing is
lost by the move: the seed is constant across a sprite, so the character is too.

## The rain is a term of its own, and the glyph field reads it

**The rain computes one scalar per point out of world height and program time.** That scalar
drives brightness in the colour stage, and the glyph field's `rain` key reads the same
scalar to scramble the character. One source, two consumers — the arrangement `duotone`
already has, sitting on top of all five readings rather than being written into one of them.

It is put this way because the brightness is the effect. In the probe the same value did
both jobs, and the clips show what carries the picture: a drop head descending a column with
a trail of afterglow above it. Scrambling on its own is invisible, since which character a
cell draws is noise either way. Brightness keyed on where a point stands in the room is a
colour term rather than a property of the alphabet, and filing it inside the glyph field
would have made a wave descending through the room unreachable for any look that was not
drawing text — including `voxel`, which now gets it for nothing.

Four parameters: how much, how fast the head falls in metres per second, how many metres
between one head and the next, and how many metres of afterglow trail it.

**A repeating drop rather than one that wraps.** The probe's first attempt ran a single head
down four metres and spent half its cycle below the floor with the room dark behind it. What
works is a head every `span` metres down each column, so a column always has two or three
running, and the trail sits *above* the head — which is what makes it read as falling rather
than as a band sliding through.

**No accumulated state anywhere in it.** The value is a pure function of program time and
world position, so a seek lands on exactly the frame playback would have drawn there.
`timeline-check` is the instrument that holds that, and a rain that integrated frame to
frame would fail it.

## The room is made of code, and that is the tested half

**The cell hash is keyed on the world cell and on nothing else**, so the characters belong
to the room and a subject walks through them.

The reference this started from reads the other way — the figures in the doorway are
themselves code — and there is one cheap thing that would get close to it. Hashing on the
sensor's view ray instead of the world cell gives an identical picture for static geometry,
because the sensor does not move, and differs only for something travelling through the
frame: a world hash leaves the characters standing while a subject passes through them,
where a ray hash washes them over the subject as it moves.

**It stays a probe rather than becoming a parameter, because nobody has rendered it.** The
world-cell variant was built and compared against a real take; the ray variant is an
argument about a picture that does not exist yet. Putting it into the registry means a value
in all nine shipped presets and a mutation holding it, which is a lot of commitment to
something whose only evidence is that it sounds right.

**The test that decides it has to be subject motion and not camera motion.** Moving the
camera never changes which sensor texel a point arrived on, so the two hash sources produce
bit-identical pictures under a fly-through — the probe ran that comparison first, and it
looked convincing while proving nothing. What discriminates is two frames of playback with
the animation frozen and a person moving between them: the room's characters hold and the
subject's change, or they do not.

## Two groups, at the two stages they belong to

**`Glyph` sits immediately after `Points`, and `Rain` sits beside `Style`.**

Every group below `framing` in `PANEL_GROUPS` is one stage of the pipeline rather than one
subject heading, and these two are at different stages: the glyph field decides what mark
gets drawn, which is what `Points` is about, and the rain decides what colour a point takes,
which is what `Style` is about. Filing them together because they were designed together is
the grouping this registry has refused twice, and the rain works over round splats, so its
home must not depend on glyphs being switched on.

Each gets a group rather than joining its neighbour, which is the precedent the raster set:
a term that grows sub-controls gets a group rather than crowding the group it started in.
`Style` already carries about fifteen controls.

The cost this accepts is that the falling-code look is authored in two places on the panel.
That is worth watching, because the reason `Glitch` left `Displacement` was that nobody
stylising an image thought to look for it there — but both of these are groups named after
what they do, so neither is hidden inside something else.

| Group | Parameter | Unit | What it does |
| --- | --- | --- | --- |
| Glyph | `glyph` | 0–1 | blends the mark from round splat toward character |
| Glyph | `glyphTone` | 0–1 | how far luminance moves the character index |
| Glyph | `glyphHash` | 0–1 | how far the cell's own hash moves it |
| Glyph | `glyphRain` | 0–1 | how far the passing rain scrambles it |
| Rain | `rain` | 0–1 | how much the falling wave brightens |
| Rain | `rainSpeed` | m/s | how fast a drop head descends |
| Rain | `rainSpan` | m | metres between one head and the next in a column |
| Rain | `rainTrail` | m | metres of afterglow above the head |

Eight parameters against the 68 look values that exist, so the look grows by about a
seventh. Each needs a key in the registry, a uniform, a value in all nine shipped presets,
a panel row, a reset and a mutation that must fail without it.

## A tenth look ships, and it is called `cascade`

**`presets-builtin/cascade.json` joins the four graded looks**, carrying the values the probe
arrived at: the lattice at 1.0 on a 5.5cm cell, `glyph` at 1.0, the hash key full and the
rain key at about 0.6, `rain` at 0.8 falling 0.55 m/s with heads 1.3m apart and 0.45m of
trail, over a depth reading with a duotone, bloom and a toe on top.

It ships because the feature exists to draw one picture, and without a document holding it
that picture has to be rebuilt from eight sliders plus a lattice nobody would connect to
them. The rain's numbers in particular took three passes to settle — the first was a single
head that spent half its cycle under the floor, the second extinguished the room — and a
tuning that lives nowhere gets rediscovered by hand.

**Named in the house style rather than after the film.** `ember`, `grille`, `voxel` and
`tearline` are single evocative nouns and none of them names the thing it is referencing,
so a `matrix.json` would break the pattern and put somebody else's trademark in the tree.

Two obligations come with it, and neither is done here.

**The other nine each have to name the eight new values**, because `library-check` holds all
nine against `completeLookNames()` rather than against a list — a look parameter added next
year fails every one of them until somebody chooses a value for it in each. All eight are
zero for the existing looks, so no shipped picture moves. **Those zeros still have to be read
back out of the registry with each look on screen rather than typed in**, which is the method
the last padding pass had to learn: 33 of 72 ordered pairs of looks rendered a different frame
in sequence than they rendered alone, because values written by hand into a document do not
fail the way values taken from a running program do.

**`presets-builtin/README.md` opens on the sentence "Nine preset documents"** and says a tenth
has to meet the whole-look rule. It is deliberately untouched: it describes what ships, and
editing it before the file exists would make it wrong in the direction that is hardest to see.

## `registry-check` holds it, and it has to plant rather than sweep

**The mutations go in `registry-check`**, which already owns the claim that a look term does
what it says: `lattice-ignored` is there, the whole duotone family is there, and so is every
raster row. Two of its existing rows already do the hard version of this —
`duotone-span-against-a-frozen-range` and `vspeed-unnormalised` both plant a condition rather
than sweeping a parameter — so the machinery for what is needed here exists. A twentieth tool
would buy direct reads of the character index at the price of its own server, its own
fixtures and a line in `CLAUDE.md`.

**A drop-one sweep cannot see the defect the probe actually shipped.** The probe hashed the
character off the point *after* noise, ripple, the region push and the lattice had moved it,
so the field would boil the moment any of those was raised — and with all of them at zero,
which is where a sweep leaves them, the picture is bit-identical to the correct one. The row
that catches it has to raise the turbulence first and then compare two frames of the same
program time under a moved point.

The same is true of the index arithmetic. Mixing the three keys instead of summing them draws
a different character in every cell and a completely plausible picture, so nothing that asks
"did the frame change" can tell the two apart. What separates them is that a mix of two keys
at half weight each must land on a character that is *neither* of the two the keys name
alone, where the wrap-sum lands on a third one deterministically.

Rows to build:

```
node tools/registry-check.mjs --mutate glyph-ignored                    # the master
node tools/registry-check.mjs --mutate glyph-hash-per-point             # identity per point, not per cell
node tools/registry-check.mjs --mutate glyph-hash-on-the-displaced-point # ... and hashed before the displacements,
                                                                        #     which needs turbulence planted or the
                                                                        #     picture is bit-identical
node tools/registry-check.mjs --mutate glyph-index-averages             # the three keys mixed rather than summed,
                                                                        #     which draws a plausible wrong character
node tools/registry-check.mjs --mutate glyph-tone-ignored               # the tonal key, and the ink ordering under it
node tools/registry-check.mjs --mutate rain-ignored                     # the falling wave
node tools/registry-check.mjs --mutate rain-trail-below-the-head        # and which side of the head it trails,
                                                                        #     without which the rain reads as rising
node tools/registry-check.mjs --mutate rain-span-in-frames              # its spacing is metres of room, not frames
node tools/registry-check.mjs --mutate normalisation-floor-restored     # the pile-up fix, which needs a planted look
                                                                        #     because no shipped preset reaches it
node tools/timeline-check.mjs --mutate rain-accumulates                 # the rain integrated frame to frame, so a
                                                                        #     seek lands where playback never would
```

**`normalisation-floor-restored` cannot pick up a shipped look.** The floor bites nearer than
`pointSize / 48` metres and all nine sit at 9 or below, so the mutation has to plant a look
with a large point size and a full lattice before it can see anything — which is the same
shape as `duotone-span-against-a-frozen-range` and for the same reason.

## The mark falls back to a dot before it becomes speckle

**Below about ten pixels the sprite crossfades back toward the round falloff**, so the near
room is text and the far room is texture.

A cell four metres from the sensor projects to roughly six pixels, and an 8x8 bitmask
sampled across six pixels is not a small character — it is a different random set of bits
every time the camera moves, which bloom then amplifies. The probe never saw this because
it was shot in a room where everything was near, and it clamped its sprite at 6 pixels,
which is under the size at which its own font resolves.

The fallback reuses the mechanism `glyph` already has rather than adding one: the mask is
already a blend between the round falloff and the character, so the distance term multiplies
into the same blend. Nothing new can go out of step with it.

**The recession is what this protects.** Clamping the sprite to a legible minimum instead
would keep every cell readable at any range, but far cells would stop being cell-sized and
start overlapping — which collapses the perspective recession at depth into exactly the flat
screen grid the cube variant was chosen over. The mark stops trying to be legible; the
geometry never stops being true.

## What composes with it, and what does not

**Cut-away points stay dots.** The crop's faint pass halves `gl_PointSize` so excluded
geometry reads as dust rather than as surface, and half of a cell-sized sprite is a bitmask
across about four pixels. The distance fallback above already covers it, since a halved
sprite is below the threshold by construction.

`vFade`, `vMask` and `vGhost` all multiply alpha and need nothing: surface memory, the
region's soft mask and the ghost pass dim a character exactly as they dim a splat.

## The sprite grows into its cell as the master rises

**Sprite size blends from `pointSize` to cell-sized along with `glyph` itself**, so the
master crossfades the mark's size and its shape as one idea.

A 5.5cm cell a metre from the sensor projects to about 42 pixels where `pointSize` 9 at the
same distance is 9, so the two are nowhere near each other and something had to give. Growing
the sprite to the cell at full glyph is what makes one character stand for one cube of room,
which is the reading the cube variant was chosen for; blending to it rather than switching is
what keeps `pointSize` meaning something at every value in between. A shipped, keyframable
control that silently stopped working the instant another one left zero would be worse than
one that is merely inert.

The margin around a character comes from the font rather than from a parameter: an 8x8
character does not fill its own 8x8 box, so cells tile while the marks inside them do not
touch — which is how the reference frames actually look, characters with dark between them
rather than a solid wall of ink.

**This is the whole cost story and none of it has been measured.** 42 pixels is twenty-two
times the fill of 9, over 217,088 points, plus a bitmask lookup and an index computation in
every fragment. The probe never reported a frame rate. Nothing here should be believed until
`grabber --profile` has been run on the sensor, and an offline harness will not answer it —
a screening measurement that removes the effect confidently reports its absence.

**At `lattice` 0 with `glyph` 1 the picture is mush, and that is authoring rather than a
defect.** Every one of the 217,088 points draws a cell-sized character at its own unquantised
position: the probe measured that variant wanting roughly twenty times more pixels than the
canvas has, and it rendered as solid green. The lattice is what decimates, so the two controls
are raised together. Nothing gates one on the other, because a control that refuses to work
until you find its partner is the failure `Glitch` sitting inside `Displacement` already was.

## The point clamp becomes the hardware's, not a literal

**`gl_PointSize` is clamped to whatever `ALIASED_POINT_SIZE_RANGE` reports rather than to the
literal 64**, because a cell-sized sprite reaches 64 pixels at a metre and that is where a
person stands.

A 5.5cm cell measures `63.7 / z` framebuffer pixels at 1080p under the program camera's
50-degree field, so the existing ceiling bites at `z` = 1.00m. Past it the sprite stops growing
while the cell keeps growing, so characters stop filling their cells, the tiling opens up, and
`(spriteWorld / cell)` stops being 1 at full glyph — which is the property the whole
compensation rests on.

**The clamp is in framebuffer pixels, so the failure moves with output size.** The same look
that opens gaps at one metre on screen opens them at two metres in a 4K export. That is exactly
the drift the 1080p reference unit exists to stop, and it is why this could not be left as a
tuning number.

The comment beside that clamp already argues the bound is a limit on what the hardware can draw
rather than a look value — and 64 is not that limit. This GPU reports 511. At 511 the clamp
bites nearer than 13cm at 1080p and 25cm at 4K, both inside the shader's own 0.15m distance
clamp, so it stops firing at all. **What it costs is that the ceiling now varies by machine**,
so two GPUs could differ in the very near field, where today they agree on being wrong
together.

**The compensation factor reads the drawn sprite, not the requested one.** Wherever the clamp
does bite, `(spriteWorld / cell)` is computed from the size that was actually rasterised, so
brightness stays correct and only the tiling degrades. That holds whatever the ceiling is, and
it is the half of this that should have been true from the start.
