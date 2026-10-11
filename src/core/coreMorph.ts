// Turns the real JARVIS state (connection status, processing flag, live mic / voice levels,
// errors, node clicks) into the smoothly-varying parameters both core renderers read.
// No rendering here: one instance per core, updated once per animation frame.

export type CoreStatus = 'OFFLINE' | 'CONNECTING' | 'ONLINE' | 'LISTENING' | 'SPEAKING';

/** Morph states — indices into CoreDrive.w (the shader blends these fields). */
export const FLOWER = 0, VORTEX = 1, BURST = 2, ORBITAL = 3, BRANCH = 4, BLOOM = 5, MIXED = 6;
const N_STATES = 7;
/** Ambient cycle when nothing else is happening. BLOOM is event-driven, never held. */
const CYCLE = [FLOWER, VORTEX, BURST, ORBITAL, BRANCH, MIXED];
const HOLD = 8; // seconds per state
const FADE = 3.5; // crossfade seconds at the end of each hold

/** Channel emphasis per morph state: [MEMORY, SKILLS, THINKING, SOUL, SETTING]. */
const CHAN: number[][] = [
  [0.15, 0.6, 0.35, 1.0, 0.1], // flower: warm orange / gold
  [0.1, 0.15, 1.0, 0.35, 0.05], // vortex: crimson
  [0.1, 1.0, 0.1, 0.35, 0.15], // burst: gold
  [0.8, 0.5, 0.15, 0.3, 0.35], // orbital: cyan + gold
  [0.9, 0.2, 0.7, 0.15, 0.3], // branching: cyan + red
  [0.9, 1.0, 0.2, 0.3, 0.3], // bloom: cyan + gold
  [0.8, 0.5, 0.9, 0.7, 0.5], // mixed vortex: all five
];

/** Seconds a node pulse takes to travel node → glass (0..0.6) → centre (0.6..1). */
const BURST_DUR = 1.1;
export const BURST_ENTRY = 0.6;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (dt: number, k: number) => 1 - Math.exp(-dt * k);
const smooth = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
/** Smooth 0→1→0 bump peaking at x=1 (lub-dub heartbeat). */
const bump = (x: number) => (x <= 0 ? 0 : x * Math.exp(1 - x));
const arch = (x: number, len: number) => (x < 0 || x > len ? 0 : Math.sin((Math.PI * x) / len));

export interface DriveInput {
  status: CoreStatus;
  isProcessing: boolean;
  isMicMuted: boolean;
  input: number; // raw mic level 0..1
  output: number; // raw JARVIS voice level 0..1
}

export class CoreDrive {
  /** Morph weights (sum ≈ 1). */
  readonly w = new Float32Array(8);
  /** Per-channel colour intensity, node order. */
  readonly chan = new Float32Array(5);
  /** Per-node energy pulse progress: -1 idle, else 0..1 (see BURST_ENTRY). */
  readonly burst = new Float32Array(5).fill(-1);

  energy = 0; // live voice (either direction), fast attack / slow release
  beat = 0; // heartbeat envelope
  think = 0; // user speaking / listening
  proc = 0; // processing
  speak = 0; // JARVIS responding
  err = 0; // error disturbance
  online = 0;
  breath = 0;
  glow = 1;
  outward = 0; // particle burst outward
  collapse = 0; // particle collapse inward
  flow = 0.12; // stream pulse speed
  clock = 0; // real seconds
  neuralT = 0; // integrated neural time (speed varies without jumps)
  rot = 0; // very slow overall rotation
  newWave = 0; // >0 on frames that spawn a heartbeat shockwave
  pulse = 0; // integrated nucleus pulse phase: each whole number = one wave out to the glass
  beatAge = 10; // seconds since the last heartbeat (drives the shader's beat wave)

  private target = new Float32Array(8);
  private act = new Float32Array(5);
  private prevBurst = new Float32Array(5).fill(-1);
  private clickAt = [-100, -100, -100, -100, -100];
  private cycleT = 0;
  private slow = 0;
  private lastBeat = -10;
  private beatStr = 0;
  private bloomAt = -100;
  private errAt = -100;
  private speaking = false;
  private pendingWave = 0;

  constructor() {
    this.w[FLOWER] = 1;
  }

  /** START AI / power pressed. */
  surge() {
    this.lastBeat = this.clock;
    this.beatStr = 1;
    this.pendingWave = 1;
    this.bloomAt = this.clock;
  }

  error() {
    this.errAt = this.clock;
  }

  click(i: number) {
    this.clickAt[i] = this.clock;
  }

  update(dt: number, s: DriveInput) {
    this.clock += dt;
    const t = this.clock;
    this.newWave = this.pendingWave;
    this.pendingWave = 0;

    this.online += ((s.status !== 'OFFLINE' ? 1 : 0) - this.online) * ease(dt, 3);
    // Missing / NaN / unsupported audio reads as silence -> state-based animation only.
    const inRaw = Number.isFinite(s.input) ? s.input : 0;
    const outRaw = Number.isFinite(s.output) ? s.output : 0;
    const inN = s.isMicMuted ? 0 : clamp01((inRaw - 0.03) * 3.2);
    const outN = clamp01((outRaw - 0.02) * 3);
    const target = Math.max(inN, outN);
    this.energy += (target - this.energy) * ease(dt, target > this.energy ? 30 : 3.5);
    this.slow += (target - this.slow) * ease(dt, 2.5);

    const thinkT = clamp01(inN * 1.6 + (s.status === 'LISTENING' ? 0.35 : 0));
    this.think += (thinkT - this.think) * ease(dt, thinkT > this.think ? 8 : 1.5);
    const speakT = s.status === 'SPEAKING' ? Math.max(0.35, outN) : 0;
    this.speak += (speakT - this.speak) * ease(dt, 6);
    if (speakT > 0 && !this.speaking) this.bloomAt = t; // response starts → bloom outward
    this.speaking = speakT > 0;
    const procT = s.isProcessing || s.status === 'CONNECTING' ? 1 : 0;
    this.proc += (procT - this.proc) * ease(dt, 3);
    const e = Math.exp(-(t - this.errAt) / 1.4);
    this.err = e < 0.01 ? 0 : e;

    // Heartbeat: fires on voice onsets and keeps beating while the voice is sustained.
    if (target > 0.16 && t - this.lastBeat > 0.3 && (target > this.slow + 0.12 || t - this.lastBeat > 0.75)) {
      this.lastBeat = t;
      this.beatStr = Math.min(1, 0.45 + target);
      this.newWave = Math.max(this.newWave, this.beatStr);
    }
    // No live voice: a subtle simulated heartbeat keeps the core alive; processing beats
    // faster and harder. (No newWave: the outer shock rings stay reserved for real voice.)
    else if (target <= 0.16) {
      const gap = this.proc > 0.3 ? 0.7 : this.think > 0.3 ? 1.1 : 1.8;
      if (t - this.lastBeat > gap) {
        this.lastBeat = t;
        this.beatStr = 0.22 + 0.6 * this.proc + 0.2 * this.speak + 0.15 * this.think;
      }
    }
    const bt = t - this.lastBeat;
    this.beat = this.beatStr * (bump(bt / 0.06) + 0.6 * bump((bt - 0.2) / 0.07));
    this.breath = 0.5 + 0.5 * Math.sin(t * 1.3);

    // ---- Morph targets: ambient cycle, biased by what JARVIS is actually doing ----
    const tg = this.target;
    tg.fill(0);
    this.cycleT += dt * (1 + this.proc * 0.8 + this.think * 0.5);
    const pos = this.cycleT / HOLD;
    const idx = Math.floor(pos) % CYCLE.length;
    const fb = smooth(1 - FADE / HOLD, 1, pos - Math.floor(pos));
    tg[CYCLE[idx]] += 1 - fb;
    tg[CYCLE[(idx + 1) % CYCLE.length]] += fb;

    const bsum = this.think + this.proc + this.speak;
    if (bsum > 0.001) {
      const k = Math.min(1, bsum) * 0.8;
      for (let i = 0; i < N_STATES; i++) tg[i] *= 1 - k;
      tg[BRANCH] += (k * this.think * 0.55) / bsum;
      tg[BURST] += (k * this.think * 0.45) / bsum;
      tg[VORTEX] += (k * this.proc * 0.5) / bsum;
      tg[MIXED] += (k * this.proc * 0.5) / bsum;
      tg[BLOOM] += (k * this.speak * 0.6) / bsum;
      tg[FLOWER] += (k * this.speak * 0.4) / bsum;
    }
    // Brief blooms: response start / START AI, plus a deterministic ambient bloom every 41s.
    const ev = Math.max(arch(t % 41, 3), arch(t - this.bloomAt, 2.8));
    if (ev > 0) {
      for (let i = 0; i < N_STATES; i++) tg[i] *= 1 - ev * 0.7;
      tg[BLOOM] += ev * 0.7;
    }
    if (this.err > 0) tg[VORTEX] += this.err * 0.6; // instability

    let sum = 0;
    for (let i = 0; i < N_STATES; i++) sum += tg[i];
    const m = ease(dt, 1.6);
    for (let i = 0; i < N_STATES; i++) this.w[i] += (tg[i] / sum - this.w[i]) * m;

    // ---- Node pulses: deterministic schedule + clicks; arrival energises that channel ----
    for (let i = 0; i < 5; i++) {
      const period = 6.5 + i * 1.7;
      const ph = (t + i * 2.3) % period;
      let b = ph < BURST_DUR ? ph / BURST_DUR : -1;
      const cb = (t - this.clickAt[i]) / 0.9;
      if (cb >= 0 && cb < 1) b = Math.max(b, cb);
      this.burst[i] = b;
      if (b >= BURST_ENTRY && this.prevBurst[i] < BURST_ENTRY) this.act[i] += 0.8;
      this.prevBurst[i] = b;
    }

    for (let c = 0; c < 5; c++) {
      let base = 0;
      for (let st = 0; st < N_STATES; st++) base += this.w[st] * CHAN[st][c];
      this.act[c] *= Math.exp(-dt * 1.8);
      this.chan[c] = 0.12 + base + this.act[c] * 0.9;
    }
    this.chan[0] += this.think * 0.4; // MEMORY cyan while listening
    this.chan[2] += this.think * 0.3 + this.proc * 0.5 + this.err * 1.5; // THINKING red

    this.glow = Math.min(
      1.8,
      (0.92 + 0.12 * this.online) * (0.86 + 0.14 * this.breath) +
        this.energy * 0.55 + this.beat * 0.35 + this.proc * 0.25 + this.speak * 0.3
    );
    this.neuralT += dt * (0.32 + this.proc * 0.55 + this.think * 0.45 + this.energy * 0.35 + this.speak * 0.25 + this.err * 1.2);
    this.pulse += dt * (0.2 + this.proc * 0.35 + this.think * 0.25 + this.energy * 0.4 + this.speak * 0.3);
    this.beatAge = t - this.lastBeat;
    this.rot += dt * (0.035 + this.proc * 0.12 + this.energy * 0.08);
    this.flow = 0.12 + this.energy * 0.45 + this.proc * 0.3 + this.think * 0.2;
    this.outward = Math.max(this.beat * 0.8, ev * 0.6);
    this.collapse = arch((t + 7) % 23, 1.6) + this.proc * 0.15;
  }
}
