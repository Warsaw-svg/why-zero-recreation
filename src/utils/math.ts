export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const map = (v: number, a: number, b: number, c = 0, d = 1) => lerp(c, d, clamp((v - a) / (b - a)));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInCubic = (t: number) => t * t * t;
/**
 * Envelope helper: 0 before a, ramps to 1 at b, holds to c, ramps down to 0 at d.
 * Pass c=d=Infinity to never fade out.
 */
export function win(p: number, a: number, b: number, c = Infinity, d = Infinity): number {
  const up = clamp((p - a) / Math.max(1e-6, b - a));
  const down = c === Infinity ? 1 : 1 - clamp((p - c) / Math.max(1e-6, d - c));
  return Math.min(up, down);
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
