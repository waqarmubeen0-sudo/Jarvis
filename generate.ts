// One text-generation call for every AI provider JARVIS supports. Callers pass a prompt (or turns)
// and get plain text back, whichever provider is selected in API Settings:
//   Gemini    -> generateContent (@google/genai)
//   Anthropic -> POST https://api.anthropic.com/v1/messages
//   OpenAI    -> POST https://api.openai.com/v1/chat/completions
// Runs on the backend only: keys come from credentials.ts and never reach the page.
import { GoogleGenAI } from '@google/genai';
import { credential, redact, type CredentialName } from './credentials';
import { PROVIDERS, activeProvider, providerModel, temperatureConfig, tracked, type ProviderId } from './apiSettings';

export interface Turn { role: 'user' | 'model'; text: string }
export interface GenerateOptions {
  system?: string;
  json?: boolean; // the reply must be raw JSON (code fences are stripped)
  temperature?: number; // Gemini only; default: Settings → Thinking
  provider?: ProviderId; // default: the selected provider
  model?: string; // default: that provider's model in API Settings
  apiKey?: string; // default: the stored key (Test Connection passes a new one)
  geminiTools?: any[]; // e.g. code execution; Gemini only, other providers answer without tools
}
interface Reply { text: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }

const usage = (input = 0, output = 0) => ({ promptTokenCount: input, candidatesTokenCount: output, totalTokenCount: input + output });
const TIMEOUT_MS = 180_000;

/** Calls a provider's HTTP API and turns failures into one clear sentence (status code kept for rate-limit handling). */
async function post(label: string, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e: any) {
    throw new Error(`Couldn't reach ${label}: ${e?.name === 'TimeoutError' ? 'no answer in 3 minutes' : e?.message ?? e}`);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(redact(`${label} error ${res.status}: ${data?.error?.message ?? res.statusText}`)), { status: res.status });
  return data;
}

/** Providers want strictly alternating user/assistant turns that start with the user. */
function alternate(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    if (!t.text.trim()) continue;
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1] = { role: t.role, text: `${out[out.length - 1].text}\n\n${t.text}` };
    else out.push({ ...t });
  }
  if (out[0]?.role === 'model') out.unshift({ role: 'user', text: '(conversation so far)' });
  return out;
}

const CALL: Record<ProviderId, (key: string, model: string, turns: Turn[], o: GenerateOptions) => Promise<Reply>> = {
  gemini: async (key, model, turns, o) => {
    const ai = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const temperature = o.temperature ?? (o.json ? 0 : temperatureConfig().temperature);
    const r = await ai.models.generateContent({
      model,
      contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      config: {
        ...(o.system ? { systemInstruction: o.system } : {}),
        ...(o.json ? { responseMimeType: 'application/json' } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(o.geminiTools?.length ? { tools: o.geminiTools } : {}),
      },
    });
    return { text: r.text ?? '', usageMetadata: r.usageMetadata };
  },
  // ponytail: temperature isn't sent to Claude/OpenAI (some of their models reject it); add per-model support if needed.
  anthropic: async (key, model, turns, o) => {
    const d = await post('Anthropic', 'https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
      model,
      max_tokens: 16000,
      ...(o.system || o.json ? { system: `${o.system ?? ''}${o.json ? '\n\nReply with raw JSON only: no code fences, no other text.' : ''}`.trim() } : {}),
      messages: alternate(turns).map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
    });
    const text = (d.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return { text, usageMetadata: usage(d.usage?.input_tokens, d.usage?.output_tokens) };
  },
  openai: async (key, model, turns, o) => {
    const system = `${o.system ?? ''}${o.json ? '\n\nReply with raw JSON only: no code fences, no other text.' : ''}`.trim();
    const d = await post('OpenAI', 'https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${key}` }, {
      model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...alternate(turns).map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text }))],
    });
    return { text: d.choices?.[0]?.message?.content ?? '', usageMetadata: usage(d.usage?.prompt_tokens, d.usage?.completion_tokens) };
  },
};

/** Generates text with the selected provider (or `o.provider`). Throws a clear Error if the key is missing or the call fails. */
export async function generate(input: string | Turn[], o: GenerateOptions = {}): Promise<string> {
  const provider = o.provider ?? activeProvider();
  const meta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const key = (o.apiKey ?? credential(meta.keyName as CredentialName)).trim();
  if (!key) throw new Error(`No ${meta.label} API key is set. Add it in API Settings.`);
  const model = o.model ?? providerModel(meta.id);
  const turns = typeof input === 'string' ? [{ role: 'user' as const, text: input }] : input;
  const r = await tracked(model, () => CALL[meta.id](key, model, turns, o));
  const text = r.text.trim();
  return o.json ? text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : text;
}

/** Test Connection: one tiny call. A rate limit still means the key is valid. */
export async function testProvider(provider: ProviderId, apiKey: string, model: string): Promise<{ ok: boolean; message?: string }> {
  const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
  try {
    await generate('Reply with OK.', { provider, apiKey, model });
    return { ok: true };
  } catch (err: any) {
    const text = String(err?.message ?? err);
    if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(text)) return { ok: true, message: `Accepted, but ${label} says this key is currently rate-limited.` };
    if (/API.?key|\b40[13]\b|PERMISSION_DENIED|UNAUTHENTICATED|authentication|invalid x-api-key|Incorrect API key/i.test(text)) return { ok: false, message: `${label} rejected this API key.` };
    if (/\b404\b|NOT_FOUND|not found|not supported|does not exist|model_not_found/i.test(text)) return { ok: false, message: `${label} has no model called "${model}" for this key.` };
    return { ok: false, message: `Test call failed: ${redact(text).slice(0, 200)}` };
  }
}
