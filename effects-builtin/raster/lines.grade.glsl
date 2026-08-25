      if (scanlines > 0.0) {
        // The default path is the old line itself rather than an expression computing what it
        // computed: the compiler contracts the whole statement and will not do so through a
        // local, which moved all six frames of the shipped Blackwall look.
        float line;
        if (scanAxis.x == 0.0 && scanAxis.y == 1.0 && scanPitch == 1.3 && scanHard == 0.0) {
          line = sin(vUv.y * ref.y * 1.3 + time * 2.0) * 0.5 + 0.5;
        } else {
          // The raster's own axis, as a direction in reference pixels, built on the CPU.
          float coord = dot(vUv * ref, scanAxis);
          float wave = sin(coord * scanPitch + time * 2.0) * 0.5 + 0.5;
          // Hardness is a duty cycle: it narrows a smoothstep about the middle of the wave.
          float w = mix(0.5, 0.004, scanHard);
          line = mix(wave, smoothstep(0.5 - w, 0.5 + w, wave), scanHard);
        }
        col *= 1.0 - scanlines * 0.35 * line;
      }

