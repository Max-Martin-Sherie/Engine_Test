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
 * The colours of a fruit's splash when it is cut: `flesh` and `fleshLight` are the juice, `skin` the specks of
 * peel. (The fruit pictures themselves are in the painted sheet, see fruitSprites.ts.)
 */
export interface FruitColors {
  skin: number;
  flesh: number;
  fleshLight: number;
}

export const FRUIT_COLORS: Record<string, FruitColors> = {
  orange: { skin: 0xf08c14, flesh: 0xf9a62b, fleshLight: 0xffcc70 },
  apple: { skin: 0xd62f3e, flesh: 0xeedfba, fleshLight: 0xfaf0d2 },
  watermelon: { skin: 0x2a8f48, flesh: 0xf0445f, fleshLight: 0xff8197 },
  lemon: { skin: 0xc9a40c, flesh: 0xdcc03a, fleshLight: 0xebd873 },
  pear: { skin: 0x9bc238, flesh: 0xe3e8a8, fleshLight: 0xf1f2c4 },
  banana: { skin: 0xdcb927, flesh: 0xeedc94, fleshLight: 0xf7eab8 },
  kiwi: { skin: 0x8a6a40, flesh: 0x7bbf40, fleshLight: 0xa9d86f },
  dragonfruit: { skin: 0xdc2a63, flesh: 0xeee6e2, fleshLight: 0xf8f3f0 },
  pineapple: { skin: 0xc2871a, flesh: 0xeccb45, fleshLight: 0xf6e183 },
  mango: { skin: 0xec8820, flesh: 0xf3b230, fleshLight: 0xf9cf6e },
  starfruit: { skin: 0xbccd36, flesh: 0xdae564, fleshLight: 0xe9f0a0 },
  pomegranate: { skin: 0xad1330, flesh: 0xe6d6c0, fleshLight: 0xf2e8d8 },
  passionfruit: { skin: 0x65298c, flesh: 0xf5a93f, fleshLight: 0xffc978 },
  avocado: { skin: 0x2d5a28, flesh: 0xc4d874, fleshLight: 0xdcea9c },
  papaya: { skin: 0xd99a2a, flesh: 0xf9884a, fleshLight: 0xffb286 },
  lychee: { skin: 0xd0405a, flesh: 0xefe2d6, fleshLight: 0xf8efe8 },
  coconut: { skin: 0x68472a, flesh: 0xeee6d8, fleshLight: 0xf8f2e8 },
  strawberry: { skin: 0xdf2038, flesh: 0xf4a3ae, fleshLight: 0xfcd0d6 },
  persimmon: { skin: 0xf2741a, flesh: 0xf99238, fleshLight: 0xffbf80 },
};
