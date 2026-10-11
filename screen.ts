// SCREEN VISION skill: JARVIS looks at the user's real screen.
//   look      screenshot -> Gemini vision answers a question about it (and, in a voice session,
//             the frame is also shown straight to the Live model, which needs no extra quota)
//   read      the text / controls Windows UI Automation exposes for the window in front
//   elements  the clickable controls of that window, with their screen positions
//   find      where something is (UI Automation by name first, then vision)
//   click     find + click it (UI Automation Invoke when possible, else a real mouse click)
//   screenshot  save one to Pictures\JARVIS
// Gated by the SCREEN permission (Permission Center, and the SCREEN chip in the header). Every
// capture is announced to the dashboard so the user can see when JARVIS is looking.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type } from '@google/genai';
import { native } from './pcControl';
import { gemini } from './files';
import { registerSkill, type ToolResult, type ToolContext } from './skillRegistry';

const listeners = new Set<(e: { at: string; action: string }) => void>();
export const onScreenUse = (cb: (e: { at: string; action: string }) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const announce = (action: string) => listeners.forEach((cb) => { try { cb({ at: new Date().toISOString(), action }); } catch {} });

export interface Shot { file: string; base64: string; x: number; y: number; w: number; h: number; outW: number; outH: number }

/** Captures the whole screen (scaled to maxW wide) as JPEG. */
export async function captureScreen(file = path.join(os.tmpdir(), `jarvis-screen-${process.pid}.jpg`), maxW = 1600): Promise<Shot> {
  const out = await native('[JarvisNative]::Capture($env:P, 72, 0, 0, 0, 0, [int]$env:W)', { P: file, W: String(maxW) });
  const [x, y, w, h, outW, outH] = out.trim().split(',').map(Number);
  announce('capture');
  return { file, base64: fs.readFileSync(file).toString('base64'), x, y, w, h, outW, outH };
}

// ---------------------------------------------------------------------------------------------
// UI Automation (no vision quota needed)

const UIA_LIST = `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$h = [IntPtr][long]([JarvisNative]::Foreground())
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$title = $root.Current.Name
"WINDOW\`t$title"
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$n = 0
foreach ($e in $all) {
  if ($n -ge [int]$env:MAX) { break }
  try { $c = $e.Current } catch { continue }
  if ($c.IsOffscreen) { continue }
  $name = $c.Name
  if (-not $name) { try { $name = [string]$e.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty) } catch {} }
  if (-not $name) { continue }
  $r = $c.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0) { continue }
  $t = $c.ControlType.ProgrammaticName -replace '^ControlType\\.',''
  "{0}\`t{1}\`t{2}\`t{3}\`t{4}\`t{5}" -f $t, (($name -replace '\\s+',' ').Trim()), [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height
  $n++
}`;

export interface UiElement { type: string; name: string; x: number; y: number; w: number; h: number }
async function uiElements(max = 400): Promise<{ window: string; elements: UiElement[] }> {
  const out = await native(UIA_LIST, { MAX: String(max) }, 30000);
  let window = '';
  const elements: UiElement[] = [];
  for (const line of out.split('\n')) {
    const p = line.replace(/\r$/, '').split('\t');
    if (p[0] === 'WINDOW') { window = p.slice(1).join(' '); continue; }
    if (p.length < 6) continue;
    elements.push({ type: p[0], name: p[1].slice(0, 160), x: +p[2], y: +p[3], w: +p[4], h: +p[5] });
  }
  return { window, elements };
}

const CLICKABLE = /^(Button|MenuItem|Hyperlink|ListItem|TabItem|CheckBox|RadioButton|SplitButton|TreeItem|ComboBox|Edit|DataItem)$/;
function bestMatch(els: UiElement[], target: string): UiElement | null {
  const t = target.toLowerCase().trim().replace(/^(the|a)\s+/, '').replace(/\s+(button|link|tab|menu|icon)$/, '');
  if (!t) return null;
  const score = (e: UiElement) => {
    const n = e.name.toLowerCase();
    const base = n === t ? 3 : n.startsWith(t) ? 2 : n.includes(t) ? 1 : 0;
    return base ? base + (CLICKABLE.test(e.type) ? 0.5 : 0) : 0;
  };
  return els.map((e) => [e, score(e)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const INVOKE = `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]([JarvisNative]::Foreground()))
$pt = New-Object System.Windows.Point ([double]$env:CX), ([double]$env:CY)
$e = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
if ($e -and $e.Current.Name -eq $env:NAME) {
  try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); "INVOKED" } catch { "NOINVOKE" }
} else { "NOINVOKE" }`;

// ---------------------------------------------------------------------------------------------
// Vision

async function locate(shot: Shot, target: string): Promise<{ x: number; y: number; label: string } | null> {
  const reply = await gemini([
    { inlineData: { mimeType: 'image/jpeg', data: shot.base64 } },
    { text: `This is a screenshot of a Windows desktop. Find: "${target}". Reply with JSON only: {"found": true|false, "label": "what it is", "box_2d": [ymin, xmin, ymax, xmax]} with box_2d normalised to 0-1000.` },
  ], { responseMimeType: 'application/json' });
  let j: any;
  try { j = JSON.parse(reply.replace(/```json|```/g, '').trim()); } catch { return null; }
  if (Array.isArray(j)) j = j[0];
  const b = j?.box_2d;
  if (!j?.found || !Array.isArray(b) || b.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = b.map(Number);
  return { x: Math.round(shot.x + ((xmin + xmax) / 2 / 1000) * shot.w), y: Math.round(shot.y + ((ymin + ymax) / 2 / 1000) * shot.h), label: String(j.label ?? target) };
}

async function find(target: string): Promise<{ x: number; y: number; label: string; via: string; el?: UiElement } | null> {
  const ui = await uiElements().catch(() => null);
  const el = ui ? bestMatch(ui.elements, target) : null;
  if (el) return { x: Math.round(el.x + el.w / 2), y: Math.round(el.y + el.h / 2), label: `${el.type} "${el.name}"`, via: 'UI Automation', el };
  const shot = await captureScreen();
  const v = await locate(shot, target);
  return v ? { ...v, via: 'vision' } : null;
}

async function screenAction(a: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  const action = String(a.action || 'look').toLowerCase();
  switch (action) {
    case 'look': {
      const shot = await captureScreen();
      ctx.showImage?.(shot.base64);
      const question = String(a.question || 'Describe what is on the screen: the app and window in front, what it shows, any visible text, errors or dialogs.');
      try {
        const answer = await gemini([{ inlineData: { mimeType: 'image/jpeg', data: shot.base64 } }, { text: `${question}\nBe specific and quote any error text exactly.` }]);
        return { status: 'SUCCESS', message: 'Looked at the screen', answer, screen: `${shot.w}x${shot.h}` };
      } catch (e: any) {
        if (ctx.showImage) return { status: 'SUCCESS', message: `Vision analysis is unavailable (${e.message}), but the screenshot was just sent to you as an image: answer from what you see in it.` };
        throw new Error(`Couldn't analyse the screen: ${e.message}`);
      }
    }
    case 'read': case 'elements': {
      const ui = await uiElements(action === 'read' ? 400 : 200);
      announce(action);
      const els = action === 'elements' ? ui.elements.filter((e) => CLICKABLE.test(e.type)) : ui.elements;
      return {
        status: 'SUCCESS', message: `${els.length} ${action === 'elements' ? 'controls' : 'items'} in "${ui.window}"`, window: ui.window,
        items: els.slice(0, 150).map((e) => (action === 'elements' ? `${e.type} "${e.name}" at ${Math.round(e.x + e.w / 2)},${Math.round(e.y + e.h / 2)}` : `${e.type}: ${e.name}`)),
      };
    }
    case 'find': {
      if (!a.target) throw new Error('find needs a target, e.g. "the Save button".');
      const f = await find(String(a.target));
      return f ? { status: 'SUCCESS', message: `Found ${f.label} at ${f.x},${f.y} (${f.via})`, x: f.x, y: f.y } : { status: 'FAILED', error: `Couldn't find "${a.target}" on the screen.` };
    }
    case 'click': {
      if (!a.target) throw new Error('click needs a target, e.g. "the Submit button".');
      const f = await find(String(a.target));
      if (!f) return { status: 'FAILED', error: `Couldn't find "${a.target}" on the screen, so nothing was clicked.` };
      if (f.el && !a.double && !a.right) {
        const inv = (await native(INVOKE, { CX: String(f.x), CY: String(f.y), NAME: f.el.name }).catch(() => '')).trim();
        if (inv === 'INVOKED') return { status: 'SUCCESS', message: `Clicked ${f.label} (UI Automation)` };
      }
      await native(`[JarvisNative]::Move([int]$env:X, [int]$env:Y); Start-Sleep -Milliseconds 80; [JarvisNative]::Click($env:B, [int]$env:N)`,
        { X: String(f.x), Y: String(f.y), B: a.right ? 'right' : 'left', N: a.double ? '2' : '1' });
      return { status: 'SUCCESS', message: `Clicked ${f.label} at ${f.x},${f.y} (${f.via})` };
    }
    case 'screenshot': {
      const dir = path.join(os.homedir(), 'Pictures', 'JARVIS');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `screen-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
      const shot = await captureScreen(file, 4000);
      ctx.showImage?.(shot.base64);
      return { status: 'SUCCESS', message: `Saved a screenshot to ${file}`, path: file };
    }
  }
  return { status: 'FAILED', error: `Unknown screen action "${action}".` };
}

const str = (description: string) => ({ type: Type.STRING, description });
registerSkill({
  id: 'screen',
  name: 'SCREEN VISION',
  description: "See the user's screen: describe it, read errors, list and find controls, and click them.",
  guide: "screen look (with a question) for 'what's on my screen / what does this error say / what's wrong'; screen read for the text of the window in front; screen click with a target like 'the Save button' to press it; screen find for coordinates before using mouse. Never guess what is on screen: look first.",
  tools: [{
    name: 'screen',
    description: "Look at the user's real screen. 'look' (question) answers about a fresh screenshot; 'read' lists the text/controls of the window in front; 'elements' lists its clickable controls with positions; 'find' locates a target; 'click' finds and clicks a target (double/right optional); 'screenshot' saves one to Pictures\\JARVIS.",
    parameters: { type: Type.OBJECT, properties: {
      action: str("'look' | 'read' | 'elements' | 'find' | 'click' | 'screenshot'"),
      question: str('For look: what to find out'),
      target: str("For find/click: e.g. 'the Save button', 'the blue Submit button on the right'"),
      double: { type: Type.BOOLEAN, description: 'Double-click' }, right: { type: Type.BOOLEAN, description: 'Right-click' },
    }, required: ['action'] },
  }],
  permission: (_t, a) => (String(a.action) === 'click' ? ['SCREEN', 'PC_CONTROL'] : ['SCREEN']),
  risk: (_t, a) => (String(a.action) === 'click' && /\b(buy|purchase|checkout|place order|pay( now)?|subscribe|donate|transfer)\b/i.test(String(a.target ?? '')) ? { reason: 'it looks like a purchase or payment', perm: 'PURCHASES' } : null),
  execute: (_t, a, ctx) => screenAction(a, ctx),
});
