// BROWSER skill: real browser automation over the DevTools protocol (not screen clicking).
//   DIRECT mode -> a visible Chrome window on the user's desktop with JARVIS's own profile
//                  (~/.jarvis/browser-profile). Sign in there once and it stays signed in; it
//                  never touches the cookies or passwords of their everyday Chrome profile.
//   ORBIT mode  -> the existing private Orbit browser (headless, streamed in the JARVIS PC panel).
// Clicks and typing are real input events at the element's position, so sites react normally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type } from '@google/genai';
import { Cdp, browserWsUrl, devToolsPort, launchChrome } from './cdp';
import { getMode, type ComputerMode } from './computer';
import { orbit } from './orbit';
import { resolvePath } from './osTools';
import { registerSkill, type ToolResult, type ToolContext } from './skillRegistry';

const PROFILE = path.join(os.homedir(), '.jarvis', 'browser-profile');
export const DOWNLOADS = path.join(os.homedir(), 'Downloads', 'JARVIS');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const downloadListeners = new Set<(file: string) => void>();
export const onBrowserDownload = (cb: (file: string) => void) => { downloadListeners.add(cb); return () => { downloadListeners.delete(cb); }; };

class BrowserDriver {
  private cdp: Cdp | null = null;
  private on: ComputerMode | null = null;
  private sessions = new Map<string, string>(); // targetId -> sessionId
  private active = '';
  private queue: Promise<unknown> = Promise.resolve();
  private downloads = new Map<string, { file: string; state: string }>();
  private order: string[] = [];

  /** One browser job at a time. */
  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job);
    this.queue = next.catch(() => {});
    return next;
  }

  private async connect() {
    const mode = getMode();
    if (this.cdp && !this.cdp.closed && this.on === mode) return this.cdp;
    this.cdp?.close();
    this.sessions.clear();
    this.active = '';
    if (mode === 'ORBIT') {
      await orbit.start();
      const ws = await browserWsUrl(orbit.debugPort);
      if (!ws) throw new Error('The Orbit browser is not reachable.');
      this.cdp = await Cdp.connect(ws);
    } else {
      const port = devToolsPort(PROFILE);
      const ws = port ? await browserWsUrl(port) : null; // JARVIS's browser may still be open from before
      this.cdp = ws ? await Cdp.connect(ws) : (await launchChrome({ profile: PROFILE, headless: false, detached: true, args: ['--start-maximized', 'about:blank'] })).cdp;
    }
    this.on = mode;
    fs.mkdirSync(DOWNLOADS, { recursive: true });
    await this.cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DOWNLOADS, eventsEnabled: true }).catch(() => {});
    this.cdp.on((method, p) => {
      if (method === 'Browser.downloadWillBegin') this.downloads.set(p.guid, { file: path.join(DOWNLOADS, p.suggestedFilename), state: 'inProgress' });
      if (method === 'Browser.downloadProgress' && this.downloads.has(p.guid)) {
        const d = this.downloads.get(p.guid)!;
        if (p.state === 'completed' && d.state !== 'completed') {
          // allowAndName saves under the guid; give the file its real name.
          try { if (fs.existsSync(path.join(DOWNLOADS, p.guid))) fs.renameSync(path.join(DOWNLOADS, p.guid), d.file); } catch {}
          downloadListeners.forEach((cb) => { try { cb(d.file); } catch {} });
        }
        d.state = p.state;
      }
      if (method === 'Target.detachedFromTarget') for (const [t, s] of this.sessions) if (s === p.sessionId) this.sessions.delete(t);
    });
    return this.cdp;
  }

  async pages() {
    const cdp = await this.connect();
    const { targetInfos } = await cdp.send('Target.getTargets');
    const pages = (targetInfos as any[]).filter((t) => t.type === 'page' && !/^(devtools|chrome-extension|chrome-untrusted):/.test(t.url));
    // Chrome lists newest first; number tabs in the order they were first seen so "tab 1" stays tab 1.
    for (const p of [...pages].reverse()) if (!this.order.includes(p.targetId)) this.order.push(p.targetId);
    return pages.sort((x, y) => this.order.indexOf(x.targetId) - this.order.indexOf(y.targetId));
  }

  /** Session of the active tab (creating a tab if there is none). */
  async tab(): Promise<{ cdp: Cdp; sid: string; targetId: string }> {
    const cdp = await this.connect();
    let pages = await this.pages();
    if (!pages.some((p) => p.targetId === this.active)) {
      if (!pages.length) { await cdp.send('Target.createTarget', { url: 'about:blank' }); pages = await this.pages(); }
      this.active = pages[0].targetId;
    }
    return { cdp, sid: await this.attach(this.active), targetId: this.active };
  }

  private async attach(targetId: string) {
    const cdp = await this.connect();
    let sid = this.sessions.get(targetId);
    if (!sid) {
      sid = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId as string;
      this.sessions.set(targetId, sid);
      await cdp.send('Page.enable', {}, sid);
      await cdp.send('Runtime.enable', {}, sid);
    }
    return sid;
  }

  async eval<T = any>(expression: string): Promise<T> {
    const { cdp, sid } = await this.tab();
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? 'Page script error');
    return r.result?.value as T;
  }

  async goto(url: string) {
    const { cdp, sid, targetId } = await this.tab();
    const loaded = cdp.waitFor('Page.loadEventFired', 15000, (_p, s) => s === sid);
    const nav = await cdp.send('Page.navigate', { url }, sid);
    if (nav.errorText) throw new Error(`Couldn't open ${url}: ${nav.errorText}`);
    await loaded;
    await sleep(400);
    if (this.on === 'DIRECT') await cdp.send('Target.activateTarget', { targetId }).catch(() => {});
    return this.where();
  }

  where() { return this.eval<{ title: string; url: string }>('({ title: document.title, url: location.href })'); }

  async select(targetId: string) {
    const cdp = await this.connect();
    this.active = targetId;
    await this.attach(targetId);
    if (this.on === 'DIRECT') await cdp.send('Target.activateTarget', { targetId });
  }

  async create(url = 'about:blank') {
    const cdp = await this.connect();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    await this.select(targetId);
    if (url !== 'about:blank') await this.goto(url);
    return targetId;
  }
  async closeTab(targetId: string) { const cdp = await this.connect(); await cdp.send('Target.closeTarget', { targetId }); this.sessions.delete(targetId); if (this.active === targetId) this.active = ''; }

  async mouseClick(x: number, y: number, clickCount = 1) {
    const { cdp, sid } = await this.tab();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sid);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount }, sid);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount }, sid);
  }
  async key(key: string) {
    const { cdp, sid } = await this.tab();
    const k = KEYS[key.toLowerCase()] ?? { key, code: key, vk: 0 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, ...(k.text ? { text: k.text } : {}) }, sid);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk }, sid);
  }
  async insertText(text: string) { const { cdp, sid } = await this.tab(); await cdp.send('Input.insertText', { text }, sid); }

  async waitForDownload(since: number, ms: number) {
    const before = new Set([...this.downloads.keys()].slice(0, since));
    for (let t = 0; t < ms; t += 300) {
      const done = [...this.downloads.entries()].find(([g, d]) => !before.has(g) && d.state === 'completed');
      if (done) return done[1].file;
      const bad = [...this.downloads.entries()].find(([g, d]) => !before.has(g) && d.state === 'canceled');
      if (bad) throw new Error('The download was cancelled.');
      await sleep(300);
    }
    return null;
  }
  downloadCount() { return this.downloads.size; }
}

const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }, tab: { key: 'Tab', code: 'Tab', vk: 9 }, escape: { key: 'Escape', code: 'Escape', vk: 27 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 }, backspace: { key: 'Backspace', code: 'Backspace', vk: 8 }, space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 }, arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 }, pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
};

export const browser = new BrowserDriver();

// ---------------------------------------------------------------------------------------------
// Page-side helpers

/** Finds an element by CSS selector or by its visible text / label, scrolls it into view, returns its centre. */
const FIND = `(function (q, sel) {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('alt') || e.getAttribute('name') || '').trim().toLowerCase().replace(/\\s+/g, ' ');
  let el = null;
  if (sel) el = [...document.querySelectorAll(sel)].find(vis) || null;
  else {
    const t = String(q).toLowerCase().trim().replace(/^(the|a)\\s+/, '').replace(/\\s+(button|link|tab|field|box)$/, '');
    const c = [...document.querySelectorAll('a,button,input,textarea,select,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=searchbox],[role=textbox],[contenteditable=true],[onclick]')].filter(vis);
    el = c.find((e) => label(e) === t) || c.find((e) => label(e).startsWith(t)) || c.find((e) => label(e).includes(t))
      || [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && vis(e) && (e.innerText || '').toLowerCase().includes(t)) || null;
  }
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), text: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 80), href: el.href || '' };
})`;

type Found = { x: number; y: number; tag: string; type: string; text: string; href: string };
async function findEl(target?: string, selector?: string): Promise<Found> {
  const f = await browser.eval<Found | null>(`${FIND}(${JSON.stringify(target ?? '')}, ${JSON.stringify(selector ?? '')})`);
  if (!f) throw new Error(`Couldn't find ${selector ? `"${selector}"` : `"${target}"`} on the page.`);
  await sleep(150); // let scrollIntoView settle before the real click
  return (await browser.eval<Found | null>(`${FIND}(${JSON.stringify(target ?? '')}, ${JSON.stringify(selector ?? '')})`)) ?? f;
}
const describe = (f: Found) => `${f.tag}${f.text ? ` "${f.text}"` : ''}`;

const SEARCH: Record<string, (q: string) => string> = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
};
/** The visible result titles of a search page (YouTube videos, web results). */
const RESULTS = `(() => {
  const pick = (sel) => [...document.querySelectorAll(sel)].map((e) => ({ title: (e.getAttribute('title') || e.innerText || '').trim().replace(/\\s+/g, ' '), url: (e.closest('a') || e).href || '' })).filter((r) => r.title && r.url);
  const r = location.hostname.includes('youtube') ? pick('a#video-title, a#video-title-link, yt-formatted-string#video-title') : pick('h3, h2 a, li.b_algo h2 a');
  return r.slice(0, 8);
})()`;

const normUrl = (u: string) => {
  let url = String(u ?? '').trim();
  if (!url) throw new Error('No URL given.');
  if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
  if (!/^(https?|file|about):/i.test(url)) throw new Error('Only http(s), file and about: pages can be opened.');
  new URL(url);
  return url;
};

async function act(a: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  const action = String(a.action || 'open').toLowerCase();
  const where = getMode() === 'ORBIT' ? 'Orbit browser' : 'JARVIS browser';
  switch (action) {
    case 'open': { const w = await browser.goto(normUrl(a.url)); return { status: 'SUCCESS', message: `Opened ${w.title || w.url} in the ${where}`, ...w }; }
    case 'search': {
      const engine = String(a.site || a.engine || 'google').toLowerCase();
      const build = SEARCH[engine] ?? SEARCH.google;
      const w = await browser.goto(build(String(a.query ?? a.text ?? '')));
      if (/youtube/.test(engine)) await browser.eval('new Promise((r) => { let n = 0; const t = setInterval(() => { if (document.querySelector("a#video-title, a#video-title-link") || ++n > 20) { clearInterval(t); r(true); } }, 250); })');
      const results = await browser.eval<any[]>(RESULTS).catch(() => []);
      return { status: 'SUCCESS', message: `Searched ${engine} for "${a.query}" in the ${where}`, ...w, results };
    }
    case 'click': {
      const f = await findEl(a.target, a.selector);
      if (f.type === 'file') throw new Error('That is a file picker: use the upload action with a path.');
      await browser.mouseClick(f.x, f.y, a.double ? 2 : 1);
      await sleep(700);
      return { status: 'SUCCESS', message: `Clicked ${describe(f)}`, ...(await browser.where()) };
    }
    case 'type': {
      let f: Found | null = null;
      if (a.target || a.selector) { f = await findEl(a.target, a.selector); await browser.mouseClick(f.x, f.y); }
      else f = await browser.eval<Found | null>(`(() => { let e = document.activeElement; if (!e || e === document.body) { e = [...document.querySelectorAll('input[type=search],input[type=text],input:not([type]),textarea,[role=searchbox],[contenteditable=true]')].find((x) => x.offsetParent); e && e.focus(); } return e && e !== document.body ? { x: 0, y: 0, tag: e.tagName.toLowerCase(), type: (e.type || '').toLowerCase(), text: e.getAttribute('aria-label') || e.placeholder || e.name || '', href: '' } : null; })()`);
      if (!f) throw new Error('There is no text field to type into; give a target.');
      if (f.type === 'password') throw new Error("That's a password field. I don't enter credentials: you type those yourself.");
      if (a.clear) await browser.eval('(() => { const e = document.activeElement; if (e && "value" in e) { e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); } })()');
      await browser.insertText(String(a.text ?? ''));
      if (a.submit) { await browser.key('enter'); await sleep(1200); }
      return { status: 'SUCCESS', message: `Typed into ${describe(f)}${a.submit ? ' and pressed Enter' : ''}`, ...(await browser.where()) };
    }
    case 'press': { await browser.key(String(a.key ?? a.text ?? 'Enter')); await sleep(500); return { status: 'SUCCESS', message: `Pressed ${a.key}`, ...(await browser.where()) }; }
    case 'scroll': {
      const dir = String(a.direction ?? 'down').toLowerCase();
      const pos = await browser.eval<{ y: number; max: number }>(dir === 'top' ? 'scrollTo(0, 0), ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight })'
        : dir === 'bottom' ? 'scrollTo(0, document.documentElement.scrollHeight), ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight })'
        : `scrollBy(0, ${dir === 'up' ? -1 : 1} * innerHeight * 0.8 * ${Math.max(1, Math.min(20, Number(a.amount ?? 1)))}), ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight })`);
      return { status: 'SUCCESS', message: `Scrolled ${dir} (now at ${Math.round(pos.y)} of ${Math.round(pos.max)} px)` };
    }
    case 'read': {
      const r = await browser.eval<{ title: string; url: string; text: string }>('({ title: document.title, url: location.href, text: (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n") })');
      const offset = Math.max(0, Number(a.offset ?? 0));
      return { status: 'SUCCESS', message: `Read ${r.title || r.url}`, title: r.title, url: r.url, text: r.text.slice(offset, offset + 12000), length: r.text.length, ...(r.text.length > offset + 12000 ? { nextOffset: offset + 12000 } : {}) };
    }
    case 'extract': {
      const data = await browser.eval<any>(`(() => {
        const sel = ${JSON.stringify(a.selector ?? '')};
        if (sel) return { matches: [...document.querySelectorAll(sel)].slice(0, 60).map((e) => (e.innerText || e.getAttribute('content') || e.href || '').trim().replace(/\\s+/g, ' ').slice(0, 400)) };
        const t = (e) => (e.innerText || '').trim().replace(/\\s+/g, ' ');
        return {
          headings: [...document.querySelectorAll('h1,h2,h3')].map(t).filter(Boolean).slice(0, 40),
          links: [...document.querySelectorAll('a[href]')].map((e) => ({ text: t(e).slice(0, 100), url: e.href })).filter((l) => l.text).slice(0, 50),
          tables: [...document.querySelectorAll('table')].slice(0, 3).map((tb) => [...tb.rows].slice(0, 25).map((r) => [...r.cells].map(t).join(' | '))),
          description: document.querySelector('meta[name=description]')?.content || '',
        };
      })()`);
      return { status: 'SUCCESS', message: 'Extracted page structure', ...(await browser.where()), ...data };
    }
    case 'wait': {
      const ms = Math.max(500, Math.min(60000, Number(a.timeout ?? 10) * 1000));
      const q = JSON.stringify(a.selector ?? ''), t = JSON.stringify(String(a.text ?? a.target ?? '').toLowerCase());
      const ok = await browser.eval<boolean>(`new Promise((r) => { const end = Date.now() + ${ms}; const tick = () => { const hit = ${q} ? document.querySelector(${q}) : ${t} ? (document.body && document.body.innerText.toLowerCase().includes(${t})) : document.readyState === 'complete'; if (hit) return r(true); if (Date.now() > end) return r(false); setTimeout(tick, 300); }; tick(); })`);
      return ok ? { status: 'SUCCESS', message: 'The page is ready' } : { status: 'FAILED', error: `Timed out after ${ms / 1000}s waiting for ${a.selector || a.text || 'the page'}.` };
    }
    case 'back': case 'forward': {
      await browser.eval(`history.${action}()`);
      await sleep(1500);
      return { status: 'SUCCESS', message: `Went ${action}`, ...(await browser.where()) };
    }
    case 'tabs': {
      const pages = await browser.pages();
      const { targetId } = await browser.tab();
      return { status: 'SUCCESS', message: `${pages.length} tab(s)`, tabs: pages.map((p, i) => `${i + 1}. ${p.title || p.url}${p.targetId === targetId ? ' (active)' : ''}`) };
    }
    case 'new_tab': { await browser.create(a.url ? normUrl(a.url) : undefined); return { status: 'SUCCESS', message: 'Opened a new tab', ...(await browser.where()) }; }
    case 'switch_tab': case 'close_tab': {
      const pages = await browser.pages();
      const want = String(a.tab ?? '').toLowerCase();
      const { targetId } = await browser.tab();
      const page = !want ? pages.find((p) => p.targetId === targetId) : /^\d+$/.test(want) ? pages[Number(want) - 1] : pages.find((p) => `${p.title} ${p.url}`.toLowerCase().includes(want));
      if (!page) throw new Error(`No tab matches "${a.tab}".`);
      if (action === 'close_tab') { await browser.closeTab(page.targetId); return { status: 'SUCCESS', message: `Closed tab ${page.title || page.url}` }; }
      await browser.select(page.targetId);
      return { status: 'SUCCESS', message: `Switched to ${page.title || page.url}` };
    }
    case 'screenshot': {
      const { cdp, sid } = await browser.tab();
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, sid);
      ctx.showImage?.(data);
      const dir = path.join(os.homedir(), 'Pictures', 'JARVIS');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `browser-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return { status: 'SUCCESS', message: `Saved a screenshot of the page to ${file}`, path: file };
    }
    case 'download': {
      if (a.url) {
        const url = normUrl(a.url);
        const { cdp, sid } = await browser.tab();
        const { cookies } = await cdp.send('Network.getCookies', { urls: [url] }, sid).catch(() => ({ cookies: [] }));
        const res = await fetch(url, { headers: cookies.length ? { Cookie: cookies.map((c: any) => `${c.name}=${c.value}`).join('; ') } : {} });
        if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}.`);
        const name = (res.headers.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? path.basename(new URL(url).pathname)) || 'download';
        fs.mkdirSync(DOWNLOADS, { recursive: true });
        const file = path.join(DOWNLOADS, decodeURIComponent(name).replace(/[\\/:*?"<>|]/g, '_'));
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        downloadListeners.forEach((cb) => { try { cb(file); } catch {} });
        return { status: 'SUCCESS', message: `Downloaded ${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB) to ${DOWNLOADS}`, path: file };
      }
      const n = browser.downloadCount();
      const f = await findEl(a.target, a.selector);
      await browser.mouseClick(f.x, f.y);
      const file = await browser.waitForDownload(n, Math.min(600, Number(a.timeout ?? 120)) * 1000);
      return file ? { status: 'SUCCESS', message: `Downloaded ${path.basename(file)} to ${DOWNLOADS}`, path: file } : { status: 'FAILED', error: `Clicked ${describe(f)} but no download finished in time.` };
    }
    case 'upload': {
      const file = resolvePath(a.path);
      if (!fs.existsSync(file)) throw new Error(`No file at ${file}.`);
      const { cdp, sid } = await browser.tab();
      const sel = a.selector || 'input[type=file]';
      const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})` }, sid);
      if (!result?.objectId) throw new Error('There is no file upload field on this page.');
      await cdp.send('DOM.setFileInputFiles', { files: [file], objectId: result.objectId }, sid);
      return { status: 'SUCCESS', message: `Attached ${path.basename(file)} to the upload field` };
    }
    case 'close': {
      if (getMode() === 'ORBIT') return { status: 'FAILED', error: "The Orbit browser is JARVIS's private computer; say 'Direct mode' to close the JARVIS browser." };
      const { cdp } = await browser.tab();
      await cdp.send('Browser.close').catch(() => {});
      return { status: 'SUCCESS', message: 'Closed the JARVIS browser' };
    }
  }
  return { status: 'FAILED', error: `Unknown browser action "${action}".` };
}

const str = (description: string) => ({ type: Type.STRING, description });
const PURCHASE = /\b(buy|purchase|checkout|check out|place (your )?order|pay( now)?|subscribe|donate|add payment|confirm (order|payment))\b/i;
registerSkill({
  id: 'browser',
  name: 'BROWSER',
  description: 'Automates a real browser: open, search, tabs, click, type, scroll, read, extract, download, upload, screenshots.',
  guide: "browser for anything beyond just opening a site: search (site 'youtube' for YouTube), click results or buttons by their text, type into fields, read or extract a page, manage tabs, download and upload. It runs in the JARVIS browser (Direct mode) or the Orbit browser (Orbit mode). After search, tell the user the top results.",
  builtin: ['open_url', 'search_web', 'play_youtube'],
  tools: [{
    name: 'browser',
    description: "Real browser automation. Actions: open (url), search (query, site 'google'|'youtube'|'bing'), click (target text or selector), type (text, optional target/selector, submit, clear), press (key), scroll (direction down|up|top|bottom, amount), read (page text, offset), extract (headings, links, tables, or a selector), wait (selector or text, timeout s), back, forward, tabs, new_tab (url), switch_tab (tab number or title), close_tab, screenshot, download (url, or a target to click), upload (path, selector), close.",
    parameters: { type: Type.OBJECT, properties: {
      action: str('One of the actions above'), url: str('URL'), query: str('Search query'), site: str("Search site: 'google' (default), 'youtube', 'bing'"),
      target: str('Visible text or label of the element, e.g. "Sign in", "Search"'), selector: str('CSS selector (alternative to target)'),
      text: str('Text to type'), submit: { type: Type.BOOLEAN, description: 'Press Enter after typing' }, clear: { type: Type.BOOLEAN, description: 'Clear the field first' },
      key: str("Key for press, e.g. 'Enter', 'Escape', 'Tab'"), direction: str("'down' | 'up' | 'top' | 'bottom'"), amount: { type: Type.NUMBER, description: 'Screens to scroll' },
      tab: str('Tab number (1 = first) or part of its title'), path: str('Local file path for upload'), timeout: { type: Type.NUMBER, description: 'Seconds to wait' },
      offset: { type: Type.NUMBER, description: 'Continue reading from this character' }, double: { type: Type.BOOLEAN, description: 'Double-click' },
    }, required: ['action'] },
  }],
  permission: (_t, a) => (['download', 'upload'].includes(String(a.action)) ? ['BROWSER', 'FILE_ACCESS'] : ['BROWSER']),
  risk: (_t, a) => {
    if (String(a.action) === 'upload') return { reason: 'it uploads a file from your PC to a website' };
    if (['click', 'press', 'type'].includes(String(a.action)) && PURCHASE.test(`${a.target ?? ''} ${a.selector ?? ''}`)) return { reason: 'it looks like a purchase or payment', perm: 'PURCHASES' };
    return null;
  },
  summary: (_t, a) => String(a.action) === 'upload' ? `Upload ${a.path} to the page that is open in the browser` : `Browser ${a.action} ${a.target ?? a.url ?? a.query ?? ''}`.trim(),
  execute: (_t, a, ctx) => browser.run(() => act(a, ctx)),
});
