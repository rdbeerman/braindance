  // Torn bands flare cyan where the feed shears - and it sits here, after the blend,
  // for the reason thermal and edges two blocks up sit here. This line used to live
  // inside the Blackwall branch, which made it inert in the other four readings while
  // the displacement that earns it kept firing in all five: the geometry tore under
  // Colour and Depth and nothing lit up, so a slider that plainly worked in one reading
  // looked broken in the rest. Worse than inert, it was coupled to something nobody
  // asked it to be - the readings normalise by their weight sum, so a dissolve from
  // Blackwall into Depth dimmed the corruption on the way past and the flare rode the
  // colour crossfade.
  //
  // Moving it changes what the Blackwall preset draws, because inside the branch the
  // flare was multiplied by that reading's 0.55 + 0.75 * lum shading before the
  // normalisation reached it. glitchTint was given a default of 1.8 to absorb that,
  // rather than carrying 3.0 over, on the grounds that a term reconstructing the old
  // inside-the-branch arithmetic would be a second implementation of this line.
  //
  // **That default is worse than the literal it replaced, measured on the reading the
  // shipped preset actually uses.** Against the pinned build on readBlackwall at the
  // shipped glitch of 0.18: 1.8 lands 30 of 255 off at worst with a frame mean of 0.0391,
  // where 3.0 lands 5 off with a mean of 0.0062, and 0 and 5.0 are worse than either. No
  // constant can match exactly, because the multiplier it is standing in for varied per
  // fragment - but the ordering is not close, and the number was chosen without this
  // comparison being run. Colour only, no alpha term: that is what the
  // old line did, and an additive splat shows a brighter colour without being asked to
  // cover more.
  //
  // Unconditional, and the missing guard on vGlitch is a measurement rather than an
  // oversight. Guarded, this line reddened three of registry-check's five reading rows
  // against the pinned pre-readings build - readDepth and readContour at frame 4 and
  // readBlackwall at frames 0 and 1 - at parameter defaults, where glitch is 0 and the
  // guard means the add never runs at all. Nothing mathematical moved: adding zero is
  // exact, and the branch was never taken. What moved was the code around it, because a
  // branch dropped into the common path costs the compiler contractions it was making
  // across the lines either side. Written straight through, all five rows are bit-identical
  // again and only the pre-existing readGhost failure remains. So the cost of a fragment
  // being able to skip a multiply-add it does not need is three false regressions in a
  // check with no tolerance and no way to re-baseline, and the multiply-add is cheaper.
  //
  // **The readGhost failure named above was the same effect as the three, and it has since
  // been measured rather than lived with**: one byte of 1,024,000 differing by exactly 1,
  // which is one fragment rounding the other way between two independently compiled
  // builds. Section 1b compares pictures now, so "a check with no tolerance" is no longer
  // the situation - but the conclusion above stands unchanged, because a tolerance sized
  // to admit one byte at one step admits nothing like the three regressions that
  // paragraph is about, and writing the multiply-add straight through is still cheaper
  // than reasoning about what a branch did to the contractions around it.
  col += vec3(0.2, 0.9, 1.0) * vGlitch;

