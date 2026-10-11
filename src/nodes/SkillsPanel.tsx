import React, { useEffect, useRef, useState } from 'react';
import { Cpu, Globe, FolderTree, Code2, Upload } from 'lucide-react';
import { useJarvisConfig, fieldClass, sectionTitle, hintClass, JarvisConfig } from '../settings/useJarvisConfig';
import { Switch, Status, SaveButton } from '../settings/controls';

// SKILLS node: Plugin Manager (which backend tools JARVIS and the agents get) and Agent Training
// (per-agent default coding language and reference context).

type Skills = JarvisConfig['skills'];
const PLUGINS: { key: keyof Skills; name: string; icon: typeof Globe; desc: string }[] = [
  { key: 'webSearch', name: 'Web Search', icon: Globe, desc: 'search_web, research_web, Google Search grounding and agent web research.' },
  { key: 'fileSystem', name: 'File System', icon: FolderTree, desc: 'Create, move, delete and list files and folders on your PC. (Reading files you DROP stays on.)' },
  { key: 'codeExecution', name: 'Code Execution', icon: Code2, desc: "Gemini's sandboxed code runner for the agent team (it cannot touch your PC). The voice model doesn't support it." },
];
const MAX_CONTEXT = 20_000;
const TEXT_FILE = '.txt,.md,.json,.csv,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.cs,.cpp,.c,.h,.java,.go,.rs,.gd,.lua,.sql,.sh';

export const SkillsPanel: React.FC = () => {
  const { data, error, saving, save } = useJarvisConfig();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [agent, setAgent] = useState('CODE');
  const [lang, setLang] = useState('');
  const [ctx, setCtx] = useState('');
  const file = useRef<HTMLInputElement | null>(null);
  const [catalog, setCatalog] = useState<{ id: string; name: string; description: string; tools: string[] }[]>([]);
  useEffect(() => { fetch('/api/skills').then((r) => r.json()).then((d) => setCatalog(d.skills ?? [])).catch(() => {}); }, []);

  const training = data?.config.training ?? {};
  // Load the chosen agent's saved training into the form.
  useEffect(() => {
    const t = training[agent];
    setLang(t?.language ?? '');
    setCtx(t?.context ?? '');
  }, [agent, data?.config.training]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (key: keyof Skills, on: boolean) => {
    const err = await save({ skills: { [key]: on } });
    const name = PLUGINS.find((p) => p.key === key)!.name;
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `${name} ${on ? 'enabled' : 'disabled'}. Text chat and agents follow it now; voice gets the new tool list on the next START AI.` });
  };

  const upload = async (f: File) => {
    if (f.size > 2_000_000) return setMsg({ ok: false, text: 'That file is too large; use a text file under 2 MB.' });
    const text = await f.text();
    const joined = (ctx.trim() ? `${ctx.trim()}\n\n` : '') + `--- ${f.name} ---\n${text}`;
    setCtx(joined.slice(0, MAX_CONTEXT));
    setMsg({ ok: true, text: joined.length > MAX_CONTEXT ? `Added ${f.name}, trimmed to ${MAX_CONTEXT.toLocaleString()} characters. Click Save training.` : `Added ${f.name}. Click Save training to keep it.` });
  };

  const saveTraining = async (clear = false) => {
    const err = await save({ training: { [agent]: clear ? null : { language: lang, context: ctx } } });
    if (clear && !err) { setLang(''); setCtx(''); }
    setMsg(err ? { ok: false, text: err } : { ok: true, text: clear ? `${agent}'s training cleared.` : `${agent} trained. It applies to its next task.` });
  };

  const saved = training[agent];
  const dirty = (saved?.language ?? '') !== lang || (saved?.context ?? '') !== ctx;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Cpu className="w-5 h-5 text-amber-400" />
        <h3 className="font-mono-tech text-sm font-bold text-cyan-100 uppercase">J.A.R.V.I.S. Skills // Plugins &amp; Training</h3>
      </div>
      {error && <p className="text-[11px] font-mono text-rose-300 mb-2">{error}</p>}
      {!data ? (
        !error && <p className="text-xs font-mono text-slate-400 mb-4">Loading…</p>
      ) : (
        <div className="space-y-4 mb-4">
          <section className="space-y-2">
            <span className={sectionTitle}>Plugin Manager</span>
            {PLUGINS.map((p) => (
              <div key={p.key} className="flex items-start gap-3 p-2 rounded bg-[#070b12] border border-[#1e2638]">
                <p.icon className={`w-4 h-4 mt-0.5 shrink-0 ${data.config.skills[p.key] ? 'text-cyan-300' : 'text-slate-600'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono font-bold text-cyan-100">{p.name}</div>
                  <div className="text-[10px] font-mono text-slate-400 leading-snug">{p.desc}</div>
                </div>
                <Switch label={p.name} on={data.config.skills[p.key]} onChange={(v) => toggle(p.key, v)} disabled={saving} />
              </div>
            ))}
          </section>

          {catalog.length > 0 && (
            <section className="space-y-1.5 border-t border-[#1e2638] pt-4">
              <span className={sectionTitle}>Skill Registry</span>
              <p className={hintClass}>Every capability is a skill module with its own tools; JARVIS picks the right one per request. Permissions are set in Settings → Permission Center.</p>
              <div className="grid grid-cols-2 gap-1.5">
                {catalog.map((s) => (
                  <div key={s.id} className="p-1.5 rounded bg-[#070b12] border border-[#1e2638]" title={s.tools.join(', ')}>
                    <div className="text-[10.5px] font-mono font-bold text-cyan-100">{s.name} <span className="font-normal text-slate-500">· {s.tools.length} tool{s.tools.length === 1 ? '' : 's'}</span></div>
                    <div className="text-[10px] font-mono text-slate-400 leading-snug">{s.description}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2 border-t border-[#1e2638] pt-4">
            <span className={sectionTitle}>Agent Training</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="train-agent" className="block text-[10px] font-mono text-slate-400 mb-1">Agent</label>
                <select id="train-agent" value={agent} onChange={(e) => setAgent(e.target.value)} className={fieldClass}>
                  {data.agents.map((id) => <option key={id} value={id}>{id}{training[id] ? ' ●' : ''}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="train-lang" className="block text-[10px] font-mono text-slate-400 mb-1">Default coding language</label>
                <select id="train-lang" value={lang} onChange={(e) => setLang(e.target.value)} className={fieldClass}>
                  <option value="">No default</option>
                  {data.languages.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
            <label htmlFor="train-ctx" className="block text-[10px] font-mono text-slate-400">Reference context (style guides, project notes, APIs…)</label>
            <textarea id="train-ctx" rows={5} value={ctx} maxLength={MAX_CONTEXT} onChange={(e) => setCtx(e.target.value)} placeholder={`What ${agent} should always know, e.g. "Our backend is FastAPI + Postgres; follow PEP 8."`} className={`${fieldClass} resize-y min-h-[90px]`} />
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => file.current?.click()} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/15 text-[11px] font-mono cursor-pointer">
                <Upload className="w-3.5 h-3.5" />Upload context file
              </button>
              <span className="text-[10px] font-mono text-slate-500">{ctx.length.toLocaleString()}/{MAX_CONTEXT.toLocaleString()}</span>
              <input ref={file} type="file" accept={TEXT_FILE} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            </div>
            <div className="flex items-center gap-2">
              <SaveButton onClick={() => saveTraining()} busy={saving} disabled={!dirty}>Save training</SaveButton>
              {saved && <button type="button" onClick={() => saveTraining(true)} disabled={saving} className="px-3 py-1.5 rounded border border-rose-500/50 text-rose-200 hover:bg-rose-950/40 text-[11px] font-mono uppercase cursor-pointer disabled:opacity-40">Clear</button>}
            </div>
            <p className={hintClass}>Added to that agent's prompt for every task it works on (solo or in a task force).</p>
          </section>
          <Status msg={msg} />
        </div>
      )}
    </div>
  );
};
