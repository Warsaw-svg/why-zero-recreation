import * as THREE from 'three';
import { Scene, type Ctx } from '../core/Scene';
import { fontCss } from '../utils/text';
import { makeLockup, SERIF, type Lockup } from '../utils/lockup';
import { NOISE } from '../shaders/common';
import { buildCityscape, cityEnvironment } from '../utils/cityscape';
import { lerp, easeOutCubic, easeInOutCubic, smoothstep, clamp } from '../utils/math';

/** Bold rounded cyan glass wordmark: mask-driven shader that fakes refraction of the city beneath. */
class ZeroMark {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; w = 1; h = 1; private tex: THREE.CanvasTexture | null = null;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { tMask: { value: null }, uTime: { value: 0 }, uReveal: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform sampler2D tMask; uniform float uTime; uniform float uReveal; uniform float uOpacity; varying vec2 vUv; ${NOISE}
        void main(){
          float e = 1.-uReveal;
          vec2 uv = vUv + vec2(0., e*.02);
          float m = 0.; for(int i=0;i<6;i++){ float k=float(i)/5.; m += texture2D(tMask, uv + vec2(0.,-k*e*.12)).r * (1.-k*.7); } m/=3.4; m = clamp(m,0.,1.);
          float b = texture2D(tMask, uv, 5.0).r;       // blurred mask ~ depth
          float b2 = texture2D(tMask, uv, 3.0).r;
          vec2 g = vec2(texture2D(tMask, uv+vec2(.004,0.), 2.).r - texture2D(tMask, uv-vec2(.004,0.), 2.).r, texture2D(tMask, uv+vec2(0.,.006), 2.).r - texture2D(tMask, uv-vec2(0.,.006), 2.).r);
          vec3 n = normalize(vec3(-g*6., .5 + b*1.2));
          vec3 c1 = vec3(.32,.6,.72), c2 = vec3(.42,.58,.7), c3 = vec3(.72,.86,.9);
          vec3 base = mix(c1, c2, smoothstep(.2,1.,uv.y*.8 + .3*sin(uv.x*3.+uTime*.4)*.5)); base = mix(base, c3, smoothstep(.55,1.,uv.y));
          // refracted "city" pattern
          vec2 ru = uv*vec2(26.,9.) + n.xy*1.6;
          vec2 cell = floor(ru); float h = hash21(cell); vec2 f = fract(ru);
          float bld = step(.12, f.x)*step(f.x,.88)*step(.1,f.y)*step(f.y,.1+h*.8);
          vec3 city = mix(vec3(.75,.95,1.), vec3(.2,.55,.9), bld*.8);
          vec3 col = mix(base, city, .35);
          vec3 L = normalize(vec3(-.4,.7,.6)); float spec = pow(max(dot(reflect(-L,n), vec3(0.,0.,1.)),0.), 18.);
          float rim = pow(1.-smoothstep(.0,.6,b), 1.4);
          col += vec3(1.)*spec*.9 + vec3(.7,1.,1.)*rim*.5;
          col *= .85 + .3*b;
          float a = smoothstep(.08,.5,m) * uOpacity * smoothstep(0., .3, uReveal) * .82;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 1000; this.mesh.frustumCulled = false; this.mesh.visible = false;
  }
  build(ppu: number) {
    const size = 1.9, px = size * ppu, pad = px * 0.25;
    const g0 = document.createElement('canvas').getContext('2d')!;
    const p = { t: 'zero', f: 'round' as const, s: size, w: 700 };
    g0.font = fontCss(p, px);
    const W = Math.min(4096, Math.ceil(g0.measureText('zero').width + pad * 2)), H = Math.ceil(px * 1.5 + pad);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.font = fontCss(p, px); g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round'; g.lineWidth = px * 0.05; g.strokeStyle = '#fff';
    g.strokeText('zero', pad, px * 1.12); g.fillText('zero', pad, px * 1.12);
    this.tex?.dispose(); this.tex = new THREE.CanvasTexture(cv); this.tex.generateMipmaps = true; this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.mat.uniforms.tMask.value = this.tex; this.w = W / ppu; this.h = H / ppu;
  }
  place(x: number, y: number, scale: number) { this.mesh.position.set(x, y, 0); this.mesh.scale.set(this.w * scale, this.h * scale, 1); }
  dispose() { this.tex?.dispose(); this.mat.dispose(); this.mesh.geometry.dispose(); }
}

/**
 * Component 5a — matched to Screen Recording 9.55.37 (0–14 s). Straight out of the second TAP HOLD's white: you look down
 * through thick white cloud at the city (it shows through the gaps at the edges). Lettering in deep teal steps through
 * "Introducing" → "zero" → "where WORK gets Real" → "Real projects from companies" → "Real tools that teams use everyday" →
 * "Real skills that employers need" → "GET Hired into" → "world's most in-demand Careers", while the clouds part outward
 * and the camera settles toward the city view Component 5b starts from.
 */
const CLOUD_FRAG = /* glsl */ `
uniform float uTime; uniform float uCover; uniform float uOpen; uniform float uAspect; uniform float uSeed; uniform float uScale; uniform float uA;
varying vec2 vUv; ${NOISE}
void main(){
  vec2 q = (vUv - .5) * vec2(uAspect, 1.);
  float r = length(q);
  vec2 dir = q / max(r, .001);
  // clouds drift slowly and PART outward from the centre as you scroll
  // parting = the cloud field spreads outward (zooming past us), not smeared sideways
  vec2 p = q * uScale / (1. + uOpen * .9) + vec2(uTime * .012, uTime * .006) + uSeed;
  float n = fbm(p) * .62 + fbm(p * 2.3 + 7.1) * .38;
  float centre = 1. - smoothstep(.0, .8, length(q - vec2(.18, -.12)));   // thickest a little right of / below centre
  float tl = smoothstep(.1, .9, -q.x * .8 + q.y);                       // top-left opens first          // thickest behind the lettering, thinner toward the edges
  float th = 1. - uCover;
  float a = smoothstep(th - .05, th + .12, n + centre * .32 - smoothstep(.4, .95, r) * (.06 + uOpen * .55) - tl * uOpen * .45);   // at the start the edges stay covered too   // puffy, with clear gaps
  float sh = fbm(p * 1.4 + 3.3);
  float body = smoothstep(th, th + .35, n);
  vec3 col = mix(vec3(.87, .9, .93), vec3(1.), clamp(smoothstep(.25, .75, sh) * .6 + body * .6, 0., 1.));   // soft grey undersides, bright white tops
  gl_FragColor = vec4(col, a * uA);
}`;

type Beat = { L: Lockup; i0: number; i1: number; o0: number; o1: number; w: number; x: number; y: number };

export class SkyScene extends Scene {
  private clouds: THREE.Mesh[] = []; private cloudZ: number[] = [];
  private zero!: ZeroMark; private beats: Beat[] = [];
  constructor(ctx: Ctx) { super(ctx, 'sky', [0.905, 0.995]); this.theme = 'light'; this.fx = { bloom: 0.08, grain: 0.03, vignette: 0.08, ca: 0.05 }; this.camera.fov = 27; this.camera.far = 1200; this.camera.near = 0.5; }   // near 0.5: the cloud layers sit 0.8–1 in front of the lens
  init() {
    super.init();
    this.clouds = []; this.cloudZ = []; this.beats = [];
    this.makeBackdrop('void main(){ vec3 col = mix(vec3(.95,.98,1.), vec3(.74,.86,.95), smoothstep(.2,1.,1.-vUv.y)); gl_FragColor = vec4(col,1.); }', {});
    this.scene.fog = new THREE.Fog(0xe4f0f8, 150, 560);
    this.scene.environment = cityEnvironment(this.ctx.renderer);
    this.scene.environmentIntensity = 0.28;   // just enough for glass/metal reflections, not a second light
    // the same city Component 5b explores, seen from high above
    const city = buildCityscape(11);
    this.scene.add(city.group);
    this.scene.add(new THREE.HemisphereLight(0xeef4ff, 0xb9b3a4, 0.95));
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.7); sun.position.set(-34, 62, 28); this.scene.add(sun);
    // two cloud layers fixed in front of the lens (near one larger and faster → parallax)
    [[1.0, 2.2, 3.1], [0.8, 3.4, 9.7]].forEach(([z, sc, seed]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uCover: { value: 0.9 }, uOpen: { value: 0 }, uAspect: { value: 1 }, uSeed: { value: seed }, uScale: { value: sc }, uA: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: CLOUD_FRAG }));
      m.position.z = -z; m.renderOrder = 2 + (z < 1 ? 1 : 0); m.frustumCulled = false;   // over the city, under the lettering (10)
      this.camera.add(m); this.clouds.push(m); this.cloudZ.push(z);
    });
    this.zero = new ZeroMark(); this.ui.add(this.zero.mesh);
    // lettering: deep teal, a script capital with big serif words, set as a staggered stack (reference)
    const S = (px: number, it = false) => `${it ? 'italic ' : ''}400 ${px}px ${SERIF}`, SC = (px: number) => `400 ${px}px "Pinyon Script", cursive`;
    const mk = (draw: (g: CanvasRenderingContext2D) => void) => makeLockup((g) => { g.textAlign = 'left'; draw(g); });
    const intro = mk((g) => { g.font = SC(620); g.fillText('I', 240, 720); g.font = S(330); g.fillText('ntroducing', 520, 690); });
    const work = mk((g) => { g.font = S(190); g.fillText('where', 420, 300); const ww = g.measureText('where ').width; g.font = S(260); g.fillText('WORK', 420 + ww, 330); g.font = S(170); g.fillText('gets', 1050, 520); g.font = SC(560); g.fillText('Real', 520, 860); });
    const real = (big: string, small: string, tail: string) => mk((g) => {
      g.font = SC(520); g.fillText('Real', 360, 470);
      g.font = S(360); g.fillText(big, 700, 730); const bw = g.measureText(big).width;
      g.font = S(110); g.fillText(small, 720 + bw, 730);
      g.font = S(170); g.fillText(tail, 860, 900);
    });
    const proj = real('projects', 'from', 'companies'), tools = real('tools', 'that', 'teams use everyday'), skills = real('skills', 'that', 'employers need');
    const hired = mk((g) => { g.font = S(230); g.fillText('GET', 260, 520); g.font = SC(640); g.fillText('H', 640, 760); const hw = g.measureText('H').width; g.font = S(380); g.fillText('ired', 640 + hw * 0.92, 740); const iw = g.measureText('ired').width; g.font = S(120); g.fillText('into', 680 + hw * 0.92 + iw, 740); });
    const careers = mk((g) => { g.font = S(250); g.fillText("world's most", 300, 360); g.font = S(260); g.fillText('in-demand', 820, 590); g.font = SC(560); g.fillText('C', 420, 880); const cw = g.measureText('C').width; g.font = S(260); g.fillText('areers', 420 + cw * 0.9, 860); });
    for (const L of [intro, work, proj, tools, skills, hired, careers]) {
      const u = L.mat.uniforms;
      u.uDeep.value.set(.12, .3, .32); u.uLight.value.set(.2, .48, .5); u.uForm.value.set(.45, .78, .82);
      u.uShadowCol.value.set(.96, .98, 1); u.uEmboss.value = .08; u.uGlow.value = .45; u.uGlowCol.value.set(1, 1, 1);
      this.ui.add(L.mesh);
    }
    // k: 0 = where the TAP HOLD lands you … 1 = the city (see update)
    const B = (L: Lockup, i0: number, i1: number, o0: number, o1: number, w = 0.62, x = 0, y = 0.05) => this.beats.push({ L, i0, i1, o0, o1, w, x, y });
    B(intro, -0.06, -0.001, 0.13, 0.18, 0.6);   // fully formed where the hold lands you (k 0): it appears as the white flash clears
    B(work, 0.33, 0.38, 0.41, 0.45, 0.5);
    B(proj, 0.44, 0.49, 0.53, 0.57, 0.56);
    B(tools, 0.56, 0.61, 0.65, 0.69, 0.56);
    B(skills, 0.68, 0.73, 0.77, 0.81, 0.56);
    B(hired, 0.79, 0.825, 0.85, 0.875, 0.56);
    B(careers, 0.875, 0.905, 0.925, 0.95, 0.52);   // on full cloud; gone before the clouds dissolve
  }
  protected onResize() { this.zero?.build(Math.min(500, (this.ctx.size.h / 2) * Math.min(this.ctx.quality.dpr, 2))); }
  protected layoutText() {
    const a = this.aspect, p = this.portrait;
    const zs = Math.min(1, (a * 2 * 0.6) / this.zero.w);
    this.zero.place(0, 0.05, zs);
    for (const b of this.beats) { const w = Math.min(a * 2 * (p ? 0.95 : b.w), 2.6); b.L.mesh.scale.set(w / 2, w / 2, 1); b.L.mesh.position.set(b.x, b.y, 0); }
    // cloud layers cover the whole view at their distance
    this.clouds.forEach((m, i) => { const z = this.cloudZ[i], h = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * z * 1.15; m.scale.set(h * this.ctx.size.aspect, h, 1); (m.material as THREE.ShaderMaterial).uniforms.uAspect.value = this.ctx.size.aspect; });
  }
  enter() { this.ctx.hud.setTheme('light'); }
  exit() { this.ctx.scroll.speed = 1; this.ctx.scroll.smooth = 1; }
  update(l: number, _dt: number, t: number) {
    const ctx = this.ctx;
    // start the sequence exactly where the second TAP HOLD lands you (its scroll floor), so "Introducing" comes first
    const land = ctx.gates.get('hold2').floorAt ?? this.range[0];
    const k = clamp((ctx.scroll.progress - land) / (this.range[1] - land));
    // slower, gliding scroll through this part (reference: it takes its time); back to normal once you leave it
    const inside = ctx.scroll.progress >= land - 0.002 && ctx.scroll.progress < this.range[1];
    ctx.scroll.speed = inside ? 0.45 : 1; ctx.scroll.smooth = inside ? 0.55 : 1;
    // camera: a slow, steady zoom in toward the dome the whole time the words play (reference), ending on 5b's opening
    // view; the pointer drifts it like the other components
    const e = 1 - Math.pow(1 - k, 1.4);
    const ax = ctx.input.sx || 0, ay = ctx.input.sy || 0;
    const el = lerp(1.12, 0.65, e), d = lerp(200, 140, e), az = 0.15 + ax * 0.04 + (1 - e) * 0.12;
    this.camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d + ay * 1.5, Math.cos(az) * Math.cos(el) * d);
    this.camera.lookAt(ax * 1.5, 0, -ay * 1.5);
    // clouds: thick at first (city only at the edges), parting outward as you scroll, gone as 5b takes over
    // near-full cover at "Introducing" (small gaps). The cloud SHAPES stay almost put (just a slow drift); what changes as
    // you scroll is their opacity, so they fade away slowly and the city comes through everywhere (not shrink / pull apart)
    const cover = lerp(0.76, 0.66, smoothstep(0.0, 0.9, k));
    // reference (9.55.37 / 10.16.05): the clouds stay thick through "GET Hired" and "Careers" (only a slight thinning);
    // once the words have gone they dissolve in a soft white haze and the city + dome appear
    const fade = lerp(1, 0.9, smoothstep(0.05, 0.85, k)) * (1 - smoothstep(0.93, 0.99, k));
    this.clouds.forEach((m, i) => {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t * (1 + i * 0.6); u.uCover.value = cover * (i ? 0.85 : 1); u.uOpen.value = k * 0.2 * (1 + i * 0.5); u.uA.value = (i ? 0.75 : 1) * fade;
    });
    // lettering
    for (const b of this.beats) {
      b.L.mat.uniforms.uIn.value = easeOutCubic(smoothstep(b.i0, b.i1, k));
      b.L.mat.uniforms.uOut.value = smoothstep(b.o0, b.o1, k);
      b.L.mesh.visible = k > b.i0 && k < b.o1;
      b.L.mesh.position.x = b.x + ax * 0.03;
    }
    const eZ = easeOutCubic(smoothstep(0.17, 0.24, k)) * (1 - smoothstep(0.3, 0.35, k));
    this.zero.mat.uniforms.uReveal.value = eZ; this.zero.mat.uniforms.uTime.value = t; this.zero.mesh.visible = eZ > 0.01;
  }
  dispose() { this.ctx.scroll.speed = 1; this.ctx.scroll.smooth = 1; this.zero?.dispose(); super.dispose(); }
}
