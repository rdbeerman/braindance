  // The volume rebuilt on a grid. Snapped in the levelled frame rather than the sensor's, so
  // the cells line up with the room instead of the bracket's angle. Getting back is the
  // transpose rather than inverse(), which holds only while modelMatrix is a pure rotation.
  if (lattice > 0.0) {
    mat3 level = mat3(modelMatrix);
    vec3 cell = floor((level * pos) / latticeCell + 0.5) * latticeCell;
    pos = mix(pos, transpose(level) * cell, lattice);
  }

