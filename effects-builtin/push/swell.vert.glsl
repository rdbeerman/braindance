  // Radial rather than along the field's gradient, which is degenerate at the centre. The
  // guard is for the point landing exactly on the centre, where normalize hands back NaN.
  if (regionPush != 0.0 && rw > 0.0) {
    vec3 away = p0 - regionCentre;
    float d = length(away);
    if (d > 1e-4) pos += (away / d) * regionPush * rw;
  }

