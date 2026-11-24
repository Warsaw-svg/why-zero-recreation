# Why Zero — interactive WebGL recreation

A scroll-driven, real-time 3D recreation of <https://why.zero.university/>, built as a functional single-page WebGL
experience (no pre-rendered videos or static images stand in for interactions).

- **Live site:** _add the Vercel URL here after deploying_
- **Repository:** _add the GitHub URL here_

Every part of the story was rebuilt from screen recordings of the reference site and compared with them frame by
frame (motion timing, the ruler readings, XP values, transitions and interactions).

---

## The story (5 components)

| # | What happens | How you interact |
|---|---|---|
| 1 | Loader count-down (it reflects how much has really loaded) → frosted ice. Wipe the frost, then **draw a zero** to solve the first gate. A clay hand points from under the ice. | Draw a closed loop with mouse / finger |
| 2 | "You Believed" → a green hand rises → "College would land You" with glass coins → meadow with a human hand and a clay hand → "JOB" → **TAP & HOLD**: the hands try to shake, the clay hand flips the middle finger, red → black → the screen shatters like glass | Scroll; press and hold |
| 3 | Red curtain with falling light → "But," → "That's Bullsh*t" → glass statistic cards in front of a hand that follows the cursor and turns with scroll direction → the hand moves onto a banknote | Scroll; move the pointer |
| 4 | The banknote zooms out → "University sells" with a cloud of notes in depth that burn → "Paper" → a paper vortex: "but Companies want Someone who can do the Job — see the Disconnect" → "and that's Why we had to Exist" → **second TAP & HOLD** (orb + green rings; holding pulls everything inward, release springs back; the finish sends green rims outward and blooms to white) | Scroll; press and hold |
| 5 | Above the clouds: "Introducing" → **zero** → "where WORK gets Real" → "Real projects / tools / skills" → "GET Hired into" → "world's most in-demand Careers" → the clouds dissolve onto an explorable 3D city with a green **JOIN THE WAITLIST** dome, company buildings with project cards, and an email sign-up | Drag to pan, pinch / wheel / buttons to zoom, joystick; click buildings, the dome, Join Beta |

HUD throughout: a **ruler** (-100 BZ → 0) and **XP** (100 per gate / component) that match the reference at each
point, a sound toggle, and the ≡ **menu** (Home / Letters / Why Zero open a "Coming soon" page). Refreshing resumes
where you were (inside Component 4 it returns to that component's start, like the reference). Add `?restart` to the
URL to start over.

## Setup and running

Requirements: **Node.js 20+** (developed on Node 24) and npm.

```bash
npm install        # also copies the Draco + Basis decoders into /public (postinstall)
npm run dev        # http://localhost:5173
npm run build      # strict type-check (tsc --noEmit) + production build → dist/
npm run preview    # serve the production build locally
```

### Deploying (Vercel)

`vercel.json` is included (framework preset *Vite*, build `npm run build`, output `dist`, long-cache headers for
hashed assets). Import the GitHub repository in Vercel and deploy with the defaults, or run `npx vercel --prod`.

## Controls

| Input | Action |
|---|---|
| Wheel / trackpad / touch-drag / ↑ ↓ Space PgUp PgDn | move through the story (virtual, damped scroll) |
| Draw a loop | solve the intro gate |
| Press and hold (mouse, touch, or hold Enter) | fill the TAP & HOLD gates (releasing early drains them) |
| Pointer movement | parallax / hand and object follow in every component |
| City: drag · pinch / wheel · joystick · + − ◀ ▶ · click | pan · zoom · move · zoom / step between companies · open a card |

## Technologies and libraries

| Area | Used |
|---|---|
| Language / build | **TypeScript** (strict), **Vite** |
| 3D / rendering | **three.js** (r187): custom GLSL shaders throughout, `EffectComposer`, `UnrealBloomPass`, tilt-shift shaders, `RoomEnvironment` + PMREM, GLTF / Draco / KTX2 loaders |
| Post-processing | **n8ao** (screen-space ambient occlusion for the city) and **postprocessing** (required by n8ao) |
| Animation | **GSAP** for timed sequences (gate finishes, flashes, XP count-up); scroll-driven motion is computed per frame |
| Audio | **Howler.js** for playback. All sound effects and beds are **synthesised in code** (no audio files) |
| Fonts | Google Fonts: Pinyon Script, Instrument Serif, Playfair Display, JetBrains Mono, Fredoka, Inter |
| Assets | `public/assets/hand.glb`: rigged hand from `@webxr-input-profiles/assets` (MIT). `public/textures/`: 4 CC0 photo textures from Poly Haven (see `LICENSE.txt`). Everything else (city, clouds, notes, paper, rings, lettering) is generated procedurally. |

No UI framework is used: the HUD is plain DOM + CSS layered over one WebGL canvas, which keeps the frame loop in one
place.

## Architecture (`src/`)

```
core/     Scene (base class: 3D scene + camera, UI layer, backdrop helper, optional custom render hook)
          Timeline (each scene owns a slice of scroll progress; lazy init / dispose; cross-fades)
          ScrollEngine (virtual scroll: wheel / touch / keys → damped progress; per-scene speed & smoothing)
          Gates + HoldGate (scroll locks, tap-and-hold logic, scroll floors once a step is done)
          Compositor (scenes → HDR targets → bloom → grain / vignette / chromatic aberration / flash)
          progressMap (pacing), resume (refresh → resume), Input, Quality (frame-time probe → quality tiers)
audio/    synthesised sound + AudioManager (Howler)
ui/       HUD (ruler, XP, sound, menu, "Coming soon" page, toasts, TAP/HOLD ring, cursor), styles.css
scenes/   one file per act: Intro, Story (Component 2), Adam (hands + hold), Red (Component 3a/3b),
          Banknote (3c), Money (4a), Letters (4b), Gate2 (4c), Sky (5a), City (5b)
utils/    Hand (rigged hand + materials), lockup (shared lettering shader), cityscape (procedural city:
          instanced buildings with a world-space window shader, traffic, landmarks, company buildings, photo
          textures), cityPost (ambient occlusion + tilt-shift), waitlist (the green dome), math, text, …
```

Key decisions:
- **One canvas, one renderer, one render loop.** Each scene has its own `THREE.Scene` and camera and is composited
  with a cross-fade, so neighbouring sections can overlap smoothly.
- **Scroll is virtual.** Progress 0 → 1 drives everything. Gates clamp it until solved; floors stop you scrolling
  back past a finished step. The ruler and XP are derived from progress and completed steps, so they're identical
  on every screen size.
- **Lettering** is drawn to canvases and revealed by a shared shader (sweep-in, smear / blur-out, glow).
- **The city** is fully procedural but uses hundreds of buildings in one instanced mesh with windows computed in the
  shader from world position, plus ambient occlusion, tilt-shift and real photo textures, for a realistic look at
  low cost.

## Responsive and performance

- Tested at desktop (1366+ wide), tablet (768×1024) and phone (375×812). Portrait screens get adjusted cameras and
  text widths; HUD elements never overlap.
- Device pixel ratio is capped (2 on desktop, 1.5 on mobile). A frame-time probe lowers the quality tier (particle
  counts, MSAA, bloom) on slower devices. Scenes are initialised just before they're needed and disposed after.
- Production bundle: about 1.2 MB of JavaScript (about 400 KB gzipped), plus the hand model and textures.

## Known differences from the reference

- The final city is procedural (realistic materials and lighting) rather than a photo-scanned / pre-rendered city.
- Company project cards use illustrated people and plain company names (no real logos or photos).
- Menu items open a "Coming soon" page rather than separate pages.
- The email sign-up validates the address and confirms with a toast; there is no backend.

## AI tools used

This project was built with **Claude Code** (Anthropic's AI coding agent, in the Claude desktop app) as the main
development tool.
- I supplied screen recordings of the reference site and described what I wanted. Claude extracted frames from
  the recordings (ffmpeg), compared them with the build, and wrote and edited the TypeScript / GLSL code.
- Claude checked each change in a browser preview (screenshots, measuring layouts, reading shader errors).
- I reviewed every step against the reference and asked for corrections until each part matched. Approved parts were
  "locked" (snapshotted) before moving on.

## Licences and credits

- Reference: <https://why.zero.university/> (recreated for an assignment; no assets were copied from it).
- Hand model: `@webxr-input-profiles/assets`, MIT licence.
- Photo textures: Poly Haven, CC0.
- Fonts: Google Fonts (SIL Open Font License).
