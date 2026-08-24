  if (thermal > 0.0) {
    // Luminance where there is a colour camera, depth where there is not. A thermal
    // picture is a reading of a signal, and with the colour stream off the only signal
    // left is range - falling back to a flat tint instead would be a slider that
    // appears to work and is showing nothing.
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    float heat = hasColor == 1 ? lum : 1.0 - t;
    col = mix(col, heatRamp(clamp(heat, 0.0, 1.0)), thermal);
  }

