import * as THREE from 'three';
import { NOISE } from '../shaders/common';
import { mulberry32 } from './math';
import { logoTexture } from './props';

const VERT = /* glsl */ `
varying vec3 vWP; varying vec3 vWN; varying vec3 vCol; varying float vD;
void main(){
  #ifdef USE_INSTANCING
    mat4 im = instanceMatrix;
  #else
    mat4 im = mat4(1.0);
  #endif
  vec4 wp = modelMatrix * im * vec4(position,1.);
  vWP = wp.xyz; vWN = normalize(mat3(modelMatrix*im) * normal);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #else
    vCol = vec3(1.);
  #endif
  vec4 mv = viewMatrix * wp; vD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform vec3 uFog; uniform float uFogD; uniform float uHi; uniform float uTime; uniform vec3 uTint;
varying vec3 vWP; varying vec3 vWN; varying vec3 vCol; varying float vD;
${NOISE}
void main(){
  vec3 N = normalize(vWN); vec3 L = normalize(vec3(.5,.9,.35));
  float dif = .62 + .38*max(dot(N,L),0.);
  vec3 base = vCol * uTint;
  float side = 1. - step(.5, abs(N.y));
  vec2 wuv = vec2(vWP.x*abs(N.z) + vWP.z*abs(N.x), vWP.y) * vec2(1.7, 1.5);
  vec2 cell = floor(wuv); vec2 f = fract(wuv);
  float win = step(.18,f.x)*step(f.x,.82)*step(.22,f.y)*step(f.y,.78);
  float lit = step(.78, hash21(cell + floor(vWP.xz*.5)));
  vec3 glass = mix(vec3(.5,.7,.82), vec3(1.,.92,.65), lit);
  base = mix(base, glass, win*side*.75);
  if(N.y > .5) base = mix(base, vec3(.95,.97,.97), .35);
  vec3 col = base * dif;
  float fres = pow(1. - abs(N.y), 2.) * .0;
  col += vec3(.2,1.,.7) * uHi * (.3 + .5*(.5+.5*sin(uTime*4.)));
  col = mix(col, uFog, 1. - exp(-vD * uFogD));
  gl_FragColor = vec4(col, 1.);
}`;

export function cityMaterial(fog = new THREE.Color(0.86, 0.95, 0.96), fogD = 0.012) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uFog: { value: fog }, uFogD: { value: fogD }, uHi: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } },
  });
}

export interface Campus { name: string; group: THREE.Group; mats: THREE.ShaderMaterial[]; hi: number; pos: THREE.Vector3; logo: THREE.Mesh }
export interface City {
  group: THREE.Group; campuses: Campus[]; dome: THREE.Mesh; ring: THREE.Mesh; materials: THREE.ShaderMaterial[]; update(t: number): void;
}

const NAMES = ['NOVA', 'ORBITAL', 'LUMEN', 'KITEWORKS', 'HELIX', 'PIXELFORGE', 'MOSSCORP', 'QUARK'];

export function buildCity(opts: { fog: THREE.Color; fogD: number; density?: number; seed?: number } = { fog: new THREE.Color(0.86, 0.95, 0.96), fogD: 0.012 }): City {
  const rnd = mulberry32(opts.seed ?? 11);
  const group = new THREE.Group();
  const mats: THREE.ShaderMaterial[] = [];
  const mat = cityMaterial(opts.fog, opts.fogD); mats.push(mat);
  const N = 15, S = 3.4, half = (N - 1) / 2;
  const palette = [0xe8eef0, 0xcfe3e6, 0xb7d3dc, 0xf3f5f2, 0xa9c8c2, 0xd8e6f0].map((c) => new THREE.Color(c));
  const boxes: Array<{ x: number; z: number; w: number; d: number; h: number; c: THREE.Color }> = [];
  const campusCells = new Set<string>(['-4,-3', '3,-4', '5,2', '-5,3', '0,-6', '-2,5', '4,5', '-6,-1']);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const ci = i - half, cj = j - half;
    if (Math.hypot(ci, cj) < 2.6) continue; // central plaza
    if (campusCells.has(`${ci},${cj}`)) continue;
    if (rnd() < 0.12) continue;
    const dist = Math.hypot(ci, cj);
    const h = (0.8 + rnd() * 2.6) * (1.6 - dist / 12) + (rnd() < 0.15 ? 3 : 0);
    const w = 1.6 + rnd() * 1.0, d = 1.6 + rnd() * 1.0;
    boxes.push({ x: ci * S, z: cj * S, w, d, h: Math.max(0.7, h), c: palette[Math.floor(rnd() * palette.length)] });
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length);
  const m4 = new THREE.Matrix4();
  boxes.forEach((b, i) => {
    m4.compose(new THREE.Vector3(b.x, b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
    inst.setMatrixAt(i, m4); inst.setColorAt(i, b.c);
  });
  inst.frustumCulled = false;
  group.add(inst);
  // ground
  const gm = new THREE.ShaderMaterial({
    uniforms: { uFog: { value: opts.fog }, uFogD: { value: opts.fogD } },
    vertexShader: 'varying vec3 vW; varying float vD; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }',
    fragmentShader: `uniform vec3 uFog; uniform float uFogD; varying vec3 vW; varying float vD; ${NOISE}
      void main(){ vec2 q = vW.xz/${S.toFixed(1)} + .5; vec2 f = abs(fract(q)-.5); float road = step(.5-.12, max(f.x,f.y));
        vec3 g = mix(vec3(.62,.82,.66), vec3(.74,.9,.72), fbm(vW.xz*.15)); vec3 r = vec3(.55,.62,.64);
        vec3 col = mix(g, r, road); float dash = step(.5, fract((vW.x+vW.z)*.6)) * step(.5-.02, max(f.x,f.y)) * step(max(f.x,f.y), .5-.1+.1); col = mix(col, vec3(.9), dash*road*.3);
        float edge = 1.-smoothstep(25.,52.,length(vW.xz)); col = mix(uFog, col, edge); col = mix(col, uFog, 1.-exp(-vD*uFogD)); gl_FragColor = vec4(col,1.); }`,
  });
  mats.push(gm);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), gm);
  ground.rotation.x = -Math.PI / 2; group.add(ground);
  // trees
  const treeG = new THREE.IcosahedronGeometry(0.4, 1);
  const trees = new THREE.InstancedMesh(treeG, mat, 160);
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2, r = 5 + rnd() * 34;
    m4.compose(new THREE.Vector3(Math.cos(a) * r + (rnd() - .5) * 2, 0.35, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(1, 1.2, 1).multiplyScalar(0.6 + rnd() * 0.8));
    trees.setMatrixAt(i, m4); trees.setColorAt(i, new THREE.Color().setHSL(0.33 + rnd() * 0.06, 0.45, 0.42 + rnd() * 0.12));
  }
  group.add(trees);
  // campuses (invented brands)
  const campuses: Campus[] = [];
  const cells = [...campusCells].map((s) => s.split(',').map(Number));
  cells.forEach(([ci, cj], idx) => {
    const g = new THREE.Group();
    const m = cityMaterial(opts.fog, opts.fogD); mats.push(m);
    const col = new THREE.Color().setHSL(0.45 + idx * 0.07, 0.35, 0.78);
    m.uniforms.uTint.value = col;
    const kind = idx % 4;
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); g.add(me); return me; };
    if (kind === 0) { add(new THREE.BoxGeometry(2.6, 1.2, 2.6), 0, 0.6, 0); add(new THREE.BoxGeometry(2.0, 1.2, 2.0), 0, 1.8, 0); add(new THREE.BoxGeometry(1.4, 1.2, 1.4), 0, 3.0, 0); }
    else if (kind === 1) { add(new THREE.CylinderGeometry(1.2, 1.4, 4.6, 28), 0, 2.3, 0); add(new THREE.CylinderGeometry(1.8, 1.8, 0.4, 28), 0, 0.2, 0); }
    else if (kind === 2) { const a = add(new THREE.BoxGeometry(3.0, 1.6, 1.4), 0, 0.8, 0); a.rotation.y = 0.3; const b = add(new THREE.BoxGeometry(1.4, 3.6, 1.4), 1.0, 1.8, 0.6); b.rotation.y = 0.3; }
    else { add(new THREE.BoxGeometry(2.8, 0.8, 2.8), 0, 0.4, 0); add(new THREE.SphereGeometry(1.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.8, 0); add(new THREE.BoxGeometry(0.8, 3.2, 0.8), 1.2, 1.6, 1.2); }
    g.position.set(ci * S, 0, cj * S);
    group.add(g);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ map: logoTexture(idx + 2), side: THREE.DoubleSide }));
    logo.position.set(ci * S, 5.6, cj * S); group.add(logo);
    campuses.push({ name: NAMES[idx % NAMES.length], group: g, mats: [m], hi: 0, pos: g.position, logo });
  });
  // dome / pavilion
  const dm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=-mv.xyz; gl_Position=projectionMatrix*mv; }',
    fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; void main(){ vec3 N=normalize(vN), V=normalize(vV); float f=pow(1.-abs(dot(N,V)),2.2);
      vec3 ir = .5+.5*cos(6.28*(f*.8+vec3(0.,.33,.67)+uTime*.05)); vec3 col = mix(vec3(.6,1.,.9), ir, .5) ; gl_FragColor=vec4(col*(.5+f), .12 + f*.7); }`,
  });
  mats.push(dm);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), dm);
  group.add(dome);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.8, 16), mat); core.position.y = 0.9; group.add(core);
  const rm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float uTime; varying vec2 vUv; void main(){ vec2 q=vUv-.5; float r=length(q)*2.; float p=fract(uTime*.35); float ring=smoothstep(.06,0.,abs(r-(.55+p*.45)))*(1.-p); float base=smoothstep(.04,0.,abs(r-.62))*.8; vec3 c=vec3(.2,1.,.55); gl_FragColor=vec4(c*(ring*1.4+base+.1*smoothstep(1.,.3,r)), (ring+base)*.9+.05*smoothstep(1.,.3,r)); }',
  });
  mats.push(rm);
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), rm);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; group.add(ring);
  return {
    group, campuses, dome, ring, materials: mats,
    update(t) { mats.forEach((m) => { if (m.uniforms.uTime) m.uniforms.uTime.value = t; }); },
  };
}
