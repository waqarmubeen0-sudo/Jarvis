import React, { useEffect, useRef, useState } from 'react';
import { Activity, Network, BookOpen, Brain, Flame, Mic, MicOff } from 'lucide-react';
import { CoreDrive } from './core/coreMorph';
import { createNeuralCoreGL } from './core/neuralCoreGL';
import { CoreOverlay, CoreLayout, buildLink } from './core/coreOverlay';

export type CoreNode = 'MEMORY' | 'SKILLS' | 'THINKING' | 'SOUL' | 'SETTING';
type Status = 'OFFLINE' | 'CONNECTING' | 'ONLINE' | 'LISTENING' | 'SPEAKING';

/** Live mic (input) and JARVIS voice (output) levels, 0..1, written every frame by App. */
export interface AudioLevels {
  input: number;
  output: number;
}

interface CoreOrbProps {
  status: Status;
  levels: React.RefObject<AudioLevels>;
  isProcessing: boolean;
  isMicMuted: boolean;
  onToggle: () => void;
  onToggleMic: () => void;
  onSelectNode: (node: CoreNode) => void;
  /** Existing app error message; each new error causes a brief red disturbance. */
  error?: string | null;
}

const NODES: { id: CoreNode; Icon: typeof Brain; color: string }[] = [
  { id: 'MEMORY', Icon: Network, color: '#22d3ee' },
  { id: 'SKILLS', Icon: BookOpen, color: '#fbbf24' },
  { id: 'THINKING', Icon: Brain, color: '#f43f5e' },
  { id: 'SOUL', Icon: Flame, color: '#fb923c' },
]; // SETTING node removed from the core; settings stay on the title-bar gear
export const CoreOrb: React.FC<CoreOrbProps> = ({
  status,
  levels,
  isProcessing,
  isMicMuted,
  onToggle,
  onToggleMic,
  onSelectNode,
  error,
}) => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const [drive] = useState(() => new CoreDrive());
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeNode, setActiveNode] = useState<CoreNode | null>(null);

  // Everything the render loop reads lives here, so the loop is started once and never restarted.
  const live = useRef({
    status,
    isProcessing,
    isMicMuted,
    activeIdx: -1,
  });
  useEffect(() => {
    const l = live.current;
    l.status = status;
    l.isProcessing = isProcessing;
    l.isMicMuted = isMicMuted;
    l.activeIdx = activeNode ? NODES.findIndex((n) => n.id === activeNode) : -1;
  }, [status, isProcessing, isMicMuted, activeNode]);

  useEffect(() => {
    if (error) drive.error();
  }, [error, drive]);

  // One animation loop drives both layers: WebGL sphere (below) and the 2D overlay (above).
  useEffect(() => {
    const canvas = canvasRef.current;
    const glCanvas = glRef.current;
    const body = bodyRef.current;
    const box = boxRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !glCanvas || !body || !box || !ctx) return;

    const colors = NODES.map((n) => n.color);
    const gl = createNeuralCoreGL(glCanvas, colors);
    const overlay = new CoreOverlay(ctx, colors, !gl);
    const L: CoreLayout = { W: 0, H: 0, dpr: 1, bx: 0, by: 0, bw: 0, bh: 0, cx: 0, cy: 0, R: 0, links: [] };

    // Measured from the DOM so the core follows any panel size.
    const layout = () => {
      const r = body.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const b = box.getBoundingClientRect();
      L.dpr = Math.min(window.devicePixelRatio || 1, 2);
      L.W = r.width;
      L.H = r.height;
      canvas.width = Math.round(L.W * L.dpr);
      canvas.height = Math.round(L.H * L.dpr);
      L.bx = b.left - r.left;
      L.by = b.top - r.top;
      L.bw = b.width;
      L.bh = b.height;
      L.R = Math.min(L.bw * 0.4, L.bh * 0.41);
      L.cx = L.bx + L.bw * 0.5;
      L.cy = L.by + L.bh * 0.47;
      gl?.resize(L.bw, L.bh, L.dpr);
      L.links = pillRefs.current.map((el, i) => {
        if (!el) return null;
        const p = el.getBoundingClientRect();
        return buildLink(p.right - r.left - 3, p.top - r.top + p.height / 2, i, L, NODES.length);
      });
    };
    const ro = new ResizeObserver(layout);
    ro.observe(body);
    layout();

    let raf = 0;
    let last = performance.now();
    let slow = 0; // seconds of sustained slow frames
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!L.W) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Sustained < ~40 FPS: drop the shader resolution a step (cheapest big win).
      slow = dt > 0.025 ? slow + dt : Math.max(0, slow - dt);
      if (slow > 2 && gl?.degrade()) slow = 0;
      const lv = live.current;
      const lvl = levels.current;
      drive.update(dt, {
        status: lv.status,
        isProcessing: lv.isProcessing,
        isMicMuted: lv.isMicMuted,
        input: Number(lvl?.input) || 0, // missing / NaN audio -> silence (state-based animation)
        output: Number(lvl?.output) || 0,
      });
      overlay.draw(L, drive, dt, lv.activeIdx); // also computes the in-glass stream paths
      gl?.render(drive, L.cx - L.bx, L.cy - L.by, L.R, overlay.inner);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl?.dispose();
    };
  }, [levels, drive]);

  const isOnline = status === 'ONLINE' || status === 'LISTENING' || status === 'SPEAKING';
  const isConnecting = status === 'CONNECTING';
  const stateLabel = isProcessing ? 'PROCESSING' : status;

  const handleNode = (id: CoreNode, i: number) => {
    setActiveNode(id);
    drive.click(i);
    onSelectNode(id);
  };
  const handleToggle = () => {
    drive.surge();
    onToggle();
  };

  return (
    <div className="jv-obsidian-panel core-panel p-2 flex flex-col gap-1.5 shrink-0 relative overflow-hidden">
      <div className="flex items-center justify-between pb-1 shrink-0 px-1">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-orange-300/80" />
          <h2 className="font-mono-tech text-xs font-bold text-orange-200/80 tracking-wider uppercase">
            Core Orb Node Visualizer
          </h2>
        </div>
        <div className="flex items-center gap-1 font-mono text-[9px] tracking-widest">
          <span className="text-orange-200/40">STATE:</span>
          <span
            className={`font-bold uppercase ${
              stateLabel === 'PROCESSING'
                ? 'text-sky-300 animate-pulse'
                : isOnline
                ? 'text-emerald-400'
                : isConnecting
                ? 'text-amber-400 animate-pulse'
                : 'text-orange-200/40'
            }`}
          >
            {stateLabel}
          </span>
        </div>
      </div>

      <div ref={bodyRef} className="core-body">
        <canvas ref={canvasRef} className="core-canvas" aria-hidden="true" />

        <div className="core-left">
          {NODES.map(({ id, Icon, color }, i) => (
            <button
              key={id}
              ref={(el) => {
                pillRefs.current[i] = el;
              }}
              type="button"
              onClick={() => handleNode(id, i)}
              className={`core-pill ${activeNode === id ? 'active' : ''} ${
                id === 'THINKING' && isProcessing ? 'live' : ''
              }`}
              style={{ '--c': color } as React.CSSProperties}
              aria-pressed={activeNode === id}
              title={`Open ${id.toLowerCase()} node`}
            >
              <span className="core-pill-inner">
                <Icon className="core-pill-icon" />
                <span className="core-pill-label">{id}</span>
                <span className="core-pill-dot" />
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleToggle}
          className={`core-start ${isOnline ? 'on' : ''} ${isConnecting ? 'busy' : ''}`}
          aria-pressed={isOnline}
          title={isOnline ? 'Shut down J.A.R.V.I.S. voice link' : 'Start J.A.R.V.I.S. voice link'}
        >
          <span className="core-start-inner">
            {isConnecting ? 'CONNECTING…' : isOnline ? 'STOP AI' : 'START AI'}
          </span>
        </button>

        <div ref={boxRef} className="core-box">
          <canvas ref={glRef} className="core-gl" aria-hidden="true" />
          <div className="core-controls">
            <button
              type="button"
              onClick={onToggleMic}
              className={`core-ctl ${isMicMuted ? 'muted' : isOnline ? 'on' : ''}`}
              aria-pressed={!isMicMuted}
              aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
              title={isMicMuted ? 'Microphone muted — click to unmute' : 'Microphone live — click to mute'}
            >
              {isMicMuted ? <MicOff /> : <Mic />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
