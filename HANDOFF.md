# Handoff

Updated: 2026-10-28 21:50, launch film v2 in flight (a41b9a5 storyboard), session: places

## Goal

Dress a rigged 3D character from a wardrobe, pose it, light it, capture the result. Three.js r185 + Vite, no framework, no backend. Live at https://avatar-customizer.mulualemxar.workers.dev (Cloudflare Workers static assets, `pnpm build && pnpm dlx wrangler deploy`).

## In flight

- master (orchestrator): launch film v2 — two workers: `synth.mjs` revision (continuous flow, resolved ending, writes `_/launch/v2/track.wav`) and `render.mjs` v2 (60 fps, direct camera keyframes, no loader, writes `_/launch/v2/frames` and `launch-v2.mp4`). v1 stays at `_/launch/launch.mp4` and `_/social/2026-10-28-launch/`. Then: review, re-assemble with the v2 track, social export v2, portfolio handoff to the xar-project-highlights session.

## Blocked / waiting

- Asset trims need an owner decision (see Next). Nothing else.

## Decisions (last 2 weeks)

- 2026-10-28 (night): launch film pipeline under `scripts/launch-video/` (`storyboard.json` → `render.mjs` frame-exact against a dev server, `synth.mjs` generates the 124 BPM track, `assemble.sh` ffmpeg); outputs in `_/launch/` and `_/social/2026-10-28-launch/`. Mobile: low tier keeps one place, textures pre-upload, 30 fps idle rest; `?stats` exposes modules for profiling production builds.

- 2026-10-28 (evening): production polish merged for all four places (kits: `forest-kit.glb` 328 KB, `dunes-kit.glb` 28 KB, Quaternius CC0; build scripts under `scripts/`). Skin tone is fair (`SKIN_COLOR #edd6c4`). Depth of field subtle, vignette darkness exactly 1. Icon font class rule lives in style.css (fonts self-hosted). Final matrix: 32 cells, zero errors, both tiers at the 60 Hz cap.

- 2026-10-28 (afternoon): camera-side front light per preset; time-of-day console button (phones had it only inside the sheet); places cached and warmed after the reveal, swaps dip to the fog colour (~260 ms); depth of field + vignette on high (subtle; frame timer drops the blur above 17.5 ms); fonts self-hosted (26-icon subset); loader is a transparent turntable rendered by `scripts/render-loader.mjs`; garments declare body-region coverage and the self-check walks all 8,640 outfits; forest rebuilt from Quaternius CC0 kits (`scripts/build-forest-kit.mjs`, 307 KB GLB).

- 2026-10-28: places are procedural and swappable (`src/modules/env/`): Harbor, Rooftop, Forest, Dunes, each `create({floorY, tier, LIVE})` per the contract in `env/index.js`. The sky is a dome; its probe copy feeds `scene.environment` through PMREM, so the HDR and the scenery GLB are gone (-0.9 MB).
- 2026-10-28: the figure is framed in the uncovered viewport by a `setViewOffset` lens shift (desktop: half the 384 px panel; phone sheet: capped at 10% of the height). Exports clear it.
- 2026-10-28: the model is served brotli by `worker.js` on Cloudflare (`run_worker_first` for /models/*), 3.0 MB raw -> ~2.2 MB on the wire; the face normal map is 512^2 (pixel-identical at the closest zoom).

- 2026-10-28: one-shot gestures settle into the default idle, never into the last looping clip (Fly sat before Cast in the picker, so every gesture ended in levitation). Cycling continues from the picked clip.
- 2026-10-28: garments render double-sided (`shadowSide` stays BackSide); the mountain plane too. Skin roughness fixed at 0.72 (export had 0.4).
- 2026-10-28: night key/fill/env raised, noon key lowered, dusk fill raised. Measured on the character mask: night +23% mean luminance, noon blown pixels 10x fewer, dusk dark pixels 9.7% -> 2.9%.
- 2026-10-28: shaders compile with `compileAsync` before the reveal, HDR fetch starts with the character, font CSS is non-blocking, scenery streams as soon as the character bytes arrive.
- 2026-10-28: meshopt re-encode of bilal.glb REJECTED: gltf-transform quantize breaks skinned placement in three r185 (soles box -0.9 -> -1.9 m). env.glb grows 516 -> 934 KB under meshopt. Dropping the 4 unused clips saves only ~80 KB (buffers are shared).
- 2026-10-28: Vercel `avatar-customizer.vercel.app` deploys the 2023 repo `MULUALEM-TEKLE/avatar-customizer`, not this one. Cloudflare is the deploy target now.
- No framework, no TypeScript, no state library (see `uplift.md`).

## Next

- Places polish if wanted: a crossfade between places (today it is a hard swap after an async compile), a social capture per place, the pier is 4 m wide (flat 2.0 m, contract asks 2.5 m; the light pool still fits).
- Low-tier devices: measure the sky-probe PMREM cost on a real phone (now only the settled frame refreshes on low).
- bilal.glb is 3.0 MB raw / 2.1 MB brotli on the wire (0.9 MB raw animation floats are the next trim: compress animation only, quantize off, verify soles).
- loader.webp is an animation (88 KB); 40 KB needs dropping frames.
- Per-garment colour customisation needs material cloning and a design first.

## Do not touch

- none
