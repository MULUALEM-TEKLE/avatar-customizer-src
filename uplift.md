# Uplift Plan — Avatar Customizer

A prioritized, actionable plan to improve performance, correctness, UX, and maintainability.
Findings come from a full read of `src/` (all 11 modules, HTML, CSS, Vite config) and an audit
of `static/` assets and `package.json`.

**Current state in one paragraph:** a Vite 4 + Three.js r148 app that loads a 21 MB character
GLB and a 32 MB environment GLB, renders an ocean/mountain/sky procedural backdrop with three
duplicated copies of the same Perlin-noise shader, and drives clothing toggles through DOM-built
UI. It works, but it ships ~100 MB of assets, has a compounding `requestAnimationFrame` leak,
downloads a 6 MB HDR it never uses, carries three unused npm dependencies, and has several
latent bugs (wrong function signatures, broken event-listener options, layout-breaking
screenshot restore).

---

## 0. Scorecard (why users feel pain today)

| Area | Today | Target |
|---|---|---|
| Total download before interactive | ~90–100 MB (models 53 MB, audio 26 MB, thumbnails 9 MB, HDR 6 MB, loading gif 2.8 MB) | < 10 MB initial, rest lazy |
| Frame cost | Grows over time (RAF leak) + ~1M background triangles | Stable 60 fps, < 200k triangles for backdrop |
| Time to first render | All assets serial-gated behind two GLB loads | Character first, environment streamed after |
| Accessibility | Icon-only buttons, no labels, zoom disabled | Baseline WCAG: labels, keyboard nav, pinch-zoom allowed |
| Dependencies | 3 of 7 unused; three r148 (Jan 2023), Vite 4 | Only what's imported; current three + Vite |

---

## 1. Critical bugs (fix first — small diffs, big wins)

### 1.1 `animateOcean` requestAnimationFrame leak — `environment.js:469-476`
`tick()` in `script.js` calls `animateOcean()` **every frame**, and `animateOcean` **also
schedules itself** with `requestAnimationFrame`. Every rendered frame adds one more
self-perpetuating RAF callback, so after N frames there are ~N ocean callbacks running per
frame. This is unbounded growth: after a minute at 60 fps there are ~3,600 callbacks firing
each frame. The app measurably degrades the longer it's open — this alone explains any
"gets slow over time" reports.

**Fix:** delete the `requestAnimationFrame(animateOcean.bind(...))` line; `tick()` already
drives it. One line removed.

### 1.2 Initial incompatibility check is a silent no-op — `character.js:84`
`initializeClothingItemsVisibility` calls `handleIncompatibilities(selectedItem)` passing a
**mesh object**, but the signature is `(selectedItemKey, selectedSectionKey)`. It looks up
`incompatibleItems.get(undefined)` and does nothing. Initial outfit state may therefore show
incompatible combinations (e.g. jacket index 0 + whatever else is visible in the GLB defaults).

**Fix:** pass the section key, or drop the call and rely on the explicit index choices.

### 1.3 Broken `addEventListener` options — `cameraZoomSystem.js:24-27`
`window.addEventListener("wheel", onMouseWheel, false, { passive: false })` passes options as a
**4th argument, which is ignored** (3rd arg is `useCapture`). The wheel/touchmove listeners are
therefore passive by browser default, and every `event.preventDefault()` inside them throws
"Unable to preventDefault inside passive event listener" and does nothing — page scroll/zoom
fights the 3D zoom on mobile.

**Fix:** `window.addEventListener("wheel", onMouseWheel, { passive: false })`.

### 1.4 Screenshot restore breaks UI layout — `screenshotSystem.js:19`
The panel is `display: flex` in CSS; after a screenshot it's restored with
`ui.style.display = "block"`, permanently breaking the customizer layout for the rest of the
session. **Fix:** `ui.style.display = ""` (or toggle a class / `visibility`).

### 1.5 Dead-property typos on materials — `character.js:165-167`
`child.material.castShadow` / `child.material.recieveShadow` — `castShadow`/`receiveShadow`
are **mesh** properties, not material properties, and one is misspelled. They currently do
nothing (shadows aren't enabled on the renderer anyway). Either delete them, or move to the
mesh and actually enable shadow maps (see §4.4).

### 1.6 Model rotation hijacks all clicks — `modelRotateSystem.js`
`mousedown`/`touchmove` listeners are on `document`, so dragging over the clothing panel,
volume slider, or Webamp also rotates the model. **Fix:** attach to `renderer.domElement`
instead of `document`.

### 1.7 Dead guard in base clothing logic — `userInterfaceManager.js:43`
`if (clothingCategories.boots)` is always truthy (it's always an array). The `boots` category
also can never be populated — `categorizeClothingItems` never returns `"boots"` (only
`"baseBoot"`), so the boot toggle logic is inert. Decide: wire up boots properly (there are
boot meshes and `01_boot.png`/`02_boot.png` thumbnails suggesting the feature was intended)
or delete the dead branch.

### 1.8 No load error handling — `loadingManager.js`
If either GLB fails (network, cache, 404), the loading screen sits at N% forever with no
message. Add `loadingManager.onError` → show a "reload" message. Ten lines, prevents the
worst possible UX (silent infinite spinner).

---

## 2. Asset pipeline (the single biggest user-experience lever)

~100 MB of static assets is the dominant cost; everything else is secondary. Ordered by payoff:

### 2.1 Compress the models (53 MB → target 5–8 MB)
- `bilal.glb` (21 MB) and `env.glb` (32 MB) — run through `gltf-transform` (npx, no new runtime
  dep): `npx @gltf-transform/cli optimize input.glb output.glb --compress draco --texture-compress webp`.
  Draco is already wired into the loader, and embedded PNG/JPEG textures are almost certainly
  the bulk of the 53 MB. KTX2/BasisU is the stronger endgame for GPU memory, but WebP alone
  typically cuts glTF texture payload 60–80% with zero code changes.
- Verify draco is actually active on these files — a 21 MB character GLB suggests uncompressed
  geometry and/or 2–4k PNG textures inside.

### 2.2 Stop downloading things that are never used
- **HDR env map (6.2 MB)** — `loadEnvMap()` in `world.js` loads `alps_field_2k.hdr`, stores it
  in `envMap`… and nothing ever reads it (no `scene.environment`, no material `.envMap`).
  Either apply it (via `PMREMGenerator` → `scene.environment`, which would noticeably improve
  material response — see §4.2) or delete the load. Right now it's 6.2 MB of pure waste.
- **Unused gifs** — `LCPT.gif` (5.9 MB) and `bilal_loading_screen.gif` (2.4 MB) are referenced
  nowhere. Delete from `static/`.
- **Duplicate draco decoders** — `static/draco/` contains both root and `gltf/` copies plus
  encoder files (~3.2 MB). Only `draco_decoder.wasm` + `draco_wasm_wrapper.js` (gltf variant)
  are needed at runtime. Point `setDecoderPath` at the gltf folder and delete the rest.

### 2.3 Thumbnails: 9 MB of PNGs → ~400 KB of WebP
Each clothing thumbnail is 300–380 KB. Batch-convert to WebP or AVIF at display size
(they render at ~120 px tall): `npx sharp-cli` or `cwebp -q 80`. Also add `loading="lazy"`,
`width`/`height`, and `alt` attributes in `createItemIcon`.

### 2.4 Audio: 26 MB, all loaded eagerly-ish
- `demo.mp3` (9.5 MB) — referenced nowhere in code. Delete.
- `song.mp4` (6.5 MB) is `load()`ed on DOMContentLoaded before the user ever presses play.
  Set `preload="none"` / call `.load()` on first play instead.
- Re-encode remaining tracks to ~96–128 kbps (music player background quality); `alaska.mp3`
  at 10 MB is likely 320 kbps.
- `select.mp4` as the click sound: rename/re-encode to a real audio container (`.mp3`/`.ogg`),
  and reuse **one** `Audio` element instead of constructing a new one per click
  (`userInterfaceManager.js:134-138`).

### 2.5 Loading sequence & perceived progress
- The loading gif itself is 2.8 MB — it competes for bandwidth with the models it's masking.
  Replace with a CSS animation or a < 100 KB asset.
- `onProgress` counts items (3–4 total), so the bar jumps 0 → 33 → 100. Track real bytes for
  the two big GLBs (fetch with `ReadableStream` progress, then parse via `GLTFLoader.parse`),
  or at least weight items by known size.
- **Load order uplift:** show the character as soon as `bilal.glb` is ready (it's the product);
  stream `env.glb`, HDR, and Webamp in the background after first render. Today everything is
  serialized behind both GLBs (`script.js:41-51` nests environment inside character callback,
  and all UI systems wait for both).

---

## 3. Rendering & runtime performance

### 3.1 Background geometry is ~1M triangles for a backdrop
- Ground wireframe plane: `PlaneGeometry(20, 5, 800, 200)` = 320k tris (`world.js:57`)
- Lake: `PlaneGeometry(100, 100, 512, 512)` = 524k tris (`environment.js:219`)
- Mountains: `PlaneGeometry(400, 200, 512, 256)` = 262k tris (`environment.js:227`)

These are vertex-shader-displaced planes viewed from a fixed camera at distance. Halving each
subdivision axis (400×100, 256×256, 256×128) cuts vertex work ~75% with no visible difference
at this camera distance. Do a quick visual A/B and tune down until it degrades.

### 3.2 Clamp pixel ratio — `world.js:14`
`renderer.setPixelRatio(window.devicePixelRatio)` unclamped means 3× rendering on modern
phones — 9× the pixels of 1×. Standard practice:
`renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`. Also add it to the resize
handler, and pass `powerPreference: "high-performance"` to the renderer.

### 3.3 Consolidate the three duplicated Perlin shaders
The identical ~110-line `cnoise` GLSL block is pasted into `world.js`, and twice into
`environment.js` (lake + mountains). Extract once into a shared template string module
(`src/shaders/noise.glsl.js`) and interpolate. Removes ~250 lines and makes shader edits
single-sourced. (The wave-displacement vertex shader is also 90% identical between ground
and lake — same extraction.)

### 3.4 Raycast on every mousemove — `cameraZoomSystem.js:30-35`
`checkIntersection()` runs a recursive raycast against the character on every mouse move,
even when the user isn't zooming. Only raycast inside the wheel handler (when a zoom is
actually attempted), or throttle to ~10 Hz. Same pattern exists in the (currently disabled)
color picker.

### 3.5 Frame loop correctness — `script.js:54-68`
- `material.uniforms.uTime.value += 0.02` is frame-rate dependent — ocean speed doubles at
  120 Hz displays. Use the clock's delta/elapsed (there are already **two** `THREE.Clock`s,
  one in `script.js`, one in `environment.js` — one clock, passed or shared, is enough).
- `renderer.render()` runs **before** `mixer.update()` — animation lags one frame. Reorder:
  update mixer/uniforms first, render last.
- `Math.max(...frequencyData)` spreads a 128-element array every frame; fine, but a plain
  loop avoids the allocation. Optional.

### 3.6 Remove the dead canvas — `index.html:126`
`<canvas id="webgl">` is never used; `world.js` creates and appends its own canvas. Either pass
the existing canvas to `WebGLRenderer({ canvas })` (better: keeps it inside `#screenshotable`)
or delete it from the HTML.

---

## 4. Visual quality uplift (rendering looks)

### 4.1 Modernize Three.js (r148 → current release)
r148 is from January 2023. Upgrading unlocks better color management, `WebGPURenderer` as a
future option, and continued fixes. Migration cost is real but bounded and mechanical here:
- `renderer.outputEncoding = THREE.sRGBEncoding` → `renderer.outputColorSpace = THREE.SRGBColorSpace`
- Loader/example import paths move to `three/addons/...`
- Test animation & draco after upgrade.
Do this **before** other rendering work so you're not building on a deprecated API.

### 4.2 Actually use the environment map
The character is lit by just ambient + 2 directional lights — PBR materials without an
environment look flat and plasticky. The HDR is already shipped (§2.2): run it through
`PMREMGenerator`, set `scene.environment`, and drop or reduce the ambient light. This is the
single biggest "looks better" change available, and the asset cost is already being paid.
(Consider swapping the 2k HDR for a 1k or a small `RoomEnvironment`-generated one — for
lighting-only use, 1k is indistinguishable and saves 4+ MB.)

### 4.3 Antialiasing/tone mapping sanity pass after upgrade
ACESFilmic is set — good. After the env-map change, re-tune light intensities (they'll be
too hot with IBL added).

### 4.4 Shadows (optional, do after 4.2)
A single directional shadow with a tight frustum around the character + a soft contact
shadow would ground the avatar. Cost: one shadow map render. Skip if the env-map alone
looks good enough — evaluate then decide.

---

## 5. Dependencies & tooling

### 5.1 Remove unused dependencies
`postprocessing`, `realism-effects`, `lil-gui` — zero imports anywhere in `src/`.
`pnpm remove postprocessing realism-effects lil-gui`.

### 5.2 Replace `ua-parser-js` with one line
It's imported solely for `getDevice().type == "mobile"`. Native equivalent:
`const isMobile = matchMedia("(pointer: coarse)").matches` (or check `navigator.maxTouchPoints`).
Drops a dependency and its parse cost.

### 5.3 Delete `package-lock.json`
Both `pnpm-lock.yaml` and `package-lock.json` exist. The project uses pnpm; the npm lockfile
is stale drift waiting to happen. Also add `.DS_Store` to `.gitignore` and remove the tracked
`static/.DS_Store`.

### 5.4 Upgrade Vite 4 → current major
Mostly config-compatible for a project this simple. Do together with the three upgrade in one
"platform bump" PR. Optionally add `vite-plugin-compression` (brotli) if the host doesn't
already compress.

### 5.5 Rename the package
`"name": "threejs-journey-exercise"` → `"avatar-customizer"`. Cosmetic, but it's the
product now.

---

## 6. UX / UI improvements

### 6.1 Loading experience
Covered in §2.5 — smaller gif, real progress, character-first display. This is the first
impression and currently the worst part of the product (long wait, jumpy percentage,
multi-MB spinner).

### 6.2 Interaction affordances
- **Rotation vs. UI conflict** (§1.6) is the most annoying daily paper-cut — fix first.
- The collapse button's infinite `heartbeat` scale animation (`style.css:347-365`) runs
  forever and reads as an error/alarm. Pulse 2–3 times then stop
  (`animation-iteration-count: 3`), or replace with a subtle glow.
- Volume slider is 1 px tall (`height: 1px`) with a 15 px thumb — hard to grab on touch.
  Make the track ≥ 6 px and the touch target ≥ 32 px.
- `cursor: crosshair` on buttons is nonstandard; use `pointer`.
- Selected-item feedback: the 2 px blue border is subtle; add a background tint/scale on
  `.active` and a hover state on thumbnails.
- Consider drag-to-rotate hint (small "↔ drag to rotate" fade-out label on first load).

### 6.3 Unify the two audio systems
Desktop gets Webamp (playing `alaska.mp3`), mobile gets a mini player (playing `song.mp4`),
and **only the mini player** feeds the AnalyserNode that drives the audio-reactive ocean —
on desktop the flagship reactive-ocean feature never activates unless the hidden mini-player
pipeline runs. Options (pick one):
1. Route Webamp's output through the analyser — Webamp exposes a media element / audio
   context hookup; this makes the desktop experience reactive. Recommended.
2. Drop Webamp entirely (−672 KB skins, −1 dependency, −10 MB `alaska.mp3`) and polish the
   mini player for both platforms. Simplest; do this if Webamp is a nice-to-have rather
   than brand-essential.

### 6.4 Screenshot polish
- Filename with timestamp: `avatar_${Date.now()}.png`.
- Use `renderer.domElement.toBlob` + object URL instead of a base64 data URL (a full-res
  canvas data URL is a multi-MB string on the main thread).
- Optional: brief white-flash/shutter feedback so users know it fired.

### 6.5 Small correctness cleanups in UI code
- `handleUIToggle` if/else branches differ only by icon text — collapse to a ternary.
- `setActiveItem`/`handlePrev/NextButtonClick` find active state by reading DOM classList —
  keep a `currentIndex` per section in JS instead; DOM-as-state is why the initial state
  bug (§1.2) was invisible.
- Dead code: remove the commented-out color-picker markup in `index.html`, the commented
  `#loading-screen` block + its now-dead inline styles, and either finish or delete
  `colorPickerSystem.js` (currently disabled at `script.js:49`; it also has a listener leak —
  it re-adds an `input` listener on every mousedown).
- `style.css` carries ~40 commented-out declarations and a `width: 80x` typo — sweep it.

---

## 7. Accessibility (baseline pass, ~1 hour)

- Remove `maximum-scale=1.0, user-scalable=no` from the viewport meta — blocking pinch zoom
  is a WCAG failure and iOS ignores it anyway.
- Every icon-only button (`play`, `mute`, `screenshot`, `reset`, `animate`, collapse toggle,
  prev/next) needs an `aria-label`.
- Clothing thumbnails: `alt` text (item name is already available as `childMesh.name`).
- Thumbnails are `<img>` with click handlers — wrap in `<button>` for keyboard operability.
- `<html lang>` is set — good. Add a real `<title>` ("Avatar Customizer") and a meta
  description while in there.
- Check the ivory-on-black and white-on-transparent text against actual rendered background
  for contrast.

## 8. Architecture & code health (enables everything above)

Keep the module layout — it's reasonable. Targeted fixes only:

- **Break the circular dependency**: `character.js` ⇄ `userInterfaceManager.js` import each
  other. It works via hoisting luck, but it's why state lives in scattered module-level
  `let`s. Move clothing state (`clothingMap`, `incompatibleItems`, `clothingCategories`, the
  visibility logic) into one `clothingState.js` module both import; UI subscribes, character
  populates.
- **Stop hardcoding animation indices** (`gltf.animations[10]`, `[9]`, `[13]`… in
  `character.js:184-193`) — select by clip **name**. Re-exporting the GLB reshuffles indices
  and silently breaks animations.
- Same for mesh-name magic strings (`"Underwear_Bilal_Skin"`, `"Cube"`,
  `base_boot__`) — collect them in one constants block at the top of `character.js` so the
  GLB naming contract is visible in one place.
- `categorizeClothingItems`: replace the if/else-if chain with a suffix→category lookup table.
- Add `loadingManager.onError` (§1.8) and a top-level guard: if WebGL context creation fails,
  show a friendly message instead of a black page.
- Delete `console.log` debug lines (`script.js:34`, `musicPlayer.js:9`, etc.), and replace the
  Webamp `alert()` + `throw new Error("What's the point of anything?")` with a graceful
  "player unavailable" no-op.

## 9. What NOT to do (explicitly out of scope)

- **No framework rewrite** (React/Svelte/react-three-fiber). The DOM UI is ~200 lines and
  works; a rewrite is weeks of churn for zero user-visible gain.
- **No post-processing stack** (bloom/SSAO/etc.). The deps were installed and never used —
  remove them (§5.1); revisit only after the asset and lighting work lands, if the visual
  bar still isn't met.
- **No state-management library, no TypeScript migration** — the codebase is ~1,500 lines;
  the constants + single-state-module fixes in §8 get 90% of the safety for 5% of the cost.
- **No custom loading framework** — the byte-progress tweak in §2.5 is enough.

---

## 10. Execution roadmap

Each phase is independently shippable; verify after each.

### Phase 1 — Bug squash (½ day) → immediate stability
1.1 RAF leak · 1.3 listener options · 1.4 screenshot display · 1.6 rotation scoping ·
1.2 incompatibility call · 1.7 dead boots guard · 1.8 onError · §3.2 pixel-ratio clamp ·
§3.5 frame-loop order/delta-time.
**Verify:** open app for 10 minutes — flat frame time in DevTools performance monitor;
mobile pinch/scroll no longer fights zoom; screenshot twice, UI intact.

### Phase 2 — Asset diet (1 day) → 100 MB → ~10 MB
§2.1 model compression · §2.2 delete unused HDR-load-or-apply decision, gifs, draco dupes ·
§2.3 WebP thumbnails · §2.4 audio cleanup · §2.5 smaller loading gif.
**Verify:** Network tab, cold load: total transferred < 10 MB before interactive; visual
diff of character before/after compression.

### Phase 3 — Platform bump (½–1 day)
§5 all items (remove unused deps, drop ua-parser, lockfile cleanup, Vite + three upgrades).
**Verify:** `pnpm build` clean; smoke-test animations, draco loading, screenshot, Webamp.

### Phase 4 — Looks & lighting (1 day)
§4.2 env-map lighting (+light retune) · §3.1 geometry subdivision cuts · §3.3 shader
consolidation · §4.4 shadows if still needed.
**Verify:** before/after screenshots at fixed camera; frame time budget on a mid-range phone.

### Phase 5 — UX & a11y polish (1 day)
§6.2 affordances · §6.3 audio unification decision · §6.4 screenshot polish · §7 full list ·
§6.5 + §8 code-health sweep.
**Verify:** keyboard-only walkthrough; Lighthouse a11y ≥ 90; touch test on a real phone.

**Total: ~4–5 focused days.** Phases 1–2 deliver the majority of user-perceived improvement;
if only one thing happens, make it Phase 1 + Phase 2.
