  // Gated because it is the most expensive thing in this shader: eight hashes of three
  // sines each, against the six the old sine field cost. A look with no turbulence pays
  // none of it, which is the same bargain the ghost half of the geometry makes.
  float amp = noise + regionNoise * rw;
  if (amp > 0.0) {
    pos += amp * vnoise3(p0 * noiseScale + time * noiseSpeed * vec3(0.7, 1.13, 0.31));
  }

