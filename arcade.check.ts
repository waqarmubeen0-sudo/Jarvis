// Self-check for the Arcade logic and the fun.ts helpers: npx tsx arcade.check.ts
import assert from 'assert';
import { bestMove, memoryDeck, winner, Cell } from './src/arcade/logic';
import { humor, trivia, youtubeIds } from './fun';
import { useEncryptedStore } from './credentials';

(async () => {
  assert.equal(winner(['X', 'X', 'X', null, 'O', 'O', null, null, null])?.who, 'X');
  assert.equal(winner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'])?.who, 'DRAW');
  assert.equal(winner(Array(9).fill(null)), null);

  // JARVIS takes a win, blocks a loss.
  assert.equal(bestMove(['O', 'O', null, 'X', 'X', null, null, null, null], 'O'), 2);
  assert.equal(bestMove(['X', 'X', null, null, 'O', null, null, null, null], 'O'), 2);

  // Exhaustive: whatever X plays, JARVIS (O) never loses.
  let games = 0;
  const play = (b: Cell[]) => {
    const w = winner(b);
    if (w) { assert.notEqual(w.who, 'X', `JARVIS lost: ${b.map((c) => c ?? '.').join('')}`); games++; return; }
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      const nb = [...b]; nb[i] = 'X';
      if (winner(nb)) { play(nb); continue; }
      nb[bestMove(nb, 'O')] = 'O';
      play(nb);
    }
  };
  play(Array(9).fill(null));
  assert.ok(games > 100);

  const deck = memoryDeck();
  assert.equal(deck.length, 16);
  assert.ok(deck.every((s) => deck.filter((x) => x === s).length === 2));

  assert.deepEqual(youtubeIds('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3 and https://youtu.be/9bZkp7q19f0 again https://youtu.be/9bZkp7q19f0'), ['dQw4w9WgXcQ', '9bZkp7q19f0']);
  assert.deepEqual(youtubeIds('dQw4w9WgXcQ'), ['dQw4w9WgXcQ']);
  assert.deepEqual(youtubeIds('lofi beats to code to'), []);

  // No AI key at all (an empty credential store, never the real one): offline stash, clearly labelled.
  useEncryptedStore('no-such-credentials.bin', { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '{}' });
  const h = await humor('dad joke');
  assert.equal(h.source, 'offline');
  assert.equal(h.kind, 'DAD JOKE');
  const t = await trivia();
  assert.equal(t.source, 'offline');
  assert.equal(t.questions.length, 5);
  assert.ok(t.questions.every((q) => q.options.length === 4 && q.answer >= 0 && q.answer < 4));

  console.log(`arcade: all checks passed (${games} tic-tac-toe games, JARVIS never lost)`);
})().catch((e) => { console.error(e); process.exit(1); });
