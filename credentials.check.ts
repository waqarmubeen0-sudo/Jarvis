// Self-check for credentials: dev .env.local writer, OS-encrypted store, env scrubbing, masking and redaction.
// Run: npx tsx credentials.check.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cred-'));
process.env.JARVIS_ENV_FILE = path.join(dir, '.env.local');
process.env.NEWSAPI_KEY = 'news-key-from-the-shell-1234';
const C = await import('./credentials');

// Env vars still work, but are taken out of process.env (child processes must not inherit them).
assert.equal(process.env.NEWSAPI_KEY, undefined, 'scrubbed from process.env');
assert.equal(C.credential('NEWSAPI_KEY'), 'news-key-from-the-shell-1234');

// .env writer: one line changes, everything else survives; an empty value removes the line.
const env = path.join(dir, 'x.env');
fs.writeFileSync(env, '# my notes\nOTHER=1\nGEMINI_API_KEY=old-key\nMORE="x"\n');
C.writeEnvVar(env, 'GEMINI_API_KEY', 'new-key');
assert.equal(fs.readFileSync(env, 'utf-8'), '# my notes\nOTHER=1\nGEMINI_API_KEY=new-key\nMORE="x"\n');
C.writeEnvVar(env, 'GEMINI_API_KEY', '');
assert.equal(fs.readFileSync(env, 'utf-8'), '# my notes\nOTHER=1\nMORE="x"\n', 'removed');
C.writeEnvVar(env, 'EMAIL_ADDRESS', 'a@b.co');
assert.ok(fs.readFileSync(env, 'utf-8').endsWith('MORE="x"\nEMAIL_ADDRESS=a@b.co\n'), 'added when missing');
assert.throws(() => C.writeEnvVar(env, 'GEMINI_API_KEY', 'a\nEVIL=1'));

// Dev store: set / read / remove.
C.setCredential('GEMINI_API_KEY', 'AQ.devKey1234567890abcdefghijklmnop');
assert.equal(C.credential('GEMINI_API_KEY'), 'AQ.devKey1234567890abcdefghijklmnop');
assert.match(fs.readFileSync(process.env.JARVIS_ENV_FILE, 'utf-8'), /^GEMINI_API_KEY=AQ\.devKey/m);
C.removeCredential('GEMINI_API_KEY');
assert.equal(C.credential('GEMINI_API_KEY'), '');

// Desktop store: what reaches the disk is the OS-encrypted blob, never the key.
const fake = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s).reverse(), decryptString: (b: Buffer) => Buffer.from(b).reverse().toString() };
const bin = path.join(dir, 'user', 'credentials.bin');
C.useEncryptedStore(bin, fake);
assert.equal(C.storageKind(), 'os-encrypted');
assert.equal(C.credential('GEMINI_API_KEY'), '', 'a fresh install has no key: the setup screen shows');
C.setCredential('GEMINI_API_KEY', 'AIzaSyD4f8K3mQ9zX2vB7nL1pR6tW0yH5jC8eUa');
assert.ok(!fs.readFileSync(bin).toString('latin1').includes('AIzaSyD4f8'), 'not stored in plain text');
assert.equal(C.credential('GEMINI_API_KEY'), 'AIzaSyD4f8K3mQ9zX2vB7nL1pR6tW0yH5jC8eUa');
C.useEncryptedStore(bin, { ...fake, decryptString: () => { throw new Error('other user'); } });
assert.equal(C.credential('GEMINI_API_KEY'), '', "another account can't read it");
C.useEncryptedStore(bin, { ...fake, isEncryptionAvailable: () => false });
assert.throws(() => C.setCredential('GEMINI_API_KEY', 'x'), /plain text/, 'refuses to save without OS encryption');
C.useEncryptedStore(bin, fake);

// Masking and redaction.
assert.equal(C.maskKey('AIzaSyABCDEF1234'), '••••••1234');
assert.equal(C.maskKey('short'), '••••••');
const leaks = [
  'AIzaSyD4f8K3mQ9zX2vB7nL1pR6tW0yH5jC8eUa', 'AQ.Ab8RNfakefakefakefakefakefake99', 'sk-' + 'proj-abcdefghijklmnop1234', 'sk-' + 'ant-api03-abcdefghijklmnop', // split: fake keys must not look real in the source
  'ghp_abcdefghijklmnopqrstuvwxyz12', 'https://x.io/v1?key=SECRETVALUE123&alt=json', 'x-goog-api-key: SECRETVALUE456',
  '{"apiKey":"SECRETVALUE789"}', 'password=hunter2hunter2', 'Authorization: Bearer SECRETVALUE000', 'news-key-from-the-shell-1234',
  '-----BEGIN ' + 'PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----',
];
for (const l of leaks) {
  const out = C.redact(`error: ${l} happened`);
  assert.ok(!/SECRETVALUE|hunter2hunter2|D4f8K3|fakefake|abcdefghijklmnop|news-key-from|MIIEvQ/.test(out), `redacted: ${l} -> ${out}`);
}
assert.equal(C.redact('Gemini rejected this API key.'), 'Gemini rejected this API key.', 'ordinary text untouched');

fs.rmSync(dir, { recursive: true });
console.log('credentials: all checks passed');
