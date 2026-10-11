// JARVIS game creation: "create a Snake game" → a real, playable game in JARVIS Arcade.
//
// Game interface (what every Arcade game is): ONE self-contained HTML file with inline CSS/JS,
// a <title>, keyboard and/or pointer input, its own loop/rendering, score, a game-over state and a
// Restart button. The Arcade runs it in a sandboxed iframe (scripts only, no network, no access to
// JARVIS) and may receive optional messages: parent.postMessage({ jarvisGame: 'gameover', score }).
//
// Pipeline: detect intent → the assigned agent generates the HTML → extract → validate (every
// script must compile; input + loop/handlers required) → one repair round with the exact errors →
// save + register in generated-games/ → served at /games/<id>. When Gemini itself is unavailable,
// a known genre (Snake, Pong, Tic-Tac-Toe) is built from the offline library and labelled as such.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GAMES_DIR = process.env.JARVIS_GAMES_DIR || path.resolve(HERE, 'generated-games');
const LIBRARY_DIR = path.resolve(HERE, 'game-library');
const REGISTRY = () => path.join(GAMES_DIR, 'index.json');
const MAX_HTML = 400_000;

export interface GameRecord {
  id: string;
  title: string;
  prompt: string;
  agent: string;
  source: 'generated' | 'library';
  createdAt: string;
  taskId?: string;
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Intent

/** Library genres, matched in the (possibly mis-transcribed) request. */
const LIBRARY: { id: string; title: string; re: RegExp }[] = [
  { id: 'snake', title: 'Snake', re: /\bsnake\b/i },
  { id: 'pong', title: 'Pong', re: /\bpong\b/i },
  { id: 'tic-tac-toe', title: 'Tic Tac Toe', re: /\btic[\s-]?tac[\s-]?toe\b|\bnoughts?\s*(and|&|n)\s*crosses\b/i },
];

/** True when the request asks for a game to be made (not to talk about games). */
export function wantsGame(prompt: string): boolean {
  const p = String(prompt);
  const make = /\b(create|make|build|generate|code|write|program|develop|design|give me|i want|can you do)\b/i;
  const game = /\b(game|snake|pong|tic[\s-]?tac[\s-]?toe|tetris|breakout|flappy|space invaders|asteroids|platformer|minesweeper|2048|memory game|arcade)\b/i;
  // Mis-heard voice requests ("tu es un snake game") still name a specific game: "<snake> game" counts.
  const namedGame = /\b(snake|pong|tic[\s-]?tac[\s-]?toe|tetris|breakout|flappy(?: bird)?|space invaders|asteroids|platformer|minesweeper|2048|racing|shooter|puzzle)\s+game\b/i;
  return game.test(p) && (make.test(p) || namedGame.test(p));
}

export const libraryMatch = (prompt: string) => LIBRARY.find((g) => g.re.test(prompt)) ?? null;

// ---------------------------------------------------------------------------------------------
// Generation prompt, extraction and validation

export function gamePrompt(request: string, repair?: { errors: string[]; previous: string }) {
  const base = `Build this as a real, playable browser game: "${request}".

Return ONE complete, self-contained HTML document (<!DOCTYPE html> … </html>) in a single \`\`\`html code block. Rules:
- Write it in HTML + JavaScript, whatever your usual default language is.
- All CSS and JavaScript inline. No external files, CDNs, images, fonts or network requests of any kind.
- A <title> with the game's name.
- Fill the whole window (100vw × 100vh), dark background, and handle window resize.
- Controls: keyboard (call preventDefault on arrow keys / space so the page never scrolls) and pointer where natural. Call window.focus() on start and on click.
- A working game loop with requestAnimationFrame (turn-based games may be event-driven instead).
- Visible score, real collision / win / lose rules, a clear game-over (or win/draw) state, and a visible RESTART button that fully resets the game (Enter/Space should restart after game over too).
- No alert(), prompt(), confirm(), localStorage or cookies (the game runs in a sandbox).
- Optional: on game over call parent.postMessage({ jarvisGame: 'gameover', score }, '*').
- REQUIRED test hook: define window.jarvisState = () => ({ score: <number>, gameOver: <boolean>, ... }). JARVIS's tester plays the game through it.${/\bsnake\b/i.test(request) ? `
  For Snake it must also return snake: [{x, y}, ...] (grid cells, head first), food: {x, y}, dir: {x, y} (current direction, e.g. {x:1,y:0}), cols and rows. Hitting a wall must end the game (no wrap-around), and Enter or the RESTART button starts a fresh game with score 0.` : ''}
- Code must run without errors. Do not leave TODOs or placeholders.`;
  if (!repair) return base;
  return `${base}

Your previous attempt was rejected for these reasons:
${repair.errors.map((e) => `- ${e}`).join('\n')}
Fix every problem and return the full corrected HTML document again.`;
}

/** Pulls the HTML document out of a model reply. */
export function extractHtml(reply: string): string | null {
  const text = String(reply ?? '');
  const block = text.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  const body = block ? block[1] : text;
  const start = body.search(/<!DOCTYPE html|<html[\s>]/i);
  const end = body.toLowerCase().lastIndexOf('</html>');
  if (start < 0 || end < start) return null;
  return body.slice(start, end + '</html>'.length).trim();
}

/** Static checks: never executes the code. Returns the list of problems (empty = valid). */
export function validateGameHtml(html: string): string[] {
  const errors: string[] = [];
  if (!html) return ['No HTML document was found in the reply.'];
  if (html.length > MAX_HTML) errors.push(`The file is too large (${html.length} characters, limit ${MAX_HTML}).`);
  if (/<script[^>]*\bsrc\s*=/i.test(html)) errors.push('It loads an external script; everything must be inline.');
  if (/<link[^>]*rel\s*=\s*["']?stylesheet[^>]*href\s*=\s*["']?https?:/i.test(html)) errors.push('It loads an external stylesheet.');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const code = scripts.join('\n');
  if (!code.trim()) errors.push('There is no inline JavaScript, so nothing can run.');
  scripts.forEach((s, i) => {
    try { new vm.Script(s, { filename: `script-${i + 1}.js` }); } // compile only: syntax check
    catch (err: any) { errors.push(`JavaScript syntax error in script ${i + 1}: ${err.message}`); }
  });
  if (code && !/addEventListener\(\s*['"](keydown|keyup|keypress|click|pointerdown|mousedown|touchstart)['"]|on(keydown|keyup|click|pointerdown|mousedown|touchstart)\s*=/i.test(code + html)) {
    errors.push('No keyboard or pointer input handler was found.');
  }
  if (code && !/requestAnimationFrame|setInterval|setTimeout|addEventListener\(\s*['"]click['"]/i.test(code)) errors.push('No game loop (requestAnimationFrame/setInterval) or event-driven turn handling was found.');
  if (!/restart|play again|new game|reset/i.test(html)) errors.push('There is no Restart button.');
  if (/\b(alert|prompt|confirm)\s*\(/.test(code)) errors.push('It uses alert/prompt/confirm, which are blocked in the Arcade sandbox.');
  if (code && !/jarvisState\s*=/.test(code)) errors.push('window.jarvisState (the test hook returning { score, gameOver }) is missing.');
  return errors;
}

export const htmlTitle = (html: string) => html.match(/<title>([^<]{1,80})<\/title>/i)?.[1].trim() || null;

// ---------------------------------------------------------------------------------------------
// Registry

export function listGames(): GameRecord[] {
  try { return JSON.parse(fs.readFileSync(REGISTRY(), 'utf-8')); } catch { return []; }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'game';
export const validGameId = (id: string) => /^[a-z0-9][a-z0-9-]{2,63}$/.test(id);

export function saveGame(html: string, meta: Omit<GameRecord, 'id' | 'createdAt'>): GameRecord {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const id = `${slug(meta.title)}-${Date.now().toString(36).slice(-5)}`;
  fs.writeFileSync(path.join(GAMES_DIR, `${id}.html`), html, 'utf-8');
  const rec: GameRecord = { id, createdAt: new Date().toISOString(), ...meta };
  const all = [rec, ...listGames().filter((g) => g.id !== id)];
  fs.writeFileSync(REGISTRY(), JSON.stringify(all, null, 2) + '\n', 'utf-8');
  return rec;
}

export function libraryHtml(id: string): string {
  return fs.readFileSync(path.join(LIBRARY_DIR, `${id}.html`), 'utf-8');
}

/** Finds a game by id or by (fuzzy) title, newest first. */
export function findGame(query?: string): GameRecord | null {
  const all = listGames();
  if (!query) return all[0] ?? null;
  const q = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return all.find((g) => g.id === query) ?? all.find((g) => g.title.toLowerCase().includes(q) || q.includes(g.title.toLowerCase())) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Serving (sandboxed)

/** Strict policy: inline code only, no network at all. */
export const GAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'";

/** Reports runtime errors to the Arcade (which shows them instead of a silent black box). */
const BRIDGE = `<script>(function(){function send(m){try{parent.postMessage({jarvisGame:'error',message:String(m).slice(0,300)},'*')}catch(e){}}
addEventListener('error',function(e){send((e.message||'Script error')+(e.lineno?' (line '+e.lineno+')':''))});
addEventListener('unhandledrejection',function(e){send('Unhandled promise rejection: '+(e.reason&&e.reason.message||e.reason))});
addEventListener('load',function(){parent.postMessage({jarvisGame:'ready'},'*')});})();</script>`;

export function gameFileForServing(id: string): string | null {
  if (!validGameId(id)) return null;
  const file = path.join(GAMES_DIR, `${id}.html`);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, 'utf-8');
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${BRIDGE}`) : BRIDGE + html;
}
