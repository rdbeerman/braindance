      if (grain > 0.0) {
        // Weighted by luminance so grain lives in the signal instead of lifting
        // the empty background into a grey haze.
        //
        // Quantised onto the reference grid rather than sampled continuously, so
        // one grain cell is one 1080p pixel wherever the frame is drawn. Sampling
        // continuously would give four sub-pixels of a 2x render four unrelated
        // hash values that average to a quarter of the variance, which is exactly
        // the "grain grows finer as resolution rises" this reference exists to
        // stop. At 1080p it is the same one-value-per-pixel noise it always was,
        // off a different seed.
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        float n = hash(floor(vUv * ref) + fract(time) * 137.0);
        col += (n - 0.5) * grain * 0.22 * (0.15 + lum);
      }

