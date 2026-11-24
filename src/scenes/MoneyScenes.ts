import * as THREE from 'three';
import { Scene, type Ctx } from '../core/Scene';
import { Hand, POSES } from '../utils/Hand';
import { wrapText } from '../utils/text';
import { makeLockup, SERIF, type Lockup } from '../utils/lockup';
import { NOISE } from '../shaders/common';
import { win, lerp, easeOutCubic, smoothstep, clamp, mulberry32 } from '../utils/math';

export function billTexture() {
  const W = 1280, H = 560, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#cfe3c2'); gr.addColorStop(0.5, '#e6efd2'); gr.addColorStop(1, '#bcd6b0');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // guilloche rosettes
  g.strokeStyle = 'rgba(40,100,70,.35)'; g.lineWidth = 1.2;
  for (const cx of [150, W - 150]) for (let k = 0; k < 40; k++) { g.beginPath(); for (let a = 0; a < Math.PI * 2; a += 0.05) { const r = 80 + 30 * Math.sin(a * 7 + k * 0.4); g.lineTo(cx + Math.cos(a + k * 0.08) * r, H / 2 + Math.sin(a + k * 0.08) * r); } g.stroke(); }
  g.strokeStyle = '#2d6a4f'; g.lineWidth = 10; g.strokeRect(24, 24, W - 48, H - 48); g.lineWidth = 3; g.strokeRect(46, 46, W - 92, H - 92);
  for (let i = 0; i < 24; i++) { g.strokeStyle = `rgba(45,106,79,${0.25})`; g.beginPath(); g.ellipse(W / 2, H / 2, 210 + i * 3, 220 + i * 3, 0, 0, 7); g.stroke(); }
  // portrait oval
  g.fillStyle = '#dbe8cf'; g.beginPath(); g.ellipse(W / 2, H / 2 + 6, 190, 215, 0, 0, 7); g.fill(); g.strokeStyle = '#2d6a4f'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#2d6a4f';
  g.beginPath(); g.ellipse(W / 2, H / 2 + 10, 62, 76, 0, 0, 7); g.fill(); // head
  g.beginPath(); g.moveTo(W / 2 - 150, H / 2 + 200); g.quadraticCurveTo(W / 2 - 120, H / 2 + 100, W / 2, H / 2 + 92); g.quadraticCurveTo(W / 2 + 120, H / 2 + 100, W / 2 + 150, H / 2 + 200); g.fill(); // shoulders
  g.fillStyle = '#17382b'; g.beginPath(); g.moveTo(W / 2, H / 2 - 120); g.lineTo(W / 2 + 120, H / 2 - 82); g.lineTo(W / 2, H / 2 - 44); g.lineTo(W / 2 - 120, H / 2 - 82); g.closePath(); g.fill(); // mortarboard
  g.fillRect(W / 2 - 54, H / 2 - 70, 108, 28);
  g.strokeStyle = '#17382b'; g.lineWidth = 5; g.beginPath(); g.moveTo(W / 2 + 108, H / 2 - 80); g.lineTo(W / 2 + 108, H / 2 - 10); g.stroke(); g.fillStyle = '#c9a227'; g.beginPath(); g.arc(W / 2 + 108, H / 2 - 4, 9, 0, 7); g.fill();
  g.fillStyle = '#1d4a38'; g.textAlign = 'center'; g.font = '700 38px "Playfair Display", serif';
  g.fillText('THE UNITED STATES OF NOTHING', W / 2, 108);
  g.font = '500 26px "JetBrains Mono", monospace'; g.fillText('FEDERAL RESERVE OF HOPE', W / 2, H - 70);
  g.font = '700 96px "Playfair Display", serif'; g.textAlign = 'left'; g.fillText('100', 78, 170); g.textAlign = 'right'; g.fillText('100', W - 78, H - 100);
  g.font = '500 26px "JetBrains Mono", monospace'; g.textAlign = 'left'; g.fillStyle = '#8a1c1c'; g.fillText('00000000', 80, H - 60); g.textAlign = 'right'; g.fillText('00000000', W - 80, 110);
  g.fillStyle = 'rgba(40,100,70,.5)'; g.textAlign = 'center'; g.font = '400 22px "Playfair Display", serif'; wrapText(g, 'IN DEBT WE TRUST', W / 2, H / 2 + 250, 400, 30, 'center');
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
}

const BILL_VERT = /* glsl */ `
uniform float uTime; uniform float uAmp; uniform float uCurl; uniform float uSeed; varying vec2 vUv; varying vec3 vN;
void main(){
  vUv = uv; vec3 p = position; float x = uv.x;
  p.z += uCurl * (p.x * p.x * .22 - .3) + uCurl * .35 * p.y * p.x * .25;   // paper is curved, not flat
  float w = sin(p.x*2.2 - uTime*1.3 + p.y*.8 + uSeed*6.) * .1 + sin(p.x*4.1 - uTime*1.9 + p.y*1.7 + uSeed*3.) * .035;
  p.z += w * uAmp;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.);
}`;
const BILL_FRAG = /* glsl */ `
uniform sampler2D tMap; uniform float uBurn; uniform float uTime; uniform float uBlur; uniform float uSeed; uniform vec2 uIgn; varying vec2 vUv; varying vec3 vN; ${NOISE}
void main(){
  vec4 c = texture2D(tMap, vUv, uBlur);   // depth of field: notes away from the focus plane are soft
  // fire eats in from an ignition point with ragged, noisy holes (reference: several burning islands, not a straight sweep)
  vec2 a = (vUv - uIgn) * vec2(2.27, 1.);
  float n = fbm(vUv*vec2(7.,3.2) + uSeed*13.) * .7 + vnoise(vUv*vec2(30.,14.) + uSeed*5.)*.3;
  float edge = length(a) * .45 + n * .8;
  float thr = uBurn * 1.55 - .2;
  if(edge < thr) discard;
  float d = edge - thr;
  vec3 col = c.rgb * (.72 + .28*abs(dot(normalize(vN), vec3(0.,0.,1.))));
  col = mix(vec3(dot(col, vec3(.3,.59,.11))), col, .5) * vec3(.74, .8, .66);
  col *= 1. - min(uBlur, 4.) * .06;
  float on = step(.001, uBurn);
  float char = 1. - smoothstep(.0, .07, d);
  col = mix(col, vec3(.04,.025,.015), char*.92*on);
  float glow = 1. - smoothstep(.0, .022, d);
  col += vec3(1.,.62,.14) * glow * 2.4 * on;          // bright yellow-orange outline around every burning edge
  col += vec3(1.,.9,.45) * pow(glow, 4.) * 1.2 * on;
  gl_FragColor = vec4(col, 1.);
}`;
const EMBER_VERT = /* glsl */ `
attribute vec4 aSeed; uniform float uTime; uniform float uBurn; uniform float uSize; uniform vec3 uOrigin; varying float vA;
void main(){
  float life = fract(uTime*.22*(.5+aSeed.w) + aSeed.x*7.);
  vec3 p = uOrigin + vec3((aSeed.x-.5)*9., (aSeed.y-.5)*5., (aSeed.z-.5)*5.);
  p.y += life*3.5; p.x += sin(life*6.+aSeed.x*30.)*.35 + life*.5; p.z += sin(life*4.+aSeed.z*20.)*.3;
  vA = (1.-life) * smoothstep(.0,.1,life) * smoothstep(0., .15, uBurn);
  vec4 mv = modelViewMatrix*vec4(p,1.);
  gl_PointSize = uSize * (.4+aSeed.w) * (1.-life*.7) * (300./-mv.z);
  gl_Position = projectionMatrix*mv;
}`;
const EMBER_FRAG = 'varying float vA; void main(){ vec2 q=gl_PointCoord-.5; float d=length(q); float a=smoothstep(.5,0.,d)*vA; gl_FragColor=vec4(vec3(1.,.5+.4*smoothstep(.3,0.,d),.12)*2.2, a); }';

export class MoneyScene extends Scene {
  private bg!: THREE.ShaderMaterial; private hand!: Hand;
  private bills: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial; start: number; ignited: boolean; pos: THREE.Vector3; rot: THREE.Vector3; sc: number; seed: number; fly: number }> = [];
  private embers!: THREE.Points; private emberMat!: THREE.ShaderMaterial;
  private scraps!: THREE.InstancedMesh; private scrapMat!: THREE.ShaderMaterial;
  private uni!: Lockup; private paper!: Lockup;
  private uniDx = 0; private paperDx = 0;
  private xp = false;
  constructor(ctx: Ctx) { super(ctx, 'money', [0.67, 0.755]); /* starts after 3c (banknote) */ this.theme = 'dark'; this.fx = { bloom: 1.0, grain: 0.12, vignette: 0.6, ca: 0.2 }; }
  init() {
    super.init();
    this.bills = [];   // fresh list on re-entry (the old one was disposed)
    // dark bottle-green room (continues 3c's banknote grade): soft top glow, vignette, a hint of the banknote early on
    this.bg = this.makeBackdrop(/* glsl */ `
      uniform float uPhase; uniform float uBurnGlow; uniform sampler2D tBill;
      void main(){
        vec2 p = vUv; float asp = uRes.x / uRes.y; vec2 q = (p - .5) * vec2(asp, 1.);
        vec3 col = mix(vec3(.02, .05, .035), vec3(.07, .16, .1), smoothstep(-.2, 1.1, p.y + fbm(p * 2. + uTime * .03) * .25));
        col += vec3(.06, .16, .1) * exp(-pow(length(q - vec2(0., .45)), 2.) * 2.5);
        vec2 buv = vec2(q.x / 2.29 / 1.05 + .5, q.y / 1.05 + .5);
        vec3 bill = texture2D(tBill, clamp(buv, 0., 1.), 1.5).rgb;   // the same full note 3c pulled back to
        float l = dot(bill, vec3(.3, .59, .11));
        col = mix(col, vec3(l) * vec3(.62, .72, .58) * .8, mix(.85, .05, uPhase));
        col *= mix(.35, 1., smoothstep(1.25, .3, length(q * vec2(.8, 1.1))));
        col += vec3(.5, .22, .05) * uBurnGlow * .12 * (.6 + .4 * fbm(q * 4. + uTime * .3));
        gl_FragColor = vec4(col, 1.);
      }`, { uPhase: { value: 0 }, uBurnGlow: { value: 0 }, tBill: { value: billTexture() } });
    this.hand = new Hand('skin', undefined, 2.0);
    this.hand.mat.uniforms.uDesat.value = 0.6;
    this.hand.mat.uniforms.uRim.value.set(0.4, 1, 0.6);
    this.hand.setPose(POSES.open);
    this.hand.group.visible = false;   // 3c's hand is the only hand here
    this.scene.add(this.hand.group);
    this.camera.position.set(0, 0, 8); this.camera.fov = 40;
    const tex = billTexture();
    // reference (Screen Recording 8.53.42): a whole cloud of notes in depth around one hero note — some right in front of
    // the lens (big, soft, half off-screen), some far behind — not a tidy row of five
    const br = mulberry32(77);
    const LAYOUT: Array<[number, number, number, number]> = [   // x, y, z, scale  (camera at z 8)
      [0.25, 0.05, 2.2, 1.0],
      [-2.6, 1.3, 3.6, 0.9], [2.9, -0.2, 4.4, 0.95], [-1.6, -1.6, 4.9, 0.8], [1.8, 1.9, 3.0, 0.85],
      [-3.4, -0.6, 0.8, 1.0], [3.6, 1.6, 0.2, 1.0], [-0.8, 2.3, -0.6, 1.0], [1.2, -2.3, 0.5, 1.0],
      [-4.8, 2.6, -2.6, 1.1], [4.9, -2.4, -2.2, 1.1], [0.4, 3.4, -3.6, 1.1], [-2.4, -3.2, -3.0, 1.1], [3.0, 3.6, -4.2, 1.1],
    ];
    LAYOUT.forEach(([x, y, z, k], i) => {
      const seed = br();
      const mat = new THREE.ShaderMaterial({ vertexShader: BILL_VERT, fragmentShader: BILL_FRAG, side: THREE.DoubleSide,
        uniforms: { tMap: { value: tex }, uBurn: { value: 0 }, uTime: { value: 0 }, uAmp: { value: 1 }, uCurl: { value: (br() - 0.5) * 0.9 }, uSeed: { value: seed }, uBlur: { value: 0 }, uIgn: { value: new THREE.Vector2(br(), br()) } } });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.5, 48, 16), mat);
      mesh.visible = false; this.scene.add(mesh);
      this.bills.push({ mesh, mat, start: 0.38 + br() * 0.08 + (i === 0 ? 0.02 : 0), ignited: false, seed,
        pos: new THREE.Vector3(x, y, z), rot: new THREE.Vector3((br() - 0.5) * 1.1, (br() - 0.5) * 1.2, (br() - 0.5) * 1.4), sc: k, fly: i === 0 ? 0 : br() * 0.06 });
    });
    this.bills[0].rot.set(-0.35, -0.45, 0.22);   // hero note tilts back and away, like the reference at 4–5 s
    const n = Math.floor(420 * this.ctx.quality.particles), seeds = new Float32Array(n * 4), rnd = mulberry32(9);
    for (let i = 0; i < n * 4; i++) seeds[i] = rnd();
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); eg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.emberMat = new THREE.ShaderMaterial({ vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uBurn: { value: 0 }, uSize: { value: 0.1 }, uOrigin: { value: new THREE.Vector3(0.6, -0.4, 0.5) } } });
    this.embers = new THREE.Points(eg, this.emberMat); this.embers.frustumCulled = false; this.scene.add(this.embers);
    // paper scraps (burnt fragments)
    const sn = Math.floor(90 * this.ctx.quality.particles) + 20;
    const sg = new THREE.PlaneGeometry(0.34, 0.24, 3, 3);
    const ss = new Float32Array(sn * 4); for (let i = 0; i < ss.length; i++) ss[i] = rnd();
    sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ss, 4));
    this.scrapMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, transparent: true, uniforms: { uTime: { value: 0 }, uShow: { value: 0 } },
      vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform float uShow; varying float vS; varying vec2 vUv;
        void main(){ vUv=uv; vec3 p = vec3((aSeed.x-.5)*11., (aSeed.y-.5)*6., -2.+aSeed.z*5.); float t=uTime*(.3+aSeed.w*.4)+aSeed.x*30.;
          p.y += sin(t)*.5 + mod(t*.3, 3.)-1.5; p.x += cos(t*.7)*.5; vec3 v = position*(.6+aSeed.w*1.4); float a=t*2.; float c=cos(a), s=sin(a); v.xy=mat2(c,-s,s,c)*v.xy; v.z += sin(v.x*10.+t*3.)*.04;
          vec3 q = p+v*uShow; vS = aSeed.w; gl_Position = projectionMatrix*modelViewMatrix*vec4(q,1.); }`,
      fragmentShader: 'uniform float uShow; varying float vS; varying vec2 vUv; void main(){ float e = min(min(vUv.x,1.-vUv.x), min(vUv.y,1.-vUv.y)); vec3 col = mix(vec3(.9,.86,.74), vec3(.12,.1,.08), smoothstep(.3,0.,e)); col += vec3(1.,.4,.05)*smoothstep(.12,.0,e)*1.2*step(.5,vS); gl_FragColor = vec4(col, uShow); }' });
    this.scraps = new THREE.InstancedMesh(sg, this.scrapMat, sn); this.scraps.frustumCulled = false; this.scene.add(this.scraps);
    // mint-white lettering with a soft glow (reference): "University" serif over a big script "sells", bottom left; then "Paper"
    this.uni = makeLockup((g) => {
      g.font = `400 300px ${SERIF}`; g.textAlign = 'left'; g.fillText('University', 120, 430);
      g.font = '400 520px "Pinyon Script", cursive'; g.fillText('sells', 420, 860);
    });
    this.paper = makeLockup((g) => {
      g.font = '400 980px "Pinyon Script", cursive'; g.textAlign = 'center'; g.fillText('P', 600, 830);
      g.font = `400 440px ${SERIF}`; g.textAlign = 'left'; g.fillText('aper', 800, 810);
    });
    for (const m of [this.uni.mat, this.paper.mat]) {
      const u = m.uniforms;
      u.uDeep.value.set(.78, .93, .84); u.uLight.value.set(.95, 1, .97); u.uForm.value.set(.55, .95, .8);
      u.uShadowCol.value.set(.02, .08, .05); u.uEmboss.value = .06; u.uGlow.value = .5; u.uGlowCol.value.set(.45, .85, .65);
    }
    this.paper.mat.uniforms.uOutSweep.value = 0;
    this.ui.add(this.uni.mesh, this.paper.mesh);
  }
  protected layoutText() {
    const a = this.aspect, p = this.portrait;
    const wu = Math.min(a * 2 * (p ? 0.8 : 0.36), 1.7);
    this.uni.mesh.scale.set(wu / 2, wu / 2, 1); this.uni.mesh.position.set(-a + wu * 0.5 + 0.06, p ? -0.45 : -0.38, 0);
    const wp = Math.min(a * 2 * (p ? 0.95 : 0.5), 2.4);
    this.paper.mesh.scale.set(wp / 2, wp / 2, 1); this.paper.mesh.position.set(0, 0, 0);
    this.uniDx = 0; this.paperDx = 0;
  }
  enter() { this.ctx.hud.setTheme('dark'); this.xp = true; }   // the banknote ends Component 3: no XP here
  update(l: number, dt: number, t: number) {
    const ctx = this.ctx;
    this.bg.uniforms.uTime.value = t; this.bg.uniforms.uRes.value.set(ctx.size.w, ctx.size.h);
    const phase = smoothstep(0.2, 0.5, l);   // the big note stays behind while the bills come out of it
    this.bg.uniforms.uPhase.value = phase;
    this.hand.update(t);
    this.hand.group.position.set(-2.2 * (this.portrait ? 0.4 : 1), lerp(-2.2, -9, smoothstep(0.25, 0.5, l)), -1);
    this.hand.group.rotation.set(-0.2, 0.4, 0.2);
    this.hand.mat.uniforms.uMono.value = smoothstep(0.05, 0.3, l);
    this.hand.mat.uniforms.uMonoTint.value.set(0.3, 0.9, 0.55);
    // bills — the whole cloud comes in from in front of the lens and settles back into depth, then everything burns
    const portrait = this.portrait;
    const ax = ctx.input.sx || 0, ay = ctx.input.sy || 0;
    let anyBurn = 0;
    this.bills.forEach((b, i) => {
      const s0 = 0.14 + b.fly;
      const show = l > s0 && l < 0.74;
      b.mesh.visible = show;
      if (!show) return;
      const q = clamp((l - s0) / 0.2), eq = easeOutCubic(q);
      const drift = (l - 0.3) * 1.2;   // slow tumble/drift after they settle
      const xs = portrait ? 0.45 : 1;
      const tx = b.pos.x * xs + Math.sin(t * 0.25 + b.seed * 9) * 0.12, ty = b.pos.y + Math.cos(t * 0.21 + b.seed * 7) * 0.1 + drift * 0.3;
      b.mesh.position.set(tx * (0.3 + 0.7 * eq), ty * (0.3 + 0.7 * eq), lerp(7.3, b.pos.z, eq));
      // cursor: nearer notes swing more (depth parallax) and every note turns a little toward the pointer
      const near = (b.pos.z + 5) / 10;
      b.mesh.position.x += ax * (0.15 + near * 0.6); b.mesh.position.y += ay * (0.08 + near * 0.3);
      const hero = i === 0 ? smoothstep(0.25, 0.45, l) : 1;   // hero note starts face-on, then tilts back
      b.mesh.rotation.set(b.rot.x * hero + Math.sin(t * 0.4 + b.seed * 5) * 0.08 - ay * 0.25, b.rot.y * hero + drift * 0.2 * (b.seed - 0.5) + ax * 0.35, b.rot.z * hero + Math.sin(t * 0.3 + b.seed) * 0.05);
      b.mesh.scale.setScalar(b.sc * (portrait ? 0.7 : 1) * smoothstep(0, 0.06, q));
      // depth of field: focus on the hero note's plane
      b.mat.uniforms.uBlur.value = Math.min(Math.abs(b.mesh.position.z - 2.2) * 1.1, 4.5);
      const burn = smoothstep(b.start, b.start + 0.3, l);
      b.mat.uniforms.uBurn.value = burn; b.mat.uniforms.uTime.value = t;
      anyBurn = Math.max(anyBurn, burn * (1 - burn * 0.3));
      if (!b.ignited && burn > 0.02) { b.ignited = true; if (i % 4 === 0) ctx.audio.play('ignite', 0.5, 0.9 + i * 0.03); }
      if (burn < 0.01) b.ignited = false;
    });
    this.bg.uniforms.uBurnGlow.value = anyBurn;
    this.emberMat.uniforms.uTime.value = t; this.emberMat.uniforms.uBurn.value = anyBurn * (1 - smoothstep(0.7, 0.76, l) * 0.5);
    this.scrapMat.uniforms.uTime.value = t; this.scrapMat.uniforms.uShow.value = 0;   // reference: clean dark green behind "Paper" (no paper scraps)
    // pointer: the view follows the cursor left/right (and a little up/down) like the other components
    this.camera.position.set(ax * 0.6 + Math.sin(t * 0.2) * 0.1, ay * 0.3, 8); this.camera.lookAt(ax * 0.2, ay * 0.1, 0);
    this.uni.mesh.position.x += (ax * 0.03 - this.uniDx); this.uniDx = ax * 0.03;
    this.paper.mesh.position.x += (ax * 0.04 - this.paperDx); this.paperDx = ax * 0.04;
    this.fx.bloom = 0.25 + anyBurn * 0.2;
    // "University sells" sweeps in as the bills fly, stays through the burning; "Paper" blurs in once they've burnt away
    this.uni.mat.uniforms.uIn.value = easeOutCubic(smoothstep(0.15, 0.3, l));
    this.uni.mat.uniforms.uOut.value = smoothstep(0.66, 0.72, l);
    this.paper.mat.uniforms.uIn.value = easeOutCubic(smoothstep(0.72, 0.82, l));
    this.paper.mat.uniforms.uOut.value = smoothstep(0.95, 1, l);
    void lerp;
  }
  dispose() { this.hand?.dispose(); super.dispose(); }
}
