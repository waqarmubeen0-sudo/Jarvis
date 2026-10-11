// Media Player (YouTube search), JARVIS Humor and Arcade Trivia.
// Content comes from Gemini (the project's key) when it's available; humor and trivia fall back
// to a small built-in set when Gemini is busy, and every reply says which source it came from.
import { GoogleGenAI } from '@google/genai';

import { textModel, tracked } from './apiSettings';
import { generate } from './generate';
const client = (apiKey: string) => new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });

// ---------------------------------------------------------------------------------------------
// YouTube

export interface Video { id: string; title: string; author: string }
const ID = /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/g;

/** Every YouTube video id in a text, in order, without repeats. */
export function youtubeIds(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text).matchAll(ID)) if (!out.includes(m[1])) out.push(m[1]);
  if (!out.length && /^[\w-]{11}$/.test(String(text).trim())) out.push(String(text).trim());
  return out;
}

/** Confirms a video exists and is embeddable, via YouTube's public oEmbed endpoint. */
async function oembed(id: string): Promise<Video | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { title?: string; author_name?: string };
    return { id, title: String(d.title ?? 'YouTube video'), author: String(d.author_name ?? '') };
  } catch {
    return null;
  }
}

/** A link or id plays directly; words are searched with Gemini + Google Search grounding. */
export async function youtubeSearch(query: string, apiKey: string): Promise<{ videos: Video[]; source: string }> {
  const q = String(query ?? '').trim().slice(0, 200);
  if (!q) throw new Error('What should I look for?');
  let ids = youtubeIds(q);
  let source = 'link';
  if (!ids.length) {
    if (!apiKey) throw new Error('YouTube search needs the Gemini key. Paste a YouTube link instead.');
    source = 'Google (via Gemini grounding)';
    const ask = (grounded: boolean) => tracked(textModel(), () => client(apiKey).models.generateContent({
      model: textModel(),
      contents: [{ role: 'user', parts: [{ text: `Find YouTube videos for: ${q}\nReply with up to ${grounded ? 5 : 8} full YouTube watch URLs (https://www.youtube.com/watch?v=...), one per line, best match first. URLs only.` }] }],
      config: grounded ? { tools: [{ googleSearch: {} }] } : {},
    }));
    // Search grounding has its own quota. Without it, Gemini answers from memory; every id is
    // still checked against YouTube below, so only real, playable videos are shown.
    const r = await ask(true).catch(async (e) => {
      if (!/429|RESOURCE_EXHAUSTED|quota/i.test(String(e?.message))) throw e;
      source = 'Gemini (ungrounded, verified on YouTube)';
      return ask(false);
    });
    ids = youtubeIds(r.text ?? '');
    // Grounding sources are redirect links: follow them to find more video ids.
    const chunks = (r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c: any) => String(c.web?.uri ?? '')).filter(Boolean).slice(0, 8);
    const resolved = await Promise.all(chunks.map(async (u) => {
      try {
        const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        return res.headers.get('location') ?? '';
      } catch { return ''; }
    }));
    for (const id of youtubeIds(resolved.join('\n'))) if (!ids.includes(id)) ids.push(id);
  }
  const videos = (await Promise.all(ids.slice(0, 6).map(oembed))).filter((v): v is Video => !!v);
  return { videos, source };
}

// ---------------------------------------------------------------------------------------------
// Humor

export const HUMOR_KINDS = ['JOKE', 'ROAST', 'SARCASM', 'DAD JOKE', 'RANDOM', 'FUN FACT'] as const;
export type HumorKind = (typeof HUMOR_KINDS)[number];

const STASH: Record<HumorKind, string[]> = {
  JOKE: [
    "Why don't skeletons fight each other? They don't have the guts.",
    "I told my computer I needed a break. It said: 'No problem, I'll go to sleep.'",
    'Why did the developer go broke? Because he used up all his cache.',
    "There are 10 types of people: those who understand binary and those who don't.",
  ],
  ROAST: [
    "Your browser has more open tabs than you have finished projects. I say that with love.",
    "Boss, you debug like a detective who suspects everyone except the actual culprit: you.",
    "Your sleep schedule is less of a schedule and more of a rumour.",
  ],
  SARCASM: [
    "Oh sure, let's deploy on a Friday evening. What could possibly go wrong?",
    "Yes, 'it works on my machine' is exactly what I'll tell the users.",
    "Another meeting that could have been an email. Truly, my favourite genre.",
  ],
  'DAD JOKE': [
    "I'm reading a book about anti-gravity. It's impossible to put down.",
    'What do you call a fake noodle? An impasta.',
    "I only know 25 letters of the alphabet. I don't know y.",
  ],
  RANDOM: [
    "If I had a body, I'd still refuse to fold laundry. Some things are beneath even an AI.",
    'I ran the numbers: 73% of statistics are made up on the spot. Including this one.',
  ],
  'FUN FACT': [
    'Octopuses have three hearts, and two of them stop beating when they swim.',
    'Honey never spoils: edible honey has been found in 3,000-year-old Egyptian tombs.',
    'A day on Venus is longer than its year.',
    'The first computer bug was an actual moth, found in a Harvard relay in 1947.',
  ],
};

export async function humor(kind: string, recent: string[] = []): Promise<{ kind: HumorKind; text: string; source: 'ai' | 'offline' }> {
  const k = (HUMOR_KINDS as readonly string[]).includes(String(kind).toUpperCase()) ? (String(kind).toUpperCase() as HumorKind) : 'JOKE';
  const pick = k === 'RANDOM' ? HUMOR_KINDS[Math.floor(Math.random() * 5)] : k;
  const ask: Record<HumorKind, string> = {
    JOKE: 'a short, genuinely funny clean joke',
    ROAST: "a playful, affectionate one-liner roast of the user (they build things on their PC and work late). Friendly, never mean",
    SARCASM: 'one dry, sarcastic one-liner about everyday life or tech',
    'DAD JOKE': 'one classic groan-worthy dad joke',
    RANDOM: 'something unexpected and funny in your own voice',
    'FUN FACT': 'one surprising, true fun fact (accurate, no made-up facts)',
  };
  try {
    const r = await generate(`You are J.A.R.V.I.S., the user's witty AI companion. Give ${ask[pick]}. Max 2 short sentences. Just the line, no preamble, no quotes.${recent.length ? `\nDon't repeat any of these: ${recent.slice(-8).join(' | ')}` : ''}`, { temperature: 1.1 });
    const text = r.replace(/^["“]|["”]$/g, '');
    if (text) return { kind: k, text, source: 'ai' };
  } catch {} // no key or the call failed: the offline stash below
  const pool = STASH[pick].filter((t) => !recent.includes(t));
  const list = pool.length ? pool : STASH[pick];
  return { kind: k, text: list[Math.floor(Math.random() * list.length)], source: 'offline' };
}

// ---------------------------------------------------------------------------------------------
// Trivia

export interface TriviaQ { question: string; options: string[]; answer: number; fact?: string }

const TRIVIA_STASH: TriviaQ[] = [
  { question: 'Which planet has the most known moons?', options: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'], answer: 1, fact: 'Saturn passed 140 confirmed moons in 2023.' },
  { question: 'What does "CPU" stand for?', options: ['Central Process Unit', 'Central Processing Unit', 'Computer Personal Unit', 'Core Processing Utility'], answer: 1 },
  { question: 'Who is credited with the first computer program?', options: ['Alan Turing', 'Grace Hopper', 'Ada Lovelace', 'Charles Babbage'], answer: 2 },
  { question: 'What is the chemical symbol for gold?', options: ['Go', 'Gd', 'Au', 'Ag'], answer: 2 },
  { question: 'How many bits are in a byte?', options: ['4', '8', '16', '32'], answer: 1 },
  { question: 'Which ocean is the largest?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answer: 3 },
  { question: 'In what year did the first iPhone launch?', options: ['2005', '2007', '2009', '2010'], answer: 1 },
  { question: 'What is the hardest natural substance?', options: ['Quartz', 'Diamond', 'Titanium', 'Graphene'], answer: 1 },
  { question: 'Which language runs natively in web browsers?', options: ['Python', 'Java', 'JavaScript', 'C#'], answer: 2 },
  { question: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], answer: 2 },
  { question: 'Which element has the atomic number 1?', options: ['Helium', 'Hydrogen', 'Oxygen', 'Carbon'], answer: 1 },
  { question: 'How many hearts does an octopus have?', options: ['1', '2', '3', '4'], answer: 2 },
];

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const valid = (q: any): q is TriviaQ =>
  q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length === 4 && q.options.every((o: unknown) => typeof o === 'string') && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4;

export async function trivia(count = 5): Promise<{ questions: TriviaQ[]; source: 'ai' | 'offline' }> {
  try {
    const r = await generate(`Write ${count} fun, accurate multiple-choice trivia questions (mixed: science, tech, space, geography, pop culture). JSON array: [{"question":"...","options":["a","b","c","d"],"answer":<index 0-3 of the correct option>,"fact":"one short true follow-up fact"}]. Vary which index is correct.`, { json: true, temperature: 1 });
    const qs = (JSON.parse(r || '[]') as unknown[]).filter(valid).slice(0, count);
    if (qs.length >= 3) return { questions: qs, source: 'ai' };
  } catch {} // no key or the call failed: the offline questions below
  return { questions: shuffle(TRIVIA_STASH).slice(0, count), source: 'offline' };
}
