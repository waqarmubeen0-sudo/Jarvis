// JARVIS configuration + usage telemetry (persisted in jarvis-settings.json).
//  - Model routing: the text model (chat + agents) and the Manager's routing model.
//  - THINKING: reasoning depth (Fast = low temperature, Deep = high temperature + step-by-step).
//  - SOUL: core directives, personality, autonomy; injected into every system instruction.
//  - SKILLS: plugin toggles (web search, PC file system, code execution) and per-agent training.
//  - Quota: a delay that staggers agent API calls, and a session token budget.
//  - Every Gemini text call is timed and its token usage counted (session totals).
//  - PROVIDERS: the AI providers JARVIS can run on (keys themselves live in credentials.ts).
//  - Recent server terminal output is kept in memory for the System Logs modal.
import fs from 'node:fs';
import util from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMOTIONS, type Emotion } from './voicePersona';
import { redact } from './credentials';
export { maskKey } from './credentials';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// JARVIS_SETTINGS_FILE lets the self-checks use a scratch file instead of the real settings.
const SETTINGS_FILE = process.env.JARVIS_SETTINGS_FILE || path.resolve(HERE, 'jarvis-settings.json');

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_ROUTER_MODEL = 'gemini-flash-lite-latest';
/** Suggested text models; any gemini-* id can also be entered (it is test-called before saving). */
export const MODEL_CHOICES = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'];
export const LIVE_MODEL = 'gemini-3.8-live'; // voice (Gemini Live) model: fixed, shown read-only

/**
 * AI providers for JARVIS's text work (chat, agents, NEX routing, humor, trivia), all called through
 * generate.ts. Voice, web search and file/image analysis always use Gemini (Gemini Live / grounding / vision).
 * `models` are suggestions; any model name the key can use may be entered (it is test-called before saving).
 */
export const PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', keyName: 'GEMINI_API_KEY', keyUrl: 'https://aistudio.google.com/apikey', models: MODEL_CHOICES },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyName: 'ANTHROPIC_API_KEY', keyUrl: 'https://console.anthropic.com/settings/keys', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'] },
  { id: 'openai', label: 'OpenAI (ChatGPT)', keyName: 'OPENAI_API_KEY', keyUrl: 'https://platform.openai.com/api-keys', models: ['gpt-5', 'gpt-5-mini'] },
] as const;
export type ProviderId = (typeof PROVIDERS)[number]['id'];

export const PERSONALITIES = ['PROFESSIONAL', 'CASUAL', 'SARCASTIC'] as const;
export const DEPTHS = ['FAST', 'DEEP', 'CUSTOM'] as const; // CUSTOM = temperature set by hand (or model default)
export const LANGUAGES = ['', 'TypeScript', 'JavaScript', 'Python', 'C#', 'C++', 'Java', 'Go', 'Rust', 'GDScript', 'Lua', 'SQL'] as const;
export const DEPTH_TEMPERATURE = { FAST: 0.2, DEEP: 1.0 } as const;
const MAX_DIRECTIVES = 4000;
const MAX_TRAINING = 20_000;

export interface AgentTraining { language: string; context: string }
/** Gemini prebuilt voices offered in Settings (adult male, natural); the first is the default. */
export const VOICES = ['Achird', 'Umbriel', 'Zubenelgenubi', 'Puck', 'Charon', 'Fenrir', 'Orus'] as const;
export interface VoiceConfig {
  name: string;
  emotion: 'AUTO' | Emotion;
  autoEmotion: boolean;
  speed: 'RELAXED' | 'NATURAL' | 'BRISK';
  expressiveness: 'SUBTLE' | 'NATURAL' | 'EXPRESSIVE';
  interruption: boolean; // barge-in: the user can talk over JARVIS
  enabled: boolean; // JARVIS's voice is played (off = transcript only)
  speakTyped: boolean; // speak replies to typed messages too (uses Gemini TTS)
}
/** Permission Center: what JARVIS may do on its own (ON), only after the user confirms (ASK), or never (OFF). */
export const PERMISSIONS = ['PC_CONTROL', 'BROWSER', 'SCREEN', 'FILE_ACCESS', 'FILE_DELETE', 'TERMINAL', 'SOFTWARE_INSTALL', 'EMAIL_READ', 'EMAIL_SEND', 'EMAIL_DELETE', 'MEMORY', 'AUTOMATION', 'PURCHASES'] as const;
export type PermKey = (typeof PERMISSIONS)[number];
export type PermLevel = 'ON' | 'ASK' | 'OFF';
export const DEFAULT_PERMISSIONS: Record<PermKey, PermLevel> = {
  PC_CONTROL: 'ON', BROWSER: 'ON', SCREEN: 'ON', FILE_ACCESS: 'ON', FILE_DELETE: 'ASK', TERMINAL: 'ON', SOFTWARE_INSTALL: 'ASK',
  EMAIL_READ: 'ON', EMAIL_SEND: 'ASK', EMAIL_DELETE: 'ASK', MEMORY: 'ASK', AUTOMATION: 'ON', PURCHASES: 'OFF',
};
/** Money can never run unattended: purchases are at most ASK. */
export const NEVER_ON: PermKey[] = ['PURCHASES'];
/** Proactive JARVIS: which things it may watch and tell the user about. */
export interface ProactiveConfig { enabled: boolean; reminders: boolean; email: boolean; downloads: boolean; builds: boolean }

export interface JarvisConfig {
  model: string;
  routerModel: string;
  provider: ProviderId;
  providerModels: { anthropic: string; openai: string }; // the Gemini text model is `model`
  userName: string; // what JARVIS calls the user ('' = not set)
  temperature: number | null; // null = model default
  depth: (typeof DEPTHS)[number];
  soul: { directives: string; personality: (typeof PERSONALITIES)[number]; autonomy: 'REACTIVE' | 'PROACTIVE' };
  skills: { webSearch: boolean; fileSystem: boolean; codeExecution: boolean };
  training: Record<string, AgentTraining>;
  limits: { delaySec: number; tokenBudget: number }; // tokenBudget 0 = not set
  voice: VoiceConfig;
  permissions: Record<PermKey, PermLevel>;
  proactive: ProactiveConfig;
}
/** Backwards-compatible view used by the API Settings modal. */
export type ApiSettings = Pick<JarvisConfig, 'model' | 'temperature'>;

const DEFAULTS: JarvisConfig = {
  model: DEFAULT_MODEL,
  routerModel: DEFAULT_ROUTER_MODEL,
  provider: 'gemini',
  providerModels: { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5' },
  userName: '', // set on the setup screen; blank = JARVIS doesn't know it yet
  temperature: null,
  depth: 'CUSTOM',
  soul: { directives: '', personality: 'CASUAL', autonomy: 'REACTIVE' },
  skills: { webSearch: true, fileSystem: true, codeExecution: false },
  training: {},
  limits: { delaySec: 1, tokenBudget: 0 },
  voice: { name: 'Achird', emotion: 'AUTO', autoEmotion: true, speed: 'NATURAL', expressiveness: 'NATURAL', interruption: true, enabled: true, speakTyped: false },
  permissions: DEFAULT_PERMISSIONS,
  proactive: { enabled: true, reminders: true, email: true, downloads: true, builds: true },
};

export const validModel = (m: unknown): m is string => typeof m === 'string' && /^gemini-[a-z0-9.\-]{2,60}$/i.test(m);
export const validProviderModel = (m: unknown): m is string => typeof m === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:\/-]{1,79}$/.test(m);
export const validName = (n: unknown): n is string => typeof n === 'string' && /^[\p{L}\p{M}' .-]{1,30}$/u.test(n.trim());
export const validTemp = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 2;
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);
const oneOf = <T extends readonly string[]>(list: T, v: unknown, dflt: T[number]): T[number] => (list.includes(v as string) ? (v as T[number]) : dflt);
const agentId = (id: string) => /^[A-Z]{2,12}$/.test(id);

/** Builds a full, valid config from untrusted input, keeping `base` for anything missing or invalid. */
export function normalizeConfig(input: any, base: JarvisConfig = DEFAULTS): JarvisConfig {
  const j = input && typeof input === 'object' ? input : {};
  const training: Record<string, AgentTraining> = { ...base.training };
  if (j.training && typeof j.training === 'object') {
    for (const [id, t] of Object.entries<any>(j.training)) {
      const key = id.toUpperCase();
      if (!agentId(key)) continue;
      if (t === null) { delete training[key]; continue; }
      training[key] = {
        language: oneOf(LANGUAGES, t?.language, (training[key]?.language ?? '') as any),
        context: typeof t?.context === 'string' ? t.context.slice(0, MAX_TRAINING) : training[key]?.context ?? '',
      };
      if (!training[key].language && !training[key].context.trim()) delete training[key];
    }
  }
  const permissions = { ...base.permissions };
  for (const k of PERMISSIONS) {
    const v = j.permissions?.[k];
    if (v === 'ON' || v === 'ASK' || v === 'OFF') permissions[k] = NEVER_ON.includes(k) && v === 'ON' ? 'ASK' : v;
  }
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    permissions,
    proactive: {
      enabled: bool(j.proactive?.enabled, base.proactive.enabled),
      reminders: bool(j.proactive?.reminders, base.proactive.reminders),
      email: bool(j.proactive?.email, base.proactive.email),
      downloads: bool(j.proactive?.downloads, base.proactive.downloads),
      builds: bool(j.proactive?.builds, base.proactive.builds),
    },
    model: validModel(j.model) ? j.model : base.model,
    routerModel: validModel(j.routerModel) ? j.routerModel : base.routerModel,
    provider: PROVIDERS.some((x) => x.id === j.provider) ? j.provider : base.provider,
    providerModels: {
      anthropic: validProviderModel(j.providerModels?.anthropic) ? j.providerModels.anthropic : base.providerModels.anthropic,
      openai: validProviderModel(j.providerModels?.openai) ? j.providerModels.openai : base.providerModels.openai,
    },
    userName: j.userName === '' ? '' : validName(j.userName) ? j.userName.trim() : base.userName,
    temperature: j.temperature === null ? null : validTemp(j.temperature) ? j.temperature : base.temperature,
    depth: oneOf(DEPTHS, j.depth, base.depth),
    soul: {
      directives: typeof j.soul?.directives === 'string' ? j.soul.directives.slice(0, MAX_DIRECTIVES) : base.soul.directives,
      personality: oneOf(PERSONALITIES, j.soul?.personality, base.soul.personality),
      autonomy: oneOf(['REACTIVE', 'PROACTIVE'] as const, j.soul?.autonomy, base.soul.autonomy),
    },
    skills: {
      webSearch: typeof j.skills?.webSearch === 'boolean' ? j.skills.webSearch : base.skills.webSearch,
      fileSystem: typeof j.skills?.fileSystem === 'boolean' ? j.skills.fileSystem : base.skills.fileSystem,
      codeExecution: typeof j.skills?.codeExecution === 'boolean' ? j.skills.codeExecution : base.skills.codeExecution,
    },
    training,
    limits: {
      delaySec: clampInt(j.limits?.delaySec, 1, 5, base.limits.delaySec),
      tokenBudget: clampInt(j.limits?.tokenBudget, 0, 100_000_000, base.limits.tokenBudget),
    },
    voice: {
      // Any Gemini prebuilt voice name is accepted (letters only), so a previously saved one keeps working.
      name: typeof j.voice?.name === 'string' && /^[A-Za-z]{3,20}$/.test(j.voice.name) ? j.voice.name : base.voice.name,
      emotion: oneOf(['AUTO', ...EMOTIONS] as const, j.voice?.emotion, base.voice.emotion),
      autoEmotion: typeof j.voice?.autoEmotion === 'boolean' ? j.voice.autoEmotion : base.voice.autoEmotion,
      speed: oneOf(['RELAXED', 'NATURAL', 'BRISK'] as const, j.voice?.speed, base.voice.speed),
      expressiveness: oneOf(['SUBTLE', 'NATURAL', 'EXPRESSIVE'] as const, j.voice?.expressiveness, base.voice.expressiveness),
      interruption: typeof j.voice?.interruption === 'boolean' ? j.voice.interruption : base.voice.interruption,
      enabled: typeof j.voice?.enabled === 'boolean' ? j.voice.enabled : base.voice.enabled,
      speakTyped: typeof j.voice?.speakTyped === 'boolean' ? j.voice.speakTyped : base.voice.speakTyped,
    },
  };
}

const load = (): JarvisConfig => {
  try { return normalizeConfig(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))); } catch { return normalizeConfig({}); }
};

let config = load();
export const getConfig = (): JarvisConfig => structuredClone(config);

/**
 * Merges a patch into the config and saves it. Choosing a reasoning depth sets the temperature;
 * setting a temperature by hand makes the depth CUSTOM.
 */
export function saveConfig(patch: any): JarvisConfig {
  const p = patch && typeof patch === 'object' ? { ...patch } : {};
  if (p.depth === 'FAST' || p.depth === 'DEEP') p.temperature = DEPTH_TEMPERATURE[p.depth as 'FAST' | 'DEEP'];
  else if ('temperature' in p && p.depth === undefined) p.depth = 'CUSTOM';
  if (p.soul) p.soul = { ...config.soul, ...p.soul };
  if (p.skills) p.skills = { ...config.skills, ...p.skills };
  if (p.limits) p.limits = { ...config.limits, ...p.limits };
  if (p.voice) p.voice = { ...config.voice, ...p.voice };
  if (p.permissions) p.permissions = { ...config.permissions, ...p.permissions };
  if (p.proactive) p.proactive = { ...config.proactive, ...p.proactive };
  if (p.providerModels) p.providerModels = { ...config.providerModels, ...p.providerModels };
  if ('model' in p && !validModel(p.model)) throw new Error('Model must be a Gemini model id, e.g. gemini-3.8-flash.');
  if ('routerModel' in p && !validModel(p.routerModel)) throw new Error('Routing model must be a Gemini model id.');
  if ('temperature' in p && p.temperature !== null && !validTemp(p.temperature)) throw new Error('Temperature must be between 0 and 2.');
  config = normalizeConfig(p, config);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return getConfig();
}

export const getSettings = (): ApiSettings => ({ model: config.model, temperature: config.temperature });
export const saveSettings = (next: Partial<ApiSettings>): ApiSettings => { saveConfig(next); return getSettings(); };

/** The Gemini text model (Gemini-only features, and all text work when Gemini is the provider). */
export const textModel = () => config.model;
/** The provider chosen in API Settings, and the model JARVIS uses on it. */
export const activeProvider = (): ProviderId => config.provider;
export const providerModel = (p: ProviderId = config.provider) => (p === 'gemini' ? config.model : config.providerModels[p]);
/** The Manager's lightweight routing model. */
export const routerModel = () => config.routerModel;
/** Generation config for conversational calls (agents, chat): the reasoning depth / chosen temperature. */
export const temperatureConfig = () => (config.temperature === null ? {} : { temperature: config.temperature });
export const skills = () => ({ ...config.skills });
/** Minimum gap between agent API calls (the quota slider). */
export const agentCallGapMs = () => config.limits.delaySec * 1000;
export const isProactive = () => config.soul.autonomy === 'PROACTIVE';
export const voiceConfig = (): VoiceConfig => ({ ...config.voice });
export const userName = () => config.userName;
/** Every system instruction ends with who the user is (the name from the setup screen, if any). */
export const personalizeInstruction = (text: string) => `${text}\n\n${config.userName
  ? `The user's name is ${config.userName}.`
  : "You don't know the user's name yet. If it comes up naturally, you may ask once what they'd like to be called; until then use no name."} Don't assume the user's gender.`;
export const permissionLevel = (k: PermKey): PermLevel => config.permissions[k];
export const proactiveConfig = (): ProactiveConfig => ({ ...config.proactive });

const PERSONALITY_NOTE: Record<JarvisConfig['soul']['personality'], string> = {
  PROFESSIONAL: 'Tone: strictly professional. Precise, formal and to the point. No jokes, banter or small talk.',
  CASUAL: 'Tone: casual and warm, like a trusted friend. Light humour is welcome when it fits.',
  SARCASTIC: 'Tone: sarcastic, dry wit. Tease playfully, but stay helpful, accurate and never mean-spirited.',
};

/** The SOUL block appended to JARVIS's system instructions (text chat and voice). */
export function soulInstruction(): string {
  const s = config.soul;
  return `

SOUL (the user's settings; they take priority over earlier style guidance):
${PERSONALITY_NOTE[s.personality]}
Autonomy: ${s.autonomy === 'PROACTIVE'
    ? 'PROACTIVE. You may act on clear intent without waiting to be asked twice: delegate obvious work to the team, report when background tasks finish, and suggest the next useful step.'
    : 'REACTIVE. Act only on explicit commands. Never start tasks or delegate work unless the user asks for it; just answer and wait.'}${s.directives.trim() ? `
Core directives (follow them unless they are unsafe):
${s.directives.trim()}` : ''}${depthInstruction()}`;
}

/** Reasoning-depth guidance shared by JARVIS and the agents. */
export function depthInstruction(): string {
  if (config.depth === 'DEEP') return '\nReasoning: DEEP ANALYSIS. Think step by step before answering: break the problem down, check your assumptions and edge cases, then give a well-reasoned answer (show a short outline of your reasoning for complex questions).';
  if (config.depth === 'FAST') return '\nReasoning: FAST EXECUTION. Answer directly and efficiently; skip long deliberation.';
  return '';
}

/** Personality + directives + training for one agent's system prompt. */
export function agentInstruction(id: string): string {
  const s = config.soul;
  const t = config.training[id.toUpperCase()];
  return `${depthInstruction()}${s.directives.trim() ? `\nTeam directives from the user (follow unless unsafe):\n${s.directives.trim()}` : ''}${t?.language ? `\nDefault coding language: ${t.language}. Use it for code unless the task clearly needs another language.` : ''}${t?.context?.trim() ? `\n[Training context from the user for ${id}]\n${t.context.trim()}` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Context window (THINKING node): prompt size of the latest conversational turn.

export interface ContextState { source: 'voice' | 'chat'; model: string; tokens: number; at: number }
let context: ContextState | null = null;
export function recordContext(source: ContextState['source'], model: string, meta: any) {
  const tokens = Number(meta?.promptTokenCount) || 0;
  if (tokens > 0) context = { source, model, tokens, at: Date.now() };
}
export const getContext = () => (context ? { ...context } : null);

// ---------------------------------------------------------------------------------------------
// Usage telemetry

export interface Usage {
  calls: number;
  errors: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastLatencyMs: number | null;
  lastModel: string | null;
  lastCallAt: number | null;
  lastRateLimitAt: number | null;
  since: number;
}
const usage: Usage = { calls: 0, errors: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, lastLatencyMs: null, lastModel: null, lastCallAt: null, lastRateLimitAt: null, since: Date.now() };
export const getUsage = (): Usage => ({ ...usage });

/** Adds a Gemini response's usageMetadata (text calls and Live session messages alike). */
export function addTokens(meta: any) {
  if (!meta) return;
  usage.promptTokens += Number(meta.promptTokenCount) || 0;
  usage.outputTokens += Number(meta.candidatesTokenCount ?? meta.responseTokenCount) || 0;
  usage.totalTokens += Number(meta.totalTokenCount) || 0;
}

/** Times one Gemini call and counts its tokens. Errors are counted (and rate limits noted), then rethrown. */
export async function tracked<T extends { usageMetadata?: any }>(model: string, call: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await call();
    usage.calls++;
    usage.lastLatencyMs = Date.now() - t0;
    usage.lastModel = model;
    usage.lastCallAt = Date.now();
    addTokens(r?.usageMetadata);
    return r;
  } catch (err: any) {
    usage.calls++;
    usage.errors++;
    usage.lastLatencyMs = Date.now() - t0;
    usage.lastModel = model;
    usage.lastCallAt = Date.now();
    if (/\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(String(err?.message ?? err))) usage.lastRateLimitAt = Date.now();
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Server terminal capture (for System Logs)

export interface LogLine { at: number; level: 'log' | 'warn' | 'error'; text: string }
const lines: LogLine[] = [];
const MAX_LINES = 400;

export function captureConsole() {
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    // Keys, passwords and tokens are hidden in the terminal and in the dashboard alike.
    console[level] = (...args: any[]) => {
      let text: string;
      try { text = redact(util.format(...args)); } catch { return orig('[log line hidden: it could not be checked for secrets]'); }
      orig(text);
      lines.push({ at: Date.now(), level, text: text.slice(0, 2000) });
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    };
  }
}
export const recentLogs = (sinceAt = 0) => lines.filter((l) => l.at > sinceAt);
