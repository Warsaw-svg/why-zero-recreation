import { clamp, smoothstep } from '../utils/math';
import type { Scene, Ctx } from './Scene';

export interface Active { scene: Scene; opacity: number; local: number }

/** Ordered list of scenes, each owning a slice of global progress. Lazily inits/disposes GPU resources. */
export class Timeline {
  scenes: Scene[] = [];
  lead = 0.05;
  constructor(private ctx: Ctx) {}
  add(s: Scene) { this.scenes.push(s); return this; }
  find(name: string) { return this.scenes.find((s) => s.name === name)!; }
  /** returns visible scenes bottom→top with crossfade opacity */
  update(p: number, dt: number, t: number): Active[] {
    const out: Active[] = [];
    for (const s of this.scenes) {
      if (s.disabled) { if (s.inited) { if (s.active) { s.active = false; s.exit(); } s.dispose(); } continue; }
      const [a, b] = s.range;
      const near = p >= a - this.lead && p <= b + this.lead;
      const visible = p >= a && p <= b + 1e-6 || (s.overlay && s.active);
      if (near && !s.inited) { s.init(); s.resize(this.ctx.size.w, this.ctx.size.h); }
      if (!near && s.inited) {
        if (s.active) { s.active = false; s.exit(); }
        if (p > b + this.lead * 1.6 || p < a - this.lead * 1.6) s.dispose();
        continue;
      }
      if (visible && !s.active) { s.active = true; s.enter(); }
      if (!visible && s.active && !s.overlay) { s.active = false; s.exit(); }
      if (!s.active) continue;
      const local = clamp((p - a) / (b - a));
      s.update(local, dt, t);
      s.syncUI();
      const fade = s.overlay ? 1 : smoothstep(a, a + Math.min(0.06, (b - a) * 0.45), p);
      // first scene in range (lowest start) is opaque
      out.push({ scene: s, opacity: a <= 0 ? 1 : fade, local });
    }
    out.sort((x, y) => x.scene.layer - y.scene.layer || x.scene.range[0] - y.scene.range[0]);
    // make the lowest non-overlay scene fully opaque base (avoids black gaps when a scene ends before the next starts)
    if (out.length && !out[0].scene.overlay) out[0].opacity = 1;
    return out;
  }
}
