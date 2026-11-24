import * as THREE from 'three';
import { N8AOPass } from 'n8ao';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

/**
 * Realism pass for the city (Component 5b): screen-space ambient occlusion (n8ao), so buildings sit in soft contact shadows
 * where they meet the street and each other, followed by a tilt-shift blur that softens the top and bottom of the frame
 * like an aerial photo. Renders the scene itself and writes the result into the target the compositor gives it.
 */
export class CityPost {
  ao: N8AOPass;
  private rtA: THREE.WebGLRenderTarget; private rtB: THREE.WebGLRenderTarget;
  private hq: FullScreenQuad; private vq: FullScreenQuad;
  private hm: THREE.ShaderMaterial; private vm: THREE.ShaderMaterial;
  /** 0 = off … 1 = full tilt-shift */
  tilt = 1;
  private failed = false;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, w: number, h: number) {
    this.ao = new N8AOPass(scene, camera, w, h);
    const c = this.ao.configuration;
    c.aoRadius = 4.5; c.distanceFalloff = 1.2; c.intensity = 2.6; c.aoSamples = 16; c.denoiseSamples = 8; c.denoiseRadius = 10;
    c.halfRes = false; c.depthAwareUpsampling = false; c.gammaCorrection = false;   // full res: n8ao's half-res path uses a render-target type three 0.187 removed   // the site renders in linear (no tone mapping)
    this.rtA = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.rtB = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.hm = new THREE.ShaderMaterial(HorizontalTiltShiftShader); this.vm = new THREE.ShaderMaterial(VerticalTiltShiftShader);
    this.hq = new FullScreenQuad(this.hm); this.vq = new FullScreenQuad(this.vm);
    this.setSize(w, h);
  }
  setSize(w: number, h: number) {
    this.ao.setSize(w, h); this.rtA.setSize(w, h); this.rtB.setSize(w, h);
    this.hm.uniforms.h.value = 1.6 / w; this.vm.uniforms.v.value = 1.6 / h;
    this.hm.uniforms.r.value = 0.5; this.vm.uniforms.r.value = 0.5;
  }
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    const ac = renderer.autoClear;
    if (this.failed) { renderer.setRenderTarget(target); renderer.render(this.scene, this.camera); return; }
    try { this.draw(renderer, target); }
    catch (e) {   // never let the effect stop the page: fall back to a plain render from now on
      console.warn('[city] realism pass disabled:', e); this.failed = true; renderer.autoClear = ac;
      renderer.setRenderTarget(target); renderer.render(this.scene, this.camera);
    }
  }
  private draw(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    const ac = renderer.autoClear; renderer.autoClear = true;
    if (this.tilt <= 0.01) { this.ao.render(renderer, target as THREE.WebGLRenderTarget, null as unknown as THREE.WebGLRenderTarget); renderer.autoClear = ac; return; }
    this.ao.render(renderer, this.rtA, null as unknown as THREE.WebGLRenderTarget);
    this.hm.uniforms.tDiffuse.value = this.rtA.texture; this.hm.uniforms.h.value = (1.6 * this.tilt) / this.rtA.width;
    renderer.setRenderTarget(this.rtB); this.hq.render(renderer);
    this.vm.uniforms.tDiffuse.value = this.rtB.texture; this.vm.uniforms.v.value = (1.6 * this.tilt) / this.rtB.height;
    renderer.setRenderTarget(target); this.vq.render(renderer);
    renderer.autoClear = ac;
  }
  dispose() { this.ao.dispose?.(); this.rtA.dispose(); this.rtB.dispose(); this.hm.dispose(); this.vm.dispose(); this.hq.dispose(); this.vq.dispose(); }
}
