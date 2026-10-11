import React, { useState } from 'react';
import { KeyRound, Loader2, Check, ExternalLink, ShieldCheck } from 'lucide-react';

// JARVIS INITIAL SETUP: shown until the user has configured their OWN AI provider key.
// The key goes straight to the local backend, which tests it and stores it OS-encrypted; this page
// never receives it back (only ••••ABCD).

export interface SetupStatus {
  configured: boolean; provider: string; model: string; userName: string; masked: string; storage: 'os-encrypted' | 'env-file';
  voiceModel: string; geminiKey: boolean;
  providers: { id: string; label: string; keyUrl: string; models: string[]; model: string; key: { set: boolean; masked: string } }[];
}

export const fetchSetup = (): Promise<SetupStatus> => fetch('/api/setup').then((r) => r.json());

export const InitialSetup: React.FC<{ status: SetupStatus; onDone: () => void }> = ({ status, onDone }) => {
  const [provider, setProvider] = useState(status.provider);
  const [key, setKey] = useState('');
  const [model, setModel] = useState(status.model);
  const [name, setName] = useState(status.userName);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [masked, setMasked] = useState('');
  const p = status.providers.find((x) => x.id === provider) ?? status.providers[0];
  const pick = (id: string) => { setProvider(id); setModel(status.providers.find((x) => x.id === id)?.model ?? ''); setMsg(null); };

  const call = async (kind: 'test' | 'save') => {
    setBusy(kind);
    setMsg(null);
    try {
      const body = { provider, apiKey: key.trim(), model, ...(kind === 'save' ? { userName: name.trim() } : {}) };
      const r = await fetch(kind === 'test' ? '/api/setup/test' : '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.message || 'Request failed');
      setMsg({ kind: 'ok', text: d.message });
      if (kind === 'save') { setKey(''); setMasked(d.masked); setTimeout(onDone, 900); }
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const field = 'w-full bg-[#070b12] border border-[#1e2638] rounded p-2 text-xs font-mono text-cyan-100 outline-none focus:border-cyan-400';
  const label = 'text-cyan-300 font-bold tracking-wider';
  return (
    <div className="fixed inset-0 z-[100] bg-[#05080d] flex items-center justify-center p-4">
      <div className="bg-[#0b1018] border-2 border-cyan-500/50 rounded-xl p-6 max-w-md w-full shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <h1 id="setup-title" className="font-mono-tech text-base font-bold text-cyan-100 uppercase tracking-widest">J.A.R.V.I.S. Initial Setup</h1>
        <p className="text-[11px] font-mono text-slate-400 mt-1 mb-5">Configure your AI provider. JARVIS runs on your own API key: none is included.</p>

        <form className="flex flex-col gap-4 font-mono text-xs" onSubmit={(e) => { e.preventDefault(); call('save'); }}>
          <label className="flex flex-col gap-1.5">
            <span className={label}>API PROVIDER</span>
            <select value={provider} onChange={(e) => pick(e.target.value)} className={field}>
              {status.providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={`${label} flex items-center gap-1.5`}><KeyRound className="w-3.5 h-3.5" />API KEY</span>
            <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)}
              placeholder={masked || (p.key.set ? `${p.key.masked} (saved)` : `Paste your ${p.label} API key`)} className={field} />
            <a href={p.keyUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 w-fit">
              Get a key at {new URL(p.keyUrl).host}<ExternalLink className="w-3 h-3" />
            </a>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>MODEL</span>
            <input list="setup-models" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} placeholder={p.models[0]} className={field} />
            <datalist id="setup-models">{p.models.map((m) => <option key={m} value={m} />)}</datalist>
            <span className="text-[10px] text-slate-500">
              {provider === 'gemini'
                ? `For chat and agents. Voice uses ${status.voiceModel}.`
                : `For chat, agents and routing. Voice, web search and file/image analysis always use Gemini${status.geminiKey ? '.' : ': add a Gemini key later in API Settings for those.'}`}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>WHAT SHOULD JARVIS CALL YOU?</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="Your name (optional)" className={field} />
          </label>

          <div className="flex gap-2 mt-1">
            <button type="button" onClick={() => call('test')} disabled={busy !== null || (!key.trim() && !p.key.set) || !model.trim()}
              className="flex-1 py-2 border border-cyan-500/60 text-cyan-200 hover:bg-cyan-500/15 disabled:opacity-40 disabled:cursor-default font-bold uppercase rounded cursor-pointer flex items-center justify-center gap-2">
              {busy === 'test' ? <><Loader2 className="w-4 h-4 animate-spin" />Testing…</> : 'Test connection'}
            </button>
            <button type="submit" disabled={busy !== null || (!key.trim() && !p.key.set) || !model.trim()}
              className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-default text-slate-950 font-bold uppercase rounded cursor-pointer flex items-center justify-center gap-2">
              {busy === 'save' ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : 'Save configuration'}
            </button>
          </div>

          {msg && (
            <div className={`text-[11px] leading-snug flex items-start gap-1.5 ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`} role="status">
              {msg.kind === 'ok' && <Check className="w-3.5 h-3.5 shrink-0 mt-px" />}{msg.text}
            </div>
          )}
          <p className="text-[10px] text-slate-500 leading-snug flex items-start gap-1.5 border-t border-[#1e2638] pt-3">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            {status.storage === 'os-encrypted'
              ? 'Your key is encrypted by your operating system and stored only on this PC. It is never shown again in full.'
              : 'Development mode: your key is saved in .env.local in the project folder (git-ignored).'}
          </p>
        </form>
      </div>
    </div>
  );
};
