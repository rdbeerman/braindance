  // **Which character this cell draws.** Decided here rather than in the vertex stage
  // because one of the three keys does not exist up there: the tone key is the luminance of
  // the colour the cell is about to draw, which is the line above this one. Nothing is lost
  // by the move - the cell seed and the rain coordinate are both constant across a sprite,
  // so the character is too.
  //
  // **The three keys add and wrap rather than mixing the way the five readings do**, and
  // the difference is forced rather than stylistic: character indices do not average.
  // Character 3 blended half and half with character 9 is character 6, which is an
  // unrelated symbol rather than anything between the two. A sum wrapped into the table is
  // the only composition that leaves each weight meaning how far it moves the character,
  // and it keeps the property the readings have, that a weight at zero contributes exactly
  // nothing.
  //
  // **The tone key is scaled by 63/64 where the other two keep the pure wrap**, and that
  // departs from the design document, which writes all three the same. Luminance is the one
  // key with a direction: the table is sorted by ink, so a tone ramp is only a ramp if full
  // luminance lands on the densest character. Unscaled it lands on fract(1.0), which is 0
  // and therefore the sparsest, so the brightest point in the picture would draw an
  // apostrophe and the top of the ramp would read as a hole in it. The hash and the rain
  // are not scaled, because wrapping is exactly what makes them look like noise.
  //
  // The luminance is clamped for the same reason the scaling exists. col can leave the unit
  // interval - the readings sum, the flare adds, and a duotone pole is hot - and an
  // unclamped tone term would carry the top of the ramp round to the sparse end again.
  //
  // The rain key reads whole heads gone past rather than the continuous coordinate, because
  // a character index that blends is a character nobody wrote. It is multiplied by the
  // golden ratio rather than used raw, and that is not decoration: at a weight of 1 an
  // integer counter contributes exactly nothing, since the fract of a whole number is zero,
  // so the one setting where the key should be strongest is the one where it would be
  // inert. An irrational step walks the table without repeating, which is what a scramble
  // has to do.
  if (glyphMix > 0.0) {
    float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    float rainStep = floor(vRain) * 0.6180339887498949;
    float f = fract(glyphTone * lum * (63.0 / 64.0) + glyphHash * vCellSeed + glyphRain * rainStep);
    // Guarded rather than trusted. fract is below 1 by definition, but a value arriving at
    // exactly 1.0 through a rounding would index one past the end of the table, and reading
    // a constant array out of range in GLSL is undefined rather than an error - so the one
    // way this could go wrong is also the way nothing would report it.
    int idx = min(int(f * 64.0), 63);
    uvec2 g = GLYPHS[idx];
    // gl_PointCoord runs from the sprite's upper left, which is where row 0 and column 0 of
    // the bitmask are, so the two grids line up without a flip anywhere. Sampled across the
    // whole 8x8 box rather than across the ink: the clear eighth row and column are the
    // margin, and cropping to the ink would be a parameter for something the font already
    // says.
    uint gc = uint(clamp(gl_PointCoord.x * 8.0, 0.0, 7.0));
    uint gr = uint(clamp(gl_PointCoord.y * 8.0, 0.0, 7.0));
    uint bits = gr < 4u ? g.x >> (gr * 8u + gc) : g.y >> ((gr - 4u) * 8u + gc);
    // A hard cut rather than an antialiased one, and the crossfade above is why it can be.
    // The mark is already blending back toward the round falloff wherever it is too small
    // to resolve, so softening the bits as well would be a second legibility mechanism
    // doing the first one's job - and the two would then have to be kept in step.
    falloff = mix(falloff, (bits & 1u) == 1u ? 1.0 : 0.0, glyphMix);
  }

