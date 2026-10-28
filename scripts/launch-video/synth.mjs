#!/usr/bin/env node
// Launch-video soundtrack: melodic techno, A minor, 124 BPM, 26 bars + tail.
// Pure JS DSP, zero dependencies. Usage: node synth.mjs --out <dir>
// Writes <dir>/track.wav (48 kHz 16-bit stereo), <dir>/track.json (bar grid), <dir>/preview-20-26.wav (bar 20 to the end).
// Director's cut: one continuous groove from bar 4 to the hit on 24 (no dropouts), then a clean A-minor end card that fades with a closing low-pass.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : '.';
const SR = 48000, BPM = 124, FPS = 30;
const BEAT = 60 / BPM, BAR = 4 * BEAT, STEP = BEAT / 4; // STEP = 1/16 note
const BARS = 26, END_BAR = 26.6;
const N = Math.round(END_BAR * BAR * SR);
const S = (t) => Math.round(t * SR); // seconds -> sample; every onset goes through this
const at = (bar, step = 0) => bar * BAR + step * STEP;
const TAU = Math.PI * 2;

// ---------- primitives ----------
let seed = 0x9e3779b9;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const hz = (n) => 440 * 2 ** ((12 * (+n.slice(-1) + 1) + NOTE[n[0]] - 69) / 12);
const up = (nm, o) => nm[0] + (+nm.slice(-1) + o);
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
const saw = (p, dt) => 2 * p - 1 - blep(p, dt);
const sq = (p, dt) => saw(p, dt) - saw((p + 0.5) % 1, dt);
const tri = (p) => 1 - 4 * Math.abs(p - 0.5);
const smooth = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const expLerp = (a, b, x) => a * (b / a) ** x;
const tail = (j, n, f = 480) => j > n - f ? (n - j) / f : 1; // linear release over the last f samples

// TPT state-variable filter (stable under fast modulation).
class SVF {
  constructor() { this.a = 0; this.b = 0; this.lp = 0; this.bp = 0; this.hp = 0; this.set(1000); }
  set(fc, q = 0.707) {
    const g = Math.tan(Math.PI * Math.min(fc, SR * 0.45) / SR); this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2; return this;
  }
  run(x) {
    const v3 = x - this.b, v1 = this.a1 * this.a + this.a2 * v3, v2 = this.b + this.a2 * this.a + this.a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2; return v2;
  }
}

// ---------- buses: scene A = bars 0..24, scene B = end card (own fx, so no reverb from the build smears the end card) ----------
const buf = () => new Float32Array(N);
const scene = () => ({ dL: buf(), dR: buf(), bass: buf(), pL: buf(), pR: buf(), lL: buf(), lR: buf(), sL: buf(), sR: buf(), rvL: buf(), rvR: buf(), dlL: buf(), dlR: buf() });
const A = scene(), B = scene();
const kicks = []; // {t, depth} for the sidechain
const put = (L, R, i, v, pan = 0) => { if (i < 0 || i >= N) return; L[i] += v * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2; R[i] += v * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2; };

// ---------- drums ----------
function kick(sc, t, { gain = 1, decay = 0.17, len = 0.45, depth = 0.6, L = sc.dL, R = sc.dR } = {}) {
  kicks.push({ t, depth });
  const i0 = S(t), n = Math.round(len * SR); let ph = 0;
  for (let j = 0; j < n && i0 + j < N; j++) {
    const s = j / SR; ph += TAU * (47 + 115 * Math.exp(-s / 0.03) + 60 * Math.exp(-s / 0.004)) / SR;
    const body = Math.tanh(1.6 * Math.sin(ph) * Math.exp(-s / decay)) / Math.tanh(1.6);
    const click = (noise() * 0.5 + Math.sin(TAU * 3200 * s)) * Math.exp(-s / 0.0012) * Math.min(1, j / 8) * 0.22;
    const v = gain * (body + click) * tail(j, n, 1440); L[i0 + j] += v; R[i0 + j] += v;
  }
}
function hat(sc, t, { gain = 0.2, decay = 0.03, pan = 0.15, fc = 7500 } = {}) {
  const i0 = S(t), n = Math.round(decay * 7 * SR), f = new SVF().set(fc, 0.8), f2 = new SVF().set(11000, 1.2);
  for (let j = 0; j < n; j++) {
    const x = noise(); f.run(x); f2.run(x);
    put(sc.dL, sc.dR, i0 + j, gain * (f.hp * 0.7 + f2.bp * 0.6) * Math.exp(-j / SR / decay) * Math.min(1, j / 24) * tail(j, n, 240), pan);
  }
}
function snare(sc, t, { gain = 0.3, pitch = 1, fc = 2400, rv = 0.15 } = {}) {
  const i0 = S(t), n = Math.round(0.22 * SR), f = new SVF().set(fc, 0.9); let ph = 0;
  for (let j = 0; j < n; j++) {
    const s = j / SR; ph += TAU * (190 * pitch + 60 * Math.exp(-s / 0.01)) / SR;
    f.run(noise());
    const v = gain * (Math.sin(ph) * Math.exp(-s / 0.045) * 0.6 + (f.bp + f.hp * 0.4) * Math.exp(-s / 0.07)) * Math.min(1, j / 16) * tail(j, n);
    put(sc.dL, sc.dR, i0 + j, v); put(sc.rvL, sc.rvR, i0 + j, v * rv);
  }
}
function clap(sc, t, gain = 0.32) {
  const i0 = S(t), n = Math.round(0.3 * SR), f = new SVF().set(1300, 1.4);
  for (let j = 0; j < n; j++) {
    const s = j / SR; let e = 0;
    for (const o of [0, 0.011, 0.022]) if (s >= o) e += Math.exp(-(s - o) / 0.0045);
    if (s >= 0.03) e += 0.8 * Math.exp(-(s - 0.03) / 0.085);
    f.run(noise());
    const v = gain * (f.bp * 1.6 + f.hp * 0.3) * e * Math.min(1, j / 16) * tail(j, n);
    put(sc.dL, sc.dR, i0 + j, v, -0.1); put(sc.rvL, sc.rvR, i0 + j, v * 0.3);
  }
}
// Short bright noise accent (stereo, decorrelated L/R).
function noiseHit(sc, t, { gain = 0.25, decay = 0.08, fc = 3000, rv = 0.25 } = {}) {
  const i0 = S(t), n = Math.round(decay * 7 * SR), fl = new SVF().set(fc, 0.7), fr = new SVF().set(fc, 0.7);
  for (let j = 0; j < n && i0 + j < N; j++) {
    fl.run(noise()); fr.run(noise());
    const e = gain * Math.exp(-j / SR / decay) * Math.min(1, j / 24) * tail(j, n);
    sc.dL[i0 + j] += fl.hp * e; sc.dR[i0 + j] += fr.hp * e;
    sc.rvL[i0 + j] += fl.hp * e * rv; sc.rvR[i0 + j] += fr.hp * e * rv;
  }
}
// Impact: sub boom + bright burst, ~300 ms (the video flashes white here).
function impact(sc, t, gain = 1) {
  const i0 = S(t), n = Math.round(0.34 * SR); let ph = 0;
  for (let j = 0; j < n; j++) {
    const s = j / SR; ph += TAU * (38 + 50 * Math.exp(-s / 0.05)) / SR;
    const v = gain * 0.55 * Math.sin(ph) * Math.exp(-s / 0.11) * Math.min(1, j / 48) * tail(j, n, 960);
    sc.dL[i0 + j] += v; sc.dR[i0 + j] += v;
  }
  noiseHit(sc, t, { gain: 0.42 * gain, decay: 0.06, fc: 2500, rv: 0 });
}
function riser(sc, t0, t1, { gain = 0.12, f0 = 400, f1 = 9000, sine = 0, s0 = 220, s1 = 1760 } = {}) {
  const i0 = S(t0), i1 = S(t1), fl = new SVF(), fr = new SVF(); let ph = 0;
  for (let i = i0; i < i1; i++) {
    const x = (i - i0) / (i1 - i0);
    if ((i & 15) === 0) { const fc = expLerp(f0, f1, x); fl.set(fc, 2.5); fr.set(fc * 1.04, 2.5); }
    fl.run(noise()); fr.run(noise());
    const e = gain * x * x * Math.min(1, (i1 - i) / 240);
    ph += TAU * expLerp(s0, s1, x) / SR; const sn = sine * Math.sin(ph) * x * Math.min(1, (i - i0) / 240, (i1 - i) / 240);
    sc.dL[i] += fl.bp * e + sn; sc.dR[i] += fr.bp * e + sn; sc.rvL[i] += fl.bp * e * 0.3; sc.rvR[i] += fr.bp * e * 0.3;
  }
}

// ---------- tonal ----------
function bassNote(sc, t, dur, f, { gain = 0.32, cut = 380, env = 1200, q = 2.2 } = {}) {
  const i0 = S(t), n = Math.round((dur + 0.02) * SR), nd = Math.round(dur * SR), flt = new SVF(), dt = f / SR; let p = 0;
  for (let j = 0; j < n && i0 + j < N; j++) {
    if ((j & 7) === 0) flt.set(cut + env * Math.exp(-j / SR / 0.07), q);
    p = (p + dt) % 1;
    const y = flt.run(saw(p, dt) * 0.6 + sq(p, dt) * 0.25) + Math.sin(TAU * p) * 0.45;
    sc.bass[i0 + j] += gain * y * Math.min(1, j / 144) * (j < nd ? 1 : 1 - (j - nd) / (n - nd));
  }
}
const DET = [-13, -6, 0, 6, 13], PAN = [-0.85, 0.45, 0, -0.45, 0.85];
function padChord(sc, t, dur, notes, { gain = 0.07, atk = 0.25, rel = 0.6 } = {}) {
  const i0 = S(t), nd = Math.round(dur * SR), n = nd + Math.round(rel * SR), na = Math.round(atk * SR);
  for (const nm of notes) DET.forEach((c, v) => {
    const f = hz(nm) * 2 ** (c / 1200), dt = f / SR, pan = PAN[(v + NOTE[nm[0]]) % 5]; let p = rnd();
    for (let j = 0; j < n && i0 + j < N; j++) {
      p += dt; if (p >= 1) p -= 1;
      put(sc.pL, sc.pR, i0 + j, saw(p, dt) * gain * smooth(j / na) * (j < nd ? 1 : smooth(1 - (j - nd) / (n - nd))), pan);
    }
  });
}
function stab(sc, t, notes, { gain = 0.06, decay = 0.12, rv = 0.3, dl = 0.15, bright = 5500 } = {}) {
  const i0 = S(t), n = Math.round(decay * 6 * SR);
  for (const nm of notes) for (const [c, pan] of [[-9, -0.7], [0, 0], [9, 0.7]]) {
    const dt = hz(nm) * 2 ** (c / 1200) / SR, flt = new SVF(); let p = rnd();
    for (let j = 0; j < n && i0 + j < N; j++) {
      const s = j / SR; if ((j & 7) === 0) flt.set(600 + bright * Math.exp(-s / (decay * 0.6)), 1.1);
      p = (p + dt) % 1;
      const v = gain * flt.run(saw(p, dt)) * Math.exp(-s / decay) * Math.min(1, j / 48) * tail(j, n);
      put(sc.sL, sc.sR, i0 + j, v, pan); put(sc.rvL, sc.rvR, i0 + j, v * rv, pan); put(sc.dlL, sc.dlR, i0 + j, v * dl, pan);
    }
  }
}
// Lead: triangle/saw (or pulse) with glide, late vibrato, dotted-1/8 delay + reverb sends.
function leadNote(sc, t, dur, f, prev, { gain = 0.11, wide = false, cut = 3800, rv = 0.28, dl = 0.32, pan = 0, pulse = false } = {}) {
  const i0 = S(t), nd = Math.round(dur * SR), n = nd + Math.round(0.14 * SR);
  for (const [c, pn] of wide ? [[-8, -0.9], [8, 0.9], [0, 0]] : [[0, pan]]) {
    const flt = new SVF(); let p = rnd();
    for (let j = 0; j < n && i0 + j < N; j++) {
      const s = j / SR;
      const glide = prev ? (prev / f) ** Math.exp(-s / 0.03) : 1;
      const vib = 1 + 0.004 * Math.sin(TAU * 5.2 * s) * smooth((s - 0.18) / 0.3);
      const dt = f * glide * vib * 2 ** (c / 1200) / SR;
      p += dt; if (p >= 1) p -= 1;
      if ((j & 7) === 0) flt.set(cut + 2200 * Math.exp(-s / 0.09), 0.9);
      const osc = pulse ? sq(p, dt) * 0.5 : tri(p) * 0.75 + saw(p, dt) * 0.3;
      const e = gain / (wide ? 1.6 : 1) * Math.min(1, j / 380) * (0.78 + 0.22 * Math.exp(-s / 0.12)) * (j < nd ? 1 : smooth(1 - (j - nd) / (n - nd)));
      const v = flt.run(osc) * e;
      put(sc.lL, sc.lR, i0 + j, v, pn); put(sc.rvL, sc.rvR, i0 + j, v * rv, pn); put(sc.dlL, sc.dlR, i0 + j, v * dl, pn);
    }
  }
}

// ---------- the song ----------
const PROG = [ // Am7, Fmaj7, Cmaj7, G6 — one per bar
  { root: 'A1', pad: ['A3', 'C4', 'E4', 'G4'], stab: ['A3', 'C4', 'E4'] },
  { root: 'F1', pad: ['F3', 'A3', 'C4', 'E4'], stab: ['F3', 'A3', 'C4'] },
  { root: 'C2', pad: ['G3', 'C4', 'E4', 'B4'], stab: ['G3', 'C4', 'E4'] },
  { root: 'G1', pad: ['G3', 'B3', 'D4', 'E4'], stab: ['G3', 'B3', 'D4'] },
];
const MOTIF = [ // [step, note, len] per chord bar
  [[0, 'E5', 3], [3, 'D5', 3], [6, 'C5', 6], [12, 'D5', 2], [14, 'E5', 2]],
  [[0, 'F5', 3], [3, 'E5', 3], [6, 'C5', 6], [12, 'A4', 4]],
  [[0, 'G5', 3], [3, 'E5', 3], [6, 'C5', 6], [12, 'D5', 2], [14, 'E5', 2]],
  [[0, 'D5', 3], [3, 'B4', 3], [6, 'G4', 4], [10, 'B4', 6]],
];
const COUNTER = [[[8, 'A4', 4], [12, 'G4', 4]], [[8, 'A4', 4], [12, 'F4', 4]], [[8, 'G4', 4], [12, 'E4', 4]], [[8, 'D4', 4], [12, 'B3', 4]]];

let lastLead = null; // {end, f}: glide only between touching notes
function playLine(sc, bar, notes, opts = {}, oct = 0) {
  for (const [st, nm, len] of notes) {
    const t = at(bar, st), f = hz(up(nm, oct));
    const prev = lastLead && Math.abs(lastLead.end - t) < STEP * 0.6 ? lastLead.f : null;
    leadNote(sc, t, len * STEP * 0.92, f, prev, opts); lastLead = { end: t + len * STEP, f };
  }
}

A.kL = buf(); A.kR = buf(); // muffled kick bus for bars 2-3
for (let bar = 0; bar < 24; bar++) {
  const c = PROG[bar % 4];
  padChord(A, at(bar), BAR, c.pad, { atk: bar === 0 ? 1.2 : 0.25, gain: bar < 4 ? 0.068 : 0.052 }); // darker + quieter under the lead
  // bars 0-3: soft filtered 1/8 pulse, an octave above the bass, hints the tempo
  if (bar < 4) for (let e = 0; e < 8; e++)
    bassNote(A, at(bar, e * 2), STEP * 1.2, hz(up(c.root, 1)), { gain: (e % 2 ? 0.16 : 0.1) * (0.6 + 0.4 * bar / 3), cut: 160 + bar * 60, env: 300 + bar * 120, q: 1.2 });
  // kick on every beat, bars 2..23 (muffled 2-3 so the main scene already moves; full groove from 4)
  if (bar >= 2 && bar < 24) for (let b = 0; b < 4; b++) kick(A, at(bar, b * 4), bar < 4 ? { depth: 0.25, L: A.kL, R: A.kR } : {});
  // hats
  if (bar === 2) for (const b of [2, 3]) hat(A, at(bar, b * 4 + 2), { gain: 0.05 * b, decay: 0.05 });
  if (bar === 3) for (let b = 0; b < 4; b++) hat(A, at(bar, b * 4 + 2), { gain: 0.08 + 0.03 * b, decay: 0.06 });
  if (bar >= 4 && bar < 24) for (let b = 0; b < 4; b++) {
    hat(A, at(bar, b * 4 + 2), { gain: bar >= 16 ? 0.24 : 0.2, decay: bar >= 16 ? 0.085 : 0.07, fc: 6500 });
    if (bar >= 8) for (const s of [1, 3]) hat(A, at(bar, b * 4 + s), { gain: bar >= 16 ? 0.075 : 0.06, decay: 0.022, pan: s === 1 ? -0.35 : 0.35, fc: 9000 });
  }
  // bass: rolling 1/8 through bar 23, on-beat notes softer (the kick owns the beat)
  if (bar >= 4 && bar < 24) {
    const lift = bar >= 14 && bar < 16 ? (bar - 14) / 2 : bar >= 16 ? 1 : 0;
    for (let e = 0; e < 8; e++)
      bassNote(A, at(bar, e * 2), STEP * 1.6, hz(e === 7 && bar % 2 ? up(c.root, 1) : c.root), { gain: e % 2 ? 0.34 : 0.2, cut: 320 + 260 * lift, env: 1000 + 900 * lift });
  }
  // lead motif (bar 6+), octave up and wide in the drop; counter-melody from bar 12
  if (bar >= 6 && bar < 16) playLine(A, bar, MOTIF[bar % 4]);
  if (bar >= 16 && bar < 20) playLine(A, bar, MOTIF[bar % 4], { wide: true, cut: 5200, gain: 0.1 }, 1);
  if (bar >= 20 && bar < 24) playLine(A, bar, MOTIF[bar % 4], { gain: 0.1 });
  if (bar >= 12 && bar < 20) for (const [st, nm, len] of COUNTER[bar % 4])
    leadNote(A, at(bar, st), len * STEP * 0.85, hz(up(nm, 1)), null, { gain: 0.07, pulse: true, cut: 1600, pan: -0.45, dl: 0.25, rv: 0.3 });
  // drop 16-19: clap on 2 & 4, stab + noise accent on every half-bar line; 20-21: stab on every beat
  if (bar >= 16 && bar < 22) for (const b of [1, 3]) clap(A, at(bar, b * 4));
  if (bar >= 16 && bar < 20) for (const h of [0, 8]) {
    stab(A, at(bar, h), c.stab, { gain: 0.06, decay: 0.16 });
    if (!(bar === 16 && h === 0)) noiseHit(A, at(bar, h), { gain: 0.16, decay: 0.07, fc: 5000 });
  }
  if (bar >= 20 && bar < 24) for (let b = 0; b < 4; b++) stab(A, at(bar, b * 4), c.stab, { gain: bar < 22 ? 0.055 : 0.045, decay: 0.09, dl: 0.1 });
}
riser(A, at(3), at(4), { gain: 0.1 });
riser(A, at(14), at(16), { gain: 0.08, f0: 600 });
riser(A, at(22), at(24), { gain: 0.12, f0: 500, f1: 12000 });
// short risers (noise + rising sine) in the last beat before the cuts on 8, 16, 24
for (const b of [8, 16, 24]) riser(A, at(b - 1, 12), at(b), { gain: 0.1, f0: 1500, f1: 10000, sine: 0.05 });
// drum fills into 8 and 20: 1/16 snares on the last beat
for (const [b, g] of [[8, 0.1], [20, 0.16]]) for (let s = 12; s < 16; s++) snare(A, at(b - 1, s), { gain: g * (0.6 + 0.15 * (s - 12)), fc: 2200 + 400 * (s - 12) });
// snare build over bar 15: 1/8s then 1/16s, rising
for (let s = 0; s < 16; s++) { const x = s / 15; if (s < 8 && s % 2) continue; snare(A, at(15, s), { gain: 0.08 + 0.2 * x * x, fc: 1800 + 2500 * x }); }
// bars 22-23: 1/8 snare roll over the running kick, pitch and filter rising (one hit per cut)
for (let e = 0; e < 16; e++) { const x = e / 15; snare(A, at(22, e * 2), { gain: 0.08 + 0.18 * x, pitch: 2 ** (x * 1.2), fc: expLerp(900, 7000, x), rv: 0.1 }); }
impact(A, at(16));
// end card (scene B): clean resolving hit on 24 (tonic stab + kick + impact), then pad, bass and lead hold A
// under a soft 4-on-the-floor (-8 dB) through bar 25; the master fade closes it over 25.5-26.5
kick(B, at(24), { gain: 1.1, decay: 0.12, len: 0.4, depth: 0.3 });
impact(B, at(24), 1.1);
stab(B, at(24), ['A2', 'E3', 'A3', 'C4', 'E4'], { gain: 0.05, decay: 0.2, rv: 0.12, dl: 0 });
for (let q = 1; q < 8; q++) kick(B, at(24, q * 4), { gain: 10 ** (-8 / 20), depth: 0.25 });
const HOLD = (END_BAR - 24) * BAR;
padChord(B, at(24), HOLD, ['A3', 'C4', 'E4'], { atk: 0.05, rel: 0, gain: 0.06 });
padChord(B, at(24), HOLD, ['A2'], { atk: 0.05, rel: 0, gain: 0.045 });
bassNote(B, at(24), HOLD, hz('A1'), { gain: 0.26, cut: 240, env: 600, q: 1 });
lastLead = null;
playLine(B, 24, [[2, 'C5', 2], [4, 'B4', 4], [8, 'A4', 40]], { gain: 0.1, rv: 0.25, dl: 0.2 });

// ---------- fx + mix ----------
// Sidechain envelope from kick onsets: 3 ms dip, ~120 ms recovery.
const duck = new Float32Array(N).fill(1);
for (const { t, depth } of kicks) {
  const i0 = S(t);
  for (let j = 0; j < 0.45 * SR && i0 + j < N; j++) {
    const s = j / SR, e = s < 0.003 ? s / 0.003 : Math.exp(-(((s - 0.003) / 0.12) ** 1.6));
    duck[i0 + j] = Math.min(duck[i0 + j], 1 - depth * e);
  }
}
function delay(L, R) { // ping-pong dotted 1/8, damped feedback
  const d = S(BEAT * 0.75), oL = buf(), oR = buf(), lp1 = new SVF().set(4200), lp2 = new SVF().set(4200), hp = new SVF().set(280), FB = 0.35;
  for (let i = 0; i < N; i++) {
    hp.run((L[i] + R[i]) * 0.5);
    oL[i] = lp1.run(hp.hp + (i >= d ? oR[i - d] : 0) * FB);
    oR[i] = lp2.run((i >= d ? oL[i - d] : 0) * FB);
  }
  return hpReturn(oL, oR);
}
// 220 Hz high-pass on an fx return (12 dB/oct), so no low-end mush builds up under the kick and bass.
function hpReturn(L, R) {
  const fl = new SVF().set(220), fr = new SVF().set(220);
  for (let i = 0; i < N; i++) { fl.run(L[i]); fr.run(R[i]); L[i] = fl.hp; R[i] = fr.hp; }
  return [L, R];
}
// Freeverb, 25 ms pre-delay, 220 Hz HP in and out. room 0.82: longest comb 37 ms -> RT60 = 3 * 0.037 / -log10(0.82) = 1.3 s
function reverb(L, R, room = 0.82, damp = 0.35) {
  const k = SR / 44100, pre = S(0.025), hl = new SVF().set(220), hr = new SVF().set(220);
  const mk = (sp) => ({
    c: [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => ({ b: new Float32Array(Math.round((n + sp) * k)), i: 0, s: 0 })),
    a: [556, 441, 341, 225].map((n) => ({ b: new Float32Array(Math.round((n + sp) * k)), i: 0 })),
  });
  const ch = [mk(0), mk(23)], oL = buf(), oR = buf();
  for (let i = 0; i < N; i++) {
    const xl = i >= pre ? hl.run(L[i - pre]) : 0, xr = i >= pre ? hr.run(R[i - pre]) : 0;
    for (let c = 0; c < 2; c++) {
      const x = (xl + xr) * 0.015 + (c ? xr : xl) * 0.005; let y = 0;
      for (const cb of ch[c].c) { const o = cb.b[cb.i]; cb.s = o * (1 - damp) + cb.s * damp; cb.b[cb.i] = x + cb.s * room; if (++cb.i >= cb.b.length) cb.i = 0; y += o; }
      for (const ap of ch[c].a) { const o = ap.b[ap.i]; ap.b[ap.i] = y + o * 0.5; if (++ap.i >= ap.b.length) ap.i = 0; y = o - y; }
      (c ? oR : oL)[i] = y;
    }
  }
  return hpReturn(oL, oR);
}
const tb = (i) => i / SR / BAR; // sample -> bars
const padCut = (b) => b < 2 ? expLerp(450, 750, b / 2) : b < 4 ? expLerp(750, 1300, (b - 2) / 2) : b < 8 ? 1600 : b < 14 ? 1900
  : b < 16 ? expLerp(1900, 5200, (b - 14) / 2) : b < 20 ? 4200 : b < 22 ? 3000 : b < 24 ? expLerp(2000, 6500, (b - 22) / 2) : 1800;
const padGain = (b) => b < 4 ? 1 : b < 8 ? 0.85 : b < 16 ? 0.75 : b < 20 ? 1 : b < 22 ? 0.6 : 0.85;

function mixScene(sc, gate) {
  if (sc.kL) { // muffled kick, bars 2-3: two-pole LP opening across the two bars
    const f1 = new SVF(), f2 = new SVF();
    for (let i = S(at(2)); i < Math.min(N, S(at(4.3))); i++) {
      const x = smooth((tb(i) - 2) / 2);
      if ((i & 15) === 0) { const fc = expLerp(200, 9000, x); f1.set(fc, 0.6); f2.set(fc, 0.6); }
      const v = f2.run(f1.run(sc.kL[i])) * (0.75 + 0.25 * x); sc.dL[i] += v; sc.dR[i] += v;
    }
  }
  const fl = new SVF(), fr = new SVF();
  for (let i = 0; i < N; i++) {
    if ((i & 15) === 0) { const fc = 0.75 * padCut(tb(i)); fl.set(fc, 0.8); fr.set(fc, 0.8); } // 0.75: darker pad under the lead
    const g = padGain(tb(i)) * (0.55 + 0.45 * duck[i]);
    sc.pL[i] = fl.run(sc.pL[i]) * g; sc.pR[i] = fr.run(sc.pR[i]) * g;
    sc.rvL[i] += sc.pL[i] * 0.4; sc.rvR[i] += sc.pR[i] * 0.4;
  }
  { // lead bus: 400 Hz HP (lead + counter sit above the pad and bass), gentle +2 dB shelf above 4 kHz
    const h = [new SVF().set(400), new SVF().set(400)], sh = [new SVF().set(4000), new SVF().set(4000)], g = 10 ** (2 / 20) - 1;
    for (let i = 0; i < N; i++) for (const [c, X] of [[0, sc.lL], [1, sc.lR]]) { h[c].run(X[i]); sh[c].run(h[c].hp); X[i] = h[c].hp + g * sh[c].hp; }
  }
  const [dL, dR] = delay(sc.dlL, sc.dlR);
  for (let i = 0; i < N; i++) { sc.rvL[i] += dL[i] * 0.25; sc.rvR[i] += dR[i] * 0.25; }
  const [rL, rR] = reverb(sc.rvL, sc.rvR);
  const L = buf(), R = buf();
  for (let i = 0; i < N; i++) {
    const b = sc.bass[i] * (0.35 + 0.65 * duck[i]), g = gate(i);
    L[i] = g * (sc.dL[i] + b + sc.pL[i] + sc.lL[i] + sc.sL[i] + dL[i] * 0.45 + rL[i] * 0.9);
    R[i] = g * (sc.dR[i] + b + sc.pR[i] + sc.lR[i] + sc.sR[i] + dR[i] * 0.45 + rR[i] * 0.9);
  }
  return [L, R];
}
const cut24 = S(at(24)), fadeA = S(0.003), fade0 = S(at(25.5)), fade1 = S(at(26.5));
const [aL, aR] = mixScene(A, (i) => i < cut24 - fadeA ? 1 : i >= cut24 ? 0 : (cut24 - i) / fadeA);
const [bL, bR] = mixScene(B, () => 1);
const L = new Float64Array(N), R = new Float64Array(N);
{ // sum scenes, end fade over bar 25.5 -> 26.5 (volume and a 2-pole low-pass closing together), DC blocker
  let xl = 0, xr = 0, yl = 0, yr = 0; const r = 1 - TAU * 12 / SR, fl = new SVF(), fr = new SVF();
  for (let i = 0; i < N; i++) {
    const x = Math.min(1, Math.max(0, (i - fade0) / (fade1 - fade0))), end = 0.5 + 0.5 * Math.cos(Math.PI * x);
    if ((i & 15) === 0) { const fc = expLerp(16000, 220, x); fl.set(fc, 0.6); fr.set(fc, 0.6); }
    const sl = aL[i] + bL[i], sr = aR[i] + bR[i], ol = fl.run(sl), or = fr.run(sr);
    const l = (i < fade0 ? sl : ol) * end, rr = (i < fade0 ? sr : or) * end;
    yl = l - xl + r * yl; xl = l; yr = rr - xr + r * yr; xr = rr; L[i] = yl; R[i] = yr;
  }
}

// ---------- master: soft clip -> lookahead limiter -> loudness match to -14 LUFS ----------
const CEIL = 10 ** (-1.7 / 20); // sample ceiling; leaves headroom for inter-sample peaks (true peak <= -1 dBTP)
function master(gain) {
  const oL = new Float64Array(N), oR = new Float64Array(N), req = new Float64Array(N), K = 0.75;
  const clip = (x) => { const a = Math.abs(x); return a < K ? x : Math.sign(x) * (K + (1 - K) * Math.tanh((a - K) / (1 - K))); };
  for (let i = 0; i < N; i++) { oL[i] = clip(L[i] * gain); oR[i] = clip(R[i] * gain); const p = Math.max(Math.abs(oL[i]), Math.abs(oR[i])); req[i] = p > CEIL ? CEIL / p : 1; }
  // gain = min over the next LA samples, then 80 ms release, then an LA-sample average (never above the requirement)
  const LA = 96, hold = new Float64Array(N), dq = new Int32Array(N); let h = 0, tq = 0;
  for (let i = N - 1; i >= 0; i--) {
    while (tq > h && req[dq[tq - 1]] >= req[i]) tq--; dq[tq++] = i;
    while (dq[h] > i + LA - 1) h++; hold[i] = req[dq[h]];
  }
  const rel = Math.exp(-1 / (0.08 * SR)); let g = 1;
  for (let i = 0; i < N; i++) { g = Math.min(hold[i], 1 - (1 - g) * rel); hold[i] = g; }
  let acc = LA; // window starts filled with 1s
  for (let i = 0; i < N; i++) { acc += hold[i] - (i >= LA ? hold[i - LA] : 1); const gg = acc / LA; oL[i] *= gg; oR[i] *= gg; }
  return [oL, oR];
}
function lufs(l, r) { // ITU BS.1770 integrated loudness, 48 kHz K-weighting
  const kw = (x) => {
    const y = new Float64Array(N); let a1 = 0, a2 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, d1 = 0, d2 = 0;
    for (let i = 0; i < N; i++) {
      const s = 1.53512485958697 * x[i] - 2.69169618940638 * a1 + 1.19839281085285 * a2 + 1.69065929318241 * b1 - 0.73248077421585 * b2;
      a2 = a1; a1 = x[i]; b2 = b1; b1 = s;
      const u = s - 2 * c1 + c2 + 1.99004745483398 * d1 - 0.99007225036621 * d2;
      c2 = c1; c1 = s; d2 = d1; d1 = u; y[i] = u;
    }
    return y;
  };
  const kl = kw(l), kr = kw(r), blk = S(0.4), hop = S(0.1), z = [];
  for (let i = 0; i + blk <= N; i += hop) { let s = 0; for (let j = i; j < i + blk; j++) s += kl[j] * kl[j] + kr[j] * kr[j]; z.push(s / blk); }
  const ld = (m) => -0.691 + 10 * Math.log10(m), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const g1 = z.filter((m) => ld(m) > -70), relGate = ld(mean(g1)) - 10;
  return ld(mean(g1.filter((m) => ld(m) > relGate)));
}
let gain = 1, out, lu;
for (let k = 0; k < 5; k++) { out = master(gain); lu = lufs(out[0], out[1]); if (Math.abs(lu + 14) < 0.1) break; gain *= 10 ** ((-14 - lu) / 20); }

// ---------- write ----------
function wav(path, l, r, i0 = 0, i1 = N, fade = 0) {
  const n = i1 - i0, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let j = 0; j < n; j++) {
    const f = fade ? Math.min(1, j / fade, (n - 1 - j) / fade) : 1;
    const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * f * 32767 + (rnd() - rnd()) * 0.5))); // light TPDF dither
    b.writeInt16LE(q(l[i0 + j]), 44 + j * 4); b.writeInt16LE(q(r[i0 + j]), 46 + j * 4);
  }
  writeFileSync(path, b);
}
mkdirSync(OUT, { recursive: true });
wav(join(OUT, 'track.wav'), out[0], out[1]);
wav(join(OUT, 'preview-20-26.wav'), out[0], out[1], S(at(20)), N, S(0.01));
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const SECTIONS = [['title', 0, 2], ['hero', 2, 8], ['cycle-beat', 8, 16], ['drop-halfbar', 16, 20], ['cycle-beat', 20, 22], ['strobe-halfbeat', 22, 24], ['end', 24, 26]];
const json = {
  bpm: BPM, fps: FPS, bars: BARS, barSeconds: r6(BAR), beatSeconds: r6(BEAT), sampleRate: SR, duration: r6(N / SR),
  barTimes: Array.from({ length: BARS + 1 }, (_, i) => r6(i * BAR)),
  sections: SECTIONS.map(([name, a, b]) => ({ name, bars: [a, b], start: r6(a * BAR), end: r6(b * BAR) })),
  impacts: [16, 24].map((b) => r6(b * BAR)),
};
writeFileSync(join(OUT, 'track.json'), JSON.stringify(json, null, 2) + '\n');
let peak = 0, dc = 0;
for (let i = 0; i < N; i++) { peak = Math.max(peak, Math.abs(out[0][i]), Math.abs(out[1][i])); dc += out[0][i] + out[1][i]; }
console.log(`wrote ${join(OUT, 'track.wav')}  ${(N / SR).toFixed(3)} s  ~${lu.toFixed(2)} LUFS (internal)  sample peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS  dc ${(dc / 2 / N).toExponential(1)}  gain ${gain.toFixed(2)}`);
console.table(json.barTimes.slice(0, 8).map((t, i) => ({ bar: i, seconds: t, frame: +(t * FPS).toFixed(2) })));
console.table(json.sections.map(({ name, bars, start, end }) => ({ name, bars: bars.join('-'), start, end })));
