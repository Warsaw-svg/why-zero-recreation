import * as THREE from 'three';

const LOCKUP_FRAG = /* glsl */ `
uniform sampler2D tMap; uniform float uIn; uniform float uOut; uniform vec2 uPx; uniform float uOutSweep; varying vec2 vUv;
// colours (defaults = the teal Component 2 lettering) + optional glow halo (Component 3's white-on-red titles)
uniform vec3 uDeep; uniform vec3 uLight; uniform vec3 uForm; uniform vec3 uShadowCol; uniform float uEmboss; uniform float uGlow; uniform vec3 uGlowCol;
float A(vec2 uv, float b){ return texture2D(tMap, uv, b).a; }
void main(){
  vec2 uv = vUv;
  float rin = clamp((uIn * 1.5 - uv.x) * 2.6, 0., 1.);            // sweep in from the left
  // exit: sweep away from the right (uOutSweep 1), or fade out in place, all at once (uOutSweep 0)
  float rout = mix(uOut, clamp((uOut * 1.5 - (1. - uv.x)) * 2.6, 0., 1.), uOutSweep);
  float s = rin * (1. - rout);
  float sm = mix((1. - rin) * .045, (1. - s) * .045, uOutSweep);   // smear while forming; on a sweeping exit too (unchanged), none on an in-place fade
  float al = 0.;
  for (int i = -3; i <= 3; i++) al += A(uv + vec2(float(i) * sm / 3., float(i) * sm * .12), (1. - s) * 4.);
  al /= 7.;
  float e = A(uv - uPx * vec2(2., -2.), 0.) - A(uv + uPx * vec2(2., -2.), 0.);   // light from the upper left
  vec3 col = mix(uDeep, uLight, smoothstep(.15, .85, uv.y + (uv.x - .5) * .25));
  col += e * uEmboss;
  col = mix(uForm, col, smoothstep(.55, 1., s));
  float a = al * smoothstep(0., .45, s + rin * .25);
  float sh = A(uv + vec2(0., .018), 4.5) * .10 * s;                   // soft drop shadow under the letters
  vec4 o = vec4(mix(uShadowCol, col, a / max(a + sh * (1. - a), .0001)), clamp(a + sh * (1. - a), 0., 1.));
  if (uGlow > 0.) {   // soft halo behind the letters
    float h = (A(uv, 5.) * .6 + A(uv, 6.5) * .4) * uGlow * smoothstep(0., .6, s + rin * .3);
    o.rgb = mix(uGlowCol, o.rgb, o.a / max(o.a + h * (1. - o.a), .0001));
    o.a = clamp(o.a + h * (1. - o.a), 0., 1.);
  }
  gl_FragColor = o;
}`;

/** a lettering lockup: drawn white on a 2:1 canvas, coloured + animated by LOCKUP_FRAG (uIn sweeps it in, uOut dissolves it) */
export function makeLockup(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.textBaseline = 'alphabetic'; g.lineCap = 'round';
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: LOCKUP_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      tMap: { value: tex }, uIn: { value: 0 }, uOut: { value: 0 }, uPx: { value: new THREE.Vector2(1 / 2048, 1 / 1024) }, uOutSweep: { value: 1 },
      uDeep: { value: new THREE.Vector3(.21, .40, .39) }, uLight: { value: new THREE.Vector3(.42, .63, .59) }, uForm: { value: new THREE.Vector3(.30, .86, .80) },
      uShadowCol: { value: new THREE.Vector3(.2, .35, .33) }, uEmboss: { value: .22 }, uGlow: { value: 0 }, uGlowCol: { value: new THREE.Vector3(1, .35, .3) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), mat);
  mesh.renderOrder = 10;
  return { mesh, mat };
}
export const SERIF = '"Instrument Serif", "Playfair Display", serif';
export type Lockup = ReturnType<typeof makeLockup>;
