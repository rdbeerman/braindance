      // The extent is fixed - a vignette here is a corner falloff, not a shape to author.
      float vig = smoothstep(1.05, 0.32, length(vUv - 0.5));
      col *= mix(1.0, vig, vignette);

