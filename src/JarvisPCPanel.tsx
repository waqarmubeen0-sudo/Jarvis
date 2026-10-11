import React, { useEffect, useRef, useState } from 'react';
import { Camera, Monitor, MonitorSmartphone, Orbit as OrbitIcon, Globe, Loader2, ShieldCheck } from 'lucide-react';
import { useComputerFrame, useComputerState, ComputerSnapshot } from './computerState';

interface JarvisPCPanelProps {
  onSendFrame?: (base64Jpeg: string) => void;
  isLiveActive?: boolean;
}

const host = (u?: string) => {
  if (!u) return '';
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u.slice(0, 40); }
};

/** Header badge, sub-label and footer lines, all derived from the real router state. */
function describe(s: ComputerSnapshot | null) {
  if (!s) return { badge: { text: 'LINKING', dot: '○', cls: 'text-slate-400 border-slate-600/40 bg-slate-900/60' }, sub: 'CONNECTING TO J.A.R.V.I.S. CORE', status: '—', agent: '—', action: 'Waiting for the core…' };
  if (s.mode === 'DIRECT') {
    const last = s.direct.lastAction?.text;
    const [who, ...rest] = (last ?? '').split(': ');
    return {
      badge: { text: 'DIRECT', dot: '●', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40' },
      sub: 'YOUR PC // DIRECT LINK',
      status: 'LINKED',
      agent: last ? who : 'J.A.R.V.I.S.',
      action: last ? rest.join(': ') : 'Awaiting your command',
    };
  }
  const o = s.orbit;
  const standby = o.state === 'OFF' || o.state === 'STOPPING';
  return {
    badge: standby
      ? { text: 'STANDBY', dot: '○', cls: 'text-slate-400 border-slate-600/40 bg-slate-900/60' }
      : { text: 'ORBIT', dot: '●', cls: 'text-violet-300 border-violet-500/40 bg-violet-950/40' },
    sub: o.activity ? `${o.activity.actor} — ${o.activity.status}` : 'ORBIT WORKSPACE // ISOLATED PROFILE',
    status: o.activity?.status ?? o.state,
    agent: o.activity?.actor ?? '—',
    action: o.activity?.action ?? (o.state === 'STARTING' ? 'Booting private computer…' : o.error ? o.error : o.title || 'Awaiting instructions'),
  };
}

/** Live Orbit screen. Subscribes to frames itself, so each frame re-renders only this, not the panel. */
function OrbitScreen({ o }: { o?: ComputerSnapshot['orbit'] }) {
  const frame = useComputerFrame();
  return frame ? (
    <>
      <img src={`data:image/jpeg;base64,${frame}`} alt="Live Orbit computer screen" className="w-full h-full object-contain" draggable={false} />
      <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 px-2 py-1 bg-[#05080e]/80 border-b border-violet-500/20 font-mono text-[9px] text-violet-200/90">
        <Globe className="w-2.5 h-2.5 shrink-0" />
        <span className="truncate">{host(o?.url) || o?.title || 'orbit://workspace'}</span>
        <span className="ml-auto flex items-center gap-1 text-rose-300 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          LIVE
        </span>
      </div>
    </>
  ) : (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2 bg-[radial-gradient(ellipse_at_center,#150f2a_0%,#04060a_100%)]">
      {o?.state === 'STARTING' ? <Loader2 className="w-5 h-5 text-violet-300 animate-spin mb-1" /> : <OrbitIcon className="w-5 h-5 text-violet-300/60 mb-1" />}
      <p className="font-mono text-[10.5px] text-violet-200/90">
        {o?.state === 'STARTING' ? 'BOOTING ORBIT COMPUTER…' : o?.state === 'STOPPING' ? 'ORBIT STANDING DOWN…' : 'ORBIT OFFLINE'}
      </p>
      <p className="font-mono text-[9px] text-slate-500 mt-0.5 max-w-[90%]">
        {o?.error || 'Private isolated browser // separate profile'}
      </p>
    </div>
  );
}

// Evolution of the MEDIA LINK panel: a live window into the computer J.A.R.V.I.S. is using.
//   DIRECT -> the user's PC. Nothing is captured unless the user shares camera/screen here.
//   ORBIT  -> the real screen of J.A.R.V.I.S.'s private Orbit computer, streamed live.
export const JarvisPCPanel: React.FC<JarvisPCPanelProps> = ({ onSendFrame, isLiveActive = false }) => {
  const state = useComputerState();
  const mode = state?.mode ?? 'DIRECT';
  const orbitMode = mode === 'ORBIT';

  // ---- user-shared camera / screen (Direct mode only), sent to JARVIS while connected ----
  const [sourceType, setSourceType] = useState<'camera' | 'screen' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fpsCount, setFpsCount] = useState<number>(0);
  const [resolution, setResolution] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Latest props for the capture timer (a setInterval callback would otherwise keep stale values).
  const liveRef = useRef({ onSendFrame, isLiveActive });
  liveRef.current = { onSendFrame, isLiveActive };
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bumped on every start/stop: a camera request that resolves after a newer click is discarded,
  // so a double click or an OFF during "opening" can't leave a second stream or turn it back on.
  const requestRef = useRef(0);

  const stopStream = () => {
    requestRef.current++;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setSourceType(null);
    setResolution('');
    setFpsCount(0);
  };

  const startVision = async (type: 'camera' | 'screen') => {
    stopStream();
    const request = requestRef.current;
    setError(null);
    try {
      const stream =
        type === 'camera'
          ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } })
          : await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      // If the camera is unplugged, permission revoked, or "Stop sharing" pressed: back to standby.
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (streamRef.current === stream) stopStream();
        };
      });
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.onloadedmetadata = () => setResolution(`${video.videoWidth}x${video.videoHeight}`);
        await video.play().catch((e) => console.warn('Video play() was blocked:', e));
      }
      if (request !== requestRef.current) return; // stopped while the video was starting
      setSourceType(type);
      intervalRef.current = setInterval(captureAndSendFrame, 1000);
    } catch (err: any) {
      if (request !== requestRef.current) return;
      console.error('Vision feed error:', err);
      setError(err.message || 'Optical sensor unavailable');
      stopStream();
    }
  };

  const captureAndSendFrame = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    canvasRef.current ??= document.createElement('canvas');
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setFpsCount((prev) => (prev + 1) % 1000);
    const { onSendFrame: send, isLiveActive: live } = liveRef.current;
    if (!send || !live) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.65).split(',')[1];
    if (base64) send(base64);
  };

  // The user's camera/screen share only changes when they click it (or the device/browser ends it);
  // switching modes never touches it.
  useEffect(() => () => stopStream(), []);

  const d = describe(state);
  const o = state?.orbit;
  // The existing CAM ON / SCR ON toggle; also shown in Orbit mode while sharing, so it stays in the user's hands.
  const liveToggle = sourceType && (
    <button
      onClick={stopStream}
      aria-pressed={true}
      title={`${sourceType === 'camera' ? 'Camera' : 'Screen share'} is live - click to turn off`}
      className="group px-2 py-0.5 text-[10px] font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/50 rounded hover:text-rose-300 hover:bg-rose-950/50 hover:border-rose-500/50 transition-colors flex items-center gap-1 cursor-pointer"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 group-hover:bg-rose-400" />
      {sourceType === 'camera' ? <Camera className="w-2.5 h-2.5" /> : <Monitor className="w-2.5 h-2.5" />}
      <span className="group-hover:hidden">{sourceType === 'camera' ? 'CAM ON' : 'SCR ON'}</span>
      <span className="hidden group-hover:inline">OFF</span>
    </button>
  );
  const btn =
    'px-2 py-0.5 text-[10px] font-mono text-cyan-300 bg-[#0e1420] border border-[#263448] rounded hover:border-cyan-500/50 hover:text-white transition-colors flex items-center gap-1 cursor-pointer';

  return (
    <div className="jv-obsidian-panel p-2.5 flex flex-col gap-1.5 shrink-0">
      {/* Header: JARVIS PC + real mode/lifecycle badge */}
      <div className="flex items-center justify-between border-b border-[#1e2638] pb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {orbitMode ? <OrbitIcon className="w-3.5 h-3.5 text-violet-300" /> : <MonitorSmartphone className="w-3.5 h-3.5 text-cyan-400" />}
          <h2 className="font-mono-tech text-xs font-bold text-cyan-100 tracking-wider uppercase">JARVIS PC</h2>
          <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${d.badge.cls}`} title={state?.session.desktop}>
            {d.badge.dot} {d.badge.text}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {orbitMode ? (
            <>
              {liveToggle}
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded border border-violet-500/30 text-violet-300/80 bg-violet-950/30" title="Orbit computer lifecycle">
                {o?.state === 'STARTING' || o?.state === 'STOPPING' ? <Loader2 className="inline w-2.5 h-2.5 mr-0.5 animate-spin" /> : null}
                {o?.state ?? '—'}
              </span>
            </>
          ) : sourceType ? (
            liveToggle
          ) : (
            <>
              <button onClick={() => startVision('camera')} className={btn} title="Share your webcam with J.A.R.V.I.S.">
                <Camera className="w-2.5 h-2.5 text-cyan-400" />
                <span>CAM</span>
              </button>
              <button onClick={() => startVision('screen')} className={btn} title="Share your screen: shows your PC here and lets J.A.R.V.I.S. see it">
                <Monitor className="w-2.5 h-2.5 text-cyan-400" />
                <span>SCR</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className={`font-mono text-[9px] tracking-widest uppercase truncate ${orbitMode ? 'text-violet-300/80' : 'text-emerald-300/70'}`}>{d.sub}</div>

      {error && !orbitMode && (
        <div className="text-[10px] text-rose-400 bg-rose-950/30 px-2 py-1 rounded border border-rose-500/30 font-mono">{error}</div>
      )}

      {/* Live computer view */}
      <div
        className={`relative w-full aspect-[16/10] max-h-[210px] bg-[#05080e] rounded border overflow-hidden flex items-center justify-center ${
          orbitMode ? 'border-violet-500/25' : 'border-[#1e2638]'
        }`}
      >
        <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${!orbitMode && sourceType ? '' : 'hidden'}`} />

        {orbitMode ? (
          <OrbitScreen o={o} />
        ) : sourceType ? (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 scanline opacity-25" />
            <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-cyan-400" />
            <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-cyan-400" />
            <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-cyan-400" />
            <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-cyan-400" />
            <div className="absolute bottom-1 left-2 font-mono text-[9px] text-cyan-300/80 drop-shadow">
              {sourceType === 'screen' ? 'YOUR SCREEN' : 'OPTICAL FEED'} {resolution && `// ${resolution}`} // FRM: {fpsCount}
              {isLiveActive ? ' // TX JARVIS' : ' // LOCAL'}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2 bg-[radial-gradient(ellipse_at_center,#0b1a1a_0%,#04060a_100%)]">
            <div className="w-8 h-8 rounded-full border border-emerald-500/30 bg-emerald-950/30 flex items-center justify-center mb-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-300/80" />
            </div>
            <p className="font-mono text-[10.5px] text-emerald-200/90">CONNECTED TO YOUR PC</p>
            <p className="font-mono text-[9px] text-slate-500 mt-0.5 max-w-[92%]">
              Apps &amp; browser open on your desktop. Your screen isn&apos;t captured — press SCR to show it here.
            </p>
          </div>
        )}
      </div>

      {/* Real status from the router */}
      <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5 font-mono text-[9.5px] leading-tight">
        <span className="text-slate-500">STATUS</span>
        <span className={orbitMode ? 'text-violet-200' : 'text-emerald-200'}>{d.status}</span>
        <span className="text-slate-500">AGENT</span>
        <span className="text-cyan-200">{d.agent}</span>
        <span className="text-slate-500">ACTION</span>
        <span className="text-slate-300 truncate" title={d.action}>{d.action}</span>
      </div>
    </div>
  );
};
