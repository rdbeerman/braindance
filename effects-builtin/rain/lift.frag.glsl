  // **The rain, which is a colour term rather than a property of the alphabet.** It sits
  // here for the reason thermal, the edges and the duotone above it do - a term written
  // into one reading is inert in every other one - and it is a term of its own rather than
  // a setting inside the glyph field because the brightness *is* the effect. What the
  // reference clips show carrying the picture is a drop head descending a column with a
  // trail of afterglow above it; scrambling on its own is invisible, since which character
  // a cell draws is noise either way. Filed inside the glyph field, a wave descending
  // through the room would have been unreachable for any look that was not drawing text -
  // including voxel, which now gets it for nothing.
  //
  // It is below the flare rather than above it so that the line the flare's own comment
  // measured keeps the neighbours it was measured beside, and because a torn band is
  // emitted light: the rain lifts what the cell actually draws, flare included, and the
  // tone key one block down reads the same colour the frame gets.
  //
  // vRain counts whole drops, so its fraction is how far above the last head this point
  // stands as a share of the span, and the trail arrives in metres and is converted into
  // that same share. **The trail sits above the head and not below it**, which is what
  // makes the wave read as falling rather than as a band sliding through: the lift is 1 at
  // the head and decays upward over rainTrail metres, and a point just under a head is a
  // whole span below the next one and so is dark.
  //
  // Unconditional and written straight through, on the flare's own measurement above: at a
  // rain of 0 the multiplier is exactly 1.0 whether or not the compiler contracts it, where
  // a branch dropped into this path costs contractions across the lines either side of it.
  float rainLift = 1.0 - smoothstep(0.0, rainTrail / rainSpan, fract(vRain));
  col *= 1.0 + rain * rainLift;

