// Draws one frame: the supplied artwork, live HUD values on its own header and
// footer, then characters depth-sorted against art patches that stand in front of them.
import { TownSim, Actor, VisualState } from './behavior';
import { AgentStore } from './agentStore';
import { OCCLUDERS, HUD, Box } from './scene';
import { Frame, SPRITE_CELL, AGENT_SCALE as S } from './sprites';

export const STATE_COLOR: Record<VisualState, string> = {
  IDLE: '#34d399', WALKING: '#22d3ee', WORKING: '#fbbf24', THINKING: '#c084fc', COFFEE_BREAK: '#fb923c',
  CHATTING: '#f0abfc', MEETING: '#38bdf8', WAITING: '#94a3b8', COMPLETED: '#4ade80', ERROR: '#ef4444', OFFLINE: '#64748b',
  HELPING: '#f472b6', SWARMING: '#f97316', PAUSED: '#60a5fa',
};

const HUD_FONT = '"Share Tech Mono", monospace';

export interface RenderAssets { art: HTMLImageElement; atlas: HTMLImageElement; pillBg: string; footerBg: string }

/** Sample the artwork's own background colours for the HUD patches. */
export function sampleHudColors(art: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = art.naturalWidth;
  c.height = art.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(art, 0, 0);
  const at = (x: number, y: number) => { const d = ctx.getImageData(x, y, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
  return { pillBg: at(HUD.units.cover[0] + 2, HUD.units.cover[1] + 2), footerBg: at(HUD.grid.cover[0] + 1, HUD.grid.cover[1] + 1) };
}

function pickFrame(a: Actor, now: number): { f: Frame; flip: boolean; bob: number } {
  const an = a.sprites.anims;
  const cycle = (frames: Frame[], ms: number) => frames[Math.floor(now / ms) % Math.max(1, frames.length)] ?? an.idle[0];
  const sideways = a.facing !== 'down';
  switch (a.state) {
    case 'WALKING':
      return a.facing === 'down' ? { f: cycle(an.walkDown, 95), flip: false, bob: 0 } : { f: cycle(an.walkSide, 95), flip: a.facing === 'left', bob: 0 };
    case 'WORKING':
      return { f: cycle(an.work.length ? an.work : an.idle, 380), flip: false, bob: 0 };
    case 'SWARMING': // working at the shared table, turning to teammates now and then
      if (Math.floor(now / 1800) % 3 === 0 && an.gesture.length) return { f: cycle(an.gesture, 300), flip: false, bob: 0 };
      return sideways ? { f: an.walkSide[0] ?? an.idle[0], flip: a.facing === 'left', bob: Math.floor(now / 380) % 2 } : { f: cycle(an.work.length ? an.work : an.idle, 380), flip: false, bob: 0 };
    case 'PAUSED':
      return { f: an.idle[0], flip: false, bob: 0 };
    case 'HELPING':
    case 'CHATTING':
      // Face the partner; gesture every few beats.
      if (Math.floor(now / 900) % 3 === 0 && an.gesture.length) return { f: cycle(an.gesture, 300), flip: false, bob: 0 };
      return { f: an.walkSide[0] ?? an.idle[0], flip: a.facing === 'left', bob: Math.floor(now / 450) % 2 };
    case 'MEETING':
      if (Math.floor(now / 2200) % 3 === 0 && an.gesture.length) return { f: cycle(an.gesture, 320), flip: false, bob: 0 };
      return sideways ? { f: an.walkSide[0] ?? an.idle[0], flip: a.facing === 'left', bob: 0 } : { f: cycle(an.idle, 420), flip: false, bob: 0 };
    case 'COMPLETED':
      return { f: cycle(an.gesture.length ? an.gesture : an.idle, 260), flip: false, bob: 0 };
    case 'OFFLINE':
      return { f: an.idle[0], flip: false, bob: 0 };
    default:
      return sideways ? { f: an.walkSide[0] ?? an.idle[0], flip: a.facing === 'left', bob: Math.floor(now / 700) % 2 } : { f: cycle(an.idle, 420), flip: false, bob: 0 };
  }
}

function indicator(ctx: CanvasRenderingContext2D, a: Actor, x: number, y: number, k: number, now: number) {
  const s = a.state;
  if (s === 'IDLE' || s === 'WALKING') return;
  const w = 20 * k;
  const h = 14 * k;
  const bx = x - w / 2;
  const by = y - h;
  const col = STATE_COLOR[s];
  ctx.fillStyle = 'rgba(3, 8, 18, 0.92)';
  ctx.fillRect(bx, by, w, h);
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, k);
  ctx.strokeRect(bx, by, w, h);
  ctx.fillStyle = col;
  const cx = x;
  const cy = by + h / 2;
  const u = 2 * k; // "pixel" unit
  const t = now / 1000;
  switch (s) {
    case 'WORKING':
    case 'CHATTING': {
      const lit = Math.floor(t * 4) % 4;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i < lit ? 1 : 0.3;
        ctx.fillRect(cx - 4 * u + i * 3 * u, cy - u / 2, 2 * u, u);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'THINKING':
    case 'ERROR':
    case 'HELPING':
      ctx.font = `700 ${11 * k}px ${HUD_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s === 'ERROR' ? '!' : s === 'HELPING' ? '?!' : '?', cx, cy + 0.5);
      break;
    case 'SWARMING': { // three linked nodes = pooled work
      const pulse = Math.floor(t * 3) % 3;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i === pulse ? 1 : 0.45;
        ctx.fillRect(cx - 4 * u + i * 3 * u, cy - u, 2 * u, 2 * u);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'PAUSED': // pause bars
      ctx.fillRect(cx - 2 * u, cy - 2 * u, 1.3 * u, 4 * u);
      ctx.fillRect(cx + 0.7 * u, cy - 2 * u, 1.3 * u, 4 * u);
      break;
    case 'WAITING': // hourglass
      ctx.fillRect(cx - 2 * u, cy - 2.5 * u, 4 * u, u / 2);
      ctx.fillRect(cx - 2 * u, cy + 2 * u, 4 * u, u / 2);
      ctx.beginPath(); ctx.moveTo(cx - 1.5 * u, cy - 2 * u); ctx.lineTo(cx + 1.5 * u, cy - 2 * u); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 1.5 * u, cy + 2 * u); ctx.lineTo(cx - 1.5 * u, cy + 2 * u); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 'COFFEE_BREAK': // cup with steam
      ctx.fillRect(cx - 2 * u, cy - u / 2, 3 * u, 2.5 * u);
      ctx.fillRect(cx + u, cy, u, u);
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 4);
      ctx.fillRect(cx - 1.5 * u + (Math.floor(t * 3) % 2) * (u / 2), cy - 2 * u, u / 2, u);
      ctx.fillRect(cx - (Math.floor(t * 3 + 1) % 2) * (u / 2), cy - 2.3 * u, u / 2, u);
      ctx.globalAlpha = 1;
      break;
    case 'MEETING':
      ctx.beginPath(); ctx.moveTo(cx, cy - 2 * u); ctx.lineTo(cx + 2 * u, cy); ctx.lineTo(cx, cy + 2 * u); ctx.lineTo(cx - 2 * u, cy); ctx.closePath(); ctx.fill();
      break;
    case 'COMPLETED':
      ctx.lineWidth = u * 0.8;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(cx - 2 * u, cy); ctx.lineTo(cx - 0.5 * u, cy + 1.5 * u); ctx.lineTo(cx + 2 * u, cy - 1.5 * u); ctx.stroke();
      break;
    case 'OFFLINE':
      ctx.font = `700 ${9 * k}px ${HUD_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('zz', cx, cy + 0.5);
      break;
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontPx: number, color: string, highlight: boolean) {
  ctx.font = `700 ${fontPx}px ${HUD_FONT}`;
  const pad = fontPx * 0.45;
  const dot = fontPx * 0.5;
  const w = ctx.measureText(text).width + pad * 3 + dot;
  const h = fontPx * 1.35;
  const lx = x - w / 2;
  ctx.fillStyle = highlight ? 'rgba(8, 47, 73, 0.95)' : 'rgba(3, 8, 18, 0.82)';
  ctx.fillRect(lx, y, w, h);
  ctx.strokeStyle = highlight ? '#67e8f9' : 'rgba(34, 211, 238, 0.35)';
  ctx.lineWidth = Math.max(1, fontPx / 10);
  ctx.strokeRect(lx, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(lx + pad, y + (h - dot) / 2, dot, dot);
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + pad * 2 + dot, y + h / 2 + fontPx * 0.05);
}

function cover(ctx: CanvasRenderingContext2D, [x0, y0, x1, y1]: Box, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

export function renderTown(
  ctx: CanvasRenderingContext2D,
  assets: RenderAssets,
  sim: TownSim,
  store: AgentStore,
  now: number,
  scale: number, // artwork px → CSS px
  hoverId: string | null,
) {
  const { art, atlas } = assets;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(art, 0, 0);

  // Live HUD values drawn into the artwork's own header/footer slots.
  const actors = [...sim.actors.values()];
  const total = actors.length || store.agents.size;
  if (total) {
    cover(ctx, HUD.units.cover, assets.pillBg);
    ctx.save();
    ctx.font = `700 25px ${HUD_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8ff5ff';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 8;
    ctx.fillText(`${total} UNITS`, HUD.units.center.x, HUD.units.center.y);
    ctx.restore();
  }
  if (store.loaded && !store.online) {
    cover(ctx, HUD.grid.cover, assets.footerBg);
    cover(ctx, HUD.grid.dot, '#ef4444');
    ctx.font = `700 26px ${HUD_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f87171';
    ctx.fillText('GRID OFFLINE', HUD.grid.textX, HUD.grid.y);
  }
  if (store.online) {
    const busy = [...store.agents.values()].filter(l => l.demand).length;
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(HUD.busy.x, HUD.busy.y - 8, 16, 16);
    ctx.font = `700 26px ${HUD_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fcd34d';
    ctx.fillText(`${busy}/${total} BUSY`, HUD.busy.x + 30, HUD.busy.y);
  }

  // Painter's order: characters and foreground art patches by their floor line.
  type Item = { y: number; draw: () => void };
  const items: Item[] = OCCLUDERS.map(o => ({
    y: o.base,
    draw: () => {
      const [x0, y0, x1, y1] = o.box;
      ctx.drawImage(art, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    },
  }));
  const k = Math.min(2.2, Math.max(1, 0.8 / scale));
  const labelPx = Math.max(12, 8.5 / scale);
  const overlays: (() => void)[] = [];
  for (const a of actors) {
    items.push({
      y: a.y,
      draw: () => {
        const x = Math.round(a.x);
        const y = Math.round(a.y);
        const hovered = a.id === hoverId;
        ctx.fillStyle = hovered ? 'rgba(34, 211, 238, 0.45)' : 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.ellipse(x, y - 1, (hovered ? 15 : 11) * S, (hovered ? 5 : 4) * S, 0, 0, Math.PI * 2);
        ctx.fill();
        const { f, flip, bob } = pickFrame(a, now);
        // Scale about the feet: the sheet's bottom pixel row stays on the floor line.
        const cw = SPRITE_CELL.w * S;
        const ch = SPRITE_CELL.h * S;
        const top = y + 1 - ch + S - bob * S;
        ctx.save();
        if (a.state === 'OFFLINE') ctx.filter = 'grayscale(1) brightness(0.6)';
        if (flip) {
          ctx.translate(x, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(atlas, f.sx, f.sy, f.w, f.h, -cw / 2, top, cw, ch);
        } else {
          ctx.drawImage(atlas, f.sx, f.sy, f.w, f.h, x - cw / 2, top, cw, ch);
        }
        ctx.restore();
        // Labels and bubbles sit above the scenery, so queue them for the end.
        overlays.push(() => {
          indicator(ctx, a, x, y - 50 * S, k, now);
          label(ctx, store.agents.get(a.id)?.agent.name ?? a.id, x, y + 4, labelPx, STATE_COLOR[a.state], hovered);
        });
      },
    });
  }
  items.sort((p, q) => p.y - q.y).forEach(i => i.draw());
  overlays.forEach(o => o());
}

/** Topmost actor under an artwork-space point. */
export function actorAt(sim: TownSim, x: number, y: number) {
  let hit: Actor | null = null;
  for (const a of sim.actors.values()) {
    if (x >= a.x - 14 * S && x <= a.x + 14 * S && y >= a.y - 48 * S && y <= a.y + 8 && (!hit || a.y > hit.y)) hit = a;
  }
  return hit;
}
