// The glyph field's master and its three keys. The master is declared in both stages
// because it does two things that belong at two stages - it grows the sprite up there and
// it crossfades the mark here - and the three keys are here alone, because the character
// index is decided beside the colour it reads.
uniform float glyph, glyphTone, glyphHash, glyphRain;
