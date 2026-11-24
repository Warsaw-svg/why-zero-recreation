import * as THREE from 'three';
import type { Input } from './Input';
import type { Gates } from './Gates';
import type { ScrollEngine } from './ScrollEngine';
import type { Quality } from './Quality';
import type { AudioManager } from '../audio/AudioManager';
import type { HUD } from '../ui/HUD';
import type { AssetLoader } from './AssetLoader';
import { FULLSCREEN_VERT, NOISE } from '../shaders/common';
import type { TextLine } from '../utils/text';

export interface Ctx {
  renderer: THREE.WebGLRenderer;
  input: Input;
  gates: Gates;
  scroll: ScrollEngine;
  quality: Quality;
  audio: AudioManager;
  hud: HUD;
  assets: AssetLoader;
  flash: (amount: number) => void; // 0..1 whiteout pulse, handled by compositor
  size: { w: number; h: number; aspect: number };
  time: number;
  global: { progress: number; /** real load progress 0..1 (drives the loader + ice reveal) */ load: number; /** loader finished; interaction allowed */ ready: boolean };
}
export interface FX { bloom: number; grain: number; vignette: number; ca: number }

export abstract class Scene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  /** UI layer attached to camera: 1 unit = half viewport height, z=0 plane. */
  readonly ui = new THREE.Group();
  range: [number, number];
  overlay = false;
  layer = 0;
  fx: FX = { bloom: 0.5, grain: 0.06, vignette: 0.3, ca: 0 };
  theme: 'light' | 'dark' = 'dark';
  /** optional custom render (e.g. the city's ambient occlusion + tilt-shift); draws this scene into `target` */
  post: { render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void } | null = null;
  inited = false;
  disabled = false;
  active = false;
  protected texts: TextLine[] = [];
  constructor(public ctx: Ctx, public name: string, range: [number, number]) {
    this.range = range;
    this.scene.add(this.camera);
    this.camera.add(this.ui);
  }
  init(): void { this.inited = true; }
  enter(): void {}
  abstract update(local: number, dt: number, t: number): void;
  exit(): void {}
  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of list) {
        for (const v of Object.values(x as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
        const u = (x as THREE.ShaderMaterial).uniforms;
        if (u) for (const k in u) { const v = u[k].value; if (v instanceof THREE.Texture) v.dispose(); }
        x.dispose();
      }
    });
    this.texts.forEach((t) => t.dispose());
    this.texts = [];
    this.scene.clear();
    this.scene.add(this.camera);
    this.ui.clear();
    this.camera.add(this.ui);
    this.inited = false;
  }
  /** keep ui plane at a fixed distance with exact vh mapping (call after fov changes) */
  syncUI() {
    const d = 5;
    this.ui.position.z = -d;
    this.ui.scale.setScalar(d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.syncUI();
    this.camera.updateProjectionMatrix();
    this.onResize(w, h);
    const ppu = Math.min(1100, (h / 2) * Math.min(this.ctx.quality.dpr, 2));
    this.texts.forEach((t) => t.build(ppu));
    this.layoutText();
  }
  protected onResize(_w: number, _h: number) {}
  /** position text blocks (called on resize) */
  protected layoutText() {}
  protected addText(t: TextLine) { this.texts.push(t); this.ui.add(t.mesh); t.mesh.visible = false; return t; }
  protected fit(t: TextLine, s = 1) { return Math.min(s, this.textW / Math.max(0.01, t.width - 2 * t.padU)); }
  protected get aspect() { return this.ctx.size.aspect; }
  protected get portrait() { return this.ctx.size.aspect < 0.9; }
  /** half-width available for text in vh units */
  protected get textW() { return this.aspect * 2 - 0.26; }
  /** full-screen shader backdrop */
  protected makeBackdrop(frag: string, uniforms: Record<string, THREE.IUniform>) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `uniform float uTime; uniform vec2 uRes; uniform float uLocal; varying vec2 vUv;\n${NOISE}\n${frag}`,
      uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uLocal: { value: 0 }, ...uniforms },
      depthTest: false, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    m.frustumCulled = false;
    m.renderOrder = -1000;
    this.scene.add(m);
    return mat;
  }
}
