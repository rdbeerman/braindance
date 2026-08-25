  // The region breathing: a wave travelling out along the radius. The clock is stepped in
  // eighth-cycles rather than running continuously, which is what makes it read as machinery.
  if (ripple > 0.0 && rw > 0.0) {
    vec3 out0 = p0 - regionCentre;
    float dist = length(out0);
    if (dist > 1e-4) {
      float cycles = dist * rippleFreq - floor(time * rippleSpeed * 8.0) * 0.125;
      pos += (out0 / dist) * (sin(cycles * 6.2831853) * ripple * rw);
    }
  }

