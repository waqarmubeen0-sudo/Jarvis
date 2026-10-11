// Permission Center + confirmation gate.
//
// Every tool call passes gate() before it runs:
//   OFF  -> refused, with the reason ("Permission required").
//   ASK  -> held: JARVIS tells the user exactly what will happen and asks. It runs only after the user
//           themselves say yes (voice / typed) or presses Approve in the dashboard. The model can't
//           approve on its own, and what runs is what was shown, not a re-worded call.
//   ON   -> runs, unless the action is high-impact (destructive command, credentials, uploads,
//           purchases): those always ask, whatever the level.
import { permissionLevel, type PermKey } from './apiSettings';
import { logActivity } from './activity';
import { YES, NO } from './webGate';

export interface Confirmation {
  id: string;
  tool: string;
  args: Record<string, any>;
  summary: string; // exactly what will happen
  reason: string; // why it needs a yes
  at: number;
  state: 'PENDING' | 'APPROVED' | 'DENIED' | 'DONE' | 'EXPIRED';
}
export interface Risk { reason: string; perm?: PermKey }

const WINDOW_MS = 3 * 60 * 1000;
const items: Confirmation[] = [];
const listeners = new Set<(c: Confirmation) => void>();
const emit = (c: Confirmation) => listeners.forEach((cb) => { try { cb(c); } catch {} });
export const onConfirmation = (cb: (c: Confirmation) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

function expire(now = Date.now()) {
  for (const c of items) if ((c.state === 'PENDING' || c.state === 'APPROVED') && now - c.at > WINDOW_MS) { c.state = 'EXPIRED'; emit(c); }
  while (items.length > 50) items.shift();
}

export function listConfirmations() {
  expire();
  return items.slice().reverse().map(({ args, ...c }) => c);
}

function request(tool: string, args: Record<string, any>, summary: string, reason: string, now = Date.now()) {
  expire(now);
  for (const c of items) if (c.tool === tool && c.state === 'PENDING') c.state = 'EXPIRED'; // a new request replaces an unanswered one
  const c: Confirmation = { id: `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, tool, args, summary, reason, at: now, state: 'PENDING' };
  items.push(c);
  logActivity('CONFIRM', `Asked the user: ${summary} (${reason})`, { tool });
  emit(c);
  return {
    status: 'NEEDS_CONFIRMATION',
    confirmId: c.id,
    message: `Not done yet: this needs the user's confirmation (${reason}). Tell them exactly what will happen: ${summary}. Then ask "Shall I go ahead?". Do not claim it happened. ` +
      `If they say yes (or approves it in the dashboard), call ${tool} again and the approved action runs. If they say no, drop it.`,
  };
}

/** The user's own words (speech transcript or typed text) answer the latest open question. */
export function hearUser(text: string, now = Date.now()) {
  expire(now);
  const c = [...items].reverse().find((x) => x.state === 'PENDING');
  // The tail of the request itself ("ok, send it") can still be arriving: only later words answer.
  if (!c || now - c.at < 1500) return;
  if (NO.test(text)) decide(c.id, false, 'voice');
  else if (YES.test(text)) decide(c.id, true, 'voice');
}

/** Approve / deny from the dashboard (or from hearUser). */
export function decide(id: string, approve: boolean, via: 'voice' | 'dashboard') {
  const c = items.find((x) => x.id === id);
  if (!c || c.state !== 'PENDING') return null;
  c.state = approve ? 'APPROVED' : 'DENIED';
  logActivity('CONFIRM', `The user ${approve ? 'approved' : 'declined'} (${via}): ${c.summary}`, { tool: c.tool });
  emit(c);
  return c;
}

/** The approved args for this tool, once (null if nothing was approved). */
function takeApproved(tool: string, now = Date.now()) {
  expire(now);
  const c = items.find((x) => x.tool === tool && x.state === 'APPROVED');
  if (!c) return null;
  c.state = 'DONE';
  emit(c);
  return c.args;
}

export const PERM_LABEL: Record<PermKey, string> = {
  PC_CONTROL: 'PC control', BROWSER: 'browser', SCREEN: 'screen access', FILE_ACCESS: 'file access', FILE_DELETE: 'file delete',
  TERMINAL: 'terminal', SOFTWARE_INSTALL: 'software install', EMAIL_READ: 'email read', EMAIL_SEND: 'email send', EMAIL_DELETE: 'email delete',
  MEMORY: 'memory', AUTOMATION: 'automation', PURCHASES: 'purchases',
};

export type GateResult = { run: true; args: Record<string, any> } | { run: false; result: Record<string, any> };

/** Decides whether a tool call may run now. */
export function gate(tool: string, args: Record<string, any>, perms: PermKey[], risk: Risk | null, summary: string): GateResult {
  const all = risk?.perm ? [...perms, risk.perm] : perms;
  const off = all.find((p) => permissionLevel(p) === 'OFF');
  if (off) {
    logActivity('ERROR', `Blocked ${tool}: ${PERM_LABEL[off]} is OFF in the Permission Center`, { tool });
    return { run: false, result: { status: 'FAILED', error: `Permission required: ${PERM_LABEL[off].toUpperCase()} is OFF in the Permission Center (Settings). Tell the user; only they can turn it on.` } };
  }
  const approved = takeApproved(tool);
  if (approved) return { run: true, args: approved };
  const ask = all.find((p) => permissionLevel(p) === 'ASK');
  if (ask || (risk && !risk.perm)) return { run: false, result: request(tool, args, summary, risk?.reason ?? `${PERM_LABEL[ask!]} is set to ASK`) };
  return { run: true, args };
}
