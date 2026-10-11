// Proactive JARVIS: tells the user when something genuinely needs their attention.
// Sources (each can be switched off in Settings -> Permission Center -> Proactive):
//   reminders  their reminders and automations firing
//   email      new important email (flagged / Gmail-important), checked every 5 minutes
//   downloads  a download finished (Downloads folder + the JARVIS browser)
//   builds     a build, background process or team task failed
// Not annoying: identical notices within 15 minutes are dropped, and non-urgent ones are at least
// 90 s apart (several waiting ones are combined into one).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proactiveConfig, type ProactiveConfig } from './apiSettings';
import { logActivity } from './activity';

export type Source = Exclude<keyof ProactiveConfig, 'enabled'>;
export interface Notice { text: string; source: Source; at: string; urgent: boolean }

const listeners = new Set<(n: Notice) => void>();
export const onNotice = (cb: (n: Notice) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

const recent = new Map<string, number>();
let lastAt = 0;
let held: Notice[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const GAP_MS = 90_000;
const DEDUPE_MS = 15 * 60_000;

function deliver(n: Notice) {
  lastAt = Date.now();
  logActivity('ACTION', `Told the user (${n.source}): ${n.text}`);
  listeners.forEach((cb) => { try { cb(n); } catch {} });
}
function flush() {
  flushTimer = null;
  if (!held.length) return;
  const batch = held;
  held = [];
  deliver(batch.length === 1 ? batch[0] : { ...batch[0], text: batch.map((n) => n.text).join(' Also: '), at: new Date().toISOString() });
}

/** Ask JARVIS to tell the user something. Returns false when that source is off or it's a repeat. */
export function notify(source: Source, text: string, opts: { urgent?: boolean; key?: string } = {}) {
  const cfg = proactiveConfig();
  if (!cfg.enabled || !cfg[source]) return false;
  const key = opts.key ?? `${source}:${text}`;
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  if (recent.has(key)) return false;
  recent.set(key, now);
  const n: Notice = { text, source, at: new Date().toISOString(), urgent: !!opts.urgent };
  if (n.urgent || now - lastAt >= GAP_MS) { deliver(n); return true; }
  held.push(n);
  flushTimer ??= setTimeout(flush, GAP_MS - (now - lastAt));
  return true;
}
export const wasNotified = (key: string) => recent.has(key);

// ---------------------------------------------------------------------------------------------
// Monitors

const PARTIAL = /\.(crdownload|part|partial|tmp|download|opdownload)$|^~\$|^\./i;

/** Watches the Downloads folder: a new, finished file -> "your download has finished". */
export function watchDownloads(dir = path.join(os.homedir(), 'Downloads')) {
  const seen = new Set<string>();
  try { for (const f of fs.readdirSync(dir)) seen.add(f); } catch { return () => {}; }
  let w: fs.FSWatcher;
  try {
    w = fs.watch(dir, (_e, name) => {
      const file = name ? String(name) : '';
      if (!file || PARTIAL.test(file) || seen.has(file)) return;
      // Wait until the size stops changing (still being written otherwise).
      let last = -1;
      const check = (tries: number) => {
        try {
          const s = fs.statSync(path.join(dir, file));
          if (!s.isFile()) return;
          if (s.size > 0 && s.size === last) { seen.add(file); downloadFinished(path.join(dir, file)); return; }
          last = s.size;
        } catch { return; }
        if (tries < 40) setTimeout(() => check(tries + 1), 1500);
      };
      setTimeout(() => check(0), 1000);
    });
  } catch { return () => {}; }
  return () => w.close();
}

export function downloadFinished(file: string) {
  const kb = (() => { try { return Math.round(fs.statSync(file).size / 1024); } catch { return 0; } })();
  notify('downloads', `Boss, your download has finished: ${path.basename(file)}${kb ? ` (${kb > 2048 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`})` : ''}.`, { key: `download:${path.basename(file)}` });
}
