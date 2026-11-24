export type Tier = 'high' | 'mid' | 'low';
/** Adaptive quality: a quick frame-time probe lowers tier on slow devices. */
export class Quality {
  tier: Tier = 'high';
  isMobile = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private samples: number[] = [];
  private probed = false;
  private acc = 0;
  onChange: (t: Tier) => void = () => {};
  constructor() { if (this.isMobile) this.tier = 'mid'; }
  get dpr() { const cap = this.isMobile ? 1.5 : 2; const d = Math.min(devicePixelRatio || 1, cap); return this.tier === 'low' ? Math.min(d, 1) : this.tier === 'mid' ? Math.min(d, 1.5) : d; }
  get particles() { return (this.tier === 'high' ? 1 : this.tier === 'mid' ? 0.55 : 0.3) * (this.reducedMotion ? 0.5 : 1); }
  get bloom() { return this.tier !== 'low'; }
  get msaa() { return this.tier === 'high' ? 4 : 0; }
  frame(dt: number) {
    if (this.probed) {
      // continuous slow watch: sustained slow frames drop a tier
      this.acc = this.acc * 0.98 + dt * 0.02;
      if (this.acc > 1 / 26 && this.tier !== 'low') { this.set(this.tier === 'high' ? 'mid' : 'low'); this.acc = 1 / 50; }
      return;
    }
    if (dt < 0.25) this.samples.push(dt);
    if (this.samples.length >= 90) {
      const s = this.samples.slice(20).sort((a, b) => a - b);
      const med = s[Math.floor(s.length / 2)];
      this.probed = true;
      this.acc = med;
      if (med > 1 / 28) this.set('low'); else if (med > 1 / 48 && this.tier === 'high') this.set('mid');
    }
  }
  private set(t: Tier) { this.tier = t; this.onChange(t); }
}
