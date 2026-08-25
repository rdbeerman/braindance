  // The region read a fourth way: a wave travelling out along the radius, so the volume
  // breathes where the push only swells it. It shares the push's radial direction and its
  // centre guard for the same reasons - the gradient of a rounded box is degenerate at the
  // centre, and normalize there would hand back NaN and take the vertex with it.
  //
  // **The clock is stepped rather than continuous, which is the whole character of it.**
  // A sine of raw time is a thing breathing; this design wants a thing being rebuilt by a
  // machine, so the phase advances in eighth-cycles and the surface arrives at each one
  // rather than sliding between them. Eight steps and not a parameter: the count is what
  // makes it read as machinery, and a slider that could set it to a thousand would just
  // be a way to author the smooth version this is deliberately not.
  //
  // The step is on the clock alone and not on the radius, so the wave is quantised in
  // time and smooth in space. Quantising both would put the region on a set of shells,
  // which is the lattice's job two blocks down and would be a second way to do it.
  if (ripple > 0.0 && rw > 0.0) {
    vec3 out0 = p0 - regionCentre;
    float dist = length(out0);
    if (dist > 1e-4) {
      float cycles = dist * rippleFreq - floor(time * rippleSpeed * 8.0) * 0.125;
      pos += (out0 / dist) * (sin(cycles * 6.2831853) * ripple * rw);
    }
  }

