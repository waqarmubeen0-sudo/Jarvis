// TERMINAL skill: a controlled development environment on the user's PC.
//   run    one command (PowerShell, cmd, Python, Node), waits, returns output + exit code + errors
//   start  a long-running process in the background (dev servers, watchers), output kept
//   output / stop / list for background processes
// High-impact commands never run silently: destructive / system-changing / credential / upload
// commands always need the user's yes, and installs follow the SOFTWARE_INSTALL permission.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type } from '@google/genai';
import { resolvePath } from './osTools';
import { registerSkill, type ToolResult } from './skillRegistry';
import type { Risk } from './permissions';

export type Shell = 'powershell' | 'cmd' | 'python' | 'node';
const MAX_OUT = 20_000;
// Plain output (no colours) so errors can be read and matched; ANSI codes are stripped as well.
const PLAIN_ENV = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', PYTHON_COLORS: '0', PYTHONIOENCODING: 'utf-8' };
const ANSI = new RegExp(String.fromCharCode(27) + '\[[0-9;?]*[A-Za-z]', 'g');
export const plain = (s: string) => String(s).replace(ANSI, '');

const INSTALL = /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bnpx\s+--?y(es)?\b|\bpip3?\s+install\b|\bpython\s+-m\s+pip\s+install\b|\b(winget|choco|scoop)\s+install\b|\bmsiexec\b|\bInstall-(Module|Package|Script)\b|\bAdd-AppxPackage\b|\.msi\b|\bsetup\.exe\b/i;
const DESTRUCTIVE = /\brm\s+-[a-z]*[rf]|\bRemove-Item\b|\b(del|erase|rd|rmdir)\b|\bformat(\.com)?\s+[a-z]:|\bdiskpart\b|\bStop-Computer\b|\bRestart-Computer\b|\bshutdown(\.exe)?\b|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+(-f\b|--force))|\breg(\.exe)?\s+(add|delete|import)\b|\b(Set|New|Remove)-ItemProperty\b|\bHKLM:|\bbcdedit\b|\bicacls\b|\btakeown\b|\bnetsh\b|\bSet-ExecutionPolicy\b|\bsc(\.exe)?\s+(delete|config|stop)\b|\bDisable-\w+|\bcipher\s+\/w|\bvssadmin\b|\bwmic\b.*\bdelete\b|\bStop-Process\b.*-Force|\btaskkill\b|\bClear-(Content|RecycleBin)\b|\bmkfs\b|\bdd\s+if=/i;
const CREDENTIALS = /\b(password|passwd|secret|token|api[_-]?key|credential|private[_-]?key)s?\b|\.ssh\b|\bid_rsa\b|(^|[\\/\s])\.env\b|\bcmdkey\b|\bGet-Credential\b|\bConvertFrom-SecureString\b|\bvault\b|\bLogin Data\b|\bCookies\b/i;
const UPLOAD = /\bcurl\b.*\s(-T|--upload-file|-F|--form|--data-binary\s+@)|\bInvoke-(WebRequest|RestMethod)\b.*-(InFile|Method\s+(Post|Put))|\bscp\b|\bftp\b/i;
const ELEVATE = /\brunas\b|-Verb\s+RunAs|\bsudo\b/i;

/** Why a command needs a yes (null = it may run under the TERMINAL permission alone). */
export function commandRisk(command: string): Risk | null {
  const c = String(command);
  if (DESTRUCTIVE.test(c)) return { reason: 'it can delete data or change system settings' };
  if (CREDENTIALS.test(c)) return { reason: 'it touches passwords, keys or other credentials' };
  if (UPLOAD.test(c)) return { reason: 'it sends data from your PC to the internet' };
  if (ELEVATE.test(c)) return { reason: 'it asks for administrator rights' };
  if (INSTALL.test(c)) return { reason: 'it installs software', perm: 'SOFTWARE_INSTALL' };
  return null;
}

/** Lines that look like real errors in a command's output. */
export function detectErrors(out: string): string[] {
  return String(out).split(/\r?\n/).filter((l) => /\b(error|exception|traceback|failed|fatal|cannot find|not recognized|is not defined|ENOENT|EADDRINUSE|ERR!)\b|\w(Error|Exception)\b/i.test(l) && !/\b0 errors?\b|\bno errors?\b/i.test(l)).slice(0, 12).map((l) => l.trim().slice(0, 300));
}

function argv(shell: Shell, command: string): [string, string[]] {
  switch (shell) {
    // cmd.exe parses its own command line: pass it verbatim, wrapped in quotes for /s /c.
    case 'cmd': return ['cmd.exe', ['/d', '/s', '/c', `"${command}"`]];
    case 'python': return ['python', ['-c', command]];
    case 'node': return [process.execPath, ['-e', command]];
    default: return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]];
  }
}
const shellOf = (s: unknown): Shell => (['powershell', 'cmd', 'python', 'node'].includes(String(s)) ? (String(s) as Shell) : 'powershell');
function cwdOf(dir: unknown) {
  const cwd = dir ? resolvePath(String(dir)) : os.homedir();
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`No folder at ${cwd}.`);
  return cwd;
}
const tail = (s: string, n = MAX_OUT) => (s.length > n ? `…(${s.length - n} earlier characters cut)\n${s.slice(-n)}` : s);

/** Runs one command to completion. */
export function runCommand(command: string, opts: { shell?: Shell; cwd?: string; timeoutSec?: number } = {}): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; ms: number }> {
  const [exe, args] = argv(opts.shell ?? 'powershell', command);
  const t0 = Date.now();
  return new Promise((resolve) => {
    execFile(exe, args, { cwd: opts.cwd ?? os.homedir(), windowsVerbatimArguments: exe === 'cmd.exe', timeout: Math.min(600, opts.timeoutSec ?? 120) * 1000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: PLAIN_ENV },
      (err: any, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: plain(String(stdout)), stderr: plain(String(stderr)) || (err && typeof err.code !== 'number' ? err.message : ''), timedOut: !!err?.killed, ms: Date.now() - t0 }));
  });
}

// ---------------------------------------------------------------------------------------------
// Background processes

interface Job { id: string; command: string; shell: Shell; cwd: string; proc: ChildProcess; out: string; startedAt: string; exit: number | null | undefined; errors: string[] }
const jobs = new Map<string, Job>();
const exitListeners = new Set<(j: { id: string; command: string; code: number | null; errors: string[] }) => void>();
export const onJobExit = (cb: (j: { id: string; command: string; code: number | null; errors: string[] }) => void) => { exitListeners.add(cb); return () => { exitListeners.delete(cb); }; };

export function startJob(command: string, shell: Shell, cwd: string, name?: string): Job {
  const [exe, args] = argv(shell, command);
  const proc = spawn(exe, args, { cwd, windowsHide: true, windowsVerbatimArguments: exe === 'cmd.exe', env: PLAIN_ENV });
  const id = (name ? String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) + '-' : 'job-') + Math.random().toString(36).slice(2, 6);
  const job: Job = { id, command, shell, cwd, proc, out: '', startedAt: new Date().toISOString(), exit: undefined, errors: [] };
  const add = (b: Buffer) => { job.out = (job.out + plain(b.toString())).slice(-200_000); };
  proc.stdout?.on('data', add);
  proc.stderr?.on('data', add);
  proc.on('error', (e) => { job.out += `\n${e.message}`; });
  proc.on('exit', (code) => {
    job.exit = code;
    job.errors = detectErrors(job.out);
    exitListeners.forEach((cb) => { try { cb({ id, command, code, errors: job.errors }); } catch {} });
  });
  jobs.set(id, job);
  return job;
}

function stopJob(job: Job) {
  if (job.exit !== undefined) return;
  // The whole process tree (dev servers spawn children).
  try { execFile('taskkill', ['/PID', String(job.proc.pid), '/T', '/F'], { windowsHide: true }); } catch { job.proc.kill(); }
}
process.once('exit', () => { for (const j of jobs.values()) try { j.proc.kill(); } catch {} });

const jobView = (j: Job) => ({ id: j.id, command: j.command.slice(0, 120), cwd: j.cwd, startedAt: j.startedAt, status: j.exit === undefined ? 'RUNNING' : `EXITED (${j.exit})` });
export const listJobs = () => [...jobs.values()].map(jobView);

async function terminalAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'run').toLowerCase();
  if (action === 'list') return { status: 'SUCCESS', message: `${jobs.size} background process(es)`, processes: listJobs() };
  if (action === 'output' || action === 'stop') {
    const j = jobs.get(String(a.id)) ?? [...jobs.values()].reverse().find((x) => x.command.includes(String(a.id ?? '')));
    if (!j) return { status: 'FAILED', error: `No background process "${a.id}".` };
    if (action === 'stop') { stopJob(j); await new Promise((r) => setTimeout(r, 600)); return { status: 'SUCCESS', message: `Stopped ${j.id} (${j.command.slice(0, 60)})` }; }
    return { status: 'SUCCESS', message: `${j.id}: ${jobView(j).status}`, output: tail(j.out, 8000), errors: detectErrors(j.out) };
  }
  const command = String(a.command ?? '').trim();
  if (!command) throw new Error('No command given.');
  const shell = shellOf(a.shell);
  const cwd = cwdOf(a.cwd);
  if (action === 'start') {
    const j = startJob(command, shell, cwd, a.name);
    await new Promise((r) => setTimeout(r, Math.min(15, Number(a.wait ?? 4)) * 1000)); // let it start (or fail)
    const errors = detectErrors(j.out);
    if (j.exit !== undefined && j.exit !== 0) return { status: 'FAILED', error: `It exited straight away with code ${j.exit}.`, id: j.id, output: tail(j.out, 6000), errors };
    return { status: 'SUCCESS', message: `Started ${j.id} in the background${j.exit === undefined ? '' : ' (it already finished)'}`, id: j.id, output: tail(j.out, 4000), errors };
  }
  if (action !== 'run') return { status: 'FAILED', error: `Unknown terminal action "${action}".` };
  const r = await runCommand(command, { shell, cwd, timeoutSec: Number(a.timeout ?? 120) });
  const output = tail(`${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`.trim());
  const errors = detectErrors(`${r.stdout}\n${r.stderr}`);
  if (r.timedOut) return { status: 'FAILED', error: `Timed out after ${a.timeout ?? 120}s. For long-running things use action 'start'.`, output, errors };
  return r.code === 0
    ? { status: 'SUCCESS', message: `Exit code 0 (${(r.ms / 1000).toFixed(1)}s)${errors.length ? `, but the output mentions ${errors.length} error line(s)` : ''}`, exitCode: 0, output, errors }
    : { status: 'FAILED', error: `Exit code ${r.code}${errors[0] ? `: ${errors[0]}` : ''}`, exitCode: r.code, output, errors };
}

const str = (description: string) => ({ type: Type.STRING, description });
registerSkill({
  id: 'terminal',
  name: 'TERMINAL',
  description: 'Runs PowerShell, cmd, Python and Node commands, background dev servers, tests and builds, and reads their output and errors.',
  guide: "terminal run for commands/tests/builds (read exitCode, output and errors; if it fails, fix the cause and run again); terminal start for dev servers and other long-running processes, then output/stop by id. Set cwd to the project folder. Report the real result, never assume success.",
  tools: [{
    name: 'terminal',
    description: "Run commands on the user's PC. action 'run' (waits, returns exitCode/output/errors), 'start' (background process; returns id), 'output' (id), 'stop' (id), 'list'. shell: 'powershell' (default) | 'cmd' | 'python' (code) | 'node' (code). cwd: working folder (relative = from home).",
    parameters: { type: Type.OBJECT, properties: {
      action: str("'run' | 'start' | 'output' | 'stop' | 'list'"), command: str('Command line (or code for python/node)'), shell: str("'powershell' | 'cmd' | 'python' | 'node'"),
      cwd: str('Working directory'), timeout: { type: Type.NUMBER, description: 'Seconds before run gives up (default 120, max 600)' }, id: str('Background process id'), name: str('Optional name for a started process'),
    }, required: ['action'] },
  }],
  permission: () => ['TERMINAL'],
  risk: (_t, a) => (['run', 'start'].includes(String(a.action ?? 'run')) ? commandRisk(String(a.command ?? '')) : null),
  summary: (_t, a) => `Run in ${shellOf(a.shell)}${a.cwd ? ` (in ${a.cwd})` : ''}: ${String(a.command ?? '').slice(0, 300)}`,
  execute: (_t, a) => terminalAction(a),
});
