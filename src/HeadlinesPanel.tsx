import React, { useCallback, useEffect, useState } from 'react';
import { Newspaper, Radio } from 'lucide-react';

interface Headline {
  title: string;
  source: string;
  sourceName: string;
  url: string;
  publishedAt: string;
}
interface HeadlinesResult {
  mode: 'newsapi' | 'rss' | 'sample';
  fetchedAt: string;
  items: Headline[];
}

const REFRESH_MS = 5 * 60 * 1000;
const SECONDS_PER_ITEM = 4; // carousel speed

/** Badge colour per outlet, in the panel's existing accent palette. */
const SOURCE_COLOR: Record<string, string> = {
  BBC: 'border-cyan-500/40 text-cyan-300',
  AJE: 'border-amber-500/40 text-amber-300',
  DW: 'border-blue-500/40 text-blue-300',
  GRD: 'border-purple-500/40 text-purple-300',
  NPR: 'border-emerald-500/40 text-emerald-300',
  SAMPLE: 'border-slate-500/40 text-slate-400',
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'JUST NOW' : m < 60 ? `${m} MIN AGO` : m < 1440 ? `${Math.floor(m / 60)} HR AGO` : `${Math.floor(m / 1440)} D AGO`;
};

export const HeadlinesPanel: React.FC = () => {
  const [data, setData] = useState<HeadlinesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/headlines${refresh ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // An HTML reply means the running server predates the /api/headlines route.
      if (!res.headers.get('content-type')?.includes('json')) throw new Error('RESTART J.A.R.V.I.S. SERVER TO ENABLE NEWS');
      const json = (await res.json()) as HeadlinesResult;
      if (!Array.isArray(json.items)) throw new Error('Bad response');
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message); // keep showing the last headlines we had
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(() => load(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30000); // keeps "N MIN AGO" current
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const items = data?.items ?? [];
  const live = data?.mode !== 'sample' && !error;
  const feedTitle = data
    ? `${data.mode === 'newsapi' ? 'NewsAPI' : data.mode === 'rss' ? 'BBC · Al Jazeera · DW · Guardian · NPR' : 'Sample headlines (sources unreachable)'}` +
      ` - updated ${clock(data.fetchedAt)}${error ? ` - last refresh failed: ${error}` : ''} - click to refresh`
    : 'Loading headlines…';

  const row = (h: Headline, key: string) => (
    <a
      key={key}
      href={h.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      title={`${h.sourceName}: ${h.title}`}
      className="headline-item flex items-start gap-2 cursor-pointer no-underline"
    >
      <span
        className={`text-[8.5px] font-mono px-1 py-0.2 rounded bg-slate-900 border uppercase font-bold shrink-0 mt-0.5 min-w-[30px] text-center ${
          SOURCE_COLOR[h.source] ?? 'border-cyan-500/40 text-cyan-300'
        }`}
      >
        {h.source}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono text-slate-300 leading-tight line-clamp-2">{h.title}</p>
        <span className="text-[8.5px] font-mono text-slate-500 mt-0.5 block">
          {clock(h.publishedAt)} // {ago(h.publishedAt, now)}
        </span>
      </div>
    </a>
  );

  return (
    <div className="jv-obsidian-panel p-2.5 flex flex-col gap-1.5 flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1e2638] pb-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <Newspaper className="w-3.5 h-3.5 text-cyan-400" />
          <h2 className="font-mono-tech text-xs font-bold text-cyan-100 tracking-wider uppercase">
            TODAY HEADLINES
          </h2>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          title={feedTitle}
          className={`flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.2 rounded border cursor-pointer transition-colors ${
            live
              ? 'text-amber-400 bg-amber-950/40 border-amber-500/30 hover:border-amber-400/60'
              : 'text-slate-400 bg-slate-900/60 border-slate-600/40 hover:border-slate-400/60'
          }`}
        >
          <Radio className={`w-2.5 h-2.5 ${live || loading ? 'animate-pulse' : ''}`} />
          <span>LIVE FEED</span>
        </button>
      </div>

      {/* Headlines carousel: scrolls upward continuously, pauses on hover */}
      <div className="headline-viewport flex-1 min-h-0">
        {items.length === 0 ? (
          <p className="font-mono text-[10px] text-cyan-300/70 p-2">
            {loading ? 'ACQUIRING GLOBAL NEWS FEED…' : `NEWS FEED UNAVAILABLE${error ? ` // ${error}` : ''}`}
          </p>
        ) : (
          <div className="headline-track" style={{ animationDuration: `${items.length * SECONDS_PER_ITEM}s` }}>
            {/* Two copies back to back: scrolling one list-height makes the loop seamless */}
            <div className="flex flex-col gap-1.5 pb-1.5">{items.map((h, i) => row(h, `a${i}`))}</div>
            <div className="flex flex-col gap-1.5 pb-1.5" aria-hidden="true">
              {items.map((h, i) => row(h, `b${i}`))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
