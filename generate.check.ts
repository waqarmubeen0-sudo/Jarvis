// Self-check for generate(): request shape per provider, plain-text replies, clear errors. No network
// (fetch is mocked) and no real keys (a throwaway in-memory credential store).
// Run: npx tsx generate.check.ts
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.JARVIS_SETTINGS_FILE = path.join(os.tmpdir(), `jarvis-gen-${process.pid}.json`);
const C = await import('./credentials');
const mem: Record<string, string> = {};
C.useEncryptedStore(path.join(os.tmpdir(), `jarvis-gen-${process.pid}.bin`), {
  isEncryptionAvailable: () => true,
  encryptString: (s) => { Object.assign(mem, JSON.parse(s)); return Buffer.from('x'); },
  decryptString: () => JSON.stringify(mem),
});
const S = await import('./apiSettings');
const { generate, testProvider } = await import('./generate');

const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
let reply: { status: number; json: any } = { status: 200, json: {} };
globalThis.fetch = (async (url: any, init: any) => {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
  calls.push({ url: String(url), headers, body: init?.body ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const last = () => calls[calls.length - 1];

// Missing key: one clear sentence naming the provider.
S.saveConfig({ provider: 'anthropic' });
await assert.rejects(generate('hi'), /No Anthropic \(Claude\) API key is set\. Add it in API Settings\./);

// Anthropic: /v1/messages, x-api-key + anthropic-version, system separate, alternating turns, text blocks joined.
C.setCredential('ANTHROPIC_API_KEY', 'test-anthropic-key');
reply = { status: 200, json: { content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there.' }], usage: { input_tokens: 5, output_tokens: 3 } } };
assert.equal(await generate([{ role: 'model', text: 'earlier' }, { role: 'user', text: 'a' }, { role: 'user', text: 'b' }], { system: 'Be JARVIS.' }), 'Hello there.');
assert.equal(last().url, 'https://api.anthropic.com/v1/messages');
assert.equal(last().headers['x-api-key'], 'test-anthropic-key');
assert.equal(last().headers['anthropic-version'], '2023-06-01');
assert.equal(last().body.model, 'claude-sonnet-5-5');
assert.equal(last().body.system, 'Be JARVIS.');
assert.ok(last().body.max_tokens > 0);
assert.deepEqual(last().body.messages.map((m: any) => m.role), ['user', 'assistant', 'user'], 'starts with user, alternates');
assert.equal(last().body.messages[2].content, 'a\n\nb', 'same-role turns merged');

// OpenAI: /v1/chat/completions, Bearer auth, system message first, choices[0].message.content.
S.saveConfig({ provider: 'openai', providerModels: { openai: 'gpt-test' } });
C.setCredential('OPENAI_API_KEY', 'test-openai-key');
reply = { status: 200, json: { choices: [{ message: { content: '```json\n{"ok":true}\n```' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } } };
assert.equal(await generate('route this', { system: 'You route.', json: true }), '{"ok":true}', 'JSON fences stripped');
assert.equal(last().url, 'https://api.openai.com/v1/chat/completions');
assert.equal(last().headers.authorization, 'Bearer test-openai-key');
assert.equal(last().body.model, 'gpt-test');
assert.equal(last().body.messages[0].role, 'system');
assert.match(last().body.messages[0].content, /raw JSON only/);

// Failures: status and the provider's own message, with the key hidden if it is echoed back.
reply = { status: 401, json: { error: { message: 'Incorrect API key provided: test-openai-key' } } };
await assert.rejects(generate('x'), (e: any) => /OpenAI error 401: Incorrect API key/.test(e.message) && !e.message.includes('test-openai-key') && e.status === 401);
assert.deepEqual(await testProvider('openai', 'test-openai-key', 'gpt-test'), { ok: false, message: 'OpenAI (ChatGPT) rejected this API key.' });
reply = { status: 404, json: { error: { message: 'The model `nope` does not exist' } } };
assert.match((await testProvider('openai', 'test-openai-key', 'nope')).message!, /no model called "nope"/);
reply = { status: 429, json: { error: { message: 'Rate limit reached' } } };
assert.equal((await testProvider('openai', 'test-openai-key', 'gpt-test')).ok, true, 'rate-limited still means a valid key');

// Gemini: the generateContent endpoint, plain text out.
S.saveConfig({ provider: 'gemini' });
C.setCredential('GEMINI_API_KEY', 'test-gemini-key');
reply = { status: 200, json: { candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini says hi.' }] } }] } };
assert.equal(await generate('hi', { system: 'Be JARVIS.' }), 'Gemini says hi.');
assert.match(last().url, /models\/gemini-[^:]+:generateContent/);
assert.equal(last().body.systemInstruction?.parts?.[0]?.text, 'Be JARVIS.');

console.log('generate: all checks passed');
