/**
 * A human body as sixteen joints. While someone is alive the joints are placed by simple animation (a walk cycle,
 * the arms reaching to hold the gun where the head is looking); when they die the *same joints* are handed to the
 * ragdoll, so the fall continues from exactly the pose they were in, with the speed they had.
 *
 * Coordinates are the world's: y up, and a body facing yaw 0 looks along -z with its right hand on +x.
 */

export const J = {
  pelvis: 0,
  spine: 1,
  neck: 2,
  head: 3,
  shL: 4,
  shR: 5,
  elL: 6,
  elR: 7,
  haL: 8,
  haR: 9,
  hipL: 10,
  hipR: 11,
  knL: 12,
  knR: 13,
  anL: 14,
  anR: 15,
} as const;

export const JOINTS = 16;

/** Standing at the origin, facing -z, arms hanging (x is the body's right). Lengths of every bone come from here. */
export const REST: readonly (readonly [number, number, number])[] = [
  [0, 0.92, 0],
  [0, 1.2, 0],
  [0, 1.46, 0],
  [0, 1.66, 0],
  [-0.2, 1.43, 0],
  [0.2, 1.43, 0],
  [-0.2, 1.15, 0],
  [0.2, 1.15, 0],
  [-0.2, 0.89, 0],
  [0.2, 0.89, 0],
  [-0.13, 0.92, 0],
  [0.13, 0.92, 0],
  [-0.13, 0.5, 0],
  [0.13, 0.5, 0],
  [-0.13, 0.08, 0],
  [0.13, 0.08, 0],
];

export const UPPER_LEG = 0.42;
export const LOWER_LEG = 0.42;
export const UPPER_ARM = 0.28;
export const LOWER_ARM = 0.26;

const rest = (i: number, j: number): number => {
  const a = REST[i]!;
  const b = REST[j]!;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

/** A distance the ragdoll keeps between two joints (a bone when min = max, a limit otherwise). */
export interface Link {
  a: number;
  b: number;
  min: number;
  max: number;
}

const bone = (a: number, b: number): Link => ({ a, b, min: rest(a, b), max: rest(a, b) });
const limit = (a: number, b: number, lo: number, hi: number): Link => ({ a, b, min: rest(a, b) * lo, max: rest(a, b) * hi });

export const LINKS: readonly Link[] = [
  // The spine and head.
  bone(J.pelvis, J.spine),
  bone(J.spine, J.neck),
  bone(J.neck, J.head),
  // Shoulders and hips.
  bone(J.neck, J.shL),
  bone(J.neck, J.shR),
  bone(J.pelvis, J.hipL),
  bone(J.pelvis, J.hipR),
  // Arms and legs.
  bone(J.shL, J.elL),
  bone(J.shR, J.elR),
  bone(J.elL, J.haL),
  bone(J.elR, J.haR),
  bone(J.hipL, J.knL),
  bone(J.hipR, J.knR),
  bone(J.knL, J.anL),
  bone(J.knR, J.anR),
  // Braces that keep the trunk a trunk.
  bone(J.shL, J.shR),
  bone(J.hipL, J.hipR),
  bone(J.shL, J.hipR),
  bone(J.shR, J.hipL),
  bone(J.shL, J.hipL),
  bone(J.shR, J.hipR),
  bone(J.spine, J.shL),
  bone(J.spine, J.shR),
  bone(J.spine, J.hipL),
  bone(J.spine, J.hipR),
  limit(J.head, J.spine, 0.9, 1.1),
  limit(J.head, J.shL, 0.85, 1.15),
  limit(J.head, J.shR, 0.85, 1.15),
  // Joints that only bend so far: a knee or an elbow cannot fold flat.
  limit(J.hipL, J.anL, 0.25, 1),
  limit(J.hipR, J.anR, 0.25, 1),
  limit(J.shL, J.haL, 0.2, 1),
  limit(J.shR, J.haR, 0.2, 1),
  // The arms do not fold through the body.
  limit(J.elL, J.hipL, 0.5, 4),
  limit(J.elR, J.hipR, 0.5, 4),
];

// ---- posing a living body ------------------------------------------------------------------------------------------

export interface PoseInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  stride: number;
  onGround: boolean;
  /** How long the gun in hand is, and whether it is held in two hands. */
  gunLength: number;
}

export interface Pose {
  joints: Float32Array;
  /** The gun's middle and which way it points. */
  gun: { x: number; y: number; z: number; dx: number; dy: number; dz: number };
}

export const createPose = (): Pose => ({ joints: new Float32Array(JOINTS * 3), gun: { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1 } });

/** Two bones from `s` toward `h` bending out toward the pole: the elbow of an arm reaching a point. */
function reach(out: Float32Array, elbow: number, sx: number, sy: number, sz: number, hx: number, hy: number, hz: number, px: number, py: number, pz: number, l1: number, l2: number): void {
  let dx = hx - sx;
  let dy = hy - sy;
  let dz = hz - sz;
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1e-6;
  }
  dx /= d;
  dy /= d;
  dz /= d;
  const dist = Math.min(d, l1 + l2 - 0.001);
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // The part of the pole direction at right angles to the arm.
  const dot = px * dx + py * dy + pz * dz;
  let ox = px - dx * dot;
  let oy = py - dy * dot;
  let oz = pz - dz * dot;
  const ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
  ox /= ol;
  oy /= ol;
  oz /= ol;
  out[elbow * 3] = sx + dx * along + ox * height;
  out[elbow * 3 + 1] = sy + dy * along + oy * height;
  out[elbow * 3 + 2] = sz + dz * along + oz * height;
}

/** Puts the joints of a living body where its animation says. */
export function poseAlive(p: PoseInput, pose: Pose): void {
  const o = pose.joints;
  const set = (j: number, x: number, y: number, z: number): void => {
    o[j * 3] = x;
    o[j * 3 + 1] = y;
    o[j * 3 + 2] = z;
  };
  const sy = Math.sin(p.yaw);
  const cy = Math.cos(p.yaw);
  const fx = -sy;
  const fz = -cy; // forward
  const rx = cy;
  const rz = -sy; // right
  const speed = Math.hypot(p.vx, p.vz);
  const run = Math.min(1, speed / 5);
  const phase = p.stride * 2.2;
  const bob = p.onGround ? Math.abs(Math.sin(phase)) * 0.035 * run : 0;
  const py = p.y + 0.92 + bob - (p.onGround ? 0 : 0.04);

  set(J.pelvis, p.x, py, p.z);
  // The trunk leans forward when running and back when looking up.
  const lean = -p.pitch * 0.3 + run * 0.14;
  const ux = fx * Math.sin(lean);
  const uy = Math.cos(lean);
  const uz = fz * Math.sin(lean);
  set(J.spine, p.x + ux * 0.28, py + uy * 0.28, p.z + uz * 0.28);
  const nx = p.x + ux * 0.54;
  const ny = py + uy * 0.54;
  const nz = p.z + uz * 0.54;
  set(J.neck, nx, ny, nz);
  const headLean = lean - p.pitch * 0.55;
  set(J.head, nx + fx * Math.sin(headLean) * 0.2, ny + Math.cos(headLean) * 0.2, nz + fz * Math.sin(headLean) * 0.2);
  const shoulder = (side: number): [number, number, number] => [nx + rx * 0.2 * side - ux * 0.0, ny - 0.03, nz + rz * 0.2 * side];
  const [slx, sly, slz] = shoulder(-1);
  const [srx, sry, srz] = shoulder(1);
  set(J.shL, slx, sly, slz);
  set(J.shR, srx, sry, srz);
  set(J.hipL, p.x - rx * 0.13, py, p.z - rz * 0.13);
  set(J.hipR, p.x + rx * 0.13, py, p.z + rz * 0.13);

  // Legs: a swing about the hip and a knee that folds on the way forward.
  for (const side of [-1, 1] as const) {
    const hipX = p.x + rx * 0.13 * side;
    const hipZ = p.z + rz * 0.13 * side;
    const ph = phase + (side > 0 ? 0 : Math.PI);
    let theta = Math.sin(ph) * 0.75 * run;
    let bend = Math.max(0, Math.cos(ph)) * 0.95 * run + 0.05 * run;
    if (!p.onGround) {
      theta = side > 0 ? 0.5 : -0.15;
      bend = 0.9;
    }
    const kx = hipX + fx * Math.sin(theta) * UPPER_LEG;
    const ky = py - Math.cos(theta) * UPPER_LEG;
    const kz = hipZ + fz * Math.sin(theta) * UPPER_LEG;
    const t2 = theta - bend;
    const ax = kx + fx * Math.sin(t2) * LOWER_LEG;
    const ay = Math.max(p.y + 0.07, ky - Math.cos(t2) * LOWER_LEG);
    const az = kz + fz * Math.sin(t2) * LOWER_LEG;
    set(side > 0 ? J.knR : J.knL, kx, ky, kz);
    set(side > 0 ? J.anR : J.anL, ax, ay, az);
  }

  // Arms: the gun is held in front of the chest, pointing where the head looks.
  const c = Math.cos(p.pitch);
  const dx = -sy * c;
  const dy = Math.sin(p.pitch);
  const dz = -cy * c;
  const gx = nx + dx * 0.3 + rx * 0.1;
  const gy = ny - 0.18 + dy * 0.3;
  const gz = nz + dz * 0.3 + rz * 0.1;
  const rhx = gx + dx * 0.04;
  const rhy = gy + dy * 0.04;
  const rhz = gz + dz * 0.04;
  const reachFront = Math.min(0.5, 0.12 + p.gunLength * 0.38);
  const lhx = gx + dx * reachFront - rx * 0.03;
  const lhy = gy + dy * reachFront;
  const lhz = gz + dz * reachFront - rz * 0.03;
  set(J.haR, rhx, rhy, rhz);
  set(J.haL, lhx, lhy, lhz);
  reach(o, J.elR, srx, sry, srz, rhx, rhy, rhz, rx * 0.8, -0.7, rz * 0.8, UPPER_ARM, LOWER_ARM);
  reach(o, J.elL, slx, sly, slz, lhx, lhy, lhz, -rx * 0.8, -0.7, -rz * 0.8, UPPER_ARM, LOWER_ARM);

  pose.gun.dx = dx;
  pose.gun.dy = dy;
  pose.gun.dz = dz;
  const mid = p.gunLength / 2 - 0.1;
  pose.gun.x = gx + dx * mid;
  pose.gun.y = gy + dy * mid;
  pose.gun.z = gz + dz * mid;
}
