// AUTOMATION / TASKS skill: reminders, scheduled tasks, recurring tasks, conditional watches and
// background jobs. Saved in ~/.jarvis/automations.json, checked every 15 s, shown in System Logs ->
// AUTOMATIONS (where the user can cancel or run them).
//   REMINDER  at a time (optionally recurring): JARVIS tells the user the message
//   TASK      at a time / recurring: the prompt goes to the team (e.g. "prepare my weekly report")
//   COMMAND   at a time / recurring: a terminal command runs in the background, result reported
//   WATCH     every N minutes until it happens: a web page changes, a file appears or changes,
//             a process ends, a download finishes. Then JARVIS tells the user.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type } from '@google/genai';
import { resolvePath, ps } from './osTools';
import { notify } from './proactive';
import { commandRisk, runCommand } from './terminal';
import { logActivity } from './activity';
import { registerSkill, type ToolResult } from './skillRegistry';

type Kind = 'REMINDER' | 'TASK' | 'COMMAND' | 'WATCH';
type Unit = 'minutes' | 'hours' | 'days' | 'weeks';
export interface Automation {
  id: string;
  kind: Kind;
  title: string;
  message?: string;
  prompt?: string;
  command?: string;
  cwd?: string;
  every?: { n: number; unit: Unit };
  watch?: { type: 'url' | 'file' | 'process' | 'download'; target: string; baseline?: string };
  nextRun: string;
  status: 'ACTIVE' | 'DONE' | 'CANCELLED' | 'FAILED';
  runs: number;
  lastRun?: string;
  lastResult?: string;
  createdAt: string;
}

const FILE = process.env.JARVIS_AUTOMATIONS_FILE || path.join(os.homedir(), '.jarvis', 'automations.json');
let items: Automation[] = [];
try { items = JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch {}
const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(items, null, 2)); } catch {} };
const listeners = new Set<() => void>();
export const onAutomationChange = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const changed = () => { save(); listeners.forEach((cb) => { try { cb(); } catch {} }); };

let runPrompt: (prompt: string) => Promise<{ status: string; result: string }> = async () => ({ status: 'FAILED', result: 'The team is not connected.' });
/** server.ts connects TASK automations to the agent team. */
export const configureAutomation = (opts: { runPrompt: typeof runPrompt }) => { runPrompt = opts.runPrompt; };

// ---------------------------------------------------------------------------------------------
// Time

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const UNIT: Record<string, Unit> = { min: 'minutes', mins: 'minutes', minute: 'minutes', minutes: 'minutes', hour: 'hours', hours: 'hours', hr: 'hours', hrs: 'hours', day: 'days', days: 'days', week: 'weeks', weeks: 'weeks' };
const MS: Record<Unit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 };

function clock(text: string): { h: number; m: number } | null {
  const t = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!t || (!t[2] && !t[3] && !/\bat\s+\d/i.test(text))) return null;
  let h = Number(t[1]);
  const m = Number(t[2] ?? 0);
  if (t[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
  if (t[3]?.toLowerCase() === 'am' && h === 12) h = 0;
  return h < 24 && m < 60 ? { h, m } : null;
}

/** "2026-10-02T09:00", "in 20 minutes", "tomorrow", "tomorrow at 9am", "at 18:30", "monday 10am". Local time. */
export function parseWhen(input: string, now = new Date()): Date {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text || text === 'now') return new Date(now.getTime() + 1000);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const d = new Date(text.length === 10 ? `${text}T09:00` : text);
    if (!isNaN(+d)) return d;
  }
  const rel = text.match(/\bin\s+(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (rel && UNIT[rel[2]]) return new Date(now.getTime() + Number(rel[1]) * MS[UNIT[rel[2]]]);
  const c = clock(text);
  const d = new Date(now);
  d.setSeconds(0, 0);
  const day = DAYS.findIndex((x) => text.includes(x));
  if (/\btomorrow\b/.test(text)) d.setDate(d.getDate() + 1);
  else if (day >= 0) d.setDate(d.getDate() + (((day - d.getDay() + 7) % 7) || 7));
  if (c) d.setHours(c.h, c.m);
  else if (/\btonight\b/.test(text)) d.setHours(20, 0);
  else if (/\bthis evening\b/.test(text)) d.setHours(18, 0);
  else if (/\btomorrow\b/.test(text) || day >= 0) d.setHours(9, 0); // a day without a time: 9 am
  else throw new Error(`I couldn't work out when "${input}" is. Give a time like "in 20 minutes", "tomorrow 9am" or "2026-10-02T09:00".`);
  if (d <= now && !/\btomorrow\b/.test(text) && day < 0) d.setDate(d.getDate() + 1); // "at 9am" already passed today
  return d;
}

/** "day", "week", "monday", "2 hours", "30 minutes" -> an interval (+ the first run for weekdays). */
export function parseEvery(input: string, time: string | undefined, now = new Date()): { every: { n: number; unit: Unit }; first?: Date } {
  const text = String(input).toLowerCase().trim();
  const day = DAYS.findIndex((x) => text.includes(x));
  if (day >= 0) return { every: { n: 1, unit: 'weeks' }, first: parseWhen(`${DAYS[day]} ${time ?? '9:00'}`, now) };
  const m = text.match(/^(\d+)?\s*([a-z]+)/);
  const unit = m ? UNIT[m[2]] ?? (m[2] === 'daily' ? 'days' : m[2] === 'weekly' ? 'weeks' : m[2] === 'hourly' ? 'hours' : undefined) : undefined;
  if (!unit) throw new Error(`"${input}" isn't a repeat I understand. Use e.g. "day", "week", "monday", "2 hours".`);
  const n = Math.max(1, Number(m![1] ?? 1));
  if (unit === 'minutes' && n < 5) throw new Error('Repeating more often than every 5 minutes is not allowed.');
  return { every: { n, unit }, first: time ? parseWhen(`at ${time}`, now) : undefined };
}

// ---------------------------------------------------------------------------------------------
// Running

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex');
async function pageText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 JARVIS' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/** One check of a WATCH: returns a message when the condition is met, else null. */
async function checkWatch(a: Automation): Promise<string | null> {
  const w = a.watch!;
  switch (w.type) {
    case 'url': {
      const h = hash(await pageText(w.target));
      if (!w.baseline) { w.baseline = h; return null; }
      return h !== w.baseline ? `the page ${w.target} has changed` : null;
    }
    case 'file': {
      const f = resolvePath(w.target);
      const now = fs.existsSync(f) ? String(fs.statSync(f).mtimeMs) : 'missing';
      if (w.baseline === undefined) { w.baseline = now; return null; }
      return now !== w.baseline ? (w.baseline === 'missing' ? `${path.basename(f)} now exists` : `${path.basename(f)} has changed`) : null;
    }
    case 'process': {
      const out = await ps('(Get-Process -Name ($env:N -replace "\\.exe$","") -ErrorAction SilentlyContinue | Measure-Object).Count', { N: w.target });
      return Number(out) === 0 ? `${w.target} has finished (it is no longer running)` : null;
    }
    case 'download': {
      const dir = path.join(os.homedir(), 'Downloads');
      const want = w.target.toLowerCase();
      const hit = [dir, path.join(dir, 'JARVIS')].flatMap((d) => { try { return fs.readdirSync(d); } catch { return []; } })
        .find((f) => f.toLowerCase().includes(want) && !/\.(crdownload|part|tmp)$/i.test(f));
      return hit ? `the download ${hit} has finished` : null;
    }
  }
  return null;
}

function reschedule(a: Automation, from: number) {
  if (!a.every) { a.status = 'DONE'; return; }
  let next = new Date(a.nextRun).getTime();
  while (next <= from) next += a.every.n * MS[a.every.unit];
  a.nextRun = new Date(next).toISOString();
}

async function fire(a: Automation) {
  const now = Date.now();
  a.lastRun = new Date(now).toISOString();
  try {
    if (a.kind === 'WATCH') {
      const hit = await checkWatch(a);
      if (!hit) { a.nextRun = new Date(now + (a.every ? a.every.n * MS[a.every.unit] : 5 * 60_000)).toISOString(); a.lastResult = 'checked, no change yet'; return; }
      a.runs++;
      a.lastResult = hit;
      a.status = 'DONE';
      logActivity('RESULT', `Watch "${a.title}": ${hit}`);
      notify('reminders', `Boss, ${hit}${a.message ? `: ${a.message}` : ''}.`, { urgent: true, key: `auto:${a.id}` });
      return;
    }
    a.runs++;
    if (a.kind === 'REMINDER') {
      a.lastResult = 'reminded';
      logActivity('ACTION', `Reminder: ${a.message ?? a.title}`);
      notify('reminders', `You asked me to remind you: ${a.message ?? a.title}.`, { urgent: true, key: `auto:${a.id}:${a.runs}` });
    } else if (a.kind === 'TASK') {
      logActivity('ACTION', `Scheduled task started: ${a.title}`);
      const r = await runPrompt(a.prompt ?? a.title);
      a.lastResult = `${r.status}: ${r.result.slice(0, 300)}`;
      notify('reminders', r.status === 'COMPLETED' ? `Boss, your scheduled task "${a.title}" is done. It's in your chat.` : `Boss, your scheduled task "${a.title}" failed: ${r.result.slice(0, 160)}`, { urgent: true, key: `auto:${a.id}:${a.runs}` });
    } else if (a.kind === 'COMMAND') {
      logActivity('ACTION', `Scheduled command: ${a.command}`);
      const r = await runCommand(a.command!, { cwd: a.cwd, timeoutSec: 600 });
      a.lastResult = `exit ${r.code}: ${(r.stderr || r.stdout).trim().slice(-300)}`;
      if (r.code !== 0) notify('builds', `Boss, the scheduled command "${a.title}" failed (exit ${r.code}).`, { key: `auto:${a.id}:${a.runs}` });
      else if (a.message) notify('reminders', `Boss, "${a.title}" ran fine.`, { key: `auto:${a.id}:${a.runs}` });
    }
    reschedule(a, now);
  } catch (e: any) {
    a.lastResult = `error: ${e?.message ?? e}`;
    logActivity('ERROR', `Automation "${a.title}" failed: ${e?.message ?? e}`);
    if (a.kind === 'WATCH') a.nextRun = new Date(now + 5 * 60_000).toISOString(); // try again later
    else reschedule(a, now);
  }
}

let ticking = false;
export function startScheduler() {
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const due = items.filter((a) => a.status === 'ACTIVE' && new Date(a.nextRun).getTime() <= Date.now());
      for (const a of due) await fire(a);
      if (due.length) changed();
    } finally { ticking = false; }
  };
  const iv = setInterval(tick, 15_000);
  tick();
  return () => clearInterval(iv);
}

export const listAutomations = (all = false) => items.filter((a) => all || a.status === 'ACTIVE').map((a) => ({ ...a, watch: a.watch && { type: a.watch.type, target: a.watch.target } }));
export function cancelAutomation(id: string) {
  const a = items.find((x) => x.id === id || x.title.toLowerCase().includes(String(id).toLowerCase()));
  if (!a || a.status !== 'ACTIVE') return null;
  a.status = 'CANCELLED';
  changed();
  return a;
}
export async function runNow(id: string) {
  const a = items.find((x) => x.id === id);
  if (!a || a.status !== 'ACTIVE') return null;
  await fire(a);
  changed();
  return a;
}

export function createAutomation(a: Record<string, any>, now = new Date()): Automation {
  const kind = String(a.kind ?? (a.watch_type ? 'WATCH' : a.prompt ? 'TASK' : a.command ? 'COMMAND' : 'REMINDER')).toUpperCase() as Kind;
  if (!['REMINDER', 'TASK', 'COMMAND', 'WATCH'].includes(kind)) throw new Error(`Unknown automation kind "${a.kind}".`);
  let every: Automation['every'];
  let first: Date | undefined;
  if (a.every) ({ every, first } = parseEvery(String(a.every), a.time, now));
  if (a.when) first = parseWhen(String(a.when), now);
  if (kind === 'WATCH') {
    if (!['url', 'file', 'process', 'download'].includes(String(a.watch_type))) throw new Error("A watch needs watch_type 'url', 'file', 'process' or 'download' and a watch_target.");
    if (!a.watch_target) throw new Error('A watch needs a watch_target.');
    every ??= { n: 5, unit: 'minutes' };
    first ??= now;
  }
  if (!first) {
    if (!every) throw new Error('Say when: give "when" (e.g. "tomorrow 9am", "in 20 minutes") or "every" (e.g. "monday", "day").');
    first = new Date(now.getTime() + every.n * MS[every.unit]);
  }
  if (kind === 'TASK' && !a.prompt) throw new Error('A scheduled task needs a prompt (what the team should do).');
  if (kind === 'COMMAND' && !a.command) throw new Error('A scheduled command needs the command.');
  if (kind === 'REMINDER' && !a.message && !a.title) throw new Error('A reminder needs a message.');
  const item: Automation = {
    id: `auto-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind,
    title: String(a.title ?? a.message ?? a.prompt ?? a.command ?? a.watch_target).slice(0, 120),
    message: a.message ? String(a.message).slice(0, 500) : undefined, prompt: a.prompt ? String(a.prompt).slice(0, 2000) : undefined,
    command: a.command ? String(a.command) : undefined, cwd: a.cwd ? resolvePath(String(a.cwd)) : undefined, every,
    watch: kind === 'WATCH' ? { type: a.watch_type, target: String(a.watch_target) } : undefined,
    nextRun: first.toISOString(), status: 'ACTIVE', runs: 0, createdAt: now.toISOString(),
  };
  items.push(item);
  changed();
  return item;
}

const describe = (a: Automation) => {
  const when = new Date(a.nextRun).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${a.kind} "${a.title}" ${a.kind === 'WATCH' ? `watching ${a.watch?.type} ${a.watch?.target}` : `next ${when}`}${a.every ? ` (every ${a.every.n === 1 ? '' : a.every.n + ' '}${a.every.n === 1 ? a.every.unit.replace(/s$/, '') : a.every.unit})` : ''}`;
};

async function automationAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action ?? 'create').toLowerCase();
  if (action === 'list') {
    const list = listAutomations();
    return { status: 'SUCCESS', message: `${list.length} active automation(s)`, automations: list.map((x) => `${x.id}: ${describe(x as Automation)}`) };
  }
  if (action === 'cancel') {
    const c = cancelAutomation(String(a.id ?? a.title ?? ''));
    return c ? { status: 'SUCCESS', message: `Cancelled ${describe(c)}` } : { status: 'FAILED', error: `No active automation matches "${a.id ?? a.title}".` };
  }
  if (action === 'run_now') {
    const r = await runNow(String(a.id ?? ''));
    return r ? { status: 'SUCCESS', message: `Ran "${r.title}": ${r.lastResult ?? 'done'}` } : { status: 'FAILED', error: `No active automation "${a.id}".` };
  }
  if (action !== 'create') return { status: 'FAILED', error: `Unknown automation action "${action}".` };
  const item = createAutomation(a);
  return { status: 'SUCCESS', message: `Set: ${describe(item)}`, id: item.id, nextRun: new Date(item.nextRun).toLocaleString() };
}

const str = (description: string) => ({ type: Type.STRING, description });
registerSkill({
  id: 'automation',
  name: 'AUTOMATION & TASKS',
  description: 'Reminders, scheduled and recurring tasks, conditional watches (page changes, files, processes, downloads) and background jobs.',
  guide: "automation create for 'remind me...', 'every Monday prepare my report' (kind TASK, every 'monday', time '09:00', prompt), 'tell me when this download finishes' (WATCH download), 'check this page later and tell me if it changes' (WATCH url). 'Remind me about this' means write what 'this' is into the message. Confirm the time it returns. automation list / cancel.",
  tools: [{
    name: 'automation',
    description: "Reminders and automations. action 'create' | 'list' | 'cancel' (id or title) | 'run_now' (id). For create: kind REMINDER (message) | TASK (prompt for the team) | COMMAND (command, cwd) | WATCH (watch_type 'url'|'file'|'process'|'download', watch_target, optional message). when: a local time ('2026-10-02T09:00', 'in 20 minutes', 'tomorrow 9am', 'friday 5pm'). every: repeat ('day', 'week', 'monday', '2 hours'; WATCH: check interval, default 5 minutes). time: 'HH:MM' for repeats.",
    parameters: { type: Type.OBJECT, properties: {
      action: str("'create' | 'list' | 'cancel' | 'run_now'"), kind: str("'REMINDER' | 'TASK' | 'COMMAND' | 'WATCH'"), title: str('Short name'), message: str('What to tell the user'),
      when: str('When (local time)'), every: str('Repeat'), time: str('Time of day for repeats, HH:MM'), prompt: str('TASK: what the team should do'),
      command: str('COMMAND: terminal command'), cwd: str('COMMAND: working folder'), watch_type: str("WATCH: 'url' | 'file' | 'process' | 'download'"), watch_target: str('WATCH: URL, file path, process name or download file name'), id: str('Automation id'),
    }, required: ['action'] },
  }],
  permission: (_t, a) => (String(a.kind).toUpperCase() === 'COMMAND' ? ['AUTOMATION', 'TERMINAL'] : ['AUTOMATION']),
  risk: (_t, a) => (String(a.action ?? 'create') === 'create' && a.command ? commandRisk(String(a.command)) : null),
  summary: (_t, a) => `Schedule ${String(a.kind ?? 'REMINDER').toLowerCase()} "${a.title ?? a.message ?? a.command ?? ''}"${a.command ? `: runs \`${a.command}\`` : ''} ${a.when ?? (a.every ? `every ${a.every}` : '')}`.trim(),
  execute: (_t, a) => automationAction(a),
});
