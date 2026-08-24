  // The duotone, and it is the governing tonal transform rather than a tint over one:
  // the near pole runs toward black and the far pole toward hot, so a single term
  // produces both the depth-keyed palette and the near-black silhouette against a
  // burning core. The note beside the uniforms has why those are one parameter.
  //
  // It sits here, after the blend, for the reason thermal and edges above it do - a term
  // written into one reading is inert in every other, and is then exercised only by
  // whichever sweep arm happens to select that reading. And it sits *before* the glitch
  // flare below rather than after it, which is a decision rather than an ordering
  // accident: a torn band is emitted light, so it belongs on top of the tonal transform
  // and not underneath one that would crush it back toward black.
  //
  // Read off t, the point's position inside the near/far clip range, so the split is a
  // place in the room the way the crop faces are and not a fraction of a frame. The split
  // is where the two poles meet and moving it decides which half of the room the subject
  // falls in.
  //
  // **How wide the ramp is either side of that is a distance rather than a share of the
  // box**, which is what duotoneSpan buys and why the division below exists. t is already
  // normalised by the clip range, so a ramp stated in t is a ramp whose metres change
  // every time a crop face moves - the grade would follow the framing, and shutting the
  // far plane to steepen the toning would be the only way to steepen it. Dividing the span
  // by the range converts metres back into t's units at the width the look asked for, and
  // the long note beside the uniform carries what that was measured to cost.
  //
  // Guarded, and the shape was measured rather than chosen. Both shapes are arithmetically
  // clean here, which is not obvious and is worth writing down: a mix at zero is a plus
  // zero times b minus a, which is exact whether or not the compiler contracts it, where
  // the mix at one this file guards elsewhere is the one that is not. So the question was
  // never the identity but what a branch does to the contractions either side of it, which
  // the flare below records going the surprising way. Measured here, guarded, against the
  // pinned pre-registry build: readRgb, readDepth, readContour and readBlackwall all came
  // back bit-identical over six frames, and readGhost reproduced its own pre-existing
  // failure unchanged - the same two frames, 2 and 3, and the same pair of hashes
  // 55d01311394e against 36fb79d8fa45. That last part was the half that mattered, because
  // a row already red is where a new perturbation would hide.
  //
  // **That standing failure has since been measured and it was never this file's.** The
  // two frames differed by one byte of 1,024,000, by exactly 1 - one channel of one
  // fragment landing the other side of a rounding boundary between two independently
  // compiled builds, which is the same contraction effect the flare below records rather
  // than a term. registry-check's section 1b compares pictures now, with the threshold
  // derived from that noise at one end and from ghost-alpha-term-dropped at the other,
  // no backticks in this comment on purpose - it sits inside the GLSL template literal,
  // and one here ends the shader. That is the seventh time in this repo,
  // which moves 187k bytes by 47. So the row is green at baseline and a re-measurement
  // like this one no longer has to reason around a red row while doing it.
  if (duotoneDepth > 0.0) {
    vec3 cold = hueSpin(vec3(0.020, 0.030, 0.075), duotoneHue);
    vec3 heat = hueSpin(vec3(1.000, 0.380, 0.120), duotoneHue);
    float w = duotoneSpan / max(0.001, farClip - nearClip);
    float k = smoothstep(duotoneSplit - w * 0.5, duotoneSplit + w * 0.5, t);
    // The motion half of the same transform, and it is the same two poles rather than a
    // second palette laid over them: depth decides where the room falls between cold and
    // hot, and this pushes whatever is moving through the room toward the hot end of it.
    // That is the reading the depth key on its own cannot draw - a subject and the wall
    // behind it are graded by where they stand, so a person walking through a scene is
    // exactly as cold as the air they walk through until something keys on the walking.
    //
    // Toward 1 rather than added to k, so a point at the hot end cannot be pushed past
    // it and the term has its room where the picture is near-black, which is where a
    // subject usually is. The far half of the room is already hot and has nothing to
    // gain, which is right: motion is only news against the pole it is not at.
    //
    // **1200 mm/s is the speed at which a point reaches the pole**, and it is baked for
    // the reason the two poles themselves are - a look parameterises how much of a ramp
    // it wants, not the ramp. It is about the axial speed of somebody walking straight
    // at the sensor at an ordinary pace, so the pole belongs to a person crossing the
    // room rather than to a hand. Measured over the sample capture: the 99th percentile
    // of a nearly-static stretch is 430 mm/s and the fastest sample in five pairs is
    // about 1900, while a take with somebody moving through it runs a median of 286 and
    // a 90th percentile of 1082.
    //
    // **The sensor's jitter is a displacement rather than a speed, so what it reads as
    // here depends on how fast the frames arrive**, and that is worth knowing before
    // trusting any threshold in these units. Measured on the same capture at two
    // spacings: the median sample moves about 4mm whichever pair you take, which is 31
    // mm/s across the 128ms pairs registry-check pins and about 140 mm/s across the
    // capture's own 32ms ones. Real movement is a fixed speed and reads the same at both,
    // so this estimator gets noisier as the link gets faster - which is a property of
    // measuring a rate from two adjacent samples and not something a constant fixes.
    //
    // No floor under it, and that is measured rather than assumed. A smoothstep has zero
    // derivative at the origin, which is most of the suppression on its own: on a wall
    // planted flat at 1100mm with this amount at 1 and the depth at 1, driven through the
    // editor at 1280 wide rather than through the check's own stage, mean red over the
    // frame goes 7.83 still, 7.90 with 4mm of jitter across a 128ms pair, 8.76 with the
    // same 4mm across a 32ms one, and 22.84 at a real 600 mm/s. So even at the frame rate
    // where the jitter
    // reads loudest it costs about one 8-bit step against fifteen for the signal. A floor
    // would have to be stated in one unit or the other and neither is right at both
    // spacings - in mm/s it would need re-tuning per link, which is what dividing by the
    // span exists to stop, and in millimetres it would let a slow surface register over a
    // slow link and vanish over a fast one.
    //
    // A duotoneMotion of 0 is exactly the picture this block drew before the term
    // existed. mix at zero is x times one plus y times zero, or x plus zero times the
    // difference, and both are exact whether or not the compiler contracts them - which
    // is the same arithmetic the guard comment above this block records measuring, and
    // it is measured again rather than inherited: the comparison is in registry-check's
    // planted-motion section, where a frame with a fast point in it and a frame with a
    // still one have to come back bit-identical while this sits at its default.
    k = mix(k, 1.0, duotoneMotion * smoothstep(0.0, 1200.0, vSpeed));
    col = mix(col, mix(cold, heat, k), duotoneDepth);
  }

