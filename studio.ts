// GAME DEVELOPMENT + CODING skills: JARVIS Game Studio (connected to JARVIS Arcade) and the
// projects JARVIS builds in ~/JarvisProjects.
//   game_studio: create (the team builds + plays/tests it), edit, test, debug, run/open, restart,
//                save (export), publish (a local HTML game -> tested -> Arcade), list
//   project:     list, open (VS Code / browser / folder), run, test
// A game reaches the Arcade only after JARVIS has actually played it in a test browser.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Type } from '@google/genai';
import { listGames, findGame, saveGame, validateGameHtml, extractHtml, gamePrompt, htmlTitle, GAMES_DIR } from './gameBuilder';
import { testGame, testHtml, reportText, failures } from './runtimeTest';
import { gemini } from './files';
import { PROJECTS_DIR, testProject, type ProjectKind } from './builder';
import { runCommand } from './terminal';
import { resolvePath, ps } from './osTools';
import { logActivity } from './activity';
import { registerSkill, type ToolResult } from './skillRegistry';

let hooks = {
  openArcade: (_gameId: string | null) => {},
  delegate: async (_prompt: string, _agent?: string): Promise<{ id: string; assignees: string[] }> => { throw new Error('The team is not connected.'); },
};
/** server.ts connects the Arcade (dashboard) and the agent team. */
export const configureStudio = (h: Partial<typeof hooks>) => { hooks = { ...hooks, ...h }; };

const gameFile = (id: string) => path.join(GAMES_DIR, `${id}.html`);
function needGame(q: unknown) {
  const g = findGame(q ? String(q) : undefined);
  if (!g) throw new Error(q ? `No game called "${q}" in JARVIS Arcade. Built so far: ${[...new Set(listGames().map((x) => x.title))].join(', ') || 'none'}.` : 'There are no games in JARVIS Arcade yet.');
  return g;
}

async function studio(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'list').toLowerCase();
  switch (action) {
    case 'list': {
      const games = listGames();
      return { status: 'SUCCESS', message: `${games.length} game(s) in JARVIS Arcade`, games: games.slice(0, 30).map((g) => `${g.title} (${g.id}, ${g.source}, ${new Date(g.createdAt).toLocaleDateString()})`) };
    }
    case 'create': {
      const request = String(a.request ?? '').trim();
      if (!request) throw new Error('Say what game to create.');
      const t = await hooks.delegate(/\b(create|make|build)\b/i.test(request) ? request : `Create ${request}`, 'GAME');
      return { status: 'DELEGATED', message: `The GAME team is building it (task ${t.id}). It will be played and tested before it appears in the Arcade; the Mission Queue shows progress.`, taskId: t.id };
    }
    case 'open': case 'run': case 'restart': {
      const g = needGame(a.game);
      hooks.openArcade(g.id);
      return { status: 'SUCCESS', message: `${action === 'restart' ? 'Restarted' : 'Launched'} ${g.title} in JARVIS Arcade` };
    }
    case 'test': case 'debug': {
      const g = needGame(a.game);
      const r = await testGame(gameFile(g.id), g.prompt || g.title);
      logActivity(r.ok ? 'RESULT' : 'ERROR', `${g.title} ${r.ok ? 'passed' : 'failed'} its game test${r.ok ? '' : `: ${failures(r).join('; ').slice(0, 200)}`}`);
      return { status: r.ok ? 'SUCCESS' : 'FAILED', ...(r.ok ? { message: `${g.title} passed every check` } : { error: `${g.title} has problems: ${failures(r).join('; ')}` }), report: reportText(r), ...(action === 'debug' && !r.ok ? { hint: "Use game_studio edit with a request describing the fix, e.g. 'fix: ' + the failures." } : {}) };
    }
    case 'edit': {
      const g = needGame(a.game);
      const request = String(a.request ?? '').trim();
      if (!request) throw new Error('Say what to change.');
      const current = fs.readFileSync(gameFile(g.id), 'utf-8');
      let errors: string[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        logActivity('ACTION', attempt === 1 ? `Editing ${g.title}: ${request}` : `Fixing the edited ${g.title} (attempt ${attempt})`);
        const reply = await gemini([{ text: `${gamePrompt(`${g.title}, changed as follows: ${request}`, attempt > 1 ? { errors, previous: '' } : undefined)}

Here is the CURRENT game. Modify it (keep everything that already works) and return the full updated HTML:
\`\`\`html
${current.slice(0, 120_000)}
\`\`\`` }]);
        const html = extractHtml(reply);
        errors = validateGameHtml(html ?? '');
        if (!errors.length) {
          logActivity('ACTION', `Started the edited ${g.title} in the test browser`);
          const r = await testHtml(html!, `${g.prompt} ${request}`);
          if (r.ok) {
            const rec = saveGame(html!, { title: htmlTitle(html!) ?? g.title, prompt: `${g.prompt}; ${request}`, agent: 'JARVIS', source: 'generated', note: `edit of ${g.id}` });
            logActivity('RESULT', `Edited ${rec.title}: game test successful (${rec.id})`);
            hooks.openArcade(rec.id);
            return { status: 'SUCCESS', message: `Updated ${rec.title} and opened it in the Arcade. Verified: ${r.checks.filter((c) => c.ok).map((c) => c.name.toLowerCase()).join(', ')}.`, id: rec.id };
          }
          errors = failures(r);
        }
        logActivity('ERROR', `The edited ${g.title} failed: ${errors.join('; ').slice(0, 200)}`);
      }
      return { status: 'FAILED', error: `The edit kept failing its tests, so the Arcade still has the old version. Problems: ${errors.join('; ')}` };
    }
    case 'save': {
      const g = needGame(a.game);
      const to = a.path ? resolvePath(String(a.path)) : path.join(PROJECTS_DIR, 'games', `${g.id}.html`);
      const dest = fs.existsSync(to) && fs.statSync(to).isDirectory() ? path.join(to, `${g.id}.html`) : to;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(gameFile(g.id), dest);
      return { status: 'SUCCESS', message: `Saved ${g.title} to ${dest}`, path: dest };
    }
    case 'publish': {
      const file = resolvePath(String(a.path ?? ''));
      if (!a.path || !fs.existsSync(file)) throw new Error(`No HTML game at ${file}.`);
      const html = fs.readFileSync(file, 'utf-8');
      const errs = validateGameHtml(html);
      if (errs.length) return { status: 'FAILED', error: `Not published: ${errs.join('; ')}` };
      const r = await testHtml(html, String(a.request ?? htmlTitle(html) ?? 'game'));
      if (!r.ok) return { status: 'FAILED', error: `Not published, it failed testing: ${failures(r).join('; ')}`, report: reportText(r) };
      const rec = saveGame(html, { title: htmlTitle(html) ?? path.basename(file, '.html'), prompt: `published from ${file}`, agent: 'JARVIS', source: 'generated' });
      return { status: 'SUCCESS', message: `Published ${rec.title} to JARVIS Arcade after it passed testing`, id: rec.id };
    }
  }
  return { status: 'FAILED', error: `Unknown game_studio action "${action}".` };
}

// ---------------------------------------------------------------------------------------------
// Projects

function projects() {
  try {
    return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'games').map((d) => {
      const dir = path.join(PROJECTS_DIR, d.name);
      const kind: ProjectKind | null = fs.existsSync(path.join(dir, 'index.html')) ? 'web' : fs.existsSync(path.join(dir, 'main.py')) ? 'python' : fs.existsSync(path.join(dir, 'main.js')) ? 'node' : null;
      return { name: d.name, dir, kind, modified: fs.statSync(dir).mtime };
    }).sort((x, y) => +y.modified - +x.modified);
  } catch { return []; }
}
function needProject(q: unknown) {
  const list = projects();
  const want = String(q ?? '').toLowerCase().trim();
  const p = !want ? list[0] : list.find((x) => x.name.toLowerCase() === want) ?? list.find((x) => x.name.toLowerCase().includes(want.replace(/\s+/g, '-')));
  if (p) return p;
  // Any folder on the PC works too ("open my jarvis project").
  const dir = resolvePath(String(q ?? ''));
  if (q && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return { name: path.basename(dir), dir, kind: null as ProjectKind | null, modified: new Date() };
  throw new Error(want ? `No project "${q}" in ${PROJECTS_DIR} (and no such folder).` : `There are no projects in ${PROJECTS_DIR} yet.`);
}

async function project(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'list').toLowerCase();
  if (action === 'list') return { status: 'SUCCESS', message: `${projects().length} project(s) in ${PROJECTS_DIR}`, projects: projects().slice(0, 30).map((p) => `${p.name} (${p.kind ?? 'folder'})`) };
  const p = needProject(a.name);
  switch (action) {
    case 'open': {
      const how = String(a.with ?? 'vscode').toLowerCase();
      if (how === 'vscode' || how === 'code') {
        await new Promise<void>((res, rej) => execFile('cmd.exe', ['/d', '/c', 'code', p.dir], { windowsHide: true }, (e) => (e ? rej(new Error(`VS Code could not be started: ${e.message}`)) : res())));
        return { status: 'SUCCESS', message: `Opened ${p.name} in VS Code` };
      }
      const target = how === 'browser' && p.kind === 'web' ? path.join(p.dir, 'index.html') : p.dir;
      await ps('Start-Process -FilePath $env:P', { P: target });
      return { status: 'SUCCESS', message: `Opened ${p.name} ${how === 'browser' ? 'in the browser' : 'in File Explorer'}` };
    }
    case 'run': {
      if (p.kind === 'web') { await ps('Start-Process -FilePath $env:P', { P: path.join(p.dir, 'index.html') }); return { status: 'SUCCESS', message: `Opened ${p.name} in your browser` }; }
      if (!p.kind) throw new Error(`${p.name} has no index.html, main.py or main.js to run; use the terminal skill.`);
      const r = await runCommand(p.kind === 'python' ? 'python main.py' : 'node main.js', { shell: 'cmd', cwd: p.dir, timeoutSec: 60 });
      return { status: r.code === 0 ? 'SUCCESS' : 'FAILED', ...(r.code === 0 ? { message: `${p.name} ran (exit 0)` } : { error: `${p.name} exited with code ${r.code}` }), output: `${r.stdout}\n${r.stderr}`.trim().slice(-6000) };
    }
    case 'test': {
      if (!p.kind) throw new Error(`${p.name} has no index.html, main.py or main.js to test.`);
      const r = await testProject(p.dir, p.kind);
      return { status: r.ok ? 'SUCCESS' : 'FAILED', ...(r.ok ? { message: `${p.name} passed every check` } : { error: failures(r).join('; ') }), report: reportText(r) };
    }
  }
  return { status: 'FAILED', error: `Unknown project action "${action}".` };
}

const str = (description: string) => ({ type: Type.STRING, description });
registerSkill({
  id: 'games',
  name: 'GAME DEVELOPMENT',
  description: 'JARVIS Game Studio: creates, edits, tests, debugs, runs, saves and publishes games to JARVIS Arcade.',
  guide: "To create a game, delegate it (or game_studio create): the team writes it, JARVIS plays it in a test browser, fixes errors and only then publishes it to the Arcade. game_studio test/debug checks an existing game for real; edit changes one; open/restart launches it in the Arcade.",
  builtin: ['open_arcade'],
  tools: [{
    name: 'game_studio',
    description: "JARVIS Game Studio. Actions: list, create (request), edit (game, request), test (game: really plays it and reports each check), debug (test + what to fix), run / open (game, in the Arcade), restart (game), save (game, optional path: export the HTML), publish (path of a local HTML game: tested, then added to the Arcade).",
    parameters: { type: Type.OBJECT, properties: { action: str('One of the actions above'), game: str('Game name or id'), request: str('What to create / change'), path: str('File path (save / publish)') }, required: ['action'] },
  }],
  permission: (_t, a) => (['save', 'publish'].includes(String(a.action)) ? ['FILE_ACCESS'] : []),
  execute: (_t, a) => studio(a),
});

registerSkill({
  id: 'coding',
  name: 'CODING',
  description: 'Builds websites, web apps, scripts and tools that are run and tested before they are reported done; opens, runs and tests projects.',
  guide: "To build software (webpage, web app, script, tool), delegate it: CODE writes it to ~/JarvisProjects, JARVIS runs and tests it, fixes errors and reports only a verified result. project list/open (with 'vscode' | 'browser' | 'folder')/run/test for existing projects; name can also be any folder path, e.g. 'Desktop/jarvis'. Use terminal for other commands.",
  tools: [{
    name: 'project',
    description: "Projects in ~/JarvisProjects (or any folder path). Actions: list, open (name, with 'vscode' (default) | 'browser' | 'folder'), run (name), test (name: run + verify).",
    parameters: { type: Type.OBJECT, properties: { action: str("'list' | 'open' | 'run' | 'test'"), name: str('Project name or folder path'), with: str("'vscode' | 'browser' | 'folder'") }, required: ['action'] },
  }],
  permission: (_t, a) => (['run', 'test'].includes(String(a.action)) ? ['TERMINAL'] : String(a.action) === 'open' ? ['PC_CONTROL'] : ['FILE_ACCESS']),
  execute: (_t, a) => project(a),
});
