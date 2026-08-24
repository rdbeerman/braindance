    // Counted in whole drops rather than wrapped into one, so that the fragment stage can
    // read both halves of the same number off one varying: the fraction is how far above
    // the last head this point sits, which is the brightness, and the integer is how many
    // heads have already gone past it, which is the scramble. Wrapping here would throw
    // the counter away and cost a second varying to get it back.
    //
    // Heads descend, so world height enters with the same sign program time does and a
    // point standing still watches the coordinate climb. One head every rainSpan metres
    // down each column rather than a single head wrapping over the whole room: a column
    // always has two or three running, where one head spends half its cycle below the
    // floor with the room dark behind it. The per-column offset is a hash of the cell's
    // own x and z, so neighbouring columns are out of step and the room does not pulse as
    // a single plane.
    vRain = (rainPhase * rainSpeed + room.y) / rainSpan + hash(dot(wc.xz, vec2(269.5, 183.3)));
