# Handoff

Updated: 2026-10-28 13:10, after merging the four place branches (2762b30), session: places

## Goal

Dress a rigged 3D character from a wardrobe, pose it, light it, capture the result. Three.js r185 + Vite, no framework, no backend. Live at https://avatar-customizer.mulualemxar.workers.dev (Cloudflare Workers static assets, `pnpm build && pnpm dlx wrangler deploy`).

## In flight

- master (orchestrator): all five worker branches merged. Running the capture matrix (`node scripts/capture-matrix.mjs`, high and low) and a fresh code review; then fixes, deploy, report.

## Blocked / waiting

- Asset trims need an owner decision (see Next). Nothing else.

## Decisions (last 2 weeks)

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

- bilal.glb (3.1 MB = 1.1 MB textures, 0.9 MB raw animation floats, 0.65 MB Draco mesh, 0.5 MB JSON) is 75% of the download. Options for the owner: downscale the one 1024^2 texture (315 KB), compress animation only (meshopt with quantize off, verify soles), or serve `.glb` brotli via a tiny Worker route (Cloudflare does not compress model/gltf-binary).
- loader.webp 121 KB could be ~30 KB.
- Per-garment colour customisation needs material cloning and a design first.

## Do not touch

- none
