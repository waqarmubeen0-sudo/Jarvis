// J.A.R.V.I.S.-led multi-agent ecosystem.
//
//  - Every user prompt passes through the Manager (NEX) first: one lightweight LLM call decides
//    DIRECT (JARVIS answers himself), SOLO (one specialist) or TASK_FORCE (2-4 specialists at once).
//  - NEX never does the ground work. It monitors every task and reports progress
//    (% done, % left, blockers) back to JARVIS in real time.
//  - Specialists: CODE, GAME, WRITE, PROMPT, SEC, SOCIAL, ATLAS (research).
//  - Web research goes through the computer router: Orbit browser in ORBIT mode, background reads in DIRECT.
//
// Agent modes:
//   ROAMING  idle, free to roam / chat / optimise (Agent Town idle life)
//   OFFICE   solo task: locked to that task until its part is 100% complete, no unrelated work
//   HELPING  hit a bottleneck: consults a sister agent (without leaving its room), then continues
//   SWARM    task force: 2-4 agents share one room and work concurrently until the task completes
//   (paused) JARVIS can pause any agent or task; it resumes where it stopped.

import { agentResearch, getMode } from './computer';
import { textModel, routerModel, temperatureConfig, tracked, agentInstruction, skills, agentCallGapMs, personalizeInstruction, activeProvider } from './apiSettings';
import { generate } from './generate';
import { wantsGame, libraryMatch, libraryHtml, gamePrompt, extractHtml, validateGameHtml, htmlTitle, saveGame } from './gameBuilder';
import { testHtml, reportText, failures, type TestReport } from './runtimeTest';
import { wantsProject, buildProject } from './builder';
import { logActivity } from './activity';
import path from 'node:path';

export type AgentMode = 'ROAMING' | 'OFFICE' | 'HELPING' | 'SWARM';

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  badge: string;
  color: string; // Tailwind color class
  description: string;
  systemPrompt: string;
  status: 'IDLE' | 'THINKING' | 'WORKING' | 'COMPLETED' | 'FAILED';
  currentTask?: string;
  mode: AgentMode;
  paused: boolean;
  taskId?: string; // task this agent is locked to (OFFICE / SWARM / HELPING)
  helpTarget?: string; // sister agent being consulted while HELPING
}

export interface TaskStep {
  id: string;
  agentId: string;
  agentName: string;
  instruction: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  helpedBy?: string;
  reviewedBy?: string;
  research?: string; // web research query this step needs (run in Orbit when in ORBIT mode)
}

export interface MultiAgentTask {
  id: string;
  title: string;
  userPrompt: string;
  assignedBy: string; // 'JARVIS'
  orchestrator: string; // 'NEX' (Project Manager)
  status: 'QUEUED' | 'DECOMPOSING' | 'IN_PROGRESS' | 'VERIFYING' | 'COMPLETED' | 'FAILED';
  mode: 'STANDARD' | 'SWARM'; // STANDARD = SOLO route, SWARM = TASK_FORCE route
  route: 'SOLO' | 'TASK_FORCE';
  routeReason?: string;
  assignees: string[];
  steps: TaskStep[];
  blockers: string[];
  paused: boolean;
  finalResult?: string;
  /** What the task produced, when it is more than text (e.g. a playable game in JARVIS Arcade). */
  artifact?: { type: 'game'; id: string; title: string; source: 'generated' | 'library' } | { type: 'project'; path: string; entry: string; kind: string; title: string };
  createdAt: string;
  completedAt?: string;
  retryCount: number;
}

export interface AgentEventLog {
  id: string;
  timestamp: string;
  taskId: string;
  fromAgent: string;
  toAgent: string;
  message: string;
  type: 'DELEGATION' | 'EXECUTION' | 'RESULT' | 'ERROR' | 'VERIFICATION' | 'HELP' | 'SWARM' | 'REPORT' | 'CONTROL';
}

export interface ManagerReport {
  taskId: string;
  title: string;
  status: MultiAgentTask['status'];
  mode: MultiAgentTask['mode'];
  paused: boolean;
  percentComplete: number;
  percentRemaining: number;
  stepsDone: number;
  stepsTotal: number;
  agents: { id: string; mode: AgentMode; paused: boolean; activity: string }[];
  blockers: string[];
}

const agent = (id: string, role: string, badge: string, color: string, description: string, prompt: string, secondary: string): AgentInfo => ({
  id, name: id, role, badge, color, description, status: 'IDLE', mode: 'ROAMING', paused: false,
  systemPrompt: `You are ${id}, the ${role} of the J.A.R.V.I.S. multi-agent team. ${prompt}
Your master specialty is ${role.replace(/ Specialist$/, '').toLowerCase()}, and that is where you lead. You are also multi-talented: you can work in a secondary capacity (${secondary}) when the Manager puts you on a task force or a teammate needs support. When you work outside your specialty, keep to the part you were given, do it properly, and say briefly which parts a specialist should double-check.`,
});

export const MANAGER = 'NEX';
export const SPECIALISTS = ['CODE', 'GAME', 'WRITE', 'PROMPT', 'SEC', 'SOCIAL', 'ATLAS'] as const;

export const AGENT_REGISTRY: Record<string, AgentInfo> = {
  NEX: agent('NEX', 'Project Manager', 'MANAGER', 'amber',
    'Monitors every specialist and reports progress, remaining work and blockers to JARVIS. Does not do the ground work.',
    'You are the Manager: every request reaches you first and you route it to the right specialist or task force. You monitor the team and write concise, factual status reports and final summaries for JARVIS. You never do specialist work yourself.',
    'routing, planning, progress tracking and merging a task force\'s results into one report'),
  CODE: agent('CODE', 'Code Generation Specialist', 'CODE GEN', 'cyan',
    'Writes, refactors and explains production-quality code in any language.',
    'You write clean, correct, well-structured code with brief explanations.',
    'technical documentation, reviewing code for security issues, automation scripts and prompt tooling'),
  GAME: agent('GAME', 'Game Development Specialist', 'GAME DEV', 'rose',
    'Designs game mechanics, gameplay loops and game code for engines such as Unity, Godot, Unreal and the web.',
    'You design gameplay systems and write game code, balancing fun, performance and scope.',
    'general programming, interactive UI, storytelling and launch or community content'),
  WRITE: agent('WRITE', 'Document Writing Specialist', 'DOCS', 'emerald',
    'Drafts documentation, reports, emails, proposals and long-form text.',
    'You write clear, well-organised documents in the tone the task requires. This includes emails, docs, reports and proposals.',
    'social media copy, prompt writing, research summaries and user-facing text for code or games'),
  PROMPT: agent('PROMPT', 'Prompt Engineering Specialist', 'PROMPTS', 'indigo',
    'Designs, tests and refines prompts and instructions for AI models.',
    'You craft precise, robust prompts and explain why they work.',
    'writing and editing, AI workflow design, reviewing reasoning, and light scripting'),
  SEC: agent('SEC', 'Cyber Security Specialist', 'CYBERSEC', 'red',
    'Reviews code and configurations for vulnerabilities and recommends defensive hardening.',
    'You find security weaknesses and recommend concrete defensive fixes and best practices.',
    'code review, secure configuration and infrastructure advice, privacy wording and policy documents'),
  SOCIAL: agent('SOCIAL', 'Social Media Management Specialist', 'SOCIAL', 'purple',
    'Plans content calendars, writes posts and captions, and shapes engagement strategy.',
    'You plan and write engaging social media content tailored to each platform.',
    'copywriting, audience and trend research, community messaging and campaign planning for launches'),
  ATLAS: agent('ATLAS', 'Research Specialist', 'RESEARCH', 'blue',
    'Researches topics on the web from the Orbit private computer and turns sources into clear findings.',
    'You research topics and report accurate findings with their sources. When web sources are provided in your context, base your answer on them and cite them (title + URL). Never cite a source you were not given; if none were provided, say the facts are from your own knowledge.',
    'fact-checking teammates\' work, competitive analysis, summarising documents and data for writers and coders'),
};

/** Default sister agents to ping when a specialist hits a bottleneck (first free one wins). */
const SISTER: Record<string, string[]> = {
  CODE: ['SEC', 'GAME', 'PROMPT'],
  GAME: ['CODE', 'WRITE'],
  WRITE: ['PROMPT', 'SOCIAL'],
  PROMPT: ['WRITE', 'CODE'],
  SEC: ['CODE'],
  SOCIAL: ['WRITE', 'PROMPT'],
  ATLAS: ['WRITE', 'PROMPT'],
};

// ---------------------------------------------------------------------------------------------
// State, events, model access

export const activeTasks: MultiAgentTask[] = [];
export const agentLogs: AgentEventLog[] = [];
type EventCallback = (type: string, payload: any) => void;
const eventListeners: EventCallback[] = [];
const taskRuns = new Map<string, Promise<void>>();

export function subscribeAgentEvents(cb: EventCallback) {
  eventListeners.push(cb);
  return () => { const i = eventListeners.indexOf(cb); if (i >= 0) eventListeners.splice(i, 1); };
}

/** Resolves when a task has fully finished (used by the self-check). */
export const taskFinished = (taskId: string) => taskRuns.get(taskId);

function broadcastEvent(type: string, payload: any) {
  for (const cb of eventListeners) {
    try { cb(type, payload); } catch (_) {}
  }
}

function logAgentEvent(taskId: string, fromAgent: string, toAgent: string, message: string, type: AgentEventLog['type']) {
  const event: AgentEventLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toLocaleTimeString(),
    taskId, fromAgent, toAgent, message, type,
  };
  agentLogs.unshift(event);
  if (agentLogs.length > 100) agentLogs.pop();
  broadcastEvent('agent_log', event);
}

function setAgent(id: string, patch: Partial<AgentInfo>) {
  const a = AGENT_REGISTRY[id];
  if (!a) return;
  Object.assign(a, patch);
  broadcastEvent('agent_status_change', { agentId: id, status: a.status, currentTask: a.currentTask, mode: a.mode, paused: a.paused });
}

type Contents = { role: string; parts: { text: string }[] }[];
interface ModelOpts { model?: string; json?: boolean; tools?: any[] }
type ModelFn = (systemInstruction: string, contents: Contents, apiKey: string, opts?: ModelOpts) => Promise<string>;
/** The Manager's routing call uses the lightweight model; it falls back to the chosen text model if unavailable. */
// Agent work on the chosen provider/model; on Gemini, lighter models take over when it is out of quota or overloaded.
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
let model: ModelFn = async (systemInstruction, contents, _apiKey, opts) => {
  // generate() picks the provider chosen in API Settings and uses its stored key.
  const turns = contents.map((c) => ({ role: c.role === 'model' ? 'model' as const : 'user' as const, text: c.parts.map((p) => p.text).join('\n') }));
  const base = { system: personalizeInstruction(systemInstruction), json: opts?.json, ...(opts?.json ? { temperature: 0 } : {}) };
  if (activeProvider() !== 'gemini') return generate(turns, base);
  const chain = opts?.model ? [opts.model] : [...new Set([textModel(), ...FALLBACK_MODELS])];
  let lastErr: unknown;
  for (const [i, name] of chain.entries()) {
    try {
      const text = await generate(turns, { ...base, model: name, geminiTools: opts?.tools });
      if (i > 0) console.warn(`[Agents] ${chain[0]} unavailable; this call used ${name}`);
      return text;
    } catch (err) {
      lastErr = err;
      if (!/\b429\b|RESOURCE_EXHAUSTED|quota|\b503\b|UNAVAILABLE|overloaded/i.test(String((err as any)?.message ?? err))) throw err;
    }
  }
  throw lastErr;
};
/** Swap the model call (used by the self-check to run the workflow offline). */
export function setAgentModel(fn: ModelFn) { model = fn; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Infrastructure failures (quota, rate limit, outage, network) - no colleague can fix these. */
class ServiceError extends Error {}
function asServiceError(err: any): Error {
  const text = String(err?.message ?? err);
  if (/\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(text)) return new ServiceError('Gemini API quota exceeded - check the API plan/billing, then retry.');
  if (/\b50[0-4]\b|UNAVAILABLE|fetch failed|ECONN|ETIMEDOUT|network/i.test(text)) return new ServiceError('Gemini API unavailable (network or service outage) - retry shortly.');
  return err instanceof Error ? err : new Error(text);
}

/** Blocks while JARVIS has paused this agent or task. */
async function holdIfPaused(agentId: string, task: MultiAgentTask) {
  let noted = false;
  while (AGENT_REGISTRY[agentId]?.paused || task.paused) {
    if (!noted) { noted = true; report(task, `${agentId} is paused by JARVIS`); }
    await sleep(300);
  }
}

/**
 * Rate limiting: agent API calls start at least `delaySec` apart (Settings → Quota), so the
 * concurrent members of a task force are staggered instead of hitting the API in one burst.
 */
let nextSlot = 0;
let gapOverride: number | null = null;
/** Override the stagger gap in ms (used by the self-check); null = use the Settings value. */
export function setCallGap(ms: number | null) { gapOverride = ms; }
async function agentSlot() {
  const gap = gapOverride ?? agentCallGapMs();
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gap;
  if (at > now) await sleep(at - now);
}

/** Gemini's suggested wait in a 429 error ("Please retry in 37.2s" / "retryDelay": "37s"), if any. */
export function retryHintMs(err: any): number | null {
  const text = String(err?.message ?? err);
  if (!/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(text)) return null;
  const m = text.match(/retry in ([\d.]+)\s*s/i) ?? text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  return m ? Math.round(parseFloat(m[1]) * 1000) : null;
}

/** Waits before retrying a transient Gemini error (rate limit, overload, network). */
let retryDelays = [2000, 5000];
/** Shorten the retry waits (used by the self-check). */
export function setRetryDelays(ms: number[]) { retryDelays = ms; }

async function queryAgent(agentId: string, prompt: string, apiKey: string, context?: string): Promise<string> {
  const a = AGENT_REGISTRY[agentId];
  if (!a) throw new Error(`Unknown agent: ${agentId}`);
  setAgent(agentId, { status: 'THINKING', currentTask: prompt.substring(0, 80) });
  const contents: Contents = [];
  if (context) {
    contents.push({ role: 'user', parts: [{ text: `[BACKGROUND CONTEXT & PREVIOUS STEPS]\n${context}` }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood. I will use this background context.' }] });
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });
  for (let attempt = 0; ; attempt++) {
    try {
      await agentSlot();
      setAgent(agentId, { status: 'WORKING' });
      const tools = skills().codeExecution ? [{ codeExecution: {} }] : undefined; // SKILLS → Code Execution
      const text = (await model(`${a.systemPrompt}${agentInstruction(agentId)}\n\nBe accurate and concise. Format responses in clean markdown.`, contents, apiKey, { tools })) ||
        `[${a.name}] Completed with no verbal output.`;
      setAgent(agentId, { status: 'IDLE' });
      return text;
    } catch (err: any) {
      const e = asServiceError(err);
      console.warn(`[Agents] ${agentId} model call failed (attempt ${attempt + 1}): ${String(err?.message ?? err).substring(0, 240)}`);
      if (e instanceof ServiceError && attempt < retryDelays.length) {
        // Transient: the agent stays at its post (still locked) and tries again. A 429 usually says
        // how long the per-minute quota needs ("retry in 37s"); wait that long (up to a minute).
        const hint = retryHintMs(err);
        const wait = hint !== null && retryDelays[attempt] >= 1000 ? Math.min(hint + 500, 60_000) : retryDelays[attempt];
        setAgent(agentId, { status: 'THINKING', currentTask: `Retrying in ${Math.round(wait / 1000)}s after: ${e.message}` });
        await sleep(wait);
        continue;
      }
      setAgent(agentId, { status: 'FAILED', currentTask: e.message });
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Office locks: an agent belongs to at most one task at a time. A task waits until ALL of its
// agents are free and then locks them together (all-or-nothing, so tasks can never deadlock).

const lockedBy = new Map<string, string>(); // agentId -> taskId
let lockWaiters: (() => void)[] = [];
const wakeLockWaiters = () => { const w = lockWaiters; lockWaiters = []; w.forEach((f) => f()); };

async function acquireAll(task: MultiAgentTask) {
  for (;;) {
    const busy = task.assignees.filter((id) => lockedBy.has(id) && lockedBy.get(id) !== task.id);
    if (!busy.length) break;
    task.blockers = busy.map((id) => `${id} is in Office Mode on another task`);
    report(task, `Waiting for ${busy.join(', ')} to finish their current assignment`);
    await new Promise<void>((r) => lockWaiters.push(r));
  }
  task.blockers = [];
  const mode: AgentMode = task.mode === 'SWARM' ? 'SWARM' : 'OFFICE';
  for (const id of task.assignees) {
    lockedBy.set(id, task.id);
    setAgent(id, { mode, taskId: task.id, currentTask: task.title });
  }
}

function release(id: string, task: MultiAgentTask) {
  if (lockedBy.get(id) !== task.id) return;
  lockedBy.delete(id);
  setAgent(id, { mode: 'ROAMING', taskId: undefined, helpTarget: undefined, status: 'COMPLETED', currentTask: undefined });
  wakeLockWaiters();
}

/** True when the agent is locked to a task (Office / Swarm / Helping). */
export const isLocked = (agentId: string) => lockedBy.has(agentId);

// ---------------------------------------------------------------------------------------------
// Manager (NEX): real-time progress reporting to JARVIS

export function managerReport(task: MultiAgentTask): ManagerReport {
  const total = task.steps.length || 1;
  const done = task.steps.filter((s) => s.status === 'COMPLETED' || s.status === 'FAILED').length;
  const running = task.steps.some((s) => s.status === 'RUNNING') ? 0.5 : 0;
  // Steps are 90% of the job; the Manager's final verification/report is the last 10%.
  const pct = task.status === 'COMPLETED' || task.status === 'FAILED' ? 100
    : task.status === 'VERIFYING' ? 95
    : Math.round(((done + running) / total) * 90);
  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    mode: task.mode,
    paused: task.paused,
    percentComplete: pct,
    percentRemaining: 100 - pct,
    stepsDone: done,
    stepsTotal: task.steps.length,
    agents: task.assignees.map((id) => {
      const a = AGENT_REGISTRY[id];
      const step = task.steps.find((s) => s.agentId === id && s.status === 'RUNNING');
      return {
        id, mode: a.mode, paused: a.paused,
        activity: a.helpTarget ? `consulting ${a.helpTarget}` : step ? `working: ${step.instruction.substring(0, 60)}` : lockedBy.get(id) === task.id ? 'in office, standing by' : 'released',
      };
    }),
    blockers: [...task.blockers, ...task.steps.filter((s) => s.status === 'FAILED').map((s) => `${s.agentId} step failed: ${s.error}`)],
  };
}

function report(task: MultiAgentTask, note: string) {
  const r = managerReport(task);
  broadcastEvent('manager_report', r);
  broadcastEvent('task_updated', task);
  const blockers = r.blockers.length ? ` · Blockers: ${r.blockers.join('; ')}` : ' · No blockers';
  logAgentEvent(task.id, MANAGER, 'JARVIS', `${note} — ${r.percentComplete}% complete, ${r.percentRemaining}% left (${r.stepsDone}/${r.stepsTotal} steps)${blockers}`, 'REPORT');
}

function refreshManager() {
  const open = activeTasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'FAILED');
  setAgent(MANAGER, open.length
    ? { mode: 'OFFICE', status: 'WORKING', currentTask: `Monitoring ${open.length} task(s)` }
    : { mode: 'ROAMING', status: 'IDLE', currentTask: undefined });
}

/** Everything JARVIS can see: every agent, every open task report, recent inter-agent traffic. */
export function teamTelemetry() {
  return {
    manager: MANAGER,
    agents: Object.values(AGENT_REGISTRY).map((a) => ({
      id: a.id, role: a.role, mode: a.mode, paused: a.paused, status: a.status, taskId: a.taskId, helpTarget: a.helpTarget, currentTask: a.currentTask,
    })),
    tasks: activeTasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'FAILED').map(managerReport),
    recentComms: agentLogs.slice(0, 12).map((l) => `${l.timestamp} ${l.fromAgent}->${l.toAgent}: ${l.message}`),
  };
}

// ---------------------------------------------------------------------------------------------
// JARVIS overrides

export function controlAgents(args: { action: string; agentId?: string; taskId?: string; toAgent?: string }): { status: string; message: string } {
  const action = String(args.action || '').toLowerCase();
  const id = args.agentId?.toUpperCase();
  const to = args.toAgent?.toUpperCase();
  const task = args.taskId ? activeTasks.find((t) => t.id === args.taskId) : undefined;
  const fail = (message: string) => ({ status: 'FAILED', message });

  if (action === 'pause' || action === 'resume') {
    const paused = action === 'pause';
    if (task) { task.paused = paused; report(task, `JARVIS ${paused ? 'paused' : 'resumed'} the task`); }
    else if (id && AGENT_REGISTRY[id]) setAgent(id, { paused });
    else return fail('Give an agentId or taskId to pause/resume.');
    const what = task ? `task "${task.title}"` : id!;
    logAgentEvent(task?.id ?? 'system', 'JARVIS', task ? MANAGER : id!, `${paused ? 'Paused' : 'Resumed'} ${what}`, 'CONTROL');
    return { status: 'SUCCESS', message: `${paused ? 'Paused' : 'Resumed'} ${what}.` };
  }

  if (action === 'reroute') {
    if (!id || !to || !AGENT_REGISTRY[to] || to === MANAGER) return fail('Reroute needs agentId (from) and a specialist toAgent.');
    const t = task ?? activeTasks.find((x) => x.status !== 'COMPLETED' && x.status !== 'FAILED' && x.steps.some((s) => s.agentId === id && s.status === 'PENDING'));
    if (!t) return fail(`${id} has no pending work to reroute.`);
    if (lockedBy.has(to) && lockedBy.get(to) !== t.id) return fail(`${to} is in Office Mode on another task.`);
    const moved = t.steps.filter((s) => s.agentId === id && s.status === 'PENDING');
    if (!moved.length) return fail(`${id} has no pending steps in "${t.title}".`);
    moved.forEach((s) => { s.agentId = to; s.agentName = to; });
    if (!t.assignees.includes(to)) t.assignees.push(to);
    if (t.status !== 'QUEUED' && t.status !== 'DECOMPOSING') {
      lockedBy.set(to, t.id);
      setAgent(to, { mode: t.mode === 'SWARM' ? 'SWARM' : 'OFFICE', taskId: t.id, currentTask: t.title });
    }
    const stillBusy = t.steps.some((s) => s.agentId === id && s.status === 'RUNNING');
    if (!stillBusy && t.mode !== 'SWARM') {
      t.assignees = t.assignees.filter((a) => a !== id);
      release(id, t);
    }
    logAgentEvent(t.id, 'JARVIS', to, `Re-routed ${moved.length} step(s) from ${id} to ${to}`, 'CONTROL');
    report(t, `JARVIS re-routed work from ${id} to ${to}`);
    return { status: 'SUCCESS', message: `Moved ${moved.length} step(s) of "${t.title}" from ${id} to ${to}.` };
  }
  return fail(`Unknown action '${action}'. Use pause, resume or reroute.`);
}

// ---------------------------------------------------------------------------------------------
// Assignment (JARVIS) and execution

// ---------------------------------------------------------------------------------------------
// The Manager: every user prompt is routed here first.

export type RouteKind = 'DIRECT' | 'SOLO' | 'TASK_FORCE';
export interface RouteAssignment { agentId: string; instruction: string; research?: string }
export interface ManagerRoute { route: RouteKind; assignments: RouteAssignment[]; reason: string }

const isSpecialist = (id: string) => (SPECIALISTS as readonly string[]).includes(id);

/** Keyword fallback when the Manager's call fails but work must still go to someone. */
function fallbackAgent(prompt: string): string {
  const hints: [RegExp, string][] = [
    [/\b(game|unity|godot|unreal|level design|sprite)\b/i, 'GAME'],
    [/\b(secur|vulnerab|pentest|exploit|harden|firewall|encrypt|password policy)\w*/i, 'SEC'],
    [/\b(instagram|tiktok|twitter|tweet|linkedin|facebook|youtube channel|social|caption|hashtag|post)\w*/i, 'SOCIAL'],
    [/\b(prompt|system instruction|llm|chatgpt|gemini)\w*/i, 'PROMPT'],
    [/\b(research|find out|latest|compare|look up|sources)\b/i, 'ATLAS'],
    [/\b(code|bug|debug|function|script|api|typescript|python|javascript|react|sql|refactor)\w*/i, 'CODE'],
  ];
  return hints.find(([re]) => re.test(prompt))?.[1] ?? 'WRITE';
}

/** Validates the Manager's JSON strictly: known specialists only, SOLO = exactly 1, TASK_FORCE = 2-4 distinct. */
export function parseManagerRoute(raw: string, userPrompt: string, requireAgents = false): ManagerRoute {
  let j: any = null;
  const text = String(raw ?? '').replace(/```json|```/g, '').trim();
  try { j = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } }
  }
  const norm = (x: any): RouteAssignment | null => {
    const id = String(x?.agentId ?? x?.agent ?? x?.id ?? '').toUpperCase();
    if (!isSpecialist(id)) return null;
    const instruction = String(x?.instruction ?? '').trim() || userPrompt;
    return { agentId: id, instruction, research: x?.research ? String(x.research) : undefined };
  };
  const reason = String(j?.reason ?? '').slice(0, 240);
  const kind = String(j?.route ?? '').toUpperCase().replace(/[\s-]/g, '_');
  const force: RouteAssignment[] = [];
  for (const x of Array.isArray(j?.taskForce) ? j.taskForce : Array.isArray(j) ? j : []) {
    const a = norm(x);
    if (a && !force.some((f) => f.agentId === a.agentId)) force.push(a);
  }
  const solo = norm(j?.agent) ?? force[0] ?? null;
  if ((kind === 'TASK_FORCE' || (Array.isArray(j) && !kind)) && force.length >= 2) return { route: 'TASK_FORCE', assignments: force.slice(0, 4), reason };
  if ((kind === 'SOLO' || kind === 'TASK_FORCE') && solo) return { route: 'SOLO', assignments: [solo], reason };
  if (kind === 'DIRECT' && !requireAgents) return { route: 'DIRECT', assignments: [], reason };
  if (requireAgents) return { route: 'SOLO', assignments: [{ agentId: fallbackAgent(userPrompt), instruction: userPrompt }], reason: reason || 'Manager fallback: keyword match' };
  return { route: 'DIRECT', assignments: [], reason: reason || 'Manager could not decide; JARVIS answers directly' };
}

/**
 * Requests that are certainly for JARVIS himself (talk, PC/browser control, email, screen,
 * reminders, modes). Anything that also asks for real work (build, write, research...) goes to NEX.
 */
const SMALL_TALK = /^\W*(?:(?:hey|hi|ok(?:ay)?|yo)\W+)?(?:jarvis\W*)?(?:hi|hello|hey|thanks?(?: you)?|thank you|good (?:morning|afternoon|evening|night)|how are you(?: doing)?(?: today)?|what'?s up|how'?s it going|yes|yeah|yep|no|nope|ok(?:ay)?|sure|cool|nice|great|never ?mind|stop|wait|tell me (?:a |another )?(?:short |quick |funny |good )?(?:joke|something funny)|make me laugh|i'?m (?:tired|bored|stressed|back|good|fine))\b[\w\s,'!?.]{0,40}$/i;
const PC_COMMAND = /^\W*(?:(?:hey|ok(?:ay)?)\W+)?(?:jarvis\W*)?(?:please\s+)?(?:can you\s+|could you\s+)?(?:open|close|launch|start|quit|switch to|go to|minimi[sz]e|maximi[sz]e|play|pause|resume|skip|next|mute|unmute|turn (?:up|down)|volume|lock|scroll|click|type|press|copy|paste|take a screenshot|look at my screen|what'?s on (?:my|the) screen|read (?:my|the) (?:screen|email|emails)|check (?:my )?(?:email|emails|inbox|mail)|remind me|set (?:a )?(?:reminder|timer|alarm)|cancel (?:the |my )?reminder|search (?:youtube|google|the web) for|what time is it|what'?s the (?:time|weather)|(?:direct|orbit) mode)\b/i;
const REAL_WORK = /\b(build|create|make|write|develop|design|generate|(?:code|program) (?:a|an|me|up|the)|research|analy[sz]e|review|refactor|debug|fix the code|draft a (?:post|document|report)|plan (?:a|my|the)|compare|summari[sz]e the (?:document|file|report))\b/i;
export const quickDirect = (prompt: string) => {
  const p = String(prompt).trim();
  return p.length <= 160 && !REAL_WORK.test(p) && (SMALL_TALK.test(p) || PC_COMMAND.test(p));
};

const MANAGER_SYSTEM ='You are NEX, the Manager of the J.A.R.V.I.S. agent team. Every request the user sends to JARVIS reaches you first, and you decide who handles it. Output raw JSON only.';

/**
 * The Manager's routing decision for one user prompt (one lightweight LLM call).
 * requireAgents: the prompt is already known to be work for the team (delegate_task, Agent Town
 * dispatch), so DIRECT is not an option.
 */
export async function managerRoute(userPrompt: string, apiKey: string, opts: { requireAgents?: boolean; context?: string } = {}): Promise<ManagerRoute> {
  // Obvious JARVIS-only turns skip the LLM call entirely (it took 4-10 s and burned quota).
  if (!opts.requireAgents && quickDirect(userPrompt)) {
    const route: ManagerRoute = { route: 'DIRECT', assignments: [], reason: 'instant: an obvious request for JARVIS himself' };
    broadcastEvent('manager_route', { prompt: userPrompt, route: route.route, agents: [], reason: route.reason });
    return route;
  }
  const team = SPECIALISTS.map((id) => `- ${id}: ${AGENT_REGISTRY[id].role}. ${AGENT_REGISTRY[id].description}`).join('\n');
  const prompt = `Request: ${JSON.stringify(userPrompt)}${opts.context ? `\nSession context: ${opts.context}` : ''}

Specialists (each has a master specialty, and every one is multi-talented and can help outside it):
${team}

Choose exactly one route:
${opts.requireAgents ? '' : `- "DIRECT": JARVIS answers himself, no specialist. Use for conversation and greetings, quick questions he can answer in a sentence or two, controlling the PC or apps (open, close, switch windows, click, type, play, volume, files, lock, shutdown), browser actions (open a site, search YouTube/Google, click, read a page), email (check, read, summarise, draft, reply, send), looking at the screen ("what's on my screen", "what does this error say", "click the right button"), reminders and schedules ("remind me tomorrow", "every Monday..."), running terminal commands, opening/running/testing an existing project or game, quick web research questions, switching Direct/Orbit mode, memory requests, asking about or pausing/resuming the team, and anything about files already in this session. Also DIRECT: venting, feelings, jokes, opinions and "I need help with something" BEFORE they have said what the work is (e.g. "this code is driving me crazy" — JARVIS talks it through and asks what's wrong; only route once there is a concrete task).
`}- "SOLO": a standard task one specialist can do well alone. Pick the single most relevant specialist. Building NEW software (a webpage, website, web app, script, tool or utility) is SOLO for CODE; creating a NEW game is SOLO for GAME (they build, run and test it for real).
- "TASK_FORCE": a complex or multi-disciplinary task that genuinely needs 2 to 4 specialists working on it at the same time. Give each one a distinct part of the work.
If an assignment needs current information from the web, add a "research" search query to it.

Reply with one JSON object in one of these shapes:
{"route":"DIRECT","reason":"..."}
{"route":"SOLO","reason":"...","agent":{"agentId":"CODE","instruction":"..."}}
{"route":"TASK_FORCE","reason":"...","taskForce":[{"agentId":"CODE","instruction":"..."},{"agentId":"SEC","instruction":"...","research":"optional"}]}`;
  const contents: Contents = [{ role: 'user', parts: [{ text: prompt }] }];
  let raw = '';
  try {
    raw = await model(MANAGER_SYSTEM, contents, apiKey, { model: routerModel(), json: true });
  } catch (err) {
    try { raw = await model(MANAGER_SYSTEM, contents, apiKey, { json: true }); } // lightweight model unavailable: use the main one
    catch (err2) { console.warn('[Manager] routing failed:', (err2 as Error).message); }
  }
  const route = parseManagerRoute(raw, userPrompt, opts.requireAgents);
  logAgentEvent('system', MANAGER, route.route === 'DIRECT' ? 'JARVIS' : route.assignments.map((a) => a.agentId).join(', '),
    `Routed "${userPrompt.substring(0, 80)}" → ${route.route === 'DIRECT' ? 'JARVIS (direct)' : route.route === 'SOLO' ? `${route.assignments[0].agentId} (solo)` : `task force ${route.assignments.map((a) => a.agentId).join(' + ')}`}${route.reason ? ` · ${route.reason}` : ''}`,
    'DELEGATION');
  broadcastEvent('manager_route', { prompt: userPrompt, route: route.route, agents: route.assignments.map((a) => a.agentId), reason: route.reason });
  return route;
}

// ---------------------------------------------------------------------------------------------
// Game creation: a game request produces a real, playable game in JARVIS Arcade (gameBuilder.ts).

/** This step is the one that builds the game (the GAME specialist, or the only step of the task). */
const isGameStep = (task: MultiAgentTask, step: TaskStep) =>
  wantsGame(task.userPrompt) && (step.agentId === 'GAME' || task.steps.length === 1 || !task.steps.some((s) => s.agentId === 'GAME'));

/** Writes to the agent log (Mission Queue / System Logs) and the JARVIS activity log at once. */
function buildLog(task: MultiAgentTask, step: TaskStep) {
  return (kind: 'ACTION' | 'RESULT' | 'ERROR' | 'VERIFICATION', text: string) => {
    logAgentEvent(task.id, step.agentId, MANAGER, text, kind === 'ACTION' ? 'EXECUTION' : kind === 'ERROR' ? 'ERROR' : kind === 'RESULT' ? 'RESULT' : 'VERIFICATION');
    if (kind !== 'VERIFICATION') logActivity(kind, text, { actor: step.agentId });
  };
}

async function buildGameStep(task: MultiAgentTask, step: TaskStep, apiKey: string): Promise<string> {
  const request = task.userPrompt;
  const lib = libraryMatch(request);
  const log = buildLog(task, step);
  const name = lib?.title ?? 'game';
  const test = async (html: string, label: string) => {
    log('ACTION', `Started ${label} in the test browser`);
    const r = await testHtml(html, request);
    log('VERIFICATION', reportText(r));
    if (r.ok) log('RESULT', `${label[0].toUpperCase()}${label.slice(1)}: game test successful`);
    else log('ERROR', `Detected problems in ${label}: ${failures(r).join('; ').slice(0, 300)}`);
    return r;
  };
  const verified = (r: TestReport) => r.checks.filter((c) => c.ok && c.name !== 'Game loads').map((c) => c.name.toLowerCase()).join(', ');
  const fromLibrary = async (why: string) => {
    const html = libraryHtml(lib!.id);
    const r = await test(html, `${lib!.title} (offline library)`);
    if (!r.ok) throw new Error(`The library ${lib!.title} failed its runtime test too: ${failures(r).join('; ')}`);
    const rec = saveGame(html, { title: lib!.title, prompt: request, agent: step.agentId, source: 'library', taskId: task.id, note: why });
    task.artifact = { type: 'game', id: rec.id, title: rec.title, source: 'library' };
    log('RESULT', `Published ${rec.title} to JARVIS Arcade (${rec.id})`);
    return `Built **${rec.title}** from JARVIS's offline game library, because ${why}. JARVIS played it in a test browser and verified: ${verified(r)}. It's playable now in JARVIS Arcade.`;
  };

  log('ACTION', `Created ${name} project for "${request.substring(0, 80)}"`);
  let html: string | null = null;
  let errors: string[] = [];
  let report: TestReport | null = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      log('ACTION', attempt ? `Fixing the errors (attempt ${attempt + 1}): ${errors.join('; ').slice(0, 200)}` : 'Writing the game code');
      const reply = await queryAgent(step.agentId, gamePrompt(request, attempt ? { errors, previous: '' } : undefined), apiKey);
      html = extractHtml(reply);
      errors = validateGameHtml(html ?? '');
      if (errors.length) { log('ERROR', `Code check failed (attempt ${attempt + 1}): ${errors.join('; ')}`); continue; }
      report = await test(html!, attempt ? 'the fixed game' : 'the game');
      if (report.ok) break;
      errors = failures(report);
    }
  } catch (err: any) {
    if (err instanceof ServiceError && lib) return fromLibrary(`Gemini was unavailable (${err.message})`);
    throw err;
  }
  if (!report?.ok || !html) {
    if (lib) return fromLibrary(`the generated version still failed testing (${errors.join('; ').slice(0, 200)})`);
    throw new Error(`The game failed testing after 3 attempts: ${errors.join('; ')}`);
  }
  const title = htmlTitle(html) ?? lib?.title ?? 'JARVIS Game';
  const rec = saveGame(html, { title, prompt: request, agent: step.agentId, source: 'generated', taskId: task.id });
  task.artifact = { type: 'game', id: rec.id, title, source: 'generated' };
  log('RESULT', `Published ${title} to JARVIS Arcade (${rec.id})`);
  return `Built **${title}** (${(html.length / 1024).toFixed(1)} KB). JARVIS played it in a test browser and verified: ${verified(report)}. It's playable now in JARVIS Arcade.`;
}

/** This step builds software (web page, web app, script, tool): the CODE specialist or the only step. */
const isBuildStep = (task: MultiAgentTask, step: TaskStep) =>
  !wantsGame(task.userPrompt) && wantsProject(task.userPrompt) && (step.agentId === 'CODE' || task.steps.length === 1 || !task.steps.some((s) => s.agentId === 'CODE'));

async function buildProjectStep(task: MultiAgentTask, step: TaskStep, apiKey: string): Promise<string> {
  const r = await buildProject(task.userPrompt, (prompt) => queryAgent(step.agentId, prompt, apiKey), buildLog(task, step));
  task.artifact = { type: 'project', path: r.dir, entry: r.entry, kind: r.kind, title: path.basename(r.dir) };
  const ran = r.report.checks.filter((c) => c.ok).map((c) => c.name.toLowerCase()).join(', ');
  return `Built **${path.basename(r.dir)}** (${r.files.join(', ')}) in \`${r.dir}\`.${r.summary ? ` ${r.summary}` : ''}\nJARVIS ran it and verified: ${ran}${r.attempts > 1 ? ` (it needed ${r.attempts - 1} fix round${r.attempts > 2 ? 's' : ''})` : ''}.${r.kind === 'web' ? ` Open ${r.entry} in a browser to use it.` : ''}`;
}

const BLOCK_HINT = `\n\nIf you are genuinely blocked and need a specific colleague (CODE, GAME, WRITE, PROMPT, SEC, SOCIAL, ATLAS), reply ONLY with:
BLOCKED: <AGENT_ID>: <your precise question>`;

/** Runs one step; on a bottleneck the agent leaves its office to consult a sister agent (once). */
async function runStep(task: MultiAgentTask, step: TaskStep, context: string, apiKey: string): Promise<string> {
  // Web research only ever goes through the computer router (Orbit browser in ORBIT mode;
  // background reads in DIRECT mode, never the user's browser), so an agent can't jump environments.
  if ((step.agentId === 'ATLAS' || step.research) && !skills().webSearch) {
    context += '\n[Web search is disabled in SKILLS: work from your own knowledge and say that sources were not checked.]\n';
  } else if (step.agentId === 'ATLAS' || step.research) {
    const q = step.research || step.instruction;
    const orbitMode = getMode() === 'ORBIT';
    logAgentEvent(task.id, step.agentId, orbitMode ? 'ORBIT' : 'JARVIS',
      orbitMode ? `Researching in the Orbit browser: "${q}"` : `Researching "${q}" (reading sources in the background)`, 'EXECUTION');
    context += '\n' + (await agentResearch(q, step.agentId).catch((e) => `[Research failed: ${e.message}. Do not invent sources.]`)) + '\n';
  }
  let out = '';
  let question = '';
  let asked: string | undefined;
  try {
    out = await queryAgent(step.agentId, step.instruction + BLOCK_HINT, apiKey, context);
    const m = out.match(/^\s*BLOCKED:\s*([A-Z]+)\s*:\s*([\s\S]+)/);
    if (!m) return out;
    asked = m[1];
    question = m[2].trim();
    out = '';
  } catch (err: any) {
    if (err instanceof ServiceError) throw err; // a sister agent can't fix quota/outages: report it as a blocker
    question = `I hit an error on "${step.instruction}": ${err.message}. How should I proceed?`;
  }

  // Help Protocol: the sister agent must be free (roaming) or already on this same task.
  const available = (id: string) => !!AGENT_REGISTRY[id] && id !== step.agentId && id !== MANAGER && (!lockedBy.has(id) || lockedBy.get(id) === task.id);
  const helper = [asked, ...(SISTER[step.agentId] ?? []), ...SPECIALISTS].find((id): id is string => !!id && available(id));
  const blocker = `${step.agentId} blocked: ${question.substring(0, 120)}`;
  task.blockers.push(blocker);
  if (!helper) {
    report(task, `${step.agentId} hit a bottleneck and no sister agent is free`);
    task.blockers = task.blockers.filter((b) => b !== blocker);
    throw new Error(`Blocked with no available help: ${question}`);
  }

  const officeMode: AgentMode = task.mode === 'SWARM' ? 'SWARM' : 'OFFICE';
  setAgent(step.agentId, { mode: 'HELPING', helpTarget: helper });
  logAgentEvent(task.id, step.agentId, helper, `Help request: ${question}`, 'HELP');
  report(task, `${step.agentId} left the office to consult ${helper}`);
  try {
    await holdIfPaused(helper, task);
    const answer = await queryAgent(helper,
      `${step.agentId} is blocked on part of the task "${task.title}" and needs brief help:\n${question}\nGive a short, practical answer.`, apiKey, context);
    logAgentEvent(task.id, helper, step.agentId, `Help given: ${answer.substring(0, 160)}`, 'HELP');
    step.helpedBy = helper;
    context = `${context}\n[Help from ${helper}]:\n${answer}`;
  } finally {
    setAgent(step.agentId, { mode: officeMode, helpTarget: undefined });
    task.blockers = task.blockers.filter((b) => b !== blocker);
  }
  report(task, `${step.agentId} is back in the office with ${helper}'s input`);
  await holdIfPaused(step.agentId, task);
  return queryAgent(step.agentId, step.instruction, apiKey, context);
}

/**
 * Creates and runs a task. `route` is the Manager's decision when the caller already routed the
 * prompt; otherwise an explicit targetAgent makes it SOLO, and anything else is routed now.
 */
export async function processMultiAgentTask(userPrompt: string, apiKey: string, targetAgent?: string, route?: ManagerRoute): Promise<MultiAgentTask> {
  const task: MultiAgentTask = {
    id: `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    title: userPrompt.length > 50 ? userPrompt.substring(0, 47) + '...' : userPrompt,
    userPrompt,
    assignedBy: 'JARVIS',
    orchestrator: MANAGER,
    status: 'DECOMPOSING',
    mode: 'STANDARD',
    route: 'SOLO',
    assignees: [],
    steps: [],
    blockers: [],
    paused: false,
    createdAt: new Date().toLocaleTimeString(),
    retryCount: 0,
  };
  activeTasks.unshift(task);
  if (activeTasks.length > 30) activeTasks.pop();
  broadcastEvent('task_created', task);
  refreshManager();

  const run = (async () => {
    try {
      logAgentEvent(task.id, 'JARVIS', MANAGER, `New assignment: "${userPrompt}"`, 'DELEGATION');
      const target = targetAgent?.toUpperCase();
      const plan: ManagerRoute = route && route.route !== 'DIRECT' ? route
        : target && isSpecialist(target) ? { route: 'SOLO', assignments: [{ agentId: target, instruction: userPrompt }], reason: `Assigned directly to ${target}` }
        : await managerRoute(userPrompt, apiKey, { requireAgents: true });
      task.route = plan.route === 'TASK_FORCE' ? 'TASK_FORCE' : 'SOLO';
      task.routeReason = plan.reason;
      task.mode = task.route === 'TASK_FORCE' ? 'SWARM' : 'STANDARD';
      task.steps = plan.assignments.map((s, i) => ({ id: `step-${i + 1}`, agentId: s.agentId, agentName: s.agentId, instruction: s.instruction, research: s.research, status: 'PENDING' as const }));
      task.assignees = [...new Set(task.steps.map((s) => s.agentId))];
      task.status = 'QUEUED';
      broadcastEvent('task_routed', { taskId: task.id, title: task.title, route: task.route, agents: task.assignees, reason: task.routeReason });
      logAgentEvent(task.id, MANAGER, task.assignees.join(', '),
        task.mode === 'SWARM' ? `Task force: ${task.assignees.join(' + ')} will gather in one room and work concurrently` : `Solo task for ${task.assignees[0]} (Office Mode)`,
        task.mode === 'SWARM' ? 'SWARM' : 'DELEGATION');

      await acquireAll(task);
      task.status = 'IN_PROGRESS';
      report(task, task.mode === 'SWARM' ? `Task force formed: ${task.assignees.join(', ')}` : `${task.assignees[0]} entered Office Mode`);

      let context = `Task from JARVIS: "${userPrompt}"\n\n`;
      if (task.mode === 'SWARM') {
        context += `You are on a task force working at the same time:\n${task.steps.map((s) => `- ${s.agentId}: ${s.instruction}`).join('\n')}\nDo only your own part; your teammates cover theirs. The Manager merges everything at the end.\n\n`;
      }

      const runOne = async (i: number) => {
        const step = task.steps[i];
        await holdIfPaused(step.agentId, task);
        step.status = 'RUNNING';
        step.startedAt = new Date().toLocaleTimeString();
        report(task, `Step ${i + 1}/${task.steps.length} started by ${step.agentId}`);
        try {
          step.result = isGameStep(task, step) ? await buildGameStep(task, step, apiKey)
            : isBuildStep(task, step) ? await buildProjectStep(task, step, apiKey)
            : await runStep(task, step, context, apiKey);
          step.status = 'COMPLETED';
        } catch (err: any) {
          step.status = 'FAILED';
          step.error = err.message;
        }
        step.completedAt = new Date().toLocaleTimeString();
        // Solo agents are released once their part is done; a task force stays together until the end.
        if (task.mode !== 'SWARM' && !task.steps.slice(i + 1).some((s) => s.agentId === step.agentId)) release(step.agentId, task);
        report(task, `Step ${i + 1}/${task.steps.length} ${step.status === 'COMPLETED' ? 'completed' : 'failed'} (${step.agentId})`);
      };

      if (task.mode === 'SWARM') {
        await Promise.all(task.steps.map((_, i) => runOne(i))); // the task force works concurrently
      } else {
        for (let i = 0; i < task.steps.length; i++) {
          await runOne(i);
          const step = task.steps[i];
          if (step.status === 'COMPLETED') context += `[Step ${i + 1} - ${step.agentId}]:\n${step.result}\n\n`;
        }
      }
      if (task.mode === 'SWARM') {
        for (const [i, step] of task.steps.entries()) {
          context += step.status === 'COMPLETED' ? `[${step.agentId} - part ${i + 1}]:\n${step.result}\n\n` : `[${step.agentId} - part ${i + 1} FAILED: ${step.error}]\n\n`;
        }
      }

      task.status = 'VERIFYING';
      report(task, 'All steps finished; compiling the final report for JARVIS');
      const failed = task.steps.filter((s) => s.status === 'FAILED');
      if (task.artifact && task.steps.length === 1 && !failed.length) {
        task.finalResult = task.steps[0].result;
      } else if (failed.length === task.steps.length) {
        // Nothing to summarise: say plainly what went wrong rather than asking NEX to write a report.
        task.finalResult = `Nothing was completed. ${failed.map((s) => `${s.agentId}: ${s.error}`).join(' · ')}`;
      } else {
        try {
          task.finalResult = await queryAgent(MANAGER,
            task.mode === 'SWARM'
              ? `Merge the task force's parts into one final deliverable for JARVIS on "${userPrompt}". Keep each specialist's work intact where it matters, resolve overlaps, and state clearly which parts failed.\n\n${context}`
              : `Write a concise final report for JARVIS on the task "${userPrompt}". Summarise the outcome and state clearly anything that failed.\n\n${context}`, apiKey);
        } catch (err: any) {
          // NEX couldn't write the summary: deliver the finished work as it is instead of losing it.
          task.finalResult = `NEX couldn't compile the summary (${err.message}). The finished parts are below.\n\n` +
            task.steps.map((s) => s.status === 'COMPLETED' ? `### ${s.agentId}\n${s.result}` : `### ${s.agentId}\nFailed: ${s.error}`).join('\n\n');
        }
      }
      task.status = failed.length === task.steps.length ? 'FAILED' : 'COMPLETED';
      task.completedAt = new Date().toLocaleTimeString();
    } catch (err: any) {
      console.error('Multi-agent task error:', err);
      task.status = 'FAILED';
      task.finalResult = `Task failed: ${err.message}`;
    } finally {
      task.assignees.forEach((id) => release(id, task));
      task.blockers = [];
      report(task, task.status === 'COMPLETED' ? 'Task complete' : 'Task ended with failures');
      refreshManager();
    }
  })();
  taskRuns.set(task.id, run);
  return task;
}

// Every specialist starts free-roaming; NEX announces the team to JARVIS.
logAgentEvent('system', MANAGER, 'JARVIS',
  `Project Manager online. Specialists ${SPECIALISTS.join(', ')} are idle and roaming, awaiting their first assignment.`, 'REPORT');
