  // How much of the mark is a character rather than a round splat, worked out here
  // because the discard below has to know about it and finished a long way down, where the
  // luminance the character index keys on finally exists.
  //
  // **The distance term multiplies into the master rather than clamping the sprite**, and
  // that is what protects the recession. A cell four metres from the sensor projects to
  // about six pixels, and an 8x8 bitmask sampled across six pixels is not a small
  // character - it is a different random set of bits every time the camera moves, which
  // bloom then amplifies. Clamping the sprite to a legible minimum would keep every cell
  // readable at any range, but far cells would stop being cell-sized and start
  // overlapping, which collapses the perspective recession at depth into exactly the flat
  // screen grid this design was chosen over. So the mark stops trying to be legible and
  // the geometry never stops being true, and it does it by reusing the blend the master
  // already is rather than adding a mechanism that could go out of step with it.
  //
  // The two ends are the font's own sampling limits: at 8 the 8x8 grid gets one pixel per
  // font cell, which is where the bits start aliasing into speckle, and at 16 it gets two
  // and the character resolves. The design document says the fallback is somewhere below
  // about ten pixels, which is inside this band rather than at either end of it.
  //
  // **What the two numbers are pixels *of* is the whole of what the vertex stage works out
  // above**, and it is neither of this renderer's two existing references on its own. Below
  // 1080 they are framebuffer pixels, because aliasing is a fact about the samples that
  // exist and a mark cannot resolve on texels it does not have. At and above 1080 they are
  // reference pixels, because the boundary between text and texture is a property of the
  // look and a 4K export has to draw the same picture the grade was made on. The band is
  // therefore stated once and read against whichever limit is nearer.
  //
  // **A cut-away point never draws a character, and it arrives here already saying so.**
  // The crop writes a legible size of exactly zero for anything outside the box, which is
  // below the band at every output size, so this collapses to a glyphMix of 0 and the mark
  // below is the disc. That is asked for in the vertex stage rather than tested again here
  // because the crop's state is up there and the comment beside that write carries the
  // argument: halving the sprite was never enough on its own, since half of a sprite well
  // above the band is still above it, and cut-away geometry drawing a smaller character is
  // the opposite of the dust the halving's own paragraph promises.
  float glyphMix = glyph * smoothstep(8.0, 16.0, vLegiblePx);

  // Additive mode shapes the sprite purely with alpha falloff. Skipping the
  // discard keeps Apple's tile-based hidden-surface removal working.
  //
  // **The disc the hard-edged branch cuts would take the corners off a character**, so it
  // is asked about the glyph first. At a glyphMix of exactly zero - which is every value of
  // every look that does not draw characters, because the master multiplies - the condition
  // collapses to the test that has always been here and the executed path is literally the
  // old one, discard and then smoothstep. Above zero the sprite keeps its corners, and what
  // shapes it is the bitmask rather than the disc.
  float falloff;
  if (softEdge == 1) {
    falloff = exp(-r2 * 9.0);
  } else {
    if (glyphMix <= 0.0 && r2 > 0.25) discard;
    falloff = smoothstep(0.25, 0.02, r2);
  }

