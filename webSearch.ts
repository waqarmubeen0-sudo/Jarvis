// Where Orbit gets search results from. Scraping search engines from a headless browser is
// unreliable (they serve junk results to bots) and against their terms, so results come from
// sanctioned sources, and Orbit then opens and reads the actual pages itself:
//   1. Gemini with Google Search grounding (the project's existing Gemini key)
//   2. Wikipedia's public search API (no key) - fallback when Gemini is unavailable
import { GoogleGenAI } from '@google/genai';
import { textModel, tracked } from './apiSettings';
import { credential } from './credentials';

export interface SearchHit { title: string; url: string }
export interface SearchResults { provider: 'Google (via Gemini grounding)' | 'Wikipedia'; hits: SearchHit[] }

async function viaGemini(query: string): Promise<SearchHit[]> {
  const apiKey = credential('GEMINI_API_KEY');
  if (!apiKey) return [];
  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  const r = await tracked(textModel(), () => ai.models.generateContent({
    model: textModel(),
    contents: [{ role: 'user', parts: [{ text: `Search the web for: ${query}\nList the most relevant, authoritative sources.` }] }],
    config: { tools: [{ googleSearch: {} }] },
  }));
  const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  return chunks
    .map((c: any) => ({ title: String(c.web?.title || c.web?.domain || 'Source'), url: String(c.web?.uri || '') }))
    .filter((h: SearchHit) => /^https?:/.test(h.url) && !seen.has(h.title) && seen.add(h.title));
}

async function viaWikipedia(query: string): Promise<SearchHit[]> {
  const api = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=${encodeURIComponent(query)}`;
  const res = await fetch(api, { headers: { 'User-Agent': 'JARVIS-Orbit/1.0 (personal assistant research)' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const data = (await res.json()) as { query?: { search?: { title: string }[] } };
  return (data.query?.search ?? []).map((s) => ({ title: s.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}` }));
}

export async function findSources(query: string): Promise<SearchResults> {
  try {
    const hits = await viaGemini(query);
    if (hits.length) return { provider: 'Google (via Gemini grounding)', hits };
  } catch (e) {
    console.warn('[Orbit] Gemini search unavailable, using Wikipedia:', (e as Error).message.slice(0, 120));
  }
  return { provider: 'Wikipedia', hits: await viaWikipedia(query) };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A results page Orbit shows on its own screen: the real hits, from the named provider. */
export function resultsPage(query: string, r: SearchResults) {
  const rows = r.hits.map((h, i) => `<li><a href="${esc(h.url)}">${esc(h.title)}</a><div>${esc(h.url.replace(/^https?:\/\//, '').slice(0, 90))}</div></li>`).join('');
  return `data:text/html,${encodeURIComponent(`<html><head><title>${esc(query)} - Orbit search</title></head>
<body style="margin:0;background:#05080e;color:#cbd5e1;font-family:Segoe UI,Arial,sans-serif">
<div style="padding:28px 40px;border-bottom:1px solid #1e293b;background:#0a1220">
<div style="font:700 13px Consolas,monospace;letter-spacing:.25em;color:#38bdf8">ORBIT SEARCH</div>
<div style="margin-top:8px;font-size:26px;color:#f1f5f9">${esc(query)}</div>
<div style="margin-top:6px;font-size:13px;color:#64748b">${r.hits.length} results via ${esc(r.provider)}</div></div>
<ol style="padding:14px 40px 14px 64px;font-size:18px;line-height:1.35">${rows || '<li>No results</li>'}</ol>
<style>li{margin:14px 0}a{color:#7dd3fc;text-decoration:none}li div{font-size:13px;color:#4ade80;opacity:.75}</style>
</body></html>`)}`;
}

/** Readable text of an HTML page (scripts, styles, navigation chrome removed). */
export const htmlToText = (html: string) => html
  .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

/** Research without a browser window: find sources, fetch and read the top ones. */
export async function fetchResearch(query: string, maxSources = 3) {
  const found = await findSources(query);
  const sources: { title: string; url: string; excerpt: string }[] = [];
  for (const h of found.hits) {
    if (sources.length >= maxSources) break;
    try {
      const res = await fetch(h.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JARVIS-research', 'Accept-Language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
      if (!res.ok || !/html|text/i.test(res.headers.get('content-type') ?? '')) continue;
      const text = htmlToText(await res.text());
      if (text.length < 200) continue;
      sources.push({ title: h.title, url: res.url || h.url, excerpt: text.slice(0, 3000) });
    } catch {}
  }
  return { query, provider: found.provider, sources, otherResults: found.hits.slice(sources.length, sources.length + 4) };
}
