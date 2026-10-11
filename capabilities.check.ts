// Self-check for the capability layer. Run: npx tsx capabilities.check.ts
// Uses scratch files for settings / activity / automations, so the real ones are untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cap-'));
process.env.JARVIS_SETTINGS_FILE = path.join(tmp, 'settings.json');
process.env.JARVIS_ACTIVITY_FILE = path.join(tmp, 'activity.jsonl');
process.env.JARVIS_AUTOMATIONS_FILE = path.join(tmp, 'automations.json');
process.env.JARVIS_PROJECTS_DIR = path.join(tmp, 'projects');

const S = await import('./apiSettings');
const P = await import('./permissions');
const A = await import('./activity');
const R = await import('./skillRegistry');
const T = await import('./terminal');
const Au = await import('./automation');
const Pr = await import('./proactive');
const B = await import('./builder');
const RT = await import('./runtimeTest');
const { parseKeys } = await import('./pcControl');
await import('./skills');

// 1) Defaults match the Permission Center spec; purchases can never be ON.
const perms = S.getConfig().permissions;
assert.deepEqual([perms.PC_CONTROL, perms.BROWSER, perms.SCREEN, perms.FILE_ACCESS, perms.EMAIL_READ, perms.EMAIL_SEND, perms.FILE_DELETE, perms.SOFTWARE_INSTALL, perms.MEMORY, perms.AUTOMATION, perms.PURCHASES],
  ['ON', 'ON', 'ON', 'ON', 'ON', 'ASK', 'ASK', 'ASK', 'ASK', 'ON', 'OFF']);
assert.equal(S.saveConfig({ permissions: { PURCHASES: 'ON' } }).permissions.PURCHASES, 'ASK', 'purchases are at most ASK');
S.saveConfig({ permissions: { PURCHASES: 'OFF' } });

// 2) The gate: OFF refuses, ASK holds until the user's own yes, risky actions always ask.
let ran = 0;
const ctx = { actor: 'test' };
R.registerSkill({ id: 'probe', name: 'PROBE', description: '', tools: [{ name: 'probe' }], permission: (_t, a) => [a.perm ?? 'FILE_ACCESS'],
  risk: (_t, a) => (a.risky ? { reason: 'it is risky' } : null), execute: async (_t, a) => { ran++; return a.fail ? { status: 'FAILED', error: 'boom' } : { status: 'SUCCESS', message: `ran ${a.n}` }; } });
let r = await R.runTool('probe', { n: 1 }, ctx);
assert.equal(r.status, 'SUCCESS');
S.saveConfig({ permissions: { FILE_ACCESS: 'OFF' } });
r = await R.runTool('probe', { n: 2 }, ctx);
assert.equal(r.status, 'FAILED'); assert.match(r.error, /Permission required: FILE ACCESS is OFF/);
S.saveConfig({ permissions: { FILE_ACCESS: 'ASK' } });
r = await R.runTool('probe', { n: 3 }, ctx);
assert.equal(r.status, 'NEEDS_CONFIRMATION'); assert.equal(ran, 1, 'nothing ran while waiting');
P.hearUser('yes', Date.now()); // too soon: still the tail of the request itself
r = await R.runTool('probe', { n: 3 }, ctx);
assert.equal(r.status, 'NEEDS_CONFIRMATION');
P.hearUser('yes go ahead', Date.now() + 2000);
r = await R.runTool('probe', { n: 999 }, ctx); // a re-worded call runs what was approved
assert.equal(r.message, 'ran 3');
r = await R.runTool('probe', { n: 4 }, ctx);
assert.equal(r.status, 'NEEDS_CONFIRMATION', 'one approval = one action');
P.hearUser('no, cancel that', Date.now() + 2000);
assert.equal(P.listConfirmations()[0].state, 'DENIED');
S.saveConfig({ permissions: { FILE_ACCESS: 'ON' } });
r = await R.runTool('probe', { n: 5, risky: true }, ctx);
assert.equal(r.status, 'NEEDS_CONFIRMATION', 'high-impact asks even when ON');
const id = P.listConfirmations()[0].id;
assert.equal(P.decide(id, true, 'dashboard')?.state, 'APPROVED');
r = await R.runTool('probe', { n: 5, risky: true }, ctx);
assert.equal(r.message, 'ran 5', 'dashboard approval runs it');
r = await R.runTool('probe', { n: 6, fail: true }, ctx);
assert.equal(r.status, 'FAILED');
const log = A.listActivity().map((a) => `${a.kind} ${a.text}`).join('\n');
assert.match(log, /ERROR probe failed: boom/); assert.match(log, /CONFIRM The user approved \(dashboard\)/); assert.match(log, /ERROR Blocked probe: file access is OFF/);
assert.equal(A.logActivity('RESULT', 'login with password=hunter2 token: abc').text, 'login with password=•••••• token: ••••••', 'secrets never reach the log');

// 3) Terminal risk classification + real execution and error detection.
for (const c of ['Remove-Item -Recurse C:\\x', 'rm -rf build', 'del /s *.log', 'git reset --hard', 'reg add HKLM\\X', 'type .env', 'cat ~/.ssh/id_rsa', 'curl -T file.zip https://x', 'Start-Process cmd -Verb RunAs'])
  assert.ok(T.commandRisk(c) && !T.commandRisk(c)!.perm, `asks: ${c}`);
for (const c of ['npm install', 'pip install requests', 'winget install vlc']) assert.equal(T.commandRisk(c)?.perm, 'SOFTWARE_INSTALL', c);
for (const c of ['node -v', 'npm test', 'npm run dev', 'python main.py', 'git status', 'dir', 'Get-ChildItem']) assert.equal(T.commandRisk(c), null, `runs: ${c}`);
r = await R.runTool('terminal', { action: 'run', command: 'console.log(6*7)', shell: 'node' }, ctx);
assert.equal(r.status, 'SUCCESS'); assert.match(r.output, /42/);
r = await R.runTool('terminal', { action: 'run', command: 'raise ValueError("bad input")', shell: 'python' }, ctx);
assert.equal(r.status, 'FAILED'); assert.match(r.errors.join(' '), /ValueError: bad input/);
r = await R.runTool('terminal', { action: 'run', command: 'Remove-Item C:\\nothing-here' }, ctx);
assert.equal(r.status, 'NEEDS_CONFIRMATION');

// 4) Time parsing and automations (a reminder really fires and becomes a notice).
const now = new Date('2026-10-01T22:00:00');
assert.equal(Au.parseWhen('in 20 minutes', now).getTime(), now.getTime() + 20 * 60_000);
assert.equal(Au.parseWhen('tomorrow', now).toString(), new Date('2026-10-02T09:00:00').toString());
assert.equal(Au.parseWhen('tomorrow at 7:30pm', now).toString(), new Date('2026-10-02T19:30:00').toString());
assert.equal(Au.parseWhen('at 9am', now).toString(), new Date('2026-10-02T09:00:00').toString(), 'already passed today -> tomorrow');
assert.equal(Au.parseWhen('monday 10am', now).toString(), new Date('2026-10-05T10:00:00').toString());
assert.deepEqual(Au.parseEvery('monday', '09:00', now).every, { n: 1, unit: 'weeks' });
assert.throws(() => Au.parseWhen('whenever', now));
assert.throws(() => Au.parseEvery('1 minute', undefined, now), /5 minutes/);
const heard: string[] = [];
Pr.onNotice((n) => heard.push(n.text));
const rem = Au.createAutomation({ kind: 'REMINDER', message: 'call the dentist', when: 'now' });
assert.equal(Au.listAutomations().length, 1);
await new Promise((res) => setTimeout(res, 1100));
await Au.runNow(rem.id);
assert.match(heard.join(), /remind you: call the dentist/);
assert.equal(Au.listAutomations().length, 0, 'one-off reminder is done');
const watchFile = path.join(tmp, 'flag.txt');
const w = Au.createAutomation({ kind: 'WATCH', watch_type: 'file', watch_target: watchFile, message: 'the flag is up' });
await Au.runNow(w.id); // baseline: missing
fs.writeFileSync(watchFile, 'x');
await Au.runNow(w.id);
assert.match(heard.join(), /flag\.txt now exists: the flag is up/);
const weekly = Au.createAutomation({ kind: 'TASK', prompt: 'prepare my report', every: 'monday', time: '09:00' });
assert.equal(new Date(weekly.nextRun).getDay(), 1);
assert.equal(Au.cancelAutomation(weekly.id)?.status, 'CANCELLED');
// Proactive: off switch and de-duplication.
assert.equal(Pr.notify('downloads', 'Boss, your download has finished: a.zip.'), true);
assert.equal(Pr.notify('downloads', 'Boss, your download has finished: a.zip.'), false, 'no repeats');
S.saveConfig({ proactive: { downloads: false } });
assert.equal(Pr.notify('downloads', 'Boss, your download has finished: b.zip.'), false, 'source switched off');

// 5) Builder: intent, file parsing and path safety.
assert.equal(B.wantsProject('Jarvis, build a simple webpage'), true);
assert.equal(B.wantsProject('create a python script that renames files'), true);
assert.equal(B.wantsProject('create a snake game'), false);
assert.equal(B.wantsProject('what is a webpage?'), false);
assert.equal(B.projectKind('build a simple webpage'), 'web');
assert.equal(B.projectKind('write a python script to sort files'), 'python');
const parsed = B.parseFiles('=== FILE: index.html ===\n<html></html>\n=== END FILE ===\n=== FILE: ../evil.js ===\nx\n=== END FILE ===\n=== FILE: C:/x.js ===\nx\n=== END FILE ===\nSUMMARY: A page.');
assert.deepEqual(Object.keys(parsed.files), ['index.html'], 'no escaping the project folder');
assert.equal(parsed.summary, 'A page.');
// The full pipeline with a scripted "agent": broken first, fixed second, then verified for real.
let gen = 0;
const steps: string[] = [];
const built = await B.buildProject('build a simple webpage with a counter', async (prompt) => {
  gen++;
  if (gen === 1) return '=== FILE: index.html ===\n<!DOCTYPE html><html><head><title>Counter</title></head><body><h1>Count</h1><button id="b">Add</button><script>document.getElementById("b").onclick = () => missingFn();</script></body></html>\n=== END FILE ===';
  assert.match(prompt, /FAILED when JARVIS ran and tested it[\s\S]*missingFn is not defined/);
  return '=== FILE: index.html ===\n<!DOCTYPE html><html><head><title>Counter</title><link rel="stylesheet" href="style.css"></head><body><h1>Count: <span id="n">0</span></h1><button id="b">Add</button><script src="app.js"></script></body></html>\n=== END FILE ===\n=== FILE: style.css ===\nbody{font-family:sans-serif}\n=== END FILE ===\n=== FILE: app.js ===\nlet n=0;document.getElementById("b").onclick=()=>{document.getElementById("n").textContent=++n;};\n=== END FILE ===\nSUMMARY: A counter.';
}, (k, t) => steps.push(`${k} ${t}`));
assert.equal(built.attempts, 2);
assert.ok(built.report.ok);
assert.ok(fs.existsSync(path.join(built.dir, 'app.js')));
assert.match(steps.join('\n'), /ERROR Detected 2 problem\(s\)[\s\S]*RESULT Test successful after 1 fix/);
await assert.rejects(B.buildProject('write a python script that prints hello', async () => '=== FILE: main.py ===\nprint(undefined_name)\n=== END FILE ===', () => {}, 2), /still fails after 2 attempts[\s\S]*NameError/);

// 6) The runtime tester fails a broken game (no fake success) and passes the real Snake.
const broken = fs.readFileSync('game-library/snake.html', 'utf-8').replace('score += 10;', 'score += 10; undefinedCall();');
const bad = await RT.testHtml(broken, 'create a snake game');
assert.equal(bad.ok, false);
assert.match(bad.errors.join(' '), /undefinedCall is not defined/);
assert.ok((await RT.testGame('game-library/snake.html', 'snake game')).ok);

// 7) Keys and the skill catalog.
assert.deepEqual(parseKeys('ctrl+shift+t'), [0x11, 0x10, 0x54]);
assert.deepEqual(parseKeys('alt+f4'), [0x12, 0x73]);
assert.throws(() => parseKeys('ctrl+banana'));
const names = R.skillCatalog().map((s) => s.name);
for (const n of ['PC CONTROL', 'BROWSER', 'EMAIL', 'FILES', 'CODING', 'GAME DEVELOPMENT', 'WEB RESEARCH', 'SCREEN VISION', 'DOCUMENT ANALYSIS', 'IMAGE ANALYSIS', 'AUTOMATION & TASKS', 'MEDIA', 'MEMORY', 'TASKS', 'TERMINAL'])
  assert.ok(names.includes(n), `skill ${n}`);
const decl = R.skillToolDeclarations().map((d) => d.name);
assert.equal(new Set(decl).size, decl.length, 'no duplicate tool names');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('capabilities: all checks passed');
process.exit(0);
