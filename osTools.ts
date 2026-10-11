// Real Windows PC-control tools for J.A.R.V.I.S.
import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Type, FunctionDeclaration } from '@google/genai';

// Args reach PowerShell only via env vars (never string-interpolated) so the model can't inject script.
export function ps(script: string, env: Record<string, string> = {}, timeout = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim()))
    );
  });
}

// Relative paths resolve from the user's home folder, so "Desktop/Project_X" just works.
export const resolvePath = (p: string) => path.resolve(os.homedir(), String(p || '').replace(/^~[\\/]?/, ''));

const str = (description: string) => ({ type: Type.STRING, description });

export const osToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'open_app',
    description:
      "Open any application on the user's Windows PC by name, e.g. 'notepad', 'chrome', 'calc', 'explorer', 'spotify', 'whatsapp', or 'ms-settings:' for System Settings.",
    parameters: { type: Type.OBJECT, properties: { name: str('App name or executable'), args: str("Optional: what to open with it, e.g. a folder for VS Code ('code' + 'C:\\Users\\you\\Projects\\app') or a file") }, required: ['name'] },
  },
  {
    name: 'close_app',
    description: "Close a running application by process name or window title, e.g. 'notepad', 'chrome'.",
    parameters: { type: Type.OBJECT, properties: { name: str('Process name or window title') }, required: ['name'] },
  },
  {
    name: 'open_url',
    description: 'Open a website in the default browser.',
    parameters: { type: Type.OBJECT, properties: { url: str("URL, e.g. 'youtube.com' or 'https://github.com'") }, required: ['url'] },
  },
  {
    name: 'play_youtube',
    description: 'Search YouTube and immediately play the top matching song or video in the browser.',
    parameters: { type: Type.OBJECT, properties: { query: str('Song or video to play, e.g. "Back in Black AC/DC"') }, required: ['query'] },
  },
  {
    name: 'search_web',
    description: 'Open a Google search for a query in the browser.',
    parameters: { type: Type.OBJECT, properties: { query: str('Search query') }, required: ['query'] },
  },
  {
    name: 'set_volume',
    description: 'Control system volume: set an exact level, step up/down, or toggle mute.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: str("'set', 'up', 'down', or 'mute'"),
        level: { type: Type.NUMBER, description: "0-100; target for 'set', or amount to change for 'up'/'down' (default 10)" },
      },
      required: ['action'],
    },
  },
  {
    name: 'lock_pc',
    description: 'Lock the Windows PC (shows the lock screen). Unlocking requires the user to sign in.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'power',
    description: "Power control: 'sleep', 'shutdown', 'restart', or 'cancel' a pending shutdown/restart. Shutdown/restart wait 30s so they can be cancelled.",
    parameters: { type: Type.OBJECT, properties: { action: str("'sleep', 'shutdown', 'restart', or 'cancel'") }, required: ['action'] },
  },
  {
    name: 'create_folder',
    description: "Create a folder. Relative paths start at the user's home folder, e.g. 'Desktop/Project_X' or 'Documents/Notes'.",
    parameters: { type: Type.OBJECT, properties: { path: str('Folder path') }, required: ['path'] },
  },
  {
    name: 'create_file',
    description: "Create or overwrite a text file with content. Relative paths start at the user's home folder, e.g. 'Desktop/todo.txt'.",
    parameters: {
      type: Type.OBJECT,
      properties: { path: str('File path'), content: str('Text content (optional)') },
      required: ['path'],
    },
  },
  {
    name: 'move_item',
    description: "Move or rename a file or folder. Relative paths start at the user's home folder.",
    parameters: {
      type: Type.OBJECT,
      properties: { from: str('Existing path'), to: str('New path') },
      required: ['from', 'to'],
    },
  },
  {
    name: 'delete_item',
    description: "Delete a file or folder by sending it to the Recycle Bin (recoverable). Relative paths start at the user's home folder.",
    parameters: { type: Type.OBJECT, properties: { path: str('Path to delete') }, required: ['path'] },
  },
  {
    name: 'list_folder',
    description: "List the contents of a folder, e.g. 'Desktop' or 'Downloads'.",
    parameters: { type: Type.OBJECT, properties: { path: str('Folder path') }, required: ['path'] },
  },
];

export const osToolNames = new Set(osToolDeclarations.map((t) => t.name!));

const openTarget = (target: string) => ps('Start-Process -FilePath $env:T', { T: target });

async function run(name: string, a: Record<string, any>): Promise<string> {
  switch (name) {
    case 'open_app':
      // Fall back to Start Menu apps (Store apps like Spotify/WhatsApp have no exe on PATH).
      if (a.args) {
        // With arguments: resolve through PATH (code.cmd, python.exe...) and pass the path/file along.
        // A relative path ("Desktop/jarvis") means one under their home folder, like every other path tool.
        const raw = String(a.args).trim().replace(/^["']|["']$/g, '');
        const fromHome = resolvePath(raw);
        const arg = /[\\/]/.test(raw) && !path.isAbsolute(raw) && fs.existsSync(fromHome) ? fromHome : raw.replace(/^~[\\/]?/, os.homedir() + path.sep);
        await ps(`$c = Get-Command $env:APP -ErrorAction SilentlyContinue | Select-Object -First 1
          $exe = if ($c) { $c.Source } else { $env:APP }
          Start-Process -FilePath $exe -ArgumentList ('"' + $env:ARG + '"') -ErrorAction Stop`, { APP: String(a.name), ARG: arg });
        return `Opened ${a.name} with ${arg}`;
      }
      await ps(
        `try { Start-Process -FilePath $env:APP -ErrorAction Stop }
         catch {
           $a = Get-StartApps | Where-Object { $_.Name -like "*$env:APP*" } | Select-Object -First 1
           if (-not $a) { throw "No app named '$env:APP' found" }
           Start-Process "shell:AppsFolder\\$($a.AppID)"
         }`,
        { APP: String(a.name) }
      );
      return `Opened ${a.name}`;

    case 'close_app': {
      const out = await ps(
        `$n = $env:APP -replace '\\.exe$',''
         $p = Get-Process -Name $n -ErrorAction SilentlyContinue
         if (-not $p) { $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$n*" } }
         if (-not $p) { throw "No running app matches '$n'" }
         $p | Stop-Process -Force
         ($p | Select-Object -ExpandProperty ProcessName -Unique) -join ', '`,
        { APP: String(a.name) }
      );
      return `Closed ${out}`;
    }

    case 'open_url': {
      let url = String(a.url).trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      new URL(url); // throws on garbage
      await openTarget(url);
      return `Opened ${url}`;
    }

    case 'play_youtube': {
      const q = encodeURIComponent(String(a.query));
      const html = await (await fetch(`https://www.youtube.com/results?search_query=${q}`, {
        headers: { 'Accept-Language': 'en-US' },
      })).text();
      const id = html.match(/"videoId":"([\w-]{11})"/)?.[1];
      const title = html.match(/"title":\{"runs":\[\{"text":"([^"]+)"/)?.[1];
      await openTarget(id ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/results?search_query=${q}`);
      return id ? `Playing "${title ?? a.query}" on YouTube` : `No direct match; opened YouTube search for "${a.query}"`;
    }

    case 'search_web':
      await openTarget(`https://www.google.com/search?q=${encodeURIComponent(String(a.query))}`);
      return `Searching Google for "${a.query}"`;

    case 'set_volume': {
      // ponytail: media-key presses (2% each) since Windows has no volume CLI; add a CoreAudio helper if exact levels matter.
      const action = String(a.action).toLowerCase();
      const level = Math.max(0, Math.min(100, Number(a.level ?? 10)));
      const key = (code: number, times: number) => `for ($i=0; $i -lt ${times}; $i++) { $w.SendKeys([char]${code}) }`;
      const body =
        action === 'mute' ? key(173, 1)
        : action === 'up' ? key(175, Math.round(level / 2))
        : action === 'down' ? key(174, Math.round(level / 2))
        : action === 'set' ? `${key(174, 50)}; ${key(175, Math.round(level / 2))}`
        : null;
      if (!body) throw new Error(`Unknown volume action '${action}'`);
      await ps(`$w = New-Object -ComObject WScript.Shell; ${body}`);
      return action === 'mute' ? 'Toggled mute' : action === 'set' ? `Volume set to ${level}%` : `Volume ${action} ${level}%`;
    }

    case 'lock_pc':
      await ps('rundll32.exe user32.dll,LockWorkStation');
      return 'PC locked';

    case 'power': {
      const action = String(a.action).toLowerCase();
      const cmd = {
        sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
        shutdown: 'shutdown.exe /s /t 30',
        restart: 'shutdown.exe /r /t 30',
        cancel: 'shutdown.exe /a',
      }[action];
      if (!cmd) throw new Error(`Unknown power action '${action}'`);
      await ps(cmd);
      return action === 'cancel' ? 'Pending shutdown cancelled' : action === 'sleep' ? 'Going to sleep' : `${action} in 30 seconds (say "cancel shutdown" to abort)`;
    }

    case 'create_folder': {
      const p = resolvePath(a.path);
      await ps('New-Item -ItemType Directory -Force -Path $env:P | Out-Null', { P: p });
      return `Folder created: ${p}`;
    }

    case 'create_file': {
      const p = resolvePath(a.path);
      await ps(
        'New-Item -ItemType Directory -Force -Path (Split-Path $env:P) | Out-Null; Set-Content -LiteralPath $env:P -Value $env:C -Encoding UTF8',
        { P: p, C: String(a.content ?? '') }
      );
      return `File created: ${p}`;
    }

    case 'move_item': {
      const from = resolvePath(a.from);
      const to = resolvePath(a.to);
      await ps('Move-Item -LiteralPath $env:F -Destination $env:D -ErrorAction Stop', { F: from, D: to });
      return `Moved ${from} -> ${to}`;
    }

    case 'delete_item': {
      const p = resolvePath(a.path);
      await ps(
        `Add-Type -AssemblyName Microsoft.VisualBasic
         if (-not (Test-Path -LiteralPath $env:P)) { throw "Not found: $env:P" }
         if ((Get-Item -LiteralPath $env:P).PSIsContainer) {
           [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:P, 'OnlyErrorDialogs', 'SendToRecycleBin')
         } else {
           [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:P, 'OnlyErrorDialogs', 'SendToRecycleBin')
         }`,
        { P: p }
      );
      return `Sent to Recycle Bin: ${p}`;
    }

    case 'list_folder': {
      const p = resolvePath(a.path);
      const out = await ps('(Get-ChildItem -LiteralPath $env:P -ErrorAction Stop | Select-Object -First 100 -ExpandProperty Name) -join "`n"', { P: p });
      return `${p}:\n${out || '(empty)'}`;
    }

    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// Real outcome goes back to the model, so it only confirms what actually happened.
export async function executeOsTool(name: string, args: Record<string, any>) {
  try {
    return { status: 'SUCCESS', message: await run(name, args) };
  } catch (err: any) {
    return { status: 'FAILED', error: err?.message || String(err) };
  }
}
