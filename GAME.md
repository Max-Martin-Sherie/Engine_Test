# RockFall

This branch (`rockfall`) is a game built on the engine from `main`. The README and `CLAUDE.md`
describe the engine and its workflow; this file describes what is specific to RockFall.

Steer the sand-coloured pebble by dragging (touch) or moving the mouse. Rocks fall faster and more
often the longer you survive; your score is the seconds you last. One "Watch ad to continue" revive
per run clears the field and gives 1.5 s of invulnerability.

Everything the player sees or does lives in `src/game/`; `src/engine/` is unchanged from `main`.

- App ID: `com.maxmartin.rockfall` (`capacitor.config.json`; `android/` was generated from it)
- `src/game/index.ts`: the flow (title / playing / paused / over / ad), best score, revive-with-ad
- `src/game/sim/`: pure rules (`game.ts`), lifecycle (`step.ts`), tuning (`config.ts`, `difficulty.ts`)
- `src/game/view/`: drawing (`scene.ts`, `rockArt.ts`, `palette.ts`)
- `src/game/ui/`: DOM screens, HUD and CSS; title art in `info.ts` + `ui/rockfall.css`
- Tests: `tests/rockfall.test.ts` (rules), `tests/lifecycle.test.ts` (mocked rules), `e2e/game.spec.ts`.
  The engine's own tests (`core`, `layout`, `ads`, `admob`, `architecture`, `e2e/engine.spec.ts`) come from `main`.

Engine updates arrive with `git merge main`.
