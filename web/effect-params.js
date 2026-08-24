/**
 * The forty-one effect parameters, as data rather than as forty-one closures.
 *
 * Every one of them does the same thing: it writes one number into one uniform, on one of
 * two tables - the point cloud's or the grade pass's - with at most a fixed conversion on
 * the way and, for the five that gate the grade, a recompute of whether that pass runs at
 * all. Written out as an `apply` each, that was forty-one hand-typed closures where a
 * reader had to check every one to know whether it was the ordinary case, and where the
 * ordinary case could be got subtly wrong in a way nothing reads back. Here the binding is
 * the declaration - `on`, `uniform`, and optionally `transform` and `gates` - and
 * `web/main.js` turns each into the closure the registry wants through one applier. There
 * is one place the arithmetic can be wrong instead of forty-one, and a new effect
 * parameter is a row in this table rather than a function somebody writes again.
 *
 * **The entries are in registry order and that order is load-bearing.** `web/main.js`
 * spreads contiguous runs of this table into its `PARAMS` literal at the positions the
 * inline entries used to hold, so `Object.keys(PARAMS)` comes out byte-for-byte what it
 * always was: `registry-check`'s scramble table is coupled to it through a stringified
 * equality, and the panel's row order inside a group falls out of it. Moving an entry here
 * moves a slider there.
 *
 * **This module imports nothing, on purpose.** It is pure data with no dependency on
 * three.js, on a DOM or on anything the page constructs, which is what lets a check pull an
 * older revision of it out of `git show` and evaluate that text under bare node without
 * standing a whole page up around it. One import would take that away, so a value that
 * would have been computed from a constant somewhere else is written as the literal it
 * equals with the expression named beside it - see `duotone.span`, which is the only one.
 *
 * The vocabulary, and it is deliberately small:
 *
 *   on         which uniform table the write lands on: `points` for the cloud's, `grade`
 *              for the grade pass's. Resolved when the write happens rather than when the
 *              closure is built, because both tables are null until their banner in
 *              `web/main.js` constructs them.
 *   uniform    the GLSL uniform's own name, which is frequently not the parameter's -
 *              `raster.amount` writes `scanlines`, and that rename is refused because
 *              every authored preset spells the parameter the old way.
 *   transform  `degToRad` for the one hue, `axisDeg` for the two angles that arrive in
 *              degrees and land as a unit vector. Absent means the value is written
 *              through untouched, which is the case for thirty-eight of the forty-one.
 *   gates      the five terms whose presence decides whether the grade pass runs at all.
 *              A zero value has to switch its pass off rather than run it as a no-op,
 *              because a full-screen read and write costs the same whether or not it
 *              changes a pixel.
 *
 * Frozen entry by entry and then as a whole, so the table is a fact rather than a
 * suggestion. `tools/module-check.mjs` refuses an exported object anybody can write into
 * unless an exemption says why that is the channel, and the honest answer here is that
 * nothing should ever write into it - which is a freeze rather than an exemption.
 */

const bindings = {
  // The glyph field: every point drawn as a character rather than as a round splat, on the
  // grid `lattice` and `latticeCell` already cut. There is no cell size here and no second
  // snap, deliberately - the shader's own comment carries why - so this family costs the
  // presets four values rather than six and nothing has to be kept in step with a grid.
  //
  // The master crossfades the mark and grows the sprite into the cell as it rises, rather
  // than switching. Blending is what every other master in this registry does: `lattice`
  // blends, the five readings blend, `glitch` fades, and a control with two states would be
  // a checkbox wearing a slider and could not keyframe into anything. The composition falls
  // out for free - at `lattice` 1.0 with this at 0 the picture is the `voxel` look that
  // ships today, and raising it turns those dots into characters without moving one of
  // them. Nothing gates it on the lattice, because a control that refuses to work until you
  // find its partner is the failure `Glitch` sitting inside `Displacement` already was; at
  // `lattice` 0 with this at 1 every one of 217,088 points draws a cell-sized character at
  // its own unquantised position and the picture is mush, which is authoring rather than a
  // defect.
  'glyph.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'glyph', group: 'glyph', on: 'points', uniform: 'glyph' },
  // The three keys, which add into one index and wrap. Each is how far that reading moves
  // the character, and each contributes exactly nothing at zero.
  //
  // `tone` reads the luminance of the colour the cell is about to draw, so with `readDepth`
  // up it is a depth band without a second control existing to do that - which is why there
  // is no fourth key for depth. `hash` is the cell's own identity and holds still, so the
  // characters belong to the room and a subject walks through them. `rain` is the falling
  // counter passing through the cell, which is the one of the three that moves on its own.
  //
  // **`hash` defaults to 1 and the other two to 0**, on the convention the glitch ceilings
  // set: a setting under a master defaults to the literal it replaces, and the probe this
  // came from had exactly one key, the cell's. So raising `glyph` alone draws the field the
  // probe drew rather than sixty-four copies of one character, which is what a default of 0
  // across all three would give.
  'glyph.tone': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'tone key', group: 'glyph', on: 'points', uniform: 'glyphTone' },
  'glyph.hash': { def: 1, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'hash key', group: 'glyph', on: 'points', uniform: 'glyphHash' },
  'glyph.rain': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'rain key', group: 'glyph', on: 'points', uniform: 'glyphRain' },

  // The turbulence field, in world units throughout: amplitude in metres, scale in
  // cycles per metre, speed in metres of drift per program second. Nothing here is a
  // screen-space length, so unlike `pointSize` and the grade terms none of it is
  // referred to 1080p - the same values draw the same displacement at every output
  // size because they describe the room rather than the frame.
  'noise.amount': { def: 0, min: 0, max: 1, step: 0.005, kind: 'scalar',
    label: 'turbulence', group: 'displacement', on: 'points', uniform: 'noise' },
  'noise.scale': { def: 3, min: 0.2, max: 12, step: 0.1, kind: 'scalar',
    label: 'grain m', group: 'displacement', on: 'points', uniform: 'noiseScale' },
  'noise.speed': { def: 0.7, min: 0, max: 3, step: 0.05, kind: 'scalar',
    label: 'speed', group: 'displacement', on: 'points', uniform: 'noiseSpeed' },
  // How far the cloud is pulled onto its grid, so the two ends are the measured surface
  // and a fully reconstructed one, and everything between is the surface arriving. It
  // snaps in the levelled frame, which means a canted mount does not cut the grid on the
  // diagonal - the shader block carries that reasoning and the rotation it uses.
  'lattice.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'lattice', group: 'displacement', on: 'points', uniform: 'lattice' },

  // Datastream corruption: one master and five ceilings, where there used to be one
  // scalar carrying all six meanings at fixed ratios. The comment beside the uniforms
  // has the argument for the shape; what belongs here is why the ceilings are ceilings
  // and not absolute values. An absolute set would need a clip to animate density,
  // shove and tint on three tracks that all reach zero on the same frame just to fade
  // corruption out, and one that missed by a frame leaves a tear standing in a clean
  // plate. The master is the fade, and these say what a full one means.
  //
  // **Four of the five defaults are exactly the literals they replaced, and the fifth is
  // not.** That is the rule the readings' seven constants are held to and it is
  // load-bearing the same way here, so the exception matters: 0.45, 0.45, 12 and 7 are the
  // numbers the shader already had, and `glitchTint` is 1.8 where the old line baked 3.0.
  //
  // This sentence used to claim all five without naming an exception, with the
  // enumeration above listing precisely the four that hold - which is the shape of error
  // `CLAUDE.md` rule 5 describes, an object every observation skips behind a justification
  // that stops anybody looking twice. So `blackwall.json`, which names `glitch: 0.18` and
  // no tint, does *not* draw the picture it drew: its tear flares dimmer. The flare's move
  // out of the Blackwall branch - which is in `web/cloud-shader.js` now, and was a
  // thousand-odd lines from this entry even before it left the file - is a deliberate
  // change on top of that; this one was not deliberate.
  'glitch.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'amount', group: 'glitch', on: 'points', uniform: 'glitch' },
  // How much of the frame tears at a full master, as a fraction of the bands. The
  // shove's other half: this one is how *often* the feed fails and the next is how
  // badly, and the two were the same number until now.
  'glitch.density': { def: 0.45, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'density', group: 'glitch', on: 'points', uniform: 'glitchDensity' },
  // Metres a band travels at a full master, half of it either way. World units like
  // the turbulence field and unlike every screen-space term here, because a tear is a
  // distance in the room: the same look draws the same shear at any output size, and a
  // shove referred to 1080p would change how far the feed failed when you exported.
  'glitch.shove': { def: 0.45, min: 0, max: 2, step: 0.01, kind: 'scalar',
    label: 'shove m', group: 'glitch', on: 'points', uniform: 'glitchShove' },
  // What a torn band flares, per metre it was shoved. Deliberately per metre rather
  // than normalised against `glitchShove`, so a bigger tear burns harder on its own -
  // the alternative decouples them and then wants a second slider to couple them back.
  // The default is not the 3.0 the literal was, and the arithmetic says what it is
  // instead. Inside the Blackwall branch the flare was added to `bw` and then scaled by
  // that reading's `0.55 + 0.75 * lum` on the way out, so the tint reproducing the old
  // picture is `3.0 * (0.55 + 0.75 * lum)` over the torn pixels: 1.65 where a tear falls
  // on black, 2.10 at a luminance of 0.2, 3.0 only where it crosses something as bright
  // as 0.6. Which end of that applies is a fact about the footage rather than about the
  // shader, and this look is graded for rooms shot dark - `docs/reference.md` says the
  // sample was shot unlit and that colour "reads a signal the sensor barely produced" -
  // so the torn bands land near the bottom of the range and 1.8 is the match at a
  // luminance of about 0.07.
  //
  // Stated as arithmetic and not as an A/B of rendered frames, deliberately, because at
  // the value anything ships with the choice barely resolves: `blackwall.json` asks for
  // a master of 0.18, where the largest shove is 8.1cm and the whole flare spans 0.13 to
  // 0.19 across that entire luminance range. It is at a full master that the end of the
  // range starts to matter, and a full master is a slider anybody setting it is watching.
  'glitch.tint': { def: 1.8, min: 0, max: 8, step: 0.05, kind: 'scalar',
    label: 'flare', group: 'glitch', on: 'points', uniform: 'glitchTint' },
  // Depth-image rows per band, so the count of bands is 424 over this - 35 of them at
  // the default. Rows and not a fraction of the frame, because a band is a run of the
  // sensor's own scanlines and that is what makes the tear read as the feed failing
  // rather than as a shape drawn over the picture.
  'glitch.bands': { def: 12, min: 1, max: 64, step: 1, kind: 'scalar',
    label: 'band rows', group: 'glitch', on: 'points', uniform: 'glitchBands' },
  // Which way the bands run, from the sensor's rows at 0 to its columns at 1, and the
  // interesting looks are the fractions in between where the bands cross the frame on a
  // diagonal. The axis was baked as `position.y` from the first version of this effect,
  // which is why the default is 0 and why it has to be exactly 0: a document written
  // before this control existed names no axis and has to keep tearing along rows.
  //
  // A blend of the two image axes rather than an angle in degrees, and that is the honest
  // spelling rather than a lazy one. The bands are quantised in the *sensor's* frame,
  // where the two axes are 512 columns against 424 rows and a band is a run of scanlines
  // rather than a distance - so there is no square in which an angle would mean what an
  // angle means, and the raster's `scanAxis` further down this table is the term that has
  // one because it runs in screen space where the pixels are square.
  //
  // No shear parameter to go with it. The tear's direction stays sensor-frame x, so
  // turning the axis rotates which bands are chosen and not which way they slide, and the
  // pair of controls that would let those disagree buys a look nothing in the references
  // shows and two more ways to author something incoherent.
  'glitch.axis': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'axis', group: 'glitch', on: 'points', uniform: 'glitchAxis' },
  // Hertz: how often the torn set is redrawn, 7 by default, so a state holds for 143ms
  // or about 4.3 frames at 30fps. The phase is `floor(time * rate)` and stays a pure
  // function of program time - integrating a rate for a smoother phase would make the
  // frame depend on how the playhead got there, and seek-equals-playback dies the
  // moment it does. Keyframing the rate therefore jumps the pattern, which is in genre.
  'glitch.rate': { def: 7, min: 0, max: 30, step: 0.5, kind: 'scalar',
    label: 'rate hz', group: 'glitch', on: 'points', uniform: 'glitchRate' },

  // The three effects. Push and mask are signed because both questions have two
  // answers - bulge or pinch, hide the inside or hide everything else - and a sign is
  // one slider where a direction toggle would be a second parameter that cannot lerp.
  'push.amount': { def: 0, min: -1, max: 1, step: 0.01, kind: 'scalar',
    label: 'push', group: 'region', on: 'points', uniform: 'regionPush' },
  'noise.region': { def: 0, min: 0, max: 1, step: 0.005, kind: 'scalar',
    label: 'scramble', group: 'region', on: 'points', uniform: 'regionNoise' },
  'mask.amount': { def: 0, min: -1, max: 1, step: 0.01, kind: 'scalar',
    label: 'mask', group: 'region', on: 'points', uniform: 'regionMask' },
  // The region read a fourth way, after displacing, scrambling and masking: a wave
  // travelling out along the radius, in metres at a full weight. Non-negative, unlike the
  // push and the mask beside it, because the phase is what a sign would invert and the
  // wave already visits both directions every cycle - a negative amplitude would be a
  // second spelling of a shift the frequency can already reach.
  'ripple.amount': { def: 0, min: 0, max: 0.5, step: 0.005, kind: 'scalar',
    label: 'ripple m', group: 'region', on: 'points', uniform: 'ripple' },
  // Cycles per metre of radius, so the wave's spacing is a distance in the room.
  'ripple.freq': { def: 4, min: 0.2, max: 20, step: 0.1, kind: 'scalar',
    label: 'ripple per m', group: 'region', on: 'points', uniform: 'rippleFreq' },
  // Cycles per second, and it advances in eighths of one rather than smoothly - the block
  // says why. Zero freezes the wave where it stands instead of switching it off, which is
  // the state `glitchRate` reaches the same way and for the same reason: a held shape is
  // a different picture from no shape, and both keyframe.
  'ripple.speed': { def: 1, min: 0, max: 8, step: 0.05, kind: 'scalar',
    label: 'ripple hz', group: 'region', on: 'points', uniform: 'rippleSpeed' },

  // The same argument the five readings in `web/main.js`'s registry were rebuilt on, made
  // here first.
  'thermal.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'thermal', group: 'style', on: 'points', uniform: 'thermal' },
  'edges.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'edges', group: 'style', on: 'points', uniform: 'edges' },
  // The duotone: how far the image lands between the two poles, which way they are
  // turned, and where they meet. Three amounts and no source selector, which is the same
  // argument `thermal` above and the five readings in `web/main.js` are built on - a
  // shading idea expressed as a mode is refused during evaluation as a user action and can
  // therefore never move under the playhead, where three scalars each key like anything
  // else.
  //
  // `duotoneDepth` is an amount rather than a switch for the reason every other term here
  // is one: a clip brings the tonal transform in and out on one track. It is the term the
  // rest of this look sits on top of, because in the frames this is graded against the
  // light is emitted by the data rather than reflected off surfaces - so the interiors
  // have to fall toward black before a raster over the top reads as a reconstruction
  // instead of as a filter laid over a video.
  'duotone.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'duotone depth', group: 'style', on: 'points', uniform: 'duotoneDepth' },
  // Degrees on the slider and radians at the uniform, the way `tilt` and `roll` are, so
  // the panel reads in the unit a person turns a hue in and the shader gets the unit a
  // trigonometric function takes. The full turn either way rather than a half, because
  // the two poles are asymmetric - the near one is nearly black - so +90 and -90 are
  // genuinely different pictures and a half-range would hide one of them.
  //
  // `degToRad` is the whole of the binding, and it is the only entry in this table that
  // uses it, so the conversion in `web/main.js`'s applier belongs to this parameter alone
  // and a mutation of it is a mutation of this hue.
  'duotone.hue': { def: 0, min: -180, max: 180, step: 1, kind: 'scalar',
    label: 'duotone hue', group: 'style', on: 'points', uniform: 'duotoneHue',
    transform: 'degToRad' },
  // Where the poles meet, as a fraction of the near/far clip range. A place in the room
  // rather than a fraction of the frame, which is what lets a subject keep its silhouette
  // when the camera moves - and it is the same reasoning `contourBands` is per metre for.
  'duotone.split': { def: 0.5, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'duotone split', group: 'style', on: 'points', uniform: 'duotoneSplit' },
  // And how many metres the crossing between the poles takes, which is the one term here
  // stated in the room's units rather than as a share of the clip range. The uniform
  // carries why; what belongs beside the entry is the range.
  //
  // The floor is 0.2m rather than zero because zero is a hard edge and the ramp already
  // has one at 0.2 for anything a sensor this noisy can resolve - the jitter is about 4mm
  // per sample, so a crossing inside a couple of centimetres is a threshold with speckle
  // on it rather than a gradient. The ceiling is the full 9.5m the depth sliders reach,
  // so a ramp can always be opened wider than anything the box can hold, which is what
  // "the grade does not follow the framing" has to mean at the top end.
  //
  // **The default is the default clip range, and it is the one number in this table that
  // used to be derived and is now written out.** `CLIP_FAR_DEFAULT - CLIP_NEAR_DEFAULT` is
  // `6 - 0.05`, which is the double `5.95` to the bit - checked rather than assumed, and
  // the two constants live in `web/point-cloud.js`, which this module cannot import
  // without giving up the property the header describes. So the derivation is genuinely
  // gone and the three defaults can now drift apart without a compiler noticing, which is
  // a cost rather than a wash: what still holds them together is `registry-check`, whose
  // cross-build arm renders this default against a pinned commit and reddens if the number
  // moves at all.
  //
  // At that value `duotoneSpan / (farClip - nearClip)` is 1.0 on an untouched document and
  // the expression is the one this replaced, term for term - so nine shipped looks and
  // every saved project render what they rendered.
  'duotone.span': { def: 5.95, min: 0.2, max: 9.5, step: 0.05, kind: 'scalar',
    label: 'duotone span m', group: 'style', on: 'points', uniform: 'duotoneSpan' },
  // The fourth of them, and the one that is not a fact about where a point is. It keys
  // the same two poles on how fast a point is moving along the sensor's axis, so a room
  // graded by distance gets whatever is moving through it in the hot pole - which is the
  // one reading the depth key cannot produce, since a subject and the wall behind it are
  // both exactly where they stand.
  //
  // **The speed is measured from the two depth frames the shader already holds and there
  // is no flow pass.** Optical flow would buy lateral motion as well, and it would buy it
  // for a full pass over the frame plus a second history to keep, on a renderer whose
  // whole transport rests on a seek producing the same image playback would - so the pass
  // would have to be walked forward through a pre-roll like the accumulators are, and a
  // scrub would arrive carrying whatever the drag had built. What the depth pair gives is
  // the axial component alone, for one texel fetch that was nearly already there, and
  // axial is the component this look is about: the sensor measures depth, so a subject
  // walking toward it is the movement it can actually see.
  //
  // An amount rather than an amount and a reference speed, on the precedent the poles
  // themselves are baked on: what a look parameterises is how much of a ramp it wants.
  // The shader carries the reference and the measurement behind it.
  'duotone.motion': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'duotone motion', group: 'style', on: 'points', uniform: 'duotoneMotion' },

  // The rain: repeating drop heads descending each column of the room, brightening what
  // they pass. It is a term of its own rather than a setting inside the glyph field because
  // the brightness is the effect - the glyph field's `rain` key reads the same scalar to
  // scramble a character, which is the arrangement `duotone` already has, one source and
  // two consumers. Filed inside the glyph field, a wave descending through a room would
  // have been unreachable for any look that was not drawing text, including `voxel`, which
  // now gets it for nothing.
  //
  // **No accumulated state anywhere in it.** The value is a pure function of program time
  // and world position, so a seek lands on exactly the frame playback would have drawn
  // there; `timeline-check` is the instrument that holds that, and a rain integrated frame
  // to frame would fail it.
  //
  // **A repeating drop rather than one that wraps**, which is the first of three things
  // the probe had to settle by rendering them. A single head running down four metres
  // spends half its cycle below the floor with the room dark behind it; a head every
  // `span` metres means a column always has two or three running. And the trail sits
  // *above* the head, which is what makes it read as falling rather than as a band sliding
  // through.
  'rain.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'rain', group: 'rain', on: 'points', uniform: 'rain' },
  // The three lengths under it, in metres and metres per second of the room, so unlike the
  // screen-space terms none of them owes anything to the 1080p reference and the same look
  // draws the same wave at any output size. Each defaults to the value the reference clips
  // were shot at rather than to zero: they are settings under a master on the glitch
  // ceilings' convention, and a span of zero in particular is a degenerate divisor with
  // nothing but the master standing over it.
  'rain.speed': { def: 0.55, min: 0.05, max: 3, step: 0.01, kind: 'scalar',
    label: 'fall m/s', group: 'rain', on: 'points', uniform: 'rainSpeed' },
  'rain.span': { def: 1.3, min: 0.2, max: 4, step: 0.01, kind: 'scalar',
    label: 'head gap m', group: 'rain', on: 'points', uniform: 'rainSpan' },
  'rain.trail': { def: 0.45, min: 0.05, max: 2, step: 0.01, kind: 'scalar',
    label: 'trail m', group: 'rain', on: 'points', uniform: 'rainTrail' },

  'rgbsplit.amount': { def: 0, min: 0, max: 6, step: 0.05, kind: 'scalar',
    label: 'rgb split', group: 'post', on: 'grade', uniform: 'rgbSplit', gates: true },
  // The raster's master, and the only one of the four that gates the pass. It keeps the
  // name `scanlines`, which now describes one of its settings rather than the whole term:
  // a rename is the one change `registry-check` cannot make bit-exact against its pinned
  // commit, and it would break every preset anybody has authored. Accepted rather than
  // overlooked.
  'raster.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'scanlines', group: 'raster', on: 'grade', uniform: 'scanlines', gates: true },
  // The three settings under it, and none of them gates the pass - for `crush`'s reason
  // in the case of the pitch, whose default is 1.3 and so is true of every document there
  // is, and for a plainer one in the case of the other two: raising an angle while the
  // master sits at zero rotates a raster nobody asked for, and switching a full-screen
  // pass on to draw nothing is exactly the no-op the gate exists to refuse.
  //
  // Degrees on the slider and radians at the uniform. The full half-turn either way is
  // the whole of a raster's range, because a line grille at 180 degrees is the grille at
  // 0 - what the sign buys is which way a *rotating* raster turns under the playhead.
  // One parameter, one vec2 uniform, and the trigonometry happens on the CPU rather than
  // in the shader. The comment beside the uniform carries the measurement that forced it;
  // what belongs here is that the arithmetic is stated once, as the `axisDeg` transform
  // `web/main.js` builds this binding's write from, so a check can hold the axis against
  // it rather than against a second copy of the same sum. It is stated once for both
  // angles now rather than once each, which is what makes a mutation of it a statement
  // about the pair.
  'raster.angle': { def: 0, min: -180, max: 180, step: 1, kind: 'scalar',
    label: 'angle', group: 'raster', on: 'grade', uniform: 'scanAxis',
    transform: 'axisDeg' },
  // Cycles per reference pixel along the raster's own axis, and the default is exactly
  // the literal it replaces.
  //
  // **The useful range runs below the default, not above it**, which is the opposite of
  // what this said when it was written and is worth stating as a correction rather than
  // quietly replacing. The claim was that 1.3 is a television artifact and 6 is the column
  // raster a reference frame gets sliced into. The first half is right and the second is
  // backwards: the wave is expressed against 1080p, so 1.3 is already about 220 cycles
  // across the picture, 6 is nearer a thousand, and a line thinner than the pixel carrying
  // it is not a grille but aliasing. The wide bands the references actually cut a picture
  // into want a pitch under about 0.6. Measured on rendered frames at a fixed pose rather
  // than reasoned about: at 0.1 the bands are wide enough to read across the room, and by
  // 1.0 they have closed up into a scanline again.
  //
  // The old range of 0.1 to 12 in tenths therefore put every value worth having inside its
  // bottom four percent, with six positions to choose between, and spent the rest of the
  // travel past the point where anything is resolvable.
  //
  // **The default has to stay reachable to the exact bit**, because the guard in the grade
  // shader tests this against the literal 1.3 and takes the old code path when it matches.
  // A range input does its stepping in decimal on its own value string, so a minimum of
  // 0.05 with a hundredth step still lands the same double `params.reset()` writes, and
  // every one of the 396 reachable positions round-trips. Checked in a browser rather than
  // reasoned about, because a default that missed by one bit would take the shipped raster
  // off its bit-exact path with nothing anywhere turning red to say so.
  'raster.pitch': { def: 1.3, min: 0.05, max: 4, step: 0.01, kind: 'scalar',
    label: 'pitch', group: 'raster', on: 'grade', uniform: 'scanPitch' },
  // How square the wave is, from the sine it has always been to a hard grille with dark
  // gaps. This is the control that makes the other two reach the look at all - an angle
  // over a sine is rotated softness, and softness is not what the references show.
  'raster.hard': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'hardness', group: 'raster', on: 'grade', uniform: 'scanHard' },
  'grain.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'grain', group: 'post', on: 'grade', uniform: 'grain', gates: true },
  // The fifth term that gates the pass, and it gates for the plain reason the other four
  // do rather than as an exception: its default is zero, so a look that never names it
  // pays nothing and the pass stays shut. Contrast `crush`, a core entry still written out
  // in `web/main.js`'s registry, whose default is the literal it replaced and which
  // therefore cannot gate anything without holding the pass open for every look there has
  // ever been.
  'streak.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'streak', group: 'post', on: 'grade', uniform: 'streak', gates: true },
  // Which way the light runs, and this **reverses a decision the code used to state as
  // settled**, which is worth saying plainly rather than leaving as a diff. The gather ran
  // down the column and nothing else, the comment above it said it falls and only falls,
  // and `docs/reference.md` said a control for the direction would be a control for
  // getting it wrong. The argument was that gravity has one direction. It is not a bad
  // argument and it is not the operator's: a smear is a thing a lens and a sensor do, and
  // a light bleeding sideways off a hot edge is in as many reference frames as one running
  // down a column. The old sentences are gone rather than left standing next to the slider
  // that contradicts them.
  //
  // Zero has to be exactly straight down, because a look authored before this control
  // existed names no angle and has to keep the streak it was graded with. The gather's own
  // comment carries the measurement that says it does, to the bit.
  //
  // A full half-turn either way, like the raster's angle and unlike it in what the sign
  // buys: a grille at 180 degrees is the grille at 0, so there the sign only decides which
  // way a rotating raster turns, where here 0 and 180 are opposite directions and both are
  // reachable by two routes. Positive turns the streak clockwise on the glass - 90 puts it
  // across to the left, -90 across to the right - which is the same sense the raster's
  // angle turns in, and it is written down here because it was read off rendered frames
  // rather than derived. One parameter, one vec2 uniform, and the trigonometry happens on
  // the CPU, in the one `axisDeg` transform this and the raster's angle share, so a check
  // can hold the axis against the arithmetic stated once rather than against a second copy
  // of the same sum.
  'streak.angle': { def: 0, min: -180, max: 180, step: 1, kind: 'scalar',
    label: 'streak angle', group: 'post', on: 'grade', uniform: 'streakAxis',
    transform: 'axisDeg' },
  // The corner falloff, which was a literal inside the grade shader and so arrived with
  // whichever of the three above you happened to raise. The uniform beside it carries
  // why this is the one promoted literal that does not keep its old value; what belongs
  // here is that it gates the pass like the other three, so the vignette can be had on
  // its own and a look wanting none of the four still pays for no pass at all.
  'vignette.amount': { def: 0, min: 0, max: 1, step: 0.01, kind: 'scalar',
    label: 'vignette', group: 'post', on: 'grade', uniform: 'vignette', gates: true },
};

for (const binding of Object.values(bindings)) Object.freeze(binding);

export const EFFECT_PARAMS = Object.freeze(bindings);
