// Self-check for the Agent Town work state machine (IDLE / WORKING_SOLO / WORKING_GROUP) against
// a fake agent grid. Run: npx tsx --import ./src/agentTown/assetStub.mjs src/agentTown/townState.check.ts
import assert from 'node:assert/strict';
import { TownSim } from './behavior';
import type { AgentStore, AgentLive, WorkState, Demand } from './agentStore';
import { ROSTER } from './roster';
import { STATIONS, GROUP_ROOMS } from './scene';

const agents = new Map<string, AgentLive>();
const store = { online: true, loaded: true, agents } as unknown as AgentStore;
const set = (id: string, work: WorkState, demand: Demand = null, groupId?: string) =>
  agents.set(id, { agent: { id, name: id, role: id, status: 'IDLE', mode: work === 'IDLE' ? 'ROAMING' : work === 'WORKING_SOLO' ? 'OFFICE' : 'SWARM', taskId: groupId }, demand, work, groupId });
for (const id of Object.keys(ROSTER)) set(id, 'IDLE');

const sim = new TownSim(store);
let now = 0;
const run = (secs: number, each?: () => void) => { for (let t = 0; t < secs * 20; t++) { now += 50; sim.update(now, 0.05); each?.(); } };
const at = (id: string, station: string) => { const a = sim.actors.get(id)!; const s = STATIONS[station]; return Math.hypot(a.x - s.x, a.y - s.y) < 3; };

run(20);
assert.equal(sim.actors.size, 8, 'all 8 roster agents are in town');

// WORKING_SOLO: CODE goes to its own desk and stays there, working, until released.
set('CODE', 'WORKING_SOLO', 'WORKING', 'tA');
run(15);
assert.ok(at('CODE', ROSTER.CODE.home), 'solo agent reached its desk');
let leftDesk = false;
set('CODE', 'WORKING_SOLO', 'HELP', 'tA'); // consulting a colleague...
run(20, () => { if (!at('CODE', ROSTER.CODE.home)) leftDesk = true; });
assert.equal(leftDesk, false, 'a solo agent never leaves its desk, not even to ask for help');
assert.equal(sim.actors.get('CODE')!.state, 'HELPING');
set('CODE', 'WORKING_SOLO', 'WAITING', 'tA'); // between model calls
run(10, () => { if (!at('CODE', ROSTER.CODE.home)) leftDesk = true; });
assert.equal(leftDesk, false, 'still locked while waiting for the backend');

// WORKING_GROUP: a task force gathers in ONE room and stays there.
for (const id of ['GAME', 'SOCIAL', 'SEC']) set(id, 'WORKING_GROUP', 'SWARM', 'tB');
run(25);
const seatsOf = (ids: string[]) => ids.map(id => GROUP_ROOMS.find(r => r.seats.some(s => at(id, s)))?.id);
assert.deepEqual(seatsOf(['GAME', 'SOCIAL', 'SEC']), ['command', 'command', 'command'], 'task force shares the command table');
const pos = ['GAME', 'SOCIAL', 'SEC'].map(id => { const a = sim.actors.get(id)!; return `${a.x},${a.y}`; });
assert.equal(new Set(pos).size, 3, 'each member has its own seat');
let moved = false;
const before = pos.join();
run(20, () => { if (['GAME', 'SOCIAL', 'SEC'].map(id => { const a = sim.actors.get(id)!; return `${a.x},${a.y}`; }).join() !== before) moved = true; });
assert.equal(moved, false, 'task force stays locked in its room');
assert.ok(['GAME', 'SOCIAL', 'SEC'].every(id => sim.actors.get(id)!.state === 'SWARMING'));

// A second, concurrent task force gets its own room.
for (const id of ['WRITE', 'ATLAS']) set(id, 'WORKING_GROUP', 'SWARM', 'tC');
run(30);
assert.deepEqual(seatsOf(['WRITE', 'ATLAS']), ['lounge', 'lounge'], 'second task force takes the lounge');
assert.equal(sim.describe('WRITE')!.mode, 'WORKING_GROUP');
assert.equal(sim.describe('CODE')!.mode, 'WORKING_SOLO');

// Completion: released agents return to idle life (and can leave).
for (const id of ['CODE', 'GAME', 'SOCIAL', 'SEC', 'WRITE', 'ATLAS']) set(id, 'IDLE');
run(60);
assert.equal(sim.describe('CODE')!.mode, 'IDLE');
assert.ok(['GAME', 'SOCIAL', 'SEC'].some(id => !['SWARMING', 'WORKING'].includes(sim.actors.get(id)!.state)), 'released agents resume idle behaviour');

console.log('townState: all checks passed');
