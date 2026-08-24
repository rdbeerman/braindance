// The two programs the point cloud compiles, assembled out of a core spine and whatever
// effect packages are installed.
//
// **Assembly is concatenation and nothing else.** A chunk's text is spliced between two
// verbatim segments exactly as it arrived - not re-indented, not substituted into, not
// wrapped - because the property this whole split rests on is that the shipped set
// assembles to the two literals the file used to hold, byte for byte, and every
// transformation on the way is a byte that can move. `test/shader-assembly.test.mjs`
// holds that equality against the last revision carrying the monolith and refuses a
// single flipped byte in any chunk, which is what makes "verbatim" a measurement rather
// than an intention.
//
// **Nothing is imported here and nothing may be.** The spine is data handed in and the
// packages are data handed in, so this module is a pure function of its two arguments -
// which is what lets the gate evaluate it under bare node beside a `git show` of the old
// file, with no page and no server standing around it. The same argument
// `web/effect-manifests.js` makes about the registry's conversion: one statement of it,
// used by the live page and by the test, because a test with its own copy of the
// assembler would be a second assembler agreeing with itself.
//
// The four kinds of joint a spine can hold, and each is a different question:
//
//   - a **stage** takes any number of chunks, concatenated in the order they declare.
//     Declaration blocks and helper tables are stages: two packages both adding uniforms
//     is the ordinary case, not a conflict.
//   - a **slot** takes at most one chunk and carries the text to use when nothing claims
//     it. A slot is a *replacement* - the glyph field's point-size branch stands where
//     the old clamp line stood - so two claimants is a refusal rather than a
//     concatenation nobody could read.
//   - a **service** is a gate the spine opens and the packages fill: the condition is
//     generated from the `when` of every package consuming it, joined with `||` in
//     `gateOrder`, and the body is the spine's own prologue followed by each consumer's
//     chunk in the same order. With no consumers the whole block disappears, which is
//     the point - a build with neither glyph nor rain installed must not pay a mat3
//     multiply and two hashes per point for a cell nothing reads.
//   - a **varying declaration** is generated from the packages' `varyings` entries, in
//     three places out of one declaration: the vertex `out`, the fragment `in`, and the
//     line in the prologue that gives it its inert value above the early returns. One
//     statement rather than three, because an `out` with no `in` is a link error and an
//     `in` with no prologue write is undefined-register roulette on every shed point -
//     and a package declaring the three separately could get any pair of them out of
//     step.
//
// Every refusal below names the silent failure it is standing in front of. A chunk
// naming a joint that is not there would otherwise assemble into nothing at all: the
// page boots, the shader compiles, and the effect is simply absent with no error
// anywhere - which is the exact shape this repo keeps case files about.

const byOrder = (a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Every joint the spine holds, by kind.
 *
 * Collected before any package is read so a chunk can be refused against the spine
 * rather than against whatever happens to be in the map by the time it is reached, and
 * a name declared twice is refused here: two joints sharing a name would take one
 * package's chunk to two places in the program, which compiles and draws twice.
 */
const jointsOf = (spine) => {
  const stages = new Set();
  const slots = new Map();
  const services = new Set();
  const claim = (name, where) => {
    if (stages.has(name) || slots.has(name) || services.has(name)) {
      throw new Error(`the shader spine declares ${JSON.stringify(name)} twice, so a chunk naming it would be spliced in two places`);
    }
    if (where === 'stage') stages.add(name);
    if (where === 'service') services.add(name);
  };
  for (const program of [spine.vertex, spine.fragment]) {
    for (const entry of program) {
      if (entry.stage !== undefined) claim(entry.stage, 'stage');
      else if (entry.service !== undefined) claim(entry.service, 'service');
      else if (entry.slot !== undefined) {
        claim(entry.slot, 'slot');
        slots.set(entry.slot, entry);
      }
    }
  }
  return { stages, slots, services };
};

/**
 * One package's chunk text, or a refusal naming what was not fetched.
 *
 * The manifest lists the files and the caller fetches them, so a chunk the manifest
 * names and the caller did not bring is a package half-loaded - and half-loaded
 * assembles to a program missing one block, which compiles as often as not.
 */
const chunkText = (pkg, file) => {
  const text = pkg.chunks?.[file];
  if (typeof text !== 'string') {
    throw new Error(`effect ${pkg.id} declares the chunk ${JSON.stringify(file)} and its text was not loaded - `
      + 'a package assembled without one of its chunks is a program with a block missing');
  }
  return text;
};

/**
 * The two programs, as source text, from a spine and the installed packages.
 *
 * `packages` are the objects `/effects/:id` answers with, each carrying its `manifest`
 * and a `chunks` map of file name to text. A package with no `chunks` section in its
 * manifest contributes nothing and is not an error: most of the sixteen shipped effects
 * are parameters over code the spine already holds.
 */
export function assembleShaders(spine, packages) {
  const joints = jointsOf(spine);
  const stages = new Map([...joints.stages].map((name) => [name, []]));
  const slots = new Map();
  const services = new Map([...joints.services].map((name) => [name, []]));
  const varyings = [];
  const declared = new Set();

  for (const pkg of packages) {
    const manifest = pkg.manifest ?? {};
    const consumes = new Map();
    for (const c of manifest.consumes ?? []) {
      if (!joints.services.has(c.service)) {
        throw new Error(`effect ${pkg.id} consumes the service ${JSON.stringify(c.service)}, which this shader spine does not offer`);
      }
      if (typeof c.when !== 'string' || c.when.length === 0) {
        throw new Error(`effect ${pkg.id} consumes ${c.service} without a \`when\`, so nothing would open the gate it needs`);
      }
      if (!Number.isFinite(c.gateOrder)) {
        throw new Error(`effect ${pkg.id} consumes ${c.service} without a numeric \`gateOrder\`, and where its term sits in the condition decides the text`);
      }
      if (consumes.has(c.service)) {
        throw new Error(`effect ${pkg.id} consumes ${c.service} twice, and one package gets one term in a gate`);
      }
      consumes.set(c.service, c);
    }

    for (const v of manifest.varyings ?? []) {
      if (declared.has(v.name)) {
        throw new Error(`${v.name} is declared by two effects - a varying is one channel, and two packages writing it would be two effects sharing one register`);
      }
      declared.add(v.name);
      varyings.push({ ...v, id: pkg.id });
    }

    const filled = new Set();
    for (const c of manifest.chunks ?? []) {
      const text = chunkText(pkg, c.file);
      if (c.slot !== undefined) {
        if (!joints.slots.has(c.slot)) {
          throw new Error(`effect ${pkg.id}'s ${c.file} claims the slot ${JSON.stringify(c.slot)}, which this shader spine does not hold`);
        }
        const held = slots.get(c.slot);
        if (held) {
          throw new Error(`${held.id} and ${pkg.id} both claim the slot ${c.slot} - a slot is a replacement, so two claimants is two programs`);
        }
        slots.set(c.slot, { id: pkg.id, text });
        continue;
      }
      if (c.stage === undefined) {
        throw new Error(`effect ${pkg.id}'s ${c.file} names neither a stage nor a slot, so nothing decides where it goes`);
      }
      // A chunk on a service stage takes its place from the `consumes` entry rather than
      // from an `order` of its own: the term in the gate and the block inside it are one
      // placement, and two numbers for one fact is the drift this design keeps refusing.
      if (joints.services.has(c.stage)) {
        const consumed = consumes.get(c.stage);
        if (!consumed) {
          throw new Error(`effect ${pkg.id}'s ${c.file} fills the ${c.stage} service without consuming it, so nothing would open the gate around it`);
        }
        if (c.order !== undefined) {
          throw new Error(`effect ${pkg.id}'s ${c.file} carries an \`order\` as well as ${c.stage}'s \`gateOrder\` - the gate term and the block it opens are one placement`);
        }
        if (filled.has(c.stage)) {
          throw new Error(`effect ${pkg.id} fills the ${c.stage} service twice, and one consumer gets one block`);
        }
        filled.add(c.stage);
        services.get(c.stage).push({ id: pkg.id, order: consumed.gateOrder, when: consumed.when, text });
        continue;
      }
      if (!joints.stages.has(c.stage)) {
        throw new Error(`effect ${pkg.id}'s ${c.file} names the stage ${JSON.stringify(c.stage)}, which this shader spine does not hold`);
      }
      if (!Number.isFinite(c.order)) {
        throw new Error(`effect ${pkg.id}'s ${c.file} joins ${c.stage} without a numeric \`order\`, and a stage's text is its chunks in order`);
      }
      stages.get(c.stage).push({ id: pkg.id, order: c.order, text });
    }

    for (const service of consumes.keys()) {
      if (!filled.has(service)) {
        throw new Error(`effect ${pkg.id} consumes ${service} and brings no chunk for it, so it would widen the gate and put nothing inside it`);
      }
    }
  }

  for (const list of stages.values()) list.sort(byOrder);
  for (const list of services.values()) list.sort(byOrder);
  varyings.sort(byOrder);

  const emit = (program) => {
    let out = '';
    for (const entry of program) {
      if (entry.text !== undefined) out += entry.text;
      else if (entry.varyings === 'out') out += varyings.map((v) => `out ${v.type} ${v.name};\n`).join('');
      else if (entry.varyings === 'in') out += varyings.map((v) => `in ${v.type} ${v.name};\n`).join('');
      else if (entry.varyings === 'init') out += varyings.map((v) => `  ${v.name} = ${v.init};\n`).join('');
      else if (entry.stage !== undefined) out += stages.get(entry.stage).map((c) => c.text).join('');
      else if (entry.slot !== undefined) out += (slots.get(entry.slot)?.text ?? entry.fallback);
      else if (entry.service !== undefined) {
        const consumers = services.get(entry.service);
        if (consumers.length === 0) continue;
        out += `${entry.indent}if (${consumers.map((c) => c.when).join(' || ')}) {\n`;
        out += entry.body;
        out += consumers.map((c) => c.text).join('');
        out += `${entry.indent}}\n`;
      } else {
        throw new Error(`the shader spine holds an entry of no kind this assembler knows: ${JSON.stringify(Object.keys(entry))}`);
      }
    }
    return out;
  };

  return { vertexShader: emit(spine.vertex), fragmentShader: emit(spine.fragment) };
}
