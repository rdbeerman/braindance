  // Torn bands flare cyan. Unconditional rather than guarded on vGlitch: a branch here
  // costs the compiler contractions on the lines around it and moved the picture.
  col += vec3(0.2, 0.9, 1.0) * vGlitch;

