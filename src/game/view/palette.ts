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

export interface FruitColors {
  skin: number;
  skinDark: number;
  flesh: number;
  fleshLight: number;
  /** Colour of seeds and small details. */
  detail: number;
}

export const FRUIT_COLORS: Record<string, FruitColors> = {
  orange: { skin: 0xff9f1c, skinDark: 0xd9780a, flesh: 0xffc24d, fleshLight: 0xffe08a, detail: 0xffefc2 },
  apple: { skin: 0xe63946, skinDark: 0x9e1b2a, flesh: 0xfff1d6, fleshLight: 0xffffff, detail: 0x6b3b1d },
  watermelon: { skin: 0x2d9a4e, skinDark: 0x17602f, flesh: 0xff4d6d, fleshLight: 0xff8fa3, detail: 0x2a1218 },
  lemon: { skin: 0xffe94d, skinDark: 0xd1b300, flesh: 0xfff7a8, fleshLight: 0xfffbd1, detail: 0xfffbd1 },
  pear: { skin: 0xb5e04b, skinDark: 0x7fa51a, flesh: 0xf4ffd0, fleshLight: 0xffffff, detail: 0x5a3d1a },
  banana: { skin: 0xffe14d, skinDark: 0xc79a00, flesh: 0xfff3b0, fleshLight: 0xffffff, detail: 0x6b4a14 },
};
