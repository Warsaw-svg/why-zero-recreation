import * as THREE from 'three';
import gsap from 'gsap';
import { Input } from './core/Input';
import { Gates } from './core/Gates';
import { ScrollEngine } from './core/ScrollEngine';
import { Quality } from './core/Quality';
import { Timeline } from './core/Timeline';
import { Compositor } from './core/Compositor';
import { AssetLoader } from './core/AssetLoader';
import type { Ctx } from './core/Scene';
import { AudioManager } from './audio/AudioManager';
import { HUD } from './ui/HUD';
import { IntroScene } from './scenes/IntroScene';
import { BelievedScene, GreenHandScene, CollegeScene } from './scenes/StoryScenes';
import { AdamScene } from './scenes/AdamScene';
import { registerLaterScenes } from './scenes/later';
import { Hand } from './utils/Hand';
import { P } from './core/progressMap';
import { loadResume, saveResume } from './core/resume';

THREE.ColorManagement.enabled = false;

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const quality = new Quality();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(quality.dpr);

  const input = new Input(canvas);
  const gates = new Gates();
  gates.add('intro', 0);
  gates.add('hold1', P(0.345), P(0.37) + 0.04);   // after TAP HOLD you land in Component 3 and can't scroll back into Component 2
  gates.add('hold2', P(0.865), P(0.935));
  const scroll = new ScrollEngine(gates);
  const audio = new AudioManager();
  const hud = new HUD(audio);
  const assets = new AssetLoader(renderer);
  const compositor = new Compositor(renderer, quality);

  const ctx: Ctx = {
    renderer, input, gates, scroll, quality, audio, hud, assets,
    flash: (a) => compositor.flash(a),
    size: { w: innerWidth, h: innerHeight, aspect: innerWidth / innerHeight },
    time: 0, global: { progress: 0, load: 0, ready: false },
  };
  const timeline = new Timeline(ctx);

  // ---- loader: the countdown IS the real load progress (fonts + hand model + audio). No artificial minimum:
  //      a slow first visit counts down slowly; a cached repeat visit (audio read back from IndexedDB) finishes almost at once.
  //      The number also drives the ice reveal in the intro scene (ctx.global.load), so the page frosts in as it falls.
  const pct = document.getElementById('plPct')!;
  const preEl = document.getElementById('preloader')!;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const prog = { fonts: 0, hand: 0, audio: 0 };
  const target = () => prog.fonts * 0.12 + prog.hand * 0.08 + prog.audio * 0.8;
  let shown = 0, loaderT = performance.now(), loaderDone = false, glitching = false;
  // refreshed mid-story? the loader plays as usual, then we land straight back where the visitor was (see core/resume)
  const saved = loadResume();
  const resuming = !!saved && saved.solved.includes('intro') && saved.p > 0.01;
  const finishResume = () => {
    (window as unknown as { __loadMs: number }).__loadMs = Math.round(performance.now());
    glitching = true;
    ctx.global.ready = true;
    saved!.solved.forEach((id) => { if (gates.gates.some((g) => g.id === id)) gates.solve(id); });
    const intro = timeline.scenes.find((s) => s.name === 'intro');
    if (intro) intro.disabled = true;                   // the frost clears: no "draw a zero" again
    // refreshed anywhere inside Component 4 (before its TAP HOLD is done)? land back at Component 4's start (-50, the
    // banknote's +100 point), like the reference — not mid-way through it
    const land = () => {
      const bnS = timeline.scenes.find((s) => s.name === 'banknote');
      if (!bnS) { setTimeout(land, 50); return; }   // scenes not registered yet (very fast cached load)
      const c4 = bnS.range[0] + (bnS.range[1] - bnS.range[0]) * 0.47;
      const inC4 = saved!.p > c4 && !saved!.solved.includes('hold2');
      scroll.jumpTo(inC4 ? c4 : saved!.p);
    };
    land();
    compositor.flash(0.55);
    hud.reveal();
    // rebuild XP from what was actually completed (not the stored number), so it can't drift: e.g. 200 in Component 3
    let xp = 0;
    saved!.solved.forEach((id) => { xp += HUD.GATE_XP[id] ?? 0; });
    (saved!.awarded ?? []).forEach((k) => { if (k in HUD.AWARD_XP) { hud.awarded.add(k); xp += HUD.AWARD_XP[k]; } });
    if (xp > 0) hud.addXP(xp, false);
    gsap.fromTo('#ui', { opacity: 0 }, { opacity: 1, duration: 0.8 });
    // "zero" sits small in the bottom-left for a few seconds, then slides out to the left
    pct.classList.remove('glitch'); pct.classList.add('word', 'resume');
    pct.textContent = 'zero'; pct.style.visibility = 'visible';
    gsap.fromTo(pct, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    gsap.to(pct, { xPercent: -120, opacity: 0, duration: 0.7, ease: 'power2.in', delay: 3.2 });
  };
  const finishLoader = async () => {
    if (resuming) { finishResume(); return; }
    (window as unknown as { __loadMs: number }).__loadMs = Math.round(performance.now()); // dev: how long the loader really took
    glitching = true; pct.classList.remove('glitch'); pct.classList.add('word'); // 1 -> ZERO, clean (no glitch on the word)
    pct.textContent = 'zero';
    ctx.global.ready = true;
    await sleep(150);
    // the loader's "zero" word stays (one word, not two) and fades when the visitor first moves the pointer (see IntroScene)
    gsap.fromTo('#ui', { opacity: 0 }, { opacity: 1, duration: 1.2, delay: 0.2 });
  };
  const loaderTick = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - loaderT) / 1000); loaderT = now;
    const tg = target();
    // eased follow, plus a minimum speed so it never crawls through the last numbers
    shown += Math.max((tg - shown) * (1 - Math.exp(-dt * 7)), Math.min(tg - shown, dt * 0.4));
    if (tg >= 0.9999 && shown > 0.985) shown = 1;
    ctx.global.load = shown;
    if (!glitching) {
      pct.textContent = String(Math.max(1, Math.round(99 * (1 - shown)))); // ...10, 9 ... 1, then straight to "zero" (never shows 0)
      pct.classList.toggle('glitch', Math.random() < 0.15); // occasional tears while counting
    }
    if (shown >= 1 && !loaderDone) { loaderDone = true; void finishLoader(); }
    if (!loaderDone) requestAnimationFrame(loaderTick);
  };
  const fontJobs = ['400 40px "Pinyon Script"', '400 40px "Instrument Serif"', 'italic 400 40px "Instrument Serif"', '400 40px "Playfair Display"', 'italic 400 40px "Playfair Display"', '400 40px "JetBrains Mono"', '700 40px "Fredoka"'];
  const fontP = Promise.all(fontJobs.map((f) => document.fonts.load(f, 'AaBbYyZz0123').catch(() => null).then(() => { prog.fonts += 1 / fontJobs.length; })));
  const handP = Hand.preload(assets).then(() => { prog.hand = 1; });
  loaderTick();
  void audio.build((p) => { prog.audio = p; }).catch(() => { prog.audio = 1; }); // heavy part: keeps going while the intro already renders
  await Promise.race([Promise.all([fontP, handP]), sleep(8000)]);
  await document.fonts.ready;
  prog.fonts = 1; prog.hand = 1;

  timeline.add(new IntroScene(ctx)).add(new BelievedScene(ctx)).add(new GreenHandScene(ctx)).add(new CollegeScene(ctx)).add(new AdamScene(ctx));
  registerLaterScenes(ctx, timeline);
  // pacing: Component 2 fits between ruler -100 and -75 (see core/progressMap); the intro overlay keeps its own range
  timeline.scenes.forEach((s) => { if (s.name !== 'intro') s.range = [P(s.range[0]), P(s.range[1])]; });

  // ---- resize
  const resize = () => {
    ctx.size.w = innerWidth; ctx.size.h = innerHeight; ctx.size.aspect = innerWidth / innerHeight;
    renderer.setPixelRatio(quality.dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    compositor.resize(innerWidth, innerHeight);
    timeline.scenes.forEach((s) => { if (s.inited) s.resize(innerWidth, innerHeight); });
  };
  addEventListener('resize', resize);
  quality.onChange = () => { compositor.setQuality(); resize(); };
  compositor.setQuality();
  resize();

  // ---- menu navigation
  hud.onNav = (id) => {
    const target = id === 'home' ? 0 : id === 'why' ? timeline.find('sky').range[0] + 0.004 : timeline.find('letters').range[0] + 0.03;
    scroll.scrollTo(target, 3, { skipGates: true });
  };
  gates.onSolve(() => {});

  // ---- first frame, then reveal
  let t = 0, last = performance.now(), saveT = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt; ctx.time = t;
    quality.frame(dt);
    input.update(dt);
    scroll.update(dt);
    const p = scroll.progress; ctx.global.progress = p;
    if (ctx.global.ready && gates.isSolved('intro') && (saveT -= dt) <= 0) {   // remember where the visitor is (resume after refresh)
      saveT = 0.5;
      saveResume({ p, solved: gates.gates.filter((g) => g.solved).map((g) => g.id), xp: hud.xp, awarded: [...hud.awarded] });
    }
    // ruler: TAP HOLD sits at -75 and Component 3 ("That's Bullsh*t") also starts at -75 — the hold → shatter → landing
    // stretch doesn't move the ruler; after that it runs on to -0 at the end
    const H1 = gates.get('hold1'), F1 = H1.floorAt ?? H1.at;
    // Component 4 starts where the banknote is fully in (the +100 XP point) and the ruler must read -50 there
    const bn = timeline.find('banknote').range, C4 = bn[0] + (bn[1] - bn[0]) * 0.47;
    // Component 4 runs -50 → -30: the second TAP HOLD parks just before -25 (reference: the -25 mark is still 5 ticks away)
    const G2 = gates.get('hold2').at;
    // Component 5 (reference 9.55.37): -30 at the second TAP HOLD → -25 at "Introducing" (where the hold lands you) → 0 at the end
    const L5 = gates.get('hold2').floorAt ?? G2;
    hud.setProgress(p <= H1.at ? p : p <= F1 ? H1.at : p <= C4 ? H1.at + (p - F1) * (0.5 - H1.at) / (C4 - F1) : p <= G2 ? 0.5 + (p - C4) * 0.2 / (G2 - C4) : p < L5 ? 0.7 + (p - G2) * 0.05 / (L5 - G2) : 0.75 + (p - L5) * 0.25 / (1 - L5));
    // once the words are gone and the whole dome is in view: +100 XP (400 → 500), and you can't scroll back into the words
    const C5 = timeline.find('sky').range[1];
    if (p >= C5 && gates.isSolved('hold2')) hud.addXPOnce('comp5', 100);
    if (hud.awarded.has('comp5')) gates.extraFloor = Math.max(gates.extraFloor, C5);
    // once Component 4 has started you can't scroll back into Component 3 (same as 2 → 3)
    if (hud.awarded.has('comp4')) gates.extraFloor = Math.max(gates.extraFloor, C4);
    hud.frame(dt);
    audio.update(p, scroll.velocity, dt);
    const list = timeline.update(p, dt, t);
    const top = list[list.length - 1];
    if (top) hud.setTheme(top.opacity > 0.5 ? top.scene.theme : (list[list.length - 2]?.scene.theme ?? 'dark'));
    compositor.render(list, dt, t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  requestAnimationFrame(() => requestAnimationFrame(() => { preEl.classList.add('seethrough'); pct.style.visibility = 'hidden'; })); // the scene now paints the gradient, the ice reveal and the number (under the frost)
  (window as unknown as { __zero: unknown }).__zero = { ctx, timeline, scroll, gates, compositor };
}
boot();
