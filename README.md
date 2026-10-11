# J.A.R.V.I.S. — real-time voice assistant for your PC

JARVIS is a desktop voice assistant you talk to like a person. It can control your PC (apps, windows, browser, screen, files, terminal), read and send email with your confirmation, remember what you allow it to, run reminders and automations, and hand bigger jobs (research, code, games, projects) to its agent team in Agent Town.

> **JARVIS does not include the developer's API keys. Each user must provide their own API credentials.**

## Supported providers and models

Pick the provider for JARVIS's text work in **API Settings** (or on the setup screen). Each provider has its own key and model.

| Provider | Used for | Suggested models (any model your key can use works) |
|---|---|---|
| **Google Gemini** | Chat, agents, routing, humor, trivia, **and always:** voice, web search, file/image analysis | `gemini-3.8-flash` (default), `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`; voice uses `gemini-3.8-live` |
| **Anthropic (Claude)** | Chat, agents, routing, humor, trivia | `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-4-5-20251001` |
| **OpenAI (ChatGPT)** | Chat, agents, routing, humor, trivia | `gpt-5`, `gpt-5-mini` |

JARVIS's real-time voice is built on the Gemini Live API, so **voice, web search and file/image analysis always need a Gemini key**, even when Claude or ChatGPT handles the text. A free key from Google AI Studio works (free-tier rate limits apply). With Claude or ChatGPT selected, typed chat gives plain answers without PC-control tools; voice keeps all of them.

Optional extras (also your own credentials): an **email app password** (Gmail, Outlook, Yahoo, iCloud or any IMAP/SMTP server) and a **NewsAPI** key for headlines (otherwise free RSS feeds are used).

## Install and set up (Windows)

1. **Download** `JARVIS-Setup-x.y.z.exe` from this repository's **Releases** page.
2. **Install**: run the installer. It isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.
3. **Launch JARVIS** from the Start menu or the desktop shortcut.
4. **Enter your own API key**: on first launch JARVIS shows **J.A.R.V.I.S. INITIAL SETUP**.
   - Provider: **Google Gemini** (recommended, needed for voice), **Anthropic (Claude)** or **OpenAI (ChatGPT)**.
   - API key: create one at <https://aistudio.google.com/apikey> (Gemini), <https://console.anthropic.com/settings/keys> (Claude) or <https://platform.openai.com/api-keys> (ChatGPT), and paste it.
   - Model: keep the default, or pick another.
   - Your name: what JARVIS should call you.
5. **Test Connection**: JARVIS makes one tiny test call with your key.
6. **Save Configuration**: you're in. Press **START AI** and talk to JARVIS.

After saving, your key is only ever shown masked (`••••••ABCD`). You can replace or remove it any time in **API Settings** (header).

## Where your credentials are stored

- **In the desktop app**, credentials are **encrypted by your operating system**: Windows DPAPI, macOS Keychain, or Linux Secret Service. They're stored in your user profile (`%APPDATA%\JARVIS\credentials.bin` on Windows), never in the install folder.
  - The file can't be decrypted by another user account or on another PC.
  - If your system has no secure storage (e.g. Linux without a keyring), JARVIS refuses to save rather than storing keys in plain text.
- The JARVIS window never receives your full key. All AI calls are made by JARVIS's local backend.
- Keys, passwords and tokens are hidden (`••••••ABCD`) in the System Logs, the activity log and error messages.
- JARVIS only listens on `127.0.0.1`, so other devices on your network can't reach it. It only accepts requests from its own window, so websites you visit can't control it.

Your settings and data also stay in your profile:
- `%APPDATA%\JARVIS`: settings and built games.
- `~/.jarvis`: memory, activity log and automations.

## Permissions and safety

JARVIS acts on your real PC. **Settings → Permission Center** sets what it may do:
- **ON**: on its own.
- **ASK**: only after your "yes".
- **OFF**: never.

Purchases are never automatic. Deleting files, installing software and sending or deleting email ask first by default. Before sending an email, JARVIS reads you the recipient, subject and message and waits for your confirmation.

## Build from source

Requirements: Node.js 22+ and npm, on Windows 10/11. PC control uses Windows APIs; the rest of JARVIS is cross-platform.

```bash
npm install
cp .env.example .env            # then put YOUR key in .env (never commit it)
npm run dev                     # http://localhost:3000 in your browser
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with live reload. Reads credentials from `.env` (keys you save in the app go to `.env.local`). |
| `npm run desktop` | Builds and opens the desktop app (first-launch setup, OS-encrypted keys). |
| `npm run dist` | Builds the Windows installer into `release/`, scanning the build and installer for secrets. |
| `npm run scan-secrets` | Checks the files that would be committed for keys, tokens and private keys. |
| `npm run lint` | Type-checks the project. |

Self-checks: `npx tsx <name>.check.ts` (e.g. `npx tsx credentials.check.ts`).

## Security

- Never commit `.env.local`, `.env` or any real key. `.gitignore` excludes them; run `npm run scan-secrets` before you push.
- Found a security problem? See [SECURITY.md](SECURITY.md). **Never paste your API key into an issue.**

## License

JARVIS is free for **personal, non-commercial use**: you may download it, use it, study it and change it for yourself.

**Business use, selling it, or including it in a paid product is not allowed** without my written permission. To ask for a business license, contact me through my GitHub profile: <https://github.com/waqarmubeen0-sudo>.

The full terms are the [PolyForm Noncommercial License 1.0.0](LICENSE).
