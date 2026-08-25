      // The emulsion's own colour, keyed to luminance, with one parameter walking both poles
      // between a tungsten stock and a daylight one. The tinted pixel is scaled back onto the
      // luminance it arrived with, which is what keeps this a colour control rather than an
      // exposure one - dividing the tint by the tint's own luminance holds for grey alone.
      if (stock > 0.0) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        float e = smoothstep(stockSplit - stockLatitude * 0.5, stockSplit + stockLatitude * 0.5, lum);
        float day = stockBalance * 0.5 + 0.5;
        vec3 shadowTint = mix(vec3(0.82, 0.97, 1.22), vec3(1.06, 1.00, 0.93), day);
        vec3 highlightTint = mix(vec3(1.16, 1.02, 0.84), vec3(1.14, 1.02, 0.85), day);
        vec3 tint = mix(shadowTint, highlightTint, e);
        vec3 tinted = col * tint;
        float tintedLum = dot(tinted, vec3(0.299, 0.587, 0.114));
        col = mix(col, tinted * (abs(tintedLum) > 1e-5 ? lum / tintedLum : 1.0), stock);
      }
