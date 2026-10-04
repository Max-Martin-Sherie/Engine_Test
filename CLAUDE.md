# Game Engine

A portrait 9:16 mobile web game **engine**: TypeScript, Vite, PixiJS v8, Capacitor 8, AdMob rewarded
ads. It loads the libraries and services, runs a fixed-timestep loop, and draws **nothing**.
Run alone (`main` branch) it shows a blank black screen: that is correct. Menus, HUD, score, rules,
art and the flow between screens belong to a *game*, which is a branch of this repo.
Needs **Node >= 22.12**.

## Branching: main is the engine, every game is a branch

- Each game is a branch of `main`, checked out in its own folder with a git worktree
  (`git worktree add -b <game> ../<Game> main`). Nobody switches branches.
- **Engine fixes happen on `main` first** (this folder), are proven here (`npm run check`,
  `npm run e2e`), then merged into every game branch (`git merge main`), running `npm run check` in
  each. Never develop engine fixes inside a game branch and port them back. Never merge a game
  branch into `main`.
- Keep engine commits separate from game commits.
- A game lives in `src/game/` (plus its own tests, e2e specs and identity files). If a game needs
  something from the engine that is missing, add a hook to the engine on `main`; don't edit
  `src/engine/` inside a game branch.
- Do not push without being asked. Published branches (origin/*) are never rewritten.

## Layout

```
src/main.ts            boot(createGame): the only file that sees both sides
src/engine/            the engine - never imports from src/game
  core/                loop, pointer input, seeded RNG, safe storage, world size + layout math
  services/            ads (fake in browsers, AdMob on devices) and analytics
  view/                PixiJS bootstrap: letterboxed canvas + an empty, clipped `field` layer
  ui/                  invisible helpers: createStage() sizes a stage over the field, handles
                       safe-area insets; base.css is structure only (no fonts or colours)
  boot.ts, context.ts  wires it together; defines EngineContext / Game / GameFactory
src/game/              the game - everything the player sees and does
  index.ts             createGame(context): Game      (empty on main)
  (a game adds)        sim/ (pure rules), view/ (drawing), ui/ (DOM screens, CSS), flow, info
```

### The contract

`createGame(context: EngineContext): Game`. The context gives the game: `input` (pointer, client
space), `view` (`view.field` to draw into, `view.clientToWorldX`, `view.setBackground`), `ads`,
`analytics`, `params` (URL query), `uiRoot` (#ui), `world` (360 x 640) and `resetClock()`. The game
returns `{ step, update(dt), render(alpha) }`: a fixed step in seconds, a simulation step, and a
function that updates what is drawn. The engine calls `render`, then draws the frame.

The engine starts the loop immediately and starts the renderer and ad SDK in the background; a
game's DOM UI must never wait for them. `view.field` is usable at once, before the renderer is
ready.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server, also on the LAN (`server.host: true`, port 5173) |
| `npm run build` | `tsc --noEmit && vite build` into `dist/` |
| `npm run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) |
| `npm test` | Vitest unit tests in `tests/` |
| `npm run check` | typecheck + tests. **Run after every change.** |
| `npm run e2e` | Playwright (Pixel 7) against the dev server; screenshots go to `e2e/screenshots/` |
| `npm run android:setup` | one-time: build, `cap add android`, run `scripts/setup-native.mjs android` |
| `npm run android` | build, `cap sync android`, `cap run android` |
| `npm run ios:setup` / `npm run ios` | same for iOS (macOS only) |

URL flags: `?ads=no-fill` / `?ads=skip` make the fake ad service fail; a game may read others from
`context.params` (RockFall uses `?seed=N`). In dev builds `window.__engine` (`viewReady`,
`renderer`, `fit`, `adsReady`) is a read-only snapshot for tests; a game can add its own.

Set `CHROMIUM_PATH` to run e2e against an installed Chrome instead of Playwright's download.

## Architecture rules (enforced by `tests/architecture.test.ts`)

Dependency direction: **main -> game -> engine**, and inside each:

- engine: `boot` -> `services` / `view` / `ui` -> `core`. These three never import each other.
- game: `flow` (root) -> `ui` / `view` -> `sim` -> `engine/core`.

Further rules:

- **The engine never imports the game and draws nothing** (no sprites, fonts or colours in `src/engine`).
- `game/sim` and `engine/core/{rng,layout,config}` are pure: **no Pixi, DOM, `window`, timers,
  `Date` or `Math.random`**. Randomness comes from the seeded RNG held in the game state; tuning
  numbers live in the game's `sim/config.ts`.
- Only `view` layers import `pixi.js`; only `engine/services` imports Capacitor / AdMob.
- `game/ui` never touches the game state (callbacks and plain values only); `game/view` reads
  state and never writes it.
- **Never call `.focus()` on buttons** (focus rings on touch). A HUD must be `pointer-events: none`.
- Services never throw or reject into game code (`guardAdService` is the backstop).

## Rules for working here

1. Run `npm run check` after every change.
2. New gameplay logic gets a test in `tests/`.
3. After any visual change, run `npm run e2e` and **open the screenshots** in `e2e/screenshots/`.
   Passing tests do not prove the canvas drew anything.
4. Never hand-edit `android/` or `ios/`. Change `scripts/setup-native.mjs` instead (it is
   idempotent and has tests in `tests/setup-native.test.ts`), then re-run it. Native projects are
   generated per game and never exist on `main`.
5. When writing files from a shell, use the editor tools or single-quoted heredocs: backticks inside
   double quotes run as commands.

## AdMob gotchas (verified against the plugin's native source)

- `AdMob.initialize()` must run **before** `requestConsentInfo()` / `showConsentForm()`; the iOS
  consent form needs an initialized plugin.
- Show the form only if status is `REQUIRED` **and** a form is available. Load nothing unless
  `canRequestAds`. Then request ATT if `trackingAuthorizationStatus()` is `notDetermined`.
- Rewarded outcome comes from **events**, never from `showRewardVideoAd()`'s promise: on Android that
  promise never settles if the user closes the ad early. Await listener registration (Rewarded,
  Dismissed, FailedToShow) *before* calling show; on show rejection finish with `false`; keep the
  120 s safety timeout; always remove the listeners.
- Test unit IDs are used unless `VITE_ADS_TESTING=false`; real IDs then come from
  `VITE_ADMOB_REWARDED_ANDROID` / `VITE_ADMOB_REWARDED_IOS`. A missing real ID disables ads, it never
  falls back to a test ID.
- The plugin's index does not export `PrivacyOptionsRequirementStatus` as a value.

## Toolchain notes

- TypeScript 7 no longer has the classic compiler API, so the Capacitor CLI cannot transpile a
  `capacitor.config.ts` reliably. The config is `capacitor.config.json` on purpose.
- Vite 8 needs Node >= 20.19, Vitest 5 and the Capacitor 8 CLI need Node >= 22.
- Capacitor 8's Android library compiles at Java 21; building Android needs JDK 21+ and the Android SDK.
- `cap add` fails without a built `dist/`, so the `*:setup` scripts build first.
- On phones Pixi appends a stray accessibility `<button>` to `<body>`; `engine/view/view.ts` removes
  it after init (the engine e2e fails if that stops working).
- Git checks files out as LF on every machine (`.gitattributes`).
