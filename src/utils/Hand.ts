import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AssetLoader } from '../core/AssetLoader';
import { NOISE } from '../shaders/common';

/** Procedural stylised hand (stand-in for a CC-licensed GLB). Fingers along +Y, palm faces +Z. */
const VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vWN; varying vec3 vObj; varying float vJoint; varying float vThin; varying float vPalm;
uniform float uDisp; uniform float uInflate;
${NOISE}
#include <skinning_pars_vertex>
void main(){
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  transformed += normalize(objectNormal) * ((fbm(transformed.xy * 26. + transformed.z * 17. + 3.) - .5) * uDisp + uInflate);   // clay lumps + chunkier fingers (closes the gaps in a fist)
  vec4 mv = modelViewMatrix * vec4(transformed,1.);
  vObj = position;
  vJoint = 0.; vThin = 0.; vPalm = 0.;
  #ifdef USE_SKINNING
    // joints = where two bones share a vertex (creases); thin = distal/intermediate phalanges (light shines through)
    vJoint = 1. - max(max(skinWeight.x, skinWeight.y), max(skinWeight.z, skinWeight.w));
    vec4 si = skinIndex;
    for (int i = 0; i < 4; i++) {
      float b = i == 0 ? si.x : i == 1 ? si.y : i == 2 ? si.z : si.w;
      float w = i == 0 ? skinWeight.x : i == 1 ? skinWeight.y : i == 2 ? skinWeight.z : skinWeight.w;
      float m = mod(b, 5.);   // per finger: 0 metacarpal, 1 proximal, 2 intermediate, 3 distal, 4 tip (thumb is shifted by one)
      if (b > .5 && (m > 2.5 || (b > 4.5 && m > 1.5))) vThin += w;
      if (b < .5 || b < 1.5 || (b > 4.5 && m < .5)) vPalm += w;   // wrist + metacarpals = palm (no finger creases there)
    }
  #endif
  vN = normalize(normalMatrix * objectNormal);
  vWN = normalize(mat3(modelMatrix) * objectNormal);
  vV = -mv.xyz; vP = (modelMatrix*vec4(transformed,1.)).xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform float uMode; uniform float uDesat; uniform float uMono; uniform vec3 uMonoTint; uniform float uTime; uniform float uOpacity;
uniform vec3 uRim; uniform float uRimK; uniform float uFacet; uniform vec3 uBase; uniform float uGlow;
uniform float uRagged; uniform float uSoft;
uniform float uFadeY; uniform float uFadeW; uniform vec3 uFadeCol; uniform vec3 uFadeDir; uniform vec3 uFadeDir2; uniform float uFadeY2; uniform float uFadeW2;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vWN; varying vec3 vObj; varying float vJoint; varying float vThin; varying float vPalm;
uniform vec3 uAlb; uniform vec3 uAlb2; uniform vec3 uSSS; uniform float uSpec; uniform float uRough; uniform float uRimSSS;
${NOISE}
vec3 pal(float t){ return .5 + .5*cos(6.2831*(vec3(1.,1.,1.)*t + vec3(0.0,0.33,0.67))); }
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  if(uFacet > 0.01){ vec3 fn = normalize(cross(dFdx(-vV), dFdy(-vV))); N = normalize(mix(N, fn, uFacet)); }
  float fres = pow(1. - max(dot(N,V),0.), 3.0);
  vec3 L = normalize(vec3(.5,.8,.7));
  float ndl = dot(N,L);
  vec3 col;
  if(uMode < .5){
    // glossy iridescent "fancy" green via matcap-like lookup
    vec2 mc = N.xy*.5+.5;
    vec3 base = mix(vec3(.02,.28,.2), uBase, smoothstep(.0,1.,mc.y*.8+.2));
    float irid = fres*1.2 + N.y*.25 + .1*sin(vP.y*3.+uTime*.5);
    vec3 ir = pal(irid*.6+.35) ;
    col = base + ir*fres*.55;
    float spec = pow(max(dot(reflect(-L,N),V),0.), 48.);
    col += vec3(1.,1.,.95)*spec*.9;
    float spec2 = pow(max(dot(reflect(-normalize(vec3(-.6,.2,.8)),N),V),0.), 32.);
    col += vec3(.6,1.,.9)*spec2*.5;
    col += uRim*fres*uRimK;
  } else if(uMode < 1.5){
    // skin: wrapped lambert + subsurface-ish tint + backlight rim
    float wrap = clamp((ndl+.5)/1.5, 0., 1.);
    vec3 skin = mix(vec3(.45,.2,.16), vec3(.93,.68,.55), wrap);
    skin += vec3(.5,.1,.05)*pow(1.-max(dot(N,V),0.), 2.)*.35;
    float spec = pow(max(dot(reflect(-L,N),V),0.), 30.);
    col = skin + spec*.25;
    float back = pow(1.-max(dot(N,V),0.), 2.5) * smoothstep(-.4,.6,-ndl+.4);
    col += uRim*back*uRimK;
  } else if(uMode > 3.5){
    // REALISTIC SKIN (human or green-tinted): wrapped diffuse with a red/cyan scattering terminator, translucency through
    // thin fingers, pores + knuckle creases from object-space noise and skin weights, sky/ground fill, soft GGX sheen
    vec3 op = vObj * 160.;
    float pore = vnoise(op.xy + op.z * 1.3) * .6 + vnoise(op.yz * 2.1 + 4.) * .4;               // soft skin tone variation (no aliasing)
    float crease = smoothstep(.2, .6, vJoint) * (1. - smoothstep(.3, .7, vPalm));             // knuckles only, not the palm
    vec3 Nb = N;
    vec3 Lk = normalize(vec3(.45, .75, .5));
    float ndl = dot(Nb, Lk);
    float wrap = clamp((ndl + .2) / 1.2, 0., 1.);
    float term = smoothstep(-.35, .25, ndl) * (1. - smoothstep(.25, .8, ndl));                // light bleeding past the shadow edge
    vec3 alb = mix(uAlb, uAlb2, clamp(crease * .45 + vThin * .3 + (pore - .5) * .25, 0., 1.)); // redder knuckles + fingertips
    alb *= 1. - crease * .07;                                                                  // knuckle creases
    vec3 sky = mix(vec3(.55, .62, .55), vec3(.95, 1., 1.05), vWN.y * .5 + .5);                 // ground bounce → sky
    vec3 dif = alb * (wrap * vec3(1.04, .99, .94) * 1.0 + sky * .24) + uSSS * term * .3;
    float back = pow(clamp(dot(V, -Lk) * .5 + .5, 0., 1.), 3.) * (.25 + vThin * .9);             // light through thin parts
    dif += uSSS * back * .55;
    dif += uSSS * pow(1. - max(dot(N, V), 0.), 3.) * uRimSSS;                                 // scattering rim (cyan on the green hand, faint on skin)
    vec3 H = normalize(Lk + V);
    float a2 = uRough * uRough * uRough * uRough;
    float nh = max(dot(Nb, H), 0.);
    float D = a2 / (3.1416 * pow(nh * nh * (a2 - 1.) + 1., 2.));
    float F = .028 + .972 * pow(1. - max(dot(V, H), 0.), 5.);
    float spec = D * F * max(ndl, 0.) * uSpec * (.75 + pore * .5);
    float sheen = pow(1. - max(dot(Nb, V), 0.), 4.) * .18;
    col = dif + vec3(1., .98, .95) * spec + sky * sheen;
    col *= mix(.9, 1., smoothstep(.0, .35, abs(dot(N, V))));                                  // soft contact/edge occlusion
  } else if(uMode > 2.5){
    // glossy green plastic (reference "green hand"): saturated green, lit tops, cyan bounce underneath, soft sheen
    vec3 Lk = normalize(vec3(-.3, .8, .6));
    float dk = dot(N, Lk) * .5 + .5;
    vec3 b = mix(vec3(.06, .46, .14), vec3(.22, .80, .22), smoothstep(.2, .62, dk));
    b = mix(b, vec3(.50, .95, .36), smoothstep(.72, .98, dk));
    b = mix(b, vec3(.42, .90, .86), smoothstep(.15, -.65, N.y) * .5);
    float fg = pow(1. - max(dot(N, V), 0.), 2.5);
    b += vec3(.55, 1., .95) * fg * .3;
    b += vec3(1.) * pow(max(dot(reflect(-Lk, N), V), 0.), 60.) * .35;
    col = b;
  } else {
    // sculpted clay (uRagged 1 = eaten-away silhouette for the hand under the ice; 0 = clean clay): lumpy surface (height-noise bump), partly faceted, lit from the upper left;
    // light -> colour ramp: cyan in shadow, green mid-tones, lime, yellow on the lit tops; undersides lean cyan
    float hgt = fbm(vP.xy * 2.2 + vP.z * 1.7) + fbm(vP.xy * 6.5 - vP.z) * .35;
    vec3 Nb = normalize(N - vec3(dFdx(hgt), dFdy(hgt), 0.) * 18.);   // stronger clay lumps
    vec3 fn = normalize(cross(dFdx(-vV), dFdy(-vV)));
    Nb = normalize(mix(Nb, fn, .45));
    vec3 Lk = normalize(vec3(-.45, .75, .55));
    float dk = dot(Nb, Lk) * .5 + .5;
    float up = Nb.y * .5 + .5;
    float k = clamp(dk * .95 + up * .3 - .16, 0., 1.);              // more contrast: deeper shadows, brighter tops
    vec3 cyanC = vec3(.40, .80, .92), greenC = vec3(.22, .62, .26), limeC = vec3(.52, .86, .28), yelC = vec3(.90, .95, .45);
    vec3 b = mix(cyanC, greenC, smoothstep(.18, .42, k));
    b = mix(b, limeC, smoothstep(.42, .66, k));
    b = mix(b, yelC, smoothstep(.70, .92, k));
    b = mix(b, cyanC * 1.05, smoothstep(.55, .05, up) * .45);
    b += vec3(1.) * pow(max(dot(reflect(-Lk, Nb), V), 0.), 24.) * .25;
    b *= mix(.72, 1., smoothstep(.05, .5, abs(dot(N, V))));       // darker creases keep folded fingers readable
    col = b;
    // ragged, eaten-away silhouette
    float edge = 1. - max(dot(N,V),0.);
    if(uRagged > .5 && fbm(vP.xy*9. + uTime*.08) < edge*1.0 - .52) discard;
  }
  float lum = dot(col, vec3(.299,.587,.114));
  col = mix(col, vec3(lum), uDesat);
  col = mix(col, vec3(lum)*uMonoTint*1.4, uMono);
  col += uRim*uGlow*fres;
  // sinks into a liquid surface: below uFadeY the hand dissolves into uFadeCol
  float ph = dot(vP, uFadeDir);
  float fy = smoothstep(uFadeY, uFadeY + uFadeW, ph);
  col = mix(uFadeCol, col, fy);
  // second plane: the hand always dissolves softly just past the wrist (there is no forearm piece)
  float ph2 = dot(vP, uFadeDir2);
  float a2 = smoothstep(uFadeY2, uFadeY2 + uFadeW2, ph2);
  // optional soft focus (default 0 = off): silhouette feathers out, highlights soften — reads as a slightly blurred hand
  float nvS = abs(dot(normalize(vN), normalize(vV)));
  col = mix(col, vec3(dot(col, vec3(.333))) * .35 + col * .65, uSoft * .25);
  float softA = mix(1., smoothstep(0., .75, nvS) * .85, uSoft);
  gl_FragColor = vec4(col, uOpacity * smoothstep(uFadeY - uFadeW * .35, uFadeY + uFadeW * .5, ph) * a2 * softA);
}`;

/** realistic skin parameters: albedo, albedo at knuckles/tips, scattering colour, specular, roughness */
function skinParams(mode: string): Record<string, THREE.IUniform> {
  const green = mode === 'realGreen';
  return {
    uAlb: { value: green ? new THREE.Color(0.34, 0.95, 0.26) : new THREE.Color(0.82, 0.62, 0.52) },
    uAlb2: { value: green ? new THREE.Color(0.24, 0.88, 0.36) : new THREE.Color(0.8, 0.5, 0.44) },
    uSSS: { value: green ? new THREE.Color(0.35, 0.95, 0.8) : new THREE.Color(0.95, 0.3, 0.2) },
    uSpec: { value: green ? 1.1 : 0.35 },
    uRough: { value: green ? 0.32 : 0.48 },
    uRimSSS: { value: green ? 0.55 : 0.08 },
  };
}
export type HandMode = 'fancy' | 'skin' | 'lime' | 'clay' | 'glossy' | 'real' | 'realGreen';
export function makeHandMaterial(mode: HandMode, base = 0x2fd6a0) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, transparent: true,
    uniforms: {
      uMode: { value: mode === 'fancy' ? 0 : mode === 'skin' ? 1 : mode === 'lime' || mode === 'clay' ? 2 : mode === 'glossy' ? 3 : 4 },
      uRagged: { value: mode === 'lime' ? 1 : 0 },
      ...skinParams(mode), uDisp: { value: mode === 'lime' ? 0.0022 : mode === 'clay' ? 0.0016 : 0 }, uInflate: { value: mode === 'lime' ? 0.0034 : mode === 'clay' ? 0.0022 : mode === 'glossy' ? 0.0026 : 0 },
      uSoft: { value: 0 }, uFadeY: { value: -1e4 }, uFadeDir: { value: new THREE.Vector3(0, 1, 0) }, uFadeY2: { value: -1e4 }, uFadeDir2: { value: new THREE.Vector3(0, 1, 0) }, uFadeW2: { value: 0.5 }, uFadeW: { value: 0.5 }, uFadeCol: { value: new THREE.Color(0.45, 0.85, 0.86) }, uDesat: { value: 0 }, uMono: { value: 0 }, uMonoTint: { value: new THREE.Color(0.35, 0.8, 0.5) },
      uTime: { value: 0 }, uOpacity: { value: 1 }, uRim: { value: new THREE.Color(mode === 'fancy' ? 0x9ffff0 : 0xff5a3a) }, uRimK: { value: mode === 'fancy' ? 0.7 : 1.2 },
      uFacet: { value: 0 }, uBase: { value: new THREE.Color(base) }, uGlow: { value: 0 },
    },
  });
}

/** curl per finger (0 straight → 1 folded); spread 1 = the rig's natural fan, 0 = fingers drawn together */
export interface HandPose { index: number; middle: number; ring: number; pinky: number; thumb: number; spread?: number; /** extra bend at the big knuckle only (radians), e.g. a finger pointing toward the viewer */ mcp?: Partial<Record<'index' | 'middle' | 'ring' | 'pinky', number>>; /** 0 = rig's wide thumb, 1 = thumb drawn in beside the index and slightly across the palm */ thumbIn?: number }
export const POSES: Record<string, HandPose> = {
  open: { index: 0.06, middle: 0.08, ring: 0.1, pinky: 0.14, thumb: 0.1 },
  /** relaxed, about to shake hands: fingers together and softly curved, thumb up */
  shake: { index: 0.08, middle: 0.1, ring: 0.12, pinky: 0.15, thumb: 0.05, spread: 0.12, thumbIn: 0.55 },
  /** reaching, fingers loosely together */
  reach: { index: 0.08, middle: 0.14, ring: 0.18, pinky: 0.24, thumb: 0.12, spread: 0.3, thumbIn: 0.45 },
  point: { index: 0.02, middle: 0.35, ring: 0.45, pinky: 0.55, thumb: 0.2 },
  adam: { index: 0.0, middle: 0.2, ring: 0.28, pinky: 0.36, thumb: 0.22 },
  fist: { index: 1, middle: 1, ring: 1, pinky: 1, thumb: 0.8 },
  fistPoint: { index: 0.0, middle: 1.0, ring: 1.0, pinky: 1.0, thumb: 0.9 },
  /** relaxed point (reference intro hand): index up, the other three loosely curled (not a tight fist), thumb out to the side */
  pointLoose: { index: 0.0, middle: 0.58, ring: 0.66, pinky: 0.72, thumb: 0.12, spread: 0.75, thumbIn: 0.0 }, // pointing: index out, the rest folded into a fist
};

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
/** local-axis curl direction per joint; calibrated against the WebXR generic-hand rig */
const HAND_SCALE = 7.4;
const CURL_SIGN = -1; // fingers fold toward the real palm of this right-hand mesh (thumb on the viewer's right when the palm faces you)

export class Hand {
  /** real skinned hand mesh (MIT, @webxr-input-profiles/assets) – loaded once, cloned per Hand */
  static template: GLTF | null = null;
  static async preload(assets: AssetLoader) { Hand.template = await assets.loadGLB('/assets/hand.glb'); return Hand.template; }

  readonly group = new THREE.Group();
  readonly mat: THREE.ShaderMaterial;
  private fingers: Record<string, THREE.Group[]> = {};
  /** finger chains for forward kinematics (this rig is FLAT: every joint is a direct child of the armature) */
  private chains: Record<string, { axis: THREE.Vector3; dir: THREE.Vector3; joints: Array<{ b: THREE.Bone; rp: THREE.Vector3; rq: THREE.Quaternion }> }> = {};
  private palmN = new THREE.Vector3();
  private real = false;
  private fit: THREE.Group | null = null;
  tip = new THREE.Object3D(); // index fingertip marker
  constructor(mode: HandMode, base?: number, public scale = 1) {
    this.mat = makeHandMaterial(mode, base);
    if (Hand.template) { this.buildReal(); this.showBack(false); this.setPose(POSES.open); this.group.scale.setScalar(scale); return; }
    this.buildProcedural();
  }
  private buildReal() {
    this.real = true;
    const root = cloneSkinned(Hand.template!.scene);
    root.traverse((o) => { const sm = o as THREE.SkinnedMesh; if (sm.isSkinnedMesh) { sm.material = this.mat; sm.frustumCulled = false; } });
    const byName = new Map<string, THREE.Bone>();
    root.traverse((o) => { if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone); });
    root.updateWorldMatrix(true, true);
    // The joints don't inherit from each other, so a curl is done by hand: each joint is placed from the previous one along the
    // rest-pose segment rotated by all bends so far, and its orientation carries those bends. Bends are about the rig's Z axis
    // (the finger-width axis), expressed in the armature's space.
    const A = new THREE.Vector3(0, 0, 1), pq = new THREE.Quaternion();
    const chain = (names: string[], axisRoot = A) => {
      const js = names.map((n) => byName.get(n)).filter(Boolean).map((b) => ({ b: b!, rp: b!.position.clone(), rq: b!.quaternion.clone() }));
      const parent = js[0]?.b.parent; parent?.getWorldQuaternion(pq);
      const dir = js.length > 1 ? js[js.length - 1].rp.clone().sub(js[0].rp).normalize() : new THREE.Vector3(0, -1, 0);
      return { axis: axisRoot.clone().applyQuaternion(pq.clone().invert()).normalize(), dir, joints: js };
    };
    for (const f of FINGERS) this.chains[f] = chain([`${f}-finger-phalanx-proximal`, `${f}-finger-phalanx-intermediate`, `${f}-finger-phalanx-distal`, `${f}-finger-tip`]);
    // each finger bends about its OWN knuckle axis (perpendicular to the finger and the palm normal). One shared axis made the
    // fanned-out fingers bend sideways and cross each other.
    {
      const ip = this.chains.index.joints[0].rp, pp = this.chains.pinky.joints[0].rp;
      const across = pp.clone().sub(ip), along = this.chains.middle.dir;
      this.palmN.crossVectors(across, along).normalize();
      for (const f of FINGERS) {
        const c = this.chains[f];
        const ax = new THREE.Vector3().crossVectors(c.dir, this.palmN).normalize();
        if (ax.dot(c.axis) < 0) ax.negate();    // keep the calibrated curl direction (toward the palm)
        c.axis.copy(ax);
      }
    }
    this.chains.thumb = chain(['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'], new THREE.Vector3(0, -1, 0.3).normalize());
    // fit: rig has fingers along -Y, thumb on -Z, palm normal ±X.  Map → fingers +Y, thumb -X, palm +Z (x'=z, y'=-y, z'=x)
    const R = new THREE.Matrix4().set(0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
    const fit = new THREE.Group();
    this.fit = fit;
    fit.add(root);
    fit.quaternion.setFromRotationMatrix(R);
    fit.scale.setScalar(HAND_SCALE);
    this.group.add(fit);
    // place the wrist at (0,-0.45,0): measure where it lands with the fit at the origin, then offset
    this.group.updateWorldMatrix(true, true);
    const wrist = byName.get('wrist')!.getWorldPosition(new THREE.Vector3());
    fit.position.set(0, -0.45, 0).sub(wrist);
    const tipBone = byName.get('index-finger-tip');
    if (tipBone) tipBone.add(this.tip);
    // forearm so the wrist doesn't end in mid-air
    // no separate forearm piece: the hand fades out softly at the wrist (see autoFade / update)
  }
  private buildProcedural() {
    const mat = this.mat;
    const add = (g: THREE.BufferGeometry, parent: THREE.Object3D, pos?: THREE.Vector3, scl?: THREE.Vector3) => {
      const m = new THREE.Mesh(g, mat);
      if (pos) m.position.copy(pos);
      if (scl) m.scale.copy(scl);
      parent.add(m);
      return m;
    };
    // palm
    const sh = new THREE.Shape();
    const w = 0.84, h = 0.9, r = 0.2;
    sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    sh.lineTo(w / 2, h / 2 - r * .6); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); sh.lineTo(-w / 2 + r, h / 2);
    sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r * .6); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const palm = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelSize: 0.09, bevelThickness: 0.09, bevelSegments: 6, curveSegments: 14 });
    palm.translate(0, 0, -0.06);
    add(palm, this.group);
    // forearm (tapered, runs off-screen)
    const arm = new THREE.CylinderGeometry(0.34, 0.4, 3.2, 28, 1);
    const a = add(arm, this.group, new THREE.Vector3(0, -0.45 - 1.6, -0.02), new THREE.Vector3(1.05, 1, 0.78));
    a.name = 'arm';
    // fingers
    const defs: Array<[string, number, number, number[], number]> = [
      ['index', -0.27, 0.45, [0.42, 0.26, 0.21], 0.088], ['middle', -0.03, 0.47, [0.46, 0.3, 0.22], 0.09],
      ['ring', 0.21, 0.45, [0.42, 0.27, 0.2], 0.085], ['pinky', 0.43, 0.38, [0.31, 0.2, 0.17], 0.075],
    ];
    for (const [name, x, y, segs, rad] of defs) {
      let parent: THREE.Object3D = this.group;
      const joints: THREE.Group[] = [];
      segs.forEach((L, i) => {
        const j = new THREE.Group();
        j.position.set(i === 0 ? x : 0, i === 0 ? y : segs[i - 1], 0);
        parent.add(j);
        const rr = rad * (1 - i * 0.1);
        add(new THREE.CapsuleGeometry(rr, Math.max(0.01, L - rr * 2), 6, 16), j, new THREE.Vector3(0, L / 2, 0));
        joints.push(j); parent = j;
      });
      this.fingers[name] = joints;
      if (name === 'index') { this.tip.position.set(0, segs[2] + 0.02, 0); joints[2].add(this.tip); }
    }
    // thumb
    {
      const segs = [0.34, 0.27, 0.22]; const joints: THREE.Group[] = []; let parent: THREE.Object3D = this.group;
      segs.forEach((L, i) => {
        const j = new THREE.Group();
        if (i === 0) { j.position.set(-0.42, -0.15, 0.02); j.rotation.z = 0.85; j.rotation.y = -0.25; }
        else j.position.set(0, segs[i - 1], 0);
        parent.add(j);
        const rr = 0.1 * (1 - i * 0.1);
        add(new THREE.CapsuleGeometry(rr, Math.max(0.01, L - rr * 2), 6, 16), j, new THREE.Vector3(0, L / 2, 0));
        joints.push(j); parent = j;
      });
      this.fingers.thumb = joints;
    }
    this.setPose(POSES.open);
    this.group.scale.setScalar(this.scale);
  }
  setPose(p: HandPose) {
    if (this.real) {
      const spread = p.spread ?? 1;
      const md = this.chains.middle?.dir;
      const fk = (k: string, ang: number[], curl = 0) => {
        const c = this.chains[k]; if (!c || !c.joints.length) return;
        const cum = new THREE.Quaternion(), r = new THREE.Quaternion(), pos = c.joints[0].rp.clone(), seg = new THREE.Vector3();
        // draw the finger toward the middle finger's direction (in the palm plane) when spread < 1
        // fingers converge toward the middle finger as they curl (real fingers fold into the palm, never outward over
        // the side of the hand); spread < 1 also draws straight fingers together
        if (md && k !== 'thumb' && k !== 'middle') {
          const fold = Math.min(1, Math.max(0, (curl - 0.15) / 0.5));
          const w = Math.min(1, (1 - spread) + fold * fold * (3 - 2 * fold) * 0.95);
          if (w > 0.001) cum.setFromUnitVectors(c.dir, c.dir.clone().lerp(md, w).normalize());
        }
        if (k === 'thumb' && (p.thumbIn ?? 0) > 0 && this.chains.index) {
          // swing the thumb toward the index finger (in the palm plane) and a little in front of the palm
          const ti = p.thumbIn ?? 0;
          const target = c.dir.clone().lerp(this.chains.index.dir, ti * 0.55).addScaledVector(this.palmN, ti * 0.35).normalize();
          cum.setFromUnitVectors(c.dir, target);
        }
        const ax = c.axis.clone().applyQuaternion(cum);
        c.joints.forEach((j, i) => {
          if (i > 0) { seg.copy(j.rp).sub(c.joints[i - 1].rp).applyQuaternion(cum); pos.add(seg); }
          if (i < ang.length) cum.premultiply(r.setFromAxisAngle(ax, ang[i] * CURL_SIGN));
          j.b.position.copy(pos);
          j.b.quaternion.copy(cum).multiply(j.rq);
        });
      };
      // natural curl: small curls bend mostly at the knuckle; the middle and tip joints join in as the finger folds
      // (a sharp bend at the middle joint of a mostly-straight finger is what reads as "broken")
      const ss = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
      for (const k of FINGERS) {
        const v = p[k];
        const pip = v * (0.45 + 1.15 * ss(0.15, 0.6, v));
        const dip = pip * 0.62;
        fk(k, [v * 1.35 + (p.mcp?.[k] ?? 0), pip, dip], v);
      }
      fk('thumb', [p.thumb * 1.2, p.thumb * 0.95, p.thumb * 0.7]);
      return;
    }
    const f = this.fingers;
    (['index', 'middle', 'ring', 'pinky'] as const).forEach((k) => {
      const c = p[k]; f[k][0].rotation.x = c * 1.25; f[k][1].rotation.x = c * 1.6; f[k][2].rotation.x = c * 1.0;
    });
    f.thumb[0].rotation.x = p.thumb * 0.6; f.thumb[1].rotation.x = p.thumb * 1.1; f.thumb[2].rotation.x = p.thumb * 0.9;
  }
  lerpPose(a: HandPose, b: HandPose, t: number) {
    const o = {} as HandPose;
    (['index', 'middle', 'ring', 'pinky', 'thumb'] as const).forEach((k) => (o[k] = a[k] + (b[k] - a[k]) * t));
    o.spread = (a.spread ?? 1) + ((b.spread ?? 1) - (a.spread ?? 1)) * t;
    o.thumbIn = (a.thumbIn ?? 0) + ((b.thumbIn ?? 0) - (a.thumbIn ?? 0)) * t;
    if (a.mcp || b.mcp) { o.mcp = {}; for (const f of FINGERS) o.mcp[f] = (a.mcp?.[f] ?? 0) + ((b.mcp?.[f] ?? 0) - (a.mcp?.[f] ?? 0)) * t; }
    this.setPose(o);
  }
  /** show the BACK of the hand to the camera (knuckles toward the viewer, folded fingers curl away), thumb kept on the same side */
  showBack(on = true) {
    const f = this.fit; if (!f) return;
    // the rig is a RIGHT hand whose back faces +Z at rest; mirrored (scale.x < 0) it becomes a left hand with its PALM to +Z.
    // showBack(false) (the default) = palm toward the viewer; showBack(true) = back of the hand toward the viewer.
    const want = on ? 1 : -1;
    // the fit group is rotated (local x -> view z), and scale is applied before rotation, so the front/back mirror is on local X
    if (Math.sign(f.scale.x) !== want) { f.scale.x *= -1; f.position.z *= -1; }
  }
  /** draw order among transparent objects (higher = on top) */
  setRenderOrder(n: number) { this.group.traverse((o) => { o.renderOrder = n; }); }
  tipWorld(out = new THREE.Vector3()) { this.group.updateWorldMatrix(true, true); return this.tip.getWorldPosition(out); }
  /** when true (default) the hand dissolves softly just below the wrist, along its own axis (second fade plane;
   *  scenes keep the first plane for their own liquid/haze fades) */
  autoFade = true;
  /** fade the hand out along its own axis, starting \`off\` (hand units, 0 = wrist) below the wrist over \`w\` hand units */
  wristFade(off = 0.05, w = 0.32) {
    const g = this.group, u = this.mat.uniforms, s = g.scale.x;
    g.updateWorldMatrix(true, false);
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const wrist = new THREE.Vector3(0, -0.45, 0).applyMatrix4(g.matrixWorld);
    u.uFadeDir2.value.copy(dir);
    u.uFadeY2.value = wrist.dot(dir) - off * s - w * s * 0.5;
    u.uFadeW2.value = w * s;
  }
  update(t: number) { this.mat.uniforms.uTime.value = t; if (this.autoFade && this.real) this.wristFade(); }
  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.mat.dispose();
  }
}
