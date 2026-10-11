import React, { useEffect, useState } from 'react';
import { X, SlidersHorizontal, KeyRound, Loader2, Check, ExternalLink } from 'lucide-react';

// API Settings: which AI provider JARVIS's text work uses (Gemini / Claude / ChatGPT), its model, and
// each provider's own API key. Keys are stored by the backend and only ever shown here masked.
// Changes are test-called on the server before they are saved, and apply to the next call.

interface Provider { id: string; label: string; keyUrl: string; models: string[]; model: string; key: { set: boolean; masked: string } }
interface Loaded {
  settings: { model: string; temperature: number | null }; choices: string[]; liveModel: string; key: { set: boolean; masked: string };
  provider: string; providers: Provider[];
}

export const ApiSettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [data, setData] = useState<Loaded | null>(null);
  const [prov, setProv] = useState('gemini');
  const [model, setModel] = useState('');
  const [custom, setCustom] = useState('');
  const [pModel, setPModel] = useState('');
  const [useDefault, setUseDefault] = useState(true);
  const [temp, setTemp] = useState(0.7);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState<'model' | 'key' | 'remove' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = (keepProvider?: string) =>
    fetch('/api/settings').then((r) => r.json()).then((d: Loaded) => {
      setData(d);
      const p = keepProvider ?? d.provider;
      setProv(p);
      setPModel(d.providers.find((x) => x.id === p)?.model ?? '');
      setModel(d.choices.includes(d.settings.model) ? d.settings.model : 'custom');
      setCustom(d.choices.includes(d.settings.model) ? '' : d.settings.model);
      setUseDefault(d.settings.temperature === null);
      if (d.settings.temperature !== null) setTemp(d.settings.temperature);
    }).catch(() => setMsg({ kind: 'err', text: 'Could not load settings from the backend.' }));

  useEffect(() => {
    load();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const p = data?.providers.find((x) => x.id === prov);
  const gemini = prov === 'gemini';
  const chosen = model === 'custom' ? custom.trim() : model;
  const pickProvider = (id: string) => { setProv(id); setKey(''); setMsg(null); setPModel(data?.providers.find((x) => x.id === id)?.model ?? ''); };

  const saveModel = async () => {
    setSaving('model');
    setMsg(null);
    try {
      const body = gemini ? { provider: prov, model: chosen, temperature: useDefault ? null : temp } : { provider: prov, providerModel: pModel.trim() };
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Save failed (HTTP ${r.status}).`);
      const now = d.providers?.find((x: Provider) => x.id === d.provider);
      setMsg({ kind: 'ok', text: `Saved. JARVIS and the agents now use ${now?.label ?? prov} (${now?.model ?? ''})${gemini && d.settings.temperature !== null ? ` at temperature ${d.settings.temperature}` : ''}.` });
      load(prov);
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(null);
    }
  };

  const saveKey = async () => {
    setSaving('key');
    setMsg(null);
    try {
      const r = await fetch('/api/config/apikey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: prov, apiKey: key.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Save failed (HTTP ${r.status}). Restart JARVIS so the server has the latest version.`);
      setKey('');
      setMsg({ kind: 'ok', text: `${d.message}.${gemini ? ' Voice sessions pick it up on the next START AI.' : ''}` });
      load(prov);
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(null);
    }
  };

  const removeKey = async () => {
    if (!p || !window.confirm(`Remove your ${p.label} API key from this PC?`)) return;
    setSaving('remove');
    setMsg(null);
    try {
      const r = await fetch(`/api/config/apikey?provider=${encodeURIComponent(prov)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Remove failed (HTTP ${r.status}). Restart JARVIS so the server has the latest version.`);
      if (prov === data?.provider) window.location.reload(); // the active provider has no key now: back to JARVIS INITIAL SETUP
      else { setMsg({ kind: 'ok', text: `${p.label} key removed.` }); load(prov); setSaving(null); }
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
      setSaving(null);
    }
  };

  const dirty = !!data && (prov !== data.provider || (gemini
    ? chosen !== data.settings.model || (useDefault ? null : temp) !== data.settings.temperature
    : pModel.trim() !== (p?.model ?? '')));
  const field = 'w-full bg-[#070b12] border border-[#1e2638] rounded p-2 text-xs font-mono text-cyan-100 outline-none focus:border-cyan-400';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0b1018] border-2 border-cyan-500/50 rounded-xl p-5 max-w-md w-full shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="API settings">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-cyan-400" />
            <h3 className="font-mono-tech text-sm font-bold text-cyan-100 uppercase">API Settings</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer" aria-label="Close API settings"><X className="w-5 h-5" /></button>
        </div>

        {!data || !p ? (
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : (
          <div className="flex flex-col gap-4 font-mono text-xs">
            <section className="flex flex-col gap-2">
              <label htmlFor="api-provider" className="text-cyan-300 font-bold tracking-wider">AI PROVIDER</label>
              <select id="api-provider" value={prov} onChange={(e) => pickProvider(e.target.value)} className={field}>
                {data.providers.map((x) => <option key={x.id} value={x.id}>{x.label}{x.id === data.provider ? ' (in use)' : ''}</option>)}
              </select>
              {!gemini && (
                <p className="text-[10px] text-amber-300/90 leading-snug">
                  Chat, agents and routing use {p.label}. Voice, web search and file/image analysis always use Gemini{data.key.set ? '.' : ': add a Gemini key too for those.'}
                </p>
              )}
            </section>

            <section className="flex flex-col gap-2 border-t border-[#1e2638] pt-4">
              {gemini ? (
                <>
                  <label htmlFor="api-model" className="text-cyan-300 font-bold tracking-wider">ACTIVE MODEL</label>
                  <select id="api-model" value={model} onChange={(e) => setModel(e.target.value)} className={field}>
                    {data.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="custom">Other Gemini model…</option>
                  </select>
                  {model === 'custom' && (
                    <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="gemini-…" className={field} aria-label="Custom model id" />
                  )}
                  <p className="text-[10px] text-slate-500 leading-snug">Used by JARVIS text chat and every agent. The Manager's routing stays on the fast lite model. Voice uses {data.liveModel}.</p>

                  <div className="flex items-center justify-between mt-1">
                    <span className="text-cyan-300 font-bold tracking-wider">TEMPERATURE</span>
                    <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} className="accent-cyan-400" />
                      model default
                    </label>
                  </div>
                  <div className={`flex items-center gap-3 ${useDefault ? 'opacity-40' : ''}`}>
                    <input type="range" min={0} max={2} step={0.1} value={temp} disabled={useDefault} onChange={(e) => setTemp(+e.target.value)} className="flex-1 accent-cyan-400" aria-label="Temperature" />
                    <span className="w-8 text-right text-cyan-100">{temp.toFixed(1)}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-snug">Lower is more precise, higher is more creative. Humor and trivia keep their own settings.</p>
                </>
              ) : (
                <>
                  <label htmlFor="api-pmodel" className="text-cyan-300 font-bold tracking-wider">MODEL NAME</label>
                  <input id="api-pmodel" list="api-pmodel-list" value={pModel} onChange={(e) => setPModel(e.target.value)} spellCheck={false} placeholder={p.models[0]} className={field} />
                  <datalist id="api-pmodel-list">{p.models.map((m) => <option key={m} value={m} />)}</datalist>
                  <p className="text-[10px] text-slate-500 leading-snug">Any model your {p.label} key can use. It is test-called before saving.</p>
                </>
              )}
              <button onClick={saveModel} disabled={!dirty || (gemini ? !chosen : !pModel.trim()) || saving !== null} className="mt-1 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-default text-slate-950 font-bold uppercase rounded cursor-pointer flex items-center justify-center gap-2">
                {saving === 'model' ? <><Loader2 className="w-4 h-4 animate-spin" />Testing model…</> : prov !== data.provider ? `Use ${p.label}` : 'Save model settings'}
              </button>
            </section>

            <section className="flex flex-col gap-2 border-t border-[#1e2638] pt-4">
              <div className="flex items-center justify-between">
                <label htmlFor="api-key" className="text-cyan-300 font-bold tracking-wider flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" />{gemini ? 'GEMINI' : prov === 'anthropic' ? 'ANTHROPIC' : 'OPENAI'} API KEY</label>
                <span className={p.key.set ? 'text-emerald-300' : 'text-rose-300'}>{p.key.set ? p.key.masked : 'not set'}</span>
              </div>
              <input id="api-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.key.set ? 'Paste a new key to replace it' : `Paste your ${p.label} API key`} className={field} />
              <a href={p.keyUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 w-fit">Get a key at {new URL(p.keyUrl).host}<ExternalLink className="w-3 h-3" /></a>
              <p className="text-[10px] text-slate-500 leading-snug">Checked with a tiny test call, then stored on this PC only (OS-encrypted in the desktop app). It is never shown in full.</p>
              <button onClick={saveKey} disabled={!key.trim() || saving !== null} className="py-2 border border-cyan-500/60 text-cyan-200 hover:bg-cyan-500/15 disabled:opacity-40 disabled:cursor-default font-bold uppercase rounded cursor-pointer flex items-center justify-center gap-2">
                {saving === 'key' ? <><Loader2 className="w-4 h-4 animate-spin" />Checking key…</> : 'Test & save key'}
              </button>
              {p.key.set && (
                <button onClick={removeKey} disabled={saving !== null} className="py-1.5 text-[10px] text-rose-300 hover:text-rose-200 disabled:opacity-40 uppercase tracking-wider cursor-pointer">
                  {saving === 'remove' ? 'Removing…' : 'Remove key from this PC'}
                </button>
              )}
            </section>

            {msg && (
              <div className={`text-[11px] leading-snug flex items-start gap-1.5 ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`} role="status">
                {msg.kind === 'ok' && <Check className="w-3.5 h-3.5 shrink-0 mt-px" />}{msg.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
