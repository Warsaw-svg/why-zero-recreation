import * as THREE from 'three';
import { Scene, type Ctx } from '../core/Scene';
import { Hand, POSES, type HandPose } from '../utils/Hand';
import { makeLockup, SERIF, type Lockup } from '../utils/lockup';
import { P } from '../core/progressMap';
import { TextLine, wrapText } from '../utils/text';
import { buildShards, ROT_GLSL } from '../utils/shards';
import { win, lerp, easeOutCubic, smoothstep, clamp, easeInOutCubic, mulberry32 } from '../utils/math';

export const RED_BG = /* glsl */ `
uniform float uSwap; uniform float uDark;
void main(){
  vec2 p = vUv; float asp = uRes.x/uRes.y;
  vec3 deep = vec3(.30,.01,.02), mid = vec3(.62,.04,.05), hot = vec3(.95,.12,.08);
  float v = fbm(vec2(p.x*asp*2., p.y*.4 - uTime*.12));
  float st = fbm(vec2(p.x*asp*14. + uTime*.02, p.y*.6 - uTime*.35));
  float streak = smoothstep(.45,.9, st) * smoothstep(.0,.6,p.y+.2);
  vec3 col = mix(deep, mid, smoothstep(.1,.9,v + (1.-p.y)*.25));
  col = mix(col, hot, streak*.45);
  col += hot * pow(max(0., 1.-length((p-vec2(.5,.38))*vec2(asp*.7,1.))*1.5), 2.)*.35;
  col *= 1. - uDark;
  gl_FragColor = vec4(col, 1.);
}`;

/* ---------- 6. That's Bullsh*t (Component 3 opening, matched to componet 2to3.mov 5–8 s + coponent3.mov 0–2 s) ---------- */
/** red velvet stage curtain: vertical folds, light catching the fold crests, a hot spotlight from above, dark edges */
export const CURTAIN_BG = /* glsl */ `
uniform float uDim;
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
void main(){
  vec2 p = vUv; float asp = uRes.x / uRes.y; float x = p.x * asp;
  float wob = fbm(vec2(x * 1.3, p.y * .35 + uTime * .03)) * 2.2;
  float f = .5 + .5 * sin(x * 15. + sin(x * 2.7 + uTime * .15) * 1.8 + wob);           // folds
  float f2 = .5 + .5 * sin(x * 37. + wob * 1.7);
  vec3 col = mix(vec3(.09, 0., .007), vec3(.42, .01, .026), f * .85 + f2 * .12);
  // red light FALLING from above at speed (reference): streaks run down the folds in random lanes, bright head + long trail
  float fall = 0.;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float cyc = uTime * (.55 + h1(fi + 3.) * .55) + h1(fi);          // each streak has its own speed and phase
    float k = floor(cyc), ph = fract(cyc);
    float lx = (h1(fi * 7.3 + k) * 1.1 - .05) * asp;                   // new lane every pass
    float w = .025 + h1(fi * 3.1 + k) * .05;
    float head = 1.25 - ph * 1.7;                                       // top → bottom, fast
    float d = p.y - head;
    float tail = d > 0. ? exp(-d / (.35 + h1(fi + k * 1.3) * .35)) : exp(d / .015);
    float across = exp(-pow((x - lx) / w, 2.));
    fall += across * tail * (.6 + .4 * f) * (.55 + .45 * h1(fi * 5. + k));
  }
  col += vec3(1., .2, .15) * fall * .75;
  col += vec3(.9, .08, .06) * pow(f, 8.) * .12;                         // faint sheen on the fold crests
  col *= mix(.32, 1., smoothstep(1.25, .25, length((p - vec2(.52, .55)) * vec2(asp * .75, 1.05))));   // vignette
  col *= .78 + .22 * smoothstep(0., .35, p.y);
  col *= 1. - uDim;
  gl_FragColor = vec4(col, 1.);
}`;
/** white-on-red title colours for the lettering shader */
function whiteTitle(m: THREE.ShaderMaterial, glow = 0.55) {
  const u = m.uniforms;
  u.uDeep.value.set(.93, .86, .86); u.uLight.value.set(1, 1, 1); u.uForm.value.set(1, .72, .72);
  u.uShadowCol.value.set(.28, 0, .02); u.uEmboss.value = .08; u.uGlow.value = glow; u.uGlowCol.value.set(1, .22, .18);
  u.uOutSweep.value = 1;
}
const RAISED: HandPose = { index: 0.08, middle: 0.1, ring: 0.16, pinky: 0.22, thumb: 0.14, spread: 0.95, thumbIn: 0.1 };
export class BullScene extends Scene {
  private bg!: THREE.ShaderMaterial; private hand!: Hand;
  private but!: Lockup; private bull!: Lockup; private xp = false;
  private t0 = -1;
  constructor(ctx: Ctx) { super(ctx, 'bullsh', [0.37, 0.485]); this.theme = 'dark'; this.fx = { bloom: 0.32, grain: 0.12, vignette: 0.45, ca: 0.15 }; }
  init() {
    super.init();
    this.bg = this.makeBackdrop(CURTAIN_BG, { uDim: { value: 0 } });
    // a real right hand raised from below, back of the hand to us, lit red by the stage
    this.hand = new Hand('real', undefined, 2.95);   // big enough that the wrist sits below the bottom edge (the arm runs off-screen, like the reference)
    this.hand.showBack(true);
    const u = this.hand.mat.uniforms;
    u.uAlb.value.setRGB(.42, .17, .15); u.uAlb2.value.setRGB(.5, .14, .12); u.uSSS.value.setRGB(1, .15, .1); u.uRimSSS.value = .8; u.uSpec.value = .22;
    u.uFadeCol.value.setRGB(.2, 0, .02);
    this.hand.setPose(RAISED);
    this.scene.add(this.hand.group);
    this.camera.position.set(0, 0, 8); this.camera.fov = 40;
    this.but = makeLockup((g) => { g.font = `400 600px ${SERIF}`; g.textAlign = 'center'; g.fillText('But,', 1000, 760); });
    whiteTitle(this.but.mat, .45); this.but.mat.uniforms.uOutSweep.value = 0;
    this.bull = makeLockup((g) => {
      g.font = `400 640px ${SERIF}`; g.textAlign = 'center'; g.fillText('Bullsh*t', 1024, 860);
      g.font = '400 300px "Pinyon Script", cursive'; g.textAlign = 'left'; g.fillText("That's", 300, 420);
    });
    whiteTitle(this.bull.mat, .6);
    this.ui.add(this.but.mesh, this.bull.mesh);
  }
  protected layoutText() {
    const w = Math.min(this.aspect * 2 * (this.portrait ? 0.95 : 0.56), 2.6);
    this.bull.mesh.scale.set(w / 2, w / 2, 1); this.bull.mesh.position.set(0, -0.02, 0);
    const wb = w * 0.5;
    this.but.mesh.scale.set(wb / 2, wb / 2, 1); this.but.mesh.position.set(-0.08 * this.aspect, 0.02, 0);
  }
  enter() { this.ctx.hud.setTheme('dark'); this.xp = true; }   // no XP in Component 3: it stays at 200 (reference)
  update(l: number, dt: number, t: number) {
    const ctx = this.ctx;
    this.bg.uniforms.uTime.value = t; this.bg.uniforms.uRes.value.set(ctx.size.w, ctx.size.h);
    // the opening plays in time once you arrive (the reference runs it without scrolling); scrolling on dissolves it
    if (this.t0 < 0 && l > 0.05) this.t0 = t;
    const s = this.t0 < 0 ? 0 : t - this.t0;
    const rise = easeOutCubic(clamp(s / 0.9));
    const halfW = 8 * Math.tan(THREE.MathUtils.degToRad(20)) * this.aspect;
    const g = this.hand.group;
    g.position.set(halfW * (this.portrait ? 0.15 : 0.1), lerp(-9, -1.75, rise) + Math.sin(t * 0.7) * 0.03, -0.6);
    g.rotation.set(-0.12 + Math.sin(t * 0.5) * 0.02, 0, -0.1 + Math.sin(t * 0.4) * 0.03);
    this.hand.lerpPose(RAISED, { ...RAISED, index: 0.14, middle: 0.18, ring: 0.24, pinky: 0.3 }, 0.5 + 0.5 * Math.sin(t * 0.9));
    this.hand.update(t);
    // "But," blurs in, holds, fades in place; then "That's Bullsh*t" sweeps in from the left and glows
    this.but.mat.uniforms.uIn.value = easeInOutCubic(clamp((s - 0.2) / 0.5));
    this.but.mat.uniforms.uOut.value = easeInOutCubic(clamp((s - 1.25) / 0.35));
    // the title goes as soon as you start scrolling on (you land at l ≈ 0.30), not after a long scroll
    const out = easeInOutCubic(smoothstep(0.32, 0.37, l));
    this.bull.mat.uniforms.uIn.value = easeInOutCubic(clamp((s - 2.0) / 0.8));
    this.bull.mat.uniforms.uOut.value = out;
    this.hand.mat.uniforms.uSoft.value = Math.sin(Math.PI * out) * 0.85;   // the hand softens while the title dissolves, then sharpens again
    this.fx.ca = 0.15 + (1 - smoothstep(0, 0.6, s)) * 0.8;
  }
  dispose() { this.hand?.dispose(); super.dispose(); }
}

/* ---------- 7. Glass stat cards (Component 3b, matched to coponent3.mov 12.7–20 s) ---------- */
type CardText = { big?: string; lines: string[]; script?: string; title?: string; big2?: string; lines2?: string[] };
const CARDS: CardText[] = [
  { big: '43', lines: ["don't have a", 'full time job', 'months', 'after'], script: 'graduating' },
  { big: '50', lines: ['drop in', 'grad hiring', 'at BIG tech'] },
  { title: 'Worst since 1988', lines: ["the hardest it's been to"], big2: '37', lines2: ['land a first job in', 'years'] },
  { big: '73', lines: ['Who land in the wrong', 'first', 'job are still stuck', '10 ten years later.'] },
  { big: '25', lines: ['of Jobless', 'americans', 'have a degree'] },
  { big: '70', lines: ['grads', "aren't working", 'in', 'their'], script: 'Field' },
];
/** an irregular broken-glass outline (seeded): a jittered rectangle with chipped edges and, on some cards, a long sharp spike */
function glassOutline(seed: number, W: number, H: number) {
  const r = mulberry32(seed);
  const x0 = 70, x1 = W - 70, y0 = 120, y1 = H - 120;
  const pts: Array<[number, number]> = [];
  const side = (ax: number, ay: number, bx: number, by: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const k = i / n, nx = -(by - ay), ny = bx - ax, len = Math.hypot(nx, ny);
      const j = (r() - 0.5) * 70;
      pts.push([ax + (bx - ax) * k + (nx / len) * j, ay + (by - ay) * k + (ny / len) * j]);
    }
  };
  side(x0, y0 + 40, x1 - 60, y0, 5); side(x1, y0 + 30, x1 - 20, y1, 4); side(x1 - 40, y1, x0 + 30, y1 - 20, 5); side(x0, y1 - 30, x0 + 10, y0 + 60, 3);
  if (seed % 2 === 0) { const at = 3 + Math.floor(r() * 3); pts.splice(at, 0, [W - 6, y0 - 60 + r() * 60]); }   // a sharp spike
  return pts;
}
function cardTexture(i: number, pts: Array<[number, number]>) {
  const W = 1024, H = 720, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath(); };
  // clear glass body, frosted towards the broken edges, a bright chipped rim
  g.save(); path(); g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 60; path(); g.stroke();   // frosted band inside the broken edge
  g.restore();
  const r = mulberry32(99 + i);
  for (let k = 0; k < pts.length; k++) {   // little chips and cracks along the edge
    const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % pts.length];
    for (let q = 0; q < 4; q++) {
      const s = r(), cx = ax + (bx - ax) * s, cy = ay + (by - ay) * s;
      g.strokeStyle = `rgba(255,255,255,${0.35 + r() * 0.4})`; g.lineWidth = 1 + r() * 1.5;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (r() - 0.5) * 40, cy + (r() - 0.5) * 40); g.stroke();
    }
  }
  // white type: big serif number with a raised %, slanted small serif lines, an optional script word
  const c = CARDS[i];
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  g.save(); g.translate(W * 0.5, H * 0.5); g.rotate(-0.16); g.translate(-W * 0.5, -H * 0.5);
  if (c.title) {
    g.font = `400 112px ${SERIF}`; g.textAlign = 'center'; g.fillText(c.title, W * 0.5, 300);
    g.font = `italic 400 48px ${SERIF}`; g.fillText(c.lines[0], W * 0.5, 370);
    g.font = `400 170px ${SERIF}`; g.textAlign = 'right'; g.fillText(c.big2!, W * 0.47, 530);
    g.font = `italic 400 50px ${SERIF}`; g.textAlign = 'left'; c.lines2!.forEach((s, k) => g.fillText(s, W * 0.49, 460 + k * 54));
  } else {
    g.font = `400 330px ${SERIF}`; g.textAlign = 'left'; g.fillText(c.big!, 150, 520);
    const bw = g.measureText(c.big!).width;
    g.font = `400 130px ${SERIF}`; g.fillText('%', 150 + bw + 6, 330);
    g.font = `italic 400 58px ${SERIF}`;
    c.lines.forEach((s, k) => g.fillText(s, 160 + bw + 110, 250 + k * 64));
    if (c.script) { g.font = '400 120px "Pinyon Script", cursive'; g.fillText(c.script, 160 + bw + 80, 250 + c.lines.length * 64 + 70); }
  }
  g.restore();
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
/** thick glass slab cut to the card's broken outline; front/back faces get UVs matching the card texture */
function cardGeometry(pts: Array<[number, number]>, w: number) {
  const W = 1024, H = 720, k = w / W;
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2((x - W / 2) * k, (H / 2 - y) * k)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 1 });
  geo.translate(0, 0, -0.035);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / k / W + 0.5, pos.getY(i) / k / H + 0.5);
  uv.needsUpdate = true; geo.computeVertexNormals();
  return geo;
}
const CARD_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vON;
void main(){ vUv = uv; vON = normal; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const CARD_FRAG = /* glsl */ `
uniform sampler2D tMap; uniform float uTime; uniform float uAlpha; uniform float uSeed;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vON;
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  if (!gl_FrontFacing) N = -N;
  float nv = abs(dot(N, V));
  vec4 tx = texture2D(tMap, vUv) * step(0., vON.z);   // text only on the front face (no mirrored double print)
  float face = smoothstep(.6, .9, abs(normalize(vON).z));    // front/back faces vs the cut edges (object space)
  float fres = pow(1. - nv, 3.);
  // glass body: faint pinkish-white, brighter at grazing angles; text and chips from the texture
  vec3 iri = .5 + .5 * cos(6.2831 * (vUv.x * .7 + vUv.y * .4 + nv * 1.3 + uSeed + vec3(0., .33, .67)));
  float band = smoothstep(.75, 1., sin((vUv.x * 5. + vUv.y * 3.) + nv * 6. + uSeed * 3. + uTime * .25));
  float streak = exp(-pow((vUv.x - vUv.y * .55 - fract(uTime * .07 + uSeed) * 1.6 + .3) * 7., 2.));
  vec3 body = mix(vec3(1., .86, .86), iri, band * .3);
  float aBody = .1 + fres * .35 + streak * .2 + band * .06;
  vec3 col = mix(body, vec3(1.), max(tx.a, streak * .6));
  float a = max(aBody, tx.a);
  // cut edges: bright, slightly rainbow (like thick glass catching the stage light)
  vec3 edge = mix(vec3(1., .95, .95), iri, .35);
  col = mix(edge, col, face);
  a = mix(.55 + fres * .45, a, face);
  gl_FragColor = vec4(col, clamp(a, 0., 1.) * uAlpha);
}`;
/** soft out-of-focus glass fragment for the background */
function blurShardTexture() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.filter = 'blur(7px)';
  g.fillStyle = 'rgba(255,225,225,0.55)'; g.strokeStyle = 'rgba(255,240,240,0.9)'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(40, 60); g.lineTo(210, 30); g.lineTo(225, 170); g.lineTo(90, 220); g.closePath(); g.fill(); g.stroke();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

/** 3b hand pose: index + middle up together, ring + pinky half folded */
const SCREEN_Z = new THREE.Vector3(0, 0, 1);
const PEACE: HandPose = { index: 0.04, middle: 0.04, ring: 0.5, pinky: 0.55, thumb: 0.3, spread: 0.35, thumbIn: 0.35 };
export class StatsScene extends Scene {
  private bg!: THREE.ShaderMaterial; private hand!: Hand;
  private cards: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }> = [];
  private bits: Array<{ m: THREE.Mesh; v: THREE.Vector3; s: number; r: THREE.Vector3 }> = [];
  private frags: Array<{ m: THREE.Mesh; d: THREE.Vector3; r: THREE.Vector3 }> = [];
  private fragMat!: THREE.ShaderMaterial;
  private cracked = false;
  private wrist = 0; private wristTarget = 0;
  private spin = 0; private spinTarget = 0;
  constructor(ctx: Ctx) { super(ctx, 'stats', [0.455, 0.615]); this.theme = 'dark'; this.fx = { bloom: 0.32, grain: 0.12, vignette: 0.45, ca: 0.15 }; }
  init() {
    super.init();
    // re-entering after the scene was unloaded: start with fresh lists (old entries were disposed)
    this.cards = []; this.bits = []; this.frags = []; this.cracked = false;
    this.bg = this.makeBackdrop(CURTAIN_BG, { uDim: { value: 0 } });   // the same falling-light curtain as 3a
    // the same raised, red-lit right hand as 3a (same transform and look, so the crossfade is seamless)
    this.hand = new Hand('real', undefined, 2.95);
    this.hand.showBack(true);
    const u = this.hand.mat.uniforms;
    u.uAlb.value.setRGB(.42, .17, .15); u.uAlb2.value.setRGB(.5, .14, .12); u.uSSS.value.setRGB(1, .15, .1); u.uRimSSS.value = .8; u.uSpec.value = .22;
    u.uFadeCol.value.setRGB(.2, 0, .02);
    this.hand.setPose(RAISED);
    this.scene.add(this.hand.group);
    this.camera.position.set(0, 0, 8); this.camera.fov = 40;
    CARDS.forEach((_, i) => {
      const pts = glassOutline(11 + i * 7, 1024, 720);
      const mat = new THREE.ShaderMaterial({
        vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { tMap: { value: cardTexture(i, pts) }, uTime: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: i * 0.37 } },
      });
      const mesh = new THREE.Mesh(cardGeometry(pts, 3.6), mat);
      mesh.renderOrder = 5 + i; mesh.visible = false;
      this.scene.add(mesh); this.cards.push({ mesh, mat });
    });
    // the last card (70%) breaks into thick glass pieces around the hand
    this.fragMat = new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { tMap: { value: new THREE.CanvasTexture(document.createElement('canvas')) }, uTime: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: .9 } } });
    const fr = mulberry32(21);
    for (let i = 0; i < 9; i++) {
      const s = 0.35 + fr() * 0.55;
      const pts: Array<[number, number]> = [[0, 0], [1024 * (0.5 + fr() * 0.5), 720 * fr() * 0.3], [1024 * fr() * 0.6, 720 * (0.6 + fr() * 0.4)]];
      const m = new THREE.Mesh(cardGeometry(pts, s * 1.6), this.fragMat);
      m.renderOrder = 12; m.visible = false; this.scene.add(m);
      this.frags.push({ m, d: new THREE.Vector3((fr() - 0.5) * 2, fr() * 1.6 - 0.3, (fr() - 0.2) * 1.5), r: new THREE.Vector3(fr() * 4, fr() * 4, fr() * 4) });
    }
    const st = blurShardTexture(); const rnd = mulberry32(7);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide }));
      m.renderOrder = 1;
      this.bits.push({ m, v: new THREE.Vector3((rnd() - 0.5) * 16, (rnd() - 0.5) * 9, -2 - rnd() * 5), s: 0.6 + rnd() * 1.1, r: new THREE.Vector3(rnd(), rnd(), rnd()) });
      this.scene.add(m);
    }
  }
  enter() { this.ctx.hud.setTheme('dark'); }   // no XP in Component 3
  update(l: number, dt: number, t: number) {
    const ctx = this.ctx;
    this.bg.uniforms.uTime.value = t; this.bg.uniforms.uRes.value.set(ctx.size.w, ctx.size.h);
    const halfW = 8 * Math.tan(THREE.MathUtils.degToRad(20)) * this.aspect;
    const px = this.portrait ? 0.55 : 1;
    // pointer: the hand and the glass follow the cursor left/right (eased), and the camera parallaxes like the other parts
    // nothing moves the hand away from 3a's pose until 3a's own hand has gone (they overlap in the crossfade; any offset
    // shows as a ghost/shadow hand). P(0.485) = end of 3a's range.
    const fk = smoothstep(P(0.485) + 0.002, P(0.485) + 0.025, this.ctx.scroll.progress);
    // while 3a is still on screen its identical hand is the one you see; drawing ours on top too gives a double/shadow hand
    this.hand.group.visible = this.ctx.scroll.progress > P(0.485) + 0.001;
    const ax = (this.ctx.input.sx || 0) * fk, ay = (this.ctx.input.sy || 0) * fk;
    this.camera.position.set(ax * 0.45, ay * 0.25, 8); this.camera.lookAt(ax * 0.15, ay * 0.08, 0);
    // cards rise past the hand one after another, scroll-driven, each tilting in 3D
    const XS = [0.15, -0.05, 0.1, -0.1, 0.25, 0.05], ZR = [0.32, -0.12, 0.1, 0.28, -0.22, 0.18], YR = [0.45, -0.4, 0.3, -0.35, 0.4, -0.3];
    let push = 0;
    this.cards.forEach((c, i) => {
      const s = (l - (0.13 + i * 0.11)) / 0.21;
      c.mesh.visible = s > 0 && s < 1;
      if (!c.mesh.visible) { c.mat.uniforms.uAlpha.value = 0; return; }
      const e = s * s * (3 - 2 * s) * 0.4 + s * 0.6;
      c.mesh.position.set(halfW * 0.1 + XS[i] * halfW * px + ax * (1.1 + (i % 2) * 0.3), lerp(-3.4, 3.8, e), 0.6 + (i % 2) * 0.25);
      c.mesh.rotation.set(lerp(0.95, -0.55, e) - ay * 0.15, YR[i] * (1 - e * 0.6) + Math.sin(t * 0.5 + i) * 0.05 + ax * 0.35, ZR[i] + (e - 0.5) * 0.35 - ax * 0.12);
      c.mesh.scale.setScalar(this.portrait ? 0.62 : 1);
      c.mat.uniforms.uAlpha.value = smoothstep(0, 0.035, s) * (1 - smoothstep(0.95, 1, s));   // quick in/out (no slow fade)
      c.mat.uniforms.uTime.value = t;
      push = Math.max(push, Math.sin(Math.PI * clamp((s - 0.15) / 0.4)));   // the hand pushes each card up as it passes
    });
    // the 70% card cracks apart near the top of its rise: pieces burst out around the hand and tumble away
    {
      const last = this.cards[this.cards.length - 1];
      const s = (l - (0.13 + 5 * 0.11)) / 0.21;
      const b = clamp((s - 0.55) / 0.45);
      if (b > 0) last.mat.uniforms.uAlpha.value *= 1 - smoothstep(0, 0.15, b);
      this.frags.forEach((f) => {
        f.m.visible = b > 0 && b < 1;
        if (!f.m.visible) return;
        f.m.position.copy(last.mesh.position).addScaledVector(f.d, b * 3.2); f.m.position.y -= b * b * 1.5;
        f.m.rotation.set(f.r.x * b + last.mesh.rotation.x, f.r.y * b, f.r.z * b);
      });
      this.fragMat.uniforms.uAlpha.value = b > 0 ? (1 - smoothstep(0.6, 1, b)) : 0;
      this.fragMat.uniforms.uTime.value = t;
      if (b > 0 && !this.cracked) { this.cracked = true; this.ctx.audio.play('glassCrack', 0.8); }
      if (b <= 0) this.cracked = false;
    }
    // hand: 3a's resting transform, nudged up as it pushes a card through, fingers flexing
    const g = this.hand.group;
    // the hand moves with the glass: follows the cursor, lifts and leans into each card as it pushes it up
    const sway = Math.sin(l * 26) * 0.35 * fk;
    push *= fk;
    g.position.set(halfW * (this.portrait ? 0.15 : 0.1) + ax * 1.1 + sway * 0.5, -1.75 + Math.sin(t * 0.7) * 0.03 + push * 0.45, -0.6);
    g.rotation.set(-0.12 + Math.sin(t * 0.5) * 0.02 - push * 0.12, ax * 0.25, -0.1 + Math.sin(t * 0.4) * 0.03 - ax * 0.22 + sway * 0.25);
    // wrist turns with the scroll direction: scrolling UP shows the palm, scrolling DOWN shows the back of the hand.
    // Last direction is held when you stop. Eased in at the scene start so the hand begins exactly as 3a leaves it.
    const v = this.ctx.scroll.velocity;
    if (v < -0.002) this.wristTarget = 1; else if (v > 0.002) this.wristTarget = 0;
    this.wrist += (this.wristTarget - this.wrist) * Math.min(1, dt * 1.4);   // slow, smooth turn
    const wk = this.wrist * this.wrist * (3 - 2 * this.wrist);
    g.rotateY(wk * Math.PI * fk);
    // while you keep scrolling the hand slowly turns in the screen plane: down = anticlockwise, up = clockwise.
    // It builds up gently with continued scrolling (capped), and drifts back to upright when you stop.
    const vRaw = this.ctx.scroll.velocity;
    if (vRaw > 0.002) this.spinTarget += dt * 0.32; else if (vRaw < -0.002) this.spinTarget -= dt * 0.32;   // same slow, steady rate both ways
    this.spinTarget = clamp(this.spinTarget, -0.5, 0.5);
    if (Math.abs(vRaw) < 0.002) this.spinTarget *= 1 - Math.min(1, dt * 0.35);
    this.spin += (this.spinTarget - this.spin) * Math.min(1, dt * 1.2);
    // only during the last two glass cards (25% and 70%; card 4 starts at l = 0.57)
    const lastTwo = smoothstep(0.54, 0.6, l);
    g.rotateOnWorldAxis(SCREEN_Z, this.spin * fk * lastTwo);   // true screen-plane turn
    // index + middle straight at the same height, ring + pinky half folded (both sides); blends in from 3a's open hand
    this.hand.lerpPose(RAISED, PEACE, fk);
    this.hand.update(t);
    // out-of-focus glass fragments tumbling behind, drifting up with the scroll
    const show = smoothstep(0.08, 0.2, l);
    this.bits.forEach((b, i) => {
      const y = ((b.v.y + l * 6 + t * 0.12 * (0.5 + b.r.x) + 4.5) % 9 + 9) % 9 - 4.5;
      b.m.position.set(b.v.x, y, b.v.z);
      b.m.rotation.set(t * (0.2 + b.r.x * 0.5) + i, t * (0.15 + b.r.y * 0.4), t * 0.1 + b.r.z * 6);
      b.m.scale.setScalar(b.s);
      (b.m.material as THREE.MeshBasicMaterial).opacity = show * (0.18 + b.r.z * 0.22);
    });
  }
  dispose() { this.hand?.dispose(); super.dispose(); }
}
