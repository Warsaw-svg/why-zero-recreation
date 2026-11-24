import * as THREE from 'three';
import { Scene, type Ctx } from '../core/Scene';
import { wrapText } from '../utils/text';
import { NOISE } from '../shaders/common';
import { makeLockup, SERIF, type Lockup } from '../utils/lockup';
import { easeOutCubic, smoothstep, mulberry32 } from '../utils/math';

/**
 * Component 4b — matched to recording/componet4.mov 11–20 s: black room with a green glow from above, a vortex of
 * pale-green paper streaming toward the camera (blank torn sheets, newspaper clippings with quotes + headshots, long
 * curly shredded strips), while the lettering steps through "but Companies" → "want Someone" → "who can do the" →
 * "Job" → "see the Disconnect".
 */
const QUOTES = [
  { q: "There's no need to have a college degree at all. I look for evidence of exceptional ability.", a: 'CEO, tech company' },
  { q: 'Skills are far more important than a college degree.', a: 'Head of Talent, software firm' },
  { q: 'What matters most is relevant skills, not a degree.', a: 'VP Engineering, cloud company' },
  { q: "About half our US hires don't have a four-year degree, and we're proud of it.", a: 'Chief People Officer, retailer' },
  { q: 'I never judge people by their education qualifications.', a: 'Founder, airline group' },
];
const CW = 512, CH = 640;
function atlas() {
  // 4×2 tiles: 0–4 quote clippings (portrait, headshot), 5–7 blank torn paper
  const cv = document.createElement('canvas'); cv.width = CW * 4; cv.height = CH * 2;
  const g = cv.getContext('2d')!; const rnd = mulberry32(21);
  for (let i = 0; i < 8; i++) {
    const x0 = (i % 4) * CW, y0 = Math.floor(i / 4) * CH;
    g.save(); g.translate(x0, y0);
    g.fillStyle = i < 5 ? '#ece6d2' : ['#e9e3cf', '#f1ecdc', '#e2dcc6'][i - 5]; g.fillRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(80,60,30,.08)'; for (let k = 0; k < 220; k++) g.fillRect(rnd() * CW, rnd() * CH, 2 + rnd() * 7, 1);
    if (i < 5) {
      const Q = QUOTES[i];
      g.fillStyle = '#161616'; g.font = 'italic 400 46px "Playfair Display", serif'; g.textAlign = 'left';
      const y = wrapText(g, Q.q, 34, 92, CW - 68, 52);
      // headshot + name
      const hy = Math.min(CH - 150, y + 10);
      g.fillStyle = '#9a9a92'; g.fillRect(34, hy, 96, 110);
      g.fillStyle = '#3a3a36'; g.beginPath(); g.ellipse(82, hy + 44, 22, 27, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(42, hy + 110); g.quadraticCurveTo(50, hy + 72, 82, hy + 70); g.quadraticCurveTo(114, hy + 72, 122, hy + 110); g.fill();
      g.fillStyle = '#2a2a2a'; g.font = '600 24px "JetBrains Mono", monospace'; g.fillText('—', 148, hy + 40);
      g.font = '500 22px "JetBrains Mono", monospace'; wrapText(g, Q.a, 148, hy + 72, CW - 180, 28);
      // faint column text above (it's cut from a newspaper page)
      g.fillStyle = 'rgba(30,30,30,.35)'; for (let r = 0; r < 3; r++) g.fillRect(34, 24 + r * 14, (CW - 68) * (0.5 + rnd() * 0.5), 6);
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// shared tunnel: everything streams toward the camera along -z → +z as you scroll (and drifts a little on its own)
const TUNNEL = /* glsl */ `
uniform float uTime; uniform float uL;
vec3 tunnel(vec4 P, out float zf){
  float travel = uL * 30. + uTime * .35;
  float z = mod(P.z + travel * (.8 + P.w * .4), 26.) - 22.;     // -22 (far) … +4 (just past the lens)
  zf = z;
  float ang = P.y + travel * .06 * (P.w - .5) + sin(uTime * .2 + P.y) * .1;
  float r = P.x;
  return vec3(cos(ang) * r, sin(ang) * r * .75, z);
}
mat3 rot(vec3 a){ float cx=cos(a.x), sx=sin(a.x), cy=cos(a.y), sy=sin(a.y), cz=cos(a.z), sz=sin(a.z);
  return mat3(cy*cz, cy*sz, -sy,  sx*sy*cz - cx*sz, sx*sy*sz + cx*cz, sx*cy,  cx*sy*cz + sx*sz, cx*sy*sz - sx*cz, cx*cy); }
`;

const CLIP_VERT = /* glsl */ `
attribute vec4 aP; attribute vec4 aS; attribute float aTex; ${TUNNEL}
varying vec2 vUv; varying vec2 vTile; varying float vShade; varying float vBlur; varying float vSeed;
void main(){
  float zf; vec3 c = tunnel(aP, zf);
  vec3 v = position * (.55 + aS.w * .8);
  v.z += sin(v.y * 3. + uTime * 1.6 + aS.z * 6.) * .08 + v.x * v.x * .25 * (aS.x - .5);   // flutter + curl
  vec3 a = vec3(aS.x * 6.28 + uTime * (.2 + aS.y * .5), aS.y * 6.28 + uTime * (.15 + aS.z * .4), aS.z * 6.28 + uTime * .1);
  v = rot(a) * v;
  vec4 mv = modelViewMatrix * vec4(c + v, 1.);
  vUv = uv; vTile = vec2(mod(aTex, 4.), floor(aTex / 4.)); vSeed = aS.x;
  float d = -mv.z;
  vShade = clamp(1. - (d - 3.) / 20., 0., 1.);                       // fade into the black far away
  vShade *= .55 + .6 * smoothstep(-4., 4., (c + v).y);                // lit by the green glow from above
  vBlur = clamp(abs(d - 7.) * .45, 0., 4.);                           // depth of field around the text plane
  gl_Position = projectionMatrix * mv;
}`;
const CLIP_FRAG = /* glsl */ `
uniform sampler2D tAtlas; varying vec2 vUv; varying vec2 vTile; varying float vShade; varying float vBlur; varying float vSeed; ${NOISE}
void main(){
  // torn edges: ragged top/bottom (and a little on the sides)
  float tb = .05 + vnoise(vec2(vUv.x * 34. + vSeed * 50., vSeed * 9.)) * .06;
  float tt = .04 + vnoise(vec2(vUv.x * 30. + vSeed * 20., 3.)) * .05 * step(.5, fract(vSeed * 7.));
  float ts = .015 + vnoise(vec2(vUv.y * 20., vSeed * 30.)) * .02;
  if (vUv.y < tb || vUv.y > 1. - tt || vUv.x < ts || vUv.x > 1. - ts) discard;
  vec2 uv = (vTile + vec2(vUv.x, 1. - vUv.y)) / vec2(4., 2.); uv.y = 1. - uv.y;
  vec3 c = texture2D(tAtlas, uv, vBlur).rgb;
  c = mix(vec3(dot(c, vec3(.3, .59, .11))), c, .4) * vec3(.62, .82, .6);   // pale green, like the reference
  gl_FragColor = vec4(c * vShade * .9, 1.);
}`;

const STRIP_VERT = /* glsl */ `
attribute vec4 aP; attribute vec4 aS; ${TUNNEL}
varying float vShade; varying float vLit;
void main(){
  float zf; vec3 c = tunnel(aP, zf);
  float s = uv.y;                                     // along the strip
  float len = 1.2 + aS.w * 2.2;
  float ph = aS.x * 6.28 + uTime * (.6 + aS.y);
  float f = 2. + aS.z * 5.;                           // curliness
  float amp = .18 + aS.y * .3;
  vec3 v = vec3(position.x + sin(s * f + ph) * amp, (s - .5) * len, cos(s * f * .8 + ph) * amp * 1.3);
  vec3 a = vec3(aS.z * 6.28 + uTime * .25, aS.x * 6.28 + uTime * (.1 + aS.w * .3), aS.y * 6.28);
  v = rot(a) * v;
  vec4 mv = modelViewMatrix * vec4(c + v, 1.);
  float d = -mv.z;
  vShade = clamp(1. - (d - 3.) / 20., 0., 1.) * (.5 + .6 * smoothstep(-4., 4., (c + v).y));
  vLit = .55 + .45 * sin(s * f + ph + 1.2);            // light rolls along the curls
  gl_Position = projectionMatrix * mv;
}`;
const STRIP_FRAG = 'varying float vShade; varying float vLit; void main(){ vec3 c = vec3(.58,.7,.55) * vLit; gl_FragColor = vec4(c * vShade, 1.); }';

const DUST_VERT = /* glsl */ `attribute vec4 aSeed; uniform float uTime; varying float vA;
void main(){ vec3 p = vec3((aSeed.x - .5) * 14., (aSeed.y - .5) * 9., -2. - aSeed.z * 10.); p.y += sin(uTime * .2 + aSeed.w * 20.) * .3; p.x += cos(uTime * .15 + aSeed.x * 20.) * .3;
  vA = .3 + .7 * aSeed.w; vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (2. + aSeed.w * 4.) * (8. / -mv.z); gl_Position = projectionMatrix * mv; }`;
const DUST_FRAG = 'varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.85, 1., .9), smoothstep(.5, 0., d) * vA * .6); }';

export class LettersScene extends Scene {
  private bg!: THREE.ShaderMaterial;
  private clipMat!: THREE.ShaderMaterial; private stripMat!: THREE.ShaderMaterial; private dustMat!: THREE.ShaderMaterial;
  private butC!: Lockup; private wantS!: Lockup; private whoCan!: Lockup; private job!: Lockup; private disc!: Lockup;
  private base = new Map<Lockup, THREE.Vector2>();
  private rustled = false;
  constructor(ctx: Ctx) { super(ctx, 'letters', [0.735, 0.855]); this.theme = 'dark'; this.fx = { bloom: 0.35, grain: 0.1, vignette: 0.55, ca: 0.12 }; this.camera.fov = 50; }
  init() {
    super.init();
    this.base = new Map();
    // black room, green glow from the top centre
    this.bg = this.makeBackdrop(/* glsl */ `
      void main(){ vec2 q = vUv - .5; q.x *= uRes.x / uRes.y;
        vec3 col = vec3(.008, .012, .01);
        col += vec3(.05, .2, .1) * exp(-pow(length(q - vec2(0., .62)), 2.) * 3.2) * (.85 + .15 * fbm(q * 3. + uTime * .05));
        gl_FragColor = vec4(col, 1.); }`, {});
    const rnd = mulberry32(3);
    const uT = { value: 0 }, uL = { value: 0 };
    // clippings + blank torn sheets
    const nc = Math.floor(46 * this.ctx.quality.particles) + 16;
    const cg = new THREE.PlaneGeometry(1.15, 1.45, 6, 8);
    const cp = new Float32Array(nc * 4), cs = new Float32Array(nc * 4), ct = new Float32Array(nc);
    for (let i = 0; i < nc; i++) {
      cp[i * 4] = 1.0 + rnd() * 4.5; cp[i * 4 + 1] = rnd() * 6.283; cp[i * 4 + 2] = rnd() * 26; cp[i * 4 + 3] = rnd();
      cs[i * 4] = rnd(); cs[i * 4 + 1] = rnd(); cs[i * 4 + 2] = rnd(); cs[i * 4 + 3] = rnd();
      ct[i] = i % 3 === 0 ? 5 + Math.floor(rnd() * 3) : i % 5;
    }
    cg.setAttribute('aP', new THREE.InstancedBufferAttribute(cp, 4)); cg.setAttribute('aS', new THREE.InstancedBufferAttribute(cs, 4)); cg.setAttribute('aTex', new THREE.InstancedBufferAttribute(ct, 1));
    this.clipMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { tAtlas: { value: atlas() }, uTime: uT, uL }, vertexShader: CLIP_VERT, fragmentShader: CLIP_FRAG });
    const clips = new THREE.InstancedMesh(cg, this.clipMat, nc); clips.frustumCulled = false; this.scene.add(clips);
    // long curly shredded strips
    const ns = Math.floor(120 * this.ctx.quality.particles) + 30;
    const sg = new THREE.PlaneGeometry(0.13, 1, 1, 48);
    const sp = new Float32Array(ns * 4), ss = new Float32Array(ns * 4);
    for (let i = 0; i < ns; i++) { sp[i * 4] = 0.8 + rnd() * 5.5; sp[i * 4 + 1] = rnd() * 6.283; sp[i * 4 + 2] = rnd() * 26; sp[i * 4 + 3] = rnd(); for (let k = 0; k < 4; k++) ss[i * 4 + k] = rnd(); }
    sg.setAttribute('aP', new THREE.InstancedBufferAttribute(sp, 4)); sg.setAttribute('aS', new THREE.InstancedBufferAttribute(ss, 4));
    this.stripMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uTime: uT, uL }, vertexShader: STRIP_VERT, fragmentShader: STRIP_FRAG });
    const strips = new THREE.InstancedMesh(sg, this.stripMat, ns); strips.frustumCulled = false; this.scene.add(strips);
    // dust specks
    const nd = Math.floor(160 * this.ctx.quality.particles) + 30, ds = new Float32Array(nd * 4); for (let i = 0; i < ds.length; i++) ds[i] = rnd();
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nd * 3), 3)); dg.setAttribute('aSeed', new THREE.BufferAttribute(ds, 4));
    this.dustMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: uT }, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG });
    const dust = new THREE.Points(dg, this.dustMat); dust.frustumCulled = false; this.scene.add(dust);

    // lettering — same mint-white glowing style as "University sells" / "Paper"
    this.butC = makeLockup((g) => { g.font = `400 250px ${SERIF}`; g.textAlign = 'left'; g.fillText('but', 90, 380); g.font = `400 330px ${SERIF}`; g.fillText('Companies', 90, 690); });
    this.wantS = makeLockup((g) => {
      g.font = `400 330px ${SERIF}`; const w2 = g.measureText('omeone').width; g.textAlign = 'right'; g.fillText('omeone', 1980, 820);
      g.font = '400 640px "Pinyon Script", cursive'; g.fillText('S', 1980 - w2 + 40, 840);
      g.font = `400 200px ${SERIF}`; g.fillText('want', 1960, 470);
    });
    this.whoCan = makeLockup((g) => { g.textAlign = 'center'; g.font = `400 340px ${SERIF}`; g.fillText('who can', 1000, 500); g.font = `400 270px ${SERIF}`; g.fillText('do the', 1120, 790); });
    this.job = makeLockup((g) => { g.textAlign = 'center'; g.font = '400 860px "Pinyon Script", cursive'; g.fillText('Job', 1024, 760); });
    this.disc = makeLockup((g) => {
      g.textAlign = 'center'; g.font = `400 230px ${SERIF}`; g.fillText('see the', 1080, 400);
      g.font = `400 400px ${SERIF}`; const wr = g.measureText('isconnect').width; g.font = `italic 400 470px ${SERIF}`; const wd = g.measureText('D').width;
      const x0 = 1024 - (wr + wd) / 2; g.textAlign = 'left'; g.fillText('D', x0, 800); g.font = `400 400px ${SERIF}`; g.fillText('isconnect', x0 + wd + 6, 790);
    });
    for (const L of [this.butC, this.wantS, this.whoCan, this.job, this.disc]) {
      const u = L.mat.uniforms;
      u.uDeep.value.set(.78, .93, .84); u.uLight.value.set(.95, 1, .97); u.uForm.value.set(.55, .95, .8);
      u.uShadowCol.value.set(.02, .08, .05); u.uEmboss.value = .06; u.uGlow.value = .5; u.uGlowCol.value.set(.45, .85, .65);
      u.uOutSweep.value = 0;   // reference: each line blurs out in place
      this.ui.add(L.mesh);
    }
  }
  protected layoutText() {
    const a = this.aspect, p = this.portrait;
    const put = (L: Lockup, w: number, x: number, y: number) => { L.mesh.scale.set(w / 2, w / 2, 1); L.mesh.position.set(x, y, 0); this.base.set(L, new THREE.Vector2(x, y)); };
    const wb = Math.min(a * 2 * (p ? 0.95 : 0.56), 2.3); put(this.butC, wb, -a + wb / 2 + 0.04, p ? 0.55 : 0.5);
    const ww = Math.min(a * 2 * (p ? 0.95 : 0.56), 2.3); put(this.wantS, ww, a - ww / 2 - 0.04, p ? -0.5 : -0.48);
    put(this.whoCan, Math.min(a * 2 * (p ? 0.92 : 0.56), 2.3), 0, 0.02);
    put(this.job, Math.min(a * 2 * (p ? 0.95 : 0.72), 3.0), 0, 0.02);
    put(this.disc, Math.min(a * 2 * (p ? 0.9 : 0.64), 2.7), 0, 0.02);   // portrait: fits the screen width
  }
  enter() { this.rustled = false; this.ctx.hud.setTheme('dark'); }   // Component 4's +100 is given at the banknote
  update(l: number, _dt: number, t: number) {
    const ctx = this.ctx;
    this.bg.uniforms.uTime.value = t; this.bg.uniforms.uRes.value.set(ctx.size.w, ctx.size.h);
    this.clipMat.uniforms.uTime.value = t; this.clipMat.uniforms.uL.value = l;
    // the view follows the cursor like the other components (depth gives the parallax)
    const ax = ctx.input.sx || 0, ay = ctx.input.sy || 0;
    this.camera.position.set(ax * 0.9 + Math.sin(t * 0.12) * 0.2, ay * 0.5 + Math.cos(t * 0.1) * 0.1, 6);
    this.camera.lookAt(ax * 0.25, ay * 0.12, -10);
    this.camera.rotation.z += Math.sin(t * 0.15) * 0.03;
    if (!this.rustled && l > 0.05) { this.rustled = true; ctx.audio.play('rustle', 0.8); }
    // lettering sequence (componet4.mov 12–20 s)
    const step = (L: Lockup, i0: number, i1: number, o0: number, o1: number) => {
      L.mat.uniforms.uIn.value = easeOutCubic(smoothstep(i0, i1, l));
      L.mat.uniforms.uOut.value = smoothstep(o0, o1, l);
      L.mesh.visible = l > i0 - 0.01 && l < o1 + 0.01;
      const b = this.base.get(L); if (b) L.mesh.position.set(b.x + ax * 0.03, b.y + ay * 0.015, 0);
    };
    // ('Paper' is still fading until l≈0.17; the next component crossfades in from l≈0.79)
    step(this.butC, 0.17, 0.24, 0.38, 0.43);
    step(this.wantS, 0.26, 0.32, 0.38, 0.43);
    step(this.whoCan, 0.43, 0.48, 0.52, 0.56);
    step(this.job, 0.55, 0.6, 0.64, 0.67);
    step(this.disc, 0.66, 0.71, 0.77, 0.8);
  }
}
