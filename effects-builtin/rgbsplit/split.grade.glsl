      if (rgbSplit > 0.0) {
        // Split grows toward the edges, so the centre stays legible.
        vec2 dir = (vUv - 0.5);
        vec2 off = dir * rgbSplit * texel * 8.0;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }

