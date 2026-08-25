#!/usr/bin/env node
// The plugin contract, as an instrument: every installed effect, asked whether it is
// really absent when it is off.
//
// **One claim, of every package, and it is the claim the whole two-root design rests on.**
// A build with sixteen effects installed and every value at its default has to draw
// exactly what a build with none of them installed draws. If it does not, then installing
// an effect changes the look of every clip on the machine, a preset authored here stops
// meaning what it means anywhere else, and the sixteen shipped looks - all of which sit at
// the defaults of most of the sixteen packages - are quietly a different grade from the one
// they were graded as. Nothing in the assembler can hold that: a chunk is spliced whether
// or not anybody raised its master, so "inert at zero" is a property of the GLSL each
// package's author wrote and of nothing else.
//
// **Three renders per package, and the third is the one that costs something.**
//
//   1. **defaults** - every parameter of every package at its own default.
//   2. **the master held at zero, everything the manifest says it gates raised** - the keys
//      that declare themselves `under` the master pushed off their defaults while the term
//      the effect is absent at stays where it is. A leak shows here as a picture that moved
//      because a control under a switched-off effect was turned. `under` rather than "every
//      other parameter", because one shipped package has a second amplitude in its
//      namespace - `noise.region` - which the master does not gate and correctly does move
//      the picture on its own.
//   3. **the package gone** - its manifest served hollow, so it contributes no GLSL at
//      all, and the page rebuilt from that. This is what "absent" actually means, and it
//      is the arm the other two cannot replace: a term that leaks a constant is identical
//      under 1 and 2 and different under 3.
//
// All three must be the same image, byte for byte.
//
// **Every hash is taken inside one run and none is written down.** A committed hash is a
// claim about a rasteriser, a driver and a window size, and this suite already carries the
// case file for what that costs; what is compared here is three images this process just
// rendered on one GPU, which is a comparison that means the same thing on every machine.
//
// **The vacuity guard is what stops all of this passing on a dead effect.** An equality
// between three renders is satisfied perfectly by a package whose GLSL reaches no pixel
// under any value, so each package gets a fourth render with *its own* parameters raised,
// and that one has to differ. A package that cannot move the picture is reported as a
// failure rather than as three green rows.
//
// **The population comes off the store and is never named here.** `GET /effects` says what
// is installed, so a seventeenth package is asked these questions by existing - which is
// the whole point of a conformance check rather than a list of sixteen assertions.
//
//   node tools/effect-conformance-check.mjs --url http://localhost:8080
//   node tools/effect-conformance-check.mjs --url http://localhost:8080 --mutate leaks-at-zero  # must FAIL
//
// Needs a running server and a GPU browser. No capture, no sensor, no ffmpeg and no port
// of its own: the frames are planted and both interceptions - the hollowed manifest and the
// mutated chunk - are served, so nothing this tool does touches a byte on disk.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const URL_BASE = flag('--url', 'http://localhost:8080');
const MUTATE = argv.includes('--mutate') ? flag('--mutate') : null;

/**
 * The mutations, and this one is a defect rather than a switch.
 *
 * **`leaks-at-zero` is served rather than written**, which is a departure from every other
 * tool in the suite and is forced by what this one is. It runs `--url` against a server
 * somebody else started, so there is no staged tree to edit - and editing the checkout
 * would leave a mutated working tree behind any crash, which is the one state a proof tool
 * must never produce. So the mutation is a function over the text of one served chunk, and
 * the page compiles what the interception hands it.
 *
 * A function rather than a `{ file, edits }` table on purpose: `syntax-check`'s anchor row
 * recognises a function-shaped entry as one that redirects the oracle rather than anchoring
 * on source text, which is exactly what this is. What replaces the anchor check is a row in
 * the run itself - the tool asserts the served text actually changed, because a mutation
 * that does nothing reads as a check that found nothing.
 *
 * The rain is the target because its lift is a multiply by `1.0 + rain * rainLift`,
 * deliberately unconditional, so a floor under the master leaks into every frame the
 * package draws into.
 *
 * **Measured rather than reasoned about, and the reasoning was wrong.** This was aimed at
 * the rain expecting both the second and the third arm to see it, on the grounds that the
 * rain has three sub-keys shaping `rainLift`. Run, it reddens the third arm alone - and the
 * reason is the gate: `vRain` is computed inside the `cell` service under `rain > 0.0`, so
 * at a master of zero the varying sits at the `0.0` the prologue writes, `fract(0.0)` is
 * zero, and `smoothstep` returns zero whatever `rainTrail` and `rainSpan` are. The sub-keys
 * are genuinely dead at zero, which is the package being correct, and the arm that can see
 * a constant leak is the one that takes the package away. That is the whole argument for
 * having the third arm: a leak that both other arms agree about is invisible to them.
 */
const MUTATIONS = {
  'leaks-at-zero': (text, path) => (
    path.endsWith('/effects/rain/file/lift.frag.glsl')
      ? text.replace('col *= 1.0 + rain * rainLift;', 'col *= 1.0 + max(rain, 0.08) * rainLift;')
      : text
  ),
};

if (argv.includes('--mutate') && !MUTATIONS[MUTATE]) {
  console.log(`[conformance] DID NOT RUN - no mutation named ${MUTATE ?? '(nothing was given)'};`
    + ` this tool knows ${Object.keys(MUTATIONS).join(', ')}`);
  process.exit(2);
}

// --- harness -----------------------------------------------------------------
let checked = 0;
let failed = 0;
let crashed = null;
let untested = null;
// Which effect each failed row belongs to, because the whole claim of the method control
// is that a leak in one package reddens that package's rows and no other's - and a count
// cannot say that.
const firedFor = new Map();
const ok = (label, pass, detail = '', effect = null) => {
  checked++;
  if (!pass) {
    failed++;
    if (effect) firedFor.set(effect, [...(firedFor.get(effect) ?? []), label]);
  }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

const DEPTH_W = 512;
const DEPTH_H = 424;
const POSITIONS = [0.15, 0.7, 1.3];

/**
 * The frames every arm renders, planted here rather than taken off a capture.
 *
 * A leaning plane, so the picture has range in it: on a flat wall every depth-keyed term
 * writes the same value at every pixel, and a duotone or a thermal would move the whole
 * frame by one constant - which two builds can agree about for reasons that have nothing to
 * do with the term being read per point. The frames drift between each other so the three
 * program positions are three geometries rather than one restamped.
 */
const pinnedBuffer = () => {
  const FRAMES = 8;
  const depthBytes = DEPTH_W * DEPTH_H * 2;
  const out = Buffer.alloc(FRAMES * (16 + depthBytes));
  for (let f = 0; f < FRAMES; f++) {
    const at = f * (16 + depthBytes);
    out.writeUInt32LE(depthBytes, at);
    out.writeUInt32LE(0, at + 4);
    // 200ms apart, so the eight of them span 1.4 seconds and every position below sits
    // inside the run. A pinned source clamps past its last stamp, so positions beyond the
    // end are the same frame twice - which reads as three arms agreeing and is two of them
    // measuring one image.
    out.writeBigUInt64LE(BigInt(f * 200), at + 8);
    for (let y = 0; y < DEPTH_H; y++) {
      for (let x = 0; x < DEPTH_W; x++) {
        const mm = 1100 + Math.round((x / DEPTH_W) * 1400 + (y / DEPTH_H) * 700) + f * 60;
        out.writeUInt16LE(mm, at + 16 + (y * DEPTH_W + x) * 2);
      }
    }
  }
  return out;
};

/**
 * A colour image with structure in it, for the terms that key on one.
 *
 * `drive.pin` switches colour off, because a JPEG decode is asynchronous and a hash taken
 * across one would be a hash of whether it had landed yet - so the arms that need colour
 * get it planted instead. Half the shipped packages read `rgb`: the thermal takes its heat
 * off luminance, the edges and the duotone key on it, and a flat grey is the identity for
 * several of them at once, which would put four packages in a dead zone where the vacuity
 * guard would correctly report them as unable to move a pixel.
 */
const COLOR_W = 64;
const COLOR_H = 48;
const plantedColour = () => {
  const rgba = new Array(COLOR_W * COLOR_H * 4);
  for (let y = 0; y < COLOR_H; y++) {
    for (let x = 0; x < COLOR_W; x++) {
      const i = (y * COLOR_W + x) * 4;
      rgba[i] = (x * 4) % 256;
      rgba[i + 1] = (y * 5) % 256;
      rgba[i + 2] = ((x + y) * 3) % 256;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
};

/**
 * A value clearly off the default and inside the bounds, derived rather than tabulated.
 *
 * Three quarters of the way to whichever end is further from the default, which puts a
 * master that starts at 0 well up its range and a parameter that starts mid-range decisively
 * off centre. Not the bound itself: several of the shipped bounds are degenerate on purpose
 * - an angle at its wrap point, a mask fully open, a span at the whole clip range - and a
 * raise landing on one of those is a raise that can be inert for a reason about the bound
 * rather than about the parameter. The registry snaps whatever this returns onto the
 * parameter's own grid, so no rounding is done here.
 */
/**
 * A line of a package's own GLSL that nothing else in the build writes.
 *
 * The longest line of its chunks with the comments taken out, which for every shipped
 * package is a statement rather than a brace - long enough to be its own and short enough
 * to be one line. Used only to ask whether the package's text is in the assembled program,
 * so what matters is that it is present exactly when the package is and absent when it is
 * not; a package with no chunks at all has no such line, and its rows say so rather than
 * asserting against an empty string that every program contains.
 */
const markerOf = (pkg) => {
  const lines = Object.values(pkg.chunks ?? {}).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 16 && !l.startsWith('//'));
  return lines.sort((a, b) => b.length - a.length)[0] ?? null;
};

const raisedValue = (spec) => {
  if (typeof spec.default === 'boolean') return !spec.default;
  const far = (spec.default - spec.min) > (spec.max - spec.default) ? spec.min : spec.max;
  return spec.default + (far - spec.default) * 0.75;
};

console.log(`[conformance] ${MUTATE ? `MUTATED: ${MUTATE} (served, not written)` : 'unmutated tree'}`);
console.log(`[conformance] against ${URL_BASE}\n`);

let browser = null;
// Which package `/effects/:id` is currently answering hollow for, and the body it answers
// with. Module state rather than a closure argument, because the one route handler
// installed below outlives every package it serves.
let hollowFor = null;
let hollowBody = null;
try {
  let chromium;
  try {
    ({ chromium } = await import(join(REPO, 'node_modules/playwright/index.mjs')));
  } catch {
    untested = 'playwright is not installed, and every claim here is about a rendered frame';
    throw new Error(untested);
  }

  // The population, off the store. Fetched here rather than read off the page, because the
  // question below is whether the page is assembled from what the server holds - and a
  // list taken from the page would be the page agreeing with itself.
  const listed = await fetch(`${URL_BASE}/effects`);
  if (!listed.ok) throw new Error(`GET /effects answered ${listed.status} - there is no population to check`);
  const { effects } = await listed.json();
  const packages = [];
  for (const { id } of effects) {
    const res = await fetch(`${URL_BASE}/effects/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`GET /effects/${id} answered ${res.status}`);
    const pkg = await res.json();
    // The chunk text as well as the manifest, because the marker below is a line of the
    // package's own GLSL and the manifest names the files rather than carrying them.
    pkg.chunks = {};
    for (const name of [...new Set((pkg.manifest.chunks ?? []).map((c) => c.file))]) {
      const chunk = await fetch(`${URL_BASE}/effects/${encodeURIComponent(id)}/file/${encodeURIComponent(name)}`);
      if (!chunk.ok) throw new Error(`GET /effects/${id}/file/${name} answered ${chunk.status}`);
      pkg.chunks[name] = await chunk.text();
    }
    packages.push(pkg);
  }

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  // No socket, so nothing overwrites the planted frames: a live sensor wipes a plant in
  // well under a second, and every arm here is a hash of a planted geometry.
  await page.routeWebSocket(/.*/, () => {});

  // The mutation, served. Every chunk fetch goes through here whatever the mutation is, so
  // the unmutated path and the mutated one differ in one function call rather than in
  // whether an interception is installed at all.
  let mutatedText = 0;
  await page.route((url) => /\/effects\/[^/]+\/file\//.test(url.pathname), async (route) => {
    const res = await route.fetch();
    const text = await res.text();
    const next = MUTATE ? MUTATIONS[MUTATE](text, route.request().url()) : text;
    if (next !== text) mutatedText++;
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: next });
  });

  // **One handler over `/effects/:id`, consulting a variable.** Which package is served
  // hollow changes sixteen times in a run and the interception does not: a route added and
  // removed per package cannot be removed at all, because `page.unroute` matches the
  // matcher by reference and every call would hand it a fresh arrow.
  await page.route((url) => /^\/effects\/[a-z][a-z0-9]*$/.test(url.pathname), async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[2];
    if (id !== hollowFor) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: hollowBody });
  });

  await page.goto(`${URL_BASE}/record`, { waitUntil: 'load' });
  await page.waitForFunction('Boolean(globalThis.__kinect)', null, { timeout: 20000 });

  /** All four assembled shader strings, as one, for the marker rows. */
  const assembled = () => page.evaluate(() => {
    const p = globalThis.__kinect.effects.programs();
    return `${p.cloud.vertexShader}${p.cloud.fragmentShader}${p.grade.vertexShader}${p.grade.fragmentShader}`;
  });

  if (MUTATE) {
    // **Before believing a mutation was missed, confirm it did something.** A served
    // mutation whose target text has moved changes nothing at all, and a run of it would
    // report the check as having found nothing when what happened is that nothing was
    // done to it.
    ok(`the ${MUTATE} mutation reached the text it is about`, mutatedText > 0,
      `${mutatedText} served chunk${mutatedText === 1 ? '' : 's'} rewritten`);
  }

  const buffer = pinnedBuffer();
  await page.route('**/__conformance-pinned.bin', (route) => route.fulfill({
    status: 200, contentType: 'application/octet-stream', body: buffer,
  }));
  await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; });
  await page.evaluate(async () => {
    const res = await fetch('/__conformance-pinned.bin');
    globalThis.__kinect.drive.pin(await res.arrayBuffer());
  });
  await page.evaluate(({ rgba, w, h }) => globalThis.__kinect.drive.plantColor(rgba, w, h),
    { rgba: plantedColour(), w: COLOR_W, h: COLOR_H });

  /**
   * One render of one look, hashed at three program positions.
   *
   * The camera is written every time rather than once, because the arms that drop a
   * package rebuild the whole page in between and a pose left to persist is a pose one arm
   * could be measuring a different value of. `drive.reset` rewinds the pinned source and
   * clears both accumulators, so each arm starts from the state a page that had just
   * booted is in - which is what makes three renders taken minutes apart comparable at all.
   */
  const renderLook = (values, positions) => page.evaluate(async ({ v, ts }) => {
    const k = globalThis.__kinect;
    const sha256 = async (bytes) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    k.params.reset();
    if (Object.keys(v).length) k.params.apply(v);
    k.drive.reset();
    k.freeCamera.position.set(0, 0.1, 1.6);
    k.freeCamera.lookAt(0, 0, -2.2);
    k.freeCamera.updateMatrixWorld(true);
    const hashes = [];
    for (const t of ts) {
      k.drive.stepTo(t);
      hashes.push(await sha256(k.drive.readPixels()));
    }
    // **What the registry actually stored, handed back with the hashes.** An arm that
    // asked for a raise and got a clamp, a snap or a refusal renders the defaults and
    // looks exactly like an effect that cannot move a pixel - which is a vacuity row
    // firing about the tool rather than about the build. The caller compares against what
    // it asked for, so the two cases are told apart at the point they differ.
    return { hashes, stored: Object.fromEntries(Object.keys(v).map((n) => [n, k.params.get(n)])) };
  }, { v: values, ts: positions });

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const brief = (hs) => hs.map((h) => h.slice(0, 8)).join(' ');

  // ---- the reference: every package installed, every value at its own default
  const { hashes: defaults } = await renderLook({}, POSITIONS);
  ok('the defaults render, and the three positions are three different images',
    new Set(defaults).size === POSITIONS.length, brief(defaults));

  // What the page says each parameter's bounds are, so the raise is derived from the
  // registry the build actually holds rather than from the manifests read above. The two
  // agree by construction; asking the page is what makes a raise land inside the bounds
  // the page will clamp it to.
  const specs = await page.evaluate(() => Object.fromEntries(
    globalThis.__kinect.params.names('look').map((n) => [n, globalThis.__kinect.params.spec(n)]),
  ));

  console.log('');
  const raiseless = [];
  const vacuous = [];
  for (const pkg of packages) {
    const id = pkg.id;
    const own = Object.keys(pkg.manifest.params).map((short) => `${id}.${short}`);
    const masterShort = Object.entries(pkg.manifest.params).find(([, s]) => s.role === 'master')?.[0];
    const master = masterShort ? `${id}.${masterShort}` : null;
    const known = own.filter((n) => specs[n]);
    if (known.length !== own.length) {
      ok(`${id}: every parameter it declares is in this build's registry`, false,
        `${known.length} of ${own.length}: ${own.filter((n) => !specs[n]).join(', ')}`, id);
      continue;
    }

    const mark = markerOf(pkg);

    // ---- arm 2: the master where it is absent, everything under it raised
    //
    // **Only the keys the manifest says the master gates**, which is `under` and is a field
    // the packages already carry. Raising every non-master parameter was the obvious rule
    // and it is wrong about one shipped package: `noise.region` declares no `under`, because
    // it is a second amplitude in the same namespace - the region's scramble, which reuses
    // the turbulence field's scale and speed and is gated by itself rather than by
    // `noise.amount`. Raising it under a master at zero moves the picture correctly, and a
    // rule that did not read `under` would report that as the noise package leaking.
    //
    // The parameters that are neither the master nor under it are named in the row's own
    // detail rather than quietly skipped, because a deliberate exclusion that nobody can
    // see is the shape this repo has three holes filed under.
    const under = known.filter((n) => pkg.manifest.params[n.split('.').slice(1).join('.')].under === masterShort);
    const ungated = known.filter((n) => n !== master && !under.includes(n));
    const held = Object.fromEntries(under.map((n) => [n, raisedValue(specs[n])]));
    for (const n of [...(master ? [master] : []), ...ungated]) held[n] = specs[n].default;
    const { hashes: atZero } = await renderLook(held, POSITIONS);
    if (under.length === 0) raiseless.push(id);
    ok(`${id} at its inert master draws exactly what the defaults draw`
      + `${under.length === 0 ? ' (nothing declares itself under the master, so this arm is the defaults arm)' : ` (${under.length} key${under.length === 1 ? '' : 's'} raised under it)`}`,
    same(atZero, defaults), `${same(atZero, defaults) ? brief(defaults) : `${brief(atZero)} against ${brief(defaults)}`}`
      + `${ungated.length ? ` - held at its default beside the master: ${ungated.join(', ')}` : ''}`, id);

    // ---- arm 3: the package not there at all
    //
    // **Served hollow rather than dropped from the list**, and the difference is the
    // difference between measuring absence and measuring a page that will not boot. The
    // client's declaration order places every shipped parameter by name, so a package
    // missing from the list is a registry that cannot assemble - and the glyph field reads
    // the rain's varying, so a rain with no varying is a program that will not compile.
    // What "absent" means for a shader is that the package contributes no GLSL: the chunks
    // go, the services it consumes go with them so nothing widens a gate around an empty
    // block, and the parameters and varyings stay - the parameters so the registry still
    // assembles, the varyings so a reader in another package still has its channel, pinned
    // at the inert value the prologue writes, which is what a build without this package
    // would see there anyway.
    //
    // **The interception is one handler consulting a variable rather than a route added and
    // removed per package**, and that is a bug this tool shipped for exactly one run.
    // `page.unroute` matches the matcher it is given by reference, so a fresh arrow removes
    // nothing - every package dropped stayed dropped, and by the end the raise arm was
    // asking a hollowed package to move a picture. It reads as eleven effects that cannot
    // reach a pixel, which is a finding-shaped output from an instrument that had quietly
    // stopped putting anything back. The marker rows below are what makes that visible now.
    hollowFor = id;
    hollowBody = JSON.stringify({ ...pkg, manifest: { ...pkg.manifest, chunks: [], consumes: [] } });
    const rebuilt = await page.evaluate(async () => {
      try {
        await globalThis.__kinect.effects.reload();
        return null;
      } catch (err) { return String(err.message); }
    });
    let dropped = null;
    let goneWhileHollow = null;
    if (rebuilt === null) {
      goneWhileHollow = mark ? !(await assembled()).includes(mark) : null;
      dropped = (await renderLook({}, POSITIONS)).hashes;
    }
    hollowFor = null;
    const back = await page.evaluate(async () => {
      try {
        await globalThis.__kinect.effects.reload();
        return null;
      } catch (err) { return String(err.message); }
    });
    const backWhileWhole = mark && back === null ? (await assembled()).includes(mark) : null;

    ok(`${id} can be taken out of the served set and put back, so the arm above is about a rebuild rather than a refusal`,
      rebuilt === null && back === null, [rebuilt, back].filter(Boolean).join(' | ') || 'both rebuilds ran', id);
    // **Assert against the program, not against the interception.** A route that did not
    // fire, a hollowing that did not hollow and an unroute that did not restore all render
    // a picture equal to the defaults, which is the answer this arm is looking for - so the
    // arm on its own cannot tell a package that is genuinely absent from a package that
    // never left. The marker is the package's own longest line of GLSL, which is in the
    // assembled program when it is installed and is not when it is not.
    if (mark) {
      ok(`${id}'s own text really does leave the assembled program while it is hollow, and comes back after`,
        goneWhileHollow === true && backWhileWhole === true,
        `while hollow: ${goneWhileHollow === true ? 'gone' : 'still there'}; after: ${backWhileWhole === true ? 'back' : 'missing'}`, id);
    }
    if (dropped) {
      ok(`${id} contributing no GLSL at all draws exactly what the defaults draw`,
        same(dropped, defaults), same(dropped, defaults) ? brief(defaults) : `${brief(dropped)} against ${brief(defaults)}`, id);
    }

    // ---- the guard: raise everything it owns, and the picture has to move
    const raised = Object.fromEntries(known.map((n) => [n, raisedValue(specs[n])]));
    const { hashes: loud, stored } = await renderLook(raised, POSITIONS);
    // **The raise has to have landed before its picture means anything.** A value the
    // registry clamped, snapped away or refused renders the defaults, and a vacuity row
    // reading only the picture would report that as an effect that cannot move a pixel.
    const short = Object.keys(raised).filter((n) => Math.abs(stored[n] - raised[n]) > (specs[n].step ?? 0) + 1e-9);
    ok(`${id}'s raise reaches the registry, so the row under it is about the effect rather than about the raise`,
      short.length === 0,
      short.length ? short.map((n) => `${n} asked ${raised[n]} and holds ${stored[n]}`).join('; ')
        : Object.entries(stored).map(([n, x]) => `${n.split('.')[1]}=${x}`).join(' '), id);
    const moves = !same(loud, defaults);
    if (!moves) vacuous.push(id);
    ok(`${id} raised off its defaults moves the picture, so the three equalities above are not about a dead effect`,
      moves, moves ? `${brief(loud)} against ${brief(defaults)}` : `${brief(loud)} - identical to the defaults`, id);
  }

  const { hashes: restored } = await renderLook({}, POSITIONS);
  ok('and after every drop and restore the defaults still render what they rendered at the start',
    same(restored, defaults), same(restored, defaults) ? brief(defaults) : `${brief(restored)} against ${brief(defaults)}`);

  console.log('');
  if (raiseless.length) {
    console.log(`[conformance] ${raiseless.length} package${raiseless.length === 1 ? ' has' : 's have'} no sub-key, `
      + `so their inert-master arm is the defaults arm and only the drop arm can see a leak: ${raiseless.join(', ')}`);
  }
  if (vacuous.length) {
    console.log(`[conformance] ${vacuous.length} package${vacuous.length === 1 ? '' : 's'} could not move a pixel from `
      + `this fixture, so their equalities prove nothing: ${vacuous.join(', ')}`);
  }

  ok('the page reported no error through any of it', pageErrors.length === 0,
    pageErrors.slice(0, 2).join(' | '));
} catch (err) {
  crashed = err;
  console.log(`\n  FAIL  the run did not finish: ${err.stack ?? err.message}`);
} finally {
  if (browser) await browser.close().catch(() => {});
}

console.log(`\n[conformance] ${checked} assertions, ${failed} failed`);
if (untested) {
  console.log(`[conformance] UNTESTED - ${untested}.`);
  process.exit(2);
}
// The count decides before the crash does, for the reason `tools/effect-check.mjs` sets
// out at the same place: a mutation that half-breaks a page takes the driver down with it,
// and reporting DID NOT RUN over rows that had already fired is a caught mutation recorded
// as a run that proved nothing.
if (MUTATE && failed > 0) {
  console.log(`[conformance] caught, as required (${failed} assertion${failed === 1 ? '' : 's'} fired)`);
  if (crashed) console.log(`[conformance] and the run ended early: ${crashed.message.split('\n')[0]} - the count is a floor`);
  for (const [effect, rows] of firedFor) console.log(`[conformance] ${effect}: ${rows.join(' | ')}`);
  console.log(`[conformance] effects with a red row: ${[...firedFor.keys()].join(', ') || 'none'}`);
  process.exit(1);
}
if (crashed) {
  console.log(`[conformance] DID NOT RUN - ${crashed.message.split('\n')[0]}. Nothing here is a finding: re-run it.`);
  process.exit(2);
}
if (MUTATE) {
  console.log('[conformance] NOT CAUGHT - the check passed a build it should have rejected');
  process.exit(1);
}
if (failed) {
  for (const [effect, rows] of firedFor) console.log(`[conformance] ${effect}: ${rows.join(' | ')}`);
  console.log('[conformance] FAIL');
  process.exit(1);
}
console.log('[conformance] PASS');
process.exit(0);
