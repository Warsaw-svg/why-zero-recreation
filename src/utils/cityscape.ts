import * as THREE from 'three';
import { mulberry32 } from './math';
import { COMPANIES } from './companies';
import type { Anchor, Diorama } from './diorama';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** soft daylight environment (reflections on glass / metal, gentler ambient) — generated once and shared */
let ENV: THREE.Texture | null = null;
export function cityEnvironment(renderer: THREE.WebGLRenderer) {
  if (!ENV) { const pm = new THREE.PMREMGenerator(renderer); ENV = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
  return ENV;
}

/**
 * Component 5b city, rebuilt toward the reference (Screen Recording 9.55.37): a dense, muted, realistic-looking city seen
 * from above — concrete / beige / glass blocks on a dark street grid, a canal, parks, stadiums and other landmarks, a beach
 * and sea along the east edge, and the white dome plaza in the middle (the green JOIN THE WAITLIST dome sits on it).
 * Everything is procedural: the ground is one painted canvas, the ordinary buildings are ONE instanced mesh whose windows
 * are drawn in the shader from world position (any size box gets a correct window grid), so hundreds of buildings stay cheap.
 * Same interface as buildDiorama (group / anchors / half) so the scenes can swap it in.
 */
const X0 = -150, X1 = 58, Z0 = -150, Z1 = 150;     // land (big enough to fill a wide window, even from the cloud scene's high start); the sea starts past X1
const BLOCK = 10.5, ROAD = 2.6, R_RING0 = 14, R_RING1 = 17.5, R_PLAZA = 11;
const CANAL_X = -31, CANAL_W = 3.2;

type Lot = { x: number; z: number; w: number; d: number };
const inPlaza = (x: number, z: number, pad = 0) => Math.hypot(x, z) < R_RING1 + 2 + pad;
const inCanal = (x: number, pad = 0) => Math.abs(x - CANAL_X) < CANAL_W / 2 + 1 + pad;

// ---------- ground: streets, sidewalks, parks, canal, plaza (one canvas) ----------
function groundTexture(parks: Lot[]) {
  const S = 4096, W = X1 + 6 - X0, H = Z1 - Z0, k = S / Math.max(W, H);
  const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const g = cv.getContext('2d')!;
  const X = (x: number) => (x - X0) * k, Y = (z: number) => (z - Z0) * k;
  g.fillStyle = '#4c4f52'; g.fillRect(0, 0, cv.width, cv.height);           // asphalt
  // blocks (sidewalk rim + concrete lot)
  for (let x = X0; x < X1; x += BLOCK + ROAD) for (let z = Z0; z < Z1; z += BLOCK + ROAD) {
    g.fillStyle = '#9d9a93'; g.fillRect(X(x), Y(z), BLOCK * k, BLOCK * k);
    g.fillStyle = '#b3afa6'; g.fillRect(X(x + 0.5), Y(z + 0.5), (BLOCK - 1) * k, (BLOCK - 1) * k);
  }
  // lane markings
  g.strokeStyle = 'rgba(235,225,190,.55)'; g.lineWidth = 0.12 * k; g.setLineDash([0.9 * k, 0.9 * k]);
  for (let x = X0 + BLOCK + ROAD / 2; x < X1; x += BLOCK + ROAD) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), cv.height); g.stroke(); }
  for (let z = Z0 + BLOCK + ROAD / 2; z < Z1; z += BLOCK + ROAD) { g.beginPath(); g.moveTo(0, Y(z)); g.lineTo(X(X1), Y(z)); g.stroke(); }
  g.setLineDash([]);
  // crosswalks at every junction
  g.fillStyle = 'rgba(230,226,214,.55)';
  for (let x = X0 + BLOCK; x < X1; x += BLOCK + ROAD) for (let z = Z0 + BLOCK; z < Z1; z += BLOCK + ROAD) {
    for (let i = 0; i < 5; i++) { g.fillRect(X(x + 0.25 + i * 0.45), Y(z - 0.9), 0.22 * k, 0.8 * k); g.fillRect(X(x - 0.9), Y(z + 0.25 + i * 0.45), 0.8 * k, 0.22 * k); }
  }
  // grime / patching so it doesn't look flat
  { const r2 = mulberry32(17); for (let i = 0; i < 9000; i++) { const a = r2() * 0.08; g.fillStyle = r2() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`; const s = (0.3 + r2() * 2.4) * k; g.fillRect(r2() * cv.width, r2() * cv.height, s, s * (0.4 + r2())); } }
  // parks
  const rnd = mulberry32(4);
  for (const p of parks) {
    g.fillStyle = '#5d7448'; g.fillRect(X(p.x - p.w / 2), Y(p.z - p.d / 2), p.w * k, p.d * k);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${60 + rnd() * 40},${90 + rnd() * 40},${50 + rnd() * 30},.5)`; g.fillRect(X(p.x - p.w / 2 + rnd() * p.w), Y(p.z - p.d / 2 + rnd() * p.d), 0.6 * k, 0.6 * k); }
    g.strokeStyle = '#c9c0a8'; g.lineWidth = 0.35 * k; g.beginPath(); g.moveTo(X(p.x - p.w / 2), Y(p.z)); g.quadraticCurveTo(X(p.x), Y(p.z - p.d * 0.4), X(p.x + p.w / 2), Y(p.z + p.d * 0.2)); g.stroke();
  }
  // canal with stone banks
  g.fillStyle = '#c2bcae'; g.fillRect(X(CANAL_X - CANAL_W / 2 - 0.8), 0, (CANAL_W + 1.6) * k, cv.height);
  g.fillStyle = '#3e6a73'; g.fillRect(X(CANAL_X - CANAL_W / 2), 0, CANAL_W * k, cv.height);
  // plaza: ring road + paving
  g.fillStyle = '#4a4d50'; g.beginPath(); g.arc(X(0), Y(0), (R_RING1 + 2) * k, 0, 7); g.fill();
  g.fillStyle = '#5a5e62'; g.beginPath(); g.arc(X(0), Y(0), R_RING1 * k, 0, 7); g.fill();
  g.strokeStyle = 'rgba(235,225,190,.6)'; g.lineWidth = 0.12 * k; g.setLineDash([0.9 * k, 0.9 * k]); g.beginPath(); g.arc(X(0), Y(0), (R_RING0 + R_RING1) / 2 * k, 0, 7); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#d8d3c6'; g.beginPath(); g.arc(X(0), Y(0), R_RING0 * k, 0, 7); g.fill();
  g.fillStyle = '#e8e4da'; g.beginPath(); g.arc(X(0), Y(0), R_PLAZA * k, 0, 7); g.fill();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; g.strokeStyle = 'rgba(160,150,130,.35)'; g.lineWidth = 0.08 * k; g.beginPath(); g.moveTo(X(Math.cos(a) * R_PLAZA), Y(Math.sin(a) * R_PLAZA)); g.lineTo(X(Math.cos(a) * R_RING0), Y(Math.sin(a) * R_RING0)); g.stroke(); }
  // beach toward the sea
  const bg = g.createLinearGradient(X(X1 - 1), 0, X(X1 + 6), 0); bg.addColorStop(0, '#cdbf9c'); bg.addColorStop(1, '#e3d6b3');
  g.fillStyle = bg; g.fillRect(X(X1 - 1), 0, 7 * k, cv.height);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true;
  return { tex: t, w: W, h: H };
}

// ---------- building material: windows from world position (instanced) ----------
function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.02, envMapIntensity: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tWall = { value: photo('concrete_wall_008_diff_1k.jpg') };
    sh.uniforms.tFacade = { value: photo('concrete_tile_facade_diff_1k.jpg') };
    sh.uniforms.tRoof = { value: photo('concrete_floor_worn_02_diff_1k.jpg') };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind; varying float vKind; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 bldM = modelMatrix;
        #ifdef USE_INSTANCING
          bldM = modelMatrix * instanceMatrix;
        #endif
        vWP = (bldM * vec4(transformed, 1.)).xyz; vWN = normalize(mat3(bldM) * objectNormal); vKind = aKind;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vKind; varying vec3 vWP; varying vec3 vWN;
        uniform sampler2D tWall; uniform sampler2D tFacade; uniform sampler2D tRoof;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
        float gWin = 0., gWall = 0.;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float wall = 1. - step(.85, abs(vWN.y));
          vec2 fc = vec2(abs(vWN.x) > .5 ? vWP.z : vWP.x, vWP.y);
          float k = vKind;
          // 0 concrete (punched windows) · 1 office (bands) · 2 glass (grid) · 3 dark glass
          vec2 cs = k < .5 ? vec2(1.25, 1.35) : k < 1.5 ? vec2(.9, 1.2) : vec2(1.0, 1.1);
          vec2 cell = fc / cs, f = fract(cell);
          float win = k < .5 ? step(.22, f.x) * step(f.x, .78) * step(.28, f.y) * step(f.y, .78)
                    : k < 1.5 ? step(.18, f.y) * step(f.y, .82)
                    : step(.06, f.x) * step(f.x, .94) * step(.08, f.y) * step(f.y, .92);
          float r = h21(floor(cell) + floor(vWP.xz * .1));
          vec3 wc = k > 2.5 ? mix(vec3(.12, .15, .19), vec3(.22, .27, .33), r) : mix(vec3(.28, .34, .40), vec3(.52, .62, .70), r);
          wc += vec3(.9, .8, .6) * step(.97, r) * .25;                                     // the odd lit window
          float base = step(vWP.y, 1.1);                                                    // darker ground floor
          // floor slabs + mullions read as real construction
          float slab = smoothstep(.04, 0., abs(f.y - .02)) * (k > .5 ? 1. : .6);
          float mull = k > 1.5 ? smoothstep(.05, 0., min(f.x, 1. - f.x)) : 0.;
          // weathering: soft vertical streaks + large blotches
          float grime = vn(vec2(fc.x * 2.2, vWP.y * .25)) * .5 + vn(fc * .35 + vWP.xz * .05) * .5;
          // real photographed surface (Poly Haven), normalised so it adds texture without shifting the building's colour
          vec3 tw = texture2D(tWall, fc / 7.).rgb / .46, tf = texture2D(tFacade, fc / 5.).rgb / .5;
          vec3 photoT = mix(vec3(1.), mix(tw, tf, step(.5, k) * step(k, 1.5)), .85);
          vec3 wallCol = diffuseColor.rgb * photoT * (.9 + .16 * grime);
          wallCol = mix(wallCol, wallCol * .8, slab);
          vec3 c = mix(wallCol, wc, win * (k < .5 ? .88 : .92) * (1. - base));
          c = mix(c, vec3(.82, .84, .85), mull * .6);
          c *= mix(1., .7, base);
          gWin = win * (1. - base) * wall; gWall = wall;
          // roofs: gravel/membrane with grime
          vec3 tr = texture2D(tRoof, vWP.xz / 6.).rgb / .45;
          vec3 roof = diffuseColor.rgb * .72 * mix(vec3(1.), tr, .9) * (.9 + .2 * vn(vWP.xz * 1.7));
          diffuseColor.rgb = mix(roof, c, wall);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, vKind > 1.5 ? .08 : .2, gWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, vKind > 1.5 ? .55 : .25, gWin);`);
  };
  return m;
}

/** a car: body + cabin merged into one small geometry */
class RoundedCar extends THREE.BufferGeometry {
  constructor() {
    super();
    const body = new THREE.BoxGeometry(1.15, 0.32, 0.52).translate(0, 0.24, 0), cab = new THREE.BoxGeometry(0.62, 0.26, 0.46).translate(-0.05, 0.52, 0);
    const pos: number[] = [], nor: number[] = [];
    for (const g of [body, cab]) { const gi = g.toNonIndexed(); pos.push(...(gi.attributes.position.array as Float32Array)); nor.push(...(gi.attributes.normal.array as Float32Array)); }
    this.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); this.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  }
}
/** CC0 photo textures from Poly Haven (public/textures, see LICENSE.txt), tiled in world space */
const TEX = new Map<string, THREE.Texture>();
function photo(name: string) {
  let t = TEX.get(name);
  if (!t) {
    t = new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'textures/' + name);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace;
    TEX.set(name, t);
  }
  return t;
}
const flat = (color: number, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

// ---------- landmarks ----------
function stadium(rx: number, rz: number, color = 0xd7d2c8) {
  const g = new THREE.Group();
  const shape = new THREE.Shape(); shape.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path(); hole.absellipse(0, 0, rx * 0.72, rz * 0.68, 0, Math.PI * 2, true, 0); shape.holes.push(hole);
  const bowl = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2), flat(color, 0.6));
  bowl.castShadow = bowl.receiveShadow = true; g.add(bowl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 64).rotateX(Math.PI / 2).scale(rx * 0.86, 1, rz * 0.84), flat(0xb83a3a, 0.5)); rim.position.y = 3.25; g.add(rim);
  const field = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(rx * 0.72, 1, rz * 0.68), flat(0x5d8a45, 0.9)); field.position.y = 0.15; field.receiveShadow = true; g.add(field);
  return g;
}
function ringBuilding(r: number, h: number) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.32, 12, 64).rotateX(Math.PI / 2).scale(1, h / (r * 0.64), 1), flat(0xbfc3c4, 0.4, 0.2));
  m.position.y = h / 2; m.castShadow = m.receiveShadow = true; g.add(m);
  const roof = new THREE.Mesh(new THREE.CircleGeometry(r * 0.66, 40).rotateX(-Math.PI / 2), flat(0x6f8f55, 0.9)); roof.position.y = 0.2; g.add(roof);
  return g;
}
function twistTower(h: number) {
  const g = new THREE.Group(); const n = Math.round(h / 1.4);
  for (let i = 0; i < n; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 3.2), flat(i % 2 ? 0x8ea3b2 : 0x9fb3c1, 0.25, 0.4)); s.position.y = i * 1.4 + 0.65; s.rotation.y = i * 0.07; s.castShadow = true; g.add(s); }
  return g;
}

// ---------- the four company buildings: real-looking architecture with the same facade shader ----------
const BMATS = new Map<number, THREE.MeshStandardMaterial>();   // one facade material per colour (clone() would drop the window shader)
/** a non-instanced box/prism with the facade material; kind 0 concrete · 1 office · 2 glass · 3 dark glass */
function facadeMesh(geo: THREE.BufferGeometry, kind: number, color: number) {
  let mat = BMATS.get(color);
  if (!mat) { mat = buildingMaterial(); mat.color.setHex(color); BMATS.set(color, mat); }
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(kind), 1));
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true; return m;
}
/** building sign: company name in plain lettering on a panel (no logos) */
function sign(text: string, bg: string, fg: string, w: number, h: number, glow = 0.25) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = Math.round(1024 * h / w);
  const g = cv.getContext('2d')!; g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = cv.height * 0.62; g.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
  while (g.measureText(text).width > cv.width * 0.86) { fs *= 0.92; g.font = `600 ${fs}px system-ui, -apple-system, sans-serif`; }
  g.fillText(text, cv.width / 2, cv.height * 0.54);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: glow, roughness: 0.5 }));
}
const GLASS = () => new THREE.MeshPhysicalMaterial({ color: 0xa9c4cf, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.55, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });

function companyBuilding(id: string, rnd: () => number) {
  const g = new THREE.Group(); let top = 6;
  const put = <T extends THREE.Object3D>(m: T, x: number, y: number, z: number, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.add(m); return m; };
  const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  // landscaped plaza: paving, planters with trees, a few benches
  const plaza = (w: number, d: number) => {
    put(box(w, 0.25, d, flat(0xcfcabd, 0.9)), 0, 0.125, 0);
    put(box(w - 0.6, 0.05, d - 0.6, flat(0xbdb7a8, 0.95)), 0, 0.27, 0);
    const blob = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 10; i++) {
      const ex = (rnd() < 0.5 ? -1 : 1) * (w / 2 - 0.8), ez = (rnd() - 0.5) * (d - 1.6), alongX = rnd() < 0.5;
      const x = alongX ? (rnd() - 0.5) * (w - 1.6) : ex, z = alongX ? (rnd() < 0.5 ? -1 : 1) * (d / 2 - 0.8) : ez;
      put(box(0.9, 0.35, 0.9, flat(0x8d8a82, 0.9)), x, 0.42, z);
      const tr = new THREE.Mesh(blob, flat(new THREE.Color().setHSL(0.25 + rnd() * 0.05, 0.3, 0.22 + rnd() * 0.06).getHex(), 0.95)); tr.scale.set(0.55, 0.5, 0.55); put(tr, x, 1.05, z);
    }
  };
  // glass lobby + entrance canopy at the front (+z)
  const lobby = (w: number, z: number) => {
    put(new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, 1.6), GLASS()), 0, 0.97, z);
    put(box(w + 1.2, 0.12, 2.6, flat(0xe6e6e2, 0.4, 0.3)), 0, 1.75, z + 0.5);
    for (const x of [-w / 2, w / 2]) put(box(0.12, 1.5, 0.12, flat(0x9aa0a4, 0.4, 0.6)), x - 0.4 * Math.sign(x), 1, z + 1.6);
  };
  const plant = (w: number, d: number, y: number) => { put(box(w, 0.7, d, flat(0x7d8084, 0.8)), (rnd() - 0.5) * w, y + 0.35, (rnd() - 0.5) * d); };

  if (id === 'google') {
    // campus: three glass pavilions under curved translucent canopies, on a landscaped podium with green roofs
    plaza(13, 11);
    const P: Array<[number, number, number, number, number]> = [[-3, -2.2, 5, 4.4, 3.6], [3.2, -2.4, 4.6, 3.8, 3], [0.2, 2.8, 8, 3.6, 4]];
    for (const [x, z, w, d, h] of P) {
      put(facadeMesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), 2, 0x7d95a1), x, 0.3, z);
      // curved glass canopy: a shallow vault spanning the building's depth, running along its length, on thin arched ribs
      const vault = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 32, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), GLASS());
      vault.scale.set(1, 0.42, 1); put(vault, x, h + 0.3, z);
      for (let i = 0; i < 5; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(d / 2, 0.045, 4, 24, Math.PI), flat(0xdfe3e5, 0.3, 0.6)); rib.scale.set(1, 0.42, 1); rib.rotation.y = Math.PI / 2; put(rib, x - w / 2 + (i / 4) * w, h + 0.3, z); }
      put(box(w - 0.4, 0.1, d - 0.4, flat(0x6c8a52, 0.95)), x, h + 0.35, z);
    }
    const sg = sign('Google', '#ffffff', '#3c4043', 3.8, 0.8, 0.15); put(sg, 0, 0.75, 5.52);
    // coloured accent fins by the entrance
    [0x4285f4, 0xea4335, 0xfbbc04, 0x34a853].forEach((c, i) => put(box(0.25, 2.2, 0.25, flat(c, 0.5)), -2.2 + i * 0.5, 1.4, 5.2));
    top = 6.2;
  } else if (id === 'openai') {
    // white hexagonal glass tower: vertical fins, setbacks, lit crown, glass lobby on a plaza
    plaza(11, 11); lobby(5, 3.6);
    let y = 0.3;
    for (const [r, h] of [[3, 7], [2.6, 7], [2.2, 6]] as const) {
      put(facadeMesh(new THREE.CylinderGeometry(r, r, h, 6).translate(0, h / 2, 0), 2, 0x93a7b0), 0, y, 0);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; put(box(0.1, h, 0.35, flat(0xe4e8e8, 0.35, 0.3)), Math.cos(a) * r * 0.99, y + h / 2, Math.sin(a) * r * 0.99, -a); }
      y += h; put(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.15, r + 0.15, 0.3, 6), flat(0xf2f4f4, 0.4)), 0, y + 0.15, 0); y += 0.3;
    }
    put(new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1.2, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9fff7, emissive: 0x9fffe0, emissiveIntensity: 0.6, transparent: true, opacity: 0.8, side: THREE.DoubleSide })), 0, y + 0.6, 0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4, 8), flat(0xcfd6d6, 0.3, 0.7)), 0, y + 3, 0);
    const sg = sign('OpenAI', '#111111', '#ffffff', 3, 0.7, 0.3); put(sg, 0, 2.2, 4.42);
    top = y + 5;
  } else if (id === 'anthropic') {
    // terracotta stepped tower: punched windows, vertical fins, roof gardens on every setback, warm lobby
    plaza(12, 12); lobby(5.4, 4.4);
    let y = 0.3;
    for (const [w, h] of [[7, 7.5], [5.6, 6.5], [4.2, 5]] as const) {
      put(facadeMesh(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), 0, 0xb98468), 0, y, 0);
      for (let k = -2; k <= 2; k++) put(box(0.18, h, 0.35, flat(0x9a624a, 0.7)), k * (w / 5), y + h / 2, w / 2 + 0.1);
      y += h;
      put(box(w + 0.2, 0.25, w + 0.2, flat(0x8f5d47, 0.7)), 0, y + 0.12, 0);
      // roof garden on the setback
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const t = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), flat(0x5f7a45, 0.95)); put(t, Math.cos(a) * w * 0.42, y + 0.6, Math.sin(a) * w * 0.42); }
      y += 0.25;
    }
    plant(1.6, 1.4, y);
    const sg = sign('Anthropic', '#f3ece3', '#3a2c25', 3.6, 0.75, 0.15); put(sg, 0, 2.4, 5.2);
    top = y + 1.5;
  } else {
    // dark-glass slab: big red sign panel, LED band, podium with lobby, rooftop plant
    plaza(12, 10);
    put(facadeMesh(new THREE.BoxGeometry(9, 3, 6).translate(0, 1.5, 0), 1, 0x2c3036), 0, 0.3, 0.8);
    put(facadeMesh(new THREE.BoxGeometry(5.4, 19, 3.6).translate(0, 9.5, 0), 3, 0x22262c), 0, 0.3, -0.6);
    const red = sign('NETFLIX', '#b20710', '#ffffff', 3.4, 7, 0.45); put(red, 0, 12.5, 1.22);
    put(new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.35, 6.1), new THREE.MeshStandardMaterial({ color: 0xb20710, emissive: 0xb20710, emissiveIntensity: 0.4 })), 0, 3.4, 0.8);
    plant(3, 2, 19.3); put(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3, 6), flat(0x888c90, 0.4, 0.6)), 1.6, 21, -0.6);
    top = 22.5;
  }
  return { group: g, top };
}

export function buildCityscape(seed = 11): Diorama {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();

  // reserve: company sites, landmarks
  const reserved: Array<[number, number, number]> = COMPANIES.map((c) => [c.pos[0], c.pos[1], 8] as [number, number, number]);   // room for each landmark's plaza
  const LANDMARKS: Array<{ x: number; z: number; r: number; make: () => THREE.Group }> = [
    { x: -12, z: 34, r: 9, make: () => stadium(8, 6) },
    { x: 24, z: -38, r: 8, make: () => stadium(7, 5.2, 0xc9c4ba) },
    { x: -46, z: -16, r: 7, make: () => ringBuilding(5, 3.4) },
    { x: 30, z: 34, r: 4, make: () => twistTower(22) },
    { x: -44, z: 30, r: 7, make: () => ringBuilding(4.4, 2.6) },
  ];
  LANDMARKS.forEach((l) => reserved.push([l.x, l.z, l.r]));
  const isReserved = (x: number, z: number, pad = 0) => reserved.some(([rx, rz, rr]) => Math.hypot(x - rx, z - rz) < rr + pad);

  // blocks → parks or lots
  const parks: Lot[] = [], lots: Lot[] = [];
  for (let x = X0; x < X1 - 1; x += BLOCK + ROAD) for (let z = Z0; z < Z1; z += BLOCK + ROAD) {
    const cx = x + BLOCK / 2, cz = z + BLOCK / 2;
    if (inPlaza(cx, cz) || inCanal(cx, BLOCK / 2)) continue;
    if (rnd() < 0.1) { parks.push({ x: cx, z: cz, w: BLOCK - 1, d: BLOCK - 1 }); continue; }
    const split = rnd();   // 1, 2 or 4 lots per block
    const n = split < 0.3 ? 1 : split < 0.65 ? 2 : 4;
    const sub = n === 1 ? [[0, 0, 1, 1]] : n === 2 ? (rnd() < 0.5 ? [[-0.25, 0, 0.5, 1], [0.25, 0, 0.5, 1]] : [[0, -0.25, 1, 0.5], [0, 0.25, 1, 0.5]]) : [[-0.25, -0.25, 0.5, 0.5], [0.25, -0.25, 0.5, 0.5], [-0.25, 0.25, 0.5, 0.5], [0.25, 0.25, 0.5, 0.5]];
    const inner = BLOCK - 1.4;
    for (const [ox, oz, fw, fd] of sub) lots.push({ x: cx + ox * inner, z: cz + oz * inner, w: inner * fw - 0.7, d: inner * fd - 0.7 });
  }

  // ground
  const gt = groundTexture(parks);
  const asN = photo('asphalt_02_nor_gl_1k.jpg').clone(); asN.needsUpdate = true; asN.repeat.set(gt.w / 5, gt.h / 5);
  const gMat = new THREE.MeshStandardMaterial({ map: gt.tex, roughness: 0.95, normalMap: asN, normalScale: new THREE.Vector2(0.55, 0.55) });
  gMat.onBeforeCompile = (sh) => {   // photographed asphalt grain multiplied over the painted street map
    sh.uniforms.tAsp = { value: photo('asphalt_02_diff_1k.jpg') }; sh.uniforms.uRep = { value: new THREE.Vector2(gt.w / 5, gt.h / 5) };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tAsp; uniform vec2 uRep;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= mix(vec3(1.), texture2D(tAsp, vMapUv * uRep).rgb / .42, .75);');
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gt.w, gt.h).rotateX(-Math.PI / 2), gMat);
  ground.position.set(X0 + gt.w / 2, 0, Z0 + gt.h / 2); ground.receiveShadow = true; group.add(ground);
  // sea: deep blue-grey, lighter in the shallows by the beach
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x3d6b82, roughness: 0.25, metalness: 0.1 });
  seaMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSW = (modelMatrix * vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vSW;`).replace('#include <color_fragment>', `#include <color_fragment>
      float sh = 1. - smoothstep(0., 22., vSW.x - ${(X1 + 6).toFixed(1)});
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .66, .7), sh * .7);
      diffuseColor.rgb += vec3(.9) * smoothstep(.985, 1., sin(vSW.x * 2.3 + vSW.z * .4) * .5 + .5) * sh * .25;`);
  };
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), seaMat); sea.position.set(X1 + 6 + 350, -0.25, 0); sea.receiveShadow = true; group.add(sea);
  // surroundings beyond the city edge (keeps the horizon from looking cut off)
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), flat(0x6e7466, 0.95)); edge.position.set(X0 - 350 + 0.01, -0.05, 0); group.add(edge);
  for (const zz of [Z0 - 350, Z1 + 350]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(X1 + 6 - X0, 700).rotateX(-Math.PI / 2), flat(0x6e7466, 0.95)); e.position.set((X0 + X1 + 6) / 2, -0.05, zz); group.add(e); }
  const canal = new THREE.Mesh(new THREE.PlaneGeometry(CANAL_W, Z1 - Z0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3e6a73, roughness: 0.15, metalness: 0.2 }));
  canal.position.set(CANAL_X, 0.03, 0); group.add(canal);

  // ordinary buildings: one instanced mesh
  const PAL: Array<[number, number]> = [[0xc9c1b2, 0], [0xb7b3aa, 0], [0xd6cfc2, 0], [0xa9aaa6, 1], [0xc4c6c4, 1], [0x9fb2bf, 2], [0xb2c2cc, 2], [0x3b434c, 3], [0xb98f72, 0], [0x8f8f8a, 1]];
  const items: Array<{ x: number; z: number; w: number; d: number; h: number; c: number; k: number }> = [];
  for (const L of lots) {
    if (isReserved(L.x, L.z, Math.max(L.w, L.d) * 0.5)) continue;
    const dist = Math.hypot(L.x, L.z);
    const tall = rnd() < (dist < 34 ? 0.22 : 0.08);
    const h = tall ? 10 + rnd() * 16 : 2.4 + rnd() * 6;
    const [c, k] = PAL[Math.floor(rnd() * PAL.length)];
    const w = L.w * (0.75 + rnd() * 0.25), d = L.d * (0.75 + rnd() * 0.25);
    items.push({ x: L.x, z: L.z, w, d, h, c, k: tall && rnd() < 0.6 ? 2 + Math.round(rnd()) : k });
    if (tall && rnd() < 0.5) items.push({ x: L.x, z: L.z, w: w * 0.6, d: d * 0.6, h: h + 3 + rnd() * 6, c, k: 2 });   // setback top
  }
  const bGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const kinds = new Float32Array(items.length);
  const blds = new THREE.InstancedMesh(bGeo, buildingMaterial(), items.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion();
  items.forEach((b, i) => {
    m4.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d)); blds.setMatrixAt(i, m4);
    blds.setColorAt(i, col.setHex(b.c).offsetHSL(0, 0, (rnd() - 0.5) * 0.05)); kinds[i] = b.k;
  });
  bGeo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
  blds.castShadow = blds.receiveShadow = true; group.add(blds);
  // rooftop units (small dark boxes)
  const ru = items.filter(() => rnd() < 0.55);
  const roofUnits = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), flat(0x6d6f70, 0.8), ru.length * 2);
  let ri = 0;
  for (const b of ru) for (let j = 0; j < 2; j++) { m4.compose(new THREE.Vector3(b.x + (rnd() - 0.5) * b.w * 0.5, b.h, b.z + (rnd() - 0.5) * b.d * 0.5), q, new THREE.Vector3(0.6 + rnd() * 1.2, 0.4 + rnd() * 0.6, 0.6 + rnd() * 1.2)); roofUnits.setMatrixAt(ri++, m4); }
  roofUnits.castShadow = true; group.add(roofUnits);

  // centre: white dome on the plaza
  { const dome = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(7, 56, 28, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.58, 1), new THREE.MeshStandardMaterial({ color: 0xf4f6f6, roughness: 0.25, metalness: 0.1 }));
    shell.castShadow = shell.receiveShadow = true; dome.add(shell);
    for (let i = 0; i < 12; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(7.04, 0.07, 6, 56, Math.PI).scale(1, 0.58, 1), flat(0xd5d9db, 0.4)); rib.rotation.y = (i * Math.PI) / 12; dome.add(rib); }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(7.3, 7.5, 0.5, 56), flat(0xe6e3dc, 0.6)); base.position.y = 0.25; dome.add(base);
    group.add(dome); }

  // landmarks
  for (const l of LANDMARKS) { const m = l.make(); m.position.set(l.x, 0, l.z); m.rotation.y = rnd() * Math.PI; group.add(m); }

  // company buildings
  const anchors: Anchor[] = [];
  for (const c of COMPANIES) {
    const b = companyBuilding(c.id, rnd); b.group.position.set(c.pos[0], 0, c.pos[1]); b.group.rotation.y = Math.atan2(c.pos[0], c.pos[1]) + Math.PI; group.add(b.group);
    anchors.push({ id: c.id, x: c.pos[0], z: c.pos[1], top: b.top });
  }

  // trees: muted greens, along streets and in parks
  const trees: Array<[number, number, number]> = [];
  for (const p of parks) for (let i = 0; i < 26; i++) trees.push([p.x + (rnd() - 0.5) * p.w * 0.9, p.z + (rnd() - 0.5) * p.d * 0.9, 0.5 + rnd() * 0.5]);
  for (let x = X0; x < X1 - 1; x += BLOCK + ROAD) for (let z = Z0; z < Z1; z += BLOCK + ROAD) {
    for (let i = 0; i < 6; i++) {
      const along = rnd() * BLOCK, sideA = rnd() < 0.5;
      const tx = sideA ? x + along : x + (rnd() < 0.5 ? 0.3 : BLOCK - 0.3), tz = sideA ? z + (rnd() < 0.5 ? 0.3 : BLOCK - 0.3) : z + along;
      if (inPlaza(tx, tz, -1) || inCanal(tx) || isReserved(tx, tz)) continue;
      trees.push([tx, tz, 0.35 + rnd() * 0.25]);
    }
  }
  for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2; trees.push([Math.cos(a) * (R_PLAZA - 0.6), Math.sin(a) * (R_PLAZA - 0.6), 0.45]); }
  // trees: a canopy of 3 overlapping, slightly lumpy blobs each (reads as foliage, not a ball)
  const blobGeo = new THREE.IcosahedronGeometry(1, 2);
  { const p = blobGeo.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(0.88 + 0.24 * Math.abs(Math.sin(v.x * 7.1 + v.y * 5.3 + v.z * 3.7))); p.setXYZ(i, v.x, v.y, v.z); }
    blobGeo.computeVertexNormals(); }
  const foliage = new THREE.InstancedMesh(blobGeo, new THREE.MeshStandardMaterial({ roughness: 0.92 }), trees.length * 3);
  let fi = 0;
  trees.forEach(([x, z, s]) => {
    const hue = 0.22 + rnd() * 0.08, sat = 0.25 + rnd() * 0.15, lum = 0.17 + rnd() * 0.1;
    for (let j = 0; j < 3; j++) {
      const a = rnd() * 6.28, o = s * 0.45;
      m4.compose(new THREE.Vector3(x + Math.cos(a) * o * (j ? 1 : 0), s * (1 + j * 0.25), z + Math.sin(a) * o * (j ? 1 : 0)), q, new THREE.Vector3(s * (0.85 - j * 0.12), s * (0.75 - j * 0.1), s * (0.85 - j * 0.12)));
      foliage.setMatrixAt(fi, m4); foliage.setColorAt(fi, col.setHSL(hue, sat, lum + j * 0.03)); fi++;
    }
  });
  foliage.castShadow = true; foliage.receiveShadow = true; group.add(foliage);

  // traffic: cars in lanes along every street (small rounded boxes, realistic colours)
  const cars: Array<[number, number, number]> = [];
  for (let x = X0 + BLOCK; x < X1 - 1; x += BLOCK + ROAD) for (let z = Z0; z < Z1 - 1; z += 1.6) { const lane = rnd() < 0.5 ? 0.65 : 1.95; const cz = z + rnd(); if (rnd() < 0.32 && !inPlaza(x + lane, cz, 1) && !inCanal(x + lane)) cars.push([x + lane, cz, Math.PI / 2]); }
  for (let z = Z0 + BLOCK; z < Z1 - 1; z += BLOCK + ROAD) for (let x = X0; x < X1 - 1; x += 1.6) { const lane = rnd() < 0.5 ? 0.65 : 1.95; const cx = x + rnd(); if (rnd() < 0.32 && !inPlaza(cx, z + lane, 1) && !inCanal(cx)) cars.push([cx, z + lane, 0]); }
  const CAR_COLS = [0xf2f2f2, 0x1c1c1e, 0x9a9da1, 0x3a4a5e, 0x7a1f1f, 0xd8d6cf, 0x2f3b33];
  const carMesh = new THREE.InstancedMesh(new RoundedCar(), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4, envMapIntensity: 1 }), cars.length);
  cars.forEach(([x, z, r], i) => { m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), new THREE.Vector3(1, 1, 1)); carMesh.setMatrixAt(i, m4); carMesh.setColorAt(i, col.setHex(CAR_COLS[Math.floor(rnd() * CAR_COLS.length)])); });
  carMesh.castShadow = true; group.add(carMesh);

  return { group, anchors, half: Math.max(X1 - X0, Z1 - Z0) / 2 };
}
