// Self-check for API settings, usage telemetry and log capture (key storage: credentials.check.ts).
// Run: npx tsx apiSettings.check.ts
import assert from 'node:assert/strict';
import { maskKey, tracked, getUsage, addTokens, validModel, validTemp, captureConsole, recentLogs } from './apiSettings';

assert.equal(maskKey('AIzaSyABCDEF1234'), '••••••1234');
assert.equal(maskKey(''), '');
assert.ok(validModel('gemini-3.8-flash') && validModel('gemini-flash-lite-latest'));
assert.ok(!validModel('gpt-4') && !validModel('gemini-../../etc') && !validModel(''));
assert.ok(validTemp(0) && validTemp(2) && validTemp(0.7) && !validTemp(2.1) && !validTemp(-1) && !validTemp(NaN));

// Usage: calls, latency and tokens are counted; failures count as errors and rate limits are noted.
const u0 = getUsage();
await tracked('m', async () => ({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }));
addTokens({ totalTokenCount: 100, promptTokenCount: 60, responseTokenCount: 40 }); // Live message shape
await assert.rejects(tracked('m', async () => { throw new Error('429 RESOURCE_EXHAUSTED'); }));
const u1 = getUsage();
assert.equal(u1.calls - u0.calls, 2);
assert.equal(u1.errors - u0.errors, 1);
assert.equal(u1.totalTokens - u0.totalTokens, 115);
assert.equal(u1.outputTokens - u0.outputTokens, 45);
assert.ok(u1.lastLatencyMs !== null && u1.lastRateLimitAt !== null);

// Logs: console output is kept, and anything shaped like a Gemini key is hidden.
captureConsole();
const before = Date.now() - 1;
console.log('[test] key is AIzaSyD4f8K3mQ9zX2vB7nL1pR6tW0yH5jC8eUa in a message');
const line = recentLogs(before).find((l) => l.text.startsWith('[test]'))!;
assert.ok(line && !line.text.includes('AIzaSyD4f8') && line.text.includes('••••••8eUa'), 'keys never reach the dashboard');
console.log('apiSettings: all checks passed');
