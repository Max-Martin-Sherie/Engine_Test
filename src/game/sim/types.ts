import type { RngState } from '../../engine/core/rng';
import type { Arena, NavGrid } from './arena';
import type { Difficulty, Mode, WeaponId } from './config';

/** What a player (or a bot) wants to do this tick. Looking is absolute: the controller keeps the angles. */
export interface Input {
  /** Strafe right (+) / left (-), and forward (+) / back (-), each -1..1. */
  moveX: number;
  moveZ: number;
  /**
   * Which way the head is turned, in radians, the way a Three.js camera is: yaw 0 looks along -z and a positive yaw turns
   * left (counter-clockwise seen from above); a positive pitch looks up.
   */
  yaw: number;
  pitch: number;
  fire: boolean;
  jump: boolean;
  sprint: boolean;
  reload: boolean;
  aim: boolean;
  /** Switch to this weapon slot (0..4), or -1. */
  switchTo: number;
}

export const noInput = (): Input => ({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, jump: false, sprint: false, reload: false, aim: false, switchTo: -1 });

export interface WeaponState {
  owned: boolean;
  mag: number;
  reserve: number;
}

export interface Actor {
  id: number;
  name: string;
  /** Teams: in a free-for-all everyone is their own team (the actor's id). */
  team: number;
  human: boolean;
  alive: boolean;
  /** Feet position, and where they were a tick ago (for smooth drawing). */
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  health: number;
  armor: number;
  weapons: WeaponState[];
  /** Index into WEAPON_IDS. */
  current: number;
  /** Ticks until the next shot is allowed, until a reload ends, until the weapon is up. */
  cooldown: number;
  reloading: number;
  equipping: number;
  /** Degrees of extra spread from firing a lot. */
  bloom: number;
  /** Was the trigger down last tick (a semi-automatic gun needs a fresh press). */
  trigger: boolean;
  aiming: boolean;
  /** Ticks of safety after (re)spawning. */
  protect: number;
  /** When a dead actor comes back (tick). */
  respawnAt: number;
  kills: number;
  deaths: number;
  streak: number;
  damageDealt: number;
  shots: number;
  hits: number;
  headshots: number;
  lastHurtBy: number;
  lastHurtTick: number;
  /** A phase that advances as the actor walks (for the legs). */
  stride: number;
  input: Input;
  brain: Brain | null;
}

/** What a bot remembers and plans. Plain data, so it lives in the match. */
export interface Brain {
  difficulty: Difficulty;
  nextThink: number;
  target: number;
  /** Seconds the current target has been in sight without a break. */
  seenFor: number;
  lastSeenX: number;
  lastSeenZ: number;
  lastSeenTick: number;
  goalX: number;
  goalZ: number;
  hasGoal: boolean;
  /** Waypoints (x, z pairs) and which one is next. */
  path: number[];
  pathIndex: number;
  repathAt: number;
  strafe: number;
  strafeUntil: number;
  aimYaw: number;
  aimPitch: number;
  errYaw: number;
  errPitch: number;
  errUntil: number;
  burstLeft: number;
  pauseUntil: number;
  stuckSince: number;
  stuckX: number;
  stuckZ: number;
  jumpUntil: number;
  wanderUntil: number;
  /** Is the target in sight right now? */
  visible: boolean;
  /** The weapon slot it wants in hand. */
  wantWeapon: number;
}

export type PickupKind = 'health' | 'armor' | 'ammo' | 'shotgun' | 'rail' | 'rocket';

export interface Pickup {
  kind: PickupKind;
  x: number;
  z: number;
  /** The floor height it sits on. */
  y: number;
  active: boolean;
  /** When it comes back (tick). */
  backAt: number;
}

export interface Projectile {
  id: number;
  owner: number;
  weapon: WeaponId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Ticks left before it fizzles, and ticks since it was fired. */
  life: number;
  age: number;
}

export type MatchEvent =
  | { type: 'fire'; actor: number; weapon: WeaponId; x: number; y: number; z: number }
  | { type: 'bullet'; actor: number; weapon: WeaponId; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; hit: 'none' | 'world' | 'actor'; nx: number; ny: number; nz: number; victim: number }
  | { type: 'hit'; attacker: number; victim: number; damage: number; head: boolean; killed: boolean; weapon: WeaponId; fromYaw: number }
  | { type: 'kill'; killer: number; victim: number; weapon: WeaponId; head: boolean }
  | { type: 'death'; actor: number; x: number; y: number; z: number; killer: number }
  | { type: 'spawn'; actor: number; x: number; y: number; z: number }
  | { type: 'pickup'; actor: number; kind: PickupKind; x: number; z: number }
  | { type: 'reload'; actor: number; weapon: WeaponId }
  | { type: 'switch'; actor: number; weapon: WeaponId }
  | { type: 'rocket'; id: number; owner: number; x: number; y: number; z: number }
  | { type: 'explosion'; owner: number; x: number; y: number; z: number }
  | { type: 'land'; actor: number; speed: number }
  | { type: 'jump'; actor: number }
  | { type: 'end'; winner: number };

/** A noise bots can hear: where, when and who made it. */
export interface Sound {
  x: number;
  z: number;
  tick: number;
  owner: number;
  team: number;
}

export interface Match {
  seed: number;
  tick: number;
  rng: RngState;
  arena: Arena;
  nav: NavGrid;
  mode: Mode;
  difficulty: Difficulty;
  actors: Actor[];
  pickups: Pickup[];
  projectiles: Projectile[];
  nextProjectile: number;
  events: MatchEvent[];
  sounds: Sound[];
  /** Per team (in a free-for-all, per actor id). */
  scores: number[];
  scoreLimit: number;
  /** Ticks left on the clock. */
  timeLeft: number;
  /** -1 while playing; else the winning actor id (free-for-all) or team; -2 for a draw. */
  winner: number;
  /** The person playing, or -1 when only bots are. */
  human: number;
}
