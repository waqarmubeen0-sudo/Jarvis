# Security policy

## Reporting a vulnerability

Please report security problems privately through **GitHub → Security → Report a vulnerability** on this repository. Don't open a public issue.

Include what you found, how to reproduce it, and the JARVIS version. **Never include your API key, email password or any other credential** in a report, issue, log or screenshot. If you have pasted one anywhere public, revoke it right away:
- Gemini key: <https://aistudio.google.com/apikey>.
- App password: your email provider's security settings.

## How JARVIS handles credentials

- **No credentials ship with JARVIS.** Each user enters their own on first launch.
- **The desktop app stores them encrypted by the operating system** (Windows DPAPI / macOS Keychain / Linux Secret Service) in the user's profile. It never stores them in plain text, in browser storage or in the install folder.
- **The UI never receives a full key.** It only ever sees `••••••ABCD`.
- **Credentials are removed from the process environment at startup**, so commands JARVIS runs can't read them.
- **Logs, the activity log and error messages are redacted.**
- **The local server listens only on `127.0.0.1`.** It rejects requests whose Host isn't this PC, and any state-changing request or WebSocket whose Origin isn't JARVIS itself.
- **`npm run dist` fails if a key-shaped string or the developer's own credential values appear** in the build output, the packaged app or the installer.

## Scope

JARVIS can control the PC it runs on (apps, files, terminal, browser, email) within the limits set in **Settings → Permission Center**. A bypass of those limits, or any way for another device or website to drive JARVIS, is in scope.
