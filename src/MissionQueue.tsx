import React, { useEffect, useState } from 'react';
import { Crosshair, Pause, Play, CircleDot, CirclePlus, CheckCircle2, XCircle, Loader2, User, Wrench, FileText, Check } from 'lucide-react';

// Mission Queue: the agent team's real tasks (agentSystem via /api/tasks). Pause / resume use
// the existing JARVIS control endpoint. Nothing here is sample data.

interface Step { agentId: string; instruction: string; status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'; error?: string }
interface Task {
  id: string;
  title: string;
  status: 'QUEUED' | 'DECOMPOSING' | 'IN_PROGRESS' | 'VERIFYING' | 'COMPLETED' | 'FAILED';
  mode: 'STANDARD' | 'SWARM';
  assignees: string[];
  steps: Step[];
  blockers: string[];
  paused: boolean;
  createdAt: string;
  completedAt?: string;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
/** Task times come as ISO strings or as bare local times ("01:02:38", today). */
const when = (v?: string) => {
  if (!v) return NaN;
  const iso = Date.parse(v);
  if (!Number.isNaN(iso)) return iso;
  const m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return NaN;
  const d = new Date();
  let h = +m[1] % 12 + (m[4]?.toUpperCase() === 'PM' ? 12 : 0);
  if (!m[4]) h = +m[1];
  d.setHours(h, +m[2], +(m[3] ?? 0), 0);
  if (d.getTime() > Date.now() + 60_000) d.setDate(d.getDate() - 1); // started before midnight
  return d.getTime();
};
const elapsed = (t: Task, now: number) => { const s = when(t.createdAt); return Number.isNaN(s) ? '--:--:--' : clock(now - s); };
const pct = (t: Task) => (t.steps.length ? Math.round((t.steps.filter((s) => s.status === 'COMPLETED').length / t.steps.length) * 100) : 0);
const agentOf = (t: Task) => t.steps.find((s) => s.status === 'RUNNING')?.agentId ?? t.assignees[0] ?? 'NEX';

export const MissionQueue: React.FC = () => {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = () =>
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((d) => { setTasks(d.tasks ?? []); setError(null); })
      .catch(() => setError('Mission link lost. Retrying…'));

  useEffect(() => {
    load();
    const poll = setInterval(load, 2000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  const control = async (t: Task) => {
    setBusy(t.id);
    try {
      const r = await fetch('/api/agents/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: t.paused ? 'resume' : 'pause', taskId: t.id }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.message || 'Control failed');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const active = (tasks ?? []).filter((t) => t.status === 'IN_PROGRESS' || t.status === 'VERIFYING' || t.status === 'DECOMPOSING');
  const queued = (tasks ?? []).filter((t) => t.status === 'QUEUED');
  const done = (tasks ?? []).filter((t) => t.status === 'COMPLETED' || t.status === 'FAILED').slice(0, 12);

  const head = (label: string, icon: React.ReactNode, glow: string, count?: number) => (
    <div className="flex items-center justify-between mb-2">
      <span className={`jv-mq-label ${glow}`}>{icon}{label}</span>
      {count !== undefined && <span className="jv-count">{count}</span>}
    </div>
  );
  const doneAt = (t: Task) => (Number.isNaN(when(t.completedAt)) ? '' : new Date(when(t.completedAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));

  return (
    <div className="jv-hud">
      <div className="jv-hud-head">
        <div className="jv-hud-title"><Crosshair className="w-4 h-4" /><span><span className="jv-t-full">Mission Queue</span><span className="jv-t-short">Missions</span></span></div>
        <span className="jv-live-pill jv-glow-g"><i />LIVE</span>
      </div>
      <div className="jv-hud-body flex flex-col">
        {error && <div className="text-[10px] text-rose-300 mb-2 jv-mono">{error}</div>}
        {tasks === null ? (
          <div className="text-[11px] text-[var(--dgray)] flex items-center gap-1.5 jv-mono"><Loader2 className="w-3.5 h-3.5 animate-spin" />Linking to NEX…</div>
        ) : (
          <>
            {/* ACTIVE */}
            <div className="jv-mq-active shrink-0">
              {head('Active', <CircleDot className="w-3.5 h-3.5 drop-shadow-[0_0_4px_var(--dy)]" />, 'jv-glow-y', active.length || undefined)}
              {active.length === 0 && <div className="text-[10.5px] text-[var(--dgray-l)] jv-mono leading-snug">No active missions. Ask JARVIS to delegate a task.</div>}
              {active.map((t, i) => (
                <div key={t.id} className={`min-w-0 ${i ? 'mt-3 pt-3 border-t border-[var(--dc)]/20' : ''}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-start gap-1.5 min-w-0">
                      <User className="w-4 h-4 text-[var(--dc)] shrink-0" />
                      <span className="jv-glow-c font-bold tracking-wide text-[12.5px] leading-tight break-words min-w-0">{t.title.toUpperCase()}</span>
                    </div>
                    {t.status !== 'DECOMPOSING' && (
                      <button onClick={() => control(t)} disabled={busy === t.id} className="jv-icon-btn ring w-7 h-7" title={t.paused ? 'Resume mission' : 'Pause mission'} aria-label={t.paused ? 'Resume mission' : 'Pause mission'}>
                        {busy === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : t.paused ? <Play className="w-3 h-3" fill="currentColor" /> : <Pause className="w-3 h-3" fill="currentColor" />}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-[18px] h-[18px] rounded-full border border-[var(--dc)] grid place-items-center shrink-0"><Wrench className="w-2.5 h-2.5 text-[var(--dc)]" /></span>
                      <span className="text-[var(--dc)] text-[11.5px] font-semibold tracking-wide truncate">{agentOf(t)}{t.mode === 'SWARM' ? ' // SWARM' : ''}{t.paused ? ' // PAUSED' : ''}</span>
                    </span>
                    <span className="jv-glow-c jv-mono font-bold text-[11px] shrink-0">{pct(t)}%</span>
                  </div>
                  <div className="jv-progress mb-1.5"><div style={{ width: `${pct(t)}%` }} /></div>
                  <div className="flex justify-between gap-2 text-[11px]">
                    <span className="text-gray-300 tracking-wide truncate">{t.status === 'DECOMPOSING' ? 'NEX is planning…' : t.blockers[0] ?? t.steps.find((s) => s.status === 'RUNNING')?.instruction ?? t.status}</span>
                    <span className="text-[var(--dgray)] jv-mono shrink-0">{elapsed(t, now)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* QUEUED */}
            <div className="mt-4 px-0.5 shrink-0">
              {head('Queued', <CirclePlus className="w-3.5 h-3.5 drop-shadow-[0_0_3px_var(--dy)]" />, 'jv-glow-y', queued.length)}
              <div className="flex flex-col gap-2">
                {queued.length === 0 && <div className="text-[10.5px] text-[var(--dgray)] jv-mono">Nothing waiting.</div>}
                {queued.map((t) => (
                  <div key={t.id} className="jv-mq-card">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-[var(--dc)] shrink-0 drop-shadow-[0_0_2px_var(--dc)]" />
                      <span className="text-[var(--dc)] font-bold tracking-wide text-[12px] truncate">{t.title.toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-1.5 pl-5 mt-1"><span className="jv-mq-dot" /><span className="text-gray-300 text-[10.5px] tracking-wide truncate">{agentOf(t)}</span></div>
                    <div className="flex justify-between items-center text-[10.5px] pl-5 mt-0.5">
                      <span className="text-[var(--dgray)] uppercase tracking-widest font-semibold">Waiting</span>
                      <span className="text-[var(--dgray)] jv-mono">{elapsed(t, now)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="jv-sep my-4 opacity-70" />

            {/* COMPLETED */}
            <div className="px-0.5 pb-1 shrink-0">
              {head('Completed', <CheckCircle2 className="w-3.5 h-3.5 drop-shadow-[0_0_3px_var(--dg)]" />, 'jv-glow-g', done.length)}
              {done.length === 0 && <div className="text-[10.5px] text-[var(--dgray)] jv-mono">No finished missions yet.</div>}
              <div className="flex flex-col">
                {done.map((t, i) => (
                  <React.Fragment key={t.id}>
                    {i > 0 && <div className="border-b border-[var(--dc)]/20 ml-6 my-2" />}
                    <div className="min-w-0" title={t.status === 'FAILED' ? `Failed: ${t.steps.find((s) => s.error)?.error ?? 'see the conversation for details'}` : undefined}>
                      <div className="flex items-center gap-2 mb-1 min-w-0">
                        <span className={`jv-mq-check ${t.status === 'FAILED' ? 'fail' : ''}`}>{t.status === 'FAILED' ? <XCircle className="w-2.5 h-2.5" strokeWidth={3} /> : <Check className="w-2.5 h-2.5" strokeWidth={3} />}</span>
                        <span className="text-gray-300 font-semibold tracking-wide text-[11.5px] truncate">{t.title.toUpperCase()}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2 pl-6">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="jv-mq-dot" />
                          <span className="text-[var(--dgray-l)] text-[10px] truncate max-w-[70px]">{agentOf(t)}</span>
                          <span className={`text-[10px] tracking-widest uppercase font-bold ${t.status === 'FAILED' ? 'text-rose-300' : 'jv-glow-g'}`}>{t.status === 'FAILED' ? 'Failed' : 'Complete'}</span>
                        </span>
                        <span className="text-[var(--dgray)] text-[10.5px] jv-mono shrink-0">{doneAt(t)}</span>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
