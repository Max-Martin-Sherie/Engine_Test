/**
 * A ragdoll: the body's sixteen joints as points that move under gravity (Verlet integration: a point's velocity is
 * the difference between where it is and where it was), held together by distance links, and pushed out of the floor
 * and the walls. It is a picture of a body falling, not part of the game's rules, so it lives here in the view.
 */
import { cellHeight, type Arena } from '../sim';
import { JOINTS, LINKS, J } from './skeleton';

const DT = 1 / 60;
const GRAVITY = 15;
const DAMPING = 0.996;
const ITERATIONS = 8;
/** How fat each joint is for bumping into things. */
const RADIUS: number[] = [];
for (let i = 0; i < JOINTS; i++) RADIUS.push(0.08);
RADIUS[J.head] = 0.13;
RADIUS[J.anL] = 0.06;
RADIUS[J.anR] = 0.06;
RADIUS[J.haL] = 0.06;
RADIUS[J.haR] = 0.06;

export class Ragdoll {
  readonly pos = new Float32Array(JOINTS * 3);
  private readonly prev = new Float32Array(JOINTS * 3);
  private still = 0;
  /** Seconds since it fell. */
  age = 0;
  asleep = false;
  /** Is each joint touching something (for friction)? */
  private readonly touching = new Uint8Array(JOINTS);

  /** Starts from a pose, moving at `v` (metres a second). */
  constructor(joints: Float32Array, vx: number, vy: number, vz: number) {
    this.pos.set(joints);
    for (let i = 0; i < JOINTS; i++) {
      this.prev[i * 3] = joints[i * 3]! - vx * DT;
      this.prev[i * 3 + 1] = joints[i * 3 + 1]! - vy * DT;
      this.prev[i * 3 + 2] = joints[i * 3 + 2]! - vz * DT;
    }
  }

  /**
   * Goes slack. A body that has just been killed does not hold itself up, but a pose with straight legs balances all
   * by itself in this model (nothing perturbs it), so the knees are given a small push the way (dx, dz) points; that is
   * all it takes for the weight above them to fold the legs.
   */
  limp(dx: number, dz: number): void {
    const len = Math.hypot(dx, dz) || 1;
    for (const k of [J.knL, J.knR]) {
      this.prev[k * 3] = this.prev[k * 3]! - (dx / len) * 0.9 * DT;
      this.prev[k * 3 + 2] = this.prev[k * 3 + 2]! - (dz / len) * 0.9 * DT;
    }
    this.asleep = false;
    this.still = 0;
  }

  /** A shove: the joints near a point are thrown along a direction, the nearer the harder. */
  push(x: number, y: number, z: number, dx: number, dy: number, dz: number, power: number, radius: number): void {
    for (let i = 0; i < JOINTS; i++) {
      const ex = this.pos[i * 3]! - x;
      const ey = this.pos[i * 3 + 1]! - y;
      const ez = this.pos[i * 3 + 2]! - z;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d > radius) continue;
      const k = power * (1 - d / radius) * DT;
      this.prev[i * 3] = this.prev[i * 3]! - dx * k;
      this.prev[i * 3 + 1] = this.prev[i * 3 + 1]! - dy * k;
      this.prev[i * 3 + 2] = this.prev[i * 3 + 2]! - dz * k;
    }
    this.asleep = false;
    this.still = 0;
  }

  /** An explosion: every joint is thrown away from the point, the nearer the harder, and a little upward. */
  blast(x: number, y: number, z: number, power: number, radius: number): void {
    for (let i = 0; i < JOINTS; i++) {
      const ex = this.pos[i * 3]! - x;
      const ey = this.pos[i * 3 + 1]! - y;
      const ez = this.pos[i * 3 + 2]! - z;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d > radius) continue;
      const k = (power * (1 - d / radius) * DT) / (d || 1);
      this.prev[i * 3] = this.prev[i * 3]! - ex * k;
      this.prev[i * 3 + 1] = this.prev[i * 3 + 1]! - (ey + 0.6 * (d || 1)) * k;
      this.prev[i * 3 + 2] = this.prev[i * 3 + 2]! - ez * k;
    }
    this.asleep = false;
    this.still = 0;
  }

  /** Where the middle of the body is. */
  centre(): { x: number; y: number; z: number } {
    return { x: this.pos[J.pelvis * 3]!, y: this.pos[J.pelvis * 3 + 1]!, z: this.pos[J.pelvis * 3 + 2]! };
  }

  /** One fixed step. */
  step(arena: Arena): void {
    this.age += DT;
    if (this.asleep) return;
    const p = this.pos;
    const q = this.prev;
    let moved = 0;
    for (let i = 0; i < JOINTS * 3; i += 3) {
      const vx = (p[i]! - q[i]!) * DAMPING;
      const vy = (p[i + 1]! - q[i + 1]!) * DAMPING;
      const vz = (p[i + 2]! - q[i + 2]!) * DAMPING;
      q[i] = p[i]!;
      q[i + 1] = p[i + 1]!;
      q[i + 2] = p[i + 2]!;
      p[i] = p[i]! + vx;
      p[i + 1] = p[i + 1]! + vy - GRAVITY * DT * DT;
      p[i + 2] = p[i + 2]! + vz;
      moved += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (const link of LINKS) {
        const a = link.a * 3;
        const b = link.b * 3;
        const dx = p[b]! - p[a]!;
        const dy = p[b + 1]! - p[a + 1]!;
        const dz = p[b + 2]! - p[a + 2]!;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const target = dist < link.min ? link.min : dist > link.max ? link.max : dist;
        if (target === dist) continue;
        const k = ((dist - target) / dist) * 0.5;
        p[a] = p[a]! + dx * k;
        p[a + 1] = p[a + 1]! + dy * k;
        p[a + 2] = p[a + 2]! + dz * k;
        p[b] = p[b]! - dx * k;
        p[b + 1] = p[b + 1]! - dy * k;
        p[b + 2] = p[b + 2]! - dz * k;
      }
      this.collide(arena, it === ITERATIONS - 1);
    }
    // Rest when the body as a whole has barely moved for a while (or has lain there long enough that nobody can tell).
    // A body still standing up (holding a balanced pose) is not at rest, however little it moves.
    let low = Infinity;
    for (let j = 0; j < JOINTS; j++) low = Math.min(low, p[j * 3 + 1]!);
    const upright = p[J.pelvis * 3 + 1]! - low > 0.45;
    if (moved / JOINTS < 0.0012 && !upright) {
      this.still += 1;
      if (this.still > 30) this.asleep = true;
    } else this.still = 0;
    if (this.age > 3.5) this.asleep = true;
  }

  private collide(arena: Arena, last: boolean): void {
    const p = this.pos;
    const q = this.prev;
    for (let j = 0; j < JOINTS; j++) {
      const i = j * 3;
      const r = RADIUS[j]!;
      let touched = false;
      let x = p[i]!;
      let y = p[i + 1]!;
      let z = p[i + 2]!;
      if (y < r) {
        y = r;
        touched = true;
      }
      const cx0 = Math.floor(x);
      const cz0 = Math.floor(z);
      for (let cz = cz0 - 1; cz <= cz0 + 1; cz++) {
        for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
          const h = cellHeight(arena, cx, cz);
          if (h <= 0.001 || y - r >= h) continue;
          // The nearest point of the column to the joint.
          const nx = Math.min(cx + 1, Math.max(cx, x));
          const ny = Math.min(h, Math.max(0, y));
          const nz = Math.min(cz + 1, Math.max(cz, z));
          let ex = x - nx;
          let ey = y - ny;
          let ez = z - nz;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= r * r) continue;
          if (d2 < 1e-10) {
            // Inside: leave by the nearest face.
            const up = h - y + r;
            const left = x - cx + r;
            const right = cx + 1 - x + r;
            const near = z - cz + r;
            const far = cz + 1 - z + r;
            const best = Math.min(up, left, right, near, far);
            if (best === up) y = h + r;
            else if (best === left) x = cx - r;
            else if (best === right) x = cx + 1 + r;
            else if (best === near) z = cz - r;
            else z = cz + 1 + r;
          } else {
            const d = Math.sqrt(d2);
            ex /= d;
            ey /= d;
            ez /= d;
            x = nx + ex * r;
            y = ny + ey * r;
            z = nz + ez * r;
          }
          touched = true;
        }
      }
      p[i] = x;
      p[i + 1] = y;
      p[i + 2] = z;
      if (touched && last) {
        // Friction: slow what slides along the ground.
        q[i] = x - (x - q[i]!) * 0.85;
        q[i + 2] = z - (z - q[i + 2]!) * 0.85;
        this.touching[j] = 1;
      } else if (last) this.touching[j] = 0;
    }
  }
}
