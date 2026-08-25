  if (edges > 0.0) {
    // vEdge is the neighbour spread the vertex stage already computed for the
    // speckle test, so an edge-only reading costs a mix rather than a second pass.
    float e = pow(vEdge, 0.6);
    col = mix(col, mix(vec3(0.02, 0.03, 0.05), vec3(0.82, 0.94, 1.0), e), edges);
    alpha *= mix(1.0, 0.05 + 0.95 * e, edges);
  }

