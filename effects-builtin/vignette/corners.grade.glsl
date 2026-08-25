      // How far the frame closes down on the subject, which used to be the literal 0.55
      // and therefore a hidden function of whether any of the three terms above was up.
      // The extent is still fixed - a vignette this look wants is a corner falloff and
      // not a shape to author - so the parameter is the depth alone.
      float vig = smoothstep(1.05, 0.32, length(vUv - 0.5));
      col *= mix(1.0, vig, vignette);

