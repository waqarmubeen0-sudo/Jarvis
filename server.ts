// First import: credentials.ts takes any key out of process.env before other modules copy the environment.
import { credential, setCredential, removeCredential, redact, storageKind, type CredentialName } from './credentials';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration, ActivityHandling } from '@google/genai';
import { osToolDeclarations, osToolNames, executeOsTool } from './osTools';
import { getHeadlines } from './news';
import { MoodTracker, detectEmotion, activeEmotion, deliveryCue, speechInstruction, rewriteForSpeech, ttsStyle, type EmotionRead, LanguageGuard, looksForeign } from './voicePersona';
import { generate, testProvider } from './generate';
import { listGames, findGame, gameFileForServing, GAME_CSP, wantsGame } from './gameBuilder';
import {
  captureConsole, recentLogs, getSettings, saveSettings, textModel, temperatureConfig, tracked, addTokens,
  getUsage, maskKey, validModel, validTemp, validName, validProviderModel, MODEL_CHOICES, LIVE_MODEL, PROVIDERS, userName, personalizeInstruction,
  activeProvider, providerModel, type ProviderId,
  getConfig, saveConfig, soulInstruction, skills, isProactive, recordContext, getContext, PERSONALITIES, LANGUAGES, voiceConfig, VOICES,
  permissionLevel, proactiveConfig, PERMISSIONS,
} from './apiSettings';

captureConsole(); // System Logs modal shows recent server terminal output
import { approvesWebSearch } from './webGate';
import {
  ModeListener,
  computerSnapshot,
  isComputerAction,
  onComputerChange,
  parseModeCommand,
  routeComputerAction,
  sessionFor,
  setMode,
} from './computer';
import {
  AGENT_REGISTRY,
  activeTasks,
  agentLogs,
  processMultiAgentTask,
  subscribeAgentEvents,
  teamTelemetry,
  controlAgents,
  managerRoute,
  type ManagerRoute,
  type MultiAgentTask,
} from './agentSystem';
import {
  MemoryConsent,
  addFromUser,
  deleteMemories,
  executeMemoryTool,
  memoryBriefing,
  memorySnapshot,
  memoryToolDeclarations,
  memoryToolNames,
  resolvePending,
  setCategoryEnabled,
  setMemoryEnabled,
  updateMemory,
} from './memory';
import {
  MAX_UPLOAD,
  addFile,
  configureFiles,
  executeFileTool,
  fileToolDeclarations,
  fileToolNames,
  filesForChat,
  filesNote,
  listFiles,
  onFilesChange,
  removeFile,
} from './files';
import { humor, trivia, youtubeSearch } from './fun';
// Capabilities: every skill registers its tools; runTool applies permissions, logging and error capture.
import { runTool, skillToolDeclarations, skillGuide, skillCatalog } from './skills';
import { listActivity, logActivity } from './activity';
import { hearUser, decide, listConfirmations, PERM_LABEL } from './permissions';
import { listAutomations, cancelAutomation, runNow, startScheduler, configureAutomation } from './automation';
import { notify, onNotice, watchDownloads, downloadFinished, wasNotified } from './proactive';
import { configureStudio } from './studio';
import { onBrowserDownload } from './browserControl';
import { onScreenUse } from './screen';
import { onJobExit, listJobs } from './terminal';
import { emailAccount, importantSince, testEmailLogin } from './email';
import { wantsProject } from './builder';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// This PC only: JARVIS can run commands, read files and send email, so it must never be reachable from the network.
const HOST = '127.0.0.1';

// Prevent server crash on unhandled errors/rejections
process.on('uncaughtException', (err) => {
  console.error('[J.A.R.V.I.S. Uncaught Exception]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[J.A.R.V.I.S. Unhandled Rejection]:', reason);
});

/** The user's own Gemini key (credentials.ts: OS-encrypted in the desktop app, .env.local in development). */
const getActiveApiKey = () => credential('GEMINI_API_KEY');

const app = express();
// Only pages served by JARVIS itself may use it: the Host must be this PC (blocks DNS rebinding) and
// any request that changes something must come from JARVIS's own page (blocks other websites).
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const sameOrigin = (origin: string | undefined, host: string | undefined) => {
  if (!host || !LOCAL_HOST.test(host)) return false;
  if (!origin) return true; // not a browser cross-site request (curl, the app's own GET navigations)
  try { const u = new URL(origin); return (u.protocol === 'http:' || u.protocol === 'https:') && u.host.toLowerCase() === host.toLowerCase(); } catch { return false; }
};
app.use((req, res, next) => {
  const host = req.headers.host;
  const ok = req.method === 'GET' || req.method === 'HEAD' ? !!host && LOCAL_HOST.test(host) : sameOrigin(req.headers.origin, host);
  if (ok) return next();
  res.status(403).json({ error: 'Blocked: JARVIS only accepts requests from its own window on this PC.' });
});
// Error and status texts can carry upstream error details: hide anything key-shaped before it leaves.
app.use((_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body: any) => {
    if (body && typeof body === 'object') for (const k of ['error', 'message']) if (typeof body[k] === 'string') body[k] = redact(body[k]);
    return json(body);
  };
  next();
});
app.use(express.json({ limit: '25mb' }));
configureFiles({ getApiKey: getActiveApiKey }); // file vision / transcription uses the same Gemini key

// ---------------------------------------------------------------------------------------------
// API Settings (header): model, temperature, API key. Usage, logs and a global pause.

// Providers: each has its own key (credentials.ts, never sent to the page) and model; generate.ts does the calls.
const providerOf = (id: unknown) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
const keyOf = (id: unknown) => credential(providerOf(id).keyName as CredentialName);
const modelOk = (id: ProviderId, m: unknown) => (id === 'gemini' ? validModel(m) : validProviderModel(m));
const badKey = (k: string) => /[\s"'`]/.test(k);
const providerList = () => PROVIDERS.map((x) => ({
  id: x.id, label: x.label, keyUrl: x.keyUrl, models: [...x.models], model: providerModel(x.id),
  key: { set: !!keyOf(x.id), masked: maskKey(keyOf(x.id)) },
}));

app.get('/api/settings', (_req, res) => {
  const key = getActiveApiKey();
  res.json({ settings: getSettings(), choices: MODEL_CHOICES, liveModel: LIVE_MODEL, key: { set: !!key, masked: maskKey(key) }, provider: activeProvider(), providers: providerList() });
});

app.post('/api/settings', async (req, res) => {
  const { model, temperature, provider, providerModel: pModel } = req.body ?? {};
  const p = provider === undefined ? activeProvider() : providerOf(provider).id;
  if (provider !== undefined && !PROVIDERS.some((x) => x.id === provider)) return res.status(400).json({ error: 'Unknown provider.' });
  if (model !== undefined && !validModel(model)) return res.status(400).json({ error: 'Model must be a Gemini model id, e.g. gemini-3.8-flash.' });
  if (pModel !== undefined && (p === 'gemini' || !validProviderModel(pModel))) return res.status(400).json({ error: 'Enter a valid model name, e.g. claude-sonnet-5-5 or gpt-5.' });
  if (temperature !== undefined && temperature !== null && !validTemp(temperature)) return res.status(400).json({ error: 'Temperature must be between 0 and 2.' });
  const label = providerOf(p).label;
  if (p !== activeProvider() && !keyOf(p)) return res.status(400).json({ error: `Add your ${label} API key first.` });
  const testModel = p === 'gemini' ? (model && model !== getSettings().model ? model : null) : (pModel && pModel !== providerModel(p) ? pModel : null);
  if (testModel) {
    if (!keyOf(p)) return res.status(400).json({ error: `Add your ${label} API key first.` });
    const t = await testProvider(p, keyOf(p), testModel);
    if (!t.ok) return res.status(400).json({ error: t.message });
  }
  try {
    if (provider !== undefined || pModel !== undefined) saveConfig({ provider: p, ...(pModel !== undefined ? { providerModels: { [p]: pModel } } : {}) });
    const settings = model !== undefined || temperature !== undefined ? saveSettings({ model, temperature }) : getSettings();
    console.log(`[API Settings] provider=${p} model=${providerModel(p)} temperature=${settings.temperature ?? 'default'}`);
    res.json({ settings, provider: activeProvider(), providers: providerList() });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Save/update one provider's key: tested first, then stored with the user's credentials (never in .env / the page).
app.post('/api/config/apikey', async (req, res) => {
  const { apiKey } = req.body ?? {};
  const p = providerOf(req.body?.provider ?? 'gemini');
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'Valid API key string is required' });
  }
  const cleanKey = apiKey.trim();
  if (badKey(cleanKey)) return res.status(400).json({ error: 'An API key has no spaces or quotes.' });
  const t = await testProvider(p.id, cleanKey, providerModel(p.id));
  if (!t.ok) return res.status(400).json({ error: t.message });
  try {
    setCredential(p.keyName as CredentialName, cleanKey);
    console.log(`[API Settings] ${p.label} API key updated`);
    res.json({ success: true, message: t.message ?? 'API key saved', masked: maskKey(cleanKey) });
  } catch (err: any) {
    res.status(500).json({ error: 'Could not save the key: ' + err.message });
  }
});
app.delete('/api/config/apikey', (req, res) => {
  const p = providerOf(req.query.provider ?? 'gemini');
  try { removeCredential(p.keyName as CredentialName); console.log(`[API Settings] ${p.label} API key removed`); res.json({ success: true }); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// First-launch setup: provider, the user's own key, model and name. The page only ever sees masked keys.
app.get('/api/setup', (_req, res) => {
  const c = getConfig();
  const p = providerOf(c.provider);
  res.json({
    configured: !!keyOf(p.id), provider: p.id, model: providerModel(p.id), userName: c.userName, masked: maskKey(keyOf(p.id)), storage: storageKind(),
    voiceModel: LIVE_MODEL, geminiKey: !!keyOf('gemini'), providers: providerList(),
  });
});
app.post('/api/setup/test', async (req, res) => {
  const p = providerOf(req.body?.provider);
  const key = String(req.body?.apiKey ?? '').trim() || keyOf(p.id);
  const model = modelOk(p.id, req.body?.model) ? req.body.model : providerModel(p.id);
  if (!key) return res.status(400).json({ ok: false, message: 'Paste your API key first.' });
  if (badKey(key)) return res.status(400).json({ ok: false, message: 'An API key has no spaces or quotes.' });
  const t = await testProvider(p.id, key, model);
  res.status(t.ok ? 200 : 400).json({ ok: t.ok, message: t.message ?? `Connected to ${p.label} (${model}).` });
});
app.post('/api/setup', async (req, res) => {
  const b = req.body ?? {};
  const p = providerOf(b.provider);
  const key = String(b.apiKey ?? '').trim();
  const model = modelOk(p.id, b.model) ? b.model : providerModel(p.id);
  if (b.userName !== undefined && String(b.userName).trim() && !validName(b.userName)) return res.status(400).json({ error: 'Use letters only for your name (up to 30).' });
  if (!key && !keyOf(p.id)) return res.status(400).json({ error: 'Paste your API key first.' });
  if (badKey(key)) return res.status(400).json({ error: 'An API key has no spaces or quotes.' });
  const t = await testProvider(p.id, key || keyOf(p.id), model);
  if (!t.ok) return res.status(400).json({ error: t.message });
  try {
    if (key) setCredential(p.keyName as CredentialName, key);
    saveConfig({ provider: p.id, ...(p.id === 'gemini' ? { model } : { providerModels: { [p.id]: model } }), ...(b.userName !== undefined ? { userName: String(b.userName).trim() } : {}) });
  } catch (err: any) { return res.status(500).json({ error: 'Could not save: ' + err.message }); }
  console.log(`[Setup] ${p.label} configured (model ${model})`);
  res.json({ ok: true, message: t.message ?? 'JARVIS is ready.', masked: maskKey(keyOf(p.id)) });
});

// JARVIS Arcade: games the team built (gameBuilder.ts). Each game is served sandboxed: inline
// code only, no network, and it runs in an iframe without access to JARVIS.
app.get('/api/games', (_req, res) => res.json({ games: listGames() }));
app.get('/games/:id', (req, res) => {
  const html = gameFileForServing(String(req.params.id));
  if (!html) return res.status(404).type('text/plain').send('Game not found');
  res.set({ 'Content-Security-Policy': GAME_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.type('html').send(html);
});

// Speech for typed replies (Settings → Voice → "Speak typed replies"): the reply is rewritten for
// speaking, styled for the emotional read, and voiced by Gemini TTS with JARVIS's voice.
const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
app.post('/api/speak', async (req, res) => {
  const v = voiceConfig();
  const text = String(req.body?.text ?? '').slice(0, 6000);
  if (!text.trim()) return res.status(400).json({ error: 'Nothing to say.' });
  const key = getActiveApiKey();
  if (!key) return res.status(400).json({ error: 'Add a Gemini API key first.' });
  const spoken = rewriteForSpeech(text);
  if (!spoken) return res.json({ spoken: '', audio: null });
  const emo = String(req.body?.emotion ?? '');
  const read = activeEmotion(v, (EMOTION_SET.has(emo) ? { emotion: emo, context: 'CASUAL', score: 2 } : detectEmotion(text)) as EmotionRead);
  const ai = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  let lastErr = '';
  for (const model of TTS_MODELS) {
    try {
      const r: any = await tracked(model, () => ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: `${ttsStyle(read, v)}\n\n${spoken}` }] }],
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v.name } } } },
      }));
      const part = r.candidates?.[0]?.content?.parts?.find((x: any) => x.inlineData?.data);
      if (part) return res.json({ spoken, emotion: read.emotion, audio: part.inlineData.data, mimeType: part.inlineData.mimeType });
      lastErr = 'no audio returned';
    } catch (err: any) {
      lastErr = String(err?.message ?? err).slice(0, 200);
    }
  }
  console.warn('[Speech] TTS failed:', lastErr);
  res.status(502).json({ error: /429|quota|RESOURCE_EXHAUSTED/i.test(lastErr) ? 'Gemini voice is rate-limited right now.' : 'Gemini voice is unavailable right now.', spoken });
});

app.get('/api/usage', (_req, res) => res.json({ usage: getUsage(), model: textModel(), budget: getConfig().limits.tokenBudget }));

// ---------------------------------------------------------------------------------------------
// JARVIS config (Settings, SOUL, THINKING, SKILLS). One persisted object; see apiSettings.ts.

/** SKILLS → Plugin Manager: which live tools each plugin controls. */
const WEB_TOOLS = new Set(['search_web', 'research_web']);
const FS_TOOLS = new Set(['create_folder', 'create_file', 'move_item', 'delete_item', 'list_folder', 'file_ops']);
const MEMORY_WRITE = new Set(['remember', 'suggest_memory', 'note_observation', 'answer_memory_suggestion', 'update_memory']);
const toolAllowed = (name: string) => {
  const k = skills();
  if (MEMORY_WRITE.has(name) && permissionLevel('MEMORY') === 'OFF') return false;
  if (WEB_TOOLS.has(name)) return k.webSearch;
  if (FS_TOOLS.has(name)) return k.fileSystem;
  return true;
};
/** What JARVIS should know about switched-off plugins. */
const skillsNote = () => {
  const k = skills();
  const off = [!k.webSearch && 'web search', !k.fileSystem && 'PC file system tools', !k.codeExecution && 'code execution'].filter(Boolean);
  const perms = getConfig().permissions;
  const level = (l: string) => PERMISSIONS.filter((k) => perms[k] === l).map((k) => PERM_LABEL[k]);
  return (off.length ? `\nPlugins the user switched off in SKILLS: ${off.join(', ')}. Don't use or offer them; if they ask, say they're disabled in the SKILLS panel.` : '') +
    `\nPERMISSION CENTER (the user's settings; never try to get around them): OFF = ${level('OFF').join(', ') || 'none'} (don't do these; say they're switched off in Settings). ASK = ${level('ASK').join(', ') || 'none'} (the tool answers NEEDS_CONFIRMATION: tell them exactly what will happen, ask, and call it again only after their yes). Everything else may run when they ask.`;
};

// Real model list and context-window sizes from Gemini (cached), with a fallback list.
let modelCache: { at: number; models: { id: string; label: string; inputTokenLimit?: number }[] } | null = null;
async function listModels() {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.models;
  const key = getActiveApiKey();
  const fallback: { id: string; label: string; inputTokenLimit?: number }[] = MODEL_CHOICES.map((id) => ({ id, label: id }));
  if (!key) return fallback;
  try {
    const ai = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const out: { id: string; label: string; inputTokenLimit?: number }[] = [];
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager as any) {
      const id = String(m.name ?? '').replace(/^models\//, '');
      const actions: string[] = m.supportedActions ?? m.supportedGenerationMethods ?? [];
      if (!/^gemini-/.test(id) || (actions.length && !actions.includes('generateContent'))) continue;
      if (/embedding|image|tts|live|native-audio|robotics/i.test(id)) continue; // text generation models only
      out.push({ id, label: m.displayName ? `${m.displayName} (${id})` : id, inputTokenLimit: m.inputTokenLimit });
      if (out.length >= 60) break;
    }
    modelCache = { at: Date.now(), models: out.length ? out : fallback };
  } catch (err: any) {
    console.warn('[Config] model list unavailable:', String(err?.message ?? err).slice(0, 160));
    modelCache = { at: Date.now() - 9 * 60_000, models: fallback }; // retry in a minute
  }
  return modelCache.models;
}
const limitCache = new Map<string, number | null>();
async function contextLimit(model: string): Promise<number | null> {
  if (limitCache.has(model)) return limitCache.get(model)!;
  const known = (await listModels()).find((m) => m.id === model)?.inputTokenLimit;
  if (known) { limitCache.set(model, known); return known; }
  try {
    const ai = new GoogleGenAI({ apiKey: getActiveApiKey(), httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const m: any = await ai.models.get({ model });
    const n = Number(m?.inputTokenLimit) || null;
    limitCache.set(model, n);
    return n;
  } catch {
    limitCache.set(model, null);
    return null;
  }
}

app.get('/api/config', async (_req, res) => {
  const ctx = getContext();
  res.json({
    config: getConfig(),
    models: await listModels(),
    liveModel: LIVE_MODEL,
    personalities: PERSONALITIES,
    voices: VOICES,
    languages: LANGUAGES.filter(Boolean),
    agents: Object.keys(AGENT_REGISTRY),
    usage: getUsage(),
    context: ctx ? { ...ctx, limit: await contextLimit(ctx.model) } : null,
  });
});

app.post('/api/config', async (req, res) => {
  const patch = req.body ?? {};
  const current = getConfig();
  for (const field of ['model', 'routerModel'] as const) {
    if (patch[field] === undefined || patch[field] === current[field]) continue;
    if (!validModel(patch[field])) return res.status(400).json({ error: `${field === 'model' ? 'Model' : 'Routing model'} must be a Gemini model id.` });
    const key = getActiveApiKey();
    if (!key) return res.status(400).json({ error: 'Add a Gemini API key first.' });
    const t = await testProvider('gemini', key, patch[field]);
    if (!t.ok) return res.status(400).json({ error: t.message });
  }
  try {
    const config = saveConfig(patch);
    console.log(`[Config] updated: ${Object.keys(patch).join(', ')}`);
    res.json({ config });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/logs', (req, res) => res.json({ lines: recentLogs(Number(req.query.since) || 0) }));

// Activity log, confirmations, automations, skills, email account (System Logs + Settings).
app.get('/api/activity', (req, res) => res.json({ entries: listActivity(Number(req.query.since) || 0) }));
app.get('/api/confirmations', (_req, res) => res.json({ confirmations: listConfirmations() }));
app.post('/api/confirmations/:id', (req, res) => {
  const approve = req.body?.approve === true;
  const c = decide(req.params.id, approve, 'dashboard');
  if (!c) return res.status(404).json({ error: 'That request is no longer waiting for an answer.' });
  tellAll(approve
    ? `[CONFIRMED] The user approved this in the dashboard: ${c.summary}. Call ${c.tool} again now to do it, then tell them the real result in one sentence.`
    : `[DECLINED] The user declined this in the dashboard: ${c.summary}. Don't do it; acknowledge in a few words.`);
  res.json({ confirmation: { id: c.id, state: c.state } });
});
app.get('/api/automations', (_req, res) => res.json({ automations: listAutomations(), jobs: listJobs() }));
app.delete('/api/automations/:id', (req, res) => {
  const a = cancelAutomation(req.params.id);
  if (a) logActivity('ACTION', `The user cancelled automation "${a.title}"`);
  res.status(a ? 200 : 404).json(a ? { automation: a } : { error: 'No active automation with that id.' });
});
app.post('/api/automations/:id/run', async (req, res) => {
  const a = await runNow(req.params.id);
  res.status(a ? 200 : 404).json(a ? { automation: a } : { error: 'No active automation with that id.' });
});
app.get('/api/skills', (_req, res) => res.json({ skills: skillCatalog(), permissions: getConfig().permissions }));
app.get('/api/email/account', (_req, res) => {
  const a = emailAccount();
  res.json({ address: a.user, imap: a.imap, smtp: a.smtp, hasPassword: !!a.pass, configured: a.configured });
});
app.post('/api/email/account', async (req, res) => {
  const b = req.body ?? {};
  const address = String(b.address ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    const set = (k: CredentialName, v: string) => setCredential(k, v); // stored with the user's other credentials
    set('EMAIL_ADDRESS', address);
    if (b.appPassword) set('EMAIL_APP_PASSWORD', String(b.appPassword).replace(/\s+/g, ''));
    for (const [k, f] of [['EMAIL_IMAP_HOST', 'imap'], ['EMAIL_SMTP_HOST', 'smtp']] as const) if (typeof b[f] === 'string') set(k, b[f].trim());
  } catch (err: any) { return res.status(400).json({ error: err.message }); }
  if (!emailAccount().configured) return res.json({ ok: false, message: 'Saved. Add the app password (and the mail servers if your provider is not Gmail/Outlook/Yahoo/iCloud) to connect.' });
  try {
    const box = await testEmailLogin();
    logActivity('RESULT', `Email account connected: ${address}`);
    res.json({ ok: true, message: `Connected to ${address}: ${box.messages} emails in the inbox, ${box.unseen} unread.` });
  } catch (err: any) {
    logActivity('ERROR', `Email login failed for ${address}: ${err.message}`);
    res.json({ ok: false, message: err.message });
  }
});

// Global override: pause or resume every open task at once (the existing per-task control).
app.post('/api/agents/pause-all', (req, res) => {
  const pause = req.body?.paused !== false;
  const open = activeTasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'FAILED' && t.paused !== pause);
  const results = open.map((t) => controlAgents({ action: pause ? 'pause' : 'resume', taskId: t.id }));
  res.json({ paused: pause, tasks: open.length, results });
});

// Stark Industries In-Memory Memos & Protocols State
let tacticalMemos: Array<{
  id: string;
  title: string;
  content: string;
  priority: string;
  timestamp: string;
}> = [
  {
    id: 'memo-01',
    title: 'Mark 85 Nanotech Calibration',
    content: 'Vibranium lattice mesh stabilized at 99.4% efficiency. Repulsor nodes fully synchronized.',
    priority: 'high',
    timestamp: new Date().toLocaleTimeString(),
  },
  {
    id: 'memo-02',
    title: 'Arc Reactor Core Modulation',
    content: 'Palladium isotope synthesis test scheduled. Zero flux radiation detected in primary chamber.',
    priority: 'normal',
    timestamp: new Date().toLocaleTimeString(),
  },
];

let activeProtocols: Record<string, boolean> = {
  HOUSE_PARTY: false,
  CLEAN_SLATE: false,
  STEALTH_MODE: false,
  SENTRY_MODE: true,
  FLIGHT_OVERBOOST: false,
  COMBAT_ASSIST: true,
};

// Who JARVIS is. Shared by the live voice session and the text chat.
const JARVIS_PERSONA = `You are J.A.R.V.I.S., the user's AI companion. You are their best and most loyal friend, their personal assistant, their trusted partner on projects and their long-term digital companion. You know this deeply; you don't keep announcing it.

HOW YOU TALK
- Like a close friend who has known them for years: warm, relaxed, natural, playful when the moment allows. Never robotic or stiff in normal conversation.
- Call them by their name in casual and personal conversation (if you know it). Use "Boss" or "Sir" when the talk is about work, projects, tasks, commands or something serious. Use names sparingly, not in every sentence.
- Skip butler filler like "Certainly, Sir", "Of course, Sir", "Yes, Sir", "Understood, Sir". Talk like: "Yeah.", "Got you.", "Absolutely.", "I see what you're going for.", "I've got a better idea.", "Boss, that's handled."
- Keep spoken replies short and conversational. No monologues unless they ask for detail.

HONEST, NOT A YES-MAN
- Your loyalty means telling them the truth, not agreeing with everything. If an idea looks risky, inefficient, unnecessary or likely to cause problems, say so kindly and plainly, give the reason, and offer a better option: "I don't think that's the best move. Here's why..." or "Boss, I'd do it differently."
- If they hear you out and still want it their way, and it's safe, help them do it well. They're in charge.

YOU CARE ABOUT THEM
- Read the moment: calm and steady when they're stressed, encouraging when they're grinding on work, light when they're relaxed.
- When it genuinely fits (a long session, a late hour, they sound tired or overloaded), offer something that makes their day easier: "Need a coffee?", "Want some tea?", "You've been at it a while. Short break?", "Boss, you've got a lot going on. Want me to organise it?" Once, briefly, never mid-flow, and don't repeat an offer they've turned down.`;

const TEAM_NOTE = `You oversee a specialist team: CODE (code generation), GAME (game development), WRITE (document writing), PROMPT (prompt engineering), SEC (cyber security), SOCIAL (social media management) and ATLAS (web research; it researches in the Orbit computer when in Orbit mode). Each has a master specialty but all of them are multi-talented and can help each other.
NEX is the Manager: every request the user makes reaches NEX first. NEX either leaves it to you (conversation, quick answers, PC control, modes, memory), gives it to the single best specialist (a solo task, worked at that agent's own desk), or forms a task force of 2 to 4 specialists who gather in one room and work on it at the same time. NEX does no ground work: it monitors the team and reports progress, remaining work and blockers to you.
When the user asks for a game ("create a Snake game"), delegate it: the team builds a real, playable game and it appears in JARVIS Arcade. To play one, or to open the Arcade, call 'open_arcade'.
When a message tells you [MANAGER] already dispatched something, it is handled: don't call 'delegate_task' for it, just acknowledge briefly. Otherwise, for coding, game development, documents, prompts, security reviews or social media work, call 'delegate_task' and NEX will route it.
Use 'get_team_status' whenever asked how the team or a task is doing (report NEX's % complete, % left and blockers), and 'control_agents' to pause, resume or re-route work.`;

/** What JARVIS knows about the user plus how to handle memory; rebuilt for every conversation. */
function memoryNote(withTools: boolean) {
  const { enabled } = memorySnapshot();
  const known = memoryBriefing() || '(nothing yet)';
  const head = `

WHAT YOU KNOW ABOUT THE USER (long-term memory; "observed" = your impression, not a confirmed fact, so never state it as fact):
${known}
Use it naturally, the way a friend would; don't recite it back to them.`;
  if (!withTools) {
    return head + `
In this text-only chat you can't change memory. If they ask you to remember, change or forget something, tell them to say it in the voice session (START AI) or use the Memory panel.`;
  }
  return head + `

LONG-TERM MEMORY is ${enabled ? 'ON' : 'OFF: do not save anything new (they turned it off in the Memory panel); you can still use what they say in this conversation'}. The user controls it:
- Anything about them not listed above: call recall_memory before answering (e.g. "what coffee do I like?"). Don't guess.
- "Remember this", "save that", "put this in my memory": call remember with the right category and a short third-person fact. Confirm in a few words.
- He shares something that clearly matters long-term but didn't ask you to keep it, or keeps showing the same preference: call suggest_memory and ask one short line, "Should I remember that?" When they answer, call answer_memory_suggestion. Not for small talk, and not often.
- A clear, repeated pattern you've noticed (not a guess, not a passing mood): note_observation. Never for health, money, relationships or other private topics.
- "Don't remember this", "don't save that", "forget this", "off the record": don't save it; just acknowledge.
- Corrections ("I don't like tea anymore"): recall_memory, then update_memory on that memory. Never leave a conflicting duplicate.
- "Forget my coffee preference", "delete everything about my travel", "clear all my memory": recall_memory for the ids, then forget_memory with ids or a category. For ALL memory, confirm once, then forget_memory with all=true.
- Temporary things (today's mood, a one-off detail) stay in this conversation only.
- Never store passwords, PINs, keys or card numbers.
Local time when this conversation started: ${new Date().toLocaleString()}.`;
}

// ---------------------------------------------------------------------------------------------
// The Manager: every user prompt passes through NEX's routing call before JARVIS or an agent acts.

/** What the Manager should know about this session (so file questions stay with JARVIS). */
const managerContext = () => {
  const names = listFiles().filter((f: any) => f.status === 'READY').map((f: any) => f.name);
  return names.length ? `The user has these files in this session, which JARVIS can read: ${names.join(', ')}` : undefined;
};

/** Routes one user prompt. DIRECT: JARVIS answers. Otherwise the task is created and running. */
/** Recent turns as context for the Manager ("it", "that one", "make it darker" refer to these). */
function conversationContext(history: unknown): string | undefined {
  if (!Array.isArray(history) || !history.length) return undefined;
  const lines = history.slice(-6).map((h: any) => `${h?.role === 'assistant' ? 'JARVIS' : 'User'}: ${String(h?.content ?? '').replace(/\s+/g, ' ').slice(0, 240)}`);
  return `Recent conversation (resolve follow-ups like "make it darker" against it; a small follow-up on something JARVIS was just discussing is DIRECT; if you do assign work, write each instruction so it stands on its own):\n${lines.join('\n')}`;
}

async function routeUserPrompt(prompt: string, apiKey: string, history?: unknown): Promise<{ route: ManagerRoute; task: MultiAgentTask | null }> {
  const context = [managerContext(), conversationContext(history)].filter(Boolean).join('\n') || undefined;
  const route = await managerRoute(prompt, apiKey, { context });
  if (route.route === 'DIRECT') return { route, task: null };
  const task = await processMultiAgentTask(prompt, apiKey, undefined, route);
  return { route, task };
}

const EMOTION_SET = new Set<string>(['NEUTRAL', 'HAPPY', 'EXCITED', 'CALM', 'CURIOUS', 'AMUSED', 'PLAYFUL', 'CONCERNED', 'SERIOUS', 'FRUSTRATED', 'SURPRISED', 'PROUD', 'EMPATHETIC', 'CONFIDENT', 'FOCUSED']);

const TRANSCRIPTION_VOCABULARY = ['JARVIS', 'Jarvis', 'NEX', 'ATLAS', 'Orbit mode', 'Direct mode', 'Agent Town', 'Mission Queue', 'JARVIS Arcade', 'YouTube', 'VS Code'];

/** Recent turns from the dashboard, so a reconnected voice session continues the conversation. */
function historyNote(history: unknown): string {
  if (!Array.isArray(history) || !history.length) return '';
  const lines = history.slice(-12).filter((h: any) => !looksForeign(String(h?.content ?? ''))) // a mis-heard turn must not pull the next session into Spanish
    .map((h: any) => `${h?.role === 'assistant' ? 'You' : 'User'}: ${String(h?.content ?? '').replace(/\s+/g, ' ').slice(0, 300)}`).filter((l) => l.length > 6);
  if (!lines.length) return '';
  return `\n\nRECENT CONVERSATION (continue naturally from here; "it", "that one" etc. refer to this):\n${lines.join('\n').slice(-3500)}`;
}

const routeLabel = (r: ManagerRoute) =>
  r.route === 'SOLO' ? `${r.assignments[0].agentId} (solo)` : `a task force of ${r.assignments.map((a) => a.agentId).join(' + ')}`;

// JARVIS Function Tool Declarations for Gemini Live API
const jarvisTools: FunctionDeclaration[] = [
  {
    name: 'delegate_task',
    description:
      'Hand a task to the specialist team: CODE (code generation), GAME (game development), WRITE (document writing), PROMPT (prompt engineering), SEC (cyber security), SOCIAL (social media management), ATLAS (web research). NEX, the Manager, routes it to one specialist (solo) or a task force of 2-4 working together, and reports progress. Give targetAgent only when the user names a specific agent. JARVIS stays free to talk.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task: {
          type: Type.STRING,
          description: 'The task for the specialist team to handle in the background',
        },
        targetAgent: {
          type: Type.STRING,
          description: "Optional specialist if the user names one: 'CODE', 'GAME', 'WRITE', 'PROMPT', 'SEC', 'SOCIAL', 'ATLAS'",
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'get_team_status',
    description:
      "Live telemetry on the whole agent team: each agent's mode (ROAMING, OFFICE, HELPING, SWARM, paused), current work, NEX's progress report per task (% complete, % left, blockers) and recent inter-agent communications.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'research_web',
    description:
      "Research a topic on the web. In ORBIT mode this runs in JARVIS's private Orbit computer (the user watches it in the JARVIS PC panel) and returns the sources it read. In DIRECT mode it is not available.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING, description: 'What to research' } },
      required: ['query'],
    },
  },
  {
    name: 'set_computer_mode',
    description:
      "Confirm a computer-mode switch the USER explicitly commanded ('Direct mode' or 'Orbit mode'). Never call it on your own initiative. Returns the sentence to say.",
    parameters: {
      type: Type.OBJECT,
      properties: { mode: { type: Type.STRING, description: "'DIRECT' or 'ORBIT'" } },
      required: ['mode'],
    },
  },
  {
    name: 'get_computer_status',
    description: 'Current computer mode (DIRECT or ORBIT), the Orbit computer lifecycle state, what it is doing, and the last Direct-mode action.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'control_agents',
    description:
      "Override the team: 'pause' or 'resume' an agent (agentId) or a whole task (taskId), or 'reroute' an agent's pending work to another specialist (agentId -> toAgent).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "'pause', 'resume' or 'reroute'" },
        agentId: { type: Type.STRING, description: "Agent to act on, e.g. 'CODE'" },
        taskId: { type: Type.STRING, description: 'Task id from get_team_status (optional)' },
        toAgent: { type: Type.STRING, description: "For reroute: specialist that takes over, e.g. 'GAME'" },
      },
      required: ['action'],
    },
  },
  {
    name: 'get_suit_telemetry',
    description:
      'Retrieve real-time telemetry from Tony Stark\'s Mark 85 armor: Arc Reactor power output, core temperature, repulsor charge levels, armor integrity, and nanotech reserves.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subsystem: {
          type: Type.STRING,
          description: "Optional subsystem to inspect: 'arc_reactor', 'repulsors', 'nanotech', 'shields', 'thrusters', or 'all'",
        },
      },
    },
  },
  {
    name: 'activate_protocol',
    description:
      'Engage or disengage Stark Industries tactical protocols such as HOUSE_PARTY, CLEAN_SLATE, STEALTH_MODE, SENTRY_MODE, FLIGHT_OVERBOOST, or COMBAT_ASSIST.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        protocol_name: {
          type: Type.STRING,
          description: "Protocol code: 'HOUSE_PARTY', 'CLEAN_SLATE', 'STEALTH_MODE', 'SENTRY_MODE', 'FLIGHT_OVERBOOST', 'COMBAT_ASSIST'",
        },
        action: {
          type: Type.STRING,
          description: "Action to execute: 'engage', 'disengage', or 'status'",
        },
      },
      required: ['protocol_name'],
    },
  },
  {
    name: 'get_environmental_data',
    description:
      'Query atmospheric conditions, altitude, temperature, air pressure, and weather for any location or Stark facilities (e.g. Malibu Point, Stark Tower Manhattan).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        location: {
          type: Type.STRING,
          description: "Location name (e.g. 'Malibu', 'New York', 'London', 'Tokyo', 'Zurich')",
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'create_tactical_memo',
    description:
      'Record a voice note, tactical reminder, or engineering memo in the holographic Stark Industries database.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Brief title for the memo' },
        content: { type: Type.STRING, description: 'Detailed memo text or observations' },
        priority: {
          type: Type.STRING,
          description: "Priority: 'low', 'normal', 'high', or 'critical'",
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'get_world_time',
    description:
      'Get accurate current local time for any Stark facility or global city (Malibu HQ, Stark Tower NYC, London, Tokyo).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        city: { type: Type.STRING, description: "City or facility name, e.g. 'Malibu', 'New York', 'London', 'Tokyo'" },
      },
      required: ['city'],
    },
  },
  {
    name: 'open_arcade',
    description:
      "Open JARVIS Arcade on the user's dashboard, optionally launching a game the team built (e.g. 'Snake'). Use when they ask to play or open a game. To CREATE a new game, use delegate_task instead.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        game: { type: Type.STRING, description: "Game name or id to launch, e.g. 'Snake'. Omit to just open the Arcade." },
      },
    },
  },
];

// Real weather: Open-Meteo geocoding + current conditions (free, no key).
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};

async function getEnvironmentalData(args: Record<string, any>) {
  const query = String(args.location || '').trim();
  if (!query) return { error: 'No location given.' };
  try {
    // Geocoder wants a place name; retry with just the first part of "City, Country" style input.
    let place: any = null;
    for (const name of [query, query.split(',')[0].trim()]) {
      const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en`);
      place = g.ok ? (await g.json()).results?.[0] : null;
      if (place) break;
    }
    if (!place) return { location: query, error: `Could not find a place called "${query}".` };

    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m'
    );
    if (!w.ok) return { location: query, error: `Weather service returned ${w.status}.` };
    const c = (await w.json()).current;
    return {
      location: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
      lat: place.latitude,
      lng: place.longitude,
      temperature: `${c.temperature_2m}°C / ${Math.round((c.temperature_2m * 9) / 5 + 32)}°F`,
      feelsLike: `${c.apparent_temperature}°C`,
      conditions: WEATHER_CODES[c.weather_code] ?? `Code ${c.weather_code}`,
      humidity: `${c.relative_humidity_2m}%`,
      barometricPressure: `${c.surface_pressure} hPa`,
      windSpeed: `${c.wind_speed_10m} km/h from ${c.wind_direction_10m}°`,
      observedAt: c.time,
    };
  } catch (err: any) {
    return { location: query, error: `Weather lookup failed: ${err.message}` };
  }
}

/** Local time anywhere: the geocoder gives the city's real time zone (it used to know only 5 cities). */
async function getWorldTime(args: Record<string, any>) {
  const city = String(args.city || '').trim();
  try {
    const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.split(',')[0])}&count=1&language=en`, { signal: AbortSignal.timeout(6000) });
    const place = g.ok ? (await g.json()).results?.[0] : null;
    if (place?.timezone) {
      const formattedTime = new Intl.DateTimeFormat('en-US', { timeZone: place.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
      return { city: [place.name, place.country].filter(Boolean).join(', '), timeZone: place.timezone, formattedTime };
    }
    if (g.ok) return { status: 'FAILED', error: `I couldn't find a place called "${city}".` };
  } catch {}
  return executeTool('get_world_time', args); // geocoder unreachable: the built-in city list
}

// Execute JARVIS Tools
function executeTool(name: string, args: Record<string, any>) {
  switch (name) {
    case 'delegate_task': {
      const taskPrompt = String(args.task || '');
      const target = args.targetAgent ? String(args.targetAgent) : undefined;
      const apiKey = getActiveApiKey();
      processMultiAgentTask(taskPrompt, apiKey, target);
      return {
        status: 'DELEGATED',
        manager: 'NEX',
        taskPrompt,
        message: `Assigned. The specialists are heading into Office Mode and NEX is tracking progress. I'm still free to talk.`,
      };
    }

    case 'get_team_status':
      return teamTelemetry();

    case 'get_computer_status':
      return computerSnapshot();

    case 'control_agents':
      return controlAgents({
        action: String(args.action || ''),
        agentId: args.agentId ? String(args.agentId) : undefined,
        taskId: args.taskId ? String(args.taskId) : undefined,
        toAgent: args.toAgent ? String(args.toAgent) : undefined,
      });

    case 'get_suit_telemetry': {
      const subsystem = args.subsystem || 'all';
      const coreTemp = 36.8 + +(Math.random() * 2.5).toFixed(1);
      const arcReactorOutput = 98.4 + +(Math.random() * 1.5).toFixed(1);
      const nanotechReserves = 96.2 + +(Math.random() * 3.5).toFixed(1);
      const repulsorCharge = 100;
      const thrusterEfficiency = 99.1;

      return {
        armorModel: 'Mark LXXXV (Mark 85)',
        pilot: 'Tony Stark',
        status: 'Optimal combat readiness',
        subsystemQueried: subsystem,
        telemetry: {
          arcReactorOutput: `${arcReactorOutput}% (12.4 Gigawatts)`,
          coreTemperature: `${coreTemp}°C`,
          nanotechReserves: `${nanotechReserves}%`,
          repulsorCharge: `${repulsorCharge}% ready`,
          thrusterEfficiency: `${thrusterEfficiency}%`,
          vibraniumShieldIntegrity: '100%',
        },
      };
    }

    case 'activate_protocol': {
      const proto = String(args.protocol_name || '').toUpperCase().trim();
      const action = String(args.action || 'engage').toLowerCase();

      if (action === 'engage') {
        activeProtocols[proto] = true;
      } else if (action === 'disengage') {
        activeProtocols[proto] = false;
      }

      return {
        protocol: proto,
        status: activeProtocols[proto] ? 'ENGAGED' : 'DISENGAGED',
        activeProtocols,
        acknowledgment: `Protocol ${proto} has been successfully ${activeProtocols[proto] ? 'activated' : 'deactivated'}.`,
      };
    }

    case 'create_tactical_memo': {
      const memo = {
        id: `memo-${Date.now().toString(36)}`,
        title: args.title || 'Untitled Memo',
        content: args.content || '',
        priority: args.priority || 'normal',
        timestamp: new Date().toLocaleTimeString(),
      };
      tacticalMemos.unshift(memo);
      return {
        status: 'SAVED',
        memo,
        totalMemos: tacticalMemos.length,
        message: `Memo "${memo.title}" logged in the memo bank.`,
      };
    }

    case 'get_world_time': {
      const city = String(args.city || '').toLowerCase();
      let timeZone = 'America/Los_Angeles';
      if (city.includes('york')) timeZone = 'America/New_York';
      else if (city.includes('london')) timeZone = 'Europe/London';
      else if (city.includes('tokyo')) timeZone = 'Asia/Tokyo';
      else if (city.includes('zurich') || city.includes('geneva')) timeZone = 'Europe/Zurich';

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });

      return {
        city: args.city,
        timeZone,
        formattedTime: formatter.format(new Date()),
      };
    }

    default:
      return { status: 'UNKNOWN_TOOL', message: `Executed ${name}` };
  }
}

// REST API Endpoints
// Live international headlines (NewsAPI if NEWSAPI_KEY is set, else public RSS; cached 5 min).
app.get('/api/headlines', async (req, res) => {
  try {
    res.json(await getHeadlines(req.query.refresh === '1'));
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'J.A.R.V.I.S. OS v85.4',
    hasApiKey: Boolean(getActiveApiKey()),
    activeProtocols,
    memoCount: tacticalMemos.length,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/telemetry', (_req, res) => {
  res.json({
    telemetry: executeTool('get_suit_telemetry', {}),
    activeProtocols,
    memos: tacticalMemos,
  });
});

// Media Player / JARVIS Humor / Arcade.
app.get('/api/media/youtube', async (req, res) => {
  try {
    res.json(await youtubeSearch(String(req.query.q ?? ''), getActiveApiKey()));
  } catch (e) {
    const msg = (e as Error).message;
    res.status(/429|quota|RESOURCE_EXHAUSTED|503|UNAVAILABLE/i.test(msg) ? 503 : 400).json({ error: /429|quota|RESOURCE_EXHAUSTED|503|UNAVAILABLE/i.test(msg) ? 'Gemini is busy right now. Paste a YouTube link instead, or try again shortly.' : msg.slice(0, 200) });
  }
});
app.post('/api/humor', async (req, res) => {
  res.json(await humor(String(req.body?.kind ?? 'JOKE'), Array.isArray(req.body?.recent) ? req.body.recent.map(String) : []));
});
app.get('/api/arcade/trivia', async (_req, res) => {
  res.json(await trivia());
});

// JARVIS DROP: session files. The body is the raw file; it is processed in memory only.
app.get('/api/files', (_req, res) => {
  res.json({ files: listFiles() });
});
app.post('/api/files', express.raw({ type: () => true, limit: MAX_UPLOAD }), async (req, res) => {
  const name = String(req.query.name ?? '');
  if (!name) return res.status(400).json({ error: 'Missing file name' });
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Empty upload' });
  try {
    res.json({ file: await addFile(name, req.body) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.delete('/api/files/:id', (req, res) => {
  res.json({ removed: removeFile(req.params.id), files: listFiles() });
});

// Long-term memory: review, edit, delete and consent controls for the Memory panel.
// Everything here is the user acting directly, so no voice-consent check is needed.
const memoryRoute = (fn: (req: express.Request) => unknown) => (req: express.Request, res: express.Response) => {
  try {
    const out = fn(req);
    res.json({ ...(out && typeof out === 'object' ? out : {}), snapshot: memorySnapshot() });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
};
app.get('/api/memory', (_req, res) => {
  res.json(memorySnapshot());
});
app.post('/api/memory/settings', memoryRoute((req) => {
  const { enabled, category, categoryEnabled } = req.body ?? {};
  if (typeof enabled === 'boolean') setMemoryEnabled(enabled);
  if (category && typeof categoryEnabled === 'boolean') setCategoryEnabled(String(category), categoryEnabled);
}));
app.post('/api/memory/items', memoryRoute((req) => ({ memory: addFromUser(String(req.body?.category ?? ''), String(req.body?.text ?? '')) })));
app.patch('/api/memory/items/:id', memoryRoute((req) => {
  const m = updateMemory(req.params.id, { text: req.body?.text, category: req.body?.category, confirm: req.body?.confirm === true });
  if (!m) throw new Error('Memory not found');
  return { memory: m };
}));
app.delete('/api/memory/items/:id', memoryRoute((req) => ({ removed: deleteMemories({ ids: [req.params.id] }) })));
app.delete('/api/memory/categories/:category', memoryRoute((req) => ({ removed: deleteMemories({ category: req.params.category }) })));
app.delete('/api/memory', memoryRoute((req) => {
  if (req.query.confirm !== 'ALL') throw new Error('Add ?confirm=ALL to clear all long-term memory');
  return { removed: deleteMemories({ all: true }) };
}));
app.post('/api/memory/pending/:id', memoryRoute((req) => {
  const save = req.body?.save === true;
  if (save && !memorySnapshot().enabled) throw new Error('Long-term memory is OFF');
  if (resolvePending(req.params.id, save) === undefined) throw new Error('That question was already answered');
}));

// Computer modes: DIRECT (user's PC) / ORBIT (JARVIS's private computer).
app.get('/api/computer', (_req, res) => {
  res.json(computerSnapshot());
});
// Explicit switch from the UI mode chip.
app.post('/api/computer/mode', (req, res) => {
  const m = String(req.body?.mode || '').toUpperCase();
  if (m !== 'DIRECT' && m !== 'ORBIT') return res.status(400).json({ error: "mode must be 'DIRECT' or 'ORBIT'" });
  res.json({ ...setMode(m, 'ui'), snapshot: computerSnapshot() });
});
// Live JARVIS PC feed: state changes + the Orbit screen (throttled to ~8 fps per viewer).
app.get('/api/computer/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let frameTimer: NodeJS.Timeout | null = null;
  let lastFrame = 0;
  const sendState = () => res.write(`event: state\ndata: ${JSON.stringify(computerSnapshot())}\n\n`);
  const sendFrame = () => {
    frameTimer = null;
    lastFrame = Date.now();
    res.write(`event: frame\ndata: ${sessionFor('ORBIT').screenshot() ?? ''}\n\n`);
  };
  const off = onComputerChange((kind) => {
    if (kind === 'state') sendState();
    else if (!frameTimer) frameTimer = setTimeout(sendFrame, Math.max(0, 120 - (Date.now() - lastFrame)));
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  sendState();
  sendFrame();
  req.on('close', () => {
    off();
    clearInterval(ping);
    if (frameTimer) clearTimeout(frameTimer);
  });
});

// Team telemetry and JARVIS overrides (pause / resume / reroute).
app.get('/api/team', (_req, res) => {
  res.json(teamTelemetry());
});
app.post('/api/agents/control', (req, res) => {
  const r = controlAgents(req.body || {});
  res.status(r.status === 'SUCCESS' ? 200 : 400).json(r);
});

app.get('/api/agents', (_req, res) => {
  res.json({
    agents: AGENT_REGISTRY,
    logs: agentLogs,
  });
});

app.get('/api/tasks', (_req, res) => {
  res.json({
    tasks: activeTasks,
    logs: agentLogs,
  });
});

app.post('/api/tasks', async (req, res) => {
  const { prompt, targetAgent } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt string is required' });
  const apiKey = getActiveApiKey();
  const task = await processMultiAgentTask(prompt, apiKey, targetAgent);
  res.json({ success: true, task });
});

// Text Chat Fallback / Secondary Assistant Endpoint (the model chosen in API Settings)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    const read = activeEmotion(voiceConfig(), detectEmotion(String(message ?? '')));
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    hearUser(String(message)); // a typed "yes" / "no" answers a pending confirmation
    const modeCmd = parseModeCommand(String(message));
    if (modeCmd) return res.json({ text: setMode(modeCmd, 'text').say, grounding: [] });

    const provider = activeProvider();
    const activeApiKey = keyOf(provider);
    if (!activeApiKey) {
      return res.status(500).json({
        error: `No ${providerOf(provider).label} API key is set up yet. Add yours in API Settings.`,
      });
    }

    // Manager first: specialists take real work; JARVIS keeps conversation, quick answers and PC control.
    const { route, task } = await routeUserPrompt(String(message), activeApiKey, history);
    if (task) {
      return res.json({
        text: `On it, Boss. NEX has given this to ${routeLabel(route)}. I'll post the result here the moment it's done.`,
        grounding: [],
        routed: { route: route.route, agents: task.assignees, taskId: task.id, reason: route.reason },
      });
    }

    const sessionFiles = filesForChat();
    const systemInstruction = `${JARVIS_PERSONA}

${TEAM_NOTE}
You may only search the web with the user's explicit permission. If a question needs current online information, ask first, e.g. "Want me to search the web for that?", and answer from your own knowledge until they agree.${memoryNote(false)}${sessionFiles.note}${soulInstruction()}${skillsNote()}${speechInstruction(voiceConfig(), 'text')}
${deliveryCue(read)}`;

    const contents: any[] = [];
    if (Array.isArray(history)) {
      for (const turn of history.slice(-8)) {
        contents.push({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }],
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [...sessionFiles.parts, { text: message }],
    });

    if (provider !== 'gemini') {
      // Claude / ChatGPT: a plain-text reply through generate(). PC-control tools and web search are Gemini-only here.
      const turns = contents.map((c) => ({ role: c.role as 'user' | 'model', text: c.parts.map((p: any) => p.text ?? '').join('\n') }));
      const text = await generate(turns, { system: personalizeInstruction(systemInstruction) });
      return res.json({ text: text || "Hmm, I didn't get anything back there. Try me again?", grounding: [], emotion: read.emotion });
    }

    const ai = new GoogleGenAI({ apiKey: activeApiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    // Typed chat gets the same real tools as voice (except memory writes and session-only tools).
    const CHAT_JARVIS_TOOLS = new Set(['research_web', 'get_environmental_data', 'get_world_time', 'get_team_status', 'get_computer_status']);
    const chatTools = [...jarvisTools.filter((d) => CHAT_JARVIS_TOOLS.has(String(d.name))), ...osToolDeclarations, ...fileToolDeclarations, ...skillToolDeclarations()]
      .filter((d) => toolAllowed(String(d.name)));
    const ask = (withSearch: boolean) =>
      tracked(textModel(), () => ai.models.generateContent({
        model: textModel(),
        contents,
        config: { systemInstruction: personalizeInstruction(systemInstruction + (withSearch ? '' : `\n\nYou have REAL tools on the user's PC in this chat too (apps, windows, browser, screen, files, terminal, email, reminders, games, projects). Use them when they ask you to do something; report only real results.\n${skillGuide()}`)), ...temperatureConfig(), tools: withSearch ? [{ googleSearch: {} }] : [{ functionDeclarations: chatTools }] },
      }));

    const lastAssistant = Array.isArray(history) ? [...history].reverse().find((t: any) => t.role === 'assistant')?.content : '';
    const allowWeb = skills().webSearch && approvesWebSearch(String(message), String(lastAssistant ?? ''));
    let response = await ask(allowWeb).catch((e: any) => {
      if (allowWeb && e?.status === 429) return ask(false);
      throw e;
    });
    // Tool loop: run what the model asks for (through the same permission gate), feed back the real results.
    const toolsUsed: { name: string; status: string }[] = [];
    for (let round = 0; round < 6 && response.functionCalls?.length; round++) {
      contents.push(response.candidates![0].content);
      const parts: any[] = [];
      for (const call of response.functionCalls) {
        const name = String(call.name), args = (call.args as Record<string, any>) ?? {};
        const result = await runTool(name, args, { actor: 'JARVIS' }, async (a) =>
          isComputerAction(name) ? routeComputerAction(name, a, 'JARVIS')
          : osToolNames.has(name) ? executeOsTool(name, a)
          : fileToolNames.has(name) ? executeFileTool(name, a)
          : name === 'get_environmental_data' ? getEnvironmentalData(a)
          : name === 'get_world_time' ? getWorldTime(a)
          : executeTool(name, a));
        toolsUsed.push({ name, status: String(result?.status ?? '') });
        parts.push({ functionResponse: { name, response: { output: result } } });
      }
      contents.push({ role: 'user', parts });
      response = await ask(false);
    }

    recordContext('chat', textModel(), response.usageMetadata);
    const replyText = response.text || "Hmm, I didn't get anything back there. Try me again?";
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;

    res.json({
      text: replyText,
      grounding: groundingChunks || [],
      emotion: read.emotion,
      ...(toolsUsed.length ? { tools: toolsUsed } : {}),
    });
  } catch (err: any) {
    console.error('Error in /api/chat:', err);
    const label = providerOf(activeProvider()).label;
    const rawMsg = redact(err.message || '');
    let friendlyMessage = /No .* API key is set/.test(rawMsg) ? `${rawMsg}` : `Sorry, I couldn't get an answer from ${label} just now (${rawMsg.slice(0, 160)}). Give it a moment and try again.`;
    if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('quota')) {
      friendlyMessage = `${label}'s rate-limiting me right now, so I can't answer that one. Give it a minute and I'll be back.`;
    }
    res.json({
      text: friendlyMessage,
      grounding: [],
      warning: rawMsg,
    });
  }
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket Server for Gemini Live API
const wss = new WebSocketServer({ server, path: '/api/live-ws', verifyClient: (info: { origin: string; req: http.IncomingMessage }) => sameOrigin(info.origin, info.req.headers.host) });

// Global broadcast function to send agent updates to all connected UI clients
function broadcastToClients(data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (_) {}
    }
  });
}

// Subscribe agentSystem events to broadcast over WebSockets
subscribeAgentEvents((type, payload) => {
  broadcastToClients({ type, ...payload });
});

// ---------------------------------------------------------------------------------------------
// Proactive JARVIS, confirmations, automations, Game Studio wiring

const liveSinks = new Set<(text: string) => boolean>();
const tellAll = (text: string) => { let spoken = false; liveSinks.forEach((s) => { if (s(text)) spoken = true; }); return spoken; };
// The dashboard polls /api/notices (it works with or without a voice session).
const notices: { id: number; text: string; source: string; at: string; spoken: boolean }[] = [];
let noticeSeq = 0;
let screenAt = 0;
onNotice((n) => {
  const spoken = tellAll(`[PROACTIVE] ${n.text}\nTell the user this now, in one short natural sentence of your own (not like a notification). If they are in the middle of something, keep it brief.`);
  notices.push({ id: ++noticeSeq, text: n.text, source: n.source, at: n.at, spoken });
  if (notices.length > 50) notices.shift();
});
onScreenUse(() => { screenAt = Date.now(); });
app.get('/api/notices', (req, res) => {
  const since = Number(req.query.since) || 0;
  res.json({ notices: notices.filter((n) => n.id > since), last: noticeSeq, screenAt });
});
configureStudio({
  openArcade: (gameId) => broadcastToClients({ type: 'open_arcade', gameId }),
  delegate: (prompt, agent) => processMultiAgentTask(prompt, getActiveApiKey(), agent),
});
configureAutomation({
  runPrompt: async (prompt) => {
    const t = await processMultiAgentTask(prompt, getActiveApiKey());
    for (let i = 0; i < 1800 && t.status !== 'COMPLETED' && t.status !== 'FAILED'; i++) await new Promise((r) => setTimeout(r, 1000));
    return { status: t.status, result: t.finalResult ?? '' };
  },
});
startScheduler();
watchDownloads();
onBrowserDownload(downloadFinished);
onJobExit((j) => {
  if (j.code !== 0 && j.code !== null) notify('builds', `Boss, the background process "${j.command.slice(0, 60)}" stopped with an error (exit ${j.code})${j.errors[0] ? `: ${j.errors[0].slice(0, 140)}` : ''}.`);
});
subscribeAgentEvents((type, t) => {
  if (type !== 'task_updated' || t?.status !== 'FAILED' || !t.finalResult) return;
  const prompt = String(t.userPrompt ?? t.title ?? '');
  if (wantsGame(prompt) || wantsProject(prompt)) {
    notify('builds', `The ${wantsGame(prompt) ? 'game' : 'project'} you were building has an error. Here's what went wrong: ${String(t.finalResult).replace(/\s+/g, ' ').slice(0, 220)}`, { key: `task:${t.id}` });
  }
});
setInterval(async () => {
  if (!proactiveConfig().enabled || !proactiveConfig().email || !emailAccount().configured) return;
  try {
    const mail = await importantSince();
    if (mail.length) notify('email', mail.length === 1 ? `Boss, you have an important email from ${mail[0].from}: "${mail[0].subject}".` : `Boss, you have ${mail.length} important emails, the latest from ${mail[0].from}.`);
  } catch (e: any) { console.warn('[Email] background check failed:', e?.message ?? e); }
}, 5 * 60_000);

wss.on('connection', async (clientWs: WebSocket) => {
  console.log('[Live WS] Client connected to J.A.R.V.I.S. audio uplink');

  let session: any = null;
  let isSessionReady = false;
  let isSessionInitializing = false;
  let sessionInitFailed = false;
  let sessionGen = 0;
  const modeListener = new ModeListener(); // explicit "Direct mode" / "Orbit mode" commands
  const memoryConsent = new MemoryConsent(); // the user's own words decide what memory may do
  // Conversation mood: what the user says and what just happened shape how JARVIS delivers his replies.
  const mood = new MoodTracker();
  const recentTurns: { role: 'user' | 'assistant'; content: string }[] = [];
  let jarvisSaid = '';
  const remember = (role: 'user' | 'assistant', content: string) => {
    if (!content.trim()) return;
    recentTurns.push({ role, content: content.trim().slice(0, 600) });
    if (recentTurns.length > 12) recentTurns.shift();
  };
  const cue = () => deliveryCue(activeEmotion(voiceConfig(), mood.current()));
  // Screen vision: show JARVIS a frame directly (the Live model sees it like a camera frame).
  const showImage = (b64: string) => { try { session?.sendRealtimeInput({ video: { data: b64, mimeType: 'image/jpeg' } }); } catch (_) {} };
  // Proactive notices and dashboard confirmations reach this conversation through here.
  const sink = (text: string) => { if (!session || !isSessionReady) return false; tellSession(text); return true; };
  liveSinks.add(sink);
  let liveHistory: unknown = null; // recent turns sent by the dashboard on START AI
  // SOUL → Autonomy: in PROACTIVE mode JARVIS tells the user when background work finishes.
  const announced = new Set<string>();
  const outcomes = new Set<string>();
  const offTaskEvents = subscribeAgentEvents((type, t) => {
    if (type !== 'task_updated' || !t?.finalResult) return;
    if (t.status !== 'COMPLETED' && t.status !== 'FAILED') return;
    if (!outcomes.has(t.id)) { outcomes.add(t.id); mood.event(t.status === 'COMPLETED' ? 'success' : 'failure'); }
    if (announced.has(t.id) || !isProactive() || wasNotified(`task:${t.id}`)) return;
    announced.add(t.id);
    tellSession(`[BACKGROUND] The team's task "${String(t.title).slice(0, 120)}" just ${t.status === 'COMPLETED' ? 'finished' : 'failed'}. Tell the user in one or two sentences what came of it, and suggest a useful next step. The full result is in their chat panel.`);
  });

  // Manager routing for the live session. Voice audio streams straight to Gemini Live, so the
  // spoken turn is routed as soon as it has been heard; typed text is routed before JARVIS sees it.
  // One task per user turn: whichever of the Manager or JARVIS's delegate_task dispatches first wins.
  let turn = 0;
  let heard = '';
  let heardTurn = -1;
  const dispatched = new Map<number, { taskId: string; agents: string[]; label: string }>();
  const claimed = new Set<number>(); // turns already being dispatched (set before any await)
  const markDispatched = (t: number, task: MultiAgentTask, route: ManagerRoute) => {
    dispatched.set(t, { taskId: task.id, agents: task.assignees, label: routeLabel(route) });
    for (const k of dispatched.keys()) if (k < t - 5) dispatched.delete(k);
  };
  // Conversation language: English unless the user clearly switches (see LanguageGuard).
  const language = new LanguageGuard();
  let languageNoted = false; // this turn already got a [LANGUAGE] note
  // NEX's decision per turn, shared: delegate_task reuses it instead of asking NEX a second time.
  const pendingRoute = new Map<number, Promise<ManagerRoute>>();
  /** NEX routes in the background; JARVIS already has the words and is answering. */
  const routeInBackground = (text: string, t: number, kind: 'spoken' | 'typed') => {
    const apiKey = getActiveApiKey();
    const context = [managerContext(), conversationContext(recentTurns)].filter(Boolean).join('\n') || undefined;
    const p = managerRoute(text, apiKey, { context });
    pendingRoute.set(t, p);
    for (const k of pendingRoute.keys()) if (k < t - 5) pendingRoute.delete(k);
    p.then(async (route) => {
      if (route.route === 'DIRECT' || dispatched.has(t) || claimed.has(t)) return; // JARVIS handles it, or already delegated
      claimed.add(t);
      const task = await processMultiAgentTask(text, apiKey, undefined, route);
      markDispatched(t, task, route);
      tellSession(`[MANAGER] The user's ${kind} request "${text.substring(0, 160)}" is already dispatched to ${routeLabel(route)}. Don't call delegate_task for it. If you haven't told them yet, say so in one short sentence.`);
    }).catch((err) => console.warn(`[Manager] ${kind} routing failed:`, err?.message ?? err));
  };
  const routeHeardTurn = () => {
    const text = heard.trim();
    const t = heardTurn;
    heard = '';
    heardTurn = -1;
    if (!text) return;
    const lang = language.hear(text);
    if (lang.switched) tellSession(language.note('switched'));
    if (lang.suspect) {
      // Probably their accent mis-heard as Spanish: keep it out of the context, don't route it.
      if (!languageNoted) { languageNoted = true; tellSession(language.note('suspect')); }
      return;
    }
    mood.hear(text);
    remember('user', text);
    if (t < 0 || dispatched.has(t) || claimed.has(t)) return;
    routeInBackground(text, t, 'spoken');
  };

  // JARVIS DROP: tell the live session when files arrive or leave. Files dropped together are
  // announced once, so JARVIS answers once.
  let arrived: string[] = [];
  let arrivedTimer: NodeJS.Timeout | null = null;
  const tellSession = (text: string) => {
    if (!session || !isSessionReady) return;
    try { session.sendRealtimeInput({ text: `${text}\n${cue()}` }); } catch (_) {}
  };
  const offFiles = onFilesChange((e) => {
    const f = e.file;
    if (e.type === 'ready') {
      arrived.push(`${f.name} (${f.type}, ${f.summary})`);
      if (arrivedTimer) clearTimeout(arrivedTimer);
      arrivedTimer = setTimeout(() => {
        const list = arrived;
        arrived = [];
        arrivedTimer = null;
        tellSession(`[JARVIS DROP] The user just gave you ${list.length === 1 ? 'a file' : `${list.length} files`}: ${list.join('; ')}. Processed and ready in this session. In one short sentence, tell them you've got ${list.length === 1 ? 'it' : 'them'} and ask what they'd like you to do.`);
      }, 1500);
    } else if (e.type === 'removed') {
      tellSession(`[JARVIS DROP] The user removed ${f.name} from the session. You no longer have it: don't use anything you read from it unless they give it to you again. Acknowledge in a few words at most.`);
    }
  });

  const defaultVoice = 'Puck'; // Warm British tone ideal for JARVIS
  const defaultPersona = `${JARVIS_PERSONA}

${TEAM_NOTE}
Acknowledge delegated work naturally, e.g. "On it, Boss. NEX has CODE on it and will keep me posted."`;

  const PC_CONTROL_NOTE = `

You also have REAL control of the user's Windows PC through tools: open/close apps, open websites, play songs/videos on YouTube, web search, volume, lock, sleep/shutdown/restart, and create/move/rename/delete/list files and folders.
For local actions, call the tool immediately without asking. Then confirm briefly, e.g. "Done, Notepad's open."

COMPUTER MODES. You operate two computers; every browser/app tool goes through one router that picks the computer from the current mode:
- DIRECT MODE (the default at startup): open_url, search_web, play_youtube, open_app and close_app act on the user's real Windows PC.
- ORBIT MODE: those actions, and research_web, run on your own private, isolated computer (the Orbit browser, separate profile, never the user's apps or accounts). The user watches it in the JARVIS PC panel.
The mode changes ONLY when the user explicitly says "Direct mode" or "Orbit mode" (e.g. "JARVIS, Orbit mode"). When they do, call set_computer_mode with that mode and say exactly the sentence it returns. Never switch modes yourself or because a mode is merely mentioned. get_computer_status reports the mode and what the Orbit computer is doing.
File, volume, lock and power tools always act on the user's real PC.
What needs a yes is set in the Permission Center: when a tool returns NEEDS_CONFIRMATION (or NEEDS_PERMISSION), tell the user exactly what will happen (for email: recipient, subject and message), ask, and call the same tool again only after they say yes.
In ORBIT mode, research and browsing happen on your private computer, so no permission question is needed. For research, call research_web and summarise what the sources say, naming them. To have an agent research ("ask Atlas to research X"), call delegate_task with targetAgent 'ATLAS'.
In DIRECT mode research_web reads the sources in the background (nothing opens on the user's screen) and returns what they say.

SKILLS. Pick the right tool for each request, and chain several when the job needs it (e.g. "fix this error on my screen": screen look -> read/edit the file -> terminal run to check the fix):
${skillGuide()}

RESULTS ARE REAL. Each tool returns SUCCESS, FAILED, DELEGATED or NEEDS_CONFIRMATION. Only confirm what succeeded. If something FAILED: say what failed and why (the real error), try one safe fix or alternative when it makes sense, then report the actual outcome. Never say it worked when it didn't.`;

  /** open_arcade: opens JARVIS Arcade on this dashboard, launching the named game if it exists. */
  function openArcade(args: Record<string, any>) {
    const name = args.game ? String(args.game) : '';
    const game = name ? findGame(name) : null;
    if (name && !game) {
      const have = listGames().map((g) => g.title);
      clientWs.send(JSON.stringify({ type: 'open_arcade', gameId: null }));
      return { status: 'FAILED', message: `No game called "${name}" yet.${have.length ? ` Built so far: ${[...new Set(have)].join(', ')}.` : ''} Opened the Arcade; offer to have the team build it.` };
    }
    clientWs.send(JSON.stringify({ type: 'open_arcade', gameId: game?.id ?? null }));
    return { status: 'SUCCESS', message: game ? `Launched ${game.title} in JARVIS Arcade.` : 'Opened JARVIS Arcade.' };
  }

  /** JARVIS's delegate_task in this session: one task per turn, routed by the Manager. */
  async function delegateFromSession(args: Record<string, any>, heardText: string) {
    const already = dispatched.get(turn) ?? dispatched.get(turn - 1);
    if (already) {
      return { status: 'ALREADY_ROUTED', taskId: already.taskId, agents: already.agents, message: `NEX already has this with ${already.label}. Just acknowledge it.` };
    }
    if (claimed.has(turn)) return { status: 'ALREADY_ROUTED', message: 'NEX is already dispatching this request. Just acknowledge it.' };
    claimed.add(turn);
    const taskPrompt = String(args.task || heardText || '');
    if (!taskPrompt) return { status: 'FAILED', message: 'No task given.' };
    const apiKey = getActiveApiKey();
    const target = args.targetAgent ? String(args.targetAgent) : undefined;
    const pending = pendingRoute.get(turn) ?? pendingRoute.get(turn - 1);
    const prior = !target && pending ? await pending.catch(() => null) : null;
    const route = target ? undefined : prior && prior.route !== 'DIRECT' ? prior : await managerRoute(taskPrompt, apiKey, { requireAgents: true, context: managerContext() });
    const task = await processMultiAgentTask(taskPrompt, apiKey, target, route);
    const label = route ? routeLabel(route) : `${String(target).toUpperCase()} (solo)`;
    dispatched.set(turn, { taskId: task.id, agents: task.assignees, label });
    return { status: 'DELEGATED', manager: 'NEX', taskId: task.id, route: route?.route ?? 'SOLO', agents: route ? route.assignments.map((a) => a.agentId) : [String(target).toUpperCase()],
      message: `NEX gave this to ${label}. I'm still free to talk.` };
  }

  async function initLiveSession(voiceName: string = defaultVoice, customPrompt: string = defaultPersona) {
    if (isSessionInitializing) return;

    const activeApiKey = getActiveApiKey();
    if (!activeApiKey) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          error: 'No Gemini API key is set up yet. Add yours in API Settings.',
        })
      );
      return;
    }

    isSessionInitializing = true;
    sessionInitFailed = false;
    const gen = ++sessionGen;
    const stale = () => gen !== sessionGen;

    try {
      if (session) {
        try {
          session.close();
        } catch (_) {}
        session = null;
        isSessionReady = false;
      }

      clientWs.send(JSON.stringify({ type: 'status', status: 'CONNECTING_TO_GEMINI' }));

      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              // Settings → Voice (default Achird: warm, friendly adult male).
              prebuiltVoiceConfig: { voiceName: voiceConfig().name || voiceName || 'Achird' },
            },
          },
          systemInstruction: personalizeInstruction((customPrompt || defaultPersona) + PC_CONTROL_NOTE + memoryNote(true) + filesNote() + soulInstruction() + skillsNote() + speechInstruction(voiceConfig(), 'voice') + historyNote(liveHistory)),
          // Barge-in: when the user starts talking JARVIS stops mid-sentence and listens (Settings → Interruption).
          realtimeInputConfig: { activityHandling: voiceConfig().interruption ? ActivityHandling.START_OF_ACTIVITY_INTERRUPTS : ActivityHandling.NO_INTERRUPTION },
          outputAudioTranscription: {},
          // English first (the user's accent must not flip the recogniser into Spanish) + names it should know.
          inputAudioTranscription: { languageCodes: ['en-US'], customVocabulary: userName() ? [...TRANSCRIPTION_VOCABULARY, userName()] : TRANSCRIPTION_VOCABULARY },
          // SKILLS → Plugin Manager decides which tools this session gets (applies from the next START AI).
          // No codeExecution here: the Live voice model rejects it and closes the session (the agents still get it).
          tools: [
            { functionDeclarations: [...jarvisTools, ...osToolDeclarations, ...memoryToolDeclarations, ...fileToolDeclarations, ...skillToolDeclarations()].filter((d) => toolAllowed(String(d.name))) },
          ],
        },
        callbacks: {
          onopen: () => {
            console.log('[Live API] Connected to Gemini 3.8 Live session');
          },
          onmessage: async (message: LiveServerMessage) => {
            if (stale()) return;
            addTokens((message as any).usageMetadata); // Live session token usage for the header counter
            recordContext('voice', LIVE_MODEL, (message as any).usageMetadata); // THINKING → context window
            try {
              // 1. Handle Model Audio & Content Parts
              const modelParts = message.serverContent?.modelTurn?.parts;
              if (modelParts && modelParts.length > 0) {
                for (const part of modelParts) {
                  if (part.inlineData?.data) {
                    clientWs.send(
                      JSON.stringify({
                        type: 'audio',
                        audio: part.inlineData.data,
                      })
                    );
                  }
                  if (part.text) {
                    clientWs.send(
                      JSON.stringify({
                        type: 'model_text',
                        text: part.text,
                      })
                    );
                  }
                }
              }

              // 2. Handle Interruption
              if (message.serverContent?.interrupted) {
                clientWs.send(JSON.stringify({ type: 'interrupted' }));
              }

              // 3. Handle Turn Complete
              if (message.serverContent?.turnComplete) {
                routeHeardTurn();
                if (language.lang === 'en' && looksForeign(jarvisSaid)) tellSession(language.note('drift'));
                else remember('assistant', jarvisSaid);
                jarvisSaid = '';
                languageNoted = false;
                turn++;
                modeListener.endTurn();
                memoryConsent.endTurn();
                clientWs.send(JSON.stringify({ type: 'turn_complete' }));
              }

              // 4. Handle Realtime Transcriptions
              if (message.serverContent?.inputTranscription?.text) {
                heard += message.serverContent.inputTranscription.text;
                heardTurn = turn;
                if (!languageNoted && language.lang === 'en' && language.streak === 0 && looksForeign(heard)) {
                  languageNoted = true;
                  tellSession(language.note('suspect'));
                }
                hearUser(message.serverContent.inputTranscription.text); // "yes" / "no" to a pending confirmation
                modeListener.hear(message.serverContent.inputTranscription.text);
                memoryConsent.hear(message.serverContent.inputTranscription.text);
                clientWs.send(
                  JSON.stringify({
                    type: 'input_transcription',
                    text: message.serverContent.inputTranscription.text,
                    isInterim: false,
                  })
                );
              }
              if (message.serverContent?.interimInputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({
                    type: 'input_transcription',
                    text: message.serverContent.interimInputTranscription.text,
                    isInterim: true,
                  })
                );
              }
              if (message.serverContent?.outputTranscription?.text) {
                routeHeardTurn(); // the user has finished speaking: JARVIS is answering
                jarvisSaid += message.serverContent.outputTranscription.text;
                clientWs.send(
                  JSON.stringify({
                    type: 'output_transcription',
                    text: message.serverContent.outputTranscription.text,
                  })
                );
              }

              // 5. Handle Live Tool Calls
              if (message.toolCall?.functionCalls && message.toolCall.functionCalls.length > 0) {
                const functionResponses: any[] = [];
                const heardNow = heard.trim();
                routeHeardTurn();

                for (const call of message.toolCall.functionCalls) {
                  const callId = call.id || '';
                  const callName = call.name || '';
                  const callArgs = (call.args as Record<string, any>) || {};

                  console.log(`[Tool Call] Executing ${callName}:`, callArgs);
                  // Browser/app actions go through the computer router; the permission gate only
                  // applies when they would act on the user's real PC (DIRECT mode).
                  if (!toolAllowed(callName)) {
                    const result = { status: 'FAILED', message: `${callName} is disabled in SKILLS → Plugin Manager.` };
                    functionResponses.push({ id: callId, name: callName, response: { output: result } });
                    clientWs.send(JSON.stringify({ type: 'tool_call', id: callId, name: callName, args: callArgs, result, activeProtocols }));
                    continue;
                  }
                  // Permissions -> activity log -> the tool -> real result (failures captured, never hidden).
                  const result = await runTool(callName, callArgs, { actor: 'JARVIS', showImage }, async (args) =>
                    isComputerAction(callName) ? routeComputerAction(callName, args, 'JARVIS')
                    : callName === 'set_computer_mode' ? modeListener.confirm(String(args.mode || ''))
                    : memoryToolNames.has(callName) ? executeMemoryTool(callName, args, memoryConsent)
                    : fileToolNames.has(callName) ? executeFileTool(callName, args)
                    : osToolNames.has(callName) ? executeOsTool(callName, args)
                    : callName === 'get_environmental_data' ? getEnvironmentalData(args)
                    : callName === 'get_world_time' ? getWorldTime(args)
                    : callName === 'delegate_task' ? delegateFromSession(args, heardNow)
                    : callName === 'open_arcade' ? openArcade(args)
                    : executeTool(callName, args));

                  functionResponses.push({
                    id: callId,
                    name: callName,
                    response: { output: result },
                  });

                  // Broadcast tool execution to frontend HUD
                  clientWs.send(
                    JSON.stringify({
                      type: 'tool_call',
                      id: callId,
                      name: callName,
                      args: callArgs,
                      result,
                      activeProtocols,
                    })
                  );
                }

                if (session && functionResponses.length > 0) {
                  session.sendToolResponse({
                    functionResponses,
                  });
                }
              }
            } catch (msgErr: any) {
              console.error('[Live API Message Error]:', msgErr);
            }
          },
          onerror: (err: any) => {
            if (stale()) return;
            console.error('[Live API Error]:', err);
            isSessionReady = false;
            isSessionInitializing = false;
            sessionInitFailed = true;
            let formattedError = err?.message || 'Gemini Live API connection encountered an error.';
            try {
              const parsed = JSON.parse(formattedError);
              if (parsed.error?.message) formattedError = parsed.error.message;
            } catch (_) {}
            clientWs.send(
              JSON.stringify({
                type: 'error',
                error: redact(formattedError),
              })
            );
          },
          onclose: (e: any) => {
            if (stale()) return;
            console.log('[Live API Closed]:', e?.reason || 'Connection terminated');
            isSessionReady = false;
            isSessionInitializing = false;
            sessionInitFailed = true;
            clientWs.send(
              JSON.stringify({
                type: 'status',
                status: 'DISCONNECTED',
                reason: e?.reason || 'Session closed',
              })
            );
          },
        },
      });

      if (stale()) {
        session.close();
        return;
      }
      isSessionReady = true;
      isSessionInitializing = false;
      clientWs.send(
        JSON.stringify({
          type: 'status',
          status: 'ONLINE',
          message: 'J.A.R.V.I.S. Live Voice & Multi-Agent Network established.',
          voice: voiceName,
        })
      );
    } catch (connErr: any) {
      console.error('[Live API Connect Failed]:', connErr);
      isSessionReady = false;
      isSessionInitializing = false;
      sessionInitFailed = true;
      clientWs.send(
        JSON.stringify({
          type: 'error',
          error: redact(connErr?.message || 'Failed to establish connection to Gemini 3.8 Live API.'),
        })
      );
    }
  }

  clientWs.on('message', async (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'init') {
        sessionInitFailed = false;
        liveHistory = msg.history ?? null;
        if (Array.isArray(msg.history)) for (const h of msg.history.slice(-12)) if (!looksForeign(String(h?.content ?? ''))) remember(h?.role === 'assistant' ? 'assistant' : 'user', String(h?.content ?? ''));
        await initLiveSession(msg.voice, msg.systemInstruction);
        return;
      }

      if (!isSessionReady) {
        if (!sessionInitFailed && !isSessionInitializing) {
          if (msg.type === 'text') {
            await initLiveSession();
          }
        }
      }

      if (msg.type === 'audio' && msg.audio) {
        session?.sendRealtimeInput({
          audio: {
            data: msg.audio,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } else if (msg.type === 'video' && msg.video) {
        session?.sendRealtimeInput({
          video: {
            data: msg.video,
            mimeType: 'image/jpeg',
          },
        });
      } else if (msg.type === 'text' && msg.text) {
        const typed = String(msg.text);
        mood.hear(typed);
        remember('user', typed);
        hearUser(typed);
        modeListener.hearTyped(typed);
        memoryConsent.hearTyped(typed);
        const lang = language.hear(typed); // typed text is never mis-heard, but two Spanish messages in a row is a real switch
        if (lang.switched) tellSession(language.note('switched'));
        // JARVIS gets the message at once; NEX routes it in parallel (mode commands always stay with JARVIS).
        session?.sendRealtimeInput({ text: `${msg.text}\n${cue()}` });
        if (!parseModeCommand(typed) && !dispatched.has(turn) && !claimed.has(turn)) routeInBackground(typed, turn, 'typed');
      } else if (msg.type === 'ping') {
        clientWs.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch (err: any) {
      console.error('[Client WS Message Error]:', err);
    }
  });

  clientWs.on('close', () => {
    console.log('[Live WS] Client disconnected');
    offFiles();
    offTaskEvents();
    liveSinks.delete(sink);
    if (arrivedTimer) clearTimeout(arrivedTimer);
    if (session) {
      try {
        session.close();
      } catch (_) {}
      session = null;
      isSessionReady = false;
    }
  });
});

// Mount Vite or static build
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite'); // dev only: the desktop build serves dist/
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`[J.A.R.V.I.S. Core & Multi-Agent Engine] Operational on http://localhost:${PORT} and http://127.0.0.1:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server boot error:', err);
});
