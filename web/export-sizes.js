// Every output resolution the product offers, and which of them it opens on.
//
// A file of its own so that it stays one list. The menu, the ratio buttons, the project
// that restores a size and the export that renders one all read it from here, and the
// failure that rule is written against is recorded in the comment below - two lists,
// neither aware of the other, agreeing on nothing and both green.
//
// What a file buys over a `const` in the middle of `main.js` is that a node test can walk
// the whole table rather than the four sizes a sweep happens to visit: every dimension
// even because `yuv420p` cannot encode an odd one, and every size in a group actually the
// shape its label claims. That is an assertion over the population, and it is the shape
// this repo asks for - close the class, not the instance.
//
// Data and nothing else. There is no import here and nothing is constructed, so this
// module has no top-level side effect at all and its position in anybody's import list
// cannot change what the program does. The three functions below are arithmetic over the
// table and evaluate only when they are called, so that stays true of them too -
// `exportAspects()` deliberately walks the list per call rather than being a second array
// computed beside it, because a derived array is a second representation with the same
// name as the first and this file's whole argument is against those. `buildResolutionMenu`
// and `buildAspectSegments` stay in `main.js`, because they create elements in a document.

/**
 * Every size the export menu offers, grouped by the ratio it is.
 *
 * **This is the list, and the menu is built from it.** Step 6 recorded the failure
 * that makes that worth insisting on: `export-check` swept four sizes that were all
 * 1.6 while the menu offered four that were all 16:9, so a build referencing the
 * width instead of the height was bit-identical on every arm the tool had and drew
 * 11.1% too large on every size the product shipped. Two lists, neither aware of the
 * other. There is now one, and the check reads it off the page.
 *
 * **Ratios are exact, and dimensions are even.** `yuv420p` subsamples chroma by two
 * each way, so an odd dimension is not encodable and `server/export.js` refuses it
 * rather than letting ffmpeg fail after the first frame is already written. 65:24
 * only lands on both at once when the height is a multiple of 48, which is why its
 * widths are 2730 and 3900 rather than anything rounder - a menu entry labelled
 * 65:24 that is really 2.7062 would be a number this repo would find later and have
 * to correct.
 *
 * Both 4K flavours are here because they are different shapes: UHD is 3840x2160 and
 * 16:9, DCI is 4096x2160 and 1.896:1, and picking one would silently decide an
 * aspect for anybody who asked for "4K".
 */
const EXPORT_SIZES = [
  { ratio: '16:9', sizes: [[960, 540], [1280, 720], [1920, 1080], [3840, 2160]] },
  { ratio: '1.90:1 DCI', sizes: [[2048, 1080], [4096, 2160]] },
  { ratio: '4:3', sizes: [[1440, 1080], [2880, 2160]] },
  { ratio: '1:1', sizes: [[1080, 1080], [2160, 2160]] },
  { ratio: '65:24', sizes: [[2730, 1008], [3900, 1440]] },
];
const DEFAULT_EXPORT_SIZE = '1920x1080';

/**
 * A width and a height as the shape they are: the pair divided by its own divisor.
 *
 * **The pair rather than the label, because the label is not the number.** The project
 * document stores what it is letterboxed to, and the obvious thing to store is the
 * `ratio` string beside each group - except that "1.90:1 DCI" is really 1.8963, so a
 * document carrying that label would record a shape 0.2% away from the one the clip was
 * composed for, and the editor would reframe it on the next open. `2048x1080` reduces to
 * `[256, 135]` exactly, and every other group here reduces exactly too, so the pair is
 * lossless where a decimal label is a rounding this repo would find later and have to
 * correct.
 *
 * Reduced rather than kept as the size it came from, because two sizes of one shape have
 * to compare equal - 1920x1080 and 1280x720 are the same picture, which is the whole
 * reason resolution is a per-deliverable choice and shape is project state. Comparing
 * `[16, 9]` with `[16, 9]` is that equality written down; comparing the sizes is not.
 */
function reduceAspect(w, h) {
  let a = Math.abs(Math.trunc(w));
  let b = Math.abs(Math.trunc(h));
  while (b) [a, b] = [b, a % b];
  return a === 0 ? [0, 0] : [Math.trunc(w) / a, Math.trunc(h) / a];
}

/**
 * The distinct shapes the table offers, each with the label its group is written under.
 *
 * A group *is* a shape - every size in one reduces to the same pair, which is the claim
 * the group's label makes and the reason the pair is taken off the first size rather than
 * asserted here. A node test walking the whole table is where that claim is enforced,
 * because this file is data and a module that throws while it is being imported takes the
 * page down at boot rather than saying which row is wrong.
 */
function exportAspects() {
  return EXPORT_SIZES.map((group) => ({
    ratio: group.ratio,
    aspect: reduceAspect(group.sizes[0][0], group.sizes[0][1]),
  }));
}

/**
 * Every size in the table belonging to one shape, which is what the resolution menu is.
 *
 * **Empty is a real answer and the caller has to have one for it.** A project saved before
 * the shape moved onto the document carried an `outputSize` rather than an aspect, and
 * that size was free to be anything a hand had typed - so `1600x1000` reduces to `[8, 5]`,
 * a shape no group here offers, and there is nothing in this table to show for it. The
 * alternative was to manufacture a size at that ratio near 1080p, and this file refuses
 * to: a resolution the product does not offer, invented at load time and then written
 * into a deliverable, is exactly the second list the header is about.
 */
function sizesForAspect(aspect) {
  const [w, h] = aspect;
  const group = EXPORT_SIZES.find((g) => {
    const [gw, gh] = reduceAspect(g.sizes[0][0], g.sizes[0][1]);
    return gw === w && gh === h;
  });
  return group ? group.sizes.map(([sw, sh]) => [sw, sh]) : [];
}

export { EXPORT_SIZES, DEFAULT_EXPORT_SIZE, reduceAspect, exportAspects, sizesForAspect };
