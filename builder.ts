// JARVIS project builder: "build a simple webpage", "make a Python script that...", "create a
// calculator app". PLAN -> CREATE PROJECT -> WRITE CODE -> RUN -> TEST -> DETECT ERRORS -> FIX ->
// TEST AGAIN -> VERIFY -> REPORT. Nothing is reported as done unless it actually ran and passed.
//   web     index.html (+ css/js) in ~/JarvisProjects/<name>, run in a headless browser: loads,
//           renders, no JS errors or missing files, every button clicked without errors
//   python  main.py, run with Python: exit code 0, no traceback
//   node    main.js, run with Node: exit code 0, no errors
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wantsGame } from './gameBuilder';
import { testPage, reportText, failures, type TestReport } from './runtimeTest';
import { runCommand, detectErrors } from './terminal';

export const PROJECTS_DIR = process.env.JARVIS_PROJECTS_DIR || path.join(os.homedir(), 'JarvisProjects');
export type ProjectKind = 'web' | 'python' | 'node';

/** True when the request asks for software to be built (games have their own pipeline). */
export function wantsProject(prompt: string): boolean {
  const p = String(prompt);
  if (wantsGame(p)) return false;
  return /\b(build|create|make|generate|code|write|develop|program|set up)\b[\s\S]{0,60}\b(web ?pages?|websites?|web ?sites?|landing pages?|web ?apps?|html pages?|portfolio|calculator|to-?do( list)?|timer|stopwatch|clock|converter|form|dashboard|scripts?|utility|utilities|tool|cli|command[- ]line|automation|widget|component|app|application|program)\b/i.test(p);
}

export function projectKind(prompt: string): ProjectKind {
  if (/\bpython\b|\.py\b/i.test(prompt)) return 'python';
  if (/\b(node(\.js)?|javascript cli|command[- ]line|cli tool|script|automation)\b/i.test(prompt) && !/\b(web|html|page|site|browser)\b/i.test(prompt)) return 'node';
  return 'web';
}

const ENTRY: Record<ProjectKind, string> = { web: 'index.html', python: 'main.py', node: 'main.js' };

export function projectPrompt(request: string, kind: ProjectKind, repair?: { errors: string[]; files: Record<string, string> }) {
  const rules = kind === 'web'
    ? `- A static website: ${ENTRY.web} is the entry page; separate style.css / script.js files are fine (link them with relative paths).
- It must work when opened straight from disk (file://): no build step, no server, no external CDNs, fonts, images or APIs. Draw images with CSS/SVG/canvas if needed.
- Real, working functionality for everything shown (every button does something), responsive layout, a <title>.
- No alert()/prompt()/confirm(); no console errors.`
    : `- A ${kind === 'python' ? 'Python 3' : 'Node.js (ES modules not required; plain CommonJS is fine)'} program; ${ENTRY[kind]} is the entry point.
- Standard library only (no packages to install).
- It must run to completion WITHOUT user input (never block on input()/readline): use sensible defaults or command-line arguments with defaults, print clear output and exit with code 0.
- Handle errors properly; include a small self-test or demo run in the main entry when it helps show it works.`;
  const base = `Build this as a real, working project: "${request}".

Rules:
${rules}
- Complete code only: no TODOs, placeholders or "rest of the code here".

Return EVERY file in exactly this format (nothing else between files):
=== FILE: <relative/path.ext> ===
<file content>
=== END FILE ===

Then one line: SUMMARY: <what it is and how to use it>`;
  if (!repair) return base;
  return `${base}

Your previous version FAILED when JARVIS ran and tested it:
${repair.errors.map((e) => `- ${e}`).join('\n')}

Previous files:
${Object.entries(repair.files).map(([n, c]) => `=== FILE: ${n} ===\n${c.slice(0, 20000)}\n=== END FILE ===`).join('\n')}

Fix the cause of every failure and return ALL files again in the same format.`;
}

/** Parses "=== FILE: name ===" blocks; rejects unsafe paths. */
export function parseFiles(reply: string): { files: Record<string, string>; summary: string } {
  const files: Record<string, string> = {};
  for (const m of String(reply).matchAll(/===\s*FILE:\s*([^\n=]+?)\s*===\s*\n([\s\S]*?)\n?===\s*END FILE\s*===/gi)) {
    const name = m[1].trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/^[\w][\w\-./ ]{0,100}$/.test(name) || name.split('/').some((p) => p === '..' || p === '') || path.isAbsolute(name)) continue;
    files[name] = m[2].replace(/^```[\w-]*\n/, '').replace(/\n```\s*$/, '');
  }
  return { files, summary: String(reply).match(/SUMMARY:\s*(.+)/)?.[1]?.trim() ?? '' };
}

const slug = (s: string) => s.toLowerCase().replace(/\b(build|create|make|generate|code|write|develop|a|an|the|simple|please|jarvis|me)\b/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

export function projectDir(request: string) {
  const base = path.join(PROJECTS_DIR, slug(request));
  let dir = base;
  for (let i = 2; fs.existsSync(dir); i++) dir = `${base}-${i}`;
  return dir;
}

export function writeProject(dir: string, files: Record<string, string>) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = path.resolve(dir, name);
    if (!full.startsWith(path.resolve(dir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
}

/** Runs and tests a project folder. */
export async function testProject(dir: string, kind: ProjectKind): Promise<TestReport> {
  const entry = path.join(dir, ENTRY[kind]);
  if (!fs.existsSync(entry)) return { ok: false, checks: [{ name: 'Entry file', ok: false, detail: `${ENTRY[kind]} is missing` }], errors: [], title: '' };
  if (kind === 'web') return testPage(entry);
  const r = await runCommand(kind === 'python' ? `python "${ENTRY.python}"` : `node "${ENTRY.node}"`, { shell: 'cmd', cwd: dir, timeoutSec: 30 });
  const out = `${r.stdout}\n${r.stderr}`.trim();
  const errors = r.code === 0 ? detectErrors(r.stderr).filter((l) => /traceback|error/i.test(l)) : detectErrors(out);
  const checks = [
    { name: 'Runs', ok: !r.timedOut, detail: r.timedOut ? 'did not finish within 30 s (waiting for input, or an endless loop)' : `finished in ${(r.ms / 1000).toFixed(1)} s` },
    { name: 'Exit code 0', ok: r.code === 0, detail: `exit code ${r.code}` },
    { name: 'No errors', ok: r.code === 0 && !errors.length, detail: errors.length ? errors.join(' | ') : r.code === 0 ? 'none' : out.split('\n').slice(-6).join(' | ').slice(0, 600) },
    { name: 'Output', ok: true, detail: r.stdout.trim().split('\n').slice(0, 6).join(' | ').slice(0, 400) || '(no output)' },
  ];
  return { ok: checks.every((c) => c.ok), checks, errors, title: path.basename(dir) };
}

export interface BuildLog { (kind: 'ACTION' | 'RESULT' | 'ERROR' | 'VERIFICATION', text: string): void }
export interface BuildResult { dir: string; kind: ProjectKind; entry: string; files: string[]; summary: string; report: TestReport; attempts: number }

/** The whole pipeline. `generate` asks the assigned agent; throws when it never passes. */
export async function buildProject(request: string, generate: (prompt: string) => Promise<string>, log: BuildLog, maxAttempts = 3): Promise<BuildResult> {
  const kind = projectKind(request);
  const dir = projectDir(request);
  log('ACTION', `Plan: a ${kind === 'web' ? 'static web' : kind === 'python' ? 'Python' : 'Node.js'} project (${ENTRY[kind]}) in ${dir}`);
  let files: Record<string, string> = {};
  let summary = '';
  let errors: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log('ACTION', attempt === 1 ? 'Writing the code' : `Fixing ${errors.length} problem(s) (attempt ${attempt})`);
    const parsed = parseFiles(await generate(projectPrompt(request, kind, attempt > 1 ? { errors, files } : undefined)));
    if (!Object.keys(parsed.files).length) { errors = ['No files were returned in the "=== FILE: name ===" format.']; log('ERROR', errors[0]); continue; }
    if (attempt > 1) fs.rmSync(dir, { recursive: true, force: true }); // a clean folder for the fixed version
    files = parsed.files;
    summary = parsed.summary || summary;
    writeProject(dir, files);
    log('ACTION', `${attempt === 1 ? 'Created project' : 'Rewrote project'}: ${Object.keys(files).join(', ')}`);
    log('ACTION', `Running ${ENTRY[kind]} and testing it`);
    const report = await testProject(dir, kind);
    log('VERIFICATION', reportText(report));
    if (report.ok) {
      log('RESULT', `Test successful${attempt > 1 ? ` after ${attempt - 1} fix(es)` : ''}`);
      return { dir, kind, entry: path.join(dir, ENTRY[kind]), files: Object.keys(files), summary, report, attempts: attempt };
    }
    errors = failures(report);
    log('ERROR', `Detected ${errors.length} problem(s): ${errors.join('; ').slice(0, 300)}`);
  }
  throw new Error(`The project still fails after ${maxAttempts} attempts: ${errors.join('; ').slice(0, 500)}. Files are in ${dir}.`);
}
