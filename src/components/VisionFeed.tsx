import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Monitor, RefreshCw, Eye, Maximize2 } from 'lucide-react';

interface VisionFeedProps {
  onSendFrame: (base64Jpeg: string) => void;
  isLiveActive: boolean;
}

export const VisionFeed: React.FC<VisionFeedProps> = ({ onSendFrame, isLiveActive }) => {
  const [sourceType, setSourceType] = useState<'camera' | 'screen' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fpsCount, setFpsCount] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopStream = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setSourceType(null);
  };

  const startVision = async (type: 'camera' | 'screen') => {
    stopStream();
    setError(null);

    try {
      let stream: MediaStream;
      if (type === 'camera') {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
        });
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setSourceType(type);

      // Stream frames to Gemini Live at ~1 frame every 1.5 seconds (within Live API 1 FPS rate limit)
      intervalRef.current = setInterval(() => {
        captureAndSendFrame();
      }, 1500);
    } catch (err: any) {
      console.error('Vision feed error:', err);
      setError(err.message || 'Could not access optical sensor.');
      stopStream();
    }
  };

  const captureAndSendFrame = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    const base64 = dataUrl.split(',')[1];

    if (base64 && isLiveActive) {
      onSendFrame(base64);
      setFpsCount((prev) => (prev + 1) % 1000);
    }
  };

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  return (
    <div className="relative bg-slate-950/80 border border-cyan-500/30 rounded-xl p-3 backdrop-blur-md overflow-hidden">
      {/* HUD Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-cyan-900/40">
        <div className="flex items-center gap-2">
          <Eye className={`w-4 h-4 ${sourceType ? 'text-cyan-400 animate-pulse' : 'text-gray-500'}`} />
          <span className="font-mono-tech text-xs tracking-wider text-cyan-200 uppercase">
            Optical Sensor / Vision HUD
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {sourceType ? (
            <button
              onClick={stopStream}
              className="px-2 py-1 text-[11px] font-tech text-red-400 border border-red-500/30 rounded bg-red-950/30 hover:bg-red-900/50 transition-colors flex items-center gap-1"
            >
              <CameraOff className="w-3 h-3" />
              <span>Offline</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => startVision('camera')}
                className="px-2.5 py-1 text-[11px] font-tech text-cyan-300 border border-cyan-500/40 rounded bg-cyan-950/40 hover:bg-cyan-900/60 transition-colors flex items-center gap-1"
              >
                <Camera className="w-3 h-3" />
                <span>Webcam</span>
              </button>
              <button
                onClick={() => startVision('screen')}
                className="px-2.5 py-1 text-[11px] font-tech text-cyan-300 border border-cyan-500/40 rounded bg-cyan-950/40 hover:bg-cyan-900/60 transition-colors flex items-center gap-1"
              >
                <Monitor className="w-3 h-3" />
                <span>Screen</span>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-950/40 p-2 rounded border border-red-500/30 mb-2 font-code">
          {error}
        </div>
      )}

      {/* Video Viewport */}
      <div className="relative aspect-video w-full bg-black/60 rounded-lg overflow-hidden border border-cyan-900/30 flex items-center justify-center">
        {sourceType ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Holographic Crosshair Reticle & Targeting Grid */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Scanline overlay */}
              <div className="absolute inset-0 scanline opacity-30" />

              {/* Corner brackets */}
              <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-cyan-400" />
              <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-cyan-400" />
              <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-cyan-400" />
              <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-cyan-400" />

              {/* Center Target Reticle */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 border border-cyan-400/50 rounded-full flex items-center justify-center animate-spin-slow">
                  <div className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_8px_#22d3ee]" />
                </div>
              </div>

              {/* Telemetry stamps */}
              <div className="absolute bottom-2 left-3 font-code text-[10px] text-cyan-300/80 drop-shadow">
                OPTICAL_FEED: ACTIVE // FRAME_CNT: {fpsCount}
              </div>
              <div className="absolute top-2 right-3 font-code text-[10px] text-cyan-300/80 drop-shadow flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>STREAMING TO J.A.R.V.I.S.</span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-4">
            <Eye className="w-8 h-8 text-cyan-500/30 mb-2" />
            <p className="font-tech text-xs text-cyan-300/70">
              Optical sensors on standby.
            </p>
            <p className="text-[11px] text-cyan-500/50 max-w-xs mt-1">
              Enable webcam or screen share to let J.A.R.V.I.S. inspect physical items, schematics, or code in real time.
            </p>
          </div>
        )}
      </div>

      {sourceType && (
        <div className="mt-2 flex items-center justify-between text-[10px] font-code text-cyan-400/60">
          <span>Target Acquisition: Auto</span>
          <span>Resolution: 640x480 (Optimized for Live API)</span>
          <button
            onClick={captureAndSendFrame}
            className="text-cyan-300 hover:text-white flex items-center gap-1 font-tech uppercase"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Force Scan</span>
          </button>
        </div>
      )}
    </div>
  );
};
