# Rockfall

Portrait 9:16 mobile web game (dodge falling rocks) built with TypeScript, Vite, PixiJS v8 and
Capacitor 8, with AdMob rewarded test ads on Android/iOS. Needs **Node >= 22.12**.

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

URL flags: `?seed=N` makes every run reproducible; `?ads=no-fill` / `?ads=skip` make the fake ad
service fail. `window.__game` (`phase`, `score`, `rocks`) exists in dev builds only.

Set `CHROMIUM_PATH` to run e2e against an installed Chrome instead of Playwright's download.

## Architecture

Strict dependency direction: **main -> ui / view2d / services -> sim -> core**.
A layer may import only from layers to its right. `ui`, `view2d` and `services` never import each
other. `tests/architecture.test.ts` enforces this, so `npm run check` fails on a violation.

- `src/sim/` - pure game rules. **No Pixi, DOM, `window`, timers, `Date` or `Math.random`.**
  Seeded mulberry32 RNG whose state lives in `GameState`. Fixed `dt` of 1/60 via
  `step(state, input)`. Entities keep previous positions for render interpolation. Emits events
  (`died`, `revived`) that `main` drains with `drainEvents`. **All tuning lives in `sim/config.ts`.**
- `src/core/` - fixed-timestep loop (accumulator, 0.25 s frame clamp, `render(alpha)`), pointer
  input in client space, RNG, safe `localStorage` wrapper.
- `src/view2d/` - Pixi. `autoStart: false` (our loop calls `app.render()`), `preference: 'webgpu'`
  with automatic WebGL fallback, `resizeTo` the host, `autoDensity`, resolution capped at 2. Pools
  rock `Graphics` keyed by sim id, masks rocks to the field, interpolates with `alpha`. Exposes
  `render(state, alpha)` and `clientToWorldX()`. **Reads state, never writes it.**
- `src/ui/` - DOM overlay with real `<button>`s. Screens: title, HUD, game over, paused,
  waiting-for-ad. HUD is `pointer-events: none`. Handles safe-area insets. **Never call
  `.focus()` on buttons** (focus rings on touch). Callbacks only; never touches `GameState`.
- `src/services/` - `AdService` and `AnalyticsService` interfaces. No method may throw or reject
  into game code (`guardAdService` is the backstop). Browser: fake ads + console analytics. Native:
  AdMob, imported lazily.
- `src/main.ts` - composition root and phase state machine (`title | playing | paused | over | ad`).
  Keep it thin. The loop starts immediately; ad init runs in the background and must never block
  the title screen.

## Rules

1. Run `npm run check` after every change.
2. New gameplay logic gets a test in `tests/`.
3. After any visual change, run `npm run e2e` and **open the screenshots** in `e2e/screenshots/`.
   Passing tests do not prove the canvas drew anything.
4. Never hand-edit `android/` or `ios/`. Change `scripts/setup-native.mjs` instead (it is
   idempotent and has tests in `tests/setup-native.test.ts`), then re-run it.
5. Keep tuning numbers in `sim/config.ts`; no magic numbers in `sim/step.ts` or `sim/difficulty.ts`.

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
- `cap add` fails without a built `dist/`, so the `*:setup` scripts build first.
