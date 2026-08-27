        // The picture is pulled away from a line and what it leaves behind does not clear, so
        // every bright thing stretches into a vertical needle and the frame dissolves upward
        // and downward at once.
        if (mosh > 0.0) {
          // Which way this fragment is pulled. At splay 0 the whole frame drags one way; at 1 it
          // is pulled away from the line, which is what makes the picture streak up above it and
          // down below rather than sliding as one sheet. The ramp is smooth across the line
          // rather than a sign, or the two halves meet at a seam a pixel wide.
          float away = clamp((vUv.y - moshLine) * 8.0, -1.0, 1.0);
          float pull = mix(1.0, away, moshSplay);
          // Ragged rather than a clean stretch: neighbouring columns pull by different amounts,
          // which is the difference between a vertical zoom and a field of needles. A column is
          // a few reference pixels wide, so the raggedness is the same at any output size.
          float column = floor(vUv.x * ref.x / max(moshGrain, 1.0));
          float reach = moshReach * pull * (0.55 + 0.9 * hash(vec2(column, 3.7)));
          vec3 held = texture2D(tOld, vUv - vec2(0.0, reach * texel.y)).rgb * moshDecay;
          // Brightest wins rather than a blend, so a highlight leaves a needle and the dark
          // between the needles stays dark. A blend feeds the whole frame back into itself and
          // greys it over in about a second.
          col = mix(col, max(fresh, held), mosh);
        }
