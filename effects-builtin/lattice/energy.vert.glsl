  // Cancels what the lattice does to additive brightness: collapsing points onto cells breaks
  // the fragment stage's assumption that sources are spread at the sprite's scale. The min is
  // what keeps the factor exactly 1 at lattice 0 when the sprite is bigger than the cell.
  float spriteCells = vSize / cellPx;
  vCellNorm = max((1.0 - lattice) * (1.0 - lattice), min(1.0, spriteCells * spriteCells));

