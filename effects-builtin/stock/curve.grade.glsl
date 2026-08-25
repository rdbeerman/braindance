      // The emulsion's own colour, keyed to exposure, and one parameter walks both poles
      // between a tungsten stock and a daylight one. At the tungsten end the shadows sit
      // cool and the highlights sit warm, which is most of what a colour negative balanced
      // for lamplight does to daylight before anybody grades it; at the daylight end the
      // whole frame sits warm instead, which is the same mismatch read the other way round.
      //
      // **This is not the duotone, and that deserves the paragraph because "why is this not
      // the duotone" is the first question a reader has.** The duotone is keyed to *depth*,
      // it replaces the colour outright between two poles, and it runs in the point program
      // in web/cloud-shader.js - so it decides what a point is coloured by, and it decides it
      // per point. This is keyed to *luminance*, it biases the colour that is already there
      // by a multiply, and it runs in the grade over the assembled frame - so a point, the
      // bloom halo around it and the halation ringing that halo are all toned together,
      // which nothing in the point program can reach. Two terms mixing toward two poles
      // would be the drifting twin this design keeps refusing if they keyed on the same
      // thing. They do not, and neither one can be written as the other.
      //
      // It sits at 350, after the grain at 300 and before the vignette at 400, and both
      // halves are an argument rather than a free slot. The curve is what the emulsion did
      // to the light and the grain is the emulsion's own texture, so the curve reads over
      // the grain it carries rather than the grain being laid over a stock it is part of.
      // And it sits before the vignette because the vignette is the lens: the emulsion saw
      // the picture through it rather than after it, so a corner the lens put out has to
      // come out of a frame this has already toned.
      //
      // The luminance is read with the same three weights the grain a step above uses, and
      // that is the one place this file could grow a second opinion about how bright a pixel
      // is. Two readings of that in one pass would drift apart the first time somebody tuned
      // one of them, and the grade would then have a shadow that the grain thinks is a
      // highlight.
      //
      // **The tint is divided by its own luminance, which is what makes the claim that this
      // moves colour and not exposure arithmetic rather than taste.** Four hand-tuned
      // triples can be checked for neutrality at the two balances and the two ends somebody
      // happened to look at, and every crossover between them is then a guess - so a stock
      // raised to 1 would quietly rebrighten the frame, and the operator would take the
      // exposure back down and lose the grade they were reaching for.
      //
      // **The pixel is normalised against its own luminance, and the correction is recorded
      // rather than made quietly, because the line that stood here divided the tint by the
      // tint's luminance and claimed the same property.** `col * tint / dot(tint, w)` is
      // luminance-preserving for a neutral grey and for nothing else: the outgoing luminance
      // is `dot(col * tint, w) / dot(tint, w)`, which collapses to `dot(col, w)` only when
      // every channel of `col` is the same number and the tint's own dot cancels. For a
      // saturated pixel it does not cancel at all. Worked through the shipped poles in
      // double precision - arithmetic over the literals two lines below rather than a
      // rendered measurement - the tungsten shadow pole took **pure red to 0.8599 of its
      // luminance and pure blue to 1.2793**, with the tungsten highlight pole running the
      // other way at 1.1139 and 0.8067; grey came back at exactly 1.0000 at all four poles,
      // which is how a claim this wrong survived being looked at. A saturated frame at
      // stock 1 therefore moved a quarter of a stop either side of where it started, which
      // is exposure wearing a colour control's clothes - the thing this paragraph has always
      // said the divisor was there to stop.
      //
      // So the tinted pixel is scaled back onto the luminance the pixel arrived with, which
      // is that claim written as arithmetic instead of asserted: `dot(tinted * lum /
      // dot(tinted, w), w)` is `lum` for every colour, not only for the neutrals.
      //
      // **The denominator cannot vanish, and the reason is the poles rather than a clamp.**
      // Every channel of every pole is strictly positive and sits within about a fifth of
      // unity, so for a frame whose channels are non-negative the tinted luminance is
      // bracketed between 0.82 and 1.22 times the original - it reaches zero only where the
      // original does, and there the factor is multiplying black. The grain a step above can
      // push a near-black pixel under zero, and it adds the same amount to all three
      // channels, so both readings cross together and the ratio stays inside that same band.
      // The guard is therefore on the magnitude rather than on the sign, and what it falls
      // back to is the unscaled tinted colour - which at a luminance that small is black on
      // either path.
      //
      // The poles themselves are baked rather than exposed, for the reason
      // effects-builtin/duotone/tone.frag.glsl states about its own two: a look
      // parameterises how much of a ramp it wants, not the ramp.
      //
      // **The balance is an axis and the two halves of it are not the same shape**, which is
      // the correction this pair carries rather than the design it was written with. The
      // daylight poles were first a gentler version of the tungsten ones - shadows still
      // biased blue, highlights still warm - and that is a parameter that runs from very cool
      // to slightly cool and never arrives anywhere. Graded side by side on a real take, a
      // frame at +1 read as a less blue version of the frame at -1 rather than as a different
      // stock, and the luminance neutralisation below correctly cancelled most of what warmth
      // was left. So the negative half is the shadow-cool, highlight-warm split a
      // tungsten-balanced stock shows in daylight, and the positive half is a warm cast over
      // the whole frame with the same crossover still in it - `stockSplit` and
      // `stockLatitude` go on deciding where the crossover falls and how wide it is, they
      // simply stop straddling a hue boundary once the balance is past neutral. That is the
      // control being useful across its whole range instead of across half of it.
      //
      // Guarded on the master, so a build with this installed and the amount at zero draws
      // exactly what a build without it draws - the property
      // tools/effect-conformance-check.mjs takes the package away to measure.
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
