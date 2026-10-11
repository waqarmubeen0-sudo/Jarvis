import React, { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { useJarvisConfig, fieldClass, sectionTitle, hintClass, JarvisConfig } from '../settings/useJarvisConfig';
import { Segmented, Status, SaveButton } from '../settings/controls';

// SOUL node: the master directives, tone and autonomy that are injected into every JARVIS
// system instruction (text chat now, voice from the next START AI) and the agents' prompts.

type Soul = JarvisConfig['soul'];
const PERSONALITY: { id: Soul['personality']; name: string }[] = [
  { id: 'PROFESSIONAL', name: 'Strictly Professional' },
  { id: 'CASUAL', name: 'Casual' },
  { id: 'SARCASTIC', name: 'Sarcastic' },
];
const MAX = 4000;

export const SoulPanel: React.FC = () => {
  const { data, error, saving, save } = useJarvisConfig();
  const [soul, setSoul] = useState<Soul | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data && !soul) setSoul(data.config.soul); }, [data, soul]);

  const dirty = !!soul && !!data && JSON.stringify(soul) !== JSON.stringify(data.config.soul);
  const submit = async () => {
    if (!soul) return;
    const err = await save({ soul });
    setMsg(err ? { ok: false, text: err } : { ok: true, text: 'SOUL saved. Text chat and agents use it now; voice picks it up on the next START AI.' });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Flame className="w-5 h-5 text-rose-400" />
        <h3 className="font-mono-tech text-sm font-bold text-cyan-100 uppercase">J.A.R.V.I.S. Persona Core // SOUL</h3>
      </div>
      {error && <p className="text-[11px] font-mono text-rose-300 mb-2">{error}</p>}
      {!soul ? (
        !error && <p className="text-xs font-mono text-slate-400 mb-4">Loading…</p>
      ) : (
        <div className="space-y-4 mb-4">
          <section className="space-y-1.5">
            <label htmlFor="soul-directives" className={sectionTitle}>Core Directives</label>
            <textarea
              id="soul-directives"
              rows={6}
              maxLength={MAX}
              value={soul.directives}
              onChange={(e) => setSoul({ ...soul, directives: e.target.value })}
              placeholder={'Rules JARVIS always follows, e.g.\n- Call me by my first name, never "Sir".\n- Keep answers under 5 sentences unless I ask for detail.\n- Ask before spending money or deleting anything.'}
              className={`${fieldClass} resize-y min-h-[110px] leading-relaxed`}
            />
            <div className="flex justify-between">
              <p className={hintClass}>Added to JARVIS's system instruction and to every agent's prompt.</p>
              <span className={`text-[10px] font-mono shrink-0 ${soul.directives.length > MAX * 0.9 ? 'text-amber-300' : 'text-slate-500'}`}>{soul.directives.length}/{MAX}</span>
            </div>
          </section>

          <section className="space-y-1.5">
            <label htmlFor="soul-personality" className={sectionTitle}>Personality Matrix</label>
            <select id="soul-personality" value={soul.personality} onChange={(e) => setSoul({ ...soul, personality: e.target.value as Soul['personality'] })} className={fieldClass}>
              {PERSONALITY.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </section>

          <section className="space-y-1.5">
            <span className={sectionTitle}>Autonomy Level</span>
            <Segmented
              label="Autonomy level"
              value={soul.autonomy}
              onChange={(autonomy) => setSoul({ ...soul, autonomy })}
              options={[
                { id: 'REACTIVE', name: 'Reactive', hint: 'Waits for your commands; never starts work on its own.' },
                { id: 'PROACTIVE', name: 'Proactive', hint: 'Delegates clear work, reports finished background tasks and suggests next steps.' },
              ]}
            />
          </section>

          <div className="flex items-center gap-3">
            <SaveButton onClick={submit} busy={saving} disabled={!dirty}>Save SOUL</SaveButton>
            {dirty && <span className="text-[10px] font-mono text-amber-300">Unsaved changes</span>}
          </div>
          <Status msg={msg} />
        </div>
      )}
    </div>
  );
};
