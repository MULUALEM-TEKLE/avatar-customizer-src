# Uplift — status

The original plan is in git history (`git show master:uplift.md`). This file records what shipped
on `uplift/full-experience`, where the work went further than the plan, where it went a different
way, and what is deliberately left.

**Headline:** ~90 MB of assets → 15 MB shipped / **~3.8 MB before interactive**. Every critical bug
in §1 of the plan is fixed. The app was rebuilt around one owned state module, one input path, and
a real lighting rig.

---

## Scorecard

| Area | Was | Now |
|---|---|---|
| Download before interactive | ~90–100 MB | **~3.8 MB** (character 3.2 MB, JS 213 KB gz, loader 124 KB, draco ~250 KB) |
| Total shipped assets | ~90 MB | 15 MB, of which 10 MB is music that only downloads on play |
| Frame cost | grew unbounded (RAF leak) + ~1M backdrop triangles | stable; backdrop 18k/43k/86k verts by tier |
| Time to first render | serialised behind two GLBs (53 MB) | character only (3.2 MB); scenery, HDR and music stream after |
| Progress | counted 3 items: 0 → 33 → 100 | real bytes, monotonic, with a byte readout |
| Failure | silent infinite spinner | typed errors, visible message, retry |
| Dependencies | 7, of which 3 unused | **2** (three, gsap) |
| three / vite | r148 (Jan 2023) / 4 | r185 / 8 |
| Lighting | ambient + 2 unaimed directionals; a 6.2 MB HDR loaded and never used | IBL + aimed key/fill/rim, shadows, contact shadow |

---

## Fixed from the plan

Every item in §1 (critical bugs), plus §2 (assets), §3 (runtime), §4 (looks), §5 (deps), §6 (UX),
§7 (a11y) and §8 (architecture). Notable ones:

- **RAF leak** — `animateOcean` scheduled itself while `tick()` also called it, adding one
  self-perpetuating callback per rendered frame.
- **Rotation hijacked every drag** — listeners were on `document`. Every pointer listener is now on
  the canvas, so the panel and the volume slider are unreachable from the rotation path *by
  construction*, not by a guard.
- **Zoom listeners were silently passive** — options were passed as a 4th argument, where they are
  ignored, so every `preventDefault()` inside them threw and page scroll won on touch.
- **Screenshot broke the layout** — restored a `display: flex` panel with `display: "block"`.
- **Initial incompatibility check was a no-op** — passed a mesh where a section key was expected.
- **Boots were never wired** — `categorizeClothingItems` never returned `"boots"`, so the category
  was inert and the base boot could never be replaced. Both boot meshes are now selectable.
- **Frame loop rendered before `mixer.update()`** — animation lagged one frame.
- **Dead material properties** — `material.castShadow` / `material.recieveShadow` (one misspelled,
  both on the wrong object).

## Found during the work, not in the plan

- **The avatar floated 0.35 m above its own ground.** The grid was hard-coded to `y = -1.25` while
  the character stood at `y = -0.9`. This was the single biggest reason nothing read as grounded.
  The floor is now placed from the character's measured bounds.
- **The frame loop started before the world existed**, throwing on every frame until boot finished.
- **The loading screen's exit listener caught bubbling `transitionend` from its own children** and
  tore the screen away mid-fade.
- **The camera framed the figure at 96% of frame height** — the boots touched the bottom edge.
- **Two CSS specificity traps** that silently broke the desktop panel: `.seg` beat `.panel__tabs`
  (which added a third grid row and pushed the scroller off the bottom), and `.console button` beat
  `.console__recall`.
- **The Retry button was visible on a successful load** — an author `display` rule beats the UA
  rule behind the `hidden` attribute.
- **The sky plane missed the top ~15% of the frame**, hidden only because the clear colour matched.
- **The mountain shader resolved 12 cm features on a ridge 127 m away** — roughly one pixel, which
  is why the ridge line crawled.
- **Toast icons were read aloud by screen readers** as their ligature names.

### Found by adversarial review (41 agents, two rounds; 23 findings survived refutation)

- **Fog was applied in the wrong colour space.** three uploads `fogColor` already
  encoded in the renderer's *output* space when drawing to the canvas, which is why its own
  shaders order the chunks tone-map → colour-space → fog. All three backdrop shaders had fog
  first, so at dusk it came out ~2.9× too bright and the ridge sat against the sky as a pale band
  exactly where it should have dissolved into it — and because the composer path uses the working
  space instead, the seam appeared and disappeared with the Quality setting.
- **Every single-select control claimed a keyboard model it did not implement** — `listbox`/
  `option` and `radiogroup`/`radio` with no arrow keys and no roving tabindex. Now native radios.
- **`applyOutfit` skipped the conflict rules**, so a share link could dress the avatar in two
  intersecting garments and write that back to storage. Two self-checks that named
  conflict-freedom asserted something else, so `pnpm check` stayed green on exactly that bug.
- **The automatic tier tuner never updated the Quality control**, leaving a stale `checked` radio
  — and clicking the tier you were actually on fired no `change` event.
- **`boot()` had no `.catch()`**: any unexpected throw left a frozen overlay over an inert shell.
- **The WebGL probe accepted WebGL 1**, which r185 cannot use.
- **High-tier exports were viewport-resolution renders upscaled to 2048px** — `capture()` resized
  the renderer but not the composer.
- **The error copy was inverted**: once every failure became an `AssetError`, a corrupt file was
  told to check its connection and a dropped connection was told the file was damaged.
- **Segment selection and focus rings were eaten by the divider rule** — Quality defaults to the
  middle option, so the control shipped showing no selection at all.
- **Chip focus rings were clipped** by the scroller's content box, entirely so on the first chip.
- Plus: muting left the UI click sounds audible, a focused slider swallowed every letter shortcut,
  `syncURL` wrote history synchronously on every change (Safari throws past ~100 in 30s),
  `persistSession` was subscribed twice, and `--level` was written to `<html>` every frame.

## Where this went further than the plan

The plan's §9 said no new features. The brief for this branch was the opposite, so:

- **Outfit persistence and server-free share links.** Outfit, pose and scene ride in the URL hash;
  localStorage remembers the last session and a shared link always wins over it.
- **Six curated looks and a shuffle** that produces plausible outfits rather than noise.
- **Pose picker by name** (10 clips), with one-shots that play through and settle back into the
  last looping pose.
- **Four time-of-day presets** — dawn, noon, dusk, night — each a coherent set of sky, fog, light
  colour, exposure, water and mountain palettes, crossfading over 1.2 s.
- **Three quality tiers** with auto-detection *and* runtime correction from measured frame cost.
- **Photo mode** — aspect presets, 2048 px export, timestamped filename, and the now-wearing line
  composited into the PNG so every capture comes out captioned and shareable.
- **Full keyboard control** with a shortcuts sheet generated from the same table the handler reads.
- **A complete visual redesign** ("PLATE") — the panel has no card, no border and no shadow; it
  dissolves into the scene through a masked scrim ramp.

## Where this went a different way than the plan

- **Webamp was removed, not wired up.** §6.3 preferred routing Webamp through the analyser, but
  Webamp 1.5 exposes no way to reach its internal audio graph — `createMediaElementSource` cannot
  be called twice on one element from two contexts. Dropping it removed a heavy dependency, 10 MB
  of audio and 672 KB of skins, and made the audio-reactive water work on desktop for the first
  time. **If Webamp is brand-essential, this is the one decision to revisit.**
- **Post-processing was not removed entirely.** §9 said no post stack; a single `UnrealBloomPass`
  from three's own addons (no new dependency) is enabled on the high tier only, because the sun
  disc genuinely sits above the tone-mapping white point.
- **The local `static/draco/` copy was deleted rather than deduplicated.** r185's `DRACOLoader`
  resolves its own decoder through `import.meta.url`, so the bundler emits a copy guaranteed to
  match the installed three. A hand-copied decoder can drift a major version out of step and fail
  only on compressed meshes.
- **No pitch on the camera.** It is a turntable: drag rotates the model, zoom moves the camera on
  one axis. The two channels are orthogonal, so there is no arbitration layer and they cannot
  fight. Tilting would reveal the edges of the flat billboard backdrop.

---

## Verification

- `pnpm check` — 16 assertions over conflicts, base layers, share codes, presets and randomize,
  including that a hand-edited share link cannot produce a conflicting outfit. Runs under plain
  node in a fraction of a second; `state.js` has no three.js import precisely so that it can.
- `pnpm build` — clean.
- Driven headlessly over CDP (no puppeteer; a ~120-line driver over the DevTools protocol) at
  1440×900, 1280×800, 1000×640 and 390×844. Zero console errors or warnings. Verified by
  measurement rather than by eye:
  - Share links restore outfit, pose and scene; conflicts resolve and name what was removed.
  - Preset crossfades land on the exact target hex and keep instance identity, so bound uniforms
    keep tracking.
  - Feet stay 6mm off the floor across the whole idle clip, and no pose exceeds the frame
    (the tallest, Flying, peaks at y=1.23 against a half-height of 1.28).
  - Focus rings render on chips, segments and Look buttons, using *trusted* key events so
    `:focus-visible` behaves as it does for a real user.
  - Capture returns 2048px and restores the canvas exactly; the High-tier export grew from
    5.8MB to 7.2MB once the composer was resized too, which is the upscaling bug leaving.
  - Failure paths: a 404 on the character shows a modal `<dialog>` with a Reload button and
    focus on it; a 404 on the scenery or the HDR leaves the app fully usable and says so.

## Left deliberately

- **No framework, no TypeScript, no state library.** The plan was right about this.
- **Music is still 10 MB.** It is `preload="none"` and only downloads if the user presses play, so
  it costs nothing until it is wanted. Re-encode to 64k HE-AAC if that changes.
- **`Track 02` has a placeholder title** — the second audio file shipped without metadata.
- **Six thumbnails have no matching mesh** (`01_bag`, `03_bag`, `05_hoodie`, and the base layers).
  Harmless, but they are dead weight in `static/img/`.
- **Per-garment colour customisation.** `colorPickerSystem.js` was deleted rather than finished;
  materials are shared across meshes, so this needs material cloning and a real design first.
