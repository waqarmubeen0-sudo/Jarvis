import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, Loader2, TriangleAlert, X } from 'lucide-react';

// JARVIS DROP: give JARVIS files from the terminal (DROP button or drag & drop).
// Files go to the server's session file store (files.ts); the server processes them and makes
// them available to JARVIS. Nothing here pretends: statuses come from the server's answer.

export type DropStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'ERROR';
export interface DropFile {
  key: string;
  id?: string; // server id once received
  name: string;
  type: string;
  size: number;
  status: DropStatus;
  progress: number;
  summary?: string;
  error?: string;
}

const MAX_UPLOAD = 60 * 1024 * 1024; // matches the server limit
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const typeOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toUpperCase().slice(0, 6) : 'FILE');
const hasFiles = (e: DragEvent | React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Upload one file with progress; resolves with the server's processed record. */
function send(file: File, onProgress: (p: number) => void, onSent: () => void) {
  return new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/files?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.upload.onload = onSent;
    xhr.onload = () => {
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body?.file) resolve(body.file);
      else reject(new Error(body?.error || (xhr.status === 413 ? 'File is too large (max 60 MB)' : `Upload failed (HTTP ${xhr.status})`)));
    };
    xhr.onerror = () => reject(new Error('Connection to the J.A.R.V.I.S. core failed'));
    xhr.send(file);
  });
}

export function useJarvisDrop(onSystemMessage?: (text: string) => void) {
  const [files, setFiles] = useState<DropFile[]>([]);
  const [dragOver, setDragOver] = useState(false); // over the terminal drop zone
  const [dragAnywhere, setDragAnywhere] = useState(false); // dragging files over the window
  const depth = useRef(0);
  const say = useRef(onSystemMessage);
  say.current = onSystemMessage;

  const patch = (key: string, p: Partial<DropFile>) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...p } : f)));

  // Files already in the server session (e.g. after reloading the page).
  useEffect(() => {
    fetch('/api/files')
      .then((r) => r.json())
      .then((d) => setFiles((fs) => fs.length ? fs : (d.files ?? []).map((f: any) => ({ key: f.id, id: f.id, name: f.name, type: f.type, size: f.size, status: f.status === 'PROCESSING' ? 'PROCESSING' : f.status, progress: 1, summary: f.summary, error: f.error }))))
      .catch(() => {});
  }, []);

  const upload = useCallback((list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
      const entry: DropFile = { key, name: file.name, type: typeOf(file.name), size: file.size, status: 'UPLOADING', progress: 0 };
      setFiles((fs) => [...fs, entry]);
      say.current?.(`FILE RECEIVED // ${file.name} // ${fmtSize(file.size)} // ${entry.type} // STATUS: PROCESSING...`);
      if (file.size > MAX_UPLOAD) {
        patch(key, { status: 'ERROR', error: 'File is too large (max 60 MB)' });
        say.current?.(`FILE ERROR // ${file.name} // too large (max 60 MB)`);
        continue;
      }
      send(file, (p) => patch(key, { progress: p }), () => patch(key, { status: 'PROCESSING', progress: 1 }))
        .then((f) => {
          patch(key, { id: f.id, name: f.name, type: f.type, status: f.status, summary: f.summary, error: f.error, progress: 1 });
          say.current?.(f.status === 'READY'
            ? `FILE READY // ${f.name} // ${f.summary} // I can now read and analyze ${f.name}.`
            : `FILE ERROR // ${f.name} // ${f.error}`);
        })
        .catch((e: Error) => {
          patch(key, { status: 'ERROR', error: e.message });
          say.current?.(`FILE ERROR // ${file.name} // ${e.message}`);
        });
    }
  }, []);

  const remove = useCallback(async (f: DropFile) => {
    setFiles((fs) => fs.filter((x) => x.key !== f.key));
    if (!f.id) return;
    try {
      await fetch(`/api/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
      if (f.status === 'READY') say.current?.(`FILE REMOVED // ${f.name} // no longer in J.A.R.V.I.S.'s context`);
    } catch {}
  }, []);

  // Window: arm the DROP control while files are dragged anywhere, and never let a stray drop
  // make the browser open the file (which would navigate away from JARVIS).
  useEffect(() => {
    let n = 0;
    const enter = (e: DragEvent) => { if (hasFiles(e)) { n++; setDragAnywhere(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --n <= 0) { n = 0; setDragAnywhere(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); n = 0; setDragAnywhere(false); setDragOver(false); depth.current = 0; };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  // Drop-zone handlers for the terminal.
  const zone = {
    onDragEnter: (e: React.DragEvent) => { if (hasFiles(e)) { depth.current++; setDragOver(true); } },
    onDragLeave: (e: React.DragEvent) => { if (hasFiles(e) && --depth.current <= 0) { depth.current = 0; setDragOver(false); } },
    onDragOver: (e: React.DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
    },
  };

  return { files, upload, remove, dragOver, dragAnywhere, zone };
}

/** The DROP control, styled as a terminal tab, opening the native file picker. */
export const DropTab: React.FC<{ armed: boolean; busy: boolean; onFiles: (f: FileList) => void; onOpen?: () => void }> = ({ armed, busy, onFiles, onOpen }) => {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => { onOpen?.(); input.current?.click(); }}
        className={`jv-terminal-tab jv-drop-tab flex items-center gap-1 cursor-pointer ${armed ? 'armed' : ''}`}
        title="Give J.A.R.V.I.S. files: click to choose, or drag them onto the terminal"
      >
        {busy ? <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" /> : <ArrowDownToLine className="w-3 h-3 text-cyan-400" />}
        <span>DROP</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = ''; // the same file can be chosen again
        }}
      />
    </>
  );
};

export const DropOverlay: React.FC = () => (
  <div className="jv-drop-overlay">
    <ArrowDownToLine className="w-5 h-5 text-cyan-300 mb-1 drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
    <span className="relative text-[12px] font-bold tracking-[0.2em] text-cyan-200">DROP FILE FOR JARVIS</span>
    <span className="relative text-[9.5px] tracking-wider text-cyan-400/70">Release to upload &amp; analyze // multiple files ok</span>
  </div>
);

const statusStyle: Record<DropStatus, string> = {
  UPLOADING: 'text-cyan-300',
  PROCESSING: 'text-amber-300',
  READY: 'text-emerald-300',
  ERROR: 'text-rose-300',
};

/** Compact FILES list under the terminal header. */
export const FileStrip: React.FC<{ files: DropFile[]; onRemove: (f: DropFile) => void }> = ({ files, onRemove }) => (
  <div className="jv-files shrink-0">
    <div className="text-cyan-500/70 tracking-widest text-[9px] mb-0.5">FILES // {files.filter((f) => f.status === 'READY').length} IN CONTEXT</div>
    {files.map((f) => (
      <div key={f.key} className="flex items-center gap-1.5 leading-[1.55]" title={f.error || f.summary || ''}>
        {f.status === 'READY' ? <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
          : f.status === 'ERROR' ? <TriangleAlert className="w-2.5 h-2.5 text-rose-400 shrink-0" />
          : <Loader2 className="w-2.5 h-2.5 text-cyan-400 animate-spin shrink-0" />}
        <span className="text-slate-200 truncate min-w-0 flex-1">{f.name}</span>
        <span className="text-slate-500 shrink-0">{f.type}</span>
        <span className={`shrink-0 ${statusStyle[f.status]}`}>
          {f.status === 'UPLOADING' ? `UPLOADING ${Math.round(f.progress * 100)}%` : f.status === 'PROCESSING' ? 'ANALYZING…' : f.status}
        </span>
        <button
          type="button"
          onClick={() => onRemove(f)}
          disabled={f.status === 'UPLOADING' || f.status === 'PROCESSING'}
          className="text-slate-500 hover:text-rose-400 disabled:opacity-30 disabled:cursor-default cursor-pointer shrink-0"
          title="Remove from this session (J.A.R.V.I.S. loses access to it)"
          aria-label={`Remove ${f.name}`}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </div>
    ))}
  </div>
);
