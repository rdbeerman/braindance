  if (ghost > 0.0) {
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    // Two controls over one shell: the exponent decides how tightly the glow hugs a
    // depth discontinuity, and the fill is how much of the shell's blue is there before
    // any luminance arrives - which is what a colourless surface facing the sensor
    // draws, and at 0 the reading collapses to edges alone.
    float rim = pow(vEdge, ghostRim);
    col += mix(vec3(0.20, 0.45, 0.75) * (ghostFill + lum), vec3(0.75, 0.95, 1.0), rim) * ghost;
    alphaFactor += (0.25 + 0.75 * rim + 0.25 * lum) * ghost;
    readSum += ghost;
  }

