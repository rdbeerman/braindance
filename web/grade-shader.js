// The core of the grade pass, and the joints the installed effects are spliced into.
//
// The same shape as `web/cloud-shader.js` one file over, and for the same three reasons.
// There is no arithmetic here, nothing is constructed and **nothing is imported**: what this
// file exports is source text in ordered segments, which `web/shader-assembly.js` joins with
// whatever the packages bring. Neither program interpolates anything - there is no `${}` in
// any segment - so the text below is exactly what the driver is handed.
//
// **It is a file of its own rather than a block inside `web/post-chain.js`, and the reason
// is the gate rather than tidiness.** `test/shader-assembly.test.mjs` assembles this spine
// under bare node - no page, no server, no GPU - and requires each chunk to reach the one
// program its filename names. `post-chain.js` imports three.js and three of its addons, so
// its bytes cannot be evaluated that way at all, and a spine living there would be a spine
// the gate could only read by parsing. The uniforms stay behind with the pass, because a
// `THREE.Vector2` default is a constructed object and this file constructs nothing.
//
// **What the split costs is the pairing**, the same obligation `web/cloud-shader.js` names:
// every `uniform` in the assembled program has to have a key in `GRADE_UNIFORMS` in
// `web/post-chain.js`, and nothing enforces that in either direction at runtime - three.js
// writes the keys it is given and reads zero for the rest. Measured across the split: 21
// distinct uniforms in the assembled program, 21 keys there, and the two sets are equal both
// ways - 8 declared in the segments below and 13 in the raster, streak, halation and stock
// packages' own declaration chunks. `test/cloud-shader.test.mjs` asks it of both programs
// separately, so a term arriving in a package is inside the question and a grade term that
// drifted into the point cloud's table is outside both.
//
// **Three joints, and the run they sit in is the pass's order.** The order of the terms
// below is the whole of this shader's opinion and is the same kind of decision the four
// `addPass` calls in `web/post-chain.js` are: the streak and the halation are things that
// happened to the light and sit above the tonemap, the raster and the grain are drawn over
// the picture, the stock is the colour of the emulsion carrying that grain, and the vignette
// closes the corners down before any of it is rolled off. Each chunk carries its own
// argument for where it sits.

// Each entry frozen as well as the list, for the reason the cloud's spine gives: the spine
// is read by the page's pass and by the gate, and a segment trimmed in place would move the
// look of one and the verdict of the other in the same breath.
const frozen = (entries) => Object.freeze(entries.map((e) => Object.freeze(e)));

export const gradeSpine = Object.freeze({
  // No joints at all, and that is a statement rather than an omission. A full-screen pass
  // draws one quad and every term this shader has is a function of where that quad's
  // fragments land, so there is nothing an effect could want to say up here - and a joint
  // offered to nobody is a name the assembler would have to keep meaning something.
  vertex: frozen([
    { text: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  ` },
  ]),
  fragment: frozen([
    { text: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float rgbSplit, scanlines, grain, vignette, crush, time;
` },
    // The terms an effect declares for this pass.
    //
    // **The line immediately above is a stay-behind and it is the awkward one.** Six terms
    // share one declaration - four of them a package's (`rgbSplit`, `scanlines`, `grain`,
    // `vignette`) and two of them core (`crush`, which is a sub-control inside the grade
    // rather than a term beside it, and `time`) - and splitting a comma-separated
    // declaration moves bytes, which is the one thing this whole split may not do. So four
    // packages have their master declared in the spine, and every package carrying terms
    // that line does not name declares them here - the raster's axis, pitch and hardness,
    // the streak's amount and axis, and the halation's and the stock's four each, masters
    // included, because a master added to the stay-behind line is that line rewritten. That
    // reads as an inconsistency and is a measurement: the alternative is a second
    // declaration stage wrapped around a fragment of one line, bought for four names that
    // cost nothing to leave where they are. The streak's own amount is here rather than
    // above only because that is where the monolith put it.
    { stage: 'g.decl' },
    { text: /* glsl */ `\
    uniform vec2 resolution;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      // The same 1080p reference the point pass in web/cloud-shader.js uses. Every term
      // here is sized in reference pixels rather than framebuffer ones, so the grade a
      // look was built at holds at any output size: without it the split narrows, the
      // scanlines crowd and the grain thins as resolution rises - a look that is
      // *nearly* resolution-independent, which is the kind you trust and then have
      // to debug. Bloom needs none of this and gets none, and by a different mechanism
      // rather than by no mechanism: its chain is frozen at a fixed reference height by
      // bloomChainSize in web/bloom-pass.js, because that pass bakes its tap count into
      // its shaders at construction and so has no term to express in these units.
      float k = resolution.y / 1080.0;
      vec2 ref = resolution / k;
      vec2 texel = 1.0 / ref;
      vec3 col;

` },
    // How the frame is read out of the buffer behind it, which is a replacement rather than
    // a stage: there is one `col` and one place it comes from, so a second chunk here would
    // be two reads of the same texture disagreeing about which one wins.
    //
    // **This is the one fallback in either spine that is not the shipped bytes**, and the
    // reason is where the monolith put the statement. It reads the buffer inside an `else`,
    // so the text it holds is indented for a block that exists only while the split is
    // installed - and an eight-space copy of it spliced at the top level would compile and
    // would be the only line in either program indented against its neighbours. So the
    // statement is the monolith's and the indent is this joint's.
    //
    // Nothing in the shipped build ever compiles it, exactly as `v.mask`'s fallback in the
    // cloud is never compiled, so it is proved by assembling rather than by being read.
    // Measured over four removal configurations: without rgbsplit the fetch is this line at
    // the surrounding indent, without any of the four body packages the run collapses to the
    // split and the tonemap, and with no grade package at all the whole shader is this line,
    // the Reinhard curve and the toe.
    {
      slot: 'g.fetch',
      fallback: /* glsl */ `\
      col = texture2D(tDiffuse, vUv).rgb;

`,
    },
    // Everything drawn over the picture or done to the light, in the order the pass runs
    // them: the streak at 100, the halation at 150, the raster at 200, the grain at 300, the
    // stock at 350 and the vignette at 400. A stage rather than a run of slots because these
    // compose - each one takes the colour the one above it produced and hands it on - and
    // because a build with none of them installed should be the tonemap alone rather than
    // six branches on six zeros.
    { stage: 'g.body' },
    { text: /* glsl */ `\
      // Roll highlights off per channel instead of letting additive accumulation
      // clip to flat white - hot areas keep their hue this way.
      col = col / (1.0 + col);
      // Then crush the toe back down: Reinhard lifts blacks, and this look needs
      // the empty space to stay genuinely black rather than dark red.
      //
      // The gain stays a literal while the toe becomes a parameter, and that asymmetry is
      // measured rather than lazy. The obvious reading - that 1.12 normalises the toe back
      // out and so should follow it - is wrong: a toe of 0.018 would normalise at 1.018,
      // so 1.12 is an independent graded lift that happens to sit near it. Tying the two
      // together would re-grade every look ever authored the moment anybody moved the toe,
      // which is a whole preset library drifting to buy a tidier-looking line.
      col = max(col - crush, 0.0) * 1.12;

      gl_FragColor = vec4(col, 1.0);
    }
  ` },
  ]),
});
