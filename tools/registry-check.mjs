// Proves that one registry drives the renderer, and that the panel is a view on it.
//
// Four claims, and they fail for different reasons, so they are checked apart.
//
// A parameter has to *land*. Setting it through the registry must reach the place
// the renderer actually reads - a uniform, a pass property, a pass `enabled` flag,
// the draw range, the drawing buffer - and several parameters do more than set a
// uniform, so the side effects are checked as side effects rather than assumed to
// come along. The landing sites are written out here rather than asked of the
// page, because a registry reporting its own values back would agree with itself
// whatever it did with them.
//
// The panel has to be a *view*. Both directions: a slider event has to move the
// registry, and a registry write has to move the slider and its readout. And the
// HTML has to carry no parameter data at all - no value, min, max, step or checked
// on a registry-owned input - or the range lives in two places again and step 6's
// headless renderer reads the copy that is wrong.
//
// The values have to *round-trip through an image*. Serialise the registry, render
// a pinned run and hash it, restore from the serialised set, render again: the
// same pixels. That is the property steps 5, 6 and 7 all rest on, so it gets a
// falsification control - every parameter is left out of the restore in turn, and
// omitting one has to change the image. Without that, the equality above would
// pass just as well against a registry wired to nothing.
//
// And nothing may have *moved*. The two built-in mode presets and the boot state
// are compared against the committed page rather than against a table typed in
// here, by serving `git show <rev>:web/{index.html,main.js}` into a second load.
// A table would only restate what the new code does.
//
//   node server/index.js --port 8080 --replay captures/sample.knct &
//   node tools/registry-check.mjs --url http://localhost:8080

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { MessageParser, TYPE_FRAME } from '../server/protocol.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

// Everything the check reads about the repo is resolved against this file rather
// than against the working directory: the panel it inspects, the capture it pins,
// and the tree `git show` reads the before-arm out of. A tool that only runs from
// one directory is a tool that gets run from the wrong one.
const REPO = fileURLToPath(new URL('..', import.meta.url));

const URL_BASE = flag('--url', 'http://localhost:8080');
// The live recorder, which `/` served until the main menu took that path. Named
// once because the page is opened at it and the before-arm's markup is
// intercepted by it, and those two have to agree or the interception misses.
const RECORDER_PATH = '/record';
const CAPTURE = flag('--capture') ?? join(REPO, 'captures/sample.knct');
// Not HEAD: once step 3 is committed, HEAD is the registry and the before-arm would
// be comparing the tree against itself. And not a literal hash either, which is what
// this was until preparing the repository for release rewrote the history - stripping
// commit trailers with `git filter-repo` moves every hash after the first rewritten
// commit, so the pinned rev named nothing and the tool died inside `git show` with
// `invalid object name` before asserting anything. That exits non-zero and reads
// exactly like a check that ran and failed.
//
// A marker is content rather than identity, so it survives a rewrite. The refusal
// below stays the control: a search that resolved to the wrong commit trips it.
const BEFORE_REV = flag('--before') ?? revBeforeMarker('const PARAMS');

function revBeforeMarker(marker) {
  const introduced = execFileSync(
    'git', ['log', '-S', marker, '--format=%H', '--reverse', '--', 'web/main.js'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 },
  ).split('\n')[0].trim();
  if (!introduced) {
    throw new Error(`no commit in this history introduces ${JSON.stringify(marker)} to web/main.js`);
  }
  return `${introduced}^`;
}
// ------------------------------------------------------------------ mutations
//
// This file had no mutations for its whole life, and the rewrite that put the readings
// in the registry is what made that untenable. The blend is arithmetic in a shader
// compiled by a driver, and the two claims this tool now rests on - that a single
// reading is the identity and that a mix is a ratio - are precisely the kind that pass
// by construction when the instrument is pointed slightly wrong. A check nobody has
// broken on purpose is a check nobody knows the sensitivity of.
//
// Each entry names the row it must redden, and they are chosen to redden *different*
// rows: a mutation that fails everything cannot say which claim is load-bearing, which
// is the same reason `expand-shifts-by-a-block` exists beside `bind-ignores-grid` in
// monitor-check.
//
// **The clean tree is 145 passed, 0 failed, and every count below is a total against that.**
// This paragraph used to say the opposite. Section 1b renders this build against the revision
// before the registry, and that revision predates the discard that keeps a zero-alpha fragment
// out of the depth buffer - so for a while the five reading rows and the raster row stood red
// reporting 6 of 6 frames differing, at 460 to 750 bytes of 921600 with worst deltas of 191 to
// 250, and every list below was written as rows *beyond* those six. The arm was then handed the
// discard beside the unprojection's mirror it was already handing over, which is the right
// answer for an approved change a pinned build does not have: the rows kept their claim and
// went green, and `margins-miss-the-newborn` is the control that they still have teeth.
//
// **So the counts here were re-baselined after that re-pin, and they are stated as totals so
// the next drift is visible against a true baseline.** Several of them had also been carrying
// the wrong composition since long before it - a list naming five rows where four fire, or
// naming a neighbouring row that does not fire at all, each of which sends the next reader
// hunting a defect that is not there and is exactly as expensive as a missed catch. Every
// number below was measured on this tree rather than reasoned about, and where a list once
// predicted a row that does not fire, the prediction is recorded beside the measurement rather
// than quietly deleted - a mutation whose reach *shrank* is worth knowing about.
const MUTATIONS = {
  // Section 1b, the readRgb row and only that row. Alpha is the asymmetric half of this
  // blend and the place a rewrite of it actually breaks: three readings multiply
  // `alpha` and two do not, so the two that do not have to contribute a factor of
  // exactly 1.0 to the accumulator rather than nothing at all. A build that forgot
  // renders RGB completely transparent while every other reading stays correct.
  //
  // **This replaced a mutation that was caught for the wrong reason**, which is worth
  // recording because it is the failure this repo keeps producing in the direction that
  // looks like coverage. `blend-drops-alpha` removed the `* norm` from the alpha line
  // and claimed the three alpha-writing rows of 1b; measured, it left the whole of 1b
  // passing and reddened 8b instead - because at a single reading `norm` is 1.0 and
  // dropping a multiplication by 1.0 is not a mutation at all. It was a second, weaker
  // spelling of `mix-ignores-normalisation`, indistinguishable from it by the rows that
  // went red, so it could not tell anybody which claim was load-bearing.
  'rgb-contributes-no-alpha': {
    file: 'web/cloud-shader.js',
    edits: [[
      '    alphaFactor += readRgb;',
      '    alphaFactor += 0.0;',
    ]],
    fails: 'the readRgb row of 1b, alone - the other four readings are untouched',
  },
  // Section 1b, the readGhost row and only that row. The three alpha-writing readings
  // had their expressions moved verbatim out of the old branches, so what is at risk
  // there is transcription rather than arithmetic - and a check that compared only
  // colour would pass a build that dropped a term from one of them.
  'ghost-alpha-term-dropped': {
    file: 'web/cloud-shader.js',
    edits: [[
      '    alphaFactor += (0.25 + 0.75 * rim + 0.25 * lum) * readGhost;',
      '    alphaFactor += (0.25 + 0.75 * rim) * readGhost;',
    ]],
    fails: 'the readGhost row of 1b, alone - so 1b compares alpha and not just colour',
  },
  // Section 8b: the mix stops being a ratio while every single reading stays exactly
  // right, because dividing by 1.0 is what dividing by the sum already does when one
  // weight is 1 and the rest are 0. This is the mutation section 1b cannot see and the
  // whole reason 8b exists.
  'mix-ignores-normalisation': {
    file: 'web/cloud-shader.js',
    edits: [[
      'float norm = readSum > 0.0 ? 1.0 / readSum : 0.0;',
      'float norm = readSum > 0.0 ? 1.0 : 0.0;',
    ]],
    fails: 'the scale-cancels row of 8b, with every row of 1b still passing',
  },
  // Section 8's falsification sweep: one weight reaches no pixel. Dropping it from the
  // restore then changes nothing, so it lands in the no-effect bucket, which is a
  // failure unless the name is in the declared exceptions - and it is not.
  // Its reach widened when the readings grew constants of their own, and the record says
  // so rather than being left at the number it was caught with once: switching the ghost
  // block off takes `ghostRim` and `ghostFill` into the no-effect bucket with it, because
  // a per-reading term is only observable through the reading it belongs to. Three names
  // in that bucket rather than one is the right answer here, and a fourth would mean a
  // parameter had quietly become reachable only from ghost.
  'weight-ignored': {
    file: 'web/cloud-shader.js',
    edits: [[
      '  if (readGhost > 0.0) {',
      '  if (false) {',
    ]],
    fails: 'readGhost, ghostRim and ghostFill in the drop-one sweep, plus readGhost\'s 1b row',
  },
  // The duotone's amount reaches no pixel, and it takes the hue, the split and the motion
  // term down with it - the `weight-ignored` shape one block up, for the same structural
  // reason. All three are only observable through the block this switches off, so four
  // names land in the no-effect bucket and none of them is declared there. Four is the
  // right answer and a fifth would mean some other parameter had quietly become reachable
  // only through the duotone.
  'duotone-ignored': {
    file: 'effects-builtin/duotone/tone.frag.glsl',
    edits: [[
      '  if (duotoneDepth > 0.0) {',
      '  if (false) {',
    ]],
    fails: 'seven rows. The drop-one sweep names **five** - duotone.amount, duotone.hue, '
      + 'duotone.split, duotone.span and duotone.motion - and the count beneath it reads 81 of '
      + '89; the other five are the planted motion section losing its subject entire: the '
      + 'raised-speed row, the hot-pole direction row, the chequered per-point row, the '
      + 'half-moving mean row, and the span-widening row that keeps the section honest. '
      + '**This list said four names and two rows**; the span goes with the split for the '
      + 'structural reason above, and the planted section loses five rows rather than two '
      + 'because every one of them reads a colour this block no longer writes',
  },
  // The sharper half of the one above, and the reason both are kept: the duotone goes on
  // working as a flat tint, so `duotone.amount` still moves pixels and only the split stops
  // meaning anything. That is the difference between "the term is wired up" and "the term
  // is keyed on depth", and depth is the whole claim - a duotone that is not depth-keyed
  // cannot draw the silhouette this parameter exists for, which is exactly the shape of
  // failure that ships looking like a control that works.
  'duotone-ignores-depth': {
    file: 'effects-builtin/duotone/tone.frag.glsl',
    edits: [[
      '    float k = smoothstep(duotoneSplit - w * 0.5, duotoneSplit + w * 0.5, t);',
      '    float k = 0.5;',
    ]],
    fails: 'duotone.split and duotone.span in the drop-one sweep - the amount and the hue still '
      + 'reach pixels, and the span goes with the split because the ramp it widens is gone - '
      + 'plus the metre section\'s control row, since a ramp replaced by a constant cannot be '
      + 'widened either',
  },
  // The ramp's width promoted back to the literal it replaced, so the span is a slider that
  // lands in a uniform nothing reads. The plain shape, and the drop-one sweep is what sees
  // it: a parameter whose picture never changes when you take it away.
  'duotone-span-ignored': {
    file: 'effects-builtin/duotone/tone.frag.glsl',
    edits: [[
      '    float w = duotoneSpan / max(0.001, farClip - nearClip);',
      '    float w = 1.0;',
    ]],
    fails: 'duotone.span in the drop-one sweep - every other duotone term still reaches pixels, '
      + 'since the ramp goes on running at the width it had before this parameter - and the whole '
      + 'of the metre section, whose two invariance rows read a ramp that is once again a share '
      + 'of the box and whose control row cannot widen it',
  },
  // **The one that matters, and it is built so the sweep above cannot see it.** The span is
  // divided by a frozen 5.95 instead of by the clip range the picture is actually normalised
  // against - so at the default range the two are the same number, every image in the sweep
  // is bit-identical, and the parameter goes on proving it reaches pixels. What breaks is the
  // only claim this change makes: that the ramp is a distance. Move `far` and the mutated
  // build re-grades every point while the shipped one holds still, which is the coupling this
  // parameter was added to remove, reinstated in a form nothing that renders one range can
  // detect.
  'duotone-span-against-a-frozen-range': {
    file: 'effects-builtin/duotone/tone.frag.glsl',
    edits: [[
      '    float w = duotoneSpan / max(0.001, farClip - nearClip);',
      '    float w = duotoneSpan / 5.95;',
    ]],
    fails: 'the duotone span\'s two invariance rows, which render the same take at two clip '
      + 'ranges and hold the graded band still in metres - and nothing else, because at the '
      + 'default range this mutation is the shipped arithmetic',
  },
  // The speed never computed, so the motion half of the duotone has nothing to key on.
  // This is the plain one: a parameter whose slider moves, whose uniform lands and whose
  // pixels never change, which is what the drop-one sweep is for. It reddens the planted
  // section's motion rows too, and those are the rows that say the sweep is measuring the
  // speed rather than something else that moved with it.
  'vspeed-ignored': {
    file: 'web/cloud-shader.js',
    edits: [[
      '    vSpeed = paired ? abs(mmC - mmP) / spanSec : 0.0;',
      '    vSpeed = 0.0;',
    ]],
    fails: 'duotone.motion in the drop-one sweep and the proven-parameter count beneath it, '
      + 'plus the planted section\'s two motion rows - the one that says a planted pair moves '
      + 'the picture and the one that says it moves it toward the hot pole',
  },
  // **The one that matters.** The speed stops being divided by the pair's own gap, so it
  // is a per-frame difference wearing the name of a rate. Every picture still changes,
  // every uniform still lands, the drop-one sweep stays green, and a look graded at 30fps
  // renders differently over a degraded link - which is the one condition nobody grades
  // in. Nothing here could see it before the planted section existed, because both arms
  // of every comparison in this file run at the same frame rate by construction.
  'vspeed-unnormalised': {
    file: 'web/cloud-shader.js',
    edits: [[
      '    vSpeed = paired ? abs(mmC - mmP) / spanSec : 0.0;',
      '    vSpeed = paired ? abs(mmC - mmP) : 0.0;',
    ]],
    fails: 'the same-speed-over-two-spans row of the planted section, alone - the drop-one '
      + 'sweep stays green, and so do the two rows either side of it',
  },
  // The discontinuity half of the pairing test dropped from the speed and left on the
  // blend, so a ray that crossed a silhouette reports the distance to the wall behind the
  // subject as a speed. The fixture has 52 such samples in five pairs, which is far too
  // few for any hashed run over it to notice, so the only thing that can see this is a
  // pair planted across the threshold on purpose.
  'vspeed-ignores-the-gate': {
    file: 'web/cloud-shader.js',
    edits: [[
      '    vSpeed = paired ? abs(mmC - mmP) / spanSec : 0.0;',
      '    vSpeed = mmP > 0.0 ? abs(mmC - mmP) / spanSec : 0.0;',
    ]],
    fails: 'the row that says a jump past the snap threshold is a different surface, alone',
  },
  // The speed read off one fixed texel rather than the point's own, which is the failure a
  // uniformly-moving plant is invariant under - and asking what a fixture is invariant under
  // is the rule `docs/instruments.md` puts hardest. A wall planted at one speed renders
  // identically whether the varying is per point or a single number wearing a varying's name,
  // so the section grew a plant whose speed differs across the frame in order to have this
  // question at all. The blend keeps the point's own sample, so nothing about the geometry
  // moves and section 1b is untouched.
  'vspeed-reads-one-texel': {
    file: 'web/cloud-shader.js',
    edits: [[
      '    vSpeed = paired ? abs(mmC - mmP) / spanSec : 0.0;',
      '    vSpeed = paired ? abs(mmC - depthAt(depthPrev, ivec2(0))) / spanSec : 0.0;',
    ]],
    fails: 'the two chequered-plant rows of the planted section - the one that says the '
      + 'chequer is neither of the uniform frames and the one that says its mean red sits '
      + 'between them',
  },
  // The term made very slightly not-inert at its default, which is the control for the row
  // that says a motion of 0 draws exactly what the block drew before this term existed. That
  // row is an equality and equalities are the ones worth pointing a mutation at: nothing else
  // in this file can fail on a default that leaks, because every other comparison here either
  // has the term raised on both sides or has the block switched off entirely.
  'motion-leaks-at-zero': {
    file: 'effects-builtin/duotone/tone.frag.glsl',
    edits: [[
      '    k = mix(k, 1.0, duotoneMotion * smoothstep(0.0, 1200.0, vSpeed));',
      '    k = mix(k, 1.0, (duotoneMotion + 0.02) * smoothstep(0.0, 1200.0, vSpeed));',
    ]],
    fails: 'the motion-of-0-is-inert row, alone - every other row has the term raised on '
      + 'both sides or has nothing moving on either',
  },
  // The pair's gap replaced by the nominal one, which is a build that computes speeds
  // from a frame rate it assumed rather than from the frames it holds. Every picture
  // still changes and the sweep is green, because a speed scaled by a constant is still
  // a speed that reverting the parameter removes. The planted rows cannot see it either -
  // they write the span themselves, which is what makes this a probe that has to sit
  // somewhere else: on the real transport, against the times the drive reports.
  'spansec-nominal': {
    file: 'web/main.js',
    edits: [[
      '    return { steps, mixT: offset / span, sinceFrameSec: offset, spanSec: span };',
      '    return { steps, mixT: offset / span, sinceFrameSec: offset, spanSec: 1 / 30 };',
    ]],
    fails: 'the row that holds spanSec against the gaps between the pinned frames, alone',
  },
  // The unit conversion dropped, which is a defect no image comparison can see the shape
  // of: the poles still turn, the picture still changes, and every sweep row that asks
  // whether the slider reaches a pixel goes on passing. What separates the two builds is
  // the number at the uniform, so the landing row is the only thing that can fail here.
  //
  // **It anchors a branch of the shared applier now rather than this parameter's own
  // closure, and that costs it nothing.** The forty-one effect parameters are declared as
  // data in the effect manifests and `effectApply` in `web/main.js` is what turns a
  // binding into a write, so there is no `duotoneHue` line left to anchor. `degToRad` is
  // the transform of exactly one of the forty-one - this hue - so mutating the branch and
  // mutating the parameter are still the same act, and the row set below is unchanged.
  'duotone-hue-in-degrees': {
    file: 'web/main.js',
    edits: [[
      '    write = (v) => { table()[bind.uniform].value = THREE.MathUtils.degToRad(v); };',
      '    write = (v) => { table()[bind.uniform].value = v; };',
    ]],
    fails: 'the duotone.hue row of the one-at-a-time landing sweep, reporting "landed 47 want '
      + '0.8203047484373349", and the all-at-once row beside it - that second one is the same '
      + 'comparison over the whole set rather than a separate finding',
  },
  // The toe goes back to being the literal it was promoted from. Nothing about the
  // rendered default changes - that is the point, since the default *is* the literal - so
  // the only row that can see it is the drop-one sweep, where reverting a parameter that
  // reaches nothing changes no pixel.
  'crush-ignored': {
    file: 'web/grade-shader.js',
    edits: [[
      '      col = max(col - crush, 0.0) * 1.12;',
      '      col = max(col - 0.018, 0.0) * 1.12;',
    ]],
    fails: 'crush in the drop-one sweep, alone',
  },
  // The guard around the raster's default path removed, so the general form computes what
  // the old line computed instead of reaching it. Every value stays what it was and the
  // arithmetic is algebraically the same, which is the whole difficulty: a reader deleting
  // this branch as a redundant fast path would see nothing wrong, and the shipped Blackwall
  // document would start drawing a raster a hair off the one it was graded with.
  //
  // This control is also how the guard was justified rather than assumed. Run it and read
  // the raster row: red means the general form genuinely drifts and the branch is load
  // bearing, green means it does not and the branch should come out, because a fast path
  // that is bit-identical to the slow one is the second implementation this repo refuses.
  'raster-recomputes-the-default': {
    file: 'effects-builtin/raster/lines.grade.glsl',
    edits: [[
      '        if (scanAxis.x == 0.0 && scanAxis.y == 1.0 && scanPitch == 1.3 && scanHard == 0.0) {',
      '        if (false) {',
    ]],
    fails: 'the raster-at-0.35 row against the pinned build, and nothing else',
  },
  // The lattice switched off at its own guard: a cell that quantises nothing.
  //
  // **The drop-one sweep stopped being able to see this, and the reason is worth reading
  // before trusting the row set below.** This entry was written when the snap was the only
  // thing in the shader that read `lattice` and `latticeCell`. The glyph field gave both a
  // second path - the energy compensation crossing as `vCellNorm`, which is computed above
  // the snap and reads `lattice` directly, and the cell seed and sprite size, which read
  // `latticeCell` - and all of it sits outside the guard this mutation closes. So both
  // parameters go on moving the image with the snap completely dead, the sweep reports 86 of
  // 89 exactly as it does on a clean tree, and the row this entry was named for is green.
  // Measured rather than inferred: that is what the run prints.
  //
  // What still catches it is the planted glyph work at the foot of the file, which needs
  // one character per cell and therefore needs the snap. That is a real catcher and it is
  // in the wrong place - it is a claim about the glyph field standing in for a claim about
  // the lattice - so if the glyph field is ever removed this control loses its subject and
  // will come back caught on the streak fixture alone.
  'lattice-ignored': {
    file: 'effects-builtin/lattice/snap.vert.glsl',
    edits: [[
      '  if (lattice > 0.0) {',
      '  if (false) {',
    ]],
    fails: 'eight rows, and none of them is the drop-one sweep any more - see above. **All '
      + 'eight are the planted glyph sections**, which cannot draw one character per cell '
      + 'without the snap: the thinning equality, the turbulence control, the ripple and push '
      + 'control, the hash key\'s own ramp, both rows of the ink ramp, the two-surface '
      + 'section\'s box-against-ink guard and its far-surface guard. **The count was right and '
      + 'the composition was not**: this list used to give seven to the glyph sections and the '
      + 'eighth to the streak\'s 45-degree row, and measured, the streak row stays green while '
      + 'the two-surface section loses a second guard. A list that names the wrong eight is as '
      + 'expensive as one that names the wrong number, because the reader checks the names',
  },
  // The ripple switched off the same way.
  'ripple-ignored': {
    file: 'effects-builtin/ripple/wave.vert.glsl',
    edits: [[
      '  if (ripple > 0.0 && rw > 0.0) {',
      '  if (false) {',
    ]],
    fails: 'five rows. The drop-one sweep, naming ripple.amount, ripple.freq and ripple.speed '
      + 'unexplained, and the count beneath it at 83 of 89; the ripple-alone row, which is the '
      + 'one the gate is about; the clock row, since a ripple that is switched off renders the '
      + 'same frame either side of a step boundary; and the glyph section\'s hash-order row, '
      + 'which needs the ripple to move a point to tell "hashed before" from "hashed after". '
      + '**This list used to name the first and third of those and stop**, which read as two '
      + 'rows to anybody counting - the sweep is two rows rather than one, and the last two are '
      + 'planted fixtures losing their subject',
  },
  // The gate put back the way it was before the ripple existed, so the region weight is
  // only computed when one of the older three effects asks for it. **The drop-one sweep
  // cannot see this**: the scrambled set raises all four at once, so the weight is there
  // anyway and the ripple goes on working. Only the arm that raises it alone reddens.
  //
  // **It edits the assembler because the gate is no longer a line anybody wrote.** The
  // region's condition is generated from the `when` of every package consuming the service,
  // in `gateOrder`, so the state this control reproduces is the ripple's manifest declaring
  // no `consumes` at all - which is now the way a term goes missing. The manifest itself
  // cannot be the anchor: a package's declaration reaches the page inside the JSON
  // `/effects/:id` builds, and staging that would mean this tool rebuilding a route's answer
  // rather than serving a file's bytes. Dropping the same consumer out of the join is the
  // same three-term condition, delivered at `/shader-assembly.js`, which the page imports.
  // Held against the monolith mutated the old way: byte-identical vertex and fragment.
  'ripple-outside-the-gate': {
    file: 'web/shader-assembly.js',
    edits: [[
      "        out += consumers.map((c) => c.when).join(' || ');",
      "        out += consumers.filter((c) => c.id !== 'ripple').map((c) => c.when).join(' || ');",
    ]],
    fails: 'the ripple-alone row, and nothing else - the drop-one sweep stays green',
  },
  // The stepped clock made continuous, which is the term's whole character: a machine
  // rebuilding a surface rather than a thing breathing. The scrambled speed is deliberately
  // off the eighths it steps in, so the smooth phase lands somewhere the stepped one never
  // does rather than agreeing with it by luck at one instant.
  'ripple-clock-continuous': {
    file: 'effects-builtin/ripple/wave.vert.glsl',
    edits: [[
      '      float cycles = dist * rippleFreq - floor(time * rippleSpeed * 8.0) * 0.125;',
      '      float cycles = dist * rippleFreq - time * rippleSpeed;',
    ]],
    fails: 'the stepped-clock row, and nothing else - the drop-one sweep stays green',
  },
  // The band axis nailed back to the sensor's rows, which is what it was before this
  // control existed. Everything else about the tear goes on working - the same bands are
  // chosen at the same rate and shoved the same distance - so the only thing that can see
  // it is the drop-one sweep, where an axis reaching nothing changes no pixel when it is
  // reverted. A build that quietly lost it tears horizontally under a green run, which is
  // the whole of what this control was added to stop being the only option.
  'glitch-axis-ignored': {
    file: 'effects-builtin/glitch/tear.vert.glsl',
    edits: [[
      '      ? floor(mix(position.y, position.x, glitchAxis) / glitchBands)',
      '      ? floor(position.y / glitchBands)',
    ]],
    fails: 'glitch.axis in the drop-one sweep, alone',
  },
  // The streak switched off at its own guard, which is the plainest thing that can go
  // wrong with it: a term whose slider moves and whose uniform lands and whose pixels never
  // change. The drop-one sweep is where that shows, because reverting a parameter nothing
  // reads leaves the image where it was.
  'streak-ignored': {
    file: 'effects-builtin/streak/fall.grade.glsl',
    edits: [[
      '      if (streak > 0.0) {',
      '      if (false) {',
    ]],
    // Six rows and not the one this first claimed, taken off the run rather than
    // predicted - and it has grown twice, which is the argument for taking it off a run
    // every time rather than reasoning about it. The drop-one sweep names both `streak.amount`
    // and `streak.angle`, because a direction that reaches nothing is a parameter that
    // changes no pixel when it is reverted; the count beneath the sweep follows; and all
    // four rows of the direction section go, its guard first. **Three of those are the
    // fixture rather than the claim**: the pair rows compare the light two angles add, and
    // a term that adds no light at either end of a pair is not a term that pointed the
    // wrong way. The guard row is what tells them apart, and it reporting zero added
    // luminance is the whole reason it is there - without it the pair rows would be
    // differencing two empty images and could pass by arithmetic.
    fails: 'streak.amount and streak.angle in the drop-one sweep, the proven-parameter count '
      + 'beneath it, and all four rows of the direction section - the added-light guard '
      + 'reporting zero, and the three pair rows behind it, which are the fixture going '
      + 'rather than three findings about direction',
  },
  // The gather nailed back to straight down, which is what it was before the angle
  // existed. **This replaces `streak-climbs`**, which flipped the one sign there used to
  // be and cannot be written any more because the expression it anchored on is gone - and
  // the replacement is the stronger control anyway, because a build that has lost the
  // direction entirely also has the flipped one inside it at 180. Everything else about
  // the streak goes on working: the same taps at the same decay reaching the same
  // distance, so the term still bleeds light and the picture still moves.
  //
  // It is the sharper half of `streak-ignored` above in the same way `duotone-ignores-depth`
  // is the sharper half of `duotone-ignored`: that one asks whether the term is wired up at
  // all, this one asks whether it does the thing it is named for.
  'streak-ignores-angle': {
    file: 'effects-builtin/streak/fall.grade.glsl',
    edits: [[
      '          vec3 tap = texture2D(tDiffuse, vUv + d * texel * streakAxis).rgb;',
      '          vec3 tap = texture2D(tDiffuse, vUv + vec2(0.0, d * texel.y)).rgb;',
    ]],
    fails: 'streak.angle in the drop-one sweep and the proven-parameter count beneath it, '
      + 'and all three of the direction section\'s pair rows - a nailed build renders the '
      + 'same frame at every angle, so each pair differs by exactly nothing',
  },
  // The degrees-to-radians conversion dropped, which is a defect **no picture comparison
  // can see the shape of**: the streak still runs at an angle, the slider still moves it,
  // and every sweep row asking whether the parameter reaches a pixel goes on passing. It is
  // `duotone-hue-in-degrees` one block over, and the row that separates the two builds is
  // the landing sweep, where the axis is compared against the arithmetic written out in
  // EXPECT rather than against whatever the page did.
  // **Predicted to redden a direction row as well, and it does not - the prediction was
  // wrong and the threshold stays where it is.** The reasoning was that a radian-fed 180
  // points up and off to one side rather than straight up, so the 0-against-180 pair would
  // drift past the ceiling on how far across the angle its light may land. Measured, that
  // pair goes from 1.06% across 7.86% along on a clean build to 1.62% across 5.67%, which
  // is 0.29 of the distance travelled against a ceiling of 0.4: moved in the predicted
  // direction and not past it. Two reasons it cannot get there, and both are structural
  // rather than a matter of margin. The pairs are anchored at 0, where the sine of zero is
  // zero in either unit, so the one angle they all share is the one angle this mutation
  // cannot move. And the frame is wider than it is tall, so a sideways drift measured as a
  // fraction of the frame is worth about six tenths of the same drift measured vertically.
  //
  // Left as it is deliberately. Tightening the ceiling until this fired would put it at
  // 0.2 against a clean build sitting at 0.135, which is a gate adjusted to make a
  // prediction come true - the failure `docs/instruments.md` records twice, both times
  // arriving with a written justification that stopped anybody looking again.
  //
  // **This control got broader when the effect parameters became data, and the widening is
  // a real loss of resolution rather than a stronger check.** There is no `streakAxis` line
  // left to anchor: the forty-one are declared in the effect manifests and `effectApply`
  // in `web/main.js` builds the write, with `axisDeg` stated once for the two angles that
  // take it. So the anchor is that one branch, and mutating it feeds degrees to both
  // `streak.angle` and `raster.angle`. The name is kept because it is what
  // `docs/proof-tools.md` lists and what anybody reaching for this control types, but read
  // the row set below as a claim about the pair.
  //
  // What that costs is the thing this table is built to give: a mutation that reddens
  // *different* rows from its neighbours is how a run says which claim is load-bearing, and
  // this one can no longer separate the streak's unit from the raster's. Sharing the
  // arithmetic is still the right call - two copies of the same sum is the drift the whole
  // refactor removes - but the honest reading of a red run here is "an axis lands in the
  // wrong unit", not "the streak's axis does".
  'streak-angle-in-degrees': {
    file: 'web/main.js',
    edits: [[
      '      table()[bind.uniform].value.set(Math.sin(r), Math.cos(r));',
      '      table()[bind.uniform].value.set(Math.sin(v), Math.cos(v));',
    ]],
    fails: 'the streak.angle row of the one-at-a-time landing sweep, reporting "landed '
      + '[-0.097181906,0.995266636] want [0.920504853,-0.390731128]", and the all-at-once '
      + 'row beside it - that second one is the same comparison over the whole set rather '
      + 'than a separate finding. Nothing in the direction section moves: this is a unit '
      + 'error, and a streak running at the wrong angle is still a streak running at an '
      + 'angle. **And the raster.angle landing row with it**: the two angles share the one '
      + '`axisDeg` branch this now anchors, so the same wrong arithmetic reaches both - '
      + 'measured, raster.angle lands [0.1673557,0.985896582] against a want of '
      + '[0.891006524,0.4539905]. The repointing was first shipped with that row as a '
      + 'prediction, and the run confirmed it; the streak numbers above are unchanged '
      + 'because neither the test value nor the arithmetic moved',
  },
  // The raster's axis nailed back to the frame's y, which is what it was before the angle
  // existed. Everything else about the raster goes on working - the pitch still sets the
  // line frequency and the hardness still squares the wave - so the only row that can see
  // it is the drop-one sweep, where an angle that reaches nothing changes no pixel when it
  // is reverted. This is the vertical column grille the whole of D1 is for, so a build
  // that quietly lost it would be drawing television scanlines under a green run.
  'raster-ignores-angle': {
    file: 'effects-builtin/raster/lines.grade.glsl',
    edits: [[
      '          float coord = dot(vUv * ref, scanAxis);',
      '          float coord = vUv.y * ref.y;',
    ]],
    fails: 'raster.angle in the drop-one sweep, alone',
  },
  // The pitch back to the literal it was promoted from. Its default *is* that literal, so
  // nothing about the shipped picture moves - which is the point, and which leaves the
  // drop-one sweep as the only thing that can tell the two builds apart.
  'raster-pitch-fixed': {
    file: 'effects-builtin/raster/lines.grade.glsl',
    edits: [[
      '          float wave = sin(coord * scanPitch + time * 2.0) * 0.5 + 0.5;',
      '          float wave = sin(coord * 1.3 + time * 2.0) * 0.5 + 0.5;',
    ]],
    fails: 'raster.pitch in the drop-one sweep, alone',
  },
  // The duty cycle dropped, leaving the sine the term has always drawn. This is the
  // control that separates "the raster rotates and crowds" from "the raster is a grille",
  // and a build without it draws rotated softness at every setting - which looks like a
  // raster right up until you compare it against a reference frame.
  'raster-hard-ignored': {
    file: 'effects-builtin/raster/lines.grade.glsl',
    edits: [[
      '          line = mix(wave, smoothstep(0.5 - w, 0.5 + w, wave), scanHard);',
      '          line = wave;',
    ]],
    fails: 'raster.hard in the drop-one sweep, alone',
  },
  // The tempting edit, planted: `crush` joins the four terms that gate the grade pass, so
  // the pass runs whenever the toe is non-zero, which is always. This is deliberately not
  // a well-behaved control and the whole set has to be read rather than the count. It
  // reddens the pass-gate row it is aimed at; then it reddens all five reading rows of
  // section 1b, because every reading at its defaults is now drawn through a Reinhard
  // curve the pinned build never applied; and then the boot comparison, because all four
  // gating terms report their pass on where the pinned build has it off. Seven rows for
  // one fact, measured rather than predicted - the first draft of this line guessed the
  // boot failure would arrive as four separate landing rows and it arrives as one row
  // naming four terms in its detail, which is the sort of thing only a run settles.
  //
  // 1b's readGhost row used to be red in every run of this tool, and the note here used to
  // say so - it went from a standing 2 of 6 frames to 6 of 6, and the count was not the
  // reading because a row already failing is exactly where a new defect hides. That is
  // fixed rather than still true: the standing failure was one byte of 1,024,000 differing
  // by 1, which is two compilers rounding a fragment differently, and 1b compares pictures
  // now. All five of its rows are green at baseline, so all five reddening here is five
  // clean signals rather than four and a widening.
  // **The anchor moved when the gate stopped being a list**, and it plants the same defect
  // it always did: `crush` joining the terms that switch the pass on. The five names used to
  // be five hand-written lines here and are read off the packages' `gates` bindings now, so
  // there is no `rgbSplit` line left to add a disjunct to - and `crush` has no package to
  // carry a binding, which is the whole reason it is the term this control is about. So the
  // edit puts it in front of the derived test, which is exactly what a build that gated it
  // would compute.
  'crush-gates-the-grade': {
    file: 'web/main.js',
    edits: [[
      '  return GRADE_GATES.some(',
      '  return grade.uniforms.crush.value > 0 || GRADE_GATES.some(',
    ]],
    fails: 'seven rows: the pass-gate row for crush, all five reading rows of 1b (each at 6 of '
      + '6 frames and about three quarters of every frame), and the boot comparison, whose '
      + 'landing diff names rgbsplit.amount, raster.amount and grain.amount moving from '
      + '[0,false] to [0,true]. **`GRADE_GATES` holds five terms and this line used to say '
      + 'four** - grain, scanlines, rgbSplit, streak and vignette, derived from the packages\' '
      + '`gates` bindings rather than counted by hand, which is the whole point of deriving '
      + 'them: the boot row names the three whose landing actually moves, and the number of '
      + 'gates is a fact about the installed set rather than about this comment',
  },
  // The glyph field's master, switched off in **both** places it gates. One anchor is not
  // enough and the reason is the whole shape of this term: the vertex stage reads `glyph`
  // to grow the sprite into its cell and the fragment stage reads it again through
  // `glyphMix` to crossfade the mark, so a mutation at the vertex guard alone leaves every
  // character still being drawn at the old sprite size - a build that is visibly wrong and
  // in which all four parameters still reach pixels. Measured that way it is not a control
  // for anything.
  //
  // The three keys go with it for the structural reason `duotone-ignored` records: each is
  // only observable through the block this closes, so which character a cell would have
  // drawn cannot reach a pixel once no character is drawn at all.
  'glyph-ignored': {
    file: 'effects-builtin/glyph/size.vert.glsl',
    edits: [
      ['  if (glyph > 0.0) {', '  if (false) {'],
      ['  if (glyphMix > 0.0) {', '  if (false) {', 'effects-builtin/glyph/index.frag.glsl'],
    ],
    fails: 'twenty-two rows in total, on a tree that is otherwise green, counted out '
      + 'because a list that undercounts sends the next reader hunting a defect that is not '
      + 'there. **Two carry the claim**: the drop-one sweep, '
      + 'naming glyph.amount, glyph.tone, glyph.hash and glyph.rain unexplained, and the count beneath '
      + 'it at 81 of 89. **One is a neighbour**: the streak\'s right-angle row, which reads the '
      + 'scrambled set this mutation redraws. **Nineteen are the planted glyph sections losing their fixture** - '
      + 'the thinning section\'s guard and its equality, all three turbulence rows, both '
      + 'ripple rows, the index section\'s guard, its doubling row and its distinctness row, '
      + 'the hash ramp\'s strict row, the rain key\'s own row, the strict ink row, all three '
      + 'rows of the character two-surface section, the unit section\'s hard-bit reference row, '
      + 'the above-1080 section\'s companion arm, and the '
      + 'keys-move control. **This list said eighteen and nineteen fire**, and the one it left '
      + 'out is the above-1080 companion arm; that it fired before the discard was widened as '
      + 'well is a reading rather than a measurement - the mutation draws no character under '
      + 'either key setting, so the two arms are identical splats whatever the discard does - '
      + 'and it was not re-derived on the pre-widening tree, because this worktree was carrying '
      + 'other agents\' live runs at the time. That section\'s claim row is worth reading '
      + 'rather than counting: it goes red at 17 pixels of 9922 against the 19,765 of 75,239 '
      + '`glyph-margins-occlude` produces. **The 17 used to be written down here as the disc\'s '
      + 'own rim and they are not**, and the correction is recorded rather than quietly made: '
      + 'the rim is discarded outright on this build, and the number did not move by a pixel. '
      + 'What is left is bloom spreading the near cloud\'s own light past the pixels it drew '
      + 'on, which the comparison excludes by drawn pixel rather than by halo - a fixture that '
      + 'has lost its subject rather than a fault of any age. **One is a neighbour**: the '
      + 'streak\'s 90-degree '
      + 'row at 2.44/0.14, which reads the scrambled set this mutation emptied.\n'
      + '           The newborn section stays green throughout, correctly: its look draws no '
      + 'characters to begin with, so a mutation that stops characters being drawn is its '
      + 'shipped arithmetic.\n'
      + '           `bloom` is a fifth *name* inside the sweep row rather than a thirteenth '
      + 'row, and it is unexplained in both senses - why that pass in particular stops '
      + 'reaching a pixel here is a reading and not a measurement, presumably a frame with no '
      + 'characters in it having nothing left above the pass\'s own threshold. Recorded as the '
      + 'run printed it rather than as something anybody has confirmed.',
  },
  // The character keyed on the point rather than on the cell it fell in, which is the
  // difference between a room built out of code and a fog of it. The two are hard to tell
  // apart by eye and impossible to tell apart by "did the picture change": both draw
  // characters, both scramble when the hash weight moves, and the drop-one sweep is
  // satisfied by either.
  //
  // What separates them is that a per-cell identity does not depend on **how many** points
  // landed in the cell, and a per-point one does. Its near-twin is `vspeed-reads-one-texel`
  // one screen up, which asks the mirror question of the same fixture: that one plants an
  // asymmetry to prove a value is per point, this one plants a redundancy to prove one is
  // per cell.
  'glyph-hash-per-point': {
    file: 'effects-builtin/glyph/cell.vert.glsl',
    edits: [[
      '    vCellSeed = hash(dot(wc, vec3(127.1, 311.7, 74.7)));',
      '    vCellSeed = hash(dot(vec3(position.xy, 0.0), vec3(127.1, 311.7, 74.7)));',
    ]],
    fails: 'three rows. The claim is the thinning equality, at 1b30eba90301 against '
      + 'bc9087ff1fc0. With it go both of the turbulence section\'s claims - the noise one at '
      + '0.042/255 against a clean 11.565 and the ripple one at 0.000 against a clean 1.370 - '
      + 'and those are the mutation rather than two more defects: four hundred per-point '
      + 'characters overlaid in one cell cover the whole box, so exchanging a few of them '
      + 'moves nothing whichever displacement is doing the exchanging. The drop-one sweep '
      + 'stays green throughout, because a per-point hash is still a hash the weight reaches',
  },
  // **The defect the probe this design came out of actually shipped**, and it is the one
  // the spec says a drop-one sweep cannot see. The probe hashed the character off the point
  // after the turbulence had moved it, so the whole field boiled the moment noise, the
  // ripple or the region push left zero - and with all of them at zero, which is where a
  // sweep leaves them, the picture is bit-identical to the correct one.
  //
  // Written as the displacement inlined into the hash source rather than as the block moved
  // below the turbulence, because at the line it anchors on `pos` and `p0` are the same
  // vector - the cell is read before anything has moved the point, which is the fix - so
  // the one-token swap the design document imagines is a no-op. The expression is the same
  // one the noise applies fifty lines down, term for term, so the mutated build hashes
  // exactly the position the point ends up drawn at.
  'glyph-hash-on-the-displaced-point': {
    file: 'web/cloud-shader.js',
    edits: [[
      '    vec3 room = mat3(modelMatrix) * p0;',
      '    vec3 room = mat3(modelMatrix) * (p0 + (noise + regionNoise * rw) '
        + '* vnoise3(p0 * noiseScale + time * noiseSpeed * vec3(0.7, 1.13, 0.31)));',
    ]],
    fails: 'the row that says a character travels with its point through the turbulence, '
      + 'alone, and it collapses rather than drifting: 0.000/255 against a clean 11.537, with '
      + 'the control beside it still green at exactly 0. Nothing else moves - with the noise '
      + 'at zero, which is where every other arm in this file leaves it, this mutation is the '
      + 'shipped arithmetic',
  },
  // The same defect one displacement earlier, and it needs its own entry because the
  // fixture that catches the noise one cannot see it. `glyph-hash-on-the-displaced-point`
  // inlines the turbulence, and the ripple and the region push run *before* the turbulence
  // - so a build taking its hash between them renders bit-identically to a correct one in
  // every arm where those two sit at zero, which was every arm in this file.
  //
  // Both are inlined together rather than one at a time, and that is what makes the control
  // sharp instead of nearly sharp: the two share a radial direction, so a build hashing
  // after the pair hashes exactly the position the point is drawn at and every cell draws a
  // character that does not move, which is a picture the row can separate. Hashing after
  // the ripple alone would leave the push's offset between the two, and the cell a
  // character came from would drift against the cell it is drawn in.
  'glyph-hash-after-the-region': {
    file: 'web/cloud-shader.js',
    edits: [[
      '    vec3 room = mat3(modelMatrix) * p0;',
      '    vec3 room = mat3(modelMatrix) * (p0 + (rw > 0.0 && length(p0 - regionCentre) > 1e-4 '
        + '? ((p0 - regionCentre) / length(p0 - regionCentre)) * (regionPush * rw '
        + '+ sin((length(p0 - regionCentre) * rippleFreq '
        + '- floor(time * rippleSpeed * 8.0) * 0.125) * 6.2831853) * ripple * rw) : vec3(0.0)));',
    ]],
    fails: 'the ripple half of the turbulence section, alone: the row that says a character '
      + 'was hashed before the ripple and the push. Its control beside it stays green at '
      + 'exactly 0, so the two phases still hold every point inside its own cell and this is '
      + 'the characters going still rather than the geometry moving. The noise rows above it '
      + 'stay green, correctly - they run with the ripple and the push at zero, where this '
      + 'mutation is the shipped arithmetic',
  },
  // The three keys mixed rather than summed, which draws a completely plausible wrong
  // character in every cell. Nothing asking whether the frame changed can tell the two
  // apart, and the discriminator the design document proposes cannot either: at two keys
  // of half weight each the wrap-sum is `fract(0.5a + 0.5b)` and the normalising mix is
  // `(0.5a + 0.5b) / 1.0`, which is the same number, and the sum never exceeds 1 so the
  // wrap never fires. Both builds land on the same third character and both pass.
  //
  // What does separate them is scale, and it is section 8b's own row read backwards: a
  // ratio has no scale, so a mix renders the identical image when every weight is doubled
  // where a sum does not. This is the one property the two compositions cannot share.
  'glyph-index-averages': {
    file: 'effects-builtin/glyph/index.frag.glsl',
    edits: [[
      '    float f = fract(glyphTone * lum * (63.0 / 64.0) + glyphHash * vCellSeed + glyphRain * rainStep);',
      '    float f = (glyphTone * lum * (63.0 / 64.0) + glyphHash * vCellSeed + glyphRain * rainStep) '
        + '/ max(1e-4, glyphTone + glyphHash + glyphRain);',
    ]],
    fails: 'the row that says doubling two keys renders a different frame, alone - the guard '
      + 'and the solo-key control beside it stay green, because a mix still draws characters '
      + 'and still draws different ones for each key',
  },
  // The tonal key promoted to the zero it defaults to, so a cell's character stops knowing
  // how bright the cell is. The drop-one sweep sees this the plain way. The row it exists
  // for is the other one: the alphabet is sorted by ink so that a luminance ramp reads as
  // tone, and that ordering is a claim about the table nothing else in this suite asks
  // about - a build drawing characters from a shuffled table is a build whose tone key
  // draws noise, which is what the hash key is already for.
  'glyph-tone-ignored': {
    file: 'effects-builtin/glyph/index.frag.glsl',
    edits: [[
      '    float f = fract(glyphTone * lum * (63.0 / 64.0) + glyphHash * vCellSeed + glyphRain * rainStep);',
      '    float f = fract(0.0 * lum * (63.0 / 64.0) + glyphHash * vCellSeed + glyphRain * rainStep);',
    ]],
    fails: 'three rows: glyph.tone unexplained in the drop-one sweep, the count at 85 of 89, '
      + 'and the ink ramp\'s strict row at 1.55% to 1.55%. The non-decreasing row above it '
      + 'stays green and that is why the strict one exists - four equal readings satisfy '
      + '"non-decreasing" perfectly. Both source rows stay green too, correctly: this '
      + 'mutation does not touch the table',
  },
  // The falling wave switched off at both ends of it: the lift the colour stage applies,
  // and the whole-drop counter the glyph field's fourth key reads. One edit is not enough
  // in either direction. Killing the lift alone leaves `rain.speed` and `rain.span` reaching
  // pixels through the character scramble, and zeroing the coordinate alone leaves
  // `fract(0.0)` at the head of a drop, which is a lift of exactly 1 everywhere - a uniform
  // brightening that `rain` still controls.
  //
  // `glyph.rain` goes into the no-effect bucket with the four, on the `duotone-ignored`
  // terms: a key that reads the rain cannot be observed with the rain gone.
  'rain-ignored': {
    file: 'effects-builtin/rain/lift.frag.glsl',
    edits: [
      ['  float rainLift = 1.0 - smoothstep(0.0, rainTrail / rainSpan, fract(vRain));',
        '  float rainLift = 0.0;'],
      ['    float rainStep = floor(vRain) * 0.6180339887498949;', '    float rainStep = 0.0;',
        'effects-builtin/glyph/index.frag.glsl'],
    ],
    fails: 'nine rows. The claim: glyph.rain, rain.amount, rain.speed, rain.span and rain.trail '
      + 'unexplained in the drop-one sweep, with the count at 81 of 89. The rest is the '
      + 'fixture going with it - the trail section finds no head in the column at any phase, '
      + 'so all four of its rows go together: the guard, the afterglow row reading 0.0000 '
      + 'both sides, the walk\'s own guard, and the descent row with no walk to read. Then '
      + 'the span section\'s control cannot widen a gap that reaches nothing, and the '
      + 'defaults section\'s rain-raised control has nothing to raise, and the index '
      + 'section\'s rain-key row has no counter left to step - that key reads the drop '
      + 'coordinate this mutation zeroes',
  },
  // Which side of the head the afterglow sits on, flipped, and the heads left exactly where
  // they were. `fract(vRain)` is zero at a head and climbs upward through the span, so the
  // shipped lift is 1 at the head and decays over the trail *above* it; reading `1 - fract`
  // instead puts the same decay *below* it. Every head is in the same place, the pattern
  // still descends at the same speed, the same parameters still reach the same pixels - and
  // the wave reads as rising, which is the one thing this term is for.
  //
  // No row that asks whether the rain changed the picture can see it, because every sign
  // changes the picture. It takes a fixture that can say which way.
  'rain-trail-below-the-head': {
    file: 'effects-builtin/rain/lift.frag.glsl',
    edits: [[
      '  float rainLift = 1.0 - smoothstep(0.0, rainTrail / rainSpan, fract(vRain));',
      '  float rainLift = 1.0 - smoothstep(0.0, rainTrail / rainSpan, 1.0 - fract(vRain));',
    ]],
    fails: 'the row that says the afterglow is above the head, alone, and it reads as the '
      + 'exact mirror of the clean run rather than as a collapse: 0.0000 above the head and '
      + '0.5282 below, against 0.5363 above and 0.0000 below. The guard above it stays green, '
      + 'so the column still carries a drop and this is a direction rather than an absence',
  },
  // **The one that matters, and it is the mirror of `vspeed-unnormalised`.** The head gap
  // stops being metres of room and becomes metres per frame of whatever the link is doing:
  // at a 30fps stream the mutated expression is the shipped one exactly, so every picture
  // anybody grades is right, the drop-one sweep is green, and the look changes silently
  // over a degraded link. The fixture this repo ships was shot at about 9.3fps, which is
  // the condition nobody grades in and the one this row stands in.
  'rain-span-in-frames': {
    file: 'effects-builtin/rain/cell.vert.glsl',
    edits: [[
      '    vRain = (rainPhase * rainSpeed + room.y) / rainSpan + hash(dot(wc.xz, vec2(269.5, 183.3)));',
      '    vRain = (rainPhase * rainSpeed + room.y) / (rainSpan * spanSec * 30.0) '
        + '+ hash(dot(wc.xz, vec2(269.5, 183.3)));',
    ]],
    fails: 'five rows. The claim is the link-speed equality, 8d8414c35504 at 33ms against '
      + '074d7390ee19 at 111ms. The other four are the whole trail section, which is fixture '
      + 'rather than finding: it renders at the default quarter-second span, so the mutated '
      + 'divisor multiplies its head gap by seven and a half, no head is left inside the '
      + 'planted column, and its guard, its afterglow row, its walk guard and its descent row '
      + 'all go at once. The span section\'s own control stays green, because a gap divided by '
      + 'a frame gap is still a gap that widening moves',
  },
  // **The crossfade read in reference pixels alone**, which is the unit every other glyph
  // arm in this file agrees with and so the one none of them can refuse. It is not an
  // invented defect: it is what this branch shipped before the review, and it is the reading
  // a person reaches for first, because every other screen-space term here is in reference
  // pixels on purpose. What it costs is the fallback inverting at small buffers - a
  // sub-pixel sprite clamps up to one framebuffer pixel and divides back into fifteen
  // reference ones, so the far cloud draws one arbitrary bit of a character each instead of
  // a dot.
  'crossfade-reads-the-reference': {
    file: 'effects-builtin/glyph/mark.frag.glsl',
    edits: [[
      '  float glyphMix = glyph * smoothstep(8.0, 16.0, vLegiblePx);',
      '  float glyphMix = glyph * smoothstep(8.0, 16.0, vSize);',
    ]],
    fails: 'four rows, on a tree that is otherwise green. **Two carry the claim** and they '
      + 'are the two halves of it: the in-band '
      + 'cell coming back a hard bit at one colour, and the cut-away cell doing the same - '
      + 'vSize is taken before the halving as well as in the wrong unit, so this mutation is '
      + 'wrong about both. The hard-bit reference row above them stays green, which is what '
      + 'says the statistic still reads a one where it should. **Two are the two-surface '
      + 'section losing its fixture**, both guards: that section wants a far surface under '
      + 'the band drawing splats, and the reference reading puts it above at 30 pixels, so '
      + 'the far surface inks 1.71% of the frame instead of 41.42% and the at-risk '
      + 'population falls from 5875 to 264. Its claim row stays green, correctly - the near '
      + 'margins are still discarded. **This list said five and named a fifth that does not '
      + 'fire**: the streak\'s 45-degree row, predicted as a neighbour reading the scrambled '
      + 'set this mutation redraws. Measured, it stays green, so the mutation does not reach '
      + 'that fixture and the four above are the whole of it',
  },
  // **The counterpart of the one above, and the two are the two ends of one rule.** That one
  // reads the look's reference pixels and never the buffer's; this one reads the buffer's and
  // never the look's. Deleting the divisor is what the crossfade did between the review's
  // first fix round and its second, and it is the reading that looks most obviously right -
  // aliasing is a fact about texels, so count texels. What it costs is that the boundary
  // between text and texture stops being a property of the document: the same look that turns
  // to splats past four metres at 1080p holds characters to eight at 4K, and `renderScale`,
  // which is a view parameter and keyframes nothing, moves the graded picture.
  //
  // **No arm below 1080 can catch it**, and that is the point of the section it reddens
  // rather than a caveat on it: where the scale is under one the divisor is one and the two
  // expressions are the same text. Every other glyph arm in this file runs on a 360-tall
  // canvas, so the only thing that can refuse this is the arm that opens a page of its own.
  'crossfade-ignores-the-buffer-scale': {
    file: 'web/cloud-shader.js',
    edits: [[
      '  vLegiblePx = gl_PointSize / max(k, 1.0);',
      '  vLegiblePx = gl_PointSize;',
    ]],
    fails: 'the claim row of the above-1080 section, alone: the two key settings parting '
      + 'company at a cell the look asked to draw as a splat. Its guard row stays green - the '
      + 'buffer, the scale and the two readings are geometry and this mutation moves none of '
      + 'them - and so does the control beside it, because a cell above the band on both '
      + 'readings draws characters either way. Nothing else in the file moves at all, which '
      + 'is the coverage statement rather than luck: every other arm here renders at a third '
      + 'of the reference height, where the divisor this deletes is 1',
  },
  // The same reading taken one line too early, which is the half of it the crop owns. The
  // size is right and the unit is right; what is missing is the cut-away halving, so a
  // point drawn at half its pixels is crossfaded as though it still had all of them.
  // Written at the assignment rather than by moving it, so the anchor is one line and the
  // arithmetic is exactly the pre-halving value.
  'crossfade-before-the-halving': {
    file: 'web/cloud-shader.js',
    edits: [[
      '  vLegiblePx = gl_PointSize / max(k, 1.0);',
      '  vLegiblePx = (outsideCrop ? gl_PointSize * 2.0 : gl_PointSize) / max(k, 1.0);',
    ]],
    fails: 'the cut-away row of the unit section, alone. The in-band row beside it stays '
      + 'green, because nothing there is cropped and the two expressions are the same '
      + 'number - which is the split that says the crop half is its own claim rather than a '
      + 'second reading of the unit',
  },
  // **The rain key's counter used raw, which is inert at exactly the weight where it should
  // be loudest.** The key reads whole drops gone past, an integer, and the fraction of an
  // integer is zero - so at a weight of 1 a raw counter contributes nothing at all to the
  // index and the scramble stops. The golden ratio is what walks the table instead, and it
  // is the one term in this expression whose absence is invisible at every weight except
  // the one the slider tops out at.
  'rain-key-counts-whole-drops': {
    file: 'effects-builtin/glyph/index.frag.glsl',
    edits: [[
      '    float rainStep = floor(vRain) * 0.6180339887498949;',
      '    float rainStep = floor(vRain);',
    ]],
    fails: 'three rows, and it has two catchers because the scrambled set was moved onto this '
      + 'weight for it. The row that names it is the rain-key row of the index section - the '
      + 'key at exactly 1 drawing the picture it draws with the key at 0. Its nonblank guard '
      + 'stays green, because the frame is still full of characters; what has gone is the '
      + 'key\'s contribution to which ones. The other two are the drop-one sweep naming '
      + 'glyph.rain unexplained and the count beneath it at 85 of 89, which the sweep can only '
      + 'say because SCRAMBLE holds this key at 1 rather than at the 0.44 it used to - at any '
      + 'weight whose fraction is not zero a raw counter still scrambles and the sweep sees '
      + 'nothing wrong',
  },
  // **Which way the wave travels, negated, and nothing else about it touched.** Every head
  // stays a head, the trail stays above it, the gap stays metres of room and the speed
  // stays a speed - the pattern simply climbs. No row that asks whether the rain reached a
  // pixel, and no row that reads one frame however carefully, can see it: a still of rain
  // rising and a still of rain falling are the same kind of picture. It takes two phases.
  'rain-climbs': {
    file: 'effects-builtin/rain/cell.vert.glsl',
    edits: [[
      '    vRain = (rainPhase * rainSpeed + room.y) / rainSpan + hash(dot(wc.xz, vec2(269.5, 183.3)));',
      '    vRain = (-rainPhase * rainSpeed + room.y) / rainSpan + hash(dot(wc.xz, vec2(269.5, 183.3)));',
    ]],
    fails: 'the descent row of the trail section, alone. Its guard above it stays green - the '
      + 'head is still found at all four phases and still clear of both ends of the column - '
      + 'and so does the afterglow row, which is the whole point of the pair: the trail is '
      + 'still on the upper side of the head in a wave that is going the wrong way',
  },
  // **The repair for the zero-alpha occluders taken back out**, which is the build this
  // shader shipped before it: on the hard-edged path a fragment whose alpha comes out exactly
  // zero goes on writing depth, so the off bits of every bitmask, the whole sprite of every
  // point that has not faded in yet, and the disc's own rim all stand in front of the room as
  // invisible geometry.
  //
  // The whole statement is removed rather than its condition weakened, because the condition
  // is the fix. Anchored together with the line under it: the output statement appears once
  // and the discard once, and taking the pair as one anchor is what stops a future edit
  // between them being silently reinterpreted.
  'glyph-margins-occlude': {
    file: 'web/cloud-shader.js',
    edits: [[
      '  if (softEdge == 0 && alpha * falloff <= 0.0) discard;\n'
        + '  fragColor = vec4(col * exposure, alpha * falloff);',
      '  fragColor = vec4(col * exposure, alpha * falloff);',
    ]],
    fails: 'eight rows. **Two carry the claim**, one from each two-surface section: the '
      + 'character section\'s is the far surface moving under pixels the near marks never drew '
      + 'on; the newborn section\'s is the frame with an invisible cloud in it no longer being '
      + 'the frame without it. Every guard beside them stays green, because both fixtures '
      + 'still render and the sparse mark still leaves its box empty; what changes is only '
      + 'whether an empty box is a surface. Those two sections are the only planted ones that '
      + 'can see it, and that is the coverage they exist to state: every other planted section '
      + 'here stands one wall coincident with itself, where there is nothing behind anything to '
      + 'hide.\n'
      + '           **The other six are section 1b, and this line used to say "nothing else".** '
      + 'It was true when the golden arm compared against a revision with no discard at all: '
      + 'removing the discard made this build agree with that revision, so those six went '
      + '*green* under this mutation and the count came out below the clean tree\'s. The arm '
      + 'has been handed the discard since, so the old source now carries it too - and a '
      + 'mutation that takes it out of this build makes the two disagree, at 6 of 6 frames. '
      + 'The direction inverted with the re-pin and the sentence did not follow it, which is '
      + 'the specific way a re-pinned baseline rots the prose around it',
  },
  // **The same repair confined back to characters**, which is the one commit's worth of state
  // between the glyph field going in and the widening. It is the wrong fix that is hardest to
  // tell from the right one, because the section built for the glyph margins passes it
  // perfectly - the margins are exactly what it still discards - and the two older halves of
  // the class go on writing depth underneath.
  //
  // Its sibling one line further in is the same narrowing written the other way: a condition
  // reaching the rim and not the birth. Both are here because the fix is one expression and
  // the ways to get it nearly right are conditions bolted onto that expression; a section that
  // could only refuse the empty gate would accept either of them.
  'margins-confined-to-glyphs': {
    file: 'web/cloud-shader.js',
    edits: [[
      '  if (softEdge == 0 && alpha * falloff <= 0.0) discard;',
      '  if (softEdge == 0 && glyphMix > 0.0 && alpha * falloff <= 0.0) discard;',
    ]],
    fails: 'seven rows. **The claim is the newborn section\'s**, at 365 of 184184 pixels moved '
      + 'with all 365 behind a newborn sprite. Both guards beside it stay green - the plant is '
      + 'geometry and a condition does not move it - and so does every row of the character '
      + 'section next door, which is the whole point of this control: that section holds the '
      + 'glyph margins and cannot hold anything else, so a build that repaired only them reads '
      + 'clean everywhere it used to be read. That is what separates this from '
      + '`glyph-margins-occlude`, which reddens the character section\'s claim row as well.\n'
      + '           **The other six are section 1b, and this line used to say the opposite.** '
      + 'While the golden arm compared against a revision with no discard at all, the confined '
      + 'condition *was* that revision\'s arithmetic on presets that draw no characters, so the '
      + 'five reading rows and the raster row went green under this mutation and a reader '
      + 'counting reds had to know it. The arm carries the discard now, so the confined '
      + 'condition disagrees with it wherever the widening reaches, and the six redden at 6 of '
      + '6 frames. Read the frame count to tell the three margin mutations apart: this one and '
      + '`glyph-margins-occlude` move all six frames, `margins-miss-the-newborn` moves five',
  },
  // The same narrowing pointed at the other older half: a condition that reaches the disc's
  // rim and leaves a point that has not faded in yet writing depth. Written as a disjunct
  // rather than as a rewrite, so the anchor is the shipped line and the arithmetic on every
  // fragment except a newborn one is the shipped arithmetic.
  'margins-miss-the-newborn': {
    file: 'web/cloud-shader.js',
    edits: [[
      '  if (softEdge == 0 && alpha * falloff <= 0.0) discard;',
      '  if (softEdge == 0 && (glyphMix > 0.0 || falloff <= 0.0) && alpha * falloff <= 0.0) discard;',
    ]],
    fails: 'seven rows. The claim is the newborn section\'s, at the same 365 of 184184 - the '
      + 'two narrowings are indistinguishable on that fixture and that is correct rather than a '
      + 'gap, because on it every zero-alpha fragment is a birth. It is a separate control '
      + 'because it is a separate reachable mistake: this one is what a reader repairing the '
      + 'defect from the disc\'s end writes, and the fixture has to refuse both ends.\n'
      + '           **The other six are section 1b, and they are the one place in this suite '
      + 'the rim is visible at all.** That section renders this tree against a revision with no '
      + 'zero-alpha discard of any kind, so it sees whatever this condition reaches: the whole '
      + 'repair moves all six frames, five of them by 460 to 750 bytes of 921600, and a '
      + 'condition reaching the rim alone moves five of the six by 3 to 12. Both are past the '
      + 'tolerance - which asks for 64 bytes and a single step, and every one of these bytes is '
      + 'a couple of hundred - so the rows are red either way and the byte count is the reading '
      + 'rather than the verdict',
  },
  // The energy normalisation's floor put back, which is the state this branch found the
  // shader in. It looked harmless while a sprite was `pointSize`-sized, because 9 pixels
  // only reaches the floor within 19cm; growing the sprite to a cell moves the same
  // threshold out to about 1.32m, which is where a person stands, and past it the
  // normalisation has stopped scaling while the point count keeps climbing.
  //
  // **No shipped look can see it and neither can the sweep.** All nine documents sit at a
  // `pointSize` of 9 or below and `SCRAMBLE` at 9.5, so nothing this file renders anywhere
  // else gets near a `vSize` of 48. The section it reddens plants the condition instead:
  // one point, and a camera close enough to it that the sprite crosses the band.
  'normalisation-floor-restored': {
    file: 'web/cloud-shader.js',
    edits: [[
      '  if (softEdge == 1) alpha *= min(116.64 / (vSize * vSize), 1.0) * vCellNorm;',
      '  if (softEdge == 1) alpha *= clamp(116.64 / (vSize * vSize), 0.05, 1.0) * vCellNorm;',
    ]],
    fails: 'the energy-invariance row of the sprite-size section, alone, at a spread of '
      + '4.055 against a clean 1.046 and a band of 1.15 - the two arms past the floor carry '
      + '6391 and 13041 where every arm should carry about 3200. The guards either side stay '
      + 'green, so the sprites still render and still grow',
  },
  // The master made very slightly not-inert at its default, which is `motion-leaks-at-zero`
  // pointed at the term this branch adds to the shared fragment path. Eight of the nine
  // shipped looks draw no characters at all, so what protects their pixels is that `glyph`
  // at 0 multiplies the crossfade to exactly zero - an equality, and equalities are the
  // ones worth pointing a mutation at. Nothing else in this file can fail on it: section 1b
  // renders at defaults and would move on both arms, and every other comparison here either
  // has the master raised on both sides or is not looking at a character.
  'glyph-leaks-at-zero': {
    file: 'effects-builtin/glyph/mark.frag.glsl',
    edits: [[
      '  float glyphMix = glyph * smoothstep(8.0, 16.0, vLegiblePx);',
      '  float glyphMix = glyph * smoothstep(8.0, 16.0, vLegiblePx) + 0.02;',
    ]],
    fails: 'eight rows, and they are one fact arriving in three places. The row that names it '
      + 'is the glyph-of-0-is-inert equality in the defaults section. **Six are '
      + 'section 1b** - all five readings at 6 of 6 frames, plus the raster\'s cross-build row - '
      + 'because 1b renders at parameter defaults against a build that predates the glyph '
      + 'field, and a crossfade that is not exactly zero mixes a bitmask into every point of '
      + 'every one of those frames. That 1b can see this is worth knowing rather than '
      + 'trimming: it is the only comparison here with an oracle outside the build. **The '
      + 'eighth is the above-1080 section\'s governing row**, which asks that a cell under the '
      + 'band in reference pixels draws no character at a taller buffer either - a leak of 0.02 '
      + 'draws one there too, so the smaller of the two readings stops governing. This list '
      + 'said seven and eight fire; the one it left out is that row',
  },
  // The same shape on the other master. `col *= 1.0 + rain * rainLift` is written straight
  // through with no guard, on the flare's measurement that multiplying by a computed 1.0 is
  // exact in IEEE where a branch in a common path costs the compiler its contractions - so
  // the whole of what keeps a look with no rain in it byte-identical is that one
  // multiplier being exactly one. A term that leaked here would move all nine shipped
  // documents at once.
  'rain-leaks-at-zero': {
    file: 'effects-builtin/rain/lift.frag.glsl',
    edits: [[
      '  col *= 1.0 + rain * rainLift;',
      '  col *= 1.0 + (rain + 0.02) * rainLift;',
    ]],
    fails: 'twelve rows. The row that names it is the rain-of-0-is-inert equality, which sees '
      + 'the leak only because its arms hold the vertex gate open - see the comment there. '
      + 'Six more are section 1b\'s five readings and the raster cross-build row, for '
      + '`glyph-leaks-at-zero`\'s reason: a multiplier that is not exactly one moves every '
      + 'default-rendered frame. The last four are the glyph sections\' own equalities - the '
      + 'thinning row, the turbulence control, the ripple control and the ink ramp - which is '
      + 'the leak reaching them too, since those looks carry rain 0 with the glyph master up '
      + 'and so have a live drop coordinate for it to vary along. The twelfth is the unit '
      + 'section\'s hard-bit reference row, for the same reason stated the other way round: '
      + 'that row counts colours and a multiplier varying per point turns one into many, '
      + 'which is the failure its own comment predicts',
  },
  // The energy compensation as the design document writes it, which is the version without
  // the bound - and the bound is what makes it exactly 1 at `lattice` 0. `max(a, min(1, s))`
  // is 1 whenever a is 1; drop the `min` and the factor is `s` wherever the sprite is bigger
  // than the cell, which is reachable through the sliders at any lattice at all, so eight
  // of the ten shipped looks would be *brightened* by a correction that is supposed to be
  // absent from them.
  //
  // **It is not covered by the two rows above it**, and that is why it is here rather than
  // written off as arithmetic. The compensation is not a parameter and rides no master: it
  // multiplies alpha on the shared additive path at every value of everything, so neither
  // master being inert says anything about it. The row that catches it asks whether
  // `cell` can reach a pixel with the lattice at zero, which is the plainest
  // statement of "those eight documents render the frames they always did".
  'compensation-leaks-at-lattice-zero': {
    file: 'effects-builtin/lattice/energy.vert.glsl',
    edits: [[
      '  vCellNorm = max((1.0 - lattice) * (1.0 - lattice), min(1.0, spriteCells * spriteCells));',
      '  vCellNorm = max((1.0 - lattice) * (1.0 - lattice), spriteCells * spriteCells);',
    ]],
    fails: 'the cell-size-at-lattice-zero row of the defaults section, alone, at c4c44f0faac5 '
      + 'against 68f63ae52440. The control beside it stays green, so the two cell sizes still '
      + 'reach the picture with the lattice raised and this is the compensation failing to be '
      + 'one rather than a parameter going dark',
  },
};

const MUTATE = flag('--mutate');
if (MUTATE && !Object.hasOwn(MUTATIONS, MUTATE)) {
  throw new Error(`unknown mutation ${JSON.stringify(MUTATE)} - have ${Object.keys(MUTATIONS).join(', ')}`);
}

// A run that died is not a run that found something, and under `--mutate` the two are
// indistinguishable to anything reading the exit code: a Playwright page that dropped
// its execution context exits non-zero with nothing asserted, which reads exactly like
// a caught mutation. So a crash gets its own verdict and its own code.
//
// This is not hypothetical here. `rgb-contributes-no-alpha` and `ghost-alpha-term-dropped`
// both reddened their intended row and then died on `Target page, context or browser has
// been closed` on their first run, and both reproduced cleanly on the next - the same
// several-WebGL-pages flake `export-check` retries by name. Without this handler each of
// those would have exited non-zero having asserted the right thing for the wrong reason,
// and the two are indistinguishable from outside. Not retried here, deliberately: a
// check that retried would have to decide which failures are real, and the verdict line
// saying DID NOT RUN costs one re-run and no judgement.
process.on('unhandledRejection', (err) => {
  console.log(`\n[registry] DID NOT RUN - ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(2);
});
process.on('uncaughtException', (err) => {
  console.log(`\n[registry] DID NOT RUN - ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(2);
});

// The mutated module, served into every page this file opens. Refused when the anchor
// is not found exactly once, for the reason every other tool here refuses it: a
// replacement that silently matched nothing would run the unmutated page and be
// recorded as the check having missed a bug it was never shown. And a mutation is a
// piece of source text, so it stops matching the moment the code it names is edited -
// the refusal is what surfaces that rather than a silent pass.
// **The target comes off the spec rather than out of this function.** Every entry used
// to be a bare `{ from, to }` and the file was the literal `web/main.js` written here,
// which was true of all of them and true by coincidence rather than by declaration:
// `syntax-check`'s anchor row had to infer the same fact from the shape to check these
// anchors at all, and `docs/instruments.md` records that inference being wrong within
// days of being written. So the spec says where it edits, the way every other tool in
// the suite says it, and a mutation that moves to another file moves by editing its own
// entry rather than by this function learning a second path.
const mutatedSource = (() => {
  if (!MUTATE) return null;
  const spec = MUTATIONS[MUTATE];
  if (!spec) throw new Error(`unknown mutation ${MUTATE} - have ${Object.keys(MUTATIONS).join(', ')}`);
  const staged = new Map();
  const touched = [];
  const read = (rel) => {
    if (!staged.has(rel)) staged.set(rel, readFileSync(join(REPO, rel), 'utf8'));
    return staged.get(rel);
  };
  // **An edit may name its own file, and two edits of one mutation may name two.** The
  // third element of an edit pair is that file, defaulting to the spec's, which is the
  // shape `syntax-check`'s anchor row has always read and the shape `export-check` has
  // always staged - this file ignored it, which was true by coincidence right up until the
  // effects began carrying their own GLSL. `glyph-ignored` now switches the master off in
  // the glyph package's vertex chunk and again in its fragment chunk, and `rain-ignored`
  // spans two packages: the rain's own lift and the glyph field's index block, which is
  // where the rain key is read. A staging loop that read one file would have applied the
  // second edit to the first file, matched nothing, and refused - which is the loud
  // direction, but it would have refused a control that is perfectly well defined.
  for (const [from, to, where] of spec.edits) {
    const file = where ?? spec.file;
    const body = read(file);
    const hits = body.split(from).length - 1;
    if (hits !== 1) {
      throw new Error(`mutation ${MUTATE} matched its anchor ${hits} times in ${file}, not once: `
        + `${JSON.stringify(from)}`);
    }
    staged.set(file, body.replace(from, to));
    if (!touched.includes(file)) touched.push(file);
  }
  // The panel and the module, which this tool has always served as a pair because a
  // build's `PARAMS` throws at boot on a parameter with no control in the markup - and
  // beside them every file the spec actually edited, each at the URL a browser reaches it
  // by. For a spec naming `main.js` that third member is the same string as `js`; for one
  // naming a module `main.js` imports it is that module's own bytes; for one naming an
  // effect's chunk it is the text the page fetches out of `/effects/:id/file/:name` and
  // assembles its shader from.
  //
  // **This used to be the pair alone, and a spec naming a third file was refused outright**
  // with a note saying the pairing would be fixed when something needed it. Eighteen of the
  // entries below need it: the cloud's two GLSL programs are `web/cloud-shader.js` now, and
  // a refusal there is eighteen falsification controls that cannot run. What the refusal
  // was protecting against is real and is closed differently here - the staged edit used to
  // be discarded at this line while the mutant's path still resolved to the module's own,
  // so the interception fired on a request for that module and answered it with `main.js`'s
  // unmutated bytes, which reads as a delivered mutation and asserts about code nobody
  // wrote. Serving each file at its own path is what makes that impossible rather than
  // refused.
  return {
    js: read('web/main.js'),
    html: read('web/index.html'),
    mutants: touched.map((file) => ({ file, path: servedAt(file), body: read(file), type: contentTypeFor(file) })),
  };
})();

/**
 * Where a file this repo ships is reached from a browser.
 *
 * Matched on the whole pathname rather than with a `**​/name.js` glob, because a glob
 * on the basename is a claim about a filename where the server's rule is about a path -
 * two modules could end in the same name and the wrong one would be served without
 * anything failing. `timeline-check` carries the same function for the same reason;
 * this file keeps its own copy rather than importing one, the way every tool here
 * resolves its own `REPO` rather than sharing it.
 *
 * **The second branch is the effects' own GLSL, which the page fetches rather than
 * imports.** A chunk under `effects-builtin/<id>/<name>` has no URL of its own under
 * `web/`; it is answered by `/effects/:id/file/:name`, which is the route the boot in
 * `web/main.js` reads it out of before `assembleShaders` splices it into the point cloud's
 * material or the grade pass's shader - one route for both, since a chunk names the joint it
 * joins rather than the program it feeds. So
 * a mutation that edits a chunk is delivered at the fetch rather than at the module - and
 * from Playwright's side those are the same interception, because `page.route` sees a
 * `fetch` exactly as it sees a script tag. Everything else is a refusal: a spec naming a
 * file no browser asks for would install a route that never fires, which is the shape the
 * guard at the foot of this file is about.
 */
function servedAt(file) {
  if (file.startsWith('effects-builtin/')) {
    const parts = file.split('/');
    if (parts.length !== 3) {
      throw new Error(`${file} is not an effect package file - a chunk is <id>/<name> under effects-builtin/`);
    }
    return `/effects/${parts[1]}/file/${parts[2]}`;
  }
  if (!file.startsWith('web/')) {
    throw new Error(`${file} is not served to a browser, so a page mutation cannot reach it`);
  }
  return `/${file.slice('web/'.length)}`;
}

/**
 * What the server answers a file with, restated here because the interception has to
 * answer the same way.
 *
 * A chunk is served `text/plain` by `server/index.js` on the argument that what the tools
 * anchor and the client compiles is the file's own bytes; answering it as JavaScript here
 * would be this tool inventing a second promise about the same route, which is exactly
 * the kind of difference between a mutated arm and a clean one that gets read as a finding.
 */
function contentTypeFor(file) {
  return file.endsWith('.glsl') ? 'text/plain; charset=utf-8' : 'text/javascript; charset=utf-8';
}

// The route below used to be a bare `'**/main.js'` glob, true of every mutation this
// file carried at the time and true by coincidence: every entry in `MUTATIONS` named
// `web/main.js` then, so a glob on that basename happened to be a path. It stayed a
// coincidence right up until the tree it patches was about to stop being one file -
// at which point a mutation whose anchor moved into a neighbouring module would have
// gone on matching the glob's basename while matching no request any browser makes,
// which is silent in exactly the way `docs/instruments.md` keeps case files for. So
// the target is read off the mutation's own declared file, the way `timeline-check`
// reads it, and it is computed here rather than at every call site because every
// call site wants the same answer under `--mutate`: which file, if any, is the
// mutated one.
const MAIN_PATH = servedAt('web/main.js');
// Counted rather than assumed, and counted per file. A route that matches nothing
// fulfils nothing and throws no error - the page simply loads the tree's own source -
// so the only way to tell a mutation that was delivered from one that was never asked
// for is to watch the interception fire, and it has to be watched across every page
// this file opens under `--mutate`, not just the first: the after-arm, the pin arm and
// the panel arm all default to the current tree's source, and any one of them failing
// to ask for the mutated module would leave the others carrying a run that never
// happened.
//
// **Per file rather than in total, because a mutation now edits more than one.** A sum
// is satisfied by one of two chunks arriving, which is a half-delivered mutation
// reported as delivered - and the half that goes missing is the one whose route was
// wrong, so the total would be loudest exactly where it is least true.
const mutantServed = new Map((mutatedSource?.mutants ?? []).map((m) => [m.path, 0]));

const HEADED = argv.includes('--headed');
const SOURCE_FRAMES = Number(flag('--frames', '6'));
const STRIDE = Number(flag('--stride', '4'));
const SUBSTEPS = Number(flag('--substeps', '3'));

// 640x360 - 16:9, a shape `EXPORT_SIZES` actually offers a resolution for. This was
// 640x400 (8:5), which `restoreProject` refuses: `keyframe-check` died mid-run with
// "this project is framed at 8:5, which this build offers no resolution for" out of an
// undo restoring a snapshot the tool had put the editor into. This file never restores
// a project, so 8:5 never crashed it here, but it was still asking the editor to frame
// at a shape no document in this product can hold. 640x360 matches the menu's own
// default aspect, so the fit below has nothing to letterbox - the drawing buffer comes
// out at exactly the viewport's own shape, minus only the application bar.
const VIEW = { width: 640, height: 360 };
// The height the current editor gives its fixed application bar, and it is **measured
// off the page rather than declared here**. Historical comparison pages have no shell,
// so their viewport is shortened by the same amount to make both arms render the same
// content box rather than two different layouts - which means this number is not a
// note about the design, it is a term in the golden comparison. Written down as a
// literal it was 32 against a `web/nav.css` that says 38, and the two rows it feeds
// reddened with `renderScale: 589 -> 579` - a difference that is entirely this drift
// (`round(640 * (400-38)/400)` is 579) and reads exactly like the buffer regression
// the golden row exists to catch. So the after arm is opened first, the bar is
// measured, and the before arm is sized against what was measured.
let APP_BAR_HEIGHT = null;
let SHELL_CONTENT = null;
let COMPARISON_VIEW = null;
const shellGeometry = (barHeight) => {
  APP_BAR_HEIGHT = barHeight;
  SHELL_CONTENT = {
    width: Math.round(VIEW.width * ((VIEW.height - barHeight) / VIEW.height)),
    height: VIEW.height - barHeight,
  };
  COMPARISON_VIEW = { width: VIEW.width, height: VIEW.height + barHeight };
};
let RENDER_BUFFER = { width: VIEW.width, height: VIEW.height };
const POINTS = 512 * 424;
// THREE.NormalBlending and THREE.AdditiveBlending, by value, because the check
// reads the material rather than the registry.
const NORMAL_BLENDING = 1;
const ADDITIVE_BLENDING = 2;

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
  return ok;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (x) => JSON.stringify(x);

// Playwright is not a dependency of this project - it is a tool the proofs reach
// for - so it is resolved from wherever it happens to be installed.
async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [];
  try {
    roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim());
  } catch { /* no global npm root: the local resolve below may still work */ }

  const candidates = [async () => import('playwright')];
  for (const root of roots) {
    for (const name of ['playwright', '@playwright/cli/node_modules/playwright']) {
      candidates.push(async () => import(pathToFileURL(require.resolve(join(root, name))).href));
    }
  }
  for (const load of candidates) {
    try {
      const mod = await load();
      const pw = mod.chromium ? mod : mod.default;
      if (pw?.chromium) return pw;
    } catch { /* try the next one */ }
  }
  throw new Error('playwright not found - install it globally or in this project');
}

// ------------------------------------------------------------------- fixture

// Capture frame payloads back to back, wire format unchanged apart from the colour
// block being dropped, so the page parses them with the same field offsets the
// socket path uses and the depth is real sensor depth.
function buildFixture(path) {
  const parser = new MessageParser();
  const frames = [];
  for (const msg of parser.push(readFileSync(path))) {
    if (msg.type === TYPE_FRAME) frames.push(msg.payload);
  }
  if (frames.length < SOURCE_FRAMES * STRIDE) {
    throw new Error(`${path} has ${frames.length} frames, need ${SOURCE_FRAMES * STRIDE}`);
  }
  const out = [];
  for (let i = 0; i < SOURCE_FRAMES; i++) {
    const src = frames[i * STRIDE];
    const depthBytes = src.readUInt32LE(0);
    const payload = Buffer.alloc(16 + depthBytes);
    payload.writeUInt32LE(depthBytes, 0);
    payload.writeUInt32LE(0, 4); // colour dropped: JPEG decode is asynchronous
    src.copy(payload, 8, 8, 16); // the capture timestamp, verbatim
    src.copy(payload, 16, 16, 16 + depthBytes);
    out.push(payload);
  }
  return Buffer.concat(out);
}

// ------------------------------------------------------- where each value lands
//
// Written out independently of the registry. If `apply` stopped reaching one of
// these, every other check here would still pass and this one would not.

const LANDING = {
  pointSize: 'k.uniforms.pointSize.value',
  opacity: 'k.uniforms.opacity.value',
  exposure: 'k.uniforms.exposure.value',
  additive: '[k.material.blending, k.material.depthWrite, k.uniforms.softEdge.value]',
  // The glyph field's four, each landing 1:1 on one uniform - the uniform keeping the flat
  // spelling the parameter had before the rename moved the registry onto dotted effect
  // names, because the rename was a registry fact and deliberately not a shader one, so
  // this table is where the pairing of the two spellings is written down. The master is
  // read in both stages of the cloud shader and the three keys in the fragment stage alone,
  // but that is a fact about the shader rather than about the landing site: there is one
  // cell per parameter and the sweep below reads it.
  'glyph.amount': 'k.uniforms.glyph.value',
  'glyph.tone': 'k.uniforms.glyphTone.value',
  'glyph.hash': 'k.uniforms.glyphHash.value',
  'glyph.rain': 'k.uniforms.glyphRain.value',
  near: 'k.uniforms.nearClip.value',
  far: 'k.uniforms.farClip.value',
  left: 'k.uniforms.cropL.value',
  right: 'k.uniforms.cropR.value',
  bottom: 'k.uniforms.cropB.value',
  top: 'k.uniforms.cropT.value',
  crop: 'k.uniforms.cropOn.value',
  interpolate: 'k.uniforms.interpolate.value',
  snapDelta: 'k.uniforms.snapDelta.value',
  fade: '[k.uniforms.fadeTime.value, k.geometry.drawRange.count]',
  wake: '[k.uniforms.wakeTime.value, k.geometry.drawRange.count]',
  'noise.amount': 'k.uniforms.noise.value',
  'noise.scale': 'k.uniforms.noiseScale.value',
  'noise.speed': 'k.uniforms.noiseSpeed.value',
  'lattice.amount': 'k.uniforms.lattice.value',
  cell: 'k.uniforms.latticeCell.value',
  // The centre and the half-extents are three sliders landing in one vector each, so
  // the component is named here rather than the uniform - an apply that wrote the
  // whole vector, or wrote y where x was meant, reads identically at `.value`.
  regionX: 'k.uniforms.regionCentre.value.x',
  regionY: 'k.uniforms.regionCentre.value.y',
  regionZ: 'k.uniforms.regionCentre.value.z',
  regionW: 'k.uniforms.regionHalf.value.x',
  regionH: 'k.uniforms.regionHalf.value.y',
  regionD: 'k.uniforms.regionHalf.value.z',
  regionRound: 'k.uniforms.regionRound.value',
  regionSoft: 'k.uniforms.regionSoft.value',
  'push.amount': 'k.uniforms.regionPush.value',
  'noise.region': 'k.uniforms.regionNoise.value',
  'mask.amount': 'k.uniforms.regionMask.value',
  'ripple.amount': 'k.uniforms.ripple.value',
  'ripple.freq': 'k.uniforms.rippleFreq.value',
  'ripple.speed': 'k.uniforms.rippleSpeed.value',
  'glitch.amount': 'k.uniforms.glitch.value',
  'glitch.density': 'k.uniforms.glitchDensity.value',
  'glitch.shove': 'k.uniforms.glitchShove.value',
  'glitch.tint': 'k.uniforms.glitchTint.value',
  'glitch.bands': 'k.uniforms.glitchBands.value',
  'glitch.axis': 'k.uniforms.glitchAxis.value',
  'glitch.rate': 'k.uniforms.glitchRate.value',
  spin: 'k.controls.autoRotate',
  // The five readings land on uniforms of their own name, which is the one place in
  // this table where the parameter and the uniform were deliberately made to match:
  // the shader reads them as a set, and a landing site that renamed them on the way
  // through would be a second table to keep in step with the first.
  readRgb: 'k.uniforms.readRgb.value',
  readDepth: 'k.uniforms.readDepth.value',
  readGhost: 'k.uniforms.readGhost.value',
  readContour: 'k.uniforms.readContour.value',
  readBlackwall: 'k.uniforms.readBlackwall.value',
  rgbSaturation: 'k.uniforms.rgbSaturation.value',
  depthGamma: 'k.uniforms.depthGamma.value',
  ghostRim: 'k.uniforms.ghostRim.value',
  ghostFill: 'k.uniforms.ghostFill.value',
  contourBands: 'k.uniforms.contourBands.value',
  // The one parameter here that is not a single uniform write: it is half a band's
  // width, and the shader takes the two edges it makes. Named as the pair rather than
  // as one of them for the reason the region's components are - an apply that wrote the
  // same edge twice, or moved one and not the other, reads identically at either one.
  contourWidth: '[k.uniforms.contourLo.value, k.uniforms.contourHi.value]',
  blackwallSweep: 'k.uniforms.blackwallSweep.value',
  scan: 'k.uniforms.scanAmount.value',
  rim: 'k.uniforms.rimAmount.value',
  'thermal.amount': 'k.uniforms.thermal.value',
  'edges.amount': 'k.uniforms.edges.value',
  'duotone.amount': 'k.uniforms.duotoneDepth.value',
  // Degrees on the slider and radians at the uniform, so this row is the conversion as
  // much as the arrival. An apply that handed the shader its degrees straight through
  // would read here as a perfectly ordinary number and spin the poles fifty-seven times
  // too far, which is a look nobody authored arriving through a slider that works.
  'duotone.hue': 'k.uniforms.duotoneHue.value',
  'duotone.split': 'k.uniforms.duotoneSplit.value',
  'duotone.span': 'k.uniforms.duotoneSpan.value',
  'duotone.motion': 'k.uniforms.duotoneMotion.value',
  // The rain's four, 1:1 like the glyph field's. None of them converts a unit on the way
  // through - the three lengths are metres and metres per second of the room in the
  // document and in the shader alike, which is the whole reason they are not referred to
  // the 1080p reference the screen-space terms are.
  'rain.amount': 'k.uniforms.rain.value',
  'rain.speed': 'k.uniforms.rainSpeed.value',
  'rain.span': 'k.uniforms.rainSpan.value',
  'rain.trail': 'k.uniforms.rainTrail.value',
  bloom: '[k.bloom.strength, k.bloom.enabled]',
  trails: '[k.afterimage.uniforms.damp.value, k.afterimage.enabled]',
  'rgbsplit.amount': '[k.grade.uniforms.rgbSplit.value, k.grade.enabled]',
  'raster.amount': '[k.grade.uniforms.scanlines.value, k.grade.enabled]',
  // The raster's three settings, and like `crush` below none of them carries
  // `k.grade.enabled` - they are settings of the master above rather than terms beside
  // it, so the pass is the master's to gate. The angle is degrees on the slider and
  // radians at the uniform, which makes its row the conversion as well as the arrival.
  // Named as the pair rather than as an angle, because that is what the registry
  // actually writes: an apply that moved one component and not the other, or wrote the
  // sine where the cosine belongs, reads identically at either one on its own.
  'raster.angle': '[k.grade.uniforms.scanAxis.value.x, k.grade.uniforms.scanAxis.value.y].map((v) => Number(v.toFixed(9)))',
  'raster.pitch': 'k.grade.uniforms.scanPitch.value',
  'raster.hard': 'k.grade.uniforms.scanHard.value',
  'grain.amount': '[k.grade.uniforms.grain.value, k.grade.enabled]',
  'streak.amount': '[k.grade.uniforms.streak.value, k.grade.enabled]',
  // The streak's direction, on the raster angle's terms exactly: degrees on the slider,
  // an axis at the uniform, so this row is the conversion as much as the arrival, and
  // named as the pair because an apply that wrote the sine where the cosine belongs reads
  // as a perfectly ordinary number at either component on its own. No `k.grade.enabled`
  // beside it, and the absence is the assertion - it is a setting of `streak.amount` above
  // rather than a term beside it, so switching the pass on to point a streak nobody raised
  // is the no-op the gate matrix refuses by name.
  'streak.angle': '[k.grade.uniforms.streakAxis.value.x, k.grade.uniforms.streakAxis.value.y].map((v) => Number(v.toFixed(9)))',
  'vignette.amount': '[k.grade.uniforms.vignette.value, k.grade.enabled]',
  // The fifth term in that pass, and **the missing `k.grade.enabled` beside it is the
  // assertion**. The four above gate the pass and so each has to carry whether it is on;
  // this one is a sub-control inside the pass and deliberately does not, because its
  // default is the literal it replaced and a gate on a non-zero default would hold the
  // grade open for every look there is. Pairing it here would make this row agree with a
  // build that gated it, which is the one build this landing site exists to refuse. What
  // proves the negative is the row in the pass-gate matrix below.
  crush: 'k.grade.uniforms.crush.value',
  denoise: 'k.uniforms.denoise.value',
  edgeTol: 'k.uniforms.edgeTol.value',
  renderScale: 'k.renderer.getContext().drawingBufferWidth',
  // The two levelling angles share one landing site, because a rotation is what they
  // are between them. `worldTilt()` answers off the cloud's own quaternion rather than
  // off the value the pair composes into, so this row is "the rotation reached the
  // object the renderer draws" rather than "the arithmetic was done". Rounded because
  // the comparison is a `JSON.stringify` equality and the expectation below rebuilds
  // the quaternion in a different order of operations - a ULP apart is not a finding.
  tilt: 'k.worldTilt().map((v) => Number(v.toFixed(9)))',
  roll: 'k.worldTilt().map((v) => Number(v.toFixed(9)))',
  camera: '[...k.programCamera.position.toArray(), ...k.programCamera.quaternion.toArray(), k.programCamera.fov]',
};

/**
 * The quaternion `tilt` and `roll` have to compose into: `Rx(tilt) * Rz(roll)`.
 *
 * Written out here rather than read back from the page on purpose. This is the one
 * place outside `web/main.js` that states the order, so the pair being composed the
 * other way round fails this row - where a tool that asked the page what order it used
 * would agree with the implementation by construction and could never see it.
 */
function levellingQuaternion(tiltDeg, rollDeg) {
  const t = (tiltDeg * (Math.PI / 180)) / 2;
  const r = (rollDeg * (Math.PI / 180)) / 2;
  const st = Math.sin(t); const ct = Math.cos(t);
  const sr = Math.sin(r); const cr = Math.cos(r);
  return [st * cr, -st * sr, ct * sr, ct * cr].map((v) => Number(v.toFixed(9)));
}

// What that landing site must read, given the value the registry was handed. The
// ones taking `all` are the parameters that share a side effect with another.
const EXPECT = {
  pointSize: (v) => v,
  opacity: (v) => v,
  exposure: (v) => v,
  additive: (v) => [v ? ADDITIVE_BLENDING : NORMAL_BLENDING, !v, v ? 1 : 0],
  'glyph.amount': (v) => v,
  'glyph.tone': (v) => v,
  'glyph.hash': (v) => v,
  'glyph.rain': (v) => v,
  near: (v) => v,
  far: (v) => v,
  left: (v) => v,
  right: (v) => v,
  bottom: (v) => v,
  top: (v) => v,
  crop: (v) => (v ? 1 : 0),
  interpolate: (v) => (v ? 1 : 0),
  snapDelta: (v) => v,
  fade: (v, all) => [v / 1000, v > 0 || all.wake > 0 ? POINTS * 2 : POINTS],
  wake: (v, all) => [v / 1000, all.fade > 0 || v > 0 ? POINTS * 2 : POINTS],
  'noise.amount': (v) => v,
  'noise.scale': (v) => v,
  'noise.speed': (v) => v,
  'lattice.amount': (v) => v,
  cell: (v) => v,
  regionX: (v) => v,
  regionY: (v) => v,
  regionZ: (v) => v,
  regionW: (v) => v,
  regionH: (v) => v,
  regionD: (v) => v,
  regionRound: (v) => v,
  regionSoft: (v) => v,
  'push.amount': (v) => v,
  'noise.region': (v) => v,
  'mask.amount': (v) => v,
  'ripple.amount': (v) => v,
  'ripple.freq': (v) => v,
  'ripple.speed': (v) => v,
  'glitch.amount': (v) => v,
  'glitch.density': (v) => v,
  'glitch.shove': (v) => v,
  'glitch.tint': (v) => v,
  'glitch.bands': (v) => v,
  'glitch.axis': (v) => v,
  'glitch.rate': (v) => v,
  spin: (v) => v,
  readRgb: (v) => v,
  readDepth: (v) => v,
  readGhost: (v) => v,
  readContour: (v) => v,
  readBlackwall: (v) => v,
  rgbSaturation: (v) => v,
  depthGamma: (v) => v,
  ghostRim: (v) => v,
  ghostFill: (v) => v,
  contourBands: (v) => v,
  // Written as the same double-precision arithmetic the registry does, so the two agree
  // bit for bit rather than nearly: the whole reason the edges are computed off the GPU
  // is that a half minus this width is a different float in float32, and a check that
  // rounded its expectation differently from the build would be measuring its own
  // arithmetic.
  contourWidth: (v) => [0.5 - v, 0.5 + v],
  blackwallSweep: (v) => v,
  scan: (v) => v,
  rim: (v) => v,
  'thermal.amount': (v) => v,
  'edges.amount': (v) => v,
  'duotone.amount': (v) => v,
  // The degrees-to-radians the registry does on the way through, written out here as the
  // same double arithmetic rather than read back off the page - three's `degToRad` is a
  // multiply by `Math.PI / 180` and so is this, which makes the equality exact instead of
  // nearly exact. A tool that asked the page what conversion it used would agree with the
  // implementation by construction and could never see a wrong one.
  'duotone.hue': (v) => v * (Math.PI / 180),
  'duotone.split': (v) => v,
  // Metres straight through, which is the whole of what this landing has to say: the
  // conversion into the ramp's own units happens in the shader against the clip range,
  // so an apply that divided here would be doing it twice and against a range the
  // document may not still have by the time the frame is drawn.
  'duotone.span': (v) => v,
  'duotone.motion': (v) => v,
  'rain.amount': (v) => v,
  'rain.speed': (v) => v,
  'rain.span': (v) => v,
  'rain.trail': (v) => v,
  bloom: (v) => [v, v > 0],
  trails: (v) => [v, v > 0],
  // The five that share one pass, so each one's landing carries whether the pass is on
  // and every one of them has to name the other four. `vignette` joined them when it
  // stopped being a literal applied whenever the pass happened to run, and `streak` joined
  // by being written.
  //
  // **Every row here gained `streak` and not only the new one.** The scrambled set happens
  // to raise all five at once, so leaving the older four alone would have passed today and
  // gone on passing - right up until a set that raised the streak alone, where four rows
  // would expect a shut pass against an open one and read as findings about terms that had
  // not changed. The gate is one condition and each row states the whole of it.
  'rgbsplit.amount': (v, all) => [v, v > 0 || all['raster.amount'] > 0 || all['grain.amount'] > 0
    || all['vignette.amount'] > 0 || all['streak.amount'] > 0],
  'raster.amount': (v, all) => [v, all['rgbsplit.amount'] > 0 || v > 0 || all['grain.amount'] > 0
    || all['vignette.amount'] > 0 || all['streak.amount'] > 0],
  // Same double arithmetic three's `degToRad` does, so the equality is exact rather than
  // near - and written out here rather than read back off the page, because a tool that
  // asked the page what conversion it used could never see a wrong one.
  // The same double arithmetic the registry does on the way through, so the two agree bit
  // for bit rather than nearly - and stated here rather than read back off the page,
  // because a tool that asked the page which axis it built could never see a wrong one.
  // Rounded on both sides, exactly as the levelling pair above is and for its reason:
  // the comparison is a `JSON.stringify` equality and this rebuilds the cosine in a
  // different order of operations from the registry, so the two land a ULP apart -
  // 0.4539904997395468 against 0.45399049973954686 at the scrambled 63 degrees. A ULP is
  // not a finding; an axis built the wrong way round still is, and still fails here.
  'raster.angle': (v) => [Math.sin(v * (Math.PI / 180)), Math.cos(v * (Math.PI / 180))]
    .map((x) => Number(x.toFixed(9))),
  'raster.pitch': (v) => v,
  'raster.hard': (v) => v,
  'grain.amount': (v, all) => [v, all['rgbsplit.amount'] > 0 || all['raster.amount'] > 0 || v > 0
    || all['vignette.amount'] > 0 || all['streak.amount'] > 0],
  'streak.amount': (v, all) => [v, all['rgbsplit.amount'] > 0 || all['raster.amount'] > 0
    || all['grain.amount'] > 0 || all['vignette.amount'] > 0 || v > 0],
  // The same double arithmetic the registry does on the way through, written out here
  // rather than read back off the page for `raster.angle`'s reason two rows up: a tool that
  // asked the page which axis it built could never see a wrong one. Rounded on both sides,
  // because this rebuilds the cosine in a different order of operations from the registry
  // and a ULP apart is not a finding, where an axis built in degrees still is.
  'streak.angle': (v) => [Math.sin(v * (Math.PI / 180)), Math.cos(v * (Math.PI / 180))]
    .map((x) => Number(x.toFixed(9))),
  'vignette.amount': (v, all) => [v, all['rgbsplit.amount'] > 0 || all['raster.amount'] > 0
    || all['grain.amount'] > 0 || v > 0 || all['streak.amount'] > 0],
  // Reads its own value and nothing else, because it shares the pass without gating it -
  // so unlike the four above it names none of the others and none of them name it.
  crush: (v) => v,
  denoise: (v) => (v ? 1 : 0),
  edgeTol: (v) => v,
  // three floors width * pixelRatio, and the context runs at deviceScaleFactor 1.
  renderScale: (v) => Math.floor(RENDER_BUFFER.width * (v / 100)),
  // Both read the whole pair, because both land on the same rotation: a `tilt` set on
  // its own has to compose with whatever `roll` currently is, which the one-at-a-time
  // sweep leaves at its default and the all-at-once pass does not.
  tilt: (v, all) => levellingQuaternion(v, all.roll),
  roll: (v, all) => levellingQuaternion(all.tilt, v),
  camera: (v) => [...v.position, ...v.quaternion, v.fov],
};

// A scrambled but valid set: every value off its default and on its own step grid,
// every boolean flipped. This is what gets serialised, restored and hashed.
const SCRAMBLE = {
  pointSize: 9.5,
  opacity: 0.62,
  exposure: 2.05,
  additive: true,
  // The glyph field, and the master is at a half rather than at a one for the reason the
  // glitch master is at 0.31 rather than at 1: this table has to leave every parameter
  // *observable*, and a saturated arm is as blind as an inert one. At full glyph the sprite
  // is the whole cell, so with the lattice at 1 and an 11cm cell above, every cell in the
  // frame is a solid character and the four keys are then choosing between shapes that
  // cover the same pixels. At a half the mark is a character glowing inside a dot, both
  // halves of the blend are in the picture, and dropping the master takes the characters
  // out of it. The three keys are all non-zero and none of them is at the value the sweep
  // reverts it to - `glyph.hash` in particular defaults to 1, so it is scrambled *down*
  // where its two neighbours are scrambled up.
  //
  // The master is what makes the three observable at all, which is the argument the raster's
  // three settings and the glitch's five ceilings are set on: at a glyph of 0 no character
  // is drawn, so which character it would have been cannot reach a pixel and all three
  // would land in the no-pixel bucket together.
  'glyph.amount': 0.5,
  'glyph.tone': 0.61,
  'glyph.hash': 0.37,
  'glyph.rain': 1,
  // Both non-zero and both off the other's axis, because the drop-one sweep reverts one
  // at a time: a scrambled set that levelled along a single axis would leave the other
  // parameter with nothing to undo, and it would land in the no-pixel bucket looking
  // like a parameter that does nothing. Off the half-degree grid's round numbers for
  // the same reason every other value here is - a step the slider can express, but not
  // one a hardcoded constant would plausibly be.
  tilt: 13.5,
  roll: -21.5,
  near: 0.35,
  far: 4.2,
  // **Left at its default, which is the one value in this table that is**, and the
  // reason is the same one the three region effects below give: it is a gate, and the
  // six faces either side of it are only observable through it. Flipped to `false` the
  // box stops biting, so `near`, `far` and the four lateral faces all render the same
  // image whatever they are set to, and six real parameters land in the no-pixel bucket
  // at once looking like parameters that do nothing.
  //
  // What that costs is this sweep's own view of `crop`: dropping it restores the value
  // it already has, so it changes nothing here and is declared in `NO_PIXEL_EFFECT`. A
  // drop-one sweep cannot see a parameter whose scrambled value is its default, and the
  // section below is where the switch is actually proven.
  crop: true,
  // The four lateral faces, placed against the same fixture the region is placed
  // against rather than picked: the cloud runs x [-2.31, 2.97] and y [-2.26, 1.63],
  // so each of these sits inside the extent on its own side and has something to cull,
  // while the box they make still contains the subject at the median (0.021, 0.019).
  // A plane outside the cloud would be a parameter the drop-one sweep below could not
  // see, which is the same trap the region's placement comment describes.
  left: -1.5,
  right: 1.5,
  bottom: -1.5,
  top: 1,
  // Flipped, and the drop-one sweep is what makes it worth stating. Reverting `crop` to
  // its default puts all six faces back to work against the four placed above and the
  // near/far pair above them - so the row it produces is a large one, and a build whose
  // switch reached the shader and nothing else, or nothing at all, cannot pass it. The
  interpolate: false,
  snapDelta: 410,
  fade: 260,
  wake: 830,
  'noise.amount': 0.08,
  'noise.scale': 5.5,
  'noise.speed': 1.45,
  // Full strength, because a partial snap is a blend of the grid and the surface and the
  // drop-one sweep would be separating that from the turbulence three rows up.
  'lattice.amount': 1,
  // Coarse enough that a cell spans several points at this pose. A cell near the point
  // spacing snaps every point to roughly where it already was, which is a lattice that
  // renders as its own absence.
  cell: 0.11,
  // The master well up, because the five ceilings under it are only observable through
  // it: at a glitch of 0 no band tears, so density, shove, flare, band height and rate
  // would every one of them land in the no-pixel bucket together - the same argument the
  // region's three effects below are set for. The flare is above its default so it is
  // being raised onto the picture rather than lowered out of it.
  'glitch.amount': 0.31,
  'glitch.density': 0.62,
  'glitch.shove': 1.23,
  'glitch.tint': 4.35,
  'glitch.bands': 27,
  // Most of the way to the sensor's columns, so the bands cross the frame on a steep
  // diagonal rather than at either of the two axes it interpolates between. A value of 1
  // would be a second baked axis and would leave the interesting half of this control -
  // everything off the diagonal - unmeasured by the sweep.
  'glitch.axis': 0.78,
  'glitch.rate': 13.5,
  // The region is placed rather than picked, because the sweep below drops each
  // parameter in turn and asserts the image moved - and a region floating in empty
  // space would leave all eight of its geometry parameters inert while looking like a
  // perfectly reasonable set of numbers. Measured against the six frames this fixture
  // is built from, unprojected with the take's own intrinsics and clipped to the
  // near/far above: the cloud runs x [-2.31, 2.97], y [-2.26, 1.63], z [-4.50, -0.50]
  // with its median point at (0.021, 0.019, -1.893), so the centre sits on the subject
  // and the surface passes through it rather than around it.
  //
  // What that buys, per parameter, as points whose region weight changes when that one
  // parameter alone reverts to its default - 957,783 points survive the clip:
  //
  //   regionX 14.49%   regionY 19.13%   regionZ 31.25%   regionW 27.96%
  //   regionH 44.20%   regionD 56.84%   regionRound 68.89%   regionSoft 21.31%
  //
  // The tightest is `regionX`, whose 0.05 step is one grid position off its default and
  // still moves 138,822 points. `regionSoft` is the one to watch if these are ever
  // retuned: it can only act in the shell outside the surface, so a falloff at its
  // default width against a region already swallowing the cloud would move nothing.
  regionX: 0.05,
  regionY: 0.15,
  regionZ: -1.9,
  regionW: 0.4,
  regionH: 0.4,
  regionD: 0.4,
  regionRound: 0.9,
  regionSoft: 0.6,
  // All three non-zero, because the eight above are only observable through them: with
  // push, scramble and mask all at their defaults the region has no effect to have, and
  // every geometry parameter would land in the no-pixel bucket at once. The mask is
  // well short of 1 for the same reason - a region that hid its contents outright would
  // make the displacement inside it invisible and take `push.amount` down with it.
  'push.amount': 0.35,
  'noise.region': 0.5,
  'mask.amount': 0.4,
  'ripple.amount': 0.14,
  'ripple.freq': 6.3,
  // Off the whole eighths its own clock steps in, so a phase that stopped being quantised
  // would land somewhere else rather than on the same step by luck.
  'ripple.speed': 1.35,
  spin: true,
  // All five readings live at once, which is what keeps every per-reading term in the
  // shader reachable from the one sweep this file runs. They are deliberately unequal:
  // an even split would make the normalisation divide by exactly 1.0 whichever way the
  // weights were read, so a build that summed them wrong would still agree here.
  readRgb: 0.4,
  readDepth: 0.3,
  readGhost: 0.2,
  readContour: 0.15,
  readBlackwall: 0.6,
  // The seven per-reading constants, every one off its default - and for the first two
  // that is the whole point rather than a habit. Their defaults are the identity: a
  // saturation of 1 and a gamma of 1 do nothing by construction, so leaving either at
  // its default would have the drop-one sweep below record it as a parameter that
  // cannot touch a pixel, which is true of the value and false of the parameter.
  //
  // `rgbSaturation` is also the one parameter in this table that needs an input the
  // pinned fixture does not carry. The fixture drops the colour block, so `hasColor` is
  // 0 and every point draws a flat grey - and saturation of grey is the identity at
  // every value, which is a dead zone rather than a value that does nothing. The sweep
  // plants a colour image for exactly that reason; see `plantColor` below.
  //
  // `blackwallSweep` is a speed, so it moves nothing in a frame at program time 0 and
  // the run below deliberately spans a second: at 0.9 against its default the scan plane
  // has travelled 0.62 of a period by the end of it.
  rgbSaturation: 1.6,
  depthGamma: 0.6,
  ghostRim: 1.4,
  ghostFill: 0.7,
  contourBands: 27,
  contourWidth: 0.25,
  blackwallSweep: 0.9,
  scan: 0.72,
  rim: 0.28,
  // Order matters here and nowhere else in this file: the comparison against the
  // serialised set is a JSON.stringify equality, so these keys have to sit in the order
  // PARAMS declares them. Put them anywhere else and the check fails with an empty
  // detail line, because every value matches and only the ordering does not.
  'thermal.amount': 0.6,
  'edges.amount': 0.45,
  // The duotone amount well up, because the two below are only observable through it -
  // the same argument the glitch master and the region's three effects are set on. At a
  // depth of 0 the poles never reach a pixel, so the hue and the split would both land in
  // the no-pixel bucket together looking like parameters that do nothing.
  'duotone.amount': 0.65,
  // Off the axis in both senses: a rotation big enough to move both poles well clear of
  // where they started, and not one of the right angles a hardcoded constant would
  // plausibly be. 47 degrees is on the step grid and is nobody's round number.
  'duotone.hue': 47,
  // Off centre, so reverting it moves the crossover through the cloud rather than
  // symmetrically about it. The fixture's points run z [-4.50, -0.50] against a near/far
  // of 0.35/4.2, so a split at 0.36 puts the meeting plane inside the subject where the
  // default at 0.5 puts it behind them.
  'duotone.split': 0.36,
  // A ramp much steeper than the default one, because the default is what has to be
  // observable against. `near`/`far` above make the range 3.85m, so the default span of
  // 5.95m already runs wider than the box - the crossing is spread over the whole cloud
  // and then some - and 1.15m puts it inside about a third of the range instead. Reverting
  // this parameter therefore flattens a visible edge rather than nudging one, which is
  // what the drop-one sweep needs and what a value near the default would not give.
  //
  // On the 0.05 grid and nobody's round number, for the reason `duotone.hue`'s 47 is.
  'duotone.span': 1.15,
  // Well up, because what it has to be observable against is the depth key beside it: at
  // the split above, the middle of this cloud sits at a k of about 0.56, so there is room
  // above it for a moving point to be pushed into and reverting this parameter takes that
  // push away. A motion amount raised over a room already at the hot pole would land in
  // the no-pixel bucket looking like a parameter that does nothing.
  //
  // What it has to key on is in the fixture rather than planted, which is why this row is
  // safe at all: measured over the five pairs the six pinned frames make, 7.7% of paired
  // samples move faster than 150 mm/s, the 99th percentile is about 430 and the fastest is
  // about 1900, against a ramp that reaches its pole at 1200. The nearly-static fixture
  // still carries a subject moving through it.
  'duotone.motion': 0.83,
  // The rain, on the same terms: the master well up so the three lengths under it are
  // reachable, and every one of the three off the value the sweep reverts it to. The span
  // is *below* its 1.3m default and the room this fixture holds is about two metres tall,
  // so several heads are inside the frame at once rather than one crossing it - a spacing
  // that put a single head in the picture would be one the sweep could not separate from
  // the trail beneath it.
  //
  // `rain.speed` is the one of the four that cannot be seen in a single frame, because it is
  // a rate: at program time 0 every speed draws the same phase. It is observable here for
  // `blackwallSweep`'s reason two dozen rows up - the run below spans a second, and at 1.35
  // against its default of 0.55 the pattern has travelled 0.8m further down the room by the
  // end of it, which is more than a whole head gap at the span above.
  'rain.amount': 0.6,
  'rain.speed': 1.35,
  'rain.span': 0.73,
  'rain.trail': 0.28,
  bloom: 1.35,
  trails: 0.44,
  'rgbsplit.amount': 2.3,
  'raster.amount': 0.61,
  // Off every axis the raster has a right angle at, so a build that rounded the angle to
  // the nearest quarter turn - or dropped it - draws a visibly different grille. The
  // master above is what makes these three observable at all: at a raster.amount of 0 the
  // block never runs and all three would land in the no-pixel bucket together, which is
  // the argument the glitch ceilings and the region's three effects are set on.
  'raster.angle': 63,
  // Well *below* the 1.3 it defaults to, which is where the grille is: the wave is
  // expressed against 1080p, so the default is already the television artifact and the
  // wide bands live under 0.6. The registry entry in `web/main.js` carries the measurement
  // and the correction it replaced. A pitch that only moved a hair would be a parameter
  // the drop-one sweep could not separate from sampling noise, and this one is far enough
  // off the default to redraw the whole frame.
  'raster.pitch': 0.37,
  // High enough that the wave is a grille rather than a sine, which is the state the
  // hardness exists to reach. At its default of 0 it is the identity by construction, so
  // leaving it there would have the sweep record it as a parameter that cannot touch a
  // pixel - the trap `rgbSaturation` and `depthGamma` above are set off their defaults for.
  'raster.hard': 0.82,
  'grain.amount': 0.37,
  // High enough that the gather wins over the pixel it started from across a good part of
  // the frame. The taps decay with distance, so a small streak moves only what sits
  // directly under a highlight and the drop-one sweep would be separating that from the
  // grain two rows up.
  'streak.amount': 0.62,
  // Off every right angle and off both diagonals - 113 sits 22.5 degrees from 90 and from
  // 135, which are the two nearest values a build that quantised the axis could plausibly
  // land on, and it is nowhere near the 0 the sweep reverts it to. A direction a hair off
  // its default would be a parameter the drop-one sweep could not separate from sampling
  // noise; a direction on a right angle would be one a build with four choices rather than
  // an angle would answer correctly.
  'streak.angle': 113,
  'vignette.amount': 0.73,
  // Well above the 0.018 it defaults to, and the four terms above hold the pass open so
  // it is reachable at all - a toe inside a pass nothing switched on is the dead zone
  // this table's `rgbSaturation` comment describes, arriving by a different route.
  // Reverting it to its default lifts every unclamped pixel by 0.044 * 1.12, which is
  // about 12.6 of 255 and nothing a sampling residual explains.
  crush: 0.062,
  denoise: false,
  edgeTol: 340,
  renderScale: 85,
  // A unit quaternion, 30 degrees about Y, so the read-back is exact.
  camera: { position: [0.4, 0.9, 1.1], quaternion: [0, 0.25881904510252074, 0, 0.9659258262890683], fov: 42 },
};

// The closed list of parameters allowed to leave the image untouched when they are
// dropped from a restore, with the reason each one cannot reach the pixels here.
// Anything else landing in that bucket is a failure, which is what stops the sweep
// growing holes as later steps add parameters.
const NO_PIXEL_EFFECT = {
  // Not a parameter that fails to reach pixels - it is a switch over all six crop faces
  // and reaches them hard. It is invisible to *this method*: the sweep drops a parameter
  // and lets it fall back to its default, and `crop` is scrambled to its default because
  // flipping it would take the six faces beside it out of the picture. A drop-one sweep
  // cannot see a parameter it cannot drop. The section that does see it is
  // "the crop switch, which the sweep above cannot see", and this entry is a hole
  // without it.
  crop: 'its scrambled value is its default, because releasing the box would make the '
    + 'six faces it gates unobservable - proven instead by the section below',
  spin: 'auto-orbit only advances when the animation loop calls controls.update, '
    + 'and a pinned run has replaced the loop',
  camera: 'nothing draws the program camera on the pinned run - the viewport is the '
    + 'free camera - so a pose reaches the camera object and no pixel',
};

// ---------------------------------------------------------------- page helpers

const PAGE_HELPERS = `
  const k = globalThis.__kinect;
  const sha256 = async (bytes) => {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const pinCamera = (cam) => {
    cam.position.set(0, 0.1, 1.6);
    cam.lookAt(0, 0, -2.2);
    cam.updateMatrixWorld(true);
  };
`;

// The generated keys are JSON-quoted because the dotted parameter names are not
// identifiers: an unquoted `glyph.tone:` in the built literal is a syntax error inside
// `page.evaluate`, which no check on this side of the bridge would ever parse.
const landingReader = `(() => {
  const k = globalThis.__kinect;
  return { ${Object.entries(LANDING).map(([n, e]) => `${JSON.stringify(n)}: (${e})`).join(', ')} };
})()`;

// The same reader with every expression allowed to come back undefined, and it is used
// on exactly one page: the revision the golden comparison plays back. That build
// predates some of these parameters, so reading `k.uniforms.regionCentre.value.x` there
// is a TypeError rather than a finding, and one throw takes the whole section with it.
//
// Deliberately *not* used for the current page. A LANDING entry naming a uniform this
// build does not have is a real bug in the check, and swallowing it on both arms would
// turn every such typo into a silent `undefined === undefined` pass - the shape this
// repo keeps finding, where an instrument stops being able to fail.
const tolerantLandingReader = `(() => {
  const k = globalThis.__kinect;
  const at = (f) => { try { return f(); } catch { return undefined; } };
  return { ${Object.entries(LANDING).map(([n, e]) => `${JSON.stringify(n)}: at(() => (${e}))`).join(', ')} };
})()`;

const readLanding = (page) => page.evaluate(landingReader);

// Everything the two arms of the before/after comparison can both answer. No
// `k.params` here: the committed page has none, and a snapshot that only the new
// page could produce would compare nothing.
// `mode` and the `#modes` pressed states used to be in here, and they cannot be: the
// integer uniform and the five buttons exist on one side of this comparison only, so
// the field would read `0 -> undefined` at every stage and the arm would fail on the
// change it is meant to be measuring. What replaced the mode is five ordinary look
// parameters, which arrive in `dom` and `readouts` with every other slider - and the
// claim that each of them renders what its mode rendered is not a state comparison at
// all. It is section 1b, which hashes the framebuffer.
const snapshotWith = (reader) => `(() => {
  const k = globalThis.__kinect;
  return {
    landing: ${reader},
    fog: k.scene.fog.color.getHex(),
    dom: Object.fromEntries([...document.querySelectorAll('#panel input')]
      .map((el) => [el.id, el.type === 'checkbox' ? el.checked : el.value])),
    // Range rows only. A readout is the number beside a slider, so a checkbox row has
    // none by design - and the monitor group added one in step 9, at which point this
    // map started calling .textContent on null and took the whole section down before
    // a single assertion ran. Filtering to the rows that are supposed to have a readout
    // is what the map always meant.
    //
    // The missing one is still reported rather than skipped: a *slider* that lost its
    // output is exactly the regression this map exists to catch, and it now shows up as
    // a differing value instead of as a crash.
    readouts: Object.fromEntries([...document.querySelectorAll('#panel .row')]
      .filter((r) => r.querySelector('input')?.type === 'range')
      .map((r) => [r.querySelector('input').id,
        r.querySelector('output')?.textContent ?? '(no output element)'])),
  };
})()`;

// ------------------------------------------------------------------- the pages

const { chromium } = await loadPlaywright();
// The full chromium build rather than the headless shell: the shell can land on
// SwiftShader, and a run that quietly fell back to a software rasteriser would
// agree with itself for the wrong reason.
const browser = await chromium.launch({ channel: 'chromium', headless: !HEADED });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });

const fixture = buildFixture(CAPTURE);

// A page with no source of its own is this tree's page, which under `--mutate` means
// the mutated one. The arms that name a source are the historical revisions, and they
// are deliberately left alone: mutating the thing a comparison is measured *against*
// would move both sides and prove nothing.
async function openPage({
  source = mutatedSource,
  pin = false,
  viewportSize = VIEW,
  comparisonShell = false,
} = {}) {
  const page = await context.newPage();
  if (viewportSize.width !== VIEW.width || viewportSize.height !== VIEW.height) {
    await page.setViewportSize(viewportSize);
  }
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`${msg.text()} @ ${JSON.stringify(msg.location())}`); });
  // A console error names no URL, so the response is recorded alongside it - a
  // 404 on the module and a 404 on the tab icon read identically otherwise, and
  // one of those is the check silently measuring a page that never loaded.
  page.on('response', (res) => { if (!res.ok()) errors.push(`${res.status()} ${res.url()}`); });

  // No frame may arrive. The look values under test do not depend on the stream,
  // and letting the server decide whether one lands would make a verdict that
  // flips between runs on an unchanged tree.
  await page.routeWebSocket(/.*/, () => { /* accepted, never connected */ });

  // The tab icon, answered rather than left to 404. The server has never served
  // one, and the console error it produces is indistinguishable from a real
  // failure to load - which would either be ignored by hand here, hiding the real
  // ones with it, or left to fail the run for a reason that is not about the page.
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));

  let servedHtml = false;
  if (source) {
    // The panel and the module are served as one pair. The committed page reads
    // its ranges out of its own HTML, so pairing the old module with the new
    // markup would boot it on whatever a range input defaults to and the
    // comparison would be against a page that never existed.
    //
    // The predicate and the `goto` below read one constant rather than each
    // spelling the path. They used to name `/` and `/index.html` while the page
    // was opened at `/`, and the recorder has since moved to `/record` - two
    // places that must agree about a path and do not is how the before arm ends
    // up quietly loading the tree's own markup and printing two matching columns
    // under a heading that says they came from different code.
    await page.route((url) => url.pathname === RECORDER_PATH,
      (route) => { servedHtml = true; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: source.html }); });
    await page.route((url) => url.pathname === MAIN_PATH, (route) => route.fulfill({
      contentType: 'text/javascript; charset=utf-8', body: source.js,
    }));
  }
  // The file the mutation actually edits, at its own path.
  //
  // **Only ever installed for this tree's own pages, and that is the whole of why it is
  // outside the block above.** `beforeArm` and the mode-comparison arms pass an explicit
  // historical `source`, and mutating the thing a comparison is measured *against* moves
  // both sides and proves nothing - a historical `main.js` predates the split and asks for
  // no siblings at all, so the only way it could take this route is a rev that does, which
  // is a comparison across two builds rather than one.
  //
  // Registered after the `main.js` route so it wins when the two paths are the same, which
  // is every spec that edits `main.js`: the body it serves is that same staged text, so the
  // one thing the ordering decides is that `mutantServed` counts. Counting on the route
  // rather than on the file makes the guard below evidence that the mutated bytes were
  // asked for, instead of evidence that some page asked for something.
  //
  // `mutatedSource` is null on a run with no mutation, and the default `source` is that
  // same null - so the pair test alone would install this route on every clean page and
  // answer `/main.js` with a property of null. The mutation has to exist for there to be
  // one to serve.
  if (mutatedSource && source === mutatedSource) {
    for (const mutant of mutatedSource.mutants) {
      await page.route((url) => url.pathname === mutant.path, (route) => {
        mutantServed.set(mutant.path, mutantServed.get(mutant.path) + 1);
        return route.fulfill({ contentType: mutant.type, body: mutant.body });
      });
    }
  }
  if (pin) {
    await page.route('**/__pinned.bin', (route) => route.fulfill({
      status: 200, contentType: 'application/octet-stream', body: fixture,
    }));
  }

  await page.goto(URL_BASE + RECORDER_PATH, { waitUntil: 'load' });
  // Proof the interception held, for the same reason the focal reading below is
  // here. A predicate that stops matching pairs the old module with today's
  // markup, which throws at boot on the first parameter this tree has renamed -
  // and that arrives as a 30-second `waitForFunction` timeout naming nothing,
  // which is a wrong URL wearing the shape of a missing feature.
  if (source && !servedHtml) {
    throw new Error(`the page markup was never intercepted - landed on ${new URL(page.url()).pathname}, `
      + `so the ${BEFORE_REV} arm loaded the tree's own page`);
  }
  await page.waitForFunction(() => !!globalThis.__kinect);
  if (comparisonShell) {
    // The comparison build predates the fixed application bar. Canonicalise both
    // revisions onto its existing bottom-strip allocation before changing target
    // aspect, so the comparison viewport gives both the same 640x360 content box
    // through the same layout mechanism. The real current shell is measured separately
    // below and by editor-check; this arm is about shader identity across the old mode
    // boundary, at the fixed 640x360 frame it is now calibrated against.
    await page.evaluate((height) => {
      const appBar = document.getElementById('appBar');
      if (appBar) appBar.style.display = 'none';
      const timeline = document.getElementById('timeline');
      timeline.hidden = false;
      timeline.style.height = `${height}px`;
      timeline.style.minHeight = `${height}px`;
      timeline.style.maxHeight = `${height}px`;
      dispatchEvent(new Event('resize'));
    }, APP_BAR_HEIGHT);
  }
  // **The page frames at the stage this tool asked for.** The editor letterboxes
  // itself to the export aspect now, so a viewport alone no longer decides the
  // drawing buffer - except here it still effectively does, because 640x360 is 16:9,
  // the same shape the menu opens on by default, so there is nothing to letterbox:
  // with or without this call the buffer lands at exactly 640x360. This was 640x400
  // (8:5), which did letterbox against the 16:9 default and moved every buffer-size
  // expectation in this file - see the header on `VIEW` for why that shape is gone.
  //
  // **Asked for anyway, because this is the tool that boots two builds, and a default
  // that happens to agree is not a guarantee this file gets to lean on.** This hook
  // was `setTargetSize` until the shape moved onto the document and the pixel count onto
  // the deliverable, and the arms below are `git show` of a `web/main.js` from before
  // that - so the name the current tree answers to is not the name they answer to. A
  // single name reaches one arm and not the other, and spelled `?.` the miss is silent:
  // `f49c833^` publishes `setTargetSize`, so under the new name alone that arm skipped
  // its resize. Measured at the time this ran at 640x400 (8:5) against a 16:9 default,
  // a skipped resize was visibly the wrong shape: every one of the six cross-build rows
  // went red naming pixels that differ - a rename reading as six findings about
  // readings. Measured, not reasoned: that is what the run printed.
  //
  // **That particular tell is gone now, and it is worth saying rather than leaving to be
  // found later.** At 640x360 the shape a silently-skipped call leaves an arm on is the
  // default project aspect, and the default is 16:9 - the same shape this call now asks
  // for - so *this specific* miss, on *this specific* revision, no longer produces a
  // buffer of a different size and the six rows would not repeat this history. It is a
  // narrower loss than it sounds: `frameDelta` below still fails hard on any arm whose
  // buffer is a different pixel count than the other's, so a rename to a third spelling,
  // or a future default that is not 16:9, is still caught the same way it always was.
  // What is gone is protection against the one coincidence where the miss and the ask
  // land on the same shape by accident. `?? k.setTargetSize` still has to be right; there
  // is just one fewer way left for this file to notice on its own if it stops being so.
  //
  // A tool that loads two builds has to address each in its own language, which `git
  // show` above already commits it to. It is not a compatibility path inside the program,
  // which is the thing this repo refuses.
  //
  // **And optional after both, which is the half that is easy to get backwards.** The
  // instinct is to throw when neither name answers, on the grounds that a stage which
  // silently did not resize is a geometry failure wearing the shape of a colour finding.
  // That is true of an arm that *has* a letterbox and false of `151020b^`, which is the
  // boot-state arm and predates letterboxing entirely: its buffer is the viewport's, it
  // publishes neither name, and it arrives at 640x360 by having nothing to fit - which was
  // true of it at any stage this file has ever asked for, letterboxed or not. Throwing
  // there turns a correct no-op into DID NOT RUN for the whole file, which is what it did
  // before this comment was first rewritten.
  await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    (k.setOutputSize ?? k.setTargetSize)?.('640x360');
  })()`);

  // Proof the interception held, independent of the readings it protects. The
  // sensor's hello carries fx as 366.031494 and the uniform defaults to exactly
  // 366, so the default still standing means nothing came over the socket.
  const focal = await page.evaluate('globalThis.__kinect.uniforms.focal.value.x');
  if (focal !== 366) throw new Error(`websocket interception failed - intrinsics arrived (focal.x=${focal})`);

  return { page, errors };
}

// =============================================================== 1. before/after

console.log(`[registry] nothing moved: boot state against ${BEFORE_REV}`);

const beforeSource = {
  js: execFileSync('git', ['show', `${BEFORE_REV}:web/main.js`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }),
  html: execFileSync('git', ['show', `${BEFORE_REV}:web/index.html`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }),
};
// Once step 3 is committed, a bare --before HEAD would serve the registry into
// both arms and print two matching columns under a heading that says they came
// from different code. Refusing beats that.
if (beforeSource.js.includes('const PARAMS')) {
  throw new Error(`${BEFORE_REV}:web/main.js already contains the registry - pass an earlier rev with --before`);
}

// This used to walk every mode, then Blackwall and out of it twice, because the
// interesting case was the transition rather than the state: entering wrote twelve
// look values and leaving wrote them back. There is no such transition to walk any
// more, and its absence is the change rather than a gap in the check - selecting a
// reading writes the reading and nothing else, which is what "look and shading are
// one thing" cost the mode. A walk asserting that entering Blackwall still rewrites
// twelve sliders would be asserting the weld that was removed.
//
// So this arm compares boot state alone, and the claim it used to make about the
// readings is made properly one section down: not "the sliders agree" but "the
// framebuffer is identical", which is the equality the old walk was standing in for.

// The program pose at a few positions, read in the same task as the render so the
// live loop cannot re-render at 0 underneath the reading. Nothing draws the
// program camera here, which is exactly why it is worth reading: the pose moved
// from a mutation to a value the registry applies, and three orients cameras down
// -Z where it orients everything else down +Z, so a slip would be invisible until
// something drew the frustum.
//
// **This is no longer compared against the earlier revision, and the reason is a
// deletion rather than a tolerance.** At that revision the pose came from a
// placeholder orbit - a slow revolution, one turn per hundred seconds - which step
// 5 replaced with the camera track the design always called for. There is nothing
// left to compare it to: with no camera keys the pose is now a clip's single
// static value, which is the deliberate behaviour and is asserted as such below.
// The moving case is proved in `keyframe-check`, against a track rather than
// against a placeholder.
const readPoses = `(() => {
  const k = globalThis.__kinect;
  const out = {};
  for (const t of [0.7, 1.9]) {
    k.renderProgramFrame(t);
    out[t] = {
      position: k.programCamera.position.toArray(),
      quaternion: k.programCamera.quaternion.toArray(),
      fov: k.programCamera.fov,
    };
  }
  return out;
})()`;

async function bootState(opts, reader = landingReader) {
  const { page, errors } = await openPage(opts);
  const out = { boot: await page.evaluate(snapshotWith(reader)) };
  const poses = await page.evaluate(readPoses);
  return { out, poses, errors, page };
}

// **The after arm goes first, because it is what says how tall the bar is.** The
// before arm's viewport is derived from that measurement, so the order is a
// dependency rather than a preference. It is also the first page this file opens on
// the current tree, which makes it the earliest point the delivery guard below can
// answer honestly: every later arm installs the same route the same way, so if this
// one never asked for the mutated module, none of them will either.
const afterArm = await bootState({});
// **Exit 2, not a failed assertion.** A suite that fails a row on a mutation run
// reads as a catch, so a mutation the page never asked for has to be the harness
// declining to run rather than a claim going red - the same convention every other
// tool in this suite uses for the same reason, `c507eb7` records it arriving at
// `library-check`, and it holds here even though this file's own convention for an
// ordinary catch is inverted (0 caught, 1 not caught): a run that tested nothing is
// neither of those, and reusing either code would make it unrecoverably ambiguous
// with a real verdict.
if (MUTATE) {
  const unserved = [...mutantServed].filter(([, n]) => n === 0).map(([path]) => path);
  if (unserved.length) {
    console.log(`\n[registry] DID NOT RUN - ${MUTATE} was staged for ${unserved.join(', ')} and the page never `
      + 'requested it, so this run would have measured a build the mutation did not fully reach');
    process.exit(2);
  }
}
const measuredBar = await afterArm.page.evaluate(
  "Math.round(document.getElementById('appBar').getBoundingClientRect().height)");
await afterArm.page.close();
if (!Number.isFinite(measuredBar) || measuredBar <= 0) {
  throw new Error(`the application bar measured ${measuredBar}px - the shell this arm is compared against is not on the page`);
}
shellGeometry(measuredBar);
console.log(`  the shell's application bar measures ${APP_BAR_HEIGHT}px, `
  + `so the content box both arms render is ${SHELL_CONTENT.width}x${SHELL_CONTENT.height}`);

const beforeArm = await bootState(
  { source: beforeSource, viewportSize: SHELL_CONTENT },
  tolerantLandingReader,
);
await beforeArm.page.close();

// The camera is left out of the landing comparison, alone among the twenty-five,
// and only here. Every other parameter lands on the same uniform it landed on
// before the registry existed, so an equality is a regression test. The camera's
// landing site at that revision was a placeholder orbit computed from `t` inside
// the render, and step 5 deleted it - so the two arms are being asked to agree
// about a value one of them derives from something the other does not have. The
// pose is still swept, still restored and still checked against what the camera
// object holds, further down; it is only this one before/after that has nothing
// left to say.
const GOLDEN_SKIP = new Set(['camera']);

// The one value that legitimately moved, and it is rescaled rather than skipped.
//
// Step 6 made every screen-space term relative to a 1080p reference, which changed
// what `pointSize` *means*: it is pixels at 1080p now, where it used to be pixels
// at whatever buffer the look happened to be graded against - the 600-tall one the
// design document's resolution A/B calls the good size. So both presets and the
// registry default took the factor 1080/600, and comparing the raw number across
// that change would be comparing two different quantities.
//
// Skipping it the way the camera is skipped would have been weaker than what this
// replaces. The camera has nothing left to compare against, because the placeholder
// orbit it used to come from was deleted; `pointSize` has an exact expected value,
// so the equality becomes an equality against that instead of going away. A value
// that moved by any other factor still fails here.
const POINT_SIZE_REBASE = 1080 / 600;
const GOLDEN_RESCALE = { pointSize: POINT_SIZE_REBASE };

// The rename, which is a fact about history on exactly the terms the rescale above is.
// Step S1 moved every effect parameter onto a dotted effect-namespaced name and left the
// uniforms alone, so the committed page this arm replays still speaks the old spellings
// in one place: its control ids, which are what the `dom` and `readouts` halves of the
// snapshot are keyed by. (`landing` is keyed by this file's own table on both arms and
// already speaks today's names.) Those two halves are therefore joined on this map - the
// earlier arm is asked under the name it actually had - and the equality still has to
// hold value for value.
//
// Joined rather than excused, and the difference is the whole arm. Every name here could
// have been dropped into GOLDEN_ABSENT instead - the earlier page answers undefined
// under a dotted spelling, so the excuse would have taken - and that would have blinded
// this comparison to exactly the regression class it exists for: a renamed parameter
// whose default, range or readout moved in the same commit as its name. Four of the
// forty-two have controls on the committed page (glitch.amount, rgbsplit.amount,
// raster.amount, grain.amount) and compare against real values through this map; the
// other thirty-eight existed nowhere at BEFORE_REV and still go through GOLDEN_ABSENT,
// which the join makes *stricter* rather than looser - see the note on that set.
const GOLDEN_RENAME = {
  'noise.amount': 'noise',
  'noise.scale': 'noiseScale',
  'noise.speed': 'noiseSpeed',
  'noise.region': 'regionNoise',
  'lattice.amount': 'lattice',
  cell: 'latticeCell',
  'glyph.amount': 'glyph',
  'glyph.tone': 'glyphTone',
  'glyph.hash': 'glyphHash',
  'glyph.rain': 'glyphRain',
  'rain.amount': 'rain',
  'rain.speed': 'rainSpeed',
  'rain.span': 'rainSpan',
  'rain.trail': 'rainTrail',
  'glitch.amount': 'glitch',
  'glitch.density': 'glitchDensity',
  'glitch.shove': 'glitchShove',
  'glitch.tint': 'glitchTint',
  'glitch.bands': 'glitchBands',
  'glitch.axis': 'glitchAxis',
  'glitch.rate': 'glitchRate',
  'push.amount': 'regionPush',
  'mask.amount': 'regionMask',
  'ripple.amount': 'ripple',
  'ripple.freq': 'rippleFreq',
  'ripple.speed': 'rippleSpeed',
  'thermal.amount': 'thermal',
  'edges.amount': 'edges',
  'duotone.amount': 'duotoneDepth',
  'duotone.hue': 'duotoneHue',
  'duotone.split': 'duotoneSplit',
  'duotone.span': 'duotoneSpan',
  'duotone.motion': 'duotoneMotion',
  'rgbsplit.amount': 'rgbSplit',
  'streak.amount': 'streak',
  'streak.angle': 'streakAngle',
  'raster.amount': 'scanlines',
  'raster.angle': 'scanAngle',
  'raster.pitch': 'scanPitch',
  'raster.hard': 'scanHard',
  'grain.amount': 'grain',
  'vignette.amount': 'vignette',
};
// The same fact read the other way, for folding the earlier arm's keys into the union:
// an old-spelled control id from the committed page joins the comparison under the name
// it carries today, so a control the rename dropped shows up as a difference rather than
// standing beside the comparison as a stray key nobody compared.
const OLD_SPELLING = Object.fromEntries(
  Object.entries(GOLDEN_RENAME).map(([now, was]) => [was, now]));

// Parameters that did not exist at BEFORE_REV, so there is no earlier value to hold
// them to. This is the `camera` case rather than the `pointSize` case - nothing left to
// compare against - but it is not a skip, and the difference is what keeps it honest:
// a name is only excused here if the *earlier* arm answered `undefined`, which is the
// signature of a uniform, a slider and a readout that genuinely were not there. Put a
// name in this set that did exist at that revision and it still fails, because its old
// value is a number and a number is not undefined - and since the rename, the asking is
// done under GOLDEN_RENAME's old spelling, so respelling a name cannot manufacture the
// excuse either.
//
// What that leaves proven is the claim worth making about an added look parameter: the
// twenty-five that were already here render and read back exactly as they did, so
// twelve new sliders at their defaults changed no image. Whether the new ones reach the
// pixels at all is section 9's question, not this one's.
const GOLDEN_ABSENT = new Set([
  'noise.amount', 'noise.scale', 'noise.speed',
  'lattice.amount', 'cell',
  'regionX', 'regionY', 'regionZ', 'regionW', 'regionH', 'regionD',
  'regionRound', 'regionSoft', 'push.amount', 'noise.region', 'mask.amount',
  'ripple.amount', 'ripple.freq', 'ripple.speed',
  'thermal.amount', 'edges.amount',
  // The four lateral crop faces. They are excused here on the same terms as the rest -
  // the pinned revision has no such control, so there is nothing on that side to hold
  // them to - and the excuse costs nothing, because the defaults are the bounds: a
  // build with these planes wide open renders exactly what a build without them
  // renders. That equality is the row above, and it is the reason this arm still means
  // something with four more parameters in it.
  'left', 'right', 'bottom', 'top',
  // The switch over all six of them, and it is excused on the strongest version of the
  // terms the four faces above are: not merely that the pinned revision has no such
  // control, but that its default is the state that revision was permanently in. A build
  // whose box always bites renders exactly what a build with a switch defaulting to
  // biting renders, so this arm is unchanged by the switch existing. What happens when
  // it is *off* is not excused anywhere - it is asserted three ways in "the crop switch,
  // which the sweep above cannot see".
  'crop',
  // The two levelling angles, excused on exactly the crop faces' terms and for exactly
  // their reason: the pinned revision has no such control, and the default is the
  // identity rotation, so a build that levels the room by nothing renders what a build
  // that cannot level it at all renders. That equality is what the row above is
  // asserting, and it is why this arm still means something with two more parameters
  // in it. Whether they reach the pixels when they are *not* zero is section 9's
  // question, and the drop-one sweep there answers it.
  'tilt', 'roll',
  // Not registry parameters at all - the monitor's stream controls, which arrived with
  // step 9 and carry their own bounds in the markup. They are in this set for the same
  // reason as the rest: the earlier revision has no such control, so there is nothing
  // to hold them to here. What they *are* held to is `monitor-check`.
  'monDivisor', 'monStride', 'monAcceptCost',
  // The five readings, which are the parameters this comparison exists to be honest
  // about. At that revision the reading was an integer uniform behind five buttons,
  // so there is no earlier slider, readout or value to hold these to - the `camera`
  // case, not the `pointSize` case. What makes the excuse safe rather than convenient
  // is that their defaults are the boot mode: `readRgb` at 1 with the other four at 0
  // is what `mode == 0` was, so a build with them renders exactly what a build without
  // them rendered, which is precisely the equality the rest of this arm is measuring.
  // That the equality actually holds is not taken on trust here either - section 1b
  // hashes the framebuffer of each reading against the mode it replaced.
  'readRgb', 'readDepth', 'readGhost', 'readContour', 'readBlackwall',
  // The seven constants each reading is made of, excused on exactly the terms above and
  // for a reason that is the same sentence twice over. At the pinned revision every one
  // of these was a literal inside a mode branch, so there is no earlier slider, readout
  // or value to hold them to - and each one defaults to the literal it replaced, so a
  // build with them renders precisely what a build without them rendered. That is the
  // equality this arm measures, and section 1b is where it stops being an excuse and
  // becomes a framebuffer hash: every one of these lives inside a reading, so a default
  // that drifted moves that reading's image and fails there by name.
  'rgbSaturation', 'depthGamma', 'ghostRim', 'ghostFill',
  'contourBands', 'contourWidth', 'blackwallSweep',
  // The five ceilings under the glitch master, on exactly those terms: at the pinned
  // revision each was a literal inside the vertex stage's glitch block, and each
  // defaults to the literal it replaced, so a build carrying them tears identically to
  // one without them. What holds them to that is section 1b, which renders at parameter
  // defaults - a default that drifted off its literal would move whichever readings the
  // torn bands reach and fail there by name rather than being excused here.
  'glitch.density', 'glitch.shove', 'glitch.tint', 'glitch.bands', 'glitch.rate',
  // The band axis, which had no control at the pinned revision because the tear was cut
  // along the sensor's rows and nothing else. It defaults to 0 and the block reaches the
  // old division textually at that value, so a build carrying it draws what a build
  // without it drew.
  'glitch.axis',
  // `vignette` is here on different terms from everything above it, and the difference
  // is worth the sentence. It was a literal too, but it is the one promoted literal that
  // does NOT keep its old value: the behaviour it replaces is conditional - 0.55 while
  // some other grade term held the pass open, 0 while none did - so no default can
  // reproduce both branches. It defaults to the branch the parameter defaults are in,
  // which is why section 1b still agrees with a build from before it existed. The look
  // that did carry a vignette, `blackwall.json`, now names 0.55 for itself.
  'vignette.amount',
  // The duotone's four, on the plainest version of these terms: nothing at the pinned
  // revision resembles them, and all four default to the identity - a depth of 0 never
  // enters the block, so a build carrying them draws precisely what a build without them
  // drew. That equality is what this arm measures, and section 1b is where it stops being
  // an excuse and becomes a framebuffer hash, since the duotone sits after the blend and
  // would move every one of the five readings if its default reached a pixel.
  //
  // **`duotone.motion` is the one of the four that section 1b cannot vouch for**, and the
  // difference is worth the sentence rather than being carried along with its neighbours.
  // 1b renders at parameter defaults, where the depth is 0 and the block never executes,
  // so a term added *inside* it is unreached by that hash whichever way its own default
  // behaves - which is exactly the hole the glitch flare's compensating default fell
  // through. What holds this one instead is the planted section at the foot of this file,
  // where the block is entered with the depth up and a pair carrying real motion, and the
  // frame at a motion of 0 has to come back bit-identical to the frame with no motion in
  // it at all.
  //
  // **`duotone.span` is excused on the strongest version of these terms and is the only one
  // of the five that can say so.** The rest are excused because the pinned revision has no
  // such control; this one is excused because its default *is* the arithmetic that
  // revision ran. The ramp used to span the clip range, and the default here is the clip
  // range's own default width, so the division that converts it lands on exactly 1.0 and
  // the expression is the one the pinned build compiled. That is a claim about two float
  // literals rounding to the same value rather than about the derivation, so it is not
  // taken on trust: the commit that added this parameter carries the five readings'
  // hashes either side of the change, and section 1b is where a drift in it would show.
  'duotone.amount', 'duotone.hue', 'duotone.split', 'duotone.span', 'duotone.motion',
  // The glyph field's four and the rain's four, excused on the plainest version of these
  // terms: nothing at the pinned revision resembles any of them, so the earlier arm answers
  // undefined for all eight and there is no earlier value to hold them to.
  //
  // **Section 1b cannot vouch for six of the eight, and that is worth the sentence rather
  // than being carried along with the two it can.** 1b renders at parameter defaults, where
  // `glyph` and `rain` are both 0 and each gates its own block, so a term added *inside* one
  // of them is unreached by that hash whichever way its own default behaves - which is
  // exactly the hole the glitch flare's compensating default fell through, and the reason
  // `duotone.motion` above carries the same warning. The two the hash does cover are the
  // masters themselves: at 0 the vertex stage takes the else branch of the sprite size, so
  // the point-size statement the pinned build compiled is the one that runs, and the
  // fragment stage's crossfade multiplies by a glyphMix of exactly 0.
  //
  // What holds the other six is the drop-one sweep at the foot of this file, where all
  // eight are scrambled with their masters up and every one of them has to move the image
  // when it is dropped.
  //
  // The one thing this does *not* excuse is the energy compensation, which is not a
  // parameter and rides no master: it multiplies alpha on the shared additive path at every
  // value of everything. It is exactly 1 wherever `lattice` is 0, which is where section 1b
  // renders and where eight of the ten shipped looks sit, so a compensation that leaked at
  // zero would move this arm and 1b together rather than being excused anywhere.
  'glyph.amount', 'glyph.tone', 'glyph.hash', 'glyph.rain',
  'rain.amount', 'rain.speed', 'rain.span', 'rain.trail',
  // `crush` is here on `vignette`'s terms turned the other way up, and the contrast is
  // the reason it gets its own sentence. It was a literal too, and unlike the vignette it
  // *keeps* the value it replaced - so the excuse is the strong one rather than the
  // conditional one: 0.018 is what the grade always subtracted, and a build whose toe is
  // a uniform sitting at 0.018 draws what a build with the literal drew. What it cannot
  // be excused for is gating the pass, which nothing here would see and the pass-gate
  // matrix asserts directly.
  'crush',
  // The raster's three, on the terms the glitch ceilings are excused by: at the pinned
  // revision the pitch was a literal inside the wave and the other two did not exist in
  // any form, and each defaults to the behaviour that build had - an angle of zero along
  // the frame's y, the pitch's own 1.3, and a hardness whose zero is the identity. So a
  // build carrying them draws precisely what a build without them drew, which is the
  // equality this arm measures. That it holds is not taken on trust: section 1b renders
  // at parameter defaults, where the raster block does not run at all, and the drop-one
  // sweep is where the three are shown to reach pixels once the master is up.
  'raster.angle', 'raster.pitch', 'raster.hard',
  // The streak, which had no control and no uniform at the pinned revision. It defaults to
  // zero and the block is guarded on that, so a build carrying it draws exactly what a
  // build without it drew - the same argument the three above are excused by, and held to
  // the same standard: the pass-gate row below has it opening the grade on its own, and
  // the drop-one sweep has it reaching pixels once it is up.
  'streak.amount',
  // And its direction, which is excused twice over: there was no streak at the pinned
  // revision to point anywhere, and the axis it defaults to is the one the gather ran
  // along when it ran one way only. That second half is the stronger claim and it is not
  // taken on trust here either - the gather's own comment carries the hash comparison, and
  // section 1b renders at parameter defaults, where a streak of 0 keeps the block shut
  // whichever way the axis points.
  'streak.angle',
  // The program-out size, on the same terms and for the same reason: not a registry
  // parameter, no such control at the earlier revision, and its own bounds live in the
  // handler that parses it rather than in the markup. What it is held to is
  // `vcam-check`, whose section 5 asserts the drawing buffer really is the size this
  // box says and not the window's. `progMode` is not here because it is a `select`
  // and the snapshot walks `#panel input` - if it ever becomes an input it will
  // arrive here as a failure, which is the right way round.
  'progSize',
  // A file chooser is a control over a document, not a registry parameter. It arrived
  // with look import and has no earlier value to hold against the pre-registry page;
  // section 12 of editor-check drives the file through validation and back into the
  // renderer, while this tool's markup scan still refuses any parameter data in HTML.
  'tPresetFile',
]);
const absentBefore = (name, before) => GOLDEN_ABSENT.has(name) && before === undefined;

// The mirror, and it needs the mirrored evidence. `warp` and `warpSpeed` drove a fixed
// three-term sine field; the noise field replaced them, so their old values describe a
// displacement this build cannot produce and there is no rescale that recovers one from
// the other - the sine's amplitude and the noise's are both metres, but of different
// fields. A name is only excused if the *current* arm answers undefined, so putting one
// here that still exists fails on its own value.
const GOLDEN_REMOVED = new Set(['warp', 'warpSpeed']);
const removedSince = (name, after) => GOLDEN_REMOVED.has(name) && after === undefined;

const rescaled = (name, before, after) => {
  const factor = GOLDEN_RESCALE[name];
  if (!factor) return false;
  const x = Number(before);
  const y = Number(after);
  return Number.isFinite(x) && Number.isFinite(y) && y === x * factor;
};

for (const stage of Object.keys(beforeArm.out)) {
  const a = beforeArm.out[stage];
  const b = afterArm.out[stage];
  // Which halves join through GOLDEN_RENAME: `dom` and `readouts` are keyed by the
  // page's own control ids, and at BEFORE_REV those are the old spellings. `landing` is
  // keyed by this file's LANDING table on both arms, so a join there would look the four
  // renamed-but-real values up under keys the reader never wrote and read undefined.
  const joined = (field) => field !== 'landing';
  const spelledThen = (field, sub) => (joined(field) ? (GOLDEN_RENAME[sub] ?? sub) : sub);
  const unexplained = (field) => (typeof a[field] === 'object' && a[field]
    // Keyed off the union rather than the earlier arm's keys, because a parameter this
    // build added is absent from `a` entirely - iterating `a` alone would step straight
    // past every new name and call that agreement. The earlier arm's keys enter the
    // union under the name each carries today, so a renamed control compares rather
    // than standing beside the comparison as a stray key nobody looked at.
    ? [...new Set([
      ...Object.keys(a[field]).map((k) => (joined(field) && OLD_SPELLING[k]) || k),
      ...Object.keys(b[field] ?? {})])]
      .filter((sub) => !eq(a[field][spelledThen(field, sub)], b[field][sub])
        && !GOLDEN_SKIP.has(sub)
        && !rescaled(sub, a[field][spelledThen(field, sub)], b[field][sub])
        && !absentBefore(sub, a[field][spelledThen(field, sub)])
        && !removedSince(sub, b[field][sub]))
    : []);
  const differing = Object.keys(a).filter((field) => {
    if (eq(a[field], b[field])) return false;
    if (typeof a[field] !== 'object' || !a[field]) return true;
    return unexplained(field).length > 0;
  });
  const detail = differing.map((field) => {
    const keys = unexplained(field);
    return keys.length
      ? `${field}{${keys.map((s) => `${s}: ${show(a[field][spelledThen(field, s)])} -> ${show(b[field][s])}`).join(', ')}}`
      : `${field}: ${show(a[field])} -> ${show(b[field])}`;
  }).join('; ');
  check(differing.length === 0, `${stage.padEnd(10)} identical to ${BEFORE_REV}`, detail);
}

// And the rescale is asserted rather than assumed, at every stage of the walk and
// on all three views of the value - the uniform it lands on, the slider and the
// readout - so a preset re-tuned by hand to something near 1.8 would fail here.
{
  const wrong = [];
  const seen = [];
  for (const stage of Object.keys(beforeArm.out)) {
    for (const field of ['landing', 'dom', 'readouts']) {
      const x = Number(beforeArm.out[stage][field]?.pointSize);
      const y = Number(afterArm.out[stage][field]?.pointSize);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (field === 'landing') seen.push(`${stage} ${x}->${y}`);
      if (y !== x * POINT_SIZE_REBASE) wrong.push(`${stage}.${field} ${x} -> ${y}`);
    }
  }
  check(wrong.length === 0,
    `and pointSize moved by exactly 1080/600 everywhere it appears, because its unit did`,
    wrong.length ? wrong.join('; ') : seen.join(', '));
}

// The fixed shell gives the renderer 38 fewer vertical pixels - `web/nav.css`'s figure,
// the same one `shellGeometry` measures rather than trusts. With the proof's 640x360
// target aspect that content box is 572x322. The historical page has no target fit, so
// it is opened directly at that content size; both arms must then land on the same
// exact buffer rather than gaining a layout exception in the golden comparison.
check(
  beforeArm.out.boot.landing.renderScale === SHELL_CONTENT.width
    && afterArm.out.boot.landing.renderScale === SHELL_CONTENT.width,
  'and renderScale lands on exactly the fixed shell content fit',
  `${beforeArm.out.boot.landing.renderScale}->${afterArm.out.boot.landing.renderScale}, `
    + `wanted ${SHELL_CONTENT.width}->${SHELL_CONTENT.width}`,
);

// With no camera keys the pose is a single value the clip holds, so two renders at
// different program times land on the same place. That is the whole of the
// locked-off case and it is worth asserting rather than assuming: a render that
// still computed a pose from `t` would move here, which is the placeholder coming
// back by accident.
check(eq(afterArm.poses['0.7'], afterArm.poses['1.9']),
  'with no camera keys the program pose is the clip\'s single value at every program time',
  eq(afterArm.poses['0.7'], afterArm.poses['1.9']) ? '' : show(afterArm.poses));
console.log(`  pose at 0.7s ${show(afterArm.poses['0.7'].position.map((x) => +x.toFixed(6)))} `
  + `q ${show(afterArm.poses['0.7'].quaternion.map((x) => +x.toFixed(6)))}`);

if (beforeArm.errors.length || afterArm.errors.length) {
  console.log(`  page errors: ${[...beforeArm.errors, ...afterArm.errors].join(' | ')}`);
  failures++;
}

// ================================ 1b. each reading renders what its mode rendered

// The claim the whole look/shading merge rests on, and the only one in this file that
// compares two revisions by their pixels rather than by their state.
//
// Dissolving `mode` into five weights rewrote the arithmetic every fragment goes
// through: what was one branch of a five-way `if` is now a weighted sum divided by
// the sum of the weights. The intent is that a single reading at 1.0 is arithmetically
// the identity - `x * 1.0 / 1.0` - so every look ever authored, every saved project and
// every preset renders the pixels it always did. That is an argument, and an argument
// about floating point in a shader compiled by a driver is worth exactly nothing until
// it is hashed.
//
// **Why this is not section 1 with another field bolted on.** Section 1 compares
// uniforms, slider values and readouts. It cannot answer this: the mode and the five
// weights exist on opposite sides of the comparison, so there is no field the two arms
// could both fill in. And its before-arm is deliberately a *pre-registry* revision -
// `--before` refuses any rev containing `const PARAMS` - which is a page with no
// `k.drive` and therefore no way to read a pixel at all.
//
// So this arm takes its own revision. `--against` wants the commit before the readings
// landed, which is a rev that has both the registry and the drive harness: exactly the
// rev `--before` will not accept. Two flags because they are two different questions.
// Before the readings are committed there is no commit introducing them, so the
// marker resolves to nothing and HEAD is the correct answer - that is the whole of
// the working-tree case, where the change under test is exactly what is uncommitted.
// Falling back is only safe because of the refusal below: if this ever silently
// resolved to a rev that already has the readings, the arm would compare the tree
// against itself and print five matching hashes as a pass.
const AGAINST_REV = flag('--against')
  ?? (execFileSync('git', ['log', '-S', 'readBlackwall', '--format=%H', '--', 'web/main.js'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }).trim()
    ? revBeforeMarker('readBlackwall')
    : 'HEAD');

// Each reading, and the mode it was. The old build selects by writing the integer
// uniform directly rather than by clicking its button, and that is the point of the
// arm rather than a shortcut: `setMode(4)` applied a hardcoded twelve-value preset on
// the way past, so a click would be comparing the reading *plus a look* against the
// reading alone, and the whole reason this change exists is that those were welded.
// What is under test is the reading.
const READING_WAS = { readRgb: 0, readDepth: 1, readGhost: 2, readContour: 3, readBlackwall: 4 };

console.log(`\n[registry] each reading renders what its mode rendered, at ${AGAINST_REV}`);

{
  const againstSource = {
    js: execFileSync('git', ['show', `${AGAINST_REV}:web/main.js`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }),
    html: execFileSync('git', ['show', `${AGAINST_REV}:web/index.html`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }),
  };
  // The mirror of section 1's refusal, and it runs the other way. That one refuses a rev
  // that already has the registry; this one refuses a rev that already has the readings,
  // because serving today's page into both arms would print five matching hashes under a
  // heading claiming they came from different code - which is the failure mode this file
  // has recorded happening once already.
  if (againstSource.js.includes('readBlackwall')) {
    throw new Error(`${AGAINST_REV}:web/main.js already contains the readings - pass an earlier rev with --against`);
  }
  if (!againstSource.js.includes('uniforms.mode.value')) {
    throw new Error(`${AGAINST_REV}:web/main.js has no mode uniform to compare against`);
  }

  // **The old arm is the old readings, not the old geometry.** The unprojection's x sign
  // changed after this rev: the sensor's frames arrive horizontally mirrored and this build
  // undoes them, which `unproject` in `web/cloud-shader.js` carries the reasoning for. Left alone,
  // the pinned build draws the room reflected and every row below reports 6 of 6 frames
  // differing over a change that has nothing to do with a reading - measured, before this
  // was here: all five rows plus the raster, uniformly, where at HEAD five of the six pass.
  //
  // **This is the rule the raster arm below already states, arriving at a divergence that
  // has no parameter to express it.** That one hands the two builds different `vignette`
  // values because a promotion in `40ab241` baked the corner falloff into one of them, on
  // the principle that each build has to be given the values that mean the same picture in
  // its own vocabulary rather than the same numbers. A geometry difference has no value to
  // hand over, so the vocabulary is the source text and the patch goes here.
  //
  // Guarded the way the mutations are, and for the same reason: the text has to appear
  // exactly once or this refuses to run. A rev where it stopped matching would otherwise
  // quietly become a comparison against un-normalised geometry that reports differences as
  // findings about the readings, which is the one failure this whole section is arranged to
  // avoid. It is one entry because there has been one intentional geometry change; a second
  // belongs beside it rather than folded into it, so the list stays a readable account of
  // how this build differs from the one it is held against.
  const OLD_UNPROJECT_X = '     (pixel.x + 0.5 - center.x) / focal.x * z,';
  const MIRRORED_UNPROJECT_X = '    -(pixel.x + 0.5 - center.x) / focal.x * z,';
  const xHits = againstSource.js.split(OLD_UNPROJECT_X).length - 1;
  if (xHits !== 1) {
    throw new Error(`${AGAINST_REV}:web/main.js states the unprojection's x ${xHits} times, expected exactly 1`
      + ' - refusing to compare a mirrored build against an unmirrored one and report it as a reading');
  }
  againstSource.js = againstSource.js.replace(OLD_UNPROJECT_X, MIRRORED_UNPROJECT_X);

  // The second intentional divergence, beside the first as the comment above asks. The
  // zero-alpha discard is an approved change to the picture: a fragment at alpha 0 is
  // invisible in colour and solid in depth, and the hard-edged path discards it now -
  // points born at vFade 0 and the disc rim at exactly r2 0.25 stopped occluding what
  // sits behind them. The old arm has no such discard, so left alone these six rows
  // report 460 to 750 bytes of 921600 per frame - the approved movement, measured when
  // the discard landed - as a finding about the readings. The patch hands the old build
  // the same rule in its own source, exactly the discard-only A/B that established the
  // change touches nothing but the occluders; what the rows keep comparing is everything
  // else, which is their claim. The current arm's own repair is still refusable:
  // `--mutate margins-miss-the-newborn` un-discards the births on the current side only,
  // and these rows redden about it against the patched old arm.
  const OLD_FRAG_OUTPUT = '  fragColor = vec4(col * exposure, alpha * falloff);';
  const DISCARDED_FRAG_OUTPUT = '  if (softEdge == 0 && alpha * falloff <= 0.0) discard;\n'
    + '  fragColor = vec4(col * exposure, alpha * falloff);';
  const outHits = againstSource.js.split(OLD_FRAG_OUTPUT).length - 1;
  if (outHits !== 1) {
    throw new Error(`${AGAINST_REV}:web/main.js states the fragment output ${outHits} times, expected exactly 1`
      + ' - refusing to compare an arm with the zero-alpha discard against one without it and report it as a reading');
  }
  againstSource.js = againstSource.js.replace(OLD_FRAG_OUTPUT, DISCARDED_FRAG_OUTPUT);

  // Both arms are pinned to the same frames and the same camera, so the only thing
  // that differs between them is the shader. `params.reset()` first on each, because a
  // reading has to be measured against the same defaults the other arm booted with.
  const hashesFor = async (opts, select, cases = READING_WAS, extra = '') => {
    const { page: p, errors } = await openPage({ ...opts, pin: true });
    await p.evaluate(async () => {
      const buffer = await (await fetch('/__pinned.bin')).arrayBuffer();
      globalThis.__kinect.drive.pin(buffer);
    });
    const at = await p.evaluate(`(() => {
      const times = globalThis.__kinect.drive.times();
      return times.slice(0, ${SOURCE_FRAMES});
    })()`);
    const meta = await p.evaluate(`(() => {
      const k = globalThis.__kinect;
      const gl = k.renderer.getContext();
      const box = k.renderer.domElement.getBoundingClientRect();
      return {
        window: [innerWidth, innerHeight],
        canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        css: [box.x, box.y, box.width, box.height],
        composer: [k.composer.renderTarget1.width, k.composer.renderTarget1.height],
        afterimage: [k.afterimage._textureComp.width, k.afterimage._textureComp.height],
        cameraAspect: k.freeCamera.aspect,
        bufferHeight: k.uniforms.bufferHeight.value,
      };
    })()`);
    const out = {};
    for (const [reading, mode] of Object.entries(cases)) {
      out[reading] = await p.evaluate(`(async () => {
        ${PAGE_HELPERS}
        k.params.reset();
        ${select}
        ${extra}
        k.drive.reset();
        pinCamera(k.freeCamera);
        // The frames themselves rather than digests of them, because the comparison
        // downstream is a measurement and a hash answers only "same or not". Base64 so
        // the bridge carries a string: five readings by six frames of 640x360 RGBA is
        // about 37MB per arm, which node holds without complaint and which buys the row
        // the ability to say *how* two builds differ rather than only that they do.
        // Chunked into the encoder because a single spread of a million-element typed
        // array overflows the argument list.
        const frames = [];
        for (const t of ${JSON.stringify(at)}) {
          k.drive.stepTo(t);
          const px = k.drive.readPixels();
          let bin = '';
          for (let i = 0; i < px.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
          }
          frames.push(btoa(bin));
        }
        return frames;
      })()`.replace(/\$MODE/g, String(mode)).replace(/\$READING/g, JSON.stringify(reading)));
    }
    await p.close();
    return { out, errors, meta };
  };

  const oldArm = await hashesFor(
    { source: againstSource, viewportSize: COMPARISON_VIEW, comparisonShell: true },
    'k.uniforms.mode.value = $MODE;',
  );
  const newArm = await hashesFor(
    { viewportSize: COMPARISON_VIEW, comparisonShell: true },
    'k.readings().forEach((n) => k.params.set(n, 0)); k.params.set($READING, 1);',
  );
  console.log(`  comparison geometry old ${JSON.stringify(oldArm.meta)} new ${JSON.stringify(newArm.meta)}`);

  // **The same picture, which is not the same bytes, and the gap between those was a red
  // row in every run of this tool for as long as it existed.**
  //
  // `readGhost` disagreed with its pinned mode at frames 2 and 3 and nothing else did. It
  // was carried as a known standing failure - `crush-gates-the-grade` was calibrated
  // against it, and two comments in `web/cloud-shader.js` record it reproducing unchanged
  // across shader rewrites - which is the worst place for a defect to sit, because a row
  // already red is where a new one hides. So it was measured rather than carried further.
  //
  // The two frames differ by **one byte out of 921,600, by exactly 1**. That is a single
  // colour channel of a single fragment landing the other side of a rounding boundary, and
  // it is the shape `web/cloud-shader.js` already has two case files about: adding a branch
  // the shader never takes reddened three of these rows, because a branch in the common
  // path costs the compiler the contractions it was making either side. The two arms are
  // independently compiled shaders whose source differs by everything the registry did, so
  // asking them for identical bytes asks the two compilations to agree - which is a claim
  // about a driver rather than about a reading, and not one this product can keep.
  //
  // **The threshold is derived from both ends rather than picked.** Measured noise is 1
  // byte at delta 1 - re-measured at 640x360 rather than carried over from the 640x400 stage
  // this was first calibrated at, because a frame at a different pixel count is a different
  // population and the old figures would be a number this repo would find later and have to
  // correct. The smallest true positive this row has to catch is `ghost-alpha-term-dropped`,
  // which removes one term from the ghost's alpha: it moves 156,247 to 159,539 bytes - about
  // 17% of the frame - with deltas of 47 to 52, unchanged from before because a delta is a
  // colour-channel magnitude and does not move with the frame's pixel count. So 64 bytes
  // sits 64x above the noise and about 2,400x below the quietest real defect, and there is
  // no value in between that a sane instrument would disagree about.
  //
  // Two conditions rather than one, because a defect can be loud in either dimension: a
  // handful of fragments moved a long way trips the delta, and a great many moved one step
  // trips the count. What neither catches is a defect that moves one fragment by one step,
  // and that is stated rather than hidden - such a change is *by construction*
  // indistinguishable from the compiler noise this row has been printing since it shipped.
  const TOLERATED_BYTES = 64;
  const framePixels = (s) => Buffer.from(s, 'base64');
  const frameDelta = (x, y) => {
    const A = framePixels(x);
    const B = framePixels(y);
    if (A.length !== B.length) return { bytes: Infinity, max: Infinity, sized: [A.length, B.length] };
    let bytes = 0;
    let max = 0;
    for (let i = 0; i < A.length; i++) {
      const d = Math.abs(A[i] - B[i]);
      if (d) { bytes++; if (d > max) max = d; }
    }
    return { bytes, max, of: A.length };
  };

  for (const [reading, mode] of Object.entries(READING_WAS)) {
    const a = oldArm.out[reading];
    const b = newArm.out[reading];
    const deltas = a.map((frame, i) => frameDelta(frame, b[i]));
    const moved = deltas
      .map((d, i) => ({ ...d, frame: i }))
      .filter((d) => d.bytes > TOLERATED_BYTES || d.max > 1);
    const touched = deltas.filter((d) => d.bytes > 0).length;
    check(moved.length === 0,
      `${reading.padEnd(13)} at 1.0 renders the same picture as mode ${mode} at ${AGAINST_REV}`,
      // **Which frames and by how much, not which frame.** Reporting only the first
      // mismatch cannot tell a transient from a divergence, and those are different
      // findings: one frame out of a walk is a warm-up the two builds enter differently,
      // while every frame from some index on is a term that has actually changed. The
      // magnitudes are printed beside them for the same reason one step further on - a
      // row that says "2 of 6 frames differ" and a row that says "1 byte of 921,600 by
      // 1" are the same row, and only the second one lets a reader tell a defect from two
      // compilers rounding a fragment differently.
      //
      // The passing line names what was tolerated rather than saying nothing, because a
      // green row that quietly absorbed a difference is how a tolerance turns into a
      // blindfold. On this rig it reads `6 frames, 2 within tolerance`, and a day when it
      // reads 6 is a day to come back and look.
      moved.length === 0
        ? `${a.length} frames${touched ? `, ${touched} within tolerance `
          + `(worst ${Math.max(...deltas.map((d) => d.bytes))} bytes of ${deltas[0].of}, `
          + `delta ${Math.max(...deltas.map((d) => d.max))})` : ''}`
        : `${moved.length} of ${a.length} frames differ beyond ${TOLERATED_BYTES} bytes or 1 step: `
          + moved.map((d) => `f${d.frame} ${d.bytes} bytes of ${d.of} max ${d.max}`).join(', '));
  }

  // ---- the grade term whose default is not zero, at the value the shipped look uses.
  //
  // **The five rows above cannot see the raster at all, and that is worth saying plainly
  // rather than leaving as a gap somebody finds later.** They render at parameter
  // defaults, `raster.amount` defaults to 0, and the whole raster block sits behind
  // `if (scanlines > 0.0)` - so a run that came back bit-identical has measured the
  // branch being added and not one line of the arithmetic inside it. Every mutation in
  // this file's table is likewise blind to it, because the drop-one sweep compares arms
  // of one build against each other rather than against a build from before.
  //
  // What makes that a hole rather than a nicety is `presets-builtin/blackwall.json`,
  // which names `raster.amount: 0.35`. The generalisation replaced an inline expression with
  // a coordinate through a local, which is exactly the substitution `docs/measurement.md`
  // records producing a third image out of two that were each bit-identical - so "the
  // defaults reach the old expression" is a claim about a compiler, and the shipped look
  // is what pays if it is wrong. `determinism-check` and `export-check` both read that
  // file and deliberately *follow* it rather than pinning it, so neither would notice.
  //
  // One reading, so the raster is the only thing that can differ between the arms, and
  // **Blackwall rather than colour, which is a correction rather than a preference.**
  // Written on `readRgb` first, this arm was an arm lit by a single source: the pinned
  // build selects a reading by integer mode and cannot mix, so one reading is all either
  // side gets, and `--mutate rgb-contributes-no-alpha` then renders black on both of them.
  // They compare identical, the control reports `0 of 6 frames differ with the master
  // off`, and the whole section fires against a mutation with nothing to do with the
  // raster - which is the last entry in `docs/instruments.md`, reproduced in the tool that
  // entry is about. Blackwall writes its own alpha and the readRgb block is guarded on a
  // weight this arm leaves at zero, so no reading's mutation can switch this probe off.
  //
  // It is also the more faithful choice: `blackwall.json` is the document that names a
  // raster.amount of 0.35, so this arm now stands where the shipped look actually stands.
  //
  // **The two arms are handed different values on purpose, and the first version of this
  // row was wrong for exactly the reason that sounds like a bug.** Raising the raster
  // opens the grade pass on both builds, and the pinned one bakes its corner falloff into
  // that pass as `mix(1.0, vig, 0.55)` where this one reads a `vignette.amount` parameter
  // that defaults to 0. So the obvious arrangement - the same look on both sides - compares a
  // frame with a vignette against a frame without one, and reports 6 of 6 frames differing
  // over a promotion that landed in `40ab241` and has nothing to do with the raster. Named
  // here, the two arms draw the same corner falloff and the raster is what is left.
  //
  // This is the units error `export-check`'s cross-build arm already records, arriving
  // from the other direction: **each build has to be given the values that mean the same
  // picture in its own vocabulary**, not the same numbers. `blackwall.json` names 0.55 for
  // precisely this reason. Since the rename that vocabulary includes the names themselves:
  // the pinned build predates it and answers to `scanlines`, where this build answers to
  // `raster.amount`, so the two arms are two spellings of one look on the same terms as
  // the two values - and the new arm is its own literal rather than a derivation from the
  // old one, because deriving it would smuggle the old spelling into the build that no
  // longer speaks it.
  const RASTER_OLD_LOOK = "k.params.set('scanlines', 0.35);";
  const RASTER_NEW_LOOK = "k.params.set('raster.amount', 0.35); k.params.set('vignette.amount', 0.55);";
  {
    const rasterOld = await hashesFor(
      { source: againstSource, viewportSize: COMPARISON_VIEW, comparisonShell: true },
      'k.uniforms.mode.value = $MODE;',
      { readBlackwall: 4 },
      RASTER_OLD_LOOK,
    );
    const rasterNew = await hashesFor(
      { viewportSize: COMPARISON_VIEW, comparisonShell: true },
      'k.readings().forEach((n) => k.params.set(n, 0)); k.params.set($READING, 1);',
      { readBlackwall: 4 },
      RASTER_NEW_LOOK,
    );
    const a = rasterOld.out.readBlackwall;
    const b = rasterNew.out.readBlackwall;
    const first = a.findIndex((h, i) => h !== b[i]);
    check(eq(a, b),
      `and the raster at the shipped look's 0.35 is bit-identical to the one line it replaced, at ${AGAINST_REV}`,
      first < 0
        ? `${a.length} frames, angle 0 pitch 1.3 hardness 0`
        : `${a.filter((h, i) => h !== b[i]).length} of ${a.length} frames differ, first at `
          + `${first}: ${a[first].slice(0, 12)} vs ${b[first].slice(0, 12)}`);
    // The control, and this row is the reason the one above is not vacuous. Two arms that
    // both drew no raster at all would compare bit-identical just as happily, so the
    // sweep has to be shown to have something in it: raising the master has to move the
    // picture on the build under test.
    const flat = rasterNew.out.readBlackwall;
    const lit = (await hashesFor(
      { viewportSize: COMPARISON_VIEW, comparisonShell: true },
      'k.readings().forEach((n) => k.params.set(n, 0)); k.params.set($READING, 1);',
      { readBlackwall: 4 },
      "k.params.set('raster.amount', 0.0); k.params.set('vignette.amount', 0.55);",
    )).out.readBlackwall;
    check(!eq(flat, lit),
      'and the raster is actually drawing at that value, so the equality above is about something',
      `${flat.filter((h, i) => h !== lit[i]).length} of ${flat.length} frames differ with the master off`);
  }

  // The falsification control, and it is the reason the five rows above mean anything.
  // Five hashes agreeing across two revisions would agree just as well if the pinned
  // run rendered nothing at all, or rendered the same thing whatever was selected - a
  // black frame is bit-identical to a black frame. So the readings have to differ from
  // *each other*: five distinct images on each side, which is what makes "identical
  // across the revisions" a statement about the readings rather than about the harness.
  for (const [armName, arm] of [['old', oldArm], ['new', newArm]]) {
    const distinct = new Set(Object.values(arm.out).map((hs) => hs.join('|'))).size;
    check(distinct === Object.keys(READING_WAS).length,
      `and the ${armName} arm's five readings are five different images`,
      `${distinct} distinct of ${Object.keys(READING_WAS).length}`);
  }

  if (oldArm.errors.length || newArm.errors.length) {
    console.log(`  page errors: ${[...oldArm.errors, ...newArm.errors].join(' | ')}`);
    failures++;
  }
}

// ============================================================ the working page

const main = await openPage({ pin: true });
const { page } = main;
RENDER_BUFFER = await page.evaluate(`(() => {
  const gl = globalThis.__kinect.renderer.getContext();
  return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
})()`);

const declared = await page.evaluate(`(() => {
  const k = globalThis.__kinect;
  return Object.fromEntries(k.params.names().map((n) => [n, k.params.spec(n)]));
})()`);

// `LANDING` gets a coverage row of its own below; `SCRAMBLE` had none, and a
// parameter the registry declares but this table has never heard of arrives as
// `Error: left is a scalar: it takes a finite number, got undefined` from three
// frames inside `params.set`. That names the parameter and nothing about the reason,
// and it is a crash rather than a finding - so the tool exits 2 having tested
// nothing while looking like it failed. Refused here instead, in a sentence.
//
// Exit 2 rather than a failed assertion because a scrambled set missing a parameter
// cannot sweep the registry it claims to sweep: the run did not happen.
{
  const missing = Object.keys(declared).filter((n) => !(n in SCRAMBLE));
  if (missing.length) {
    console.log(`[registry] DID NOT RUN - the registry declares ${missing.join(', ')} and SCRAMBLE has no `
      + 'value for them, so the scrambled set is not the whole registry. Add one on its own step grid, '
      + 'in the order PARAMS declares it - the serialised comparison below is a JSON.stringify equality '
      + 'and is sensitive to key order.');
    process.exit(2);
  }
}

// =========================================================== 2. the declaration

console.log('\n[registry] the declaration');
{
  const names = Object.keys(declared);
  check(eq(names.sort(), Object.keys(LANDING).sort()),
    `every declared parameter has a landing site here (${names.length})`,
    show(names.filter((n) => !(n in LANDING))));

  const kinds = { scalar: [], step: [], pose: [] };
  const tags = { look: [], composition: [], view: [] };
  let bad = [];
  for (const [name, spec] of Object.entries(declared)) {
    if (!kinds[spec.kind]) bad.push(`${name} kind=${spec.kind}`);
    else kinds[spec.kind].push(name);
    if (!tags[spec.tag]) bad.push(`${name} tag=${spec.tag}`);
    else tags[spec.tag].push(name);
    // Every checkbox holds until the next key, because lerping a boolean is
    // meaningless - so a boolean declared scalar is a keyframe bug waiting for
    // step 5 rather than a cosmetic slip.
    if (typeof spec.default === 'boolean' && spec.kind !== 'step') bad.push(`${name} is boolean but kind=${spec.kind}`);
    // Keyed off the type of the default rather than off the kind: `normalise`
    // sends every non-boolean, non-pose value down the scalar branch, so a
    // future numeric step-kind parameter declared without a range would clamp
    // against undefined and store NaN.
    if (typeof spec.default === 'number' && !(spec.min < spec.max && spec.step > 0)) {
      bad.push(`${name} is numeric but has no usable range`);
    }
  }
  check(bad.length === 0, 'every parameter carries a usable kind, tag and range', bad.join('; '));
  check(kinds.scalar.length > 0 && kinds.step.length > 0 && kinds.pose.length > 0,
    'all three interpolation kinds are in use',
    `scalar ${kinds.scalar.length}, step ${kinds.step.length} (${kinds.step.join(',')}), pose ${kinds.pose.join(',')}`);
  console.log(`        look ${tags.look.length}: ${tags.look.join(' ')}`);
  console.log(`        composition ${tags.composition.length}: ${tags.composition.join(' ')}`);
  console.log(`        view ${tags.view.length}: ${tags.view.join(' ')}`);

  // This row used to assert the opposite: `!('mode' in declared)`, on the reasoning
  // that a mode key would rewrite twelve other tracks at the instant it fired. That
  // reasoning was about the twelve values `setMode` bundled in, not about the reading,
  // and unbundling it removed both the bundle and the objection. The row is inverted
  // rather than deleted because the property is still worth pinning down - it is just
  // the other property now, and a build that reintroduced an integer mode beside the
  // weights would fail here.
  check(!('mode' in declared), 'there is no mode parameter left to keyframe against');
  const readings = await page.evaluate('globalThis.__kinect.readings()');
  const missing = readings.filter((n) => !(n in declared));
  check(readings.length > 0 && missing.length === 0,
    'every reading is a registry parameter',
    missing.length ? `not declared: ${missing.join(', ')}` : readings.join(' '));
  // Scalar and look, both load-bearing and for different reasons. `step` would hold
  // until the next key, which is a reading that snaps rather than dissolves - the one
  // capability this change exists to add. And `view` would keep them out of a preset
  // and out of the undo snapshot, which is where the mode effectively sat.
  const wrongSpec = readings.filter((n) => declared[n].kind !== 'scalar' || declared[n].tag !== 'look');
  check(wrongSpec.length === 0,
    'and each one is a look-tagged scalar, so it presets and it dissolves',
    wrongSpec.length ? wrongSpec.map((n) => `${n} kind=${declared[n].kind} tag=${declared[n].tag}`).join('; ')
      : `${readings.length} readings`);
}

// ================================== 2b. the write path refuses what it cannot hold

// `params.apply(JSON.parse(projectFile))` is the path this registry advertises, so
// the values that arrive there are the ones worth being hostile about. A coercion
// that turns a truncated or hand-edited project into a plausible-looking look is
// worse than a throw, because nothing downstream can tell it happened.
console.log('\n[registry] bad values are refused rather than coerced');
{
  // Each case is JS source evaluated in the page rather than a value serialised
  // into it. That is not fussiness: JSON.stringify turns NaN and undefined into
  // null, so a table of literals would quietly test null three times over while its
  // labels claimed otherwise - an instrument lying about what it just proved.
  const REJECT = [
    ['camera', '{ position: [1, 2], quaternion: [0, 0, 0, 1], fov: 50 }', 'a short position'],
    ['camera', '{ position: [1, 2, 3], quaternion: [0, 0, 0], fov: 50 }', 'a short quaternion'],
    ['camera', '{ position: [1, 2, 3], quaternion: [0, 0, 0, 1] }', 'no fov at all'],
    ['camera', "{ position: ['1', '2', '3'], quaternion: [0, 0, 0, 1], fov: 50 }", 'strings for a position'],
    ['camera', '{ position: [1, 2, NaN], quaternion: [0, 0, 0, 1], fov: 50 }', 'a NaN component'],
    ['camera', '{ position: [1, 2, 3], quaternion: [0, 0, 0, 1], fov: NaN }', 'a NaN fov'],
    ['camera', 'null', 'null for a pose'],
    ['bloom', 'null', 'null for a scalar'],
    ['bloom', "''", 'an empty string for a scalar'],
    ['bloom', "'1.5'", 'a numeric string for a scalar'],
    ['bloom', 'NaN', 'NaN for a scalar'],
    ['bloom', 'undefined', 'a missing value for a scalar'],
    ['additive', 'null', 'null for a step'],
    ['additive', "'false'", 'the string "false" for a step'],
    ['additive', '1', 'a number for a step'],
    ['additive', 'undefined', 'a missing value for a step'],
  ];
  const ACCEPT = [
    ['camera', JSON.stringify(SCRAMBLE.camera)],
    ['bloom', '1.5'],
    ['additive', 'true'],
  ];
  const asCases = (rows) => rows
    .map(([name, expr]) => `{ name: ${JSON.stringify(name)}, value: ${expr} }`)
    .join(', ');

  const outcome = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    const out = { rejected: [], leaked: [], accepted: [], camera: null };
    for (const { name, value } of [${asCases(REJECT)}]) {
      const before = JSON.stringify(k.params.get(name));
      let threw = false;
      try { k.params.set(name, value); } catch { threw = true; }
      out.rejected.push(threw);
      // A refusal that had already written half of itself would be worse than the
      // coercion it replaced, so the stored value has to be untouched.
      if (JSON.stringify(k.params.get(name)) !== before) out.leaked.push(name);
    }
    for (const { name, value } of [${asCases(ACCEPT)}]) {
      let ok = false;
      try { k.params.set(name, value); ok = true; } catch (e) { ok = String(e); }
      out.accepted.push(ok);
    }
    out.camera = [...k.programCamera.position.toArray(), k.programCamera.fov, k.programCamera.projectionMatrix.elements[0]];
    k.params.reset();
    return out;
  })()`);

  const missed = REJECT.filter((_, i) => !outcome.rejected[i]).map(([n, , why]) => `${n}: ${why}`);
  check(missed.length === 0, `all ${REJECT.length} malformed values throw`, missed.join('; '));
  check(outcome.leaked.length === 0, 'and a refusal writes nothing at all', outcome.leaked.join(' '));
  check(outcome.accepted.every((x) => x === true), 'while well-formed values still go through',
    outcome.accepted.filter((x) => x !== true).join('; '));
  // NaN reaching the pose is the specific failure this guards: it never throws, it
  // just poisons the projection matrix, and live viewing hides it because the next
  // frame rewrites the pose from program time.
  check(outcome.camera.every(Number.isFinite), 'and nothing left NaN on the camera', show(outcome.camera));
}

console.log('\n[registry] a serialised project is document state, never view state');
{
  const sets = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    return {
      byDefault: Object.keys(k.params.values()),
      everything: Object.keys(k.params.values(k.params.names())),
      look: k.params.names('look'),
      view: k.params.names('view'),
      composition: k.params.names('composition'),
    };
  })()`);
  const leaked = sets.view.filter((n) => sets.byDefault.includes(n));
  check(leaked.length === 0,
    'values() leaves view state out, so an undo snapshot cannot swallow it', leaked.join(' '));
  check(sets.composition.every((n) => sets.byDefault.includes(n))
    && sets.look.every((n) => sets.byDefault.includes(n)),
    `and carries all ${sets.look.length} look and ${sets.composition.length} composition parameters`);
  check(sets.everything.length === sets.byDefault.length + sets.view.length,
    'while view state is still reachable by naming it', `${sets.everything.length} named explicitly`);
}

// ================================================== 3. the HTML holds no data

console.log('\n[registry] the panel carries no parameter data of its own');
{
  // The strong form of this row, and it had to become the strong form: the panel's rows
  // are generated from the registry now, so no registry-owned input appears in the
  // markup at all - and the old row, which kept the inputs whose id is a parameter and
  // asserted none of them carried a range, passed on an empty set having examined
  // nothing. A row that cannot fail is worse than no row, because it reads as coverage.
  //
  // So the claim is the one generation actually makes, with the count printed beside it
  // and a floor under the scan for the same reason `syntax-check` refuses to pass on
  // finding no files: a regex that stopped matching `<input` would otherwise report a
  // clean panel about nothing. What the markup still legitimately carries is the sensor
  // and monitor controls, the retime slider, the export name and the preset file picker -
  // eight, none of them registry-owned - and the floor sits well under that deliberately,
  // because this row is about the scan working rather than about the number. A gate set at
  // exactly today's count would fail the next honest markup edit, which is the zero-margin
  // threshold this repo has already been bitten by once.
  //
  // The second clause is the sharper half. `id="..."` is matched with double quotes, so an
  // input written with single quotes would parse as having no id, drop out of the owned
  // comparison, and be reported as a clean panel - the regex failing in precisely the
  // direction that looks like a pass. Every input tag has to yield an id or the scan is
  // not reading what it claims to read.
  const html = readFileSync(join(REPO, 'web/index.html'), 'utf8');
  const owned = new Set(Object.keys(declared));
  const tags = html.match(/<input[^>]*>/g) ?? [];
  const ids = tags.map((tag) => tag.match(/id="([^"]+)"/)?.[1]).filter(Boolean);
  const MARKUP_INPUT_FLOOR = 4;
  check(tags.length >= MARKUP_INPUT_FLOOR && ids.length === tags.length,
    `the markup scan found the inputs it is supposed to read (${tags.length} of at least ${MARKUP_INPUT_FLOOR}, all with ids)`,
    `${ids.join(' ')}`);
  const inMarkup = ids.filter((id) => owned.has(id));
  check(inMarkup.length === 0,
    `no registry-owned input is written in the markup at all - every one of the ${owned.size} `
    + 'is generated from the registry, so there is no second copy of a range to drift',
    inMarkup.join(' '));

  const stamped = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    const out = {};
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el) { out[name] = null; continue; }
      out[name] = el.type === 'checkbox'
        ? { checked: el.checked }
        : { min: el.min, max: el.max, step: el.step, value: el.value,
            out: el.parentElement.querySelector('output')?.textContent };
    }
    return out;
  })()`);
  const wrong = [];
  for (const [name, spec] of Object.entries(declared)) {
    const el = stamped[name];
    if (spec.tag === 'composition') {
      if (el !== null) wrong.push(`${name} is composition but has a control`);
      continue;
    }
    if (el === null) { wrong.push(`${name} has no control`); continue; }
    if ('checked' in el) {
      if (el.checked !== spec.default) wrong.push(`${name} checked=${el.checked} want ${spec.default}`);
      continue;
    }
    if (el.min !== String(spec.min) || el.max !== String(spec.max) || el.step !== String(spec.step)) {
      wrong.push(`${name} range ${el.min}..${el.max}/${el.step} want ${spec.min}..${spec.max}/${spec.step}`);
    }
    if (el.value !== String(spec.default)) wrong.push(`${name} value=${el.value} want ${spec.default}`);
    if (el.out !== String(spec.default)) wrong.push(`${name} readout=${el.out} want ${spec.default}`);
  }
  check(wrong.length === 0, 'every control has its range, default and readout stamped from the registry', wrong.join('; '));
}

// ========================================================== 4. every value lands

console.log('\n[registry] every parameter round-trips to where the renderer reads it');
{
  const probe = async (values) => page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    k.params.apply(${JSON.stringify(values)});
    return { values: k.params.values(k.params.names()), landing: ${landingReader} };
  })()`);

  const wrong = [];
  for (const [name, value] of Object.entries(SCRAMBLE)) {
    const { values, landing } = await probe({ [name]: value });
    if (!eq(values[name], value)) {
      wrong.push(`${name} stored ${show(values[name])} not ${show(value)}`);
      continue;
    }
    const want = EXPECT[name](values[name], values);
    if (!eq(landing[name], want)) wrong.push(`${name} landed ${show(landing[name])} want ${show(want)}`);
  }
  check(wrong.length === 0, `all ${Object.keys(SCRAMBLE).length} parameters land one at a time`, wrong.join('; '));

  // The whole set at once, so a parameter that only lands when nothing else moved
  // does not slip through.
  const { values, landing } = await probe(SCRAMBLE);
  const together = Object.keys(SCRAMBLE)
    .filter((n) => !eq(landing[n], EXPECT[n](values[n], values)))
    .map((n) => `${n}=${show(landing[n])}`);
  check(together.length === 0, 'and all of them at once', together.join('; '));
}

console.log('\n[registry] the side effects that are not a uniform write');
{
  const setAndRead = async (values) => page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    k.params.apply(${JSON.stringify(values)});
    return {
      drawRange: k.geometry.drawRange.count,
      bloom: k.bloom.enabled, trails: k.afterimage.enabled, grade: k.grade.enabled,
      blending: k.material.blending, depthWrite: k.material.depthWrite, softEdge: k.uniforms.softEdge.value,
      buffer: [k.renderer.getContext().drawingBufferWidth, k.renderer.getContext().drawingBufferHeight],
    };
  })()`);

  // The ghost half of the geometry is drawn when either persistence term can shed
  // and left out of the draw range when neither can, so the matrix is the test.
  const range = [];
  for (const [fade, wake, want] of [[0, 0, POINTS], [10, 0, POINTS * 2], [0, 10, POINTS * 2], [120, 550, POINTS * 2]]) {
    const r = await setAndRead({ fade, wake });
    if (r.drawRange !== want) range.push(`fade=${fade} wake=${wake} -> ${r.drawRange} want ${want}`);
  }
  check(range.length === 0, 'fade and wake move the draw range together', range.join('; '));

  const gates = [];
  for (const [values, want] of [
    [{ bloom: 0, trails: 0, 'rgbsplit.amount': 0, 'raster.amount': 0, 'grain.amount': 0, 'vignette.amount': 0 },
      { bloom: false, trails: false, grade: false }],
    [{ bloom: 0.05 }, { bloom: true, trails: false, grade: false }],
    [{ trails: 0.01 }, { bloom: false, trails: true, grade: false }],
    [{ 'rgbsplit.amount': 0.05 }, { bloom: false, trails: false, grade: true }],
    [{ 'raster.amount': 0.01 }, { bloom: false, trails: false, grade: true }],
    [{ 'grain.amount': 0.01 }, { bloom: false, trails: false, grade: true }],
    // The fourth term sharing that pass, and the one that used to ride on the other
    // three: raised on its own it has to bring the pass up by itself, or the vignette
    // is back to being a thing you can only have by asking for something else.
    [{ 'vignette.amount': 0.01 }, { bloom: false, trails: false, grade: true }],
    // The streak, which gates for the plain reason rather than by exception: its default
    // is zero, so a look that never asks for it pays nothing. This row is the one that
    // separates it from `crush` below - both share the pass, and only the one whose off
    // state is actually off is allowed to switch it on.
    [{ 'streak.amount': 0.02 }, { bloom: false, trails: false, grade: true }],
    // The fifth term in that pass, and the only one whose expectation is `false`. `crush`
    // shares the grade and deliberately does not gate it, so this row is the negative
    // asserted rather than left as an omission - an omission would pass on a build that
    // gated it, and gating it is the tempting edit, because every neighbour above does.
    //
    // What it would cost is why the row is worth its line. The toe defaults to 0.018 and
    // not to 0, so `crush > 0` is true of every document there has ever been: the pass
    // would run for the four shipped presets that ask for no grade at all, each paying a
    // full-screen read and write to be put through a Reinhard curve nobody graded them
    // through, and section 1b would redden on all five readings at once against a build
    // from before the registry existed.
    [{ crush: 0.5 }, { bloom: false, trails: false, grade: false }],
    // The raster's three settings, on `crush`'s terms and each for its own reason. The
    // pitch is the one that would fail loudest if it gated, since it defaults to 1.3 and
    // so is non-zero in every document there has ever been; the angle and the hardness
    // would merely switch a full-screen pass on to rotate and square a raster whose master
    // is off, which is the no-op this row exists to refuse. All three are settings of
    // `raster.amount`, and the pass is the master's to gate.
    [{ 'raster.angle': 90 }, { bloom: false, trails: false, grade: false }],
    [{ 'raster.pitch': 0.3 }, { bloom: false, trails: false, grade: false }],
    [{ 'raster.hard': 1 }, { bloom: false, trails: false, grade: false }],
    // The streak's direction, on the raster angle's terms: a setting of the term above it
    // rather than a term beside it, so pointing a streak nobody raised has to leave the
    // pass shut. Gating it would switch a full-screen read and write on to aim an effect
    // whose amount is zero, which is precisely the no-op the gate exists to refuse.
    [{ 'streak.angle': 90 }, { bloom: false, trails: false, grade: false }],
  ]) {
    const r = await setAndRead(values);
    const got = { bloom: r.bloom, trails: r.trails, grade: r.grade };
    if (!eq(got, want)) gates.push(`${show(values)} -> ${show(got)} want ${show(want)}`);
  }
  check(gates.length === 0, 'a zero value switches its pass off rather than running it as a no-op', gates.join('; '));

  const blend = [];
  for (const on of [true, false]) {
    const r = await setAndRead({ additive: on });
    const want = { blending: on ? ADDITIVE_BLENDING : NORMAL_BLENDING, depthWrite: !on, softEdge: on ? 1 : 0 };
    const got = { blending: r.blending, depthWrite: r.depthWrite, softEdge: r.softEdge };
    if (!eq(got, want)) blend.push(`additive=${on} -> ${show(got)} want ${show(want)}`);
  }
  check(blend.length === 0, 'additive drives blending, depth write and the sprite falloff together', blend.join('; '));

  const scales = [];
  for (const v of [40, 100, 200]) {
    const r = await setAndRead({ renderScale: v });
    const want = [
      Math.floor(RENDER_BUFFER.width * v / 100),
      Math.floor(RENDER_BUFFER.height * v / 100),
    ];
    if (!eq(r.buffer, want)) scales.push(`renderScale=${v} -> ${show(r.buffer)} want ${show(want)}`);
  }
  check(scales.length === 0, 'render scale resizes the drawing buffer', scales.join('; '));

  await page.evaluate('globalThis.__kinect.params.reset()');
}

// ============================================================ 5. the UI is a view

console.log('\n[registry] the panel is a view, in both directions');
{
  // Direction one: the control moves, the registry follows. The event is the one a
  // drag produces - `input` on a range, `change` on a checkbox - so this exercises
  // the listener the user reaches, not a function the check picked.
  const fromControl = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    const wrong = [];
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el) continue;
      const spec = k.params.spec(name);
      if (el.type === 'checkbox') {
        el.checked = !spec.default;
        el.dispatchEvent(new Event('change'));
        if (k.params.get(name) !== !spec.default) wrong.push(name + ' -> ' + k.params.get(name));
        continue;
      }
      const target = ${JSON.stringify(SCRAMBLE)}[name];
      el.value = String(target);
      el.dispatchEvent(new Event('input'));
      if (k.params.get(name) !== target) wrong.push(name + ' -> ' + k.params.get(name));
    }
    return wrong;
  })()`);
  check(fromControl.length === 0, 'moving a control writes the registry', fromControl.join('; '));

  // Direction two: the registry moves, the control and its readout follow. This is
  // the direction a keyframe, a preset and a restored project all arrive from, and
  // a panel that did not follow would show the previous look while rendering the
  // new one.
  const fromRegistry = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    const wrong = [];
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el) continue;
      const value = ${JSON.stringify(SCRAMBLE)}[name];
      k.params.set(name, value);
      if (el.type === 'checkbox') {
        if (el.checked !== value) wrong.push(name + ' checkbox=' + el.checked);
        continue;
      }
      if (el.value !== String(value)) wrong.push(name + ' slider=' + el.value + ' want ' + value);
      const out = el.parentElement.querySelector('output');
      if (out && out.textContent !== String(value)) wrong.push(name + ' readout=' + out.textContent);
    }
    return wrong;
  })()`);
  check(fromRegistry.length === 0, 'writing the registry moves the control and its readout', fromRegistry.join('; '));

  // Out of range and off the step grid, from both sides. The registry has to do the
  // clamping and snapping itself rather than lean on the DOM for it, or a value set
  // headlessly by step 6 lands on the uniform unsnapped while the same value set
  // through a slider lands snapped, and the panel and the image disagree.
  const clamped = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    const wrong = [];
    for (const name of k.params.names()) {
      const el = document.getElementById(name);
      if (!el || el.type === 'checkbox') continue;
      const spec = k.params.spec(name);
      // Below, above, a value that rounds down, and a tie that has to round up -
      // the tie is the one where the registry's arithmetic and the browser's
      // step alignment could part company without either looking wrong.
      for (const raw of [spec.min - 1000, spec.max + 1000, spec.min + spec.step * 0.4, spec.min + spec.step * 6.5]) {
        const stored = k.params.set(name, raw);
        if (stored < spec.min || stored > spec.max) wrong.push(name + ' ' + raw + ' -> ' + stored);
        else if (el.value !== String(stored)) wrong.push(name + ' ' + raw + ' -> registry ' + stored + ', slider ' + el.value);
      }
    }
    return wrong;
  })()`);
  check(clamped.length === 0, 'out-of-range and off-grid values clamp and snap the same way the slider does', clamped.join('; '));

  await page.evaluate('globalThis.__kinect.params.reset()');
}

// ================================================ 6. presets are user actions only

console.log('\n[registry] a preset can only be applied by a user action');
{
  // A look to apply, written here rather than taken from the page. It used to be
  // `k.presets.BLACKWALL`, a hardcoded constant the module exported for this and for
  // `setMode` to bundle in - and the bundling is what the readings replaced, so the
  // constant went with it. A preset is a document now, and what this section is about
  // is the guard rather than any particular look, so two values are enough.
  const A_LOOK = { bloom: 0.5, trails: 0.5 };

  const guard = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.reset();

    // Outside evaluation it has to work, or the check below would pass on a
    // preset path that was simply broken.
    let outside = 'applied';
    try { k.applyPreset(${JSON.stringify(A_LOOK)}); } catch (e) { outside = String(e); }
    const applied = k.params.get('bloom');
    k.params.reset();

    // Inside one, it has to refuse. The probe rides three's own pre-render hook,
    // which fires from inside renderProgramFrame, so this is the timeline calling
    // rather than the check pretending to be it.
    const seen = {};
    k.scene.onBeforeRender = () => {
      k.scene.onBeforeRender = () => {};
      try { k.applyPreset(${JSON.stringify(A_LOOK)}); seen.preset = 'applied'; }
      catch (e) { seen.preset = 'refused'; }
      // An ordinary parameter write must stay legal: that is exactly what step 5's
      // tracks do every frame, and what the camera already does.
      try { k.params.set('bloom', 0.25); seen.param = 'written'; }
      catch (e) { seen.param = String(e); }
      // And a reading is one of those writes now. This row used to be its opposite -
      // "selecting a mode during evaluation is refused" - and the inversion is the
      // capability rather than a relaxed guard: a mode was refused *because* selecting
      // one applied a twelve-value preset behind it, so it could never be a track. A
      // reading writes one number, which is what a track does every frame, so refusing
      // it here would be refusing the dissolve this change exists to allow.
      try { k.params.set('readBlackwall', 1); seen.reading = 'written'; }
      catch (e) { seen.reading = String(e); }
    };
    k.drive.stepTo(0);
    k.scene.onBeforeRender = () => {};

    return { outside, applied, seen, bloomAfter: k.params.get('bloom'), readingAfter: k.params.get('readBlackwall') };
  })()`);

  check(guard.outside === 'applied' && guard.applied === 0.5,
    'applying a preset outside evaluation writes it', `bloom=${guard.applied}`);
  check(guard.seen.preset === 'refused', 'applying a preset during evaluation is refused', show(guard.seen.preset));
  check(guard.seen.param === 'written' && guard.bloomAfter === 0.25,
    'an ordinary parameter write during evaluation still works', `bloom=${guard.bloomAfter}`);
  check(guard.seen.reading === 'written' && guard.readingAfter === 1,
    'and a reading is an ordinary write, so a track can dissolve one under the playhead',
    `readBlackwall=${guard.readingAfter}`);

  // What a preset carries is the look tag and nothing else, so the tag has to be
  // the thing that selects it rather than a label beside a hand-written list.
  const selection = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.reset();
    const chosen = k.params.names('look');
    k.params.set('camera', ${JSON.stringify(SCRAMBLE.camera)});
    k.params.set('renderScale', 60);
    const captured = k.params.values(chosen);

    // Move everything, then apply the captured look back. A preset that moved the
    // camera would not be a preset, it would be a saved project.
    k.params.apply(${JSON.stringify(SCRAMBLE)});
    k.applyPreset(captured);
    return {
      chosen,
      captured: Object.keys(captured),
      camera: k.params.get('camera'),
      renderScale: k.params.get('renderScale'),
      bloom: k.params.get('bloom'),
      near: k.params.get('near'),
    };
  })()`);

  check(!selection.captured.includes('camera') && !selection.captured.includes('spin')
    && !selection.captured.includes('renderScale'),
    'the default preset selection is the look tag, so composition and view stay out',
    `${selection.captured.length} parameters`);
  check(selection.captured.includes('near') && selection.captured.includes('far'),
    'and the depth clip is in it, as a look control whose default selection can be unpicked');
  check(eq(selection.camera, SCRAMBLE.camera),
    'applying a look leaves the camera exactly where it was', show(selection.camera.position));
  check(selection.renderScale === 85, 'and leaves view state to the viewer', `renderScale=${selection.renderScale}`);
  check(selection.bloom === 0 && selection.near === 0.05,
    'while the look values it does carry are written', `bloom=${selection.bloom} near=${selection.near}`);

  await page.evaluate('globalThis.__kinect.params.reset()');
}

// ============================================ 7. the render path writes the camera

console.log('\n[registry] the camera pose goes in through the registry, not around it');
{
  // Two keys a metre apart, so "moves with program time" is a claim about a track
  // rather than about a placeholder that happened to animate. The wild pose is
  // written first and has to lose: with keys on the track the evaluator overwrites
  // it, which is the property that makes a keyed parameter keyed at all.
  const camera = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    const wild = ${JSON.stringify(SCRAMBLE.camera)};
    k.params.set('camera', wild);
    const written = [k.params.get('camera'), k.programCamera.position.toArray()];

    const q = [0, 0, 0, 1];
    k.keyframes.setTracks({ camera: [
      { t: 0, value: { position: [-1, 0.2, 1], quaternion: q, fov: 50 } },
      { t: 2, value: { position: [1, 0.2, 1], quaternion: q, fov: 50 } },
    ] });

    k.drive.reset();
    k.drive.stepTo(0.4);
    const stored = k.params.get('camera');
    const onCamera = {
      position: k.programCamera.position.toArray(),
      quaternion: k.programCamera.quaternion.toArray(),
      fov: k.programCamera.fov,
    };
    k.drive.stepTo(0.9);
    const later = k.params.get('camera');
    k.keyframes.setTracks({});
    return { written, stored, onCamera, later };
  })()`);

  check(eq(camera.written[0], SCRAMBLE.camera) && eq(camera.written[1], SCRAMBLE.camera.position),
    'a pose written through the registry reaches the camera object');
  // The load-bearing one. If the render path posed the camera directly, the
  // registry would still be holding the wild pose while the camera had moved -
  // so agreement here is what says the write goes through the registry.
  check(eq(camera.stored, camera.onCamera),
    'after a render the registry holds the pose the camera is actually at',
    `${show(camera.stored.position)} vs ${show(camera.onCamera.position)}`);
  check(!eq(camera.stored.position, SCRAMBLE.camera.position),
    'and it is the pose the track asked for, not the one the check wrote');
  check(!eq(camera.stored.position, camera.later.position),
    'and it moves with program time', `${show(camera.stored.position)} -> ${show(camera.later.position)}`);
}

// ============================== 8. serialise, restore, and the same pixels back

console.log('\n[registry] serialise, restore, and the image comes back byte for byte');

// The reading the sweep runs in is now part of the scrambled set rather than a click
// that precedes it, and that is a repair rather than a translation. This used to click
// the Blackwall button, because `scan` and `rim` reach the shader only inside that
// branch and a sweep run in RGB would have found them inert - a real hole, correctly
// closed for the parameters that existed then. The same hole reopened wider the moment
// the readings became parameters: `params.reset()` boots `readRgb` at 1, so a sweep
// that did not say otherwise would run entirely in RGB and record `scan`, `rim` and
// every future per-reading term as unable to touch a pixel.
//
// So `SCRAMBLE` carries all five readings non-zero, and every reading's block is live
// in every image the sweep hashes. That is the "what do all my arms agree about"
// question asked of this file's own sweep, which had exactly one arm and one answer.
await page.evaluate(async () => {
  const buffer = await (await fetch('/__pinned.bin')).arrayBuffer();
  globalThis.__kinect.drive.pin(buffer);
});

// And a colour image, because one parameter is only observable through one.
//
// `pin` above switches colour off - a JPEG decode is asynchronous and a pinned run that
// raced it would hash a frame whose colour had or had not arrived - so every point in
// every arm below draws the flat `vec3(0.7)` the shader falls back to. Saturation of a
// uniform grey is the identity at every value, so `rgbSaturation` would have come out of
// the drop-one sweep as a parameter that cannot reach a pixel: a probe standing in a
// dead zone, reporting a clean pass on a build that had the term backwards.
//
// Four saturated pixels rather than a photograph, and the bytes live here rather than in
// the page so this arm owns its own input. Both samplers are pointed at the one texture,
// so nothing depends on which side of the pair `mixT` favours at a given position.
await page.evaluate(`globalThis.__kinect.drive.plantColor(${JSON.stringify([
  220, 30, 40, 255, 30, 200, 90, 255,
  40, 70, 230, 255, 230, 200, 40, 255,
])}, 2, 2)`);
// Asserted rather than assumed, because the arm it exists for is a *negative* result
// otherwise: a plant that silently failed leaves the grey behind, `rgbSaturation` lands
// in the no-effect bucket, and the sweep reports a parameter that cannot reach a pixel
// as though it had measured one.
{
  const planted = await page.evaluate('globalThis.__kinect.uniforms.hasColor.value');
  check(planted === 1,
    'the sweep runs against a colour image, so a colour term is not measured on grey',
    `hasColor ${planted}`);
}

const positions = await page.evaluate(`(() => {
  const times = globalThis.__kinect.drive.times();
  const out = [];
  for (let i = 0; i < times.length - 1; i++) {
    for (let r = 0; r < ${SUBSTEPS}; r++) out.push(times[i] + (times[i + 1] - times[i]) * (r / ${SUBSTEPS}));
  }
  return out;
})()`);

const runWith = `async ({ values, positions }) => {
  ${PAGE_HELPERS}
  k.params.reset();
  k.params.apply(values);
  k.drive.reset();
  pinCamera(k.freeCamera);
  const out = [];
  for (const t of positions) {
    k.drive.stepTo(t);
    out.push(await sha256(k.drive.readPixels()));
  }
  return out;
}`;
const run = (values) => page.evaluate(`(${runWith})(${JSON.stringify({ values, positions })})`);

const serialised = await page.evaluate(`(() => {
  const k = globalThis.__kinect;
  k.params.reset();
  k.params.apply(${JSON.stringify(SCRAMBLE)});
  return JSON.parse(JSON.stringify(k.params.values(k.params.names())));
})()`);

const defaults = await page.evaluate(
  "(() => { const k = globalThis.__kinect; k.params.reset(); return JSON.parse(JSON.stringify(k.params.values(k.params.names()))); })()");

const scrambledRun = await run(SCRAMBLE);
const defaultRun = await run(defaults);
const restoredRun = await run(serialised);

console.log(`  ${positions.length} images per run over `
  + `${positions[0].toFixed(3)}s to ${positions[positions.length - 1].toFixed(3)}s, `
  + `${new Set(scrambledRun).size} of them distinct`);

check(eq(scrambledRun, restoredRun),
  'the restored set reproduces the run exactly',
  eq(scrambledRun, restoredRun) ? '' : `first divergence at image ${scrambledRun.findIndex((h, i) => h !== restoredRun[i])}`);
// Strictly equal, not merely the same size: every value here is already on its
// own step grid, so anything the registry did to one of them on the way in and
// back out is a normalisation bug rather than a rounding it was asked for.
check(eq(serialised, JSON.parse(JSON.stringify(SCRAMBLE))),
  `the serialised set is the scrambled set, value for value (${Object.keys(serialised).length} parameters)`,
  Object.keys(SCRAMBLE).filter((n) => !eq(serialised[n], SCRAMBLE[n]))
    .map((n) => `${n}: ${show(serialised[n])} not ${show(SCRAMBLE[n])}`).join('; '));
// The blunt control: if the registry were not driving the renderer at all, the
// defaults would render the same images as the scrambled set and the equality
// above would be arithmetic rather than evidence.
check(!eq(scrambledRun, defaultRun), 'and the defaults do not - the registry is what the image depends on');
check(new Set(scrambledRun).size > positions.length / 2, 'the input moves across the run');

// =================================== 8b. the mix is a mix, and it normalises

// **The one property this file could not otherwise fail on, and it needed an oracle
// nothing else here provides.** Section 1b compares each reading against the revision
// before the weights existed, which is the strongest evidence available for a *single*
// reading - and it is silent about mixing by construction, because a single reading at
// 1.0 divides by 1.0 and any normalisation whatsoever is the identity there. Section 8
// above compares a build against itself, so a build that mixed wrongly but consistently
// reproduces its own run exactly and passes. The old build cannot mix at all, so there
// is no earlier revision to hash against either.
//
// What is left is an identity the correct implementation satisfies and a wrong one does
// not: the weights are a ratio, so scaling all of them by any constant must render the
// *same image*. sum(k*w*c) / sum(k*w) cancels the k. A build dividing by a constant
// instead of by the sum, or by the number of live readings, changes brightness the
// moment the scale changes - while staying bit-identical on every single-reading arm,
// which is exactly the shape section 1b cannot see.
console.log('\n[registry] the readings mix as a ratio, so their scale cancels');
{
  // Deliberately not equal to each other and deliberately not summing to 1, so neither
  // a build that ignored the denominator nor one that assumed the weights were already
  // normalised can agree with the correct answer by luck.
  const RATIO = { readRgb: 0.4, readDepth: 0.3, readGhost: 0.2, readContour: 0, readBlackwall: 0 };
  const scaled = (k) => Object.fromEntries(Object.entries(RATIO).map(([n, v]) => [n, v * k]));

  const atOne = await run(scaled(1));
  const atTwo = await run(scaled(2));
  check(eq(atOne, atTwo),
    'doubling every weight renders the identical image, because a ratio has no scale',
    eq(atOne, atTwo) ? `${atOne.length} frames` : `first divergence at image ${atOne.findIndex((h, i) => h !== atTwo[i])}`);

  // And the control for that row, because two identical images prove nothing if the
  // weights reach no pixel: the mix has to differ from each of the readings it is made
  // of. Without this, a build that ignored the weights entirely would pass the row
  // above perfectly - it renders the same image for every input, which is the strongest
  // possible form of "the scale cancels".
  const solo = {};
  for (const name of Object.keys(RATIO)) {
    solo[name] = await run({ ...Object.fromEntries(Object.keys(RATIO).map((n) => [n, 0])), [name]: 1 });
  }
  const sameAsSolo = Object.keys(RATIO).filter((n) => eq(atOne, solo[n]));
  check(sameAsSolo.length === 0,
    'and the mix is none of the readings it is made of',
    sameAsSolo.length ? `identical to ${sameAsSolo.join(', ')} alone` : 'distinct from all five');
}

console.log('\n[registry] the falsification control: each parameter left out of the restore in turn');
{
  const noEffect = [];
  const changed = [];
  for (const name of Object.keys(serialised)) {
    const partial = { ...serialised };
    delete partial[name];
    const hashes = await run(partial);
    if (eq(hashes, scrambledRun)) noEffect.push(name);
    else changed.push(name);
  }
  console.log(`  omitting any of these changed the image: ${changed.join(' ')}`);
  const unexplained = noEffect.filter((n) => !(n in NO_PIXEL_EFFECT));
  for (const name of noEffect.filter((n) => n in NO_PIXEL_EFFECT)) {
    console.log(`  ${name} left the image unchanged, as declared: ${NO_PIXEL_EFFECT[name]}`);
  }
  check(unexplained.length === 0,
    `every parameter outside the declared exceptions changes the image when it is dropped`,
    unexplained.length ? `unexplained: ${unexplained.join(' ')}` : '');
  check(changed.length > 0 && noEffect.length === Object.keys(NO_PIXEL_EFFECT).length,
    `${changed.length} of ${Object.keys(serialised).length} parameters are proven to reach the pixels`);
}

// The switch that gates the crop, which the sweep above declares it cannot see: it is
// scrambled to its default so the six faces it gates stay observable, and dropping a
// parameter that is already at its default changes nothing. So it is proven here
// instead, and the second row is the one that carries the design decision.
//
// **`crop` covers all six faces and not the four lateral ones.** That was very nearly
// got wrong on the grounds that `nearClip`/`farClip` also normalise the depth ramp, so
// releasing them would re-grade every point still inside the box - which is true of a
// switch that opened the values and false of this one, because it gates the discard and
// leaves the uniforms where the document put them. The second row is what keeps the
// design honest under a later edit: it authors nothing but the depth pair, so the only
// thing the switch has left to release is `near` and `far`.
console.log('\n[registry] the crop switch, which the sweep above cannot see');
{
  const released = await run({ ...SCRAMBLE, crop: false });
  check(!eq(scrambledRun, released),
    'releasing the crop changes the image, against the six faces the scrambled set authors',
    eq(scrambledRun, released) ? 'identical' : `first divergence at image ${scrambledRun.findIndex((h, i) => h !== released[i])}`);

  // The scrambled set with the four lateral faces put back to their own defaults, which
  // are their bounds - so the only thing the switch has left to release is the depth
  // pair. The bounds are read off the registry rather than named here, which would be
  // this file carrying a second copy of `CROP_LIMIT`.
  //
  // **The rest of the scrambled look comes along, and that is a repair.** The arm was
  // written as `{ near, far }` alone, which leaves every reading at its default - one
  // source, `readRgb`, carrying the whole image. `--mutate rgb-contributes-no-alpha`
  // then renders black on both arms, they compare identical, and this row fired against
  // a mutation that has nothing to do with the crop. A probe lit by five readings cannot
  // be switched off by one of them.
  const depthOnly = {
    ...SCRAMBLE,
    left: defaults.left,
    right: defaults.right,
    bottom: defaults.bottom,
    top: defaults.top,
  };
  const depthBiting = await run(depthOnly);
  const depthReleased = await run({ ...depthOnly, crop: false });
  check(!eq(depthBiting, depthReleased),
    'and it reaches the depth pair, not only the four lateral faces',
    eq(depthBiting, depthReleased) ? 'identical with only near/far authored' : 'the box releases in depth too');

  // The control for both rows. Two images that differ prove the switch does something;
  // they do not prove it does the *right* thing, and the thing it must not do is move
  // the planes. A build whose release opened `nearClip`/`farClip` instead of skipping
  // the test would pass both rows above and fail this one, because the depth ramp is
  // normalised against those two uniforms and every surviving point would be recoloured.
  const landing = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    k.params.set('near', ${SCRAMBLE.near});
    k.params.set('far', ${SCRAMBLE.far});
    k.params.set('crop', false);
    const off = [k.uniforms.nearClip.value, k.uniforms.farClip.value];
    k.params.set('crop', true);
    return { off, on: [k.uniforms.nearClip.value, k.uniforms.farClip.value] };
  })()`);
  check(eq(landing.off, landing.on) && eq(landing.on, [SCRAMBLE.near, SCRAMBLE.far]),
    'and it releases by not testing rather than by moving the planes, so the depth ramp is unchanged',
    `nearClip/farClip released ${JSON.stringify(landing.off)}, applied ${JSON.stringify(landing.on)}`);
}

// The streak's direction, which the drop-one sweep cannot see either, and for a sharper
// reason than the crop switch's. That sweep asks whether reverting a parameter changes the
// image; a streak pointed the wrong way changes it just as much as one pointed the right
// way, so the sweep is green on a build that runs every streak the same direction whatever
// the slider says. Where the light goes is the entire claim the term makes, and nothing
// above this line tests it.
//
// **This is a probe placed where its answer is different rather than where it was
// convenient.** It exists because the direction was got wrong once already, from a
// derivation about which way v grows in the grade pass, and that build had every uniform
// landing, every image changing and a green suite. What caught it was somebody looking at a
// picture, and this is the arm that means the next one does not have to.
//
// **The arm calibrates its own axes rather than asserting them, and that is a repair rather
// than a design.** It was first written comparing row indices against a stated convention -
// `readPixels` reads from the lower-left, so light that falls lands at lower indices - and
// it went red on a build whose rendered frames plainly show the light falling. Rather than
// flip the comparison until it agreed, which is changing the code under test to satisfy the
// probe, both axes are measured here. The crop's four lateral faces cut in world metres,
// and the pinned camera looks along -z with world up on screen and world +x off to its
// right, so cutting the top removes light that is high on screen by construction and
// cutting the right face removes light that is over on one side of it. Which index each cut
// takes its light from is which way the rows and the columns run, read off this framebuffer
// on this build rather than remembered.
//
// **Each row is a difference between two opposite angles rather than a displacement from
// the picture, and that is a measurement rather than a preference.** The displacement form
// is what this section shipped with, and it carries a bias the size of the answer. The
// light a streak adds is only ever near the bright things, so its centroid sits where the
// highlights are as much as where the streak took them - measured on this fixture, the
// light added at 0 and the light added at 180 both sit about fifty columns to the *right*
// of the source's own centroid, so a row written that way would report a streak running
// rightward at both of the two angles that have no sideways component at all. The bias is
// common to both arms of a pair and cancels term by term, which is the same subtraction
// `level-check` makes when it reads its inset once with an empty depth grid.
//
// It buys an unambiguous control as well as an honest statistic: a build that ignores the
// angle renders the *same frame* at both ends of every pair, so each difference is exactly
// zero rather than merely small.
console.log('\n[registry] the streak goes where the angle points');
{
  const fall = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    const gl = k.renderer.getContext();
    const lum = (px, i) => px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
    // The same program position the runs above use, so this is measured on a frame the
    // rest of the section has already shown to carry a picture rather than on one picked
    // here for being convenient.
    const at = ${JSON.stringify(positions[positions.length - 1])};
    const shot = (over) => {
      k.params.reset();
      k.params.apply(${JSON.stringify(SCRAMBLE)});
      k.params.apply(over);
      k.drive.reset();
      pinCamera(k.freeCamera);
      k.drive.stepTo(at);
      return k.drive.readPixels();
    };
    // The size is taken after the first render rather than before it, because the
    // scrambled set carries a render scale: a buffer read before anything applied it
    // describes a drawing buffer this block never looks at, and every index below would be
    // out by the ratio between the two. It used to be read at the top and was right only
    // because a neighbouring section happened to leave the page scrambled.
    const base = shot({ 'streak.amount': 0 });
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    // The luminance-weighted mean position of the light in a that is not in b, so one
    // helper reads the light a term adds and the light a crop face takes away.
    const meanPos = (a, b) => {
      let sr = 0, sc = 0, weight = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const v = b ? Math.max(0, lum(a, i) - lum(b, i)) : lum(a, i);
          sr += v * y;
          sc += v * x;
          weight += v;
        }
      }
      return { row: weight > 0 ? sr / weight : -1, col: weight > 0 ? sc / weight : -1, weight };
    };
    // The scrambled crop window runs -1.5 to 1 in y and -1.5 to 1.5 in x, so each face
    // brought to the value below takes roughly half the room off its own side of the
    // picture and leaves the other half standing.
    const cut = (over) => meanPos(base, shot({ 'streak.amount': 0, ...over }));
    const added = {};
    for (const a of [0, 180, 90, -90, 45, -135]) {
      added[a] = meanPos(shot({ 'streak.amount': 0.9, 'streak.angle': a }), base);
    }
    return {
      added,
      upper: cut({ top: -0.2 }),
      lower: cut({ bottom: -0.2 }),
      starboard: cut({ right: 0 }),
      port: cut({ left: 0 }),
      width: W,
      height: H,
    };
  })()`);

  check(fall.added[0].weight > 0,
    'the streak adds light at all, so the rows below are about something',
    `added luminance ${fall.added[0].weight.toFixed(0)} at an angle of 0`);

  // Each calibration has to have worked before its answer means anything: both cuts must
  // remove light, and they must remove it from opposite ends. A pair that agreed would be
  // two arms that cannot measure the quantity they were placed to measure.
  const upSpread = fall.upper.row - fall.lower.row;
  check(fall.upper.weight > 0 && fall.lower.weight > 0 && Math.abs(upSpread) > fall.height * 0.05,
    'cropping the room\'s top and its bottom take light from opposite ends, so the rows are calibrated',
    `top cut removes light at row ${fall.upper.row.toFixed(1)}, bottom cut at `
    + `${fall.lower.row.toFixed(1)} of ${fall.height}`);

  const acrossSpread = fall.starboard.col - fall.port.col;
  check(fall.starboard.weight > 0 && fall.port.weight > 0 && Math.abs(acrossSpread) > fall.width * 0.05,
    'and its right and its left do the same across the frame, so the columns are as well',
    `right cut removes light at column ${fall.starboard.col.toFixed(1)}, left cut at `
    + `${fall.port.col.toFixed(1)} of ${fall.width}`);

  // Screen-up is whichever way the top cut's light lies and screen-right whichever way the
  // right cut's does, so the two signs turn a pair of index differences into a direction on
  // the glass. What it has to agree with is the direction the slider names: the registry
  // lands (sin, cos) of the angle and the gather reads *along* that axis, so the light
  // travels the other way, -(sin, cos) in screen right and up.
  const up = Math.sign(upSpread);
  const rightward = Math.sign(acrossSpread);
  // The two gates are set between a clean build and a nailed one rather than chosen for
  // looking round. Measured on this fixture at a 492x307 drawing buffer: the three pairs
  // separate by 7.86%, 7.55% and 7.05% of the frame along the angle against a floor of 3%,
  // and drift 1.06%, 0.47% and 0.45% across it, which is 0.13, 0.06 and 0.06 of the
  // distance travelled against a ceiling of 0.4. `--mutate streak-ignores-angle` renders
  // one frame at every angle, so it answers 0.00% along and 0.00% across and fails both
  // terms of all three rows.
  //
  // Both terms earn their place: the floor is what a build that lost the direction fails,
  // and the ceiling is what a build that has a direction but the wrong one fails - a
  // streak running at 45 degrees to the angle its slider names clears the first and not
  // the second.
  for (const [a, b, sentence] of [
    [0, 180, 'the light at 0 lands below the light at 180, so an angle of zero is straight down'],
    [90, -90, 'and the light at 90 lands to the left of the light at -90, so a right angle runs across the frame'],
    [45, -135, 'and the light at 45 lands on the diagonal between them, so this is an angle rather than four choices'],
  ]) {
    const sx = ((fall.added[a].col - fall.added[b].col) / fall.width) * rightward;
    const sy = ((fall.added[a].row - fall.added[b].row) / fall.height) * up;
    const r = a * (Math.PI / 180);
    const ex = -Math.sin(r); const ey = -Math.cos(r);
    const along = sx * ex + sy * ey;
    const across = Math.abs(sx * ey - sy * ex);
    check(along > 0.03 && across < along * 0.4, sentence,
      `${a} against ${b}: ${(100 * along).toFixed(2)}% of the frame along the angle, `
      + `${(100 * across).toFixed(2)}% across it, with screen-up at `
      + `${up > 0 ? 'rising' : 'falling'} rows and screen-right at `
      + `${rightward > 0 ? 'rising' : 'falling'} columns`);
  }
}

// The ripple raised on its own, which is the one arrangement that can see whether the
// region's gate learned about it. **The scrambled set raises all four region effects at
// once**, so a gate that never names the ripple still computes a weight for the other
// three and the ripple still works - the drop-one sweep goes green over a term that is
// inert the moment it is used the way anybody would use it, which is alone. The failure
// this closes is not "the ripple does nothing" but "the ripple does nothing unless
// something else is already on", and only a look with nothing else on can tell them apart.
console.log('\n[registry] the ripple opens the region by itself');
{
  const alone = { ...SCRAMBLE, 'push.amount': 0, 'noise.region': 0, 'mask.amount': 0 };
  const still = await run({ ...alone, 'ripple.amount': 0 });
  const moving = await run(alone);
  check(!eq(still, moving),
    'raising the ripple alone moves the picture, so the gate names it',
    eq(still, moving)
      ? 'identical with every other region effect at zero - the gate does not name the ripple'
      : `${still.filter((h, i) => h !== moving[i]).length} of ${still.length} frames differ`);
}

// The lattice snaps in the levelled frame and gets back with the transpose, which is the
// inverse **only while the cloud's matrix is a pure rotation**. That is currently true
// because the world tilt is the only transform ever written on it, and using the matrix
// three already provides is what keeps the shader from carrying a second copy of the same
// rotation that could drift from it. But "currently true" is an assumption, and an
// assumption a comment states is one nothing enforces: a scale or an offset added to the
// cloud later would leave the transpose silently not the inverse, and the lattice would
// shear the room instead of stepping it.
console.log('\n[registry] the cloud carries a rotation and nothing else');
{
  const m = await page.evaluate(`(() => {
    const k = globalThis.__kinect;
    let cloud = null;
    k.scene.traverse((o) => { if (o.geometry === k.geometry) cloud = o; });
    if (!cloud) return { found: false };
    cloud.updateMatrixWorld(true);
    const pos = new (cloud.position.constructor)();
    const quat = new (cloud.quaternion.constructor)();
    const scale = new (cloud.scale.constructor)();
    cloud.matrixWorld.decompose(pos, quat, scale);
    return {
      found: true,
      position: [pos.x, pos.y, pos.z].map((v) => Number(v.toFixed(9))),
      scale: [scale.x, scale.y, scale.z].map((v) => Number(v.toFixed(9))),
    };
  })()`);
  check(m.found, 'the point cloud is reachable from the scene, so the row below is about it');
  check(m.found && eq(m.position, [0, 0, 0]) && eq(m.scale, [1, 1, 1]),
    'and its world matrix is a pure rotation, so the lattice\'s transpose is its inverse',
    m.found ? `position ${JSON.stringify(m.position)} scale ${JSON.stringify(m.scale)}` : '');
}

// The ripple's clock steps rather than slides, which is the term's whole character and
// which **no mutation of it was caught by until this arm existed**. The drop-one sweep asks
// whether reverting `ripple.speed` changes the picture, and it does either way - a smooth
// wave moves when you change its speed exactly as a stepped one does - so a build whose
// ripple breathed instead of ratcheting went green through the entire suite. Written after
// running `--mutate ripple-clock-continuous` and watching it be missed.
//
// **The probe holds the clock still and moves the speed, which is the opposite of the
// obvious arrangement and the reason this one works.** Comparing two program times inside
// one step was tried first and failed on a build that steps correctly, because moving the
// time moves everything else with it - which source frames are bound, the gap handed to
// the state pass, the turbulence field that `noise.region` keeps alive even with
// `noise.amount` at zero. Every one of those had to be chased down and the arm was still
// red. Holding the
// time fixed removes the entire class: the two renders differ in one uniform, and a phase
// that quantises cannot tell them apart.
//
// At a fixed time the phase is `floor(t * speed * 8) / 8`, so speeds that land inside one
// eighth have to render the same frame and a speed that crosses into the next has to
// render a different one. The second row is the control: two identical frames prove
// quantisation only if the clock is running at all.
console.log('\n[registry] the ripple advances in steps, not smoothly');
{
  const AT = 0.5;
  const at = async (speed) => page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    k.params.reset();
    k.params.apply(${JSON.stringify(SCRAMBLE)});
    k.params.set('ripple.speed', ${speed});
    k.drive.reset();
    pinCamera(k.freeCamera);
    k.drive.stepTo(${AT});
    return await sha256(k.drive.readPixels());
  })()`);

  // floor(0.5 * speed * 8) is 4 at both 1.00 and 1.20, and 5 at 1.30.
  const inStep = await at(1.0);
  const alsoInStep = await at(1.2);
  const nextStep = await at(1.3);
  check(inStep === alsoInStep,
    'two speeds inside one step render the same frame, so the phase is quantised',
    inStep === alsoInStep ? `both ${inStep.slice(0, 12)} at 1.00 and 1.20`
      : `${inStep.slice(0, 12)} vs ${alsoInStep.slice(0, 12)} - the phase slid inside a step`);
  check(inStep !== nextStep,
    'and a speed in the next step renders a different one, so the clock is running',
    inStep === nextStep ? 'identical across a step boundary at 1.30' : 'differs at 1.30');
}

// The duotone's motion half, which is the only term in this file whose input the fixture
// cannot be relied on to supply. Every other parameter here is read off a value the
// registry holds; this one is read off the difference between two depth frames, and the
// six frames this file pins are of a nearly static room - the median sample moves 31 mm/s,
// which is the sensor's own jitter. The drop-one sweep does see it, because a subject
// moves through those frames and 7.7% of samples clear 150 mm/s, but what the sweep sees
// is "reverting this changed something" and the claims worth making are all sharper than
// that. So the input is planted rather than found.
//
// **The plant is a pair, and it is the only way to make one.** `injectDepth` is called
// twice because `bindDepth` swaps the two textures and then writes, so the first call is
// what becomes `depthPrev` and the second is `depthCurr` - the same idiom `monitor-check`
// uses to reach both halves of the door. What the door does not touch is the three numbers
// that describe the pair rather than its pixels, so `mixT`, `sinceFrameSec` and `spanSec`
// are written here by hand, and a section that forgot would be dividing a planted
// difference by whatever gap the last real frame arrived with.
//
// And nothing may call `drive.stepTo` afterwards: that re-enters the transport, which
// binds real frames over the plant and hands the shader a span to match. Everything below
// renders straight through `renderer.render`, which is what `renderProgramFrame` does
// itself at these parameter values, since none of the post passes are on.
//
// **Every arm plants the same current frame and differs only in the previous one**, with
// `mixT` held at 1 so the blend is the identity on it. That is what makes these rows about
// the speed and nothing else: the geometry, the neighbour spread, the point size and the
// surface memory are identical across all four, and the only thing that can move a pixel
// is the varying. The numbers are chosen so the arithmetic is exact in float32 - 240mm over
// a quarter second and 60mm over a sixteenth are both exactly 960 mm/s - because a row
// asking for bit-identity cannot afford a quotient that lands one ulp apart on two paths
// that are supposed to agree.
console.log('\n[registry] a pair planted with a known speed in it');
{
  // 1100mm puts the wall at a t of 0.15 through the default clip range, so the depth key
  // leaves it near the cold pole with the whole of the ramp above it for motion to reach
  // into. A plant at the far end of the room would sit at a k already close to 1, where
  // pushing toward 1 is arithmetically almost the identity - a probe placed where its
  // answer cannot be different.
  const CURR_MM = 1100;
  // The look the plant is read through. The depth is up because the block is guarded on
  // it, and the two shedding windows are at zero for two reasons: the ghost half leaves
  // the draw range, so nothing renders from a surface memory this section never advances,
  // and vFade takes the ternary's 1.0 rather than a value that depends on how long ago a
  // frame notionally arrived.
  const LOOK = { 'duotone.amount': 1, fade: 0, wake: 0 };

  // The previous frame is built from a rule rather than filled with a value, so one helper
  // plants both a uniform wall and a chequered one: a block size of 0 is the plane, and any
  // other size alternates `prevMm` with the current depth in squares of that many texels.
  // **Block (0, 0) is deliberately one of the moving ones**, so a build reading a single
  // fixed texel reads a moving sample and renders the chequer as the all-moving frame -
  // which is what gives the rows below something to separate.
  const shot = ({ prevMm, spanSec, motion, block = 0 }) => page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    k.params.reset();
    k.params.apply(${JSON.stringify(LOOK)});
    k.params.set('duotone.motion', ${motion});
    k.drive.reset();
    pinCamera(k.freeCamera);
    const plane = (mm) => new Uint16Array(512 * 424).fill(mm);
    const previous = () => {
      const block = ${block};
      if (block === 0) return plane(${prevMm});
      const a = new Uint16Array(512 * 424);
      for (let row = 0; row < 424; row++) {
        for (let col = 0; col < 512; col++) {
          const moving = (((col / block) | 0) + ((row / block) | 0)) % 2 === 0;
          a[row * 512 + col] = moving ? ${prevMm} : ${CURR_MM};
        }
      }
      return a;
    };
    k.drive.injectDepth(previous());
    k.drive.injectDepth(plane(${CURR_MM}));
    k.uniforms.mixT.value = 1;
    k.uniforms.sinceFrameSec.value = 0;
    k.uniforms.spanSec.value = ${spanSec};
    k.renderer.render(k.scene, k.freeCamera);
    const px = k.drive.readPixels();
    let red = 0, lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      red += px[i];
      if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
    }
    const n = px.length / 4;
    return { hash: await sha256(px), red: red / n, lit: lit / n };
  })()`);

  const QUARTER = 0.25, SIXTEENTH = 0.0625;
  const still = { prevMm: CURR_MM, spanSec: QUARTER };
  // 240mm across a quarter of a second, which is inside the 250mm snap threshold.
  const fast = { prevMm: CURR_MM - 240, spanSec: QUARTER };
  // The same 960 mm/s built the other way round: a quarter of the movement over a
  // quarter of the time. A build reporting millimetres rather than millimetres per
  // second reads these as 240 and 60 and cannot make them agree.
  const brief = { prevMm: CURR_MM - 60, spanSec: SIXTEENTH };
  // 300mm, which is past the threshold, so the pair is two surfaces rather than one that
  // moved. Ungated it would read 1200 mm/s, which is exactly the top of the ramp.
  const jumped = { prevMm: CURR_MM - 300, spanSec: QUARTER };
  // The same 240mm, on half the frame. Every arm above moves the whole wall at once, and a
  // wall that moves at one speed is invariant under any permutation of its texels - so all
  // of them render identically on a build whose speed is one number rather than a value per
  // point, which is the question `docs/instruments.md` says to ask of a fixture before
  // trusting what it did not catch. 16-texel squares are coarse enough to survive the
  // projection at this pose without any row here needing to know where they land on screen.
  const chequer = { prevMm: CURR_MM - 240, spanSec: QUARTER, block: 16 };

  const off = { still: await shot({ ...still, motion: 0 }), fast: await shot({ ...fast, motion: 0 }) };
  const on = {
    still: await shot({ ...still, motion: 1 }),
    fast: await shot({ ...fast, motion: 1 }),
    brief: await shot({ ...brief, motion: 1 }),
    jumped: await shot({ ...jumped, motion: 1 }),
    chequer: await shot({ ...chequer, motion: 1 }),
  };

  // The guard the four rows below stand on, and it is the streak section's lesson applied
  // here: three of them are equalities, and two black frames are equal. A plant that
  // silently failed to render would satisfy them all.
  check(on.still.lit > 0.2 && on.still.red > 0,
    'the planted wall renders, so the rows below are comparing pictures rather than black',
    `${(100 * on.still.lit).toFixed(1)}% of the frame is lit, mean red ${on.still.red.toFixed(2)}`);

  // The default is the picture without the term, bit for bit, and it is measured here
  // because it cannot be measured where the rest of the defaults are. Section 1b renders
  // against the pinned build at parameter defaults, where duotone.amount is 0 and this whole
  // block is skipped - so a term added inside it is unreached by that hash however its own
  // default behaves. That is the hole the glitch flare's compensating default fell through,
  // and this is the same hole one block over.
  check(off.still.hash === off.fast.hash,
    'at a motion of 0 a fast pair and a still one are bit-identical, so the default is inert',
    off.still.hash === off.fast.hash ? `both ${off.still.hash.slice(0, 12)}`
      : `${off.still.hash.slice(0, 12)} vs ${off.fast.hash.slice(0, 12)}`);

  check(on.still.hash !== on.fast.hash,
    'and raised, the same two pairs render differently, so the speed reaches the colour',
    on.still.hash === on.fast.hash ? 'identical with a planted 960 mm/s'
      : `${on.still.hash.slice(0, 12)} vs ${on.fast.hash.slice(0, 12)}`);

  // Which way, rather than whether - the streak's lesson again, and it is worth a row of
  // its own for the same reason. "Pushed toward the hot pole" is the term's whole claim,
  // and a build that keyed the speed the other way, or onto the hue, or onto the split,
  // changes the picture exactly as much as the correct one does and passes the row above.
  // The poles run from a near-black blue to an orange, so the direction is legible as the
  // mean red channel over the frame.
  check(on.fast.red > on.still.red * 1.2,
    'and it moves toward the hot pole rather than merely somewhere else',
    `mean red ${on.fast.red.toFixed(2)} moving against ${on.still.red.toFixed(2)} still`);

  // **The row this section exists for.** A build handing the raw per-frame difference on
  // is correct in every picture anybody grades, because grading happens at one frame rate;
  // it is wrong the moment the link slows down, and it is wrong silently. Nothing else in
  // this file can see it, because both arms of every other comparison here run over the
  // same pairs at the same spacing by construction.
  check(on.fast.hash === on.brief.hash,
    'the same speed over two different spans renders the same frame, so the varying is mm/s',
    on.fast.hash === on.brief.hash
      ? `240mm over ${QUARTER}s and 60mm over ${SIXTEENTH}s both ${on.fast.hash.slice(0, 12)}`
      : `${on.fast.hash.slice(0, 12)} vs ${on.brief.hash.slice(0, 12)} - a per-frame difference, `
        + 'not a rate');

  // The discontinuity gate, which the vertex stage shares with the interpolation blend. A
  // ray that crossed a silhouette carries the distance from a subject to the wall behind
  // it, and reading that as a speed sets every edge in the room alight on every frame. The
  // fixture has 52 samples past the threshold in five pairs, far too few for a hashed run
  // to notice, so the only place this can be asked is a pair planted across it.
  check(on.jumped.hash === on.still.hash,
    'a jump past the snap threshold reads as a different surface, not as fast motion',
    on.jumped.hash === on.still.hash ? `both ${on.still.hash.slice(0, 12)} at a 300mm jump`
      : `${on.jumped.hash.slice(0, 12)} vs ${on.still.hash.slice(0, 12)} - the gate is off the speed`);

  // **The speed is a value per point and not one number for the frame.** Every row above is
  // satisfied by a build that computes one speed and hands it to everybody, because every
  // plant above moves the whole wall at once - and a uniformly moving fixture is invariant
  // under any permutation of its texels. The chequer is the asymmetry that breaks that
  // invariance, and the row is stated without any reference to where a block lands on screen:
  // half moving and half still can be neither of the two uniform frames.
  check(on.chequer.hash !== on.fast.hash && on.chequer.hash !== on.still.hash,
    'a chequered pair is neither of the uniform frames, so the speed is per point',
    on.chequer.hash === on.fast.hash ? 'identical to the all-moving frame - one speed for everybody'
      : on.chequer.hash === on.still.hash ? 'identical to the still frame - the speed reached nobody'
        : `${on.chequer.hash.slice(0, 12)}, distinct from both`);

  // And the quantitative half, which is what makes the row above a measurement rather than an
  // inequality: half a frame at 960 mm/s has to warm half as much of it, so the mean sits
  // between the two. A build reading one texel lands *on* one of the ends rather than between
  // them, and this says which end it landed on.
  check(on.still.red < on.chequer.red && on.chequer.red < on.fast.red,
    'and its mean red sits between them, because half the wall is moving',
    `still ${on.still.red.toFixed(2)}, chequer ${on.chequer.red.toFixed(2)}, `
    + `moving ${on.fast.red.toFixed(2)}`);
}

// The span the speed above is divided by, held against the transport rather than against a
// number this section wrote. **The planted rows cannot ask this**: they set `spanSec`
// themselves, which is what makes them able to isolate the varying and what makes them
// blind to where the value comes from on a real run. A build computing speeds from an
// assumed frame rate renders a perfectly plausible picture, moves when the parameter is
// reverted, and is wrong by whatever the link is doing.
//
// The probe walks every pair the pinned fixture has and lands in the middle of each rather
// than on its head, because a build reporting the *first* gap forever would be satisfied by
// a row that only ever asked about the first pair. The second row is what stops a constant
// passing at all: these five gaps are genuinely unequal, so no single number is right for
// more than one of them.
console.log('\n[registry] and the span it is divided by is the gap between the bound frames');
{
  const spans = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    k.params.reset();
    k.drive.reset();
    pinCamera(k.freeCamera);
    const times = k.drive.times();
    const out = [];
    for (let i = 0; i < times.length - 1; i++) {
      k.drive.stepTo(times[i] + (times[i + 1] - times[i]) * 0.5);
      out.push({ want: times[i + 1] - times[i], got: k.uniforms.spanSec.value });
    }
    return out;
  })()`);

  const wrong = spans.filter((s) => s.got !== s.want);
  check(spans.length > 1 && wrong.length === 0,
    'every pair the fixture holds hands the shader its own gap',
    wrong.length
      ? wrong.map((s) => `wanted ${s.want.toFixed(6)}s, got ${s.got.toFixed(6)}s`).join('; ')
      : `${spans.length} pairs at ${spans.map((s) => (s.want * 1000).toFixed(0)).join('/')}ms`);
  check(new Set(spans.map((s) => s.want)).size > 1,
    'and no two of those gaps are the same, so a constant cannot satisfy the row above',
    `${new Set(spans.map((s) => s.want)).size} distinct gaps in ${spans.length} pairs`);
}

// The duotone's ramp is a distance, and this is the only section that can say so.
//
// **Nothing above this line can.** Every arm in this file renders at one clip range, and
// `duotone.span` reaches the pixels through `duotoneSpan / (farClip - nearClip)` - so a
// build dividing by a frozen 5.95 instead produces the identical number at the default
// range, lands the parameter in its uniform, moves the picture when it is reverted, and
// satisfies the drop-one sweep completely. What it gets wrong is only visible from two
// ranges at once, which is what this section is: the whole point of the parameter is that
// the grade stopped following the framing, and a probe that never moves a crop face is a
// probe placed where its answer cannot be different.
//
// **The crossing plane is held at 1.5m in both arms while the range changes underneath
// it**, which is what makes the comparison about the width alone. `duotone.split` is a
// fraction of the range by design, so the two arms name different splits to describe the
// same plane - 0.5 through 0.5..2.5m and 0.25 through 0.5..4.5m. Every number here is
// exact in float32, on the planted section's reasoning: a row asking for equality cannot
// afford two quotients landing an ulp apart.
//
// The walls sit at 1.25m and 1.75m, a quarter of the way out from the plane on each side
// of a 1m ramp. Not on the plane itself, which is where the two builds agree by
// construction - k is 0.5 there whatever the width - and not outside the ramp either,
// where the shipped build saturates and the difference would be a clamp rather than a
// reading.
console.log('\n[registry] the duotone span is metres, held across two clip ranges');
{
  const PLANE_M = 1.5;
  const SPAN_M = 1;
  const RANGES = [
    { near: 0.5, far: 2.5 },
    { near: 0.5, far: 4.5 },
  ].map((r) => ({ ...r, split: (PLANE_M - r.near) / (r.far - r.near) }));
  const WALLS_MM = [1250, 1750];

  // One planted wall, read through a duotone at a stated range, span and split. The
  // planting idiom is the section above's - `injectDepth` twice because `bindDepth` swaps
  // and writes, and nothing may call `stepTo` afterwards or the transport binds real
  // frames over the plant.
  const wallAt = ({ mm, near, far, split, span }) => page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    k.params.reset();
    k.params.apply({ 'duotone.amount': 1, fade: 0, wake: 0,
      near: ${near}, far: ${far}, 'duotone.split': ${split}, 'duotone.span': ${span} });
    k.drive.reset();
    pinCamera(k.freeCamera);
    const plane = new Uint16Array(512 * 424).fill(${mm});
    k.drive.injectDepth(plane);
    k.drive.injectDepth(plane);
    k.uniforms.mixT.value = 1;
    k.uniforms.sinceFrameSec.value = 0;
    k.uniforms.spanSec.value = 0.25;
    k.renderer.render(k.scene, k.freeCamera);
    const px = k.drive.readPixels();
    let red = 0, lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      red += px[i];
      if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
    }
    const n = px.length / 4;
    return { hash: await sha256(px), red: red / n, lit: lit / n };
  })()`);

  const shots = [];
  for (const range of RANGES) {
    const row = [];
    for (const mm of WALLS_MM) row.push(await wallAt({ mm, ...range, span: SPAN_M }));
    shots.push(row);
  }

  // The guard the equalities stand on, and it is the planted section's lesson repeated
  // because it has to be: two black frames are equal, and every row below this one is an
  // equality. A wall that failed to plant, or a clip range that culled it, would satisfy
  // all of them.
  const dimmest = Math.min(...shots.flat().map((s) => s.lit));
  check(dimmest > 0.2,
    'both walls render at both ranges, so the rows below are comparing pictures rather than black',
    `${shots.map((row, i) => row.map((s, j) => `${WALLS_MM[j]}mm at far ${RANGES[i].far}: `
      + `${(100 * s.lit).toFixed(1)}% lit, red ${s.red.toFixed(2)}`).join('; ')).join(' | ')}`);

  // The second guard, and the sharper one: the probe has to be able to see the span at
  // all. A build whose ramp had collapsed to a step would render both walls saturated at
  // opposite poles and match across the ranges for a reason that has nothing to do with
  // metres - so the two walls are required to be genuinely mid-ramp and distinct.
  const [nearWall, farWall] = shots[0];
  check(farWall.red - nearWall.red > 2 && nearWall.red > 0 && farWall.red < 255,
    'and the two walls land either side of the crossing without saturating, so the ramp is being read',
    `1250mm mean red ${nearWall.red.toFixed(2)}, 1750mm ${farWall.red.toFixed(2)}`);

  // The claim. A metre from the crossing plane is a metre at either range, so the wall
  // renders the same colour in both - and it is asserted as a bit-identical frame rather
  // than as two means within a tolerance, because the geometry, the pose and the plant are
  // all identical between the arms and only three uniforms differ. A build dividing by a
  // frozen range renders 1250mm fully cold at far 2.5 and part-way up the ramp at far 4.5,
  // which is where this goes red.
  for (const [j, mm] of WALLS_MM.entries()) {
    const a = shots[0][j], b = shots[1][j];
    check(a.hash === b.hash,
      `a wall ${((mm / 1000 - PLANE_M) * 100).toFixed(0)}cm from the crossing renders the same `
      + `through a ${(RANGES[0].far - RANGES[0].near).toFixed(1)}m range and a `
      + `${(RANGES[1].far - RANGES[1].near).toFixed(1)}m one`,
      a.hash === b.hash
        ? `mean red ${a.red.toFixed(2)} at both, ${a.hash.slice(0, 12)}`
        : `${a.hash.slice(0, 12)} at far ${RANGES[0].far} against ${b.hash.slice(0, 12)} at far `
          + `${RANGES[1].far}; mean red ${a.red.toFixed(2)} against ${b.red.toFixed(2)}, so the `
          + 'ramp is a share of the box rather than a distance');
  }

  // And the control for those two, which is the row that stops them passing on a build
  // where the span reaches nothing: widen the ramp at one fixed range and the same wall
  // has to move. Two frames that agree prove the width is invariant under the range; this
  // is what proves the width exists.
  const wide = await wallAt({ mm: WALLS_MM[1], ...RANGES[0], span: 3 });
  check(wide.hash !== shots[0][1].hash,
    'while widening the ramp at one range does move it, so the equalities above are not '
    + 'a parameter that reaches nothing',
    `${SPAN_M}m gives mean red ${shots[0][1].red.toFixed(2)}, 3m gives ${wide.red.toFixed(2)}`);
}

// ======================================== the glyph field, and the rain under it
//
// **Nine sections that plant a condition rather than sweeping a parameter**, on the two
// exemplars above: the drop-one sweep can say that a term reaches a pixel and it cannot
// say what the term *means*, and every claim the glyph field makes is a claim about
// meaning. A character keyed on the point rather than on the cell still draws characters.
// A wave whose trail is under the head still descends. An index that averages its keys
// still draws a plausible symbol in every cell. All three are green through the sweep, and
// all three are the failure.
//
// The plant is the section above's idiom exactly - `injectDepth` twice because `bindDepth`
// swaps and then writes, `mixT`, `sinceFrameSec` and `spanSec` written by hand because the
// door does not touch them, and nothing may call `drive.stepTo` afterwards or the transport
// binds real frames over the plant and hands the shader a span to match. What is added here
// is a pose argument and a clock: two of the sections below need a camera close enough to a
// point that its sprite crosses a threshold no shipped look reaches, and two need the two
// clocks this branch introduced - the noise phase and the rain's - moved by hand rather than
// by a program time that would move the footage with them.
//
// The background is subtracted rather than assumed away. This renderer does not clear to
// black, so every "is anything lit here" reading taken against zero comes back saying the
// whole frame is lit - measured at 100% of pixels on a frame with four hundred one-pixel
// dots in it, which is a guard that cannot fail. Each section therefore renders its own
// empty frame first and reads every number against that.
const FIELD_HELPERS = `
  const empty = () => new Uint16Array(512 * 424);
  const plane = (mm) => new Uint16Array(512 * 424).fill(mm);
  // Every second texel in each axis dropped. At the cell sizes below this leaves every
  // occupied cell still occupied and a quarter of the points inside it, which is the
  // redundancy a per-cell identity is invariant under and a per-point one is not.
  const thinned = (mm) => {
    const a = new Uint16Array(512 * 424);
    for (let r = 0; r < 424; r += 2) for (let c = 0; c < 512; c += 2) a[r * 512 + c] = mm;
    return a;
  };
  // One column of the room. The rain's phase is offset per column by a hash of the cell's
  // own x and z, so neighbouring columns are deliberately out of step - which is what makes
  // a full wall useless for reading the shape of a single drop, since the frame holds a
  // dozen columns at a dozen phases and their profiles average out. A strip narrow enough
  // to fall inside one cell is one column, and a column has one profile.
  const column = (mm, halfWidth) => {
    const a = new Uint16Array(512 * 424);
    for (let r = 0; r < 424; r++) {
      for (let c = 256 - halfWidth; c < 256 + halfWidth; c++) a[r * 512 + c] = mm;
    }
    return a;
  };
  const oneTexel = (mm) => { const a = new Uint16Array(512 * 424); a[212 * 512 + 256] = mm; return a; };
  // A near surface standing in front of a far one, which one depth image cannot hold
  // twice over: a texel is one range, so the two surfaces have to be cut out of the same
  // grid rather than stacked along one ray. Every step-th texel in each axis is the near
  // surface and every other one is the far surface, and what makes that enough is the
  // sprite - a near cell projects several times larger than a far one, so its mark spills
  // across screen the far surface is drawing into.
  //
  // **Three fixtures out of one mask, and the union of the last two is exactly the first,
  // point for point.** The far-only frame carries holes where the near points are rather
  // than a wall written behind them, because a far point that exists in one frame and not
  // the other is a difference the comparison would read as occlusion. Interleaved rather
  // than banded so that the two surfaces alternate in the attribute order as well as on
  // screen: a near sprite only hides a far point the driver reaches *after* it, and a
  // block of near texels would leave that dependent on which side of the block the far
  // rows sat.
  const twoSurfaces = (nearMm, farMm, step) => {
    const both = new Uint16Array(512 * 424);
    const near = new Uint16Array(512 * 424);
    const far = new Uint16Array(512 * 424);
    for (let r = 0; r < 424; r++) {
      for (let c = 0; c < 512; c++) {
        const i = r * 512 + c;
        if (r % step === 0 && c % step === 0) { both[i] = nearMm; near[i] = nearMm; }
        else { both[i] = farMm; far[i] = farMm; }
      }
    }
    return { both, near, far };
  };
  // Whether a frame put anything at all on a pixel, against the empty frame this renderer
  // draws when no point survives. Exact rather than thresholded, because the question is
  // "did a fragment land here" and a fragment either did or did not.
  const drew = (px, bg, i) => px[i] !== bg[i] || px[i + 1] !== bg[i + 1] || px[i + 2] !== bg[i + 2];
  // How many distinct colours a frame put on the pixels the empty frame did not. At full
  // glyph on a flat wall this is the sharpest statement there is about the mark: every cell
  // sits at one depth so the reading hands them all one colour, and a hard bit either
  // replaces a pixel with that colour or leaves it alone - one value. A mark part way
  // through the crossfade is the round splat's gradient blended toward the bitmask, so it
  // paints a spread of them. No threshold, and nothing to calibrate.
  const levels = (px, bg) => {
    const seen = new Set();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] !== bg[i] || px[i + 1] !== bg[i + 1] || px[i + 2] !== bg[i + 2]) {
        seen.add(px[i] * 65536 + px[i + 1] * 256 + px[i + 2]);
      }
    }
    return seen.size;
  };
  const field = ({ look, depth, eye = [0, 0.1, 1.6], at = [0, 0, -2.2],
    spanSec = 0.25, rainPhase = 0, time = 0, cropOutside = null }) => {
    k.params.reset();
    k.params.apply(look);
    k.drive.reset();
    k.freeCamera.position.set(eye[0], eye[1], eye[2]);
    k.freeCamera.lookAt(at[0], at[1], at[2]);
    k.freeCamera.updateMatrixWorld(true);
    k.drive.injectDepth(depth);
    k.drive.injectDepth(depth);
    k.uniforms.mixT.value = 1;
    k.uniforms.sinceFrameSec.value = 0;
    k.uniforms.spanSec.value = spanSec;
    k.uniforms.rainPhase.value = rainPhase;
    k.uniforms.time.value = time;
    // The crop's faint pass is not a look value - the editor writes it from whether the box
    // is on screen - so an arm that needs cut-away points alive has to say so here, the way
    // the two clocks above do. Left alone it is whatever the page last set, which on this
    // surface is 0, and 0 is the hard cull.
    if (cropOutside !== null) k.uniforms.cropOutside.value = cropOutside;
    k.renderer.render(k.scene, k.freeCamera);
    return k.drive.readPixels();
  };
  const above = (px, bg) => {
    let energy = 0, peak = 0, lit = 0, painted = 0;
    for (let i = 0; i < px.length; i += 4) {
      const d = (px[i] + px[i + 1] + px[i + 2]) - (bg[i] + bg[i + 1] + bg[i + 2]);
      if (d > 0) energy += d;
      if (d > 12) lit++;
      if (d > 2) painted++;
      const m = Math.max(px[i] - bg[i], px[i + 1] - bg[i + 1], px[i + 2] - bg[i + 2]);
      if (m > peak) peak = m;
    }
    const n = px.length / 4;
    return { energy: energy / n, peak, lit: lit / n, painted };
  };
  const apart = (a, b) => {
    let sum = 0, differing = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      sum += d;
      if (d > 0) differing++;
    }
    const n = a.length / 4;
    return { mean: sum / n, pct: (100 * differing) / n };
  };
`;

// The look every glyph section below is read through, and the two choices in it that are
// not incidental. **Normal blending with an opacity of exactly 1**, because at full glyph
// the mask is a hard bit rather than a falloff, so a fragment's alpha is exactly 0 or
// exactly 1 and drawing the same character over itself is idempotent - which is what lets a
// row ask for bit-identity between a wall and a quarter of the same wall. Under additive it
// would not be: four hundred coincident sprites sum to four hundred times one, and the row
// would be measuring how many points there were. And **the depth reading alone**, because
// the colour planted for `rgbSaturation` two sections up is a 2x2 image and the fragment
// samples it per texel: points inside one cell would then draw different colours, the
// blending would stop being idempotent, and the equality would fail on a build with nothing
// wrong with it. Measured while getting this wrong - the cell straddling the colour seam is
// the only one that moves, and whether it exists at all depends on the cell size.
// **And the cell is 0.25m because a hard bit is a fact about framebuffer pixels.** The
// legibility crossfade reaches exactly 1 at 16 pixels of *drawn* sprite, and the stage here
// is 360 tall, so a reference pixel is a third of one: a cell of 0.15m projects to 43
// reference pixels at the pinned pose's four metres and rasterises into 14.5, which puts
// the crossfade at 0.898 and the mark back to a blend between a bitmask and a disc. A blend
// is not idempotent - four hundred coincident sprites converge on the character and a
// hundred of them stop short - so the thinning row failed on a build with nothing wrong
// with it, reporting the mark following the points. At 0.25m the cell rasterises into 24
// pixels, the mask is a bit, and drawing it over itself changes nothing. This is the
// crossfade's unit written into a fixture: the same look at a 1080-tall stage needs no such
// margin, which is exactly why the old reading of it looked correct.
const GLYPH_LOOK = {
  additive: false, denoise: false, fade: 0, wake: 0, opacity: 1, exposure: 1, pointSize: 64,
  'lattice.amount': 1, cell: 0.25, 'glyph.amount': 1, 'glyph.tone': 0, 'glyph.hash': 1,
  'glyph.rain': 0, 'rain.amount': 0,
  readRgb: 0, readDepth: 1, readGhost: 0, readContour: 0, readBlackwall: 0, near: 0.5, far: 4,
};

console.log('\n[registry] one cell, one character: the mark is a fact about the room');
{
  const shots = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    const look = ${JSON.stringify(GLYPH_LOOK)};
    const bg = field({ look, depth: empty() }).slice();
    const out = {};
    for (const [fixture, depth] of [['whole', plane(2400)], ['thinned', thinned(2400)]]) {
      for (const master of [1, 0]) {
        const px = field({ look: { ...look, 'glyph.amount': master }, depth });
        out[fixture + (master ? 'Glyph' : 'Dots')] = { hash: await sha256(px), ...above(px, bg) };
      }
    }
    return out;
  })()`);

  // The guard the two rows below stand on, and the first of them is an equality: two black
  // frames are equal, and a fixture that failed to plant would satisfy it perfectly.
  check(shots.wholeGlyph.lit > 0.03 && shots.wholeGlyph.energy > 5,
    'the planted wall draws characters, so the rows below are comparing marks rather than black',
    `${(100 * shots.wholeGlyph.lit).toFixed(2)}% of the frame is inked, energy `
    + `${shots.wholeGlyph.energy.toFixed(2)}`);

  // **The claim.** Which character a cell draws is a property of the cell, so it cannot
  // depend on how many points landed in that cell. Dropping three quarters of them leaves
  // every cell still occupied and every mark exactly where it was, and the frame is
  // bit-identical. A build hashing the point's own texel draws whichever of its four
  // hundred occupants got there first, and thinning changes which one that is.
  check(shots.wholeGlyph.hash === shots.thinnedGlyph.hash,
    'thinning the wall to a quarter of its points draws the identical marks, so the '
    + 'character belongs to the cell',
    shots.wholeGlyph.hash === shots.thinnedGlyph.hash
      ? `both ${shots.wholeGlyph.hash.slice(0, 12)}`
      : `${shots.wholeGlyph.hash.slice(0, 12)} against ${shots.thinnedGlyph.hash.slice(0, 12)} - `
        + 'the mark follows the points rather than the cell');

  // And the control, because an equality proves nothing if the thing being varied reaches
  // no pixel. At `glyph` 0 the same two fixtures draw round splats, whose falloff is a
  // gradient rather than a bit - so the blending stops being idempotent, the number of
  // points in a cell decides the result, and the two frames have to differ. That is the
  // same thinning reaching the same pixels through a mark that is not a character.
  check(shots.wholeDots.hash !== shots.thinnedDots.hash,
    'while at a glyph of 0 the same thinning does change the picture, so the equality above '
    + 'is not a fixture nothing can move',
    shots.wholeDots.hash === shots.thinnedDots.hash
      ? 'identical as round splats too - the thinning reached nothing'
      : `${(100 * shots.wholeDots.lit).toFixed(2)}% inked, ${shots.wholeDots.hash.slice(0, 12)} `
        + `against ${shots.thinnedDots.hash.slice(0, 12)}`);
}

// The defect the probe this design came out of actually shipped, and the one the spec says
// no drop-one sweep can see: the character hashed off the point *after* the turbulence had
// moved it. With the noise at zero - which is where a sweep leaves it, and where every
// other arm in this file sits - the two builds render bit-identical frames, so the row has
// to raise the turbulence first.
//
// **And raising it is not enough on its own**, which is the part the design document gets
// wrong. With the noise phase frozen the displacement is a pure function of the undisplaced
// position, so both hash sources move together and discriminate nothing. What separates
// them is the noise *clock*: as the field advances, points migrate between cells. A
// character that belongs to the point travels with it, so each cell's contents change and
// the picture changes; a character that belongs to wherever the point ended up is a
// function of the occupied cells alone, and the occupied set of a dense wall barely moves.
console.log('\n[registry] and a character travels with its point through the turbulence');
{
  // **The wall sits at a cell centre in depth and the turbulence is bounded inside that
  // cell**, and both halves of that are the difference between a row that separates and one
  // that nearly does not. A plane is one cell thick, so a displacement larger than half a
  // cell pushes every point in the frame into a neighbouring depth cell at once - which
  // changes the occupied set wholesale, and a change to the occupied set is the one thing a
  // build hashing the displaced point *can* see. Measured with the wall at 2400mm, which is
  // 25mm from a boundary at this cell size, and a turbulence of 0.3m: the mutation came
  // back at 13.48 against a correct 27.79, a separation of two. Centred at 2500mm with the
  // amplitude under the 0.125m half-cell, the same mutation has nothing left but the wall's
  // own rim.
  const NOISE = { 'noise.amount': 0.1, 'noise.scale': 1.5, 'noise.speed': 1 };
  // **The same question asked of the other two displacements that run before the hash**,
  // because the arms above leave the ripple and the region push at zero and a build taking
  // its hash after *those* renders bit-identically to a correct one there. Three
  // displacements sit between the undisplaced position and the drawn one, and covering the
  // one the shipped probe got wrong leaves the other two outside the row.
  //
  // Both are radial about the region's centre, which is put on the wall's own plane here -
  // so `p0 - regionCentre` has no z in it and neither term moves a point out of its depth
  // cell, which is the bound the control row below rests on. The box is a metre of
  // half-extent inside a wall that is nearly two, so the wall's outer rim sits at a region
  // weight of zero and is not displaced at all: the occupied cell set cannot change at the
  // edge of the fixture, which is the only place a dense plane has one.
  //
  // `ripple.speed` is 0.5 because the ripple's clock is quantised to eighths of a cycle and
  // this section's two phases are 3 seconds apart: at 0.5 that is twelve steps, an offset
  // of exactly one and a half cycles, so the displacement between the two arms is negated
  // rather than merely moved. At the ripple's default speed of 1 the same pair lands on
  // three whole cycles, which is the identical picture twice - a fixture that could not
  // fail, in the shape this file's own turbulence arms were nearly written in.
  //
  // **The push contributes to the fixture and not to the discrimination, and that is worth
  // saying rather than leaving to be found.** It has no clock, so a hash taken after it
  // draws a different character in every cell and draws the *same* different character at
  // both phases - which is what a correct build does too. Nothing built out of two renders
  // of one geometry can separate those, because neither is an oracle for the other; what
  // the push is doing here is making the drawn position genuinely differ from the hash
  // source, so the mutation below can be the honest one that inlines both.
  const RIPPLE = {
    'noise.amount': 0, 'ripple.amount': 0.05, 'ripple.freq': 4, 'ripple.speed': 0.5,
    'push.amount': 0.06,
    regionX: 0, regionY: 0, regionZ: -2.5, regionW: 1, regionH: 1, regionD: 1,
  };
  const moved = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    const look = { ...${JSON.stringify(GLYPH_LOOK)}, cell: 0.25, ...${JSON.stringify(NOISE)} };
    const ripple = ${JSON.stringify(RIPPLE)};
    const wall = plane(2500);
    const bg = field({ look, depth: empty() }).slice();
    const at = (over, time) => field({ look: { ...look, ...over }, depth: wall, time });
    const out = {};
    for (const [label, over] of [['characters', {}], ['cells', { 'glyph.hash': 0 }],
      ['dots', { 'glyph.amount': 0 }],
      ['rippleCharacters', ripple], ['rippleCells', { ...ripple, 'glyph.hash': 0 }]]) {
      const first = at(over, 0).slice();
      const second = at(over, 3);
      out[label] = { ...apart(first, second), ...above(first, bg) };
    }
    return out;
  })()`);

  check(moved.characters.lit > 0.03,
    'the planted wall draws characters under the turbulence, so the rows below are about marks',
    `${(100 * moved.characters.lit).toFixed(2)}% inked, energy ${moved.characters.energy.toFixed(2)}`
    + `; as round splats the same two phases sit ${moved.dots.mean.toFixed(3)}/255 apart`);

  // **The control, and with the fixture bounded it is an equality rather than a margin.**
  // With the hash key at zero every cell draws the same character whatever arrived in it, so
  // the only thing two noise phases could change is *which cells are occupied* - the mark is
  // idempotent at full glyph, so how many points landed in one cannot reach a pixel. Held
  // inside its own depth cell, the occupied set does not change either, and the two phases
  // are bit-identical. That is exactly the picture a build hashing the displaced point draws
  // at both phases, so this row is the mutated build's own output standing beside the claim.
  //
  // Deliberately not the `glyph` 0 arm, which was tried first and measures something else: a
  // round splat's falloff is a gradient rather than a bit, so its alpha accumulates with the
  // point count and that arm reports a per-cell census the mutation does not produce. It is
  // printed above rather than asserted on for that reason.
  check(moved.cells.mean === 0,
    'with the hash key down the two phases are bit-identical, so the turbulence moves no '
    + 'point out of the cell it started in',
    `mean ${moved.cells.mean.toFixed(3)}/255 over ${moved.cells.pct.toFixed(2)}% of pixels, at `
    + `${(100 * moved.cells.lit).toFixed(2)}% inked`);

  // **The claim.** With the geometry held exactly still by the row above, everything this
  // reads is the characters, so it is stated as a distance rather than as a ratio: a build
  // reading the identity off the cell the point ended up in draws the same frame at both
  // phases, exactly as the control does, and this falls to nothing.
  check(moved.characters.mean > 1,
    'and with it up they move anyway, so a character is carried in by its point rather than '
    + 'read off where the point landed',
    `characters ${moved.characters.mean.toFixed(3)}/255 over ${moved.characters.pct.toFixed(2)}% `
    + `of pixels, against ${moved.cells.mean.toFixed(3)} for the cell set alone`);

  // The same pair over the ripple and the region push, with the turbulence switched off, so
  // that the two displacements the arms above leave at zero are asked the same question.
  check(moved.rippleCharacters.lit > 0.03,
    'the wall draws characters under the ripple and the push too, so the pair below is '
    + 'about marks rather than about an empty frame',
    `${(100 * moved.rippleCharacters.lit).toFixed(2)}% inked, energy `
    + `${moved.rippleCharacters.energy.toFixed(2)}`);
  check(moved.rippleCells.mean === 0,
    'with the hash key down the ripple and the push move no point out of the cell it '
    + 'started in either, so the two phases are bit-identical',
    `mean ${moved.rippleCells.mean.toFixed(3)}/255 over ${moved.rippleCells.pct.toFixed(2)}% `
    + 'of pixels');
  check(moved.rippleCharacters.mean > 1,
    'and with it up they move, so the character was hashed before the ripple and the push '
    + 'rather than after them',
    `characters ${moved.rippleCharacters.mean.toFixed(3)}/255 over `
    + `${moved.rippleCharacters.pct.toFixed(2)}% of pixels, against `
    + `${moved.rippleCells.mean.toFixed(3)} for the cell set alone`);
}

// The three keys add into one index and wrap, and the alternative - mixing them the way the
// five readings mix - draws a completely plausible wrong character in every cell. Nothing
// that asks whether the frame changed can tell those apart.
//
// **The design document's discriminator is arithmetically empty and this is not it.** Two
// keys at half weight each give `fract(0.5a + 0.5b)` under a sum and `(0.5a + 0.5b) / 1.0`
// under a normalising mix, which is the same number, and the sum never exceeds 1 so the
// wrap never fires: both builds land on the same third character and both pass. What
// separates them is section 8b's own property read backwards - a ratio has no scale, so a
// mix renders the identical image when every weight is doubled, and a sum does not.
console.log('\n[registry] the three keys add and wrap, so doubling two of them is a different picture');
{
  const keys = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    const look = { ...${JSON.stringify(GLYPH_LOOK)}, cell: 0.25, 'glyph.hash': 0, 'glyph.tone': 0 };
    const wall = plane(2400);
    const bg = field({ look, depth: empty() }).slice();
    const at = async (toneKey, hashKey, rainKey = 0) => {
      const px = field({ look: { ...look, 'glyph.tone': toneKey, 'glyph.hash': hashKey,
        'glyph.rain': rainKey }, depth: wall });
      return { hash: await sha256(px), ...above(px, bg) };
    };
    // The hash key swept on its own, for the sign row below. With the other two keys down
    // the index argument is the fraction of the weight times the cell seed, and a seed is
    // under 1, so nothing wraps and the sweep walks the table out of its sparse end.
    const ramp = [];
    for (const hashKey of [0, 0.25, 0.5, 0.75, 1]) {
      ramp.push({ hashKey, ...(await at(0, hashKey)) });
    }
    return {
      half: await at(0.35, 0.35),
      doubled: await at(0.7, 0.7),
      toneAlone: await at(0.7, 0),
      hashAlone: await at(0, 0.7),
      neither: await at(0, 0),
      // The rain key alone, and at exactly 1 rather than near it. The key reads whole drops
      // gone past - an integer - and the fraction of an integer is zero, so a build using
      // that counter raw contributes nothing to the index at precisely the weight where the
      // key should be loudest. Every other arm here holds it at a weight whose fraction is
      // not zero, where a raw counter still scrambles and the defect cannot be seen.
      rainAlone: await at(0, 0, 1),
      ramp,
    };
  })()`);

  check(keys.half.lit > 0.03,
    'the two keys together draw characters, so the rows below are comparing marks rather than black',
    `${(100 * keys.half.lit).toFixed(2)}% inked, energy ${keys.half.energy.toFixed(2)}`);

  // The claim. Under a normalising mix these two are the same frame to the byte.
  check(keys.half.hash !== keys.doubled.hash,
    'doubling both keys draws different characters, so the index is a sum and not a ratio',
    keys.half.hash === keys.doubled.hash
      ? `identical at 0.35/0.35 and 0.70/0.70, ${keys.half.hash.slice(0, 12)} - the keys normalise`
      : `${keys.half.hash.slice(0, 12)} at 0.35/0.35 against ${keys.doubled.hash.slice(0, 12)} at 0.70/0.70`);

  // And 8b's control in its own clothes: two frames that differ prove the composition has a
  // scale only if the keys reach the characters at all, and each key alone has to draw
  // something the pair does not.
  const soloes = { toneAlone: keys.toneAlone, hashAlone: keys.hashAlone, neither: keys.neither };
  // The half of that control `docs/instruments.md` said was here and was not. Three frames
  // being distinct from a fourth is satisfied by four blank frames differing in a corner,
  // and a solo arm is exactly where blankness is plausible: one key down is one term gone
  // out of the index. So each of the three is asked to draw something first, and the row
  // above is what the distinctness then means.
  // The floor is 0.5% of the frame rather than the 3% the pair above is held to, and the
  // difference is the fixture rather than a softening: with both keys down every cell draws
  // index 0, which is the sparsest character in a table sorted by ink - two bits of
  // sixty-four - so that arm is *expected* to be thin and reads 1.55% here. A floor set
  // where the pair's is reddens it over a build that is drawing exactly what it should.
  const blank = Object.keys(soloes).filter((n) => !(soloes[n].lit > 0.005));
  check(blank.length === 0,
    'each key on its own, and the picture with both of them off, draws characters - so the '
    + 'row below is separating marks rather than empty frames',
    Object.keys(soloes).map((n) => `${n} ${(100 * soloes[n].lit).toFixed(2)}%`).join(', ')
      + (blank.length ? ` - ${blank.join(', ')} inked nothing` : ''));
  const same = Object.keys(soloes).filter((n) => soloes[n].hash === keys.half.hash);
  check(same.length === 0,
    'and the pair is neither of the keys alone, nor the picture with both of them off',
    same.length ? `identical to ${same.join(', ')}` : 'distinct from all three');

  // **The sign of a key, which the two rows above cannot reach.** Doubling separates a sum
  // from a ratio because a ratio has no scale; it says nothing about which way the key
  // walks the table, and a build subtracting the hash term instead of adding it is
  // scale-sensitive in exactly the same way, draws a plausible character in every cell, and
  // passes every row above.
  //
  // What separates them is the table's own ordering, read the way the ink ramp reads it for
  // the tonal key. With the other two keys down the index argument is `fract(h * seed)`,
  // the seed is under 1 so nothing wraps, and the reachable indices are the interval
  // [0, 64h) - which grows out of the sparse end as h rises, so the mean ink over the frame
  // has to climb with it. Subtracting instead gives `1 - h * seed`, whose indices sit in
  // (64 - 64h, 64] - the *dense* end, at its densest for the smallest h that is not zero -
  // so the sweep rises to nearly full ink at the first step and falls away after it.
  //
  // **What this does not establish**, stated rather than left to be assumed: a composition
  // that is neither a sum nor a difference can still climb monotonically out of the sparse
  // end. A squared sum is the clearest of them - it is scale-sensitive, so the doubling row
  // passes it, and it is monotone in each key with the other down, so this row passes it
  // too. Nothing in this suite separates a sum from a squared sum, and the two draw
  // different characters in every cell.
  const ramp = keys.ramp;
  const inks = ramp.map((r) => r.lit);
  const descents = ramp.filter((r, i) => i > 0 && r.lit < ramp[i - 1].lit);
  check(descents.length === 0,
    'and raising the hash key alone only ever draws more ink, so it walks the table out of '
    + 'the sparse end rather than into it',
    ramp.map((r) => `${r.hashKey} -> ${(100 * r.lit).toFixed(2)}%`).join(', '));
  check(inks[inks.length - 1] > inks[0] * 1.5,
    'and the far end of that sweep is substantially inkier than the near one, so the row '
    + 'above is a ramp rather than five equal readings',
    `${(100 * inks[0]).toFixed(2)}% at a hash of 0 against `
    + `${(100 * inks[inks.length - 1]).toFixed(2)}% at 1`);

  // **The third key, at exactly the weight that makes the wrong implementation inert.** It
  // reads whole drops gone past, which is an integer, and the fraction of an integer is
  // zero - so a build handing that counter to the index raw contributes nothing at all at a
  // weight of 1, which is the top of the slider and the one setting where the scramble
  // should be strongest. The golden ratio in front of it is what walks the table instead,
  // and it is invisible at every other weight: at 0.44, which is where the scrambled set
  // holds this key, a raw counter still moves the index and every row in the file passes.
  //
  // So the arm is at 1.0 and not near it, and the comparison is against the picture with
  // all three keys down - the frame a raw counter would draw here.
  check(keys.rainAlone.lit > 0.005,
    'the rain key on its own draws characters, so the row below is separating marks rather '
    + 'than empty frames',
    `${(100 * keys.rainAlone.lit).toFixed(2)}% inked, energy ${keys.rainAlone.energy.toFixed(2)}`);
  check(keys.rainAlone.hash !== keys.neither.hash,
    'and at a weight of exactly 1 it still chooses the character, so the counter it reads is '
    + 'stepped by something irrational rather than handed over whole',
    keys.rainAlone.hash === keys.neither.hash
      ? `identical to the picture with every key down, ${keys.neither.hash.slice(0, 12)} - the `
        + 'whole-number counter is inert at this weight'
      : `${keys.rainAlone.hash.slice(0, 12)} against ${keys.neither.hash.slice(0, 12)} with `
        + 'every key down');
}

// The alphabet is sorted by ink so that one table can be read as tone by one key and as
// noise by two others, and that ordering is the whole of what makes the tonal key a ramp
// rather than a third scramble. **No comparison of two pictures can see it**: a shuffled
// table draws a different character in every cell and a perfectly plausible frame.
//
// So the section asks the two halves separately. The rendered half sweeps the luminance a
// cell is about to draw at and requires the ink to follow it, which is the property a
// viewer has; the source half reads the table out of the shader the browser actually
// compiled and requires the sixty-four popcounts to be non-decreasing, which is the
// property the renderer rests on. The luminance is moved by the clip range rather than by
// moving the wall, so the geometry, the sprite size and the cell coverage are identical
// across the arms and the only thing that changes is the colour the ramp hands the cell.
console.log('\n[registry] the alphabet is sorted by ink, and the tone key reads it as a ramp');
{
  const ramp = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    const look = { ...${JSON.stringify(GLYPH_LOOK)}, cell: 0.25, 'glyph.hash': 0, 'glyph.rain': 0 };
    const wall = plane(2400);
    const rows = [];
    for (const far of [8, 4, 3, 2.6]) {
      const range = { near: 0.5, far };
      const bg = field({ look: { ...look, ...range, 'glyph.tone': 0 }, depth: empty() }).slice();
      // The base arm draws one character in every cell - index 0, the apostrophe - so its
      // coverage is identical at every range and the colour it draws in is the reading's.
      // That is what lets the luminance be measured off the picture rather than assumed
      // from the clip arithmetic.
      const flat = field({ look: { ...look, ...range, 'glyph.tone': 0 }, depth: wall });
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < flat.length; i += 4) {
        if ((flat[i] + flat[i + 1] + flat[i + 2]) - (bg[i] + bg[i + 1] + bg[i + 2]) > 12) {
          r += flat[i] - bg[i]; g += flat[i + 1] - bg[i + 1]; b += flat[i + 2] - bg[i + 2]; n++;
        }
      }
      const inked = field({ look: { ...look, ...range, 'glyph.tone': 1 }, depth: wall });
      rows.push({
        far,
        lum: n ? (0.299 * r + 0.587 * g + 0.114 * b) / n / 255 : 0,
        flat: above(flat, bg),
        ink: above(inked, bg).lit,
      });
    }
    return rows;
  })()`);

  const dimmest = Math.min(...ramp.map((r) => r.flat.lit));
  check(dimmest > 0.005,
    'every arm draws its cells, so the ink fractions below are measured on a picture',
    ramp.map((r) => `far ${r.far}: ${(100 * r.flat.lit).toFixed(2)}% at luminance `
      + `${r.lum.toFixed(3)}`).join('; '));

  // The second guard, and the sharper one: a monotonic claim over four readings that are
  // all the same reading is satisfied by anything at all.
  const lums = ramp.map((r) => r.lum);
  check(Math.max(...lums) > Math.min(...lums) * 1.5,
    'and the four arms genuinely sit at different luminances, so the ramp has something to '
    + 'be read against',
    `${Math.min(...lums).toFixed(3)} to ${Math.max(...lums).toFixed(3)}`);

  // The claim, in the order the picture puts them rather than in the order the clip
  // arithmetic predicts: sorted by the luminance each arm actually rendered, the ink has to
  // climb. A tone key reading a shuffled table walks the ramp at random and fails this.
  const byLum = ramp.slice().sort((a, b) => a.lum - b.lum);
  const descents = byLum.filter((r, i) => i > 0 && r.ink < byLum[i - 1].ink);
  check(descents.length === 0,
    'a brighter cell draws a denser character, at every step of the ramp',
    byLum.map((r) => `${r.lum.toFixed(3)} -> ${(100 * r.ink).toFixed(2)}% ink`).join(', '));

  // And the strict version of it, because "non-decreasing" is satisfied by four equal
  // readings - which is exactly what a build with the tonal key dropped produces.
  check(byLum[byLum.length - 1].ink > byLum[0].ink * 1.25,
    'and the brightest arm is substantially denser than the dimmest, so the key is doing '
    + 'the work rather than the row being flat',
    `${(100 * byLum[0].ink).toFixed(2)}% to ${(100 * byLum[byLum.length - 1].ink).toFixed(2)}%`);

  // The source half. Read off the shader the page compiled rather than off the file on
  // disk, because that is the artifact the pixels came from - and under `--mutate` it is
  // the mutated bytes, so a row reading the checkout would be asserting about code this run
  // never rendered.
  const shader = await page.evaluate('globalThis.__kinect.material.fragmentShader');
  const table = shader.match(/const uvec2 GLYPHS\[64\] = uvec2\[64\]\(([\s\S]*?)\n\);/);
  const popcount = (n) => { let c = 0; for (let x = n >>> 0; x; x >>>= 1) c += x & 1; return c; };
  const inks = table
    ? [...table[1].matchAll(/uvec2\(0x([0-9a-fA-F]{8})u,\s*0x([0-9a-fA-F]{8})u\)/g)]
      .map(([, a, b]) => popcount(parseInt(a, 16)) + popcount(parseInt(b, 16)))
    : [];
  const outOfOrder = (list) => list.map((v, i) => (i > 0 && v < list[i - 1] ? i : -1)).filter((i) => i >= 0);
  check(inks.length === 64,
    'the alphabet the page compiled is sixty-four characters, read out of the shader itself',
    `${inks.length} bitmask pairs${table ? '' : ' - the table did not parse'}`);
  check(inks.length === 64 && outOfOrder(inks).length === 0 && inks[63] > inks[0],
    'and it is sorted by ink, sparsest first, which is what lets one table be a ramp and a '
    + 'noise source at once',
    inks.length === 64
      ? `${inks[0]} bits at the sparse end to ${inks[63]} at the dense one`
      + `${outOfOrder(inks).length ? `, descending at ${outOfOrder(inks).join(',')}` : ''}`
      : '');
  // The control for the row above, and it is a probe rather than a mutation for the reason
  // `export-check`'s chain rows are: nothing in this table plants a shuffled alphabet, and a
  // predicate that cannot be shown to reject one is a predicate nobody has tested. Two
  // entries from opposite ends of the table exchanged have to be found.
  const shuffled = inks.slice();
  if (shuffled.length === 64) { [shuffled[3], shuffled[60]] = [shuffled[60], shuffled[3]]; }
  check(shuffled.length === 64 && outOfOrder(shuffled).length > 0,
    'while exchanging two of the sixty-four is found, so the row above is a test rather than '
    + 'a statement',
    `${outOfOrder(shuffled).length} descents once entries 3 and 60 are swapped`);
}

// **What the legibility band is counted in, which is the one thing about the crossfade no
// other arm in this file can see.** The band is 8 to 16 pixels, and the whole content of
// this section is *which* pixels. The mark falls back to a splat at whichever limit comes
// first - the look's own floor in reference pixels, or what the buffer can actually resolve
// - so the size the crossfade reads is the drawn sprite divided by the buffer's own scale
// only where that scale is above one. Below 1080 that is the framebuffer size, above it the
// reference size, and at 1080 exactly they are the same number.
//
// **Every other glyph arm in this file is above the band on both readings, which is why
// none of them can tell the two apart.** That is not an accident of tuning, it is what
// those arms were repointed to do: `GLYPH_LOOK`'s cell went to 0.25m and `timeline-check`'s
// cascade cell was tripled, both so that the mark would be a hard bit and a thinning could
// be asserted as bit-identity. Those are accommodations of the unit, not tests of it, and
// with the crossfade reading pure reference pixels every one of them stays green.
//
// This stage is 360 tall, so a reference pixel is three framebuffer pixels and the two
// readings are a factor of three apart - which is the whole room this section works in. A
// 0.125m cell at the pinned pose's four metres rasterises into about 12 pixels and measures
// 36 reference pixels: inside the band on the reading the shipped build takes, and well
// above it on the reading it must not take.
console.log('\n[registry] and the band is counted in the pixels the buffer actually has');
{
  const unit = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    const base = { ...${JSON.stringify(GLYPH_LOOK)}, 'glyph.hash': 0, 'glyph.tone': 0, 'glyph.rain': 0 };
    const wall = plane(2400);
    const bg = field({ look: base, depth: empty() }).slice();
    const at = (over, cropOutside = null) => {
      const px = field({ look: { ...base, ...over }, depth: wall, cropOutside });
      return { levels: levels(px, bg), ...above(px, bg) };
    };
    return {
      // 0.25m: 24 framebuffer pixels, 72 reference. Above the band on both readings, so
      // the mark is a hard bit whichever one the shader takes - this is the arm that says
      // the statistic can read a one.
      above: at({ cell: 0.25 }),
      // 0.125m: 12 framebuffer pixels, 36 reference. The two readings disagree here.
      inside: at({ cell: 0.125 }),
      // The crop's own half, which is the same disagreement produced by the halving rather
      // than by the cell. A cut-away point draws at half its size, so a 0.25m cell that is
      // above the band whole is inside it cut - and the sprite is then smaller than the
      // cell pitch, so the marks stand apart and nothing overlaps into a second value.
      // The depth range is what puts every point outside the box: the wall is at 2.4m and
      // the far face is at 1.0, so the whole frame is cut away and the faint pass keeps it.
      cropped: at({ cell: 0.25, crop: true, near: 0.5, far: 1.0 }, 0.6),
    };
  })()`);

  // The floor is 0.5% and not the 3% the two-surface guard uses, for that section's own
  // reason: every key is down here so every cell draws index 0, the sparsest character in a
  // table sorted by ink, and it reads 1.55% on a build doing exactly what it should.
  check(unit.above.lit > 0.005 && unit.inside.lit > 0.005 && unit.cropped.painted > 500,
    'all three arms draw their marks, so the counts below are taken on pictures',
    `above ${(100 * unit.above.lit).toFixed(2)}% inked, inside `
    + `${(100 * unit.inside.lit).toFixed(2)}%, cut away ${unit.cropped.painted}px painted`);

  // The reference the other two are read against. A hard bit is one colour, and if this
  // arm ever stops reading one the statistic has stopped meaning what the rows below take
  // it to mean - an overlap, a second depth, a grade term - and they should be read again
  // rather than believed.
  check(unit.above.levels === 1,
    'a cell well above the band on both readings paints exactly one colour, so the mark is '
    + 'a hard bit and the count can say so',
    `${unit.above.levels} distinct colours`);

  // The claim, and the mutation beside it is a build that reads the reference size: there
  // this cell is 36 pixels, comfortably above the band, and the mark comes out hard.
  check(unit.inside.levels > 1,
    'a cell inside the band in framebuffer pixels and above it in reference pixels is a '
    + 'blend, so the crossfade is counted in the pixels the buffer has',
    `${unit.inside.levels} distinct colours at 12 framebuffer pixels against `
    + `${unit.above.levels} at 24`);

  // The crop half of the same claim, which had never executed: the halving is the last
  // thing that moves the sprite and the reading is taken after it.
  check(unit.cropped.levels > 1,
    'and a cut-away cell is read at the half size it is actually drawn at, so the crop edge '
    + 'crossfades rather than staying a hard mark at half the pixels',
    `${unit.cropped.levels} distinct colours over ${unit.cropped.painted}px`);
}

// **And the other half of the invariant, which needs a buffer this file does not otherwise
// have.** Everything above runs on a 360-tall canvas, where the buffer scale is a third and
// `gl_PointSize / max(k, 1.0)` is `gl_PointSize` - the divisor is 1 and the two expressions
// are the same text evaluated. So a build that dropped the division outright passes every
// row in the section above, and passes it for the honest reason that nothing there can tell
// the two apart. The rule has two ends and only one of them was held.
//
// This is the other end, and it costs a page of its own: the buffer has to be **taller than
// 1080** for the divisor to be anything, and the stage on this tool's own page is 360. A
// viewport of 3840x2380 leaves a 16:9 stage of 3840x2160 under the same chrome every other
// page here carries, which is a scale of exactly 2 - and it is measured rather than assumed,
// because a chrome height that moved would move the scale with it and the two readings below
// are derived from what the context actually reported.
//
// The cell is 2cm, and both readings matter. At a scale of 2 it rasterises into about 12
// framebuffer pixels, which is inside the band, and measures about 6 reference pixels, which
// is below it - so the shipped build takes the smaller reading, the crossfade is zero, and
// the mark is the round splat the look asked for. A build reading framebuffer pixels alone
// sees 12, crossfades halfway, and draws characters where the grade says dots.
//
// **The claim is an equality over the keys rather than a statistic about the mark**, because
// a crossfade of exactly zero has a property nothing else does: the three keys choose a
// character that is not drawn, so moving them cannot reach a pixel. That is bit-identity,
// with no threshold in it. The companion arm at a 9cm cell is above the band on both
// readings, where the same two key settings have to part company - without it this row would
// pass on a build whose keys reach nothing anywhere.
console.log('\n[registry] and above 1080 the same band is counted in the look\'s own pixels');
{
  const wide = await openPage({ viewportSize: { width: 3840, height: 2380 } });
  const over = await wide.page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    const base = { ...${JSON.stringify(GLYPH_LOOK)}, 'glyph.hash': 0, 'glyph.tone': 0, 'glyph.rain': 0 };
    const wall = plane(2400);
    const bg = field({ look: base, depth: empty() }).slice();
    const gl = k.renderer.getContext();
    const buffer = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    const scale = buffer[1] / 1080;
    // The projection's own cotangent rather than a baked fifty degrees, and the view
    // distance is the pinned pose's: the camera sits at z = +1.6 and the wall at z = -2.4.
    const p11 = k.freeCamera.projectionMatrix.elements[5];
    const readings = (cell) => {
      const reference = (cell * p11 * 540) / 4.0;
      return { cell, reference, drawn: reference * scale };
    };
    const at = async (cell, keys) => {
      const px = field({ look: { ...base, cell, ...keys }, depth: wall });
      return { hash: await sha256(px), ...above(px, bg) };
    };
    const LOUD = { 'glyph.hash': 1, 'glyph.tone': 0.7 };
    return {
      buffer,
      scale,
      small: readings(0.02),
      large: readings(0.09),
      smallQuiet: await at(0.02, {}),
      smallLoud: await at(0.02, LOUD),
      largeQuiet: await at(0.09, {}),
      largeLoud: await at(0.09, LOUD),
    };
  })()`);

  console.log(`  buffer ${over.buffer.join('x')}, scale ${over.scale.toFixed(3)}: the 2cm cell `
    + `rasterises into ${over.small.drawn.toFixed(1)} framebuffer pixels and measures `
    + `${over.small.reference.toFixed(1)} reference ones; the 9cm cell `
    + `${over.large.drawn.toFixed(1)} and ${over.large.reference.toFixed(1)}`);

  // The condition the two rows below stand on, and it is three separate facts: the buffer is
  // over 1080 so the divisor is not 1, the small cell straddles the band with one reading
  // inside it and the other below, and the wall renders at all.
  check(over.scale > 1.5 && over.small.drawn > 8 && over.small.reference < 8
    && over.smallQuiet.lit > 0.002,
    'the arm stands where the two readings disagree - above 1080, with the cell inside the '
    + 'band in framebuffer pixels and below it in reference pixels',
    `scale ${over.scale.toFixed(3)}, drawn ${over.small.drawn.toFixed(1)}, reference `
    + `${over.small.reference.toFixed(1)}, ${(100 * over.smallQuiet.lit).toFixed(2)}% inked`);

  // The claim.
  check(over.smallQuiet.hash === over.smallLoud.hash,
    'a cell under the band in reference pixels draws no character above 1080 either, so the '
    + 'smaller of the two readings governs and the boundary between text and texture is a '
    + 'property of the look rather than of the output size',
    over.smallQuiet.hash === over.smallLoud.hash
      ? `both ${over.smallQuiet.hash.slice(0, 12)} with the keys down and up`
      : `${over.smallQuiet.hash.slice(0, 12)} against ${over.smallLoud.hash.slice(0, 12)} - the `
        + 'keys are choosing a character the look asked not to draw');

  // And the control: the same two key settings at a cell above the band on both readings.
  check(over.largeQuiet.hash !== over.largeLoud.hash,
    'while at a cell above the band on both readings the same two settings do draw different '
    + 'characters, so the equality above is not a page where the keys reach nothing',
    `${over.largeQuiet.hash.slice(0, 12)} against ${over.largeLoud.hash.slice(0, 12)} at `
    + `${over.large.drawn.toFixed(0)} framebuffer pixels`);

  check(wide.errors.length === 0, 'and the wide page logged no errors',
    wide.errors.slice(0, 2).join('; '));
  await wide.page.close();
}

// **The part of a character that is not there must not stand in front of anything.** An
// 8x8 bitmask is mostly margin, and on the hard-edged path the sprite is a square quad with
// depthWrite on and no alphaTest under it - so a fragment whose alpha comes out exactly
// zero still writes depth and hides whatever the room had behind it. That shipped: the four
// documents with additive off lost between 4.3% and 5.0% of their pixels to invisible
// square occluders at a glyph of 1, and the same look with no lattice and a pointSize of 40
// hid 43% of the lit frame.
//
// **No row in this file could see it, and the reason is rule 5 rather than an oversight.**
// The sections above plant one wall, coincident with itself, where there is nothing behind
// anything - `GLYPH_LOOK`'s comment gives the reason, which is that a coincident plane at
// full glyph is idempotent and that is what lets a thinning be asserted as bit-identity. An
// object every observation happens to skip is exactly the shape this suite keeps finding,
// and here it was the second surface.
//
// **The claim is an equality rather than a ratio, and that is what makes it free of a
// threshold.** With three fixtures cut out of one mask, the combined frame's points are the
// near ones and the far ones and nothing else. So at every pixel the near cloud left alone,
// the combined frame has to be the far-only frame - to the byte. A margin that occludes
// takes far pixels away and fails it; a margin that does not cannot move a pixel it draws
// nothing on, because under normal blending a fragment of alpha zero is the destination
// unchanged.
console.log('\n[registry] and the margin around a character is not a surface');
{
  const occl = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    // The keys are all down on purpose, so every cell draws index 0 - the sparsest
    // character in a table sorted by ink, and therefore the largest margin the alphabet
    // has. The dense arm below is the same geometry with the hash key up, which is what
    // measures how much of the box the sparse mark is leaving empty.
    //
    // **The two depths and the cell size are one choice with two ends to it**, because the
    // legibility crossfade is now in framebuffer pixels and the two surfaces want opposite
    // sides of its band. A camera at z = +1.6 puts 1.2m at a view distance of 2.8m and 4.0m
    // at 5.6m, and a 0.15m cell rasterises into about 21 pixels at the first and 10 at the
    // second. The near number has to clear 16, where the crossfade is exactly 1: there the
    // mark is a hard bit, an off bit's alpha is exactly zero rather than nearly zero, and
    // the whole square is either ink or nothing. The far number wants to be well under it,
    // where the mark is mostly the round splat it falls back to, because a far surface that
    // also drew sparse characters would be 1.5% of the frame - almost nothing to hide, and
    // the section would be asking its question of a nearly empty room. Measured while
    // getting this wrong: at the shared 0.25m cell both surfaces sat above the band and the
    // population fell from 5881 pixels to 291.
    const look = { ...${JSON.stringify(GLYPH_LOOK)},
      cell: 0.15, near: 0.5, far: 4.5, 'glyph.hash': 0, 'glyph.tone': 0, 'glyph.rain': 0 };
    const { both, near, far } = twoSurfaces(1200, 4000, 16);
    const bg = field({ look, depth: empty() }).slice();
    const C = field({ look, depth: both }).slice();
    const F = field({ look, depth: far }).slice();
    const N = field({ look, depth: near }).slice();
    const D = field({ look: { ...look, 'glyph.hash': 1 }, depth: near }).slice();
    let population = 0, atRisk = 0, moved = 0, movedAtRisk = 0, nearInk = 0, farLit = 0;
    for (let i = 0; i < C.length; i += 4) {
      if (drew(N, bg, i)) { nearInk++; continue; }
      if (!drew(F, bg, i)) continue;
      farLit++;
      population++;
      const inBox = drew(D, bg, i);
      if (inBox) atRisk++;
      if (C[i] !== F[i] || C[i + 1] !== F[i + 1] || C[i + 2] !== F[i + 2]) {
        moved++;
        if (inBox) movedAtRisk++;
      }
    }
    const n = C.length / 4;
    return { population, atRisk, moved, movedAtRisk, nearInk, farLit, n,
      sparse: above(N, bg), dense: above(D, bg), combined: above(C, bg), farOnly: above(F, bg) };
  })()`);

  check(occl.farOnly.lit > 0.1 && occl.sparse.lit > 0.002,
    'both surfaces render, so the rows below are comparing pictures rather than black',
    `the far surface alone inks ${(100 * occl.farOnly.lit).toFixed(2)}% of the frame and the `
    + `near marks ${(100 * occl.sparse.lit).toFixed(2)}%`);

  // The vacuity guard, and it is a population rather than a proxy for one. Raising the hash
  // key spreads the cells across the whole alphabet and leaves the geometry untouched, so
  // every pixel the dense arm draws on and the sparse arm does not is a pixel demonstrably
  // inside a near sprite's own box with nothing drawn on it. Counted only where the far
  // surface is lit, which makes it exactly the set of pixels an occluding margin would take
  // away - and if it were empty, the claim below would be a statement about nowhere.
  check(occl.atRisk > 2000 && occl.dense.painted > occl.sparse.painted * 4,
    'and the sparse mark leaves most of its own box empty with the far surface showing '
    + 'through it, so there is something for a margin to hide',
    `${occl.atRisk} pixels of far surface sit inside a near sprite with no near mark on them, `
    + `out of ${occl.population} the near cloud left alone; the same cells at a hash of 1 `
    + `paint ${occl.dense.painted}px against ${occl.sparse.painted}px`);

  // The claim.
  check(occl.moved === 0,
    'every pixel the near marks did not draw on is the far surface untouched, so a character '
    + 'occludes with its ink and not with its box',
    occl.moved === 0
      ? `0 of ${occl.population} pixels moved, ${occl.atRisk} of them inside a near sprite`
      : `${occl.moved} of ${occl.population} pixels moved without a near mark on them, `
        + `${occl.movedAtRisk} of those inside a near sprite - the margin is writing depth`);
}

// **A point that has not faded in yet is invisible in colour and solid in depth, and that
// is older than characters by a long way.** The section above stands the same two surfaces
// up and cannot see it: every planted look in this file carries `fade: 0`, which sends the
// vertex stage down the `fadeTime > 0.0 ? ... : 1.0` branch and makes the crossfade the
// constant 1, so nothing up there is ever at zero alpha for any reason except a character's
// margin. That is rule 5 twice over on the same fixture - an object every observation
// happens to skip, and skipped for a reason that reads as sound.
//
// **The fixture cannot be `field()` and the reason is arithmetic rather than convenience.**
// `field()` injects a depth grid straight into the texture and writes `sinceFrameSec` by
// hand, and the crossfade reads `st.g + sinceFrameSec` - so with the surface memory cleared
// every point in the frame carries the same age, and a fade window either blanks the whole
// cloud or none of it. There is no setting of it in which one surface is faded in and the
// other is not, which is exactly the frame this claim needs.
//
// The pinned drive has the per-texel age the plant wants, because the memory zeroes `.g` on
// a swap and adds the gap to it otherwise. Three synthetic frames carry that:
//
//   0, 1   the far surface, with holes where the near points are going to be
//   2      both surfaces
//
// Stepped to frame 1's own time, the offset into the frame is 0 - asserted below rather than
// assumed - and the drive has applied every frame up to 2. The near texels were born on that
// last step, so their age is exactly 0 and the fade window puts them at exactly zero alpha.
// The far texels never swapped, so theirs is the gap between two frames and they draw at full
// strength. **The far-only arm is the same three frames with the near points never
// arriving**, so the only difference between the two is a cloud that draws nothing - which
// makes the claim byte-identity over the whole frame rather than an equality carved out of
// part of it, with no threshold anywhere in it.
//
// A birth leaves no ghost to confuse the comparison, and that is the memory's own rule rather
// than an assumption: a swap writes `wasValid ? last : 0.0` into the depth a ghost would stand
// at, so a texel arriving over nothing writes 0 there and the ghost branch's `st.r <= 0.0`
// takes it out before it can rasterise.
//
// It costs a page of its own because it re-pins the drive, and every section after this one
// plants through `field()` on the shared page's fixture.
//
// **What this does not hold is the disc's own rim**, and that is stated rather than left to
// be inferred. `smoothstep(0.25, 0.02, r2)` reaches 0 at exactly r2 = 0.25, one ring of
// fragments the `r2 > 0.25` test lets through, and whether a rasterised sprite lands a sample
// on that ring at all depends on its fractional size - so it is real and measured on footage,
// at 12 pixels per shipped look over the fifteen pinned positions, and there is no setting of
// this fixture that plants it deterministically. `docs/instruments.md` carries the case file.
console.log('\n[registry] and a point that has not faded in yet is not a surface either');
{
  const born = await openPage();
  const occl = await born.page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    const W = 512, H = 424, N = W * H;
    // The same interleave the section above uses and for the same reason: a near sprite only
    // hides a far point the driver reaches after it, and a block of near texels would leave
    // that dependent on which side of the block the far rows sat.
    const mask = (withNear) => {
      const a = new Uint16Array(N);
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          const near = r % 16 === 0 && c % 16 === 0;
          a[r * W + c] = near ? (withNear ? 1200 : 0) : 4000;
        }
      }
      return a;
    };
    // The pinned wire shape, which is the one \`PinnedPairSource\` parses: depth byte count,
    // colour byte count, the capture stamp, then the depth. A hundred milliseconds apart, so
    // the far surface's age clears the fade window below with room to spare.
    const pack = (grids) => {
      const per = 16 + N * 2;
      const buf = new ArrayBuffer(per * grids.length);
      const view = new DataView(buf);
      grids.forEach((g, i) => {
        view.setUint32(i * per, N * 2, true);
        view.setUint32(i * per + 4, 0, true);
        view.setBigUint64(i * per + 8, BigInt(i * 100), true);
        new Uint16Array(buf, i * per + 16, N).set(g);
      });
      return buf;
    };
    const far = mask(false);
    const both = mask(true);
    const none = new Uint16Array(N);
    // No characters anywhere: this is the older half of the class and it belongs to looks
    // that draw no glyph at all, so a fixture drawing them would be asking the question the
    // section above already answers.
    const look = { additive: false, denoise: false, wake: 0, opacity: 1, exposure: 1,
      pointSize: 64, 'lattice.amount': 1, cell: 0.15, 'glyph.amount': 0, 'rain.amount': 0,
      interpolate: false, readRgb: 0, readDepth: 1, readGhost: 0, readContour: 0,
      readBlackwall: 0, near: 0.5, far: 4.5 };
    const shot = (grids, fade) => {
      const times = k.drive.pin(pack(grids));
      k.params.reset();
      k.params.apply({ ...look, fade });
      k.drive.reset();
      pinCamera(k.freeCamera);
      k.drive.stepTo(times[1]);
      return { px: k.drive.readPixels().slice(), since: k.uniforms.sinceFrameSec.value };
    };
    // This renderer does not clear to black, so every "is anything lit here" reading taken
    // against zero comes back saying the whole frame is lit. Each arm is read against a frame
    // of the same fixture with no depth in it at all.
    const bg = shot([none, none, none], 60).px;
    const F = shot([far, far, far], 60);
    const C = shot([far, far, both], 60);
    // The same pair with no fade window, which is what says the near cloud is present and
    // held at zero alpha rather than simply absent - without it the equality below would be
    // satisfied perfectly by a plant that failed.
    const Flit = shot([far, far, far], 0).px;
    const Clit = shot([far, far, both], 0).px;
    const drew = (px, i) => px[i] !== bg[i] || px[i + 1] !== bg[i + 1] || px[i + 2] !== bg[i + 2];
    const lit = (px) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (drew(px, i)) n++; return n / (px.length / 4); };
    let moved = 0, atRisk = 0, movedAtRisk = 0;
    for (let i = 0; i < C.px.length; i += 4) {
      const inSprite = Clit[i] !== Flit[i] || Clit[i + 1] !== Flit[i + 1] || Clit[i + 2] !== Flit[i + 2];
      if (inSprite && drew(F.px, i)) atRisk++;
      if (C.px[i] !== F.px[i] || C.px[i + 1] !== F.px[i + 1]
        || C.px[i + 2] !== F.px[i + 2] || C.px[i + 3] !== F.px[i + 3]) {
        moved++;
        if (inSprite) movedAtRisk++;
      }
    }
    return { moved, atRisk, movedAtRisk, since: C.since, sinceFar: F.since,
      pixels: C.px.length / 4, farLit: lit(F.px), combinedLit: lit(C.px),
      farPaint: lit(Flit), nearPaint: lit(Clit) };
  })()`);

  check(occl.farLit > 0.02 && occl.nearPaint > occl.farPaint * 1.2,
    'the far surface renders and the near cloud is really in front of it, so the equality '
    + 'below is comparing pictures rather than two empty frames',
    `the far surface inks ${(100 * occl.farLit).toFixed(2)}% of the frame, and with the fade `
    + `window off the same pair inks ${(100 * occl.nearPaint).toFixed(2)}% against the far `
    + `surface's ${(100 * occl.farPaint).toFixed(2)}%`);

  // The vacuity guard, and it is the plant asserted rather than described. `sinceFrameSec` at
  // exactly 0 is what puts the newborn points at an age of exactly 0, and a drive that landed
  // anywhere else inside the frame would fade them in and leave nothing here to hide with.
  // The at-risk count is the population an invisible sprite could take away: lit far surface
  // standing behind a near sprite's own footprint.
  check(occl.since === 0 && occl.atRisk > 300,
    'and the near cloud is at zero alpha because its points were born on this frame, with lit '
    + 'far surface behind them, so there is something for an invisible sprite to hide',
    `sinceFrameSec ${occl.since} at the plant and ${occl.sinceFar} on the far-only arm; `
    + `${occl.atRisk} pixels of lit far surface sit inside a near sprite's footprint`);

  // The claim, and it is the whole frame rather than a carved-out part of it: the near cloud
  // draws nothing at all, so a correct build renders the far-only frame byte for byte.
  check(occl.moved === 0,
    'and the frame with the newborn cloud in it is the frame without it, byte for byte, so a '
    + 'point that has not faded in yet occludes nothing',
    occl.moved === 0
      ? `0 of ${occl.pixels} pixels moved, ${occl.atRisk} of them behind a newborn sprite`
      : `${occl.moved} of ${occl.pixels} pixels moved, ${occl.movedAtRisk} of those behind a `
        + `newborn sprite - a point at zero alpha is writing depth`);

  check(born.errors.length === 0, 'and the page it ran on logged no errors',
    born.errors.slice(0, 2).join('; '));
  await born.page.close();
}

// **Which side of the head the afterglow sits on**, which is what makes the wave read as
// falling rather than as a band sliding through - and every sign draws a picture, so no row
// asking whether the rain changed anything can say which one shipped.
//
// **A full wall cannot answer it.** The phase is offset per column by a hash of the cell's
// own x and z, on purpose, so that the room does not pulse as a single plane - which means
// a frame of a wall holds a dozen columns at a dozen phases and the vertical profile of the
// lift averages flat. Measured that way before the strip existed: flat. So the fixture is
// one column, planted narrow enough to fall inside a single lattice cell, and the profile
// read up it is one drop's.
//
// The head is found rather than computed, because its position depends on that per-column
// hash and the tool has no business knowing it: the phase is swept, the row of maximum lift
// is the head, and the arm used is whichever phase puts it nearest the middle of the strip
// so both windows are inside the planted region. `readPixels` returns rows from the bottom,
// so a higher row index is higher in the room.
console.log('\n[registry] the rain falls, and its afterglow is above the head');
{
  const trail = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    // The span is wide and the trail long so that exactly one head is inside the planted
    // slab: a column carrying three of them has no unambiguous peak to measure either side
    // of. Round splats and no lattice, because the rain is a colour term that works over
    // dots and this section is not about characters.
    const look = { additive: false, denoise: false, fade: 0, wake: 0, opacity: 1, exposure: 1,
      pointSize: 12, 'lattice.amount': 0, cell: 0.5, 'glyph.amount': 0,
      readRgb: 0, readDepth: 1, readGhost: 0, readContour: 0, readBlackwall: 0, near: 0.5, far: 4,
      'rain.amount': 0.9, 'rain.speed': 0.55, 'rain.span': 4, 'rain.trail': 1.2 };
    const strip = column(2400, 30);
    const off = field({ look: { ...look, 'rain.amount': 0 }, depth: strip }).slice();
    // The lift is read as a ratio against the same column with the rain down, so the base
    // picture divides out and what is left is the term itself.
    let lo = 360, hi = -1;
    for (let y = 0; y < 360; y++) {
      let n = 0;
      for (let x = 0; x < 640; x++) {
        const i = (y * 640 + x) * 4;
        if (off[i] + off[i + 1] + off[i + 2] > 30) n++;
      }
      if (n > 20) { if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    const profileAt = (rainPhase) => {
      const px = field({ look, depth: strip, rainPhase });
      const rows = new Array(360).fill(null);
      for (let y = lo; y <= hi; y++) {
        let sum = 0, n = 0;
        for (let x = 0; x < 640; x++) {
          const i = (y * 640 + x) * 4;
          const base = off[i] + off[i + 1] + off[i + 2];
          if (base > 30) { sum += Math.max(0, (px[i] + px[i + 1] + px[i + 2]) - base) / base; n++; }
        }
        if (n > 20) rows[y] = sum / n;
      }
      return rows;
    };
    const middle = (lo + hi) / 2;
    const window = Math.floor((hi - lo) / 6);
    let best = null;
    for (let rainPhase = 0; rainPhase < 8; rainPhase += 0.5) {
      const rows = profileAt(rainPhase);
      let head = -1, lift = -1;
      for (let y = lo; y <= hi; y++) if (rows[y] !== null && rows[y] > lift) { lift = rows[y]; head = y; }
      if (head - window < lo || head + window > hi) continue;
      if (best === null || Math.abs(head - middle) < Math.abs(best.head - middle)) {
        const mean = (from, to) => {
          let sum = 0, n = 0;
          for (let y = from; y <= to; y++) if (rows[y] !== null) { sum += rows[y]; n++; }
          return n ? sum / n : 0;
        };
        best = { rainPhase, head, lift,
          aboveHead: mean(head + 3, head + window), belowHead: mean(head - window, head - 3) };
      }
    }
    // The head found again at three further phases, for the descent row. The step is a
    // choice about this fixture rather than a round number: the column stands 2.4m from
    // the sensor and so 4.0m from the camera, where a metre of room is about 96
    // framebuffer rows, and a phase step of 0.5 moves a head 0.55 * 0.5 metres - about 27
    // rows, which is far enough to be unambiguous against a profile sampled per row and
    // near enough that four samples stay inside a column 267 rows tall. The span is 4m and
    // the strip holds under 3, so there is one head to follow and no second one arriving
    // from above to be mistaken for it.
    const descent = [];
    if (best !== null) {
      for (const step of [0, 0.5, 1.0, 1.5]) {
        const rows = profileAt(best.rainPhase + step);
        let head = -1, lift = -1;
        for (let y = lo; y <= hi; y++) if (rows[y] !== null && rows[y] > lift) { lift = rows[y]; head = y; }
        descent.push({ step, head, lift });
      }
    }
    return { lo, hi, window, best, descent, rows: hi - lo + 1 };
  })()`);

  check(trail.best !== null && trail.best.lift > 0.05,
    'the planted column carries a drop, so the two readings below are of a wave rather than '
    + 'of a flat picture',
    trail.best
      ? `${trail.rows} rows of column, head at row ${trail.best.head} at phase `
        + `${trail.best.rainPhase}, lifting ${trail.best.lift.toFixed(3)} of the base there`
      : `no phase in the sweep put a head clear of the ends of a ${trail.rows}-row column`);

  // The claim, and it is stated as which way rather than as whether. The trail decays
  // upward from the head over `rain.trail` metres and a point just under a head is a whole
  // span below the next one, so the room above the head is lit and the room below it is
  // dark. A build reading the other side of the fraction puts the same decay underneath,
  // which draws a wave that reads as rising.
  const dir = trail.best ?? { aboveHead: 0, belowHead: 0, head: -1, window: 0 };
  check(trail.best !== null && dir.aboveHead > dir.belowHead * 4 + 0.05,
    'and the afterglow is above the head rather than below it',
    `mean lift ${dir.aboveHead.toFixed(4)} over the ${trail.window} rows above the head, `
    + `${dir.belowHead.toFixed(4)} over the ${trail.window} below`);

  // **Which way the pattern travels, which is a different claim from which side the trail
  // sits on and had no row at all.** Negate the phase and the rain rises: every head is
  // still a head, the trail is still above it, the speed and the gap are still metres, and
  // the row above goes on passing - because a frame has no direction in it. Only two phases
  // do. `readPixels` hands rows back from the bottom of the frame, so a falling head is a
  // head whose row index goes down as the clock goes forward.
  //
  // Stated as the sign and not as the rate. The rate is a real number and it has been
  // measured - about 76 rows a second over an 0.8m slab against a predicted 87, with the
  // gap unexplained and the prediction easy to get twice wrong, since it runs off the view
  // distance rather than the sensor depth. A row asserting it would be asserting the part
  // of that nobody has closed; a row asserting the sign is asserting the whole of what the
  // design says.
  const walk = trail.descent ?? [];
  const inside = walk.filter((s) => s.head > trail.lo && s.head < trail.hi && s.lift > 0.05);
  check(walk.length === 4 && inside.length === 4,
    'the head stays inside the planted column across the whole walk, so the row below is '
    + 'reading a head rather than an end of the strip',
    walk.length
      ? walk.map((s) => `+${s.step}: row ${s.head} lifting ${s.lift.toFixed(3)}`).join(', ')
        + ` in rows ${trail.lo}..${trail.hi}`
      : 'no phase in the sweep put a head clear of the ends of the column');
  const climbs = walk.filter((s, i) => i > 0 && s.head >= walk[i - 1].head);
  check(walk.length === 4 && climbs.length === 0,
    'and the head is lower in the room at every later phase, so the wave falls',
    walk.length
      ? `rows ${walk.map((s) => s.head).join(' -> ')} at phases `
        + `${walk.map((s) => (trail.best.rainPhase + s.step).toFixed(2)).join(', ')}`
        + ` (${((walk[0].head - walk[3].head) / 1.5).toFixed(1)} rows per unit of phase, downward)`
      : 'no walk was taken');
}

// The head gap is metres of room, and this is the only section that can say so. It is the
// mirror of the duotone's metre section above and of `vspeed-unnormalised` beside it: a
// build dividing the world height by a frame-derived quantity produces the identical number
// at 30fps, lands the parameter in its uniform, moves the picture when it is reverted, and
// satisfies the drop-one sweep completely. What it gets wrong is only visible from two link
// speeds at once - and the planted rows are the only place in this file where the gap
// between the bound frames is something the check chooses rather than something the fixture
// hands it.
//
// The sample this repo ships was shot at about 9.3fps, so a ninth of a second is the
// condition the program is actually used in rather than an invented one.
console.log('\n[registry] and the rain\'s head gap is metres of room, not the link\'s frame gap');
{
  const link = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    const look = { additive: false, denoise: false, fade: 0, wake: 0, opacity: 1, exposure: 1,
      pointSize: 12, 'lattice.amount': 0, cell: 0.5, 'glyph.amount': 0,
      readRgb: 0, readDepth: 1, readGhost: 0, readContour: 0, readBlackwall: 0, near: 0.5, far: 4,
      'rain.amount': 0.9, 'rain.speed': 0.55, 'rain.span': 1.3, 'rain.trail': 0.45 };
    const wall = plane(2400);
    const bg = field({ look, depth: empty() }).slice();
    const at = async (spanSec, span) => {
      const px = field({ look: { ...look, 'rain.span': span }, depth: wall, spanSec, rainPhase: 7 });
      return { hash: await sha256(px), ...above(px, bg) };
    };
    return {
      nominal: await at(1 / 30, 1.3),
      degraded: await at(1 / 9, 1.3),
      widened: await at(1 / 30, 2.6),
    };
  })()`);

  check(link.nominal.lit > 0.05,
    'the wall renders with the rain on it, so the equality below is comparing pictures',
    `${(100 * link.nominal.lit).toFixed(2)}% lit, energy ${link.nominal.energy.toFixed(2)}`);

  check(link.nominal.hash === link.degraded.hash,
    'a 30fps link and a 9fps one render the same frame, so the head gap is metres and not frames',
    link.nominal.hash === link.degraded.hash
      ? `both ${link.nominal.hash.slice(0, 12)} at spans of 33ms and 111ms`
      : `${link.nominal.hash.slice(0, 12)} at 33ms against ${link.degraded.hash.slice(0, 12)} at `
        + '111ms - the spacing follows the link');

  // The control for it: two frames that agree prove the gap is invariant under the link,
  // and this is what proves the gap exists at all.
  check(link.widened.hash !== link.nominal.hash,
    'while doubling the gap at one link speed does move it, so the equality above is not a '
    + 'parameter that reaches nothing',
    `1.3m gives energy ${link.nominal.energy.toFixed(2)}, 2.6m gives ${link.widened.energy.toFixed(2)}`);
}

// **A splat's energy does not follow its sprite**, which is what the additive normalisation
// is for and what growing the mark to a cell nearly took away. The floor at 0.05 was
// harmless while a sprite was `pointSize`-sized - 9 pixels only reaches the band within
// 19cm, nearer than the sensor will range - and a cell-sized sprite moves the same
// threshold out by a factor of seven, to about 1.32m, which is where a person stands.
//
// **Nothing else in this file can stand where this has to.** All nine shipped documents sit
// at a `pointSize` of 9 or below and the scrambled set at 9.5, so at the pinned pose the
// largest sprite anywhere in this suite is a `vSize` of about 16 against a floor that bites
// at 48.3. The condition is planted instead: one texel, and the camera walked toward it.
//
// One point rather than a wall, and that is the whole reason this row is readable. The
// claim is about a total, so it has to be measured against a frame where the total is not
// dominated by overlap: coincident sprites saturate at the near end and clip, which
// compresses exactly the arm the mutation moves. A single sprite has no overlap, no
// clipping, and no dependence on how the wall happened to be sampled - and it is centred,
// so no arm loses a share of its footprint off the edge of the frame.
console.log('\n[registry] a splat\'s energy is its own, whatever size the sprite is');
{
  // The distances are the parameter rather than the point size, because `pointSize` tops
  // out at 64 and the pinned pose is four metres from the plant - which caps `vSize` at 16
  // and never reaches the band. Walking the camera in is the only way to cross it, and it
  // leaves the point count, the colour and the plant identical between the arms. The four
  // land at `vSize` 24.6, 33.7, 68.1 and 97: two inside the clamp band and two past the
  // floor, where the shipped build goes on scaling and a floored one has stopped.
  const DISTANCES = [2.6, 1.9, 0.94, 0.66];
  const sprite = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    // Additive, because the normalisation this is about is on that path alone. The colour
    // reading is the planted 2x2 rather than the depth ramp, for exposure headroom: the
    // dimmest arm spreads one point's energy over a thousand pixels and an eight-bit
    // readback throws away whatever rounds to zero.
    const look = { additive: true, denoise: false, fade: 0, wake: 0, opacity: 1, exposure: 6,
      pointSize: 64, 'lattice.amount': 0, 'glyph.amount': 0, 'rain.amount': 0,
      readRgb: 1, readDepth: 0, readGhost: 0, readContour: 0, readBlackwall: 0, near: 0.5, far: 2.6 };
    const point = oneTexel(2400);
    const rows = [];
    for (const dist of ${JSON.stringify(DISTANCES)}) {
      const pose = { eye: [0, 0, -2.4 + dist], at: [0, 0, -2.4] };
      const bg = field({ look, depth: empty(), ...pose }).slice();
      const px = field({ look, depth: point, ...pose });
      const s = above(px, bg);
      rows.push({ dist, vSize: 64 / dist, energy: s.energy * 640 * 360, peak: s.peak, painted: s.painted });
    }
    return rows;
  })()`);

  const energies = sprite.map((r) => r.energy);
  const spread = Math.max(...energies) / Math.max(1, Math.min(...energies));
  const painted = sprite.map((r) => r.painted);

  // Two guards rather than one, because this row can fail in both directions. A sprite
  // nobody can see makes every total zero and the ratio 1; a sprite that clips at white has
  // had its total taken away by the readback rather than by the shader, which is the same
  // compression the mutation produces.
  check(Math.min(...sprite.map((r) => r.peak)) >= 3 && Math.max(...sprite.map((r) => r.peak)) < 250,
    'every arm draws a sprite and none of them saturates, so the totals below are the shader\'s',
    sprite.map((r) => `vSize ${r.vSize.toFixed(1)}: peak ${r.peak}/255 over ${r.painted}px`).join('; '));

  // The control: the sprite really did grow. Without it the invariance row passes on a build
  // where the point size reaches nothing at all, which is the strongest possible way to hold
  // a total still.
  check(Math.max(...painted) > Math.min(...painted) * 4,
    'and the sprite grows across the arms, so the invariance is over a range rather than over '
    + 'one size four times',
    `${Math.min(...painted)}px to ${Math.max(...painted)}px of footprint`);

  // The claim. A floored build stops dividing once `vSize` passes 48.3 while the footprint
  // goes on squaring, so its two near arms carry two and four times the energy they should.
  check(spread < 1.15,
    'and one point contributes the same total light at every sprite size, so the '
    + 'normalisation has no floor under it',
    sprite.map((r) => `vSize ${r.vSize.toFixed(1)}: ${r.energy.toFixed(0)}`).join(', ')
      + ` - spread ${spread.toFixed(3)}`);
}

// **The three things this branch adds that have to be exactly absent at their defaults**,
// and they are equalities, which is what makes them worth pointing a mutation at. Eight of
// the ten shipped looks draw no characters and no rain and sit at a lattice of zero, so
// what protects every frame they have ever rendered is that two masters multiply to exactly
// nothing and one correction is exactly one. Section 1b cannot vouch for any of it: it
// renders at parameter defaults against a build that predates all three, so a term that
// leaked would move both arms of that comparison rather than one.
//
// Each is asked the same way - hold the master at its default and move everything
// underneath it - and each has the control beside it, because an equality over a parameter
// that reaches no pixel is arithmetic rather than evidence.
console.log('\n[registry] the two masters are exactly absent at zero, and so is the cell at lattice 0');
{
  const inert = await page.evaluate(`(async () => {
    ${PAGE_HELPERS}
    ${FIELD_HELPERS}
    const look = { additive: true, denoise: false, fade: 0, wake: 0, opacity: 1, exposure: 1,
      pointSize: 40, 'lattice.amount': 0, cell: 0.15, 'glyph.amount': 0, 'rain.amount': 0,
      readRgb: 0, readDepth: 1, readGhost: 0, readContour: 0, readBlackwall: 0, near: 0.5, far: 4 };
    const wall = plane(2400);
    const bg = field({ look, depth: empty() }).slice();
    const at = async (over) => {
      const px = field({ look: { ...look, ...over }, depth: wall, rainPhase: 7 });
      return { hash: await sha256(px), ...above(px, bg) };
    };
    // Two settings of the three lengths, and two of the three keys, chosen wide apart so
    // that a term leaking by a hundredth still separates them.
    const SLOW = { 'rain.speed': 0.3, 'rain.span': 0.6, 'rain.trail': 0.2 };
    const FAST = { 'rain.speed': 2.4, 'rain.span': 3.4, 'rain.trail': 1.7 };
    const QUIET = { 'glyph.tone': 0, 'glyph.hash': 0, 'glyph.rain': 0 };
    // The rain key sits at exactly 1 rather than near it, which is where a build handing
    // the whole-drop counter to the index raw goes inert - the fraction of an integer is
    // zero. It buys this pair nothing on its own and that is worth saying rather than
    // implying: the two arms here still part company through the other two keys, so the
    // equality would hold either way. What closes the whole-number counter is the
    // rain-key-alone row in the index section, and this value is here so that no reader
    // takes 0.7 for coverage of it.
    const LOUD = { 'glyph.tone': 0.8, 'glyph.hash': 0.9, 'glyph.rain': 1 };
    // **The rain arms raise the glyph master, and that is not incidental.** The vertex
    // stage computes the drop coordinate under a gate naming both masters, so with both of
    // them down the coordinate is zero, the lift collapses to a constant, and the three
    // lengths cannot reach a pixel however leaky the term is - a row asked there is a row
    // that cannot fail. Measured while getting this wrong: with the gate shut the leak
    // control came back green while section 1b reddened on all five readings. With the
    // gate open the lift is a value per point again and a term that is not exactly absent
    // separates the two settings. The rain key stays at zero, or the lengths would reach
    // the character index and the arms would differ on a build with nothing wrong with it.
    const GATED = { 'glyph.amount': 0.6, 'glyph.rain': 0, 'glyph.tone': 0, 'glyph.hash': 1 };
    return {
      rainOffSlow: await at({ 'rain.amount': 0, ...GATED, ...SLOW }),
      rainOffFast: await at({ 'rain.amount': 0, ...GATED, ...FAST }),
      rainOnSlow: await at({ 'rain.amount': 0.8, ...GATED, ...SLOW }),
      rainOnFast: await at({ 'rain.amount': 0.8, ...GATED, ...FAST }),
      glyphOffQuiet: await at({ 'glyph.amount': 0, ...QUIET }),
      glyphOffLoud: await at({ 'glyph.amount': 0, ...LOUD }),
      glyphOnQuiet: await at({ 'glyph.amount': 1, 'lattice.amount': 1, ...QUIET }),
      glyphOnLoud: await at({ 'glyph.amount': 1, 'lattice.amount': 1, ...LOUD }),
      flatFine: await at({ pointSize: 64, cell: 0.005 }),
      flatCoarse: await at({ pointSize: 64, cell: 0.5 }),
      snappedFine: await at({ 'lattice.amount': 0.5, pointSize: 64, cell: 0.005 }),
      snappedCoarse: await at({ 'lattice.amount': 0.5, pointSize: 64, cell: 0.5 }),
    };
  })()`);

  check(inert.rainOffSlow.lit > 0.1,
    'the planted wall renders, so the six equalities below are comparing pictures rather than black',
    `${(100 * inert.rainOffSlow.lit).toFixed(2)}% lit, energy ${inert.rainOffSlow.energy.toFixed(2)}`);

  const pair = (a, b, label, detail) => check(inert[a].hash === inert[b].hash, label,
    inert[a].hash === inert[b].hash ? `both ${inert[a].hash.slice(0, 12)}` : `${detail}: `
      + `${inert[a].hash.slice(0, 12)} against ${inert[b].hash.slice(0, 12)}`);
  const moves = (a, b, label, detail) => check(inert[a].hash !== inert[b].hash, label,
    inert[a].hash === inert[b].hash ? `identical, ${inert[a].hash.slice(0, 12)} - ${detail}`
      : `${inert[a].hash.slice(0, 12)} against ${inert[b].hash.slice(0, 12)}`);

  // What this row cannot see, said out loud rather than left to be discovered: a leak that
  // is the *same* everywhere - a rain of 0 multiplying every point by 1.02 rather than by 1
  // - moves both of these settings identically and they go on agreeing. That failure has a
  // home and it is section 1b, which is the only comparison in this file with a build
  // outside itself to be wrong against; measured, the leak reddens all five of its readings
  // at six frames of six. This row is for the half 1b cannot reach, which is the term
  // varying with the three lengths under it.
  pair('rainOffSlow', 'rainOffFast',
    'at a rain of 0 the speed, the gap and the trail reach no pixel, so a look with no rain '
    + 'in it draws what it always drew', 'the multiplier is not exactly one');
  moves('rainOnSlow', 'rainOnFast',
    'while raised, those same three lengths do move the picture', 'the lengths reach nothing at all');

  pair('glyphOffQuiet', 'glyphOffLoud',
    'at a glyph of 0 the three keys reach no pixel, so a look drawing no characters draws '
    + 'what it always drew', 'the crossfade is not exactly zero');
  moves('glyphOnQuiet', 'glyphOnLoud',
    'while raised, those same three keys do move the picture', 'the keys reach nothing at all');

  pair('flatFine', 'flatCoarse',
    'at a lattice of 0 the cell size reaches no pixel, so the eight shipped looks that never '
    + 'snap are untouched by the energy compensation', 'the compensation is not exactly one');
  moves('snappedFine', 'snappedCoarse',
    'while with the lattice raised the same two cell sizes do move it',
    'the cell size reaches nothing at all');
}

// ------------------------------------------------------------------- verdict

if (main.errors.length) {
  console.log(`\n[registry] page errors:\n  ${main.errors.join('\n  ')}`);
  failures++;
}

await browser.close();

if (MUTATE) {
  // Three outcomes, three exit codes, because two of them are routinely confused for
  // each other. `registration-check` reserves 2 for "the harness did not run" on the
  // same reasoning and this joins it rather than inventing a fourth convention: a
  // mutation that failed to compile, or a Playwright page that died, is not a mutation
  // that was caught, and the difference is invisible to anything reading exit codes
  // alone. The rows above are the answer - read which ones fired, not how many.
  const caught = failures > 0;
  console.log(`\n[registry] mutation ${MUTATE} ${caught
    ? `caught, as required (${failures} assertions fired)`
    : 'NOT CAUGHT'}`);
  console.log(`           it should redden: ${MUTATIONS[MUTATE].fails}`);
  process.exit(caught ? 0 : 1);
}

console.log(`\n[registry] ${failures ? `FAIL (${failures})` : 'PASS'}`);
process.exit(failures ? 1 : 0);
