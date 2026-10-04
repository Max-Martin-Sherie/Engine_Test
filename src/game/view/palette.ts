/** Colours as 0xRRGGBB. The DOM overlay mirrors the UI ones in ui/styles.css. */
export const COLORS = {
  letterbox: 0x150f1f,
  field: 0x251a38,
  spot: 0x33254f,
  cream: 0xfff4dc,
  lime: 0x9be564,
  tomato: 0xff5d5d,
  citrus: 0xffb627,
  berry: 0xb94dff,
  ink: 0x150f1f,
  bomb: 0x2b2438,
  bombRim: 0x6b5b8a,
} as const;

/**
 * How a fruit looks. `skin*` is the outside (the whole fruit); `flesh*` the inside (what a cut
 * reveals). `detail` is seeds, pores and other small marks, `accent` the leaf, crown or pit.
 * Nothing here is near white: the field is dark and bright fruit are hard to read against it.
 */
export interface FruitColors {
  skin: number;
  skinDark: number;
  skinLight: number;
  flesh: number;
  fleshLight: number;
  detail: number;
  accent: number;
}

export const FRUIT_COLORS: Record<string, FruitColors> = {
  orange: { skin: 0xf08c14, skinDark: 0xb85f06, skinLight: 0xffb347, flesh: 0xf9a62b, fleshLight: 0xffcc70, detail: 0xffe2a0, accent: 0x4f9f36 },
  apple: { skin: 0xd62f3e, skinDark: 0x8f1625, skinLight: 0xff6f7c, flesh: 0xeedfba, fleshLight: 0xfaf0d2, detail: 0x6b3b1d, accent: 0x4fa233 },
  watermelon: { skin: 0x2a8f48, skinDark: 0x14562a, skinLight: 0x55bd74, flesh: 0xf0445f, fleshLight: 0xff8197, detail: 0x24101a, accent: 0xd8ecb4 },
  lemon: { skin: 0xc9a40c, skinDark: 0x8a7000, skinLight: 0xdfc23e, flesh: 0xdcc03a, fleshLight: 0xebd873, detail: 0xefe6a8, accent: 0x4a9230 },
  pear: { skin: 0x9bc238, skinDark: 0x62861a, skinLight: 0xbfd860, flesh: 0xe3e8a8, fleshLight: 0xf1f2c4, detail: 0x5a3d1a, accent: 0x4f9f36 },
  banana: { skin: 0xdcb927, skinDark: 0x9a7300, skinLight: 0xf0d65c, flesh: 0xeedc94, fleshLight: 0xf7eab8, detail: 0x5a3e10, accent: 0x6b4a14 },
  kiwi: { skin: 0x8a6a40, skinDark: 0x56401f, skinLight: 0xb08d5a, flesh: 0x7bbf40, fleshLight: 0xa9d86f, detail: 0x1b1b12, accent: 0xe8e8c8 },
  dragonfruit: { skin: 0xdc2a63, skinDark: 0x95103c, skinLight: 0xff6d97, flesh: 0xeee6e2, fleshLight: 0xf8f3f0, detail: 0x1a1216, accent: 0x44a846 },
  pineapple: { skin: 0xc2871a, skinDark: 0x80540b, skinLight: 0xe3b04a, flesh: 0xeccb45, fleshLight: 0xf6e183, detail: 0xd6a02a, accent: 0x38963a },
  mango: { skin: 0xec8820, skinDark: 0xa9520c, skinLight: 0xffbe4a, flesh: 0xf3b230, fleshLight: 0xf9cf6e, detail: 0xd9482f, accent: 0xefd9a0 },
  starfruit: { skin: 0xbccd36, skinDark: 0x7f9012, skinLight: 0xd9e575, flesh: 0xdae564, fleshLight: 0xe9f0a0, detail: 0x6a7a10, accent: 0x7f9012 },
  pomegranate: { skin: 0xad1330, skinDark: 0x6c0a1c, skinLight: 0xdc4660, flesh: 0xe6d6c0, fleshLight: 0xf2e8d8, detail: 0xc4132f, accent: 0x74101f },
  passionfruit: { skin: 0x65298c, skinDark: 0x3c1759, skinLight: 0x9361be, flesh: 0xf5a93f, fleshLight: 0xffc978, detail: 0x2b1a14, accent: 0xeadfd2 },
  avocado: { skin: 0x2d5a28, skinDark: 0x183518, skinLight: 0x568a47, flesh: 0xc4d874, fleshLight: 0xdcea9c, detail: 0x7a4a24, accent: 0x93b955 },
  papaya: { skin: 0xd99a2a, skinDark: 0x94650f, skinLight: 0xefc566, flesh: 0xf9884a, fleshLight: 0xffb286, detail: 0x1c1410, accent: 0x7aa63a },
  lychee: { skin: 0xd0405a, skinDark: 0x8f2234, skinLight: 0xee7a8b, flesh: 0xefe2d6, fleshLight: 0xf8efe8, detail: 0x5a2a1a, accent: 0xe49aa4 },
  coconut: { skin: 0x68472a, skinDark: 0x3d2813, skinLight: 0x93704a, flesh: 0xeee6d8, fleshLight: 0xf8f2e8, detail: 0xc6d6de, accent: 0x3d2813 },
  strawberry: { skin: 0xdf2038, skinDark: 0x9a1028, skinLight: 0xff6a7c, flesh: 0xf4a3ae, fleshLight: 0xfcd0d6, detail: 0xf0d160, accent: 0x3d9a38 },
  persimmon: { skin: 0xf2741a, skinDark: 0xb54a00, skinLight: 0xffa457, flesh: 0xf99238, fleshLight: 0xffbf80, detail: 0x5a2a0a, accent: 0x57a339 },
};
