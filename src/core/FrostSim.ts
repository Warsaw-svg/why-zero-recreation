import * as THREE from 'three';

/**
 * GPU frost simulation (ping-pong half-float targets, screen-space).
 *   R = "cleared" amount: each stamp sets a soft-edged disc to 1, then it decays linearly (slow refreeze)
 *   G = "fresh" amount: same stamp, but decays quickly — drives the white glowing blob a new dab starts as
 * The ice shader reads this and erodes the hole edge with noise, so refreezing is ragged instead of a plain fade.
 */
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tPrev; uniform float uDt; uniform float uAsp; uniform float uDecay; uniform float uFreshK;
uniform int uCount; uniform vec3 uStamp[24];
varying vec2 vUv;
void main(){
  vec4 p = texture2D(tPrev, vUv);
  float clearA = max(p.r - uDt * uDecay, 0.);
  float fresh = p.g * exp(-uDt * uFreshK);
  for (int i = 0; i < 24; i++) {
    if (i >= uCount) break;
    vec2 d = vec2((vUv.x - uStamp[i].x) * uAsp, vUv.y - uStamp[i].y);
    float r = uStamp[i].z;
    float k = 1. - smoothstep(r * .6, r, length(d));
    clearA = max(clearA, k); fresh = max(fresh, k);
  }
  gl_FragColor = vec4(clearA, fresh, 0., 1.);
}`;

export class FrostSim {
  private rts: THREE.WebGLRenderTarget[] = [];
  private cur = 0;
  private mat: THREE.ShaderMaterial;
  private scn = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private pending: THREE.Vector3[] = [];
  /** linear decay per second for the "cleared" channel (1 → 0 in 1/decay seconds) */
  decay = 0.085;
  aspect = 1.6;
  constructor(private renderer: THREE.WebGLRenderer) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: FRAG,
      depthTest: false, depthWrite: false,
      uniforms: {
        tPrev: { value: null }, uDt: { value: 0 }, uAsp: { value: 1.6 }, uDecay: { value: this.decay }, uFreshK: { value: 2.4 },
        uCount: { value: 0 }, uStamp: { value: Array.from({ length: 24 }, () => new THREE.Vector3()) },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scn.add(this.quad);
    this.resize(1.6);
  }
  /** (re)allocate for a viewport aspect; this also clears the frost state */
  resize(aspect: number) {
    if (this.rts.length && Math.abs(aspect - this.aspect) < 0.01) return; // same shape: keep the frost state (resizes must not wipe it)
    this.aspect = aspect;
    this.rts.forEach((r) => r.dispose());
    const h = 288, w = Math.max(160, Math.round(h * aspect));
    const mk = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.rts = [mk(), mk()];
    this.cur = 0;
    const prev = this.renderer.getRenderTarget();
    for (const r of this.rts) { this.renderer.setRenderTarget(r); this.renderer.setClearColor(0x000000, 1); this.renderer.clear(); }
    this.renderer.setRenderTarget(prev);
  }
  /** u,v in 0..1 (v up); r in viewport-height units */
  stamp(u: number, v: number, r: number) { this.pending.push(new THREE.Vector3(u, v, r)); }
  step(dt: number) {
    const u = this.mat.uniforms;
    const n = Math.min(24, this.pending.length);
    for (let i = 0; i < n; i++) u.uStamp.value[i].copy(this.pending[i]);
    this.pending.length = 0;
    u.uCount.value = n; u.uDt.value = dt; u.uAsp.value = this.aspect; u.uDecay.value = this.decay;
    u.tPrev.value = this.rts[this.cur].texture;
    const next = 1 - this.cur;
    const prev = this.renderer.getRenderTarget();
    const ac = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.rts[next]);
    this.renderer.render(this.scn, this.cam);
    this.renderer.setRenderTarget(prev);
    this.renderer.autoClear = ac;
    this.cur = next;
  }
  get texture() { return this.rts[this.cur].texture; }
  dispose() { this.rts.forEach((r) => r.dispose()); this.mat.dispose(); this.quad.geometry.dispose(); }
}
