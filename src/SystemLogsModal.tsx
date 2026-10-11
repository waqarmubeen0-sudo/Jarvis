import React, { useEffect, useRef, useState } from 'react';
import { X, ScrollText, Pause, Play, Loader2, Check, XCircle, Trash2 } from 'lucide-react';

// System Logs: the Manager's routing decisions and all agent traffic (from /api/agents), the raw
// server terminal (/api/logs), JARVIS's activity log (what it actually did, with confirmations to
// approve), active automations, and a global pause / resume for every open task.

interface AgentLog { id: string; timestamp: string; taskId: string; fromAgent: string; toAgent: string; message: string; type: string }
interface LogLine { at: number; level: 'log' | 'warn' | 'error'; text: string }
interface Activity { id: number; at: string; kind: 'ACTION' | 'TOOL' | 'RESULT' | 'ERROR' | 'CONFIRM'; text: string; actor: string }
interface Confirmation { id: string; tool: string; summary: string; reason: string; state: string; at: number }
interface Automation { id: string; kind: string; title: string; nextRun: string; every?: { n: number; unit: string }; watch?: { type: string; target: string }; runs: number; lastResult?: string }
interface Job { id: string; command: string; cwd: string; status: string }
type View = 'MANAGER' | 'ACTIVITY' | 'AUTOMATIONS' | 'SERVER';
const VIEW_LABEL: Record<View, string> = { MANAGER: 'MANAGER & AGENTS', ACTIVITY: 'ACTIVITY', AUTOMATIONS: 'AUTOMATIONS', SERVER: 'SERVER TERMINAL' };
const KINDS = ['ALL', 'ACTION', 'TOOL', 'RESULT', 'ERROR', 'CONFIRM'] as const;
const kindColor: Record<string, string> = { ACTION: 'text-cyan-300', TOOL: 'text-amber-300', RESULT: 'text-emerald-300', ERROR: 'text-rose-300', CONFIRM: 'text-violet-300' };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const FILTERS = {
  ALL: () => true,
  ROUTING: (l: AgentLog) => l.type === 'DELEGATION' || l.type === 'SWARM',
  REPORTS: (l: AgentLog) => l.type === 'REPORT',
  HELP: (l: AgentLog) => l.type === 'HELP',
  CONTROL: (l: AgentLog) => l.type === 'CONTROL' || l.type === 'ERROR',
} as const;
type Filter = keyof typeof FILTERS;

const typeColor: Record<string, string> = {
  DELEGATION: 'text-cyan-300', SWARM: 'text-orange-300', REPORT: 'text-emerald-300', HELP: 'text-pink-300',
  CONTROL: 'text-sky-300', ERROR: 'text-rose-300', EXECUTION: 'text-amber-300', RESULT: 'text-emerald-300', VERIFICATION: 'text-violet-300',
};

export const SystemLogsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [view, setView] = useState<View>('MANAGER');
  const [activity, setActivity] = useState<Activity[]>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('ALL');
  const [confirms, setConfirms] = useState<Confirmation[]>([]);
  const [autos, setAutos] = useState<{ automations: Automation[]; jobs: Job[] }>({ automations: [], jobs: [] });
  const lastActivity = useRef(0);
  const [filter, setFilter] = useState<Filter>('ROUTING');
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [open, setOpen] = useState<{ total: number; paused: number }>({ total: 0, paused: 0 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastAt = useRef(0);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [a, t, l, act, c, au] = await Promise.all([
          fetch('/api/agents').then((r) => r.json()),
          fetch('/api/tasks').then((r) => r.json()),
          fetch(`/api/logs?since=${lastAt.current}`).then((r) => r.json()),
          fetch(`/api/activity?since=${lastActivity.current}`).then((r) => r.json()).catch(() => ({ entries: [] })),
          fetch('/api/confirmations').then((r) => r.json()).catch(() => ({ confirmations: [] })),
          fetch('/api/automations').then((r) => r.json()).catch(() => ({ automations: [], jobs: [] })),
        ]);
        if (!alive) return;
        const freshAct: Activity[] = act.entries ?? [];
        if (freshAct.length) {
          lastActivity.current = freshAct[freshAct.length - 1].id;
          setActivity((prev) => [...prev, ...freshAct].slice(-500));
        }
        setConfirms(c.confirmations ?? []);
        setAutos({ automations: au.automations ?? [], jobs: au.jobs ?? [] });
        setLogs(a.logs ?? []);
        const openTasks = (t.tasks ?? []).filter((x: any) => x.status !== 'COMPLETED' && x.status !== 'FAILED');
        setOpen({ total: openTasks.length, paused: openTasks.filter((x: any) => x.paused).length });
        const fresh: LogLine[] = l.lines ?? [];
        if (fresh.length) {
          lastAt.current = fresh[fresh.length - 1].at;
          setLines((prev) => [...prev, ...fresh].slice(-400));
        }
        setError(null);
      } catch {
        if (alive) setError('Backend unreachable. Retrying…');
      }
    };
    poll();
    const iv = window.setInterval(poll, 2000);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener('keydown', esc); };
  }, [onClose]);

  useEffect(() => { if (view === 'SERVER' || view === 'ACTIVITY') bottom.current?.scrollIntoView({ block: 'end' }); }, [lines.length, activity.length, view]);

  const answer = async (id: string, approve: boolean) => {
    try {
      const r = await fetch(`/api/confirmations/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }) });
      const d = await r.json();
      setNote(r.ok ? (approve ? 'Approved: JARVIS will do it now.' : 'Declined.') : d.error);
      setConfirms((list) => list.map((x) => (x.id === id ? { ...x, state: approve ? 'APPROVED' : 'DENIED' } : x)));
    } catch { setNote('Could not reach the backend.'); }
  };
  const automation = async (id: string, op: 'run' | 'cancel') => {
    try {
      const r = await fetch(op === 'run' ? `/api/automations/${id}/run` : `/api/automations/${id}`, { method: op === 'run' ? 'POST' : 'DELETE' });
      const d = await r.json();
      setNote(r.ok ? (op === 'run' ? `Ran "${d.automation.title}": ${d.automation.lastResult ?? 'done'}` : `Cancelled "${d.automation.title}".`) : d.error);
      if (op === 'cancel' && r.ok) setAutos((x) => ({ ...x, automations: x.automations.filter((a) => a.id !== id) }));
    } catch { setNote('Could not reach the backend.'); }
  };
  const pending = confirms.filter((c) => c.state === 'PENDING');
  const shownActivity = kind === 'ALL' ? activity : activity.filter((a) => a.kind === kind);

  const pauseAll = async (paused: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch('/api/agents/pause-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) });
      const d = await r.json();
      setNote(d.tasks ? `${paused ? 'Paused' : 'Resumed'} ${d.tasks} task${d.tasks === 1 ? '' : 's'}.` : `No ${paused ? 'running' : 'paused'} tasks.`);
      setOpen((o) => ({ ...o, paused: paused ? o.total : 0 }));
    } catch {
      setNote('Could not reach the backend.');
    } finally {
      setBusy(false);
    }
  };

  // Agent logs arrive newest first; show them oldest → newest like a terminal.
  const shown = [...logs].filter(FILTERS[filter]).reverse();

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0b1018] border-2 border-cyan-500/50 rounded-xl p-4 w-full max-w-3xl h-[80vh] shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="System logs">
        <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-cyan-400" />
            <h3 className="font-mono-tech text-sm font-bold text-cyan-100 uppercase">System Logs // Manager &amp; Backend</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer" aria-label="Close system logs"><X className="w-5 h-5" /></button>
        </div>

        {/* Global override */}
        <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0 font-mono text-[11px]">
          <span className="text-slate-400">Open tasks: <b className="text-cyan-200">{open.total}</b>{open.paused ? <> · paused <b className="text-sky-300">{open.paused}</b></> : null}</span>
          <div className="flex-1" />
          <button onClick={() => pauseAll(true)} disabled={busy || open.total === open.paused} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-500/60 text-rose-200 bg-rose-950/40 hover:bg-rose-900/50 disabled:opacity-40 disabled:cursor-default cursor-pointer" title="Pause every open task (they resume where they stopped)">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}PAUSE ALL TASKS
          </button>
          <button onClick={() => pauseAll(false)} disabled={busy || !open.paused} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-500/60 text-emerald-200 bg-emerald-950/40 hover:bg-emerald-900/50 disabled:opacity-40 disabled:cursor-default cursor-pointer">
            <Play className="w-3.5 h-3.5" />RESUME ALL
          </button>
        </div>
        {note && <div className="text-[11px] font-mono text-cyan-200 mb-2 shrink-0">{note}</div>}

        {/* View + filter */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2 shrink-0 font-mono text-[11px]">
          {(['MANAGER', 'ACTIVITY', 'AUTOMATIONS', 'SERVER'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-2.5 py-1 rounded border cursor-pointer ${view === v ? 'border-cyan-400 text-cyan-100 bg-cyan-500/15' : 'border-[#263040] text-slate-400 hover:text-cyan-200'}`}>
              {VIEW_LABEL[v]}
              {v === 'ACTIVITY' && pending.length > 0 && <span className="ml-1 px-1 rounded bg-violet-500/40 text-violet-100">{pending.length}</span>}
              {v === 'AUTOMATIONS' && autos.automations.length > 0 && <span className="ml-1 text-slate-500">{autos.automations.length}</span>}
            </button>
          ))}
          {view === 'ACTIVITY' && <span className="w-px h-4 bg-[#263040] mx-1" />}
          {view === 'ACTIVITY' && KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={`px-2 py-0.5 rounded cursor-pointer ${kind === k ? 'text-cyan-100 bg-cyan-500/20' : 'text-slate-500 hover:text-cyan-200'}`}>{k}</button>
          ))}
          {view === 'MANAGER' && <span className="w-px h-4 bg-[#263040] mx-1" />}
          {view === 'MANAGER' && (Object.keys(FILTERS) as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`px-2 py-0.5 rounded cursor-pointer ${filter === f ? 'text-cyan-100 bg-cyan-500/20' : 'text-slate-500 hover:text-cyan-200'}`}>{f}</button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto bg-[#03060a] border border-[#1a2332] rounded p-2 font-mono text-[11px] leading-relaxed">
          {error && <div className="text-rose-300 mb-1">{error}</div>}
          {view === 'ACTIVITY' ? (
            <>
              {pending.map((c) => (
                <div key={c.id} className="mb-2 p-2 rounded border border-violet-500/50 bg-violet-950/30">
                  <div className="text-violet-200 font-bold">NEEDS YOUR OK <span className="font-normal text-slate-400">({c.reason})</span></div>
                  <div className="text-slate-100 whitespace-pre-wrap break-words my-1">{c.summary}</div>
                  <div className="flex gap-2">
                    <button onClick={() => answer(c.id, true)} className="flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-500/60 text-emerald-200 bg-emerald-950/40 hover:bg-emerald-900/50 cursor-pointer"><Check className="w-3.5 h-3.5" />APPROVE</button>
                    <button onClick={() => answer(c.id, false)} className="flex items-center gap-1 px-2.5 py-1 rounded border border-rose-500/60 text-rose-200 bg-rose-950/40 hover:bg-rose-900/50 cursor-pointer"><XCircle className="w-3.5 h-3.5" />DENY</button>
                  </div>
                </div>
              ))}
              {shownActivity.length ? shownActivity.map((a) => (
                <div key={a.id} className="whitespace-pre-wrap break-words">
                  <span className="text-slate-500">{hhmm(a.at)}</span>{' '}
                  <span className={`font-bold ${kindColor[a.kind] ?? 'text-slate-300'}`}>[{a.kind}]</span>{' '}
                  {a.actor !== 'JARVIS' && <span className="text-amber-200">{a.actor} </span>}
                  <span className={a.kind === 'ERROR' ? 'text-rose-200' : 'text-slate-200'}>{a.text}</span>
                </div>
              )) : <div className="text-slate-500">Nothing yet. Everything JARVIS does on your PC (actions, tools, results, errors, confirmations) is listed here.</div>}
            </>
          ) : view === 'AUTOMATIONS' ? (
            <>
              {autos.automations.length ? autos.automations.map((a) => (
                <div key={a.id} className="flex items-start gap-2 py-1 border-b border-[#1a2332]">
                  <span className="font-bold text-amber-300 w-20 shrink-0">{a.kind}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-100 break-words">{a.title}</div>
                    <div className="text-slate-500">
                      {a.watch ? `watching ${a.watch.type}: ${a.watch.target} · next check ${hhmm(a.nextRun)}` : `next ${new Date(a.nextRun).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                      {a.every ? ` · every ${a.every.n === 1 ? a.every.unit.replace(/s$/, '') : `${a.every.n} ${a.every.unit}`}` : ''}{a.runs ? ` · ran ${a.runs}×` : ''}{a.lastResult ? ` · ${a.lastResult}` : ''}
                    </div>
                  </div>
                  <button onClick={() => automation(a.id, 'run')} title="Run now" className="text-emerald-300 hover:text-emerald-100 cursor-pointer"><Play className="w-3.5 h-3.5" /></button>
                  <button onClick={() => automation(a.id, 'cancel')} title="Cancel" className="text-rose-300 hover:text-rose-100 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )) : <div className="text-slate-500">No active automations. Ask JARVIS: "remind me tomorrow at 9", "every Monday prepare my report", "tell me when this download finishes".</div>}
              {autos.jobs.length > 0 && <div className="mt-3 mb-1 text-cyan-300 font-bold">BACKGROUND PROCESSES</div>}
              {autos.jobs.map((j) => (
                <div key={j.id} className="break-words"><span className={j.status === 'RUNNING' ? 'text-emerald-300' : 'text-slate-500'}>[{j.status}]</span> <span className="text-amber-200">{j.id}</span> <span className="text-slate-200">{j.command}</span> <span className="text-slate-500">({j.cwd})</span></div>
              ))}
            </>
          ) : view === 'MANAGER' ? (
            shown.length ? shown.map((l) => (
              <div key={l.id} className="whitespace-pre-wrap break-words">
                <span className="text-slate-500">[{l.timestamp}]</span>{' '}
                <span className={`font-bold ${typeColor[l.type] ?? 'text-slate-300'}`}>[{l.type}]</span>{' '}
                <span className="text-amber-200">{l.fromAgent} → {l.toAgent}</span>{' '}
                <span className="text-slate-200">{l.message}</span>
              </div>
            )) : <div className="text-slate-500">No {filter === 'ALL' ? '' : filter.toLowerCase() + ' '}entries yet. Send JARVIS a request to see the Manager route it.</div>
          ) : (
            lines.length ? lines.map((l, i) => (
              <div key={`${l.at}-${i}`} className={`whitespace-pre-wrap break-words ${l.level === 'error' ? 'text-rose-300' : l.level === 'warn' ? 'text-amber-300' : 'text-emerald-200/90'}`}>
                <span className="text-slate-500">{new Date(l.at).toLocaleTimeString([], { hour12: false })}</span> {l.text}
              </div>
            )) : <div className="text-slate-500">Nothing logged since the server started.</div>
          )}
          <div ref={bottom} />
        </div>
      </div>
    </div>
  );
};
