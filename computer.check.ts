// Self-check for the command router and mode switching (no browser launched).
// Run: npx tsx computer.check.ts
import assert from 'node:assert/strict';
import { parseModeCommand, getMode, computerTarget, ModeListener, sessionFor, setMode } from './computer';
import { orbit } from './orbit';

// Explicit commands only.
for (const s of ['JARVIS, Orbit mode.', 'orbit mode', 'Jarvis orbit mode please', 'switch to direct mode', 'Hey JARVIS, activate orbit mode!', 'go back to direct mode'])
  assert.ok(parseModeCommand(s), `command: ${s}`);
for (const s of ['what is orbit mode?', 'is direct mode safer than orbit mode', 'tell me about orbit mode', 'open youtube'])
  assert.equal(parseModeCommand(s), null, `not a command: ${s}`);
assert.equal(parseModeCommand('JARVIS, Direct Mode'), 'DIRECT');

// Starts in DIRECT; browser actions follow the mode, system actions stay on the real PC.
assert.equal(getMode(), 'DIRECT');
assert.equal(computerTarget('open_url'), 'DIRECT');
assert.equal(computerTarget('create_folder'), 'SYSTEM');
assert.equal(sessionFor().type, 'DIRECT');

// Keep the test offline: don't really boot the private browser.
(orbit as any).start = async () => {};
(orbit as any).stop = async () => {};

// Voice: chunks assemble into one utterance; the switch happens on the command itself.
const l = new ModeListener();
l.hear(' JARVIS,', 0);
assert.equal(getMode(), 'DIRECT');
l.hear(' Orbit mode.', 10);
assert.equal(getMode(), 'ORBIT', 'spoken command switches');
assert.equal(computerTarget('research_web'), 'ORBIT');
assert.equal(computerTarget('open_url'), 'ORBIT');
assert.equal(computerTarget('lock_pc'), 'SYSTEM', 'system tools never go to Orbit');
assert.equal(l.confirm('ORBIT', 1000).status, 'SUCCESS');
assert.match(String(l.confirm('ORBIT', 1000).say), /Orbit mode activated/);
assert.equal(l.confirm('DIRECT', 1000).status, 'FAILED', 'model cannot switch without the user commanding it');
assert.equal(getMode(), 'ORBIT');
l.endTurn();

// Ordinary conversation never flips the mode.
l.hear(' what is direct mode anyway?', 2000);
assert.equal(getMode(), 'ORBIT');
l.endTurn();

// Typed command.
l.hearTyped('JARVIS, Direct Mode', 3000);
assert.equal(getMode(), 'DIRECT');
assert.equal(computerTarget('play_youtube'), 'DIRECT');
setMode('DIRECT', 'ui');
console.log('computer: all checks passed');
