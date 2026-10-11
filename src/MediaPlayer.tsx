import React, { useEffect, useRef, useState } from 'react';
import { Music, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, FolderOpen, Search, Loader2, X, Disc3, ListMusic } from 'lucide-react';

// Media Player: LOCAL plays audio files the user picks or drops (they stay in the browser, never
// uploaded); YT searches YouTube (via the server, Gemini-grounded) or takes a pasted link and
// plays it embedded.

interface Track { name: string; url: string }
interface Video { id: string; title: string; author: string }
const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|weba)$/i.test(f.name);

export const MediaPlayer: React.FC = () => {
  const [tab, setTab] = useState<'LOCAL' | 'YT'>('LOCAL');

  // ---- local audio ----
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;

  const addFiles = (list: FileList | File[]) => {
    const add = Array.from(list).filter(isAudio).map((f) => ({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
    if (!add.length) { setAudioError('Those are not audio files.'); return; }
    setAudioError(null);
    setTracks((t) => { if (!t.length) setIndex(0); return [...t, ...add]; });
  };
  // Free the in-memory files when the player goes away.
  useEffect(() => () => tracksRef.current.forEach((t) => URL.revokeObjectURL(t.url)), []);

  const current = tracks[index];
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !current) return;
    a.src = current.url;
    setTime(0);
    if (playing) a.play().catch(() => setPlaying(false));
  }, [current?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (audioRef.current) { audioRef.current.volume = volume; audioRef.current.muted = muted; } }, [volume, muted]);

  // Spectrum: an analyser on the <audio> element, created on first play (needs a user gesture).
  const ensureAnalyser = () => {
    if (analyserRef.current || !audioRef.current) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(audioRef.current);
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      src.connect(an);
      an.connect(ctx.destination);
      analyserRef.current = an;
    } catch {}
  };
  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(32);
    const draw = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const w = (c.width = c.clientWidth * 2), h = (c.height = c.clientHeight * 2);
        ctx.clearRect(0, 0, w, h);
        const an = analyserRef.current;
        if (an && playing) an.getByteFrequencyData(data); else data.fill(0);
        const n = 28, bw = w / n;
        for (let i = 0; i < n; i++) {
          const v = playing ? data[i] / 255 : 0.04 + 0.03 * Math.sin(Date.now() / 600 + i);
          const bh = Math.max(2, v * h);
          ctx.fillStyle = `rgba(0,229,255,${0.4 + v * 0.6})`;
          ctx.fillRect(i * bw + bw * 0.2, h - bh, bw * 0.6, bh);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, tab]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !current) { fileRef.current?.click(); return; }
    ensureAnalyser();
    if (a.paused) { setVideo(null); a.play().then(() => setPlaying(true)).catch((e) => setAudioError(`Can't play this file: ${e.message}`)); }
    else { a.pause(); setPlaying(false); }
  };
  const step = (dir: 1 | -1) => {
    if (!tracks.length) return;
    const a = audioRef.current;
    if (dir === -1 && a && a.currentTime > 3) { a.currentTime = 0; return; }
    const next = shuffle && tracks.length > 1
      ? (index + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length
      : (index + dir + tracks.length) % tracks.length;
    setIndex(next);
  };
  const ended = () => {
    const a = audioRef.current;
    if (repeat === 'one' && a) { a.currentTime = 0; a.play(); return; }
    if (!shuffle && repeat === 'off' && index === tracks.length - 1) { setPlaying(false); return; }
    step(1);
  };

  // ---- YouTube ----
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Video[]>([]);
  const [searching, setSearching] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setYtError(null);
    try {
      const r = await fetch(`/api/media/youtube?q=${encodeURIComponent(query.trim())}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Search failed');
      setResults(d.videos);
      if (!d.videos.length) setYtError('No playable videos found.');
      else if (d.source === 'link') play(d.videos[0]);
    } catch (err) {
      setYtError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const play = (v: Video) => {
    audioRef.current?.pause();
    setPlaying(false);
    setVideo(v);
  };

  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;

  return (
    <div
      className="jv-hud flex flex-col min-h-0 h-full"
      onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setTab('LOCAL'); addFiles(e.dataTransfer.files); } }}
    >
      <div className="jv-hud-head">
        <div className="jv-hud-title"><Music className="w-4 h-4" /><span><span className="jv-t-full">Media Player</span><span className="jv-t-short">Media</span></span></div>
        <div className="flex gap-1 shrink-0">
          <button className={`jv-src-pill ${tab === 'LOCAL' ? 'on' : ''}`} onClick={() => setTab('LOCAL')} title="Local audio files" aria-pressed={tab === 'LOCAL'}>
            <FolderOpen className="w-3 h-3 text-[var(--dc)]" /><span>Local</span>
          </button>
          <button className={`jv-src-pill ${tab === 'YT' ? 'on' : ''}`} onClick={() => setTab('YT')} title="YouTube" aria-pressed={tab === 'YT'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#ff0000" aria-hidden="true"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" /></svg>
            <span>YouTube</span>
          </button>
        </div>
      </div>

      <audio ref={audioRef} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onEnded={ended} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} onError={() => current && setAudioError(`Can't play "${current.name}"`)} />
      <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />

      {tab === 'LOCAL' ? (
        <div className="jv-hud-body flex flex-col gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="jv-art">
              <Disc3 className={`relative z-10 w-5 h-5 text-white ${playing ? 'animate-spin [animation-duration:2.4s]' : ''}`} />
              <i />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white font-bold text-[13px] tracking-wide truncate" title={current?.name}>{current?.name ?? 'No track loaded'}</div>
              <div className="text-[var(--dgray-l)] text-[11px] tracking-wide truncate mt-0.5">{tracks.length ? `Track ${index + 1} of ${tracks.length}` : 'Pick or drop audio files'}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 min-w-0">
            <input
              type="range"
              className="jv-range flex-1 min-w-0"
              style={{ '--p': `${duration ? (time / duration) * 100 : 0}%` } as React.CSSProperties}
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              disabled={!current}
              onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = +e.target.value; }}
              aria-label="Seek"
            />
            <span className="shrink-0 jv-mono font-bold text-[10px] text-[var(--dgray)]">{fmt(time)} / {fmt(duration)}</span>
          </div>

          <div className="jv-media-ctl flex items-center justify-between px-1">
            <button className={`jv-icon-btn w-6 h-6 ${shuffle ? 'on' : ''}`} onClick={() => setShuffle((s) => !s)} title="Shuffle" aria-pressed={shuffle}><Shuffle className="w-4 h-4" /></button>
            <button className="jv-icon-btn w-6 h-6 !text-white hover:!text-[var(--dc)]" onClick={() => step(-1)} disabled={!tracks.length} title="Previous" aria-label="Previous"><SkipBack className="w-4 h-4" fill="currentColor" /></button>
            <button className="jv-play" onClick={toggle} title={current ? (playing ? 'Pause' : 'Play') : 'Load audio files'} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
            </button>
            <button className="jv-icon-btn w-6 h-6 !text-white hover:!text-[var(--dc)]" onClick={() => step(1)} disabled={!tracks.length} title="Next" aria-label="Next"><SkipForward className="w-4 h-4" fill="currentColor" /></button>
            <button className={`jv-icon-btn w-6 h-6 ${repeat !== 'off' ? 'on' : ''}`} onClick={() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))} title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`}><RepeatIcon className="w-4 h-4" /></button>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <button className="jv-icon-btn w-5 h-5" onClick={() => setMuted((m) => !m)} title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}>{muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
            <input
              type="range"
              className="jv-range w-[28%] min-w-[36px] shrink-0"
              style={{ '--p': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => { setVolume(+e.target.value); setMuted(false); }}
              aria-label="Volume"
            />
            <canvas ref={canvasRef} className="flex-1 min-w-0 h-5" aria-hidden="true" />
            <button className="jv-icon-btn w-5 h-5" onClick={() => fileRef.current?.click()} title="Add audio files" aria-label="Add audio files"><ListMusic className="w-4 h-4" /></button>
          </div>

          {audioError && <div className="text-[9px] text-rose-300">{audioError}</div>}
          {tracks.length > 1 && (
            <div className="flex flex-col min-h-0">
              {tracks.map((t, i) => (
                <button key={t.url} onClick={() => { ensureAnalyser(); setVideo(null); if (i === index) { audioRef.current?.play().catch(() => {}); } else { setIndex(i); setPlaying(true); } }} className={`text-left text-[9px] truncate px-1 py-0.5 rounded ${i === index ? 'text-cyan-200 bg-cyan-500/10' : 'text-slate-400 hover:text-cyan-200'}`}>{i + 1}. {t.name}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="jv-hud-body flex flex-col gap-2">
          <form onSubmit={search} className="flex items-center gap-1.5">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or paste link…" className="flex-1 min-w-0 bg-black/40 border border-[var(--dc)]/30 rounded-md px-2 py-1 text-[11px] jv-mono text-white placeholder:text-[var(--dgray)] outline-none focus:border-[var(--dc)]/80 focus:shadow-[0_0_10px_rgba(0,229,255,0.3)]" />
            <button type="submit" className="jv-btn !p-1" disabled={!query.trim() || searching} title="Search YouTube">{searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}</button>
          </form>
          {video && (
            <div className="relative shrink-0">
              <iframe
                key={video.id}
                className="w-full aspect-video rounded border border-cyan-500/40"
                src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
                title={video.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
              <button className="absolute -top-1.5 -right-1.5 jv-icon-btn w-4 h-4 bg-[#031018] border border-cyan-500/50" onClick={() => setVideo(null)} title="Stop video"><X className="w-2.5 h-2.5" /></button>
              <div className="text-[9px] text-cyan-100 truncate mt-0.5" title={video.title}>{video.title}</div>
            </div>
          )}
          {ytError && <div className="text-[9px] text-rose-300">{ytError}</div>}
          <div className="flex flex-col gap-1 min-h-0">
            {results.filter((v) => v.id !== video?.id).map((v) => (
              <button key={v.id} onClick={() => play(v)} className="text-left jv-card !p-1.5 hover:border-cyan-300/60 min-w-0">
                <div className="text-[9.5px] text-cyan-50 line-clamp-2 leading-tight">{v.title}</div>
                <div className="text-[8.5px] text-slate-500 truncate">{v.author}</div>
              </button>
            ))}
          </div>
          {!video && !results.length && !ytError && <div className="text-[9px] text-slate-500">Search by name, or paste a youtube.com / youtu.be link.</div>}
        </div>
      )}
    </div>
  );
};
