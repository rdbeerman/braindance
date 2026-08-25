  // Positive hides what is inside the region, negative what is outside. Carried to the
  // fragment stage rather than culled here, because the edge is meant to be soft.
  vMask = (regionMask > 0.0
    ? 1.0 - regionMask * rw
    : 1.0 + regionMask * (1.0 - rw))
    * (outsideCrop ? cropOutside : 1.0);

