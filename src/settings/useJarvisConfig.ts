import { useCallback, useEffect, useState } from 'react';

// Shared access to the backend JARVIS config (GET/POST /api/config) for the Settings menu and the
// SOUL / THINKING / SKILLS node panels. The server validates and persists every change.

export interface JarvisConfig {
  model: string;
  routerModel: string;
  temperature: number | null;
  depth: 'FAST' | 'DEEP' | 'CUSTOM';
  soul: { directives: string; personality: 'PROFESSIONAL' | 'CASUAL' | 'SARCASTIC'; autonomy: 'REACTIVE' | 'PROACTIVE' };
  skills: { webSearch: boolean; fileSystem: boolean; codeExecution: boolean };
  training: Record<string, { language: string; context: string }>;
  limits: { delaySec: number; tokenBudget: number };
}
export interface ConfigPayload {
  config: JarvisConfig;
  models: { id: string; label: string; inputTokenLimit?: number }[];
  liveModel: string;
  languages: string[];
  agents: string[];
  usage: { totalTokens: number; calls: number; errors: number; lastRateLimitAt: number | null };
  context: { source: 'voice' | 'chat'; model: string; tokens: number; at: number; limit: number | null } | null;
}

export function useJarvisConfig(pollMs = 0) {
  const [data, setData] = useState<ConfigPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/config');
      // An older server has no /api/config route and answers with the dashboard's HTML page.
      if (!(r.headers.get('content-type') ?? '').includes('json')) {
        setError('The J.A.R.V.I.S. server is running an older version without these settings. Restart it (close its window and run start-jarvis.bat).');
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch {
      setError('Could not reach the J.A.R.V.I.S. server. Start it with start-jarvis.bat, then reopen this panel.');
    }
  }, []);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const iv = window.setInterval(load, pollMs);
    return () => window.clearInterval(iv);
  }, [load, pollMs]);

  /** Saves a partial config. Resolves to an error message, or null on success. */
  const save = useCallback(async (patch: Record<string, unknown>): Promise<string | null> => {
    setSaving(true);
    try {
      const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return d.error || `Save failed (HTTP ${r.status})`;
      setData((prev) => (prev ? { ...prev, config: d.config } : prev));
      return null;
    } catch {
      return 'Could not reach the backend.';
    } finally {
      setSaving(false);
    }
  }, []);

  return { data, error, saving, save, reload: load };
}

/** Small shared UI pieces for the config panels. */
export const fieldClass = 'w-full bg-[#070b12] border border-[#1e2638] rounded p-2 text-xs font-mono text-cyan-100 outline-none focus:border-cyan-400';
export const sectionTitle = 'text-[11px] font-mono font-bold tracking-wider text-cyan-300 uppercase';
export const hintClass = 'text-[10px] font-mono text-slate-500 leading-snug';
