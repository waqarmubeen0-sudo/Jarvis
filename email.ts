// EMAIL skill: The user's mailbox over IMAP (read) + SMTP (send).
//   check, search, read, summarize, attachment downloads, archive, delete: IMAP
//   draft, reply, forward: build a draft (also saved to the mailbox's Drafts folder), never sent
//   send: sends a draft. Needs EMAIL_SEND (ASK by default): JARVIS shows/announces recipient,
//         subject and message and waits for the user's yes.
// Account: EMAIL_ADDRESS + EMAIL_APP_PASSWORD (+ optional EMAIL_IMAP_HOST / EMAIL_SMTP_HOST) kept by
// credentials.ts, set from Settings -> Permission Center. Gmail / Outlook / Yahoo / iCloud hosts are known.
import fs from 'node:fs';
import path from 'node:path';
import { Type } from '@google/genai';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { credential } from './credentials';
import { simpleParser, type ParsedMail } from 'mailparser';
import { resolvePath } from './osTools';
import { DOWNLOADS } from './browserControl';
import { registerSkill, type ToolResult } from './skillRegistry';

const HOSTS: Record<string, { imap: string; smtp: string }> = {
  'gmail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' }, 'googlemail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'outlook.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' }, 'hotmail.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'live.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' }, 'yahoo.com': { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
  'icloud.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' }, 'me.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' },
};

export function emailAccount() {
  const user = credential('EMAIL_ADDRESS');
  const pass = credential('EMAIL_APP_PASSWORD').replace(/\s+/g, '');
  const known = HOSTS[user.split('@')[1]?.toLowerCase() ?? ''];
  const imap = credential('EMAIL_IMAP_HOST') || known?.imap || '';
  const smtp = credential('EMAIL_SMTP_HOST') || known?.smtp || '';
  return { user, pass, imap, smtp, configured: !!(user && pass && imap && smtp) };
}
const NOT_SET = 'Email is not set up yet. The user needs to add their address and an app password in Settings -> Permission Center -> Email account (for Gmail: Google Account -> Security -> 2-Step Verification -> App passwords).';

async function withImap<T>(job: (c: ImapFlow) => Promise<T>): Promise<T> {
  const acc = emailAccount();
  if (!acc.configured) throw new Error(NOT_SET);
  const client = new ImapFlow({ host: acc.imap, port: 993, secure: true, auth: { user: acc.user, pass: acc.pass }, logger: false });
  try {
    await client.connect();
  } catch (e: any) {
    throw new Error(/auth|credential|invalid|login/i.test(String(e?.responseText ?? e?.message)) ? `The mail server rejected the login for ${acc.user} (check the app password).` : `Couldn't reach ${acc.imap}: ${e?.message ?? e}`);
  }
  try { return await job(client); } finally { await client.logout().catch(() => {}); }
}

const addr = (list: any) => (list ?? []).map((x: any) => (x.name ? `${x.name} <${x.address}>` : x.address)).join(', ');
const view = (m: any) => ({ uid: m.uid, from: addr(m.envelope?.from), subject: m.envelope?.subject ?? '(no subject)', date: m.envelope?.date ? new Date(m.envelope.date).toLocaleString() : '', unread: !m.flags?.has('\\Seen'), flagged: !!m.flags?.has('\\Flagged') });

async function listMessages(c: ImapFlow, query: any, limit: number) {
  const lock = await c.getMailboxLock('INBOX');
  try {
    const uids = ((await c.search(query, { uid: true })) || []) as number[];
    const pick = uids.slice(-Math.max(1, Math.min(50, limit)));
    const out: any[] = [];
    if (pick.length) for await (const m of c.fetch(pick, { envelope: true, flags: true, uid: true }, { uid: true })) out.push(view(m));
    return { total: uids.length, messages: out.reverse() };
  } finally { lock.release(); }
}

async function fetchParsed(c: ImapFlow, uid: number): Promise<ParsedMail> {
  const lock = await c.getMailboxLock('INBOX');
  try {
    const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
    if (!m || !m.source) throw new Error(`No email with id ${uid} in the inbox.`);
    return await simpleParser(m.source);
  } finally { lock.release(); }
}
const bodyOf = (p: ParsedMail) => (p.text || (typeof p.html === 'string' ? p.html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ') : '') || '').replace(/\n{3,}/g, '\n\n').trim();
const fromOf = (p: ParsedMail) => (p.from?.value ?? []).map((x) => x.address).filter(Boolean)[0] ?? '';

// ---------------------------------------------------------------------------------------------
// Drafts (local, plus a copy in the mailbox's Drafts folder)

interface Draft { id: string; to: string; cc?: string; subject: string; body: string; attachments: string[]; inReplyTo?: string; references?: string; forwarded?: { filename: string; content: Buffer }[]; createdAt: string; sent?: string }
const drafts = new Map<string, Draft>();

function newDraft(d: Omit<Draft, 'id' | 'createdAt'>): Draft {
  if (!/@/.test(d.to)) throw new Error('A draft needs a recipient email address (to).');
  for (const f of d.attachments) if (!fs.existsSync(f)) throw new Error(`Attachment not found: ${f}`);
  const draft: Draft = { ...d, id: `draft-${Date.now().toString(36)}`, createdAt: new Date().toISOString() };
  drafts.set(draft.id, draft);
  return draft;
}
const mailOf = (d: Draft, from: string) => ({
  from, to: d.to, cc: d.cc, subject: d.subject, text: d.body, inReplyTo: d.inReplyTo, references: d.references,
  attachments: [...d.attachments.map((p) => ({ path: p })), ...(d.forwarded ?? [])],
});
async function saveToDrafts(d: Draft) {
  const acc = emailAccount();
  const raw: Buffer = await new Promise((res, rej) => nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(mailOf(d, acc.user), (e, info: any) => (e ? rej(e) : res(info.message))));
  await withImap(async (c) => {
    const box = (await c.list()).find((b: any) => b.specialUse === '\\Drafts');
    if (box) await c.append(box.path, raw, ['\\Draft']);
  });
}
const draftView = (d: Draft) => ({ draftId: d.id, to: d.to, ...(d.cc ? { cc: d.cc } : {}), subject: d.subject, body: d.body, attachments: [...d.attachments.map((p) => path.basename(p)), ...(d.forwarded ?? []).map((f) => f.filename)] });

// ---------------------------------------------------------------------------------------------
// Actions

async function emailAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'check').toLowerCase();
  const limit = Number(a.limit ?? 10);
  switch (action) {
    case 'check': return withImap(async (c) => {
      const r = await listMessages(c, a.unread === false ? { all: true } : { seen: false }, limit);
      if (!r.messages.length && a.unread !== false) { const all = await listMessages(c, { all: true }, Math.min(limit, 5)); return { status: 'SUCCESS', message: 'No unread emails. Latest ones:', unread: 0, messages: all.messages }; }
      return { status: 'SUCCESS', message: `${r.total} ${a.unread === false ? '' : 'unread '}email(s)${r.total > r.messages.length ? `, showing the newest ${r.messages.length}` : ''}`, unread: a.unread === false ? undefined : r.total, messages: r.messages };
    });
    case 'search': return withImap(async (c) => {
      const q: any = {};
      if (a.from) q.from = String(a.from);
      if (a.subject) q.subject = String(a.subject);
      if (a.query) q.body = String(a.query);
      if (a.since) q.since = new Date(String(a.since));
      if (!Object.keys(q).length) throw new Error('search needs from, subject, query or since.');
      const r = await listMessages(c, q, limit);
      return { status: 'SUCCESS', message: `${r.total} match(es)`, messages: r.messages };
    });
    case 'read': case 'summarize': return withImap(async (c) => {
      let uids: number[] = a.uid ? [Number(a.uid)] : [];
      if (!uids.length) {
        const q: any = a.from ? { from: String(a.from) } : action === 'summarize' ? { seen: false } : { all: true };
        uids = (await listMessages(c, q, action === 'summarize' ? Math.min(limit, 10) : 1)).messages.map((m) => m.uid);
        if (!uids.length) return { status: 'SUCCESS', message: a.from ? `No emails from ${a.from}.` : 'Nothing to read.' };
      }
      const out = [];
      for (const uid of uids) {
        const p = await fetchParsed(c, uid);
        const body = bodyOf(p);
        out.push({ uid, from: p.from?.text ?? '', to: p.to ? (Array.isArray(p.to) ? p.to.map((x) => x.text).join(', ') : p.to.text) : '', subject: p.subject ?? '', date: p.date?.toLocaleString() ?? '',
          text: action === 'summarize' ? body.slice(0, 1200) : body.slice(0, 12000), attachments: p.attachments.map((x) => `${x.filename ?? 'attachment'} (${Math.round(x.size / 1024)} KB)`) });
      }
      return { status: 'SUCCESS', message: action === 'summarize' ? `${out.length} email(s) to summarise` : `Read "${out[0].subject}"`, emails: out };
    });
    case 'download_attachment': return withImap(async (c) => {
      const p = await fetchParsed(c, Number(a.uid));
      const want = String(a.name ?? '').toLowerCase();
      const list = p.attachments.filter((x) => !want || (x.filename ?? '').toLowerCase().includes(want));
      if (!list.length) return { status: 'FAILED', error: want ? `No attachment named "${a.name}".` : 'That email has no attachments.' };
      fs.mkdirSync(DOWNLOADS, { recursive: true });
      const saved = list.map((x) => { const f = path.join(DOWNLOADS, (x.filename ?? 'attachment').replace(/[\\/:*?"<>|]/g, '_')); fs.writeFileSync(f, x.content); return f; });
      return { status: 'SUCCESS', message: `Saved ${saved.length} attachment(s) to ${DOWNLOADS}`, paths: saved };
    });
    case 'draft': {
      const d = newDraft({ to: String(a.to ?? ''), cc: a.cc ? String(a.cc) : undefined, subject: String(a.subject ?? ''), body: String(a.body ?? ''), attachments: (a.attachments ?? []).map((p: string) => resolvePath(p)) });
      const saved = await saveToDrafts(d).then(() => true, () => false);
      return { status: 'SUCCESS', message: `Draft ready (not sent)${saved ? ', also saved in your Drafts folder' : ''}. Read it back to the user and ask if they want it sent.`, ...draftView(d) };
    }
    case 'reply': case 'forward': {
      const orig = await withImap((c) => fetchParsed(c, Number(a.uid)));
      const quoted = `\n\n---- On ${orig.date?.toLocaleString() ?? ''}, ${orig.from?.text ?? ''} wrote ----\n${bodyOf(orig).slice(0, 4000).split('\n').map((l) => `> ${l}`).join('\n')}`;
      const subject = (orig.subject ?? '').replace(/^((re|fwd?):\s*)+/i, '');
      const d = action === 'reply'
        ? newDraft({ to: a.all && orig.cc ? [fromOf(orig), ...(Array.isArray(orig.cc) ? orig.cc : [orig.cc]).map((x) => x.text)].join(', ') : fromOf(orig), subject: `Re: ${subject}`, body: String(a.body ?? '') + quoted,
          attachments: (a.attachments ?? []).map((p: string) => resolvePath(p)), inReplyTo: orig.messageId, references: [orig.references ?? [], orig.messageId].flat().filter(Boolean).join(' ') })
        : newDraft({ to: String(a.to ?? ''), subject: `Fwd: ${subject}`, body: String(a.body ?? '') + quoted, attachments: (a.attachments ?? []).map((p: string) => resolvePath(p)),
          forwarded: orig.attachments.map((x) => ({ filename: x.filename ?? 'attachment', content: x.content })) });
      const saved = await saveToDrafts(d).then(() => true, () => false);
      return { status: 'SUCCESS', message: `${action === 'reply' ? 'Reply' : 'Forward'} drafted (not sent)${saved ? ', also saved in Drafts' : ''}. Read it back and ask before sending.`, ...draftView(d) };
    }
    case 'send': {
      const d = drafts.get(String(a.draftId ?? '')) ?? [...drafts.values()].reverse().find((x) => !x.sent);
      if (!d) return { status: 'FAILED', error: 'There is no draft to send. Make one with draft, reply or forward first.' };
      if (d.sent) return { status: 'FAILED', error: `That draft was already sent at ${d.sent}.` };
      const acc = emailAccount();
      if (!acc.configured) throw new Error(NOT_SET);
      const t = nodemailer.createTransport({ host: acc.smtp, port: 465, secure: true, auth: { user: acc.user, pass: acc.pass } });
      const info = await t.sendMail(mailOf(d, acc.user));
      d.sent = new Date().toLocaleString();
      return { status: 'SUCCESS', message: `Sent "${d.subject}" to ${d.to}`, messageId: info.messageId, accepted: info.accepted };
    }
    case 'archive': case 'delete': return withImap(async (c) => {
      const boxes = await c.list();
      const target = boxes.find((b: any) => b.specialUse === (action === 'archive' ? '\\All' : '\\Trash')) ?? boxes.find((b: any) => b.specialUse === '\\Archive') ?? boxes.find((b: any) => new RegExp(action === 'archive' ? 'archive' : 'trash|deleted', 'i').test(b.path));
      const lock = await c.getMailboxLock('INBOX');
      try {
        if (target) await c.messageMove(String(Number(a.uid)), target.path, { uid: true });
        else if (action === 'delete') await c.messageDelete(String(Number(a.uid)), { uid: true });
        else throw new Error('This mailbox has no Archive folder.');
      } finally { lock.release(); }
      return { status: 'SUCCESS', message: action === 'archive' ? 'Archived it' : `Moved it to ${target?.path ?? 'deleted'}` };
    });
  }
  return { status: 'FAILED', error: `Unknown email action "${action}".` };
}

/** Logs in and reads the inbox counters (Settings -> Email account -> Save & test). */
export const testEmailLogin = () => withImap(async (c) => {
  const st = await c.status('INBOX', { messages: true, unseen: true });
  return { messages: (st && st.messages) || 0, unseen: (st && st.unseen) || 0 };
});

/** New important mail since the last check (unread + flagged / Gmail-important), for proactive JARVIS. */
let lastSeenUid = 0;
export async function importantSince(): Promise<{ from: string; subject: string }[]> {
  if (!emailAccount().configured) return [];
  return withImap(async (c) => {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const uids = ((await c.search({ seen: false }, { uid: true })) || []) as number[];
      const fresh = uids.filter((u) => u > lastSeenUid);
      const first = lastSeenUid === 0;
      if (uids.length) lastSeenUid = Math.max(lastSeenUid, ...uids);
      if (first || !fresh.length) return []; // the first check only sets the baseline
      const out: { from: string; subject: string }[] = [];
      for await (const m of c.fetch(fresh.slice(-20), { envelope: true, flags: true, uid: true, labels: true } as any, { uid: true })) {
        const labels: Set<string> | undefined = (m as any).labels;
        if (m.flags?.has('\\Flagged') || labels?.has('\\Important')) out.push({ from: addr(m.envelope?.from), subject: m.envelope?.subject ?? '' });
      }
      return out;
    } finally { lock.release(); }
  });
}

const str = (description: string) => ({ type: Type.STRING, description });
registerSkill({
  id: 'email',
  name: 'EMAIL',
  description: 'Checks, searches, reads and summarises email, drafts replies and forwards, handles attachments, archives and deletes; sends only with your yes.',
  guide: "email check / search (from, subject, query) / read (uid, or from) / summarize; draft, reply and forward only make drafts. To send, read the draft back (recipient, subject, message) then call email send with its draftId: it needs the user's confirmation. If email isn't set up, say how to add it in Settings.",
  tools: [{
    name: 'email',
    description: "The user's email. Actions: check (unread; unread=false for all latest), search (from, subject, query, since), read (uid, or newest from 'from'), summarize (several unread, short), download_attachment (uid, name), draft (to, cc, subject, body, attachments paths), reply (uid, body, all), forward (uid, to, body), send (draftId), archive (uid), delete (uid).",
    parameters: { type: Type.OBJECT, properties: {
      action: str('One of the actions above'), uid: { type: Type.NUMBER, description: 'Email id from check/search' }, from: str('Sender name or address'), subject: str('Subject (search or draft)'),
      query: str('Text to search for'), since: str('Date, e.g. 2026-09-01'), limit: { type: Type.NUMBER, description: 'How many (default 10)' }, unread: { type: Type.BOOLEAN, description: 'check: only unread (default true)' },
      to: str('Recipient address(es)'), cc: str('CC'), body: str('Message text'), attachments: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'File paths to attach' },
      draftId: str('Draft to send'), name: str('Attachment name'), all: { type: Type.BOOLEAN, description: 'reply: reply all' },
    }, required: ['action'] },
  }],
  permission: (_t, a) => {
    const act = String(a.action ?? 'check');
    if (act === 'send') return ['EMAIL_SEND'];
    if (act === 'delete') return ['EMAIL_DELETE'];
    return act === 'download_attachment' ? ['EMAIL_READ', 'FILE_ACCESS'] : ['EMAIL_READ'];
  },
  summary: (_t, a) => {
    if (String(a.action) === 'send') {
      const d = drafts.get(String(a.draftId ?? '')) ?? [...drafts.values()].reverse().find((x) => !x.sent);
      return d ? `Send email TO: ${d.to}${d.cc ? `, CC: ${d.cc}` : ''} | SUBJECT: ${d.subject} | MESSAGE: ${d.body.split('\n---- On')[0].slice(0, 400)}${d.attachments.length + (d.forwarded?.length ?? 0) ? ` | ${d.attachments.length + (d.forwarded?.length ?? 0)} attachment(s)` : ''}` : 'Send the latest draft (none exists yet)';
    }
    return `Email ${a.action} ${a.uid ?? a.from ?? a.to ?? ''}`.trim();
  },
  execute: (_t, a) => emailAction(a),
});
