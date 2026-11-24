import * as THREE from 'three';
import gsap from 'gsap';
import { Scene, type Ctx } from '../core/Scene';
import { HoldGate } from '../core/HoldGate';
import { NOISE } from '../shaders/common';
import { makeLockup, SERIF, type Lockup } from '../utils/lockup';
import { easeOutCubic, smoothstep, lerp, mulberry32 } from '../utils/math';
import { P } from '../core/progressMap';

/**
 * Component 4c — matched to recording/componet4.mov 20–26 s: black starry space with one bright dot; "and that's Why"
 * (top left), the dot grows into a grey glass orb while "we had to Exist" comes in on the right; a big metallic-green
 * segmented ring zooms in from outside the screen and settles round the orb with two finer rings; the lettering goes and
 * you're parked on the orb with the TAP / HOLD prompt (same prompt as Component 2).
 */
const RING_FRAG = /* glsl */ `
uniform float uTime; uniform float uProg; uniform float uSeg; uniform float uDir; uniform float uW; uniform float uGapW; uniform float uOn; uniform float uSpin;
uniform float uBlur; uniform float uNeon;
varying vec2 vUv;
const float TAU = 6.28318530718;
void main(){
  vec2 q = vUv - .5; float r = length(q) * 2.5;              // 1 = the ring's outer edge (the plane leaves room for a glow)
  float inner = 1. - uW, soft = .006 + uBlur * .07;          // uBlur: out of focus while it's big / close to the lens
  float band = smoothstep(inner - soft, inner + soft, r) * (1. - smoothstep(1. - soft, 1. + soft, r));
  float a = fract(atan(q.y, q.x) / TAU + .5 + uSpin);
  float f = fract(a * uSeg), seg = floor(a * uSeg);
  float gs = uGapW + uBlur * .05;
  float gap = smoothstep(0., gs, f) * (1. - smoothstep(1. - gs, 1., f));
  // neon glow around the segments when the hold completes
  float dist = max(inner - r, r - 1.);
  float halo = uNeon * exp(-max(dist, 0.) * 9.) * (.35 + .65 * gap);
  if (band * gap < .01 && halo < .01) discard;
  // bevel: light rolls across the band's width like a metal rim; a bright highlight travels round
  float w = clamp((r - inner) / uW, 0., 1.);
  float bev = .45 + .55 * pow(max(sin(w * 3.14159), 0.), .6) - .25 * w;
  float sweep = pow(max(0., cos((a - fract(uTime * .08)) * TAU)), 24.);
  float lit = step(seg / uSeg, uProg - .0001);
  vec3 dark = vec3(.06, .26, .16), mid = vec3(.3, .78, .54), hi = vec3(.8, 1., .9);
  vec3 col = mix(dark, mid, bev) + hi * sweep * .9 * (1. - uBlur) + hi * lit * .55;
  col *= 1. - uBlur * .45;
  vec3 neon = vec3(.25, 1., .38);
  col = mix(col, neon * 1.6 + vec3(.6, 1., .6) * bev * .4, uNeon);
  float al = band * gap + halo * .8;
  gl_FragColor = vec4(mix(col, neon, halo * (1. - band * gap)) * uOn, clamp(al, 0., 1.) * uOn);
}`;

const ORB_FRAG = /* glsl */ `
uniform float uTime; uniform float uP; uniform float uOn; varying vec3 vN; varying vec3 vV; ${NOISE}
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  float ndv = max(dot(N, V), 0.), fr = pow(1. - ndv, 2.2);
  float n = fbm(N.xy * 2.5 + uTime * .15);
  vec3 col = vec3(.07, .08, .08) + vec3(.55, .6, .58) * fr * (.8 + n * .4);   // grey glass: dark core, soft bright rim
  col += vec3(.9, 1., .95) * pow(ndv, 18.) * .12;
  col += vec3(.4, 1., .75) * uP * fr * .6;
  gl_FragColor = vec4(col * uOn, (.55 + fr * .45) * uOn);
}`;

const STAR_VERT = /* glsl */ `attribute vec4 aSeed; uniform float uTime; varying float vA;
void main(){ vec3 p = vec3((aSeed.x - .5) * 22., (aSeed.y - .5) * 13., -4. - aSeed.z * 10.);
  p.x += sin(uTime * .05 + aSeed.w * 30.) * .2; p.y += uTime * .02 * (aSeed.w - .5);
  vA = .25 + .75 * aSeed.w * (.7 + .3 * sin(uTime * (1. + aSeed.z * 2.) + aSeed.x * 40.));
  vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (1.5 + aSeed.w * aSeed.w * 4.5) * (10. / -mv.z); gl_Position = projectionMatrix * mv; }`;
const STAR_FRAG = 'varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.92, 1., .96), smoothstep(.5, .0, d) * vA); }';

export class Gate2Scene extends Scene {
  private bg!: THREE.ShaderMaterial; private rings: THREE.Mesh[] = []; private ringGroup = new THREE.Group();
  private ghosts: THREE.Mesh[] = []; private ghostGroup = new THREE.Group();
  private orb!: THREE.Mesh; private orbMat!: THREE.ShaderMaterial; private dot!: THREE.Mesh; private dotMat!: THREE.ShaderMaterial;
  private starMat!: THREE.ShaderMaterial;
  private why!: Lockup; private exist!: Lockup; private base = new Map<Lockup, THREE.Vector2>();
  private hold!: HoldGate; private tmp = new THREE.Vector3();
  private done = { v: 0 };
  constructor(ctx: Ctx) { super(ctx, 'gate2', [0.83, 0.925]); this.theme = 'dark'; this.fx = { bloom: 0.4, grain: 0.08, vignette: 0.55, ca: 0.08 }; }
  init() {
    super.init();
    this.rings = []; this.ghosts = []; this.base = new Map(); this.ringGroup = new THREE.Group(); this.ghostGroup = new THREE.Group(); this.done.v = 0;
    this.camera.position.set(0, 0, 9);
    // black space; later a few dim, blurred green shapes drift behind (reference 24–26 s)
    this.bg = this.makeBackdrop(/* glsl */ `
      uniform float uShapes; uniform float uGlow;
      void main(){ vec2 q = vUv - .5; q.x *= uRes.x / uRes.y; float r = length(q);
        vec3 col = vec3(.006, .009, .008);
        float s = fbm(q * 1.6 + vec2(uTime * .02, -uTime * .015));
        col += vec3(.02, .07, .04) * smoothstep(.45, .75, s) * uShapes;
        col += vec3(.06, .35, .12) * exp(-r * 2.2) * uGlow * .6 + vec3(.02, .12, .04) * uGlow * .5;   // goes green as the hold completes
        gl_FragColor = vec4(col, 1.); }`, { uShapes: { value: 0 }, uGlow: { value: 0 } });
    // stars / dust
    const rnd = mulberry32(5), ns = Math.floor(220 * this.ctx.quality.particles) + 40, sd = new Float32Array(ns * 4);
    for (let i = 0; i < sd.length; i++) sd[i] = rnd();
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ns * 3), 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
    this.starMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG });
    const stars = new THREE.Points(sg, this.starMat); stars.frustumCulled = false; this.scene.add(stars);
    // the bright dot that becomes the orb
    this.dotMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 1 }, uSoft: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      // uSoft 1 = the finish's white bloom: a soft glow with no hard edge (reference), instead of the crisp dot
      fragmentShader: 'uniform float uA; uniform float uSoft; varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float c = mix(smoothstep(.22, .12, d) + exp(-d * 5.) * .35, exp(-d * d * 9.) * 1.3, uSoft); gl_FragColor = vec4(vec3(1.), c * uA); }' });
    this.dot = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), this.dotMat); this.dot.renderOrder = 3; this.scene.add(this.dot);
    // grey glass orb
    this.orbMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uP: { value: 0 }, uOn: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: ORB_FRAG });
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.82, 48, 32), this.orbMat); this.orb.renderOrder = 2; this.scene.add(this.orb);
    // metallic green segmented rings: big outer rim, a finer middle ring, a dashed inner ring
    const SPEC: Array<{ r: number; seg: number; w: number; gap: number; dir: number }> = [
      { r: 1.62, seg: 7, w: 0.12, gap: 0.05, dir: 1 },
      { r: 1.3, seg: 9, w: 0.06, gap: 0.08, dir: -1 },
      { r: 1.08, seg: 14, w: 0.05, gap: 0.16, dir: 1 },
    ];
    const mkRing = (s: { r: number; seg: number; w: number; gap: number; dir: number }) =>
      new THREE.Mesh(new THREE.PlaneGeometry(s.r * 2.5, s.r * 2.5), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uProg: { value: 0 }, uSeg: { value: s.seg }, uDir: { value: s.dir }, uW: { value: s.w }, uGapW: { value: s.gap }, uOn: { value: 0 }, uSpin: { value: 0 }, uBlur: { value: 0 }, uNeon: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: RING_FRAG }));
    // tunnel rings: while you hold, big out-of-focus rims keep sweeping in from outside and shrinking toward the orb
    for (let j = 0; j < 3; j++) { const g = mkRing({ r: 1.62, seg: 7, w: 0.14, gap: 0.05, dir: j % 2 ? -1 : 1 }); g.renderOrder = 3; g.userData.dir = j % 2 ? -1 : 1; this.ghosts.push(g); this.ghostGroup.add(g); }
    this.scene.add(this.ghostGroup);
    SPEC.forEach((s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.r * 2.5, s.r * 2.5), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uProg: { value: 0 }, uSeg: { value: s.seg }, uDir: { value: s.dir }, uW: { value: s.w }, uGapW: { value: s.gap }, uOn: { value: 0 }, uSpin: { value: 0 }, uBlur: { value: 0 }, uNeon: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: RING_FRAG }));
      m.renderOrder = 4; m.userData.dir = s.dir; this.rings.push(m); this.ringGroup.add(m);
    });
    this.scene.add(this.ringGroup);
    // lettering (same mint glow as the rest of Component 4)
    this.why = makeLockup((g) => {
      g.textAlign = 'left'; g.font = `400 250px ${SERIF}`; g.fillText("and that's", 90, 330);
      g.font = '400 700px "Pinyon Script", cursive'; g.fillText('W', 60, 800); const ww = g.measureText('W').width;
      g.font = `400 400px ${SERIF}`; g.fillText('hy', 60 + ww * 0.78, 790);
    });
    this.exist = makeLockup((g) => {
      g.textAlign = 'left'; g.font = `400 270px ${SERIF}`; g.fillText('we had', 520, 380);
      g.font = `italic 400 260px ${SERIF}`; g.fillText('to', 440, 620);
      g.font = '400 720px "Pinyon Script", cursive'; g.fillText('E', 720, 860); const we = g.measureText('E').width;
      g.font = `400 400px ${SERIF}`; g.fillText('xist', 720 + we * 0.72, 850);
    });
    for (const L of [this.why, this.exist]) {
      const u = L.mat.uniforms;
      u.uDeep.value.set(.78, .93, .84); u.uLight.value.set(.95, 1, .97); u.uForm.value.set(.55, .95, .8);
      u.uShadowCol.value.set(.02, .08, .05); u.uEmboss.value = .06; u.uGlow.value = .5; u.uGlowCol.value.set(.45, .85, .65);
      u.uOutSweep.value = 0;
      this.ui.add(L.mesh);
    }
    this.hold = new HoldGate(this.ctx, 'hold2', () => this.complete());
    this.hold.duration = 2.0;
  }
  protected layoutText() {
    const a = this.aspect, p = this.portrait;
    const put = (L: Lockup, w: number, x: number, y: number) => { L.mesh.scale.set(w / 2, w / 2, 1); L.mesh.position.set(x, y, 0); this.base.set(L, new THREE.Vector2(x, y)); };
    const w1 = Math.min(a * 2 * (p ? 0.85 : 0.4), 1.7); put(this.why, w1, -a + w1 / 2 + (p ? 0.07 : 0.02), p ? 0.6 : 0.42);
    const w2 = Math.min(a * 2 * (p ? 0.85 : 0.42), 1.8); put(this.exist, w2, a - w2 / 2 - 0.02, p ? -0.6 : -0.32);
  }
  enter() { this.ctx.hud.setTheme('dark'); }
  exit() { this.ctx.hud.ring(false); }   // never leave the TAP / HOLD prompt on screen after this part
  // hold complete (reference 9.20.15 at 23–25 s): the rings flash neon green and keep pulling in, big green rims rush in
  // around them, the room turns green, a white bloom swells out of the centre and whites the screen → next component
  private complete() {
    const ctx = this.ctx;
    ctx.hud.ring(false);
    ctx.scroll.locked = true;   // stay put while the finish plays (solving the gate moves the scroll floor past this scene)
    gsap.to(this.done, { v: 1, duration: 1.7, ease: 'power1.in', onComplete: () => { ctx.flash(1.6); ctx.scroll.locked = false; ctx.scroll.advance(P(0.935), 2.4); } });
  }
  update(l: number, dt: number, t: number) {
    const ctx = this.ctx, pg = ctx.scroll.progress;
    this.bg.uniforms.uTime.value = t; this.bg.uniforms.uRes.value.set(ctx.size.w, ctx.size.h);
    this.starMat.uniforms.uTime.value = t;
    const parked = ctx.gates.activeAt(pg, 'hold2', 0.012) && !this.hold.done;
    this.hold.enabled = parked; this.hold.update(dt);
    const hp = this.hold.p, sc = this.portrait ? 0.62 : 1, dv = this.done.v;
    const ax = ctx.input.sx || 0, ay = ctx.input.sy || 0;
    // cursor: the view drifts with the pointer and the rings tilt toward it, like the other components
    this.camera.position.set(ax * 0.5, ay * 0.3, 9); this.camera.lookAt(ax * 0.1, ay * 0.05, 0);
    // (the Disconnect paper is still fading underneath until l≈0.27, so the lettering starts once it's mostly gone)
    // 1) bright dot → 2) grows into the orb (with its inner rings) → 3) the big outer rim comes in from outside, out of
    //    focus, and settles → 4) lettering goes, parked. HOLD: everything zooms in toward the centre.
    const sq = hp * hp * (3 - 2 * hp);                                     // hold squeeze
    const neon = smoothstep(0, 0.15, dv), pull = dv;                       // completion
    // finish (reference 9.39.53 at 7–9.5 s): the rings turn a muted green and open back OUT a little (no neon glow)
    const squeeze = lerp(1, 0.32, sq) * lerp(1, 1.5, easeOutCubic(pull));
    const grow = easeOutCubic(smoothstep(0.22, 0.3, l));
    const bloom = smoothstep(0.45, 1, dv);
    this.dotMat.uniforms.uA.value = Math.max(smoothstep(0.08, 0.16, l) * (1 - grow), bloom * 1.2);
    this.dot.scale.setScalar(sc * (1 + grow * 2) * (1 + Math.pow(bloom, 2) * 60));
    this.dotMat.uniforms.uSoft.value = smoothstep(0, 0.15, bloom);
    this.orb.scale.setScalar(sc * Math.max(0.001, grow) * (1 + Math.sin(t * 2.4) * 0.015) * lerp(1, 0.3, sq) * (1 - pull * 0.6));
    this.orbMat.uniforms.uTime.value = t; this.orbMat.uniforms.uP.value = hp;
    this.orbMat.uniforms.uOn.value = smoothstep(0.22, 0.26, l) * (1 - sq * 0.55) * (1 - neon);
    this.ringGroup.scale.setScalar(sc * squeeze * (1 + 0.012 * Math.sin(t * 2)));
    this.ringGroup.rotation.set(-ay * 0.35, ax * 0.45, 0);
    this.rings.forEach((r, i) => {
      const u = (r.material as THREE.ShaderMaterial).uniforms;
      let sc0 = 1, on = 1, blur = 0;
      if (i === 0) {   // outer rim forms in place with the orb (it never flies in on scroll)
        sc0 = lerp(0.6, 1, easeOutCubic(smoothstep(0.25, 0.32, l))); on = smoothstep(0.25, 0.29, l);
      } else {         // inner rings come with the orb
        sc0 = lerp(0.4, 1, grow); on = smoothstep(0.23 + i * 0.01, 0.28 + i * 0.01, l);
      }
      r.scale.setScalar(Math.max(0.001, sc0));
      u.uTime.value = t; u.uOn.value = on * (1 - sq * 0.35 * (1 - neon)) * (1 - bloom);
      u.uBlur.value = blur + pull * 0.3; u.uNeon.value = neon * 0.3;   // green tint, only a hint of glow
      u.uSpin.value = t * 0.03 * r.userData.dir + t * hp * 0.25 * r.userData.dir;
      u.uProg.value = 0;
      r.position.z = -i * 0.05;
      // the dashed inner ring orbits at a tilt, like the green loops inside the reference's orb
      if (i === 2) r.rotation.set(1.05 + Math.sin(t * 0.4) * 0.1, t * 0.35, 0.3);
    });
    // reference 9.39.53 at 2.5–4 s: as you scroll on, a big soft copy of the rim sweeps OUTWARD past the lens and is gone by
    // the time you park. It follows the scroll (scrolling back rewinds it in); it never comes back in on its own.
    const outSweep = smoothstep(0.31, 0.365, l);
    // tunnel rings: rims only come INWARD while you tap & hold (and through the finish)
    const tun = Math.min(1, hp * 3) * (hp > 0.001 || dv > 0 ? 1 : 0);
    this.ghostGroup.rotation.copy(this.ringGroup.rotation);
    this.ghosts.forEach((g, j) => {
      const u = (g.material as THREE.ShaderMaterial).uniforms;
      const ph = (t * (0.35 + dv * 0.8) + j / 3) % 1;
      const s0 = lerp(3.6, 0.35, Math.pow(ph, 0.8));
      g.scale.setScalar(sc * s0);
      u.uTime.value = t; u.uSpin.value = t * 0.05 * g.userData.dir + j * 0.3;
      u.uBlur.value = 0.35 + smoothstep(1.1, 3.2, s0) * 0.65; u.uNeon.value = neon;
      u.uOn.value = tun * Math.pow(Math.sin(Math.PI * ph), 2) * (0.28 + neon * 0.1) * (1 - bloom);   // faint, like the reference
      if (dv > 0) {   // finish: big soft green rims spread OUTWARD from the centre and off the screen, one after another
        const k = Math.min(1, Math.max(0, dv * 1.5 - j * 0.25)), sb = lerp(0.6, 5, easeOutCubic(k));
        g.scale.setScalar(sc * sb); u.uSpin.value = t * 0.03 * g.userData.dir + j * 0.3;
        u.uBlur.value = 0.4 + smoothstep(1.0, 4.0, sb) * 0.6; u.uNeon.value = neon * 0.25;
        u.uOn.value = 0.5 * smoothstep(0, 0.1, k) * (1 - k) * (1 - bloom * 0.5);
      } else if (j === 0 && tun < 0.01 && outSweep > 0 && outSweep < 1) {   // the scroll-driven outward sweep
        const b = outSweep, sb = lerp(1, 4.2, easeOutCubic(b));
        g.scale.setScalar(sc * sb); u.uSpin.value = t * 0.03;
        u.uBlur.value = smoothstep(1.0, 3.0, sb); u.uOn.value = 0.6 * smoothstep(0, 0.08, b) * (1 - b);
      }
      g.visible = u.uOn.value > 0.002;
    });
    this.bg.uniforms.uShapes.value = smoothstep(0.32, 0.4, l);
    this.bg.uniforms.uGlow.value = hp * 0.25 + neon * 0.7;
    this.fx.bloom = 0.4 + hp * 0.3 + neon * 0.15; this.fx.ca = 0.08 + hp * 0.25;
    // lettering: "and that's Why" first, "we had to Exist" as the orb grows; both clear once the rings arrive
    const step = (L: Lockup, i0: number, i1: number, o0: number, o1: number) => {
      const out = Math.max(smoothstep(o0, o1, l), dv);
      L.mat.uniforms.uIn.value = easeOutCubic(smoothstep(i0, i1, l)) * (1 - out);   // drains fully, no blurred ghost left
      L.mat.uniforms.uOut.value = out;
      L.mesh.visible = l > i0 - 0.01 && l < o1 + 0.01;
      const b = this.base.get(L); if (b) L.mesh.position.set(b.x + ax * 0.03, b.y + ay * 0.015, 0);
    };
    step(this.why, 0.19, 0.25, 0.33, 0.362);
    step(this.exist, 0.24, 0.3, 0.33, 0.362);
    // TAP / HOLD: the same prompt as Component 2, centred on the orb
    const show = parked && dv < 0.01;
    this.tmp.set(0, 0, 0).project(this.camera);
    ctx.hud.ring(show, (this.tmp.x * 0.5 + 0.5) * ctx.size.w, (-this.tmp.y * 0.5 + 0.5) * ctx.size.h, hp, 'TAP\nHOLD', !this.hold.isDown, 'tap');
  }
  dispose() { this.ctx.hud.ring(false); this.hold?.dispose(); super.dispose(); }
}
