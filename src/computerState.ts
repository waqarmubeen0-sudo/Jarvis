// Live computer-mode state from the backend router (/api/computer/stream, Server-Sent Events).
// One shared connection; state and screen frames are separate subscriptions so components that
// only show the mode don't re-render on every frame.
import { useSyncExternalStore } from 'react';

export type ComputerMode = 'DIRECT' | 'ORBIT';
export type OrbitState = 'OFF' | 'STARTING' | 'READY' | 'ACTIVE' | 'IDLE' | 'STOPPING';

export interface ComputerSnapshot {
  mode: ComputerMode;
  modeChangedAt: string;
  session: { type: ComputerMode; browser: string; desktop: string };
  orbit: {
    state: OrbitState;
    activity: { actor: string; status: string; action: string; url?: string } | null;
    url: string;
    title: string;
    error?: string;
    profile: string;
  };
  direct: { lastAction: { text: string; at: string } | null };
}

let snapshot: ComputerSnapshot | null = null;
let frame: string | null = null;
const stateSubs = new Set<() => void>();
const frameSubs = new Set<() => void>();
let source: EventSource | null = null;

function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/computer/stream'); // reconnects automatically if the server restarts
  source.addEventListener('state', (e) => {
    snapshot = JSON.parse((e as MessageEvent).data);
    stateSubs.forEach((f) => f());
  });
  source.addEventListener('frame', (e) => {
    frame = (e as MessageEvent).data || null;
    frameSubs.forEach((f) => f());
  });
  // A dropped stream keeps the last known state while EventSource reconnects (the server sends the
  // fresh state on reconnect). Clearing it here made the UI fall back to DIRECT and flip back to
  // ORBIT on every blip, which swapped the panel's buttons and stopped the user's camera.
}

const sub = (set: Set<() => void>) => (cb: () => void) => {
  connect();
  set.add(cb);
  return () => { set.delete(cb); };
};
const subscribeState = sub(stateSubs);
const subscribeFrame = sub(frameSubs);

/** Current mode / Orbit lifecycle / activity (null until the first update arrives). */
export const useComputerState = () => useSyncExternalStore(subscribeState, () => snapshot);
/** Latest Orbit screen as base64 JPEG (null when Orbit is off). */
export const useComputerFrame = () => useSyncExternalStore(subscribeFrame, () => frame);

/** Explicit switch from the UI. */
export async function requestMode(mode: ComputerMode) {
  const res = await fetch('/api/computer/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`Mode switch failed (HTTP ${res.status})`);
}
