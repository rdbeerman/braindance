  if (contour > 0.0) {
    // Bands per metre, and how much of each band the line fills.
    float bands = fract(vDepth * contourBands);
    float lo = 0.5 - contourWidth;
    float hi = 0.5 + contourWidth;
    float line = smoothstep(lo, 0.5, bands) * smoothstep(hi, 0.5, bands);
    col += mix(depthRamp(1.0 - t) * 0.18, vec3(1.0), line) * contour;
    alphaFactor += (0.15 + 0.85 * line) * contour;
    readSum += contour;
  }

