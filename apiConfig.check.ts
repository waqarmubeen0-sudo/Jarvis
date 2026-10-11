// Self-check for the JARVIS config (SOUL / THINKING / SKILLS / quota / routing), on a scratch file.
// Run: npx tsx apiConfig.check.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cfg-')), 'settings.json');
process.env.JARVIS_SETTINGS_FILE = file;
const C = await import('./apiSettings');

// Defaults keep today's behaviour.
let c = C.getConfig();
assert.equal(c.model, 'gemini-3.8-flash');
assert.equal(c.temperature, null);
assert.deepEqual(c.skills, { webSearch: true, fileSystem: true, codeExecution: false });
assert.equal(c.limits.delaySec, 1);
assert.equal(C.soulInstruction().includes('Core directives'), false, 'no directives until the user writes some');

// THINKING: depth drives temperature; a manual temperature makes it CUSTOM.
c = C.saveConfig({ depth: 'FAST' });
assert.equal(c.temperature, 0.2);
assert.deepEqual(C.temperatureConfig(), { temperature: 0.2 });
c = C.saveConfig({ depth: 'DEEP' });
assert.equal(c.temperature, 1);
assert.match(C.soulInstruction(), /DEEP ANALYSIS/);
c = C.saveConfig({ temperature: 0.6 });
assert.equal(c.depth, 'CUSTOM');
assert.throws(() => C.saveConfig({ temperature: 3 }), /between 0 and 2/);

// SOUL: personality, autonomy and directives are injected; limits are enforced.
C.saveConfig({ soul: { personality: 'SARCASTIC', autonomy: 'PROACTIVE', directives: 'Always answer in British English.' } });
const soul = C.soulInstruction();
assert.match(soul, /sarcastic/i);
assert.match(soul, /PROACTIVE/);
assert.match(soul, /Always answer in British English/);
assert.ok(C.isProactive());
C.saveConfig({ soul: { personality: 'EVIL', directives: 'x'.repeat(9000) } });
c = C.getConfig();
assert.equal(c.soul.personality, 'SARCASTIC', 'unknown personality ignored');
assert.equal(c.soul.autonomy, 'PROACTIVE', 'partial soul patch keeps other fields');
assert.equal(c.soul.directives.length, 4000, 'directives capped');

// SKILLS: plugin toggles merge; training per agent reaches that agent's prompt only.
C.saveConfig({ skills: { codeExecution: true } });
assert.deepEqual(C.skills(), { webSearch: true, fileSystem: true, codeExecution: true });
C.saveConfig({ training: { code: { language: 'Python', context: 'Our repo uses FastAPI.' }, write: { language: 'Klingon' } } });
assert.match(C.agentInstruction('CODE'), /Default coding language: Python[\s\S]*FastAPI/);
assert.equal(C.agentInstruction('WRITE').includes('Klingon'), false, 'unknown language rejected');
assert.equal(C.agentInstruction('SEC').includes('FastAPI'), false, 'training is per agent');
C.saveConfig({ training: { CODE: null } });
assert.equal(C.getConfig().training.CODE, undefined, 'training can be cleared');

// Quota + routing.
C.saveConfig({ limits: { delaySec: 9, tokenBudget: 250000 } });
assert.equal(C.getConfig().limits.delaySec, 5, 'delay clamped to 1-5 s');
assert.equal(C.agentCallGapMs(), 5000);
assert.equal(C.getConfig().limits.tokenBudget, 250000);
assert.throws(() => C.saveConfig({ routerModel: 'gpt-4' }), /Gemini model id/);
C.saveConfig({ routerModel: 'gemini-3.8-flash' });
assert.equal(C.routerModel(), 'gemini-3.8-flash');

// Persistence: a fresh load of the file gives the same config; garbage is repaired.
assert.deepEqual(C.normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf-8'))), C.getConfig());
assert.equal(C.normalizeConfig({ limits: { delaySec: 'lots' }, skills: { webSearch: 'yes' } }).limits.delaySec, 1);

// Context window tracking.
C.recordContext('voice', 'gemini-3.8-live', { promptTokenCount: 4321 });
assert.equal(C.getContext()!.tokens, 4321);
fs.rmSync(path.dirname(file), { recursive: true });
console.log('apiConfig: all checks passed');
