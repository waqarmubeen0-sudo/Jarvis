// PC CONTROL skill: real mouse, keyboard, windows, clipboard, processes and media keys on
// The user's Windows PC. Win32 calls live in a tiny C# helper compiled ONCE into a cached DLL
// (~/.jarvis/native), so each action is a quick PowerShell call instead of a fresh compile.
// Arguments reach PowerShell only through environment variables (never spliced into script).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Type } from '@google/genai';
import { ps } from './osTools';
import { registerSkill, type ToolResult } from './skillRegistry';

const SRC = String.raw`
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class JarvisNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint map);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);

  public static void Dpi() { try { SetProcessDPIAware(); } catch {} }
  public static string Cursor() { POINT p; GetCursorPos(out p); return p.X + "," + p.Y; }
  public static string Screen() { return GetSystemMetrics(76) + "," + GetSystemMetrics(77) + "," + GetSystemMetrics(78) + "," + GetSystemMetrics(79); }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static void Click(string button, int count) {
    uint down = 0x0002, up = 0x0004;
    if (button == "right") { down = 0x0008; up = 0x0010; } else if (button == "middle") { down = 0x0020; up = 0x0040; }
    for (int i = 0; i < count; i++) { mouse_event(down, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(30); mouse_event(up, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(70); }
  }
  public static void Scroll(int notches, bool horizontal) { mouse_event(horizontal ? 0x01000u : 0x0800u, 0, 0, notches * 120, UIntPtr.Zero); }
  public static void Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1); Thread.Sleep(80);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(150);
    for (int i = 1; i <= 25; i++) { SetCursorPos(x1 + (x2 - x1) * i / 25, y1 + (y2 - y1) * i / 25); Thread.Sleep(15); }
    Thread.Sleep(150); mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) { INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
  public static void TypeText(string s, int delayMs) {
    int size = Marshal.SizeOf(typeof(INPUT));
    foreach (char c in s) {
      if (c == '\r') continue;
      INPUT[] pair = c == '\n' ? new INPUT[] { Key(0x0D, 0, 0), Key(0x0D, 0, 2) }
        : c == '\t' ? new INPUT[] { Key(0x09, 0, 0), Key(0x09, 0, 2) }
        : new INPUT[] { Key(0, c, 4), Key(0, c, 6) };
      SendInput((uint)pair.Length, pair, size);
      if (delayMs > 0) Thread.Sleep(delayMs);
    }
  }
  static bool Ext(int vk) { return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0x5D || vk == 0x6F || vk == 0x90; }
  static void KeyEvent(int vk, bool up) { keybd_event((byte)vk, (byte)MapVirtualKey((uint)vk, 0), (Ext(vk) ? 1u : 0u) | (up ? 2u : 0u), UIntPtr.Zero); }
  public static void Keys(int[] vks) {
    foreach (int vk in vks) { KeyEvent(vk, false); Thread.Sleep(30); }
    for (int i = vks.Length - 1; i >= 0; i--) { KeyEvent(vks[i], true); Thread.Sleep(30); }
  }
  public static string Windows() {
    StringBuilder sb = new StringBuilder();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      StringBuilder t = new StringBuilder(512); GetWindowText(h, t, 512);
      if (t.Length == 0 || t.ToString() == "Program Manager") return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string name = ""; try { name = Process.GetProcessById((int)pid).ProcessName; } catch {}
      string st = IsIconic(h) ? "minimized" : IsZoomed(h) ? "maximized" : "normal";
      sb.Append(h.ToInt64()).Append('\t').Append(pid).Append('\t').Append(name).Append('\t').Append(st).Append('\t').Append(t.ToString().Replace('\t', ' ')).Append('\n');
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  public static long Foreground() { return GetForegroundWindow().ToInt64(); }
  public static bool Focus(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    if (IsIconic(h)) { ShowWindow(h, 9); Thread.Sleep(150); }
    mouse_event(0x0001, 0, 0, 0, UIntPtr.Zero); // an input event of our own lets us take the foreground
    BringWindowToTop(h); SetForegroundWindow(h); Thread.Sleep(200);
    if (GetForegroundWindow() == h) return true;
    ShowWindow(h, 6); Thread.Sleep(150); ShowWindow(h, 9); Thread.Sleep(250); // minimise + restore brings it to the front
    return GetForegroundWindow() == h;
  }
  public static void Show(long hwnd, int cmd) { ShowWindow(new IntPtr(hwnd), cmd); }
  public static void Close(long hwnd) { PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }
  public static string Rect(long hwnd) { RECT r; GetWindowRect(new IntPtr(hwnd), out r); return r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top); }
  /** Screenshot of a region (w=0: the whole virtual screen), scaled to at most maxW wide. Returns "x,y,w,h,outW,outH". */
  public static string Capture(string path, long quality, int x, int y, int w, int h, int maxW) {
    if (w <= 0 || h <= 0) { x = GetSystemMetrics(76); y = GetSystemMetrics(77); w = GetSystemMetrics(78); h = GetSystemMetrics(79); }
    int ow = w, oh = h;
    if (maxW > 0 && w > maxW) { ow = maxW; oh = (int)Math.Round((double)h * maxW / w); }
    using (Bitmap full = new Bitmap(w, h)) {
      using (Graphics g = Graphics.FromImage(full)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
      using (Bitmap outBmp = new Bitmap(ow, oh)) {
        using (Graphics g2 = Graphics.FromImage(outBmp)) { g2.InterpolationMode = InterpolationMode.HighQualityBicubic; g2.DrawImage(full, 0, 0, ow, oh); }
        ImageCodecInfo jpg = null; foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpg = c;
        EncoderParameters ep = new EncoderParameters(1); ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        outBmp.Save(path, jpg, ep);
      }
    }
    return x + "," + y + "," + w + "," + h + "," + ow + "," + oh;
  }
}`;

const NATIVE_DIR = path.join(os.homedir(), '.jarvis', 'native');
const DLL = path.join(NATIVE_DIR, `JarvisNative-${crypto.createHash('sha1').update(SRC).digest('hex').slice(0, 10)}.dll`);
let building: Promise<void> | null = null;

function ensureNative(): Promise<void> {
  if (fs.existsSync(DLL)) return Promise.resolve();
  building ??= (async () => {
    fs.mkdirSync(NATIVE_DIR, { recursive: true });
    await ps('Add-Type -TypeDefinition $env:SRC -ReferencedAssemblies System.Drawing -OutputAssembly $env:DLL -OutputType Library', { SRC, DLL }, 60000);
    if (!fs.existsSync(DLL)) throw new Error('Could not build the native PC-control helper.');
  })().finally(() => { building = null; });
  return building;
}

/** Runs PowerShell with the native helper loaded and DPI awareness on (physical pixels everywhere). */
export async function native(script: string, env: Record<string, string> = {}, timeout = 20000) {
  await ensureNative();
  return ps(`Add-Type -Path $env:JN_DLL; [JarvisNative]::Dpi(); ${script}`, { JN_DLL: DLL, ...env }, timeout);
}

// ---------------------------------------------------------------------------------------------
// Keys

const VK: Record<string, number> = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, windows: 0x5b, cmd: 0x5b, enter: 0x0d, return: 0x0d, tab: 0x09,
  esc: 0x1b, escape: 0x1b, space: 0x20, backspace: 0x08, delete: 0x2e, del: 0x2e, insert: 0x2d, home: 0x24, end: 0x23,
  pageup: 0x21, pgup: 0x21, pagedown: 0x22, pgdn: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28, printscreen: 0x2c,
  capslock: 0x14, menu: 0x5d, volume_mute: 0xad, volume_down: 0xae, volume_up: 0xaf, media_next: 0xb0, media_previous: 0xb1,
  media_stop: 0xb2, media_play_pause: 0xb3, ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0,
  '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde, plus: 0xbb, minus: 0xbd,
};
for (let i = 1; i <= 12; i++) VK[`f${i}`] = 0x6f + i;

/** "ctrl+shift+t" -> virtual-key codes (throws on an unknown key). */
export function parseKeys(combo: string): number[] {
  const parts = String(combo).toLowerCase().replace(/\s+/g, '').split(/\+(?!$)/).filter(Boolean);
  if (!parts.length) throw new Error('No keys given.');
  return parts.map((k) => {
    if (VK[k] !== undefined) return VK[k];
    if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
    throw new Error(`Unknown key "${k}".`);
  });
}

// ---------------------------------------------------------------------------------------------
// Windows

export interface WindowInfo { hwnd: number; pid: number; process: string; state: string; title: string }
export async function listWindows(): Promise<WindowInfo[]> {
  const out = await native('[JarvisNative]::Windows()');
  return out.split('\n').filter(Boolean).map((l) => {
    const [hwnd, pid, process, state, ...t] = l.split('\t');
    return { hwnd: Number(hwnd), pid: Number(pid), process, state, title: t.join(' ').trim() };
  });
}
/** Best window for "chrome", "VS Code", "Photoshop", a title fragment, or "this"/"active". */
export async function findWindow(target?: string): Promise<WindowInfo | null> {
  const wins = await listWindows();
  const t = String(target ?? '').toLowerCase().trim().replace(/\.exe$/, '');
  if (!t || /^(this|current|active|foreground)( window)?$/.test(t)) {
    const fg = Number(await native('[JarvisNative]::Foreground()'));
    return wins.find((w) => w.hwnd === fg) ?? null;
  }
  const alias: Record<string, string> = { 'vs code': 'code', vscode: 'code', 'visual studio code': 'code', edge: 'msedge', photoshop: 'photoshop', word: 'winword', excel: 'excel', 'file explorer': 'explorer', explorer: 'explorer', terminal: 'windowsterminal' };
  const proc = alias[t] ?? t;
  return wins.find((w) => w.process.toLowerCase() === proc) ?? wins.find((w) => w.title.toLowerCase().includes(t)) ?? wins.find((w) => w.process.toLowerCase().includes(proc)) ?? null;
}

const SHOW = { minimize: 6, maximize: 3, restore: 9 } as const;

async function windowAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'list').toLowerCase();
  if (action === 'list') {
    const wins = await listWindows();
    return { status: 'SUCCESS', message: `${wins.length} open windows`, windows: wins.slice(0, 40).map((w) => `${w.title} [${w.process}${w.state !== 'normal' ? `, ${w.state}` : ''}]`) };
  }
  const w = await findWindow(a.target);
  if (!w) return { status: 'FAILED', error: `No open window matches "${a.target ?? 'the active window'}".` };
  const name = `${w.title} [${w.process}]`;
  if (action === 'focus' || action === 'switch') {
    const ok = (await native('[JarvisNative]::Focus([long]$env:H)', { H: String(w.hwnd) })).trim() === 'True';
    return ok ? { status: 'SUCCESS', message: `Switched to ${name}` } : { status: 'FAILED', error: `Windows refused to bring ${name} to the front.` };
  }
  if (action in SHOW) {
    await native('[JarvisNative]::Show([long]$env:H, [int]$env:C)', { H: String(w.hwnd), C: String(SHOW[action as keyof typeof SHOW]) });
    return { status: 'SUCCESS', message: `${action[0].toUpperCase()}${action.slice(1)}d ${name}` };
  }
  if (action === 'close') {
    await native('[JarvisNative]::Close([long]$env:H)', { H: String(w.hwnd) });
    await new Promise((r) => setTimeout(r, 800));
    const still = (await listWindows()).some((x) => x.hwnd === w.hwnd);
    return still ? { status: 'SUCCESS', message: `Asked ${name} to close; it is still open (it may be asking to save).` } : { status: 'SUCCESS', message: `Closed ${name}` };
  }
  if (action === 'active') return { status: 'SUCCESS', message: `Active window: ${name}`, window: w };
  return { status: 'FAILED', error: `Unknown window action "${action}".` };
}

// ---------------------------------------------------------------------------------------------
// Mouse / keyboard / clipboard / processes / media

const int = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (screen pixels).`);
  return String(Math.round(n));
};

async function mouseAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'click').toLowerCase();
  const at = a.x !== undefined && a.y !== undefined ? `[JarvisNative]::Move([int]$env:X, [int]$env:Y); Start-Sleep -Milliseconds 60; ` : '';
  const env: Record<string, string> = at ? { X: int(a.x, 'x'), Y: int(a.y, 'y') } : {};
  const where = at ? ` at ${env.X},${env.Y}` : '';
  switch (action) {
    case 'position': return { status: 'SUCCESS', message: `Mouse is at ${await native('[JarvisNative]::Cursor()')}` };
    case 'move': if (!at) throw new Error('move needs x and y.'); await native(at); return { status: 'SUCCESS', message: `Moved the mouse${where}` };
    case 'click': case 'double_click': case 'right_click': case 'middle_click': {
      const button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left';
      await native(`${at}[JarvisNative]::Click($env:B, [int]$env:N)`, { ...env, B: button, N: action === 'double_click' ? '2' : '1' });
      return { status: 'SUCCESS', message: `${action.replace('_', ' ')}${where}` };
    }
    case 'scroll': {
      const n = Math.max(-50, Math.min(50, Math.round(Number(a.amount ?? -5)))); // negative = down
      await native(`${at}[JarvisNative]::Scroll([int]$env:N, $${a.horizontal ? 'true' : 'false'})`, { ...env, N: String(n) });
      return { status: 'SUCCESS', message: `Scrolled ${n < 0 ? 'down' : 'up'} ${Math.abs(n)}${where}` };
    }
    case 'drag': {
      await native('[JarvisNative]::Drag([int]$env:X, [int]$env:Y, [int]$env:X2, [int]$env:Y2)', { X: int(a.x, 'x'), Y: int(a.y, 'y'), X2: int(a.toX, 'toX'), Y2: int(a.toY, 'toY') });
      return { status: 'SUCCESS', message: `Dragged from ${a.x},${a.y} to ${a.toX},${a.toY}` };
    }
  }
  return { status: 'FAILED', error: `Unknown mouse action "${action}".` };
}

async function keyboardAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'type').toLowerCase();
  if (action === 'type') {
    const text = String(a.text ?? '');
    if (!text) throw new Error('Nothing to type.');
    if (text.length > 5000) throw new Error('That is too much to type at once (5000 characters max).');
    await native('[JarvisNative]::TypeText($env:T, 4)', { T: text }, 20000 + text.length * 20);
    return { status: 'SUCCESS', message: `Typed ${text.length} characters` };
  }
  if (action === 'hotkey' || action === 'press') {
    const combo = String(a.keys ?? a.text ?? '');
    const codes = parseKeys(combo);
    const times = Math.max(1, Math.min(50, Math.round(Number(a.repeat ?? 1))));
    await native(`for ($i = 0; $i -lt ${times}; $i++) { [JarvisNative]::Keys([int[]]($env:K -split ',')); Start-Sleep -Milliseconds 40 }`, { K: codes.join(',') });
    return { status: 'SUCCESS', message: `Pressed ${combo}${times > 1 ? ` ×${times}` : ''}` };
  }
  return { status: 'FAILED', error: `Unknown keyboard action "${action}".` };
}

async function clipboardAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'read').toLowerCase();
  if (action === 'read') return { status: 'SUCCESS', message: 'Clipboard read', text: (await ps('Get-Clipboard -Raw')).slice(0, 10000) };
  if (action === 'write') { await ps('Set-Clipboard -Value $env:T', { T: String(a.text ?? '') }); return { status: 'SUCCESS', message: 'Copied the text to the clipboard' }; }
  if (action === 'copy') { await native('[JarvisNative]::Keys([int[]](0x11,0x43))'); await new Promise((r) => setTimeout(r, 200)); return { status: 'SUCCESS', message: 'Copied the selection', text: (await ps('Get-Clipboard -Raw')).slice(0, 4000) }; }
  if (action === 'paste') { if (a.text) await ps('Set-Clipboard -Value $env:T', { T: String(a.text) }); await native('[JarvisNative]::Keys([int[]](0x11,0x56))'); return { status: 'SUCCESS', message: 'Pasted' }; }
  return { status: 'FAILED', error: `Unknown clipboard action "${action}".` };
}

async function processAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'list').toLowerCase();
  if (action === 'list') {
    const out = await ps(`Get-Process | Where-Object { -not $env:N -or $_.ProcessName -like "*$env:N*" } | Sort-Object WorkingSet64 -Descending | Select-Object -First 30 |
      ForEach-Object { "{0}\t{1}\t{2:N0} MB\t{3}" -f $_.ProcessName, $_.Id, ($_.WorkingSet64/1MB), $_.MainWindowTitle }`, { N: String(a.name ?? '') });
    return { status: 'SUCCESS', message: 'Running processes (largest memory first)', processes: out.split('\n').filter(Boolean) };
  }
  if (action === 'kill') {
    if (!a.name && !a.pid) throw new Error('kill needs a process name or pid.');
    const out = await ps(`$p = if ($env:P) { Get-Process -Id ([int]$env:P) -ErrorAction Stop } else { Get-Process -Name ($env:N -replace '\\.exe$','') -ErrorAction Stop }
      $p | Stop-Process -Force; ($p | Select-Object -ExpandProperty ProcessName -Unique) -join ', '`, { P: a.pid ? String(Number(a.pid)) : '', N: String(a.name ?? '') });
    return { status: 'SUCCESS', message: `Ended ${out}` };
  }
  return { status: 'FAILED', error: `Unknown process action "${action}".` };
}

const MEDIA: Record<string, number> = { play_pause: 0xb3, play: 0xb3, pause: 0xb3, next: 0xb0, previous: 0xb1, stop: 0xb2 };
async function mediaAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'play_pause').toLowerCase();
  if (!(action in MEDIA)) return { status: 'FAILED', error: `Unknown media action "${action}".` };
  await native('[JarvisNative]::Keys([int[]]@([int]$env:K))', { K: String(MEDIA[action]) });
  return { status: 'SUCCESS', message: `Sent media ${action.replace('_', '/')}` };
}

// ---------------------------------------------------------------------------------------------
// Skill

const str = (description: string) => ({ type: Type.STRING, description });
const num = (description: string) => ({ type: Type.NUMBER, description });

registerSkill({
  id: 'pc',
  name: 'PC CONTROL',
  description: 'Apps, windows, mouse, keyboard, clipboard, processes, volume, media, lock and power on your Windows PC.',
  guide: 'open_app/close_app for apps (open_app takes args, e.g. name "code" args "C:\\path\\project" opens a folder in VS Code); window to list/switch/minimize/maximize/close windows ("close this window" = target "active"); mouse and keyboard for direct input (use the screen skill first to find coordinates); clipboard; process to list/end processes; media_control and set_volume for media.',
  builtin: ['open_app', 'close_app', 'set_volume', 'lock_pc', 'power'],
  tools: [
    { name: 'window', description: "Manage windows on the user's PC: list, focus (switch to), minimize, maximize, restore, close, or get the active window.",
      parameters: { type: Type.OBJECT, properties: { action: str("'list' | 'focus' | 'minimize' | 'maximize' | 'restore' | 'close' | 'active'"), target: str("App or window title, e.g. 'chrome', 'VS Code', 'Photoshop'; 'active' = the window in front") }, required: ['action'] } },
    { name: 'mouse', description: 'Real mouse input in screen pixels: move, click, double_click, right_click, middle_click, scroll (amount: negative = down), drag (x,y -> toX,toY), position.',
      parameters: { type: Type.OBJECT, properties: { action: str("'move' | 'click' | 'double_click' | 'right_click' | 'middle_click' | 'scroll' | 'drag' | 'position'"), x: num('Screen x (pixels)'), y: num('Screen y (pixels)'), toX: num('Drag end x'), toY: num('Drag end y'), amount: num('Scroll notches, negative = down (default -5)') }, required: ['action'] } },
    { name: 'keyboard', description: "Real keyboard input into the window in front: 'type' text, or 'hotkey' a shortcut like 'ctrl+s', 'alt+tab', 'ctrl+shift+t', 'enter', 'f5'.",
      parameters: { type: Type.OBJECT, properties: { action: str("'type' | 'hotkey'"), text: str('Text to type'), keys: str("Shortcut, e.g. 'ctrl+c'"), repeat: num('Press the shortcut N times') }, required: ['action'] } },
    { name: 'clipboard', description: "Clipboard: 'read' it, 'write' text to it, 'copy' the current selection (ctrl+c) or 'paste' (optionally text) into the window in front.",
      parameters: { type: Type.OBJECT, properties: { action: str("'read' | 'write' | 'copy' | 'paste'"), text: str('Text for write/paste') }, required: ['action'] } },
    { name: 'process', description: "Running processes: 'list' (optionally filtered by name) or 'kill' one by name or pid.",
      parameters: { type: Type.OBJECT, properties: { action: str("'list' | 'kill'"), name: str('Process name'), pid: num('Process id') }, required: ['action'] } },
    { name: 'media_control', description: 'Media keys for whatever is playing: play_pause, next, previous, stop.',
      parameters: { type: Type.OBJECT, properties: { action: str("'play_pause' | 'next' | 'previous' | 'stop'") }, required: ['action'] } },
  ],
  permission: () => ['PC_CONTROL'],
  risk: (tool, a) => (tool === 'power' && /shutdown|restart/i.test(String(a.action)) ? { reason: 'it shuts down or restarts the PC' } : null),
  execute: async (tool, a) => {
    switch (tool) {
      case 'window': return windowAction(a);
      case 'mouse': return mouseAction(a);
      case 'keyboard': return keyboardAction(a);
      case 'clipboard': return clipboardAction(a);
      case 'process': return processAction(a);
      case 'media_control': return mediaAction(a);
    }
    return { status: 'FAILED', error: `Unknown tool ${tool}` };
  },
});
