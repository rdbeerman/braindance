  // Datastream corruption: horizontal bands tear sideways, the way a failing
  // feed shears. Bands are picked stochastically so it stutters rather than pulses.
  //
  // The shove is sensor-frame X applied before the view matrix, and the bands are
  // depth-image rows, so the tear belongs to the feed rather than to the display. That
  // is the point rather than an oversight: orbit around a torn band and it shoves in
  // depth, which is what says the volume is corrupt, and under a levelled room the
  // bands run at the angle the bracket was actually at. Screen-locked tearing is a
  // different effect and would belong at the grade stage beside the scanlines.
  //
  // The floor of time times the rate is written twice rather than hoisted into a local,
  // and the shove's ceiling is parenthesised as twice glitchShove rather than folded
  // into the chain. Both are here to hold the float arithmetic at the defaults exactly
  // where the literals left it - this file has already measured that handing a value
  // through a variable licenses a contraction the inline expression does not get, and
  // doubling 0.45 is exact in float32 where a re-associated product need not be. At the
  // defaults the *geometry* of this block is bit-identical to the one-slider version it
  // replaces, and that is measured rather than reasoned: with the flare taken to zero, the
  // colour, depth and contour readings come back byte for byte identical to the pinned
  // build at the shipped glitch of 0.18, over six frames, and the shove is live on both
  // sides so the equality is not vacuous.
  //
  // **The flare is the exception and the claim used to be stated without it.** glitchTint
  // defaults to 1.8 where the line it replaced baked 3.0, so the picture does move - see
  // the registry entry for the measurement. The blanket version of this sentence stood for
  // as long as it did because nothing ever rendered these two builds with the glitch
  // switched on: the cross-build section renders at parameter defaults, where glitch is 0
  // and none of this executes.
  vGlitch = 0.0;
  if (glitch > 0.0) {
    // The axis the bands are cut along, and the default path is the old expression itself
    // rather than one that computes what the old expression computed. That distinction has
    // already cost this file a measurement twice - the comment above says why, and the
    // raster's guard in the grade shader in web/post-chain.js says it again - so the zero
    // case reaches the old division textually, with no local in the way to license a
    // contraction the inline form does not get.
    float band = glitchAxis > 0.0
      ? floor(mix(position.y, position.x, glitchAxis) / glitchBands)
      : floor(position.y / glitchBands);
    float roll = hash(band + floor(time * glitchRate) * 31.7);
    if (roll > 1.0 - glitch * glitchDensity) {
      float shove = (hash(band * 3.1 + floor(time * glitchRate)) - 0.5) * glitch * (2.0 * glitchShove);
      pos.x += shove;
      vGlitch = abs(shove) * glitchTint;
    }
  }

