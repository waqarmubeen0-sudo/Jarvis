// Runtime verification: JARVIS actually RUNS what it builds in a headless browser and checks it.
//   testPage(file)          loads, renders visible content, no JS errors / failed resources,
//                           clicks every button and watches for errors
//   testGame(file, request) loads, renders, game loop, input changes the game, score/game-over
//                           state; for Snake it really plays: steers to food, checks score and
//                           growth, crashes into a wall (collision -> game over) and restarts
// Games expose window.jarvisState() -> { score, gameOver, ... } so the tester can see the state.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launchChrome, type Cdp } from './cdp';

export interface Check { name: string; ok: boolean; detail: string }
export interface TestReport { ok: boolean; checks: Check[]; errors: string[]; title: string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Counts animation frames and timer ticks, so a running game loop can be told from a frozen page.
const INSTRUMENT = `(() => {
  window.__jt = { raf: 0, ticks: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (f) => raf((t) => { window.__jt.raf++; f(t); });
  const si = window.setInterval.bind(window);
  window.setInterval = (f, ms, ...a) => si((...b) => { window.__jt.ticks++; typeof f === 'function' ? f(...b) : 0; }, ms, ...a);
  const st = window.setTimeout.bind(window);
  window.setTimeout = (f, ms, ...a) => st((...b) => { window.__jt.ticks++; typeof f === 'function' ? f(...b) : 0; }, ms, ...a);
})();`;

const KEYS: Record<string, { key: string; code: string; vk: number }> = {
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 }, down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  space: { key: ' ', code: 'Space', vk: 32 }, enter: { key: 'Enter', code: 'Enter', vk: 13 },
  w: { key: 'w', code: 'KeyW', vk: 87 }, s: { key: 's', code: 'KeyS', vk: 83 },
};

class Harness {
  errors: string[] = [];
  private constructor(private cdp: Cdp, private sid: string, private close: () => void) {}

  static async open(file: string): Promise<Harness> {
    const profile = path.join(os.tmpdir(), `jarvis-test-${process.pid}-${Math.random().toString(36).slice(2, 7)}`);
    const { cdp, proc } = await launchChrome({ profile, headless: true, args: ['--window-size=1100,800', '--autoplay-policy=no-user-gesture-required'] });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const h = new Harness(cdp, sid, () => { cdp.close(); try { proc.kill(); } catch {} setTimeout(() => fs.rm(profile, { recursive: true, force: true }, () => {}), 1500); });
    cdp.on((method, p, s) => {
      if (s !== sid) return;
      if (method === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails;
        h.errors.push(`${d.exception?.description?.split('\n')[0] ?? d.text}${d.lineNumber !== undefined ? ` (line ${d.lineNumber + 1})` : ''}`);
      } else if (method === 'Runtime.consoleAPICalled' && p.type === 'error') {
        h.errors.push(`console.error: ${p.args.map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
      } else if (method === 'Log.entryAdded' && p.entry.level === 'error' && !/favicon/i.test(p.entry.url ?? p.entry.text)) {
        h.errors.push(`${p.entry.text}${p.entry.url ? ` (${p.entry.url.split('/').pop()})` : ''}`.slice(0, 300));
      }
    });
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Log.enable', {}, sid);
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT }, sid);
    const loaded = cdp.waitFor('Page.loadEventFired', 15000, (_p, s) => s === sid);
    await cdp.send('Page.navigate', { url: pathToFileURL(file).href }, sid);
    if (!(await loaded)) h.errors.push('The page did not finish loading within 15 seconds.');
    await cdp.send('Page.bringToFront', {}, sid).catch(() => {});
    await sleep(900);
    return h;
  }

  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, this.sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? 'evaluation failed');
    return r.result?.value as T;
  }
  async key(name: string) {
    const k = KEYS[name];
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, ...(name === 'enter' ? { text: '\r' } : name === 'space' ? { text: ' ' } : {}) }, this.sid);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk }, this.sid);
  }
  async click(x: number, y: number) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, this.sid);
  }
  /** Centre of the first visible element whose text matches. */
  findText(re: RegExp, selector = 'button, [role=button], a, input[type=button], input[type=submit]') {
    return this.eval<{ x: number; y: number; text: string } | null>(`(() => { const re = new RegExp(${JSON.stringify(re.source)}, 'i');
      const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden' && re.test(b.innerText || b.value || b.getAttribute('aria-label') || ''); });
      if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (e.innerText || e.value || '').trim().slice(0, 40) }; })()`);
  }
  async screenshot() { return (await this.cdp.send('Page.captureScreenshot', { format: 'png' }, this.sid)).data as string; }
  done() { this.close(); }
}

/** Visible output: non-blank canvas, or real DOM content. */
const RENDER = `(() => {
  const c = [...document.querySelectorAll('canvas')].filter((x) => x.width > 20 && x.height > 20).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (c) { try { const ctx = c.getContext('2d'); if (ctx) { const d = ctx.getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return { kind: 'canvas', colours: seen.size, size: c.width + 'x' + c.height }; } } catch (e) {} return { kind: 'canvas', colours: -1, size: c.width + 'x' + c.height }; }
  const vis = [...document.body.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden'; });
  return { kind: 'dom', elements: vis.length, text: (document.body.innerText || '').trim().length };
})()`;

const finish = (h: Harness, checks: Check[], title: string): TestReport => {
  const errors = [...new Set(h.errors)].slice(0, 12);
  if (errors.length) checks.push({ name: 'No JavaScript / console errors', ok: false, detail: errors.join(' | ') });
  else checks.push({ name: 'No JavaScript / console errors', ok: true, detail: 'none during the whole test' });
  return { ok: checks.every((c) => c.ok), checks, errors, title };
};

// ---------------------------------------------------------------------------------------------

export async function testPage(file: string): Promise<TestReport> {
  const h = await Harness.open(file);
  const checks: Check[] = [];
  try {
    const title = (await h.eval<string>('document.title')) || '';
    checks.push({ name: 'Page loads', ok: true, detail: `loaded ${path.basename(file)}${title ? ` ("${title}")` : ''}` });
    const r = await h.eval<any>(RENDER);
    const visible = r.kind === 'canvas' ? r.colours !== 1 : r.elements >= 1 && (r.text > 0 || r.elements >= 3);
    checks.push({ name: 'Renders visible content', ok: visible, detail: r.kind === 'canvas' ? `canvas ${r.size}` : `${r.elements} visible elements, ${r.text} characters of text` });
    // Exercise every button once and see what breaks.
    const buttons = await h.eval<{ x: number; y: number; text: string }[]>(`[...document.querySelectorAll('button, input[type=button], input[type=submit], [role=button]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, 8).map((b) => { b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (b.innerText || b.value || '').trim().slice(0, 30) }; })`);
    const before = h.errors.length;
    for (const b of buttons) { await h.eval(`(() => { const e = document.elementFromPoint(${b.x}, ${b.y}); if (e) e.scrollIntoView({ block: 'center' }); })()`); await h.click(b.x, b.y); await sleep(300); }
    // A submit may navigate away from the file: keep the check honest about that.
    checks.push({ name: 'Buttons work without errors', ok: h.errors.length === before, detail: buttons.length ? `clicked ${buttons.map((b) => `"${b.text || '?'}"`).join(', ')}` : 'no buttons on the page' });
    return finish(h, checks, title);
  } finally { h.done(); }
}

interface GameState { score: number; gameOver: boolean; snake?: { x: number; y: number }[]; food?: { x: number; y: number }; dir?: { x: number; y: number } }

export async function testGame(file: string, request: string): Promise<TestReport> {
  const h = await Harness.open(file);
  const checks: Check[] = [];
  const state = () => h.eval<GameState | null>('typeof window.jarvisState === "function" ? JSON.parse(JSON.stringify(window.jarvisState())) : null').catch(() => null);
  try {
    const title = (await h.eval<string>('document.title')) || '';
    checks.push({ name: 'Game loads', ok: true, detail: title ? `"${title}"` : 'loaded' });
    const r = await h.eval<any>(RENDER);
    checks.push({ name: 'Rendering', ok: r.kind === 'canvas' ? r.colours !== 1 : r.elements >= 3, detail: r.kind === 'canvas' ? `canvas ${r.size}, ${r.colours < 0 ? 'drawn' : `${r.colours} colours on screen`}` : `${r.elements} visible elements` });
    const t0 = await h.eval<{ raf: number; ticks: number }>('window.__jt');
    await sleep(700);
    const t1 = await h.eval<{ raf: number; ticks: number }>('window.__jt');
    const looping = t1.raf - t0.raf > 5 || t1.ticks - t0.ticks > 2;
    const s0 = await state();
    const hasState = !!s0 && typeof s0.score === 'number' && typeof s0.gameOver === 'boolean';
    checks.push({ name: 'Game state hook', ok: hasState, detail: hasState ? `score ${s0!.score}, gameOver ${s0!.gameOver}` : 'window.jarvisState() is missing or does not return { score: number, gameOver: boolean }' });

    if (/\bsnake\b/i.test(request)) {
      checks.push({ name: 'Game loop', ok: looping, detail: looping ? `${t1.raf - t0.raf} frames / ${t1.ticks - t0.ticks} ticks in 0.7 s` : 'nothing is animating' });
      await playSnake(h, state, checks);
    } else {
      checks.push({ name: 'Game loop', ok: true, detail: looping ? `${t1.raf - t0.raf} frames / ${t1.ticks - t0.ticks} ticks in 0.7 s` : 'event-driven (turn-based)' });
      // Input: keys + a click in the middle of the board must change something.
      const shot = await h.screenshot();
      const sBefore = JSON.stringify(await state());
      for (const k of ['right', 'up', 'space', 'w', 'down', 'left']) { await h.key(k); await sleep(120); }
      const board = await h.eval<{ x: number; y: number } | null>(`(() => { const e = document.querySelector('canvas, [data-cell], .cell, button.cell, #board, .board'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (board) { await h.click(board.x, board.y); await sleep(400); }
      const changed = JSON.stringify(await state()) !== sBefore || (await h.screenshot()) !== shot;
      checks.push({ name: 'Controls respond', ok: changed, detail: changed ? 'keyboard / pointer input changed the game' : 'pressing keys and clicking the board changed nothing' });
      const restart = await h.findText(/restart|play again|new game|reset/);
      if (restart) {
        await h.click(restart.x, restart.y); await sleep(400);
        const s1 = await state();
        checks.push({ name: 'Restart', ok: !s1 || !s1.gameOver, detail: `"${restart.text}" ${s1 ? `-> score ${s1.score}, gameOver ${s1.gameOver}` : 'clicked'}` });
      } else {
        // Many games only show Restart on the game-over screen.
        const hidden = await h.eval<boolean>(`[...document.querySelectorAll('button, [role=button], input[type=button]')].some((b) => /restart|play again|new game|reset/i.test(b.textContent || b.value || ''))`);
        checks.push({ name: 'Restart', ok: hidden, detail: hidden ? 'a Restart button is there (shown at game over)' : 'no Restart / Play again button anywhere' });
      }
    }
    return finish(h, checks, title);
  } finally { h.done(); }
}

/** Really plays Snake: food, growth, score, wall collision, game over, restart. */
async function playSnake(h: Harness, state: () => Promise<GameState | null>, checks: Check[]) {
  let s = await state();
  if (s?.gameOver) { // it may already have run into a wall while loading: start a fresh round
    const btn = await h.findText(/restart|play again|new game|try again|start/);
    if (btn) await h.click(btn.x, btn.y); else await h.key('enter');
    await sleep(150);
    s = await state();
  }
  if (!s?.snake?.length || !s.food) {
    checks.push({ name: 'Snake state', ok: false, detail: 'jarvisState() must include snake: [{x,y}, ...] (head first) and food: {x,y}' });
    return;
  }
  // Many games wait for a Start button / Space / Enter: start it the way a player would.
  const headAt = (st: GameState | null) => JSON.stringify(st?.snake?.[0]);
  const h0 = headAt(s);
  await sleep(450);
  if (headAt(await state()) === h0) {
    const start = await h.findText(/start|play|begin|go\b/);
    if (start) await h.click(start.x, start.y);
    for (const k of ['space', 'enter']) { if (headAt(await state()) !== h0) break; await h.key(k); await sleep(300); }
    s = (await state()) ?? s;
  }
  const dirOf = (st: GameState) => st.dir ?? (st.snake!.length > 1 ? { x: st.snake![0].x - st.snake![1].x, y: st.snake![0].y - st.snake![1].y } : { x: 1, y: 0 });
  const press = async (d: { x: number; y: number }) => h.key(d.x > 0 ? 'right' : d.x < 0 ? 'left' : d.y > 0 ? 'down' : 'up');
  const startLen = s.snake!.length, startScore = s.score;
  const [moved, keysWork] = await (async () => {
    const head = s!.snake![0];
    const d = dirOf(s!);
    // Turn 90° (always allowed) towards the open side of the board, then watch it move.
    const cols = (s as any).cols ?? 20, rows = (s as any).rows ?? 20;
    await press(d.x ? { x: 0, y: head.y < rows / 2 ? 1 : -1 } : { x: head.x < cols / 2 ? 1 : -1, y: 0 });
    await sleep(350);
    const n = await state();
    return [!!n && (n.snake![0].x !== head.x || n.snake![0].y !== head.y), !!n && JSON.stringify(dirOf(n)) !== JSON.stringify(d)];
  })();
  checks.push({ name: 'Snake moves', ok: moved, detail: moved ? 'the head advances on its own' : 'the snake did not move' });
  checks.push({ name: 'Keyboard controls', ok: keysWork, detail: keysWork ? 'arrow keys change direction' : 'arrow keys did not turn the snake' });

  // Steer to the food until it is eaten (up to 20 s).
  let ate = false;
  for (const end = Date.now() + 20000; Date.now() < end && !ate;) {
    s = await state();
    if (!s || s.gameOver) break;
    if (s.score > startScore && s.snake!.length > startLen) { ate = true; break; }
    const head = s.snake![0], d = dirOf(s);
    const want = [s.food!.x - head.x ? { x: Math.sign(s.food!.x - head.x), y: 0 } : null, s.food!.y - head.y ? { x: 0, y: Math.sign(s.food!.y - head.y) } : null].filter(Boolean) as { x: number; y: number }[];
    const next = want.find((w) => !(w.x === -d.x && w.y === -d.y)) ?? (want.length ? { x: d.y ? 1 : 0, y: d.x ? 1 : 0 } : null);
    if (next && (next.x !== d.x || next.y !== d.y)) await press(next);
    await sleep(40);
  }
  s = await state();
  checks.push({ name: 'Food, growth and score', ok: ate, detail: ate ? `ate food: score ${startScore} -> ${s!.score}, length ${startLen} -> ${s!.snake!.length}` : `could not get the food (score ${s?.score}, length ${s?.snake?.length}${s?.gameOver ? ', game over first' : ''})` });

  // Drive straight into a wall: collision must end the game.
  let over = !!s?.gameOver;
  for (const end = Date.now() + 15000; Date.now() < end && !over;) {
    const st = await state();
    if (!st) break;
    if (st.gameOver) { over = true; break; }
    const d = dirOf(st);
    if (d.x !== 0) await press({ x: 0, y: -1 }); // go up (never a reversal from a horizontal move)
    await sleep(60);
  }
  checks.push({ name: 'Collision -> game over', ok: over, detail: over ? 'hitting the wall ended the game' : 'running into the wall did not end the game' });

  if (over) {
    const btn = await h.findText(/restart|play again|new game|try again/);
    if (btn) await h.click(btn.x, btn.y); else await h.key('enter');
    await sleep(500);
    const n = await state();
    const ok = !!n && !n.gameOver && n.score === 0 && n.snake!.length <= startLen;
    checks.push({ name: 'Restart', ok, detail: ok ? `${btn ? `"${btn.text}" button` : 'Enter'} started a fresh game (score 0, length ${n!.snake!.length})` : `after restart: ${JSON.stringify(n).slice(0, 120)}` });
  } else checks.push({ name: 'Restart', ok: false, detail: 'not tested: the game never ended' });
}

export const reportText = (r: TestReport) => r.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`).join('\n');
export const failures = (r: TestReport) => r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);

/** Tests HTML that is not on disk yet (a game before it is saved to the Arcade). */
export async function testHtml(html: string, request: string): Promise<TestReport> {
  const file = path.join(os.tmpdir(), `jarvis-game-${process.pid}-${Date.now().toString(36)}.html`);
  fs.writeFileSync(file, html, 'utf-8');
  try { return await testGame(file, request); } finally { fs.rm(file, { force: true }, () => {}); }
}
