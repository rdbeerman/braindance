// The core of the mosh pass, and the joints the installed effects are spliced into.
//
// The same shape as `web/grade-shader.js` and for the same reasons: source text in ordered
// segments, nothing imported, nothing interpolated, so `test/shader-assembly.test.mjs` can
// assemble it under bare node with no page and no GPU. Every `uniform` in the assembled program
// needs a key in `MOSH_UNIFORMS` in `web/post-chain.js`, which `test/cloud-shader.test.mjs` asks
// of the assembled text rather than of this file.
//
// **What makes this spine different from the other two is that it reads the frame it drew last
// time.** `tOld` is the pass's own previous output and `tNew` is what the chain handed it, so a
// chunk here can hold pixels back rather than only transform the ones in front of it. That is the
// whole reason the pass exists, and it is also the reason the spine owns the refresh below.

const frozen = (entries) => Object.freeze(entries.map((e) => Object.freeze(e)));

export const moshSpine = Object.freeze({
  // No joints, for the reason the grade's vertex stage gives: a full-screen pass draws one quad
  // and every term is a function of where its fragments land.
  vertex: frozen([
    { text: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  ` },
  ]),
  fragment: frozen([
    { text: /* glsl */ `
    uniform sampler2D tNew, tOld;
    uniform vec2 resolution;
    uniform float time, moshIFrame;
` },
    // The terms an effect declares for this pass.
    { stage: 'm.decl' },
    { text: /* glsl */ `\
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      // The same 1080p reference the other two programs use, so a distance measured here is
      // the same distance at any output size. \`ref\` is the frame in reference pixels and
      // \`texel\` is one of them in uv.
      float k = resolution.y / 1080.0;
      vec2 ref = resolution / k;
      vec2 texel = 1.0 / ref;
      vec3 fresh = texture2D(tNew, vUv).rgb;
      vec3 col = fresh;

      // The refresh, which is this spine's own and not a chunk's: on an I-frame the pass is the
      // frame it was handed, exactly, and every chunk below is skipped. The host raises it when
      // the bounding term says this much program time has gone by since the last one, and on the
      // first frame after a reset, where the history is black and a chunk reading it would draw
      // black. It is what makes a seek reproduce a playback - a pre-roll starts at the last
      // refresh and decodes forward, which is what seeking to a keyframe is.
      if (moshIFrame < 0.5) {
` },
    // Everything a mosh package does, inside the refresh gate and in the order the pass runs
    // them. A stage rather than a slot because these compose: each takes the colour the one
    // above produced.
    { stage: 'm.body' },
    { text: /* glsl */ `\
      }

      gl_FragColor = vec4(col, 1.0);
    }
  ` },
  ]),
});
