// JARVIS activity log: what JARVIS actually did, in order, for transparency and debugging.
//   ACTION  something JARVIS (or an agent) did as part of a job ("Created Snake project")
//   TOOL    a tool call with its arguments
//   RESULT  the real outcome of a tool / job step
//   ERROR   a real failure, with the captured reason
//   CONFIRM a confirmation asked of, or given by, the user
// Kept in memory (last 500) and appended to ~/.jarvis/activity.jsonl so it survives restarts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact } from './credentials';

export type ActivityKind = 'ACTION' | 'TOOL' | 'RESULT' | 'ERROR' | 'CONFIRM';
export interface Activity { id: number; at: string; kind: ActivityKind; text: string; tool?: string; actor: string }

const FILE = process.env.JARVIS_ACTIVITY_FILE || path.join(os.homedir(), '.jarvis', 'activity.jsonl');
const MAX = 500;
const entries: Activity[] = [];
let seq = 0;
const listeners = new Set<(a: Activity) => void>();

try {
  const lines = fs.readFileSync(FILE, 'utf-8').trim().split('\n').slice(-MAX);
  for (const l of lines) { try { const a = JSON.parse(l); entries.push(a); seq = Math.max(seq, a.id); } catch {} }
  // ponytail: the file only grows; trim it on start when it gets big.
  if (lines.length >= MAX && fs.statSync(FILE).size > 2_000_000) fs.writeFileSync(FILE, lines.join('\n') + '\n');
} catch {}

const clean = (t: string) => redact(String(t)).replace(/\s+/g, ' ').trim().slice(0, 400);

export function logActivity(kind: ActivityKind, text: string, meta: { tool?: string; actor?: string } = {}): Activity {
  const a: Activity = { id: ++seq, at: new Date().toISOString(), kind, text: clean(text), tool: meta.tool, actor: meta.actor ?? 'JARVIS' };
  entries.push(a);
  if (entries.length > MAX) entries.shift();
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.appendFileSync(FILE, JSON.stringify(a) + '\n'); } catch {}
  listeners.forEach((cb) => { try { cb(a); } catch {} });
  return a;
}

export const listActivity = (since = 0) => entries.filter((a) => a.id > since);
export const onActivity = (cb: (a: Activity) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** Short human form of tool arguments for the log ("open_app name=chrome"). */
export const describeArgs = (args: Record<string, any>) =>
  Object.entries(args ?? {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ').slice(0, 200);
