// Character atlas produced from the supplied sprite sheet by extract-sprites.ps1
// (exact pixels, background removed). Each card's frames are grouped by column
// position: front idle/walk, side walk, then work + gesture.
import atlasUrl from '../assets/agent-town/agent-sprites.png';
import atlasMeta from './spriteMeta';

export type AnimName = 'idle' | 'walkDown' | 'walkSide' | 'work' | 'gesture';
export interface Frame { sx: number; sy: number; w: number; h: number }
export interface CharacterSprites { anims: Record<AnimName, Frame[]>; portrait: Frame }

interface MetaFrame { i: number; row: number; x: number }
const meta = atlasMeta as {
  cell: { w: number; h: number };
  portrait: { w: number; h: number; y: number };
  characters: Record<string, { portrait: number; frames: MetaFrame[] }>;
};

const PER_ROW = 24; // must match extract-sprites.ps1

const toFrame = (f: MetaFrame): Frame => ({
  sx: (f.i % PER_ROW) * meta.cell.w,
  sy: Math.floor(f.i / PER_ROW) * meta.cell.h,
  w: meta.cell.w,
  h: meta.cell.h,
});

// Split one row of frames into its three sections at the two widest gaps.
function sections(row: MetaFrame[]) {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const gaps = sorted.slice(1).map((f, i) => ({ i: i + 1, gap: f.x - sorted[i].x }));
  const cuts = gaps.sort((a, b) => b.gap - a.gap).slice(0, 2).map(g => g.i).sort((a, b) => a - b);
  if (cuts.length < 2) return [sorted, sorted, sorted];
  return [sorted.slice(0, cuts[0]), sorted.slice(cuts[0], cuts[1]), sorted.slice(cuts[1])];
}

export const CHARACTER_NAMES = Object.keys(meta.characters);

export function characterSprites(name: string): CharacterSprites {
  const c = meta.characters[name] ?? meta.characters[CHARACTER_NAMES[0]];
  const [f0, s0, w0] = sections(c.frames.filter(f => f.row === 0));
  const [f1, s1, w1] = sections(c.frames.filter(f => f.row === 1));
  return {
    anims: {
      idle: f0.map(toFrame),
      walkDown: (f1.length ? f1 : f0).map(toFrame),
      walkSide: [...s0, ...s1].map(toFrame),
      work: [w0[0], w1[0]].filter(Boolean).map(toFrame),
      gesture: [...w0.slice(1), ...w1.slice(1)].map(toFrame),
    },
    portrait: { sx: c.portrait * meta.portrait.w, sy: meta.portrait.y, w: meta.portrait.w, h: meta.portrait.h },
  };
}

export const SPRITE_CELL = meta.cell;
/** On-screen size of every agent relative to its sheet pixels (1.22 = 22% larger). Applies to all agents, including ones added later. */
export const AGENT_SCALE = 1.22;
export const ATLAS_URL = atlasUrl;
