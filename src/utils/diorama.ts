import * as THREE from 'three';
import { mulberry32 } from './math';
import { COMPANIES } from './companies';

/**
 * Original procedural "campus city" diorama: glass dome plaza, ring road + spokes, river, trees, rocks, filler towers and one
 * distinctive building per company. Everything is generated here — no external models or textures.
 */
export interface Anchor { id: string; x: number; z: number; top: number }
export interface Diorama { group: THREE.Group; anchors: Anchor[]; half: number }

const HALF = 38;
const R_PLAZA = 11, R_RING0 = 14, R_RING1 = 17, R_SPOKE = 31;
const SPOKES = Array.from({ length: 8 }, (_, k) => ((22.5 + 45 * k) * Math.PI) / 180);
const RIVER = new THREE.CatmullRomCurve3([[-34, -34], [-30, -16], [-35, 0], [-30, 16], [-34, 34]].map(([x, z]) => new THREE.Vector3(x, 0.04, z)));
const RIVER_PTS = RIVER.getPoints(80);

// ---------- textures (canvas, generated once) ----------
type Kind = 'glass' | 'warm' | 'dark';
const texCache = new Map<string, THREE.CanvasTexture>();
function facade(kind: Kind) {
  const hit = texCache.get(kind); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const bg = { glass: '#eef2f5', warm: '#d97e5e', dark: '#171a21' }[kind];
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  const rnd = mulberry32(kind.length * 99);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const px = x * 32 + 5, py = y * 32 + 6;
    if (kind === 'glass') { const gr = g.createLinearGradient(0, py, 0, py + 18); gr.addColorStop(0, '#9cc3d8'); gr.addColorStop(1, '#5f8fa8'); g.fillStyle = gr; }
    else if (kind === 'warm') g.fillStyle = rnd() > 0.2 ? '#ffe3bf' : '#f6b98a';
    else g.fillStyle = rnd() > 0.72 ? '#ffd27a' : '#34425c';
    g.fillRect(px, py, 22, 18);
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(px, py, 22, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace;
  texCache.set(kind, t); return t;
}
function grassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!; g.fillStyle = '#9ccb70'; g.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(5);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `hsla(${88 + rnd() * 30},${40 + rnd() * 25}%,${36 + rnd() * 22}%,.35)`; g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 5, 2 + rnd() * 5); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9, 9); t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const side = (kind: Kind, color = 0xffffff) => {
  const k = `s${kind}${color}`; let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ map: facade(kind), color, roughness: 0.55, metalness: 0.08 }); matCache.set(k, m); } return m;
};
const flat = (color: number, rough = 0.7, metal = 0, emissive = 0x000000, ei = 0) => {
  const k = `f${color}${rough}${metal}${emissive}${ei}`; let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei }); matCache.set(k, m); } return m;
};

function scaleUV(g: THREE.BufferGeometry, fn: (i: number) => [number, number]) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) { const [su, sv] = fn(i); uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
}
/** textured box: windows tile at 4 world units; roof/floor use a plain material */
function box(w: number, h: number, d: number, x: number, y: number, z: number, kind: Kind, tint = 0xffffff, roof = 0xb9c0c6) {
  const g = new THREE.BoxGeometry(w, h, d);
  const dims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  scaleUV(g, (i) => { const f = Math.floor(i / 4); return [dims[f][0] / 4, dims[f][1] / 4]; });
  const s = side(kind, tint), r = flat(roof, 0.8);
  const m = new THREE.Mesh(g, [s, s, r, r, s, s]);
  m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; return m;
}
function plain(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; return m;
}
function nameSign(text: string, color: string, w = 6) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d')!; g.fillStyle = color; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#fff'; g.font = '700 74px Fredoka, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t })); return m;
}

// ---------- the four company buildings (original designs) ----------
function googleCampus() {
  const g = new THREE.Group(); const roofs = [0x4285f4, 0xea4335, 0xfbbc04, 0x34a853];
  const defs: Array<[number, number, number, number, number]> = [[-3.2, -2.2, 5, 5, 4], [3.4, -2.6, 5.5, 4, 3], [0.4, 3.4, 8, 4, 4.8], [-4.6, 3, 3, 3, 3]];
  defs.forEach(([x, z, w, d, h], i) => {
    g.add(box(w, h, d, x, 0, z, 'glass', 0xffffff, 0xffffff));
    g.add(plain(new THREE.BoxGeometry(w + 0.5, 0.35, d + 0.5), flat(roofs[i], 0.4), x, h + 0.17, z));
  });
  return { group: g, top: 5.4 };
}
function openaiTower() {
  const g = new THREE.Group(); let y = 0;
  [[2.9, 4.2], [2.4, 4.2], [1.9, 4.2]].forEach(([r, h], i) => {
    const geo = new THREE.CylinderGeometry(r, r + 0.15, h, 6); scaleUV(geo, () => [4, h / 4]);
    const m = new THREE.Mesh(geo, [side('glass', 0xf7fbfa), flat(0xeafaf4, 0.4), flat(0xeafaf4, 0.4)]);
    m.position.y = y + h / 2; m.rotation.y = i * 0.52; m.castShadow = m.receiveShadow = true; g.add(m);
    g.add(plain(new THREE.CylinderGeometry(r + 0.25, r + 0.25, 0.28, 6), flat(0x10a37f, 0.3, 0.2, 0x10a37f, 0.35), 0, y + h + 0.05, 0).rotateY(i * 0.52));
    y += h + 0.3;
  });
  g.add(plain(new THREE.CylinderGeometry(0.2, 0.2, 2.2, 8), flat(0xdfe7e5, 0.4, 0.5), 0, y + 1.1, 0));
  return { group: g, top: y + 2.2 };
}
function anthropicTower() {
  const g = new THREE.Group();
  g.add(box(6.4, 7, 6.4, 0, 0, 0, 'warm', 0xffffff, 0xc4694a));
  g.add(box(5, 5.4, 5, 0, 7, 0, 'warm', 0xffffff, 0xc4694a));
  g.add(box(3.4, 4, 3.4, 0, 12.4, 0, 'warm', 0xffffff, 0xc4694a));
  for (let i = -2; i <= 2; i++) g.add(plain(new THREE.BoxGeometry(0.28, 7.2, 0.4), flat(0x9a4a32, 0.6), i * 1.2, 3.6, 3.3));
  g.add(plain(new THREE.ConeGeometry(0.5, 3, 4), flat(0xf4d8c4, 0.4, 0.2), 0, 17.9, 0));
  g.add(plain(new THREE.TorusGeometry(2.6, 0.12, 6, 32).rotateX(Math.PI / 2), flat(0xf4d8c4, 0.4), 0, 7.1, 0));
  return { group: g, top: 19.5 };
}
function netflixTower() {
  const g = new THREE.Group();
  g.add(box(5.2, 17, 3.4, 0, 0, 0, 'dark', 0xffffff, 0x2b2f38));
  const band = plain(new THREE.BoxGeometry(1.5, 17.2, 0.12), flat(0xe50914, 0.35, 0, 0xe50914, 0.6), 0, 8.6, 1.75, false); g.add(band);
  g.add(plain(new THREE.BoxGeometry(5.5, 0.6, 3.7), flat(0xe50914, 0.4, 0, 0xe50914, 0.3), 0, 17.3, 0));
  g.add(box(7.4, 2.6, 5, 0, 0, 0.2, 'dark', 0xffffff, 0x2b2f38).translateX(0).translateZ(2.6));
  return { group: g, top: 18.2 };
}
const BUILDERS: Record<string, () => { group: THREE.Group; top: number }> = { google: googleCampus, openai: openaiTower, anthropic: anthropicTower, netflix: netflixTower };

// ---------- placement helpers ----------
function riverDist(x: number, z: number) { let m = 1e9; for (const p of RIVER_PTS) m = Math.min(m, Math.hypot(x - p.x, z - p.z)); return m; }
function nearSpoke(x: number, z: number, pad: number) {
  if (Math.hypot(x, z) > R_SPOKE + 4) return false;
  for (const a of SPOKES) { const proj = x * Math.cos(a) + z * Math.sin(a); if (proj > 0 && Math.abs(-x * Math.sin(a) + z * Math.cos(a)) < 2.3 + pad) return true; }
  return false;
}

export function buildDiorama(seed = 3): Diorama {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const occ: Array<[number, number, number]> = [];
  const blocked = (x: number, z: number, r: number) =>
    Math.hypot(x, z) < R_RING1 + r + 1 || Math.abs(x) > HALF - 3 - r || Math.abs(z) > HALF - 3 - r || riverDist(x, z) < 3.6 + r || nearSpoke(x, z, r) ||
    occ.some(([ox, oz, or]) => Math.hypot(x - ox, z - oz) < or + r);

  // sea, beach, island
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), flat(0x86d0ea, 0.3, 0, 0x4aa8d0, 0.35)); sea.position.y = -0.7; sea.receiveShadow = true; group.add(sea);
  group.add(plain(new THREE.BoxGeometry(HALF * 2 + 7, 1, HALF * 2 + 7), flat(0xe9dcb8, 0.9), 0, -0.6, 0, false));
  const gt = grassTexture();
  const ground = plain(new THREE.BoxGeometry(HALF * 2, 1, HALF * 2), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95 }), 0, -0.5, 0, false); ground.receiveShadow = true; group.add(ground);

  // plaza, ring road, spokes
  group.add(plain(new THREE.CylinderGeometry(R_PLAZA, R_PLAZA, 0.12, 64), flat(0xeee9de, 0.85), 0, 0.06, 0, false));
  const ring = new THREE.Mesh(new THREE.RingGeometry(R_RING0, R_RING1, 96).rotateX(-Math.PI / 2), flat(0x5a6068, 0.9)); ring.position.y = 0.03; ring.receiveShadow = true; group.add(ring);
  const curb = new THREE.Mesh(new THREE.RingGeometry(R_PLAZA, R_RING0, 96).rotateX(-Math.PI / 2), flat(0xcfd6c9, 0.9)); curb.position.y = 0.025; curb.receiveShadow = true; group.add(curb);
  const len = R_SPOKE - R_RING1;
  for (const a of SPOKES) {
    const r = plain(new THREE.BoxGeometry(len, 0.06, 2.6), flat(0x4b5057, 0.9), 0, 0.03, 0, false);
    const line = plain(new THREE.BoxGeometry(len, 0.02, 0.12), flat(0xf3e6a8, 0.6), 0, 0.07, 0, false);
    const holder = new THREE.Group(); holder.add(r, line); r.position.x = line.position.x = R_RING1 + len / 2; holder.rotation.y = -a; group.add(holder);
  }

  // river
  { const pos: number[] = [], idx: number[] = []; const W = 2.3;
    RIVER_PTS.forEach((p, i) => { const q = RIVER_PTS[Math.min(i + 1, RIVER_PTS.length - 1)], o = RIVER_PTS[Math.max(i - 1, 0)]; const dx = q.x - o.x, dz = q.z - o.z, l = Math.hypot(dx, dz) || 1; const nx = -dz / l, nz = dx / l; pos.push(p.x + nx * W, p.y, p.z + nz * W, p.x - nx * W, p.y, p.z - nz * W); if (i < RIVER_PTS.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const r = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x5aaed6, roughness: 0.15, metalness: 0.2, side: THREE.DoubleSide })); r.receiveShadow = true; group.add(r); }

  // glass dome
  { const dome = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(7, 56, 28, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.58, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.5, emissive: 0xe4f6ff, emissiveIntensity: 1.0, depthWrite: false, side: THREE.DoubleSide }));
    shell.castShadow = true; dome.add(shell);
    for (let i = 0; i < 10; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(7.04, 0.09, 6, 56, Math.PI).scale(1, 0.58, 1), flat(0xffffff, 0.3, 0.3)); rib.rotation.y = (i * Math.PI) / 10; dome.add(rib); }
    dome.add(plain(new THREE.CylinderGeometry(7.3, 7.5, 0.5, 56), flat(0xf3f3ef, 0.5), 0, 0.25, 0));
    dome.add(plain(new THREE.CylinderGeometry(3, 3, 0.3, 40), flat(0x6fc2e6, 0.12, 0.2), 0, 0.2, 0, false));
    group.add(dome); }

  // company buildings
  const anchors: Anchor[] = [];
  for (const c of COMPANIES) {
    const b = BUILDERS[c.id](); b.group.position.set(c.pos[0], 0, c.pos[1]); b.group.lookAt(0, 0, 0); b.group.rotateY(0); group.add(b.group);
    const s = nameSign(c.name, c.color, 5.2); s.position.set(c.pos[0] * 0.78, 1.6, c.pos[1] * 0.78 + 0); s.lookAt(c.pos[0] * 2, 4, c.pos[1] * 2); s.rotation.set(0, Math.atan2(c.pos[0], c.pos[1]) + Math.PI, 0); group.add(s);
    anchors.push({ id: c.id, x: c.pos[0], z: c.pos[1], top: b.top }); occ.push([c.pos[0], c.pos[1], 9]);
  }

  // rocks (left bank)
  for (const [x, z, sc] of [[-25, -24, 3.2], [-27, -20, 2.2], [-26, 24, 3], [-23, 27, 2]] as const) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(sc, 0), flat(0x8a8277, 0.95)); r.position.set(x, sc * 0.5, z); r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); r.scale.y = 0.8; r.castShadow = r.receiveShadow = true; group.add(r); occ.push([x, z, sc + 1.5]);
  }

  // filler buildings
  const tints = [0xffffff, 0xfff3e2, 0xe6f0f8, 0xffe4d0, 0xeeeae0, 0xf4f8fb];
  const roofs = [0xf2f4f5, 0xd9694a, 0x9fb7c9, 0xe9e1cf, 0x6f7f8c, 0xc9d8c0];
  for (let gx = -HALF + 5; gx < HALF - 4; gx += 6.4) for (let gz = -HALF + 5; gz < HALF - 4; gz += 6.4) {
    const x = gx + (rnd() - 0.5) * 2.2, z = gz + (rnd() - 0.5) * 2.2, w = 3 + rnd() * 3.2, d = 3 + rnd() * 3.2, r = Math.max(w, d) * 0.62;
    if (blocked(x, z, r)) continue;
    const dist = Math.hypot(x, z); const h = 3 + rnd() * 5 + (dist < 28 ? rnd() * 5 : 0);
    const kind: Kind = rnd() > 0.88 ? 'dark' : 'glass';
    group.add(box(w, h, d, x, 0, z, kind, tints[Math.floor(rnd() * tints.length)], roofs[Math.floor(rnd() * roofs.length)]));
    occ.push([x, z, r]);
  }

  // trees (instanced)
  const trees: Array<[number, number, number]> = [];
  for (let tries = 0; tries < 1400 && trees.length < 340; tries++) {
    const x = (rnd() * 2 - 1) * (HALF - 2), z = (rnd() * 2 - 1) * (HALF - 2);
    if (Math.hypot(x, z) < R_RING1 + 1 || riverDist(x, z) < 3.2 || nearSpoke(x, z, 0.8) || occ.some(([ox, oz, or]) => Math.hypot(x - ox, z - oz) < or * 0.85)) continue;
    trees.push([x, z, 0.8 + rnd() * 0.9]);
  }
  const foliage = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), trees.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 1, 5), flat(0x6b4a33, 0.9), trees.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  trees.forEach(([x, z, s], i) => {
    m4.compose(new THREE.Vector3(x, s * 1.35, z), new THREE.Quaternion(), new THREE.Vector3(s * 0.95, s * 1.1, s * 0.95)); foliage.setMatrixAt(i, m4);
    foliage.setColorAt(i, col.setHSL(0.26 + rnd() * 0.08, 0.45 + rnd() * 0.2, 0.28 + rnd() * 0.14));
    m4.compose(new THREE.Vector3(x, s * 0.4, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s)); trunk.setMatrixAt(i, m4);
  });
  foliage.castShadow = true; trunk.castShadow = true; foliage.receiveShadow = true; group.add(foliage, trunk);

  return { group, anchors, half: HALF };
}
