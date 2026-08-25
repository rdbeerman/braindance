  // Datastream corruption: depth-image rows tear along sensor X before the view matrix, so
  // the tear belongs to the feed rather than to the display.
  vGlitch = 0.0;
  if (glitch > 0.0) {
    // The zero case reaches the old division textually: a local licenses a contraction the
    // inline form does not get.
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

