import React, { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { useJarvisConfig, sectionTitle, hintClass } from '../settings/useJarvisConfig';
import { Segmented, Status } from '../settings/controls';

// THINKING node: reasoning depth (drives temperature + step-by-step guidance), a read-only live log
// of the latest task force's internal dialogue, and how full the conversation's context window is.

interface Log { id: string; timestamp: string; taskId: string; fromAgent: string; toAgent: string; message: string; type: string }
interface Step { agentId: string; instruction: string; status: string; result?: string; error?: string; helpedBy?: string }
interface Task { id: string; title: string; status: string; route?: string; mode?: string; assignees: string[]; steps: Step[] }

const DIALOGUE = new Set(['SWARM', 'HELP', 'EXECUTION', 'REPORT', 'DELEGATION', 'RESULT', 'ERROR']);
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export const ThinkingPanel: React.FC = () => {
  const { data, error, saving, save } = useJarvisConfig(4000);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);

  // Swarm consensus: the most recent task force (a running one first).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [t, a] = await Promise.all([fetch('/api/tasks').then((r) => r.json()), fetch('/api/agents').then((r) => r.json())]);
        if (!alive) return;
        const forces: Task[] = (t.tasks ?? []).filter((x: Task) => x.route === 'TASK_FORCE' || x.mode === 'SWARM');
        const pick = forces.find((x) => x.status !== 'COMPLETED' && x.status !== 'FAILED') ?? forces[0] ?? null;
        setTask(pick);
        setLogs(pick ? (a.logs ?? []).filter((l: Log) => l.taskId === pick.id && DIALOGUE.has(l.type)).reverse() : []);
      } catch { /* keep the last view */ }
    };
    poll();
    const iv = window.setInterval(poll, 2000);
    return () => { alive = false; window.clearInterval(iv); };
  }, []);

  const depth = data?.config.depth ?? null;
  const setDepth = async (d: 'FAST' | 'DEEP') => {
    const err = await save({ depth: d });
    setMsg(err ? { ok: false, text: err } : { ok: true, text: d === 'FAST' ? 'Fast Execution: temperature 0.2, direct answers.' : 'Deep Analysis: temperature 1.0, step-by-step reasoning.' });
  };

  const ctx = data?.context ?? null;
  const pct = ctx?.limit ? Math.min(100, (ctx.tokens / ctx.limit) * 100) : null;
  const live = task && task.status !== 'COMPLETED' && task.status !== 'FAILED';

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-5 h-5 text-rose-400" />
        <h3 className="font-mono-tech text-sm font-bold text-cyan-100 uppercase">J.A.R.V.I.S. Reasoning // THINKING</h3>
      </div>
      {error && <p className="text-[11px] font-mono text-rose-300 mb-2">{error}</p>}
      <div className="space-y-4 mb-4">
        <section className="space-y-1.5">
          <span className={sectionTitle}>Reasoning Depth</span>
          <Segmented
            label="Reasoning depth"
            value={depth === 'CUSTOM' ? null : depth}
            onChange={setDepth}
            disabled={!data || saving}
            options={[
              { id: 'FAST', name: 'Fast Execution', hint: 'Low temperature (0.2). Quick, direct, consistent.' },
              { id: 'DEEP', name: 'Deep Analysis', hint: 'High temperature (1.0) + step-by-step reasoning.' },
            ]}
          />
          {depth === 'CUSTOM' && (
            <p className={hintClass}>Currently custom: {data?.config.temperature === null ? 'model default temperature' : `temperature ${data?.config.temperature}`} (from API Settings). Pick a mode to override it.</p>
          )}
          <Status msg={msg} />
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className={sectionTitle}>Swarm Consensus</span>
            {task && <span className={`text-[10px] font-mono font-bold ${live ? 'text-orange-300 animate-pulse' : 'text-slate-400'}`}>{live ? 'LIVE' : task.status}</span>}
          </div>
          <div className="bg-[#03060a] border border-[#1a2332] rounded p-2 font-mono text-[10.5px] leading-relaxed max-h-52 overflow-y-auto" aria-live="polite" aria-label="Task force dialogue">
            {!task ? (
              <span className="text-slate-500">No task force yet. Give JARVIS a multi-disciplinary job and the Manager will form one.</span>
            ) : (
              <>
                <div className="text-cyan-200 mb-1">Task force: {task.assignees.join(' + ')} — “{task.title}”</div>
                {logs.map((l) => (
                  <div key={l.id} className="whitespace-pre-wrap break-words">
                    <span className="text-slate-500">[{l.timestamp}]</span> <span className="text-amber-200">{l.fromAgent} → {l.toAgent}:</span> <span className="text-slate-200">{l.message}</span>
                  </div>
                ))}
                {task.steps.map((s) => (
                  <div key={s.agentId} className="mt-1 pt-1 border-t border-[#1a2332]">
                    <span className={s.status === 'COMPLETED' ? 'text-emerald-300' : s.status === 'FAILED' ? 'text-rose-300' : 'text-orange-300'}>{s.agentId} [{s.status}]</span>{' '}
                    <span className="text-slate-400">{s.instruction}</span>
                    {s.result && <div className="text-slate-300 whitespace-pre-wrap line-clamp-4">{s.result}</div>}
                    {s.error && <div className="text-rose-300">{s.error}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
          <p className={hintClass}>Read-only: what the members tell each other and NEX while they work in parallel.</p>
        </section>

        <section className="space-y-1.5">
          <span className={sectionTitle}>Context Visualizer</span>
          {!ctx ? (
            <p className="text-[11px] font-mono text-slate-500">No conversation yet: talk to JARVIS (voice or chat) to see how full the context window is.</p>
          ) : (
            <>
              <div className="flex justify-between text-[11px] font-mono text-slate-300">
                <span>{ctx.source === 'voice' ? 'Voice session' : 'Text chat'} · {ctx.model}</span>
                <span className="text-cyan-100">{fmt(ctx.tokens)}{ctx.limit ? ` / ${fmt(ctx.limit)}` : ''} tokens{pct !== null ? ` (${pct < 1 ? pct.toFixed(1) : pct.toFixed(0)}%)` : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-[#070b12] border border-[#1e2638] overflow-hidden" role="progressbar" aria-label="Context window used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : Math.round(pct)}>
                <div className={`h-full ${pct !== null && pct >= 85 ? 'bg-rose-500' : pct !== null && pct >= 60 ? 'bg-amber-400' : 'bg-cyan-400'}`} style={{ width: `${pct === null ? 0 : Math.max(pct, 1)}%` }} />
              </div>
              <p className={hintClass}>{ctx.limit ? 'Prompt size of the latest turn (system instruction, memory, files and history) against the model\'s input limit.' : 'Gemini did not report an input limit for this model, so only the size is shown.'}</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
