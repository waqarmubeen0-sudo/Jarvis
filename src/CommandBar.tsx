import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Paperclip, Send, Loader2 } from 'lucide-react';

// The command line, standalone at the bottom of the right column. Sends through App's existing
// handleSendText (live voice link when connected, text chat otherwise).

interface CommandBarProps {
  onSend: (text: string) => void;
  isLoading?: boolean;
  error?: string | null;
  isLive: boolean;
  micMuted: boolean;
  onToggleMic: () => void;
  onStartVoice: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({ onSend, isLoading = false, error, isLive, micMuted, onToggleMic, onStartVoice }) => {
  const [text, setText] = useState('');
  const [shownError, setShownError] = useState<string | null>(null);
  const sentAt = useRef(0);

  // Show App's error here when it follows something sent from this bar.
  useEffect(() => {
    if (error && Date.now() - sentAt.current < 30_000) setShownError(error);
  }, [error]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || isLoading) return;
    setShownError(null);
    sentAt.current = Date.now();
    onSend(text.trim());
    setText('');
  };

  const bars = (hs: number[]) => (
    <div className="flex gap-[2px] items-end h-3 shrink-0" aria-hidden="true">
      {hs.map((h, i) => <div key={i} className="w-0.5 bg-[var(--dgray)]" style={{ height: `${h}%` }} />)}
    </div>
  );

  return (
    <div className="jv-command">
      {shownError && (
        <div className="mb-1.5 text-[10px] jv-mono text-rose-300 bg-rose-950/30 border border-rose-500/30 rounded-md px-2 py-0.5 flex justify-between gap-2">
          <span className="truncate">{shownError}</span>
          <button type="button" onClick={() => setShownError(null)} className="text-rose-300/70 hover:text-rose-200 cursor-pointer shrink-0">DISMISS</button>
        </div>
      )}
      <form onSubmit={submit} className="jv-command-bar">
        <button
          type="button"
          onClick={isLive ? onToggleMic : onStartVoice}
          className={`jv-mic-btn ${isLive && micMuted ? 'muted' : ''}`}
          title={!isLive ? 'Start the voice link (START AI)' : micMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-label={!isLive ? 'Start voice' : micMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isLive && micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Talk to JARVIS or type a message..."
          className="jv-prompt-input"
          disabled={isLoading}
        />
        <button
          type="button"
          className="jv-icon-btn w-8 h-8 shrink-0"
          title="Give JARVIS files (same as DROP)"
          aria-label="Attach files"
          onClick={() => (document.querySelector('.jv-drop-tab') as HTMLButtonElement | null)?.click()}
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <button type="submit" disabled={!text.trim() || isLoading} className="jv-send-btn" title="Send to JARVIS" aria-label="Send to JARVIS">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 -ml-0.5 mt-0.5" />}
        </button>
      </form>
      <div className="jv-hint">
        {bars([40, 80, 100, 60, 30])}
        <b className="jv-glow-c">VOICE MODE</b>
        <span className="w-1 h-1 rounded-full bg-[var(--dgray)] shrink-0" />
        <span>{isLive ? (micMuted ? 'Mic muted: tap the mic to talk again' : 'Just speak, JARVIS is listening') : 'Tap the mic or START AI to talk, or type a message'}</span>
        {bars([30, 60, 100, 80, 40])}
      </div>
    </div>
  );
};
