/**
 * Procedural audio synthesis (CC0 — generated at runtime, no sample files).
 * Everything is rendered into Float32Arrays, wrapped as WAV blobs, and played through Howler.
 */
export const SR = 22050;
const TAU = Math.PI * 2;
let seed = 1234567;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;

class LP { y = 0; constructor(public a: number) {} p(x: number) { this.y += this.a * (x - this.y); return this.y; } }
const lpA = (fc: number) => 1 - Math.exp(-TAU * fc / SR);
class BP { lp1: LP; lp2: LP; constructor(lo: number, hi: number) { this.lp1 = new LP(lpA(hi)); this.lp2 = new LP(lpA(lo)); } p(x: number) { const a = this.lp1.p(x); return a - this.lp2.p(a); } }

function buf(sec: number) { return new Float32Array(Math.floor(sec * SR)); }
function loopify(b: Float32Array, xf = 0.6) {
  const n = Math.floor(xf * SR);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const j = b.length - n + i;
    b[i] = b[i] * t + b[j] * (1 - t); // blend tail into head
  }
  return b.subarray(0, b.length - n);
}
function norm(b: Float32Array, peak = 0.9) {
  let m = 0; for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  const k = m > 0 ? peak / m : 1; for (let i = 0; i < b.length; i++) b[i] *= k; return b;
}
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
const quant = (f: number, D: number) => Math.round(f * D) / D;

function pad(D: number, freqs: number[], opts: { shimmer?: number; vib?: number; noiseAmt?: number; sat?: number } = {}) {
  const b = buf(D + 0.6);
  const lp = new LP(lpA(900));
  const bp = new BP(2000, 7000);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    let s = 0;
    freqs.forEach((f0, k) => {
      const f = quant(f0, D);
      const vib = 1 + (opts.vib ?? 0) * Math.sin(TAU * quant(5, D) * t + k);
      const amp = 0.5 + 0.5 * Math.sin(TAU * (1 / D) * t * (1 + (k % 2)) + k * 1.7);
      s += Math.sin(TAU * f * t * vib) * (0.25 + 0.75 * amp) / (1 + k * 0.15);
      s += Math.sin(TAU * f * 2.0 * t) * 0.12 * amp;
    });
    s /= freqs.length * 0.55;
    if (opts.noiseAmt) s += lp.p(noise()) * opts.noiseAmt + bp.p(noise()) * opts.noiseAmt * 0.5 * (0.5 + 0.5 * Math.sin(TAU * t / D));
    if (opts.shimmer) s += Math.sin(TAU * quant(2093, D) * t) * opts.shimmer * Math.pow(Math.sin(TAU * t * 2 / D) * 0.5 + 0.5, 3);
    if (opts.sat) s = Math.tanh(s * opts.sat);
    b[i] = s;
  }
  return norm(loopify(b), 0.55);
}

export type SfxName =
  | 'creak' | 'crack' | 'shatter' | 'riser' | 'whoosh' | 'clink' | 'ding' | 'tick' | 'hover' | 'menuOpen' | 'menuClose'
  | 'rustle' | 'ignite' | 'glassCrack' | 'boom' | 'glassBreak';
export type BedName = 'icy' | 'choir' | 'drone' | 'fire' | 'bright';

export function makeBed(name: BedName): Float32Array {
  seed = 99 + name.length;
  switch (name) {
    case 'icy': return pad(8, [220, 329.63, 440, 659.25, 880], { shimmer: 0.25, noiseAmt: 0.18, vib: 0.002 });
    case 'choir': return pad(10, [196, 246.94, 293.66, 392, 493.88, 587.33], { vib: 0.004, shimmer: 0.08, noiseAmt: 0.05 });
    case 'drone': {
      const D = 8; const b = buf(D + 0.6);
      const lp = new LP(lpA(160));
      for (let i = 0; i < b.length; i++) {
        const t = i / SR;
        let s = Math.sin(TAU * 55 * t + 2 * Math.sin(TAU * 0.25 * t)) + 0.6 * Math.sin(TAU * 82.5 * t) + 0.4 * Math.sin(TAU * 110.5 * t);
        s = Math.tanh(s * 2.2) * 0.6 + lp.p(noise()) * 1.2;
        // heartbeat: lub-dub once per second
        const ph = t % 1; const beat = (x: number, f: number) => (x > 0 ? Math.sin(TAU * f * x) * Math.exp(-x * 18) : 0);
        s += (beat(ph, 52) * 1.4 + beat(ph - 0.28, 44) * 1.0);
        b[i] = s;
      }
      return norm(loopify(b), 0.8);
    }
    case 'fire': {
      const D = 8; const b = buf(D + 0.6);
      const brown = new LP(lpA(120)); const hiss = new BP(1500, 6000);
      let pop = 0;
      for (let i = 0; i < b.length; i++) {
        if (rnd() < 0.0016) pop = 0.4 + rnd() * 0.9;
        pop *= 0.9985 - rnd() * 0.004;
        const crackle = noise() * pop * pop;
        b[i] = brown.p(noise()) * 2.2 + hiss.p(noise()) * 0.25 + crackle * 0.9;
      }
      return norm(loopify(b), 0.8);
    }
    case 'bright': return pad(10, [261.63, 329.63, 392, 493.88, 587.33, 783.99], { shimmer: 0.2, vib: 0.002, noiseAmt: 0.04 });
  }
}

export function makeSfx(name: SfxName): Float32Array {
  seed = 4242 + name.length * 17;
  switch (name) {
    case 'creak': {
      const b = buf(0.9); const bp = new BP(300, 1400);
      for (let i = 0; i < b.length; i++) { const t = i / SR; const f = 90 + 40 * Math.sin(t * 40) + 30 * noise(); b[i] = (Math.sin(TAU * f * t * 6) * 0.3 + bp.p(noise())) * Math.sin(Math.PI * t / 0.9) * (0.5 + 0.5 * Math.sin(t * 60)); }
      return norm(b, 0.5);
    }
    case 'crack': {
      const b = buf(0.9); const hp = new LP(lpA(4000));
      for (let i = 0; i < b.length; i++) { const t = i / SR; const n = noise(); b[i] = (n - hp.p(n)) * Math.exp(-t * 18) + Math.sin(TAU * 70 * t) * Math.exp(-t * 9) * 0.8 + noise() * Math.exp(-t * 60); }
      return norm(b, 0.95);
    }
    case 'shatter': {
      const b = buf(2.2); const hp = new LP(lpA(3000));
      const ev: Array<[number, number, number]> = [];
      for (let k = 0; k < 90; k++) ev.push([rnd() * 1.4 * (0.3 + rnd()), 2500 + rnd() * 6500, 0.05 + rnd() * 0.25]);
      for (let i = 0; i < b.length; i++) {
        const t = i / SR; let s = 0;
        const n = noise(); s += (n - hp.p(n)) * Math.exp(-t * 6) * 0.7 + Math.sin(TAU * 55 * t) * Math.exp(-t * 7);
        for (const [t0, f, d] of ev) { const x = t - t0; if (x > 0 && x < d * 4) s += Math.sin(TAU * f * x) * Math.exp(-x / d) * 0.06; }
        b[i] = s;
      }
      return norm(b, 0.95);
    }
    case 'riser': { // loopable charge tone; pitch driven by Howler rate()
      const b = buf(1.0);
      for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(TAU * 220 * t) * 0.5 + Math.sin(TAU * 330 * t) * 0.3 + Math.sin(TAU * 440 * t + Math.sin(TAU * 8 * t)) * 0.25 + Math.sin(TAU * 880 * t) * 0.08; }
      return norm(b, 0.5);
    }
    case 'whoosh': {
      const b = buf(1.1); const l = new LP(lpA(500));
      for (let i = 0; i < b.length; i++) { const t = i / SR; l.a = lpA(300 + 6000 * Math.sin(Math.PI * t / 1.1) ** 2); b[i] = l.p(noise()) * Math.sin(Math.PI * t / 1.1) ** 1.5; }
      return norm(b, 0.8);
    }
    case 'clink': {
      const b = buf(0.6);
      for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = (Math.sin(TAU * 2637 * t) + 0.6 * Math.sin(TAU * 4186 * t) + 0.3 * Math.sin(TAU * 6272 * t)) * Math.exp(-t * 11) * (t < 0.002 ? t / 0.002 : 1); }
      return norm(b, 0.6);
    }
    case 'ding': {
      const b = buf(1.4);
      for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = (Math.sin(TAU * 1318.5 * t) + 0.5 * Math.sin(TAU * 2637 * t) + 0.25 * Math.sin(TAU * 3951 * t)) * Math.exp(-t * 4.2) * Math.min(1, t / 0.003); }
      return norm(b, 0.55);
    }
    case 'tick': case 'hover': {
      const n = name === 'tick' ? 0.07 : 0.05; const f = name === 'tick' ? 1500 : 2200; const b = buf(n);
      for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(TAU * f * t) * Math.exp(-t * 70); }
      return norm(b, 0.4);
    }
    case 'menuOpen': case 'menuClose': {
      const up = name === 'menuOpen'; const b = buf(0.55); const l = new LP(lpA(800));
      for (let i = 0; i < b.length; i++) { const t = i / SR; const x = up ? t / 0.55 : 1 - t / 0.55; l.a = lpA(400 + 3000 * x * x); b[i] = (l.p(noise()) * 0.8 + Math.sin(TAU * (up ? 440 + 440 * t / 0.55 : 880 - 440 * t / 0.55) * t) * 0.15) * Math.sin(Math.PI * t / 0.55); }
      return norm(b, 0.5);
    }
    case 'rustle': {
      const b = buf(1.2); const bp = new BP(2500, 9000);
      for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = bp.p(noise()) * (0.4 + 0.6 * Math.abs(Math.sin(t * 23 + Math.sin(t * 9) * 3))) * Math.sin(Math.PI * t / 1.2); }
      return norm(b, 0.5);
    }
    case 'ignite': {
      const b = buf(1.5); const l = new LP(lpA(900)); const bp = new BP(1200, 5000);
      for (let i = 0; i < b.length; i++) { const t = i / SR; const e = Math.min(1, t / 0.08) * Math.exp(-t * 1.6); b[i] = (l.p(noise()) * 1.5 + bp.p(noise()) * 0.4 * (rnd() < 0.02 ? 3 : 1)) * e; }
      return norm(b, 0.8);
    }
    case 'glassCrack': {
      const b = buf(0.7); const hp = new LP(lpA(5000));
      for (let i = 0; i < b.length; i++) { const t = i / SR; const n = noise(); b[i] = (n - hp.p(n)) * Math.exp(-t * 25) + Math.sin(TAU * 3100 * t) * Math.exp(-t * 20) * 0.3 + Math.sin(TAU * 5200 * t) * Math.exp(-t * 28) * 0.2 + Math.sin(TAU * 90 * t) * Math.exp(-t * 14) * 0.5; }
      return norm(b, 0.7);
    }
    case 'glassBreak': {
      // a pane of glass breaking: impact crack + low thump, a bright burst of breaking glass, then many shards tinkling
      // and bouncing as they fall (inharmonic glass partials), with a soft debris rattle underneath
      const D = 2.6; const b = buf(D);
      const lpA1 = new LP(lpA(2500)), lpA2 = new LP(lpA(900));
      type Ping = { t0: number; f: number; d: number; a: number; ph: number };
      const pings: Ping[] = [];
      for (let k = 0; k < 260; k++) {
        // most shards hit early, a long tail of small bounces later
        const t0 = 0.012 + Math.pow(rnd(), 2.2) * 2.1;
        const f = 1800 + rnd() * Math.min(7800, SR * 0.42 - 1800);
        pings.push({ t0, f, d: 0.012 + rnd() * 0.06, a: (0.35 + rnd() * 0.65) * Math.exp(-t0 * 1.4), ph: rnd() * TAU });
        if (rnd() < 0.35) pings.push({ t0: t0 + 0.04 + rnd() * 0.12, f: f * (0.97 + rnd() * 0.06), d: 0.01 + rnd() * 0.03, a: pings[pings.length - 1].a * 0.45, ph: rnd() * TAU });   // bounce
      }
      for (let i = 0; i < b.length; i++) {
        const t = i / SR; const n = noise();
        // impact: broadband click + high-passed crack burst + low thump
        let s = (t < 0.004 ? (1 - t / 0.004) * n * 1.6 : 0);
        const hpN = n - lpA1.p(n);
        s += hpN * Math.exp(-t * 9) * 1.15 * (0.6 + 0.4 * (rnd() < 0.15 ? 1.8 : 1));
        s += Math.sin(TAU * (85 - 30 * t) * t) * Math.exp(-t * 14) * 0.7;
        // debris rattle: low-passed grainy noise
        s += lpA2.p(noise()) * (rnd() < 0.03 ? 2.2 : 0.4) * Math.exp(-t * 2.2) * 0.35;
        // shards
        for (const p of pings) {
          const x = t - p.t0;
          if (x <= 0 || x > p.d * 6) continue;
          const env = Math.min(1, x / 0.0006) * Math.exp(-x / p.d);
          // glass partials, kept below the Nyquist limit (no aliasing hiss)
          let v = Math.sin(TAU * p.f * x + p.ph);
          if (p.f * 2.76 < SR * 0.45) v += 0.5 * Math.sin(TAU * p.f * 2.76 * x + p.ph);
          if (p.f * 5.4 < SR * 0.45) v += 0.25 * Math.sin(TAU * p.f * 5.4 * x);
          s += v * env * p.a * 0.22;
        }
        b[i] = s * Math.min(1, (D - t) / 0.2);
      }
      return norm(b, 0.98);
    }
    case 'boom': {
      const b = buf(1.8);
      for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(TAU * (60 - 25 * t) * t) * Math.exp(-t * 2.6) + noise() * Math.exp(-t * 9) * 0.5; }
      return norm(b, 0.95);
    }
  }
}

export function toWavBlob(samples: Float32Array): Blob {
  const n = samples.length;
  const ab = new ArrayBuffer(44 + n * 2);
  const v = new DataView(ab);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([ab], { type: 'audio/wav' });
}
export function toWavUrl(samples: Float32Array): string { return URL.createObjectURL(toWavBlob(samples)); }
