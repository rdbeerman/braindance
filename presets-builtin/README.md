# The looks that ship

Twelve preset documents in exactly the shape `PUT /presets/:name` writes and
`applyStoredPreset` reads: `{ version, values }`, plus a `requires` list — one entry per
effect the values touch — whenever the look raises any. They are the same kind of file a
user's own preset is, and they are read-only only in the sense that the store serves them
from here and writes go to the user's directory — saving over one forks it rather than
overwriting it.

**Five of them are readings and seven are looks, and nothing but this paragraph tells the
two kinds apart.** `rgb`, `depth`, `ghost`, `contour` and `blackwall` are one per reading
and are where a grade starts: the first four differ from each other in nothing but the
reading, `blackwall` adds the post chain its mode always wrote, and what goes on top of any
of them is yours. `ember`, `grille`, `voxel`, `tearline`, `cascade`, `updraft` and `rift` are
graded looks in their own right — each of them takes one reading and then spends a duotone, a
raster, a toe and whatever else its picture wanted, so applying one is taking somebody else's
grade rather than clearing the desk to begin your own. No field in the format says which kind a
file is, and none should: a kind field would be a mechanism carrying a sentence, and every preset a
user saves would have to answer it too, where the question has no answer.

They exist as files rather than as constants in `web/main.js`, and that is the whole point
of the change they arrived with. `BLACKWALL` and `NEUTRAL` used to be two hardcoded objects
that `setMode` applied on the way past, so picking a *reading* and picking a *look* were one
gesture and neither could be had without the other. A preset is a document now, so what
ships is a set to edit, fork and export, rather than the only two looks the program could
name.

## Every one of them names the whole look

Naming the whole look means the 36 core values every look owes regardless of which effects it
uses, plus every parameter of each effect the document itself touches, with a `requires` entry
claiming that effect — and **that is the rule a thirteenth one has to meet**, enforced by
`library-check` against the registry rather than against a list. A new core value fails all
twelve until each names it; a new parameter on an effect a document already touches fails that
document alone, because completeness is a function of what each document's own `requires`
claims rather than a single count every file owes. Picking a shipped look therefore gives you
that look and nothing else, whatever was on screen before it.

**The glyph field is the parameter addition that rule was written against, and it landed
exactly the way the rule says.** Its eight values — `glyph.amount`, `glyph.tone`,
`glyph.hash`, `glyph.rain`, `rain.amount`, `rain.speed`, `rain.span` and `rain.trail` — failed
all nine existing documents the moment they entered the registry, and each was closed by
reading the value back out of the registry with that look on screen rather than by typing
eight numbers into nine files. That took the look tag less its framing from 69 to 77 — and 69
rather than the 68 this paragraph carried until now, because a look value was added after the
sentence was written and nobody re-ran the count. A number in prose beside a registry that
grows rots exactly the way the section below says a number in a document does, and this one
rotted again: 92 is what a run reports now, seven of the fifteen between them being the
datamosh's. Measured after the padding, over `captures/sample.knct` at 15 pinned program
positions running 0 to 0.9933s, drawn into a 572x322 buffer inside a 640x360 viewport at
device scale 1: eight of the nine render byte-identical frames to the pre-implementation build
at every one of those positions, three passes agreeing, two of them in one page and the third
in a fresh browser context. `voxel` is the one that moves, and it moves on purpose, because it
is the only one of the nine that raises `lattice.amount`. The pair sweep was re-run over the
ten documents at 0 of 90 ordered pairs contaminated, two arms and two identical runs.

**Framing is the shot, not the look, which is why nine values are outside the rule.**
`tilt`, `roll`, the clip planes and the crop box are in the look tag because that tag is
also what a project saves and what step 5 can keyframe — a crop you could not keyframe would
be a worse program — but they are measured in metres in the room, so a look that named them
would reframe your shot when you picked it. `none` is the control that does reach them: it
resets every look value including the framing, which is why it is the way back to nothing
rather than a thirteenth look.

**This reverses what this file used to say, and the reversal is the interesting part.** The
nine were each sparse in a *different* set of keys, and the argument written here for that
was that a zero in one of these files is a value somebody chose and none of these four chose
one. It was wrong in the direction that is hard to see: the alternative to writing the zero
was not writing nothing, it was inheriting a value nobody chose at all. `voxel` was the only
document naming `lattice.amount`, so picking `ember` after it drew amber over a lattice from the
previous look — reported as a bug, because it is one. Measured at 22.000s of
`2026-08-07-take2`, **33 of the 72 ordered pairs rendered a different frame in sequence from
the frame that look renders alone**. After the fix, 0 of 72, and all nine render byte-identical
frames from a clean start to the ones they rendered before it, because each padded value was
read back out of the registry while that look was on screen rather than typed in by hand.

The old text had the measurement in it and shipped anyway, which is the lesson worth keeping:
a number written into a document does not fail. `docs/instruments.md` carries that one.

## What is still sparse, and why that is untouched

**A preset you save is whatever you ticked**, and applying it deliberately leaves everything
it does not name where your grading left it. That is the whole point of the picker's tick
boxes and none of it changed — "just my grain and bloom" is still a document you can save and
layer onto a grade in progress. The line is not between kinds of file, because the format has
no kinds: it is that a document naming the whole look *is* a whole look, and one naming part
of a look is an adjustment. The shipped documents all sit on the first side of that line now,
where they always claimed to be.

That line is the one `wholeLookTag` already drew, and moving the shipped nine across it gets
the provenance stamp back for free: picking `voxel` says `applied voxel · <rev>` rather than
`applied 43 of 86 values from voxel`, because the document now answers the question the stamp
asks. That 86 is the whole look tag as the registry stood then, framing included, and it is the
number the picker prints rather than the 77 the rule above counts — the two differ by the nine
framing values and are not a spelling of each other. A run reports 101 against 92 now, for the
reason the paragraph above gives.

**A look that switches a term on names all of that term's parameters** was the narrower rule
this file carried before, learned from `tearline` shipping a duotone with a depth and a split
but no hue, so the tone came up in whatever colour the previous look had left — hue 0 from a
clean start and −10 after `voxel`, from a document specifying neither. It is kept here as the
reason rather than as a rule, because naming the whole look makes it unreachable: there is no
term whose parameters can go unstated. The same is true of the older `contourBands` failure,
where picking `contour` after somebody had pulled the band count to 60 gave them a contour at
60 bands and called it the shipped look.

## The values themselves

**`blackwall.json` carries the twelve values the old constant did**, and the point sizes in
the five readings are the rebased ones — `pointSize` is pixels at 1080p, and the buffer those
looks were graded against was 600 tall, so 4.5 and 5 pixels there are 8.1 and 9 here. That
rebase happened once, when the screen-space terms went resolution-relative; nothing else in
either look was in pixels. The seven graded looks came after it and are in 1080p pixels
throughout: six of them sit on Blackwall's 8.1, and `voxel` names 6.5 because its lattice
wanted a smaller point, which is a value somebody chose rather than a rebase of one.

**`cascade.json` is the only document that draws the glyph field**, which
is why it exists at all: the feature draws one picture, and without a document holding it
that picture has to be rebuilt from eight sliders plus a lattice nobody would connect to
them. It reads depth rather than Blackwall, sits at `lattice.amount` 1.0 on a 5.5cm cell with
`glyph.amount` 1.0, keeps the hash key full and the rain key at 0.6, and runs the rain at 0.8
falling 0.55 m/s with heads 1.3m apart and 0.45m of trail, under a green duotone, a toe, a hard
raster at a low weight and a little bloom. It is named in the house style rather than after the film the
look references — `ember`, `grille`, `voxel` and `tearline` are single evocative nouns and
none of them names the thing it is referencing.

**`updraft.json` and `rift.json` are `ember`'s grade with the datamosh raised over it, and
`datamosh.splay` is the whole of what separates them.** `updraft` sits at 0, where every column
drags the same way and the whole picture streams upward — measured rather than assumed, because
the name went out backwards once: over `captures/fixture-long.knct` at 1.100s the light the pass
adds sits 33.2 rows above the centroid of the frame it was added to. `rift` sits at 1, where the
picture is pulled away from `datamosh.line` and comes apart from the middle outward. They are
built on `ember` rather than on a reading because the smear is nearly invisible over a light
grade, and each carries the reach, decay and grain its own reading wanted: 14 pixels at 0.92 over
6-pixel columns for the updraft, 20 at 0.9 over 2-pixel ones for the rift, which is ragged where
the updraft is broad. They are the two documents raising every accumulator this program has —
`trails` and the surface memory from `ember`, and the mosh over them — which is why
`determinism-check` reads `rift` rather than spelling a smear out.

**Those six numbers are the one part of these two documents nobody graded against footage**,
and they are here as a starting point rather than as a finished look. `ember`'s grade underneath
them was graded; the reach, decay and grain over it were chosen from what the pass does and then
checked over `captures/fixture-long.knct`, which is `make-sample` looped and therefore a flat wall
with no depth jitter, no dropped frames and none of the sparse bright glints a smear is really
for. A pass over a real take is owed, and re-grading these six is the expected outcome of it
rather than a sign anything regressed.

**`rift`'s line at 0.55 needs a subject that straddles it, and that is a property of the shot
rather than of the document.** The pass ramps `away` over `(vUv.y - line) * 8`, so it pulls a half
at full strength only past 0.125 of frame height either side, and a line the picture sits wholly
above renders the frame `updraft` renders — measured, at line 0.10, byte-identical to splay 0 in
every band. Over `captures/fixture-long.knct` with the camera at (0, 0.1, 1.6) the light spans
0.171 to 0.901 of frame height, and 0.55 divides it 41.7% above against 58.3% below at mean pulls
of +0.83 and −0.88, which is a split at both halves' saturation. Anything from about 0.30 to 0.70
splits that framing; 0.25 and below leaves too little underneath to tear.

**`voxel`'s exposure moved 1.15 to 5.65 in the same change, and that is a re-grade rather
than a padding.** The glyph field's energy compensation cancels the pile-up a lattice creates
by collapsing many points onto one cell, and `voxel` is the only shipped document it darkens,
so the look fell to 0.1595 of its mean channel. **It is the only one darkened without being the
only one with a lattice**, which is the part worth stating rather than leaving as a
coincidence: `cascade` raises `lattice.amount` further, to 1.0, and the correction never touches it,
because the factor is exactly 1 wherever the sprite is already the size of the cell — and full
`glyph.amount` is precisely what makes it that size. The compensation and the glyph field do not
interact at full strength, so what the correction is for is `voxel`'s combination and not its
lattice alone: 0.55 with `glyph.amount` 0 and a `pointSize` of 6.5 well under its 3.5cm cell.

The replacement exposure was found by sweeping 43 candidates from 0.05 to 6.00 and minimising
the mean absolute deviation per RGB channel against 15 pre-implementation reference frames —
the same 15 positions of `captures/sample.knct` the byte-identity run above uses, drawn into
the same 572x322 buffer: 0.2559 at the interior
minimum against 10.6625 left unchanged, a factor of 41.7, with the worst channel down from
138/255 to 51/255. It is a mean match rather than a pixel match, because the compensation
redistributes energy inside the frame rather than scaling it — mean channel 12.870 against
the reference's 12.685, lit fragments 21.36% against 21.18%. The value was read back out of
the registry with the look on screen, so it is the registry's own snapped number rather than
a typed one.

`rgb`, `depth`, `ghost` and `contour` are deliberately identical apart from their reading.
They are the neutral grade, which is what leaving Blackwall used to restore, and their job is
to be a clean place to start rather than a look in their own right — a sentence that was not
quite true while they were sparse, since picking `rgb` mid-grade gave you the grade you were
already wearing in a different reading. Switching only the reading is what the five reading
weights in the panel are for; picking a document is going somewhere.

**The reading weights are all or none**, which is a format rule rather than a convention here
and is enforced by `refusePresetBody`: a file naming two of the five leaves the other three at
whatever the clip was wearing, which renders as a mixture nobody authored. Naming none of them
is a legal look that is not about the reading. All twelve name all five.
