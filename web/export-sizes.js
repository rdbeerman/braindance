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
// cannot change what the program does. `buildExportMenu` and `buildExportRatios` stay in
// `main.js`, because they create elements in a document.

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

export { EXPORT_SIZES, DEFAULT_EXPORT_SIZE };
