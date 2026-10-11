// JARVIS desktop app (Electron main process).
// Runs the existing JARVIS server in-process on 127.0.0.1 (random free port) and shows the existing
// dashboard in one window. Credentials stay here, OS-encrypted (safeStorage); the window is a plain,
// sandboxed web page with no Node access and never receives a raw key.
import { app, BrowserWindow, desktopCapturer, safeStorage, session, shell } from 'electron';
import net from 'node:net';
import path from 'node:path';
import { useEncryptedStore } from '../credentials';

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
});

async function waitFor(url: string) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The JARVIS server did not start.');
}

if (process.env.JARVIS_USER_DATA) app.setPath('userData', process.env.JARVIS_USER_DATA); // a separate profile (testing)
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(async () => {
  // Everything the user owns lives in their profile (%APPDATA%\JARVIS), never in the install folder.
  const data = app.getPath('userData');
  const port = await freePort();
  Object.assign(process.env, {
    NODE_ENV: 'production',
    PORT: String(port),
    JARVIS_SETTINGS_FILE: process.env.JARVIS_SETTINGS_FILE || path.join(data, 'jarvis-settings.json'),
    JARVIS_GAMES_DIR: process.env.JARVIS_GAMES_DIR || path.join(data, 'generated-games'),
  });
  useEncryptedStore(path.join(data, 'credentials.bin'), safeStorage);
  await import('../server'); // starts listening on 127.0.0.1:<port>
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(`${origin}/api/setup`);

  // Mic (voice) and screen share only for JARVIS's own page; nothing else is granted.
  const ours = (url?: string) => !!url && (url === origin || url.startsWith(`${origin}/`));
  const ALLOWED = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => cb(ours(details.requestingUrl) && ALLOWED.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => ours(requestingOrigin) && ALLOWED.has(permission));
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb(s[0] ? { video: s[0] } : {})).catch(() => cb({}));
  }, { useSystemPicker: true });

  const win = new BrowserWindow({
    width: 1600, height: 950, minWidth: 1100, minHeight: 700, backgroundColor: '#0a0d12', autoHideMenuBar: true, title: 'J.A.R.V.I.S.',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links (e.g. "get a key") open in the user's browser; the window itself never leaves JARVIS.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!ours(url)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  await win.loadURL(origin);
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
}).catch((err) => {
  console.error('[Desktop] JARVIS failed to start:', err);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
