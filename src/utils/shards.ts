import * as THREE from 'three';
import { mulberry32 } from './math';

type V2 = [number, number];
function clip(poly: V2[], nx: number, ny: number, d: number): V2[] {
  // keep points where nx*x+ny*y <= d
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - d, db = nx * b[0] + ny * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * Voronoi-fractured plane (w×h, centred). Attributes:
 *  aCenter (vec3 shard centroid), aRand (vec4: r1,r2,r3, normalised distance from impact), aEdge (0 at border → 1 at centre)
 */
export function buildShards(w: number, h: number, count: number, seed: number, thick = 0.05, impact = new THREE.Vector2(0, 0)) {
  const rnd = mulberry32(seed);
  const cols = Math.max(2, Math.round(Math.sqrt((count * w) / h)));
  const rows = Math.max(2, Math.round(count / cols));
  const cw = w / cols, ch = h / rows;
  const seeds: V2[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    seeds.push([-w / 2 + (i + 0.5 + (rnd() - 0.5) * 0.85) * cw, -h / 2 + (j + 0.5 + (rnd() - 0.5) * 0.85) * ch]);
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], cen: number[] = [], ran: number[] = [], edge: number[] = [];
  let maxD = 0;
  const cells: Array<{ poly: V2[]; c: V2 }> = [];
  for (let s = 0; s < seeds.length; s++) {
    let poly: V2[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    const [sx, sy] = seeds[s];
    for (let o = 0; o < seeds.length && poly.length > 2; o++) {
      if (o === s) continue;
      const [ox, oy] = seeds[o];
      const dx = ox - sx, dy = oy - sy;
      if (dx * dx + dy * dy > (cw + ch) * (cw + ch) * 4) continue;
      const mx = (sx + ox) / 2, my = (sy + oy) / 2;
      poly = clip(poly, dx, dy, dx * mx + dy * my);
    }
    if (poly.length < 3) continue;
    let cx = 0, cy = 0; poly.forEach((p) => { cx += p[0]; cy += p[1]; }); cx /= poly.length; cy /= poly.length;
    cells.push({ poly, c: [cx, cy] });
    maxD = Math.max(maxD, Math.hypot(cx - impact.x, cy - impact.y));
  }
  const push = (x: number, y: number, z: number, nz: number, nx2: number, ny2: number, c: V2, r: number[], e: number) => {
    pos.push(x, y, z); nor.push(nx2, ny2, nz); uv.push(x / w + 0.5, y / h + 0.5);
    cen.push(c[0], c[1], 0); ran.push(r[0], r[1], r[2], r[3]); edge.push(e);
  };
  for (const { poly, c } of cells) {
    const r = [rnd(), rnd(), rnd(), Math.hypot(c[0] - impact.x, c[1] - impact.y) / (maxD || 1)];
    const z0 = thick / 2, z1 = -thick / 2;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      // front (ccw seen from +z)
      push(c[0], c[1], z0, 1, 0, 0, c, r, 1); push(a[0], a[1], z0, 1, 0, 0, c, r, 0); push(b[0], b[1], z0, 1, 0, 0, c, r, 0);
      // back
      push(c[0], c[1], z1, -1, 0, 0, c, r, 1); push(b[0], b[1], z1, -1, 0, 0, c, r, 0); push(a[0], a[1], z1, -1, 0, 0, c, r, 0);
      // side
      const ex = b[0] - a[0], ey = b[1] - a[1]; const l = Math.hypot(ex, ey) || 1; const nx = ey / l, ny = -ex / l;
      push(a[0], a[1], z0, 0, nx, ny, c, r, 0); push(a[0], a[1], z1, 0, nx, ny, c, r, 0); push(b[0], b[1], z1, 0, nx, ny, c, r, 0);
      push(a[0], a[1], z0, 0, nx, ny, c, r, 0); push(b[0], b[1], z1, 0, nx, ny, c, r, 0); push(b[0], b[1], z0, 0, nx, ny, c, r, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(cen, 3));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(ran, 4));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  return g;
}

/** GLSL: rotate vector v around unit axis by angle */
export const ROT_GLSL = /* glsl */ `
vec3 rotAx(vec3 v, vec3 ax, float a){ ax = normalize(ax); float c = cos(a), s = sin(a); return v*c + cross(ax,v)*s + ax*dot(ax,v)*(1.-c); }
`;
