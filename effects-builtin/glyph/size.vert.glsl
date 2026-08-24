  // **The sprite grows into its cell as the master rises**, so one character stands for one
  // cube of room, which is the whole reading the cube variant of this was chosen for. A
  // 5.5cm cell a metre away is about 64 reference pixels where pointSize 9 is 9, so the
  // two are nowhere near each other and something had to give; blending rather than
  // switching is what keeps pointSize meaning something at every value in between.
  //
  // **The ceiling on the glyph branch is the hardware's and not the literal 64**, because a
  // cell-sized sprite reaches 64 pixels at a metre and that is where a person stands. Past
  // that the sprite would stop growing while the cell kept growing, so characters would
  // stop filling their cells, the tiling would open up, and spriteWorld / cell would stop
  // being 1 at full glyph - which is the property the energy compensation in the fragment
  // stage rests on. The clamp is in framebuffer pixels, so that failure moves with output
  // size: the same look that opens gaps at a metre on screen opens them at two metres in a
  // 4K export, which is exactly the drift the 1080p reference unit exists to stop.
  //
  // **The old statement survives verbatim on the else branch, and that departs from the
  // design document on purpose.** The document replaces the literal 64 outright. It is kept
  // here because no shipped look reaches it - pointSize tops out at 9 across all nine, so
  // 64 needs a subject 14cm from the sensor, nearer than a Kinect v2 will range - and
  // because leaving the statement textually alone is what keeps the old path byte-identical
  // across output sizes and keeps export-check's anchor alive. What the document is right
  // about is the case it was written for, which is the grown sprite, and that case is the
  // branch above.
  if (glyph > 0.0) {
    float base = clamp(pointSize * k / dist, 1.0, 64.0);
    gl_PointSize = clamp(mix(base, cellPx * k, glyph), 1.0, pointCeiling);
  } else {
    gl_PointSize = clamp(pointSize * k / max(0.15, -mv.z), 1.0, 64.0);
  }
