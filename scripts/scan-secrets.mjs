// Fails (exit 1) if anything that will be published or shipped contains a secret.
//   node scripts/scan-secrets.mjs .          -> the files that would go to GitHub
//   node scripts/scan-secrets.mjs dist       -> the built web UI
//   node scripts/scan-secrets.mjs release    -> the packaged app (app.asar) and the installer
// Two checks: key-shaped strings (Google/OpenAI/Anthropic/GitHub/Slack keys, private keys), and the
// exact values of the developer's own local credentials (.env.local / .env), wherever they appear.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATTERNS = [
  ['Google API key', /AIza[0-9A-Za-z_\-]{35}/g],
  ['Google API key (new format)', /\bAQ\.[0-9A-Za-z_\-]{40,}/g],
  ['OpenAI/Anthropic key', /\bsk-(?:ant-|proj-)?[0-9A-Za-z_\-]{24,}/g],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{30,}/g],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z\-]{20,}/g],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
];
// Fake keys the self-checks use to prove redaction works. They are not credentials.
const ALLOW = new Set(['AIzaSyD4f8K3mQ9zX2vB7nL1pR6tW0yH5jC8eUa']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|mp3|wav|ogg|mp4|zip|7z|exe|dll|pak|bin|dat|node|asar)$/i;

// The developer's real values: they must appear nowhere outside their own git-ignored files.
const literals = [];
for (const f of [path.join(ROOT, '.env.local'), path.join(ROOT, '.env'), path.join(ROOT, '..', '.env')]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*=\s*["']?([^"'\s#]{8,})/);
    if (m) literals.push(m[2]);
  }
}

const findings = [];
let scanned = 0;
function scanText(label, text, { patterns = true } = {}) {
  scanned++;
  for (const v of literals) if (text.includes(v)) findings.push(`${label}: contains one of YOUR local credential values`);
  if (!patterns) return;
  for (const [name, re] of PATTERNS) for (const m of text.matchAll(re)) if (!ALLOW.has(m[0])) findings.push(`${label}: ${name} (${m[0].slice(0, 6)}…)`);
}
function scanFile(file, label = path.relative(ROOT, file)) {
  const st = fs.statSync(file);
  if (st.size > 64 * 1024 * 1024) return;
  const buf = fs.readFileSync(file);
  // Binary files: only the exact-value check (pattern hits inside images/fonts are noise).
  scanText(label, buf.toString('latin1'), { patterns: !BINARY.test(file) });
}
function walk(dir, skip = () => false) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip(p, e)) continue;
    if (e.isDirectory()) walk(p, skip); else if (e.isFile()) scanFile(p);
  }
}

// The publishable source tree: what git would commit (tracked + untracked, minus .gitignore).
function scanRepo(dir) {
  let files = null;
  try { files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); } catch { /* not a repo yet */ }
  if (files) { for (const f of files) if (fs.existsSync(path.join(dir, f))) scanFile(path.join(dir, f)); return; }
  // Not a git repo yet: approximate .gitignore.
  const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'release', 'build', 'out', 'generated-games', 'coverage', 'logs', '.vite', '.cache']);
  walk(dir, (p, e) => (e.isDirectory() ? IGNORED_DIRS.has(e.name) : (/^\.env/.test(e.name) && e.name !== '.env.example') || ['jarvis-settings.json', 'credentials.bin', 'jarvis-desktop.mjs'].includes(e.name) || /\.(key|pem|p12|pfx|log)$/.test(e.name)));
}

// A packaged app: every file inside app.asar (our code with patterns; dependencies with the exact-value check).
async function scanAsar(file) {
  const asar = await import('@electron/asar');
  for (const f of asar.listPackage(file)) {
    const rel = f.replace(/^[\\/]/, '');
    let buf;
    try { buf = asar.extractFile(file, rel); } catch { continue; } // directories
    const ours = !/^node_modules[\\/]/.test(rel);
    scanned++;
    scanText(`${path.relative(ROOT, file)}:${rel}`, buf.toString('latin1'), { patterns: ours && !BINARY.test(rel) });
  }
}

function sevenZip() {
  const cands = ['7z', '7za', 'C:/Program Files/7-Zip/7z.exe'];
  const cache = path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron-builder', 'Cache');
  for (const c of cands) { try { execFileSync(c, ['i'], { stdio: 'ignore' }); return c; } catch { /* next */ } }
  try { for (const d of fs.readdirSync(cache, { recursive: true })) if (/7za\.exe$/i.test(String(d))) return path.join(cache, String(d)); } catch { /* none */ }
  return null;
}

async function scanRelease(dir) {
  const asars = [];
  walk(dir, (p, e) => {
    if (e.isFile() && e.name === 'app.asar') { asars.push(p); return true; }
    return e.isFile() && BINARY.test(e.name) && !/\.exe$/i.test(e.name); // Electron's own binaries: skip
  });
  for (const a of asars) await scanAsar(a);
  // The installer itself: unpack it and scan the app.asar inside, so the shipped file is what is checked.
  const installers = fs.readdirSync(dir).filter((f) => /setup.*\.exe$/i.test(f));
  const z = sevenZip();
  for (const inst of installers) {
    if (!z) { console.warn(`[scan-secrets] ${inst}: no 7-Zip found to unpack it; its content (win-unpacked/resources/app.asar) was scanned instead.`); continue; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-inst-'));
    try {
      execFileSync(z, ['x', '-y', `-o${tmp}`, path.join(dir, inst)], { stdio: 'ignore' });
      for (const pkg of fs.readdirSync(tmp, { recursive: true }).map(String).filter((f) => /\.7z$/i.test(f))) execFileSync(z, ['x', '-y', `-o${path.join(tmp, 'app')}`, path.join(tmp, pkg)], { stdio: 'ignore' });
      const inner = [];
      walk(tmp, (p, e) => { if (e.isFile() && e.name === 'app.asar') { inner.push(p); return true; } return e.isFile() && BINARY.test(e.name); });
      for (const a of inner) await scanAsar(a);
      console.log(`[scan-secrets] ${inst}: unpacked, ${inner.length} app.asar scanned`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
}

for (const arg of process.argv.slice(2).length ? process.argv.slice(2) : ['.']) {
  const target = path.resolve(ROOT, arg);
  if (!fs.existsSync(target)) { console.warn(`[scan-secrets] ${arg}: not found, skipped`); continue; }
  if (arg === '.' || target === ROOT) scanRepo(target);
  else if (/release/.test(path.basename(target))) await scanRelease(target);
  else if (fs.statSync(target).isDirectory()) walk(target);
  else scanFile(target);
}

if (findings.length) {
  console.error(`[scan-secrets] FAILED: ${findings.length} possible secret(s):\n  ${[...new Set(findings)].join('\n  ')}`);
  process.exit(1);
}
console.log(`[scan-secrets] OK: ${scanned} files checked, no secrets (${literals.length} local credential value(s) checked by exact match).`);
