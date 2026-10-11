// Permission gate for browser / web actions.
// J.A.R.V.I.S. must ask before opening a browser or running a web search. The first call of a
// gated tool is held and the model is told to ask; the action only runs after the USER says or
// types an approval (the model cannot approve on its own), and it runs exactly what was asked.

const WEB_TOOLS = new Set(['open_url', 'play_youtube', 'search_web']);
const BROWSER_APP = /\b(chrome|msedge|edge|firefox|brave|opera|vivaldi|iexplore|browser)\b|https?:|www\./i;
export const YES = /\b(yes|yeah|yep|yup|sure|ok(ay)?|go ahead|do it|approved?|allow(ed)?|proceed|confirm(ed)?|please do)\b/i;
export const NO = /\b(no|nope|don'?t|do not|cancel|stop|deny|never ?mind|not now)\b/i;
const WINDOW_MS = 2 * 60 * 1000; // an unanswered request expires after 2 minutes

/** Text chat: web search is allowed only when J.A.R.V.I.S. just asked about searching and the user said yes. */
export const approvesWebSearch = (userMessage: string, lastAssistant = '') =>
  /\b(search|web|online|internet|look (it )?up|browse)\b/i.test(lastAssistant) && YES.test(userMessage) && !NO.test(userMessage);

export const isWebAction = (name: string, args: Record<string, any> = {}) =>
  WEB_TOOLS.has(name) || (name === 'open_app' && BROWSER_APP.test(String(args.name ?? '')));

interface Pending {
  name: string;
  args: Record<string, any>;
  at: number;
  heard: string; // what the user said/typed since the request
  approved: boolean;
}

export class WebGate {
  private pending: Pending | null = null;

  /** Feed the user's words (speech transcript chunks or typed text). */
  hear(text: string, now = Date.now()) {
    const p = this.pending;
    if (!p || now - p.at > WINDOW_MS || p.approved) return;
    p.heard += ' ' + text;
    if (NO.test(p.heard)) this.pending = null;
    else if (YES.test(p.heard)) p.approved = true;
  }

  /**
   * Called for every gated tool call. Returns the args to run once the user has approved,
   * or null while waiting (a new request replaces an older unanswered one).
   */
  check(name: string, args: Record<string, any>, now = Date.now()): Record<string, any> | null {
    const p = this.pending;
    if (p && p.name === name && p.approved && now - p.at <= WINDOW_MS) {
      this.pending = null;
      return p.args; // run what the user approved, not a re-worded call
    }
    if (!p || p.name !== name || now - p.at > WINDOW_MS) {
      this.pending = { name, args, at: now, heard: '', approved: false };
    }
    return null;
  }

  /** What the model is told when an action is held for permission. */
  static askMessage(name: string, args: Record<string, any>) {
    const what = args.url ?? args.query ?? args.name ?? '';
    return {
      status: 'NEEDS_PERMISSION',
      message:
        `Browser/web actions need the user's explicit permission. Ask the user now, in one short line, ` +
        `whether you may ${name.replace(/_/g, ' ')}${what ? ` "${what}"` : ''}. Do not claim it happened. ` +
        `If they say yes, call ${name} again; if they decline, drop it.`,
    };
  }
}
