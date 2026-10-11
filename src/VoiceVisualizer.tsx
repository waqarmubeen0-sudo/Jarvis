import React, { useEffect, useRef } from 'react';
import type { AudioLevels } from './CoreOrb';

// Voice-state visual for the terminal: a small reactor orb plus a waveform, driven by the same
// real mic/speaker levels as the Core Orb (App's audioLevelsRef). When no audio data is flowing
// (no analyser, muted, blocked) it falls back to a gentle synthetic motion instead of freezing.

export type VoiceState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'ERROR';

const COLORS: Record<VoiceState, [number, number, number]> = {
  IDLE: [34, 211, 238],
  LISTENING: [34, 211, 238],
  PROCESSING: [251, 191, 36],
  SPEAKING: [56, 189, 248],
  ERROR: [251, 113, 133],
};

export const VoiceVisualizer: React.FC<{ state: VoiceState; levels?: React.RefObject<AudioLevels> }> = ({ state, levels }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let w = 0, h = 0, raf = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let level = 0;
    let color = [...COLORS.IDLE];
    const bars = new Float32Array(48);
    const t0 = performance.now();

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const s = stateRef.current;
      const target = COLORS[s];
      for (let i = 0; i < 3; i++) color[i] += (target[i] - color[i]) * 0.08;
      const rgb = (a: number) => `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${a})`;

      // Real level for the state (mic while listening, speaker while speaking), smoothed.
      const raw = s === 'SPEAKING' ? levels?.current.output ?? 0 : s === 'LISTENING' ? levels?.current.input ?? 0 : 0;
      const live = Number.isFinite(raw) ? Math.min(1, raw * 2.2) : 0;
      // Safe fallback: no audio data -> synthetic breathing so the state still reads as alive.
      const fallback = s === 'SPEAKING' ? 0.35 + 0.25 * Math.sin(t * 7) * Math.sin(t * 2.3) : s === 'LISTENING' ? 0.12 + 0.06 * Math.sin(t * 3) : 0;
      level += ((live > 0.02 ? live : fallback) - level) * 0.25;

      ctx.clearRect(0, 0, w, h);
      const cy = h / 2;
      const r = Math.min(h * 0.34, 18);
      const cx = r + 8;

      // Orb: glow, core, rotating arc segments.
      const pulse = s === 'IDLE' ? 0.5 + 0.2 * Math.sin(t * 1.2) : s === 'ERROR' ? 0.45 + 0.35 * (Math.sin(t * 9) > 0.6 ? 1 : 0) : 0.6 + level * 0.8;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
      g.addColorStop(0, rgb(0.55 * pulse));
      g.addColorStop(0.4, rgb(0.18 * pulse));
      g.addColorStop(1, rgb(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.28 + level * 0.25), 0, Math.PI * 2);
      ctx.fill();
      const spin = t * (s === 'PROCESSING' ? 4.5 : s === 'IDLE' ? 0.4 : 1.4);
      ctx.lineWidth = 1.4;
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = rgb(0.35 + 0.2 * k);
        ctx.beginPath();
        const a = spin * (k % 2 ? -1 : 1) + (k * Math.PI * 2) / 3;
        ctx.arc(cx, cy, r * (0.62 + k * 0.17), a, a + Math.PI * (0.5 + 0.25 * k));
        ctx.stroke();
      }

      // Waveform bars to the right of the orb.
      const x0 = cx + r + 14;
      const span = w - x0 - 6;
      const n = Math.max(12, Math.min(bars.length, Math.floor(span / 5)));
      const bw = span / n;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const env = Math.sin(Math.PI * u); // taller in the middle
        let v: number;
        if (s === 'PROCESSING') {
          const sweep = Math.exp(-(((u - ((t * 0.7) % 1.4) + 0.2) * 7) ** 2));
          v = 0.08 + 0.55 * sweep;
        } else if (s === 'ERROR') {
          v = 0.04 + (Math.random() < 0.02 ? 0.4 : 0);
        } else if (s === 'IDLE') {
          v = 0.05 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.3 + u * 6));
        } else {
          const wobble = 0.55 + 0.45 * Math.sin(t * 9 + i * 1.7) * Math.sin(t * 3.1 + i * 0.6);
          v = 0.06 + level * env * wobble;
        }
        bars[i] += (v - bars[i]) * 0.3;
        const bh = Math.max(1.5, bars[i] * h * 0.9);
        ctx.fillStyle = rgb(0.25 + 0.65 * Math.min(1, bars[i] * 1.6));
        ctx.fillRect(x0 + i * bw + bw * 0.25, cy - bh / 2, Math.max(1, bw * 0.5), bh);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [levels]);

  return <canvas ref={canvasRef} className="w-full h-full block" aria-hidden="true" />;
};
