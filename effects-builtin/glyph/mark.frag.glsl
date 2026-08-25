  // How much of the mark is a character rather than a round splat. The distance term
  // multiplies into the master rather than clamping the sprite, so far cells stay cell-sized
  // and the recession holds. 8 to 16 are the font's own sampling limits; which pixels they
  // are is worked out in the vertex stage.
  float glyphMix = glyph * smoothstep(8.0, 16.0, vLegiblePx);

  // Additive mode shapes the sprite purely with alpha falloff. Skipping the
  // discard keeps Apple's tile-based hidden-surface removal working.
  //
  // The glyph is asked about first, or the disc would take the corners off a character.
  float falloff;
  if (softEdge == 1) {
    falloff = exp(-r2 * 9.0);
  } else {
    if (glyphMix <= 0.0 && r2 > 0.25) discard;
    falloff = smoothstep(0.25, 0.02, r2);
  }

