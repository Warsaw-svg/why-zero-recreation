import { Howl, Howler } from 'howler';
import { makeBed, makeSfx, toWavBlob, type BedName, type SfxName } from './synth';
import { cacheGet, cacheSet } from '../core/cache';
import { smoothstep, clamp } from '../utils/math';

const BEDS: Array<{ name: BedName; vol: number; a: number; b: number; c: number; d: number }> = [
  // progress windows: fade in a→b, hold, fade out c→d
  { name: 'icy', vol: 0.5, a: -1, b: 0, c: 0.2, d: 0.34 },
  { name: 'choir', vol: 0.55, a: 0.18, b: 0.3, c: 0.38, d: 0.42 },
  { name: 'drone', vol: 0.7, a: 0.37, b: 0.42, c: 0.58, d: 0.66 },
  { name: 'fire', vol: 0.6, a: 0.58, b: 0.68, c: 0.86, d: 0.9 },
  { name: 'bright', vol: 0.55, a: 0.86, b: 0.92, c: 2, d: 3 },
];

export class AudioManager {
  muted = false;
  unlocked = false;
  private beds = new Map<BedName, Howl>();
  private sfx = new Map<SfxName, Howl>();
  private filter: BiquadFilterNode | null = null;
  private holdId: number | null = null;
  private scrollEnergy = 0;
  private lastIdx = -1;
  onMute: (m: boolean) => void = () => {};

  constructor() {
    try { this.muted = localStorage.getItem('zero-muted') === '1'; } catch { /* ignore */ }
    document.addEventListener('visibilitychange', () => {
      const ctx = Howler.ctx;
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else if (this.unlocked && !this.muted) ctx.resume();
    });
  }

  /** Build all sounds. The first visit synthesises them (slow) and stores the WAVs in IndexedDB; repeat visits read them back (fast). */
  async build(progress: (p: number) => void) {
    const url = async (key: string, make: () => Float32Array) => {
      const k = `audio-v1-${key}`;
      const hit = await cacheGet(k);
      if (hit) return URL.createObjectURL(hit);
      await new Promise((r) => setTimeout(r, 0)); // yield so the loader can paint between heavy syntheses
      const blob = toWavBlob(make());
      void cacheSet(k, blob);
      return URL.createObjectURL(blob);
    };
    const jobs: Array<() => Promise<void>> = [];
    (['icy', 'choir', 'drone', 'fire', 'bright'] as BedName[]).forEach((n) => jobs.push(async () => {
      this.beds.set(n, new Howl({ src: [await url(`bed-${n}`, () => makeBed(n))], loop: true, volume: 0, format: ['wav'] }));
    }));
    (['creak', 'crack', 'shatter', 'riser', 'whoosh', 'clink', 'ding', 'tick', 'hover', 'menuOpen', 'menuClose', 'rustle', 'ignite', 'glassCrack', 'boom', 'glassBreak'] as SfxName[]).forEach((n) => jobs.push(async () => {
      this.sfx.set(n, new Howl({ src: [await url(`sfx-${n}`, () => makeSfx(n))], volume: 0.7, loop: n === 'riser', format: ['wav'] }));
    }));
    for (let i = 0; i < jobs.length; i++) {
      await jobs[i]();
      progress((i + 1) / jobs.length);
    }
    Howler.mute(this.muted);
  }

  /** must be called inside a user gesture */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const ctx = Howler.ctx;
    if (ctx) {
      ctx.resume();
      if (!this.filter) {
        // scroll-reactive low-pass between Howler's master gain and the destination
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 18000; f.Q.value = 0.4;
        try { Howler.masterGain.disconnect(); Howler.masterGain.connect(f); f.connect(ctx.destination); this.filter = f; } catch { /* ignore */ }
      }
    }
    this.beds.forEach((h) => h.play());
    Howler.mute(this.muted);
  }

  toggle() {
    this.muted = !this.muted;
    Howler.mute(this.muted);
    try { localStorage.setItem('zero-muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    this.onMute(this.muted);
    if (!this.muted) this.play('tick');
  }

  play(name: SfxName, vol = 1, rate = 1) {
    if (!this.unlocked) return;
    const h = this.sfx.get(name);
    if (!h) return;
    const id = h.play();
    h.volume(Math.min(1, 0.7 * vol), id);
    h.rate(rate, id);
    return id;
  }

  /** hold-to-charge riser: pitch follows progress */
  holdStart() {
    if (!this.unlocked || this.holdId !== null) return;
    const h = this.sfx.get('riser')!;
    this.holdId = h.play();
    h.volume(0.0, this.holdId);
    h.rate(0.6, this.holdId);
  }
  holdSet(p: number) {
    if (this.holdId === null) return;
    const h = this.sfx.get('riser')!;
    h.rate(0.6 + p * 1.6, this.holdId);
    h.volume(0.15 + p * 0.5, this.holdId);
  }
  holdEnd(complete: boolean) {
    if (this.holdId === null) return;
    const h = this.sfx.get('riser')!;
    h.fade(h.volume(this.holdId) as number, 0, 200, this.holdId);
    const id = this.holdId;
    setTimeout(() => h.stop(id), 230);
    this.holdId = null;
    if (complete) { this.play('whoosh', 1); this.play('boom', 0.8); }
  }

  /** crossfade beds by global progress; scroll velocity drives low-pass + swell */
  update(progress: number, velocity: number, dt: number) {
    if (!this.unlocked) return;
    this.scrollEnergy += (clamp(Math.abs(velocity) * 14, 0, 1) - this.scrollEnergy) * (1 - Math.exp(-dt * 5));
    for (const b of BEDS) {
      const h = this.beds.get(b.name);
      if (!h) continue;
      const v = smoothstep(b.a, b.b, progress) * (1 - smoothstep(b.c, b.d, progress));
      h.volume(v * b.vol * (0.82 + this.scrollEnergy * 0.28));
    }
    if (this.filter) {
      // quieter/duller at rest, opens up as you scroll
      const f = 2200 + this.scrollEnergy * 15000;
      this.filter.frequency.value += (f - this.filter.frequency.value) * (1 - Math.exp(-dt * 6));
    }
    const idx = Math.floor(progress * 60);
    if (progress > 0.58 && progress < 0.86 && idx !== this.lastIdx && Math.abs(velocity) > 0.004 && idx % 3 === 0) { this.lastIdx = idx; this.play('rustle', 0.12); }
  }
}
