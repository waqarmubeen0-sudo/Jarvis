import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TitleBar } from './TitleBar';
import { JarvisPCPanel } from './JarvisPCPanel';
import { MemoryVault } from './MemoryVault';
import { SoulPanel } from './nodes/SoulPanel';
import { JarvisArcade } from './JarvisArcade';
import { ThinkingPanel } from './nodes/ThinkingPanel';
import { SkillsPanel } from './nodes/SkillsPanel';
import { SatLinkPanel } from './SatLinkPanel';
import { HeadlinesPanel } from './HeadlinesPanel';
import { CoreOrb, CoreNode, AudioLevels } from './CoreOrb';
import { AgentTown } from './AgentTown';
import { LiveTerminal } from './LiveTerminal';
import { MissionQueue } from './MissionQueue';
import { CommandBar } from './CommandBar';
import { SettingsModal } from './components/SettingsModal';
import { SystemLogsModal } from './SystemLogsModal';
import { ApiSettingsModal } from './ApiSettingsModal';
import { InitialSetup, fetchSetup, type SetupStatus } from './InitialSetup';
import { TranscriptEntry } from './components/LiveTranscript';
import {
  downsampleBuffer,
  float32ToPcm16Base64,
  LiveAudioPlayer,
  soundFX,
} from './utils/audio';
import { X, Database } from 'lucide-react';

// Import all required stylesheet files
import './jv-base.css';
import './jv-left.css';
import './jv-center.css';
import './jv-right.css';
import './jv-town.css';

export default function App() {
  // First launch: no API key yet -> JARVIS INITIAL SETUP (the user's own key; none ships with JARVIS).
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  useEffect(() => { fetchSetup().then(setSetup).catch(() => {}); }, []);
  // Connection & Audio States
  const [connectionStatus, setConnectionStatus] = useState<
    'OFFLINE' | 'CONNECTING' | 'ONLINE' | 'LISTENING' | 'SPEAKING'
  >('OFFLINE');
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Written every animation frame; kept in a ref so the whole app doesn't re-render at 60fps.
  const audioLevelsRef = useRef<AudioLevels>({ input: 0, output: 0 });
  // True between the user finishing a turn and JARVIS starting to answer (or while tools run).
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Persona & Directives
  const [voiceName, setVoiceName] = useState<string>('Puck');
  const [customDirective, setCustomDirective] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isLogsOpen, setIsLogsOpen] = useState<boolean>(false);
  // JARVIS Arcade (opened as an overlay: from a finished game in the chat, or by JARVIS's open_arcade).
  const [arcade, setArcade] = useState<{ gameId: string | null } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setArcade({ gameId: (e as CustomEvent).detail?.gameId ?? null });
    window.addEventListener('jarvis:open-arcade', open);
    return () => window.removeEventListener('jarvis:open-arcade', open);
  }, []);
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState<boolean>(false);
  const [activeNodeModal, setActiveNodeModal] = useState<'MEMORY' | 'SKILLS' | 'THINKING' | 'SOUL' | null>(null);

  // Live Transcripts & Logs
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const [interimUserText, setInterimUserText] = useState<string>('');
  const [isLoadingRest, setIsLoadingRest] = useState<boolean>(false);

  // Web Audio & WebSocket References
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<LiveAudioPlayer | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micStartingRef = useRef(false);
  const isMutedRef = useRef<boolean>(false);
  // Read inside socket handlers (which outlive renders), so toggles apply mid-conversation.
  const isAudioMutedRef = useRef<boolean>(false);
  useEffect(() => { isAudioMutedRef.current = isAudioMuted; }, [isAudioMuted]);
  // Settings → Voice (from the backend config): voice on/off and "speak typed replies".
  const voiceRef = useRef<{ enabled: boolean; speakTyped: boolean }>({ enabled: true, speakTyped: false });
  useEffect(() => {
    const apply = (v: any) => {
      if (!v) return;
      voiceRef.current = { enabled: v.enabled !== false, speakTyped: !!v.speakTyped };
      setIsAudioMuted(v.enabled === false);
      if (v.enabled === false) playerRef.current?.interrupt();
    };
    fetch('/api/config').then((r) => r.json()).then((d) => apply(d.config?.voice)).catch(() => {});
    const onChange = (e: Event) => apply((e as CustomEvent).detail);
    window.addEventListener('jarvis:voice-config', onChange);
    return () => window.removeEventListener('jarvis:voice-config', onChange);
  }, []);
  // Conversation context for typed chat and for (re)starting the voice link.
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  useEffect(() => { transcriptRef.current = transcriptEntries; }, [transcriptEntries]);
  const recentHistory = () => {
    const turns: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const e of transcriptRef.current) {
      if (e.sender !== 'user' && e.sender !== 'jarvis') continue;
      const role = e.sender === 'user' ? 'user' : 'assistant';
      const last = turns[turns.length - 1];
      if (last && last.role === role) last.content += e.text;
      else turns.push({ role, content: e.text });
    }
    return turns.slice(-12).map((t) => ({ ...t, content: t.content.slice(0, 1200) }));
  };

  useEffect(() => {
    isMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  // Connect WebSocket to J.A.R.V.I.S. Live Voice Backend
  const connectWebSocket = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setConnectionStatus('CONNECTING');
    setErrorMessage(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/live-ws`;

    console.log('[App] Connecting WebSocket to J.A.R.V.I.S. Uplink:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[App] J.A.R.V.I.S. WebSocket uplink connected');
      setConnectionStatus('ONLINE');
      soundFX.playStartup();

      ws.send(
        JSON.stringify({
          type: 'init',
          voice: voiceName,
          systemInstruction: customDirective || undefined,
          history: recentHistory(),
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'status') {
          if (data.status === 'ONLINE') {
            setConnectionStatus('ONLINE');
            addTranscriptEntry({
              sender: 'system',
              text: data.message || 'J.A.R.V.I.S. neural link online.',
            });
          } else if (data.status === 'DISCONNECTED') {
            setConnectionStatus('OFFLINE');
            setIsProcessing(false);
          }
        } else if (data.type === 'audio' && data.audio) {
          setIsProcessing(false);
          if (!isAudioMutedRef.current && playerRef.current) {
            playerRef.current.playChunk(data.audio);
            setConnectionStatus('SPEAKING');
          }
        } else if (data.type === 'interrupted') {
          if (playerRef.current) {
            playerRef.current.interrupt();
          }
          setConnectionStatus('LISTENING');
        } else if (data.type === 'turn_complete') {
          setIsProcessing(false);
          setConnectionStatus((prev) => (prev === 'SPEAKING' ? 'ONLINE' : prev));
        } else if (data.type === 'input_transcription') {
          if (data.isInterim) {
            setInterimUserText(data.text);
            setConnectionStatus('LISTENING');
          } else {
            setInterimUserText('');
            setIsProcessing(true);
            addTranscriptEntry({
              sender: 'user',
              text: data.text,
            });
          }
        } else if (data.type === 'output_transcription' || data.type === 'model_text') {
          addTranscriptEntry({
            sender: 'jarvis',
            text: data.text,
          });
        } else if (data.type === 'tool_call') {
          setIsProcessing(true);
          soundFX.playProtocolChirp();
          // Fly the globe to whatever place JARVIS just looked up.
          if (Number.isFinite(data.result?.lat) && Number.isFinite(data.result?.lng)) {
            window.dispatchEvent(new CustomEvent('jarvis:focus-location', { detail: data.result }));
          }
          addTranscriptEntry({
            sender: 'tool',
            text: `Tool executed: ${data.name}`,
            toolData: { name: data.name, result: data.result, args: data.args },
          });
        } else if (data.type === 'agent_log') {
          addTranscriptEntry({
            sender: 'system',
            text: `[Agent Log - ${data.fromAgent} → ${data.toAgent}]: ${data.message}`,
          });
        } else if (data.type === 'open_arcade') {
          window.dispatchEvent(new CustomEvent('jarvis:open-arcade', { detail: { gameId: data.gameId ?? null } }));
        } else if (data.type === 'task_routed') {
          addTranscriptEntry({ sender: 'system', text: routedLine(data.title, data.route, data.agents) });
        } else if (data.type === 'task_updated') {
          if (data.finalResult) postTaskResult(data);
        } else if (data.type === 'error') {
          setErrorMessage(data.error);
          setConnectionStatus('OFFLINE');
          setIsProcessing(false);
          stopMicCapture();
        }
      } catch (err) {
        console.error('Error handling WS message:', err);
      }
    };

    ws.onerror = () => {
      setErrorMessage('Failed to connect to J.A.R.V.I.S. voice uplink.');
      setConnectionStatus('OFFLINE');
      setIsProcessing(false);
      stopMicCapture();
    };

    ws.onclose = () => {
      setConnectionStatus('OFFLINE');
      setIsProcessing(false);
      stopMicCapture();
    };
  }, [voiceName, customDirective, isAudioMuted]);

  // Start Mic Audio Capture
  const startMicCapture = async () => {
    // One capture at a time: a second one would send two interleaved audio streams (garbled speech).
    if (micStartingRef.current || micStreamRef.current) return;
    micStartingRef.current = true;
    try {
      if (!playerRef.current) {
        playerRef.current = new LiveAudioPlayer();
        const { analyser } = playerRef.current.init();
        outputAnalyserRef.current = analyser;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      micStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioCtx();
      inputAudioCtxRef.current = inputCtx;

      const source = inputCtx.createMediaStreamSource(stream);
      const analyser = inputCtx.createAnalyser();
      analyser.fftSize = 256;
      inputAnalyserRef.current = analyser;

      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const resampled = downsampleBuffer(inputData, inputCtx.sampleRate, 16000);
        const base64Audio = float32ToPcm16Base64(resampled);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'audio', audio: base64Audio }));
        }
      };

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(inputCtx.destination);
    } catch (err) {
      setErrorMessage('Microphone access denied or unavailable.');
    } finally {
      micStartingRef.current = false;
    }
  };

  const stopMicCapture = () => {
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
  };

  const toggleConnection = async () => {
    if (connectionStatus === 'OFFLINE') {
      await startMicCapture();
      connectWebSocket();
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      stopMicCapture();
      if (playerRef.current) playerRef.current.interrupt();
      setConnectionStatus('OFFLINE');
      setIsProcessing(false);
    }
  };

  // Audio level meter animation
  useEffect(() => {
    let animId: number;
    const inputArr = new Uint8Array(32);
    const outputArr = new Uint8Array(32);

    const avg = (analyser: AnalyserNode | null, arr: Uint8Array<ArrayBuffer>, enabled: boolean) => {
      if (!analyser || !enabled) return 0;
      analyser.getByteFrequencyData(arr);
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i];
      return sum / arr.length / 255;
    };

    const updateLevel = () => {
      // Mic capture closes its AudioContext on stop; only read it while the stream is live.
      audioLevelsRef.current.input = avg(inputAnalyserRef.current, inputArr, !isMicMuted && !!micStreamRef.current);
      audioLevelsRef.current.output = avg(outputAnalyserRef.current, outputArr, !isAudioMuted);
      animId = requestAnimationFrame(updateLevel);
    };
    updateLevel();
    return () => cancelAnimationFrame(animId);
  }, [isMicMuted, isAudioMuted]);

  const addTranscriptEntry = (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => {
    setTranscriptEntries((prev) => [
      ...prev,
      {
        ...entry,
        id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ]);
  };

  const handleSendFrame = (base64Jpeg: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'video', video: base64Jpeg }));
    }
  };

  const handleSendText = (text: string) => {
    if (!text.trim()) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text }));
      setIsProcessing(true);
      addTranscriptEntry({ sender: 'user', text });
    } else {
      handleSendRestChat(text);
    }
  };

  // Manager routing in the conversation: which agent(s) took a request, and their result when done.
  const reportedTasks = useRef(new Set<string>());
  const watchedTasks = useRef(new Map<string, number>());
  const routedLine = (title: string, route: string, agents: string[] = []) =>
    `NEX routed "${String(title).slice(0, 60)}" → ${route === 'TASK_FORCE' ? `task force: ${agents.join(' + ')}` : `${agents[0] ?? 'a specialist'} (solo)`}`;
  const postTaskResult = (t: { id: string; title: string; finalResult?: string; status?: string; artifact?: { type: string; id: string; title: string } }) => {
    if (!t.finalResult || reportedTasks.current.has(t.id)) return;
    reportedTasks.current.add(t.id);
    const game = t.status === 'COMPLETED' && t.artifact?.type === 'game' ? t.artifact : null;
    addTranscriptEntry({
      sender: 'jarvis',
      text: `[NEX Task ${t.status === 'FAILED' ? 'Failed' : 'Completed'}: "${t.title}"]\n${t.finalResult}`,
      ...(game ? { action: { kind: 'play-game' as const, gameId: game.id, title: game.title } } : {}),
    });
    if (game) window.dispatchEvent(new Event('jarvis:games-changed'));
  };
  /** Text chat has no live socket, so poll the task the Manager just dispatched until it finishes. */
  const watchTask = (taskId: string) => {
    if (watchedTasks.current.has(taskId)) return;
    const stop = () => { window.clearInterval(watchedTasks.current.get(taskId)); watchedTasks.current.delete(taskId); };
    watchedTasks.current.set(taskId, window.setInterval(async () => {
      try {
        const t = ((await (await fetch('/api/tasks')).json()).tasks ?? []).find((x: any) => x.id === taskId);
        if (!t) return stop();
        if (t.status === 'COMPLETED' || t.status === 'FAILED') { stop(); postTaskResult(t); }
      } catch { /* server briefly unreachable: keep watching */ }
    }, 2000));
  };
  useEffect(() => () => { watchedTasks.current.forEach((iv) => window.clearInterval(iv)); watchedTasks.current.clear(); }, []);

  // Proactive JARVIS ("Boss, your download has finished") and the header's screen "looking" signal.
  // Polled, so they arrive with or without START AI; notices the voice session already spoke are skipped.
  const lastNotice = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d = await (await fetch(`/api/notices?since=${lastNotice.current ?? 0}`)).json();
        if (!alive) return;
        if (d.screenAt && Date.now() - d.screenAt < 3500) window.dispatchEvent(new Event('jarvis:screen-use'));
        const first = lastNotice.current === null; // on load: start from now, don't replay old notices
        lastNotice.current = d.last ?? 0;
        if (first) return;
        for (const n of d.notices ?? []) {
          if (n.spoken) continue;
          addTranscriptEntry({ sender: 'jarvis', text: n.text });
          if (voiceRef.current.enabled) speakReply(n.text);
        }
      } catch { /* server briefly unreachable */ }
    };
    poll();
    const iv = window.setInterval(poll, 2500);
    return () => { alive = false; window.clearInterval(iv); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Speak a typed-chat reply in JARVIS's voice (server: rewrite for speech → emotion → Gemini TTS). */
  const speakReply = async (text: string, emotion?: string) => {
    try {
      const r = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, emotion }) });
      const d = await r.json();
      if (!r.ok || !d.audio) { if (d.error) console.warn('[Voice]', d.error); return; }
      if (!playerRef.current) {
        playerRef.current = new LiveAudioPlayer();
        outputAnalyserRef.current = playerRef.current.init().analyser; // the Core Orb reacts to it too
      }
      playerRef.current.playChunk(d.audio);
    } catch { /* speech is optional: the reply is already on screen */ }
  };

  const handleSendRestChat = async (text: string) => {
    if (!text.trim() || isLoadingRest) return;
    setIsLoadingRest(true);
    addTranscriptEntry({ sender: 'user', text });

    try {
      const history = recentHistory();
      playerRef.current?.interrupt(); // a new message cuts off a reply that's still being spoken
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      if (data.routed) addTranscriptEntry({ sender: 'system', text: routedLine(text, data.routed.route, data.routed.agents) });
      addTranscriptEntry({ sender: 'jarvis', text: data.text });
      if (voiceRef.current.enabled && voiceRef.current.speakTyped && data.text) speakReply(data.text, data.emotion);
      if (data.routed?.taskId) watchTask(data.routed.taskId);
      soundFX.playProtocolChirp();
    } catch (err: any) {
      setErrorMessage('REST Error communicating with J.A.R.V.I.S.');
    } finally {
      setIsLoadingRest(false);
    }
  };

  const handleDelegateTask = (prompt: string, targetAgent?: string) => {
    soundFX.playProtocolChirp();
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, targetAgent }),
    }).then(() => {
      addTranscriptEntry({ sender: 'system', text: `Task delegated to NEX orchestrator: "${prompt}"` });
    });
  };

  const handleSelectNode = (node: CoreNode) => {
    if (node === 'SETTING') {
      setIsSettingsOpen(true);
    } else {
      setActiveNodeModal(node);
    }
  };

  return (
    <div className="h-screen w-screen max-h-screen overflow-hidden flex flex-col bg-[var(--jv-bg)] text-cyan-100 select-none">
      {/* 1. BRANDING & HEADER */}
      <TitleBar
        status={connectionStatus}
        onToggleConnection={toggleConnection}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenLogs={() => setIsLogsOpen(true)}
        onOpenApiSettings={() => setIsApiSettingsOpen(true)}
      />

      {/* 2. STRICT 3-COLUMN OBSIDIAN PANEL LAYOUT (Fits within 100vh Viewport Grid) */}
      <main className="flex-1 w-full h-[calc(100vh-44px)] p-2 grid grid-cols-12 gap-2 overflow-hidden">
        {/* LEFT COLUMN: MediaLink, SatLink, Headlines */}
        <section className="col-span-12 lg:col-span-3 h-full flex flex-col gap-2 min-h-0 overflow-hidden">
          <JarvisPCPanel onSendFrame={handleSendFrame} isLiveActive={connectionStatus !== 'OFFLINE'} />
          <SatLinkPanel />
          <HeadlinesPanel />
        </section>

        {/* CENTER COLUMN: CoreOrb, AgentTown */}
        <section className="col-span-12 lg:col-span-5 h-full flex flex-col gap-2 min-h-0 overflow-hidden">
          <CoreOrb
            status={connectionStatus}
            levels={audioLevelsRef}
            isProcessing={isProcessing || isLoadingRest}
            isMicMuted={isMicMuted}
            onToggle={toggleConnection}
            onToggleMic={() => setIsMicMuted((m) => !m)}
            onSelectNode={handleSelectNode}
            error={errorMessage}
          />
          <AgentTown
            onDispatchTask={handleDelegateTask}
            onOpenChat={() => {
              const inputEl = document.querySelector('.jv-prompt-input') as HTMLInputElement | null;
              inputEl?.focus();
            }}
          />
        </section>

        {/* RIGHT COLUMN: Conversation (top) / Mission Queue (bottom) / command bar */}
        <section className="jv-dash col-span-12 lg:col-span-4 h-full">
          <div className="jv-dash-top">
            <div>
              <LiveTerminal
                entries={transcriptEntries}
                interimText={interimUserText}
                onClear={() => setTranscriptEntries([])}
                onSystemMessage={(text) => addTranscriptEntry({ sender: 'system', text })}
                voice={{
                  status: connectionStatus,
                  processing: isProcessing || isLoadingRest,
                  error: errorMessage,
                  micMuted: isMicMuted,
                  levels: audioLevelsRef,
                }}
                onToggleMic={() => setIsMicMuted((m) => !m)}
                onToggleConnection={toggleConnection}
              />
            </div>
          </div>
          <div className="jv-dash-mid">
            <div>
              <MissionQueue />
            </div>
          </div>
          <CommandBar
            onSend={handleSendText}
            isLoading={isLoadingRest}
            error={errorMessage}
            isLive={connectionStatus !== 'OFFLINE'}
            micMuted={isMicMuted}
            onToggleMic={() => setIsMicMuted((m) => !m)}
            onStartVoice={toggleConnection}
          />
        </section>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentVoice={voiceName}
        onSaveVoice={(v, d) => {
          setVoiceName(v);
          setCustomDirective(d);
        }}
      />

      {/* System Logs (Manager routing + server terminal) and API Settings, opened from the header */}
      {isLogsOpen && <SystemLogsModal onClose={() => setIsLogsOpen(false)} />}
      {arcade && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setArcade(null)}>
          <div className="w-full max-w-4xl h-[86vh] flex flex-col gap-2" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="JARVIS Arcade">
            <div className="flex justify-end shrink-0">
              <button onClick={() => setArcade(null)} className="flex items-center gap-1 px-2.5 py-1 rounded border border-[#263040] text-slate-300 hover:text-white hover:border-cyan-500/50 text-[11px] font-mono cursor-pointer" aria-label="Close JARVIS Arcade">
                <X className="w-3.5 h-3.5" />CLOSE
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col jv-dash">
              <JarvisArcade key={arcade.gameId ?? 'menu'} initialGame={arcade.gameId} />
            </div>
          </div>
        </div>
      )}
      {isApiSettingsOpen && <ApiSettingsModal onClose={() => setIsApiSettingsOpen(false)} />}
      {setup && !setup.configured && <InitialSetup status={setup} onDone={() => fetchSetup().then(setSetup).catch(() => {})} />}

      {/* Node Details Modal (MEMORY, SKILLS, SOUL) */}
      {activeNodeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`bg-[#0b1018] border-2 border-cyan-500/60 rounded-xl p-5 w-full shadow-2xl relative max-h-[88vh] overflow-y-auto ${activeNodeModal === 'MEMORY' ? 'max-w-md' : 'max-w-lg'}`} role="dialog" aria-modal="true" aria-label={`${activeNodeModal} node`}>
            <button
              onClick={() => setActiveNodeModal(null)}
              className="absolute top-3 right-3 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {activeNodeModal === 'MEMORY' && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Database className="w-5 h-5 text-cyan-400" />
                  <h3 className="font-mono-tech text-sm font-bold text-cyan-100 uppercase">
                    HOLOGRAPHIC MEMORY VAULT
                  </h3>
                </div>
                <MemoryVault />
              </div>
            )}

            {activeNodeModal === 'SKILLS' && <SkillsPanel />}

            {activeNodeModal === 'THINKING' && <ThinkingPanel />}

            {activeNodeModal === 'SOUL' && <SoulPanel />}

            <button
              onClick={() => setActiveNodeModal(null)}
              className="w-full py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold font-mono text-xs uppercase rounded cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
