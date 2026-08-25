// The alphabet: sixty-four 8x8 bitmasks, sorted by ink so the tone key reads the index as a
// luminance ramp while the hash and rain keys read the same table as noise. x holds rows 0-3
// and y rows 4-7, row 0 at the top, bit at row * 8 + col. Column 7 and row 7 are clear in
// every one of them, which is where the margin between neighbouring cells comes from.
const uvec2 GLYPHS[64] = uvec2[64](
  uvec2(0x00080800u, 0x00000000u), // '  apostrophe  ink 2
  uvec2(0x00000000u, 0x000c0c00u), // .  period  ink 4
  uvec2(0x00141400u, 0x00000000u), // "  quote  ink 4
  uvec2(0x04081000u, 0x00001008u), // <  less-than  ink 5
  uvec2(0x10080400u, 0x00000408u), // >  greater-than  ink 5
  uvec2(0x3e000000u, 0x00000000u), // -  hyphen  ink 5
  uvec2(0x00000000u, 0x00060c0cu), // ,  comma  ink 6
  uvec2(0x00000000u, 0x007f0000u), // _  underscore  ink 7
  uvec2(0x08040201u, 0x00402010u), //   backslash  ink 7
  uvec2(0x08080808u, 0x00080808u), // |  vertical bar  ink 7
  uvec2(0x08102040u, 0x00010204u), // /  slash  ink 7
  uvec2(0x10204300u, 0x00000408u), // ン  katakana N  ink 7
  uvec2(0x000c0c00u, 0x00000c0cu), // :  colon  ink 8
  uvec2(0x0c081020u, 0x0008080au), // イ  katakana I  ink 9
  uvec2(0x10204442u, 0x00020408u), // ソ  katakana SO  ink 9
  uvec2(0x3e080800u, 0x00000808u), // +  plus  ink 9
  uvec2(0x000c0c00u, 0x00060c0cu), // ;  semicolon  ink 10
  uvec2(0x003e0000u, 0x0000003eu), // =  equals  ink 10
  uvec2(0x08080c08u, 0x001c0808u), // 1  digit one  ink 10
  uvec2(0x10204a0au, 0x00020408u), // ツ  katakana TSU  ink 10
  uvec2(0x14240404u, 0x0004040cu), // ト  katakana TO  ink 10
  uvec2(0x23400300u, 0x00060810u), // シ  katakana SHI  ink 10
  uvec2(0x003c0000u, 0x00007f00u), // ニ  katakana NI  ink 11
  uvec2(0x02020202u, 0x003e0202u), // L  latin L  ink 11
  uvec2(0x0808081cu, 0x001c0808u), // I  latin I  ink 11
  uvec2(0x0808083eu, 0x00080808u), // T  latin T  ink 11
  uvec2(0x0810203eu, 0x00040404u), // 7  digit seven  ink 11
  uvec2(0x1c2a0800u, 0x0000082au), // *  asterisk  ink 11
  uvec2(0x10107f00u, 0x00081010u), // ナ  katakana NA  ink 12
  uvec2(0x1020223eu, 0x00020408u), // ク  katakana KU  ink 12
  uvec2(0x2020407eu, 0x00040810u), // フ  katakana FU  ink 12
  uvec2(0x22222222u, 0x000c1020u), // リ  katakana RI  ink 12
  uvec2(0x22420202u, 0x00060a12u), // レ  katakana RE  ink 12
  uvec2(0x44242800u, 0x00414242u), // ハ  katakana HA  ink 12
  uvec2(0x0202221cu, 0x001c2202u), // C  latin C  ink 13
  uvec2(0x2040427eu, 0x00040810u), // ワ  katakana WA  ink 13
  uvec2(0x20427e08u, 0x00040810u), // ウ  katakana U  ink 13
  uvec2(0x040c1424u, 0x007c0404u), // ヒ  katakana HI  ink 14
  uvec2(0x0c08103eu, 0x00402112u), // ス  katakana SU  ink 14
  uvec2(0x1020221cu, 0x003e0408u), // 2  digit two  ink 14
  uvec2(0x1810201eu, 0x001c2220u), // 3  digit three  ink 14
  uvec2(0x1e02023eu, 0x00020202u), // F  latin F  ink 14
  uvec2(0x20203e00u, 0x003e2020u), // コ  katakana KO  ink 14
  uvec2(0x24247e00u, 0x00020c10u), // ア  katakana A  ink 14
  uvec2(0x2c20223eu, 0x00040810u), // タ  katakana TA  ink 14
  uvec2(0x0810203eu, 0x003e0204u), // Z  latin Z  ink 15
  uvec2(0x087f003cu, 0x00040808u), // テ  katakana TE  ink 15
  uvec2(0x0e10207fu, 0x00101008u), // マ  katakana MA  ink 15
  uvec2(0x107f1212u, 0x00081010u), // サ  katakana SA  ink 15
  uvec2(0x22242424u, 0x00612122u), // ル  katakana RU  ink 15
  uvec2(0x22242830u, 0x0020203eu), // 4  digit four  ink 15
  uvec2(0x08083e00u, 0x007f0808u), // エ  katakana E  ink 16
  uvec2(0x207f003cu, 0x00060810u), // ラ  katakana RA  ink 16
  uvec2(0x2222221cu, 0x001c2222u), // 0  digit zero  ink 16
  uvec2(0x201e023eu, 0x001c2220u), // 5  digit five  ink 17
  uvec2(0x3c22221cu, 0x001c2220u), // 9  digit nine  ink 17
  uvec2(0x4244447cu, 0x00011922u), // カ  katakana KA  ink 17
  uvec2(0x18107f10u, 0x00191214u), // オ  katakana O  ink 18
  uvec2(0x1e02023eu, 0x003e0202u), // E  latin E  ink 18
  uvec2(0x2a2a3622u, 0x00222222u), // M  latin M  ink 18
  uvec2(0x3c20203eu, 0x003e2020u), // ヨ  katakana YO  ink 18
  uvec2(0x7f107f10u, 0x00040808u), // キ  katakana KI  ink 19
  uvec2(0x1c087f08u, 0x00084936u), // ホ  katakana HO  ink 20
  uvec2(0x2222223eu, 0x003e2222u)  // ロ  katakana RO  ink 20
);

