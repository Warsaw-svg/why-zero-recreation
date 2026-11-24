import * as THREE from 'three';
import gsap from 'gsap';
import { Scene, type Ctx } from '../core/Scene';
import { HoldGate } from '../core/HoldGate';
import { ScrollEngine } from '../core/ScrollEngine';
import { Hand, POSES, type HandPose } from '../utils/Hand';

/** human hand in the reference: palm up, index reaching up-left, the other fingers softly curled up */
const HUMAN_POSE: HandPose = { index: 0.03, middle: 0.08, ring: 0.2, pinky: 0.3, thumb: 0.08, spread: 0.65, thumbIn: 0.15 };   // relaxed open reach: index + middle long, ring/pinky gently curled
const HUMAN_Q = (() => {
  // a real RIGHT hand (showBack(true) = unmirrored rig, whose palm is local -Z): open palm toward the viewer, thumb up,
  // fingers stretched up-left toward the green hand (the look you picked)
  const y = new THREE.Vector3(-0.86, 0.42, 0.28).normalize();
  const z = new THREE.Vector3(-0.1, -0.6, -0.8); z.addScaledVector(y, -z.dot(y)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z).normalize(), y, z));
})();
/** finale: the human hand offers a handshake (right hand, fingers toward the green hand, thumb up, palm to the viewer) */
const basisQ = (fingers: THREE.Vector3, z: THREE.Vector3) => {
  const y = fingers.clone().normalize(); const zz = z.clone(); zz.addScaledVector(y, -zz.dot(y)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, zz).normalize(), y, zz));
};
const HANDSHAKE_Q = basisQ(new THREE.Vector3(-1, 0.08, 0.12), new THREE.Vector3(0, 0, -1));
/** finale: the clay hand turns upright, back of the hand to the human hand, and flips it the middle finger */
const FLIP_Q = basisQ(new THREE.Vector3(0.12, 1, 0.05), new THREE.Vector3(-0.35, 0, -1));
const FLIP_POSE: HandPose = { index: 0.95, middle: 0.0, ring: 0.95, pinky: 1.0, thumb: 0.75, spread: 0.15, thumbIn: 0.7 };
/** fingers wrapped round the other hand (handshake grip) */
const GRIP: HandPose = { index: 0.5, middle: 0.55, ring: 0.58, pinky: 0.6, thumb: 0.3, spread: 0.1, thumbIn: 0.6 };
/** the College scene's pose = OPEN_REACH in StoryScenes (keep in sync) */
const COLLEGE_END: HandPose = { ...POSES.open, thumb: 0.06, spread: 0.6, thumbIn: 0.5 };
import { makeLockup, SERIF, type Lockup } from '../utils/lockup';
import { setHandOnPath, ADAM_GREEN } from '../utils/handPath';
import { NOISE } from '../shaders/common';
import { lerp, easeOutCubic, easeInOutCubic, smoothstep, clamp, mulberry32 } from '../utils/math';
import { P } from '../core/progressMap';
import { playShatter } from '../ui/shatter';

const FOG = 'vec3(.84,.92,.90)';   // pale mint haze (the reference meadow is soft, blue-green and bright)

const PETAL_VERT = /* glsl */ `
attribute vec4 aSeed; uniform float uTime; uniform float uFocus; varying vec2 vUv; varying float vBlur; varying float vTone;
void main(){
  vUv = uv;
  vec3 base = vec3((aSeed.x-.5)*22., (aSeed.y-.5)*9., -7. + aSeed.z*13.);
  float spd = .3 + aSeed.w*.5;
  float t = uTime*spd + aSeed.x*40.;
  vec3 p = base;
  p.x = mod(base.x + t*1.1 + 11., 22.) - 11.;
  p.y = mod(base.y - t*.55 + 4.5, 9.) - 4.5 + sin(t*2.+aSeed.z*6.)*.25;
  p.z += sin(t*.9 + aSeed.y*9.)*.6;
  vec3 v = position * (0.7 + aSeed.w*.9);
  float a = t*3. + aSeed.x*6.;
  float c = cos(a), s = sin(a);
  v.xy = mat2(c,-s,s,c) * v.xy;
  v.z += sin(v.x*8. + t*4.)*.04;
  float a2 = t*1.7 + aSeed.y*6.; float c2=cos(a2), s2=sin(a2);
  v.yz = mat2(c2,-s2,s2,c2)*v.yz;
  vec4 mv = modelViewMatrix * vec4(p + v, 1.);
  vBlur = clamp(abs(-mv.z - uFocus)/9., 0., 1.);
  vTone = aSeed.w;
  gl_Position = projectionMatrix * mv;
}`;
const PETAL_FRAG = /* glsl */ `
varying vec2 vUv; varying float vBlur; varying float vTone;
void main(){
  vec2 q = (vUv-.5)*2.; q.y *= 1.15;
  float d = length(q*vec2(.85,1.));
  float soft = .08 + vBlur*.9;
  float a = smoothstep(1., 1.-soft, d) * (1. - vBlur*.55);
  vec3 col = mix(vec3(1.,.62,.78), vec3(.95,.36,.62), vTone);
  col = mix(col, vec3(1.,.9,.92), smoothstep(.2,.9,length(q)) * .5);
  col *= .9 + .1*(1.-vUv.y);
  gl_FragColor = vec4(col, a * .85);
}`;

export class AdamScene extends Scene {
  private bg!: THREE.ShaderMaterial;
  private green!: Hand; private human!: Hand;
  private petals!: THREE.InstancedMesh; private petalMat!: THREE.ShaderMaterial;
  private job!: Lockup; private haze!: THREE.Mesh;
  private hold!: HoldGate;
  private touch = { v: 0 };   // 0 apart → 1 clasped (driven by the GSAP timeline in complete())
  private pump = { v: 0 };    // handshake pumps
  private liveB = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), s: 1.5 };
  /** finale after the hold: freeze (time stop), hs (human offers a handshake), flip (clay hand's middle finger) */
  private fin = { hs: 0, flip: 0, recoil: 0 };
  private shade: HTMLElement | null = null;
  /** after the shatter (or when resuming past the hold) the red/black shade is gone for good */
  private shadeGone = false;
  private ft = 0;   // scene time that stops while frozen
  private entered = false;
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3();
  private shake = 0;
  constructor(ctx: Ctx) {
    super(ctx, 'adam', [0.255, 0.395]);
    this.theme = 'light';
    this.fx = { bloom: 0.1, grain: 0.04, vignette: 0.22, ca: 0.0 };
    this.camera.fov = 45;   // same lens as the College scene, so the green hand carries straight on
  }
  init() {
    super.init();
    this.camera.position.set(0, 0.15, 7.5);
    // blue sky, big soft cumulus, light shafts from the top right
    this.bg = this.makeBackdrop(/* glsl */ `
      void main(){
        vec2 p = vUv; float asp = uRes.x / uRes.y;
        vec3 zen = vec3(.42, .66, .88), hor = vec3(.86, .93, .95);
        vec3 col = mix(hor, zen, smoothstep(.42, 1., p.y));
        vec2 cq = vec2(p.x * asp * 1.4 + uTime * .006, p.y * 2.6);
        float cl = fbm(cq * 1.3) * .65 + fbm(cq * 3.1 + 7.) * .35;
        float cm = smoothstep(.42, .72, cl) * smoothstep(.4, .62, p.y);
        vec3 cloud = mix(vec3(.80, .86, .90), vec3(1.), smoothstep(.45, .85, cl + (p.y - .6) * .4));
        col = mix(col, cloud, cm * .92);
        vec2 o = vec2(.92, 1.12); vec2 d = (p - o) * vec2(asp, 1.);
        float ang = atan(d.y, d.x);
        float rays = pow(.5 + .5 * sin(ang * 26. + fbm(vec2(ang * 4., uTime * .08)) * 4.), 5.) + pow(.5 + .5 * sin(ang * 11. + 1.7), 9.) * .8;
        col += vec3(1., .99, .95) * rays * exp(-length(d) * .9) * .55 * smoothstep(.15, .9, p.x + p.y * .6);
        col += vec3(1.) * exp(-length(d) * 3.5) * .5;
        gl_FragColor = vec4(min(col, vec3(1.)), 1.);
      }`, {});
    // meadow
    const mead = new THREE.Mesh(new THREE.PlaneGeometry(60, 40, 1, 1), new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }',
      fragmentShader: `uniform float uTime; varying vec3 vW; varying float vD; ${NOISE}
        void main(){ vec2 q = vW.xz; float n = fbm(q*.6); float g = vnoise(q*14. + vec2(sin(uTime+q.y)*.2,0.));
          vec3 col = mix(vec3(.30,.58,.30), vec3(.62,.82,.45), n); col *= .85 + .3*g;
          float fl2 = step(.45, hash21(floor(q*9.)+3.)) * (1.-smoothstep(.1,.3,length(fract(q*9.)-.5))) * smoothstep(.35,.6,fbm(q*.35+2.)); col = mix(col, mix(vec3(.62,.52,.86), vec3(.95,.62,.82), hash21(floor(q*9.))), fl2*.85);
          vec2 fc = fract(q*5.)-.5; float fl = step(.9, hash21(floor(q*5.))) * (1.-smoothstep(.08,.14,length(fc))); col = mix(col, vec3(1.,.8,.88), fl*.9);
          col = mix(col, ${FOG}, smoothstep(6., 32., vD)); gl_FragColor = vec4(col,1.); }`,
    }));
    mead.rotation.x = -Math.PI / 2; mead.position.set(0, -2.6, -12);
    this.scene.add(mead);
    // pond
    const pond = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.ShaderMaterial({
      transparent: true, uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying float vD; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vD=-mv.z; gl_Position=projectionMatrix*mv; }',
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vD; ${NOISE}
        void main(){ vec2 q=(vUv-.5)*2.; float m = 1.-smoothstep(.6,1.,length(q*vec2(1.,1.35)));
          float rip = fbm(vUv*vec2(20.,50.)+vec2(uTime*.1, uTime*.2)); vec3 sky = mix(vec3(.55,.74,.88), vec3(.92,.96,.97), vUv.y*.9+rip*.12);
          sky += pow(rip,3.)*.4; sky = mix(sky, ${FOG}, smoothstep(10.,30.,vD)*.6); gl_FragColor=vec4(sky, m*.9); }`,
    }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(0.5, -2.58, -10);
    this.scene.add(pond);
    // pillars
    const stoneMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vN; varying vec3 vP; varying float vD; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vP=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }',
      fragmentShader: `varying vec3 vN; varying vec3 vP; varying float vD; ${NOISE}
        void main(){ float n = fbm(vP.xy*3.+vP.z); float fl = abs(sin(atan(vP.z+6., vP.x*sign(vP.x)-3.2)*24.)); 
          vec3 col = mix(vec3(.78,.74,.7), vec3(.94,.9,.86), n); col *= .88 + .12*fl; col *= .6 + .5*max(dot(normalize(vN), normalize(vec3(.3,.7,.6))),0.);
          col = mix(col, ${FOG}, smoothstep(6.,26.,vD)*.85); gl_FragColor=vec4(col,1.); }`,
    });
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 7.2, 36), stoneMat);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 1.7), stoneMat); base.position.y = -3.7;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 1.7), stoneMat); cap.position.y = 3.8;
      const cap2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.25, 1.3), stoneMat); cap2.position.y = 3.55;
      const vol = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.09, 10, 20), stoneMat); vol.position.set(-0.78, 3.6, 0.0); vol.rotation.y = Math.PI / 2;
      const vol2 = vol.clone(); vol2.position.x = 0.78;
      g.add(shaft, base, cap, cap2, vol, vol2); g.position.set(sx * 5.6, sx < 0 ? -0.3 : 0.3, -14); g.scale.setScalar(0.8);
      this.scene.add(g);
    }
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 2), stoneMat); rock.scale.set(1.3, 0.6, 0.9); rock.position.set(-0.8, -2.4, -10);
    this.scene.add(rock);
    // petals
    const n = Math.floor(260 * this.ctx.quality.particles);
    const geo = new THREE.PlaneGeometry(0.3, 0.26, 4, 4);
    this.petalMat = new THREE.ShaderMaterial({ vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uFocus: { value: 8.5 } } });
    this.petals = new THREE.InstancedMesh(geo, this.petalMat, n);
    const rnd = mulberry32(5), seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.petals.frustumCulled = false; this.petals.renderOrder = 9;
    this.scene.add(this.petals);
    // hands
    this.green = new Hand('clay', 0x35e04a, 1.55);
    this.human = new Hand('real', undefined, 1.55);
    this.green.showBack(false); this.human.showBack(true);
    this.human.mat.uniforms.uRim.value.set(1, 0.85, 0.75); this.human.mat.uniforms.uRimK.value = 0.5;
    this.green.setPose(POSES.adam); this.human.setPose(POSES.adam);
    this.scene.add(this.green.group, this.human.group);
    this.job = makeLockup((g) => { g.font = `italic 400 720px ${SERIF}`; g.textAlign = 'center'; g.fillText('JOB', 1024, 790); });
    this.ui.add(this.job.mesh);
    // soft, out-of-focus frame: mint haze at the edges and bottom (the reference's shallow depth of field)
    this.haze = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, uniforms: { uTime: { value: 0 }, uAsp: { value: 1.6 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `uniform float uTime; uniform float uAsp; varying vec2 vUv; ${NOISE}
        void main(){ vec2 q = (vUv - .5) * 2.; float n = fbm(vUv * 3. + uTime * .02);
          float e = smoothstep(.55, 1.35, length(q * vec2(1., 1.2)) + (n - .5) * .35) + smoothstep(-.45, -1.05, q.y) * .7 + smoothstep(-.35, -.95, q.x) * .35;
          vec3 col = mix(vec3(.62, .84, .70), vec3(.90, .96, .94), smoothstep(-.2, .9, vUv.y + (n - .5) * .3));
          gl_FragColor = vec4(col, clamp(e, 0., 1.) * .78); }`,
    }));
    this.haze.renderOrder = 8;
    this.ui.add(this.haze);
    this.hold = new HoldGate(this.ctx, 'hold1', () => this.complete());
    this.hold.duration = 3.0;   // the reference hold takes about 3 s
    this.shadeGone = this.ctx.gates.isSolved('hold1');   // came back after the hold (resume / scrolling back): no black shade
    this.touch.v = this.ctx.gates.isSolved('hold1') ? 1 : 0;
  }
  protected layoutText() {
    const w = Math.min(this.aspect * 2 * (this.portrait ? 0.8 : 0.34), 1.9);
    this.job.mesh.scale.set(w / 2, w / 2, 1);
    this.job.mesh.position.set(this.portrait ? 0 : 0.12, this.portrait ? 0.35 : 0.05, 0);
    this.haze.scale.set(this.aspect, 1, 1);
    (this.haze.material as THREE.ShaderMaterial).uniforms.uAsp.value = this.aspect;
  }
  enter() { this.entered = true; this.ctx.hud.setTheme('light'); this.ctx.audio.play('rustle', 0.5); }
  /** hold finished (screen is already black): the ring goes, a beat of black, then the screen shatters into Component 3 */
  private complete() {
    const ctx = this.ctx;
    gsap.delayedCall(0.3, () => {
      ctx.audio.play('glassBreak', 1.3);   // the screen breaks like a pane of glass
      ctx.scroll.advance(P(0.37) + 0.04, 0.6);        // land where Component 3's red scene is fully faded in (it renders under the flying shards)
      playShatter(() => { this.shadeGone = true; if (this.shade) this.shade.style.opacity = '0'; });
      gsap.delayedCall(0.05, () => { if (this.shade) { this.shade.style.transition = 'opacity .35s'; this.shade.style.opacity = '0'; } });
    });
  }
  update(l: number, dt: number, t: number) {
    const ctx = this.ctx;
    this.ft += dt;
    this.bg.uniforms.uTime.value = this.ft; this.bg.uniforms.uRes.value.set(ctx.size.w, ctx.size.h);
    this.petalMat.uniforms.uTime.value = this.ft;
    this.scene.traverse((o) => { const m = o as THREE.Mesh; const u = (m.material as THREE.ShaderMaterial | undefined)?.uniforms; if (u?.uTime && m !== this.petals) u.uTime.value = this.ft; });
    const pg = ctx.scroll.progress;
    // once the hold is done and we're past it, the meadow is gone (black base under Component 3, as in the reference);
    // scrolling back up above the hold brings it back
    this.scene.visible = !(this.shadeGone && pg > ctx.gates.get('hold1').at + 0.002);
    const parked = ctx.gates.activeAt(pg, 'hold1', 0.012) && !this.hold.done;
    this.hold.enabled = parked;
    this.hold.update(dt);
    const hp = this.hold.p;
    this.shake = Math.max(0, this.shake - dt * 1.2);
    const reach = this.portrait ? 0.62 : 1;
    const wob = Math.sin(t * 0.8) * 0.03;
    // GREEN: the same scroll-keyed path as the College scene; ends in the "Creation of Adam" pose (upper left, palm down,
    // fingers drooping toward the centre). Holding draws it toward the human fingertip; on completion the tips touch.
    const g = this.green.group;
    const gPose = setHandOnPath(g, ctx.scroll.progress, ctx.input.sx || 0, ctx.input.sy || 0, t);
    // holding draws the fingertips toward each other, but they never touch: at full they stop ~0.3 apart (rest gap ≈ 1.3)
    const close = hp * 0.35 + this.touch.v * 0.65;
    const reachIn = close * 0.78;
    this.tmpB.set(0, 1, 0).applyQuaternion(g.quaternion);
    g.position.addScaledVector(this.tmpB, reachIn + wob * 0.5);
    if (reach < 1) g.scale.multiplyScalar(reach);
    this.setFade(this.green, -0.75 * g.scale.x, 1.0 * g.scale.x);
    this.green.setPose(gPose);
    // HUMAN: rises in from the lower right as the meadow fades in, palm up, index reaching up-left toward the green tip
    const e2 = smoothstep(0.0, 0.5, l);
    const arrive = 1 - Math.pow(1 - e2, 3);
    const hs = 1.6 * reach;
    this.human.group.scale.setScalar(hs);
    this.human.group.quaternion.copy(HUMAN_Q);
    this.human.setPose(HUMAN_POSE);
    this.human.tipWorld(this.tmpA);
    this.tmpA.sub(this.human.group.position);   // tip offset from the group origin
    const tx = (this.portrait ? 0.35 : 0.45) + (1 - arrive) * 3.2 - close * 0.78 * 0.76;
    const ty = -0.62 - (1 - arrive) * 3.0 + close * 0.78 * 0.65 - wob;
    this.human.group.position.set(tx - this.tmpA.x, ty - this.tmpA.y, 0.1 - this.tmpA.z);
    this.setFade(this.human, -0.75 * hs, 1.0 * hs);
    this.human.group.visible = e2 > 0.001;
    // the hold drives the finale (matched to componet 2to3.mov): both reach in → the clay hand flips the middle finger and
    // the human hand pulls back → the scene goes red, then black (only the ring stays). Letting go plays it backwards.
    const hpk = this.hold.done ? 1 : hp;
    this.fin.hs = smoothstep(0.08, 0.3, hpk) * (1 - smoothstep(0.36, 0.55, hpk));
    this.fin.recoil = smoothstep(0.36, 0.6, hpk);
    this.fin.flip = smoothstep(0.24, 0.42, hpk);
    if (this.fin.hs > 0.001 || this.fin.flip > 0.001 || this.fin.recoil > 0.001) this.finale();
    this.setShade(smoothstep(0.28, 0.6, hpk), smoothstep(0.52, 0.8, hpk));
    this.green.update(t); this.human.update(t);
    this.green.mat.uniforms.uGlow.value = hp * 0.35 + this.touch.v * 0.4;
    this.human.mat.uniforms.uGlow.value = hp * 0.25;
    // camera
    const k = this.shake * (ctx.quality.reducedMotion ? 0.2 : 1);
    const settle = smoothstep(0, 0.4, l);
    this.camera.position.set((Math.sin(t * 0.15) * 0.25 + ctx.input.sx * 0.2) * settle + (Math.random() - 0.5) * k * 0.3, 0.15 + ctx.input.sy * 0.1 * settle + (Math.random() - 0.5) * k * 0.3, (7.5 - hp * 0.5) * (this.portrait ? 1.65 : 1));   // portrait: step back so both hands fit
    this.camera.lookAt(0, 0, 0);
    this.fx.ca = this.shake * 1.2; this.fx.bloom = 0.1 + hp * 0.22 + this.shake * 0.6;
    // "JOB" sweeps in between the hands, then dissolves before the hold prompt
    this.job.mat.uniforms.uIn.value = easeOutCubic(smoothstep(0.02, 0.3, l));
    this.job.mat.uniforms.uOut.value = easeOutCubic(smoothstep(0.36, 0.5, l));
    (this.haze.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    // ring at fingertip midpoint
    this.green.tipWorld(this.tmpA); this.human.tipWorld(this.tmpB);
    this.tmpA.add(this.tmpB).multiplyScalar(0.5).project(this.camera);
    const show = parked && l > 0.35 && !this.hold.done;
    ctx.hud.ring(show, (this.tmpA.x * 0.5 + 0.5) * ctx.size.w, (-this.tmpA.y * 0.5 + 0.5) * ctx.size.h, hp, 'TAP\nHOLD', !this.hold.isDown, 'tap');
    if (this.hold.done && !this.entered) ctx.hud.ring(false);
    void clamp; void ScrollEngine;
  }
  /** red tint, then black, over the meadow (DOM layer under the HUD, so the TAP / HOLD ring stays visible on black) */
  private setShade(red: number, black: number) {
    if (!this.shade) {
      const d = document.createElement('div'); d.id = 'holdShade';
      d.innerHTML = '<div class="red"></div><div class="black"></div>';
      document.body.appendChild(d); this.shade = d;
    }
    const s = this.shade;
    if (this.shadeGone || (red + black < 0.001 && !this.hold.done)) { s.style.display = 'none'; return; }
    s.style.display = 'block';
    (s.firstElementChild as HTMLElement).style.opacity = String(red);
    (s.lastElementChild as HTMLElement).style.opacity = String(black);
  }
  /** finale blend on top of the resting pose: human → handshake offer, clay → middle finger */
  private finale() {
    const { hs, flip, recoil } = this.fin;
    const hg = this.human.group, gg = this.green.group;
    if (hs > 0.001) {
      hg.quaternion.slerp(HANDSHAKE_Q, hs);
      hg.position.x -= hs * 0.15; hg.position.y += hs * 0.3;   // reaches in, but stops short of the clay hand
      this.human.lerpPose(HUMAN_POSE, POSES.shake, hs);
      this.setFade(this.human, -0.75 * hg.scale.x, 1.0 * hg.scale.x);
    }
    if (recoil > 0.001) { hg.position.x += recoil * 0.9; hg.position.y -= recoil * 0.45; hg.rotateZ(-recoil * 0.25); }   // pulls back
    if (flip > 0.001) {
      gg.quaternion.slerp(FLIP_Q, Math.min(1, flip));
      gg.position.x -= flip * 0.15; gg.position.y += flip * 0.35;   // rises a little so the gesture reads clearly
      this.green.lerpPose(ADAM_GREEN, FLIP_POSE, Math.min(1, flip));
      this.setFade(this.green, -0.75 * gg.scale.x, 1.0 * gg.scale.x);
    }
  }
  /** orient a hand (z = direction the fingers point, roll = turn about the finger axis) and put its index fingertip at (tx, ty) */
  private placeHand(hand: Hand, s: number, rz: number, rx: number, roll: number, tx: number, ty: number, tz = 0) {
    const g = hand.group;
    g.scale.setScalar(s);
    g.position.set(0, 0, 0);
    g.rotation.set(rx, 0, rz);
    g.rotateY(roll);
    hand.tipWorld(this.tmpA);
    g.position.set(tx - this.tmpA.x, ty - this.tmpA.y, tz - this.tmpA.z);
  }
  /** forearm melts into the haze along the arm's own axis (offset/width in world units from the wrist) */
  private setFade(hand: Hand, off: number, w: number) {
    const g = hand.group, u = hand.mat.uniforms;
    const dir = this.tmpB.set(0, 1, 0).applyQuaternion(g.quaternion).normalize();
    u.uFadeDir.value.copy(dir);
    u.uFadeY.value = g.position.dot(dir) + off; u.uFadeW.value = w;
    u.uFadeCol.value.setRGB(0.84, 0.92, 0.9);
  }
  exit() { this.ctx.hud.ring(false); if (this.shade) { this.shade.remove(); this.shade = null; } }
  dispose() { this.hold?.dispose(); this.green?.dispose(); this.human?.dispose(); super.dispose(); }
}
