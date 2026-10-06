/**
 * Finding a way across the map. A* over the cell grid (8 directions, never cutting a corner), then the route
 * is straightened wherever a unit's width can go straight. All plain arithmetic, so it is exactly the same on
 * every device.
 */

export interface Route {
  /** Waypoints to walk, x0, y0, x1, y1, ... (the start is not included). */
  points: number[];
  /** False when the goal could not be reached and the route ends at the nearest point. */
  complete: boolean;
}

const SQRT2 = 1.4142135623730951;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Reusable buffers for a map of a given size. Searches are one after another, never at once. */
export class Pathfinder {
  private readonly size: number;
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly stamp: Int32Array;
  private readonly closed: Uint8Array;
  private heapKeys: Float32Array;
  private heapNodes: Int32Array;
  private heapSize = 0;
  private generation = 0;

  constructor(size: number) {
    this.size = size;
    const n = size * size;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.heapKeys = new Float32Array(n * 4);
    this.heapNodes = new Int32Array(n * 4);
  }

  private push(key: number, node: number): void {
    let i = this.heapSize++;
    if (i >= this.heapKeys.length) {
      const keys = new Float32Array(this.heapKeys.length * 2);
      const nodes = new Int32Array(this.heapNodes.length * 2);
      keys.set(this.heapKeys);
      nodes.set(this.heapNodes);
      this.heapKeys = keys;
      this.heapNodes = nodes;
    }
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.heapKeys[p] ?? 0) <= key) break;
      this.heapKeys[i] = this.heapKeys[p] ?? 0;
      this.heapNodes[i] = this.heapNodes[p] ?? 0;
      i = p;
    }
    this.heapKeys[i] = key;
    this.heapNodes[i] = node;
  }

  private pop(): number {
    const top = this.heapNodes[0] ?? 0;
    this.heapSize -= 1;
    const key = this.heapKeys[this.heapSize] ?? 0;
    const node = this.heapNodes[this.heapSize] ?? 0;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.heapSize) break;
      if (child + 1 < this.heapSize && (this.heapKeys[child + 1] ?? 0) < (this.heapKeys[child] ?? 0)) child += 1;
      if ((this.heapKeys[child] ?? 0) >= key) break;
      this.heapKeys[i] = this.heapKeys[child] ?? 0;
      this.heapNodes[i] = this.heapNodes[child] ?? 0;
      i = child;
    }
    this.heapKeys[i] = key;
    this.heapNodes[i] = node;
    return top;
  }

  /** The free cell nearest to (x, y), searching in growing squares; -1 if none within `reach`. */
  nearestFree(blocked: Uint8Array, x: number, y: number, reach = 10): number {
    const s = this.size;
    const cx = Math.min(s - 1, Math.max(0, Math.floor(x)));
    const cy = Math.min(s - 1, Math.max(0, Math.floor(y)));
    if (blocked[cy * s + cx] === 0) return cy * s + cx;
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= reach; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= s || ny >= s || blocked[ny * s + nx] === 1) continue;
          const d = (nx + 0.5 - x) * (nx + 0.5 - x) + (ny + 0.5 - y) * (ny + 0.5 - y);
          if (d < bestD) {
            bestD = d;
            best = ny * s + nx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Whether a unit of `radius` can walk the straight line from (x0, y0) to (x1, y1) without touching a blocked cell. */
  lineClear(blocked: Uint8Array, x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
    const s = this.size;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1e-6) return true;
    const nx = (-dy / length) * radius;
    const ny = (dx / length) * radius;
    const steps = Math.max(1, Math.ceil(length / 0.25));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      for (const side of [0, 1, -1]) {
        const px = Math.floor(x + nx * side);
        const py = Math.floor(y + ny * side);
        if (px < 0 || py < 0 || px >= s || py >= s || blocked[py * s + px] === 1) return false;
      }
    }
    return true;
  }

  /**
   * The route from (sx, sy) to (tx, ty). If the goal is blocked the route goes to the nearest free cell; if it
   * cannot be reached it goes as close as it can (`complete` is false). Null if there is nowhere to go.
   */
  find(blocked: Uint8Array, sx: number, sy: number, tx: number, ty: number, radius = 0.35): Route | null {
    const s = this.size;
    const start = this.nearestFree(blocked, sx, sy, 4);
    const goal = this.nearestFree(blocked, tx, ty, 10);
    if (start < 0 || goal < 0) return null;
    const goalX = goal % s;
    const goalY = (goal - goalX) / s;
    const startX = start % s;
    const startY = (start - startX) / s;
    const goalExact = Math.floor(tx) === goalX && Math.floor(ty) === goalY;
    if (start === goal) return { points: [goalExact ? tx : goalX + 0.5, goalExact ? ty : goalY + 0.5], complete: true };

    this.generation += 1;
    const gen = this.generation;
    const octile = (x: number, y: number): number => {
      const dx = Math.abs(x - goalX);
      const dy = Math.abs(y - goalY);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    this.stamp[start] = gen;
    this.g[start] = 0;
    this.parent[start] = -1;
    this.closed[start] = 0;
    this.heapSize = 0;
    this.push(octile(startX, startY), start);
    let best = start;
    let bestH = octile(startX, startY);
    let found = false;
    let expanded = 0;

    while (this.heapSize > 0 && expanded < s * s) {
      const node = this.pop();
      if (this.stamp[node] === gen && this.closed[node] === 1) continue;
      this.closed[node] = 1;
      expanded += 1;
      if (node === goal) {
        found = true;
        break;
      }
      const x = node % s;
      const y = (node - x) / s;
      const h = octile(x, y);
      if (h < bestH) {
        bestH = h;
        best = node;
      }
      const base = this.g[node] ?? 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + (DX[d] ?? 0);
        const ny = y + (DY[d] ?? 0);
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const n = ny * s + nx;
        if (blocked[n] === 1) continue;
        const diagonal = d >= 4;
        if (diagonal && (blocked[y * s + nx] === 1 || blocked[ny * s + x] === 1)) continue;
        const cost = base + (diagonal ? SQRT2 : 1);
        if (this.stamp[n] === gen) {
          if (this.closed[n] === 1 || cost >= (this.g[n] ?? Infinity)) continue;
        } else {
          this.stamp[n] = gen;
          this.closed[n] = 0;
        }
        this.g[n] = cost;
        this.parent[n] = node;
        this.push(cost + octile(nx, ny), n);
      }
    }

    const end = found ? goal : best;
    if (end === start) return null;
    const cells: number[] = [];
    for (let c = end; c !== -1; c = this.parent[c] ?? -1) cells.push(c);
    cells.reverse(); // start ... end
    const xs: number[] = [];
    const ys: number[] = [];
    for (const c of cells) {
      const x = c % s;
      xs.push(x + 0.5);
      ys.push((c - x) / s + 0.5);
    }
    // The route starts from where the unit really is, not from the middle of its cell.
    xs[0] = sx;
    ys[0] = sy;
    if (found && goalExact) {
      xs[xs.length - 1] = tx;
      ys[ys.length - 1] = ty;
    }

    // Straighten: from each point, jump as far ahead as a straight line stays clear.
    const points: number[] = [];
    let at = 0;
    while (at < xs.length - 1) {
      let far = xs.length - 1;
      while (far > at + 1 && !this.lineClear(blocked, xs[at] ?? 0, ys[at] ?? 0, xs[far] ?? 0, ys[far] ?? 0, radius)) far -= 1;
      points.push(xs[far] ?? 0, ys[far] ?? 0);
      at = far;
    }
    return { points, complete: found };
  }
}
