import React from 'react';
import { Check, Loader2 } from 'lucide-react';

/** On/off switch (a real button with role="switch"). */
export const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({ on, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`relative w-10 h-5 shrink-0 rounded-full border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default ${on ? 'bg-cyan-500/40 border-cyan-400' : 'bg-[#070b12] border-[#263040]'}`}
  >
    <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${on ? 'left-[21px] bg-cyan-200 shadow-[0_0_8px_var(--dc)]' : 'left-0.5 bg-slate-500'}`} />
  </button>
);

/** Two-or-more-way toggle. */
export function Segmented<T extends string>({ value, options, onChange, label, disabled }: {
  value: T | null; options: { id: T; name: string; hint?: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`p-2 rounded border text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default ${value === o.id ? 'bg-cyan-950/70 border-cyan-400 shadow-[0_0_10px_rgba(var(--dc-rgb),0.25)]' : 'bg-[#070b12] border-[#1e2638] hover:border-cyan-500/40'}`}
        >
          <span className="flex items-center justify-between gap-1 text-[11px] font-mono font-bold text-cyan-100">
            {o.name}{value === o.id && <Check className="w-3.5 h-3.5 text-cyan-300 shrink-0" />}
          </span>
          {o.hint && <span className="block text-[10px] font-mono text-slate-400 mt-0.5 leading-snug">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** Save result line. */
export const Status: React.FC<{ msg: { ok: boolean; text: string } | null }> = ({ msg }) =>
  msg ? <p role="status" className={`text-[10.5px] font-mono leading-snug ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</p> : null;

export const SaveButton: React.FC<{ onClick: () => void; busy: boolean; disabled?: boolean; children: React.ReactNode }> = ({ onClick, busy, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy || disabled}
    className="py-1.5 px-3 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-default text-slate-950 font-bold font-mono text-[11px] uppercase rounded cursor-pointer flex items-center justify-center gap-1.5"
  >
    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{children}
  </button>
);
