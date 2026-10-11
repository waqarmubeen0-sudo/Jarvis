// Live smoke test of the Orbit private computer (boots a headless browser, uses the network).
// Run: npx tsx orbit.check.ts
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { orbit, ORBIT_PROFILE } from './orbit';

const states: string[] = [];
let frames = 0;
orbit.onChange((k) => { if (k === 'frame' && orbit.frame) frames++; else if (states.at(-1) !== orbit.state) states.push(orbit.state); });

await orbit.start();
assert.equal(orbit.state, 'READY');

// The private browser runs with its own profile, never the user's.
const cmd = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*jarvis-orbit*' -and $_.CommandLine -like '*remote-debugging-port*' } | Select-Object -First 1).CommandLine"`).toString();
assert.ok(cmd.includes(ORBIT_PROFILE) && cmd.includes('--headless'), 'isolated profile + headless');

const r = await orbit.research('WebGL specification', 'ATLAS');
console.log('sources:', r.sources.map((s) => `${s.title} <${s.url}> ${s.excerpt.length} chars`));
assert.ok(r.sources.length >= 1, 'research read at least one real page');
assert.ok(frames > 3, `live screen frames streamed (${frames})`);
assert.equal(orbit.state, 'IDLE', 'stays alive for reuse after the job');

const b = await orbit.browse('example.com');
assert.match(b.url, /example\.com/);

await orbit.stop();
assert.equal(orbit.state, 'OFF');
console.log('lifecycle:', states.join(' -> '), `| frames: ${frames}`);
console.log('orbit: all checks passed');
process.exit(0);
