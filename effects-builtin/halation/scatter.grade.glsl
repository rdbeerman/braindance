      // Light scattering off the film base rings bright areas red-orange. What is gathered is
      // a scalar - how far each tap sits above the threshold - so the colour all comes from
      // the tint, which is what the bloom pass cannot say. The normaliser is the sum of the
      // distance weights and never the summed excess, which is zero on a frame with no
      // highlight in it and would put a NaN halo where nobody is watching for it.
      if (halation > 0.0) {
        vec3 glowTint = mix(vec3(0.94, 0.16, 0.05), vec3(1.00, 0.56, 0.20), halationTint);
        float scattered = 0.0;
        float weights = 0.0;
        for (int i = 0; i < 16; i++) {
          float span = sqrt((float(i) + 0.5) / 16.0) * halationRadius;
          float turn = float(i) * 2.39996323;
          vec3 tap = texture2D(tDiffuse, vUv + vec2(cos(turn), sin(turn)) * span * texel).rgb;
          float weight = 1.0 / (1.0 + span * 0.08);
          scattered += max(dot(tap, vec3(0.299, 0.587, 0.114)) - halationThreshold, 0.0) * weight;
          weights += weight;
        }
        col += glowTint * (scattered / weights) * halation;
      }
