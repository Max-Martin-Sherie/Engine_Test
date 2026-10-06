/** Every colour the game draws with, in one place. */
export const COLORS = {
  /** The bars around the letterboxed play field. */
  letterbox: 0x03050a,
  skyTop: 0x040818,
  skyMid: 0x0f1c40,
  skyHorizon: 0x3a2a6e,
  fog: 0x0a1230,
  /** Block tints: tall walls, crates you can hide behind and jump over, steps and platforms. */
  wall: 0x9db0dc,
  crate: 0xffb06a,
  step: 0x7fe0cc,
  floor: 0xa3aec8,
  /** The two teams of a team match: yours, then theirs. */
  team: [0x35a8ff, 0xff7a3a] as const,
  /** Everyone's colour in a free-for-all, by actor id. */
  ffa: [0x35e0ff, 0xff5252, 0xffb13a, 0x6ae36a, 0xb77bff, 0xff62d0, 0x33e6c7, 0xe9e44a, 0xff8a5c, 0x7aa8ff, 0xc8ff5a, 0xff9ad8] as readonly number[],
  tracer: { pistol: 0x7ae8ff, rifle: 0xffe27a, shotgun: 0xffc27a, rail: 0xb48cff, rocket: 0xffa14a } as Record<string, number>,
  health: 0x58ff7a,
  armor: 0x4aa8ff,
  ammo: 0xffd24a,
} as const;

/** The colour of an actor: its team's in a team match, its own in a free-for-all. */
export function actorColor(id: number, team: number, teamMode: boolean): number {
  if (teamMode) return COLORS.team[team === 0 ? 0 : 1];
  return COLORS.ffa[id % COLORS.ffa.length] ?? 0xffffff;
}

export const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
