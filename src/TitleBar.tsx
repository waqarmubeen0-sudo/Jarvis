import React, { useState, useEffect } from 'react';
import { useComputerState, requestMode } from './computerState';
import { Gauge, Users, Clock, Settings, ScrollText, SlidersHorizontal, Minus, Square, X, Shield, Eye, EyeOff } from 'lucide-react';
import { agentStore } from './agentTown/agentStore';

interface TitleBarProps {
  status: string;
  onToggleConnection: () => void;
  onOpenSettings: () => void;
  onOpenLogs: () => void;
  onOpenApiSettings: () => void;
}

interface Usage { calls: number; errors: number; promptTokens: number; outputTokens: number; totalTokens: number; lastLatencyMs: number | null; lastModel: string | null; lastRateLimitAt: number | null }
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const RATE_LIMIT_WINDOW = 10 * 60_000; // show the 429 warning for 10 minutes

export const TitleBar: React.FC<TitleBarProps> = ({
  status,
  onToggleConnection,
  onOpenSettings,
  onOpenLogs,
  onOpenApiSettings,
}) => {
  // Screen awareness: the SCREEN permission (Permission Center) and a live "looking now" signal.
  const [screen, setScreen] = useState<'ON' | 'ASK' | 'OFF' | null>(null);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((d) => setScreen(d.config?.permissions?.SCREEN ?? null)).catch(() => {});
    let t = 0;
    const onPerm = (e: Event) => setScreen((e as CustomEvent).detail);
    const onUse = () => { setLooking(true); window.clearTimeout(t); t = window.setTimeout(() => setLooking(false), 3000); };
    window.addEventListener('jarvis:screen-permission', onPerm);
    window.addEventListener('jarvis:screen-use', onUse);
    return () => { window.removeEventListener('jarvis:screen-permission', onPerm); window.removeEventListener('jarvis:screen-use', onUse); window.clearTimeout(t); };
  }, []);
  const toggleScreen = async () => {
    const next = screen === 'OFF' ? 'ON' : 'OFF';
    try {
      const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions: { SCREEN: next } }) });
      if (r.ok) setScreen(next);
    } catch {}
  };

  // Live API usage (latency / tokens of real Gemini calls) and agent availability (shared agent store).
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageModel, setUsageModel] = useState('');
  useEffect(() => {
    let alive = true;
    const poll = () => fetch('/api/usage').then((r) => r.json()).then((d) => { if (alive) { setUsage(d.usage); setUsageModel(d.model); } }).catch(() => {});
    poll();
    const iv = window.setInterval(poll, 3000);
    return () => { alive = false; window.clearInterval(iv); };
  }, []);
  useEffect(() => agentStore.acquire(), []);
  const [timeStr, setTimeStr] = useState<string>('');
  const computer = useComputerState();
  const mode = computer?.mode ?? 'DIRECT';
  const [switching, setSwitching] = useState(false);
  // Clicking the chip is an explicit switch (same as saying "JARVIS, Orbit mode").
  const toggleMode = async () => {
    setSwitching(true);
    try { await requestMode(mode === 'DIRECT' ? 'ORBIT' : 'DIRECT'); } catch (e) { console.error(e); } finally { setSwitching(false); }
  };

  useEffect(() => {
    const updateTime = () => {
      setTimeStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const isOnline = status === 'ONLINE' || status === 'LISTENING' || status === 'SPEAKING';

  return (
    <header className="w-full h-11 bg-[#0a0d12] border-b border-[#1e2638] px-3.5 flex items-center justify-between z-30 select-none shrink-0">
      {/* Top-Left: J.A.R.V.I.S. // MULTI-AGENT OS */}
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center">
          <div className="w-6 h-6 rounded-full border border-cyan-400/80 flex items-center justify-center bg-cyan-950/40 shadow-[0_0_8px_rgba(6,182,212,0.5)]">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-ping' : 'bg-cyan-400'}`} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <h1 className="font-mono-tech text-xs md:text-sm font-bold tracking-wider text-cyan-100 flex items-center gap-1.5 uppercase">
            <span>J.A.R.V.I.S.</span>
            <span className="text-cyan-400/60">//</span>
            <span className="text-amber-400 font-semibold">MULTI-AGENT OS</span>
          </h1>
          <span className="hidden sm:inline-block text-[9px] font-mono bg-cyan-950/70 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded">
            NEX ACTIVE
          </span>
          {/* Computer mode: DIRECT = your PC, ORBIT = J.A.R.V.I.S.'s private computer */}
          <button
            type="button"
            onClick={toggleMode}
            disabled={switching || !computer}
            aria-label={`Computer mode: ${mode}. Click to switch.`}
            title={mode === 'DIRECT'
              ? "DIRECT MODE: J.A.R.V.I.S. controls your PC. Click (or say 'JARVIS, Orbit mode') to switch."
              : "ORBIT MODE: J.A.R.V.I.S. uses its private computer. Click (or say 'JARVIS, Direct mode') to switch."}
            className={`flex items-center gap-1 text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded border transition-colors cursor-pointer disabled:cursor-default disabled:opacity-70 ${
              mode === 'DIRECT'
                ? 'text-emerald-300 bg-emerald-950/50 border-emerald-500/40 hover:border-emerald-400/70'
                : 'text-violet-300 bg-violet-950/50 border-violet-500/40 hover:border-violet-400/70'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${mode === 'DIRECT' ? 'bg-emerald-400' : 'bg-violet-400 animate-pulse'}`} />
            {computer ? `${mode} MODE` : 'MODE…'}
          </button>
          {/* Screen awareness: always visible, so the user knows when JARVIS can (and does) see the screen */}
          {screen && (
            <button
              type="button"
              onClick={toggleScreen}
              aria-label={`Screen access ${screen}${looking ? ', JARVIS is looking at the screen now' : ''}. Click to turn ${screen === 'OFF' ? 'on' : 'off'}.`}
              title={looking ? 'JARVIS is looking at your screen right now' : screen === 'OFF' ? 'Screen access is OFF: JARVIS cannot see your screen. Click to allow.' : `Screen access is ${screen}: JARVIS can look at your screen when you ask${screen === 'ASK' ? ' (after your OK)' : ''}. Click to turn off.`}
              className={`flex items-center gap-1 text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                screen === 'OFF' ? 'text-slate-400 bg-[#0e131d] border-[#263040] hover:border-cyan-500/50'
                  : looking ? 'text-amber-200 bg-amber-950/60 border-amber-400 animate-pulse'
                  : 'text-cyan-300 bg-cyan-950/50 border-cyan-500/40 hover:border-cyan-400/70'
              }`}
            >
              {screen === 'OFF' ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
              {looking ? 'LOOKING' : `SCREEN ${screen}`}
            </button>
          )}
        </div>
      </div>

      {/* Middle: Action Buttons & Telemetry */}
      <div className="flex items-center gap-2">
        {/* System Logs (Manager routing + server terminal, global pause) and API Settings */}
        <button
          onClick={onOpenLogs}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#101622] hover:bg-cyan-950/40 border border-[#263040] hover:border-cyan-500/50 text-[11px] font-mono text-cyan-300 transition-all cursor-pointer shadow-sm"
          title="System logs: the Manager's routing decisions, agent traffic and the server terminal, plus Pause All"
        >
          <ScrollText className="w-3 h-3 text-cyan-400" />
          <span className="hidden md:inline">System Logs</span>
        </button>

        <button
          onClick={onOpenApiSettings}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#101622] hover:bg-cyan-950/40 border border-[#263040] hover:border-cyan-500/50 text-[11px] font-mono text-cyan-300 transition-all cursor-pointer shadow-sm"
          title="API settings: model, temperature and Gemini API key"
        >
          <SlidersHorizontal className="w-3 h-3 text-amber-400" />
          <span className="hidden md:inline">API Settings</span>
        </button>

        {/* Telemetry Pills */}
        <div className="hidden xl:flex items-center gap-2 font-mono text-[10.5px] text-cyan-300 ml-2">
          {(() => {
            const limited = !!usage?.lastRateLimitAt && Date.now() - usage.lastRateLimitAt < RATE_LIMIT_WINDOW;
            const tip = usage
              ? `Last Gemini call: ${usage.lastLatencyMs ?? '-'} ms (${usage.lastModel ?? 'none yet'})\nThis session: ${usage.calls} calls, ${usage.errors} errors\nTokens: ${usage.totalTokens.toLocaleString()} total (${usage.promptTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out)\nActive model: ${usageModel}${limited ? '\nRate-limited (429) in the last 10 minutes' : ''}`
              : 'Waiting for the backend…';
            return (
              <div className={`flex items-center gap-1 bg-[#0e131d] border px-2 py-0.5 rounded ${limited ? 'border-rose-500/60 text-rose-300' : 'border-[#1e2638]'}`} title={tip}>
                <Gauge className={`w-3 h-3 ${limited ? 'text-rose-400' : 'text-cyan-400'}`} />
                <span>{usage?.lastLatencyMs != null ? `${usage.lastLatencyMs}ms` : '--ms'} · {tokens(usage?.totalTokens ?? 0)} tok</span>
                {limited && <span className="font-bold">429</span>}
              </div>
            );
          })()}
          {(() => {
            const live = [...agentStore.agents.values()];
            const free = live.filter((l) => l.work === 'IDLE' && !l.agent.paused).length;
            const cls = !agentStore.online ? 'text-slate-400' : free === 0 ? 'text-rose-300' : free < live.length / 2 ? 'text-amber-300' : 'text-emerald-300';
            return (
              <div className="flex items-center gap-1 bg-[#0e131d] border border-[#1e2638] px-2 py-0.5 rounded" title={agentStore.online ? `${free} of ${live.length} agents free for new work; the rest are on solo tasks or task forces` : 'Agent grid unreachable'}>
                <Users className="w-3 h-3 text-amber-400" />
                <span className={cls}>{agentStore.online ? `${free}/${live.length} AVAILABLE` : 'AGENTS OFFLINE'}</span>
              </div>
            );
          })()}
          <div className="flex items-center gap-1 bg-[#0e131d] border border-[#1e2638] px-2 py-0.5 rounded">
            <Clock className="w-3 h-3 text-emerald-400" />
            <span>{timeStr}</span>
          </div>
        </div>
      </div>

      {/* Right: Version Tag & Window Controls */}
      <div className="flex items-center gap-3">
        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded bg-[#101622] border border-[#263040] text-cyan-300 hover:text-white hover:border-cyan-400/60 transition-colors cursor-pointer"
          title="System Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Version Tag */}
        <span className="text-[10px] font-mono tracking-wider text-slate-400 bg-[#0e131d] border border-[#263040] px-2 py-0.5 rounded">
          v1.0.92
        </span>

        {/* Window Controls: Min, Max, Close */}
        <div className="flex items-center gap-1 border-l border-[#263040] pl-2">
          <button
            onClick={() => console.log('Minimize window')}
            className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            title="Minimize"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
              } else {
                document.exitFullscreen().catch(() => {});
              }
            }}
            className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            title="Maximize"
          >
            <Square className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={() => window.close()}
            className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
            title="Close"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </header>
  );
};
