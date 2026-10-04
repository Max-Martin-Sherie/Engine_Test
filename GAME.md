# Fruit Slice

This branch (`fruitslice`) is a game built on the engine from `main`. The README and `CLAUDE.md`
describe the engine and its workflow; this file describes what is specific to Fruit Slice.

**The game:** a fruit sits on the field. Drag one straight line across it. The closer the two halves
are to 50/50, the better. The allowed error (the tolerance) shrinks with every fruit you win. A drag
that does not go fully across the fruit (starts or ends on it, or misses it) is a *cancel*: it costs
nothing and you can try again.

**Modes**

- **Classic**: no clock. One miss over the tolerance ends the run.
- **Arcade**: 60 s clock (max 99), three strikes. Good cuts add time, misses cost time and a strike.
  Fruit drift, then spin, then come in pairs; bombs (a drag through one is a strike) appear later.
  It starts with a wider tolerance than Classic and gets harder more slowly.
- **Survival**: you have a *margin*, 25 points to start (35 at most). Every cut takes its deviation
  from 50/50 off it, so a perfect cut is free and a 4-point-off cut costs 4. The widest cut you may
  make is whatever the margin still pays for, so the green zone on the gauge shrinks as you go. The
  run ends when a cut would leave less than 0.6. Now and then a "+x" bubble floats over the fruit,
  off-centre: aim the drag through it and x is added to your margin. After 8 fruit a loss multiplier
  grows (×1.0 up to ×4.0), so even a very good player eventually runs out. All of it is in
  `CONFIG.survival` (`sim/config.ts`).

**Trying again.** Once a run has failed: pay coins (20, then doubling, capped at 1000) or watch a
rewarded ad (works for any try, including the most expensive). A try puts the same fruit back; in
Survival it also gives the margin back that the fatal cut would have used. At the end of a run you earn coins and can watch a rewarded
ad to double them. Returning to the menu shows a short interstitial, but not after a rewarded ad in
that run and not more often than every 45 s.

**Skins.** Knife skins are pure data (`src/game/sim/skins.ts`, ten bundled; "steel" is always free).
An optional online catalog is merged in the background (`?catalog=<url>` in dev, `src/game/catalog.ts`);
bad entries are dropped, the last good catalog is cached for offline use, and the game works with no
server at all. The profile (coins, owned and worn skin, best scores, sound/vibration) lives in
`localStorage` (`fruitslice.profile`).

## Where things are

- App ID: `com.maxmartin.fruitslice` (`capacitor.config.json`; `android/` was generated from it)
- `src/game/index.ts`: the flow (menu / playing / paused / failing / tryAgain / result / shop / settings / ad), profile, ads, haptics, sound
- `src/game/sim/`: pure rules, no DOM, timers or `Math.random`
  - `config.ts`: every tuning number (tolerance curves, Arcade, Survival, economy)
  - `fruit.ts`: the 19 fruit outlines; `run.ts`: the run (spawns, cuts, strikes, retries, events);
    `geometry.ts` + `cut.ts`: splitting a shape by a line and judging a drag; `rules.ts`: scoring, coins, restart cost
  - `profile.ts`, `skins.ts`: saved data and the skin catalog
- `src/game/view/`: Pixi drawing. `scene.ts` (field, fruit, halves, knife, juice), `fruitArt.ts`
  (each fruit drawn), `palette.ts` (colours)
- `src/game/ui/`: DOM menu, HUD, shop and result screens (`ui.ts`, `styles.css`)
- `src/game/sfx.ts`: synthesised sound (no audio files)

**Adding a fruit:** add a kind and a `RadialSpec` in `sim/fruit.ts`, colours in `view/palette.ts`, and
a drawing in `view/fruitArt.ts` (halves reuse it, masked). `?gallery` (dev only) lays
every fruit out to check them; the e2e gallery test fails if one throws.

## Dev URL parameters

`?seed=N` (reproducible run), `?time=S` (Arcade start time), `?catalog=URL` (online skins; put it first,
Vite treats URLs ending in `.json` as files), `?gallery`, plus the engine's `?ads=no-fill` and friends.
In dev builds `window.__game` shows the current run and profile.

## Tests

- `tests/geometry`, `fruit-rules`, `run`, `survival`, `meta`: the sim (pure, seeded)
- `e2e/fruitslice.spec.ts`: every screen and flow in a real browser; `e2e/helpers.ts` computes a drag
  that splits a fruit by an exact amount using the game's own geometry
- The engine's own tests (`core`, `layout`, `ads`, `admob*`, `input`, `devices`, `architecture`,
  `e2e/engine.spec.ts`) come from `main`

Engine updates arrive with `git merge main`.
