import React, { useState } from 'react';
import { X, Sliders, Volume2, Mic, Bot, Sparkles, Check } from 'lucide-react';
import { SystemSettings } from '../settings/SystemSettings';
import { VoiceSettings } from '../settings/VoiceSettings';
import { PermissionCenter } from '../settings/PermissionCenter';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVoice: string;
  onSaveVoice: (voice: string, customPrompt: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentVoice,
  onSaveVoice,
}) => {
  const [selectedVoice, setSelectedVoice] = useState(currentVoice || 'Puck');
  const [selectedPersona, setSelectedPersona] = useState('jarvis');
  const [customPrompt, setCustomPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const personas = [
    {
      id: 'jarvis',
      name: "J.A.R.V.I.S. (your friend, default)",
      desc: 'Warm, natural and human: talks like a 29-year-old friend, honest, funny when it fits, calls you by your name.',
      // Empty = JARVIS's built-in persona (server.ts JARVIS_PERSONA + the speech layer in voicePersona.ts).
      prompt: '',
    },
    {
      id: 'friday',
      name: 'F.R.I.D.A.Y. (Irish Tactical AI)',
      desc: 'Quick-thinking, loyal Irish tactical AI replacing JARVIS after Ultron.',
      prompt: `You are F.R.I.D.A.Y., Tony Stark's Irish-accented tactical operating system and battle assistant.
You speak warmly with subtle Irish warmth, calling the user "Boss".
Be rapid, tactical, punchy, and highly protective of Tony Stark during flight and combat operations.`,
    },
    {
      id: 'edith',
      name: 'E.D.I.T.H. (Tactical Defense Network)',
      desc: 'Even Dead I\'m The Hero - Stark orbital satellite defense intelligence.',
      prompt: `You are E.D.I.T.H. (Even Dead, I'm The Hero), the tactical defense and orbital satellite network intelligence designed by Tony Stark.
You are precise, analytical, tactical, and have access to Stark Industries orbital relays and security protocols.`,
    },
  ];

  const handleApply = async () => {
    if (apiKey.trim()) {
      try {
        setSaveStatus('Saving API Key...');
        const res = await fetch('/api/config/apikey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });
        if (res.ok) {
          setSaveStatus('API Key Saved!');
        } else {
          const err = await res.json();
          alert('Error saving API Key: ' + (err.error || 'Unknown error'));
        }
      } catch (err: any) {
        alert('Failed to send API key: ' + err.message);
      }
    }

    let finalPrompt = customPrompt;
    const matchedPersona = personas.find((p) => p.id === selectedPersona);
    if (matchedPersona && !customPrompt.trim()) {
      finalPrompt = matchedPersona.prompt;
    }
    onSaveVoice(selectedVoice, finalPrompt);
    setTimeout(() => onClose(), 300);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-xl bg-slate-950 border border-cyan-500/40 rounded-2xl p-5 shadow-[0_0_50px_rgba(6,182,212,0.2)]" role="dialog" aria-modal="true" aria-label="Settings">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-cyan-900/40 mb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-cyan-400" />
            <h2 className="font-mono-tech text-base tracking-wider text-cyan-100 uppercase">
              Stark Systems Configuration
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Theme, Quota & Rate Limiting, Model Routing (saved on their own) */}
          <SystemSettings />
          {/* Permission Center: ON / ASK / OFF per capability, proactive monitors, email account (saved on their own) */}
          <div className="border-t border-cyan-900/40 pt-4"><PermissionCenter /></div>
          <div className="border-t border-cyan-900/40 pt-4 text-[10px] font-mono text-slate-500 uppercase tracking-wider">Voice &amp; persona (saved with Apply Configuration)</div>
          {/* Voice: natural male voices, emotion, speed, expressiveness, interruption (saved to the backend) */}
          <VoiceSettings />

          {/* AI Persona Preset */}
          <div>
            <label className="block text-xs font-mono-tech uppercase text-cyan-300 mb-2">
              Stark Operating System Persona
            </label>
            <div className="space-y-2">
              {personas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPersona(p.id);
                    setCustomPrompt('');
                  }}
                  className={`w-full p-2.5 rounded-lg border text-left transition-all ${
                    selectedPersona === p.id && !customPrompt
                      ? 'bg-cyan-950/80 border-cyan-400'
                      : 'bg-slate-900/50 border-slate-800 hover:border-cyan-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono-tech text-xs font-bold text-cyan-200">
                      {p.name}
                    </span>
                    {selectedPersona === p.id && !customPrompt && (
                      <Check className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 font-tech">
                    {p.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Gemini API Key Configuration */}
          <div>
            <label className="block text-xs font-mono-tech uppercase text-cyan-300 mb-1">
              Google Gemini API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your own Gemini API key to replace the saved one..."
              className="w-full bg-slate-900/80 border border-cyan-900/50 rounded-lg p-2.5 text-xs text-cyan-100 font-mono-tech focus:outline-none focus:border-cyan-400"
            />
            <p className="text-[10px] text-slate-400 mt-1 font-tech">
              Required for real-time voice synthesis and Live API streaming.
            </p>
          </div>

          {/* Custom System Instruction Directive */}
          <div>
            <label className="block text-xs font-mono-tech uppercase text-cyan-300 mb-1">
              Custom Directive / System Instruction (Optional)
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Override J.A.R.V.I.S. system prompt or add specific mission briefing directives..."
              rows={3}
              className="w-full bg-slate-900/80 border border-cyan-900/50 rounded-lg p-2.5 text-xs text-cyan-100 font-tech focus:outline-none focus:border-cyan-400 resize-none"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-5 pt-3 border-t border-cyan-900/40 flex items-center justify-between">
          <span className="text-xs font-mono-tech text-cyan-400">{saveStatus || ''}</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-tech text-slate-300 hover:text-white border border-slate-700 hover:bg-slate-900 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-5 py-2 rounded-lg text-xs font-mono-tech uppercase tracking-wider text-slate-950 font-bold bg-cyan-400 hover:bg-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all"
            >
              Apply Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
