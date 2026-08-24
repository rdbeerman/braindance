  // Positive hides what is inside the region, negative what is outside. Carried to the
  // fragment stage rather than culled here, because the whole point of the falloff is
  // that the edge is soft.
  //
  // The crop's own dimming rides here rather than on a varying of its own, and it is
  // the same idea rather than a similar one: both are a boundary the vertex stage knows
  // about attenuating a fragment it cannot discard. A second varying would be a second
  // spelling of "how much is this point attenuated", and the two would then have to be
  // multiplied together somewhere anyway.
  vMask = (regionMask > 0.0
    ? 1.0 - regionMask * rw
    : 1.0 + regionMask * (1.0 - rw))
    * (outsideCrop ? cropOutside : 1.0);

