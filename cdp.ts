// Minimal Chrome DevTools Protocol client (browser-level, flattened sessions) + Chrome launcher.
// Used by the BROWSER skill (a visible, automatable Chrome) and by the runtime tester (headless).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

export const CHROME = [
  process.env.JARVIS_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p): p is string => !!p && fs.existsSync(p));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
  private handlers = new Set<(method: string, params: any, sessionId?: string) => void>();
  closed = false;
  private constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
      } else this.handlers.forEach((h) => { try { h(m.method, m.params, m.sessionId); } catch {} });
    });
    ws.on('close', () => {
      this.closed = true;
      this.pending.forEach((p) => p.reject(new Error('Browser connection closed')));
      this.pending.clear();
    });
  }
  static async connect(wsUrl: string) {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new Cdp(ws);
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30000): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Browser connection closed'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, timeoutMs);
    });
  }
  on(h: (method: string, params: any, sessionId?: string) => void) { this.handlers.add(h); return () => { this.handlers.delete(h); }; }
  /** Resolves when the event fires (optionally matching), or after ms (false). */
  waitFor(method: string, ms: number, match: (p: any, s?: string) => boolean = () => true): Promise<boolean> {
    return new Promise((resolve) => {
      const off = this.on((m, p, s) => { if (m === method && match(p, s)) { off(); clearTimeout(t); resolve(true); } });
      const t = setTimeout(() => { off(); resolve(false); }, ms);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

/** The DevTools port Chrome wrote for a profile started with --remote-debugging-port=0. */
export function devToolsPort(profile: string): number | null {
  try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf-8').split('\n')[0]) || null; } catch { return null; }
}

export async function browserWsUrl(port: number): Promise<string | null> {
  try { return ((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as any).webSocketDebuggerUrl ?? null; } catch { return null; }
}

/** Starts Chrome on a profile and connects to it. */
export async function launchChrome(opts: { profile: string; headless: boolean; args?: string[]; detached?: boolean }): Promise<{ cdp: Cdp; port: number; proc: ChildProcess }> {
  if (!CHROME) throw new Error('Chrome or Edge is not installed, so there is no browser to automate.');
  fs.mkdirSync(opts.profile, { recursive: true });
  try { fs.unlinkSync(path.join(opts.profile, 'DevToolsActivePort')); } catch {}
  const proc = spawn(CHROME, [
    ...(opts.headless ? ['--headless=new', '--mute-audio'] : []),
    '--remote-debugging-port=0', `--user-data-dir=${opts.profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync',
    ...(opts.args ?? []),
  ], { stdio: 'ignore', windowsHide: opts.headless, detached: !!opts.detached });
  if (opts.detached) proc.unref();
  for (let i = 0; i < 80; i++) {
    const port = devToolsPort(opts.profile);
    const ws = port ? await browserWsUrl(port) : null;
    if (port && ws) return { cdp: await Cdp.connect(ws), port, proc };
    if (proc.exitCode !== null && !opts.detached) throw new Error(`The browser exited during start-up (code ${proc.exitCode}).`);
    await sleep(250);
  }
  try { proc.kill(); } catch {}
  throw new Error('The browser did not start.');
}
