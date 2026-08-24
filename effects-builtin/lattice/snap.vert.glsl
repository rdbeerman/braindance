  // The volume rebuilt on a grid: every axis quantised to a cell, so surfaces break into
  // steps and the cloud reads as something a machine is reconstructing rather than
  // something that was measured. It sits last of the displacements, after the tear, so
  // what gets snapped is the position the point actually ends at - a lattice applied
  // before the turbulence would be smoothly pushed back off its own grid and buy nothing.
  //
  // **Snapped in the levelled frame and not the sensor's**, which is the whole of why this
  // is more than a rounding. The grid has to belong to the room: with a canted mount the
  // sensor frame is tilted, and a lattice cut along its axes would stand at whatever angle
  // the bracket happened to be at, so the floor would step diagonally. Levelling first
  // means the cells line up with the room, and a mount corrected afterwards does not
  // re-cut the grid.
  //
  // **The rotation is the model matrix three already hands this shader, not a second copy
  // of it.** The cloud carries the world tilt as its only transform, so mat3(modelMatrix)
  // is exactly the sensor-to-levelled rotation and cannot drift from it the way a uniform
  // derived beside it could. Getting back is the transpose rather than inverse(), which is
  // both cheaper and exact - but that identity holds only while the matrix stays a pure
  // rotation, so registry-check asserts the cloud carries no scale and no translation
  // rather than leaving it as a thing this comment claims.
  if (lattice > 0.0) {
    mat3 level = mat3(modelMatrix);
    vec3 cell = floor((level * pos) / latticeCell + 0.5) * latticeCell;
    pos = mix(pos, transpose(level) * cell, lattice);
  }

