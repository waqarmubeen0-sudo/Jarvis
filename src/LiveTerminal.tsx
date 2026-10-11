import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Copy, Trash2, Check, Code, Cpu, AudioLines, User, Mic, MicOff, Power, TriangleAlert } from 'lucide-react';
import { TranscriptEntry } from './components/LiveTranscript';
import { DropOverlay, DropTab, FileStrip, useJarvisDrop } from './JarvisDrop';
import { VoiceVisualizer, VoiceState } from './VoiceVisualizer';
import { AgentRoster } from './AgentRoster';
import type { AudioLevels } from './CoreOrb';

/** The real voice-link state from App (the same values the Core Orb uses). */
export interface VoiceLink {
  status: 'OFFLINE' | 'CONNECTING' | 'ONLINE' | 'LISTENING' | 'SPEAKING';
  processing: boolean;
  error: string | null;
  micMuted: boolean;
  levels: React.RefObject<AudioLevels>;
}

interface LiveTerminalProps {
  entries: TranscriptEntry[];
  interimText?: string;
  onClear?: () => void;
  /** Adds a SYS line to the terminal (file received / ready / removed). */
  onSystemMessage?: (text: string) => void;
  voice?: VoiceLink;
  onToggleMic?: () => void;
  onToggleConnection?: () => void;
}

function voiceState(v?: VoiceLink): { state: VoiceState; label: string } {
  if (!v) return { state: 'IDLE', label: 'Voice link standing by' };
  if (v.status === 'SPEAKING') return { state: 'SPEAKING', label: 'JARVIS is speaking…' };
  if (v.status === 'CONNECTING') return { state: 'PROCESSING', label: 'Establishing voice link…' };
  if (v.processing) return { state: 'PROCESSING', label: 'JARVIS is thinking…' };
  if (v.status === 'OFFLINE') return v.error ? { state: 'ERROR', label: v.error } : { state: 'IDLE', label: 'Voice link offline // press START AI' };
  if (v.micMuted) return { state: 'IDLE', label: 'Microphone muted' };
  return { state: 'LISTENING', label: 'JARVIS is listening…' };
}

const stateText: Record<VoiceState, string> = {
  IDLE: 'text-[var(--dgray-l)]',
  LISTENING: 'jv-glow-c',
  PROCESSING: 'jv-glow-y',
  SPEAKING: 'text-sky-300',
  ERROR: 'text-rose-300',
};

const TITLES = { VOICE: 'J.A.R.V.I.S. Conversation', AGENT: 'Agent Trace', EXTRA: 'Link Telemetry' } as const;

/** JARVIS's mark: a triangle in a ring, like the reference avatar. */
export const JarvisMark = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="12" cy="12" r="10" opacity="0.55" />
    <path d="M12 5.5 18 16.5H6Z" />
    <path d="M12 10 14.6 14.6H9.4Z" fill="currentColor" stroke="none" />
  </svg>
);

export const LiveTerminal: React.FC<LiveTerminalProps> = ({
  entries,
  interimText,
  onClear,
  onSystemMessage,
  voice,
  onToggleMic,
  onToggleConnection,
}) => {
  const [activeTab, setActiveTab] = useState<'VOICE' | 'AGENT' | 'EXTRA'>('VOICE');
  // The agent roster is hidden by default and shown ONLY after AGENT is clicked; VOICE, EXTRA and DROP hide it.
  const [showRoster, setShowRoster] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const drop = useJarvisDrop(onSystemMessage);
  const vs = voiceState(voice);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, interimText, activeTab]);

  const handleCopy = () => {
    const text = entries.map((e) => `[${e.timestamp}] ${e.sender.toUpperCase()}: ${e.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Streaming transcripts arrive as many small entries: show each turn as one message.
  const turns = useMemo(() => {
    const out: { id: string; sender: TranscriptEntry['sender']; time: string; text: string; action?: TranscriptEntry['action'] }[] = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && (e.sender === 'user' || e.sender === 'jarvis') && last.sender === e.sender && !e.action && !last.action) last.text += e.text;
      else out.push({ id: e.id, sender: e.sender, time: e.timestamp, text: e.text, action: e.action });
    }
    return out;
  }, [entries]);

  // Sample or active logs for AGENT tab
  const agentExecutionLogs = [
    { time: '12:00:10', type: 'INIT', msg: 'NEX Orchestrator loaded 6 specialist agents' },
    { time: '12:01:05', type: 'TOOL', msg: 'os_tool: powershell relay online and verified' },
    { time: '12:02:18', type: 'CODE', msg: 'CODE lab synthesized parser for holographic memory' },
    { time: '12:03:40', type: 'SEC', msg: 'SEC sentinel audit completed: 0 threats detected' },
    { time: '12:04:12', type: 'OPS', msg: 'write_file: src/agentSystem.ts synced [SUCCESS]' },
  ];

  // Extra JSON telemetry
  const extraPayload = {
    protocol: 'J.A.R.V.I.S. LIVE V2.4',
    session_id: 'jv_live_99482',
    audio_stream: { codec: 'PCM16', sampleRate: 16000, channels: 1, latency_ms: 18 },
    telemetry: { arc_core_mw: 3.42, nanotech_reserve: '99.4%', status: 'NOMINAL' },
    agent_pool: ['NEX', 'CODE', 'SEC', 'OPS', 'SOLVE', 'DATA'],
  };

  const tab = (id: 'VOICE' | 'AGENT' | 'EXTRA', icon: React.ReactNode) => (
    <button onClick={() => { setActiveTab(id); setShowRoster(id === 'AGENT'); }} className={`jv-terminal-tab ${activeTab === id ? 'active' : ''}`} aria-pressed={activeTab === id}>
      {icon}
      <span>{id}</span>
    </button>
  );

  return (
    <div className="jv-terminal flex flex-col flex-1 min-h-0 relative" {...drop.zone}>
      {drop.dragOver && <DropOverlay />}
      {/* Panel header: title + copy / clear */}
      <div className="jv-hud-head">
        <div className="jv-hud-title">
          <AudioLines className="w-4 h-4" />
          <span>{TITLES[activeTab]}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={handleCopy} className="jv-terminal-icon" title="Copy conversation" aria-label="Copy conversation">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {onClear && (
            <button onClick={onClear} className="jv-terminal-icon danger" title="Clear conversation" aria-label="Clear conversation">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* VOICE / AGENT / EXTRA / DROP */}
      <div className="jv-terminal-tabs">
        {tab('VOICE', <AudioLines className="w-3.5 h-3.5" />)}
        {tab('AGENT', <Cpu className="w-3.5 h-3.5" />)}
        {tab('EXTRA', <Code className="w-3.5 h-3.5" />)}
        <DropTab
          armed={drop.dragAnywhere}
          busy={drop.files.some((f) => f.status === 'UPLOADING' || f.status === 'PROCESSING')}
          onFiles={drop.upload}
          onOpen={() => setShowRoster(false)}
        />
      </div>

      {/* The Agent Town roster, live: same agents and work states as the town */}
      <div className={`jv-roster-wrap ${showRoster ? 'open' : ''}`} aria-hidden={!showRoster} inert={!showRoster}>
        <div>
          <AgentRoster />
        </div>
      </div>

      {drop.files.length > 0 && <FileStrip files={drop.files} onRemove={drop.remove} />}

      {/* Terminal Content Body */}
      <div className="jv-terminal-body">
        {activeTab === 'VOICE' && (
          <>
            {turns.length === 0 ? (
              <div className="text-[var(--dgray)] text-[11px] py-4 text-center leading-relaxed">
                <p>&gt; J.A.R.V.I.S. conversation link ready.</p>
                <p className="text-[10px] text-[var(--dc)]/60 mt-1">Press START AI to talk, or type below.</p>
              </div>
            ) : (
              <div className="jv-thread">
                {turns.map((t) =>
                  t.sender === 'user' || t.sender === 'jarvis' ? (
                    <div key={t.id} className="jv-msg">
                      <div className={`jv-avatar ${t.sender}`}>{t.sender === 'user' ? <User className="w-3.5 h-3.5" fill="currentColor" strokeWidth={0} /> : <JarvisMark />}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-3 mb-0.5">
                          <span className={`jv-msg-name ${t.sender === 'user' ? 'user' : 'jv-glow-c'}`}>{t.sender === 'user' ? 'USER' : 'JARVIS'}</span>
                          <span className="jv-msg-time">{t.time}</span>
                        </div>
                        <div className="jv-msg-text">{t.text.trim()}</div>
                        {t.action?.kind === 'play-game' && (
                          <button
                            type="button"
                            className="jv-voice-btn wide mt-2"
                            onClick={() => window.dispatchEvent(new CustomEvent('jarvis:open-arcade', { detail: { gameId: t.action!.gameId } }))}
                            title={`Open ${t.action.title} in JARVIS Arcade`}
                          >
                            ▶ PLAY {t.action.title.toUpperCase()} IN ARCADE
                          </button>
                        )}
                        <div className="jv-sep" />
                      </div>
                    </div>
                  ) : (
                    <div key={t.id} className="jv-sys">
                      <span className="text-[var(--dgray)] mr-1.5">[{t.time}]</span>
                      <span className={`font-bold mr-1.5 ${t.sender === 'tool' ? 'text-fuchsia-300' : 'jv-glow-g'}`}>SYS:</span>
                      <span>{t.text}</span>
                    </div>
                  ),
                )}
              </div>
            )}

            {interimText && (
              <div className="jv-sys text-[var(--dc)]/80 italic mt-2">
                <span className="text-[var(--dgray)] mr-1.5">&gt;</span>
                <span>{interimText}</span>
                <span className="animate-pulse">_</span>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}

        {activeTab === 'AGENT' && (
          <div className="flex flex-col gap-1 font-mono text-[10px]">
            <div className="text-cyan-400/80 mb-1 border-b border-[#1e2638] pb-1">// NEX TASK ORCHESTRATOR CODE & EXECUTION TRACE</div>
            {agentExecutionLogs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-1.5 leading-snug">
                <span className="text-slate-500">[{log.time}]</span>
                <span className="text-amber-400 font-bold">[{log.type}]</span>
                <span className="text-slate-300">{log.msg}</span>
              </div>
            ))}
            <div className="text-emerald-400 mt-2 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>Awaiting background task instructions...</span>
            </div>
          </div>
        )}

        {activeTab === 'EXTRA' && (
          <div className="font-mono text-[9.5px] text-cyan-200">
            <pre className="bg-[#03060a] p-2 rounded border border-[#1a2332] overflow-x-auto text-emerald-300">{JSON.stringify(extraPayload, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Listening indicator: the real link status, with the live mic/speaker waveform */}
      <div className={`jv-voice-strip state-${vs.state.toLowerCase()}`}>
        <AudioLines className={`w-4 h-4 shrink-0 ${stateText[vs.state]}`} />
        <div className="min-w-0 flex-1 jv-mono">
          <div className={`text-[9px] tracking-[0.2em] font-bold ${stateText[vs.state]}`}>
            {vs.state === 'ERROR' && <TriangleAlert className="inline w-2.5 h-2.5 mr-1 -mt-0.5" />}
            {vs.state}
          </div>
          <div className="text-[11px] text-[var(--dc)]/80 truncate" title={vs.label}>{vs.label}</div>
        </div>
        <div className="jv-voice-viz w-[34%] max-w-[120px] h-7 shrink-0">
          <VoiceVisualizer state={vs.state} levels={voice?.levels} />
        </div>
        {voice && voice.status !== 'OFFLINE' && voice.status !== 'CONNECTING' && onToggleMic && (
          <button onClick={onToggleMic} className={`jv-voice-btn ${voice.micMuted ? 'muted' : ''}`} title={voice.micMuted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={voice.micMuted}>
            {voice.micMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
        )}
        {voice && (voice.status === 'OFFLINE' || voice.status === 'CONNECTING') && onToggleConnection && (
          <button onClick={onToggleConnection} disabled={voice.status === 'CONNECTING'} className="jv-voice-btn wide" title="Start the J.A.R.V.I.S. voice link (same as START AI)">
            <Power className="w-3 h-3" />
            <span>{vs.state === 'ERROR' ? 'RETRY' : 'START AI'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
