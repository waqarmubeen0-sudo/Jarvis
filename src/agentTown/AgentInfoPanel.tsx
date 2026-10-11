import React, { useEffect, useState } from 'react';
import { X, Send } from 'lucide-react';
import { TownSim } from './behavior';
import { STATE_COLOR } from './renderer';
import { ATLAS_URL } from './sprites';

interface Props {
  sim: TownSim;
  agentId: string;
  onClose: () => void;
  onDispatchTask: (prompt: string, targetAgent?: string) => void;
}

// Live card for one agent; re-reads the simulation (backed by the real agent store) twice a second.
export const AgentInfoPanel: React.FC<Props> = ({ sim, agentId, onClose, onDispatchTask }) => {
  const [info, setInfo] = useState(() => sim.describe(agentId));
  const [prompt, setPrompt] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // JARVIS override from the card: pause / resume this agent.
  const togglePause = async () => {
    if (!info) return;
    setBusy(true);
    try {
      await fetch('/api/agents/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: info.paused ? 'resume' : 'pause', agentId: info.id }),
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setInfo(sim.describe(agentId));
    const t = window.setInterval(() => setInfo(sim.describe(agentId)), 500);
    return () => window.clearInterval(t);
  }, [sim, agentId]);

  if (!info) return null;
  const color = STATE_COLOR[info.state];
  const pct = info.progress ? Math.round((info.progress.done / info.progress.total) * 100) : null;
  const p = info.portrait;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    onDispatchTask(text, info.id);
    setPrompt('');
    setSent(true);
    window.setTimeout(() => setSent(false), 2500);
  };

  return (
    <div className="agent-info-panel" role="dialog" aria-label={`${info.name} details`}>
      <div className="agent-info-head">
        <div
          className="agent-info-portrait"
          style={{
            backgroundImage: `url(${ATLAS_URL})`,
            backgroundPosition: `-${p.sx * 0.5}px -${p.sy * 0.5}px`,
            backgroundSize: `${1248 * 0.5}px auto`,
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="agent-info-name">{info.name}</div>
          <div className="agent-info-role">{info.role}</div>
          <div className="agent-info-status" style={{ color }}>
            <span style={{ background: color }} />
            {info.state.replace('_', ' ')}
          </div>
        </div>
        <button className="agent-info-close" onClick={onClose} aria-label="Close agent details">
          <X className="w-3 h-3" />
        </button>
      </div>

      <dl className="agent-info-grid">
        <dt>Mode</dt>
        <dd>
          {info.mode}
          <button type="button" className="agent-info-pause" onClick={togglePause} disabled={busy}
            title={info.paused ? 'Resume this agent' : 'Pause this agent (J.A.R.V.I.S. override)'}>
            {info.paused ? 'RESUME' : 'PAUSE'}
          </button>
        </dd>
        <dt>Backend status</dt><dd>{info.backendStatus}</dd>
        <dt>Current task</dt><dd title={info.currentTask}>{info.currentTask}</dd>
        <dt>Progress</dt>
        <dd>
          {pct === null ? '—' : (
            <span className="agent-info-progress">
              <span style={{ width: `${pct}%` }} />
              <b>{info.progress!.done}/{info.progress!.total} steps</b>
            </span>
          )}
        </dd>
        <dt>Location</dt><dd>{info.location}</dd>
        <dt>Activity</dt><dd title={info.activity}>{info.activity}</dd>
        <dt>Availability</dt><dd className={info.availability === 'Available' ? 'text-emerald-300' : info.availability === 'Busy' ? 'text-amber-300' : 'text-slate-400'}>{info.availability}</dd>
        <dt>Character</dt><dd>{info.character}</dd>
      </dl>

      <form className="agent-info-dispatch" onSubmit={submit}>
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={sent ? 'Assigned — NEX is tracking it…' : `Assign a task to ${info.name}…`}
          aria-label={`Assign a task to ${info.name}`}
        />
        <button type="submit" aria-label="Send task"><Send className="w-3 h-3" /></button>
      </form>
    </div>
  );
};
