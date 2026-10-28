# Handoff

Updated: 2026-10-28 09:35, merge of uplift/full-experience into master, session: merge-and-push

## Goal

Dress a rigged 3D character from a wardrobe, pose it, light it, capture the result. Three.js r185 + Vite, no framework, no backend. The full uplift (perf, assets, state module, lighting, a11y) is merged on master. See `uplift.md` for what shipped and what is left.

## In flight

- master: merge uplift/full-experience and push. Done when this commit is on origin/master.

## Blocked / waiting

- none

## Decisions (last 2 weeks)

- 2026-10-28: uplift/full-experience merged to master as a fast-forward. The branch is deleted locally; it was never on origin.
- No framework, no TypeScript, no state library (see `uplift.md`, "Left deliberately").
- Music stays 10 MB with `preload="none"`; re-encode only if that changes.

## Next

- Per-garment colour customisation needs material cloning and a design first.
- Six orphan thumbnails in `static/img/` and the `Track 02` placeholder title.

## Do not touch

- none
