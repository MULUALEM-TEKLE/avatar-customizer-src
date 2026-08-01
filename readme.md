# Avatar Customizer

Dress a rigged 3D character from a configurable wardrobe, pose it, light it, and capture the
result. Three.js r185 + Vite, no framework, no backend.

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # -> dist/
pnpm check    # outfit-rule assertions, runs under plain node
```

---

## What it does

**Wardrobe.** Eight categories — hoodies, jackets, coveralls, t-shirts, pants, boots, bags, masks.
Garments that would clip through each other cannot be worn together; picking one removes the other
and says so. Base layers (top, bottom, boots) appear and disappear on their own depending on what
covers them. Every row has a "nothing worn" slot, so you can always get back to bare.

**Looks.** Six curated outfits, plus shuffle. Shuffle produces plausible outfits — one top layer,
bottoms only when the top isn't a coverall — not random noise.

**Poses.** Ten clips selected by name. Looping poses hold; one-shots (Victory, Cast, Defeat, Land)
play through and settle back into the last looping pose.

**Scene.** Four times of day — dawn, noon, dusk, night — each a coherent set of sky, fog, light
colours, exposure, water and mountain palettes. Switching crossfades the whole scene over 1.2s.

**Photo mode.** Exports at 2048px on the long edge, in screen / 1:1 / 4:5 / 9:16, with the
now-wearing line composited into the image and a timestamped filename. The trim marks at the
viewport corners mark exactly what the capture will contain, and flash when it fires.

**Sharing.** The outfit, pose and scene live in the URL hash, so a link is enough to hand a look to
someone else. localStorage remembers the last session; a shared link always wins over it.

**Sound.** One player, one analyser, every device. The music drives the lake's wave height and the
console's VU rule — the same signal, visible in two places.

**Keyboard.** Everything is reachable. Press `?` for the list, which is generated from the same
table the key handler reads, so it cannot drift.

---

## Layout

`src/modules/`

| Module | Owns |
|---|---|
| `config.js` | The GLB naming contract — mesh suffixes, clip names, categories, conflicts, presets. The only file that knows these strings. |
| `state.js` | What is worn. No three.js import, so `state.selfcheck.js` runs under node. |
| `presets.js` | Time-of-day tables and quality tiers; the live values every consumer binds to. |
| `world.js` | Renderer, camera, lights, IBL, shadows, ground, contact shadow, composer, resize. |
| `environment.js` | Lake, mountains, sky, scenery props. |
| `character.js` | GLB → dressed, animated character. Clips by name. |
| `controls.js` | Every pointer and camera gesture. |
| `ui.js` | Builds the panel and console, subscribes to state. Never stores what is worn. |
| `keyboard.js` | The shortcut table, read by both the key handler and the help sheet. |
| `audio.js` | Player, analyser, click SFX. |
| `photoMode.js`, `persistence.js`, `notify.js`, `loadingManager.js`, `loadingScreen.js` | Capture, links, messages, asset streaming, first paint. |

**The one rule worth knowing:** `state.js` owns the outfit and the DOM subscribes to it. The DOM is
a view. It used to be the source of truth — selection was read back out of `classList` — which is
precisely why a wrong initial outfit could sit there unnoticed.

### Adding a garment

1. Export the mesh into `bilal.glb` with a name ending in a known suffix (`_jacket`, `_hoodie`, …).
2. Drop a thumbnail at `static/img/<meshname>.webp`.

That's it — `CATEGORY_RULES` picks it up, the row grows, the counter follows. A new *category*
needs an entry in `CATEGORY_RULES` and `CATEGORIES`, and a line in `CONFLICTS` if it overlaps
something. `pnpm check` will tell you if the conflict table isn't symmetric.

---

## Performance

Three quality tiers. The default is guessed from cores, memory and screen size, then corrected by
measuring the median of frames 30–150 and moving one step. `?q=low|medium|high` overrides both and
disables the auto-correction.

|  | low | medium | high |
|---|---|---|---|
| Backdrop verts | 18k | 43k | 86k |
| Shadows | off | 1024² | 1024² |
| IBL | hemisphere light (HDR never fetched) | HDR | HDR |
| Bloom | — | — | yes |
| Pixel budget | 1.0M | 1.6M | 2.6M |

Pixel ratio is capped by both a DPR ceiling and an absolute pixel budget — a 4K desktop at DPR 1
and a phone at DPR 3 are both too many pixels, and a DPR cap alone only catches one of them.

**Payload:** ~3.8 MB before interactive (character 3.2 MB, JS 213 KB gzipped, loader 124 KB,
draco decoder ~250 KB). Scenery, the HDR and music stream in afterwards; music is `preload="none"`
and only downloads if you press play.

---

## Assets

Regenerate from originals with:

```bash
npx @gltf-transform/cli optimize in.glb out.glb \
  --compress draco --texture-compress webp --texture-size 1024 --simplify false
```

`--simplify false` matters: simplification damages skinned geometry. Verify after any re-export
that mesh node names and animation clip names survived — the whole wardrobe keys off them.

Thumbnails: `cwebp -q 82 -resize 0 320`. Audio: 96k AAC. The environment HDR is 512×256 and is used
for lighting only; the visible sky is a shader, not the HDR.

---

## Browser support

Modern browsers with WebGL2. WebGL failure and a failed character load both show a real message
with a retry, rather than a loading bar that sits at 62% forever.

## License

Private.
