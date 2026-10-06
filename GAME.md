# Arena Zero

This branch (`arenazero`) is a game built on the engine from `main`. The README and `CLAUDE.md` describe
the engine and its workflow; this file describes what is specific to Arena Zero. The long version, with
the algorithms, is `docs/ARENAZERO.md`.

**The game.** A landscape, 3D arena shooter for one player against computer players: bots only, no
network, no waiting. A **Deathmatch** (free for all, first to 20) or a **Team deathmatch** (first to 40),
five minutes a match, in a small walled arena of crates, steps and platforms. Five guns (Pulse Pistol,
Arc Rifle, Scatter, Railgun, Rocket Launcher), pick-ups for health, armor and ammunition, three levels
of bot (Easy, Normal, Hard), 4 to 10 players, and a map that is just a number. The fighters are
humanoids with a walk cycle, and a **physics ragdoll** when they fall.

- App ID: `com.maxmartin.arenazero` (`capacitor.config.json`, `"orientation": "landscape"`)
- Controls: a phone (floating stick, look area, Fire/Jump/Aim/Reload/Next, a weapon bar, aim assist and
  optional auto fire, left-handed layout), or keyboard and mouse (W A S D, mouse look with pointer lock,
  Shift, Space, R, 1-5, wheel, Tab, Esc). The in-game "How to play" lists them.
- Ads: one optional rewarded **boost** per match, on the death screen (come back at once with full armor,
  the Railgun and the Rocket Launcher), and an interstitial between matches (never after your first match, never
  after a short one).
- Saved data (localStorage): `arenazero.profile` (settings, last choices, matches, wins, kills, best match)

## Built for phones first

The target is a phone held sideways, so touch is the main way to play and the mouse is the extra.

- **Touch layout.** Left thumb: a floating stick that appears where it lands (all the way out runs).
  Right thumb: drag to look. The big Fire button also looks while it is held, so one thumb shoots and
  aims. Every button is at least 44 px; a test measures them, and checks nothing overlaps, at seven
  screen sizes (667 x 375 up to 1024 x 768).
- **Aim assist** (`aim.ts`): near an enemy you can see, turns slow down and the view drifts onto them;
  **auto fire** shoots while the crosshair is on one. Both can be switched off. Look speed and field of
  view are sliders; looking slows while zoomed.
- **Fullscreen and landscape.** On a phone, pressing Play asks the browser for fullscreen and a landscape
  lock (Android Chrome allows both; an iPhone's Safari allows neither, so *Add to Home Screen* is the way
  to get a fullscreen game there). The screen stays awake during a match. Held upright, the game asks you
  to turn the phone, and it pauses when you leave the page.
- **Speed you cannot test for.** The game measures its own frame rate and, if frames keep taking over
  about 32 ms, draws fewer pixels (down to 60%). `src/game/quality.ts`, with tests.
- **Installable.** `public/manifest.webmanifest` and the icons let Chrome and Safari install it as a
  fullscreen, landscape app from the web page.

## No hand-made maps, no hand-made animation

A map is a number. `generateArena(seed)` lays out a mirrored heightfield (48 x 48 one-metre columns),
then proves with a flood fill that every spawn and pick-up can be reached and fills in anything that
cannot; a layout that fails is thrown away and the next attempt tried (the last resort is a plain
arena). The same seed is the same arena on every device.

The people are sixteen joints. Alive, a walk cycle and a two-bone arm IK pose them with the gun where
the head looks; dead, the same joints go to a Verlet ragdoll (gravity, bone links, collision with the
arena, friction, sleep), thrown by the shot or the explosion that killed them.

## Where things are

```
src/game/
  index.ts       the FLOW: menu (with a bots-only match behind it) / countdown / playing / paused / result
  controls.ts    keyboard, mouse (pointer lock) and touch -> the simulation's Input and where you look
  aim.ts         aim assist and auto fire (pure)       camera.ts   the eye: bob, zoom, lean, the dead view (pure)
  profile.ts     saved settings and career (pure)       quality.ts  adaptive resolution (pure)
  feedback.ts    simulation events -> effects and ragdolls         sfx.ts, info.ts, globals.d.ts
  sim/           PURE rules (no DOM, no clock, no Math.random): a seed plays out the same everywhere
    config.ts    every tuning number: the guns, the player, the bots, the modes, the arena
    arena.ts     the seeded, mirrored, verified heightfield + the A* nav grid
    physics.ts   movement on a heightfield, rays against the world and against bodies
    weapons.ts   spread and bloom, falloff, headshots, armor, rockets and splash
    bots.ts      senses, reaction time, aim error, paths, choices
    match.ts     createMatch / stepMatch (60 ticks a second) / rules / events
    testing.ts   helpers that build scenes (tests and dev screenshots only)
  view/          Three.js: arena (instanced, triplanar shader), characters + skeleton + ragdoll,
                 effects, pick-ups, your gun, the world that draws them
  ui/            DOM HUD, touch pad, menus, icons, styles (callbacks and plain values only)
tests/           unit, balance and architecture tests (Vitest)
e2e/             Playwright: real multi-touch, mouse and keyboard against the running game
docs/            ARENAZERO.md (+ pdf/)
```

## Dev flags (dev builds only)

`?seed=N` the map · `?mode=ffa|tdm` · `?level=easy|normal|hard` · `?bots=3|5|7|9` · `?autostart=1` skip
the menu · `?countdown=0` skip the countdown · `?quality=N` pin the resolution (0.5..1) instead of
letting the game adapt it. `window.__game.debug` has the live match and levers for tests (`teleport`,
`put`, `give`, `kill`, `faceActor`, `screenOf`, `fallen`, `look`).

## Status

Verified: the simulation (unit, balance and determinism tests), the aim assist, camera, profile and
ragdoll, the whole game in desktop Chrome with software WebGL (Playwright, Chrome's emulated multi-touch
and a desktop keyboard and mouse, at seven screen sizes), the production build. **Not verified on a real
phone or tablet**: touch feel, frame rate on a real GPU, haptics, sound output, fullscreen and the wake
lock, installing it to a home screen, and the Android and iOS builds. See `docs/ARENAZERO.md` section 11.
