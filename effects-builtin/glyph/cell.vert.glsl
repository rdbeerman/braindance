    vCellSeed = hash(dot(wc, vec3(127.1, 311.7, 74.7)));
    // **Where the cell sits in the clip range, which is the tone key's whole input and is
    // computed here because it is the only place a per-cell quantity can be computed at
    // all.** The key used to read `dot(col, w)` down in the fragment stage - the luminance
    // of the colour the point was about to draw - and the chunk there argued that nothing
    // was lost by deciding the character beside the colour, because the seed and the rain
    // coordinate are constant across a sprite. That is true of those two and it was never
    // true of tone. A sprite is one point, and a *cell* is many: with the lattice collapsing
    // a few hundred depth texels onto one cell, every occupant computed its own luminance,
    // chose its own character out of the table, and drew it at the same snapped position as
    // its neighbours - summed into noise under additive blending and z-fighting at an
    // identical depth without it. presets-builtin/cascade.json ships in exactly that state:
    // lattice 1, additive on, glyph.tone 0.3.
    //
    // **There is no cell-constant reading of the drawn colour, and that is a fact about the
    // architecture rather than a thing left undone.** `col` is the five-reading blend plus
    // the whole f.tone run, and inside one cell it still varies through vUv, through vDepth
    // - which is the raw sample depth and not the snapped one - and through vEdge, vGhost
    // and the rain's own lift, which keys on room.y and so moves within a cell. Getting one
    // number out of that would mean either evaluating the colour a second time on
    // cell-constant inputs, which is a second implementation of the colour, or a reduction
    // over each cell's occupants, which is a second pass. Both are refused here for the same
    // reason everything else in this repo is.
    //
    // So the key reads the one cell-constant scalar the picture is actually built on: where
    // the cell stands between the clip planes. It is a function of wc and the uniforms and
    // of nothing else, so every occupant of a cell computes the same number by construction
    // rather than by agreement - which is the property the thinning row in
    // tools/registry-check.mjs claims and, with tone at 0 in its own fixture, could not see.
    // **What it costs is that the key is no longer a luminance**, and the two candidates
    // that are one were measured and are worse: the depth ramp's own luminance is not
    // monotone in its argument - 0.1086, 0.5564, 0.7874 then back to 0.5051 across the four
    // stops in web/cloud-shader.js - so a tone ramp built on it would fold over at the top
    // and never reach the dense end the 63/64 scaling below exists to land on; and the
    // camera's luminance along the ray through the cell centre goes flat the moment colour
    // is switched off at the sensor, which is a slider that moves and a keyframe that plays
    // back against nothing.
    //
    // **So the key reads where the cell is and not what colour it draws, and how close those
    // two are depends on which reading is up.** That limit is named here rather than left to
    // be discovered, because a parameter whose meaning quietly changes with the look is the
    // drift this design keeps refusing. It is *exact* for presets-builtin/cascade.json, the
    // only shipped look carrying this field: cascade is readDepth 1, so its colour is
    // depthRamp(1 - t) and the argument that ramp is read at is precisely what this key now
    // carries - the key was already a function of the clip position there, through a lookup
    // that only bent it. It diverges wherever the colour is built from something else, and
    // furthest under readRgb, where brightness is the camera's and has nothing to do with
    // range: a white shirt and the black wall behind it sit at one depth, so they take one
    // character where the old per-point key gave them two.
    //
    // The cell centre carried back out of the levelled frame is the third column of the
    // rotation dotted with it, rather than a whole transpose whose other two components
    // would be thrown away - and it is a column rather than a row because that identity
    // holds only while the cloud's transform is a pure rotation, which is the same premise
    // the snap in effects-builtin/lattice/ rests on and which registry-check asserts.
    // Negated because unproject builds the scene looking down -z while vDepth is metres out
    // in front of the sensor.
    vCellT = clamp((-dot(modelMatrix[2].xyz, wc * latticeCell) - nearClip)
      / max(0.001, farClip - nearClip), 0.0, 1.0);
