  // **What the lattice does to additive brightness, cancelled here rather than in the
  // fragment stage.** The normalisation down there divides a splat's alpha by its own area,
  // on the assumption that sources are spread at the sprite's scale - and the lattice
  // breaks that assumption by collapsing them onto cells. Pulling points a fraction L of
  // the way to their cell centre leaves a cluster spanning cell * (1 - L), so brightness
  // runs up as one over that squared until the cluster is smaller than the sprite, after
  // which it saturates at the fully coincident case. voxel.json has been in exactly that
  // state since it shipped: lattice 0.55, additive on, and a pointSize of 6.5 well under
  // its 3.5cm cell.
  //
  // **It is computed here because two of the three things it needs do not exist in the
  // fragment stage.** The view distance and the projection are vertex-stage quantities, so
  // the design document's single fragment-stage expression cannot be written where it puts
  // it; crossing the finished factor is one varying where crossing its inputs would be
  // three, and it puts the arithmetic where its inputs are. vSize is the sprite that was
  // actually rasterised - taken after both clamps - so wherever the ceiling bites,
  // brightness stays correct and only the tiling degrades.
  //
  // **The min bounding the sprite term is a correction to the document and not a
  // transcription of it.** As written there the factor is max((1-L)^2, (sprite/cell)^2),
  // which at lattice 0 is 1 only while the sprite is no bigger than the cell - and
  // pointSize reaches 64 against a cell that bottoms out at 5mm, so the region where it
  // exceeds 1 is reachable through the sliders and the factor would then *brighten*, in
  // contradiction of the document's own "exactly 1 at lattice 0". Bounded, it is exactly 1
  // at lattice 0, exactly (sprite/cell)^2 at lattice 1, and exactly 1 again at full glyph
  // where the sprite *is* the cell - which is the property that makes the compensation and
  // the glyph field not interact at all at full strength.
  //
  // Straight through with no guard, following the flare's measurement in the fragment
  // stage: multiplying by the computed 1.0 is exact in IEEE, where a branch dropped into a
  // common path costs the compiler contractions across the lines either side of it.
  float spriteCells = vSize / cellPx;
  vCellNorm = max((1.0 - lattice) * (1.0 - lattice), min(1.0, spriteCells * spriteCells));

