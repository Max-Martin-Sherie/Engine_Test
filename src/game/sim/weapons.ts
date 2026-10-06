/** Guns: switching, reloading, firing (bullets and rockets), damage, and what a death does to the score. */
import { nextFloat } from '../../engine/core/rng';
import { ACTOR, DEG, DT, WEAPONS, WEAPON_IDS, sec, type WeaponDef, type WeaponId } from './config';
import { eyeHeight, lookDir, raycastWorld, rayVsCylinder } from './physics';
import type { Actor, Input, Match } from './types';

/** Degrees of bloom lost a second once the trigger is let go. */
const BLOOM_RECOVER = 5;
/** Ticks a rocket cannot hurt the one who fired it (it is leaving the barrel). */
const ARMING = 6;

export const weaponId = (a: Actor): WeaponId => WEAPON_IDS[a.current] ?? 'pistol';
export const weaponDef = (a: Actor): WeaponDef => WEAPONS[weaponId(a)];

/** May this attacker hurt that body? Not a teammate, but always themselves (a rocket at your own feet). */
export const canHurt = (attacker: Actor, victim: Actor): boolean => attacker.id === victim.id || attacker.team !== victim.team;

/** Damage after the weapon's falloff over distance. */
export function falloff(def: WeaponDef, distance: number): number {
  if (distance <= def.falloffStart) return def.damage;
  if (distance >= def.falloffEnd) return def.damage * def.minFraction;
  const k = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return def.damage * (1 - k * (1 - def.minFraction));
}

/** The cone the bullets go in (degrees): still, aiming down the sights, moving, in the air, and warmed up. */
export function spreadOf(a: Actor): number {
  const def = weaponDef(a);
  const speed = Math.min(1, Math.hypot(a.vx, a.vz) / ACTOR.sprint);
  return def.spread * (a.aiming ? 0.55 : 1) + def.moveSpread * speed * (a.aiming ? 0.6 : 1) + (a.onGround ? 0 : 1.6) + a.bloom;
}

/** Gives a weapon (or more ammunition for it). `fraction` of its spare ammunition is added. */
export function giveWeapon(a: Actor, id: WeaponId, fraction = 1): void {
  const i = WEAPON_IDS.indexOf(id);
  const slot = a.weapons[i];
  const def = WEAPONS[id];
  if (slot === undefined) return;
  if (!slot.owned) {
    slot.owned = true;
    slot.mag = def.magazine;
    slot.reserve = Number.isFinite(def.reserve) ? Math.round(def.reserve * fraction) : def.reserve;
  } else if (Number.isFinite(def.reserve)) {
    slot.reserve = Math.min(def.reserve, slot.reserve + Math.round(def.reserve * fraction));
  }
}

/** Damage done to a body. Returns the health it took (armour soaks up part first). Handles the death if it was fatal. */
export function damageActor(m: Match, victim: Actor, amount: number, attacker: Actor, weapon: WeaponId, head: boolean, fromX: number, fromZ: number): number {
  if (!victim.alive || victim.protect > 0 || amount <= 0) return 0;
  if (!canHurt(attacker, victim)) return 0;
  const absorbed = Math.min(victim.armor, amount * ACTOR.armorAbsorb);
  victim.armor -= absorbed;
  const taken = amount - absorbed;
  victim.health -= taken;
  victim.lastHurtBy = attacker.id;
  victim.lastHurtTick = m.tick;
  if (attacker.id !== victim.id) {
    attacker.damageDealt += amount;
    attacker.hits += 1;
    if (head) attacker.headshots += 1;
  }
  const killed = victim.health <= 0;
  m.events.push({ type: 'hit', attacker: attacker.id, victim: victim.id, damage: amount, head, killed, weapon, fromYaw: Math.atan2(victim.x - fromX, victim.z - fromZ) });
  if (killed) kill(m, victim, attacker, weapon, head);
  return taken;
}

function kill(m: Match, victim: Actor, attacker: Actor, weapon: WeaponId, head: boolean): void {
  victim.health = 0;
  victim.alive = false;
  victim.deaths += 1;
  victim.streak = 0;
  victim.respawnAt = m.tick + sec(ACTOR.respawn);
  victim.reloading = 0;
  victim.trigger = false;
  const suicide = attacker.id === victim.id;
  if (suicide) {
    const slot = m.mode === 'tdm' ? victim.team : victim.id;
    m.scores[slot] = Math.max(0, (m.scores[slot] ?? 0) - 1);
  } else {
    attacker.kills += 1;
    attacker.streak += 1;
    const slot = m.mode === 'tdm' ? attacker.team : attacker.id;
    m.scores[slot] = (m.scores[slot] ?? 0) + 1;
  }
  m.events.push({ type: 'death', actor: victim.id, x: victim.x, y: victim.y, z: victim.z, killer: attacker.id });
  m.events.push({ type: 'kill', killer: attacker.id, victim: victim.id, weapon, head });
}

/** What a bullet from here, going this way, hits first. */
interface Trace {
  t: number;
  kind: 'none' | 'world' | 'actor';
  nx: number;
  ny: number;
  nz: number;
  victim: Actor | null;
  /** Height of the hit above the victim's feet. */
  y: number;
}

function trace(m: Match, shooter: Actor, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number): Trace {
  const world = raycastWorld(m.arena, ox, oy, oz, dx, dy, dz, range);
  let t = world !== null ? world.t : range;
  const out: Trace = world !== null ? { t, kind: 'world', nx: world.nx, ny: world.ny, nz: world.nz, victim: null, y: 0 } : { t, kind: 'none', nx: 0, ny: 0, nz: 0, victim: null, y: 0 };
  for (const a of m.actors) {
    if (a === shooter || !a.alive) continue;
    const hit = rayVsCylinder(ox, oy, oz, dx, dy, dz, a.x, a.y, a.z, ACTOR.hitRadius, ACTOR.height, t);
    if (hit !== null && hit.t < t) {
      t = hit.t;
      out.t = t;
      out.kind = 'actor';
      out.victim = a;
      out.y = hit.y;
      out.nx = -dx;
      out.ny = -dy;
      out.nz = -dz;
    }
  }
  return out;
}

/** A random point in a disc (uniform), as an offset on two axes. */
function inDisc(m: Match, radius: number): [number, number] {
  const r = Math.sqrt(nextFloat(m.rng)) * radius;
  const a = nextFloat(m.rng) * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** The look direction turned a little by up to `degrees`. */
function scatter(m: Match, yaw: number, pitch: number, degrees: number): { x: number; y: number; z: number } {
  const f = lookDir(yaw, pitch);
  if (degrees <= 0) return f;
  // The basis: right and up for this look direction.
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const ux = Math.sin(yaw) * Math.sin(pitch);
  const uy = Math.cos(pitch);
  const uz = Math.cos(yaw) * Math.sin(pitch);
  const [a, b] = inDisc(m, Math.tan(degrees * DEG));
  const x = f.x + rx * a + ux * b;
  const y = f.y + uy * b;
  const z = f.z + rz * a + uz * b;
  const len = Math.sqrt(x * x + y * y + z * z);
  return { x: x / len, y: y / len, z: z / len };
}

/** Where the barrel is, a little in front of the eye and off to the right. */
export function muzzleOf(a: Actor): { x: number; y: number; z: number } {
  const f = lookDir(a.yaw, a.pitch);
  return {
    x: a.x + f.x * 0.55 + Math.cos(a.yaw) * 0.18,
    y: eyeHeight(a) + f.y * 0.55 - 0.16,
    z: a.z + f.z * 0.55 - Math.sin(a.yaw) * 0.18,
  };
}

function shoot(m: Match, a: Actor): void {
  const id = weaponId(a);
  const def = WEAPONS[id];
  const slot = a.weapons[a.current]!;
  slot.mag -= 1;
  a.cooldown = sec(def.interval);
  a.shots += 1;
  a.protect = 0;
  const spread = spreadOf(a);
  a.bloom = Math.min(def.maxBloom, a.bloom + def.bloom);
  const eyeX = a.x;
  const eyeY = eyeHeight(a);
  const eyeZ = a.z;
  const muzzle = muzzleOf(a);
  m.events.push({ type: 'fire', actor: a.id, weapon: id, x: muzzle.x, y: muzzle.y, z: muzzle.z });
  m.sounds.push({ x: a.x, z: a.z, tick: m.tick, owner: a.id, team: a.team });

  if (def.projectile !== undefined) {
    const d = scatter(m, a.yaw, a.pitch, spread);
    // Launched from the eye line so it goes where the cross hairs are, drawn from the barrel.
    const rocketId = m.nextProjectile++;
    m.projectiles.push({ id: rocketId, owner: a.id, weapon: id, x: eyeX + d.x * 0.6, y: eyeY + d.y * 0.6 - 0.1, z: eyeZ + d.z * 0.6, vx: d.x * def.projectile.speed, vy: d.y * def.projectile.speed, vz: d.z * def.projectile.speed, life: sec(def.range / def.projectile.speed), age: 0 });
    m.events.push({ type: 'rocket', id: rocketId, owner: a.id, x: muzzle.x, y: muzzle.y, z: muzzle.z });
    return;
  }

  for (let p = 0; p < def.pellets; p++) {
    const d = scatter(m, a.yaw, a.pitch, spread);
    const hit = trace(m, a, eyeX, eyeY, eyeZ, d.x, d.y, d.z, def.range);
    const tx = eyeX + d.x * hit.t;
    const ty = eyeY + d.y * hit.t;
    const tz = eyeZ + d.z * hit.t;
    m.events.push({ type: 'bullet', actor: a.id, weapon: id, fx: muzzle.x, fy: muzzle.y, fz: muzzle.z, tx, ty, tz, hit: hit.kind, nx: hit.nx, ny: hit.ny, nz: hit.nz, victim: hit.victim?.id ?? -1 });
    if (hit.kind === 'actor' && hit.victim !== null) {
      const head = hit.y >= ACTOR.headFrom;
      const legs = hit.y < ACTOR.legTo;
      const base = falloff(def, hit.t);
      const amount = base * (head ? def.headMultiplier : legs ? ACTOR.legMultiplier : 1);
      damageActor(m, hit.victim, amount, a, id, head, a.x, a.z);
    }
  }
}

/** One tick of an actor's weapons: counters, switching, reloading, and pulling the trigger. */
export function updateWeapons(m: Match, a: Actor, input: Input): void {
  if (a.cooldown > 0) a.cooldown -= 1;
  if (a.equipping > 0) a.equipping -= 1;
  // The gun settles only once the trigger is let go; while it is held the spread builds.
  if (!input.fire) a.bloom = Math.max(0, a.bloom - BLOOM_RECOVER * DT);
  a.aiming = input.aim;

  // A reload in progress finishes.
  if (a.reloading > 0) {
    a.reloading -= 1;
    if (a.reloading === 0) {
      const def = weaponDef(a);
      const slot = a.weapons[a.current]!;
      const take = Math.min(def.magazine - slot.mag, slot.reserve);
      slot.mag += take;
      if (Number.isFinite(slot.reserve)) slot.reserve -= take;
    }
  }

  // Switching.
  if (input.switchTo >= 0 && input.switchTo !== a.current && a.weapons[input.switchTo]?.owned === true) {
    a.current = input.switchTo;
    a.equipping = sec(weaponDef(a).equip);
    a.reloading = 0;
    a.cooldown = Math.max(a.cooldown, a.equipping);
    m.events.push({ type: 'switch', actor: a.id, weapon: weaponId(a) });
  }

  const def = weaponDef(a);
  const slot = a.weapons[a.current]!;
  // Holding the trigger keeps firing at the gun's own pace, even for the single-shot guns: kinder on a touch screen.
  const wantsToFire = input.fire;
  a.trigger = input.fire;

  const canReload = a.reloading === 0 && a.equipping === 0 && slot.mag < def.magazine && slot.reserve > 0;
  if ((input.reload || (slot.mag === 0 && input.fire)) && canReload) {
    a.reloading = sec(def.reload);
    m.events.push({ type: 'reload', actor: a.id, weapon: weaponId(a) });
    return;
  }
  if (wantsToFire && a.cooldown === 0 && a.reloading === 0 && a.equipping === 0 && slot.mag > 0) shoot(m, a);
}

/** An explosion: damage and a shove for everyone near, less with distance, and none through a wall. */
export function explode(m: Match, x: number, y: number, z: number, owner: Actor, weapon: WeaponId): void {
  const def = WEAPONS[weapon];
  const proj = def.projectile;
  if (proj === undefined) return;
  m.events.push({ type: 'explosion', owner: owner.id, x, y, z });
  m.sounds.push({ x, z, tick: m.tick, owner: owner.id, team: owner.team });
  for (const a of m.actors) {
    if (!a.alive || !canHurt(owner, a)) continue;
    // The nearest point of the body to the blast.
    const cy = Math.min(a.y + ACTOR.height, Math.max(a.y, y));
    const dx = a.x - x;
    const dz = a.z - z;
    const dy = cy - y;
    const dist = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - ACTOR.hitRadius);
    if (dist >= proj.splash) continue;
    // Walls shield.
    const toX = a.x - x;
    const toY = a.y + 0.9 - y;
    const toZ = a.z - z;
    const len = Math.sqrt(toX * toX + toY * toY + toZ * toZ) || 1;
    const wall = raycastWorld(m.arena, x, y, z, toX / len, toY / len, toZ / len, len);
    if (wall !== null && wall.t < len - 0.2) continue;
    const k = 1 - dist / proj.splash;
    const self = a.id === owner.id;
    damageActor(m, a, def.damage * k * (self ? proj.selfScale : 1), owner, weapon, false, x, z);
    // The shove, mostly sideways with some lift.
    const push = proj.push * k;
    a.vx += (toX / len) * push;
    a.vz += (toZ / len) * push;
    a.vy += Math.max(0.3, toY / len) * push * 0.8;
    a.onGround = false;
  }
}

/** Moves the rockets, and blows them up when they meet something. */
export function updateProjectiles(m: Match, dt: number): void {
  for (let i = m.projectiles.length - 1; i >= 0; i--) {
    const p = m.projectiles[i]!;
    const owner = m.actors[p.owner];
    if (owner === undefined) {
      m.projectiles.splice(i, 1);
      continue;
    }
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    const step = speed * dt;
    const dx = p.vx / speed;
    const dy = p.vy / speed;
    const dz = p.vz / speed;
    let t = step;
    let boom = false;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const world = raycastWorld(m.arena, p.x, p.y, p.z, dx, dy, dz, step);
    if (world !== null) {
      t = world.t;
      boom = true;
      nx = world.nx;
      ny = world.ny;
      nz = world.nz;
    }
    for (const a of m.actors) {
      if (!a.alive || (a.id === p.owner && p.age < ARMING)) continue;
      const hit = rayVsCylinder(p.x, p.y, p.z, dx, dy, dz, a.x, a.y, a.z, ACTOR.hitRadius, ACTOR.height, t);
      if (hit !== null && hit.t < t) {
        t = hit.t;
        boom = true;
        nx = -dx;
        ny = -dy;
        nz = -dz;
      }
    }
    p.life -= 1;
    p.age += 1;
    if (boom || p.life <= 0) {
      // Stop a hair short of the surface so the blast is on the open side of it.
      explode(m, p.x + dx * t + nx * 0.1, p.y + dy * t + ny * 0.1, p.z + dz * t + nz * 0.1, owner, p.weapon);
      m.projectiles.splice(i, 1);
    } else {
      p.x += dx * t;
      p.y += dy * t;
      p.z += dz * t;
    }
  }
}
