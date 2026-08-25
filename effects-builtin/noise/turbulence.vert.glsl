  // Gated because it is the most expensive thing in this shader: eight hashes of three sines.
  float amp = noise + regionNoise * rw;
  if (amp > 0.0) {
    pos += amp * vnoise3(p0 * noiseScale + time * noiseSpeed * vec3(0.7, 1.13, 0.31));
  }

