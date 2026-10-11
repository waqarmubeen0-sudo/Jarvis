// ORBIT: J.A.R.V.I.S.'s own private computer.
//
// A separate, headless Chrome/Edge instance driven over the DevTools protocol (no extra
// dependencies). Isolation from the user's own browsing:
//   - its own profile folder (~/.jarvis-orbit/browser-profile): no access to the user's
//     cookies, passwords, history or signed-in accounts
//   - headless: it never opens windows or tabs on the user's desktop
// It streams its real screen (Page.startScreencast) for the JARVIS PC panel, runs one job at a
// time (JARVIS and agents share the one screen), and stays alive between jobs for reuse.

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { WebSocket } from 'ws';
import { findSources, resultsPage } from './webSearch';

export type OrbitState = 'OFF' | 'STARTING' | 'READY' | 'ACTIVE' | 'IDLE' | 'STOPPING';
export interface OrbitActivity {
  actor: string; // 'JARVIS' or an agent id
  status: 'BROWSING' | 'SEARCHING' | 'RESEARCHING' | 'READING';
  action: string;
  url?: string;
}
export interface ResearchSource { title: string; url: string; excerpt: string }

export const ORBIT_PROFILE = path.join(os.homedir(), '.jarvis-orbit', 'browser-profile');
const BROWSERS = [
  process.env.ORBIT_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter((p): p is string => !!p);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

const READY_PAGE = `data:text/html,${encodeURIComponent(`<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#0d2233,#04070c 70%);font-family:Consolas,monospace;color:#7dd3fc">
<div style="text-align:center"><div style="font-size:42px;letter-spacing:.3em;font-weight:700;color:#e0f2fe">ORBIT</div>
<div style="margin-top:10px;font-size:15px;letter-spacing:.2em;opacity:.8">J.A.R.V.I.S. PRIVATE WORKSPACE</div>
<div style="margin-top:22px;font-size:13px;opacity:.55">isolated profile &middot; awaiting instructions</div></div></body></html>`)}`;

class OrbitComputer {
  state: OrbitState = 'OFF';
  activity: OrbitActivity | null = null;
  frame: string | null = null; // latest screen, base64 JPEG
  url = '';
  title = '';
  error = '';
  debugPort = 0; // DevTools port of the private browser (the BROWSER skill drives it in Orbit mode)
  private proc?: ChildProcess;
  private ws?: WebSocket;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private waiters = new Map<string, (() => void)[]>();
  private queue: Promise<unknown> = Promise.resolve();
  private starting?: Promise<void>;
  private listeners = new Set<(kind: 'state' | 'frame') => void>();

  onChange(cb: (kind: 'state' | 'frame') => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private emit(kind: 'state' | 'frame') {
    this.listeners.forEach((cb) => { try { cb(kind); } catch {} });
  }
  private setState(s: OrbitState) {
    this.state = s;
    this.emit('state');
  }

  /** Boot the private browser (no-op if it is already up). */
  start(): Promise<void> {
    if (this.state !== 'OFF') return this.starting ?? Promise.resolve();
    this.error = '';
    this.setState('STARTING');
    this.starting = (async () => {
      try {
        const exe = BROWSERS.find((p) => fs.existsSync(p));
        if (!exe) throw new Error('No Chrome or Edge installation found for the Orbit browser.');
        fs.mkdirSync(ORBIT_PROFILE, { recursive: true });
        const port = await freePort();
        this.debugPort = port;
        this.proc = spawn(exe, [
          '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ORBIT_PROFILE}`,
          '--window-size=1280,800', '--no-first-run', '--no-default-browser-check', '--disable-sync',
          '--disable-extensions', '--mute-audio', 'about:blank',
        ], { stdio: 'ignore', windowsHide: true });
        this.proc.on('exit', () => {
          if (this.state !== 'STOPPING' && this.state !== 'OFF') { this.teardown(); this.setState('OFF'); }
        });

        let target: { webSocketDebuggerUrl: string } | undefined;
        for (let i = 0; i < 80 && !target; i++) {
          try {
            const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[];
            target = list.find((t) => t.type === 'page');
          } catch {}
          if (!target) await sleep(250);
        }
        if (!target) throw new Error('The Orbit browser did not come up.');

        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
        this.ws = ws;
        ws.on('message', (data) => {
          const m = JSON.parse(String(data));
          if (m.id) {
            const p = this.pending.get(m.id);
            if (!p) return;
            this.pending.delete(m.id);
            m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
          } else this.onEvent(m.method, m.params);
        });
        ws.on('close', () => {
          this.pending.forEach((p) => p.reject(new Error('Orbit browser connection closed')));
          this.pending.clear();
        });

        await this.send('Page.enable');
        await this.send('Runtime.enable');
        await this.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await this.send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 960, maxHeight: 600, everyNthFrame: 1 });
        await this.goto(READY_PAGE);
        this.setState('READY');
      } catch (err: any) {
        this.error = err.message;
        this.teardown();
        this.setState('OFF');
        throw err;
      } finally {
        this.starting = undefined;
      }
    })();
    return this.starting;
  }

  /** Shut the private browser down (its profile folder stays, isolated, for next time). */
  async stop() {
    if (this.state === 'OFF' || this.state === 'STOPPING') return;
    await this.starting?.catch(() => {});
    this.setState('STOPPING');
    try { await this.send('Browser.close'); } catch {}
    await sleep(300);
    this.teardown();
    this.setState('OFF');
  }

  private teardown() {
    try { this.ws?.close(); } catch {}
    try { this.proc?.kill(); } catch {}
    this.ws = undefined;
    this.proc = undefined;
    this.frame = null;
    this.activity = null;
    this.url = '';
    this.title = '';
    this.emit('frame');
  }

  private onEvent(method: string, params: any) {
    if (method === 'Page.screencastFrame') {
      this.frame = params.data;
      this.emit('frame');
      // Chrome sends the next frame only after this ack: pacing it caps the feed at ~8 fps (what the
      // panel shows) instead of 20-60 fps of JPEG parsing on the thread that relays JARVIS's voice.
      setTimeout(() => this.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {}), 120);
    } else if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      this.url = params.frame.url.startsWith('data:') ? '' : params.frame.url;
      this.emit('state');
    }
    const w = this.waiters.get(method);
    if (w) { this.waiters.delete(method); w.forEach((f) => f()); }
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Orbit browser is not running'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
    });
  }

  private waitFor(method: string, ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      const list = this.waiters.get(method) ?? [];
      list.push(() => { clearTimeout(t); resolve(); });
      this.waiters.set(method, list);
    });
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value as T;
  }

  private async goto(url: string) {
    // The DOM is enough to show, read and answer; waiting for every ad/image (load event) made
    // heavy pages like YouTube hold JARVIS's reply for seconds.
    const loaded = this.waitFor('Page.domContentEventFired', 10000);
    await this.send('Page.navigate', { url });
    await loaded;
    await sleep(200);
    this.title = (await this.evaluate<string>('document.title').catch(() => '')) || '';
    this.emit('state');
  }

  private async scrollRead(steps: number) {
    for (let i = 0; i < steps; i++) {
      await this.evaluate('window.scrollBy({ top: innerHeight * 0.75, behavior: "smooth" }), true').catch(() => {});
      await sleep(400);
    }
  }

  /** One job at a time on the shared Orbit screen; boots the browser if needed. */
  private run<T>(activity: OrbitActivity, job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.start();
      this.activity = activity;
      this.setState('ACTIVE');
      try {
        return await job();
      } finally {
        this.activity = null;
        if (this.state === 'ACTIVE') this.setState('IDLE');
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }

  private setAction(patch: Partial<OrbitActivity>) {
    if (this.activity) { Object.assign(this.activity, patch); this.emit('state'); }
  }

  browse(url: string, actor = 'JARVIS') {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    new URL(url); // throws on garbage
    return this.run({ actor, status: 'BROWSING', action: `Opening ${host(url)}`, url }, async () => {
      await this.goto(url);
      return { url: this.url, title: this.title };
    });
  }

  search(query: string, actor = 'JARVIS') {
    return this.run({ actor, status: 'SEARCHING', action: `Searching: ${query}` }, async () => {
      const r = await findSources(query);
      await this.goto(resultsPage(query, r));
      return { url: this.url, title: this.title, provider: r.provider, results: r.hits.slice(0, 6) };
    });
  }

  youtube(query: string, actor = 'JARVIS') {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    return this.run({ actor, status: 'BROWSING', action: `YouTube: ${query}`, url }, async () => {
      await this.goto(url);
      return { url: this.url, title: this.title };
    });
  }

  /** Search, open the top sources, scroll through them and bring back what they say. */
  research(query: string, actor = 'JARVIS', maxSources = 2) {
    return this.run({ actor, status: 'RESEARCHING', action: `Searching: ${query}` }, async () => {
      const found = await findSources(query);
      await this.goto(resultsPage(query, found));
      await sleep(500); // leave the results on screen for a moment
      const results = found.hits.map((h) => ({ title: h.title, href: h.url }));
      const sources: ResearchSource[] = [];
      for (const r of results) {
        if (sources.length >= maxSources) break;
        this.setAction({ status: 'READING', action: `Reading ${host(r.href)}`, url: r.href });
        try {
          await this.goto(r.href);
          await this.scrollRead(3);
          const text = (await this.evaluate<string>('document.body ? document.body.innerText.slice(0, 6000) : ""')) || '';
          sources.push({ title: this.title || r.title, url: this.url || r.href, excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 2500) });
        } catch {}
      }
      this.setAction({ status: 'RESEARCHING', action: `Finished reading ${sources.length} source(s)` });
      return { query, provider: found.provider, sources, otherResults: results.slice(sources.length, sources.length + 4).map((r) => ({ title: r.title, url: r.href })) };
    });
  }

  snapshot() {
    return { state: this.state, activity: this.activity, url: this.url, title: this.title, error: this.error || undefined };
  }
}

export const orbit = new OrbitComputer();

// Never leave the private browser running after JARVIS exits.
const shutdown = () => { try { (orbit as any).proc?.kill(); } catch {} };
process.once('exit', shutdown);
process.once('SIGINT', () => { shutdown(); process.exit(0); });
process.once('SIGTERM', () => { shutdown(); process.exit(0); });
