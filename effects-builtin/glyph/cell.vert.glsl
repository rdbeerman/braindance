    vCellSeed = hash(dot(wc, vec3(127.1, 311.7, 74.7)));
    // The tone key is where the cell sits in the clip range - the one cell-constant scalar,
    // so every occupant of a cell picks the same character. Third column of the rotation
    // dotted rather than a transpose, which holds while the transform is a pure rotation.
    vCellT = clamp((-dot(modelMatrix[2].xyz, wc * latticeCell) - nearClip)
      / max(0.001, farClip - nearClip), 0.0, 1.0);
