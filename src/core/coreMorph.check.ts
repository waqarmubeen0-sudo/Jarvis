// Self-check for the core morph driver. Run: npx tsx src/core/coreMorph.check.ts
import assert from 'node:assert/strict';
import { CoreDrive, DriveInput, VORTEX, MIXED, BLOOM, FLOWER, BRANCH, BURST } from './coreMorph';

const dt = 1 / 60;
const idle: DriveInput = { status: 'ONLINE', isProcessing: false, isMicMuted: false, input: 0, output: 0 };

const run = (d: CoreDrive, secs: number, s: DriveInput) => {
  let maxStep = 0;
  for (let f = 0; f < secs / dt; f++) {
    const before = Array.from(d.w);
    d.update(dt, s);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      assert.ok(d.w[i] >= -1e-6, `weight ${i} negative`);
      sum += d.w[i];
      maxStep = Math.max(maxStep, Math.abs(d.w[i] - before[i]));
    }
    assert.ok(Math.abs(sum - 1) < 1e-3, `weights sum ${sum}`);
  }
  return maxStep;
};

const d = new CoreDrive();
// Idle for two full cycles: morphing is continuous (no frame jumps more than ~3%).
assert.ok(run(d, 100, idle) < 0.03, 'morph must be continuous');
assert.ok(d.neuralT > 0 && d.energy < 0.01, 'idle keeps animating with no energy');

// Processing pulls the core into vortex / mixed vortex.
run(d, 6, { ...idle, isProcessing: true });
assert.ok(d.w[VORTEX] + d.w[MIXED] > 0.55, `processing → vortex (${d.w[VORTEX] + d.w[MIXED]})`);

// User speaking → thinking (branching / burst), with heartbeats.
const talk = new CoreDrive();
let waves = 0;
for (let f = 0; f < 5 / dt; f++) {
  talk.update(dt, { ...idle, status: 'LISTENING', input: f % 40 < 20 ? 0.35 : 0.08 });
  if (talk.newWave) waves++;
}
assert.ok(talk.w[BRANCH] + talk.w[BURST] > 0.45, 'listening → branching/burst');
assert.ok(waves >= 5, `speaking must heartbeat (${waves})`);
// Muted mic ignores the input level.
const muted = new CoreDrive();
run(muted, 2, { ...idle, isMicMuted: true, input: 0.5 });
assert.ok(muted.energy < 0.01, 'muted mic must not energise the core');

// JARVIS responding → bloom / flower, then returns.
const resp = new CoreDrive();
run(resp, 1.5, { ...idle, status: 'SPEAKING', output: 0.3 });
assert.ok(resp.w[BLOOM] + resp.w[FLOWER] > 0.4, 'responding → bloom');

// Error: red disturbance that decays back to normal.
const e = new CoreDrive();
run(e, 1, idle);
e.error();
run(e, 0.2, idle);
assert.ok(e.err > 0.5, 'error disturbance');
run(e, 8, idle);
assert.equal(e.err, 0, 'error must settle');

// Node click sends a pulse that reaches the core.
const c = new CoreDrive();
run(c, 0.5, idle);
c.click(2);
run(c, 0.7, idle);
assert.ok(c.burst[2] > 0.6, 'click pulse travels into the core');

// Silent / missing audio never breaks the driver and still beats gently.
const quiet = new CoreDrive();
let peak = 0;
for (let f = 0; f < 4 / dt; f++) {
  quiet.update(dt, { ...idle, input: NaN, output: undefined as unknown as number });
  peak = Math.max(peak, quiet.beat);
  assert.ok(Number.isFinite(quiet.glow) && Number.isFinite(quiet.beat), 'no NaN from missing audio');
}
assert.ok(quiet.energy === 0 && peak > 0.1, `simulated heartbeat when silent (${peak})`);

console.log('coreMorph: all checks passed');
