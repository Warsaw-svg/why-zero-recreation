import * as THREE from 'three';
import { mulberry32 } from './math';

/** Procedural "company-like" logo disc textures (all invented marks). */
export function logoTexture(i: number): THREE.CanvasTexture {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const rnd = mulberry32(i * 77 + 3);
  const gr = g.createRadialGradient(S * 0.4, S * 0.35, 10, S / 2, S / 2, S / 2);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.75, '#f2f6f5'); gr.addColorStop(1, '#cfdcd9');
  g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.fill();
  g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.08)'; g.stroke();
  const hues = ['#2b6cf0', '#f0502b', '#16a37f', '#111111', '#8a3ffc', '#f2a900'];
  g.fillStyle = hues[i % hues.length]; g.strokeStyle = g.fillStyle; g.lineWidth = 16; g.lineCap = 'round';
  const c = S / 2;
  switch (i % 8) {
    case 0: g.beginPath(); g.arc(c, c, 52, 0.4, Math.PI * 1.7); g.stroke(); break;
    case 1: g.beginPath(); g.moveTo(c, c - 58); g.lineTo(c + 54, c + 40); g.lineTo(c - 54, c + 40); g.closePath(); g.fill(); break;
    case 2: g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.lineTo(c + Math.cos(a) * 56, c + Math.sin(a) * 56); } g.closePath(); g.fill(); break;
    case 3: for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * 58, c + Math.sin(a) * 58); g.stroke(); } break;
    case 4: g.fillRect(c - 50, c - 50, 44, 44); g.fillRect(c + 6, c - 50, 44, 44); g.fillRect(c - 50, c + 6, 44, 44); g.fillRect(c + 6, c + 6, 44, 44); break;
    case 5: g.beginPath(); g.arc(c - 22, c, 34, 0, 7); g.stroke(); g.beginPath(); g.arc(c + 22, c, 34, 0, 7); g.stroke(); break;
    case 6: g.beginPath(); g.moveTo(c - 56, c + 10); for (let x = -56; x <= 56; x += 4) g.lineTo(c + x, c + 10 - Math.sin(x * 0.12) * 28); g.stroke(); break;
    default: g.font = '700 96px "Playfair Display", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String.fromCharCode(65 + Math.floor(rnd() * 26)), c, c + 6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}

export function coinMesh(tex?: THREE.Texture) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 48);
  const edge = new THREE.MeshBasicMaterial({ color: 0xdfeee9 });
  const face = new THREE.MeshBasicMaterial({ map: tex ?? null, color: tex ? 0xffffff : 0xf4fffb });
  return new THREE.Mesh(g, [edge, face, face]);
}
