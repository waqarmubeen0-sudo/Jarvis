// Pure game logic for JARVIS Arcade (tested by arcade.check.ts).

export type Cell = 'X' | 'O' | null;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

/** 'X' | 'O' when someone has three in a row, 'DRAW' when the board is full, else null. */
export function winner(b: Cell[]): { who: 'X' | 'O' | 'DRAW'; line?: number[] } | null {
  for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { who: b[l[0]]!, line: l };
  return b.every(Boolean) ? { who: 'DRAW' } : null;
}

/** JARVIS's move (plays `me`) by minimax: it never loses. Prefers faster wins. */
export function bestMove(b: Cell[], me: 'X' | 'O' = 'O'): number {
  const them = me === 'X' ? 'O' : 'X';
  const score = (board: Cell[], turn: 'X' | 'O', depth: number): number => {
    const w = winner(board);
    if (w) return w.who === me ? 10 - depth : w.who === them ? depth - 10 : 0;
    let best = turn === me ? -Infinity : Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i]) continue;
      board[i] = turn;
      const s = score(board, turn === me ? them : me, depth + 1);
      board[i] = null;
      best = turn === me ? Math.max(best, s) : Math.min(best, s);
    }
    return best;
  };
  let move = -1;
  let best = -Infinity;
  const board = [...b];
  for (const i of [4, 0, 2, 6, 8, 1, 3, 5, 7]) {
    if (board[i]) continue;
    board[i] = me;
    const s = score(board, them, 1);
    board[i] = null;
    if (s > best) { best = s; move = i; }
  }
  return move;
}

export const MEMORY_SYMBOLS = ['⚛', '☢', '⚡', '♞', '☀', '❄', '♫', '✦'];

/** A shuffled deck of pairs for Memory Match. */
export function memoryDeck(pairs = 8, rand = Math.random): string[] {
  const deck = [...MEMORY_SYMBOLS.slice(0, pairs), ...MEMORY_SYMBOLS.slice(0, pairs)];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
