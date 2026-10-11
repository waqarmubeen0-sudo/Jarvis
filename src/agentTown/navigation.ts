// Grid pathfinding over the authored walkable/blocked areas: A* with
// 8-way moves (no corner cutting) followed by line-of-sight smoothing.
import { WALKABLE, BLOCKED, ART_W, ART_H, Pt, Box } from './scene';

const CELL = 6;
const CLEARANCE = 6; // keep feet this far from furniture (sized for the enlarged agents)
const GW = Math.ceil(ART_W / CELL);
const GH = Math.ceil(ART_H / CELL);

const inside = (x: number, y: number, [x0, y0, x1, y1]: Box, pad = 0) => x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;

const grid = new Uint8Array(GW * GH);
for (let gy = 0; gy < GH; gy++) {
  for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + CELL / 2;
    const y = gy * CELL + CELL / 2;
    grid[gy * GW + gx] = WALKABLE.some(b => inside(x, y, b)) && !BLOCKED.some(b => inside(x, y, b, CLEARANCE)) ? 1 : 0;
  }
}

const cellOf = (p: Pt) => [Math.min(GW - 1, Math.max(0, Math.floor(p.x / CELL))), Math.min(GH - 1, Math.max(0, Math.floor(p.y / CELL)))] as const;
const open = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx < GW && gy < GH && grid[gy * GW + gx] === 1;

export const isWalkable = (p: Pt) => { const [gx, gy] = cellOf(p); return open(gx, gy); };

// Nearest walkable cell (BFS) for points that land on a blocked cell.
function nearestOpen(gx: number, gy: number): [number, number] | null {
  if (open(gx, gy)) return [gx, gy];
  const seen = new Uint8Array(GW * GH);
  const q: number[] = [gy * GW + gx];
  seen[gy * GW + gx] = 1;
  for (let i = 0; i < q.length && i < 20000; i++) {
    const k = q[i];
    const x = k % GW;
    const y = (k - x) / GW;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const nk = ny * GW + nx;
      if (seen[nk]) continue;
      if (grid[nk]) return [nx, ny];
      seen[nk] = 1;
      q.push(nk);
    }
  }
  return null;
}

// Straight segment stays on open cells (sampled every half cell).
function lineClear(a: Pt, b: Pt) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 2));
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    if (!isWalkable(p)) return false;
  }
  return true;
}

// Binary min-heap keyed by f-score.
class Heap {
  private k: number[] = [];
  private f: number[] = [];
  get size() { return this.k.length; }
  push(key: number, score: number) {
    this.k.push(key); this.f.push(score);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.f[p], this.f[i]] = [this.f[i], this.f[p]];
      i = p;
    }
  }
  pop() {
    const top = this.k[0];
    const lk = this.k.pop()!;
    const lf = this.f.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.f[0] = lf;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.f[l] < this.f[m]) m = l;
        if (r < this.k.length && this.f[r] < this.f[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.f[m], this.f[i]] = [this.f[i], this.f[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** Waypoints from `from` to `to` (excluding the start), or null when unreachable. */
export function findPath(from: Pt, to: Pt): Pt[] | null {
  const s = nearestOpen(...cellOf(from));
  const t = nearestOpen(...cellOf(to));
  if (!s || !t) return null;
  const start = s[1] * GW + s[0];
  const goal = t[1] * GW + t[0];
  const g = new Float32Array(GW * GH).fill(Infinity);
  const prev = new Int32Array(GW * GH).fill(-1);
  const closed = new Uint8Array(GW * GH);
  const h = (k: number) => {
    const dx = Math.abs((k % GW) - t[0]);
    const dy = Math.abs(Math.floor(k / GW) - t[1]);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new Heap();
  g[start] = 0;
  heap.push(start, h(start));
  while (heap.size) {
    const k = heap.pop();
    if (closed[k]) continue;
    if (k === goal) break;
    closed[k] = 1;
    const x = k % GW;
    const y = (k - x) / GW;
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!open(nx, ny) || (dx && dy && (!open(x + dx, y) || !open(x, y + dy)))) continue;
      const nk = ny * GW + nx;
      const ng = g[k] + cost;
      if (ng < g[nk]) { g[nk] = ng; prev[nk] = k; heap.push(nk, ng + h(nk)); }
    }
  }
  if (start !== goal && prev[goal] === -1) return null;

  const cells: Pt[] = [];
  for (let k = goal; k !== -1 && k !== start; k = prev[k]) cells.unshift({ x: (k % GW) * CELL + CELL / 2, y: Math.floor(k / GW) * CELL + CELL / 2 });
  const end = isWalkable(to) ? to : cells[cells.length - 1] ?? from;
  const raw = [from, ...cells, end];

  // String-pull: keep only the waypoints needed to stay on open floor.
  const out: Pt[] = [];
  let anchor = raw[0];
  let i = 1;
  while (i < raw.length) {
    let j = raw.length - 1;
    while (j > i && !lineClear(anchor, raw[j])) j--;
    out.push(raw[j]);
    anchor = raw[j];
    i = j + 1;
  }
  return out;
}
