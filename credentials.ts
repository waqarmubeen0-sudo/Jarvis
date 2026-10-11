// The user's own credentials: AI provider keys (Gemini / Anthropic / OpenAI), email app password, optional NewsAPI key.
//  - Desktop app: encrypted by the OS (Electron safeStorage = Windows DPAPI / macOS Keychain /
//    Linux Secret Service) in <userData>/credentials.bin. Useless if copied to another account or PC.
//  - Development (npm run dev): .env or .env.local in the project folder (both git-ignored), or real env vars.
// Values are never put in process.env (child processes such as the terminal tool would inherit them),
// never sent to the UI except masked (••••ABCD), and redact() hides them in logs and error messages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const SECRET_NAMES = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'EMAIL_APP_PASSWORD', 'NEWSAPI_KEY'] as const;
export const CREDENTIAL_NAMES = [...SECRET_NAMES, 'EMAIL_ADDRESS', 'EMAIL_IMAP_HOST', 'EMAIL_SMTP_HOST'] as const;
export type CredentialName = (typeof CREDENTIAL_NAMES)[number];

interface Store { kind: 'os-encrypted' | 'env-file'; read(): Record<string, string>; write(values: Record<string, string>): void }
/** The subset of Electron's safeStorage this module needs. */
export interface OsCrypto { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEV_ENV_FILE = process.env.JARVIS_ENV_FILE || path.resolve(HERE, '.env.local');

/** Sets (or, for an empty value, removes) one NAME=value line in a .env file, leaving every other line untouched. */
export function writeEnvVar(envPath: string, name: string, value: string) {
  if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(name) || /[\r\n]/.test(value)) throw new Error('Invalid .env entry.');
  const re = new RegExp(`^[ \\t]*${name}[ \\t]*[:=].*(?:\\r?\\n)?`, 'm');
  const old = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  if (!value && !re.test(old)) return;
  const line = value ? `${name}=${value}\n` : '';
  const next = re.test(old) ? old.replace(re, () => line) : `${old}${old && !old.endsWith('\n') ? '\n' : ''}${line}`;
  fs.writeFileSync(envPath, next, { encoding: 'utf-8', mode: 0o600 });
}

const envFileStore = (file: string): Store => ({
  kind: 'env-file',
  read: () => (fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {}),
  write: (values) => { for (const n of CREDENTIAL_NAMES) writeEnvVar(file, n, values[n] ?? ''); },
});

let store: Store = envFileStore(DEV_ENV_FILE);
let cache: Record<string, string> | null = null;

/** Desktop app: keep credentials encrypted by the OS. Called by the Electron main process before the server starts. */
export function useEncryptedStore(file: string, crypto: OsCrypto) {
  store = {
    kind: 'os-encrypted',
    read: () => {
      if (!fs.existsSync(file)) return {};
      try { return JSON.parse(crypto.decryptString(fs.readFileSync(file))); } catch { return {}; } // other account/PC: start over
    },
    write: (values) => {
      if (!crypto.isEncryptionAvailable()) throw new Error("This system has no secure credential storage (on Linux: install and unlock a keyring such as GNOME Keyring or KWallet). JARVIS won't save keys in plain text.");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, crypto.encryptString(JSON.stringify(values)), { mode: 0o600 });
    },
  };
  cache = null;
}

// Env vars (e.g. set in a dev shell) still work, but are taken out of process.env right away so
// no child process inherits them.
const fromEnv: Record<string, string> = {};
for (const n of CREDENTIAL_NAMES) {
  if (process.env[n]?.trim()) fromEnv[n] = process.env[n]!.trim();
  delete process.env[n];
}

// Development also reads a plain .env (copied from .env.example); .env.local, where the app saves keys, wins.
// ponytail: "Remove key" only edits .env.local, so a key typed into .env is removed by editing .env.
const DEV_DOTENV = process.env.JARVIS_ENV_FILE ? null : path.resolve(HERE, '.env');
const dotenvFile = () => (store.kind === 'env-file' && DEV_DOTENV && fs.existsSync(DEV_DOTENV) ? dotenv.parse(fs.readFileSync(DEV_DOTENV)) : {});
const all = () => (cache ??= { ...dotenvFile(), ...store.read(), ...fromEnv });

export const credential = (name: CredentialName): string => (all()[name] ?? '').trim();

export function setCredential(name: CredentialName, value: string) {
  if (/[\r\n]/.test(value)) throw new Error('Invalid value.');
  const next = { ...store.read(), [name]: value.trim() };
  if (!next[name]) delete next[name];
  store.write(next);
  delete fromEnv[name];
  cache = null;
}

export const removeCredential = (name: CredentialName) => setCredential(name, '');
export const storageKind = () => store.kind;

/** ••••••ABCD: the only form a credential is ever shown in. */
export const maskKey = (key: string) => (key ? `${'•'.repeat(6)}${key.length >= 12 ? key.slice(-4) : ''}` : '');

const PATTERNS: [RegExp, (m: string, ...g: string[]) => string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, () => '[private key hidden]'],
  [/\bAIza[0-9A-Za-z_\-]{20,}/g, (m) => maskKey(m)], // Google API key (classic)
  [/\bAQ\.[0-9A-Za-z_\-]{20,}/g, (m) => maskKey(m)], // Google API key (new format)
  [/\bsk-(?:ant-|proj-)?[0-9A-Za-z_\-]{16,}/g, (m) => maskKey(m)], // OpenAI / Anthropic
  [/\bgh[pousr]_[0-9A-Za-z]{20,}/g, (m) => maskKey(m)], // GitHub
  [/\bxox[abprs]-[0-9A-Za-z\-]{10,}/g, (m) => maskKey(m)], // Slack
  [/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"'#]+/gi, (_m, p) => `${p}••••••`],
  [/\b(x-goog-api-key|authorization|api[_-]?key|app[_-]?password|password|passwd|secret|token)(["']?\s*[:=]\s*["']?)(?:Bearer\s+)?([^\s"',;&}]+)/gi,
    (_m, k, sep, v) => `${k}${sep}${maskKey(v)}`],
];

/** Hides every stored credential value and anything shaped like a key, password or token. */
export function redact(text: string): string {
  let out = String(text);
  const known = all();
  for (const n of SECRET_NAMES) {
    const v = known[n];
    if (v && v.length >= 6) out = out.split(v).join(maskKey(v));
  }
  for (const [re, fn] of PATTERNS) out = out.replace(re, fn as any);
  return out;
}
