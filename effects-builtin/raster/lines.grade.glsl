      if (scanlines > 0.0) {
        // **The default path is the old line itself, not an expression that computes what
        // the old line computed**, and that distinction is a measurement rather than
        // caution. The shipped Blackwall document names a scanlines of 0.35, so this block
        // runs in the one shipped look that is a look, and a raster a hair off the one it
        // replaces is that document quietly re-grading itself.
        //
        // Two things were tried before this and both failed, which is worth recording
        // because each looked like the answer. Taking the sine and cosine of the angle in
        // the shader leaked a whisker of x into a raster meant to run along y, since GLSL
        // ES does not promise the sine of zero is zero - that is real and is why the axis
        // is built on the CPU, but fixing it moved nothing here. What moves the frame is
        // the substitution docs/measurement.md already records: handing the wave a
        // coordinate through a local is not the same as handing it the expression, because
        // the compiler contracts the whole of y times the reference times 1.3 plus the
        // clock across one line and will not do so through a variable. Measured at the
        // shipped 0.35, all six frames differed, 054b99215d9f against 44e1ccf8, with every
        // parameter at its default.
        //
        // So the branch goes around the whole statement and the default path *is* the old
        // one - the same shape, and for the same reason, as the depth reading's gamma in
        // web/cloud-shader.js. It is not a legacy path beside a new one: the general form
        // below is the implementation, and this is the one input for which the arithmetic
        // has to be reached rather than reproduced.
        float line;
        if (scanAxis.x == 0.0 && scanAxis.y == 1.0 && scanPitch == 1.3 && scanHard == 0.0) {
          line = sin(vUv.y * ref.y * 1.3 + time * 2.0) * 0.5 + 0.5;
        } else {
          // The raster's own axis, as a direction in reference pixels, built on the CPU
          // for the reason beside the uniform.
          float coord = dot(vUv * ref, scanAxis);
          float wave = sin(coord * scanPitch + time * 2.0) * 0.5 + 0.5;
          // Hardness is a duty cycle rather than a second term. It narrows a smoothstep
          // about the middle of the wave until the sine becomes a grille of hard lines
          // with dark gaps between them, which is what the reference frames actually
          // carry and what no amount of rotating a sine will ever reach.
          float w = mix(0.5, 0.004, scanHard);
          line = mix(wave, smoothstep(0.5 - w, 0.5 + w, wave), scanHard);
        }
        col *= 1.0 - scanlines * 0.35 * line;
      }

