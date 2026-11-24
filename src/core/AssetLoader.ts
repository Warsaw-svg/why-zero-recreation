import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Loads GLB (Draco/Meshopt), KTX2 and plain textures; tracks progress for the preloader. */
export class AssetLoader {
  private gltf = new GLTFLoader();
  private draco = new DRACOLoader();
  private ktx2 = new KTX2Loader();
  private tex = new THREE.TextureLoader();
  private cache = new Map<string, Promise<unknown>>();
  total = 0;
  done = 0;
  onProgress: (p: number) => void = () => {};
  constructor(renderer: THREE.WebGLRenderer) {
    this.draco.setDecoderPath('/draco/');
    this.ktx2.setTranscoderPath('/basis/').detectSupport(renderer);
    this.gltf.setDRACOLoader(this.draco).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
  }
  /** register work that counts toward preloader progress */
  async track<T>(p: Promise<T>): Promise<T> {
    this.total++;
    try { return await p; } finally { this.done++; this.onProgress(this.done / this.total); }
  }
  /** Optional: returns null if the file does not exist (procedural stand-ins are used instead). */
  loadGLB(url: string) {
    if (!this.cache.has(url)) this.cache.set(url, this.gltf.loadAsync(url).catch(() => null));
    return this.cache.get(url) as Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF | null>;
  }
  loadKTX2(url: string) { return this.ktx2.loadAsync(url).catch(() => null); }
  loadTexture(url: string) { return this.tex.loadAsync(url).catch(() => null); }
  dispose() { this.draco.dispose(); this.ktx2.dispose(); }
}
