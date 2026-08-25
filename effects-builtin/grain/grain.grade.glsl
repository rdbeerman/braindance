      if (grain > 0.0) {
        // Weighted by luminance so grain lives in the signal rather than lifting the empty
        // background, and quantised onto the reference grid so one grain cell is one 1080p
        // pixel wherever the frame is drawn.
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        float n = hash(floor(vUv * ref) + fract(time) * 137.0);
        col += (n - 0.5) * grain * 0.22 * (0.15 + lum);
      }

