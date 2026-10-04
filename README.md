# Rockfall

A portrait (9:16) dodge-the-rocks game, built as a starter for mobile web games that ship to
Android and iOS through Capacitor, with Google AdMob rewarded ads ("Watch ad to continue").

Steer the sand-coloured pebble by dragging (touch) or moving the mouse. Rocks fall faster and
more often the longer you survive. Your score is the seconds you last; the best score is kept in
`localStorage`.

**Stack:** TypeScript (strict) · Vite 8 · PixiJS v8 · Capacitor 8 · `@capacitor-community/admob` 8 ·
Vitest · Playwright

## Requirements

- **Node 22.12 or newer.** Vite 8 needs 20.19+, but Vitest 5 and the Capacitor 8 CLI need 22+.
- For Android: Android Studio (it bundles the JDK 21 that Capacitor 8 needs) and an emulator or phone.
- For iOS: a Mac with Xcode.

```bash
npm install
```

## Run in the browser

```bash
npm run dev
```

Open <http://localhost:5173>. Useful URL flags:

| Flag | Effect |
| --- | --- |
| `?seed=42` | Every run uses seed 42, so rock patterns repeat exactly |
| `?ads=no-fill` | The fake ad service never loads an ad (no "Watch ad to continue" button) |
| `?ads=skip` | The fake ad plays, but the "user" closes it early (no reward) |

In the browser, ads are a fake: a grey "Test ad" screen for 2 seconds. In dev builds
`window.__game` (`phase`, `score`, `rocks`) gives tests a read-only view of the game.

## Try it on your phone over Wi-Fi

1. Put the phone and the computer on the same Wi-Fi network.
2. Run `npm run dev`. Vite prints a line like `Network: http://192.168.1.11:5173/`.
3. Open that address in the phone's browser. If it does not load, allow Node through the
   computer's firewall for private networks.

Over plain `http://` on a LAN address the browser does not expose WebGPU (it needs a secure
context), so PixiJS uses its WebGL fallback. That is expected.

## Tests

```bash
npm run check    # typecheck + unit tests; run this after every change
npm test         # unit tests only (Vitest)
npm run e2e      # Playwright, Pixel 7 emulation, starts the dev server itself
```

The unit tests cover the simulation (determinism, clamping, speed cap, difficulty caps, death,
revive, grace period), the loop, storage, the fake and AdMob ad services (with a scripted fake
plugin), the native setup script, and the architecture rules in `CLAUDE.md`.

Playwright needs a Chromium. Either download Playwright's:

```bash
npx playwright install chromium
```

or point it at one you already have:

```bash
# macOS / Linux
CHROMIUM_PATH="/usr/bin/chromium" npm run e2e
# Windows (PowerShell)
$env:CHROMIUM_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"; npm run e2e
```

The e2e run writes screenshots to `e2e/screenshots/` (git-ignored). **Look at them** after any
visual change: the tests passing does not prove the canvas drew anything.

## Android

```bash
npm run android:setup   # once: build, cap add android, configure AdMob + portrait
npm run android         # build, cap sync android, run on a device or emulator
```

`android:setup` runs `scripts/setup-native.mjs android`, which is idempotent: it adds the AdMob
`APPLICATION_ID` meta-data (pointing at `@string/admob_app_id`, holding Google's **test** app ID)
and locks `MainActivity` to portrait. Do not hand-edit `android/`; change the script and re-run it.

You can run the script again at any time: `node scripts/setup-native.mjs android`.

## iOS (macOS only)

```bash
npm run ios:setup   # once: build, cap add ios, configure AdMob + ATT + portrait
npm run ios         # build, cap sync ios, run
```

The setup script adds `GADApplicationIdentifier` (Google's test app ID),
`NSUserTrackingUsageDescription`, the `cstr6suwn9.skadnetwork` SKAdNetwork item, and limits
iPhone to portrait. Google recommends its longer SKAdNetwork list for full ad demand; add the extra
IDs to the script before a real release.

## Ads

Test builds use Google's official test ad units, so you will see test ads only. Native start-up
order: initialize the SDK, request consent info, show the consent form only when required and
available, then (only if `canRequestAds`) request App Tracking Transparency on iOS and preload the
first rewarded ad. The title screen never waits for any of it.

The reward is decided from the SDK's *events* (Rewarded, Dismissed, FailedToShow) with a 120 s
safety timeout, not from the promise that `showRewardVideoAd()` returns; on Android that promise
never settles when the user closes the ad early.

## Release checklist

- [ ] **appId and name.** Change `appId` (and `appName`) in `capacitor.config.json` to your own
      reverse-domain ID. Do this *before* `android:setup` / `ios:setup`; after the native
      projects exist, change the ID in Android Studio / Xcode as well.
- [ ] **Real AdMob app IDs.** Create the app in the AdMob console, then run the setup script
      with your IDs (they replace the test ones):
      `ADMOB_APP_ID_ANDROID=ca-app-pub-…~… node scripts/setup-native.mjs android`
      `ADMOB_APP_ID_IOS=ca-app-pub-…~… node scripts/setup-native.mjs ios`
- [ ] **Real rewarded ad unit IDs.** Copy `.env.production.example` to `.env.production` and fill in
      `VITE_ADMOB_REWARDED_ANDROID` and `VITE_ADMOB_REWARDED_IOS`, with `VITE_ADS_TESTING=false`.
      If an ID is missing, ads are disabled; the app never falls back to a test ID.
- [ ] **Rebuild and sync** (`npm run android` / `npm run ios`) so the production env is baked in.
- [ ] **Consent message.** Create and publish the GDPR / privacy message in AdMob's Privacy &
      messaging section, otherwise EEA users never see a form.
- [ ] **iOS:** reword `NSUserTrackingUsageDescription` in the setup script if you like; add the
      full SKAdNetwork list; set the bundle ID, team and signing in Xcode.
- [ ] **Android:** set a release signing config, `versionCode` / `versionName`, and app icons and
      splash screens (the Capacitor defaults are placeholders).
- [ ] **Store listings:** privacy policy URL, the Play Data safety form, the App Store privacy
      "nutrition label", and the age rating questionnaire (ads affect these answers).
- [ ] **Analytics.** `ConsoleAnalytics` only logs; swap in a real `AnalyticsService` if you need one.
- [ ] **Test on real devices** before submitting (see below).

## Project layout

```
src/
  core/       fixed-timestep loop, pointer input, RNG, safe storage
  sim/        pure game rules + config.ts (all tuning)
  view2d/     PixiJS rendering
  ui/         DOM overlay (screens, HUD)
  services/   ads + analytics (fake in the browser, AdMob on native)
  main.ts     composition root and phase state machine
scripts/      setup-native.mjs
tests/        Vitest        e2e/   Playwright
```

Dependency direction: `main -> ui / view2d / services -> sim -> core`. See `CLAUDE.md` for the rules.
