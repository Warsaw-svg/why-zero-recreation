import * as THREE from 'three';
import { Scene, type Ctx } from '../core/Scene';
import { Hand, POSES, type HandPose } from '../utils/Hand';
import { TextLine } from '../utils/text';
import { win, lerp, easeOutCubic, easeInOutCubic, smoothstep, clamp } from '../utils/math';
import { logoTexture, coinMesh } from '../utils/props';
import { makeLockup, SERIF } from '../utils/lockup';
import { setHandOnPath } from '../utils/handPath';

/* ---------- 1. You Believed ---------- */
/** "You / Believed" lockup: condensed serif + big swash B, drawn white on a canvas; the shader colours it (teal gradient,
 *  soft emboss) and animates it in (left→right sweep: blurred bright cyan → sharp teal) and out (blur + bleach from the right). */
function drawBelieved(g: CanvasRenderingContext2D) {
  // "elieved" + "You" — condensed high-contrast serif
  g.font = '400 400px "Instrument Serif", "Playfair Display", serif';
  g.textAlign = 'left';
  g.fillText('elieved', 840, 760);
  g.font = '400 360px "Instrument Serif", "Playfair Display", serif';
  g.fillText('You', 1020, 455);
  // swash B
  g.save(); g.translate(560, 790); g.rotate(-0.06);
  g.font = '400 820px "Pinyon Script", cursive'; g.textAlign = 'center';
  g.fillText('B', 0, 0);
  g.restore();
  // long calligraphic entry stroke + top loop (thick-thin: many offset strokes)
  const swash = (pts: number[][], w0: number, w1: number) => {
    for (let k = 0; k <= 14; k++) {
      const f = k / 14, w = w0 + (w1 - w0) * Math.sin(f * Math.PI);
      g.lineWidth = Math.max(1.5, w * (1 - Math.abs(f - .5)));
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1] + (f - .5) * w);
      g.bezierCurveTo(pts[1][0], pts[1][1] + (f - .5) * w, pts[2][0], pts[2][1] + (f - .5) * w, pts[3][0], pts[3][1] + (f - .5) * w);
      g.stroke();
    }
  };
  g.lineCap = 'round';
  swash([[150, 735], [330, 720], [560, 700], [760, 735]], 4, 14);
}
export class BelievedScene extends Scene {
  private bg!: THREE.ShaderMaterial;
  private lock!: THREE.Mesh;
  private lockMat!: THREE.ShaderMaterial;
  private sub!: TextLine;
  private t0 = -1;
  constructor(ctx: Ctx) {
    super(ctx, 'believed', [0, 0.045]);   // short: the green blob takes over soon after the lettering settles
    this.theme = 'light';
    this.fx = { bloom: 0.06, grain: 0.03, vignette: 0.0, ca: 0 };
    this.camera.position.set(0, 0, 6);
  }
  init() {
    super.init();
    // white page, soft mint glow creeping in from the lower corners
    this.bg = this.makeBackdrop(/* glsl */ `
      uniform float uGlow;
      void main(){
        vec2 p = vUv; float f = fbm(p*2.4 + vec2(uTime*.03, uTime*.01));
        vec3 col = vec3(.985, .995, .99);
        float cl = exp(-pow(length((p - vec2(-.05, -.1)) * vec2(1.3, 1.6)), 2.) * 2.2);
        float cr = exp(-pow(length((p - vec2(1.05, -.1)) * vec2(1.3, 1.6)), 2.) * 2.2);
        float gl = clamp((cl + cr) * (.75 + f * .5), 0., 1.) * uGlow;
        col = mix(col, vec3(.55, .80, .68), gl * .8);
        gl_FragColor = vec4(col, 1.);
      }`, { uGlow: { value: 0 } });
    const lk = makeLockup(drawBelieved);
    this.lock = lk.mesh; this.lockMat = lk.mat;
    this.lockMat.uniforms.uOutSweep.value = 0;   // You Believed fades/blurs away in place (no sideways slide)
    this.ui.add(this.lock);
    this.sub = this.addText(new TextLine([{ t: 'SCROLL', f: 'mono', s: 0.04, c: '#0f3b36', ls: 0.3 }]));
  }
  protected layoutText() {
    const w = Math.min(this.aspect * 2 * (this.portrait ? 0.98 : 0.56), 2.4);   // plane width in ui units (content fills ~85 % of it)
    this.lock.scale.set(w / 2, w / 2, 1);
    this.lock.position.set(0, 0.04, 0);
    this.sub.place(0, -0.82, 0.5, 0.5);
  }
  enter() { this.ctx.hud.setTheme('light'); this.ctx.hud.showMenuBtn(true); }
  update(l: number, _dt: number, t: number) {
    this.bg.uniforms.uTime.value = t;
    if (this.t0 < 0 && this.ctx.gates.isSolved('intro')) this.t0 = t;
    const since = this.t0 < 0 ? -1 : t - this.t0;
    // draws in as the white bloom lifts (intro hands off ~3.8 s after the solve)
    const din = since < 0 ? 0 : clamp((since - 3.6) / 1.5);
    this.lockMat.uniforms.uIn.value = easeInOutCubic(din);
    this.lockMat.uniforms.uOut.value = easeInOutCubic(smoothstep(0.35, 0.85, l));
    this.bg.uniforms.uGlow.value = (since < 0 ? 0 : clamp((since - 4) / 3)) * (0.55 + 0.45 * smoothstep(0, 0.6, l));
    this.sub.set(since < 0 ? 0 : clamp((since - 5.2) / 1) * (1 - smoothstep(0.02, 0.15, l)), 0, 0, 0.7);
    this.theme = 'light';
  }
}

/* ---------- 2. Green hand rising ---------- */
/** like the reference: index up, middle reaching toward you, ring + pinky folded, thumb relaxed out */
const REACH = { index: 0.02, middle: 0.1, ring: 0.68, pinky: 0.76, thumb: 0.15, spread: 0.45, thumbIn: 0.15, mcp: { middle: 0.5 } };
/** blend two poses, plus a slow breathing of the fingers so the hand never looks frozen */
export function livingPose(a: HandPose, b: HandPose, f: number, t: number): HandPose {
  const o = {} as HandPose;
  (['index', 'middle', 'ring', 'pinky', 'thumb'] as const).forEach((k, i) => (o[k] = a[k] + (b[k] - a[k]) * f + Math.sin(t * 1.1 + i * 0.7) * 0.025 + 0.025));
  o.spread = (a.spread ?? 1) + ((b.spread ?? 1) - (a.spread ?? 1)) * f;
  o.thumbIn = (a.thumbIn ?? 0) + ((b.thumbIn ?? 0) - (a.thumbIn ?? 0)) * f;
  return o;
}
/** open reach the green hand ends on */
const OPEN_REACH = { ...POSES.open, thumb: 0.06, spread: 0.6, thumbIn: 0.5 };   // thumb already close to its handshake pose, so it only moves with the hand
/** a cyan liquid blob grows out of the white page; a glossy green hand rises up through its surface and reaches for the cursor */
export class GreenHandScene extends Scene {
  private bg!: THREE.ShaderMaterial;
  private hand!: Hand;
  private coins: THREE.Mesh[] = [];
  private clinked = false;
  private aim = new THREE.Vector2();
  constructor(ctx: Ctx) {
    super(ctx, 'greenhand', [0.03, 0.185]);   // starts sooner after You Believed; the end is unchanged so the hand path still joins at 0.172
    this.theme = 'light';
    this.fx = { bloom: 0.18, grain: 0.03, vignette: 0.0, ca: 0 };
  }
  init() {
    super.init();
    this.bg = this.makeBackdrop(/* glsl */ `
      float inside0(float f){ return smoothstep(1., 1.25, f); }
      uniform float uGrow; uniform float uFill; uniform vec2 uMouse; uniform float uAsp; uniform float uOrb;
      void main(){
        vec2 p = vUv; vec2 q = (p - .5) * vec2(uAsp, 1.);
        float tm = uTime * .25;
        // metaball liquid: five slow centres around the hand
        float f = 0.;
        for (int i = 0; i < 5; i++) {
          float fi = float(i);
          vec2 c = vec2(sin(tm * (.7 + fi * .13) + fi * 2.1) * .09 * uAsp, cos(tm * (.5 + fi * .11) + fi * 1.3) * .07 - .02);
          float r = (.13 + .04 * sin(fi * 3.7)) * uGrow * (1. + fi * .1);
          f += r * r / max(dot(q - c, q - c), 1e-4);
        }
        f = max(f, uFill * 9.);
        float inside = smoothstep(1., 1.25, f);
        float band = smoothstep(.45, 1., f) * (1. - inside);                 // bright white lip around the liquid
        float n = fbm(p * 2.2 + vec2(uTime * .03, -uTime * .02));
        // outside: white page, mint glow from the corners (continues "You Believed")
        float corner = clamp(exp(-pow(length((p - vec2(-.05, -.1)) * vec2(1.3, 1.6)), 2.) * 2.2) + exp(-pow(length((p - vec2(1.05, -.1)) * vec2(1.3, 1.6)), 2.) * 2.2) + smoothstep(.55, 1.3, length(q)) * .6, 0., 1.);
        // soft white core where the liquid is about to open
        float core = exp(-dot(q, q) * 9.) * smoothstep(0., .25, uGrow) * (1. - inside0(f));
        vec3 col = mix(vec3(.985, .995, .99), vec3(.62, .86, .74), corner * (.6 + n * .4) * (1. - uFill));
        col = mix(col, vec3(1.), clamp(band * .95 + core, 0., 1.));
        // inside: aqua, lighter toward the top, slightly deeper around the middle
        vec3 aq = mix(vec3(.40, .79, .83), vec3(.66, .92, .88), smoothstep(.1, 1., p.y + (n - .5) * .3));
        aq = mix(aq, vec3(.33, .72, .78), exp(-dot(q, q) * 6.) * .25 * (1. - uFill));
        col = mix(col, aq, inside);
        // white light where the hand reaches (the cursor)
        float o = exp(-pow(length((p - uMouse) * vec2(uAsp, 1.)) / .075, 2.));
        float oh = exp(-pow(length((p - uMouse) * vec2(uAsp, 1.)) / .2, 2.));
        col = mix(col, vec3(1.), clamp(o * .95 + oh * .35, 0., 1.) * uOrb);
        gl_FragColor = vec4(col, 1.);
      }`, { uGrow: { value: 0 }, uFill: { value: 0 }, uMouse: { value: new THREE.Vector2(.55, .62) }, uAsp: { value: 1.6 }, uOrb: { value: 0 } });
    this.hand = new Hand('clay', 0x35e04a, 2.5);
    this.hand.setPose(REACH);
    this.hand.showBack(false);
    this.scene.add(this.hand.group);
    const tex = [0, 3, 5].map((i) => logoTexture(i));
    for (let i = 0; i < 3; i++) { const c = coinMesh(tex[i]); c.scale.setScalar(0.6); this.coins.push(c); this.scene.add(c); }
  }
  enter() { this.clinked = false; this.ctx.hud.setTheme('light'); }
  update(l: number, dt: number, t: number) {
    const ip = this.ctx.input;
    this.aim.set(ip.sx || 0, ip.sy || 0);   // Input already eases the cursor; every scene uses the same value so crossfades match
    const rise = easeOutCubic(clamp((l - 0.02) / 0.45));
    const turn = easeInOutCubic(smoothstep(0.42, 0.9, l));                 // later: opens up and reaches to the upper right
    const h = this.hand.group;
    // comes OUT toward the viewer: starts deep behind the liquid surface, fingers tipped toward the camera, and pushes forward
    // through it (fingertips break the surface first, then the palm); later settles into the reach to the upper right
    h.position.set(lerp(0.1, 0.85, turn) + this.aim.x * 0.25, lerp(lerp(-0.75, -1.15, rise), -1.5, turn) + this.aim.y * 0.15, lerp(lerp(-4.5, 0.4, rise), 0, turn));
    h.rotation.set(lerp(lerp(1.0, 0.35, rise), -0.2, turn) - this.aim.y * 0.12 + Math.sin(t * 0.6) * 0.03, lerp(0.15, 0.45, turn), lerp(0.12, -0.75, turn) - this.aim.x * 0.15 + Math.sin(t * 0.45) * 0.03);
    this.hand.lerpPose(REACH, OPEN_REACH, smoothstep(0.42, 0.8, l));
    this.hand.update(t);
    // liquid surface the hand rises through: fingertips first, then palm; the forearm stays sunk in cyan
    const u = this.hand.mat.uniforms;
    // surface: first a plane facing the camera (depth fade), later blending to the forearm fade along world Y
    u.uFadeDir.value.set(0, turn, 1 - turn).normalize();
    u.uFadeY.value = lerp(-0.7, -3.0, turn);
    u.uFadeW.value = lerp(0.55, 1.4, turn);
    this.camera.position.set(0, 0.15, 7.5);
    this.camera.lookAt(0, 0, 0);
    this.coins.forEach((c, i) => {
      const a = t * (0.6 + i * 0.15) + i * 2.1;
      const r = 2.3 + i * 0.35;
      c.position.set(-0.8 + Math.cos(a) * r * 0.8, 0.2 + Math.sin(a * 1.3 + i) * 1.1, Math.sin(a) * r * 0.5);
      c.rotation.set(t * (0.8 + i * 0.3), t * 0.6, i);
      c.scale.setScalar(0.6 * smoothstep(0.45, 0.7, l));
    });
    if (!this.clinked && l > 0.5) { this.clinked = true; [0, 180, 330].forEach((d, i) => setTimeout(() => this.ctx.audio.play('clink', 0.7, 0.9 + i * 0.18), d)); }
    const bu = this.bg.uniforms;
    bu.uTime.value = t;
    bu.uAsp.value = this.aspect;
    bu.uGrow.value = smoothstep(0.0, 0.4, l) * 1.6;
    bu.uFill.value = smoothstep(0.32, 0.55, l);
    bu.uOrb.value = smoothstep(0.08, 0.3, l);
    bu.uMouse.value.set(this.aim.x * 0.5 + 0.5, this.aim.y * 0.5 + 0.5);
  }
  dispose() { this.hand?.dispose(); super.dispose(); }
}

/* ---------- 3. College would land You ---------- */
function drawCollege(g: CanvasRenderingContext2D) {
  g.font = `400 330px ${SERIF}`; g.textAlign = 'left';
  g.fillText('ollege', 700, 560);
  g.font = `400 230px ${SERIF}`; g.textAlign = 'right';
  g.fillText('would', 1520, 800);
  g.save(); g.translate(470, 600); g.rotate(-0.04);
  g.font = '400 760px "Pinyon Script", cursive'; g.textAlign = 'center';
  g.fillText('C', 0, 0);
  g.restore();
}
function drawLandYou(g: CanvasRenderingContext2D) {
  g.font = `italic 400 640px ${SERIF}`; g.textAlign = 'left';
  g.fillText('You', 300, 900);
  g.font = `400 250px ${SERIF}`;
  g.fillText('land', 1050, 420);
}
/** "College would" (top left) and "land You" (bottom right) draw in while the green hand reaches across and logo coins tumble up past it; light rays fall from the top right */
export class CollegeScene extends Scene {
  private bg!: THREE.ShaderMaterial;
  private hand!: Hand;
  private coins: Array<{ m: THREE.Mesh; ph: number; sp: THREE.Vector3; lane: number }> = [];
  private lkC!: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  private lkY!: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  private aim = new THREE.Vector2();
  private fdir = new THREE.Vector3();
  constructor(ctx: Ctx) {
    super(ctx, 'college', [0.155, 0.275]);
    this.theme = 'light';
    this.fx = { bloom: 0.16, grain: 0.03, vignette: 0.0, ca: 0.0 };
  }
  init() {
    super.init();
    this.bg = this.makeBackdrop(/* glsl */ `
      uniform float uLight; uniform vec2 uMouse; uniform float uAsp;
      void main(){
        vec2 p = vUv; float f = fbm(p * 2.2 + uTime * .03);
        vec3 aq = mix(vec3(.40, .79, .83), vec3(.66, .92, .88), smoothstep(.1, 1., p.y + (f - .5) * .3));     // where the green-hand scene left off
        vec3 pale = mix(vec3(.70, .88, .82), vec3(.97, .995, .985), smoothstep(-.1, .9, p.y + p.x * .35 + (f - .5) * .25));
        vec3 col = mix(aq, pale, uLight);
        // light rays from the top right
        vec2 o = vec2(1.05, 1.15); vec2 d = (p - o) * vec2(uAsp, 1.);
        float ang = atan(d.y, d.x);
        float rays = pow(.5 + .5 * sin(ang * 38. + fbm(vec2(ang * 6., uTime * .1)) * 5.), 6.) + pow(.5 + .5 * sin(ang * 17. - 1.3), 8.) * .6;
        rays *= exp(-length(d) * 1.4) * smoothstep(.2, 1.3, p.x + p.y);
        col += vec3(1.) * rays * .32 * uLight;
        float o2 = exp(-pow(length((p - uMouse) * vec2(uAsp, 1.)) / .09, 2.)) + exp(-pow(length((p - uMouse) * vec2(uAsp, 1.)) / .22, 2.)) * .4;
        col = mix(col, vec3(1.), clamp(o2, 0., 1.) * .85);
        gl_FragColor = vec4(col, 1.);
      }`, { uLight: { value: 0 }, uMouse: { value: new THREE.Vector2(.55, .62) }, uAsp: { value: 1.6 } });
    this.hand = new Hand('clay', 0x35e04a, 2.5);
    this.hand.setPose(POSES.open);
    this.hand.showBack(false);
    this.scene.add(this.hand.group);
    for (let i = 0; i < 9; i++) {
      const m = coinMesh(logoTexture(i));
      this.coins.push({ m, ph: i / 9, lane: (i * 0.618) % 1, sp: new THREE.Vector3(1.5 + (i % 3) * 0.7, 2 + (i % 4) * 0.5, 0.6 + (i % 2)) });
      this.scene.add(m);
    }
    this.lkC = makeLockup(drawCollege); this.ui.add(this.lkC.mesh);
    this.lkY = makeLockup(drawLandYou); this.ui.add(this.lkY.mesh);
    this.camera.position.set(0, 0.15, 7.5);
  }
  protected layoutText() {
    const a = this.aspect, p = this.portrait;
    const wc = Math.min(a * 2 * (p ? 0.95 : 0.56), 2.8);
    this.lkC.mesh.scale.set(wc / 2, wc / 2, 1);
    this.lkC.mesh.position.set(-a + wc * 0.5 - wc * 0.04, p ? 0.62 : 0.52, 0);
    const wy = Math.min(a * 2 * (p ? 0.7 : 0.36), 1.9);
    this.lkY.mesh.scale.set(wy / 2, wy / 2, 1);
    this.lkY.mesh.position.set(a - wy * 0.5 - (p ? 0.02 : 0.06), p ? -0.55 : -0.4, 0);
  }
  enter() { this.ctx.hud.setTheme('light'); }
  update(l: number, dt: number, t: number) {
    const ip = this.ctx.input;
    this.aim.set(ip.sx || 0, ip.sy || 0);   // Input already eases the cursor; every scene uses the same value so crossfades match
    // hand: stays in the open reach the green-hand scene ends on (no lying-down turn); the meadow scene then
    // takes it straight from here into the handshake. Same transform formula as GreenHandScene at turn = 1.
    // the hand keeps travelling with the scroll: one path (shared with the meadow scene) from the open reach to the handshake
    this.hand.setPose(setHandOnPath(this.hand.group, this.ctx.scroll.progress, this.aim.x, this.aim.y, t));
    this.hand.update(t);
    const u = this.hand.mat.uniforms;
    u.uFadeDir.value.set(0, 1, 0); u.uFadeY.value = -3.0; u.uFadeW.value = 1.4;
    u.uFadeCol.value.setRGB(0.6, 0.9, 0.87);
    this.camera.lookAt(0, 0, 0);
    // coins tumble up from below the forearm, past the hand, toward the camera
    const show = smoothstep(0.0, 0.12, l) * (1 - smoothstep(0.75, 0.95, l));
    for (const c of this.coins) {
      const life = (t * 0.22 + c.ph) % 1;
      const x = lerp(-2.6 + c.lane * 1.4, -0.4 + c.lane * 2.2, life), y = lerp(-3.4, 2.6, life) + Math.sin(life * 3.1 + c.ph * 6) * 0.4;
      c.m.position.set(x, y, lerp(-1.2, 2.4, life) * (0.5 + c.lane * 0.5));
      c.m.rotation.set(t * c.sp.x + c.ph * 9, t * c.sp.y * 0.6, t * c.sp.z);
      c.m.scale.setScalar(0.62 * show * smoothstep(0, 0.12, life) * (1 - smoothstep(0.85, 1, life)));
    }
    // lettering: sweep in, hold, dissolve as the meadow arrives
    this.lkC.mat.uniforms.uIn.value = easeInOutCubic(smoothstep(0.02, 0.32, l));
    this.lkY.mat.uniforms.uIn.value = easeInOutCubic(smoothstep(0.22, 0.5, l));
    const out = easeInOutCubic(smoothstep(0.82, 1, l));
    this.lkC.mat.uniforms.uOut.value = out; this.lkY.mat.uniforms.uOut.value = out;
    const bu = this.bg.uniforms;
    bu.uTime.value = t; bu.uAsp.value = this.aspect;
    bu.uLight.value = easeInOutCubic(smoothstep(0.0, 0.4, l));
    bu.uMouse.value.set(this.aim.x * 0.5 + 0.5, this.aim.y * 0.5 + 0.5);
  }
  dispose() { this.hand?.dispose(); super.dispose(); }
}
