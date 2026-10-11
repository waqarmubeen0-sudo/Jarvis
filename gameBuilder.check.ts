// Self-check for JARVIS game creation, end to end with a fake model, in a scratch games folder.
// Run: npx tsx gameBuilder.check.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-games-'));
process.env.JARVIS_GAMES_DIR = dir;
process.env.JARVIS_SETTINGS_FILE = path.join(dir, 'settings.json');
const G = await import('./gameBuilder');
const A = await import('./agentSystem');
A.setRetryDelays([5, 5]);
A.setCallGap(0);

// Intent: real requests, including the mis-heard voice one from the Mission Queue.
for (const p of ['Create a Snake game', 'Make me a simple Pong game', 'Create a Tic Tac Toe game', 'Chérie, tu es un snake game.', 'Jarvis, build me a breakout game'])
  assert.ok(G.wantsGame(p), `game intent: ${p}`);
for (const p of ["What's your favourite game?", 'Tell me about snakes', 'Write an email to my team'])
  assert.ok(!G.wantsGame(p), `not a game request: ${p}`);
assert.equal(G.libraryMatch('make me a simple Pong game')?.id, 'pong');
assert.equal(G.libraryMatch('create a tic-tac-toe game')?.id, 'tic-tac-toe');

// The offline library games satisfy the same checks generated games must pass.
for (const id of ['snake', 'pong', 'tic-tac-toe']) assert.deepEqual(G.validateGameHtml(G.libraryHtml(id)), [], `${id} passes validation`);

// Extraction + validation catch what breaks games.
const snake = G.libraryHtml('snake');
assert.equal(G.extractHtml('Here you go:\n```html\n' + snake + '\n```\nEnjoy!'), snake.trim());
assert.equal(G.extractHtml('no html here'), null);
assert.match(G.validateGameHtml(snake.replace('function step() {', 'function step() {{')).join(), /syntax error/i);
assert.match(G.validateGameHtml(snake.replace('<script>', '<script src="https://cdn.example/x.js"></script><script>')).join(), /external script/);
assert.match(G.validateGameHtml(snake.replace(/RESTART|restart|reset/gi, 'again')).join(), /Restart button/);
assert.match(G.validateGameHtml('<!DOCTYPE html><html><body>hi</body></html>').join(), /no inline JavaScript/i);
assert.equal(G.htmlTitle(snake), 'Snake');

// Serving: only safe ids, and the error bridge is injected.
assert.ok(!G.validGameId('../etc') && !G.validGameId('a') && G.validGameId('snake-ab12c'));

const fakeModel = (handler: (sys: string, text: string) => string | Promise<string>) =>
  A.setAgentModel(async (sys, contents) => {
    const text = contents[contents.length - 1].parts[0].text;
    if (sys.includes('Manager of the J.A.R.V.I.S. agent team')) return JSON.stringify({ route: 'SOLO', agent: { agentId: 'GAME', instruction: 'build it' } });
    return handler(sys, text);
  });

// 1) Generated game: the GAME agent's HTML is checked, saved, registered and served.
fakeModel(() => '```html\n' + G.libraryHtml('pong').replace('<title>Pong</title>', '<title>Neon Pong</title>') + '\n```');
let t = await A.processMultiAgentTask('Make me a simple Pong game', 'key');
await A.taskFinished(t.id);
assert.equal(t.status, 'COMPLETED');
assert.equal(t.artifact?.type, 'game');
assert.equal((t.artifact as any)?.source, 'generated');
assert.equal(t.artifact?.title, 'Neon Pong');
assert.ok(fs.existsSync(path.join(dir, `${t.artifact!.id}.html`)), 'game file written');
assert.equal(G.listGames()[0].id, t.artifact!.id, 'registered for the Arcade');
assert.match(G.gameFileForServing(t.artifact!.id)!, /jarvisGame:'error'/, 'served with the error bridge');
assert.match(t.finalResult!, /playable now in JARVIS Arcade/);

// 2) Broken code is repaired once with the exact errors, then accepted.
let calls = 0, repairPrompt = '';
fakeModel((_sys, text) => {
  calls++;
  if (calls === 1) return '```html\n' + G.libraryHtml('snake').replace('function step() {', 'function step() {{') + '\n```';
  repairPrompt = text;
  return '```html\n' + G.libraryHtml('snake') + '\n```';
});
t = await A.processMultiAgentTask('Create a Snake game', 'key');
await A.taskFinished(t.id);
assert.equal(calls, 2);
assert.match(repairPrompt, /previous attempt was rejected[\s\S]*syntax error/i, 'repair prompt carries the real error');
assert.equal(t.status, 'COMPLETED');
assert.equal((t.artifact as any)?.source, 'generated');

// 3) Gemini down (429) + a known genre: built from the offline library, and it says so.
fakeModel(() => { throw new Error('{"error":{"code":429,"message":"You exceeded your current quota"}}'); });
t = await A.processMultiAgentTask('Create a Tic Tac Toe game', 'key');
await A.taskFinished(t.id);
assert.equal(t.status, 'COMPLETED');
assert.equal((t.artifact as any)?.source, 'library');
assert.match(t.finalResult!, /offline game library, because Gemini was unavailable \(Gemini API quota exceeded/);

// 4) Gemini down + an unknown game: FAILED, with the real error (no fake success).
t = await A.processMultiAgentTask('Create a Tetris game', 'key');
await A.taskFinished(t.id);
assert.equal(t.status, 'FAILED');
assert.equal(t.artifact, undefined);
assert.match(t.steps[0].error!, /quota exceeded/i);

// 5) Model keeps returning a broken game for an unknown genre: FAILED with the check results.
fakeModel(() => 'Sorry, here is some text but no game.');
t = await A.processMultiAgentTask('Create a Tetris game', 'key');
await A.taskFinished(t.id);
assert.equal(t.status, 'FAILED');
assert.match(t.steps[0].error!, /failed testing after 3 attempts: No HTML document/);

// 429 retry hint parsing.
assert.equal(A.retryHintMs(new Error('429 RESOURCE_EXHAUSTED ... Please retry in 37.2s.')), 37200);
assert.equal(A.retryHintMs(new Error('{"code":429,"details":[{"retryDelay":"12s"}]} quota')), 12000);
assert.equal(A.retryHintMs(new Error('503 UNAVAILABLE')), null);

fs.rmSync(dir, { recursive: true });
console.log('gameBuilder: all checks passed');
