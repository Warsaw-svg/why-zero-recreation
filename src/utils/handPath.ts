import * as THREE from 'three';
import type { HandPose } from './Hand';
import { P } from '../core/progressMap';

/**
 * The green hand's journey from the open reach (end of the green-hand scene) to the "Creation of Adam" pose in the
 * meadow, keyed to GLOBAL scroll progress so the College and meadow scenes draw the identical hand during their
 * crossfade. Matched to recording/component 2.mov at 1 fps (11.5 s → 18.5 s):
 *   open reach → lifts up-right turning palm-down → long flat reach right → drifts left, fingers relaxing →
 *   upper left, palm down, fingers drooping toward the centre.
 * Orientation is given as (finger direction, palm normal); with Hand.showBack(false) the palm faces local +Z.
 */
export const PATH_START = P(0.172);
export const PATH_END = P(0.315);
type Key = { p: number; pos: THREE.Vector3; q: THREE.Quaternion; s: number; pose: HandPose };

const basis = (fingers: [number, number, number], palm: [number, number, number]) => {
  const y = new THREE.Vector3(...fingers).normalize();
  const z = new THREE.Vector3(...palm); z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
};
const OPEN: HandPose = { index: 0.06, middle: 0.08, ring: 0.1, pinky: 0.14, thumb: 0.06, spread: 0.6, thumbIn: 0.5 };
export const ADAM_GREEN: HandPose = { index: 0.06, middle: 0.26, ring: 0.34, pinky: 0.42, thumb: 0.12, spread: 0.4, thumbIn: 0.45 };
export const KEYS: Key[] = [
  { p: P(0.172), pos: new THREE.Vector3(0.85, -1.5, 0), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.45, -0.75)), s: 2.5, pose: OPEN },
  { p: P(0.205), pos: new THREE.Vector3(1.05, -0.75, 0), q: basis([0.55, 0.8, 0.12], [0.25, -0.75, 0.55]), s: 2.25, pose: OPEN },
  { p: P(0.235), pos: new THREE.Vector3(0.35, 0.45, 0), q: basis([0.97, 0.18, 0.1], [0, -0.7, 0.7]), s: 2.0, pose: { ...OPEN, index: 0.08, middle: 0.12, ring: 0.16, pinky: 0.2, spread: 0.4 } },
  { p: P(0.27), pos: new THREE.Vector3(-0.85, 0.45, 0), q: basis([0.94, -0.25, 0.1], [-0.1, -0.85, 0.5]), s: 1.8, pose: { ...ADAM_GREEN, middle: 0.18, ring: 0.24, pinky: 0.3 } },
  { p: P(0.315), pos: new THREE.Vector3(-1.85, 0.45, 0), q: basis([0.9, -0.38, 0.12], [-0.2, -0.85, 0.45]), s: 1.65, pose: ADAM_GREEN },
];

const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();

/** place the green hand for a global scroll progress p; aim (eased cursor) and t add the open reach's gentle lean/sway */
export function setHandOnPath(g: THREE.Object3D, p: number, aimX: number, aimY: number, t: number): HandPose {
  const n = KEYS.length;
  const pc = Math.min(KEYS[n - 1].p, Math.max(KEYS[0].p, p));
  let i = 0; while (i < n - 2 && pc > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1], a0 = KEYS[Math.max(0, i - 1)], b1 = KEYS[Math.min(n - 1, i + 2)];
  const u = (pc - a.p) / (b.p - a.p);
  g.position.set(cr(a0.pos.x, a.pos.x, b.pos.x, b1.pos.x, u), cr(a0.pos.y, a.pos.y, b.pos.y, b1.pos.y, u), cr(a0.pos.z, a.pos.z, b.pos.z, b1.pos.z, u));
  g.scale.setScalar(cr(a0.s, a.s, b.s, b1.s, u));
  g.quaternion.copy(a.q).slerp(b.q, u * u * (3 - 2 * u) * 0.35 + u * 0.65);
  // lean toward the cursor while still in the open reach, fading out along the path; a slow sway keeps it alive
  const lean = 1 - Math.min(1, (pc - PATH_START) / (P(0.212) - P(0.172)));
  tmpE.set(-aimY * 0.12 * lean + Math.sin(t * 0.6) * 0.03, 0, -aimX * 0.15 * lean + Math.sin(t * 0.45) * 0.03);
  g.quaternion.multiply(tmpQ.setFromEuler(tmpE));
  g.position.x += aimX * 0.25 * lean; g.position.y += aimY * 0.15 * lean;
  const o = {} as HandPose;
  (['index', 'middle', 'ring', 'pinky', 'thumb'] as const).forEach((k, j) => (o[k] = a.pose[k] + (b.pose[k] - a.pose[k]) * u + Math.sin(t * 1.1 + j * 0.7) * 0.025 + 0.025));
  o.spread = (a.pose.spread ?? 1) + ((b.pose.spread ?? 1) - (a.pose.spread ?? 1)) * u;
  o.thumbIn = (a.pose.thumbIn ?? 0) + ((b.pose.thumbIn ?? 0) - (a.pose.thumbIn ?? 0)) * u;
  return o;
}
