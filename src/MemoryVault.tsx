import React, { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Search, Trash2, X } from 'lucide-react';

// Contents of the MEMORY node modal: JARVIS's real long-term memory about the user (memory.ts),
// with the review / edit / delete / consent controls. Styled like the rest of the node modals.

interface Memory { id: string; category: string; text: string; status: 'CONFIRMED' | 'OBSERVED'; sensitive: boolean; createdAt: string; updatedAt: string }
interface Pending { id: string; category: string; text: string; sensitive: boolean; createdAt: string }
interface Snapshot { enabled: boolean; pending: Pending[]; categories: { id: string; label: string; enabled: boolean; items: Memory[] }[] }

const card = 'p-2 rounded bg-[#070b12] border border-[#1e2638]';
const chip = 'px-1.5 py-0.5 rounded border text-[9px] font-bold cursor-pointer transition-colors';
const on = 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40 hover:border-emerald-400/70';
const off = 'text-slate-400 border-slate-600/40 bg-slate-900/60 hover:border-slate-400/60';
const when = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

async function call(method: string, url: string, body?: unknown): Promise<Snapshot> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.snapshot ?? data;
}

export const MemoryVault: React.FC = () => {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [adding, setAdding] = useState('');

  const act = useCallback(async (method: string, url: string, body?: unknown) => {
    try {
      setSnap(await call(method, url, body));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Live while the modal is open, so saves made by voice show up without reopening.
  useEffect(() => {
    act('GET', '/api/memory');
    const t = setInterval(() => act('GET', '/api/memory'), 3000);
    return () => clearInterval(t);
  }, [act]);

  if (!snap) return <div className={`${card} font-mono text-xs text-slate-500 mb-4`}>{error ?? 'Loading memory…'}</div>;

  const q = filter.trim().toLowerCase();
  const total = snap.categories.reduce((n, c) => n + c.items.length, 0);
  const cats = snap.categories.map((c) => ({ ...c, shown: q ? c.items.filter((m) => m.text.toLowerCase().includes(q)) : c.items }));

  return (
    <div className="flex flex-col gap-2 font-mono text-xs text-slate-300 mb-4">
      {/* Master switch */}
      <div className={`${card} flex items-center justify-between`}>
        <div>
          <span className="text-cyan-400 font-bold block">LONG-TERM MEMORY</span>
          <span className="text-[10px] text-slate-400">{total} memories // {snap.enabled ? 'learning about you' : 'nothing new is saved'}</span>
        </div>
        <button
          onClick={() => act('POST', '/api/memory/settings', { enabled: !snap.enabled })}
          className={`${chip} ${snap.enabled ? on : 'text-rose-300 border-rose-500/40 bg-rose-950/40 hover:border-rose-400/70'}`}
          aria-pressed={snap.enabled}
          title={snap.enabled ? 'Turn off: JARVIS stops saving new memories (existing ones stay)' : 'Turn on long-term memory'}
        >
          {snap.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Ask before saving */}
      {snap.pending.map((p) => (
        <div key={p.id} className="p-2 rounded bg-[#070b12] border border-amber-500/40">
          <span className="text-amber-400 font-bold block">SHOULD I REMEMBER THIS? // {p.category}{p.sensitive ? ' // PRIVATE' : ''}</span>
          <span className="block mb-1.5">{p.text}</span>
          <div className="flex gap-1.5">
            <button onClick={() => act('POST', `/api/memory/pending/${p.id}`, { save: true })} className={`${chip} ${on}`}>SAVE</button>
            <button onClick={() => act('POST', `/api/memory/pending/${p.id}`, { save: false })} className={`${chip} ${off}`}>DON'T SAVE</button>
          </div>
        </div>
      ))}

      <div className={`${card} flex items-center gap-1.5`}>
        <Search className="w-3 h-3 text-slate-500 shrink-0" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search memories…"
          className="bg-transparent outline-none w-full text-[11px] text-slate-200 placeholder:text-slate-600"
        />
      </div>

      {error && <div className="text-[10px] text-rose-400 bg-rose-950/30 px-2 py-1 rounded border border-rose-500/30">{error}</div>}

      {/* Categories */}
      <div className="flex flex-col gap-1.5 max-h-[46vh] overflow-y-auto pr-0.5">
        {cats.filter((c) => !q || c.shown.length).map((c) => {
          const expanded = open === c.id || (!!q && c.shown.length > 0);
          return (
            <div key={c.id} className={card}>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex items-center gap-1 flex-1 min-w-0 text-left cursor-pointer">
                  {expanded ? <ChevronDown className="w-3 h-3 text-cyan-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-cyan-400 shrink-0" />}
                  <span className={`font-bold truncate ${c.enabled ? 'text-cyan-400' : 'text-slate-500'}`}>{c.label.toUpperCase()}</span>
                  <span className="text-[10px] text-slate-500">{c.items.length}</span>
                </button>
                <button
                  onClick={() => act('POST', '/api/memory/settings', { category: c.id, categoryEnabled: !c.enabled })}
                  className={`${chip} ${c.enabled ? on : off}`}
                  aria-pressed={c.enabled}
                  title={c.enabled ? 'JARVIS may learn things in this category' : 'JARVIS will not save anything here on his own'}
                >
                  {c.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>

              {expanded && (
                <div className="flex flex-col gap-1 mt-1.5">
                  {c.shown.length === 0 && <span className="text-[10px] text-slate-500">Nothing stored yet.</span>}
                  {c.shown.map((m) => (
                    <div key={m.id} className="border-t border-[#1e2638] pt-1">
                      {editing?.id === m.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={editing.text}
                            onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') act('PATCH', `/api/memory/items/${m.id}`, { text: editing.text, confirm: true }).then(() => setEditing(null));
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            className="flex-1 bg-[#0e1420] border border-[#263448] rounded px-1 py-0.5 text-[11px] text-slate-200 outline-none"
                          />
                          <button title="Save" onClick={() => act('PATCH', `/api/memory/items/${m.id}`, { text: editing.text, confirm: true }).then(() => setEditing(null))} className="text-emerald-300 hover:text-white cursor-pointer"><Check className="w-3 h-3" /></button>
                          <button title="Cancel" onClick={() => setEditing(null)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1">
                          <span className="flex-1 text-[11px] leading-snug">{m.text}</span>
                          {m.status === 'OBSERVED' && (
                            <button title="That's right: mark as confirmed" onClick={() => act('PATCH', `/api/memory/items/${m.id}`, { confirm: true })} className="text-emerald-300/80 hover:text-white cursor-pointer"><Check className="w-3 h-3" /></button>
                          )}
                          <button title="Edit" onClick={() => setEditing({ id: m.id, text: m.text })} className="text-cyan-300/80 hover:text-white cursor-pointer"><Pencil className="w-3 h-3" /></button>
                          <button title="Forget this" onClick={() => act('DELETE', `/api/memory/items/${m.id}`)} className="text-rose-300/80 hover:text-rose-200 cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      )}
                      <span className="text-[9px] text-slate-500">
                        <span className={m.status === 'CONFIRMED' ? 'text-emerald-400/80' : 'text-amber-400/80'} title={m.status === 'CONFIRMED' ? 'You told JARVIS or approved it' : "JARVIS's impression, not confirmed by you"}>
                          {m.status}
                        </span>
                        {m.sensitive ? ' // PRIVATE' : ''} // {m.updatedAt !== m.createdAt ? `updated ${when(m.updatedAt)}` : `saved ${when(m.createdAt)}`}
                      </span>
                    </div>
                  ))}

                  {!q && (
                    <div className="flex items-center gap-1 border-t border-[#1e2638] pt-1">
                      <Plus className="w-3 h-3 text-slate-500 shrink-0" />
                      <input
                        value={open === c.id ? adding : ''}
                        onChange={(e) => setAdding(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && adding.trim()) act('POST', '/api/memory/items', { category: c.id, text: adding }).then(() => setAdding(''));
                        }}
                        placeholder="Add a memory (Enter)…"
                        className="flex-1 bg-transparent outline-none text-[11px] text-slate-200 placeholder:text-slate-600"
                      />
                      {c.items.length > 0 && (
                        <button
                          onClick={() => window.confirm(`Forget everything in ${c.label}?`) && act('DELETE', `/api/memory/categories/${c.id}`)}
                          className="text-[9px] text-rose-300/80 hover:text-rose-200 cursor-pointer shrink-0"
                        >
                          CLEAR CATEGORY
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[9px] text-slate-500">
        <span>
          <span className="text-emerald-400/80">CONFIRMED</span> = you approved · <span className="text-amber-400/80">OBSERVED</span> = JARVIS's impression · temporary details are never stored
        </span>
        {total > 0 && (
          <button
            onClick={() => window.confirm('Clear ALL long-term memory? This cannot be undone.') && act('DELETE', '/api/memory?confirm=ALL')}
            className="text-rose-300/80 hover:text-rose-200 cursor-pointer shrink-0 ml-2"
          >
            CLEAR ALL
          </button>
        )}
      </div>
    </div>
  );
};
