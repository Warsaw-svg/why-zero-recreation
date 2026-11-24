import * as THREE from 'three';
import gsap from 'gsap';
import { Scene, type Ctx } from '../core/Scene';
import { buildShards, ROT_GLSL } from '../utils/shards';
import { Hand, POSES } from '../utils/Hand';
import { TextLine } from '../utils/text';
import { NOISE } from '../shaders/common';
import { clamp, damp } from '../utils/math';
import { FrostSim } from '../core/FrostSim';

const ICE_VERT = /* glsl */ `
attribute vec3 aCenter; attribute vec4 aRand; attribute float aEdge;
uniform float uShatter; uniform vec2 uImpact;
varying vec3 vOrig; varying vec3 vN; varying vec3 vV; varying float vEdge; varying float vDist; varying float vT; varying float vRnd; varying vec3 vNo; varying vec2 vScr;
${ROT_GLSL}
void main(){
  float delay = aRand.w * 0.45;
  float t = max(0., uShatter - delay);
  vT = t; vDist = aRand.w; vEdge = aEdge; vRnd = aRand.x; vOrig = position; vNo = normal;
  vec3 p = position - aCenter;
  vec3 axis = vec3(aRand.y-.5, aRand.z-.5, aRand.x-.5) + 0.001;
  float ang = t * (1.2 + aRand.x*4.5);
  p = rotAx(p, axis, ang);
  vec3 n = rotAx(normal, axis, ang);
  vec2 od = aCenter.xy - uImpact; od = normalize(od + 1e-3);
  vec3 vel = vec3(od * (0.8 + aRand.y*2.8), 0.);
  vec3 c = aCenter + vec3(vel.xy * t, 0.) + vec3(0., -t*t*0.25, t*t*(1.4 + aRand.z*3.2) + t*(0.6+aRand.y));
  vec4 mv = modelViewMatrix * vec4(c + p, 1.);
  vN = normalize(normalMatrix * n); vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  vScr = gl_Position.xy / gl_Position.w * .5 + .5;
}`;
/** One-time bake of the still ice look (frost, bubbles, scratches) + a noise channel, in ice-plane space. Keeps the per-frame shader cheap. */
const BAKE_FRAG = /* glsl */ `
uniform vec2 uPlane;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 q = (vUv - .5) * uPlane;                                      // same space as the ice mesh's vOrig.xy
  vec2 w = q + 0.45*vec2(fbm(q*1.1+3.), fbm(q*1.1+9.));
  float body = fbm(w*1.5);
  float frost = fbm(w*5.0 + 2.);
  vec3 deep = vec3(0.27,0.50,0.44), mid = vec3(0.44,0.67,0.60), light = vec3(0.80,0.94,0.89);
  vec3 col = mix(deep, mid, smoothstep(.2,.7,body));
  col = mix(col, light, smoothstep(.55,.95,frost*.55+body*.55)*.75);
  col += smoothstep(.72,.9,vnoise(w*14.)) * .08;
  float scr = 0.;
  for(int i=0;i<4;i++){
    float ang = .35 + float(i)*1.57 + (i==2 ? .4 : 0.);
    vec2 d = vec2(cos(ang), sin(ang)); vec2 n2 = vec2(-d.y, d.x);
    float across = dot(w, n2)*(5.5 + float(i)*1.7) + fbm(w*2.5 + float(i)*7.)*1.6;
    float cell = floor(across);
    float on = step(.7, hash21(vec2(cell, float(i)*13.1)));
    float len = smoothstep(.5,.72, fbm(vec2(dot(w, d)*1.3, cell*.37 + float(i))));
    scr += on * len * (1. - smoothstep(0., .035, abs(fract(across)-.5)));
  }
  col = mix(col, vec3(.93,1.,.97), clamp(scr,0.,1.)*.5);
  col += (hash21(floor(q*120.)) - .5) * 0.035;
  float n = fbm(q*2.8 + 7.) * .62 + fbm(q*7.6 - 3.) * .38;          // static noise: frost erosion, reveal edge, word tears
  gl_FragColor = vec4(col, n);
}`;
const ICE_FRAG = /* glsl */ `
uniform float uCrack; uniform vec2 uMouse; uniform float uTime; uniform float uAlpha; uniform sampler2D tMask; uniform float uMaskOn; uniform float uAsp; uniform float uLoad;
uniform sampler2D tIce; uniform vec2 uPlane; uniform sampler2D tWord; uniform float uWord;
uniform vec2 uZc; uniform float uZr; uniform float uExpand; uniform float uOrb; uniform float uWhite;
varying vec3 vOrig; varying vec3 vN; varying vec3 vV; varying float vEdge; varying float vDist; varying float vT; varying float vRnd; varying vec3 vNo; varying vec2 vScr;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(vV);
  if(!gl_FrontFacing) N = -N;
  vec2 iuv = (vOrig.xy + uMouse*0.15) / uPlane + .5;
  vec4 ib = texture2D(tIce, iuv);
  vec3 col = ib.rgb * 1.12; float nT = ib.a;                     // lighter sage frost, like the reference
  vec3 light = vec3(0.80,0.95,0.90);
  // fracture lines only appear as the crack spreads out from the impact point
  float reach = smoothstep(vDist - 0.3, vDist + 0.05, uCrack * 1.5) * step(0.001, uCrack);
  float border = 1. - smoothstep(0., 0.012 + 0.03*reach, vEdge + (nT-.5)*0.02);
  float crack = border * reach;
  float fres = pow(1. - max(dot(N,V),0.), 2.5);
  vec3 L = normalize(vec3(-.4,.7,.6));
  float spec = pow(max(dot(reflect(-L,N),V),0.), 28.);
  col += light * fres * .3 + spec * .2;
  col = mix(col, vec3(1.), crack * (0.55 + 0.45*uCrack));
  float sheen = smoothstep(.0,.5, sin((vOrig.x*0.8 + vOrig.y*0.5 + uMouse.x*0.6)*3.0)*.5+.5);
  col += sheen * 0.035;
  // ---- glass response once a shard has broken free
  float broken = smoothstep(0., .35, vT);
  float side = 1. - step(.5, abs(vNo.z));
  vec3 R = normalize(reflect(-V, N));
  vec3 envc = mix(vec3(.04,.2,.18), vec3(.8,.98,.95), smoothstep(-.4,.9,R.y));
  float box1 = smoothstep(.80,.88, dot(R, normalize(vec3(-.5,.7,.5))));
  float box2 = smoothstep(.90,.96, dot(R, normalize(vec3(.7,.25,.7))));
  float rimF = pow(1. - max(dot(N,V),0.), 3.);
  vec3 glass = mix(col*.55, envc, .25 + rimF*.6) + (box1 + box2*.7) * vec3(1.,1.,.97) * .9;
  glass += side * vec3(.55,1.,.9) * (.55 + .35*sin(vRnd*40. + vT*6.));
  glass += vec3(.10,.0,-.04) * rimF + vec3(-.04,.02,.1) * pow(rimF,2.);
  col = mix(col, glass, broken);
  // thin frost: the hand underneath reads clearly through it
  float a = (0.44 + crack*0.4) * uAlpha * (1. - smoothstep(0.9, 2.0, vT));
  a = mix(a, (0.28 + rimF*.55 + side*.6 + (box1+box2)*.4) * uAlpha * (1. - smoothstep(0.9, 2.0, vT)), broken);
  // the "zero" word is part of the ice: frosty white letters with torn holes (wiping the frost wipes the word too)
  float wd = texture2D(tWord, vScr).a * uWord;
  wd *= smoothstep(.34, .46, nT + (texture2D(tIce, iuv * 3.1 + .3).a - .5) * .55);
  col = mix(col, vec3(.92, .95, .94), wd * .93);
  a = max(a, wd * .92);
  // wiped frost: stamp -> white blob -> dark clear hole with a bright rim -> ragged refreeze -> soft glow spots
  vec2 mk = texture2D(tMask, vScr).rg * uMaskOn;
  // after the zero: the cleared window grows outward from the zero's centre (rim + ragged edge come from the hole logic below)
  float zdist = length((vScr - uZc) * vec2(uAsp, 1.));
  float zR = mix(uZr, 2.1, uExpand);
  mk.r = max(mk.r, step(.0001, uExpand) * smoothstep(zR + .03, zR - .03, zdist));
  // fine, frosty raggedness on the hole edge (cheap screen-space value noise, two octaves)
  vec2 rq = vScr * vec2(uAsp, 1.) * 48.;
  vec2 ri = floor(rq), rf = fract(rq); rf = rf * rf * (3. - 2. * rf);
  float h00 = fract(sin(dot(ri, vec2(127.1, 311.7))) * 43758.55), h10 = fract(sin(dot(ri + vec2(1, 0), vec2(127.1, 311.7))) * 43758.55);
  float h01 = fract(sin(dot(ri + vec2(0, 1), vec2(127.1, 311.7))) * 43758.55), h11 = fract(sin(dot(ri + vec2(1, 1), vec2(127.1, 311.7))) * 43758.55);
  float vnF = mix(mix(h00, h10, rf.x), mix(h01, h11, rf.x), rf.y);
  float tt = mk.r - ((nT - .5) * 1.05 + (vnF - .5) * .5 * (1. - smoothstep(.55, .95, mk.r))) * smoothstep(0., .12, mk.r);   // ragged near the edge only, and only where wiped
  float hole = smoothstep(.38, .46, tt);
  float wpx = fwidth(tt) + .0008;
  float rimLine = 1. - smoothstep(0., 7. * wpx, abs(tt - .42));    // thick bright rim, like the reference holes
  float rimGlow = 1. - smoothstep(0., 22. * wpx, abs(tt - .42));
  float rim = clamp(rimLine + rimGlow * .7, 0., 1.);
  float fresh = mk.g * smoothstep(.2, .45, mk.r);
  float bloom = smoothstep(.0, .35, mk.r) * (1. - hole);
  col = mix(col, vec3(.97, 1., .99), clamp(rim * 1.1 + bloom * .22, 0., 1.));
  a = mix(a, .04, hole);
  a = max(a, clamp(rim * 1.2 + bloom * .2, 0., 1.));
  col = mix(col, vec3(1.), fresh);
  a = max(a, fresh);
  // loading reveal: the ice frosts in from the top edge as the countdown falls; bright high-contrast leading band
  float rvN = texture2D(tIce, iuv * .7 + .15).a;
  float rv = uLoad * 1.22 - (1. - vScr.y) + (rvN - .5) * .5;
  float shownIce = smoothstep(0., .05, rv);
  float front = smoothstep(0., .035, rv) * (1. - smoothstep(.05, .3, rv));
  float hi = smoothstep(.6, .85, dot(ib.rgb, vec3(.333)));
  col = mix(col, mix(vec3(.16, .42, .35), vec3(.80, .99, .90), hi), front * .92);
  a = mix(a, max(a, .95), front);
  a *= shownIce;
  a *= mix(1. - side, 1., broken);   // shard thickness walls stay invisible until a shard breaks free (applied last, so the wipe can't light them up)
  float orb = step(.0001, uOrb) * exp(-pow(zdist / max(uOrb, .001), 2.));   // soft white light growing in the hole
  col = mix(col, vec3(1.), orb); a = max(a, orb * uAlpha);
  col = mix(col, vec3(1.), uWhite); a = mix(a, uAlpha, uWhite);            // everything floods white
  gl_FragColor = vec4(col, a);
}`;

/** intro-only pointing pose (the Component 2 hands use their own poses) */
const INTRO_POINT = { index: 0.0, middle: 0.86, ring: 0.92, pinky: 0.96, thumb: 0.28, spread: 0.3, thumbIn: 0.2 };   // thumb held a little apart from the folded fingers (lower left), like the reference
export class IntroScene extends Scene {
  private ice!: THREE.Mesh;
  private iceMat!: THREE.ShaderMaterial;
  private backMat!: THREE.ShaderMaterial;
  private hand!: Hand;
  private counter!: TextLine;
  private hint!: TextLine;
  private trailCv = document.getElementById('trail') as HTMLCanvasElement;
  private tg = this.trailCv.getContext('2d')!;
  private pts: Array<{ x: number; y: number; t: number }> = [];
  private drawing = false;
  private cover = 0;
  private ringP = 0;
  private solved = false;
  private shatterObj = { v: 0, crack: 0, alpha: 1 };
  private creakT = 0;
  private offs: Array<() => void> = [];
  private glitchT = 0;
  /** GPU frost sim: stamps wipe the ice, it refreezes slowly with ragged edges */
  private frost!: FrostSim;
  private readonly DAB = 0.058; // brush radius, in viewport-height units
  private fadedHint = false;
  private shownWord = false;
  private domWordGone = false;
  private lastSimMs = 0;
  private bakeRT: THREE.WebGLRenderTarget | null = null;
  private wordCv = document.createElement('canvas');
  private wordTex = new THREE.CanvasTexture(this.wordCv);
  private numCv = document.createElement('canvas');
  private numTex = new THREE.CanvasTexture(this.numCv);
  private lastNum = -1;
  private cur = { x: innerWidth * 0.5, y: innerHeight * 0.62 };
  private tipTmp = new THREE.Vector3();

  constructor(ctx: Ctx) {
    super(ctx, 'intro', [0, 0.07]);
    this.overlay = true;
    this.layer = 10;
    this.fx = { bloom: 0.35, grain: 0.07, vignette: 0.35, ca: 0 };
    this.theme = 'dark';
    this.camera.position.set(0, 0, 6);
  }
  init() {
    super.init();
    this.backMat = this.makeBackdrop(/* glsl */ `
      uniform float uAlphaB; uniform float uLoad; uniform float uBackMix; uniform sampler2D tNum; uniform float uNumOn;
      void main(){
        vec2 p = vUv; float f = fbm(p*3. + uTime*.03);
        vec3 a = vec3(.03,.17,.16), b = vec3(.12,.42,.38);
        vec3 col = mix(a, b, smoothstep(0.,1., p.y*.7 + f*.5 - .1));
        col += vec3(.1,.3,.25) * pow(1.-length(p-vec2(.5,.35)), 3.) * .6;
        // loader look (matches the DOM preloader gradient) fades out as the load finishes
        vec2 q = (vUv - vec2(.5, -.18)) / vec2(.85, .70); float rr = length(q);
        vec3 g = mix(vec3(.827,.957,.902), vec3(.525,.788,.682), smoothstep(0.,.24,rr));
        g = mix(g, vec3(.247,.604,.502), smoothstep(.24,.5,rr));
        g = mix(g, vec3(.153,.416,.333), smoothstep(.5,.78,rr));
        g = mix(g, vec3(.114,.353,.282), smoothstep(.78,1.,rr));
        col = mix(g, col, uBackMix);   // loader green + bottom glow stays until the frost has covered it
        // countdown number: sits below the frost; occasional horizontal tear bands while counting
        float band = floor(vUv.y * 46.); float fr = floor(uTime * 14.);
        float jit = step(.9, hash21(vec2(band, fr))) * (hash21(vec2(band * 1.7, fr + 3.)) - .5) * .035;
        float nm = texture2D(tNum, vec2(vUv.x + jit, vUv.y)).a * uNumOn;
        col = mix(col, vec3(1.), nm);
        gl_FragColor = vec4(col, uAlphaB);
      }`, { uAlphaB: { value: 1 }, uLoad: { value: 0 }, uBackMix: { value: 0 }, tNum: { value: this.numTex }, uNumOn: { value: 1 } });
    this.backMat.transparent = true;
    // matched to coponent1.mov: a compact fist (about a fifth of the screen wide) with a long, slim index reaching up to
    // the cursor; the three folded fingers are tight rounded lumps and the thumb tucks in (no sprawling palm/thumb)
    this.hand = new Hand('lime', 0x7bd44a, 2.55);
    this.hand.setPose(INTRO_POINT);
    this.hand.mat.uniforms.uInflate.value = 0.0018;   // slimmer fingers (the clay inflate made them stubby)
    this.hand.showBack(false); // palm side faces us: like someone pointing AT you (folded fingers curl toward the viewer)
    // the hand lives UNDER the ice: a soft frosted green through the frost, crisp and vivid where the frost is wiped away
    this.hand.group.position.set(0.9, -4.2, -1.3);
    this.hand.group.rotation.set(0.1, -0.25, 0.12);
    this.scene.add(this.hand.group);
    this.frost = new FrostSim(this.ctx.renderer);
    this.frost.resize(this.ctx.size.aspect);
    this.buildIce();
    // 99 counter (glitchy) + hint
    this.counter = this.addText(new TextLine([{ t: 'zero', f: 'round', s: 0.6, c: '#f1f1ec' }], { glow: 0.12, glowColor: '#7fffd8' }));
    this.hint = this.addText(new TextLine([{ t: 'USE A FINGER, MOUSE OR PEN', f: 'mono', s: 0.045, c: '#d9fff3', ls: 0.12 }]));
    this.counter.mat.uniforms.uOpacity.value = 0; this.hint.mat.uniforms.uOpacity.value = 0;
    const input = this.ctx.input;
    this.offs.push(input.onDown((e) => this.down(e)), input.onMove(() => this.move()), input.onUp(() => this.up()));
    this.ctx.hud.setCursorGate(true);
  }
  private buildIce() {
    this.ice?.geometry.dispose();
    const h = 2 * 6 * Math.tan(THREE.MathUtils.degToRad(22.5));
    const w = h * Math.max(this.ctx.size.aspect, 0.5) * 1.2;
    const geo = buildShards(w, h * 1.2, this.ctx.quality.tier === 'low' ? 70 : 120, 7, 0.06, new THREE.Vector2(0, 0));
    if (!this.iceMat) {
      this.iceMat = new THREE.ShaderMaterial({
        vertexShader: ICE_VERT, fragmentShader: ICE_FRAG, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, // overlay: the frost always covers the hand, even where curled fingers come closer than the ice plane
        uniforms: {
          uZc: { value: new THREE.Vector2(.5, .5) }, uZr: { value: .2 }, uExpand: { value: 0 }, uOrb: { value: 0 }, uWhite: { value: 0 },
          uShatter: { value: 0 }, uImpact: { value: new THREE.Vector2() }, uCrack: { value: 0 }, uMouse: { value: new THREE.Vector2() }, uTime: { value: 0 }, uAlpha: { value: 1 },
          tMask: { value: this.frost.texture }, uAsp: { value: 1.6 }, uLoad: { value: 0 }, uMaskOn: { value: 1 },
          tIce: { value: null }, uPlane: { value: new THREE.Vector2(w, h * 1.2) }, tWord: { value: this.wordTex }, uWord: { value: 0 },
        },
      });
    }
    this.bakeIce(w, h * 1.2);
    this.drawWord();
    if (!this.ice) { this.ice = new THREE.Mesh(geo, this.iceMat); this.ice.frustumCulled = false; this.ice.renderOrder = 1; this.scene.add(this.ice); } // ice draws after the hand, so the frost is over it
    else this.ice.geometry = geo;
  }
  /** render the still ice pattern once into a texture (re-baked on resize) so the live shader stays cheap */
  private bakeIce(pw: number, ph: number) {
    const r = this.ctx.renderer;
    this.bakeRT?.dispose();
    const W = 1024, H = Math.max(256, Math.round(1024 * ph / pw));
    this.bakeRT = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    const mat = new THREE.ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: BAKE_FRAG, uniforms: { uPlane: { value: new THREE.Vector2(pw, ph) } }, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(quad);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.bakeRT); r.render(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); r.setRenderTarget(prev);
    quad.geometry.dispose(); mat.dispose();
    this.iceMat.uniforms.tIce.value = this.bakeRT.texture;
    this.iceMat.uniforms.uPlane.value.set(pw, ph);
  }
  /** loader number, same spot/size as the DOM counter it replaces */
  private drawNum(n: number) {
    const cv = this.numCv, W = Math.max(2, Math.round(innerWidth / 2)), H = Math.max(2, Math.round(innerHeight / 2));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    if (n > 0) { g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'; g.font = `700 ${Math.round(H * 0.135)}px Fredoka, "Arial Rounded MT Bold", sans-serif`; g.fillText(String(n), W * 0.022, H * 0.97); }
    this.numTex.needsUpdate = true;
    this.lastNum = n;
  }
  /** the big "zero" word, drawn where the loader's DOM word sits; the ice shader frosts + tears it */
  private drawWord() {
    const cv = this.wordCv, W = Math.max(2, Math.round(innerWidth / 2)), H = Math.max(2, Math.round(innerHeight / 2));
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
    g.font = `700 ${Math.round(Math.min(H * 0.24, W * 0.3))}px Fredoka, "Arial Rounded MT Bold", sans-serif`;   // portrait: also fits the width
    g.fillText('zero', W * 0.005, H * 0.99);
    this.wordTex.needsUpdate = true;
  }
  protected onResize() { if (this.inited) { this.frost.resize(this.ctx.size.aspect); this.buildIce(); } }
  /** one soft round dab at the pointer (stamped per pointer event, so fast strokes read as beads) */
  private paint(a: { x: number; y: number }, b: { x: number; y: number }) {
    // like the reference: a round, slightly irregular dab at each pointer sample. Close samples (slow strokes) are
    // bridged so the wipe stays connected; far-apart samples (fast strokes) stay as separate beads, never straight bars.
    const R = this.DAB * innerHeight, d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = d < R * 1.7 ? Math.max(1, Math.ceil(d / (R * 0.8))) : 1;   // dabs ~0.8R apart: connected, but each dab's scallop still shows
    for (let i = 1; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
      const jit = R * 0.12;
      this.frost.stamp((x + (Math.random() - 0.5) * jit) / innerWidth, 1 - (y + (Math.random() - 0.5) * jit) / innerHeight, this.DAB * (0.82 + Math.random() * 0.36));
    }
  }
  protected layoutText() {
    const a = this.aspect;
    const sc = this.portrait ? 0.62 : 1;
    this.counter.place(-a + 0.12, -1 + 0.06, 0, 0, sc);
    this.hint.place(0, -0.78, 0.5, 0.5, this.portrait ? 0.75 : 1);
  }
  enter() { this.ctx.hud.setTheme('dark'); this.ctx.hud.showMenuBtn(false); }
  exit() { this.ctx.hud.setCursorGate(false); }

  private down(e: PointerEvent) {
    if (this.solved || !this.active || !this.ctx.global.ready) return;
    this.ctx.audio.unlock();
    this.ctx.hud.hideHint();
    this.drawing = true;
    this.pts = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    this.cover = 0;
    this.cur.x = e.clientX; this.cur.y = e.clientY;
    if (!this.domWordGone) { this.domWordGone = true; gsap.to(this.iceMat.uniforms.uWord, { value: 0, duration: 1.2 }); }
    if (!this.fadedHint) { this.fadedHint = true; gsap.to(this.counter.mat.uniforms.uOpacity, { value: 0, duration: 1.2 }); }
    this.paint({ x: e.clientX, y: e.clientY }, { x: e.clientX + 0.01, y: e.clientY });
  }
  private move() {
    const i = this.ctx.input;
    this.cur.x = i.x; this.cur.y = i.y;
    if (this.ctx.global.ready && !this.domWordGone && this.shownWord) { this.domWordGone = true; gsap.to(this.iceMat.uniforms.uWord, { value: 0, duration: 1.2, delay: 0.4 }); }
    if (!this.drawing || this.solved) return;
    const last = this.pts[this.pts.length - 1];
    if (Math.hypot(i.x - last.x, i.y - last.y) < 3) return;
    this.paint(last, { x: i.x, y: i.y });
    this.pts.push({ x: i.x, y: i.y, t: performance.now() });
    this.evaluate();
    if (this.creakT <= 0) { this.ctx.audio.play('creak', 0.35, 0.9 + Math.random() * 0.3); this.creakT = 0.5; }
  }
  private up() {
    if (!this.drawing) return;
    this.drawing = false;
    if (!this.solved) this.cover = 0;
  }
  /** angular coverage around stroke centroid, plus roundness */
  private evaluate() {
    const p = this.pts;
    if (p.length < 12) return;
    let cx = 0, cy = 0;
    for (const q of p) { cx += q.x; cy += q.y; }
    cx /= p.length; cy /= p.length;
    let total = 0, prev = Math.atan2(p[0].y - cy, p[0].x - cx);
    let mean = 0; const rs: number[] = [];
    for (const q of p) {
      const a = Math.atan2(q.y - cy, q.x - cx);
      let d = a - prev;
      if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      total += d; prev = a;
      const r = Math.hypot(q.x - cx, q.y - cy); rs.push(r); mean += r;
    }
    mean /= p.length;
    let varr = 0; for (const r of rs) varr += (r - mean) ** 2;
    const rel = Math.sqrt(varr / p.length) / (mean || 1);
    const minR = Math.min(innerWidth, innerHeight) * 0.07;
    const deg = Math.abs(total) * 180 / Math.PI;
    const roundOK = rel < 0.18 && mean > minR && this.maxTurnDeg(mean) < 58;
    this.cover = roundOK ? clamp(deg / 330) : clamp(deg / 330) * 0.6;
    if (deg >= 330 && roundOK) this.solve(cx, cy);
  }
  /** sharpest direction change along the stroke (degrees) on an arc-length resample: a circle stays low, triangle/square corners spike */
  private maxTurnDeg(meanR: number) {
    const p = this.pts; if (p.length < 8) return 0;
    const step = Math.max(6, (2 * Math.PI * meanR) / 48);
    const rs: Array<[number, number]> = [[p[0].x, p[0].y]];
    let acc = 0, px = p[0].x, py = p[0].y;
    for (const q of p) { acc += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y; if (acc >= step) { rs.push([q.x, q.y]); acc = 0; } }
    const k = 2; let worst = 0;
    for (let i = k; i < rs.length - k; i++) {
      const ax = rs[i][0] - rs[i - k][0], ay = rs[i][1] - rs[i - k][1], bx = rs[i + k][0] - rs[i][0], by = rs[i + k][1] - rs[i][1];
      const t = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI;
      if (t > worst) worst = t;
    }
    return worst;
  }
  /** the zero you drew becomes a clear window: one big stamp over its interior, and the frost stops refreezing */
  private clearZeroShape() {
    const n = this.pts.length || 1; let cx = 0, cy = 0;
    for (const q of this.pts) { cx += q.x; cy += q.y; } cx /= n; cy /= n;
    let r = 0; for (const q of this.pts) r += Math.hypot(q.x - cx, q.y - cy); r /= n;
    this.frost.stamp(cx / innerWidth, 1 - cy / innerHeight, (r / innerHeight) * 1.04);
    this.frost.decay = 0;
  }
  /** solved: the zero's window grows into a white bloom, a gold star spins in with "+100 XP", then hand-off to "You Believed" */
  private solve(cx: number, cy: number) {
    if (this.solved) return;
    this.solved = true;
    this.drawing = false;
    this.cover = 1;
    const ctx = this.ctx;
    ctx.gates.solve('intro');
    ctx.scroll.suspend = true;                      // the sequence plays out before the story can move on
    this.clearZeroShape();
    const u = this.iceMat.uniforms;
    let mr = 0; for (const q of this.pts) mr += Math.hypot(q.x - cx, q.y - cy); mr /= Math.max(1, this.pts.length);
    u.uZc.value.set(cx / innerWidth, 1 - cy / innerHeight);
    u.uZr.value = Math.max(0.05, mr / innerHeight);
    gsap.to([this.counter.mat.uniforms.uOpacity, this.hint.mat.uniforms.uOpacity], { value: 0, duration: 0.6 });
    gsap.to(u.uWord, { value: 0, duration: 0.4 });
    ctx.audio.play('whoosh', 0.8);
    gsap.timeline()
      .to(u.uExpand, { value: 1, duration: 0.95, ease: 'power2.in' }, 0.15)
      .to(u.uOrb, { value: 0.28, duration: 0.6, ease: 'power1.in' }, 0.4)
      .to(u.uWhite, { value: 1, duration: 0.3, ease: 'power1.in' }, 0.85)
      .add(() => this.showStar(), 1.0)
      .add(() => {                                   // screen is fully white: swap the GL ice for a plain white sheet and retire the intro
        const w = document.createElement('div'); w.id = 'solveWhite'; document.body.appendChild(w); this.whiteEl = w;
        this.disabled = true;
      }, 1.2)
      .add(() => this.endIntro(), 3.8);
  }
  private starEl: HTMLElement | null = null;
  private whiteEl: HTMLElement | null = null;
  /** gold star spins in (edge-on flips) and shrinks, then "+100 XP" scrambles in under it */
  private showStar() {
    const el = document.createElement('div'); el.id = 'solveStar';
    el.innerHTML = `<div class="halo"></div><svg class="st" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".55" stop-color="#f6c945"/><stop offset="1" stop-color="#e3a53a"/></linearGradient></defs><path d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 17 7.1 12.7 1.5 12 7.1 11.4 11.4 7.1 12 1.5z" fill="url(#sg)"/></svg><div class="xp">+ 100 XP</div>`;
    document.body.appendChild(el);
    this.starEl = el;
    const st = el.querySelector('.st') as SVGElement, xp = el.querySelector('.xp') as HTMLElement, halo = el.querySelector('.halo') as HTMLElement;
    this.ctx.audio.play('ding', 0.9);
    gsap.fromTo(st, { scale: 2.6, rotateY: 0, opacity: 0 }, { scale: 1, rotateY: 720, opacity: 1, duration: 0.6, ease: 'power2.out' });
    gsap.fromTo(halo, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.8, delay: 0.2 });
    gsap.fromTo(xp, { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.6, delay: 0.5 });
    // the number counts up steadily 0 → 100 (never overshoots), then holds
    const cnt = { v: 0 };
    xp.textContent = '+ 0 XP';
    gsap.to(cnt, { v: 100, duration: 0.6, delay: 0.5, ease: 'power1.out', onUpdate: () => { xp.textContent = '+ ' + Math.round(cnt.v) + ' XP'; } });
    gsap.to(xp, { opacity: 0, duration: 0.3, delay: 2.6 });
  }
  /** hand-off: HUD in, XP counts up, white bloom fades to the next scene, star fades */
  private endIntro() {
    const ctx = this.ctx;
    ctx.hud.reveal();
    ctx.hud.addXP(100);
    const w = this.whiteEl;
    if (w) gsap.to(w, { opacity: 0, duration: 0.7, ease: 'power1.inOut', onComplete: () => { w.remove(); this.whiteEl = null; ctx.scroll.suspend = false; } });
    else ctx.scroll.suspend = false;
    const el = this.starEl;
    if (el) gsap.to(el, { opacity: 0, duration: 0.5, delay: 0.25, onComplete: () => { el.remove(); this.starEl = null; } });
  }

  update(_l: number, dt: number, t: number) {
    const ctx = this.ctx;
    this.creakT -= dt;
    const u = this.iceMat.uniforms;
    u.uTime.value = t;
    u.uShatter.value = this.shatterObj.v;
    u.uCrack.value = this.shatterObj.crack;
    if (!Number.isFinite(u.uMouse.value.x) || !Number.isFinite(u.uMouse.value.y)) u.uMouse.value.set(0, 0);
    u.uMouse.value.set(damp(u.uMouse.value.x, ctx.input.sx || 0, 4, dt), damp(u.uMouse.value.y, ctx.input.sy || 0, 4, dt));
    this.backMat.uniforms.uTime.value = t;
    // the sim runs on real elapsed time, not the clamped frame dt, so refreezing takes the same seconds at any frame rate
    const nowMs = performance.now(); const simDt = Math.min(0.5, (nowMs - (this.lastSimMs || nowMs)) / 1000); this.lastSimMs = nowMs;
    this.frost.step(simDt);
    // loader hand-off: ice reveal follows the real load; once ready, the word/hint fade in (the DOM counter fades out)
    u.uLoad.value = ctx.global.load; this.backMat.uniforms.uLoad.value = ctx.global.load;
    const num = ctx.global.ready ? 0 : Math.max(1, Math.round(99 * (1 - ctx.global.load)));
    if (num !== this.lastNum) this.drawNum(num);
    this.backMat.uniforms.uNumOn.value = ctx.global.ready ? 0 : 1;
    this.hand.group.visible = ctx.global.ready;
    if (!this.shownWord && ctx.global.ready) {
      this.shownWord = true;
      u.uWord.value = 1;                                              // the word is now IN the ice...
      document.getElementById('preloader')?.classList.add('handoff'); // ...and the DOM copy disappears at the same moment (one word, never two)
      gsap.to(this.backMat.uniforms.uBackMix, { value: 1, duration: 1.6 });
      gsap.to(this.hint.mat.uniforms.uOpacity, { value: 1, duration: 0.8, delay: 0.6 });
    }
    u.tMask.value = this.frost.texture; u.uAsp.value = ctx.size.aspect;
    // the hand sits under the ice with its pointing finger tracking the cursor
    if (!this.solved) {
      const halfH = 7.3 * Math.tan(THREE.MathUtils.degToRad(22.5));
      const nx = (this.cur.x / innerWidth) * 2 - 1, ny = -((this.cur.y / innerHeight) * 2 - 1);
      const hg = this.hand.group;
      this.hand.tipWorld(this.tipTmp);
      const k = Math.min(1, dt * 2.4);
      hg.position.x += (nx * halfH * ctx.size.aspect - this.tipTmp.x) * k;
      hg.position.y += (ny * halfH - this.tipTmp.y) * k;
      // the hand points AT the cursor: aim the index from a pivot low on the screen, then slide so the fingertip reaches it
      const tx = nx * halfH * ctx.size.aspect, ty = ny * halfH;
      const px = tx * 0.15 + halfH * ctx.size.aspect * 0.35, py = -halfH * 1.3;   // pivot low and right of centre: the forearm comes in diagonally
      const aim = Math.atan2(tx - px, ty - py);            // 0 = straight up
      hg.rotation.z = damp(hg.rotation.z, -aim, 3, dt);
    }
    this.hand.update(t);
    // glitchy 99
    this.glitchT -= dt;
    if (this.glitchT <= 0) { this.glitchT = 0.05 + Math.random() * 0.25; this.glitchJ = Math.random() < 0.3; }
    const gl = this.glitchJ;
    this.counter.set(gl ? 0.86 : 1, gl ? (Math.random() - 0.5) * 0.25 : 0.02, gl ? (Math.random() - 0.5) * 0.05 : 0, this.counter.mat.uniforms.uOpacity.value);
    this.hint.set(1, 0, 0, this.hint.mat.uniforms.uOpacity.value * (0.5 + 0.5 * Math.sin(t * 2)));
    // ring + trail
    this.ringP = damp(this.ringP, this.cover, 14, dt);
    if (!this.solved && ctx.global.ready && !this.drawing) ctx.hud.ring(true, innerWidth / 2, innerHeight / 2, 0, 'DRAW A ZERO', true); // idle prompt only: hidden while drawing
    else ctx.hud.ring(false);
    this.drawTrail();
  }
  private glitchJ = false;
  private drawTrail() {
    const cv = this.trailCv, g = this.tg;
    if (cv.width !== innerWidth * 1 || cv.height !== innerHeight * 1) { cv.width = innerWidth; cv.height = innerHeight; }
    g.clearRect(0, 0, cv.width, cv.height);
    const now = performance.now();
    if (!this.drawing) this.pts = this.pts.filter((p) => now - p.t < 500);
    return; // no drawn line: the reference only shows the wiped holes in the frost
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [w, a, blur] of [[10, 0.25, 18], [4, 0.95, 8]] as const) {
      g.shadowColor = '#bffff0'; g.shadowBlur = blur;
      g.strokeStyle = `rgba(235,255,250,${a})`; g.lineWidth = w;
      g.beginPath();
      this.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    }
  }
  exitCleanup() {}
  dispose() {
    this.offs.forEach((f) => f());
    this.offs = [];
    this.tg.clearRect(0, 0, this.trailCv.width, this.trailCv.height);
    this.ctx.hud.ring(false);
    this.hand?.dispose();
    this.frost?.dispose();
    this.bakeRT?.dispose(); this.wordTex.dispose(); this.numTex.dispose();
    this.iceMat?.dispose();
    super.dispose();
  }
}
