import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { NOISE } from '../shaders/common';
import type { Active } from './Timeline';
import type { Quality } from './Quality';
import type { FX } from './Scene';

class ScenesPass extends Pass {
  list: Active[] = [];
  private tmp: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  constructor(w: number, h: number, private q: Quality) {
    super();
    this.needsSwap = true;
    this.tmp = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q.msaa });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, uOpacity: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
      fragmentShader: 'uniform sampler2D tMap; uniform float uOpacity; varying vec2 vUv; void main(){ vec4 c=texture2D(tMap,vUv); gl_FragColor=vec4(c.rgb, c.a*uOpacity); }',
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w: number, h: number) { this.tmp.setSize(w, h); }
  setMsaa(n: number) { this.tmp.samples = n; }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(writeBuffer);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    this.list.forEach((a, i) => {
      const s = a.scene;
      if (i === 0 && a.opacity >= 0.999) {
        renderer.setRenderTarget(writeBuffer);
        if (s.post) s.post.render(renderer, writeBuffer); else renderer.render(s.scene, s.camera);
      } else {
        renderer.setRenderTarget(this.tmp);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        if (s.post) s.post.render(renderer, this.tmp); else renderer.render(s.scene, s.camera);
        renderer.setRenderTarget(writeBuffer);
        this.mat.uniforms.tMap.value = this.tmp.texture;
        this.mat.uniforms.uOpacity.value = a.opacity;
        this.quad.render(renderer);
      }
    });
    renderer.autoClear = prevAuto;
  }
  dispose() { this.tmp.dispose(); this.mat.dispose(); this.quad.dispose(); }
}

const FINAL = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.06 }, uVig: { value: 0.3 }, uCA: { value: 0 }, uFlash: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig, uCA, uFlash; uniform vec2 uRes; varying vec2 vUv;
    ${NOISE}
    void main(){
      vec2 c = vUv - .5; float r2 = dot(c,c);
      vec2 off = c * (uCA * 0.02 + r2 * uCA * 0.03);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float g = hash21(gl_FragCoord.xy + fract(uTime*7.13)*1000.) - .5;
      col += g * uGrain;
      col *= 1. - uVig * smoothstep(.15, .75, r2*2.2);
      col = mix(col, vec3(1.), clamp(uFlash,0.,1.));
      gl_FragColor = vec4(col, 1.);
    }`,
};

export class Compositor {
  composer: EffectComposer;
  private scenesPass: ScenesPass;
  bloom: UnrealBloomPass;
  private final: ShaderPass;
  private fx: FX = { bloom: 0.15, grain: 0.06, vignette: 0.3, ca: 0 };
  flashV = 0;
  constructor(private renderer: THREE.WebGLRenderer, private q: Quality) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
    this.scenesPass = new ScenesPass(size.x, size.y, q);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.4, 0.86);
    // HDR-friendly soft-knee high pass: only energy above the threshold blooms
    const hpu = this.bloom.highPassUniforms as Record<string, THREE.IUniform>;
    hpu['luminosityThreshold'].value = 0.86;
    this.bloom.materialHighPassFilter = new THREE.ShaderMaterial({
      uniforms: hpu,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform sampler2D tDiffuse; uniform float luminosityThreshold; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(c.r, max(c.g, c.b)); float k = max(l - luminosityThreshold, 0.) / max(l, 1e-4); gl_FragColor = vec4(c * k, 1.); }',
    });
    this.final = new ShaderPass(FINAL);
    this.composer.addPass(this.scenesPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
  }
  resize(w: number, h: number) {
    this.composer.setPixelRatio(this.q.dpr);
    this.composer.setSize(w, h);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.scenesPass.setSize(s.x, s.y);
    this.bloom.resolution.set(s.x / 2, s.y / 2);
    this.final.uniforms.uRes.value.set(s.x, s.y);
  }
  setQuality() { this.scenesPass.setMsaa(this.q.msaa); this.bloom.enabled = this.q.bloom; }
  flash(a: number) { this.flashV = Math.max(this.flashV, a); }
  render(list: Active[], dt: number, t: number) {
    // blend fx from active scenes (top scene weighted by its opacity)
    let target: FX = list[0]?.scene.fx ?? this.fx;
    if (list.length > 1) {
      const top = list[list.length - 1];
      const a = top.opacity, b = list[list.length - 2].scene.fx, c = top.scene.fx;
      target = { bloom: b.bloom + (c.bloom - b.bloom) * a, grain: b.grain + (c.grain - b.grain) * a, vignette: b.vignette + (c.vignette - b.vignette) * a, ca: b.ca + (c.ca - b.ca) * a };
    }
    const k = 1 - Math.exp(-dt * 4);
    (Object.keys(this.fx) as Array<keyof FX>).forEach((key) => { this.fx[key] += (target[key] - this.fx[key]) * k; });
    this.flashV = Math.max(0, this.flashV - dt * 1.6);
    this.bloom.strength = this.fx.bloom;
    const u = this.final.uniforms;
    u.uTime.value = t; u.uGrain.value = this.q.reducedMotion ? this.fx.grain * 0.6 : this.fx.grain; u.uVig.value = this.fx.vignette;
    u.uCA.value = this.fx.ca + this.flashV * 0.6; u.uFlash.value = this.flashV;
    this.scenesPass.list = list;
    this.composer.render(dt);
  }
}
