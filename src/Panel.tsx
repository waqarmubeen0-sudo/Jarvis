import React from 'react';

interface PanelProps {
  title: string;
  badge?: string;
  badgeColor?: 'cyan' | 'amber' | 'emerald' | 'purple';
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({
  title,
  badge,
  badgeColor = 'cyan',
  icon,
  children,
  className = '',
}) => {
  const badgeClasses = {
    cyan: 'bg-cyan-950 text-cyan-400 border-cyan-500/40',
    amber: 'bg-amber-950 text-amber-400 border-amber-500/40',
    emerald: 'bg-emerald-950 text-emerald-400 border-emerald-500/40',
    purple: 'bg-purple-950 text-purple-400 border-purple-500/40',
  }[badgeColor];

  return (
    <div
      className={`bg-slate-950/80 border border-cyan-500/30 rounded-xl p-3 backdrop-blur-md flex flex-col gap-2.5 shadow-xl relative overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between border-b border-cyan-900/40 pb-2">
        <div className="flex items-center gap-2">
          {icon && <div className="text-cyan-400">{icon}</div>}
          <h3 className="font-mono-tech text-xs font-bold text-cyan-100 uppercase tracking-wider">
            {title}
          </h3>
        </div>
        {badge && (
          <span className={`text-[9px] font-mono px-2 py-0.5 rounded border uppercase ${badgeClasses}`}>
            {badge}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
};
