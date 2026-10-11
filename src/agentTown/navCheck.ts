// Self-check for Agent Town navigation against the artwork layout:
// every station sits on open floor, every station reaches every other, and no
// smoothed path segment crosses blocked furniture.
// Run: npx tsx src/agentTown/navCheck.ts
import { STATIONS, BLOCKED, WALKABLE, Pt } from './scene';
import { findPath, isWalkable } from './navigation';
import { ROSTER } from './roster';

let failures = 0;
const fail = (msg: string) => { console.error('FAIL', msg); failures++; };

for (const [id, s] of Object.entries(STATIONS)) if (!isWalkable(s)) fail(`station ${id} is not on walkable floor`);
for (const [id, r] of Object.entries(ROSTER)) if (!STATIONS[r.home] || STATIONS[r.home].kind !== 'work') fail(`${id} home ${r.home} is not a workstation`);
const homes = Object.values(ROSTER).map(r => r.home);
if (new Set(homes).size !== homes.length) fail('two agents share a home workstation');

const ids = Object.keys(STATIONS);
let checked = 0;
for (const a of ids) {
  for (const b of ids) {
    if (a === b) continue;
    const path = findPath(STATIONS[a], STATIONS[b]);
    if (!path) { fail(`no path ${a} -> ${b}`); continue; }
    let prev: Pt = STATIONS[a];
    for (const p of path) {
      const n = Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y));
      for (let i = 0; i <= n; i++) {
        const x = prev.x + ((p.x - prev.x) * i) / n;
        const y = prev.y + ((p.y - prev.y) * i) / n;
        const inBlock = BLOCKED.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1);
        const onFloor = WALKABLE.some(([x0, y0, x1, y1]) => x >= x0 - 3 && x <= x1 + 3 && y >= y0 - 3 && y <= y1 + 3);
        if (inBlock || !onFloor) { fail(`${a} -> ${b} leaves open floor at (${x.toFixed(0)}, ${y.toFixed(0)})`); break; }
      }
      prev = p;
    }
    checked++;
  }
}
console.log(failures ? `${failures} navigation problems` : `OK: ${ids.length} stations on open floor, ${checked} routes clear`);
process.exitCode = failures ? 1 : 0;
