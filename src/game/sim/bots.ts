/**
 * The computer players. A bot gets no help a person would not: it looks through its own eyes (a field of view and a
 * clear line of sight), hears gunfire, remembers where it last saw someone, aims with a delay and an error that shrink
 * with the difficulty, and produces the same `Input` a person's thumbs do. Nothing here reads a hidden value.
 */
import { nextFloat } from '../../engine/core/rng';
import { ACTOR, BOTS, DEG, DT, TPS, WEAPONS, WEAPON_IDS, sec, type BotLevel, type Difficulty, type WeaponId } from './config';
import { heightAt } from './arena';
import { clampPitch, lineOfSight, wrapAngle } from './physics';
import { weaponDef, weaponId } from './weapons';
import { noInput, type Actor, type Brain, type Input, type Match, type PickupKind } from './types';

const yawTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const rand = (m: Match): number => nextFloat(m.rng);

export function createBrain(difficulty: Difficulty): Brain {
  return {
    difficulty,
    nextThink: 0,
    target: -1,
    seenFor: 0,
    lastSeenX: 0,
    lastSeenZ: 0,
    lastSeenTick: -1000,
    goalX: 0,
    goalZ: 0,
    hasGoal: false,
    path: [],
    pathIndex: 0,
    repathAt: 0,
    strafe: 1,
    strafeUntil: 0,
    aimYaw: 0,
    aimPitch: 0,
    errYaw: 0,
    errPitch: 0,
    errUntil: 0,
    burstLeft: 0,
    pauseUntil: 0,
    stuckSince: 0,
    stuckX: 0,
    stuckZ: 0,
    jumpUntil: 0,
    wanderUntil: 0,
    visible: false,
    wantWeapon: 1,
  };
}

/** How far a weapon likes the fight to be. */
const RANGE: Record<WeaponId, number> = { pistol: 10, rifle: 14, shotgun: 5, rail: 26, rocket: 14 };

/** How good a weapon is for a fight at this distance (0 when it has nothing to fire). */
function suitability(a: Actor, id: WeaponId, dist: number, skill: number): number {
  const slot = a.weapons[WEAPON_IDS.indexOf(id)]!;
  if (!slot.owned || slot.mag + slot.reserve <= 0) return 0;
  switch (id) {
    case 'pistol':
      return 1;
    case 'rifle':
      return 3;
    case 'shotgun':
      return dist < 9 ? 3 + 3 * skill : dist < 14 ? 1.5 : 0.4;
    case 'rail':
      return dist > 20 ? 2.5 + 3 * skill : dist > 11 ? 2 + skill : 1.2;
    case 'rocket':
      return dist > 6 && dist < 30 ? 2.5 + 2 * skill : 0.8;
  }
}

function nearestPickup(m: Match, a: Actor, kinds: readonly PickupKind[], within = 60): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = within;
  for (const p of m.pickups) {
    if (!p.active || !kinds.includes(p.kind)) continue;
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d < bestD) {
      bestD = d;
      best = { x: p.x, z: p.z };
    }
  }
  return best;
}

function setGoal(m: Match, a: Actor, b: Brain, x: number, z: number): void {
  const moved = !b.hasGoal || Math.hypot(b.goalX - x, b.goalZ - z) > 2;
  b.goalX = x;
  b.goalZ = z;
  b.hasGoal = true;
  if (moved || m.tick >= b.repathAt || b.path.length === 0) {
    b.path = m.nav.find(a.x, a.z, x, z) ?? [];
    b.pathIndex = 0;
    b.repathAt = m.tick + sec(1.5);
    if (b.path.length === 0) b.hasGoal = false;
  }
}

/** The slow part of a bot's thinking (a few times a second): who it sees, what it wants, where it is going. */
function think(m: Match, a: Actor, b: Brain, lvl: BotLevel): void {
  const eye = a.y + ACTOR.eye;
  const thinkGap = (6 + (a.id % 4)) / TPS;

  // ---- eyes
  let best: Actor | null = null;
  let bestDist = Infinity;
  for (const e of m.actors) {
    if (!e.alive || e.team === a.team) continue;
    const dx = e.x - a.x;
    const dz = e.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist > lvl.sight) continue;
    const off = Math.abs(wrapAngle(yawTo(dx, dz) - a.yaw));
    const hurtByHim = a.lastHurtBy === e.id && m.tick - a.lastHurtTick < 120;
    if (off > 80 * DEG && dist > 5 && !hurtByHim) continue;
    if (!lineOfSight(m.arena, a.x, eye, a.z, e.x, e.y + 1.2, e.z) && !lineOfSight(m.arena, a.x, eye, a.z, e.x, e.y + 1.6, e.z)) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  if (best !== null) {
    if (b.target === best.id && b.visible) b.seenFor += thinkGap;
    else {
      b.target = best.id;
      b.seenFor = 0;
    }
    b.visible = true;
    b.lastSeenX = best.x;
    b.lastSeenZ = best.z;
    b.lastSeenTick = m.tick;
  } else {
    b.visible = false;
    b.seenFor = 0;
    if (b.target >= 0 && (m.tick - b.lastSeenTick > lvl.memory * TPS || m.actors[b.target]?.alive !== true)) b.target = -1;
  }

  // ---- ears
  if (!b.visible) {
    const hear = 14 + 18 * lvl.skill;
    for (const s of m.sounds) {
      if (m.tick - s.tick > 14 || s.team === a.team || s.owner === a.id) continue;
      if (Math.hypot(s.x - a.x, s.z - a.z) > hear || rand(m) > 0.3 + 0.5 * lvl.skill) continue;
      b.lastSeenX = s.x;
      b.lastSeenZ = s.z;
      b.lastSeenTick = m.tick;
      b.target = s.owner;
      break;
    }
  }

  // ---- the gun to hold
  if (b.visible && best !== null) {
    let pick = a.current;
    let top = suitability(a, weaponId(a), bestDist, lvl.skill) + 1.2;
    for (const id of WEAPON_IDS) {
      const score = suitability(a, id, bestDist, lvl.skill);
      if (score > top) {
        top = score;
        pick = WEAPON_IDS.indexOf(id);
      }
    }
    b.wantWeapon = pick;
  } else {
    // No one in sight: the rifle, or the best thing with ammunition.
    const rifle = a.weapons[1]!;
    b.wantWeapon = rifle.mag + rifle.reserve > 0 ? 1 : 0;
  }

  // ---- where to go (when not fighting someone it can see)
  if (b.visible) return;
  let goal: { x: number; z: number } | null = null;
  if (a.health < 50) goal = nearestPickup(m, a, ['health']);
  if (goal === null && a.armor < 25 && rand(m) < 0.4) goal = nearestPickup(m, a, ['armor'], 30);
  const def = weaponDef(a);
  const slot = a.weapons[a.current]!;
  if (goal === null && slot.reserve < def.magazine && Number.isFinite(slot.reserve)) goal = nearestPickup(m, a, ['ammo'], 40);
  if (goal === null && rand(m) < 0.25 + 0.6 * lvl.skill) {
    const wanted = (['shotgun', 'rail', 'rocket'] as const).filter((id) => !a.weapons[WEAPON_IDS.indexOf(id)]!.owned);
    if (wanted.length > 0) goal = nearestPickup(m, a, wanted, 34);
  }
  if (goal === null && b.target >= 0) goal = { x: b.lastSeenX, z: b.lastSeenZ };
  if (goal === null) {
    const arrived = !b.hasGoal || b.pathIndex >= b.path.length;
    if (arrived || m.tick > b.wanderUntil) {
      const spots = m.arena.waypoints;
      let pick = spots[Math.floor(rand(m) * spots.length)] ?? { x: 24, z: 24 };
      for (let tries = 0; tries < 4 && Math.hypot(pick.x - a.x, pick.z - a.z) < 10; tries++) pick = spots[Math.floor(rand(m) * spots.length)] ?? pick;
      b.wanderUntil = m.tick + sec(10);
      goal = pick;
    } else goal = { x: b.goalX, z: b.goalZ };
  }
  setGoal(m, a, b, goal.x, goal.z);
}

/** The fast part, every tick: aim, move, shoot. */
function act(m: Match, a: Actor, b: Brain, lvl: BotLevel): Input {
  const input = noInput();
  const eye = a.y + ACTOR.eye;
  const target = b.target >= 0 ? m.actors[b.target] : undefined;
  const engaging = target !== undefined && target.alive && b.visible;
  const def = weaponDef(a);
  const id = weaponId(a);
  const slot = a.weapons[a.current]!;

  let wishX = 0;
  let wishZ = 0;
  let wantYaw = b.aimYaw;
  let wantPitch = 0;
  let dist = 0;
  let trueYaw = 0;
  let truePitch = 0;

  if (engaging && target !== undefined) {
    const dx = target.x - a.x;
    const dz = target.z - a.z;
    dist = Math.hypot(dx, dz) || 0.001;
    const tx = dx / dist;
    const tz = dz / dist;
    // Keep the gun's distance, and never stand still.
    const want = RANGE[id] * (0.8 + 0.4 * lvl.skill);
    const advance = dist > want + 3 ? 1 : dist < want - 3 ? -0.8 : 0;
    if (m.tick >= b.strafeUntil) {
      b.strafe = rand(m) < 0.5 ? -1 : 1;
      b.strafeUntil = m.tick + sec(0.6 + rand(m) * 1.3);
    }
    const sideways = 0.3 + 0.7 * lvl.skill;
    wishX = tx * advance + -tz * b.strafe * sideways;
    wishZ = tz * advance + tx * b.strafe * sideways;
    // Aim at the body (the head for a good shot with a precise gun, the feet for a rocket), leading a moving target.
    const lead = id === 'rocket' && WEAPONS.rocket.projectile !== undefined ? dist / WEAPONS.rocket.projectile.speed : 0.04 * lvl.skill;
    const px = target.x + target.vx * lead;
    const pz = target.z + target.vz * lead;
    const aimHeight = id === 'rocket' ? 0.3 : id === 'rail' && lvl.skill > 0.6 ? 1.5 : 1.0;
    const py = target.y + aimHeight;
    trueYaw = yawTo(px - a.x, pz - a.z);
    truePitch = Math.atan2(py - eye, Math.hypot(px - a.x, pz - a.z));
    if (m.tick >= b.errUntil) {
      const speed = Math.min(1, Math.hypot(target.vx, target.vz) / ACTOR.walk);
      const scale = (0.4 + dist / 20) * (1 + speed * 0.7) * lvl.aimError * DEG;
      b.errYaw = (rand(m) * 2 - 1) * scale;
      b.errPitch = (rand(m) * 2 - 1) * scale * 0.6;
      b.errUntil = m.tick + sec(0.25 + rand(m) * 0.2);
    }
    wantYaw = trueYaw + b.errYaw;
    wantPitch = truePitch + b.errPitch;
    if (lvl.skill > 0.5 && a.onGround && m.tick >= b.jumpUntil && rand(m) < 0.006 * lvl.skill) b.jumpUntil = m.tick + 8;
  } else {
    // Walking: follow the route, looking where it is going.
    if (b.pathIndex < b.path.length) {
      let i = b.pathIndex;
      while (i < b.path.length && Math.hypot((b.path[i] ?? 0) - a.x, (b.path[i + 1] ?? 0) - a.z) < 0.7) i += 2;
      b.pathIndex = i;
      if (i < b.path.length) {
        const dx = (b.path[i] ?? 0) - a.x;
        const dz = (b.path[i + 1] ?? 0) - a.z;
        const len = Math.hypot(dx, dz) || 1;
        wishX = dx / len;
        wishZ = dz / len;
        wantYaw = yawTo(dx, dz);
      }
    }
  }

  // ---- turning the head: quickly but not instantly
  const maxStep = lvl.turn * DEG * DT;
  b.aimYaw += clamp(wrapAngle(wantYaw - b.aimYaw) * Math.min(1, 14 * DT), -maxStep, maxStep);
  b.aimPitch += clamp((wantPitch - b.aimPitch) * Math.min(1, 14 * DT), -maxStep, maxStep);
  b.aimPitch = clampPitch(b.aimPitch);
  input.yaw = b.aimYaw;
  input.pitch = b.aimPitch;

  // ---- feet: the wish direction in world space, turned to the body's frame
  const len = Math.hypot(wishX, wishZ);
  if (len > 1) {
    wishX /= len;
    wishZ /= len;
  }
  const sy = Math.sin(b.aimYaw);
  const cy = Math.cos(b.aimYaw);
  input.moveZ = wishX * -sy + wishZ * -cy;
  input.moveX = wishX * cy + wishZ * -sy;
  input.sprint = !engaging && input.moveZ > 0.7;

  // ---- stuck? jump, turn around, find another way
  if (m.tick - b.stuckSince >= 30) {
    const moved = Math.hypot(a.x - b.stuckX, a.z - b.stuckZ);
    if (len > 0.3 && moved < 0.35 && a.alive) {
      b.jumpUntil = m.tick + 10;
      b.strafe = -b.strafe;
      b.repathAt = m.tick;
    }
    b.stuckSince = m.tick;
    b.stuckX = a.x;
    b.stuckZ = a.z;
  }
  input.jump = m.tick < b.jumpUntil && a.onGround;

  // ---- trigger
  if (engaging && target !== undefined) {
    const off = Math.hypot(wrapAngle(trueYaw - b.aimYaw), truePitch - b.aimPitch);
    const body = Math.atan2(ACTOR.hitRadius, dist);
    // It pulls the trigger when it is close to lined up, not only when perfectly: the sloppier it is, the more it misses.
    const tolerance = body * (def.pellets > 1 || def.projectile !== undefined ? 2.8 : 1) + lvl.aimError * DEG * 0.9;
    let fire = off < tolerance && b.seenFor >= lvl.reaction && dist < def.range * 0.85 && slot.mag > 0;
    if (fire && lvl.bursts) {
      if (m.tick < b.pauseUntil) fire = false;
      else {
        if (b.burstLeft <= 0) b.burstLeft = sec(0.3 + rand(m) * 0.4);
        b.burstLeft -= 1;
        if (b.burstLeft <= 0) b.pauseUntil = m.tick + sec(0.35 + rand(m) * 0.5);
      }
    }
    input.fire = fire;
    input.aim = dist > 18 && lvl.skill > 0.4 && (id === 'rail' || id === 'rifle');
  }
  input.reload = slot.mag === 0 || (!engaging && slot.mag < def.magazine * 0.4 && slot.reserve > 0);
  if (b.wantWeapon !== a.current && a.equipping === 0) input.switchTo = b.wantWeapon;
  return input;
}

/** What a bot does this tick. */
export function thinkBot(m: Match, a: Actor): Input {
  const brain = a.brain;
  if (brain === null) return noInput();
  const lvl = BOTS[brain.difficulty];
  if (m.tick >= brain.nextThink) {
    brain.nextThink = m.tick + 6 + (a.id % 4);
    think(m, a, brain, lvl);
  }
  return act(m, a, brain, lvl);
}

export { heightAt };
