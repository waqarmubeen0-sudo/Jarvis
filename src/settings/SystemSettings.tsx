import React, { useEffect, useState } from 'react';
import { Palette, Gauge, Route } from 'lucide-react';
import { THEMES, ThemeId, applyTheme, loadTheme } from '../theme';
import { useJarvisConfig, fieldClass, sectionTitle, hintClass } from './useJarvisConfig';
import { Status, SaveButton } from './controls';

// Settings (header gear): Theme, Quota & Rate Limiting, Model Routing. Shown above the existing
// voice / persona / API-key options in the Settings modal.

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const SWATCH: Record<ThemeId, string> = {
  jarvis: 'linear-gradient(135deg,#031018,#00e5ff)',
  cyberpunk: 'linear-gradient(135deg,#000,#ff2a4d)',
  stealth: 'linear-gradient(135deg,#0f1117,#a78bfa)',
  terminal: 'linear-gradient(135deg,#000,#ffb000)',
};

export const SystemSettings: React.FC = () => {
  const { data, error, saving, save } = useJarvisConfig(5000);
  const [theme, setTheme] = useState<ThemeId>(loadTheme());
  const [delay, setDelay] = useState(1);
  const [budget, setBudget] = useState('');
  const [model, setModel] = useState('');
  const [router, setRouter] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Seed the form once the config arrives.
  const seeded = !!data;
  useEffect(() => {
    if (!data) return;
    setDelay(data.config.limits.delaySec);
    setBudget(data.config.limits.tokenBudget ? String(data.config.limits.tokenBudget) : '');
    setModel(data.config.model);
    setRouter(data.config.routerModel);
  }, [seeded]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTheme = (t: ThemeId) => { setTheme(t); applyTheme(t); };

  const saveQuota = async () => {
    const b = budget.trim() ? Number(budget.replace(/[_,\s]/g, '')) : 0;
    if (!Number.isFinite(b) || b < 0) return setMsg({ ok: false, text: 'Token budget must be a positive number (or empty for none).' });
    const err = await save({ limits: { delaySec: delay, tokenBudget: Math.round(b) } });
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `Saved. Agent calls are now spaced ${delay}s apart.` });
  };
  const saveRouting = async () => {
    setMsg({ ok: true, text: 'Testing the models with Gemini…' });
    const err = await save({ model, routerModel: router });
    setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Model routing saved. It applies from the next request.' });
  };

  const used = data?.usage.totalTokens ?? 0;
  const cap = data?.config.limits.tokenBudget ?? 0;
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const models = data?.models ?? [];
  const options = (current: string) => (models.some((m) => m.id === current) || !current ? models : [{ id: current, label: current }, ...models]);

  return (
    <div className="space-y-4">
      {/* THEME */}
      <section className="space-y-2">
        <h3 className={`${sectionTitle} flex items-center gap-1.5`}><Palette className="w-3.5 h-3.5" />Theme</h3>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} onClick={() => pickTheme(t.id)}
              className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex items-center gap-2 ${theme === t.id ? 'bg-cyan-950/70 border-cyan-400 shadow-[0_0_10px_rgba(var(--dc-rgb),0.3)]' : 'bg-slate-900/50 border-slate-800 hover:border-cyan-500/40'}`}>
              <span className="w-7 h-7 rounded shrink-0 border border-white/10" style={{ background: SWATCH[t.id] }} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-xs font-mono font-bold text-cyan-100">{t.name}</span>
                <span className="block text-[10px] font-mono text-slate-400 leading-snug">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <p className={hintClass}>Applies instantly and is remembered in this browser.</p>
      </section>

      {error && <p className="text-[11px] font-mono text-rose-300">{error}</p>}

      {/* QUOTA & RATE LIMITING */}
      <section className="space-y-2 border-t border-cyan-900/40 pt-4">
        <h3 className={`${sectionTitle} flex items-center gap-1.5`}><Gauge className="w-3.5 h-3.5" />Quota &amp; Rate Limiting</h3>
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
          <label htmlFor="cfg-delay">Delay between agent API calls</label>
          <span className="text-cyan-100 font-bold">{delay}s</span>
        </div>
        <input id="cfg-delay" type="range" min={1} max={5} step={1} value={delay} onChange={(e) => setDelay(+e.target.value)} disabled={!data} className="w-full accent-cyan-400" />
        <p className={hintClass}>Staggers the agents' calls (a task force no longer fires them all at once), which keeps free-tier keys under their per-minute limit.</p>

        <label htmlFor="cfg-budget" className="block text-[11px] font-mono text-slate-300 mt-2">Session token budget</label>
        <input id="cfg-budget" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 250000 (empty = no budget)" className={fieldClass} disabled={!data} />
        <div className="text-[11px] font-mono">
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Used this session: <b className="text-cyan-100">{tokens(used)}</b>{cap ? <> of {tokens(cap)}</> : null}</span>
            {cap ? <span className={pct >= 100 ? 'text-rose-300 font-bold' : pct >= 80 ? 'text-amber-300' : 'text-emerald-300'}>{pct >= 100 ? 'OVER BUDGET' : `${pct.toFixed(0)}%`}</span> : <span className="text-slate-500">no budget set</span>}
          </div>
          {cap > 0 && (
            <div className="h-1.5 rounded-full bg-[#070b12] border border-[#1e2638] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Token budget used">
              <div className={`h-full ${pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-400' : 'bg-cyan-400'}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          {data?.usage.lastRateLimitAt && Date.now() - data.usage.lastRateLimitAt < 10 * 60_000 && (
            <p className="text-rose-300 mt-1">Gemini rate-limited this key in the last 10 minutes: raise the delay or wait.</p>
          )}
        </div>
        <SaveButton onClick={saveQuota} busy={saving} disabled={!data}>Save quota settings</SaveButton>
      </section>

      {/* MODEL ROUTING */}
      <section className="space-y-2 border-t border-cyan-900/40 pt-4">
        <h3 className={`${sectionTitle} flex items-center gap-1.5`}><Route className="w-3.5 h-3.5" />Model Routing</h3>
        <label htmlFor="cfg-model" className="block text-[11px] font-mono text-slate-300">JARVIS chat &amp; all agents</label>
        <select id="cfg-model" value={model} onChange={(e) => setModel(e.target.value)} className={fieldClass} disabled={!data}>
          {options(model).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <label htmlFor="cfg-router" className="block text-[11px] font-mono text-slate-300">Manager routing (keep this fast and cheap)</label>
        <select id="cfg-router" value={router} onChange={(e) => setRouter(e.target.value)} className={fieldClass} disabled={!data}>
          {options(router).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <p className={hintClass}>The list comes from your Gemini key, so it only offers models you can actually use. Voice uses {data?.liveModel ?? 'the Live model'}. Each change is test-called before it is saved.</p>
        <SaveButton onClick={saveRouting} busy={saving} disabled={!data || (model === data.config.model && router === data.config.routerModel)}>Save model routing</SaveButton>
      </section>

      <Status msg={msg} />
    </div>
  );
};
