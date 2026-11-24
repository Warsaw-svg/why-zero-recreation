import * as THREE from 'three';
import { Scene, type Ctx } from '../core/Scene';
import { Hand, type HandPose } from '../utils/Hand';
import { CURTAIN_BG } from './RedScenes';
import { billTexture } from './MoneyScenes';
import { smoothstep, clamp, lerp } from '../utils/math';

/**
 * Component 3c (matched to coponent3.mov 20–25 s): the SAME hand from 3b carries on — only its colour changes.
 * On the red curtain it drains to pale grey (plaster-like), then the curtain gives way to a huge, softly focused
 * banknote (portrait in a mortarboard) in dim green-sepia, with orange embers drifting; the hand becomes a faint,
 * greenish, see-through figure over the portrait.
 * The hand is not a new pose: while 3b is still alive this scene copies 3b's hand transform every frame (identical
 * position, wrist turn and pose), so there is only ever one hand; afterwards it holds that pose and keeps the cursor follow.
 */
/** Component 4's opening hand (componet4.mov 0 s): relaxed open, fingers slightly curled and fanned */
export const C4_START: HandPose = { index: 0.2, middle: 0.26, ring: 0.32, pinky: 0.38, thumb: 0.5, spread: 1, thumbIn: 0.5 };
/** upright, leaning ~20° to the right (screen plane) */
/** the pose over the fully zoomed oval (fingers fanned up to the upper left, seen from the thumb side) */
const ZOOM_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 2.2, -0.3, 'YXZ'));
const ZOOM_POSE: HandPose = { index: 0.12, middle: 0.18, ring: 0.24, pinky: 0.3, thumb: 0.5, spread: 1, thumbIn: 0.5 };
export const C4_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 2.2, -0.3, 'YXZ'))
  .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.6));   // seen from the side, fingers fanned up and to the right
const PEACE: HandPose = { index: 0.04, middle: 0.04, ring: 0.5, pinky: 0.55, thumb: 0.3, spread: 0.35, thumbIn: 0.35 };   // = 3b's pose

const NOTE_BG = /* glsl */ `
uniform sampler2D tBill; uniform float uNote; uniform float uDim; uniform float uZoom;
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
vec3 curtain(vec2 p, float asp){
  float x = p.x * asp;
  float wob = fbm(vec2(x * 1.3, p.y * .35 + uTime * .03)) * 2.2;
  float f = .5 + .5 * sin(x * 15. + sin(x * 2.7 + uTime * .15) * 1.8 + wob);
  vec3 col = mix(vec3(.09, 0., .007), vec3(.42, .01, .026), f * .85);
  col *= mix(.32, 1., smoothstep(1.25, .25, length((p - vec2(.52, .55)) * vec2(asp * .75, 1.05))));
  return col;
}
void main(){
  vec2 p = vUv; float asp = uRes.x / uRes.y;
  vec3 red = curtain(p, asp) * (1. - uDim);
  // banknote, filling the screen, slowly pushing in; soft focus away from the centre (mip blur)
  // slow push in; at the end of 3c it closes in on the portrait (where Component 4 begins, ruler about -58)
  float z = mix(1.02 + uTime * .002, 3.4, uZoom);
  vec2 zc = mix(vec2(.5), vec2(.5, .52), uZoom);
  vec2 q = (p - zc) * vec2(asp, 1.) / z;
  vec2 buv = vec2(q.x / 2.29 + .5, q.y + .5);          // bill texture is 1280x560 (2.29:1)
  float blur = smoothstep(.15, .55, length((p - .5) * vec2(asp, 1.))) * 3.5;
  vec3 bill = texture2D(tBill, clamp(buv, 0., 1.), blur).rgb;
  // a second bill behind, tilted, for depth
  vec2 q2 = (p - vec2(.5, .62)) * vec2(asp, 1.) / 1.2; float c = cos(.32), s = sin(.32); q2 = mat2(c, -s, s, c) * q2;
  vec3 bill2 = texture2D(tBill, clamp(vec2(q2.x / 2.29 + .5, q2.y + .5), 0., 1.), 4.).rgb;
  float inB = step(0., buv.x) * step(buv.x, 1.) * step(0., buv.y) * step(buv.y, 1.);
  vec3 col = mix(bill2 * .55, bill, inB);
  // grade: dim green-sepia, crushed blacks, warm lamp from the upper left
  float l = dot(col, vec3(.3, .59, .11));
  col = mix(vec3(l), col, .55) * vec3(.82, .9, .74);
  col *= .55 + .45 * exp(-pow(length((p - vec2(.35, .72)) * vec2(asp, 1.)), 2.) * 1.2);
  col *= mix(.25, 1., smoothstep(1.2, .3, length((p - .5) * vec2(asp * .8, 1.1))));
  // orange embers drifting up
  float em = 0.;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec2 e = vec2(h1(fi) * asp, fract(h1(fi + 9.) + uTime * (.02 + h1(fi + 3.) * .03)));
    e.x += sin(uTime * .4 + fi) * .03;
    float d = length((vec2(p.x * asp, p.y) - e) * vec2(1., 1.));
    em += exp(-pow(d / (.004 + h1(fi + 5.) * .006), 2.)) * (.5 + .5 * sin(uTime * 3. + fi * 2.));
  }
  col += vec3(1., .45, .12) * em * .9;
  col = mix(red, col, uNote);
  gl_FragColor = vec4(col, 1.);
}`;

export class BanknoteScene extends Scene {
  private bg!: THREE.ShaderMaterial;
  private hand!: Hand;
  private captured = false;
  private endPos = new THREE.Vector3();
  c4q = C4_Q.clone(); c4pose: HandPose = { ...C4_START };
  private base = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), s: 2.95, ax: 0 };
  constructor(ctx: Ctx) { super(ctx, 'banknote', [0.595, 0.69]); this.theme = 'dark'; this.fx = { bloom: 0.3, grain: 0.14, vignette: 0.5, ca: 0.1 }; }
  init() {
    super.init();
    this.bg = this.makeBackdrop(NOTE_BG, { tBill: { value: billTexture() }, uNote: { value: 0 }, uDim: { value: 0 }, uZoom: { value: 0 } });
    void CURTAIN_BG;
    // the same hand as 3b (same model, size, side and pose); only its material colour is driven here
    this.hand = new Hand('real', undefined, 2.95);
    this.hand.showBack(true);
    const u = this.hand.mat.uniforms;
    u.uAlb.value.setRGB(.42, .17, .15); u.uAlb2.value.setRGB(.5, .14, .12); u.uSSS.value.setRGB(1, .15, .1); u.uRimSSS.value = .8; u.uSpec.value = .22;
    u.uFadeCol.value.setRGB(.2, 0, .02);
    this.hand.setPose(PEACE);
    this.hand.mat.transparent = true;
    this.scene.add(this.hand.group);
    this.camera.position.set(0, 0, 8); this.camera.fov = 40;
  }
  enter() { this.ctx.hud.setTheme('dark'); this.captured = false; }   // no XP in Component 3
  update(l: number, dt: number, t: number) {
    const ctx = this.ctx;
    this.bg.uniforms.uTime.value = t; this.bg.uniforms.uRes.value.set(ctx.size.w, ctx.size.h);
    const ax = ctx.input.sx || 0, ay = ctx.input.sy || 0;
    this.camera.position.set(ax * 0.45, ay * 0.25, this.portrait ? 11.5 : 8); this.camera.lookAt(ax * 0.15, ay * 0.08, 0);   // same parallax as 3b; portrait steps back so the note shows round the hand
    // follow 3b's hand exactly while 3b is alive; afterwards hold it (plus the same cursor follow)
    const stats = findStatsHand(ctx);
    const g = this.hand.group;
    if (stats) {
      g.position.copy(stats.position); g.quaternion.copy(stats.quaternion); g.scale.copy(stats.scale);
      this.base.pos.copy(stats.position); this.base.q.copy(stats.quaternion); this.base.s = stats.scale.x; this.base.ax = ax; this.captured = true;
    } else if (this.captured) {
      g.position.copy(this.base.pos); g.position.x += (ax - this.base.ax) * 1.1; g.position.y += Math.sin(t * 0.7) * 0.03;
      g.quaternion.copy(this.base.q); g.scale.setScalar(this.base.s);
    } else {
      const halfW = 8 * Math.tan(THREE.MathUtils.degToRad(20)) * this.aspect;
      g.position.set(halfW * 0.1 + ax * 1.1, -1.75, -0.6); g.rotation.set(-0.12, 0, -0.1); g.scale.setScalar(2.95);
    }
    // end of 3c = start of Component 4 (componet4.mov at 0 s): the hand settles centred, upright and leaning a little to
    // the right, relaxed open fingers, back of the hand to you, as a pale grey stone-like hand over the zoomed-in portrait
    // the hand settles over the portrait (mortarboard visible), then it fades away while the note zooms in; fully zoomed,
    // with no hand, exactly where Component 4 starts (ruler -50)
    const end = smoothstep(0.38, 0.47, l);
    // 1) mortarboard pose (by 0.38)  2) while the note zooms, the hand turns into the zoomed pose (your screenshot), in place
    //    at -50 (0.47)  3) it stays a little into Component 4, then fades away
    // once in place at -50 the hand stays about 2 s, then disappears (time-based, not scroll-based)
    // document4.mov: from -50 the note pulls back (zooms OUT) until the whole bill is seen, and the hand dissolves as it
    // does — all driven by the scroll, so scrolling back up reverses it (hand returns, note zooms back in)
    const zoomOut = smoothstep(0.5, 0.95, l);
    // scrolling back up toward -50 brings the hand back (it then stays 2 s again)
    const gone = smoothstep(0.52, 0.72, l);
    const ee = end * end * (3 - 2 * end);
    // the hand travels the whole of 3c: from where 3b leaves it (3b ends at l ≈ 0.21) it moves and turns steadily so it
    // arrives at the reference's banknote position just as the banknote closes in — no sudden move at the end
    const mv0 = smoothstep(0.22, 0.38, l), mv = mv0 * mv0 * (3 - 2 * mv0);   // in place by the time the banknote is fully shown, then held
    this.hand.lerpPose(PEACE, this.c4pose, mv);
    if (mv > 0) {
      const halfW = 8 * Math.tan(THREE.MathUtils.degToRad(20)) * this.aspect;
      this.endPos.set(halfW * 0.06 + ax * 0.6, -1.35, -0.4);
      g.position.lerp(this.endPos, mv);
      g.quaternion.slerp(this.c4q, mv);
      g.scale.setScalar(lerp(g.scale.x, 3.4, mv));   // bigger, as in the reference frame
    }
    if (ee > 0) { g.quaternion.slerp(ZOOM_Q, ee); this.hand.lerpPose(this.c4pose, ZOOM_POSE, ee); }
    // colour only: red-lit skin → pale grey → faint green, see-through over the banknote
    const grey = smoothstep(0.02, 0.3, l), note = smoothstep(0.24, 0.38, l);
    const u = this.hand.mat.uniforms;
    u.uAlb.value.setRGB(lerp(.42, .66, grey), lerp(.17, .64, grey), lerp(.15, .6, grey));
    u.uAlb2.value.setRGB(lerp(.5, .6, grey), lerp(.14, .58, grey), lerp(.12, .55, grey));
    u.uSSS.value.setRGB(lerp(1, .55, grey), lerp(.15, .5, grey), lerp(.1, .45, grey));
    u.uRimSSS.value = lerp(.8, .25, grey);
    u.uMono.value = note * 0.75; u.uMonoTint.value.setRGB(.55, .75, .55);   // pale grey-green over the note (your screenshot)
    u.uOpacity.value = lerp(1, 0.92, note) * (1 - gone);
    g.visible = gone < 0.999;
    u.uFadeCol.value.setRGB(lerp(.2, .1, note), lerp(0, .12, note), lerp(.02, .08, note));
    if (this.portrait) g.scale.multiplyScalar(0.72);   // narrow screens: smaller hand so the note shows round it (desktop unchanged)
    this.hand.update(t);
    this.bg.uniforms.uDim.value = grey * 0.35;
    this.bg.uniforms.uNote.value = note;
    this.bg.uniforms.uZoom.value = ee * (1 - zoomOut);
    if (l >= 0.47) ctx.hud.addXPOnce('comp4', 100);   // the banknote starts Component 4: 200 → 300 (reference)
    void clamp; void dt;
  }
  dispose() { this.hand?.dispose(); super.dispose(); }
}

/** 3b's live hand group (read-only), or null once 3b is gone */
function findStatsHand(ctx: Ctx): THREE.Object3D | null {
  const z = (window as unknown as { __zero?: { timeline: { scenes: Array<{ name: string; inited: boolean; active: boolean }> } } }).__zero;
  const s = z?.timeline.scenes.find((x) => x.name === 'stats') as unknown as { inited: boolean; active: boolean; hand?: Hand } | undefined;
  void ctx;
  if (!s || !s.inited || !s.active || !s.hand || !s.hand.group.visible) return null;
  return s.hand.group;
}
