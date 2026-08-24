// The core of the two programs a depth sample is drawn by, and the joints the installed
// effects are spliced into.
//
// There is no arithmetic here, nothing is constructed and nothing is imported: what this
// file exports is source text, in ordered segments, and `web/shader-assembly.js` joins
// those segments to whatever the effect packages bring to produce the two strings three.js
// is handed. Neither program interpolates anything - there is no `${}` in any segment -
// so the text below is exactly what the driver is handed, and it stays that way: a shader
// that needs a value from JavaScript takes it as a uniform, which is the boundary the
// uniform block is for and the reason any of this could move at all.
//
// **The text did not change when the joints arrived, and that is measured rather than
// intended.** `test/shader-assembly.test.mjs` assembles this spine against the shipped
// packages read off disk and asserts the two strings equal the two literals this file used
// to hold, taken out of the last revision carrying them - so an edit here that moves a byte
// is a red row naming which program moved, and a chunk file edited by one byte is the
// control beside it. Until an effect actually differs from what the monolith drew, "the
// look is unchanged" is a thing a check says rather than a thing a commit message claims.
//
// **A joint is one of four kinds, and `web/shader-assembly.js` carries what each is for.**
// A `stage` takes any number of chunks in declared order, a `slot` takes one and carries
// the text to use when nothing claims it, a `service` is a value this file computes under a
// gate its consumers generate - filling it is `cell`'s arrangement and not `region`'s - and a
// `varyings` entry is generated from the packages' own declarations.
// The comments below say why each joint is where it is, because a cut through a shader is
// a claim about what belongs to an effect and what belongs to every point in the frame -
// and the second class is the one that goes wrong quietly.
//
// **What the split costs is the pairing, and it is worth naming here rather than being
// discovered.** Every `uniform` in the assembled programs has to have a key in the
// `uniforms` object in `web/point-cloud.js`, and nothing enforces that in either
// direction. A uniform with no key is silent: three.js simply never writes it, the shader
// reads zero, and the look is subtly wrong with nothing on the console. A key with no
// uniform is dead weight that costs a slider's write on every frame it is animated.
// Measured across the split: 86 distinct uniforms in the assembled pair, 86 keys there,
// and the two sets are equal both ways - 77 of them declared in the segments below and 9
// in the glyph and rain packages' own declaration chunks. That equality is a fact about
// today rather than something this file can hold, so a term added to one side belongs in
// the same commit as the other, and `test/cloud-shader.test.mjs` asks it of the assembled
// text rather than of this file, which is what keeps a uniform arriving in a package
// inside the question.

// Each entry frozen as well as the list, because the spine is read by two callers that
// share one object - the page's material and the gate - and a segment somebody trimmed in
// place would move the look of one and the verdict of the other in the same breath.
const frozen = (entries) => Object.freeze(entries.map((e) => Object.freeze(e)));

export const cloudSpine = Object.freeze({
  vertex: frozen([
    { text: /* glsl */ `\

precision highp float;
precision highp usampler2D;

uniform usampler2D depthPrev, depthCurr;
uniform sampler2D stateTex;
uniform vec2 focal, center, resolution;
uniform float bufferHeight;
// What this hardware will actually rasterise a point sprite at, which is a bound rather
// than a look value and so is not a registry parameter: it has no default anybody chose,
// it cannot be keyframed into anything, and a preset naming it would be a document
// carrying one machine's limit to another. Written once at boot out of
// ALIASED_POINT_SIZE_RANGE in web/main.js, beside the point cloud it is built with,
// rather than in resize() where bufferHeight is written - the range is a property of
// the context and does not change when the window does. The table's own default is the
// old literal 64, so a build that somehow reached a frame before that write draws what
// the shipped clamp always drew.
uniform float pointCeiling;
uniform float pointSize, nearClip, farClip, time, edgeTol;
uniform float cropL, cropR, cropB, cropT, cropOn, cropOutside;
uniform float noise, noiseScale, noiseSpeed;
uniform float lattice, latticeCell;
` },
    // The uniforms an effect declares for this stage, above the region's block because
    // that is where the two that use it were written. A package adds its own `uniform`
    // lines here and nothing else: a term that needs a value from the registry needs a
    // cell to read it out of, and this is where the cell is named.
    { stage: 'v.decl' },
    { text: /* glsl */ `\
uniform vec3 regionCentre, regionHalf;
uniform float regionRound, regionSoft, regionPush, regionNoise, regionMask;
uniform float ripple, rippleFreq, rippleSpeed;
uniform float mixT, spanSec, snapDelta, glitch;
uniform float glitchDensity, glitchShove, glitchTint, glitchBands, glitchRate, glitchAxis;
uniform float fadeTime, wakeTime, sinceFrameSec;
uniform int denoise, interpolate;

in float aSlot;

out vec2 vUv;
out float vDepth;
out float vEdge;
out float vGlitch;
out float vSize;
out float vLegiblePx;
out float vGhost;
out float vFade;
out float vMask;
out float vSpeed;
` },
    // The channels an effect carries to the fragment stage, declared from the packages'
    // `varyings` rather than written out, so this `out` and the `in` far below cannot
    // come apart. `vCellNorm` is deliberately not one of them: the fragment stage multiplies
    // every additive splat's alpha by it whatever is installed, so the declaration and the
    // inert 1.0 belong to every point in the frame. Only the write is an effect's, and it
    // arrives through the `v.cellNorm` slot below rather than through a varying of its own -
    // a package declaring it here would emit a second `out` beside the one this line covers.
    { varyings: 'out' },
    { text: /* glsl */ `\
out float vCellNorm;

float depthAt(usampler2D tex, ivec2 p) {
  return float(texelFetch(tex, p, 0).r);
}

float hash(float n) { return fract(sin(n) * 43758.5453123); }

// Three decorrelated hashes of one lattice corner, so a vector of noise costs one
// trilinear blend rather than three of them.
vec3 vhash3(vec3 p) {
  vec3 q = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(q) * 43758.5453123);
}

// Value noise rather than gradient noise: it is eight hashes against twelve and a
// dot product, and the difference between the two is a lattice-aligned bias that
// shows when you colour with it and not when you displace points by it. Returns
// [-1, 1] per axis.
vec3 vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(vhash3(i + vec3(0.0, 0.0, 0.0)), vhash3(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(vhash3(i + vec3(0.0, 1.0, 0.0)), vhash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(vhash3(i + vec3(0.0, 0.0, 1.0)), vhash3(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(vhash3(i + vec3(0.0, 1.0, 1.0)), vhash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z) * 2.0 - 1.0;
}

// One rounded box covers every shape the region needs to be. Half-extents at zero
// with a radius is a sphere, large half-extents with a small radius is a box, two
// components at zero is a capsule, one large is a slab - and because those are all
// reached by moving continuous sliders, each keyframes and each morphs into the
// next, where a shape *enum* could not be a registry parameter at all.
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// 1 inside the surface, ramping to 0 at regionSoft beyond it. Deep inside, the
// falloff width cannot matter, which is why a probe for regionSoft has to sit in
// the shell rather than anywhere convenient.
float regionWeight(vec3 p) {
  float sd = sdRoundBox(p - regionCentre, regionHalf, regionRound);
  return 1.0 - smoothstep(0.0, max(1e-4, regionSoft), sd);
}

// libfreenect2's pinhole model, with the single deliberate departure from
// Registration::getPointXYZ this build makes. Image y grows downward, so it is flipped
// into the right-handed scene here.
//
// **x is negated because the frames arrive mirrored, and upstream's formula does not
// undo it.** libfreenect2 hands out depth, IR and colour horizontally flipped on
// purpose, to match the Microsoft SDK's selfie-view convention. Microsoft pairs that
// mirrored image with a camera space whose x grows to the sensor's *left*, so their
// cloud comes out chirally correct; getPointXYZ pairs the same mirrored image with an x
// that grows right, so a faithful port of it renders the room reflected. This was a
// faithful port of it from the first commit, and the symptom is that a raised right hand
// appears on the right of the picture where a passport photo would put it on the left.
// What settled it was not the cloud but the colour camera's own 1920x1080 frame off
// /camera.mjpg: the branded text on a subject's shirt reads only after one horizontal
// flip, and that JPEG carries a JFIF APP0 marker and no EXIF segment at all, so there is
// no orientation tag anything downstream could have been applying.
//
// **The correction is one sign, and cx is deliberately not rebased with it.** The true
// column of a mirrored pixel is W - (col + 0.5) and the true principal point is W - cx,
// so the difference is (W - col - 0.5) - (W - cx), the grid width cancels, and what is
// left is exactly -(col + 0.5 - cx). Rebasing cx as well would double-count the flip and
// translate the whole cloud by the principal point's offset from centre - 1.8px here,
// which is small enough to read as noise rather than as a bug.
//
// **Flipping the texture instead, or as well, would be wrong.** The texel lookup is what
// pairs a point with its registered colour, and that colour arrives mirrored in exactly
// the same way the depth does; mirroring the sampling would either re-mirror the picture
// or peel the colour off the geometry. The geometry moves here and the sampling does not.
vec3 unproject(vec2 pixel, float z) {
  return vec3(
    -(pixel.x + 0.5 - center.x) / focal.x * z,
    -(pixel.y + 0.5 - center.y) / focal.y * z,
    -z
  );
}

void main() {
  ivec2 px = ivec2(position.xy);

  // Age advances continuously between arrivals, so a 30fps stream still fades on
  // a 120Hz display instead of stepping once per frame.
  vec4 st = texelFetch(stateTex, px, 0);
  float age = st.g + sinceFrameSec;

  float z;
  vEdge = 0.0;
  vGhost = 0.0;
  vFade = 1.0;
  // Written before the branch rather than inside it, which is the same rule the three
  // above follow and which matters more here than it looks. There are three early
  // returns below this line and a whole branch - the ghost - that never touches either
  // depth texture, so a varying only written on the live path is undefined everywhere
  // else, and undefined in a shader is whatever the last invocation left in the
  // register. A shed point would come out carrying the speed of whichever live point
  // shared its warp.
  vSpeed = 0.0;
  // The glyph field's three, initialised here under exactly the rule above rather than
  // where they are computed, which is hundreds of lines below the early returns.
  //
  // **What leaves them unwritten is the gate and not the ghost**, and the correction is
  // recorded rather than quietly made, because the wrong reason stood here for a while and
  // reads as authoritative. This paragraph used to say a ghost never reaches the cell
  // arithmetic. A *live* ghost reaches it exactly the way a live point does - it falls
  // through the same lines - and a dead one leaves at the early return above with a point
  // size of zero, so it rasterises nothing and could not draw a wrong character if it
  // wanted to. What actually skips the block is the block's own guard: it is gated on the
  // two masters together, so at every look drawing no characters and no rain - which is
  // nine of the ten shipped ones - nothing down there runs at all. The fragment stage
  // still takes the fraction of vRain on every fragment, unguarded and deliberately so,
  // and a rain
  // of 0 is no protection: the multiplier that makes the term inert is applied to the
  // result, and zero times whatever an undefined register holds is not reliably zero.
  //
  // The identity each one is initialised to is the value that makes its consumer inert:
  // seed and rain at zero name the first character and the top of a drop, and the cell
  // normalisation at one is a multiply that changes no alpha. That third one is written
  // unconditionally further down rather than under a gate, so what its initialisation
  // covers is the early returns alone.
` },
    // The same declarations again as the value that makes each consumer inert, and this
    // is the half that has to sit here rather than where the varyings are computed. There
    // are three early returns above this line and a whole branch - the ghost - that never
    // reaches the block below, so a varying only written on the live path is undefined
    // everywhere else, and undefined in a shader is whatever the last invocation left in
    // the register.
    { varyings: 'init' },
    { text: /* glsl */ `\
  vCellNorm = 1.0;

  if (aSlot > 0.5) {
    // The ghost: what the ray used to be looking at. A hard swap earns a longer
    // wake than a soft one, which is what keeps a static scene from shedding.
    float life = fadeTime + wakeTime * st.b;
    if (st.r <= 0.0 || life <= 0.0 || age >= life) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float k = 1.0 - age / life;
    vGhost = st.b;
    vFade = k * k; // eased so it thins out rather than stepping off
    z = st.r * 0.001;
    // vEdge stays 0: it drives the rim term, and a shed point burning at full rim
    // is the white blowout this look already had to be pulled back from once.
  } else {
    float mmC = depthAt(depthCurr, px);

    // Early-out before the neighbour fetches: a large share of the frame is empty,
    // and those pixels are culled regardless of what their neighbours say.
    if (mmC <= 0.0) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    // The same ray one frame ago, and it is fetched here rather than inside the blend
    // below because two things read it now and only one of them is optional. It used to
    // live under the interpolation switch, which is where it belonged while the blend
    // was its only reader - and leaving it there would have made the speed die silently
    // the moment anybody turned interpolation off, which is exactly the arrangement
    // registry-check's scrambled set runs in.
    float mmP = depthAt(depthPrev, px);

    // **One discontinuity test, read by both.** Lerping across a depth discontinuity
    // smears a point through empty space for the whole inter-frame interval, and
    // measuring a speed across one is the same mistake wearing a worse consequence: the
    // two samples are different surfaces arriving on the same ray, so the difference
    // between them is the distance from a subject to the wall behind it rather than
    // anything that moved. A silhouette would burn on every frame.
    //
    // That the gate really is finding surfaces rather than fast motion was measured on
    // the six frames registry-check pins, at the default 250mm: of the samples it
    // rejects, 28.8% sit at a depth edge - a four-neighbour spread past the shipped
    // edgeTol - against 0.37% of the ones it keeps, which is a factor of 78. There are
    // only 52 of them in five pairs, because the fixture is nearly static, and the
    // ratio rather than the count is the reading.
    //
    // A zero sample is the other half of the same test and is not a jump from the
    // sensor to the origin: it means no prior measurement on this ray, so a point that
    // has just come into view has no speed rather than an enormous one.
    bool paired = mmP > 0.0 && abs(mmC - mmP) < snapDelta;

    float mm = mmC;
    if (interpolate == 1 && paired) mm = mix(mmP, mmC, mixT);

    // Axial speed, in millimetres per second, and **the division by the pair's own gap
    // is the whole of what makes it a property of the room rather than of the link.**
    // A build handing the raw per-frame difference on looks completely correct until
    // the frame rate changes: over a degraded link every speed in the scene reads low
    // by whatever the link lost, so a look graded at 30fps grades differently at 9, and
    // no picture comparison taken at one rate can see it.
    //
    // What the pair can express is bounded by the gate above it, at snapDelta over the
    // gap - 7500 mm/s at the default 250mm and a 30fps stream, 1953 mm/s over the
    // 128ms pairs the pinned fixture is built from. Anything keyed on this has to sit
    // under the slower of those or the top of its ramp is a place no footage reaches.
    vSpeed = paired ? abs(mmC - mmP) / spanSec : 0.0;

    z = mm * 0.001;

    // Neighbour spread doubles as a speckle test and an edge signal: isolated
    // points from dropped USB packets have no depth-consistent neighbours.
    float maxDiff = 0.0;
    int valid = 0;
    for (int i = 0; i < 4; i++) {
      ivec2 o = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
      ivec2 q = clamp(px + o, ivec2(0), ivec2(resolution) - 1);
      float n = depthAt(depthCurr, q);
      if (n > 0.0) {
        valid++;
        maxDiff = max(maxDiff, abs(n - mmC));
      }
    }
    vEdge = clamp(maxDiff / edgeTol, 0.0, 1.0);

    bool speckle = denoise == 1 && (valid < 3 || maxDiff > edgeTol * 3.0);
    if (speckle) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    // Born points ramp in over the same window their predecessor fades out.
    vFade = fadeTime > 0.0 ? clamp(age / fadeTime, 0.0, 1.0) : 1.0;
  }

  // **One question asked in two places, because half of it needs the unprojection and
  // half of it cannot wait for it.** The depth pair is a property of the sample and is
  // known here; the lateral four are positions in the room and are not known until
  // below. So outsideCrop accumulates rather than being decided once, and everything
  // downstream reads the accumulated answer instead of re-testing a face.
  //
  // The early return survives, and it is what keeps the box free when nobody is looking
  // at it: with cropOutside at zero this is the same hard cull the shader has always
  // done, and the far half of a room never reaches the unprojection or the region weight
  // below it. Only a viewer with the box on screen pays for keeping cut points alive, and
  // no exported frame ever does.
  //
  // **What that viewer pays is large in proportion and small in the budget**, which is
  // not obvious either way and so was measured rather than argued: 0.285ms per draft
  // rises to 0.518ms, up 82%, on a box tight enough to cut most of the room. The
  // proportion is that big because the cull it replaces is the cheapest exit in this
  // shader - almost every point was leaving at the depth test and now runs the whole
  // vertex stage - and 0.23ms is still under a hundredth of a 30fps frame. See
  // docs/performance.md for the method.
  bool outsideCrop = cropOn == 1.0 && (z < nearClip || z > farClip);
  if (outsideCrop && cropOutside <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec3 pos = unproject(position.xy, z);

  // The other four faces of the same box, and they have to come after the
  // unprojection because a lateral plane is a position in the room where the depth
  // clip is a property of the sample. Metres, so a face stays where it was put
  // whatever the output size is - the crop is a place a subject stood, not a
  // fraction of a frame, and a wedge that widened with depth would take the wall
  // behind the subject along with the subject's elbow.
  //
  // Tested on the undisplaced position, for the reason the region gives below: a
  // boundary read after turbulence lets points wander across it, and the edge
  // crawls along itself as the noise rises rather than holding still.
  if (cropOn == 1.0 && (pos.x < cropL || pos.x > cropR || pos.y < cropB || pos.y > cropT)) {
    if (cropOutside <= 0.0) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    outsideCrop = true;
  }

  // The region is read at the *undisplaced* position, and both things below use this
  // rather than the running pos. A region is a place in the room where the subject
  // stood, so its boundary has to stay put when turbulence is raised - evaluated on
  // the displaced position instead, a mask's edge would crawl along itself as the
  // noise pushed points across it, which reads as the mask being broken rather than
  // as the cloud moving.
  vec3 p0 = pos;
  //
  // **The gate names every effect that reads it, and a term added without joining this
  // list is inert rather than broken** - which is the worse failure, because its slider
  // moves, its uniform lands and its keyframes play back against a weight frozen at zero.
  // The operators are not uniform on purpose: regionNoise and ripple cannot go negative
  // and are tested against zero, where regionPush and regionMask run from -1 and would be
  // switched off across half their travel by the same test.
` },
    // The region weight, computed once for everything that reads it, under a gate that is
    // the four consumers' own `when` clauses rather than a list kept here. The comment
    // above is the one the monolith carried and it is left exactly as it was, because the
    // property it insists on - that a term reading this weight without joining the gate is
    // inert rather than broken - is now true by construction instead of by attention: a
    // package that consumes this service gets its term, and one that forgets to consume it
    // has no chunk in the program either.
    //
    // **This one closes nothing, which is the whole difference from `cell` below.** `rw` is
    // a value at the surrounding scope and the four displacements that read it sit in the
    // stage and the slot underneath, so there is no block for a consumer's chunk to go
    // inside - the gate is a conditional expression and its consumers are placed by name.
    // The operators are the consumers' own and are deliberately not uniform, for the reason
    // the comment above gives: two of the four run from -1.
    {
      service: 'region',
      open: '  float rw = (',
      body: /* glsl */ `\
)
    ? regionWeight(p0)
    : 0.0;
`,
      close: '',
    },
    { text: /* glsl */ `\

  // Which cell of the room this point belongs to, and where it stands in the falling
  // pattern. Both are read at the *undisplaced* position for the reason the region above
  // is, and the consequence here is sharper than a crawling edge: a character's identity
  // has to be a fact about the room, so that turbulence pushes points through a field of
  // characters that stay where they are. Hashed off the running pos instead, the whole
  // field boils the moment noise, the ripple or the region push leaves zero - and with all
  // of them at zero, which is where a drop-one sweep leaves them, the picture is
  // bit-identical to the correct one.
  //
  // **The grid is the lattice's own and there is deliberately not a second one.**
  // latticeCell already names the cube the room is cut into, and a glyph field carrying
  // a cell size of its own would be two independent world-cell quantisers in one shader
  // with nothing holding their reasoning together. It is read here whatever lattice
  // itself is, because the rain rides these same columns and works over round splats, so
  // this cannot sit inside the snap's own guard.
  //
  // mat3(modelMatrix) rather than a rotation derived beside it, for the reason the snap
  // below gives at length: the cloud carries the world tilt as its only transform, so this
  // is exactly the sensor-to-levelled rotation and cannot come apart from the one the snap
  // uses. Gated on the two masters together because neither consumer exists below them and
  // the block is a mat3 multiply and two hashes on every point in the frame.
` },
    // Which cell of the room this point fell in, computed once for everything that keys
    // on the lattice's own grid. The gate is generated from the `when` of every consumer
    // rather than written out, which is the property that makes it right by construction:
    // a build with neither consumer installed does not pay a mat3 multiply and two hashes
    // on every point in the frame, and a build with one pays for one. The body is the
    // room-space position and the cell index, because those are what "which cell" means
    // and every consumer needs both.
    {
      service: 'cell',
      open: '  if (',
      body: /* glsl */ `\
) {
    vec3 room = mat3(modelMatrix) * p0;
    vec3 wc = floor(room / latticeCell + 0.5);
`,
      close: '  }\n',
    },
    // The blank line between the cell's block and the displacement run belongs to neither,
    // which is why it is a segment of its own rather than the tail of one joint or the head
    // of the next. Written into the cell's `close` it would vanish with the glyph field;
    // written into the turbulence chunk it would arrive a second time behind the push.
    { text: '\n' },
    // The displacements the region weight drives, in the order the file held them:
    // turbulence, then the push, then the ripple. **Two displacement stages and not one,
    // and the split is forced by the text rather than chosen.** The soft mask writes a
    // varying in the middle of this run - it is a slot, because a build without the mask
    // package still has to carry the crop's own dimming - and a joint standing between two
    // chunks of one stage would have to be spliced into the middle of it, which is exactly
    // what a stage cannot do. So the run above the mask and the run below it are two
    // joints, and each one's chunks are ordered inside it.
    { stage: 'v.regionDisplace' },
    // How much of this point the region hides, which is a replacement rather than an
    // addition: the mask and the crop's dimming are one multiply on one varying, so a
    // package adding to it beside the core would be a second spelling of "how much is this
    // point attenuated" and the two would have to be multiplied together somewhere anyway.
    //
    // **The only fallback in this file carrying text no build has ever drawn**, and it is
    // worth saying out loud rather than leaving to be discovered. The other two that carry
    // text at all - `v.pointSize` and `f.mark` - are the shipped statements exactly as they
    // stood before anything claimed them, so an anchor into either is at worst in the wrong
    // one of two live copies. This one has no original: the crop's dimming has shared its
    // statement with the region mask since both existed, so the mask-less form is written
    // here for the first time. What settles it is that vMask is written on every live path
    // and read unconditionally down in the fragment stage, so an uninstalled mask has to
    // leave a write here and the crop's half is the part belonging to every point in the
    // frame - asserted by assembling the shipped set with the mask dropped, where `rw` has
    // no reader left and this is the one write vMask gets.
    {
      slot: 'v.mask',
      fallback: /* glsl */ `\
  vMask = outsideCrop ? cropOutside : 1.0;

`,
    },
    // The displacements an effect adds after the mask has read the region weight. A stage
    // rather than a slot because these compose and their order is the whole of what they
    // mean: the tear shoves a band of the feed sideways and the lattice quantises wherever
    // the point ends up, so running them the other way round would snap a position the tear
    // then walks off the grid. The order is declared in each package rather than left to
    // whichever the server lists first, which is what makes "the order the file held them
    // in" a fact rather than an accident of a directory listing.
    //
    // **A stage appends its chunks after whatever core text is left above it, so only the
    // tail of a run can move.** That is what kept the turbulence, the push and the ripple
    // core while the tear and the snap moved out, and it is why they needed a joint of
    // their own to leave through rather than orders below these two.
    { stage: 'v.displace' },
    { text: /* glsl */ `\
  vUv = (position.xy + 0.5) / resolution;
  vDepth = z;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  // Every screen-space term in this renderer is defined against a 1080p reference
  // and scales with the drawing buffer, and this is the dominant one. Set in
  // framebuffer pixels and scaled by distance but not by buffer height, the same
  // scene at twice the height kept each point the same pixel size while the frame
  // gained four times the pixels: coverage per point dropped fourfold, the 217k
  // points stopped overlapping into a surface, and the sub-pixel RGB split began
  // fringing individual points instead of edges. That is a different image rather
  // than the same one at higher fidelity, so pointSize is now pixels at 1080p.
  //
  // The clamp stays in framebuffer pixels deliberately. It is a bound on what the
  // hardware can draw rather than a look value: ALIASED_POINT_SIZE_RANGE is
  // [1, 511] on this GPU, so a sub-pixel point is not expressible at all and
  // scaling the lower bound would be a more elaborate way of asking for one. The
  // residual is confined to the clamped tails - the far cloud below one pixel, and
  // points closer than about a quarter of a metre - and a check comparing two
  // output sizes has to keep out of that band rather than pretend it is not there.
  float k = bufferHeight / 1080.0;
  // How big one lattice cell is on screen at this point's distance, in the same reference
  // pixels vSize below is carried in, and it is derived from the projection rather than
  // from a baked field of view because the fov is part of the camera pose and keyframes: a
  // constant worked out at fifty degrees is wrong the moment a clip animates it.
  // projectionMatrix[1][1] is cot(fov/2), so a world length L at view distance d spans
  // L * P11 / d of clip space and half the frame is 540 reference pixels.
  //
  // max(0.15, -mv.z) is written out a second time rather than hoisted into the clamp
  // below it, and that is deliberate: the clamp's exact text is what export-check's
  // pointsize-absolute anchors on, so putting a local in the middle of it would take the
  // control off rather than move it.
  float dist = max(0.15, -mv.z);
  float cellPx = latticeCell * projectionMatrix[1][1] * 540.0 / dist;
` },
    // How big the sprite is drawn, and the one joint here that is a replacement rather
    // than an addition: an effect that grows the sprite into something other than a point
    // has to stand where the clamp stood, not beside it. The fallback is that clamp,
    // exactly as it was written before anything claimed this - pixels at 1080p over the
    // view distance, floored at one framebuffer pixel and ceilinged at the literal 64 -
    // and the long argument for both bounds is in the comment above `dist`.
    {
      slot: 'v.pointSize',
      fallback: /* glsl */ `\
  gl_PointSize = clamp(pointSize * k / max(0.15, -mv.z), 1.0, 64.0);
`,
    },
    { text: /* glsl */ `\
  // Carried in reference pixels rather than framebuffer ones, because the fragment
  // shader normalises a splat's additive energy against its area. For the same
  // image at twice the size each point covers four times the pixels, so it has to
  // keep the same alpha - normalising against the drawn size instead would make
  // the identical look sum four times too bright at twice the resolution.
  vSize = gl_PointSize / k;

` },
    // What a displacement does to a splat's additive energy, cancelled in the stage that
    // knows the view distance and the projection. A slot rather than a stage, and the only
    // one here whose fallback is empty: `vCellNorm` is one factor on one multiply down in
    // the fragment stage, so two effects writing it would be two answers to one question,
    // and with nothing claiming it the 1.0 written above the early returns is what stands -
    // which is exactly the value that makes that multiply inert. The declaration and that
    // initialisation stay core for the same reason the `in` far below does: every additive
    // fragment reads it whatever is installed.
    { slot: 'v.cellNorm', fallback: '' },
    { text: /* glsl */ `\
  // Cut-away points draw at half the size, and **this has to come after vSize or it
  // undoes the dimming it is meant to help.** The fragment stage normalises a splat's
  // additive energy against vSize squared, so a point reported at half size gets four
  // times the alpha back - which is right for a point that is genuinely small and wrong
  // for one that has merely been shrunk to get out of the way. vSize therefore keeps
  // the size a kept point would have had, and only the rasterised sprite shrinks.
  //
  // The size is what makes this scaffolding rather than a second cloud. Alpha alone is
  // not enough: depthWrite is on, so a faint point still occludes at full strength,
  // and cut-away furniture orbiting in front of the subject would flicker through it
  // order-dependently. A quarter of the footprint is a quarter of the occlusion, and it
  // reads as dust instead of as surface.
  if (outsideCrop) gl_PointSize *= 0.5;

  // **The size the legibility crossfade reads, and it is the lesser of two readings rather
  // than either one of them.** This is a third screen-space quantity and the file now
  // carries three references rather than two, so it is worth stating what each is for. The
  // 1080p reference is the unit every *look* value is expressed in, so that a document
  // grades the same picture at any output size. Bloom's chain is frozen at 600 because
  // UnrealBloomPass bakes its tap count in at construction and has no parameter to
  // express. And this one is neither: the mark falls back to a splat at whichever limit is
  // reached first, the look's own floor in reference pixels or what the buffer can actually
  // resolve.
  //
  // **Both halves are load-bearing and each one alone is a defect.** Read purely in
  // reference pixels the crossfade inverts at small buffers: the lower clamp lifts a
  // sub-pixel sprite to one framebuffer pixel, which divides back into 15 reference pixels
  // at a 128x72 export, so the far cloud the fallback exists for was reported as nearly
  // legible and drew one arbitrary bit of a character per point instead of a dot. Read
  // purely in framebuffer pixels the boundary between text and texture moves with the
  // output size: the same document that turns to splats past four metres at 1080p holds
  // characters to eight at 4K, which is a different picture rather than the same one at
  // higher fidelity - and renderScale, which is a view parameter and keyframes nothing,
  // would move the look. Dividing by max(k, 1) takes the smaller of the two: below 1080
  // the divisor is 1 and this is the drawn sprite, at 1080 the two units coincide exactly,
  // and above it this is the drawn sprite back in reference pixels.
  //
  // Taken here because this is the last line in the file that can move gl_PointSize, and
  // the halving above it is inside the reading on purpose - a cut-away cell drawn at half
  // its pixels has half the texels to resolve on, whatever the look asked for.
  //
  // vSize is a different quantity and stays one: it is what the additive normalisation
  // divides by, it is taken before the halving, and it is in reference pixels always,
  // because brightness has to be invariant to output size where legibility cannot be.
  vLegiblePx = gl_PointSize / max(k, 1.0);
}
` },
  ]),
  fragment: frozen([
    { text: /* glsl */ `\

precision highp float;

uniform sampler2D colorPrev, colorCurr;
uniform float opacity, exposure, nearClip, farClip, mixT, time;
uniform float scanAmount, rimAmount, thermal, edges;
uniform float duotoneDepth, duotoneHue, duotoneSplit, duotoneSpan, duotoneMotion;
uniform float readRgb, readDepth, readGhost, readContour, readBlackwall;
uniform float rgbSaturation, depthGamma, ghostRim, ghostFill;
uniform float contourBands, contourLo, contourHi, blackwallSweep;
` },
    // The uniforms an effect declares for this stage. A term is declared in the stage
    // that reads it and in both when both read it, which is why the glyph field's master
    // appears here as well as in the vertex stage: it grows the sprite up there and
    // crossfades the mark down here.
    { stage: 'f.decl' },
    { text: /* glsl */ `\
uniform int hasColor, softEdge;

in vec2 vUv;
in float vDepth;
in float vEdge;
in float vGlitch;
in float vSize;
in float vLegiblePx;
in float vGhost;
in float vFade;
in float vMask;
in float vSpeed;
` },
    // The far end of the channels the vertex stage declared, from the same `varyings`
    // entries, in the same order.
    { varyings: 'in' },
    { text: /* glsl */ `\
in float vCellNorm;

out vec4 fragColor;

` },
    // Whatever an effect needs at file scope: a table, a helper, a constant array. Above
    // the ramps rather than below them because a helper has to be declared before the
    // function that calls it in GLSL, and `main` is at the bottom.
    { stage: 'f.helpers' },
    { text: /* glsl */ `\
// Black through red and orange to white, the palette a thermal camera writes rather
// than the cool-to-warm one depthRamp uses - the two are deliberately different, so
// that thermal on top of Depth mode is a second reading and not the same one twice.
vec3 heatRamp(float t) {
  vec3 a = vec3(0.02, 0.01, 0.06);
  vec3 b = vec3(0.55, 0.05, 0.28);
  vec3 c = vec3(0.98, 0.42, 0.05);
  vec3 d = vec3(1.00, 0.98, 0.86);
  return t < 0.33 ? mix(a, b, t / 0.33)
       : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33)
                  : mix(c, d, (t - 0.66) / 0.34);
}

// Smooth cool-to-warm ramp; reads as depth without the banding of a hard palette.
vec3 depthRamp(float t) {
  vec3 a = vec3(0.06, 0.10, 0.28);
  vec3 b = vec3(0.15, 0.72, 0.78);
  vec3 c = vec3(0.98, 0.78, 0.32);
  vec3 d = vec3(0.96, 0.29, 0.42);
  return t < 0.33 ? mix(a, b, t / 0.33)
       : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33)
                  : mix(c, d, (t - 0.66) / 0.34);
}

// Turning both duotone poles by one angle, as a rotation about the grey axis.
//
// Rodrigues rather than a trip through HSV, and the axis is what makes it the right
// arithmetic rather than the cheap one: rotating about the diagonal leaves the
// component along it alone, so a pole that is nearly black stays nearly black however
// far the hue is turned. A round trip through HSV would rebuild the value from a
// maximum and hand the dark pole back lifted, which is precisely the luminance the
// silhouette is made of.
//
// What is deliberately *not* claimed here is that a hue of zero is the exact identity.
// It collapses to one where the driver returns exact values at zero, and GLSL ES permits
// a couple of thousandths of absolute error on a trigonometric function, so that would be
// a premise about this GPU wearing the clothes of a fact about the language - which is the
// shape this repo has already been bitten by at the power of one. Nothing rests on it: the
// block below guards on the *amount*, so at the defaults this function is never reached at
// all, and the bit-exactness the pinned comparison measures is the branch's rather than
// this arithmetic's.
vec3 hueSpin(vec3 c, float a) {
  const vec3 axis = vec3(0.5773502691896258);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(axis, c) * sa + axis * dot(axis, c) * (1.0 - ca);
}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);

` },
    // What shape the mark is, which is a replacement for the same reason the point size
    // is: an effect drawing something other than a round splat needs the disc test to
    // stop cutting its corners, and a second test beside the first would be two answers
    // to one question. The fallback is the pair that stood here before anything claimed
    // it - the discard on the hard-edged branch, then the falloff - and it is the text
    // that shipped rather than a reconstruction of it.
    {
      slot: 'f.mark',
      fallback: /* glsl */ `\
  // Additive mode shapes the sprite purely with alpha falloff. Skipping the
  // discard keeps Apple's tile-based hidden-surface removal working.
  float falloff;
  if (softEdge == 1) {
    falloff = exp(-r2 * 9.0);
  } else {
    if (r2 > 0.25) discard;
    falloff = smoothstep(0.25, 0.02, r2);
  }

`,
    },
    { text: /* glsl */ `\
  float t = clamp((vDepth - nearClip) / max(0.001, farClip - nearClip), 0.0, 1.0);
  vec3 rgb = hasColor == 1
    ? mix(texture(colorPrev, vUv).rgb, texture(colorCurr, vUv).rgb, mixT)
    : vec3(0.7);

  // Saturation on the camera image, at the source rather than after the blend. It is
  // the colour reading's own control - the one reading that had none - so it belongs
  // where the colour is read, and the treatments that take a luminance off the colour
  // are unaffected by construction: this rotates the colour about its own luminance,
  // which is the quantity they read.
  //
  // Guarded rather than applied unconditionally, and the guard is what makes the
  // default exact rather than nearly exact. A mix at 1.0 is x plus one times y minus x
  // on hardware that contracts it into a multiply-add, and x plus y minus x is not
  // always bit-identical to y - so an unguarded identity would move the pixels of every
  // look ever authored by a hair, which is a whole preset library drifting to buy
  // nothing. The branch is on a uniform, so it is coherent across the draw and a look
  // that does not saturate pays for no saturation, the same way each reading's own
  // block is guarded on its weight.
  if (rgbSaturation != 1.0) {
    float rgbLum = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(rgbLum), rgb, rgbSaturation);
  }
  // The five readings, summed by weight rather than selected by an integer. Each
  // block answers "what colour is this point and how solid is it", and the two
  // answers are accumulated separately because they do not combine the same way:
  // a colour is a value to average, and an alpha factor is a coefficient on
  // opacity that the RGB and Depth readings do not write at all.
  //
  // Normalise-by-sum rather than a chain of mix(), and that is the whole reason
  // this rewrite is safe. A single reading at 1.0 comes out of here as
  // x * 1.0 / 1.0, which IEEE multiplication and division both leave exactly
  // alone, so every look authored against the old five-way branch renders the
  // pixels it always did - proven rather than argued, by hashing the framebuffer
  // of each reading here against the same mode on the commit before this one.
  // A chain of mix() would be a different arithmetic expression for the same
  // intent and would drift in the last bits, which is a whole preset library
  // quietly moving.
  //
  // Each block is guarded on its own weight. That is a cost decision and not a
  // semantic one - adding anything times 0.0 adds nothing - but the branch is
  // uniform, so it is coherent across the entire draw and a preset using one
  // reading pays for one reading.
  vec3 col = vec3(0.0);
  float alphaFactor = 0.0;
  float readSum = 0.0;

  if (readRgb > 0.0) {
    col += rgb * readRgb;
    alphaFactor += readRgb;
    readSum += readRgb;
  }

  if (readDepth > 0.0) {
    // The gamma bends where the ramp's colours sit inside the clip range rather than
    // moving its ends: at 1.0 it is the ramp this always drew, under 1 the far end of
    // the range gets more of the ramp and over 1 the near end does. Which is the
    // control the depth reading wanted, since where the subject stands inside near/far
    // decides whether the interesting half of the ramp lands on them at all.
    //
    // Two statements for one sum, and the duplication is the measurement rather than an
    // oversight. Three forms of this line were hashed against the build from before the
    // readings existed, and they produced three different images of the same reading at
    // a default that is exactly the literal it replaced:
    //
    //   depthRamp(pow(1.0 - t, depthGamma))            frame 0 2cf348152757
    //   depthRamp(g == 1.0 ? 1.0 - t : pow(...))       frame 0 73d0479d20f9
    //   depthRamp(1.0 - t), reached by the branch      frame 0 885c07e968a6, which is the
    //                                                 old build's own hash
    //
    // The first is the ordinary trap: raising a number to the power of one is the
    // mathematical identity and not the arithmetic one, because this GPU evaluates it as
    // exp2 of the log2 and it comes back a few last-bit values away. The second is the
    // one worth writing down - handing the ramp a value through a variable is not the
    // same as handing it the expression, even when the value is bit-identical. The ramp
    // inlines to a mix by the argument over 0.33, so with the subtraction inside the call
    // the compiler can contract the two into one multiply-add and with a variable in its
    // place it does not. So the default path here has to *be* the old line rather than
    // compute what it computed. Ghost's exponent needed no guard at all, which is the
    // other half of the measurement: substituting a uniform for a literal exponent is
    // exact, and it is asking for the power of one that is not.
    if (depthGamma == 1.0) {
      col += depthRamp(1.0 - t) * readDepth;
    } else {
      col += depthRamp(pow(1.0 - t, depthGamma)) * readDepth;
    }
    alphaFactor += readDepth;
    readSum += readDepth;
  }

  if (readGhost > 0.0) {
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    // Two controls over one shell: the exponent decides how tightly the glow hugs a
    // depth discontinuity, and the fill is how much of the shell's blue is there before
    // any luminance arrives - which is what a colourless surface facing the sensor
    // draws, and at 0 the reading collapses to edges alone.
    float rim = pow(vEdge, ghostRim);
    col += mix(vec3(0.20, 0.45, 0.75) * (ghostFill + lum), vec3(0.75, 0.95, 1.0), rim) * readGhost;
    alphaFactor += (0.25 + 0.75 * rim + 0.25 * lum) * readGhost;
    readSum += readGhost;
  }

  if (readContour > 0.0) {
    // Bands per metre, and how much of each band the line fills. The two edges arrive
    // as separate uniforms because subtracting the width from a half here would round
    // differently from the literal it replaces - see the note beside them - so the
    // width is taken either side of the middle on the CPU.
    float bands = fract(vDepth * contourBands);
    float line = smoothstep(contourLo, 0.5, bands) * smoothstep(contourHi, 0.5, bands);
    col += mix(depthRamp(1.0 - t) * 0.18, vec3(1.0), line) * readContour;
    alphaFactor += (0.15 + 0.85 * line) * readContour;
    readSum += readContour;
  }

  if (readBlackwall > 0.0) {
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
    bw += vec3(0.10, 0.62, 0.78) * scan * scanAmount;

    bw *= 0.55 + 0.75 * lum;

    // Shed points run hotter than the surface they left, so a wake reads as the
    // wall having noticed something rather than as leftover geometry.
    bw = mix(bw, vec3(1.00, 0.42, 0.20), vGhost * 0.55);

    col += bw * readBlackwall;
    alphaFactor += (0.30 + 0.70 * rim * rimAmount + 0.45 * scan * scanAmount) * readBlackwall;
    readSum += readBlackwall;
  }

  // Every weight at zero draws nothing, and that is the honest answer rather than
  // a case to clamp away: the panel is showing five zeros and the frame agrees
  // with it. The guard is on the division alone, so the alpha carries the emptiness
  // out instead of a NaN doing it.
  float norm = readSum > 0.0 ? 1.0 / readSum : 0.0;
  col *= norm;
  float alpha = opacity * alphaFactor * norm;

  // Both of these sit *after* the blend and modify whatever it produced, rather than
  // living inside one of the readings. A term written into a reading is inert in
  // every other one, which is both a worse feature - these are meant to compose with
  // whatever you are working in - and a hole in the proof: a term reachable only from
  // one reading is only exercised by a sweep arm that happens to select that reading,
  // and would otherwise be recorded as a parameter that cannot touch a pixel. That
  // argument is what the readings above have now been rebuilt around, so the rule it
  // states applies to the readings themselves: registry-check sweeps each of them.
` },
    // A term over the colour the readings produced, after the blend. It is a stage rather
    // than a slot because these compose: a term written into one reading is inert in every
    // other one, which is the argument every term here is arranged by, and two effects
    // lifting the same colour is two multiplies rather than a conflict. The GLSL comment
    // immediately above states that argument for the reader of the assembled shader, and it
    // stays in the spine rather than travelling with the first chunk because it is the
    // stage's own reason: a build with no tone effect installed still has the run, and the
    // sentence explaining why terms belong here would otherwise vanish with the last
    // package that happened to carry it.
    //
    // **The whole run is generated now.** Five packages fill it, in the order the file held
    // them and numbered with room between: the thermal at 100, the edges at 200, the duotone
    // at 300, the glitch's flare at 400 and the rain's lift at 500. Each chunk carries why
    // it sits where it does - the rain's says why it is below the flare, so that the line
    // the flare's measurement was taken beside keeps the neighbours it was measured with.
    //
    // Those five are also the first stage in this build whose declared order disagrees with
    // the order the packages arrive in, which `test/shader-assembly.test.mjs` records: the
    // directory hands them over as duotone, edges, glitch, rain, thermal, so a build that
    // lost the sort would draw a visibly different frame here rather than the identical one
    // every other stage would still draw.
    { stage: 'f.tone' },
    // What the mark actually draws, if it draws something other than the falloff. It
    // reads the colour above it, which is why it is here and not at either end: the one
    // key that cannot be decided in the vertex stage is the luminance of the colour this
    // cell is about to draw, and that does not exist until the line above.
    { slot: 'f.glyph', fallback: '' },
    { text: /* glsl */ `\
  // Cross-fade. A dying point thins out where it stood instead of blinking off,
  // and its replacement comes up over the same window.
  alpha *= vFade;
  // The region's soft mask, which is a fade rather than a cull precisely so its edge
  // can be soft - a vertex-stage discard could only ever give a hard boundary.
  alpha *= vMask;
  // Ghosts sit under the live cloud so they read as afterglow, never as surface.
  if (vGhost > 0.0) alpha *= 0.5;

  // Additive contributions sum, and near points get both larger sprites and more
  // overlap, so a splat's energy is normalised against its area. Without this the
  // nearest subject saturates to flat white while the background stays correct.
  // 116.64 is forced by the unit change rather than chosen. The same look now asks
  // for 1.8 times the point size it used to, so holding alpha fixed at every
  // distance means C / (1.8 P / d)^2 = 36 / (P / d)^2, and the only C that
  // satisfies it is 36 * 1.8^2. Leaving it at 36 would have moved the distance at
  // which the normalisation starts biting from 0.75m out to 1.35m - a look change
  // wearing a resolution fix's clothes.
  //
  // **The floor is gone, and growing the sprite to a cell is what took it away.** The 0.05
  // looked harmless while a sprite was pointSize-sized: at 9 it only reaches a vSize of 48,
  // where the floor takes over, within 19cm - nearer than a Kinect v2 will range. A
  // cell-sized sprite moves the same threshold out by a factor of seven, to about 1.32m,
  // which is where a person stands - and past it the normalisation has stopped scaling
  // while the point count keeps climbing, so a subject walking toward the sensor blows out.
  // The number that mattered was never the floor's value; it was the sprite size the floor
  // is measured against. The ceiling at the other end bites below a vSize of about 11,
  // which is 5.9m and past the far clip, and the fallback to dots covers it anyway.
  //
  // vCellNorm is the other half of the same idea and the vertex stage carries the argument
  // for it: the term above normalises against the sprite, and the lattice breaks that by
  // collapsing sources onto cells. It is exactly 1 wherever the lattice is 0, which is
  // eight of the ten shipped looks, so multiplying by it there is exact and those eight
  // render the frames they always did - asserted with hashes rather than argued, because
  // this line is in the shared fragment path the flare's measurement is about.
  if (softEdge == 1) alpha *= min(116.64 / (vSize * vSize), 1.0) * vCellNorm;

  // **A fragment carrying no colour still writes depth.** The hard-edged path draws with
  // depthWrite on and there is no alphaTest anywhere, so a fragment whose alpha comes out
  // exactly zero is invisible in colour and solid in depth - a piece of geometry standing in
  // front of whatever the room had behind it with nothing in the picture to say so. The
  // crop's own comment up in the vertex stage already states the rule this rests on, that
  // alpha alone is not enough because a faint point occludes at full strength; this is the
  // same fact arriving where the alpha is exactly zero rather than merely low, and it is
  // worse there, because a point you cannot see is a point nobody looks for.
  //
  // **Three ways a fragment arrives here at exactly zero, and the condition is one statement
  // rather than three cases.** Most of an 8x8 bitmask is margin, so every off bit of every
  // character is one. A point born this frame carries a fade of exactly 0 for as long as its
  // sprite is being rasterised, so the whole sprite is one. And the disc the hard-edged
  // branch cuts lands smoothstep(0.25, 0.02, r2) on 0 at exactly r2 = 0.25, which is the one
  // ring of fragments the r2 > 0.25 test above lets through. Written as the product, so it
  // covers the three that exist and whatever a later term multiplies in.
  //
  // **The condition was confined to characters for one commit and the confinement is gone.**
  // The glyph field introduced a *suppressed* disc test - a look drawing characters keeps its
  // square sprite - and the repair that shipped with it carried glyphMix > 0.0 so that it
  // put back only what that suppression had removed. The other two are older than the glyph
  // field by a long way, they are not that branch's to repair inside a repair, and widening
  // the condition to reach them moves four shipped documents. That movement is what this
  // change buys and it was approved rather than absorbed.
  //
  // Measured, interleaved against the confined form, over 15 pinned program positions - six
  // source frames of captures/sample.knct at stride 4 with three substeps each, drawn into
  // a 572x322 buffer inside a 640x360 viewport at device scale 1, off the pinned drive with a
  // planted colour image. **contour 847, depth 915, ghost 931 and rgb 901 differing pixels**
  // over the run, each moving at 12 of the 15 positions, and those four are exactly the
  // documents that ship with additive off. The same run splits the two older halves apart: a
  // discard reaching births alone accounts for 835 / 903 / 919 / 889 of those pixels at the
  // five positions where a frame lands and sinceFrameSec is 0, and one reaching the disc's
  // rim alone accounts for 12 on every look, at nine positions. The two sum to the whole on
  // every arm, which is the statement that these three are the class rather than three of it.
  // The same look with no lattice and a pointSize of 40 moves 4805.
  //
  // **The first term is the path and it is not tidiness.** The additive branch shapes its
  // sprite with falloff alone and takes no discard at all, so that Apple's tile-based
  // hidden-surface removal keeps working - the comment above that branch says so - and it
  // draws with depthWrite off, so a zero-alpha fragment there occludes nothing and there
  // is nothing here to repair. Measured rather than assumed, on the same run: all six of the
  // shipped additive documents come back byte-identical with this discard ungated entirely,
  // so the gate costs no correction and keeps the tiler.
  //
  // The product is written out twice rather than hoisted into a local, following the
  // distance term in the vertex stage: this file has already measured that handing a value
  // through a variable licenses a contraction the inline expression does not get, and the
  // line below it is in the shared fragment path the flare's measurement is about. That the
  // branch itself costs no contraction is measured rather than argued, and it is the same
  // reading as above: the six additive looks are byte-identical with this line present and
  // its condition short-circuiting on the path term.
  if (softEdge == 0 && alpha * falloff <= 0.0) discard;
  fragColor = vec4(col * exposure, alpha * falloff);
}
` },
  ]),
});
