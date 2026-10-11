// J.A.R.V.I.S. command router: the ONE place that decides which computer an action runs on.
//
//   user / agent command -> routeComputerAction() -> current mode -> ComputerSession
//                                                     DIRECT -> the user's real PC (osTools)
//                                                     ORBIT  -> JARVIS's private computer (orbit.ts)
//
// Mode is DIRECT at every start and only changes on an explicit command (voice, typed text,
// or the mode chip in the UI). Nothing else in the codebase checks the mode for itself.

import { executeOsTool } from './osTools';
import { orbit, ORBIT_PROFILE, ResearchSource } from './orbit';
import { fetchResearch } from './webSearch';

export type ComputerMode = 'DIRECT' | 'ORBIT';
type Result = { status: 'SUCCESS' | 'FAILED'; message?: string; error?: string; computer?: ComputerMode; [k: string]: unknown };

/** A computer JARVIS (or an agent) can operate. New environments implement this. */
export interface ComputerSession {
  type: ComputerMode;
  active: boolean; // is this the current target?
  browser: string; // what browser it drives
  desktop: string; // whose desktop it is
  screenshot(): string | null; // latest screen (base64 JPEG) when the session can show one
  actions: Record<string, (args: Record<string, any>, actor: string) => Promise<Result>>;
}

const fail = (error: string, computer?: ComputerMode): Result => ({ status: 'FAILED', error, computer });
const BROWSER_APP = /\b(chrome|msedge|edge|firefox|brave|opera|vivaldi|browser)\b/i;

// ---------------------------------------------------------------------------------------------
// Sessions

let lastDirectAction: { text: string; at: string } | null = null;
const direct = async (name: string, args: Record<string, any>, actor: string): Promise<Result> => {
  const r = (await executeOsTool(name, args)) as Result;
  lastDirectAction = { text: `${actor}: ${r.message ?? r.error}`, at: new Date().toISOString() };
  emit('state');
  return { ...r, computer: 'DIRECT' };
};

const directSession: ComputerSession = {
  type: 'DIRECT',
  get active() { return mode === 'DIRECT'; },
  browser: "the user's default browser",
  desktop: "the user's Windows desktop",
  // The user's screen is never captured here; the JARVIS PC panel can show it only while the
  // user explicitly shares it from the panel (browser screen-share permission).
  screenshot: () => null,
  actions: {
    open_url: (a, who) => direct('open_url', a, who),
    search_web: (a, who) => direct('search_web', a, who),
    play_youtube: (a, who) => direct('play_youtube', a, who),
    open_app: (a, who) => direct('open_app', a, who),
    close_app: (a, who) => direct('close_app', a, who),
    // Research reads sources in the background (no window opens on the user's PC).
    research_web: async (a, who) => {
      const r = await fetchResearch(String(a.query), Number(a.maxSources ?? 3));
      lastDirectAction = { text: `${who}: researched "${a.query}" (${r.sources.length} sources)`, at: new Date().toISOString() };
      emit('state');
      return r.sources.length
        ? { status: 'SUCCESS', computer: 'DIRECT', message: `Read ${r.sources.length} source(s) in the background`, ...r }
        : { status: 'FAILED', computer: 'DIRECT', error: `No readable sources found for "${a.query}".`, ...r };
    },
  },
};

const orbitOk = (r: Record<string, unknown>, message: string): Result => ({ status: 'SUCCESS', computer: 'ORBIT', message, ...r });
const orbitSession: ComputerSession = {
  type: 'ORBIT',
  get active() { return mode === 'ORBIT'; },
  browser: 'Orbit private browser (isolated profile)',
  desktop: "JARVIS's private workspace (not the user's desktop)",
  screenshot: () => orbit.frame,
  actions: {
    open_url: async (a, who) => { const r = await orbit.browse(String(a.url), who); return orbitOk(r, `Opened ${r.url} in the Orbit browser`); },
    search_web: async (a, who) => { const r = await orbit.search(String(a.query), who); return orbitOk(r, `Searched for "${a.query}" in the Orbit browser`); },
    play_youtube: async (a, who) => { const r = await orbit.youtube(String(a.query), who); return orbitOk(r, `Opened YouTube results for "${a.query}" in the Orbit browser`); },
    research_web: async (a, who) => {
      const r = await orbit.research(String(a.query), who);
      return orbitOk(r, r.sources.length ? `Read ${r.sources.length} source(s) in the Orbit browser` : 'No readable sources found');
    },
    open_app: async (a) => BROWSER_APP.test(String(a.name))
      ? (await orbit.start(), orbitOk({}, 'The Orbit browser is open on my private computer'))
      : fail(`Orbit mode: I only operate my private computer and won't touch your apps. Say "Direct mode" and I'll open ${a.name} on your PC.`, 'ORBIT'),
    close_app: async (a) => BROWSER_APP.test(String(a.name)) || /youtube|tab|page/i.test(String(a.name))
      ? (await orbit.browse('about:blank').catch(() => null), orbitOk({}, 'Cleared the Orbit browser'))
      : fail(`Orbit mode: I won't close apps on your PC. Say "Direct mode" to control your computer.`, 'ORBIT'),
  },
};

// ---------------------------------------------------------------------------------------------
// Mode state

let mode: ComputerMode = 'DIRECT'; // always DIRECT at start
let modeChangedAt = new Date().toISOString();
let modeSource: 'startup' | 'voice' | 'text' | 'ui' | 'tool' = 'startup'; // who switched it last
export const getMode = () => mode;
export const sessionFor = (m: ComputerMode = mode) => (m === 'ORBIT' ? orbitSession : directSession);

export const MODE_ACK: Record<ComputerMode, string> = {
  DIRECT: "Direct mode activated. I'm connected to your PC.",
  ORBIT: 'Orbit mode activated. My private computer is ready.',
};

export function setMode(next: ComputerMode, source: 'voice' | 'text' | 'ui' | 'tool') {
  if (next === mode) return { changed: false, mode, say: MODE_ACK[mode] };
  mode = next;
  modeChangedAt = new Date().toISOString();
  modeSource = source;
  console.log(`[Computer] Mode -> ${mode} (${source})`);
  if (mode === 'ORBIT') orbit.start().catch((e) => console.error('[Orbit] start failed:', e.message));
  else orbit.stop().catch(() => {}); // Direct: the private computer stands down
  emit('state');
  return { changed: true, mode, say: MODE_ACK[mode] };
}

/**
 * An explicit mode command, and nothing else: the whole utterance must be the command
 * ("JARVIS, Orbit mode", "switch to direct mode", "activate orbit mode please").
 * Mentions inside ordinary sentences ("what is orbit mode?") never count.
 */
const MODE_COMMAND = /^\W*(?:(?:hey|ok|okay)\W+)?(?:jarvis\W+)?(?:(?:switch|go|change)(?:\s+back)?\s+(?:to|into)\s+|enter\s+|activate\s+|engage\s+|enable\s+|use\s+)?(direct|orbit)\s+mode\W*(?:(?:please|now|jarvis)\W*)*$/i;
export function parseModeCommand(utterance: string): ComputerMode | null {
  const m = utterance.trim().match(MODE_COMMAND);
  return m ? (m[1].toUpperCase() as ComputerMode) : null;
}

/** Per voice connection: assembles the user's current utterance from transcript chunks. */
export class ModeListener {
  private utterance = '';
  private heard: { mode: ComputerMode; at: number } | null = null;

  /** Speech transcript chunk. Switches immediately when the utterance is a mode command. */
  hear(chunk: string, now = Date.now()) {
    this.utterance += chunk;
    this.check(this.utterance, 'voice', now);
  }
  /** Typed message (one complete utterance). */
  hearTyped(text: string, now = Date.now()) {
    this.check(text, 'text', now);
  }
  /** The model finished its turn: the next speech is a new utterance. */
  endTurn() {
    this.utterance = '';
  }
  private check(text: string, source: 'voice' | 'text', now: number) {
    const m = parseModeCommand(text);
    if (!m) return;
    this.heard = { mode: m, at: now };
    setMode(m, source);
  }
  /** The model may only confirm a switch the user actually commanded in the last 30 s. */
  confirm(requested: string, now = Date.now()): Result & { say?: string } {
    const want = String(requested).toUpperCase();
    if (want !== 'DIRECT' && want !== 'ORBIT') return fail("Mode must be 'DIRECT' or 'ORBIT'.");
    if (!this.heard || this.heard.mode !== want || now - this.heard.at > 30000) {
      return fail(`Mode unchanged (${mode}). It only changes when the user explicitly says "Direct mode" or "Orbit mode".`);
    }
    const r = setMode(want as ComputerMode, 'tool');
    return { status: 'SUCCESS', mode: r.mode, say: r.say, message: `Mode is ${r.mode}. Tell the user exactly: "${r.say}"` };
  }
}

// ---------------------------------------------------------------------------------------------
// Router

const COMPUTER_ACTIONS = new Set(['open_url', 'search_web', 'play_youtube', 'open_app', 'close_app', 'research_web']);
export const isComputerAction = (name: string) => COMPUTER_ACTIONS.has(name);

/**
 * Which computer an action will run on. Browser/app actions follow the mode; file, volume,
 * lock and power tools only exist on the real PC ('SYSTEM').
 */
export const computerTarget = (name: string): ComputerMode | 'SYSTEM' => (COMPUTER_ACTIONS.has(name) ? mode : 'SYSTEM');

/** Every computer/browser action from JARVIS or an agent goes through here. */
export async function routeComputerAction(name: string, args: Record<string, any>, actor = 'JARVIS'): Promise<Result> {
  const target = computerTarget(name);
  if (target === 'SYSTEM') return (await executeOsTool(name, args)) as Result;
  const session = sessionFor(target);
  const action = session.actions[name];
  if (!action) return fail(`${name} is not available on the ${target} computer.`, target);
  try {
    return await action(args, actor);
  } catch (err: any) {
    return fail(err?.message || String(err), target);
  }
}

/**
 * Research for agents, through the router: the Orbit browser in ORBIT mode; in DIRECT mode the
 * sources are fetched and read in the background (agents never touch the user's browser).
 */
export async function agentResearch(query: string, agentId: string): Promise<string> {
  const r = await routeComputerAction('research_web', { query }, agentId);
  const sources = (r.sources as ResearchSource[] | undefined) ?? [];
  const where = mode === 'ORBIT' ? 'Orbit web research' : 'Web research (sources read in the background)';
  if (r.status !== 'SUCCESS' || !sources.length) return `[${where} for "${query}" found nothing usable${r.error ? `: ${r.error}` : ''}. Work from your own knowledge and say plainly that no sources were checked; do not invent citations.]`;
  return `[${where} for "${query}"]\n` + sources.map((s, i) => `Source ${i + 1}: ${s.title} (${s.url})\n${s.excerpt}`).join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// State for the UI

const listeners = new Set<(kind: 'state' | 'frame') => void>();
function emit(kind: 'state' | 'frame') {
  listeners.forEach((cb) => { try { cb(kind); } catch {} });
}
orbit.onChange((kind) => emit(kind));

export function onComputerChange(cb: (kind: 'state' | 'frame') => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function computerSnapshot() {
  const s = sessionFor();
  return {
    mode,
    modeChangedAt,
    modeSource,
    session: { type: s.type, browser: s.browser, desktop: s.desktop },
    orbit: { ...orbit.snapshot(), profile: 'isolated', profilePath: ORBIT_PROFILE },
    direct: { lastAction: lastDirectAction },
  };
}
