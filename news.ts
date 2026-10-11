// Live international headlines for the TODAY HEADLINES panel.
// Server-side, so there is no browser CORS problem and no API key in the page.
//   - NEWSAPI_KEY set (credentials.ts) -> NewsAPI top headlines from international outlets
//   - otherwise                -> free public world-news RSS feeds (no key needed)
//   - everything unreachable   -> clearly labelled sample headlines
// Results are cached for 5 minutes.
import { credential } from './credentials';

export interface Headline {
  title: string;
  source: string; // short badge, e.g. BBC
  sourceName: string; // full outlet name
  url: string;
  publishedAt: string; // ISO time
}

export interface HeadlinesResult {
  mode: 'newsapi' | 'rss' | 'sample';
  fetchedAt: string;
  items: Headline[];
}

const FEEDS = [
  { source: 'BBC', sourceName: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'AJE', sourceName: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { source: 'DW', sourceName: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-en-world' },
  { source: 'GRD', sourceName: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
  { source: 'NPR', sourceName: 'NPR', url: 'https://feeds.npr.org/1004/rss.xml' },
];
const MAX_ITEMS = 10;
const TTL_MS = 5 * 60 * 1000;

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};

/** Parse RSS 2.0 / RDF items into headlines (items without a title or valid date are skipped). */
export function parseFeed(xml: string, source: string, sourceName: string): Headline[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return items.flatMap((it) => {
    const title = tag(it, 'title');
    const when = new Date(tag(it, 'pubDate') || tag(it, 'dc:date'));
    if (!title || isNaN(when.getTime())) return [];
    return [{ title, source, sourceName, url: tag(it, 'link') || tag(it, 'guid'), publishedAt: when.toISOString() }];
  });
}

/** One story per title; outlets interleaved (each outlet's newest first) so no single source dominates. */
export function pickTop(all: Headline[], n = MAX_ITEMS): Headline[] {
  const seen = new Set<string>();
  return all
    .filter((h) => {
      const k = h.title.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .reduce<Headline[][]>((rounds, h) => {
      // Round-robin across outlets: the k-th story of each outlet goes in round k.
      const k = rounds.findIndex((r) => !r.some((x) => x.source === h.source));
      (k < 0 ? rounds[rounds.push([]) - 1] : rounds[k]).push(h);
      return rounds;
    }, [])
    .flat()
    .slice(0, n);
}

async function get(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'JARVIS-Headlines/1.0' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}

async function fromNewsApi(key: string): Promise<Headline[]> {
  const url = `https://newsapi.org/v2/top-headlines?sources=bbc-news,al-jazeera-english,associated-press,reuters&pageSize=${MAX_ITEMS}`;
  const res = await fetch(url, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`NewsAPI HTTP ${res.status}`);
  const data = (await res.json()) as { articles?: { title?: string; url?: string; publishedAt?: string; source?: { name?: string } }[] };
  return (data.articles || [])
    .filter((a) => a.title && a.publishedAt)
    .map((a) => {
      const name = a.source?.name || 'News';
      return {
        title: a.title!.replace(/\s+-\s+[^-]+$/, ''), // NewsAPI appends " - Outlet"
        source: name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(),
        sourceName: name,
        url: a.url || '',
        publishedAt: new Date(a.publishedAt!).toISOString(),
      };
    });
}

async function fromRss(): Promise<Headline[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => parseFeed(await (await get(f.url)).text(), f.source, f.sourceName).slice(0, 6))
  );
  results.forEach((r, i) => r.status === 'rejected' && console.warn(`[headlines] ${FEEDS[i].source} feed failed:`, r.reason?.message));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

function sample(): Headline[] {
  const now = Date.now();
  return [
    'Live news sources are unreachable - showing sample headlines',
    'World leaders gather for climate summit as emissions talks resume',
    'Global markets steady as central banks signal pause on rate moves',
    'Humanitarian agencies scale up aid after severe flooding',
    'Space agencies announce joint mission to study Earth\'s oceans',
  ].map((title, i) => ({
    title,
    source: 'SAMPLE',
    sourceName: 'Offline sample',
    url: '',
    publishedAt: new Date(now - i * 17 * 60000).toISOString(),
  }));
}

let cache: HeadlinesResult | null = null;
let cacheAt = 0;

export async function getHeadlines(force = false): Promise<HeadlinesResult> {
  if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache;
  const key = credential('NEWSAPI_KEY');
  let result: HeadlinesResult | null = null;
  if (key) {
    try {
      const items = pickTop(await fromNewsApi(key));
      if (items.length) result = { mode: 'newsapi', fetchedAt: new Date().toISOString(), items };
    } catch (e) {
      console.warn('[headlines] NewsAPI failed, falling back to RSS:', (e as Error).message);
    }
  }
  if (!result) {
    const items = pickTop(await fromRss());
    if (items.length) result = { mode: 'rss', fetchedAt: new Date().toISOString(), items };
  }
  // Keep serving the last good headlines through a temporary outage before using samples.
  result ??= cache ?? { mode: 'sample', fetchedAt: new Date().toISOString(), items: sample() };
  cache = result;
  cacheAt = Date.now();
  return result;
}
