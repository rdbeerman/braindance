  if (blackwall > 0.0) {
    // Blackwall: crimson volume, surfaces reading as containment rather than skin.
    // Depth discontinuities are where the wall "sees" you, so edges burn hottest.
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    vec3 deep = vec3(0.28, 0.010, 0.035);
    vec3 hot  = vec3(1.00, 0.115, 0.140);
    vec3 bw = mix(deep, hot, pow(1.0 - t, 1.6));

    float rim = pow(vEdge, 0.55);
    bw = mix(bw, vec3(0.95, 0.34, 0.22), rim * rimAmount);

    // A scan plane sweeping through depth, the ICE probing outward. Kept narrow
    // and tinted rather than white - a wide hot band reads as a light leak
    // dragging across the geometry instead of something scanning it.
    // The speed is a parameter and the spacing is not, deliberately: a scan plane is
    // one plane moving through the room, and how fast it travels is the thing that
    // reads as menace or as machinery. At 0 it stands still, which is a wall that has
    // stopped looking - and because it keyframes, it can stop and start.
    float sweep = fract(vDepth * 0.55 - time * blackwallSweep);
    float scan = smoothstep(0.988, 1.0, sweep);
    bw += vec3(0.10, 0.62, 0.78) * scan * blackwallScan;

    bw *= 0.55 + 0.75 * lum;

    // Shed points run hotter than the surface they left, so a wake reads as the
    // wall having noticed something rather than as leftover geometry.
    bw = mix(bw, vec3(1.00, 0.42, 0.20), vGhost * 0.55);

    col += bw * blackwall;
    alphaFactor += (0.30 + 0.70 * rim * rimAmount + 0.45 * scan * blackwallScan) * blackwall;
    readSum += blackwall;
  }
