      // Light that got through the emulsion scatters off the film base behind it and comes
      // back to expose it a second time, so a bright area rings the things around it with a
      // red-orange glow. **The colour is the whole of what this term says, and it is the
      // thing the bloom in web/bloom-pass.js cannot say.** A halo out of that pass is the
      // highlight's own colour spread outward, so a cold window blooms cold; the same window
      // on film rings warm, because the base scatters whatever reached it and has no opinion
      // about what colour that was. So what is gathered below is a scalar - how far each tap
      // sits above the threshold - and every bit of the colour comes from the tint.
      //
      // It sits at 150, above the streak at 100 and below everything drawn over the picture,
      // and the placement is an argument rather than a free slot. The raster and the grain
      // are marks made on top of the picture and have nothing to scatter, which is why they
      // sit below this rather than above it.
      //
      // **No gather in this pass can see another effect's output, and that is the rule
      // rather than a fact about halation.** Every package filling g.body concatenates into
      // a single fragment shader that runs once per pixel, so a tap reaches a neighbour's
      // *input* and never a neighbour's *output* - a fragment has no way to read what the
      // same pass computed at some other pixel. Ordering decides what each effect does to
      // the pixel it owns, and no ordering can make a gather see work that has not been
      // written to a texture yet. An effect added here that samples its neighbourhood meets
      // this the moment it is written, so it is stated before the instance rather than
      // after it.
      //
      // **Halation is one instance and the streak is the other**, which is what says this is
      // the rule and not a placement somebody got wrong. Every tap below reads tDiffuse, the
      // immutable input to the whole grade pass, so what halation rings is the highlight as
      // the frame carried it *into* this pass and never the smear the streak drags across
      // it - the smear stays cold. The streak meets the same wall from the other side: its
      // own sixteen taps read tDiffuse too, and only its starting value comes from col.
      //
      // The correction is written down rather than made quietly, because this paragraph used
      // to argue the opposite. It said the streak's smear is light that reached the emulsion
      // so it scatters too, and that gathering before the streak ran would ring the highlight
      // while leaving the smear cold. That describes a build which gathers after the streak,
      // and no build here does.
      //
      // **The decision is made rather than pending.** Lifting the limit costs an
      // intermediate render target - the streak resolved into its own buffer and the grade
      // split into two passes - bought for a look nobody has reported; recomputing the
      // streak inside each tap is sixteen sixteen-tap gathers, 256 samples on every pixel of
      // every frame, for the same thing. Neither is worth ringing a smear, so the claim is
      // brought down to what ships and the order stays where the paragraph above puts it.
      //
      // Sixteen taps on a golden-angle disc, the distance taken as the square root of the
      // tap's share of the disc so the samples spread evenly over the area instead of
      // crowding the middle, and the offsets are in reference pixels through texel for the
      // reason the streak's are: a glow whose radius grew with the window would be the
      // nearly resolution-independent look that is worse than an honestly dependent one.
      //
      // **The normaliser is the sum of the distance weights and never the sum of the
      // luminance weights**, which is the one place this block could have been written to
      // divide by zero. Dividing by the summed excess would make the result the mean colour
      // of whatever was bright - and on a frame with nothing above the threshold, which is
      // most of a take shot in a dark room, that sum is exactly zero and the whole halo
      // comes out NaN in the one situation nobody is watching for it. Written this way the
      // denominator is a sum of sixteen positive numbers that depend only on the geometry,
      // so it cannot vanish at any radius, and a frame with no highlight in it contributes a
      // glow of zero rather than a hole.
      //
      // The same normalisation is why the radius widens the ring without dimming it: a
      // constant factor over every weight cancels top and bottom, so what the falloff
      // decides is the shape of the ring and not how much light is in it. That is a look
      // control behaving the way a person expects rather than the physics of a thicker base,
      // and it is deliberate - the amount is the term that says how much.
      //
      // Guarded on the master for the reason every package here is guarded on its own: a
      // build with this installed and the amount at zero has to draw exactly what a build
      // without it draws, which is what tools/effect-conformance-check.mjs takes the package
      // away to measure.
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
