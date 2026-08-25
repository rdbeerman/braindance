  // **The sprite grows into its cell as the master rises**, so one character stands for one
  // cube of room, which is the whole reading the cube variant of this was chosen for. A
  // 5.5cm cell a metre away is about 64 reference pixels where pointSize 9 is 9, so the
  // two are nowhere near each other and something had to give; blending rather than
  // switching is what keeps pointSize meaning something at every value in between.
  //
  // **The ceiling on the glyph branch is 255 reference pixels under the hardware's, and it
  // is not the literal 64**, because a cell-sized sprite reaches 64 pixels at a metre and
  // that is where a person stands. Past the ceiling the sprite stops growing while the cell
  // keeps growing, so characters stop filling their cells, the tiling opens up, and
  // spriteWorld / cell stops being 1 at full glyph - which is the property the energy
  // compensation in the fragment stage rests on.
  //
  // **The reference scale on the ceiling is the correction, and the hardware bound outside
  // it is what keeps the correction honest.** This clamp used to be `pointCeiling` alone,
  // which is framebuffer pixels, so the range at which the tiling opened moved with output
  // size: the same look that opened gaps at a metre on screen opened them at two metres in
  // a 4K export, which is exactly the drift the 1080p reference unit exists to stop. Scaling
  // the look's own number by k puts that range in the unit every other screen-space term
  // here is expressed in, and the min under pointCeiling is what stops it being a clamp that
  // does not clamp - a reference ceiling the GPU will not rasterise is a number with no
  // effect on the picture and a comment claiming one.
  //
  // **Which way the picture moves is the opposite of what it looks like, and it is worth
  // stating rather than being found.** Measured off the context the tools open, this rig
  // reports ALIASED_POINT_SIZE_RANGE as [1, 511] - Apple M2 Max through ANGLE's Metal
  // backend - and the tallest output web/export-sizes.js offers is 2160, so the largest
  // scale an export ever reaches is exactly 2. The old ceiling therefore already sat at
  // 255.5 reference pixels in a 4K export and at 511 at 1080p, which means 4K was the
  // tight end all along: the fix pulls 1080p and everything under it down to what 4K can
  // actually draw, rather than letting 4K reach what 1080p did. 255 is the largest number
  // that survives that - 255 * 2 is 510, inside the 511 the hardware will take - and above
  // a scale of 2, which only an interactive window with renderScale wound up reaches, the
  // min falls back to the hardware and the invariance lapses. That residual is the same one
  // the lower clamp's comment in web/cloud-shader.js records for the far cloud, and it is
  // confined the same way: to where the hardware, and not the look, is deciding.
  //
  // The number stays a look constant rather than pointCeiling halved, for the reason the
  // uniform's own comment in web/cloud-shader.js gives about itself - a machine's limit
  // carried into a document is a document that draws differently on the next machine, and
  // dividing that limit by two would carry it just as far. 255 is the same number
  // everywhere, and where a GPU cannot deliver it the hardware bound says so in the picture.
  //
  // No shipped look moves. presets-builtin/cascade.json is the only one carrying the glyph
  // field, its cell is 0.055m, and the projection measures 2.1445 at the shipped field of
  // view - so its cells are 63.7 reference pixels at a metre and would need a subject at
  // 0.250m to reach 255, which is nearer than a Kinect v2 ranges and nearer than the 0.15m
  // floor on dist below.
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
    gl_PointSize = clamp(mix(base, cellPx * k, glyph), 1.0, min(255.0 * k, pointCeiling));
  } else {
    gl_PointSize = clamp(pointSize * k / max(0.15, -mv.z), 1.0, 64.0);
  }
