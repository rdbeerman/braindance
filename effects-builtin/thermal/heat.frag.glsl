  if (thermal > 0.0) {
    // Luminance where there is a colour camera, depth where there is not - with the colour
    // stream off, range is the only signal left to read.
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    float heat = hasColor == 1 ? lum : 1.0 - t;
    col = mix(col, heatRamp(clamp(heat, 0.0, 1.0)), thermal);
  }

