      // Light bleeds: each pixel gathers back along the streak's axis and keeps the brightest
      // thing it finds. A gather rather than a feedback buffer, because a buffer accumulating
      // across frames would make a seek arrive carrying the streak the scrub built. The axis
      // is a direction in reference pixels, so the angle is the one the slider names.
      if (streak > 0.0) {
        vec3 fall = col;
        float d = 1.5;
        for (int i = 0; i < 16; i++) {
          vec3 tap = texture2D(tDiffuse, vUv + d * texel * streakAxis).rgb;
          fall = max(fall, tap * exp2(-d * 0.02));
          d *= 1.35;
        }
        col = mix(col, fall, streak);
      }

