// The two programs a depth sample is drawn by, as source text and nothing else.
//
// There is no arithmetic here, nothing is constructed and nothing is imported: this file
// is what the point cloud's material is compiled from, lifted whole out of `main.js` so
// that nine hundred lines of GLSL stop sitting between the uniforms that feed them and
// the hundred places that write those uniforms. Neither program interpolates anything -
// there is no `${}` in either literal - so the text below is exactly what the driver is
// handed, and it stays that way: a shader that needs a value from JavaScript takes it as
// a uniform, which is the boundary the uniform block is for and the reason this could
// move at all.
//
// **What the move costs is the pairing, and it is worth naming here rather than being
// discovered.** Every `uniform` declared below has to have a key in the `uniforms` object
// in `main.js`, and nothing enforces that in either direction. A uniform with no key is
// silent: three.js simply never writes it, the shader reads zero, and the look is subtly
// wrong with nothing on the console. A key with no uniform is dead weight that costs a
// slider's write on every frame it is animated. Measured across the split: 86 declared
// here, 86 keys there, and the two sets are equal both ways. That equality is a fact
// about today rather than something this file can hold, so a term added to one side
// belongs in the same commit as the other.

export const vertexShader = /* glsl */ `
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
// The glyph field's master, which this stage needs for one thing only - growing the
// sprite into the cell the lattice already cut. Which character gets drawn is decided in
// the fragment stage, because it keys on a luminance that does not exist until the colour
// is built, so the other three weights are declared there and not here.
uniform float glyph;
// The rain, which is a colour term rather than a property of the alphabet and so has its
// own four parameters. Three of them are read here because the scalar the whole thing
// rests on is a function of world height, which only this stage knows; rainTrail shapes
// the brightness and is read in the fragment stage beside the colour it lifts.
uniform float rain, rainSpeed, rainSpan;
// Program time again, and it is a second cell holding the same number rather than a reuse
// of time on purpose. The rain has to be a pure function of program time or a seek lands
// where playback never would, and the control that holds that claim -
// timeline-check --mutate rain-accumulates - has to be able to integrate exactly one
// line. Mutating time itself would redden the ripple, the glitch and the raster along
// with it, and a control that fails everything cannot say which claim is load-bearing.
uniform float rainPhase;
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
out float vCellSeed;
out float vRain;
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
  vCellSeed = 0.0;
  vRain = 0.0;
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
  float rw = (regionPush != 0.0 || regionNoise > 0.0 || regionMask != 0.0 || ripple > 0.0)
    ? regionWeight(p0)
    : 0.0;

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
  if (glyph > 0.0 || rain > 0.0) {
    vec3 room = mat3(modelMatrix) * p0;
    vec3 wc = floor(room / latticeCell + 0.5);
    vCellSeed = hash(dot(wc, vec3(127.1, 311.7, 74.7)));
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
  }

  // Gated because it is the most expensive thing in this shader: eight hashes of three
  // sines each, against the six the old sine field cost. A look with no turbulence pays
  // none of it, which is the same bargain the ghost half of the geometry makes.
  float amp = noise + regionNoise * rw;
  if (amp > 0.0) {
    pos += amp * vnoise3(p0 * noiseScale + time * noiseSpeed * vec3(0.7, 1.13, 0.31));
  }

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

  // The region read a fourth way: a wave travelling out along the radius, so the volume
  // breathes where the push only swells it. It shares the push's radial direction and its
  // centre guard for the same reasons - the gradient of a rounded box is degenerate at the
  // centre, and normalize there would hand back NaN and take the vertex with it.
  //
  // **The clock is stepped rather than continuous, which is the whole character of it.**
  // A sine of raw time is a thing breathing; this design wants a thing being rebuilt by a
  // machine, so the phase advances in eighth-cycles and the surface arrives at each one
  // rather than sliding between them. Eight steps and not a parameter: the count is what
  // makes it read as machinery, and a slider that could set it to a thousand would just
  // be a way to author the smooth version this is deliberately not.
  //
  // The step is on the clock alone and not on the radius, so the wave is quantised in
  // time and smooth in space. Quantising both would put the region on a set of shells,
  // which is the lattice's job two blocks down and would be a second way to do it.
  if (ripple > 0.0 && rw > 0.0) {
    vec3 out0 = p0 - regionCentre;
    float dist = length(out0);
    if (dist > 1e-4) {
      float cycles = dist * rippleFreq - floor(time * rippleSpeed * 8.0) * 0.125;
      pos += (out0 / dist) * (sin(cycles * 6.2831853) * ripple * rw);
    }
  }

  // Positive hides what is inside the region, negative what is outside. Carried to the
  // fragment stage rather than culled here, because the whole point of the falloff is
  // that the edge is soft.
  //
  // The crop's own dimming rides here rather than on a varying of its own, and it is
  // the same idea rather than a similar one: both are a boundary the vertex stage knows
  // about attenuating a fragment it cannot discard. A second varying would be a second
  // spelling of "how much is this point attenuated", and the two would then have to be
  // multiplied together somewhere anyway.
  vMask = (regionMask > 0.0
    ? 1.0 - regionMask * rw
    : 1.0 + regionMask * (1.0 - rw))
    * (outsideCrop ? cropOutside : 1.0);

  // Datastream corruption: horizontal bands tear sideways, the way a failing
  // feed shears. Bands are picked stochastically so it stutters rather than pulses.
  //
  // The shove is sensor-frame X applied before the view matrix, and the bands are
  // depth-image rows, so the tear belongs to the feed rather than to the display. That
  // is the point rather than an oversight: orbit around a torn band and it shoves in
  // depth, which is what says the volume is corrupt, and under a levelled room the
  // bands run at the angle the bracket was actually at. Screen-locked tearing is a
  // different effect and would belong at the grade stage beside the scanlines.
  //
  // The floor of time times the rate is written twice rather than hoisted into a local,
  // and the shove's ceiling is parenthesised as twice glitchShove rather than folded
  // into the chain. Both are here to hold the float arithmetic at the defaults exactly
  // where the literals left it - this file has already measured that handing a value
  // through a variable licenses a contraction the inline expression does not get, and
  // doubling 0.45 is exact in float32 where a re-associated product need not be. At the
  // defaults the *geometry* of this block is bit-identical to the one-slider version it
  // replaces, and that is measured rather than reasoned: with the flare taken to zero, the
  // colour, depth and contour readings come back byte for byte identical to the pinned
  // build at the shipped glitch of 0.18, over six frames, and the shove is live on both
  // sides so the equality is not vacuous.
  //
  // **The flare is the exception and the claim used to be stated without it.** glitchTint
  // defaults to 1.8 where the line it replaced baked 3.0, so the picture does move - see
  // the registry entry for the measurement. The blanket version of this sentence stood for
  // as long as it did because nothing ever rendered these two builds with the glitch
  // switched on: the cross-build section renders at parameter defaults, where glitch is 0
  // and none of this executes.
  vGlitch = 0.0;
  if (glitch > 0.0) {
    // The axis the bands are cut along, and the default path is the old expression itself
    // rather than one that computes what the old expression computed. That distinction has
    // already cost this file a measurement twice - the comment above says why, and the
    // raster's guard in the grade shader in web/post-chain.js says it again - so the zero
    // case reaches the old division textually, with no local in the way to license a
    // contraction the inline form does not get.
    float band = glitchAxis > 0.0
      ? floor(mix(position.y, position.x, glitchAxis) / glitchBands)
      : floor(position.y / glitchBands);
    float roll = hash(band + floor(time * glitchRate) * 31.7);
    if (roll > 1.0 - glitch * glitchDensity) {
      float shove = (hash(band * 3.1 + floor(time * glitchRate)) - 0.5) * glitch * (2.0 * glitchShove);
      pos.x += shove;
      vGlitch = abs(shove) * glitchTint;
    }
  }

  // The volume rebuilt on a grid: every axis quantised to a cell, so surfaces break into
  // steps and the cloud reads as something a machine is reconstructing rather than
  // something that was measured. It sits last of the displacements, after the tear, so
  // what gets snapped is the position the point actually ends at - a lattice applied
  // before the turbulence would be smoothly pushed back off its own grid and buy nothing.
  //
  // **Snapped in the levelled frame and not the sensor's**, which is the whole of why this
  // is more than a rounding. The grid has to belong to the room: with a canted mount the
  // sensor frame is tilted, and a lattice cut along its axes would stand at whatever angle
  // the bracket happened to be at, so the floor would step diagonally. Levelling first
  // means the cells line up with the room, and a mount corrected afterwards does not
  // re-cut the grid.
  //
  // **The rotation is the model matrix three already hands this shader, not a second copy
  // of it.** The cloud carries the world tilt as its only transform, so mat3(modelMatrix)
  // is exactly the sensor-to-levelled rotation and cannot drift from it the way a uniform
  // derived beside it could. Getting back is the transpose rather than inverse(), which is
  // both cheaper and exact - but that identity holds only while the matrix stays a pure
  // rotation, so registry-check asserts the cloud carries no scale and no translation
  // rather than leaving it as a thing this comment claims.
  if (lattice > 0.0) {
    mat3 level = mat3(modelMatrix);
    vec3 cell = floor((level * pos) / latticeCell + 0.5) * latticeCell;
    pos = mix(pos, transpose(level) * cell, lattice);
  }

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
  // **The sprite grows into its cell as the master rises**, so one character stands for one
  // cube of room, which is the whole reading the cube variant of this was chosen for. A
  // 5.5cm cell a metre away is about 64 reference pixels where pointSize 9 is 9, so the
  // two are nowhere near each other and something had to give; blending rather than
  // switching is what keeps pointSize meaning something at every value in between.
  //
  // **The ceiling on the glyph branch is the hardware's and not the literal 64**, because a
  // cell-sized sprite reaches 64 pixels at a metre and that is where a person stands. Past
  // that the sprite would stop growing while the cell kept growing, so characters would
  // stop filling their cells, the tiling would open up, and spriteWorld / cell would stop
  // being 1 at full glyph - which is the property the energy compensation in the fragment
  // stage rests on. The clamp is in framebuffer pixels, so that failure moves with output
  // size: the same look that opens gaps at a metre on screen opens them at two metres in a
  // 4K export, which is exactly the drift the 1080p reference unit exists to stop.
  //
  // **The old statement survives verbatim on the else branch, and that departs from the
  // design document on purpose.** The document replaces the literal 64 outright. It is kept
  // here because no shipped look reaches it - pointSize tops out at 9 across all nine, so
  // 64 needs a subject 14cm from the sensor, nearer than a Kinect v2 will range - and
  // because leaving the statement textually alone is what keeps the old path byte-identical
  // across output sizes and keeps export-check's anchor alive. What the document is right
  // about is the case it was written for, which is the grown sprite, and that case is the
  // branch above.
  if (glyph > 0.0) {
    float base = clamp(pointSize * k / dist, 1.0, 64.0);
    gl_PointSize = clamp(mix(base, cellPx * k, glyph), 1.0, pointCeiling);
  } else {
    gl_PointSize = clamp(pointSize * k / max(0.15, -mv.z), 1.0, 64.0);
  }
  // Carried in reference pixels rather than framebuffer ones, because the fragment
  // shader normalises a splat's additive energy against its area. For the same
  // image at twice the size each point covers four times the pixels, so it has to
  // keep the same alpha - normalising against the drawn size instead would make
  // the identical look sum four times too bright at twice the resolution.
  vSize = gl_PointSize / k;

  // **What the lattice does to additive brightness, cancelled here rather than in the
  // fragment stage.** The normalisation down there divides a splat's alpha by its own area,
  // on the assumption that sources are spread at the sprite's scale - and the lattice
  // breaks that assumption by collapsing them onto cells. Pulling points a fraction L of
  // the way to their cell centre leaves a cluster spanning cell * (1 - L), so brightness
  // runs up as one over that squared until the cluster is smaller than the sprite, after
  // which it saturates at the fully coincident case. voxel.json has been in exactly that
  // state since it shipped: lattice 0.55, additive on, and a pointSize of 6.5 well under
  // its 3.5cm cell.
  //
  // **It is computed here because two of the three things it needs do not exist in the
  // fragment stage.** The view distance and the projection are vertex-stage quantities, so
  // the design document's single fragment-stage expression cannot be written where it puts
  // it; crossing the finished factor is one varying where crossing its inputs would be
  // three, and it puts the arithmetic where its inputs are. vSize is the sprite that was
  // actually rasterised - taken after both clamps - so wherever the ceiling bites,
  // brightness stays correct and only the tiling degrades.
  //
  // **The min bounding the sprite term is a correction to the document and not a
  // transcription of it.** As written there the factor is max((1-L)^2, (sprite/cell)^2),
  // which at lattice 0 is 1 only while the sprite is no bigger than the cell - and
  // pointSize reaches 64 against a cell that bottoms out at 5mm, so the region where it
  // exceeds 1 is reachable through the sliders and the factor would then *brighten*, in
  // contradiction of the document's own "exactly 1 at lattice 0". Bounded, it is exactly 1
  // at lattice 0, exactly (sprite/cell)^2 at lattice 1, and exactly 1 again at full glyph
  // where the sprite *is* the cell - which is the property that makes the compensation and
  // the glyph field not interact at all at full strength.
  //
  // Straight through with no guard, following the flare's measurement in the fragment
  // stage: multiplying by the computed 1.0 is exact in IEEE, where a branch dropped into a
  // common path costs the compiler contractions across the lines either side of it.
  float spriteCells = vSize / cellPx;
  vCellNorm = max((1.0 - lattice) * (1.0 - lattice), min(1.0, spriteCells * spriteCells));

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
`;

export const fragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D colorPrev, colorCurr;
uniform float opacity, exposure, nearClip, farClip, mixT, time;
uniform float scanAmount, rimAmount, thermal, edges;
uniform float duotoneDepth, duotoneHue, duotoneSplit, duotoneSpan, duotoneMotion;
uniform float readRgb, readDepth, readGhost, readContour, readBlackwall;
uniform float rgbSaturation, depthGamma, ghostRim, ghostFill;
uniform float contourBands, contourLo, contourHi, blackwallSweep;
// The glyph field's master and its three keys. The master is declared in both stages
// because it does two things that belong at two stages - it grows the sprite up there and
// it crossfades the mark here - and the three keys are here alone, because the character
// index is decided beside the colour it reads.
uniform float glyph, glyphTone, glyphHash, glyphRain;
// The rain's brightness and the two lengths that shape it. The speed is not here: how fast
// a head falls only enters through the scalar the vertex stage already computed, where the
// world height it is a rate against lives.
uniform float rain, rainSpan, rainTrail;
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
in float vCellSeed;
in float vRain;
in float vCellNorm;

out vec4 fragColor;

// The alphabet, as sixty-four 8x8 bitmasks held in the shader source.
//
// **There is no atlas, no texture and no fetch, and that is a decision about boot rather
// than about memory.** This renderer loads no static image: every texture it binds is built
// out of frame bytes in web/gpu-textures.js, so an atlas would be the first file the render
// path ever went and got - a route on the server to serve it, a load order to get right, a
// question about what the shader draws in the frames before it arrives, and the same
// question again inside the headless browser tools/render-worker.mjs drives, where a missing
// asset is a deliverable with no characters in it rather than a visible error. A table in
// the source has none of those states, because it is there the moment the shader compiles.
// The other thing it buys is that the alphabet is reviewable: a bitmask is a diff a person
// can read, where an atlas is a binary nobody looks inside.
//
// 8x8 rather than the 5x6 the probe drew, and the size is the whole reason for it. 5x6
// draws latin, digits and symbols and cannot draw kana, which would put the reference
// look's own alphabet permanently out of reach. 8x8 is what the home computers of the
// eighties drew kana at, so it is the smallest grid that keeps the option, and two
// unsigned ints carry one character exactly.
//
// **Sorted by ink, sparsest first, which is what lets three keys share one table.** A
// luminance ramp is ASCII art and only works if the index means ink, so that a bright cell
// draws a dense character and a dark one draws a sparse one; a hash and a rain counter want
// the index to mean nothing, because looking like noise is their whole job. Sorting by ink
// dissolves that rather than resolving it - the tone key reads the table as tone and the
// hash key reads the same table as noise, and both readings are true of it at once - so no
// parameter has to choose between them, which matters because a chooser would be an enum
// and this registry has refused those since the region's shape control, on the grounds that
// an enum cannot keyframe and a slider can. What it costs is a latin tone ramp: a luminance
// sweep now runs through kana, so the picture is ASCII art drawn in an alphabet that is not
// ASCII.
//
// Packed with x holding rows 0 to 3 and y holding rows 4 to 7, row 0 at the top, and within
// a word the bit at row * 8 + col with column 0 on the left. **Column 7 and row 7 are clear
// in every one of the sixty-four**, and that is where the margin between neighbouring cells
// comes from rather than from a parameter: an 8x8 character does not fill its own 8x8 box,
// so cells tile while the marks inside them do not touch, which is how the reference frames
// actually look - characters with dark between them rather than a solid wall of ink.
const uvec2 GLYPHS[64] = uvec2[64](
  uvec2(0x00080800u, 0x00000000u), // '  apostrophe  ink 2
  uvec2(0x00000000u, 0x000c0c00u), // .  period  ink 4
  uvec2(0x00141400u, 0x00000000u), // "  quote  ink 4
  uvec2(0x04081000u, 0x00001008u), // <  less-than  ink 5
  uvec2(0x10080400u, 0x00000408u), // >  greater-than  ink 5
  uvec2(0x3e000000u, 0x00000000u), // -  hyphen  ink 5
  uvec2(0x00000000u, 0x00060c0cu), // ,  comma  ink 6
  uvec2(0x00000000u, 0x007f0000u), // _  underscore  ink 7
  uvec2(0x08040201u, 0x00402010u), // \  backslash  ink 7
  uvec2(0x08080808u, 0x00080808u), // |  vertical bar  ink 7
  uvec2(0x08102040u, 0x00010204u), // /  slash  ink 7
  uvec2(0x10204300u, 0x00000408u), // ン  katakana N  ink 7
  uvec2(0x000c0c00u, 0x00000c0cu), // :  colon  ink 8
  uvec2(0x0c081020u, 0x0008080au), // イ  katakana I  ink 9
  uvec2(0x10204442u, 0x00020408u), // ソ  katakana SO  ink 9
  uvec2(0x3e080800u, 0x00000808u), // +  plus  ink 9
  uvec2(0x000c0c00u, 0x00060c0cu), // ;  semicolon  ink 10
  uvec2(0x003e0000u, 0x0000003eu), // =  equals  ink 10
  uvec2(0x08080c08u, 0x001c0808u), // 1  digit one  ink 10
  uvec2(0x10204a0au, 0x00020408u), // ツ  katakana TSU  ink 10
  uvec2(0x14240404u, 0x0004040cu), // ト  katakana TO  ink 10
  uvec2(0x23400300u, 0x00060810u), // シ  katakana SHI  ink 10
  uvec2(0x003c0000u, 0x00007f00u), // ニ  katakana NI  ink 11
  uvec2(0x02020202u, 0x003e0202u), // L  latin L  ink 11
  uvec2(0x0808081cu, 0x001c0808u), // I  latin I  ink 11
  uvec2(0x0808083eu, 0x00080808u), // T  latin T  ink 11
  uvec2(0x0810203eu, 0x00040404u), // 7  digit seven  ink 11
  uvec2(0x1c2a0800u, 0x0000082au), // *  asterisk  ink 11
  uvec2(0x10107f00u, 0x00081010u), // ナ  katakana NA  ink 12
  uvec2(0x1020223eu, 0x00020408u), // ク  katakana KU  ink 12
  uvec2(0x2020407eu, 0x00040810u), // フ  katakana FU  ink 12
  uvec2(0x22222222u, 0x000c1020u), // リ  katakana RI  ink 12
  uvec2(0x22420202u, 0x00060a12u), // レ  katakana RE  ink 12
  uvec2(0x44242800u, 0x00414242u), // ハ  katakana HA  ink 12
  uvec2(0x0202221cu, 0x001c2202u), // C  latin C  ink 13
  uvec2(0x2040427eu, 0x00040810u), // ワ  katakana WA  ink 13
  uvec2(0x20427e08u, 0x00040810u), // ウ  katakana U  ink 13
  uvec2(0x040c1424u, 0x007c0404u), // ヒ  katakana HI  ink 14
  uvec2(0x0c08103eu, 0x00402112u), // ス  katakana SU  ink 14
  uvec2(0x1020221cu, 0x003e0408u), // 2  digit two  ink 14
  uvec2(0x1810201eu, 0x001c2220u), // 3  digit three  ink 14
  uvec2(0x1e02023eu, 0x00020202u), // F  latin F  ink 14
  uvec2(0x20203e00u, 0x003e2020u), // コ  katakana KO  ink 14
  uvec2(0x24247e00u, 0x00020c10u), // ア  katakana A  ink 14
  uvec2(0x2c20223eu, 0x00040810u), // タ  katakana TA  ink 14
  uvec2(0x0810203eu, 0x003e0204u), // Z  latin Z  ink 15
  uvec2(0x087f003cu, 0x00040808u), // テ  katakana TE  ink 15
  uvec2(0x0e10207fu, 0x00101008u), // マ  katakana MA  ink 15
  uvec2(0x107f1212u, 0x00081010u), // サ  katakana SA  ink 15
  uvec2(0x22242424u, 0x00612122u), // ル  katakana RU  ink 15
  uvec2(0x22242830u, 0x0020203eu), // 4  digit four  ink 15
  uvec2(0x08083e00u, 0x007f0808u), // エ  katakana E  ink 16
  uvec2(0x207f003cu, 0x00060810u), // ラ  katakana RA  ink 16
  uvec2(0x2222221cu, 0x001c2222u), // 0  digit zero  ink 16
  uvec2(0x201e023eu, 0x001c2220u), // 5  digit five  ink 17
  uvec2(0x3c22221cu, 0x001c2220u), // 9  digit nine  ink 17
  uvec2(0x4244447cu, 0x00011922u), // カ  katakana KA  ink 17
  uvec2(0x18107f10u, 0x00191214u), // オ  katakana O  ink 18
  uvec2(0x1e02023eu, 0x003e0202u), // E  latin E  ink 18
  uvec2(0x2a2a3622u, 0x00222222u), // M  latin M  ink 18
  uvec2(0x3c20203eu, 0x003e2020u), // ヨ  katakana YO  ink 18
  uvec2(0x7f107f10u, 0x00040808u), // キ  katakana KI  ink 19
  uvec2(0x1c087f08u, 0x00084936u), // ホ  katakana HO  ink 20
  uvec2(0x2222223eu, 0x003e2222u)  // ロ  katakana RO  ink 20
);

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

  // How much of the mark is a character rather than a round splat, worked out here
  // because the discard below has to know about it and finished a long way down, where the
  // luminance the character index keys on finally exists.
  //
  // **The distance term multiplies into the master rather than clamping the sprite**, and
  // that is what protects the recession. A cell four metres from the sensor projects to
  // about six pixels, and an 8x8 bitmask sampled across six pixels is not a small
  // character - it is a different random set of bits every time the camera moves, which
  // bloom then amplifies. Clamping the sprite to a legible minimum would keep every cell
  // readable at any range, but far cells would stop being cell-sized and start
  // overlapping, which collapses the perspective recession at depth into exactly the flat
  // screen grid this design was chosen over. So the mark stops trying to be legible and
  // the geometry never stops being true, and it does it by reusing the blend the master
  // already is rather than adding a mechanism that could go out of step with it.
  //
  // The two ends are the font's own sampling limits: at 8 the 8x8 grid gets one pixel per
  // font cell, which is where the bits start aliasing into speckle, and at 16 it gets two
  // and the character resolves. The design document says the fallback is somewhere below
  // about ten pixels, which is inside this band rather than at either end of it.
  //
  // **What the two numbers are pixels *of* is the whole of what the vertex stage works out
  // above**, and it is neither of this renderer's two existing references on its own. Below
  // 1080 they are framebuffer pixels, because aliasing is a fact about the samples that
  // exist and a mark cannot resolve on texels it does not have. At and above 1080 they are
  // reference pixels, because the boundary between text and texture is a property of the
  // look and a 4K export has to draw the same picture the grade was made on. The band is
  // therefore stated once and read against whichever limit is nearer.
  float glyphMix = glyph * smoothstep(8.0, 16.0, vLegiblePx);

  // Additive mode shapes the sprite purely with alpha falloff. Skipping the
  // discard keeps Apple's tile-based hidden-surface removal working.
  //
  // **The disc the hard-edged branch cuts would take the corners off a character**, so it
  // is asked about the glyph first. At a glyphMix of exactly zero - which is every value of
  // every look that does not draw characters, because the master multiplies - the condition
  // collapses to the test that has always been here and the executed path is literally the
  // old one, discard and then smoothstep. Above zero the sprite keeps its corners, and what
  // shapes it is the bitmask rather than the disc.
  float falloff;
  if (softEdge == 1) {
    falloff = exp(-r2 * 9.0);
  } else {
    if (glyphMix <= 0.0 && r2 > 0.25) discard;
    falloff = smoothstep(0.25, 0.02, r2);
  }

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
  if (thermal > 0.0) {
    // Luminance where there is a colour camera, depth where there is not. A thermal
    // picture is a reading of a signal, and with the colour stream off the only signal
    // left is range - falling back to a flat tint instead would be a slider that
    // appears to work and is showing nothing.
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    float heat = hasColor == 1 ? lum : 1.0 - t;
    col = mix(col, heatRamp(clamp(heat, 0.0, 1.0)), thermal);
  }

  if (edges > 0.0) {
    // vEdge is the neighbour spread the vertex stage already computed for the
    // speckle test, so an edge-only reading costs a mix rather than a second pass.
    float e = pow(vEdge, 0.6);
    col = mix(col, mix(vec3(0.02, 0.03, 0.05), vec3(0.82, 0.94, 1.0), e), edges);
    alpha *= mix(1.0, 0.05 + 0.95 * e, edges);
  }

  // The duotone, and it is the governing tonal transform rather than a tint over one:
  // the near pole runs toward black and the far pole toward hot, so a single term
  // produces both the depth-keyed palette and the near-black silhouette against a
  // burning core. The note beside the uniforms has why those are one parameter.
  //
  // It sits here, after the blend, for the reason thermal and edges above it do - a term
  // written into one reading is inert in every other, and is then exercised only by
  // whichever sweep arm happens to select that reading. And it sits *before* the glitch
  // flare below rather than after it, which is a decision rather than an ordering
  // accident: a torn band is emitted light, so it belongs on top of the tonal transform
  // and not underneath one that would crush it back toward black.
  //
  // Read off t, the point's position inside the near/far clip range, so the split is a
  // place in the room the way the crop faces are and not a fraction of a frame. The split
  // is where the two poles meet and moving it decides which half of the room the subject
  // falls in.
  //
  // **How wide the ramp is either side of that is a distance rather than a share of the
  // box**, which is what duotoneSpan buys and why the division below exists. t is already
  // normalised by the clip range, so a ramp stated in t is a ramp whose metres change
  // every time a crop face moves - the grade would follow the framing, and shutting the
  // far plane to steepen the toning would be the only way to steepen it. Dividing the span
  // by the range converts metres back into t's units at the width the look asked for, and
  // the long note beside the uniform carries what that was measured to cost.
  //
  // Guarded, and the shape was measured rather than chosen. Both shapes are arithmetically
  // clean here, which is not obvious and is worth writing down: a mix at zero is a plus
  // zero times b minus a, which is exact whether or not the compiler contracts it, where
  // the mix at one this file guards elsewhere is the one that is not. So the question was
  // never the identity but what a branch does to the contractions either side of it, which
  // the flare below records going the surprising way. Measured here, guarded, against the
  // pinned pre-registry build: readRgb, readDepth, readContour and readBlackwall all came
  // back bit-identical over six frames, and readGhost reproduced its own pre-existing
  // failure unchanged - the same two frames, 2 and 3, and the same pair of hashes
  // 55d01311394e against 36fb79d8fa45. That last part was the half that mattered, because
  // a row already red is where a new perturbation would hide.
  //
  // **That standing failure has since been measured and it was never this file's.** The
  // two frames differed by one byte of 1,024,000, by exactly 1 - one channel of one
  // fragment landing the other side of a rounding boundary between two independently
  // compiled builds, which is the same contraction effect the flare below records rather
  // than a term. registry-check's section 1b compares pictures now, with the threshold
  // derived from that noise at one end and from ghost-alpha-term-dropped at the other,
  // no backticks in this comment on purpose - it sits inside the GLSL template literal,
  // and one here ends the shader. That is the seventh time in this repo,
  // which moves 187k bytes by 47. So the row is green at baseline and a re-measurement
  // like this one no longer has to reason around a red row while doing it.
  if (duotoneDepth > 0.0) {
    vec3 cold = hueSpin(vec3(0.020, 0.030, 0.075), duotoneHue);
    vec3 heat = hueSpin(vec3(1.000, 0.380, 0.120), duotoneHue);
    float w = duotoneSpan / max(0.001, farClip - nearClip);
    float k = smoothstep(duotoneSplit - w * 0.5, duotoneSplit + w * 0.5, t);
    // The motion half of the same transform, and it is the same two poles rather than a
    // second palette laid over them: depth decides where the room falls between cold and
    // hot, and this pushes whatever is moving through the room toward the hot end of it.
    // That is the reading the depth key on its own cannot draw - a subject and the wall
    // behind it are graded by where they stand, so a person walking through a scene is
    // exactly as cold as the air they walk through until something keys on the walking.
    //
    // Toward 1 rather than added to k, so a point at the hot end cannot be pushed past
    // it and the term has its room where the picture is near-black, which is where a
    // subject usually is. The far half of the room is already hot and has nothing to
    // gain, which is right: motion is only news against the pole it is not at.
    //
    // **1200 mm/s is the speed at which a point reaches the pole**, and it is baked for
    // the reason the two poles themselves are - a look parameterises how much of a ramp
    // it wants, not the ramp. It is about the axial speed of somebody walking straight
    // at the sensor at an ordinary pace, so the pole belongs to a person crossing the
    // room rather than to a hand. Measured over the sample capture: the 99th percentile
    // of a nearly-static stretch is 430 mm/s and the fastest sample in five pairs is
    // about 1900, while a take with somebody moving through it runs a median of 286 and
    // a 90th percentile of 1082.
    //
    // **The sensor's jitter is a displacement rather than a speed, so what it reads as
    // here depends on how fast the frames arrive**, and that is worth knowing before
    // trusting any threshold in these units. Measured on the same capture at two
    // spacings: the median sample moves about 4mm whichever pair you take, which is 31
    // mm/s across the 128ms pairs registry-check pins and about 140 mm/s across the
    // capture's own 32ms ones. Real movement is a fixed speed and reads the same at both,
    // so this estimator gets noisier as the link gets faster - which is a property of
    // measuring a rate from two adjacent samples and not something a constant fixes.
    //
    // No floor under it, and that is measured rather than assumed. A smoothstep has zero
    // derivative at the origin, which is most of the suppression on its own: on a wall
    // planted flat at 1100mm with this amount at 1 and the depth at 1, driven through the
    // editor at 1280 wide rather than through the check's own stage, mean red over the
    // frame goes 7.83 still, 7.90 with 4mm of jitter across a 128ms pair, 8.76 with the
    // same 4mm across a 32ms one, and 22.84 at a real 600 mm/s. So even at the frame rate
    // where the jitter
    // reads loudest it costs about one 8-bit step against fifteen for the signal. A floor
    // would have to be stated in one unit or the other and neither is right at both
    // spacings - in mm/s it would need re-tuning per link, which is what dividing by the
    // span exists to stop, and in millimetres it would let a slow surface register over a
    // slow link and vanish over a fast one.
    //
    // A duotoneMotion of 0 is exactly the picture this block drew before the term
    // existed. mix at zero is x times one plus y times zero, or x plus zero times the
    // difference, and both are exact whether or not the compiler contracts them - which
    // is the same arithmetic the guard comment above this block records measuring, and
    // it is measured again rather than inherited: the comparison is in registry-check's
    // planted-motion section, where a frame with a fast point in it and a frame with a
    // still one have to come back bit-identical while this sits at its default.
    k = mix(k, 1.0, duotoneMotion * smoothstep(0.0, 1200.0, vSpeed));
    col = mix(col, mix(cold, heat, k), duotoneDepth);
  }

  // Torn bands flare cyan where the feed shears - and it sits here, after the blend,
  // for the reason thermal and edges two blocks up sit here. This line used to live
  // inside the Blackwall branch, which made it inert in the other four readings while
  // the displacement that earns it kept firing in all five: the geometry tore under
  // Colour and Depth and nothing lit up, so a slider that plainly worked in one reading
  // looked broken in the rest. Worse than inert, it was coupled to something nobody
  // asked it to be - the readings normalise by their weight sum, so a dissolve from
  // Blackwall into Depth dimmed the corruption on the way past and the flare rode the
  // colour crossfade.
  //
  // Moving it changes what the Blackwall preset draws, because inside the branch the
  // flare was multiplied by that reading's 0.55 + 0.75 * lum shading before the
  // normalisation reached it. glitchTint was given a default of 1.8 to absorb that,
  // rather than carrying 3.0 over, on the grounds that a term reconstructing the old
  // inside-the-branch arithmetic would be a second implementation of this line.
  //
  // **That default is worse than the literal it replaced, measured on the reading the
  // shipped preset actually uses.** Against the pinned build on readBlackwall at the
  // shipped glitch of 0.18: 1.8 lands 30 of 255 off at worst with a frame mean of 0.0391,
  // where 3.0 lands 5 off with a mean of 0.0062, and 0 and 5.0 are worse than either. No
  // constant can match exactly, because the multiplier it is standing in for varied per
  // fragment - but the ordering is not close, and the number was chosen without this
  // comparison being run. Colour only, no alpha term: that is what the
  // old line did, and an additive splat shows a brighter colour without being asked to
  // cover more.
  //
  // Unconditional, and the missing guard on vGlitch is a measurement rather than an
  // oversight. Guarded, this line reddened three of registry-check's five reading rows
  // against the pinned pre-readings build - readDepth and readContour at frame 4 and
  // readBlackwall at frames 0 and 1 - at parameter defaults, where glitch is 0 and the
  // guard means the add never runs at all. Nothing mathematical moved: adding zero is
  // exact, and the branch was never taken. What moved was the code around it, because a
  // branch dropped into the common path costs the compiler contractions it was making
  // across the lines either side. Written straight through, all five rows are bit-identical
  // again and only the pre-existing readGhost failure remains. So the cost of a fragment
  // being able to skip a multiply-add it does not need is three false regressions in a
  // check with no tolerance and no way to re-baseline, and the multiply-add is cheaper.
  //
  // **The readGhost failure named above was the same effect as the three, and it has since
  // been measured rather than lived with**: one byte of 1,024,000 differing by exactly 1,
  // which is one fragment rounding the other way between two independently compiled
  // builds. Section 1b compares pictures now, so "a check with no tolerance" is no longer
  // the situation - but the conclusion above stands unchanged, because a tolerance sized
  // to admit one byte at one step admits nothing like the three regressions that
  // paragraph is about, and writing the multiply-add straight through is still cheaper
  // than reasoning about what a branch did to the contractions around it.
  col += vec3(0.2, 0.9, 1.0) * vGlitch;

  // **The rain, which is a colour term rather than a property of the alphabet.** It sits
  // here for the reason thermal, the edges and the duotone above it do - a term written
  // into one reading is inert in every other one - and it is a term of its own rather than
  // a setting inside the glyph field because the brightness *is* the effect. What the
  // reference clips show carrying the picture is a drop head descending a column with a
  // trail of afterglow above it; scrambling on its own is invisible, since which character
  // a cell draws is noise either way. Filed inside the glyph field, a wave descending
  // through the room would have been unreachable for any look that was not drawing text -
  // including voxel, which now gets it for nothing.
  //
  // It is below the flare rather than above it so that the line the flare's own comment
  // measured keeps the neighbours it was measured beside, and because a torn band is
  // emitted light: the rain lifts what the cell actually draws, flare included, and the
  // tone key one block down reads the same colour the frame gets.
  //
  // vRain counts whole drops, so its fraction is how far above the last head this point
  // stands as a share of the span, and the trail arrives in metres and is converted into
  // that same share. **The trail sits above the head and not below it**, which is what
  // makes the wave read as falling rather than as a band sliding through: the lift is 1 at
  // the head and decays upward over rainTrail metres, and a point just under a head is a
  // whole span below the next one and so is dark.
  //
  // Unconditional and written straight through, on the flare's own measurement above: at a
  // rain of 0 the multiplier is exactly 1.0 whether or not the compiler contracts it, where
  // a branch dropped into this path costs contractions across the lines either side of it.
  float rainLift = 1.0 - smoothstep(0.0, rainTrail / rainSpan, fract(vRain));
  col *= 1.0 + rain * rainLift;

  // **Which character this cell draws.** Decided here rather than in the vertex stage
  // because one of the three keys does not exist up there: the tone key is the luminance of
  // the colour the cell is about to draw, which is the line above this one. Nothing is lost
  // by the move - the cell seed and the rain coordinate are both constant across a sprite,
  // so the character is too.
  //
  // **The three keys add and wrap rather than mixing the way the five readings do**, and
  // the difference is forced rather than stylistic: character indices do not average.
  // Character 3 blended half and half with character 9 is character 6, which is an
  // unrelated symbol rather than anything between the two. A sum wrapped into the table is
  // the only composition that leaves each weight meaning how far it moves the character,
  // and it keeps the property the readings have, that a weight at zero contributes exactly
  // nothing.
  //
  // **The tone key is scaled by 63/64 where the other two keep the pure wrap**, and that
  // departs from the design document, which writes all three the same. Luminance is the one
  // key with a direction: the table is sorted by ink, so a tone ramp is only a ramp if full
  // luminance lands on the densest character. Unscaled it lands on fract(1.0), which is 0
  // and therefore the sparsest, so the brightest point in the picture would draw an
  // apostrophe and the top of the ramp would read as a hole in it. The hash and the rain
  // are not scaled, because wrapping is exactly what makes them look like noise.
  //
  // The luminance is clamped for the same reason the scaling exists. col can leave the unit
  // interval - the readings sum, the flare adds, and a duotone pole is hot - and an
  // unclamped tone term would carry the top of the ramp round to the sparse end again.
  //
  // The rain key reads whole heads gone past rather than the continuous coordinate, because
  // a character index that blends is a character nobody wrote. It is multiplied by the
  // golden ratio rather than used raw, and that is not decoration: at a weight of 1 an
  // integer counter contributes exactly nothing, since the fract of a whole number is zero,
  // so the one setting where the key should be strongest is the one where it would be
  // inert. An irrational step walks the table without repeating, which is what a scramble
  // has to do.
  if (glyphMix > 0.0) {
    float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    float rainStep = floor(vRain) * 0.6180339887498949;
    float f = fract(glyphTone * lum * (63.0 / 64.0) + glyphHash * vCellSeed + glyphRain * rainStep);
    // Guarded rather than trusted. fract is below 1 by definition, but a value arriving at
    // exactly 1.0 through a rounding would index one past the end of the table, and reading
    // a constant array out of range in GLSL is undefined rather than an error - so the one
    // way this could go wrong is also the way nothing would report it.
    int idx = min(int(f * 64.0), 63);
    uvec2 g = GLYPHS[idx];
    // gl_PointCoord runs from the sprite's upper left, which is where row 0 and column 0 of
    // the bitmask are, so the two grids line up without a flip anywhere. Sampled across the
    // whole 8x8 box rather than across the ink: the clear eighth row and column are the
    // margin, and cropping to the ink would be a parameter for something the font already
    // says.
    uint gc = uint(clamp(gl_PointCoord.x * 8.0, 0.0, 7.0));
    uint gr = uint(clamp(gl_PointCoord.y * 8.0, 0.0, 7.0));
    uint bits = gr < 4u ? g.x >> (gr * 8u + gc) : g.y >> ((gr - 4u) * 8u + gc);
    // A hard cut rather than an antialiased one, and the crossfade above is why it can be.
    // The mark is already blending back toward the round falloff wherever it is too small
    // to resolve, so softening the bits as well would be a second legibility mechanism
    // doing the first one's job - and the two would then have to be kept in step.
    falloff = mix(falloff, (bits & 1u) == 1u ? 1.0 : 0.0, glyphMix);
  }

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
`;
