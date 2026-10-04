/** Colours as 0xRRGGBB, shared by the Pixi view. The DOM overlay mirrors them in ui/styles.css. */
export const COLORS = {
  letterbox: 0x0c2a33,
  field: 0x123d49,
  streak: 0x2f7284,
  ground: 0x0e3440,
  groundEdge: 0x24606f,
  sand: 0xe8d5a6,
  sandDark: 0xb9a46f,
  sandLight: 0xfff3cf,
  ink: 0x0c2a33,
  coral: { dark: 0xa83a30, base: 0xff6f59, light: 0xffb09f },
  amber: { dark: 0xb06a1c, base: 0xf6b042, light: 0xffe0a0 },
} as const;

export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
