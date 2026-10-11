// Self-check for the web permission gate. Run: npx tsx webGate.check.ts
import assert from 'node:assert/strict';
import { WebGate, isWebAction, approvesWebSearch } from './webGate';

assert.ok(isWebAction('play_youtube') && isWebAction('open_url') && isWebAction('search_web'));
assert.ok(isWebAction('open_app', { name: 'Chrome' }), 'opening a browser app is gated');
assert.ok(!isWebAction('open_app', { name: 'notepad' }) && !isWebAction('create_folder'), 'local actions are not');

const g = new WebGate();
const song = { query: 'Back in Black' };
assert.equal(g.check('play_youtube', song, 0), null, 'first call is held');
assert.equal(g.check('play_youtube', song, 1000), null, 'model cannot push it through by retrying');
g.hear('yes go ahead', 2000);
assert.deepEqual(g.check('play_youtube', { query: 'something else' }, 3000), song, 'runs exactly what was approved');
assert.equal(g.check('play_youtube', song, 4000), null, 'approval is used once');

const n = new WebGate();
n.check('open_url', { url: 'x.com' }, 0);
n.hear('no, not now', 500);
n.hear('yes', 600);
assert.equal(n.check('open_url', { url: 'x.com' }, 700), null, '"no" cancels the request');

const t = new WebGate();
t.check('search_web', { query: 'q' }, 0);
t.hear('yes', 3 * 60 * 1000);
assert.equal(t.check('search_web', { query: 'q' }, 3 * 60 * 1000 + 1), null, 'stale requests expire');

assert.ok(approvesWebSearch('yes please', 'Shall I search the web for that, Sir?'), 'chat: yes to a search offer');
assert.ok(!approvesWebSearch('what is the weather', ''), 'chat: no search without asking first');
assert.ok(!approvesWebSearch('no thanks', 'Shall I search online?'), 'chat: declined');

console.log('webGate: all checks passed');
