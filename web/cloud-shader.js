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
// slider's write on every frame it is animated. Measured across the split: 76 declared
// here, 76 keys there, and the two sets are equal both ways. That equality is a fact
// about today rather than something this file can hold, so a term added to one side
// belongs in the same commit as the other.

export const vertexShader = /* glsl */ `
precision highp float;
precision highp usampler2D;

uniform usampler2D depthPrev, depthCurr;
uniform sampler2D stateTex;
uniform vec2 focal, center, resolution;
uniform float bufferHeight;
uniform float pointSize, nearClip, farClip, time, edgeTol;
uniform float cropL, cropR, cropB, cropT, cropOn, cropOutside;
uniform float noise, noiseScale, noiseSpeed;
uniform float lattice, latticeCell;
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
out float vGhost;
out float vFade;
out float vMask;
out float vSpeed;

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
  gl_PointSize = clamp(pointSize * k / max(0.15, -mv.z), 1.0, 64.0);
  // Carried in reference pixels rather than framebuffer ones, because the fragment
  // shader normalises a splat's additive energy against its area. For the same
  // image at twice the size each point covers four times the pixels, so it has to
  // keep the same alpha - normalising against the drawn size instead would make
  // the identical look sum four times too bright at twice the resolution.
  vSize = gl_PointSize / k;

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
uniform int hasColor, softEdge;

in vec2 vUv;
in float vDepth;
in float vEdge;
in float vGlitch;
in float vSize;
in float vGhost;
in float vFade;
in float vMask;
in float vSpeed;

out vec4 fragColor;

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

  // Additive mode shapes the sprite purely with alpha falloff. Skipping the
  // discard keeps Apple's tile-based hidden-surface removal working.
  float falloff;
  if (softEdge == 1) {
    falloff = exp(-r2 * 9.0);
  } else {
    if (r2 > 0.25) discard;
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
  // 55d01311394e against 36fb79d8fa45. That last part is the half that matters, because a
  // row already red is where a new perturbation would hide.
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
  col += vec3(0.2, 0.9, 1.0) * vGlitch;

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
  if (softEdge == 1) alpha *= clamp(116.64 / (vSize * vSize), 0.05, 1.0);

  fragColor = vec4(col * exposure, alpha * falloff);
}
`;
