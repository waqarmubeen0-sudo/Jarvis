// J.A.R.V.I.S. long-term memory: what JARVIS knows about the user, and the user's control over it.
//
//   - Structured: every memory lives in one category (IDENTITY, LIKES, PLACES, ...).
//   - Persistent: ~/.jarvis/memory.json (outside the project, survives restarts and rebuilds).
//   - Fast: a word index per memory; a question is routed to the few categories it is about and
//     only widens to everything when those have nothing.
//   - Consent-aware: the model can only save CONFIRMED memories when the user actually asked it to,
//     can't save anything after "don't remember this", can't delete without the user asking, and never
//     stores secrets. The checks run here, on the user's own words, not on what the model claims.
//
// States: CONFIRMED (the user asked for it or approved it), OBSERVED (JARVIS noticed it; not
// confirmed), PENDING (JARVIS asked "should I remember that?" and awaits Save / Don't Save).
// TEMPORARY information is simply never written here: it lives only in the current conversation.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Type, FunctionDeclaration } from '@google/genai';

export const CATEGORIES = {
  IDENTITY: 'Identity',
  PERSONALITY: 'Personality',
  LIKES: 'Likes',
  DISLIKES: 'Dislikes',
  HABITS: 'Habits & Routines',
  PLACES: 'Places',
  PEOPLE: 'People',
  WORK: 'Work & Projects',
  GOALS: 'Goals',
  PREFERENCES: 'Preferences',
  EVENTS: 'Important Events',
  CONVERSATION: 'Conversation Memory',
  RELATIONSHIP: 'JARVIS Relationship',
  INSTRUCTIONS: 'Instructions',
  KNOWLEDGE: 'Knowledge',
  HOBBIES: 'Hobbies',
  IMPORTANT: 'Important Information',
} as const;
export type Category = keyof typeof CATEGORIES;
const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

export type MemoryStatus = 'CONFIRMED' | 'OBSERVED';
export interface Memory {
  id: string;
  category: Category;
  text: string;
  status: MemoryStatus;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface PendingMemory { id: string; category: Category; text: string; sensitive: boolean; createdAt: string }
interface Store {
  enabled: boolean; // master switch: OFF = no new long-term memories
  disabled: Category[]; // categories closed to automatic saving
  memories: Memory[];
  pending: PendingMemory[];
}
type Result = { status: 'SUCCESS' | 'FAILED' | 'NEEDS_CONFIRMATION'; message: string; [k: string]: unknown };

export const MEMORY_FILE = process.env.JARVIS_MEMORY_FILE || path.join(os.homedir(), '.jarvis', 'memory.json');

// ---------------------------------------------------------------------------------------------
// Safety classification

// Never stored, even on request: plaintext secrets don't belong in a memory file.
const SECRET = /\b(pass ?words?|passcodes?|pins?|cvv|otp|one[- ]time code|api[ -]?keys?|secret keys?|private keys?|seed phrase|recovery phrase|security answers?)\b|\b(?:\d[ -]?){12,19}\b/i;
// Stored only when the user explicitly asks or approves.
const SENSITIVE = /\b(health|medical|diagnos\w*|medication|medicine|illness|disease|therapy|therapist|depress\w*|anxiety|pregnan\w*|disorder|religio\w*|political|politics|vote[sd]?|sexual\w*|sexuality|salary|income|debt|loan|bank|address|phone number|passport|aadhaar|social security|id number|lawsuit|criminal|arrest\w*|immigration|visa status)\b/i;
export const isSecret = (t: string) => SECRET.test(t);
export const isSensitive = (t: string) => SENSITIVE.test(t);

// ---------------------------------------------------------------------------------------------
// Store + index

const STOP = new Set('the and for you your with that this what which have has had are was were who whom how when where why does did do not can could would should will about from into they them their there then than just like also very much more some any all its it’s i’m me my mine our ours his her him she he jarvis boss sir tell know remember save please want need think get got make thing stuff really'.split(' '));
const words = (t: string) =>
  t.toLowerCase().match(/[a-z0-9']+/g)?.map((w) => w.replace(/'s$|'/g, '').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1')).filter((w) => w.length > 2 && !STOP.has(w)) ?? [];

let store: Store;
const index = new Map<string, Set<string>>(); // word -> memory ids
const byId = new Map<string, Memory>();

function indexMemory(m: Memory) {
  byId.set(m.id, m);
  for (const w of words(m.text)) (index.get(w) ?? index.set(w, new Set()).get(w)!).add(m.id);
}
function reindex() {
  index.clear();
  byId.clear();
  store.memories.forEach(indexMemory);
}
function persist() {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  const tmp = MEMORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, MEMORY_FILE); // atomic: a crash never leaves half a memory file
  reindex();
  listeners.forEach((cb) => { try { cb(); } catch {} });
}

const now = () => new Date().toISOString();
const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const seed = (category: Category, text: string): Memory => ({ id: newId('mem'), category, text, status: 'CONFIRMED', sensitive: false, createdAt: now(), updatedAt: now() });

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')) as Store;
    store = { enabled: s.enabled !== false, disabled: s.disabled ?? [], memories: s.memories ?? [], pending: s.pending ?? [] };
    reindex();
  } catch {
    // First run: who JARVIS is to the user (their name comes from the setup screen, not from memory).
    store = {
      enabled: true,
      disabled: [],
      pending: [],
      memories: [
        seed('RELATIONSHIP', 'The user wants JARVIS to be their loyal friend and trusted companion: honest with them, not a yes-man.'),
        seed('PREFERENCES', "Call the user by their name in casual, personal conversation; 'Boss' or 'Sir' for work, projects, tasks and serious situations. Use them naturally, not in every sentence."),
      ],
    };
    persist();
  }
}
const listeners = new Set<() => void>();
load();

export const onMemoryChange = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

// ---------------------------------------------------------------------------------------------
// Retrieval

// Which categories a question is about. Each entry: category <- word stems that point to it.
const ROUTES: [Category, RegExp][] = [
  ['IDENTITY', /\b(name|called|pronounc|age|old am|born|birthday|who am i|myself)/],
  ['PERSONALITY', /\b(personality|kind of person|temperament|mood|character|introvert|extrovert)/],
  ['LIKES', /\b(like|love|enjoy|favou?rite|fan of|coffee|tea|drink|food|eat|snack|music|song|band|movie|film|show|series|game|book|sport|hobby|hobbies)/],
  ['DISLIKES', /\b(dislike|hate|don'?t like|avoid|annoy|frustrat|can'?t stand|bother|irritat)/],
  ['HABITS', /\b(habit|routine|usually|every (day|morning|night|week)|morning|night|sleep|wake|schedule|workout|gym)/],
  ['PLACES', /\b(place|where|go to|visit|travel|trip|holiday|vacation|city|country|restaurant|cafe|beach)/],
  ['PEOPLE', /\b(who is|friend|family|mom|mum|mother|dad|father|brother|sister|wife|husband|girlfriend|boyfriend|partner|son|daughter|colleague|cousin|uncle|aunt)/],
  ['WORK', /\b(project|work|job|code|coding|app|build|tool|stack|client|repo|editor|framework|language|jarvis build|business|company)/],
  ['GOALS', /\b(goal|plan|want to|ambition|dream|aim|target|trying to|someday)/],
  ['PREFERENCES', /\b(prefer|preference|how (do|should) (i|you)|communicat|format|respond|reply|call me|style|organi[sz]e)/],
  ['EVENTS', /\b(when|date|birthday|anniversary|deadline|meeting|event|appointment|exam|wedding|milestone)/],
  ['CONVERSATION', /\b(talked|discussed|we said|last time|conversation|earlier|told you|mentioned)/],
  ['RELATIONSHIP', /\b(you and me|us|our|created you|made you|who are you|relationship|your purpose)/],
  ['INSTRUCTIONS', /\b(instruction|always|never|rule|whenever|when i ask|how you should|i told you to|standing order)/],
  ['KNOWLEDGE', /\b(fact|facts|knowledge|reference|definition|know about|info(rmation)? (on|about)|details? (on|about)|notes? (on|about))/],
  ['HOBBIES', /\b(hobby|hobbies|free time|spare time|weekend|for fun|pastime|collect|guitar|paint|draw|gaming|play)/],
  ['IMPORTANT', /\b(important|don'?t forget|crucial|critical|key (info|detail)|must remember|essential)/],
];
const ABOUT_ME: Category[] = ['IDENTITY', 'PERSONALITY', 'PREFERENCES', 'LIKES', 'GOALS'];

export function routeQuery(query: string): Category[] {
  const q = query.toLowerCase();
  if (/\b(about me|know me|who i am|everything you know)\b/.test(q)) return ABOUT_ME;
  const cats = ROUTES.filter(([, re]) => re.test(q)).map(([c]) => c);
  // Corrections and preferences overlap: "what coffee do I like" is a like and maybe a preference.
  if (cats.includes('LIKES') && !cats.includes('PREFERENCES')) cats.push('PREFERENCES');
  if (cats.includes('WORK') && !cats.includes('CONVERSATION')) cats.push('CONVERSATION');
  return cats;
}

/** The smallest relevant set first: routed categories, then the whole index only if they come up empty. */
export function recall(query: string, categories?: string[], limit = 8) {
  const cats = (categories?.length ? categories.map((c) => normCategory(c)).filter(Boolean) : routeQuery(query)) as Category[];
  const qWords = words(query);
  const score = (m: Memory) => qWords.reduce((n, w) => n + (index.get(w)?.has(m.id) ? 1 : 0), 0);
  const rank = (list: Memory[]) => list.map((m) => [m, score(m)] as const).sort((a, b) => b[1] - a[1] || (a[0].status === 'CONFIRMED' ? -1 : 1));

  let scope = 'categories';
  let hits: (readonly [Memory, number])[] = [];
  if (cats.length) {
    const inCats = store.memories.filter((m) => cats.includes(m.category));
    const ranked = rank(inCats);
    // Words matched: return those. No word matched but the category is small: it's all relevant.
    hits = ranked.some(([, s]) => s > 0) ? ranked.filter(([, s]) => s > 0) : ranked;
  }
  if (!hits.length && qWords.length) {
    scope = 'all';
    const ids = new Set(qWords.flatMap((w) => [...(index.get(w) ?? [])]));
    hits = rank([...ids].map((id) => byId.get(id)!).filter(Boolean)).filter(([, s]) => s > 0);
  }
  return {
    searched: scope === 'all' ? 'all categories (nothing in ' + (cats.join(', ') || 'the routed categories') + ')' : cats.join(', '),
    memories: hits.slice(0, limit).map(([m]) => ({ id: m.id, category: m.category, text: m.text, status: m.status, updatedAt: m.updatedAt })),
  };
}

/** Compact briefing loaded into JARVIS at the start of every conversation. */
export function memoryBriefing(maxChars = 1800) {
  const order: Category[] = ['IDENTITY', 'INSTRUCTIONS', 'IMPORTANT', 'RELATIONSHIP', 'PREFERENCES', 'PERSONALITY', 'LIKES', 'DISLIKES', 'GOALS', 'WORK', 'HABITS', 'PEOPLE', 'PLACES', 'EVENTS'];
  const lines: string[] = [];
  let size = 0;
  for (const c of order) {
    for (const m of store.memories.filter((x) => x.category === c && !x.sensitive)) {
      const line = `- [${c}${m.status === 'OBSERVED' ? ', observed' : ''}] ${m.text}`;
      if (size + line.length > maxChars) return lines.join('\n') + '\n- (more stored: use recall_memory)';
      lines.push(line);
      size += line.length;
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Changes (used by the UI directly and by the tools below after their consent checks)

export function normCategory(c: unknown): Category | null {
  const s = String(c ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  const alias: Record<string, Category> = { HABITSROUTINES: 'HABITS', ROUTINES: 'HABITS', WORKPROJECTS: 'WORK', PROJECTS: 'WORK', USER: 'IDENTITY', IMPORTANTINFORMATION: 'IMPORTANT', INSTRUCTION: 'INSTRUCTIONS', HOBBY: 'HOBBIES', CONVERSATIONCONTEXT: 'CONVERSATION', IMPORTANTEVENTS: 'EVENTS', CONVERSATIONMEMORY: 'CONVERSATION', JARVISRELATIONSHIP: 'RELATIONSHIP', PREFERENCE: 'PREFERENCES', LIKE: 'LIKES', DISLIKE: 'DISLIKES', GOAL: 'GOALS', PLACE: 'PLACES', PERSON: 'PEOPLE', EVENT: 'EVENTS' };
  return (CATEGORY_IDS as string[]).includes(s) ? (s as Category) : alias[s] ?? null;
}
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function addMemory(category: Category, text: string, status: MemoryStatus): Memory {
  // Same fact again: refresh it (and upgrade OBSERVED -> CONFIRMED) instead of a duplicate.
  const dup = store.memories.find((m) => m.category === category && norm(m.text) === norm(text));
  if (dup) {
    if (status === 'CONFIRMED') dup.status = 'CONFIRMED';
    dup.updatedAt = now();
    persist();
    return dup;
  }
  const m: Memory = { id: newId('mem'), category, text: text.trim(), status, sensitive: isSensitive(text), createdAt: now(), updatedAt: now() };
  store.memories.push(m);
  persist();
  return m;
}

export function updateMemory(id: string, patch: { text?: string; category?: string; confirm?: boolean }): Memory | null {
  const m = store.memories.find((x) => x.id === id);
  if (!m) return null;
  if (patch.text?.trim()) { m.text = patch.text.trim(); m.sensitive = isSensitive(m.text); }
  const c = patch.category ? normCategory(patch.category) : null;
  if (c) m.category = c;
  if (patch.confirm) m.status = 'CONFIRMED';
  m.updatedAt = now();
  persist();
  return m;
}

export function deleteMemories(sel: { ids?: string[]; category?: string; all?: boolean }) {
  const before = store.memories.length;
  const cat = sel.category ? normCategory(sel.category) : null;
  store.memories = store.memories.filter((m) => !(sel.all || (cat && m.category === cat) || sel.ids?.includes(m.id)));
  if (sel.all) store.pending = [];
  else if (cat) store.pending = store.pending.filter((p) => p.category !== cat);
  const removed = before - store.memories.length;
  persist();
  return removed;
}

export function addPending(category: Category, text: string): PendingMemory {
  const same = store.pending.find((p) => p.category === category && norm(p.text) === norm(text));
  if (same) return same;
  const p: PendingMemory = { id: newId('ask'), category, text: text.trim(), sensitive: isSensitive(text), createdAt: now() };
  store.pending = [p, ...store.pending].slice(0, 20);
  persist();
  return p;
}

/** Save / Don't Save on a pending suggestion. Saving makes it CONFIRMED (the user approved it). */
export function resolvePending(id: string, save: boolean): Memory | null | undefined {
  const p = store.pending.find((x) => x.id === id);
  if (!p) return undefined;
  store.pending = store.pending.filter((x) => x.id !== id);
  if (!save) { persist(); return null; }
  return addMemory(p.category, p.text, 'CONFIRMED');
}

/** Manual add from the Memory panel: The user typed it themselves, so it's CONFIRMED. */
export function addFromUser(category: string, text: string) {
  const c = normCategory(category);
  if (!c || !text.trim()) throw new Error('A category and some text are required.');
  if (isSecret(text)) throw new Error("Secrets like passwords, PINs, keys and card numbers aren't stored in memory.");
  return addMemory(c, text, 'CONFIRMED');
}

export function setMemoryEnabled(on: boolean) { store.enabled = on; persist(); }
export function setCategoryEnabled(category: string, on: boolean) {
  const c = normCategory(category);
  if (!c) throw new Error('Unknown category');
  store.disabled = on ? store.disabled.filter((x) => x !== c) : [...new Set([...store.disabled, c])];
  persist();
}

export function memorySnapshot() {
  return {
    enabled: store.enabled,
    file: MEMORY_FILE,
    pending: store.pending,
    categories: CATEGORY_IDS.map((id) => ({
      id,
      label: CATEGORIES[id],
      enabled: !store.disabled.includes(id),
      items: store.memories.filter((m) => m.category === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Consent: what the user actually said, per conversation (voice transcript chunks or typed text)

const NO_SAVE = /\b(?:don'?t|do not|never|no need to)\s+(?:remember|save|store|keep|note|memori[sz]e)\b|\bforget (?:this|that|it|what i (?:just )?said)\b|\boff the record\b|\b(?:don'?t|do not) (?:put|add) (?:this|that|it) (?:in|to)\b/i;
const SAVE = /\bremember (?:this|that|it|me|my|i|when|where|how|what)\b|\b(?:save|store|note|log) (?:this|that|it)\b|\b(?:put|add|save|keep) (?:this|that|it)? ?(?:in|to|into) (?:your |my )?memory\b|\bdon'?t forget\b|\bkeep (?:this|that) in mind\b|\bmake a note\b/i;
// "Do you remember my ...?" is a question, not a request to save.
const RECALL_QUESTION = /\b(?:do|did|can|could|would) you (?:still |even )?remember\b|\bremember (?:when|what|how|where|who)\b.*\?/i;
const FORGET = /\b(forget|delete|erase|remove|clear|wipe|drop)\b/i;
const FORGET_ALL = /\b(all|everything|entire|whole)\b.*\b(memor(?:y|ies)|know about me|you know)\b|\b(clear|wipe|erase|delete) (?:your |my )?(?:long[- ]term )?memory\b/i;
const CORRECTION = /\b(update|change|correct|fix|actually|not anymore|anymore|no longer|instead|now i|wrong)\b/i;
const YES = /\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|save it|save that|keep it|remember it|sounds good|of course|absolutely|definitely)\b/i;
const NO = /\b(no|nope|nah|don'?t|do not|skip it|never mind|not now|leave it)\b/i;

const WINDOW = 60_000; // an instruction applies to the next minute of conversation
const NO_SAVE_WINDOW = 180_000; // "don't remember this" covers what is said around it

export class MemoryConsent {
  private utterance = '';
  saveAt = 0;
  noSaveAt = 0;
  forgetAt = 0;
  forgetAllAt = 0;
  correctAt = 0;
  answer: { save: boolean; at: number } | null = null;

  hear(chunk: string, at = Date.now()) { this.utterance += chunk; this.scan(this.utterance, at); }
  hearTyped(text: string, at = Date.now()) { this.scan(text, at); }
  endTurn() { this.utterance = ''; }

  private scan(t: string, at: number) {
    if (NO_SAVE.test(t)) { this.noSaveAt = at; this.saveAt = 0; }
    else if (SAVE.test(t) && !RECALL_QUESTION.test(t)) { this.saveAt = at; this.noSaveAt = 0; }
    if (FORGET.test(t)) this.forgetAt = at;
    if (FORGET_ALL.test(t)) this.forgetAllAt = at;
    if (CORRECTION.test(t)) this.correctAt = at;
    if (NO.test(t)) this.answer = { save: false, at };
    else if (YES.test(t)) this.answer = { save: true, at };
  }
  blocked(at = Date.now()) { return this.noSaveAt > 0 && at - this.noSaveAt < NO_SAVE_WINDOW; }
  askedToSave(at = Date.now()) { return at - this.saveAt < WINDOW; }
  askedToForget(all: boolean, at = Date.now()) { return at - (all ? this.forgetAllAt : this.forgetAt) < WINDOW; }
  askedToCorrect(at = Date.now()) { return at - this.correctAt < WINDOW || this.askedToSave(at); }
  answered(at = Date.now()) { return this.answer && at - this.answer.at < WINDOW ? this.answer.save : null; }
}

// ---------------------------------------------------------------------------------------------
// Tools for the live model

const catEnum = CATEGORY_IDS.join(', ');
export const memoryToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'recall_memory',
    description: `Look up what you know about the user. Give the question; optionally the categories to search (${catEnum}). Searches the smallest relevant set first. OBSERVED results are your impressions, not confirmed facts.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'What you want to know, e.g. "coffee they like"' },
        categories: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Optional categories to search' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember',
    description: `Save something to long-term memory because the user explicitly asked ("remember this", "save that"). Write it as a short third-person fact, e.g. "Likes their coffee black, no sugar." If it corrects an existing memory, recall it first and use update_memory instead. Category is one of: ${catEnum}.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING, description: catEnum },
        text: { type: Type.STRING, description: 'The fact, short and self-contained' },
      },
      required: ['category', 'text'],
    },
  },
  {
    name: 'suggest_memory',
    description: 'The user shared something clearly important or has shown the same preference repeatedly, but did not ask you to remember it. Creates a Save / Don\'t Save request; then ask them in one short line, e.g. "Should I remember that for future conversations?"',
    parameters: {
      type: Type.OBJECT,
      properties: { category: { type: Type.STRING, description: catEnum }, text: { type: Type.STRING, description: 'The fact to save if they agree' } },
      required: ['category', 'text'],
    },
  },
  {
    name: 'note_observation',
    description: 'Record a clear, repeated pattern you have noticed (not a guess, not a passing mood) as an OBSERVED memory, e.g. "Seems to prefer short answers while coding." Never for personal or sensitive topics; those need suggest_memory.',
    parameters: {
      type: Type.OBJECT,
      properties: { category: { type: Type.STRING, description: catEnum }, text: { type: Type.STRING } },
      required: ['category', 'text'],
    },
  },
  {
    name: 'answer_memory_suggestion',
    description: "The user answered your \"should I remember that?\" question. save=true for yes, false for no. Leave id empty for the most recent question.",
    parameters: {
      type: Type.OBJECT,
      properties: { id: { type: Type.STRING }, save: { type: Type.BOOLEAN } },
      required: ['save'],
    },
  },
  {
    name: 'update_memory',
    description: 'Correct an existing memory when the user says it changed or is wrong ("I don\'t like tea anymore"). Get its id from recall_memory. Replaces the text; never create a conflicting duplicate.',
    parameters: {
      type: Type.OBJECT,
      properties: { id: { type: Type.STRING }, text: { type: Type.STRING, description: 'The corrected fact' }, category: { type: Type.STRING, description: 'Optional new category' } },
      required: ['id', 'text'],
    },
  },
  {
    name: 'forget_memory',
    description: 'Delete memories when the user asks: specific ones (ids from recall_memory), a whole category, or everything (all=true, only after they have confirmed they means ALL long-term memory).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        ids: { type: Type.ARRAY, items: { type: Type.STRING } },
        category: { type: Type.STRING, description: catEnum },
        all: { type: Type.BOOLEAN },
      },
    },
  },
];
export const memoryToolNames = new Set(memoryToolDeclarations.map((t) => t.name!));

const ok = (message: string, extra: Record<string, unknown> = {}): Result => ({ status: 'SUCCESS', message, ...extra });
const no = (message: string): Result => ({ status: 'FAILED', message });

export function executeMemoryTool(name: string, args: Record<string, any>, consent: MemoryConsent, at = Date.now()): Result {
  const text = String(args.text ?? '').trim();
  const category = normCategory(args.category);
  const offMsg = 'Long-term memory is OFF (the user turned it off in the Memory panel). Nothing new is saved; you can still use what they say in this conversation.';

  switch (name) {
    case 'recall_memory':
      return ok('Memories found (OBSERVED = your impression, not a confirmed fact).', recall(String(args.query ?? ''), args.categories));

    case 'remember': {
      if (!category || !text) return no(`Need a category (${catEnum}) and the fact.`);
      if (!store.enabled) return no(offMsg);
      if (isSecret(text)) return no("Not saved: passwords, PINs, keys and card numbers are never stored in memory. Tell the user that, briefly.");
      if (consent.blocked(at)) return no('Not saved: The user said not to remember this.');
      if (!consent.askedToSave(at)) {
        const p = addPending(category, text);
        return { status: 'NEEDS_CONFIRMATION', message: 'The user did not ask to remember this, so it is waiting for their approval. Ask: "Should I remember that?"', pendingId: p.id };
      }
      const m = addMemory(category, text, 'CONFIRMED');
      return ok(`Saved to ${CATEGORIES[m.category]} as CONFIRMED.`, { memory: m });
    }

    case 'suggest_memory': {
      if (!category || !text) return no(`Need a category (${catEnum}) and the fact.`);
      if (!store.enabled) return no(offMsg);
      if (isSecret(text)) return no('Secrets are never stored. Do not ask.');
      if (consent.blocked(at)) return no('The user said not to remember this. Do not ask.');
      if (store.disabled.includes(category)) return no(`${CATEGORIES[category]} memory is disabled. Do not ask.`);
      const p = addPending(category, text);
      return ok('Waiting for their answer (also shown in the Memory panel with Save / Don\'t Save). Ask in one short line.', { pendingId: p.id });
    }

    case 'note_observation': {
      if (!category || !text) return no(`Need a category (${catEnum}) and the observation.`);
      if (!store.enabled) return no(offMsg);
      if (consent.blocked(at)) return no('Not saved: The user said not to remember this.');
      if (store.disabled.includes(category)) return no(`Not saved: ${CATEGORIES[category]} memory is disabled.`);
      if (isSecret(text)) return no('Secrets are never stored.');
      if (isSensitive(text)) {
        const p = addPending(category, text);
        return { status: 'NEEDS_CONFIRMATION', message: 'Personal/sensitive topic: not stored without their approval. Only ask if it matters.', pendingId: p.id };
      }
      const m = addMemory(category, text, 'OBSERVED');
      return ok(`Noted as OBSERVED in ${CATEGORIES[m.category]}. Treat it as an impression, not a fact.`, { memory: m });
    }

    case 'answer_memory_suggestion': {
      const said = consent.answered(at);
      const want = Boolean(args.save);
      if (said === null || said !== want) return no('Wait for the user to actually answer yes or no.');
      const id = String(args.id || store.pending[0]?.id || '');
      if (want && !store.enabled) return no(offMsg);
      const r = resolvePending(id, want);
      if (r === undefined) return no('No pending memory question found.');
      return ok(want ? `Saved to ${CATEGORIES[r!.category]} as CONFIRMED.` : "Not saved. It won't be stored.");
    }

    case 'update_memory': {
      if (!consent.askedToCorrect(at)) return no('Only update a memory when the user corrects it or asks you to.');
      if (isSecret(text)) return no('Secrets are never stored.');
      const m = updateMemory(String(args.id), { text, category: args.category, confirm: true });
      return m ? ok(`Updated (${CATEGORIES[m.category]}).`, { memory: m }) : no('No memory with that id; use recall_memory to find it.');
    }

    case 'forget_memory': {
      const all = Boolean(args.all);
      if (!consent.askedToForget(all, at)) {
        return no(all ? 'Clearing ALL memory needs the user to clearly say they want everything cleared. Ask them to confirm.' : 'Only delete memories when the user asks you to.');
      }
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : undefined;
      const cat = args.category ? normCategory(args.category) : null;
      if (!all && !cat && !ids?.length) return no('Say which memories: ids, a category, or all.');
      const removed = deleteMemories({ ids, category: cat ?? undefined, all });
      return ok(`Deleted ${removed} memor${removed === 1 ? 'y' : 'ies'}. They are gone from future recall.`);
    }
  }
  return no(`Unknown memory tool ${name}`);
}
