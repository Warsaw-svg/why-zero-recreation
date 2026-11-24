// minimal types for the n8ao ambient-occlusion pass (the package ships none)
declare module 'n8ao' {
  import type * as THREE from 'three';
  import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
  export class N8AOPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; aoSamples: number; denoiseSamples: number; denoiseRadius: number;
      halfRes: boolean; depthAwareUpsampling: boolean; gammaCorrection: boolean; color: THREE.Color; [k: string]: unknown;
    };
    setSize(w: number, h: number): void;
    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void;
    dispose(): void;
  }
}
