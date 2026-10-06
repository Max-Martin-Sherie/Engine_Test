/**
 * Every number that defines how Arena Zero plays. Units: metres and seconds. The simulation runs at a fixed 60 ticks a
 * second; a "tick" is one step of it.
 */

export const TPS = 60;
export const DT = 1 / TPS;
/** Whole ticks in a number of seconds. */
export const sec = (seconds: number): number => Math.max(1, Math.round(seconds * TPS));

export const DEG = Math.PI / 180;

// ---- the people ------------------------------------------------------------------------------------------------

export const ACTOR = {
  /** Body radius for walking into walls. */
  radius: 0.35,
  /** A little fatter for being shot at: easier on a touch screen. */
  hitRadius: 0.42,
  height: 1.8,
  eye: 1.62,
  /** The top part of the body (from the feet up) that counts as a headshot. */
  headFrom: 1.45,
  /** Below this height (from the feet) a hit is a leg shot. */
  legTo: 0.75,
  legMultiplier: 0.85,
  health: 100,
  armorMax: 100,
  /** The share of damage armor takes while it lasts. */
  armorAbsorb: 0.6,
  walk: 5.2,
  sprint: 7.4,
  /** How quickly the velocity closes on the wanted one (per second): snappy on the ground, floaty in the air. */
  groundResponse: 16,
  airResponse: 2.4,
  jump: 7,
  gravity: 21,
  terminal: 40,
  /** The tallest step a walker climbs without jumping. */
  step: 0.55,
  /** Seconds dead before coming back, and safe after. */
  respawn: 3,
  protect: 2,
};

// ---- the guns --------------------------------------------------------------------------------------------------

export type WeaponId = 'pistol' | 'rifle' | 'shotgun' | 'rail' | 'rocket';
export const WEAPON_IDS: readonly WeaponId[] = ['pistol', 'rifle', 'shotgun', 'rail', 'rocket'];

export interface WeaponDef {
  name: string;
  /** Hold to keep firing. */
  auto: boolean;
  /** Damage of one bullet (or pellet) up close. */
  damage: number;
  headMultiplier: number;
  pellets: number;
  /** Half the cone the bullets go in (degrees) when standing still, and the most that moving adds. */
  spread: number;
  moveSpread: number;
  /** Extra spread added by each shot and lost again as you stop (automatic weapons bloom). */
  bloom: number;
  maxBloom: number;
  /** Seconds between shots. */
  interval: number;
  magazine: number;
  /** Spare ammunition carried (Infinity: never runs out). */
  reserve: number;
  reload: number;
  /** Damage falls off between these distances to `minFraction` of itself. */
  falloffStart: number;
  falloffEnd: number;
  minFraction: number;
  range: number;
  /** How far the view kicks up per shot (degrees). */
  kick: number;
  /** Seconds to bring it up after switching. */
  equip: number;
  /** How much aiming zooms in (the field of view is divided by this). */
  zoom: number;
  /** Rockets: a projectile that explodes. */
  projectile?: { speed: number; splash: number; selfScale: number; push: number };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    name: 'Pulse Pistol',
    auto: false,
    damage: 22,
    headMultiplier: 2,
    pellets: 1,
    spread: 0.45,
    moveSpread: 1.4,
    bloom: 0.5,
    maxBloom: 1.2,
    interval: 0.24,
    magazine: 12,
    reserve: Infinity,
    reload: 1.1,
    falloffStart: 18,
    falloffEnd: 45,
    minFraction: 0.6,
    range: 90,
    kick: 1.3,
    equip: 0.25,
    zoom: 1.3,
  },
  rifle: {
    name: 'Arc Rifle',
    auto: true,
    damage: 12,
    headMultiplier: 1.8,
    pellets: 1,
    spread: 0.55,
    moveSpread: 2.2,
    bloom: 0.28,
    maxBloom: 2.6,
    interval: 0.09,
    magazine: 30,
    reserve: 150,
    reload: 1.7,
    falloffStart: 16,
    falloffEnd: 55,
    minFraction: 0.5,
    range: 100,
    kick: 0.75,
    equip: 0.4,
    zoom: 1.5,
  },
  shotgun: {
    name: 'Scatter',
    auto: false,
    damage: 9,
    headMultiplier: 1.5,
    pellets: 10,
    spread: 4.2,
    moveSpread: 1.2,
    bloom: 0,
    maxBloom: 0,
    interval: 0.82,
    magazine: 6,
    reserve: 36,
    reload: 2.2,
    falloffStart: 6,
    falloffEnd: 20,
    minFraction: 0.12,
    range: 40,
    kick: 4.5,
    equip: 0.5,
    zoom: 1.15,
  },
  rail: {
    name: 'Railgun',
    auto: false,
    damage: 90,
    headMultiplier: 1.6,
    pellets: 1,
    spread: 0.04,
    moveSpread: 4.5,
    bloom: 0,
    maxBloom: 0,
    interval: 1.1,
    magazine: 4,
    reserve: 20,
    reload: 2.4,
    falloffStart: 400,
    falloffEnd: 400,
    minFraction: 1,
    range: 250,
    kick: 3.5,
    equip: 0.6,
    zoom: 3.2,
  },
  rocket: {
    name: 'Rocket Launcher',
    auto: false,
    damage: 85,
    headMultiplier: 1,
    pellets: 1,
    spread: 0.2,
    moveSpread: 0.8,
    bloom: 0,
    maxBloom: 0,
    interval: 0.9,
    magazine: 4,
    reserve: 16,
    reload: 2.3,
    falloffStart: 0,
    falloffEnd: 0,
    minFraction: 1,
    range: 120,
    kick: 3,
    equip: 0.55,
    zoom: 1.2,
    projectile: { speed: 30, splash: 4, selfScale: 0.5, push: 11 },
  },
};

/** What you start (and come back) with. */
export const LOADOUT: readonly WeaponId[] = ['pistol', 'rifle'];
/** How much of the spare ammunition a fresh pistol/rifle starts with. */
export const START_RESERVE = 0.5;

// ---- the arena -------------------------------------------------------------------------------------------------

export const ARENA = {
  /** Cells along each side (one cell is a metre). */
  size: 48,
  /** The tall outer wall and the height above which nobody can climb. */
  wall: 6,
  /** The highest a floor gets: anything taller is a wall. */
  maxFloor: 2.5,
  /** How many tries the generator gets before it gives up and makes an open arena. */
  attempts: 16,
  /** The share of the floor that must be walkable ground. */
  minOpen: 0.62,
};

export const PICKUP = {
  radius: 0.95,
  health: 40,
  armor: 50,
  ammo: 0.5,
  /** Seconds until each kind comes back. */
  respawn: { health: 14, armor: 24, ammo: 14, shotgun: 24, rail: 30, rocket: 30 } as Record<string, number>,
};

// ---- the computer players ---------------------------------------------------------------------------------------

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotLevel {
  name: string;
  /** Seconds a bot must have you in sight before it opens fire. */
  reaction: number;
  /** How far off its aim is (degrees) at 20 m, standing still. */
  aimError: number;
  /** How fast it can swing its aim (degrees a second). */
  turn: number;
  /** Fires in short bursts with pauses (easy), or whenever it is lined up. */
  bursts: boolean;
  /** 0..1: how readily it strafes, jumps and uses the best gun. */
  skill: number;
  /** Seconds it remembers where it last saw you. */
  memory: number;
  /** How far away it notices you (metres). */
  sight: number;
}

export const BOTS: Record<Difficulty, BotLevel> = {
  easy: { name: 'Easy', reaction: 0.6, aimError: 6.5, turn: 150, bursts: true, skill: 0.2, memory: 2, sight: 28 },
  normal: { name: 'Normal', reaction: 0.34, aimError: 3.2, turn: 270, bursts: false, skill: 0.55, memory: 4, sight: 40 },
  hard: { name: 'Hard', reaction: 0.17, aimError: 1.4, turn: 460, bursts: false, skill: 1, memory: 6, sight: 60 },
};

// ---- the rules -------------------------------------------------------------------------------------------------

export type Mode = 'ffa' | 'tdm';

export const MODES: Record<Mode, { name: string; blurb: string; scoreLimit: number; time: number }> = {
  ffa: { name: 'Deathmatch', blurb: 'Every one for themselves. First to 20 kills.', scoreLimit: 20, time: 300 },
  tdm: { name: 'Team deathmatch', blurb: 'Your team against the other. First to 40 kills.', scoreLimit: 40, time: 300 },
};

export const BOT_NAMES: readonly string[] = ['Vex', 'Bolt', 'Nyx', 'Rook', 'Echo', 'Zed', 'Kite', 'Onyx', 'Flux', 'Sable', 'Juno', 'Rift'];
