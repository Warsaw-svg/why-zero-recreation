import gsap from 'gsap';
import './styles.css';
import type { AudioManager } from '../audio/AudioManager';

const TICK_GAP = 11.3, TICKS = 100, RULER_W = TICK_GAP * TICKS;
const LABELS = [-100, -75, -50, -25, 0];

export class HUD {
  root: HTMLElement;
  xp = 0;
  xpMax = 500;
  private xpObj = { v: 0 };
  private xpEl!: HTMLElement;
  private track!: HTMLElement;
  private soundBtn!: HTMLElement;
  private wavePath!: SVGPathElement;
  private amp = 1;
  menuEl!: HTMLElement;
  menuBtn!: HTMLElement;
  ringEl!: HTMLElement;
  private ringCv!: HTMLCanvasElement;
  private ringSt = { on: false, p: 0, idle: true, t: 0, tap: false };
  private ringLab!: HTMLElement;
  onNav: (id: 'home' | 'letters' | 'why') => void = () => {};
  private waveT = 0;

  constructor(private audio: AudioManager) {
    this.root = document.getElementById('ui')!;
    const r = this.root;
    r.innerHTML = `
      <div id="rulerWrap"><div id="ruler"><div id="rulerTrack"></div></div><div id="needle"></div></div>
      <div id="xp"><svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 17 7.1 12.7 1.5 12 7.1 11.4 11.4 7.1 12 1.5z" fill="#f6c945"/></svg><span id="xpv">0</span><span class="xpl">XP</span></div>
      <button id="sound" class="btn" data-ui aria-label="Toggle sound"><svg viewBox="0 0 26 18"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <button id="menuBtn" class="btn glass" data-ui aria-label="Menu"><i></i></button>
      <div id="menu" data-ui data-noscroll><button id="menuClose" class="btn glass" aria-label="Close">✕</button>
        <ul><li data-id="home">Home</li><li data-id="letters">Letters</li><li data-id="why">Why Zero</li></ul></div>
      <div id="soon" data-ui data-noscroll><button id="soonBack" class="btn glass" aria-label="Back">✕</button><div class="in"><div class="k"></div><h2>Coming soon</h2><p>We're still building this page. Check back shortly.</p></div></div>
      <div id="toasts" aria-live="polite"></div>
      <div id="ring"><canvas></canvas><div class="lab"></div></div>
      <div id="cursor"><svg class="c hand" viewBox="0 0 36 36"><defs><g id="oh"><rect x="8.5" y="9" width="4.6" height="14" rx="2.3"/><rect x="13.6" y="5.5" width="4.6" height="17" rx="2.3"/><rect x="18.7" y="6.5" width="4.6" height="16" rx="2.3"/><rect x="23.8" y="10" width="4.6" height="13" rx="2.3"/><rect x="8" y="17" width="20.6" height="14" rx="7"/><rect x="3.6" y="16.5" width="12" height="4.6" rx="2.3" transform="rotate(32 8 19)"/></g></defs>
        <use href="#oh" fill="#fff" stroke="#10201d" stroke-width="3.4" stroke-linejoin="round"/><use href="#oh" fill="#fff"/>
        <path d="M14.5 23.5v3.2M18.3 23.5v3.2M22.1 23.5v3.2" stroke="#10201d" stroke-width="1.4" stroke-linecap="round"/></svg>
        <svg class="c dot" viewBox="0 0 36 36"><circle cx="18" cy="18" r="13" fill="none" stroke="#fff" stroke-width="1.5" opacity=".8"/><circle cx="18" cy="18" r="3.2" fill="#fff"/></svg></div>`;
    this.xpEl = r.querySelector('#xp')!;
    this.track = r.querySelector('#rulerTrack')!;
    this.soundBtn = r.querySelector('#sound')!;
    this.wavePath = this.soundBtn.querySelector('path')!;
    this.menuEl = r.querySelector('#menu')!;
    this.menuBtn = r.querySelector('#menuBtn')!;
    this.ringEl = r.querySelector('#ring')!;
    this.ringCv = this.ringEl.querySelector('canvas')!;
    this.ringLab = this.ringEl.querySelector('.lab')!;
    this.buildRuler();
    this.bind();
    audio.onMute = (m) => gsap.to(this, { amp: m ? 0 : 1, duration: 0.4 });
    this.amp = audio.muted ? 0 : 1;
    this.root.classList.add('pre'); // ruler, XP and sound stay hidden until the first zero is drawn
    this.setTheme('dark');
    if (!matchMedia('(pointer: coarse)').matches) document.body.classList.add('fine');
    else (r.querySelector('#cursor') as HTMLElement).style.display = 'none';
  }

  private buildRuler() {
    let html = '';
    for (let i = 0; i <= TICKS; i++) html += `<div class="tick ${i % 5 === 0 ? 'big' : ''}" style="left:${i * TICK_GAP}px"></div>`;
    LABELS.forEach((v, i) => { html += `<div class="tlabel" style="left:${(i / 4) * RULER_W}px">${v} BZ</div>`; });
    this.track.innerHTML = html;
    this.track.style.width = RULER_W + 'px';
  }

  private bind() {
    const sfx = this.audio;
    const hoverables = this.root.querySelectorAll('.btn, #menu li');
    hoverables.forEach((el) => el.addEventListener('pointerenter', () => sfx.play('hover', 0.5)));
    this.soundBtn.addEventListener('click', () => { sfx.unlock(); sfx.toggle(); });
    this.menuBtn.addEventListener('click', () => this.openMenu(true));
    this.menuEl.querySelector('#menuClose')!.addEventListener('click', () => this.openMenu(false));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.openMenu(false); });
    this.menuEl.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
      sfx.play('tick');
      this.openMenu(false);
      this.comingSoon((li as HTMLElement).textContent || '');   // every menu page is "Coming soon" for now
    }));
    this.root.querySelector('#soonBack')!.addEventListener('click', () => this.root.querySelector('#soon')!.classList.remove('open'));
    // cursor: the hand eases after the pointer instead of snapping to it
    const cur = this.root.querySelector('#cursor') as HTMLElement;
    addEventListener('pointermove', (e) => {
      if (!this.curInit) { this.curX = e.clientX; this.curY = e.clientY; this.curInit = true; }
      this.curTX = e.clientX; this.curTY = e.clientY;
      const t = e.target as HTMLElement;
      cur.classList.toggle('ui', !!t.closest?.('.btn,#menu li,#joy,#mapList,#mapCard'));
    });
    addEventListener('pointerdown', () => cur.classList.add('down'));
    addEventListener('pointerup', () => cur.classList.remove('down'));
    this.cursorEl = cur;
  }
  cursorEl!: HTMLElement;
  private curX = 0; private curY = 0; private curTX = 0; private curTY = 0; private curInit = false;
  setCursorGate(on: boolean) { this.cursorEl.classList.toggle('gate', on); }

  openMenu(open: boolean) {
    if (open === this.menuEl.classList.contains('open')) return;
    this.menuEl.classList.toggle('open', open);
    this.audio.play(open ? 'menuOpen' : 'menuClose');
  }

  setTheme(t: 'light' | 'dark') { document.documentElement.dataset.theme = t; }
  setProgress(p: number) {
    this.track.style.transform = `translateX(${-p * RULER_W}px)`;
    if (p > 0.02) this.reveal();
  }
  hideHint() {}
  /** full-screen "Coming soon" page for a menu item */
  comingSoon(title: string) {
    const el = this.root.querySelector('#soon') as HTMLElement;
    (el.querySelector('.k') as HTMLElement).textContent = title;
    el.classList.add('open');
  }
  /** small toast at the top of the screen; kind 'ok' (green) or 'err' (red) */
  toast(msg: string, kind: 'ok' | 'err' = 'ok') {
    const box = this.root.querySelector('#toasts') as HTMLElement;
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    t.innerHTML = `<i>${kind === 'ok' ? '✓' : '!'}</i><span></span>`; (t.querySelector('span') as HTMLElement).textContent = msg;
    box.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
  }
  /** fade the HUD in once the first zero has been drawn */
  reveal() { this.root.classList.remove('pre'); }
  showMenuBtn(v: boolean) { this.menuBtn.style.opacity = v ? '1' : '0'; this.menuBtn.style.pointerEvents = v ? 'auto' : 'none'; }

  /** XP for each completed step: gates (intro zero, TAP HOLD, second hold) and one-time scene bonuses. A refresh rebuilds the
   *  total from these, so the number always matches what was actually done (Component 3 stays at 200; Component 4 → 300). */
  static GATE_XP: Record<string, number> = { intro: 100, hold1: 100, hold2: 100 };
  static AWARD_XP: Record<string, number> = { comp4: 100, comp5: 100 };   // comp5: the dome is in view (400 → 500)
  /** XP rewards that were already given (by key) — remembered across refreshes so a scene's bonus counts once */
  awarded = new Set<string>();
  addXPOnce(key: string, n: number, glow = true) { if (this.awarded.has(key)) return; this.awarded.add(key); this.addXP(n, glow); }
  addXP(n: number, glow = true) {
    const room = this.xpMax - this.xp;
    n = Math.min(n, room);
    if (n <= 0) return;
    this.xp += n;
    gsap.to(this.xpObj, { v: this.xp, duration: 1, ease: 'power2.out', onUpdate: () => { this.xpEl.querySelector('#xpv')!.textContent = String(Math.round(this.xpObj.v)); } });
    if (glow) {
      this.xpEl.classList.add('glow');
      setTimeout(() => this.xpEl.classList.remove('glow'), 900);
      this.audio.play('ding', 0.8);
    }
  }

  /** gate ring: a loader-style arc. Idle = it chases its own tail; while the visitor draws/holds = it shows progress. */
  /** style 'tap': small glowing ring with the label stacked to its right (the reference's TAP / HOLD prompt) */
  ring(visible: boolean, x = innerWidth / 2, y = innerHeight / 2, progress = 0, label = '', idle = false, style: 'loader' | 'tap' = 'loader') {
    this.ringEl.classList.toggle('on', visible);
    this.ringSt.on = visible;
    if (!visible) return;
    this.ringEl.style.left = x + 'px';
    this.ringEl.style.top = y + 'px';
    this.ringSt.p = progress; this.ringSt.idle = idle;
    if (this.ringSt.tap !== (style === 'tap')) { this.ringSt.tap = style === 'tap'; this.ringEl.classList.toggle('tap', this.ringSt.tap); this.ringCv.width = 0; }
    if (this.ringLab.dataset.l !== label) { this.ringLab.dataset.l = label; this.ringLab.textContent = label; }
  }
  private drawRing(dt: number) {
    const st = this.ringSt; if (!st.on) return;
    st.t += dt;
    const size = Math.round(Math.min(300, Math.max(210, innerHeight * 0.37)));
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cv = this.ringCv;
    if (cv.width !== size * dpr) { cv.width = cv.height = size * dpr; this.ringEl.style.width = this.ringEl.style.height = size + 'px'; this.ringEl.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`; }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const TAU = Math.PI * 2;
    if (st.tap) {
      // TAP / HOLD prompt (matched to the reference): a thick, softly glowing white ring that keeps sending a faint circle
      // outward — it grows and fades, again and again, until you hold.
      const c = size / 2, R = size * 0.12, lw = size * 0.045;
      const P = 1.5;
      const holdK = st.p;
      for (let i = 0; i < 2; i++) {
        const k = ((st.t + i * P * 0.5) % P) / P;                 // two staggered ripples
        const rr = R * (1 + k * 2.6);
        const a = (1 - k) * (1 - k) * 0.55 * (1 - holdK);
        if (a < 0.005) continue;
        g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = Math.max(1, lw * (0.9 - k * 0.7));
        g.shadowColor = 'rgba(255,255,255,.6)'; g.shadowBlur = lw * (1 - k);
        g.beginPath(); g.arc(c, c, rr, 0, TAU); g.stroke();
      }
      // idle: the thick glowing ring. Holding (componet 2to3.mov): it turns into a thin loader — a faint full circle with a
      // bright arc filling clockwise from the top
      const ringA = 1 - Math.min(1, holdK * 10);
      if (ringA > 0.01) {
        g.shadowColor = 'rgba(20,60,50,.35)'; g.shadowBlur = lw * 2.2;   // soft dark halo so the white ring reads on bright sky too
        g.strokeStyle = `rgba(20,60,50,${0.12 * ringA})`; g.lineWidth = lw * 1.8; g.beginPath(); g.arc(c, c, R, 0, TAU); g.stroke();
        g.shadowColor = 'rgba(255,255,255,.95)'; g.shadowBlur = lw * 1.6;
        g.strokeStyle = `rgba(255,255,255,${0.8 * ringA})`; g.lineWidth = lw;
        g.beginPath(); g.arc(c, c, R, 0, TAU); g.stroke();
      }
      if (holdK > 0.001) {
        const lw2 = lw * 0.42, R2 = R * 1.05;
        g.shadowBlur = 0;
        g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = lw2;
        g.beginPath(); g.arc(c, c, R2, 0, TAU); g.stroke();
        g.shadowColor = 'rgba(255,255,255,.8)'; g.shadowBlur = lw2 * 2;
        g.strokeStyle = '#fff'; g.lineWidth = lw2; g.lineCap = 'round';
        g.beginPath(); g.arc(c, c, R2, -Math.PI / 2, -Math.PI / 2 + holdK * TAU); g.stroke();
      }
      g.shadowBlur = 0;
      return;
    }
    const lw = Math.max(7, size * 0.034), R = size / 2 - lw, c = size / 2;
    let tail: number, head: number;
    if (st.idle) {
      // loader: starts at the bottom (90°), the head runs round (1.2 s) back to its origin, holds the full ring (1.4 s),
      // then the tail winds up after it (1.2 s), short rest, repeat. No spin, the origin stays put.
      const GROW = 1.2, HOLD = 1.4, UNWIND = 1.2, REST = 0.3, P = GROW + HOLD + UNWIND + REST;
      const ease = (k: number) => k * k * (3 - 2 * k);
      const u = st.t % P, origin = Math.PI / 2, full = TAU * 0.999;
      if (u < GROW) { tail = origin; head = origin + ease(u / GROW) * full; }
      else if (u < GROW + HOLD) { tail = origin; head = origin + full; }
      else if (u < GROW + HOLD + UNWIND) { tail = origin + ease((u - GROW - HOLD) / UNWIND) * full; head = origin + full; }
      else { tail = head = origin; }
    } else {
      tail = -Math.PI / 2; head = tail + Math.max(0.0001, st.p) * TAU;
    }
    const span = head - tail;
    if (span > 0.01) {
      // one continuous stroke; a conic gradient fades it smoothly from an invisible tail to a solid head (no segments)
      const f = Math.min(span / TAU, 1);
      const grad = g.createConicGradient(tail, c, c);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(f * 0.5, 'rgba(255,255,255,0.32)');
      grad.addColorStop(f, 'rgba(255,255,255,0.96)');
      if (f < 0.999) grad.addColorStop(Math.min(1, f + 0.0005), 'rgba(255,255,255,0)');
      g.lineCap = 'butt'; g.lineWidth = lw; g.strokeStyle = grad;
      g.beginPath(); g.arc(c, c, R, tail, head); g.stroke();
      g.fillStyle = '#fff'; g.shadowColor = 'rgba(255,255,255,.8)'; g.shadowBlur = lw;
      g.beginPath(); g.arc(c + Math.cos(head) * R, c + Math.sin(head) * R, lw * 0.75, 0, TAU); g.fill();
      g.shadowBlur = 0;
    }
  }

  frame(dt: number) {
    this.drawRing(dt);
    const k = 1 - Math.exp(-dt * 16);
    this.curX += (this.curTX - this.curX) * k; this.curY += (this.curTY - this.curY) * k;
    if (this.curInit) this.cursorEl.style.transform = `translate(${this.curX}px,${this.curY}px)`;
    this.waveT += dt * 4;
    let d = '';
    for (let i = 0; i <= 24; i++) {
      const x = 1 + i;
      const y = 9 + Math.sin(i * 0.5 + this.waveT) * 6 * this.amp;
      d += (i ? 'L' : 'M') + x + ' ' + y.toFixed(2);
    }
    this.wavePath.setAttribute('d', d);
    this.wavePath.style.opacity = String(0.55 + 0.45 * this.amp);
  }
}
