// Canvas 2D layer drawn above the WebGL core: core frame, the node liquid-energy tubes, the
// metal connector where they meet, the single pipe feeding the core, and heartbeat rings.
// Reads everything from CoreDrive; the shader draws what happens inside the glass.

import { CoreDrive, BURST_ENTRY } from './coreMorph';

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Samples along each node -> junction stream. */
const OUT_N = 48;
/** Share of a node pulse's outer trip spent on its own stream (the rest is the merged pipe). */
const LINK_SHARE = 0.72;

/** A node's stream: smooth curve from its dot to the shared junction. */
export interface Link {
  x: Float32Array;
  y: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  cum: Float32Array;
  total: number;
}

/** What the merged pipe delivers into the orb (read by the shader). */
export interface InnerStreams {
  on: Float32Array; // per node flow strength
  burst: Float32Array; // per node pulse progress inside the orb 0..1, <0 none
  mix: Float32Array; // blended rgb of the merged pipe
}

export interface CoreLayout {
  W: number;
  H: number;
  dpr: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
  cx: number;
  cy: number;
  R: number;
  links: (Link | null)[];
}

/** Connector (where the node tubes meet) and the pipe's entry point on the orb. */
export const junction = (L: Omit<CoreLayout, 'links'>) => {
  const T = tubeW(L);
  return { jx: L.cx - L.R * 1.55, ex: L.cx - L.R * 0.97, y: L.cy, T, cw: T * 2.6 };
};
/** Tube thickness, scaled with the orb. */
const tubeW = (L: Omit<CoreLayout, 'links'>) => Math.max(7, Math.min(13, L.R * 0.075));
/** Inlet height of node i (of n) on the connector's left face. */
const inletY = (L: Omit<CoreLayout, 'links'>, i: number, n: number) => L.cy + (i - (n - 1) / 2) * tubeW(L) * 1.25;

/** Node dot -> its inlet on the connector: leaves and arrives horizontally (smooth S-curve). */
export function buildLink(sx: number, sy: number, i: number, L: Omit<CoreLayout, 'links'>, n = 4): Link {
  const { jx, cw } = junction(L);
  const ex = jx - cw / 2, ey = inletY(L, i, n);
  const gap = Math.max(20, ex - sx);
  const c1x = sx + gap * 0.55, c2x = ex - gap * 0.45;
  const N = OUT_N + 1;
  const x = new Float32Array(N), y = new Float32Array(N);
  const nx = new Float32Array(N), ny = new Float32Array(N), cum = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    const u = j / OUT_N, m = 1 - u;
    const a = m * m * m, b = 3 * m * m * u, c = 3 * m * u * u, e = u * u * u;
    x[j] = a * sx + b * c1x + c * c2x + e * ex;
    y[j] = a * sy + b * sy + c * ey + e * ey;
  }
  for (let j = 0; j < N; j++) {
    const tx = x[Math.min(j + 1, OUT_N)] - x[Math.max(j - 1, 0)];
    const ty = y[Math.min(j + 1, OUT_N)] - y[Math.max(j - 1, 0)];
    const len = Math.hypot(tx, ty) || 1;
    nx[j] = -ty / len;
    ny[j] = tx / len;
    cum[j] = j ? cum[j - 1] + Math.hypot(x[j] - x[j - 1], y[j] - y[j - 1]) : 0;
  }
  return { x, y, nx, ny, cum, total: cum[OUT_N] };
}

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function makeSprite(color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.22, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export class CoreOverlay {
  private white = makeSprite('rgba(235,245,255,1)');
  private sprites: HTMLCanvasElement[];
  private pt = { x: 0, y: 0, nx: 0, ny: 0 };
  readonly inner: InnerStreams = {
    on: new Float32Array(5),
    burst: new Float32Array(5).fill(-1),
    mix: new Float32Array(3),
  };
  private rgb: number[][];
  private waves: { age: number; s: number }[] = [];
  private tube = 10;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private colors: string[],
    private fallback: boolean
  ) {
    this.sprites = colors.map(makeSprite);
    this.rgb = colors.map(hexRgb);
  }

  draw(L: CoreLayout, d: CoreDrive, dt: number, activeIdx: number) {
    const { ctx } = this;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dim = 0.75 + 0.25 * d.online;

    this.frame(L, d, dim);
    if (this.fallback) this.fallbackSphere(L, d);

    this.tube = tubeW(L);
    this.computeInner(L, d, dim, activeIdx);
    L.links.forEach((k, i) => k && this.outerStream(k, i, d, dim, activeIdx === i || (i === 2 && d.proc > 0.1)));
    this.mergedPipe(L, d, dim);

    ctx.globalCompositeOperation = 'lighter';
    this.heartbeat(L, d, dt);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private sprite(img: HTMLCanvasElement, x: number, y: number, w: number, a: number, h = w) {
    if (a <= 0.003 || w <= 0) return;
    this.ctx.globalAlpha = a > 1 ? 1 : a;
    this.ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  }

  /** Point + unit normal at arc-length fraction s along a link. */
  private at(k: Link, s: number) {
    const dist = clamp01(s) * k.total;
    let j = 0;
    while (j < OUT_N - 1 && k.cum[j + 1] < dist) j++;
    const f = clamp01((dist - k.cum[j]) / (k.cum[j + 1] - k.cum[j] || 1));
    this.pt.x = k.x[j] + (k.x[j + 1] - k.x[j]) * f;
    this.pt.y = k.y[j] + (k.y[j + 1] - k.y[j]) * f;
    this.pt.nx = k.nx[j];
    this.pt.ny = k.ny[j];
    return this.pt;
  }

  private chamfer(x: number, y: number, w: number, h: number, c: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y);
    ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h);
    ctx.lineTo(x, y + h - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
  }

  /** Brushed-metal HUD frame (the fill is CSS, under the WebGL sphere). */
  private frame(L: CoreLayout, d: CoreDrive, dim: number) {
    const { ctx } = this;
    const { bx, by, bw, bh } = L;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.chamfer(bx, by, bw, bh, 16);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#586274';
    ctx.stroke();
    this.chamfer(bx + 6, by + 6, bw - 12, bh - 12, 12);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(200,215,235,${(0.1 + d.energy * 0.15) * dim})`;
    ctx.stroke();
    const sheen = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    sheen.addColorStop(0, 'rgba(220,232,250,0)');
    sheen.addColorStop(0.45, `rgba(220,232,250,${0.35 * dim})`);
    sheen.addColorStop(1, 'rgba(220,232,250,0)');
    ctx.strokeStyle = sheen;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 16, by);
    ctx.lineTo(bx + bw - 16, by);
    ctx.stroke();
    ctx.globalAlpha = Math.min(1, (0.45 + d.energy * 0.35 + d.beat * 0.2) * dim);
    ctx.strokeStyle = '#c8d4e6';
    ctx.lineWidth = 2;
    const c = 16, m = 22;
    ctx.beginPath();
    ctx.moveTo(bx, by + c + m); ctx.lineTo(bx, by + c); ctx.lineTo(bx + c, by); ctx.lineTo(bx + c + m, by);
    ctx.moveTo(bx + bw - c - m, by); ctx.lineTo(bx + bw - c, by); ctx.lineTo(bx + bw, by + c); ctx.lineTo(bx + bw, by + c + m);
    ctx.moveTo(bx + bw, by + bh - c - m); ctx.lineTo(bx + bw, by + bh - c); ctx.lineTo(bx + bw - c, by + bh); ctx.lineTo(bx + bw - c - m, by + bh);
    ctx.moveTo(bx + c + m, by + bh); ctx.lineTo(bx + c, by + bh); ctx.lineTo(bx, by + bh - c); ctx.lineTo(bx, by + bh - c - m);
    ctx.stroke();
  }

  private trace(k: Link, off: (s: number) => number) {
    const { ctx } = this;
    ctx.beginPath();
    for (let j = 0; j <= OUT_N; j++) {
      const o = off(j / OUT_N);
      const x = k.x[j] + k.nx[j] * o, y = k.y[j] + k.ny[j] * o;
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
  }

  /** Node -> connector: a glass tube with living liquid energy flowing through it. The liquid
   *  swells and thins in travelling waves, carries bright bubbles and sparks, and pulses. */
  private outerStream(k: Link, i: number, d: CoreDrive, dim: number, act: boolean) {
    const { ctx } = this;
    const t = d.clock, flow = d.neuralT * 2.2 + t * 0.6; // liquid phase: faster with activity
    const color = this.colors[i];
    const TW = this.tube;
    const live = (0.88 + 0.12 * Math.sin(t * 1.3 + i * 1.3)) * dim * (act ? 1.15 : 1);

    // Soft glow, glass walls, dark tube interior.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.globalAlpha = Math.min(1, 0.1 * live + d.energy * 0.06);
    ctx.lineWidth = TW * 2.4;
    this.trace(k, () => 0);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(205,220,240,0.32)';
    ctx.lineWidth = TW + 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(8,11,17,0.85)';
    ctx.lineWidth = TW;
    ctx.stroke();

    // Liquid: short segments whose width and brightness ride travelling waves.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let j = 0; j < OUT_N; j++) {
      const s = (j + 0.5) / OUT_N;
      const wv = 0.5 + 0.5 * Math.sin(s * 22 - flow * 3 + i) ;
      const wv2 = 0.5 + 0.5 * Math.sin(s * 53 - flow * 5.3 + i * 2.1);
      ctx.lineWidth = TW * (0.38 + 0.34 * wv + 0.16 * wv2) * (1 + 0.25 * d.energy);
      ctx.globalAlpha = Math.min(1, (0.45 + 0.35 * wv + 0.2 * wv2) * live);
      ctx.beginPath();
      ctx.moveTo(k.x[j], k.y[j]);
      ctx.lineTo(k.x[j + 1], k.y[j + 1]);
      ctx.stroke();
    }
    // Bright bubbles riding the flow + glass highlight along the top of the tube.
    ctx.strokeStyle = '#fff6e6';
    ctx.lineWidth = Math.max(1.2, TW * 0.22);
    ctx.globalAlpha = 0.55 * live;
    ctx.setLineDash([3, 13]);
    ctx.lineDashOffset = -flow * 26;
    this.trace(k, (s) => Math.sin(s * 30 - flow * 2 + i) * TW * 0.15);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.globalAlpha = dim;
    this.trace(k, () => -TW * 0.32);
    ctx.stroke();

    // A node pulse surges through its tube.
    ctx.globalCompositeOperation = 'lighter';
    const b = d.burst[i] / BURST_ENTRY / LINK_SHARE;
    if (d.burst[i] >= 0 && b < 1) {
      const p = this.at(k, b);
      this.sprite(this.sprites[i], p.x, p.y, TW * 3, 0.9);
      this.sprite(this.white, p.x, p.y, TW, 0.7);
    }
  }

  /** Flow strength, pulse position inside the orb, and the blended pipe colour. */
  private computeInner(L: CoreLayout, d: CoreDrive, dim: number, activeIdx: number) {
    const { on, burst, mix } = this.inner;
    let cmax = 0.001;
    for (let c = 0; c < 5; c++) cmax = Math.max(cmax, d.chan[c]);
    let ws = 0;
    mix.fill(0);
    for (let i = 0; i < 5; i++) {
      on[i] = L.links[i] && i < this.colors.length
        ? Math.min(1.6, (0.45 + 0.35 * (d.chan[i] / cmax) + (activeIdx === i ? 0.45 : 0) + d.energy * 0.5 + (i === 2 ? d.proc * 0.5 : 0)) * dim)
        : 0;
      const b = d.burst[i];
      burst[i] = b >= BURST_ENTRY ? (b - BURST_ENTRY) / (1 - BURST_ENTRY) : -1;
      if (on[i]) for (let c = 0; c < 3; c++) mix[c] += this.rgb[i][c] * on[i];
      ws += on[i];
    }
    for (let c = 0; c < 3; c++) mix[c] /= Math.max(ws, 1e-3) * 255;
  }

  /** Metal connector + the single pipe from it into the core. Inside the glass pipe the four
   *  liquids braid together and blend on their way in. */
  private mergedPipe(L: CoreLayout, d: CoreDrive, dim: number) {
    const { ctx } = this;
    const { jx, ex, y, T, cw } = junction(L);
    const px0 = jx + cw / 2, len = ex - px0;
    const t = d.clock, flow = d.neuralT * 2.2 + t * 0.6;
    const { mix, on } = this.inner;
    const PW = T * 1.6; // pipe thickness
    const live = (0.9 + 0.1 * Math.sin(t * 2.1)) * dim;
    const n = this.colors.length;

    if (len > 4) {
      const mixCss = `rgb(${Math.round(mix[0] * 255)},${Math.round(mix[1] * 255)},${Math.round(mix[2] * 255)})`;
      ctx.lineCap = 'butt';
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = mixCss;
      ctx.globalAlpha = Math.min(1, 0.14 * live + d.energy * 0.06);
      ctx.lineWidth = PW * 2.2;
      ctx.beginPath();
      ctx.moveTo(px0, y);
      ctx.lineTo(ex, y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(205,220,240,0.35)';
      ctx.lineWidth = PW + 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(8,11,17,0.85)';
      ctx.lineWidth = PW;
      ctx.stroke();
      // Braided liquids: each colour weaves across the pipe and thickens into the blend.
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        if (!on[i]) continue;
        ctx.strokeStyle = this.colors[i];
        for (let j = 0; j < 24; j++) {
          const u0 = j / 24, u1 = (j + 1) / 24;
          const oy = (u: number) => Math.sin(u * 8 - flow * 3 + (i * TAU) / n) * PW * 0.3 * (1 - u * 0.7);
          const wv = 0.5 + 0.5 * Math.sin(u0 * 18 - flow * 4 + i);
          ctx.lineWidth = PW * (0.22 + 0.18 * wv + 0.25 * u0);
          ctx.globalAlpha = Math.min(1, (0.5 + 0.35 * wv) * live);
          ctx.beginPath();
          ctx.moveTo(px0 + u0 * len, y + oy(u0));
          ctx.lineTo(px0 + u1 * len, y + oy(u1));
          ctx.stroke();
        }
      }
      ctx.strokeStyle = '#fff4e0';
      ctx.lineWidth = Math.max(1.2, PW * 0.14);
      ctx.globalAlpha = 0.5 * live;
      ctx.setLineDash([4, 12]);
      ctx.lineDashOffset = -flow * 30;
      ctx.beginPath();
      ctx.moveTo(px0, y);
      ctx.lineTo(ex, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Node pulses continue through the pipe into the core.
      for (let i = 0; i < n; i++) {
        const b = (d.burst[i] / BURST_ENTRY - LINK_SHARE) / (1 - LINK_SHARE);
        if (!on[i] || d.burst[i] < 0 || b < 0 || b >= 1) continue;
        this.sprite(this.sprites[i], px0 + b * len, y, PW * 2.4, 0.85);
        this.sprite(this.white, px0 + b * len, y, PW * 0.7, 0.7);
      }
      // Flange where the pipe meets the core.
      this.metal(ex - T * 0.5, y - PW * 0.95, T * 0.6, PW * 1.9, 2, dim);
    }

    // Connector: a machined cross fitting with flanges and bolts; inlets glow in node colours.
    const h = Math.max(PW * 2.2, (n - 1) * T * 1.25 + T * 2.2);
    const x0 = jx - cw / 2;
    this.metal(jx - T * 0.55, y - h / 2 - T * 1.1, T * 1.1, h + T * 2.2, 3, dim); // vertical barrel
    this.metal(x0, y - h / 2, cw, h, 4, dim); // body
    this.metal(x0 - T * 0.35, y - h / 2 - T * 0.25, T * 0.35, h + T * 0.5, 2, dim); // inlet flange
    this.metal(x0 + cw, y - PW * 0.9, T * 0.4, PW * 1.8, 2, dim); // outlet flange
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(30,34,40,0.9)';
    for (const [bx, by] of [[x0 + T * 0.35, y - h / 2 + T * 0.35], [x0 + cw - T * 0.35, y - h / 2 + T * 0.35], [x0 + T * 0.35, y + h / 2 - T * 0.35], [x0 + cw - T * 0.35, y + h / 2 - T * 0.35]]) {
      ctx.globalAlpha = dim;
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(1.4, T * 0.13), 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      const iy = inletY(L, i, n);
      this.sprite(this.sprites[i], x0 + T * 0.2, iy, T * 1.6, 0.55 * live);
    }
    // Light leaking through the connector's centre window.
    this.sprite(this.white, jx, y, T * 1.4, (0.25 + 0.2 * d.energy) * live);
  }

  /** Brushed metal block with bevelled highlight (connector parts). */
  private metal(x: number, y: number, w: number, h: number, r: number, dim: number) {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = dim;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#2c3138');
    g.addColorStop(0.18, '#aab3be');
    g.addColorStop(0.42, '#5d6570');
    g.addColorStop(0.75, '#3a4048');
    g.addColorStop(1, '#1b1f25');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,230,245,0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  /** Heartbeat shockwaves around the glass (live voice). */
  private heartbeat(L: CoreLayout, d: CoreDrive, dt: number) {
    const { ctx } = this;
    if (d.newWave > 0) this.waves.push({ age: 0, s: d.newWave });
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.age += dt * 1.4;
      if (w.age >= 1) {
        this.waves.splice(i, 1);
        continue;
      }
      ctx.lineWidth = 0.5 + 1.2 * (1 - w.age);
      ctx.strokeStyle = '#ffd9a0';
      ctx.globalAlpha = (1 - w.age) * w.s * 0.3;
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, L.R * (1.01 + w.age * 0.15), 0, TAU);
      ctx.stroke();
    }
  }

  /** No WebGL2: a simple filled sphere so the core never disappears. */
  private fallbackSphere(L: CoreLayout, d: CoreDrive) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.R);
    g.addColorStop(0, `rgba(255,236,200,${Math.min(1, 0.8 * d.glow)})`);
    g.addColorStop(0.35, `rgba(255,120,40,${0.45 * d.glow})`);
    g.addColorStop(1, 'rgba(20,24,32,0.6)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,225,245,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
