import React, { useEffect, useRef } from 'react';
import { Terminal, Copy, Trash2, Bot, User, Cpu } from 'lucide-react';

export interface TranscriptEntry {
  id: string;
  sender: 'user' | 'jarvis' | 'system' | 'tool';
  text: string;
  timestamp: string;
  isInterim?: boolean;
  toolData?: {
    name: string;
    result: any;
    args?: Record<string, unknown>;
  };
  /** A follow-up the user can click, e.g. play the game a task just built. */
  action?: { kind: 'play-game'; gameId: string; title: string };
}

interface LiveTranscriptProps {
  entries: TranscriptEntry[];
  interimUserText?: string;
  onClear: () => void;
}

export const LiveTranscript: React.FC<LiveTranscriptProps> = ({
  entries,
  interimUserText,
  onClear,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, interimUserText]);

  const copyToClipboard = () => {
    const text = entries
      .map((e) => `[${e.timestamp}] ${e.sender.toUpperCase()}: ${e.text}`)
      .join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950/80 border border-cyan-500/30 rounded-xl overflow-hidden backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/60 border-b border-cyan-900/40">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="font-mono-tech text-xs tracking-wider text-cyan-200 uppercase">
            Holographic Terminal / Live Transcript
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyToClipboard}
            title="Copy Transcript"
            className="p-1 text-cyan-400/70 hover:text-cyan-200 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClear}
            title="Clear Log"
            className="p-1 text-cyan-400/70 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div
        ref={scrollRef}
        className="flex-1 p-3 overflow-y-auto space-y-3 font-tech text-xs select-text"
      >
        {entries.length === 0 && !interimUserText ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-cyan-500/40 py-8">
            <Cpu className="w-8 h-8 mb-2 opacity-50" />
            <p>J.A.R.V.I.S. Uplink initialized.</p>
            <p className="text-[11px] mt-1 text-cyan-600/70">
              Speak into your microphone or give commands like "Run suit diagnostic" or "Engage House Party Protocol".
            </p>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`p-2.5 rounded-lg border transition-all ${
                entry.sender === 'user'
                  ? 'bg-sky-950/40 border-sky-600/40 text-sky-100 ml-4'
                  : entry.sender === 'jarvis'
                  ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-100 mr-4'
                  : entry.sender === 'tool'
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                  : 'bg-slate-900/60 border-slate-700/50 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1 text-[10px] font-mono-tech tracking-wider opacity-75">
                <span className="flex items-center gap-1 font-bold">
                  {entry.sender === 'user' ? (
                    <>
                      <User className="w-3 h-3 text-sky-400" />
                      <span>TONY STARK</span>
                    </>
                  ) : entry.sender === 'jarvis' ? (
                    <>
                      <Bot className="w-3 h-3 text-cyan-400" />
                      <span>J.A.R.V.I.S.</span>
                    </>
                  ) : entry.sender === 'tool' ? (
                    <>
                      <Cpu className="w-3 h-3 text-emerald-400" />
                      <span>SYSTEM PROTOCOL EXECUTION</span>
                    </>
                  ) : (
                    <span>SYSTEM NOTICE</span>
                  )}
                </span>
                <span className="font-code text-cyan-400/60">{entry.timestamp}</span>
              </div>

              <div className="text-[13px] leading-relaxed break-words font-sans">
                {entry.text}
              </div>

              {/* Render Tool Results if available */}
              {entry.toolData && (
                <div className="mt-2 p-2 rounded bg-black/40 border border-emerald-500/20 font-code text-[11px] text-emerald-300">
                  <div className="font-bold text-emerald-400 mb-1">
                    PROTOCOL: {entry.toolData.name}
                  </div>
                  <pre className="whitespace-pre-wrap overflow-x-auto text-[10px] text-emerald-200/90">
                    {JSON.stringify(entry.toolData.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}

        {/* Interim Live User Speech Bubble */}
        {interimUserText && (
          <div className="p-2.5 rounded-lg border border-sky-400/60 bg-sky-950/50 text-sky-100 ml-4 animate-pulse">
            <div className="flex items-center justify-between mb-1 text-[10px] font-mono-tech tracking-wider text-sky-300">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                <span>TONY STARK (SPEAKING...)</span>
              </span>
            </div>
            <div className="text-[13px] italic font-sans text-sky-200">{interimUserText}</div>
          </div>
        )}
      </div>
    </div>
  );
};
