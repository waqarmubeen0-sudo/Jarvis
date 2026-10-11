// WebGL2 renderer for the core orb: a true 3D energy reactor.
//
// Three passes into one canvas:
//   1. Light   - full-screen pass: dark backing, volumetric orange haze, blazing centre,
//                soft light rays and the glow where the merged pipe feeds in.
//   2. Loops   - 3D energy ribbons (flower petals through the core, an outer cage of
//                great circles, fast comet trails). Built as instanced triangle strips whose
//                points are computed on the GPU each frame, rotated in 3D and projected with
//                perspective, so they genuinely pass in front of and behind the core.
//   3. Embers  - several hundred glowing particles orbiting the core in 3D.
// Passes 2-3 blend additively, so crossings burn hotter like real light.
// Returns null when WebGL2 is unavailable (the 2D overlay then draws a simple fallback).

import type { CoreDrive } from './coreMorph';
import type { InnerStreams } from './coreOverlay';

const SEG = 120; // points per loop
const N_PETAL = 7, N_INNER = 7, N_SHELL = 14, N_TRAIL = 8;
const N_LOOP = N_PETAL + N_INNER + N_SHELL + N_TRAIL;
const N_EMBER = 600;

/** Shared GLSL: hashing and the 3D loop / orbit definitions. */
const COMMON = `
#define TAU 6.2831853
const float NP = ${N_PETAL}.0, NI = ${N_INNER}.0, NS = ${N_SHELL}.0;
uniform vec2 uRes;      // canvas size, device px
uniform vec2 uCenter;   // orb centre, device px (GL y-up)
uniform float uR;       // orb radius, device px
uniform float uT;       // motion clock (integrated: speeds up with activity, never jumps)
uniform float uClock;   // real seconds
uniform float uScale;   // breathing + heartbeat expansion
uniform float uBeat, uEnergy, uSpeak, uProc, uThink, uGlow, uErr;
uniform mat3 uM;        // global 3D orientation of the reactor
float h(float n) { return fract(sin(n * 127.1 + 11.3) * 43758.5453); }

// Orthonormal basis of a circle whose plane has normal n.
void basis(vec3 n, out vec3 e1, out vec3 e2) {
  e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  e2 = cross(n, e1);
}

// Point at phase u (0..1) on loop i, in reactor space (radius ~1).
vec3 loopPoint(float i, float u) {
  float ph = u * TAU;
  if (i < NP + NI) {
    // Petals: circles that pass through the core, fanned around it like the reference
    // flower; each is tipped slightly out of plane so the rosette has real depth.
    bool inner = i >= NP;
    float k = inner ? i - NP : i, n = inner ? NI : NP;
    float a = k * TAU / n + (inner ? TAU / (2.0 * n) : 0.0);
    float ra = (inner ? 0.25 : 0.44) + 0.035 * sin(uT * 0.5 + i * 1.3);
    float R = ra * 1.06;
    vec3 dir = normalize(vec3(cos(a), sin(a), (inner ? 0.55 : 0.32) * sin(i * 1.7 + uT * 0.35)));
    vec3 ax = normalize(vec3(0.28 * sin(i * 2.3 + uT * 0.2), 0.28 * cos(i * 1.9 + uT * 0.17), 1.0));
    vec3 b = normalize(cross(ax, dir));
    return dir * ra + R * (cos(ph) * dir + sin(ph) * b);
  }
  // Cage loops and comet trails: tilted circles precessing slowly around the core.
  bool cage = i < NP + NI + NS;
  float k = i - NP - NI - (cage ? 0.0 : NS);
  float sd = k + (cage ? 0.0 : 40.0);
  vec3 n = normalize(vec3(h(sd) - 0.5, h(sd + 7.1) - 0.5, h(sd + 3.3) - 0.5));
  float pa = uT * (cage ? 0.12 : 0.3) * (0.5 + h(sd + 1.9));
  n = normalize(vec3(n.x * cos(pa) - n.z * sin(pa), n.y, n.x * sin(pa) + n.z * cos(pa)));
  vec3 e1, e2;
  basis(n, e1, e2);
  float r = cage ? 0.86 + 0.12 * h(sd + 5.5) : 0.42 + 0.42 * h(sd + 9.1);
  return r * (cos(ph) * e1 + sin(ph) * e2);
}

// Reactor space -> screen offset from the centre (orb radii), with perspective. z: +near.
vec3 project(vec3 P) {
  P = uM * P * uScale;
  float f = 3.2 / (3.2 - P.z);
  return vec3(P.xy * f, P.z);
}
`;

const LIGHT_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const LIGHT_FS = `#version 300 es
precision highp float;
${COMMON}
uniform vec3 uMix;     // blended colour of the liquid arriving through the pipe
uniform float uFeed;   // how strongly the pipe is feeding
out vec4 o;
void main() {
  vec2 p = (gl_FragCoord.xy - uCenter) / uR;
  float r = length(p), th = atan(p.y, p.x);
  float lvl = uGlow * (1.0 + 0.9 * uEnergy + 0.5 * uSpeak + 0.35 * uProc + 0.25 * uThink);
  float surge = 1.0 + 1.6 * uBeat;
  vec3 c = vec3(0.0);
  c += vec3(1.0, 0.3, 0.05) * exp(-r * r * 2.2) * 0.45 * lvl;                        // haze filling the orb
  c += vec3(1.0, 0.52, 0.12) * exp(-r / (0.22 + 0.05 * uBeat)) * 0.8 * lvl * surge;  // volumetric light
  float rays = pow(0.5 + 0.5 * cos(th * 9.0 + uT * 0.6), 4.0) * 0.6 + pow(0.5 + 0.5 * cos(th * 14.0 - uT * 0.4), 6.0) * 0.4;
  c *= 1.0 + rays * exp(-r * 1.6) * 0.6;                                             // soft light shafts
  c += vec3(1.0, 0.93, 0.75) * exp(-r * r / (0.004 * (1.0 + 1.8 * uBeat + uSpeak + 0.6 * uEnergy))) * 1.7 * lvl; // white-hot heart
  c += vec3(1.0, 0.38, 0.07) * exp(-abs(r - 0.96) / 0.07) * 0.07 * lvl;            // faint edge of the field
  float de = length(p - vec2(-0.97, 0.0));
  c += uMix * (exp(-de * de / 0.008) * 0.9 + exp(-de / 0.12) * 0.2) * uFeed;       // pipe feeding in
  c = mix(c, vec3(1.0, 0.1, 0.06) * (dot(c, vec3(0.4)) + 0.05), uErr * 0.6);
  float back = 0.55 * smoothstep(1.3, 0.5, r);                                      // dark backing for contrast
  o = vec4(min(c, vec3(1.0)), min(1.0, max(back, max(c.r, max(c.g, c.b)))));
}`;

const LOOP_VS = `#version 300 es
precision highp float;
${COMMON}
layout(location = 0) in float aU;
layout(location = 1) in float aSide;
layout(location = 2) in float aLoop;
out float vSide, vU, vZ, vRs, vLoop;
void main() {
  float du = 0.5 / ${SEG}.0;
  vec3 a = project(loopPoint(aLoop, aU - du));
  vec3 b = project(loopPoint(aLoop, aU + du));
  vec3 m = project(loopPoint(aLoop, aU));
  vec2 tng = normalize((b.xy - a.xy) + 1e-6);
  vec2 nrm = vec2(-tng.y, tng.x);
  float kind = aLoop < NP ? 0.0 : aLoop < NP + NI ? 1.0 : aLoop < NP + NI + NS ? 2.0 : 3.0;
  float w = (kind == 0.0 ? 9.5 : kind == 1.0 ? 7.5 : kind == 2.0 ? 5.5 : 7.0);
  w *= clamp(uR / 150.0, 0.6, 2.0) * (0.75 + 0.35 * (m.z + 1.0) * 0.5) * (1.0 + 0.4 * uBeat);
  vec2 px = uCenter + m.xy * uR + nrm * aSide * w;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vSide = aSide; vU = aU; vZ = m.z; vRs = length(m.xy); vLoop = aLoop;
}`;

const LOOP_FS = `#version 300 es
precision highp float;
${COMMON}
in float vSide, vU, vZ, vRs, vLoop;
out vec4 o;
void main() {
  float kind = vLoop < NP ? 0.0 : vLoop < NP + NI ? 1.0 : vLoop < NP + NI + NS ? 2.0 : 3.0;
  float prof = exp(-vSide * vSide / 0.025) + 0.45 * exp(-abs(vSide) * 2.6) * (1.0 - vSide * vSide);
  // Energy flowing along each loop: a bright head with a fading tail.
  float head = fract(vU - uT * (0.28 + 0.3 * h(vLoop)) * (kind == 3.0 ? 2.2 : 1.0) - h(vLoop + 4.0));
  float I = kind == 0.0 ? 0.75 + 1.4 * pow(head, 5.0)
          : kind == 1.0 ? 0.55 + 1.1 * pow(head, 5.0)
          : kind == 2.0 ? 0.28 + 0.6 * pow(head, 6.0)
          : 1.5 * pow(head, 9.0);
  // Depth: far side dimmer, and hidden behind the blazing core.
  float dz = mix(0.3, 1.0, smoothstep(-0.85, 0.85, vZ));
  if (vZ < 0.0) dz *= 1.0 - 0.75 * smoothstep(0.24, 0.05, vRs);
  I *= dz * uGlow * (1.0 + 1.5 * uBeat + 0.8 * uEnergy + 0.4 * uSpeak + 0.3 * uProc);
  vec3 col = mix(vec3(1.0, 0.4, 0.06), vec3(1.0, 0.82, 0.36), clamp(I * 0.6, 0.0, 1.0)) * I * prof * 1.05;
  col = mix(col, vec3(1.0, 0.1, 0.06) * dot(col, vec3(0.5)), uErr * 0.6);
  o = vec4(col, max(col.r, max(col.g, col.b)) * 0.7);
}`;

const EMBER_VS = `#version 300 es
precision highp float;
${COMMON}
layout(location = 3) in float aId;
out float vA, vHot;
void main() {
  float h1 = h(aId), h2 = h(aId + 1.7), h3 = h(aId + 3.9), h4 = h(aId + 8.2);
  bool outer = h1 > 0.75; // a quarter drift as embers just outside the field
  float r0 = outer ? mix(1.0, 1.35, h2) : mix(0.12, 1.0, sqrt(h2));
  vec3 n = normalize(vec3(h3 - 0.5, h4 - 0.5, h(aId + 5.1) - 0.5));
  vec3 e1, e2;
  basis(n, e1, e2);
  float ang = h3 * TAU + uT * (0.35 + 0.9 * h4) * (outer ? 0.35 : 1.0) / (0.4 + r0);
  // Heartbeat throws embers outward, then they fall back in.
  float r = r0 * (1.0 + (0.14 + 0.1 * h4) * uBeat) * (1.0 + 0.03 * sin(uClock * 1.3 + h1 * 6.0));
  vec3 m = project(r * (cos(ang) * e1 + sin(ang) * e2));
  gl_Position = vec4((uCenter + m.xy * uR) / uRes * 2.0 - 1.0, 0.0, 1.0);
  float depth = 0.45 + 0.55 * (m.z + 1.0) * 0.5;
  gl_PointSize = (1.4 + 2.8 * h2 * h2) * clamp(uR / 150.0, 0.6, 2.0) * depth * (1.0 + 0.5 * uBeat);
  float tw = 0.55 + 0.45 * sin(uClock * (2.0 + 3.0 * h1) + h2 * 20.0);
  vA = tw * depth * (outer ? 0.5 : 1.0) * (1.0 + 0.8 * uEnergy + 0.6 * uBeat);
  vHot = outer ? 0.0 : 1.0 - r0;
}`;

const EMBER_FS = `#version 300 es
precision highp float;
uniform float uGlow, uErr;
in float vA, vHot;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 18.0) * vA * uGlow;
  vec3 col = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.88, 0.6), vHot) * a;
  col = mix(col, vec3(1.0, 0.12, 0.06) * dot(col, vec3(0.5)), uErr * 0.6);
  o = vec4(col, a * 0.6);
}`;

const COMMON_UNIFORMS = [
  'uRes', 'uCenter', 'uR', 'uT', 'uClock', 'uScale', 'uBeat', 'uEnergy', 'uSpeak', 'uProc', 'uThink', 'uGlow', 'uErr', 'uM',
] as const;
type Loc = Record<string, WebGLUniformLocation | null>;

export interface NeuralCoreGL {
  resize(cssW: number, cssH: number, dpr: number): void;
  render(d: CoreDrive, cx: number, cy: number, r: number, s: InnerStreams): void;
  /** Lower the render resolution one step; false when already at the floor. */
  degrade(): boolean;
  dispose(): void;
}

export function createNeuralCoreGL(canvas: HTMLCanvasElement, _nodeColors: string[]): NeuralCoreGL | null {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return null;

  type Prog = { p: WebGLProgram; loc: Loc };
  let light: Prog | null = null, loops: Prog | null = null, embers: Prog | null = null;
  let loopVao: WebGLVertexArrayObject | null = null, emberVao: WebGLVertexArrayObject | null = null;
  let bufs: WebGLBuffer[] = [];
  let scale = 1, cssW = 0, cssH = 0, lastDpr = 1;
  // ponytail: resolution cap steps down when frames run slow (see degrade); never steps back up.
  let cap = 1.5;
  const M = new Float32Array(9);

  const compile = (vsrc: string, fsrc: string, extra: string[]): Prog | null => {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost())
        console.error('[NeuralCore] shader error:', gl.getShaderInfoLog(s));
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, vsrc), fs = sh(gl.FRAGMENT_SHADER, fsrc);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) console.error('[NeuralCore] link error:', gl.getProgramInfoLog(p));
      gl.deleteProgram(p);
      return null;
    }
    const loc: Loc = {};
    [...COMMON_UNIFORMS, ...extra].forEach((u) => (loc[u] = gl.getUniformLocation(p, u)));
    return { p, loc };
  };

  const buffer = (data: Float32Array) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    bufs.push(b);
    return b;
  };

  const release = () => {
    [light, loops, embers].forEach((x) => x && gl.deleteProgram(x.p));
    if (loopVao) gl.deleteVertexArray(loopVao);
    if (emberVao) gl.deleteVertexArray(emberVao);
    bufs.forEach((b) => gl.deleteBuffer(b));
    light = loops = embers = null;
    loopVao = emberVao = null;
    bufs = [];
  };

  const init = () => {
    light = compile(LIGHT_VS, LIGHT_FS, ['uMix', 'uFeed']);
    loops = compile(LOOP_VS, LOOP_FS, []);
    embers = compile(EMBER_VS, EMBER_FS, []);
    if (!light || !loops || !embers) {
      release();
      return;
    }
    // Loop strip: (u, side) per vertex, loop index per instance.
    const strip = new Float32Array((SEG + 1) * 4);
    for (let j = 0; j <= SEG; j++) strip.set([j / SEG, -1, j / SEG, 1], j * 4);
    const ids = new Float32Array(N_LOOP).map((_, i) => i);
    loopVao = gl.createVertexArray();
    gl.bindVertexArray(loopVao);
    buffer(strip);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 8, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 8, 4);
    buffer(ids);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(2, 1);
    emberVao = gl.createVertexArray();
    gl.bindVertexArray(emberVao);
    buffer(new Float32Array(N_EMBER).map((_, i) => i));
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 4, 0);
    gl.bindVertexArray(null);
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    light = loops = embers = null;
    loopVao = emberVao = null;
    bufs = [];
  };
  const onRestored = () => init();
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  init();
  if (!light) return null;

  const setCommon = (pr: Prog, d: CoreDrive, cx: number, cy: number, r: number, sc: number) => {
    const l = pr.loc;
    gl.uniform2f(l.uRes, canvas.width, canvas.height);
    gl.uniform2f(l.uCenter, cx * scale, (cssH - cy) * scale);
    gl.uniform1f(l.uR, r * scale);
    gl.uniform1f(l.uT, d.neuralT);
    gl.uniform1f(l.uClock, d.clock);
    gl.uniform1f(l.uScale, sc);
    gl.uniform1f(l.uBeat, d.beat);
    gl.uniform1f(l.uEnergy, d.energy);
    gl.uniform1f(l.uSpeak, d.speak);
    gl.uniform1f(l.uProc, d.proc);
    gl.uniform1f(l.uThink, d.think);
    gl.uniform1f(l.uGlow, d.glow);
    gl.uniform1f(l.uErr, d.err);
    gl.uniformMatrix3fv(l.uM, false, M);
  };

  const api: NeuralCoreGL = {
    resize(w, h, dpr) {
      lastDpr = dpr;
      scale = Math.min(dpr, cap);
      cssW = w;
      cssH = h;
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
    },
    degrade() {
      if (cap <= 0.75) return false;
      cap = Math.max(0.75, Math.min(cap, lastDpr) - 0.25);
      api.resize(cssW, cssH, lastDpr);
      return true;
    },
    render(d, cx, cy, r, s) {
      if (!light || !loops || !embers) return;
      // Orientation: steady spin about the view axis, gently wobbling tilt for 3D parallax.
      const spin = d.neuralT * 0.22, tilt = 0.32 + 0.18 * Math.sin(d.clock * 0.11), yaw = 0.3 * Math.sin(d.clock * 0.07);
      const cz = Math.cos(spin), sz = Math.sin(spin), cxr = Math.cos(tilt), sxr = Math.sin(tilt), cy_ = Math.cos(yaw), sy = Math.sin(yaw);
      // M = Ry(yaw) * Rx(tilt) * Rz(spin), column-major.
      const rz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
      const rx = [1, 0, 0, 0, cxr, sxr, 0, -sxr, cxr];
      const ry = [cy_, 0, -sy, 0, 1, 0, sy, 0, cy_];
      const mul = (a: number[], b: number[]) => {
        const out = new Array(9).fill(0);
        for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) for (let k = 0; k < 3; k++) out[c * 3 + rr] += a[k * 3 + rr] * b[c * 3 + k];
        return out;
      };
      M.set(mul(ry, mul(rx, rz)));
      // Breathing + physical heartbeat expansion.
      const sc = 0.93 * (1 + 0.025 * Math.sin(d.clock * 1.3)) * (1 + 0.07 * d.beat + 0.04 * d.energy);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.disable(gl.BLEND);
      gl.useProgram(light.p);
      setCommon(light, d, cx, cy, r, sc);
      let feed = 0;
      for (let i = 0; i < 5; i++) feed += s.on[i];
      gl.uniform3fv(light.loc.uMix, s.mix);
      gl.uniform1f(light.loc.uFeed, Math.min(1.2, feed * 0.3));
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(loops.p);
      setCommon(loops, d, cx, cy, r, sc);
      gl.bindVertexArray(loopVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2, N_LOOP);

      gl.useProgram(embers.p);
      setCommon(embers, d, cx, cy, r, sc);
      gl.bindVertexArray(emberVao);
      gl.drawArrays(gl.POINTS, 0, N_EMBER);
      gl.bindVertexArray(null);
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      // No forced context loss: StrictMode remounts reuse this same canvas/context.
      if (!gl.isContextLost()) release();
    },
  };
  return api;
}
