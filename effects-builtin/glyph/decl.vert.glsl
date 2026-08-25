// The glyph field's master, which this stage needs for one thing only - growing the
// sprite into the cell the lattice already cut. Which character gets drawn is decided in
// the fragment stage, because it keys on a luminance that does not exist until the colour
// is built, so the other three weights are declared there and not here.
uniform float glyph;
