// Copies Draco + Basis (KTX2) decoders from three into /public so the loaders work offline.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/draco', { recursive: true });
mkdirSync('public/basis', { recursive: true });
cpSync('node_modules/three/examples/jsm/libs/draco/gltf', 'public/draco', { recursive: true });
cpSync('node_modules/three/examples/jsm/libs/basis', 'public/basis', { recursive: true });
