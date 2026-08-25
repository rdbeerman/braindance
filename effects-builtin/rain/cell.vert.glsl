    // Counted in whole drops rather than wrapped, so the fragment stage reads brightness off
    // the fraction of one varying and the scramble off its integer.
    vRain = (rainPhase * rainSpeed + room.y) / rainSpan + hash(dot(wc.xz, vec2(269.5, 183.3)));
