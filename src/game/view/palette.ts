/** Every colour the game draws with, in one place. */
export const COLORS = {
  /** The bars around the letterboxed play field. */
  letterbox: 0x04060b,
  /** Behind the map. */
  sky: 0x070b14,
  /** Each side's colour. */
  team: [0x3f8cff, 0xff6a3a] as const,
  teamDark: [0x24508f, 0x9a3b1c] as const,
  mineral: 0x45e6ff,
  gas: 0x7dff6a,
  select: 0x58ff7a,
  enemy: 0xff4d4d,
  neutral: 0xffd24a,
  hpGood: 0x58ff7a,
  hpMid: 0xffd24a,
  hpLow: 0xff4d4d,
  barBack: 0x05080f,
  boxFill: 0x58ff7a,
  placeOk: 0x58ff7a,
  placeBad: 0xff4d4d,
  tracer: {
    trooper: 0xffe27a,
    tank: 0xffa14a,
    skiff: 0x6fe3ff,
    turret: 0xbfe6ff,
    worker: 0xffffff,
  } as Record<string, number>,
} as const;

/** The CSS colour of a hex number. */
export const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

export function hpColor(frac: number): number {
  return frac > 0.6 ? COLORS.hpGood : frac > 0.3 ? COLORS.hpMid : COLORS.hpLow;
}
