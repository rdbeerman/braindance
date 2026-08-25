  // Which character this cell draws. The three keys add and wrap rather than mix, because
  // character indices do not average. Tone is scaled by 63/64 so the top of the ramp lands on
  // the densest character instead of wrapping back to the sparsest.
  if (glyphMix > 0.0) {
    float cellTone = 1.0 - vCellT;
    float rainStep = floor(vRain) * 0.6180339887498949;
    float f = fract(glyphTone * cellTone * (63.0 / 64.0) + glyphHash * vCellSeed + glyphRain * rainStep);
    // Guarded: a fract arriving at exactly 1.0 would index past the end, which GLSL leaves
    // undefined rather than reporting.
    int idx = min(int(f * 64.0), 63);
    uvec2 g = GLYPHS[idx];
    // gl_PointCoord runs from the sprite's upper left, where row 0 and column 0 of the mask are.
    uint gc = uint(clamp(gl_PointCoord.x * 8.0, 0.0, 7.0));
    uint gr = uint(clamp(gl_PointCoord.y * 8.0, 0.0, 7.0));
    uint bits = gr < 4u ? g.x >> (gr * 8u + gc) : g.y >> ((gr - 4u) * 8u + gc);
    // A hard cut: the crossfade above already softens the mark wherever it cannot resolve.
    falloff = mix(falloff, (bits & 1u) == 1u ? 1.0 : 0.0, glyphMix);
  }

