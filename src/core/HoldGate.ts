import type { Ctx } from './Scene';
import { clamp } from '../utils/math';

/** Tap-and-hold gate: hold pointer (or Enter) to fill; release early drains. Ties into audio + haptics. */
export class HoldGate {
  p = 0;
  isDown = false;
  done = false;
  enabled = false;
  duration = 1.7;
  private buzz = 0;
  private offs: Array<() => void> = [];
  private key = (e: KeyboardEvent, v: boolean) => { if (e.key === 'Enter') this.isDown = v; };
  constructor(private ctx: Ctx, public id: string, private onComplete: () => void) {
    this.offs.push(ctx.input.onDown(() => { this.isDown = true; }), ctx.input.onUp(() => { this.isDown = false; }));
    const kd = (e: KeyboardEvent) => this.key(e, true), ku = (e: KeyboardEvent) => this.key(e, false);
    addEventListener('keydown', kd); addEventListener('keyup', ku);
    this.offs.push(() => { removeEventListener('keydown', kd); removeEventListener('keyup', ku); });
    if (ctx.gates.isSolved(id)) { this.done = true; this.p = 1; }
  }
  update(dt: number) {
    if (this.done) return;
    const audio = this.ctx.audio;
    const holding = this.enabled && this.isDown;
    const before = this.p;
    if (holding) {
      if (before <= 0.001) audio.holdStart();
      this.p = clamp(this.p + dt / this.duration);
      this.buzz -= dt;
      if (this.buzz <= 0 && 'vibrate' in navigator) { navigator.vibrate?.(10 + this.p * 25); this.buzz = 0.12 - this.p * 0.06; }
    } else if (this.p > 0) {
      this.p = clamp(this.p - dt / (this.duration * 0.6));
      if (this.p <= 0) audio.holdEnd(false);
    }
    if (this.p > 0) audio.holdSet(this.p);
    if (this.p >= 1) {
      this.done = true;
      audio.holdEnd(true);
      this.ctx.gates.solve(this.id);
      this.ctx.hud.addXP(100);
      this.onComplete();
    }
  }
  dispose() { this.offs.forEach((f) => f()); this.offs = []; }
}
