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
