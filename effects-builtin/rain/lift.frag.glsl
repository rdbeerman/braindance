  // vRain counts whole drops, so its fraction is how far above the last head this point
  // stands. The trail decays upward from the head, which is what reads as falling.
  float rainLift = 1.0 - smoothstep(0.0, rainTrail / rainSpan, fract(vRain));
  col *= 1.0 + rain * rainLift;

