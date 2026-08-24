  // Radial rather than along the field's gradient. The gradient of a rounded box is
  // degenerate at the centre - there is no outward direction there - and flattens
  // against the faces, where a radial push is defined everywhere and reads as a blob
  // swelling. The guard is for the point that lands exactly on the centre, where
  // normalize would hand back NaN and take the whole vertex with it.
  if (regionPush != 0.0 && rw > 0.0) {
    vec3 away = p0 - regionCentre;
    float d = length(away);
    if (d > 1e-4) pos += (away / d) * regionPush * rw;
  }

