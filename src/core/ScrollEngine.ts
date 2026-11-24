import gsap from 'gsap';
import { clamp } from '../utils/math';
import type { Gates } from './Gates';

/** Virtual scroll: wheel / touch / keys feed `target`; `cur` is damped toward it. progress = cur / LENGTH. */
export class ScrollEngine {
  static LENGTH = 30000;
  target = 0;
  cur = 0;
  velocity = 0; // progress units / s (smoothed, signed)
  direction = 1;
  locked = false; // true while an automated tween runs
  private lastCur = 0;
  private touchY = 0;
  private touchV = 0;
  private touching = false;
  private tween: gsap.core.Tween | null = null;
  /** when true, wheel/touch are ignored (explorable city takes over) */
  suspend = false;
  /** return true to swallow a wheel delta */
  wheelInterceptor: ((dy: number) => boolean) | null = null;
  /** a scene can slow scrolling down (speed < 1) and make it glide more (smooth < 1) while you're in it; 1 = normal */
  speed = 1;
  smooth = 1;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private gates: Gates) {
    addEventListener('wheel', (e) => {
      if ((e.target as HTMLElement).closest?.('[data-noscroll]')) return;
      e.preventDefault();
      if (this.suspend && !this.wheelInterceptor) return;
      let dy = e.deltaY;
      if (Math.abs(e.deltaX) > Math.abs(dy)) dy = e.deltaX;
      if (e.deltaMode === 1) dy *= 32; else if (e.deltaMode === 2) dy *= innerHeight;
      // normalise mouse notches (~100) vs trackpad streams (1..20)
      if (this.wheelInterceptor?.(dy)) return;
      if (this.suspend) return;
      const s = Math.sign(dy);
      const a = Math.min(Math.abs(dy), 150);
      this.push(s * a * 1.15);
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { this.push(k === 'PageDown' || k === ' ' ? 1400 : 700); e.preventDefault(); }
      else if (k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { this.push(k === 'PageUp' || k === ' ' ? -1400 : -700); e.preventDefault(); }
    });
    addEventListener('touchstart', (e) => {
      if ((e.target as HTMLElement).closest?.('[data-ui],[data-noscroll]')) return;
      if (this.suspend) return;
      this.touching = true; this.touchY = e.touches[0].clientY; this.touchV = 0;
    }, { passive: true });
    addEventListener('touchmove', (e) => {
      if (!this.touching) return;
      const y = e.touches[0].clientY;
      const d = (this.touchY - y) * 2.2;
      this.touchY = y;
      this.touchV = d;
      this.push(d, true);
    }, { passive: true });
    addEventListener('touchend', () => { this.touching = false; this.push(this.touchV * 9); });
  }
  get progress() { return this.cur / ScrollEngine.LENGTH; }
  get targetProgress() { return this.target / ScrollEngine.LENGTH; }
  private push(d: number, immediateDamp = false) {
    if (this.locked) return;
    void immediateDamp;
    this.target += d * this.speed;
    this.clampTarget();
    if (d !== 0) this.direction = Math.sign(d);
  }
  private clampTarget() { this.target = clamp(this.target, this.gates.floor() * ScrollEngine.LENGTH, this.gates.limit() * ScrollEngine.LENGTH); }
  /** programmatic move (menu / auto-advance). */
  scrollTo(p: number, duration = 2.2, opts: { skipGates?: boolean; ease?: string } = {}) {
    if (opts.skipGates) this.gates.skipTo(p);
    const to = clamp(p, 0, this.gates.limit()) * ScrollEngine.LENGTH;
    this.tween?.kill();
    this.locked = true;
    this.direction = Math.sign(to - this.cur) || 1;
    const o = { v: this.cur };
    this.tween = gsap.to(o, {
      v: to, duration: this.reduced ? 0.01 : duration, ease: opts.ease ?? 'power3.inOut',
      onUpdate: () => { this.cur = o.v; this.target = o.v; },
      onComplete: () => { this.locked = false; this.target = to; this.cur = to; },
    });
  }
  /** jump instantly (resume after a refresh) */
  jumpTo(p: number) { this.tween?.kill(); this.locked = false; const v = clamp(p, 0, this.gates.limit()) * ScrollEngine.LENGTH; this.cur = this.target = v; }
  /** nudge limit-aware target (used after gate solves) */
  advance(p: number, duration = 1.8) { this.scrollTo(Math.min(p, 1), duration, { ease: 'power2.inOut' }); }
  update(dt: number) {
    if (!this.locked) {
      this.clampTarget();
      this.cur += (this.target - this.cur) * (1 - Math.exp(-dt * 5.2 * this.smooth));
      if (Math.abs(this.target - this.cur) < 0.05) this.cur = this.target;
    }
    const v = (this.cur - this.lastCur) / Math.max(dt, 1e-4) / ScrollEngine.LENGTH;
    this.lastCur = this.cur;
    this.velocity += (v - this.velocity) * (1 - Math.exp(-dt * 8));
  }
}
