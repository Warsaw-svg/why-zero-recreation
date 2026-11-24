// Dev-only: hand pose lab (not part of the site). Grid of poses × views, to inspect finger bending.
import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { Hand, POSES, type HandPose } from '../utils/Hand';

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H); renderer.setPixelRatio(1); renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const q = new URLSearchParams(location.search);
const GRIP: HandPose = { index: 0.5, middle: 0.55, ring: 0.58, pinky: 0.6, thumb: 0.3, spread: 0.2 };
const poses: Array<[string, HandPose]> = [['open', POSES.open], ['reach', POSES.reach], ['shake', POSES.shake], ['grip', GRIP], ['fist', POSES.fist], ['shakeT', { ...POSES.shake, thumbIn: Number(q.get('ti') || 0.6) }], ['gripT', { ...GRIP, thumbIn: Number(q.get('ti') || 0.6) }], ['reachNew', { index: 0.02, middle: 0.12, ring: 0.68, pinky: 0.76, thumb: 0.15, spread: 0.6, thumbIn: 0.15, mcp: { middle: 0.85 } }], ['claw', { index: 0.08, middle: 0.4, ring: 0.55, pinky: 0.62, thumb: 0.35, spread: 0.55 }]];
const pick = (q.get('p') || 'shake,grip').split(',');
const views: Array<[string, number]> = [['palm', 0], ['palm 3/4', 0.7], ['thumb side', -Math.PI / 2], ['back', Math.PI]];
const mode = (q.get('mode') || 'glossy') as 'glossy';
(async () => {
  await Hand.preload(new AssetLoader(renderer));
  const cells: Array<{ scene: THREE.Scene; cam: THREE.PerspectiveCamera }> = [];
  const sel = poses.filter(([n]) => pick.includes(n));
  for (const [, p] of sel) for (const [, ry] of views) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fc9c4);
    const h = new Hand(mode, 0x35e04a, 1); h.setPose(p); h.showBack(q.get('back') === '1');
    h.group.rotation.set(Number(q.get('rx') || 0), ry, 0); h.group.position.y = -0.2;
    scene.add(h.group); h.update(0);
    const cam = new THREE.PerspectiveCamera(35, (W / views.length) / (H / sel.length), 0.1, 50); cam.position.set(0, 0.0, 2.6); cam.lookAt(0, 0.0, 0);
    cells.push({ scene, cam });
  }
  const cw = W / views.length, ch = H / sel.length;
  cells.forEach((c, i) => {
    const col = i % views.length, row = Math.floor(i / views.length);
    renderer.setViewport(col * cw, H - (row + 1) * ch, cw, ch); renderer.setScissor(col * cw, H - (row + 1) * ch, cw, ch);
    renderer.render(c.scene, c.cam);
  });
  document.getElementById('lab')!.textContent = 'rows: ' + sel.map((p) => p[0]).join(' / ') + '   cols: ' + views.map((v) => v[0]).join(' / ');
})();
