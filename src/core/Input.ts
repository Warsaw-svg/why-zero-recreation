export class Input {
  x = 0; y = 0; nx = 0; ny = 0; /* normalised -1..1, y up */
  sx = 0; sy = 0; /* smoothed */
  down = false;
  isTouch = matchMedia('(pointer: coarse)').matches;
  private downCbs: Array<(e: PointerEvent) => void> = [];
  private moveCbs: Array<(e: PointerEvent) => void> = [];
  private upCbs: Array<(e: PointerEvent) => void> = [];
  constructor(target: HTMLElement) {
    const upd = (e: PointerEvent) => {
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      this.x = e.clientX; this.y = e.clientY;
      this.nx = (e.clientX / innerWidth) * 2 - 1;
      this.ny = -((e.clientY / innerHeight) * 2 - 1);
    };
    window.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest?.('[data-ui]')) return;
      if (e.pointerType === 'touch') this.isTouch = true;
      upd(e); this.down = true; this.downCbs.forEach((f) => f(e));
    });
    window.addEventListener('pointermove', (e) => { upd(e); this.moveCbs.forEach((f) => f(e)); });
    const up = (e: PointerEvent) => { if (!this.down) return; upd(e); this.down = false; this.upCbs.forEach((f) => f(e)); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    void target;
  }
  onDown(f: (e: PointerEvent) => void) { this.downCbs.push(f); return () => (this.downCbs = this.downCbs.filter((x) => x !== f)); }
  onMove(f: (e: PointerEvent) => void) { this.moveCbs.push(f); return () => (this.moveCbs = this.moveCbs.filter((x) => x !== f)); }
  onUp(f: (e: PointerEvent) => void) { this.upCbs.push(f); return () => (this.upCbs = this.upCbs.filter((x) => x !== f)); }
  update(dt: number) {
    if (!Number.isFinite(this.sx) || !Number.isFinite(this.sy)) { this.sx = this.nx || 0; this.sy = this.ny || 0; }
    const k = 1 - Math.exp(-(Number.isFinite(dt) ? dt : 0) * 6);
    this.sx += (this.nx - this.sx) * k;
    this.sy += (this.ny - this.sy) * k;
  }
}
