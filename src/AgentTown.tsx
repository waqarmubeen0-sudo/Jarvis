import React, { useEffect, useRef, useState } from 'react';
import panelUrl from './assets/agent-town/agent-town-panel.png';
import { ATLAS_URL } from './agentTown/sprites';
import { ART_W, ART_H, HUD } from './agentTown/scene';
import { agentStore } from './agentTown/agentStore';
import { TownSim } from './agentTown/behavior';
import { renderTown, actorAt, sampleHudColors, RenderAssets } from './agentTown/renderer';
import { AgentInfoPanel } from './agentTown/AgentInfoPanel';

interface AgentTownProps {
  onDispatchTask: (prompt: string, targetAgent?: string) => void;
  onOpenChat?: () => void;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Agent Town asset failed to load: ${src}`));
    img.src = src;
  });

let assetsPromise: Promise<RenderAssets> | null = null;
const loadAssets = () =>
  (assetsPromise ??= Promise.all([loadImage(panelUrl), loadImage(ATLAS_URL), document.fonts?.load('700 20px "Share Tech Mono"').catch(() => undefined)])
    .then(([art, atlas]) => ({ art, atlas, ...sampleHudColors(art) }))
    .catch(err => { assetsPromise = null; throw err; }));

// The supplied Agent Town artwork, brought to life: characters mirror the real
// agent/task system (polled from /api/agents and /api/tasks).
export const AgentTown: React.FC<AgentTownProps> = ({ onDispatchTask, onOpenChat }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const store = agentStore; // shared with the chat panel roster
  const [sim] = useState(() => new TownSim(store));
  const [selected, setSelected] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [chatBox, setChatBox] = useState<React.CSSProperties>({ display: 'none' });
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });
  const hoverRef = useRef<string | null>(null);

  useEffect(() => {
    return store.acquire();
  }, [store]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrapper || !canvas || !ctx) return;
    let alive = true;
    let raf = 0;
    let assets: RenderAssets | null = null;
    let last = performance.now();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      const scale = Math.min(w / ART_W, h / ART_H);
      const ox = (w - ART_W * scale) / 2;
      const oy = (h - ART_H * scale) / 2;
      viewRef.current = { scale, ox, oy };
      // Real, focusable button over the artwork's CHAT button.
      const [x0, y0, x1, y1] = HUD.chat;
      setChatBox({ left: ox + x0 * scale, top: oy + y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper);

    loadAssets()
      .then(a => { if (alive) assets = a; })
      .catch(err => { console.error(err); if (alive) setAssetError('AGENT TOWN ASSETS FAILED TO LOAD'); });

    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (assets) {
        sim.update(now, dt);
        const dpr = window.devicePixelRatio || 1;
        const { scale, ox, oy } = viewRef.current;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
        renderTown(ctx, assets, sim, store, now, scale, hoverRef.current);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [sim, store]);

  const toArt = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const { scale, ox, oy } = viewRef.current;
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  };

  return (
    <div className="agent-town-panel flex flex-col flex-1 min-h-0">
      <div ref={wrapperRef} className="agent-town-canvas-wrapper relative flex-1 min-h-0">
        {/* Blurred copy of the artwork fills any letterbox space; the artwork itself is drawn untouched on the canvas. */}
        <div className="agent-town-backdrop" style={{ backgroundImage: `url(${panelUrl})` }} aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className="agent-town-canvas"
          onMouseMove={e => {
            const p = toArt(e);
            hoverRef.current = actorAt(sim, p.x, p.y)?.id ?? null;
            e.currentTarget.style.cursor = hoverRef.current ? 'pointer' : 'default';
          }}
          onMouseLeave={() => { hoverRef.current = null; }}
          onClick={e => {
            const p = toArt(e);
            const hit = actorAt(sim, p.x, p.y);
            if (hit) setSelected(hit.id);
          }}
        />
        <button className="agent-town-chat-hit" style={chatBox} onClick={onOpenChat} aria-label="Open J.A.R.V.I.S. chat" title="Open J.A.R.V.I.S. Command Runner" />
        {assetError && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-red-400">{assetError}</div>
        )}
        {selected && (
          <AgentInfoPanel sim={sim} agentId={selected} onClose={() => setSelected(null)} onDispatchTask={onDispatchTask} />
        )}
      </div>
    </div>
  );
};
