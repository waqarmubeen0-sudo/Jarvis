import React, { useEffect, useState } from 'react';
import { Volume2, Play, Loader2 } from 'lucide-react';
import { useJarvisConfig, fieldClass, sectionTitle, hintClass } from './useJarvisConfig';
import { Switch, Status, SaveButton } from './controls';
import { LiveAudioPlayer } from '../utils/audio';

// Settings → Voice: how JARVIS sounds. Saved in the backend config; the voice session picks the
// voice, interruption and style up on the next START AI, typed replies use them immediately.

interface Voice { name: string; emotion: string; autoEmotion: boolean; speed: string; expressiveness: string; interruption: boolean; enabled: boolean; speakTyped: boolean }

const VOICE_INFO: Record<string, string> = {
  Achird: 'Friendly, warm (recommended)',
  Umbriel: 'Easy-going, relaxed',
  Zubenelgenubi: 'Casual, laid-back',
  Puck: 'Upbeat, lively',
  Charon: 'Informative, steady',
  Fenrir: 'Excitable, energetic',
  Orus: 'Firm, confident',
};
const EMOTIONS = ['AUTO', 'NEUTRAL', 'HAPPY', 'EXCITED', 'CALM', 'CURIOUS', 'AMUSED', 'PLAYFUL', 'CONCERNED', 'SERIOUS', 'FRUSTRATED', 'SURPRISED', 'PROUD', 'EMPATHETIC', 'CONFIDENT', 'FOCUSED'];
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

let preview: LiveAudioPlayer | null = null;

export const VoiceSettings: React.FC = () => {
  const { data, error, saving, save } = useJarvisConfig();
  const [v, setV] = useState<Voice | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hearing, setHearing] = useState(false);
  useEffect(() => { if (data && !v) setV((data.config as any).voice); }, [data, v]);

  const saved = (data?.config as any)?.voice as Voice | undefined;
  const dirty = !!v && !!saved && JSON.stringify(v) !== JSON.stringify(saved);
  const voices: string[] = (data as any)?.voices ?? Object.keys(VOICE_INFO);

  const submit = async () => {
    if (!v) return;
    const err = await save({ voice: v });
    if (!err) window.dispatchEvent(new CustomEvent('jarvis:voice-config', { detail: v }));
    setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Voice saved. It takes effect the next time you press START AI; typed replies use it right away.' });
  };

  const hear = async () => {
    setHearing(true);
    setMsg(null);
    try {
      if (dirty) { const err = await save({ voice: v }); if (err) throw new Error(err); }
      const r = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: "Hey there. This is how I sound now... not bad, right?", emotion: 'HAPPY' }) });
      const d = await r.json();
      if (!r.ok || !d.audio) throw new Error(d.error || 'No audio came back.');
      preview ??= new LiveAudioPlayer();
      preview.init();
      preview.interrupt();
      preview.playChunk(d.audio);
    } catch (e) {
      setMsg({ ok: false, text: `Couldn't play a sample: ${(e as Error).message}` });
    } finally {
      setHearing(false);
    }
  };

  if (error) return <p className="text-[11px] font-mono text-rose-300">{error}</p>;
  if (!v) return <p className="text-[11px] font-mono text-slate-400">Loading voice settings…</p>;

  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><div className="text-[11px] font-mono text-slate-200">{label}</div><div className={hintClass}>{hint}</div></div>
      {control}
    </div>
  );

  return (
    <section className="space-y-3">
      <h3 className={`${sectionTitle} flex items-center gap-1.5`}><Volume2 className="w-3.5 h-3.5" />Voice</h3>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="v-name" className="block text-[10px] font-mono text-slate-400 mb-1">Voice</label>
          <select id="v-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={fieldClass}>
            {[...new Set([v.name, ...voices])].map((n) => <option key={n} value={n}>{n}{VOICE_INFO[n] ? ` — ${VOICE_INFO[n]}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="v-emotion" className="block text-[10px] font-mono text-slate-400 mb-1">Emotion</label>
          <select id="v-emotion" value={v.emotion} onChange={(e) => setV({ ...v, emotion: e.target.value })} className={fieldClass}>
            {EMOTIONS.map((e) => <option key={e} value={e}>{e === 'AUTO' ? 'Auto (from the conversation)' : `Always ${title(e).toLowerCase()}`}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="v-speed" className="block text-[10px] font-mono text-slate-400 mb-1">Speaking speed</label>
          <select id="v-speed" value={v.speed} onChange={(e) => setV({ ...v, speed: e.target.value })} className={fieldClass}>
            <option value="RELAXED">Relaxed</option><option value="NATURAL">Natural</option><option value="BRISK">Brisk</option>
          </select>
        </div>
        <div>
          <label htmlFor="v-expr" className="block text-[10px] font-mono text-slate-400 mb-1">Expressiveness</label>
          <select id="v-expr" value={v.expressiveness} onChange={(e) => setV({ ...v, expressiveness: e.target.value })} className={fieldClass}>
            <option value="SUBTLE">Subtle</option><option value="NATURAL">Natural</option><option value="EXPRESSIVE">Expressive</option>
          </select>
        </div>
      </div>
      {row('Auto emotion', 'Reads the mood of the conversation and adjusts tone and wording.', <Switch label="Auto emotion" on={v.autoEmotion} onChange={(autoEmotion) => setV({ ...v, autoEmotion })} disabled={v.emotion !== 'AUTO'} />)}
      {row('Interruption', 'Talk over JARVIS and he stops mid-sentence to listen.', <Switch label="Interruption" on={v.interruption} onChange={(interruption) => setV({ ...v, interruption })} />)}
      {row('Voice enabled', 'Off: JARVIS still answers, as text only.', <Switch label="Voice enabled" on={v.enabled} onChange={(enabled) => setV({ ...v, enabled })} />)}
      {row('Speak typed replies', 'Also say replies to typed messages aloud (uses Gemini TTS quota).', <Switch label="Speak typed replies" on={v.speakTyped} onChange={(speakTyped) => setV({ ...v, speakTyped })} />)}
      <div className="flex items-center gap-2">
        <SaveButton onClick={submit} busy={saving} disabled={!dirty}>Save voice</SaveButton>
        <button type="button" onClick={hear} disabled={hearing} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/15 text-[11px] font-mono uppercase cursor-pointer disabled:opacity-40">
          {hearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}Hear it
        </button>
        {dirty && <span className="text-[10px] font-mono text-amber-300">Unsaved</span>}
      </div>
      <Status msg={msg} />
    </section>
  );
};
