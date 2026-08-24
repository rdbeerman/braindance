      // Light bleeds. Each pixel gathers back along the streak's own axis and keeps the
      // brightest thing it finds, decayed by how far it had to look, so a highlight smears
      // across the frame the way a sensor smears one down a column of wells. It sits here,
      // below the raster and the vignette and above the tonemap, because it is a thing that
      // happened to the light rather than a thing drawn over the picture: a streak applied
      // after the vignette would glow in the corners the vignette had just put out.
      //
      // **A gather and not a feedback buffer**, which is a decision rather than a
      // simplification. A buffer accumulating across frames smears along whatever the
      // camera did last, so an orbit would drag every streak sideways, and - the half that
      // settles it - a seek would arrive carrying the streak the scrub built rather than
      // the one playback would have built. That is the property the whole transport rests
      // on, broken by an effect nobody would think to test it against.
      //
      // Distances are in reference pixels through texel, for the reason stated at the top
      // of this shader: a streak whose length grew with the window would be the nearly
      // resolution-independent look that is worse than an honestly dependent one. The axis
      // is a *direction* in those same reference pixels rather than in uv, which is the
      // half that keeps the angle honest: the offset below is d reference pixels along the
      // axis whatever shape the window is, where a step taken in uv and scaled afterwards
      // would run at the aspect ratio's angle instead of the one the slider names, and
      // would swing as somebody dragged the window.
      //
      // **The tap schedule is written down because the first one was wrong.** Eight taps at
      // a geometric ratio of 2.1 put the far samples so far apart that they land as separate
      // ghosts - a comb rather than a smear. Sixteen at 1.35 overlap enough to read as
      // continuous and reach about 168 reference pixels.
      //
      // **The direction is the measurement and not the derivation, and the cost of getting
      // that backwards is recorded here because it was paid twice.** When this gather ran
      // one way only it was written with the plus, doubted against a busy frame that seemed
      // to show the light climbing, flipped to a minus, and then restored - because a build
      // cropped down to a single bright band with darkness above and below settles in one
      // look what a full frame full of structure will support either reading of. Two
      // separate readings of the *same* sign came out opposite. Nothing in the suite could
      // have caught the flip: every uniform still landed and every image still changed, so
      // the drop-one sweep stayed green through all of it.
      //
      // That sign is now a whole direction, and the lesson is the same one scaled up: the
      // arm in the registry check calibrates *both* screen axes off the crop's own faces
      // and asks where each angle's light actually lands, rather than deriving where it
      // ought to from which way uv grows - which is the derivation that was wrong the first
      // time. An angle of 0 keeps the fall this always had, and it keeps it exactly: at the
      // default axis the offset below renders bit-identical to the plain vertical vec2 it
      // replaces, measured at four looks and three drawing-buffer sizes, so there is no
      // guard here of the kind the raster below needs. Multiplying by an axis that is
      // exactly zero and exactly one introduces no rounding, where the raster's general
      // form is a dot product against a sum the compiler contracts differently.
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

