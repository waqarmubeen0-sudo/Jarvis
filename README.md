# JARVIS

**JARVIS - a real-time AI voice assistant for your PC, with a dashboard, skills, memory and Agent Town.**

<!-- Add screenshot or demo video here -->

> **No API key is included.** Every user must add their **own** API key. A free Google Gemini key works.

## What it can do

- **Talk in real time**: speak to JARVIS and he answers out loud. You can interrupt him mid-sentence, or type instead.
- **Control your PC** (Windows): open and close apps, switch, minimize and maximize windows, use the mouse and keyboard, and run terminal commands.
- **Use a browser for you**: search, open pages, click, type into fields, read pages and download files. Direct mode uses a visible browser window; Orbit mode uses a separate browser in the background.
- **See your screen**: describe what's on it, read error messages and find buttons.
- **Work with files**: find, read, edit, copy and move files. Drop PDF, Word, Excel, image, audio, video or ZIP files on JARVIS to have them analysed.
- **Email**: check, search, read and summarise your mail, and write drafts. Nothing is sent until you confirm.
- **Remember what you allow**: long-term memory that only saves with your consent. You can view, edit and clear it in the Memory panel.
- **Reminders and automations**: reminders at a set time, recurring tasks, commands and watchers.
- **Agent Town**: a team of AI specialists (NEX the manager, CODE, GAME, WRITE, PROMPT, SEC, SOCIAL and ATLAS) takes on bigger jobs like research, code projects and games. You can watch them work in an animated town.
- **JARVIS Arcade**: play the built-in games and the games the team builds.
- **Dashboard extras**: world news headlines, an interactive 3D globe, world time and weather, jokes and trivia.
- **Permission Center**: choose what JARVIS may do on its own, only after asking you, or never.
- **Your choice of AI**: Google Gemini, Anthropic Claude or OpenAI ChatGPT for text work. Voice always uses Gemini.

## What you need

- **Windows 10 or 11.** PC control uses Windows; the rest of JARVIS also runs on macOS and Linux.
- **Node.js 22.12 or newer**, with npm: <https://nodejs.org>
- **Google Chrome or Microsoft Edge**, for browser control.
- **A microphone**, plus speakers or headphones, for voice.
- **Your own API key.** A free Google Gemini key from <https://aistudio.google.com/apikey> works. Voice always needs a Gemini key; Claude or ChatGPT keys are optional. No key is included with JARVIS.

## Setup

```bash
git clone https://github.com/waqarmubeen0-sudo/Jarvis.git
cd Jarvis
npm install
cp .env.example .env        # Windows Command Prompt: copy .env.example .env
```

Open `.env` and replace `your_api_key_here` with your own Gemini key. Then start JARVIS:

```bash
npm run dev
```

Open <http://localhost:3000> in your browser, press **START AI** and talk to JARVIS. If you skip the `.env` step, JARVIS shows a setup screen where you can paste your key instead.

## Supported providers and models

Pick the provider for JARVIS's text work in **API Settings** (or on the setup screen). Each provider has its own key and model.

| Provider | Used for | Suggested models (any model your key can use works) |
|---|---|---|
| **Google Gemini** | Chat, agents, routing, humor, trivia, **and always:** voice, web search, file/image analysis | `gemini-3.8-flash` (default), `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`; voice uses `gemini-3.8-live` |
| **Anthropic (Claude)** | Chat, agents, routing, humor, trivia | `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-4-5-20251001` |
| **OpenAI (ChatGPT)** | Chat, agents, routing, humor, trivia | `gpt-5`, `gpt-5-mini` |

JARVIS's real-time voice is built on the Gemini Live API, so **voice, web search and file/image analysis always need a Gemini key**, even when Claude or ChatGPT handles the text. A free key from Google AI Studio works (free-tier rate limits apply). With Claude or ChatGPT selected, typed chat gives plain answers without PC-control tools; voice keeps all of them.

Optional extras (also your own credentials): an **email app password** (Gmail, Outlook, Yahoo, iCloud or any IMAP/SMTP server) and a **NewsAPI** key for headlines (otherwise free RSS feeds are used).

## Desktop app (Windows installer)

You can also run JARVIS as a desktop app in its own window. Build the installer yourself with `npm run dist`; it appears in `release/`. (If a ready-made installer is published on this repository's **Releases** page, you can download that instead.)

1. **Install**: run `JARVIS-Setup-x.y.z.exe`. It isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.
2. **Launch JARVIS** from the Start menu or the desktop shortcut.
3. **Enter your own API key**: on first launch JARVIS shows **J.A.R.V.I.S. INITIAL SETUP**.
   - Provider: **Google Gemini** (recommended, needed for voice), **Anthropic (Claude)** or **OpenAI (ChatGPT)**.
   - API key: create one at <https://aistudio.google.com/apikey> (Gemini), <https://console.anthropic.com/settings/keys> (Claude) or <https://platform.openai.com/api-keys> (ChatGPT), and paste it.
   - Model: keep the default, or pick another.
   - Your name: what JARVIS should call you (optional).
4. **Test Connection**: JARVIS makes one tiny test call with your key.
5. **Save Configuration**: you're in. Press **START AI** and talk to JARVIS.

After saving, your key is only ever shown masked (`••••••ABCD`). You can replace or remove it any time in **API Settings** (header).

## Where your credentials are stored

- **In the desktop app**, credentials are **encrypted by your operating system**: Windows DPAPI, macOS Keychain, or Linux Secret Service. They're stored in your user profile (`%APPDATA%\JARVIS\credentials.bin` on Windows), never in the install folder.
  - The file can't be decrypted by another user account or on another PC.
  - If your system has no secure storage (e.g. Linux without a keyring), JARVIS refuses to save rather than storing keys in plain text.
- **In development** (`npm run dev`), keys come from `.env`; keys you save in the app go to `.env.local`. Both are git-ignored.
- The JARVIS window never receives your full key. All AI calls are made by JARVIS's local backend.
- Keys, passwords and tokens are hidden (`••••••ABCD`) in the System Logs, the activity log and error messages.
- JARVIS only listens on `127.0.0.1`, so other devices on your network can't reach it. It only accepts requests from its own window, so websites you visit can't control it.

Your settings and data also stay in your profile:
- `%APPDATA%\JARVIS`: settings and built games (desktop app).
- `~/.jarvis`: memory, activity log and automations.

## Permissions and safety

JARVIS acts on your real PC. **Settings → Permission Center** sets what it may do:
- **ON**: on its own.
- **ASK**: only after your "yes".
- **OFF**: never.

Purchases are never automatic. Deleting files, installing software and sending or deleting email ask first by default. Before sending an email, JARVIS reads you the recipient, subject and message and waits for your confirmation.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with live reload, at <http://localhost:3000>. |
| `npm run desktop` | Builds and opens the desktop app (first-launch setup, OS-encrypted keys). |
| `npm run dist` | Builds the Windows installer into `release/`, scanning the build and installer for secrets. |
| `npm run scan-secrets` | Checks the files that would be committed for keys, tokens and private keys. |
| `npm run lint` | Type-checks the project. |

Self-checks: `npx tsx <name>.check.ts` (e.g. `npx tsx credentials.check.ts`).

## Security

- **Never commit `.env`, `.env.local` or any real key.** `.gitignore` already excludes them.
- **Run `npm run scan-secrets` before every push.** It checks the files that would be committed for keys, tokens and private keys.
- Found a security problem? See [SECURITY.md](SECURITY.md). **Never paste your API key into an issue.**

## License

JARVIS is free for **personal, non-commercial use** under the [PolyForm Noncommercial License 1.0.0](LICENSE).

**Business use, selling it, or including it in a paid product is not allowed** without my written permission. To ask for a business license, contact me through my GitHub profile: <https://github.com/waqarmubeen0-sudo>.
