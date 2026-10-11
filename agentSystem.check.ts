// Self-check for the multi-agent framework, with a fake model (no API calls).
// Run: npx tsx agentSystem.check.ts
import assert from 'node:assert/strict';
import {
  AGENT_REGISTRY, SPECIALISTS, MANAGER, agentLogs, setAgentModel, processMultiAgentTask, taskFinished,
  controlAgents, managerReport, teamTelemetry, subscribeAgentEvents, parseManagerRoute, managerRoute, setRetryDelays, setCallGap, quickDirect,
} from './agentSystem';

setRetryDelays([5, 5]); // keep the self-check fast
setCallGap(0); // no quota stagger while testing (checked separately below)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRouting = (sys: string) => sys.includes('Manager of the J.A.R.V.I.S. agent team');
const plans: Record<string, object> = {};
let codeBlockedOnce = true;
const seenModes: string[] = [];
const events: string[] = [];
subscribeAgentEvents((type, p) => {
  events.push(type);
  if (type === 'agent_status_change') seenModes.push(`${p.agentId}:${p.mode}`);
});

// Fake model: the Manager answers from `plans`; CODE asks SEC for help once; SOCIAL is slow; others echo.
setAgentModel(async (sys, contents) => {
  const text = contents[contents.length - 1].parts[0].text;
  if (isRouting(sys)) {
    const key = Object.keys(plans).find((k) => text.split(/\r?\n/)[0].includes(k)); // the Request line only
    return key ? JSON.stringify(plans[key]) : '{"route":"DIRECT","reason":"chat"}';
  }
  const who = sys.match(/^You are (\w+)/)![1];
  await sleep(who === 'SOCIAL' ? 150 : 40);
  if (who === 'CODE' && text.includes('BLOCKED:') && codeBlockedOnce) { codeBlockedOnce = false; return 'BLOCKED: SEC: which hashing algorithm is safe?'; }
  return `${who} output`;
});

// Roster: the 8 Agent Town agents, every one with a master specialty and a secondary capacity.
assert.deepEqual([...SPECIALISTS], ['CODE', 'GAME', 'WRITE', 'PROMPT', 'SEC', 'SOCIAL', 'ATLAS']);
assert.deepEqual(Object.keys(AGENT_REGISTRY).sort(), ['ATLAS', 'CODE', 'GAME', 'NEX', 'PROMPT', 'SEC', 'SOCIAL', 'WRITE']);
for (const a of Object.values(AGENT_REGISTRY)) {
  assert.match(a.systemPrompt, /master specialty/, `${a.id} has a master specialty`);
  assert.match(a.systemPrompt, /multi-talented[\s\S]*secondary capacity/, `${a.id} can work in a secondary capacity`);
}
assert.ok(Object.values(AGENT_REGISTRY).every((a) => a.mode === 'ROAMING' && !a.paused), 'everyone starts roaming');
assert.match(agentLogs[agentLogs.length - 1].message, /idle and roaming/);

// Manager output is validated strictly.
const P = (o: object) => JSON.stringify(o);
assert.equal(parseManagerRoute(P({ route: 'DIRECT' }), 'hi').route, 'DIRECT');
assert.deepEqual(parseManagerRoute(P({ route: 'SOLO', agent: { agentId: 'code', instruction: 'fix it' } }), 'x').assignments, [{ agentId: 'CODE', instruction: 'fix it', research: undefined }]);
const big = parseManagerRoute(P({ route: 'TASK_FORCE', taskForce: ['CODE', 'SEC', 'CODE', 'NEX', 'GHOST', 'WRITE', 'SOCIAL', 'GAME'].map((agentId) => ({ agentId, instruction: agentId })) }), 'x');
assert.equal(big.route, 'TASK_FORCE');
assert.deepEqual(big.assignments.map((a) => a.agentId), ['CODE', 'SEC', 'WRITE', 'SOCIAL'], 'task force: 2-4 distinct specialists, no manager, no unknown ids');
assert.equal(parseManagerRoute(P({ route: 'TASK_FORCE', taskForce: [{ agentId: 'SEC', instruction: 'a' }, { agentId: 'NEX' }] }), 'x').route, 'SOLO', 'a one-agent "task force" is a solo task');
assert.equal(parseManagerRoute(P([{ agentId: 'CODE' }, { agentId: 'SEC' }]), 'x').route, 'TASK_FORCE', 'a bare JSON array is a task force');
assert.equal(parseManagerRoute('not json at all', 'x').route, 'DIRECT', 'unreadable output falls back to JARVIS');
assert.deepEqual(parseManagerRoute('', 'fix this python bug', true).assignments.map((a) => a.agentId), ['CODE'], 'work that must go to an agent uses a keyword fallback');
assert.equal(parseManagerRoute(P({ route: 'DIRECT' }), 'write my email', true).route, 'SOLO', 'delegated work is never DIRECT');

// Routing uses the lightweight model and falls back to the main model when it fails.
const calledModels: (string | undefined)[] = [];
setAgentModel(async (sys, _c, _k, opts) => {
  calledModels.push(opts?.model);
  if (opts?.model) throw new Error('404 model not found');
  return P({ route: 'SOLO', agent: { agentId: 'WRITE', instruction: 'email' } });
});
const fb = await managerRoute('write an email to my landlord', 'key');
assert.equal(fb.route, 'SOLO');
assert.deepEqual(calledModels, ['gemini-flash-lite-latest', undefined], 'lite model first, main model as fallback');
assert.ok(events.includes('manager_route'), 'routing decisions are broadcast to the UI');

// Restore the scripted fake model.
setAgentModel(async (sys, contents) => {
  const text = contents[contents.length - 1].parts[0].text;
  if (isRouting(sys)) {
    const key = Object.keys(plans).find((k) => text.split(/\r?\n/)[0].includes(k)); // the Request line only
    return key ? JSON.stringify(plans[key]) : '{"route":"DIRECT","reason":"chat"}';
  }
  const who = sys.match(/^You are (\w+)/)![1];
  await sleep(who === 'SOCIAL' ? 150 : 40);
  if (who === 'CODE' && text.includes('BLOCKED:') && codeBlockedOnce) { codeBlockedOnce = false; return 'BLOCKED: SEC: which hashing algorithm is safe?'; }
  return `${who} output`;
});

// 1) SOLO: the Manager assigns CODE; CODE gets blocked, consults SEC, then finishes.
plans['login form'] = { route: 'SOLO', agent: { agentId: 'CODE', instruction: 'build a login form' } };
const t1 = await processMultiAgentTask('login form feature', 'key');
// 2) A second task that also needs CODE must wait: CODE is locked in Office Mode on t1.
plans['refactor'] = { route: 'SOLO', agent: { agentId: 'CODE', instruction: 'refactor utils' } };
await sleep(20);
const t2 = await processMultiAgentTask('refactor helpers', 'key');
await sleep(60);
assert.equal(t1.route, 'SOLO');
assert.equal(AGENT_REGISTRY.CODE.taskId, t1.id, 'CODE is locked to its first assignment');
assert.equal(t2.status, 'QUEUED', 'second task waits for CODE to leave the office');
assert.match(t2.blockers.join(), /CODE is in Office Mode/);
assert.equal(AGENT_REGISTRY[MANAGER].mode, 'OFFICE', 'manager is monitoring');

await taskFinished(t1.id);
assert.equal(t1.status, 'COMPLETED');
assert.equal(t1.steps[0].helpedBy, 'SEC', 'blocked CODE was helped by SEC');
assert.ok(seenModes.includes('CODE:HELPING') && seenModes.includes('CODE:OFFICE'), 'CODE consulted a colleague and went back to its task');
assert.equal(managerReport(t1).percentComplete, 100);
assert.ok(agentLogs.some((l) => l.type === 'REPORT' && /% complete, \d+% left/.test(l.message)), 'manager reports % done / left to JARVIS');
await taskFinished(t2.id);
assert.equal(t2.status, 'COMPLETED', 'queued task ran once CODE was free');

// 3) TASK_FORCE: agents work concurrently and stay together until the whole task completes.
plans['game launch'] = { route: 'TASK_FORCE', taskForce: [{ agentId: 'GAME', instruction: 'build the game loop' }, { agentId: 'SOCIAL', instruction: 'launch posts' }] };
const t3 = await processMultiAgentTask('game launch campaign', 'key');
await sleep(25);
assert.equal(t3.route, 'TASK_FORCE');
assert.equal(t3.mode, 'SWARM');
assert.ok(t3.steps.every((s) => s.status === 'RUNNING'), 'task force members work at the same time');
assert.ok(AGENT_REGISTRY.GAME.mode === 'SWARM' && AGENT_REGISTRY.SOCIAL.mode === 'SWARM', 'task force shares one room');
await sleep(80); // GAME (40ms) is done, SOCIAL (150ms) is still working
assert.equal(t3.steps[0].status, 'COMPLETED');
assert.equal(AGENT_REGISTRY.GAME.mode, 'SWARM', 'a finished member stays locked with the task force');
await taskFinished(t3.id);
assert.equal(t3.status, 'COMPLETED');
assert.equal(AGENT_REGISTRY.GAME.mode, 'ROAMING', 'released back to roaming when the task completes');

// 4) An explicit target skips routing; JARVIS overrides: pause, re-route pending work, resume.
controlAgents({ action: 'pause', agentId: 'PROMPT' });
const t4 = await processMultiAgentTask('security audit memo', 'key', 'PROMPT');
await sleep(400);
assert.equal(t4.route, 'SOLO');
assert.equal(t4.steps[0].status, 'PENDING', 'paused agent does not start');
assert.equal(controlAgents({ action: 'reroute', agentId: 'PROMPT', toAgent: 'SEC' }).status, 'SUCCESS');
assert.equal(t4.steps[0].agentId, 'SEC', 'pending work re-routed');
assert.equal(AGENT_REGISTRY.PROMPT.mode, 'ROAMING', 'rerouted-away agent is released');
controlAgents({ action: 'resume', agentId: 'PROMPT' });
await taskFinished(t4.id);
assert.equal(t4.status, 'COMPLETED');
assert.equal(controlAgents({ action: 'fly' }).status, 'FAILED');

// 5) Quota / outage errors skip the Help Protocol and surface as a clear blocker.
let helperCalls = 0;
setAgentModel(async (sys, contents) => {
  const text = contents[contents.length - 1].parts[0].text;
  if (isRouting(sys)) return P({ route: 'SOLO', agent: { agentId: 'SOCIAL', instruction: 'post' } });
  if (sys.startsWith('You are SOCIAL')) throw new Error('{"error":{"code":429,"message":"You exceeded your current quota"}}');
  if (text.includes('needs brief help')) helperCalls++;
  return 'ok';
});
const t5 = await processMultiAgentTask('quota test', 'key');
await taskFinished(t5.id);
assert.equal(helperCalls, 0, 'no colleague is consulted for a quota error');
assert.equal(t5.steps[0].helpedBy, undefined);
assert.match(t5.steps[0].error!, /quota exceeded/i, 'friendly quota message');
assert.equal(t5.status, 'FAILED');
assert.match(t5.finalResult!, /^Nothing was completed\. SOCIAL: .*quota/i, 'a task where every step failed says so plainly');

// 6) Transient errors are retried in place, and finished work survives a failed summary.
let flaky = 0;
setAgentModel(async (sys) => {
  if (isRouting(sys)) return P({ route: 'TASK_FORCE', taskForce: [{ agentId: 'CODE', instruction: 'a' }, { agentId: 'WRITE', instruction: 'b' }] });
  if (sys.startsWith('You are CODE') && flaky++ === 0) throw new Error('503 UNAVAILABLE: model overloaded');
  if (sys.startsWith('You are NEX')) throw new Error('429 RESOURCE_EXHAUSTED');
  return sys.startsWith('You are CODE') ? 'CODE part' : 'WRITE part';
});
const t6 = await processMultiAgentTask('retry test', 'key');
await taskFinished(t6.id);
assert.equal(t6.steps[0].status, 'COMPLETED', 'a transient error is retried, not failed');
assert.equal(t6.status, 'COMPLETED');
assert.match(t6.finalResult!, /CODE part[\s\S]*WRITE part/, 'finished parts are kept when the summary fails');

// 7) Quota stagger: concurrent task-force calls start at least the configured gap apart.
const starts: number[] = [];
setAgentModel(async (sys) => {
  if (isRouting(sys)) return P({ route: 'TASK_FORCE', taskForce: [{ agentId: 'CODE', instruction: 'a' }, { agentId: 'WRITE', instruction: 'b' }, { agentId: 'SEC', instruction: 'c' }] });
  if (!sys.startsWith('You are NEX')) starts.push(Date.now());
  return 'part';
});
setCallGap(150);
const t7 = await processMultiAgentTask('stagger test', 'key');
await taskFinished(t7.id);
setCallGap(0);
assert.equal(starts.length, 3);
// Calls are scheduled on a shared clock (slot i starts at i × gap); timers may wake a little late,
// so check each call against its slot rather than the gap to the previous (possibly late) call.
assert.ok(starts.every((t, i) => t - starts[0] >= i * 150 - 15), `agent calls are staggered (${starts.map((t) => t - starts[0]).join(', ')} ms)`);

assert.ok(teamTelemetry().agents.every((a) => a.mode === 'ROAMING'), 'everyone roaming again at the end');
// Instant routing: obvious JARVIS turns skip NEX's LLM call; real work still goes to NEX.
for (const p of ['Jarvis, how are you?', 'hello', 'thanks Jarvis', 'Jarvis, tell me a joke', 'Jarvis, tell me a short joke.', 'open YouTube', 'Jarvis, open VS Code', 'check my email', 'remind me tomorrow to call Sam',
  "what's on my screen?", 'Jarvis, Orbit mode', 'play some music', 'search youtube for lofi', 'switch to Chrome', 'what time is it in Tokyo'])
  assert.equal(quickDirect(p), true, `instant: ${p}`);
for (const p of ['create a Snake game', 'build a simple webpage', 'research the James Webb telescope', 'open VS Code and build me a website', 'write a blog post about AI',
  'this code is driving me crazy', 'review my login code for security issues', 'make a python script that renames files'])
  assert.equal(quickDirect(p), false, `to NEX: ${p}`);
console.log('agentSystem: all checks passed');
