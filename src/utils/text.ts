import * as THREE from 'three';
import { NOISE } from '../shaders/common';

export type FontKey = 'script' | 'serif' | 'mono' | 'round';
export interface Part {
  t: string;
  f: FontKey;
  /** font size in "vh units" (viewport height = 2 units) */
  s: number;
  c?: string;
  w?: number;
  ls?: number;
  italic?: boolean;
  dy?: number;
}
const FAM: Record<FontKey, string> = {
  script: '"Pinyon Script","Great Vibes",cursive',
  serif: '"Playfair Display","Cormorant Garamond",Georgia,serif',
  mono: '"JetBrains Mono",ui-monospace,monospace',
  round: '"Fredoka","Arial Rounded MT Bold",sans-serif',
};
export const fontCss = (p: Part, px: number) =>
  `${p.italic ? 'italic ' : ''}${p.w ?? (p.f === 'round' ? 700 : 400)} ${px}px ${FAM[p.f]}`;

export const TEXT_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }
`;
export const TEXT_FRAG = /* glsl */ `
uniform sampler2D tMap; uniform float uReveal; uniform vec2 uDir; uniform float uTrail; uniform float uBlur;
uniform vec3 uColor; uniform float uOpacity; uniform float uGlow; uniform vec3 uGlowColor; uniform float uTime;
uniform float uMix; varying vec2 vUv;
${NOISE}
void main(){
  float e = 1.0 - uReveal;
  vec4 acc = vec4(0.); float ws = 0.;
  for(int i=0;i<12;i++){
    float k = float(i)/11.;
    vec2 off = uDir * e * uTrail * k;
    float ang = float(i)*2.399;
    vec2 b = vec2(cos(ang), sin(ang)) * e * uBlur * (0.2 + k) ;
    float w = 1.0 - k*0.75;
    vec4 t = texture2D(tMap, vUv + off + b);
    acc += vec4(t.rgb*t.a, t.a) * w; ws += w;
  }
  acc /= ws;
  vec3 col = acc.a > 1e-4 ? acc.rgb/acc.a : vec3(0.);
  col = mix(col, col*uColor, uMix);
  float a = acc.a;
  // halo
  float halo = 0.;
  if(uGlow > 0.001){
    for(int i=0;i<10;i++){
      float ang = float(i)*0.6283; float r = 0.006 + 0.012*float(i%3);
      halo += texture2D(tMap, vUv + vec2(cos(ang),sin(ang))*r*vec2(0.6,1.)*(1.+e*3.)).a;
    }
    halo = halo/10.;
  }
  float outer = max(halo - a, 0.);
  vec3 outc = col*(1.+uGlow*0.25) + uGlowColor*outer*uGlow*1.2;
  float oa = clamp(a + outer*uGlow*0.8, 0., 1.) * uOpacity * smoothstep(0., .25, uReveal);
  gl_FragColor = vec4(outc, oa);
}
`;

export interface TextOpts {
  maxW?: number | (() => number); // vh units
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  color?: THREE.ColorRepresentation;
  glow?: number;
  glowColor?: THREE.ColorRepresentation;
}

/** A multi-font text mesh rendered through a canvas texture with blur/ghost-trail reveal shader. */
export class TextLine {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  width = 1;
  height = 1;

  private tex: THREE.CanvasTexture | null = null;
  private ppu = 400;
  constructor(public parts: Part[], public opts: TextOpts = {}) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: TEXT_VERT,
      fragmentShader: TEXT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tMap: { value: null },
        uReveal: { value: 0 },
        uDir: { value: new THREE.Vector2(0.06, 0) },
        uTrail: { value: 1 },
        uBlur: { value: 0.012 },
        uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
        uMix: { value: opts.color !== undefined ? 1 : 0 },
        uOpacity: { value: 1 },
        uGlow: { value: opts.glow ?? 0 },
        uGlowColor: { value: new THREE.Color(opts.glowColor ?? 0xffffff) },
        uTime: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.build(this.ppu);
  }
  /** (re)render the canvas. ppu = pixels per vh unit. */
  build(ppu: number, maxWIn = this.opts.maxW) {
    this.ppu = ppu;
    const maxW = typeof maxWIn === 'function' ? maxWIn() : maxWIn;
    const parts = this.parts;
    const scratch = document.createElement('canvas').getContext('2d')!;
    type Tok = { t: string; p: Part; w: number; space: boolean };
    const toks: Tok[] = [];
    for (const p of parts) {
      const px = p.s * ppu;
      scratch.font = fontCss(p, px);
      const bits = p.t.split(/( )/);
      for (const b of bits) {
        if (b === '') continue;
        const ls = (p.ls ?? 0) * px;
        const w = scratch.measureText(b).width + ls * b.length;
        // merge consecutive non-space tokens with different parts (no break between)
        toks.push({ t: b, p, w, space: b === ' ' });
      }
    }
    const maxPx = (maxW ?? 1e9) * ppu;
    type Line = { toks: Tok[]; w: number; size: number };
    const lines: Line[] = [{ toks: [], w: 0, size: 0 }];
    // group into "words" (runs of non-space tokens) to wrap on spaces only
    let i = 0;
    while (i < toks.length) {
      if (toks[i].space) {
        const l = lines[lines.length - 1];
        if (l.toks.length) { l.toks.push(toks[i]); l.w += toks[i].w; }
        i++;
        continue;
      }
      let j = i;
      let ww = 0;
      while (j < toks.length && !toks[j].space) { ww += toks[j].w; j++; }
      let l = lines[lines.length - 1];
      if (l.toks.length && l.w + ww > maxPx) {
        // trim trailing space
        if (l.toks[l.toks.length - 1].space) { l.w -= l.toks[l.toks.length - 1].w; l.toks.pop(); }
        l = { toks: [], w: 0, size: 0 };
        lines.push(l);
      }
      for (let k = i; k < j; k++) { l.toks.push(toks[k]); l.w += toks[k].w; l.size = Math.max(l.size, toks[k].p.s); }
      i = j;
    }
    const lh = this.opts.lineHeight ?? 1.18;
    const pad = Math.max(...parts.map((p) => p.s)) * ppu * 0.22;
    this.padU = pad / ppu;
    const contentW = Math.max(...lines.map((l) => l.w), 4);
    const totalH = lines.reduce((s, l) => s + l.size * ppu * lh, 0);
    const W = Math.min(4096, Math.ceil(contentW + pad * 2));
    const H = Math.min(4096, Math.ceil(totalH + pad * 2));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!;
    g.textBaseline = 'alphabetic';
    const align = this.opts.align ?? 'center';
    let y = pad;
    for (const l of lines) {
      const lhPx = l.size * ppu * lh;
      const base = y + lhPx * 0.8;
      let x = pad + (align === 'left' ? 0 : align === 'right' ? contentW - l.w : (contentW - l.w) / 2);
      for (const tk of l.toks) {
        const px = tk.p.s * ppu;
        g.font = fontCss(tk.p, px);
        g.fillStyle = tk.p.c ?? '#fff';
        const ls = (tk.p.ls ?? 0) * px;
        if (ls) {
          for (const ch of tk.t) { g.fillText(ch, x, base + (tk.p.dy ?? 0) * ppu); x += g.measureText(ch).width + ls; }
        } else {
          g.fillText(tk.t, x, base + (tk.p.dy ?? 0) * ppu);
          x += tk.w;
        }
      }
      y += lhPx;
    }
    this.tex?.dispose();
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.anisotropy = 4;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.mat.uniforms.tMap.value = this.tex;
    this.width = W / ppu;
    this.height = H / ppu;
    this.mesh.scale.set(this.width, this.height, 1);
  }
  /** Place anchor (ax,ay in 0..1) of the text box at (x,y) in vh units. */
  place(x: number, y: number, ax = 0.5, ay = 0.5, scale = 1) {
    this.mesh.scale.set(this.width * scale, this.height * scale, 1);
    this.bx = x + (0.5 - ax) * (this.width - 2 * this.padU) * scale;
    this.by = y + (0.5 - ay) * (this.height - 2 * this.padU) * scale;
    this.mesh.position.set(this.bx, this.by, 0);
  }
  bx = 0;
  by = 0;
  padU = 0;
  /** envelope e in 0..1 (0 hidden/blurred, 1 sharp). dir = motion direction (uv units). */
  set(e: number, dirX = 0.05, dirY = 0, opacity = 1, slideX = 0, slideY = 0) {
    const u = this.mat.uniforms;
    this.mesh.position.set(this.bx + slideX * (1 - e), this.by + slideY * (1 - e), 0);
    u.uReveal.value = e;
    u.uDir.value.set(dirX, dirY);
    u.uOpacity.value = opacity;
    this.mesh.visible = e > 0.002 && opacity > 0.002;
  }
  dispose() {
    this.tex?.dispose();
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}

/** Draw wrapped text onto an existing 2D context (for pane/card textures). */
export function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, align: CanvasTextAlign = 'left') {
  const words = text.split(' ');
  let line = '';
  g.textAlign = align;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) {
      g.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = t;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
}
