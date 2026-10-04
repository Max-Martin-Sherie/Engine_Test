# RockFall

This branch (`rockfall`) is a game built on the engine from `main`. The README and `CLAUDE.md`
describe the engine and its workflow; this file describes what is specific to RockFall.

Steer the sand-coloured pebble by dragging (touch) or moving the mouse. Rocks fall faster and more
often the longer you survive; your score is the seconds you last. One "Watch ad to continue" revive
per run clears the field and gives 1.5 s of invulnerability.

- App ID: `com.maxmartin.rockfall` (set in `capacitor.config.json`; `android/` was generated from it)
- Tuning: `src/sim/config.ts` (spawn rate, fall speed, hitbox, speeds)
- Rules: `src/sim/game.ts`, `src/sim/difficulty.ts`
- Look: `src/view2d/scene.ts`, `rockArt.ts`, `palette.ts`; title art in `src/gameInfo.ts` and `src/rockfall.css`
- Tests: `tests/rockfall.test.ts` (rules) and `e2e/game.spec.ts`; `tests/engine-lifecycle.test.ts`
  comes from the engine and must keep passing unchanged

Engine updates arrive with `git merge main`.
