import * as THREE from 'three';
import { Scene, type Ctx } from '../core/Scene';
import { clamp, damp, smoothstep } from '../utils/math';
import { COMPANIES, type Company } from '../utils/companies';
import { buildCityscape, cityEnvironment } from '../utils/cityscape';
import { WaitlistDome } from '../utils/waitlist';
import { CityPost } from '../utils/cityPost';
import { mulberry32 } from '../utils/math';

const MIN_D = 10, MAX_D = 140;   // long lens (fov 27) like an aerial photo, so distances are larger

interface Pin { c: Company; group: THREE.Group; hit: THREE.Mesh; needle: THREE.Mesh; ring: THREE.Mesh; label: THREE.Sprite; pos: THREE.Vector3; top: number; hi: number }

/** illustrated "photo" for a project card: an office backdrop in the company colour and a person (generic, not a real photo) */
function portrait(color: string, seed: number) {
  const W = 640, H = 360, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!, rnd = mulberry32(seed);
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#d9d4cc'); bg.addColorStop(1, '#8f877c'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(255,255,255,${0.12 + rnd() * 0.18})`; g.fillRect(rnd() * W, 0, 18 + rnd() * 50, H); }   // windows / shelves
  g.fillStyle = color; g.globalAlpha = 0.35; g.fillRect(W * 0.62, H * 0.15, W * 0.3, H * 0.55); g.globalAlpha = 1;
  const skin = ['#e8c4a4', '#c99a76', '#8d5e44', '#f1d2b8'][seed % 4], hair = ['#3b2a1e', '#1d1a18', '#6b4a2b', '#2a2320'][seed % 4];
  const cx = W * 0.45, cy = H * 0.5;
  g.fillStyle = ['#2c3440', '#3d4a3f', '#5a4636', '#2f2f3a'][seed % 4];   // jacket
  g.beginPath(); g.moveTo(cx - 150, H); g.quadraticCurveTo(cx - 140, cy + 70, cx, cy + 62); g.quadraticCurveTo(cx + 140, cy + 70, cx + 150, H); g.fill();
  g.fillStyle = '#f3f1ec'; g.beginPath(); g.moveTo(cx - 34, cy + 64); g.lineTo(cx, cy + 130); g.lineTo(cx + 34, cy + 64); g.fill();   // shirt
  g.fillStyle = skin; g.fillRect(cx - 20, cy + 30, 40, 40);
  g.beginPath(); g.ellipse(cx, cy - 6, 52, 64, 0, 0, 7); g.fill();
  g.fillStyle = hair; g.beginPath(); g.ellipse(cx, cy - 46, 56, 34, 0, Math.PI, 0); g.fill(); g.fillRect(cx - 56, cy - 48, 12, 40); g.fillRect(cx + 44, cy - 48, 12, 40);
  g.fillStyle = 'rgba(40,30,25,.7)'; g.beginPath(); g.arc(cx - 18, cy - 6, 4.5, 0, 7); g.arc(cx + 18, cy - 6, 4.5, 0, 7); g.fill();
  g.strokeStyle = 'rgba(120,60,50,.6)'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy + 22, 16, 0.2, Math.PI - 0.2); g.stroke();
  return cv.toDataURL('image/jpeg', 0.85);
}

function labelSprite(text: string, color: string) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.font = '700 64px Fredoka, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(text).width + 56;
  g.fillStyle = 'rgba(255,255,255,0.94)'; g.beginPath(); g.roundRect(256 - w / 2, 16, w, 96, 48); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(256 - w / 2 + 34, 64, 12, 0, 7); g.fill();
  g.fillStyle = '#10201d'; g.fillText(text, 256 + 14, 66);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(4, 1, 1); sp.renderOrder = 1000; return sp;
}

export class CityScene extends Scene {
  private pins: Pin[] = [];
  private az = 0.15; private azT = 0.15; private el = 0.9; private elT = 0.9;
  private dist = MAX_D; private distT = MAX_D;
  private tgt = new THREE.Vector3(); private tgtT = new THREE.Vector3();
  private bounds = { x0: 0, x1: 0, z0: 0, z1: 0 };
  private joy = new THREE.Vector2(); private uiEl!: HTMLElement; private tip!: HTMLElement; private card!: HTMLElement;
  private ray = new THREE.Raycaster(); private hovered: Pin | null = null; private open: Pin | null = null;
  private seen = new Set<string>(); private explore = 0; private lastXpAt = 0;
  private offs: Array<() => void> = []; private drag: { x: number; y: number; moved: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>(); private pinch = 0; private on = false;
  private cityPost: CityPost | null = null;
  private dome!: WaitlistDome; private domeHi = 0; private domeOn = 0; private join!: HTMLFormElement; private photos = new Map<string, string>();
  constructor(ctx: Ctx) {
    super(ctx, 'city', [0.99, 1.0]); this.theme = 'light';
    this.fx = { bloom: 0.1, grain: 0.02, vignette: 0.1, ca: 0 };
    this.camera.fov = 27; this.camera.far = 1200; this.camera.near = 1;
  }
  init() {
    super.init();
    this.makeBackdrop('void main(){ vec3 col = mix(vec3(.93,.97,.99), vec3(.66,.82,.93), smoothstep(.2,1.,1.-vUv.y)); gl_FragColor = vec4(col,1.); }', {});
    this.scene.fog = new THREE.Fog(0xd8e4ec, 220, 700);
    this.scene.environment = cityEnvironment(this.ctx.renderer);
    this.scene.environmentIntensity = 0.28;   // just enough for glass/metal reflections, not a second light
    const city = buildCityscape(11);
    this.scene.add(city.group);
    // the green JOIN THE WAITLIST dome over the city's centre dome
    this.dome = new WaitlistDome(); this.scene.add(this.dome.group); this.domeOn = 0;
    // realism: ambient occlusion + tilt-shift (n8ao); sized in onResize
    const sz = this.ctx.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.cityPost = new CityPost(this.scene, this.camera, sz.x, sz.y); this.post = this.cityPost;
    this.scene.add(new THREE.HemisphereLight(0xeef4ff, 0xb9b3a4, 0.95));
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.7); sun.position.set(-34, 62, 28); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096); const sc = sun.shadow.camera; sc.left = sc.bottom = -75; sc.right = sc.top = 75; sc.near = 10; sc.far = 190; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
    this.scene.add(sun);

    // hotspot dots + hit areas on each company building
    for (const c of COMPANIES) {
      const a = city.anchors.find((x) => x.id === c.id)!;
      const pos = new THREE.Vector3(a.x, 0, a.z);
      const group = new THREE.Group(); group.position.copy(pos);
      const col = new THREE.Color(c.color);
      const needle = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      needle.renderOrder = 600;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false }));
      ring.renderOrder = 500; ring.position.y = a.top + 1;
      const hit = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      const label = labelSprite(c.name, c.color); label.visible = false;
      group.add(needle, ring, hit, label);
      this.scene.add(group);
      this.pins.push({ c, group, hit, needle, ring, label, pos, top: a.top, hi: 0 });
    }
    this.bounds = { x0: -45, x1: 25, z0: -45, z1: 40 };   // keeps the view inside the city (no edge / gaps on screen)
    this.tgt.set(0, 0, 0); this.tgtT.copy(this.tgt);
    this.buildUI();

    const w = window;
    const pd = (e: PointerEvent) => {
      if (!this.on || (e.target as HTMLElement).closest?.('[data-ui]')) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); this.drag = null; }
    };
    const pm = (e: PointerEvent) => {
      if (!this.on) return;
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0) this.distT = clamp(this.distT * (this.pinch / d), MIN_D, MAX_D); this.pinch = d;
      } else if (this.drag && this.pointers.size === 1) {
        const s = this.dist * 0.0021; const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy);
        if (e.shiftKey) { this.azT -= dx * 0.005; this.elT = clamp(this.elT + dy * 0.004, 0.35, 1.3); } else this.pan(-dx * s, dy * s * 1.4);
      }
      this.hover(e);
    };
    const pu = (e: PointerEvent) => {
      const wasClick = this.drag && this.drag.moved < 6 && this.pointers.size === 1;
      this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinch = 0;
      if (this.pointers.size === 0) { this.drag = null; if (wasClick && this.on) this.click(e); }
    };
    const pc = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.pinch = 0; if (!this.pointers.size) this.drag = null; };
    w.addEventListener('pointerdown', pd); w.addEventListener('pointermove', pm); w.addEventListener('pointerup', pu); w.addEventListener('pointercancel', pc);
    const kd = (e: KeyboardEvent) => {
      if (!this.on) return;
      if (e.key === 'Escape') this.deselect(); else if (e.key === 'ArrowRight') this.step(1); else if (e.key === 'ArrowLeft') this.step(-1);
    };
    w.addEventListener('keydown', kd);
    this.offs.push(() => { w.removeEventListener('keydown', kd); w.removeEventListener('pointerdown', pd); w.removeEventListener('pointermove', pm); w.removeEventListener('pointerup', pu); w.removeEventListener('pointercancel', pc); });
  }
  private buildUI() {
    const el = document.createElement('div'); el.id = 'cityUI';
    el.innerHTML = `<div id="cityHelp">drag to pan · scroll to zoom · click a dot or use ◀ ▶</div><div id="joy" class="glass" data-ui><div class="knob"></div></div>
      <div id="camBtns" data-ui><button class="btn glass" data-a="in" aria-label="Zoom in">+</button><button class="btn glass" data-a="out" aria-label="Zoom out">−</button>
      <button class="btn glass" data-a="l" aria-label="Previous company">◀</button><button class="btn glass" data-a="r" aria-label="Next company">▶</button></div>
      <div id="mapList" data-ui>${COMPANIES.map((c) => `<button class="chip glass" data-id="${c.id}"><i style="background:${c.color}"></i>${c.name}</button>`).join('')}</div>
      <div id="mapCard" data-ui></div>
      <div id="cityTip" class="glass"></div>
      <form id="cityJoin" data-ui data-noscroll><input type="email" placeholder="enter your email" aria-label="Email" required><button type="submit">Join Beta</button></form>`;
    this.ctx.hud.root.appendChild(el);
    this.uiEl = el; this.tip = el.querySelector('#cityTip')!; this.card = el.querySelector('#mapCard')!;
    this.join = el.querySelector('#cityJoin') as HTMLFormElement;
    const input = this.join.querySelector('input') as HTMLInputElement;
    input.addEventListener('input', () => this.join.classList.remove('bad'));
    this.join.noValidate = true;   // our own check + toast instead of the browser bubble
    this.join.addEventListener('submit', (e) => {   // no backend in this demo: validate, then confirm with a toast
      e.preventDefault();
      const v = input.value.trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
      if (!ok) {
        this.join.classList.add('bad'); this.ctx.audio.play('tick');
        this.ctx.hud.toast(v ? "That doesn't look like an email address. Please check and try again." : 'Please enter your email address.', 'err');
        input.focus(); return;
      }
      this.join.classList.remove('bad'); this.ctx.audio.play('ding', 0.6);
      this.ctx.hud.toast("You're on the waitlist! We'll email " + v + ' when your beta access is ready.', 'ok');
      input.value = '';
    });
    el.querySelectorAll('#camBtns button').forEach((b) => b.addEventListener('click', () => {
      const a = (b as HTMLElement).dataset.a; this.ctx.audio.play('tick');
      if (a === 'in') this.distT = clamp(this.distT * 0.7, MIN_D, MAX_D); else if (a === 'out') this.distT = clamp(this.distT * 1.45, MIN_D, MAX_D);
      else this.step(a === 'l' ? -1 : 1);
      this.explore += 6;
    }));
    el.querySelectorAll('#mapList .chip').forEach((b) => b.addEventListener('click', () => {
      const p = this.pins.find((x) => x.c.id === (b as HTMLElement).dataset.id); if (p) this.select(p);
    }));
    this.card.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) this.deselect();
      if (t.closest('[data-join]')) this.focusJoin();
      const st = t.closest('[data-step]') as HTMLElement | null; if (st) this.step(Number(st.dataset.step));
    });
    const joy = el.querySelector('#joy') as HTMLElement, knob = joy.querySelector('.knob') as HTMLElement;
    let act = false;
    const set = (e: PointerEvent) => { const r = joy.getBoundingClientRect(); let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2); const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } this.joy.set(x, y); knob.style.transform = `translate(${x * 32}px,${y * 32}px)`; };
    joy.addEventListener('pointerdown', (e) => { act = true; joy.setPointerCapture(e.pointerId); set(e); });
    joy.addEventListener('pointermove', (e) => { if (act) set(e); });
    const end = () => { act = false; this.joy.set(0, 0); knob.style.transform = ''; };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  }
  private pan(right: number, fwd: number) {
    const sa = Math.sin(this.az), ca = Math.cos(this.az);
    this.tgtT.x += ca * right - sa * fwd; this.tgtT.z += -sa * right - ca * fwd;
    this.tgtT.x = clamp(this.tgtT.x, this.bounds.x0, this.bounds.x1); this.tgtT.z = clamp(this.tgtT.z, this.bounds.z0, this.bounds.z1);
    this.explore += Math.hypot(right, fwd) / Math.max(0.3, this.dist) * 30;
  }
  private pick(e: PointerEvent) {
    this.ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.pins.map((p) => p.hit), false)[0];
    return hit ? this.pins.find((p) => p.hit === hit.object) ?? null : null;
  }
  private hover(e: PointerEvent) {
    if (this.ctx.input.isTouch) return;
    const p = this.drag && this.drag.moved > 6 ? null : this.pick(e);
    if (p !== this.hovered) { this.hovered = p; if (p) this.ctx.audio.play('hover', 0.6); }
    const od = !p && this.overDome(e); this.domeHi = od ? 1 : 0;
    document.body.style.cursor = p || od ? 'pointer' : this.drag ? 'grabbing' : 'grab';
    this.tip.textContent = p ? p.c.name + ' · ' + p.c.role : '';
    this.tip.style.opacity = p ? '1' : '0';
    this.tip.style.transform = `translate(${e.clientX + 16}px,${e.clientY + 16}px)`;
  }
  private overDome(e: PointerEvent) {
    this.ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), this.camera);
    return this.ray.intersectObject(this.dome.hit, false).length > 0;
  }
  private focusJoin() { this.join.classList.add('pulse'); (this.join.querySelector('input') as HTMLInputElement).focus(); setTimeout(() => this.join.classList.remove('pulse'), 900); }
  private click(e: PointerEvent) { const p = this.pick(e); if (p) this.select(p); else if (this.overDome(e)) { this.deselect(); this.focusJoin(); } else if (this.open) this.deselect(); }
  private select(p: Pin) {
    this.open = p; this.ctx.audio.play('tick');
    if (!this.seen.has(p.c.id)) { this.seen.add(p.c.id); this.ctx.hud.addXP(10, true); }
    this.tgtT.set(p.pos.x, p.top * 0.35, p.pos.z); this.distT = 58; this.elT = 0.8;
    const c = p.c;
    this.card.style.setProperty('--accent', c.color);
    if (!this.photos.has(c.id)) this.photos.set(c.id, portrait(c.color, this.pins.indexOf(p) + 1));
    // reference card: photo with the company badge, a small mono role, bold title, short brief, tool chips, black Join Beta
    this.card.innerHTML = `<button class="x" data-close aria-label="Close">✕</button>
      <div class="ph" style="background-image:url(${this.photos.get(c.id)})"><span class="badge"><i></i>${c.name}</span></div>
      <div class="role">${c.role}</div><h3>${c.project}</h3><p class="about">${c.summary}</p>
      <div class="known">${c.tools.map((k) => `<span><i></i>${k}</span>`).join('')}</div>
      <button class="join" data-join>Join Beta</button>`;
    this.card.classList.add('show');
    this.uiEl.querySelectorAll('#mapList .chip').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === c.id));
  }
  /** ◀ ▶: fly to the previous / next company and open its card */
  private step(dir: number) {
    const n = this.pins.length;
    const i = this.open ? this.pins.indexOf(this.open) : dir > 0 ? -1 : 0;
    this.select(this.pins[(i + dir + n) % n]);
  }
  private deselect() {
    this.open = null; this.card.classList.remove('show'); this.tgtT.y = 0; this.distT = Math.max(this.distT, 72); this.elT = 0.9;
    this.uiEl.querySelectorAll('#mapList .chip').forEach((b) => b.classList.remove('on'));
  }
  enter() { this.ctx.hud.setTheme('light'); this.ctx.hud.showMenuBtn(true); }
  exit() { this.setOn(false); }
  private setOn(v: boolean) {
    if (v === this.on) return;
    this.on = v; this.uiEl?.classList.toggle('on', v);
    if (!v) document.body.style.cursor = '';
    this.ctx.scroll.suspend = v;
    this.ctx.scroll.wheelInterceptor = v ? (dy) => {
      if (dy < 0 && this.distT >= MAX_D - 0.5) return false; // fully zoomed out: let the story scroll back
      this.distT = clamp(this.distT * Math.exp(dy * 0.0016), MIN_D, MAX_D); this.explore += 1; return true;
    } : null;
  }
  update(l: number, dt: number, t: number) {
    const ctx = this.ctx;
    this.setOn(ctx.scroll.progress > this.range[0] + (1 - this.range[0]) * 0.6);
    if (this.on && this.joy.lengthSq() > 0.001) this.pan(this.joy.x * dt * this.dist * 0.45, -this.joy.y * dt * this.dist * 0.45);
    this.az = damp(this.az, this.azT, 5, dt); this.el = damp(this.el, this.elT, 4, dt); this.dist = damp(this.dist, this.distT, 4.5, dt);
    this.tgt.x = damp(this.tgt.x, this.tgtT.x, 4, dt); this.tgt.z = damp(this.tgt.z, this.tgtT.z, 4, dt); this.tgt.y = damp(this.tgt.y, this.tgtT.y, 4, dt);
    const intro = 1 - smoothstep(0, 0.6, l);
    const d = this.dist, tg = this.tgt, el = this.el - intro * 0.25;
    this.camera.position.set(tg.x + Math.sin(this.az) * Math.cos(el) * d, tg.y + Math.sin(el) * d, tg.z + Math.cos(this.az) * Math.cos(el) * d);
    this.camera.lookAt(tg.x, tg.y, tg.z);
    // pins keep a readable screen size at any zoom; campus massing stays true to scale
    const ps = clamp(d * 0.011, 0.07, 0.9);
    for (const p of this.pins) {
      p.hi = damp(p.hi, p === this.hovered || p === this.open ? 1 : 0, 10, dt);
      const s = ps * (1 + p.hi * 0.25);
      p.needle.scale.setScalar(s * 0.85); p.needle.position.y = p.top + 2.2 * s; p.hit.scale.setScalar(s); p.hit.position.y = p.top + 2.2 * s;
      p.label.scale.set(4 * s * 1.2, 1 * s * 1.2, 1); p.label.position.y = p.top + 6.2 * s;
      const pulse = (t * 0.8 + p.pos.x) % 1; p.ring.scale.setScalar(s * (1.2 + pulse * 3.2)); p.ring.position.y = p.top + 1;
      (p.ring.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * 0.7;
      p.label.visible = p.hi > 0.05; (p.label.material as THREE.SpriteMaterial).opacity = p.hi;
    }
    this.domeOn = damp(this.domeOn, 1, 1.5, dt);
    this.dome.update(t, this.domeOn, this.domeHi);
    this.uiEl?.classList.toggle('joinOn', this.on);
    if (this.on && this.explore - this.lastXpAt > 30) { this.lastXpAt = this.explore; ctx.hud.addXP(5, false); }
  }
  protected onResize() { const sz = this.ctx.renderer.getDrawingBufferSize(new THREE.Vector2()); this.cityPost?.setSize(sz.x, sz.y); }
  dispose() {
    this.cityPost?.dispose(); this.cityPost = null; this.post = null;
    this.offs.forEach((f) => f()); this.offs = []; this.setOn(false); this.uiEl?.remove();
    document.body.style.cursor = ''; super.dispose();
  }
}
