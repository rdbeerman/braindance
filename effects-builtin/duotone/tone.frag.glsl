  // Depth-keyed duotone: the near pole runs to black, the far pole to hot. duotoneSpan is
  // a distance, so it is divided by the clip range to land back in t's units.
  if (duotoneDepth > 0.0) {
    vec3 cold = hueSpin(vec3(0.020, 0.030, 0.075), duotoneHue);
    vec3 heat = hueSpin(vec3(1.000, 0.380, 0.120), duotoneHue);
    float w = duotoneSpan / max(0.001, farClip - nearClip);
    float k = smoothstep(duotoneSplit - w * 0.5, duotoneSplit + w * 0.5, t);
    // Motion pushes whatever is moving toward the hot pole; 1200 mm/s reaches it.
    k = mix(k, 1.0, duotoneMotion * smoothstep(0.0, 1200.0, vSpeed));
    col = mix(col, mix(cold, heat, k), duotoneDepth);
  }

