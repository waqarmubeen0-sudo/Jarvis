import React, { useEffect, useRef, useState } from 'react';
import { Gamepad2, ChevronLeft, ChevronRight, Brain, Grid3x3, CircleHelp, Trophy, ArrowLeft, RotateCcw, Loader2, Play, Sparkles, TriangleAlert } from 'lucide-react';
import { bestMove, memoryDeck, winner, Cell } from './arcade/logic';

// JARVIS Arcade: Memory Match, Tic-Tac-Toe vs JARVIS (minimax) and Trivia (Gemini questions,
// offline set as fallback), plus every game the team built on request ("create a Snake game"),
// listed from /api/games and played in a sandboxed iframe. Best scores are kept in this browser.

/** A game the team built (see gameBuilder.ts on the server). */
export interface BuiltGameRecord { id: string; title: string; prompt: string; agent: string; source: 'generated' | 'library'; createdAt: string; note?: string }

type Game = 'MEMORY' | 'TTT' | 'TRIVIA';
const GAMES: { id: Game; name: string; icon: typeof Brain; desc: string; best: (v: number) => string }[] = [
  { id: 'MEMORY', name: 'Memory', icon: Brain, desc: 'Match all 8 pairs in as few moves as you can.', best: (v) => `BEST: ${v} MOVES` },
  { id: 'TTT', name: 'Tic-Tac-Toe', icon: Grid3x3, desc: 'Challenge JARVIS. On IMPOSSIBLE he never loses.', best: (v) => `WINS VS JARVIS: ${v}` },
  { id: 'TRIVIA', name: 'Trivia', icon: CircleHelp, desc: 'Five questions from JARVIS. How many can you get?', best: (v) => `HIGH SCORE: ${v}/5` },
];

const TILE_COLOR: Record<Game, string> = { MEMORY: 'text-[#d946ef]', TTT: 'text-[var(--dc)]', TRIVIA: 'text-[#ec4899]' };

const load = (k: string) => { try { return Number(localStorage.getItem(`jv-arcade-${k}`)) || 0; } catch { return 0; } };
const save = (k: string, v: number) => { try { localStorage.setItem(`jv-arcade-${k}`, String(v)); } catch {} };

export const JarvisArcade: React.FC<{ initialGame?: string | null }> = ({ initialGame }) => {
  const [sel, setSel] = useState(1);
  const [playing, setPlaying] = useState<Game | null>(null);
  const [built, setBuilt] = useState<BuiltGameRecord[] | null>(null);
  const [playingBuilt, setPlayingBuilt] = useState<BuiltGameRecord | null>(null);
  const [builtError, setBuiltError] = useState<string | null>(null);
  const launched = useRef(false);

  // Games the team built; refreshed whenever a new one is finished.
  useEffect(() => {
    const load = () => fetch('/api/games')
      .then((r) => { if (!(r.headers.get('content-type') ?? '').includes('json')) throw new Error('old server'); return r.json(); })
      .then((d) => { setBuilt(d.games ?? []); setBuiltError(null); })
      .catch((e) => setBuiltError(e.message === 'old server' ? 'Restart the JARVIS server to load built games.' : 'Could not load built games.'));
    load();
    window.addEventListener('jarvis:games-changed', load);
    return () => window.removeEventListener('jarvis:games-changed', load);
  }, []);
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (launched.current || !initialGame || !built) return;
    launched.current = true;
    const g = built.find((x) => x.id === initialGame);
    if (g) { setPlaying(null); setPlayingBuilt(g); } else setMissing(`That game (${initialGame}) isn't in the Arcade any more.`);
  }, [initialGame, built]);
  // A launch was requested but the game list hasn't arrived yet: show that, not the menu.
  const launching = !!initialGame && !launched.current && !builtError;
  const [best, setBest] = useState<Record<Game, number>>({ MEMORY: load('MEMORY'), TTT: load('TTT'), TRIVIA: load('TRIVIA') });
  const record = (g: Game, v: number, lowerIsBetter = false) => {
    setBest((b) => {
      const better = lowerIsBetter ? !b[g] || v < b[g] : v > b[g];
      if (!better) return b;
      save(g, v);
      return { ...b, [g]: v };
    });
  };
  const game = GAMES[sel];

  const n = GAMES.length;
  const tiles = [(sel + n - 1) % n, sel, (sel + 1) % n]; // selected game sits in the centre

  return (
    <div className="jv-hud">
      <div className="jv-hud-head">
        <div className="jv-hud-title">
          {playing || playingBuilt ? <button className="jv-icon-btn w-4 h-4 !text-[var(--dc)]" onClick={() => { setPlaying(null); setPlayingBuilt(null); }} aria-label="Back to the arcade" title="Back to the arcade"><ArrowLeft className="w-4 h-4" /></button> : <Gamepad2 className="w-4 h-4" />}
          <span>{playingBuilt ? playingBuilt.title : playing ? GAMES.find((g) => g.id === playing)!.name : <><span className="jv-t-full">JARVIS Arcade</span><span className="jv-t-short">Arcade</span></>}</span>
        </div>
        <Gamepad2 className="w-4 h-4 text-white shrink-0" aria-hidden="true" />
      </div>
      <div className="jv-hud-body flex flex-col gap-2.5">
        {playing === 'MEMORY' && <MemoryGame onWin={(moves) => record('MEMORY', moves, true)} />}
        {playing === 'TTT' && <TicTacToe onWin={() => record('TTT', best.TTT + 1)} />}
        {playing === 'TRIVIA' && <Trivia onDone={(score) => record('TRIVIA', score)} />}
        {playingBuilt && <BuiltGame game={playingBuilt} />}
        {launching && <div className="flex items-center gap-2 text-[11px] text-[var(--dgray-l)]"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading the game…</div>}
        {missing && !playingBuilt && <div role="alert" className="text-[10.5px] text-rose-300">{missing}</div>}
        {!playing && !playingBuilt && !launching && (
          <>
            {/* Game carousel */}
            <div className="flex items-center justify-between gap-1 shrink-0">
              <button className="jv-icon-btn w-5 h-7 !text-[var(--dc)]" onClick={() => setSel((s) => (s + n - 1) % n)} aria-label="Previous game"><ChevronLeft className="w-4 h-4" /></button>
              <div className="flex items-center justify-center gap-2 flex-1 min-w-0">
                {tiles.map((gi) => {
                  const g = GAMES[gi];
                  const on = gi === sel;
                  return (
                    <button key={g.id} onClick={() => setSel(gi)} className={`jv-game-tile ${on ? 'sel' : ''}`} aria-pressed={on} title={g.name}>
                      <g.icon className={on ? 'w-6 h-6 text-white drop-shadow-[0_0_5px_white]' : `w-5 h-5 ${TILE_COLOR[g.id]}`} />
                      <span>{g.name}</span>
                    </button>
                  );
                })}
              </div>
              <button className="jv-icon-btn w-5 h-7 !text-[var(--dc)]" onClick={() => setSel((s) => (s + 1) % n)} aria-label="Next game"><ChevronRight className="w-4 h-4" /></button>
            </div>

            <div className="flex flex-col px-1 flex-1">
              <span className="text-white font-bold text-[13px] tracking-wide">{game.name}</span>
              <span className="text-[var(--dgray-l)] text-[11.5px] leading-snug mt-1">{game.desc}</span>
            </div>

            <div className="flex flex-col gap-2 shrink-0">
              <button className="jv-start-btn" onClick={() => setPlaying(game.id)}>START GAME</button>
              <span className="jv-score-pill jv-glow-y">
                <Trophy className="w-3 h-3 drop-shadow-[0_0_5px_var(--dy)]" />
                <span className="truncate">{best[game.id] ? game.best(best[game.id]) : 'NO SCORE YET'}</span>
              </span>
            </div>

            {/* Games the team built on request */}
            <div className="flex flex-col gap-1.5 shrink-0 border-t border-[var(--dc)]/20 pt-2">
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.14em] jv-glow-c"><Sparkles className="w-3.5 h-3.5" />BUILT BY JARVIS</span>
              {builtError && <span className="text-[10.5px] text-rose-300">{builtError}</span>}
              {built?.length === 0 && <span className="text-[10.5px] text-[var(--dgray-l)] leading-snug">Ask JARVIS to make one, e.g. "Create a Snake game".</span>}
              {built?.map((g) => (
                <button key={g.id} onClick={() => setPlayingBuilt(g)} className="jv-btn !justify-between !normal-case !tracking-normal !text-left !py-1.5" title={g.prompt}>
                  <span className="min-w-0 truncate"><b className="text-[var(--dc)]">{g.title}</b> <span className="text-[var(--dgray)]">· {g.source === 'library' ? 'offline library' : g.agent}</span></span>
                  <Play className="w-3.5 h-3.5 shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** Plays a built game in a sandboxed iframe (scripts only: no network, no access to JARVIS). */
function BuiltGame({ game }: { game: BuiltGameRecord }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [run, setRun] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return;
      if (e.data.jarvisGame === 'error') setError(String(e.data.message ?? 'Unknown error'));
      if (e.data.jarvisGame === 'ready') { setReady(true); frame.current?.focus(); }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const reload = () => { setError(null); setReady(false); setRun((r) => r + 1); };
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--dgray-l)] shrink-0">
        <span className="truncate">{game.source === 'library' ? 'JARVIS offline game library' : `Built by ${game.agent}`} · {new Date(game.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}{ready ? '' : ' · loading…'}</span>
        <button className="jv-btn !py-0.5" onClick={reload} title="Reload the game from the start"><RotateCcw className="w-3 h-3" />RELOAD</button>
      </div>
      {error && <div role="alert" className="text-[10.5px] text-rose-200 bg-rose-950/40 border border-rose-500/40 rounded px-2 py-1 flex items-start gap-1.5 shrink-0"><TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />Game error: {error}</div>}
      <iframe
        key={run}
        ref={frame}
        src={`/games/${encodeURIComponent(game.id)}`}
        title={game.title}
        sandbox="allow-scripts"
        className="w-full flex-1 min-h-[300px] rounded border border-[var(--dc)]/30 bg-black"
        onLoad={() => frame.current?.focus()}
      />
      <span className="text-[10px] text-[var(--dgray)] shrink-0">Click the game first, then use the keyboard.</span>
    </div>
  );
}

function MemoryGame({ onWin }: { onWin: (moves: number) => void }) {
  const [deck, setDeck] = useState(() => memoryDeck());
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);
  // Refs mirror the state so fast clicks never act on a stale board.
  const g = useRef({ open: [] as number[], matched: new Set<number>(), moves: 0 });
  const won = matched.size === deck.length;
  const flip = (i: number) => {
    const s = g.current;
    if (s.open.length === 2 || s.open.includes(i) || s.matched.has(i)) return;
    s.open = [...s.open, i];
    setOpen(s.open);
    if (s.open.length < 2) return;
    s.moves += 1;
    setMoves(s.moves);
    const [a, b] = s.open;
    if (deck[a] === deck[b]) {
      s.matched = new Set(s.matched).add(a).add(b);
      s.open = [];
      setMatched(s.matched);
      setOpen([]);
      if (s.matched.size === deck.length) onWin(s.moves);
    } else {
      setTimeout(() => { s.open = []; setOpen([]); }, 700);
    }
  };
  const reset = () => { g.current = { open: [], matched: new Set(), moves: 0 }; setDeck(memoryDeck()); setOpen([]); setMatched(new Set()); setMoves(0); };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[9px] text-cyan-200"><span>MOVES: {moves}</span><span>{matched.size / 2}/8 PAIRS</span></div>
      <div className="grid grid-cols-4 gap-1">
        {deck.map((s, i) => {
          const up = open.includes(i) || matched.has(i);
          return (
            <button key={i} onClick={() => flip(i)} className={`aspect-square rounded border text-[15px] grid place-items-center transition-all ${matched.has(i) ? 'border-emerald-400/60 text-emerald-300 bg-emerald-500/10' : up ? 'border-cyan-300/80 text-cyan-100 bg-cyan-500/15 shadow-[0_0_8px_rgba(34,211,238,0.4)]' : 'border-cyan-500/25 bg-[#06121c] hover:border-cyan-400/60'}`} aria-label={up ? s : 'Hidden card'}>
              {up ? s : ''}
            </button>
          );
        })}
      </div>
      {won && <div className="text-[10px] text-emerald-300 text-center">Cleared in {moves} moves. Impressive.</div>}
      <button className="jv-btn" onClick={reset}><RotateCcw className="w-3 h-3" />NEW GAME</button>
    </div>
  );
}

function TicTacToe({ onWin }: { onWin: () => void }) {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [hard, setHard] = useState(true);
  const [thinking, setThinking] = useState(false);
  const result = winner(board);
  const play = (i: number) => {
    if (board[i] || result || thinking) return;
    const b = [...board];
    b[i] = 'X';
    setBoard(b);
    const w = winner(b);
    if (w) { if (w.who === 'X') onWin(); return; }
    setThinking(true);
    setTimeout(() => {
      const free = b.map((c, k) => (c ? -1 : k)).filter((k) => k >= 0);
      const move = !hard && Math.random() < 0.35 ? free[Math.floor(Math.random() * free.length)] : bestMove(b, 'O');
      const nb = [...b];
      nb[move] = 'O';
      setBoard(nb);
      setThinking(false);
    }, 350);
  };
  const msg = result ? (result.who === 'DRAW' ? "A draw. I'll take it." : result.who === 'X' ? 'You win this one.' : 'JARVIS wins. Again?') : thinking ? 'JARVIS is thinking…' : 'Your move (X).';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        <button className={`jv-btn flex-1 !py-0.5 ${!hard ? 'on' : ''}`} onClick={() => setHard(false)}>NORMAL</button>
        <button className={`jv-btn flex-1 !py-0.5 ${hard ? 'on' : ''}`} onClick={() => setHard(true)}>IMPOSSIBLE</button>
      </div>
      <div className="grid grid-cols-3 gap-1 mx-auto w-full max-w-[150px]">
        {board.map((c, i) => (
          <button key={i} onClick={() => play(i)} className={`aspect-square rounded border text-[18px] font-bold grid place-items-center ${result?.line?.includes(i) ? 'border-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.5)]' : 'border-cyan-500/35 hover:border-cyan-300/70'} bg-[#06121c] ${c === 'X' ? 'text-cyan-200' : 'text-violet-300'}`} aria-label={`Cell ${i + 1}${c ? `: ${c}` : ''}`}>
            {c}
          </button>
        ))}
      </div>
      <div className={`text-[9.5px] text-center ${result?.who === 'X' ? 'text-emerald-300' : result?.who === 'O' ? 'text-violet-300' : 'text-cyan-200'}`}>{msg}</div>
      <button className="jv-btn" onClick={() => setBoard(Array(9).fill(null))}><RotateCcw className="w-3 h-3" />NEW GAME</button>
    </div>
  );
}

function Trivia({ onDone }: { onDone: (score: number) => void }) {
  const [qs, setQs] = useState<{ question: string; options: string[]; answer: number; fact?: string }[] | null>(null);
  const [source, setSource] = useState('');
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setQs(null); setI(0); setPicked(null); setScore(0); setError(null);
    fetch('/api/arcade/trivia').then((r) => r.json()).then((d) => { setQs(d.questions); setSource(d.source); }).catch(() => setError("Couldn't load questions."));
  };
  useEffect(start, []);
  if (error) return <div className="text-[9.5px] text-rose-300">{error} <button className="jv-btn ml-1" onClick={start}>RETRY</button></div>;
  if (!qs) return <div className="text-[9.5px] text-slate-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />JARVIS is writing questions…</div>;
  if (i >= qs.length) {
    return (
      <div className="flex flex-col gap-1.5 items-center text-center">
        <Trophy className="w-6 h-6 text-amber-300" />
        <div className="text-[11px] text-cyan-50 font-bold">{score}/{qs.length}</div>
        <div className="text-[9.5px] text-slate-300">{score === qs.length ? 'Flawless.' : score >= 3 ? 'Solid work.' : 'We will call that practice.'}</div>
        <button className="jv-btn w-full" onClick={start}><RotateCcw className="w-3 h-3" />PLAY AGAIN</button>
      </div>
    );
  }
  const q = qs[i];
  const choose = (k: number) => {
    if (picked !== null) return;
    setPicked(k);
    const s = score + (k === q.answer ? 1 : 0);
    setScore(s);
    if (i === qs.length - 1) onDone(s);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[8.5px] text-cyan-300"><span>Q{i + 1}/{qs.length}</span><span>SCORE {score}{source === 'offline' ? ' // STASH' : ''}</span></div>
      <div className="text-[10px] text-cyan-50 leading-snug">{q.question}</div>
      {q.options.map((o, k) => (
        <button key={k} onClick={() => choose(k)} disabled={picked !== null} className={`jv-btn !justify-start !text-left !font-normal !tracking-normal !text-[9.5px] ${picked === null ? '' : k === q.answer ? '!border-emerald-400 !text-emerald-200 !bg-emerald-500/15' : k === picked ? '!border-rose-400 !text-rose-200 !bg-rose-500/15' : ''}`}>{o}</button>
      ))}
      {picked !== null && (
        <>
          {q.fact && <div className="text-[8.5px] text-slate-400 leading-snug">{q.fact}</div>}
          <button className="jv-btn on" onClick={() => { setI(i + 1); setPicked(null); }}>{i === qs.length - 1 ? 'SEE SCORE' : 'NEXT'}</button>
        </>
      )}
    </div>
  );
}
