import React, { useEffect, useState } from 'react';
import { ShieldCheck, Bell, Mail, Loader2 } from 'lucide-react';
import { useJarvisConfig, fieldClass, sectionTitle, hintClass } from './useJarvisConfig';
import { Switch, Status, SaveButton } from './controls';

// Settings → Permission Center: what JARVIS may do on its own (ON), only after the user's yes (ASK),
// or never (OFF); what proactive JARVIS may watch; and the email account. Saved on the backend,
// which enforces it on every tool call.

type Level = 'ON' | 'ASK' | 'OFF';
const PERMS: { key: string; name: string; hint: string; noOn?: boolean }[] = [
  { key: 'PC_CONTROL', name: 'PC control', hint: 'Apps, windows, mouse, keyboard, clipboard, processes' },
  { key: 'BROWSER', name: 'Browser', hint: 'Open sites, search, click, type, read pages, research' },
  { key: 'SCREEN', name: 'Screen access', hint: 'Screenshots and reading what is on screen' },
  { key: 'FILE_ACCESS', name: 'File access', hint: 'Read, create, edit, copy, move, download files' },
  { key: 'FILE_DELETE', name: 'File delete', hint: 'Send files to the Recycle Bin' },
  { key: 'TERMINAL', name: 'Terminal', hint: 'Run commands, dev servers, tests (risky ones always ask)' },
  { key: 'SOFTWARE_INSTALL', name: 'Software install', hint: 'npm / pip / winget installs' },
  { key: 'EMAIL_READ', name: 'Email read', hint: 'Check, search, read, draft' },
  { key: 'EMAIL_SEND', name: 'Email send', hint: 'Send a draft (shows recipient, subject, message)' },
  { key: 'EMAIL_DELETE', name: 'Email delete', hint: 'Move emails to the trash' },
  { key: 'MEMORY', name: 'Memory', hint: 'ASK: only what you approve. OFF: nothing new is saved' },
  { key: 'AUTOMATION', name: 'Automation', hint: 'Reminders, schedules, watches' },
  { key: 'PURCHASES', name: 'Purchases', hint: 'Buy / checkout / pay buttons (never automatic)', noOn: true },
];
const PROACTIVE: { key: string; name: string }[] = [
  { key: 'reminders', name: 'Reminders & automations' },
  { key: 'email', name: 'Important email' },
  { key: 'downloads', name: 'Finished downloads' },
  { key: 'builds', name: 'Build & task errors' },
];
const levelClass: Record<Level, string> = {
  ON: 'border-emerald-400 text-emerald-200 bg-emerald-950/60',
  ASK: 'border-amber-400 text-amber-200 bg-amber-950/50',
  OFF: 'border-rose-400 text-rose-200 bg-rose-950/50',
};

export const PermissionCenter: React.FC = () => {
  const { data, error, saving, save } = useJarvisConfig();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [acct, setAcct] = useState({ address: '', appPassword: '', imap: '', smtp: '' });
  const [acctInfo, setAcctInfo] = useState<{ configured: boolean; hasPassword: boolean } | null>(null);
  const [acctMsg, setAcctMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch('/api/email/account').then((r) => r.json()).then((a) => {
      setAcct((x) => ({ ...x, address: a.address ?? '', imap: a.imap ?? '', smtp: a.smtp ?? '' }));
      setAcctInfo({ configured: !!a.configured, hasPassword: !!a.hasPassword });
    }).catch(() => {});
  }, []);

  const perms = ((data?.config as any)?.permissions ?? {}) as Record<string, Level>;
  const proactive = ((data?.config as any)?.proactive ?? {}) as Record<string, boolean>;

  const setPerm = async (key: string, level: Level) => {
    const err = await save({ permissions: { [key]: level } });
    const name = PERMS.find((p) => p.key === key)!.name;
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `${name}: ${level}. Applies to the next action (voice gets the new rules on the next START AI).` });
    if (!err && key === 'SCREEN') window.dispatchEvent(new CustomEvent('jarvis:screen-permission', { detail: level }));
  };
  const setProactive = async (key: string, on: boolean) => {
    const err = await save({ proactive: { [key]: on } });
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `Proactive ${key === 'enabled' ? 'notifications' : key} ${on ? 'on' : 'off'}.` });
  };
  const saveAccount = async () => {
    setTesting(true);
    setAcctMsg(null);
    try {
      const body: Record<string, string> = { address: acct.address };
      if (acct.appPassword) body.appPassword = acct.appPassword;
      if (acct.imap) body.imap = acct.imap;
      if (acct.smtp) body.smtp = acct.smtp;
      const r = await fetch('/api/email/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      setAcctMsg({ ok: !!d.ok, text: d.message ?? d.error ?? 'Saved.' });
      if (r.ok) { setAcct((x) => ({ ...x, appPassword: '' })); setAcctInfo({ configured: !!d.ok, hasPassword: true }); }
    } catch {
      setAcctMsg({ ok: false, text: 'Could not reach the backend.' });
    } finally { setTesting(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <span className={sectionTitle}>Permission Center</span>
      </div>
      {error && <p className="text-[11px] font-mono text-rose-300 mb-2">{error}</p>}
      {!data ? (!error && <p className="text-xs font-mono text-slate-400">Loading…</p>) : (
        <div className="space-y-3">
          <p className={hintClass}>ON: JARVIS does it when you ask. ASK: it tells you exactly what it will do and waits for your yes (say it, or approve in System Logs → Activity). OFF: never. Deleting data, credentials, uploads and payments always ask.</p>
          <div className="grid gap-1.5">
            {PERMS.map((p) => (
              <div key={p.key} className="flex items-center gap-2 p-1.5 rounded bg-[#070b12] border border-[#1e2638]">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-mono font-bold text-cyan-100">{p.name}</div>
                  <div className="text-[10px] font-mono text-slate-500 leading-snug truncate" title={p.hint}>{p.hint}</div>
                </div>
                <div role="radiogroup" aria-label={p.name} className="flex gap-1 shrink-0">
                  {(['ON', 'ASK', 'OFF'] as Level[]).filter((l) => !(p.noOn && l === 'ON')).map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={perms[p.key] === l} disabled={saving} onClick={() => setPerm(p.key, l)}
                      className={`w-10 py-0.5 rounded border text-[10px] font-mono font-bold cursor-pointer disabled:opacity-50 ${perms[p.key] === l ? levelClass[l] : 'border-[#263040] text-slate-500 hover:text-cyan-200'}`}>{l}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Bell className="w-4 h-4 text-amber-400" />
            <span className={sectionTitle}>Proactive JARVIS</span>
            <div className="flex-1" />
            <Switch label="Proactive notifications" on={!!proactive.enabled} onChange={(v) => setProactive('enabled', v)} disabled={saving} />
          </div>
          <p className={hintClass}>What JARVIS may watch and tell you about. Repeats are dropped and notices are at least 90 seconds apart.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {PROACTIVE.map((p) => (
              <div key={p.key} className={`flex items-center justify-between gap-2 p-1.5 rounded bg-[#070b12] border border-[#1e2638] ${proactive.enabled ? '' : 'opacity-50'}`}>
                <span className="text-[11px] font-mono text-cyan-100">{p.name}</span>
                <Switch label={p.name} on={!!proactive[p.key]} onChange={(v) => setProactive(p.key, v)} disabled={saving || !proactive.enabled} />
              </div>
            ))}
          </div>
          <Status msg={msg} />

          <div className="flex items-center gap-2 pt-1">
            <Mail className="w-4 h-4 text-cyan-400" />
            <span className={sectionTitle}>Email account</span>
            <span className={`text-[10px] font-mono ${acctInfo?.configured ? 'text-emerald-300' : 'text-slate-500'}`}>{acctInfo?.configured ? 'connected' : 'not set up'}</span>
          </div>
          <p className={hintClass}>IMAP/SMTP with an app password (Gmail: Google Account → Security → 2-Step Verification → App passwords). Stored on this PC only (OS-encrypted in the desktop app), never shown again. Outlook, Yahoo and iCloud servers are filled in automatically.</p>
          <div className="grid grid-cols-2 gap-1.5">
            <input className={fieldClass} placeholder="you@gmail.com" aria-label="Email address" value={acct.address} onChange={(e) => setAcct({ ...acct, address: e.target.value })} />
            <input className={fieldClass} type="password" autoComplete="new-password" placeholder={acctInfo?.hasPassword ? 'App password (saved)' : 'App password'} aria-label="App password" value={acct.appPassword} onChange={(e) => setAcct({ ...acct, appPassword: e.target.value })} />
            <input className={fieldClass} placeholder="IMAP server (optional)" aria-label="IMAP server" value={acct.imap} onChange={(e) => setAcct({ ...acct, imap: e.target.value })} />
            <input className={fieldClass} placeholder="SMTP server (optional)" aria-label="SMTP server" value={acct.smtp} onChange={(e) => setAcct({ ...acct, smtp: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <SaveButton onClick={saveAccount} busy={testing} disabled={!acct.address}>{testing ? 'Connecting' : 'Save & test'}</SaveButton>
            {testing && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-300" />}
          </div>
          <Status msg={acctMsg} />
        </div>
      )}
    </div>
  );
};
