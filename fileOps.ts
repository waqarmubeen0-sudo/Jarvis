// FILES skill: The user's files on disk (beyond the create/move/delete/list tools in osTools).
//   read, search (names and contents), copy, edit (find/replace), append, info, open, download,
//   and analyze: loads ANY supported file (PDF, DOCX, XLSX, CSV, images, audio, video, ZIP, code...)
//   into JARVIS DROP, so the same readers, search and vision that handle dropped files apply.
// DOCUMENT ANALYSIS and IMAGE ANALYSIS are the DROP tools (read_file, search_files, look_at_file).
import fs from 'node:fs';
import path from 'node:path';
import { Type } from '@google/genai';
import { resolvePath, ps } from './osTools';
import { addFile, MAX_UPLOAD } from './files';
import { DOWNLOADS } from './browserControl';
import { registerSkill, type ToolResult } from './skillRegistry';

const TEXT_EXT = /\.(txt|md|markdown|json|jsonc|csv|tsv|log|ini|cfg|conf|env|ya?ml|toml|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|swift|kt|sh|ps1|bat|cmd|sql|r|lua|dart|vue|svelte|gd|gitignore)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'appdata', '.cache', 'dist', 'build', '__pycache__', '.venv', 'venv']);
const MAX_READ = 15_000;

function existing(p: unknown, what = 'file') {
  const full = resolvePath(String(p ?? ''));
  if (!p || !fs.existsSync(full)) throw new Error(`No ${what} at ${full}.`);
  return full;
}

/** Walks a folder (bounded) calling visit for each file; skips heavy/system folders. */
function walk(root: string, visit: (file: string) => boolean | void, limits = { files: 20_000, ms: 8000 }) {
  const end = Date.now() + limits.ms;
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (Date.now() > end || ++n > limits.files) return false;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.')) stack.push(full); }
      else if (visit(full) === false) return true;
    }
  }
  return true;
}

async function fileAction(a: Record<string, any>): Promise<ToolResult> {
  const action = String(a.action || 'read').toLowerCase();
  switch (action) {
    case 'read': {
      const file = existing(a.path);
      if (fs.statSync(file).isDirectory()) throw new Error(`${file} is a folder; use list_folder.`);
      if (!TEXT_EXT.test(file)) return { status: 'FAILED', error: `${path.basename(file)} is not plain text. Use file_ops analyze to open PDFs, Office files, images, audio, video or archives.` };
      const text = fs.readFileSync(file, 'utf-8');
      const offset = Math.max(0, Number(a.offset ?? 0));
      return { status: 'SUCCESS', message: `Read ${path.basename(file)}`, path: file, text: text.slice(offset, offset + MAX_READ), length: text.length, ...(text.length > offset + MAX_READ ? { nextOffset: offset + MAX_READ } : {}) };
    }
    case 'search': {
      const root = existing(a.folder ?? a.path ?? '.', 'folder');
      const q = String(a.query ?? '').toLowerCase();
      if (!q) throw new Error('search needs a query (part of a file name, or text to find with content=true).');
      const hits: string[] = [];
      const done = walk(root, (f) => {
        const name = path.basename(f).toLowerCase();
        if (name.includes(q)) hits.push(f);
        else if (a.content && TEXT_EXT.test(f)) {
          try { if (fs.statSync(f).size < 2_000_000 && fs.readFileSync(f, 'utf-8').toLowerCase().includes(q)) hits.push(`${f} (contains "${a.query}")`); } catch {}
        }
        return hits.length < 60;
      }, { files: a.content ? 8000 : 40_000, ms: a.content ? 12000 : 8000 });
      return { status: 'SUCCESS', message: `${hits.length} match(es) for "${a.query}" under ${root}${done ? '' : ' (stopped early: the folder is very large; search a narrower folder)'}`, results: hits };
    }
    case 'copy': {
      const from = existing(a.from ?? a.path);
      const to = resolvePath(String(a.to ?? ''));
      if (!a.to) throw new Error('copy needs a destination (to).');
      const dest = fs.existsSync(to) && fs.statSync(to).isDirectory() ? path.join(to, path.basename(from)) : to;
      if (fs.existsSync(dest) && !a.overwrite) throw new Error(`${dest} already exists (pass overwrite to replace it).`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(from, dest, { recursive: true, force: !!a.overwrite });
      return { status: 'SUCCESS', message: `Copied to ${dest}`, path: dest };
    }
    case 'edit': {
      const file = existing(a.path);
      const text = fs.readFileSync(file, 'utf-8');
      const find = String(a.find ?? '');
      if (!find) throw new Error('edit needs the exact text to find.');
      const count = text.split(find).length - 1;
      if (!count) return { status: 'FAILED', error: `The text to replace was not found in ${path.basename(file)}; nothing changed.` };
      if (count > 1 && !a.all) return { status: 'FAILED', error: `That text appears ${count} times; pass all=true or give a longer, unique snippet.` };
      fs.writeFileSync(file, a.all ? text.split(find).join(String(a.replace ?? '')) : text.replace(find, () => String(a.replace ?? '')), 'utf-8');
      return { status: 'SUCCESS', message: `Edited ${path.basename(file)} (${a.all ? count : 1} replacement${(a.all ? count : 1) === 1 ? '' : 's'})`, path: file };
    }
    case 'append': {
      const file = resolvePath(String(a.path ?? ''));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, String(a.text ?? ''), 'utf-8');
      return { status: 'SUCCESS', message: `Appended to ${path.basename(file)}`, path: file };
    }
    case 'info': {
      const file = existing(a.path, 'file or folder');
      const s = fs.statSync(file);
      return { status: 'SUCCESS', message: path.basename(file), path: file, type: s.isDirectory() ? 'folder' : 'file', sizeKB: Math.round(s.size / 1024), modified: s.mtime.toISOString(), created: s.birthtime.toISOString() };
    }
    case 'open': {
      const file = existing(a.path, 'file or folder');
      await ps('Start-Process -FilePath $env:P', { P: file });
      return { status: 'SUCCESS', message: `Opened ${path.basename(file)} with its default app` };
    }
    case 'download': {
      const url = String(a.url ?? '');
      if (!/^https?:\/\//i.test(url)) throw new Error('download needs an http(s) URL.');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}.`);
      const dir = a.to ? resolvePath(String(a.to)) : DOWNLOADS;
      fs.mkdirSync(dir, { recursive: true });
      const name = (path.basename(new URL(url).pathname) || 'download').replace(/[\\/:*?"<>|]/g, '_');
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return { status: 'SUCCESS', message: `Downloaded ${name} (${Math.round(fs.statSync(file).size / 1024)} KB) to ${dir}`, path: file };
    }
    case 'analyze': {
      const file = existing(a.path);
      const size = fs.statSync(file).size;
      if (size > MAX_UPLOAD) throw new Error(`${path.basename(file)} is ${(size / 1048576).toFixed(0)} MB; the limit is ${MAX_UPLOAD / 1048576} MB.`);
      const f = await addFile(path.basename(file), fs.readFileSync(file));
      if (f.status !== 'READY') return { status: 'FAILED', error: `Couldn't read ${f.name}: ${f.error}` };
      return { status: 'SUCCESS', message: `Loaded ${f.name} into JARVIS DROP: ${f.summary}. Use read_file / search_files / look_at_file with name "${f.name}".`, name: f.name, summary: f.summary };
    }
  }
  return { status: 'FAILED', error: `Unknown file action "${action}".` };
}

const str = (description: string) => ({ type: Type.STRING, description });
registerSkill({
  id: 'files',
  name: 'FILES',
  description: 'Lists, searches, reads, creates, edits, copies, moves, renames, opens and downloads files on your PC.',
  guide: "list_folder / file_ops search to find files; file_ops read for text and code; file_ops analyze to open PDFs, Word, Excel, images, audio, video or ZIPs (then read_file / look_at_file); create_file to write, file_ops edit for precise changes; move_item to move or rename; delete_item only when the user asks (it goes to the Recycle Bin and needs their yes). Relative paths start at their home folder (e.g. 'Desktop/notes.txt').",
  builtin: ['create_folder', 'create_file', 'move_item', 'delete_item', 'list_folder'],
  tools: [{
    name: 'file_ops',
    description: "Files on the user's PC. Actions: read (path, offset), search (query, folder, content=true to search inside text files), copy (from, to, overwrite), edit (path, find, replace, all), append (path, text), info (path), open (path, with its default app), download (url, to folder), analyze (path: loads PDF/DOCX/XLSX/CSV/PPTX/images/audio/video/ZIP into JARVIS DROP for read_file/search_files/look_at_file). Relative paths start at the home folder.",
    parameters: { type: Type.OBJECT, properties: {
      action: str('One of the actions above'), path: str('File path'), folder: str('Folder to search (default: home)'), query: str('Name fragment or text to find'),
      content: { type: Type.BOOLEAN, description: 'search: also look inside text files' }, from: str('copy: source'), to: str('copy/download: destination'),
      find: str('edit: exact text to replace'), replace: str('edit: replacement'), all: { type: Type.BOOLEAN, description: 'edit: replace every occurrence' },
      text: str('append: text'), url: str('download: URL'), offset: { type: Type.NUMBER, description: 'read: continue from this character' }, overwrite: { type: Type.BOOLEAN, description: 'copy: replace an existing file' },
    }, required: ['action'] },
  }],
  permission: (tool) => (tool === 'delete_item' ? ['FILE_DELETE'] : ['FILE_ACCESS']),
  summary: (tool, a) => (tool === 'delete_item' ? `Send ${resolvePath(String(a.path ?? ''))} to the Recycle Bin` : `${tool === 'file_ops' ? a.action : tool} ${a.path ?? a.from ?? a.url ?? ''}`.trim()),
  execute: (_t, a) => fileAction(a),
});

registerSkill({
  id: 'documents', name: 'DOCUMENT ANALYSIS', description: 'Reads and searches PDFs, Word, Excel, PowerPoint, CSV, JSON, code and archives you DROP (or that file_ops analyze loads).',
  builtin: ['list_files', 'read_file', 'search_files'], permission: () => [],
});
registerSkill({
  id: 'images', name: 'IMAGE ANALYSIS', description: 'Looks at images, scanned PDFs, audio and video with Gemini vision/listening.',
  builtin: ['look_at_file'], permission: () => [],
});
