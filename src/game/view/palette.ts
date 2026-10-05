/** Colours as 0xRRGGBB. The DOM overlay mirrors the main ones in ui/styles.css. */
export const COLORS = {
  letterbox: 0x04060f,
  field: 0x070b1a,
  fieldGlow: 0x0e1633,
  grid: 0x18224a,
  frame: 0x2a3a78,
  text: 0xe9f0ff,
  cyan: 0x35e0ff,
  magenta: 0xff4fd8,
  amber: 0xffc247,
  lime: 0x9dff6b,
  violet: 0xa78bfa,
  danger: 0xff4d6d,
  white: 0xffffff,
  orb: 0xfff27a,
} as const;

/** Each gate and its plate share a colour so the pair is easy to see. */
export const GATE_COLORS: readonly number[] = [COLORS.cyan, COLORS.amber, COLORS.lime, COLORS.violet];

/** The colour of the ghost made in loop `index` (0 = the first ghost). */
const GHOSTS: readonly number[] = [0xff4fd8, 0xffc247, 0x9dff6b, 0xa78bfa, 0xff8a4f, 0x4fffd0, 0xff6b9d, 0x6bb6ff, 0xffe14f, 0xb6ff4f];
export const ghostColor = (index: number): number => GHOSTS[index % GHOSTS.length] ?? COLORS.magenta;
