import * as THREE from 'three';

/**
 * Component 5b centrepiece (reference Screen Recording 9.55.37 at 16–50 s): a glowing, see-through green capsule over the
 * city's white dome, "JOIN THE WAITLIST ·" wrapped round it and turning, green ripples spreading over the ground, and a
 * holographic beam of rings rising out of it.
 */
const SHELL_VERT = 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = -mv.xyz; vP = position; gl_Position = projectionMatrix * mv; }';
const SHELL_FRAG = `uniform float uTime; uniform float uOn; varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  float fr = pow(1. - abs(dot(N, V)), 1.6);
  float scan = .5 + .5 * sin(vP.y * 3.5 - uTime * 2.2);
  vec3 col = mix(vec3(.18, .85, .3), vec3(.6, 1., .65), fr) * (.9 + scan * .12);   // saturated green glass, brighter rim
  gl_FragColor = vec4(col, (.42 + fr * .45) * uOn);
}`;

function bandTexture() {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.font = '700 104px "JetBrains Mono", monospace'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(6,48,18,.95)';
  const word = 'JOIN THE WAITLIST  ·  ', w = g.measureText(word).width;
  for (let x = 0; x < cv.width + w; x += w) g.fillText(word, x, 66);
  const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WaitlistDome {
  group = new THREE.Group();
  hit: THREE.Mesh;
  private shellMat: THREE.ShaderMaterial; private band: THREE.Mesh; private bandMat: THREE.MeshBasicMaterial;
  private ripples: THREE.Mesh[] = []; private beam: THREE.Mesh; private beamMat: THREE.ShaderMaterial;
  constructor(radius = 7.6, height = 4.2) {
    // capsule: open cylinder + flattened cap
    this.shellMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide, uniforms: { uTime: { value: 0 }, uOn: { value: 0 } }, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 72, 6, true), this.shellMat); wall.position.y = height / 2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 72, 24, 0, Math.PI * 2, 0, Math.PI / 2), this.shellMat); cap.scale.y = 0.42; cap.position.y = height;
    this.group.add(wall, cap);
    // turning text band
    this.bandMat = new THREE.MeshBasicMaterial({ map: bandTexture(), transparent: true, depthWrite: false, side: THREE.FrontSide, opacity: 0 });   // near side only (no mirrored text through the glass)
    this.bandMat.map!.repeat.set(2, 1);
    this.band = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.08, radius + 0.08, 1.9, 96, 1, true), this.bandMat); this.band.renderOrder = 2; this.band.position.y = height * 0.42;
    this.group.add(this.band);
    // ground ripples
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      m.position.y = 0.08; this.ripples.push(m); this.group.add(m);
    }
    // a straight cylinder of light rising from the dome's outer edge (same radius), with bright bands travelling up it
    this.beamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime; uniform float uOn; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          float y = vUv.y;
          float fade = pow(1. - y, 1.6) * smoothstep(0., .02, y);
          float edge = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.2);          // brighter at the silhouette: reads as a solid tube
          float band = smoothstep(.9, 1., fract(y * 9. - uTime * .35)) + smoothstep(.96, 1., fract(y * 23. - uTime * .55)) * .5;
          float a = fade * (.1 + edge * .85 + band * .75);
          gl_FragColor = vec4(vec3(.35, 1., .5) * a * uOn, a * uOn);
        }` });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 60, 96, 1, true), this.beamMat); this.beam.position.y = 30;
    this.group.add(this.beam);
    // click target
    this.hit = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height * 1.4, 24), new THREE.MeshBasicMaterial({ visible: false })); this.hit.position.y = height * 0.7;
    this.group.add(this.hit);
    this.radius = radius; this.height = height;
  }
  private radius: number; private height: number;
  /** on: 0..1 fade-in; hi: 0..1 hover */
  update(t: number, on: number, hi = 0) {
    this.shellMat.uniforms.uTime.value = t; this.shellMat.uniforms.uOn.value = on * (1 + hi * 0.4);
    this.bandMat.opacity = on; this.bandMat.map!.offset.x = -t * 0.035;
    this.ripples.forEach((m, i) => {
      const k = (t * 0.28 + i / 3) % 1;
      m.scale.setScalar(this.radius * (1.05 + k * 2.4));
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * (1 - k) * 0.55 * on;
    });
    this.beamMat.uniforms.uTime.value = t; this.beamMat.uniforms.uOn.value = on;
  }
}
