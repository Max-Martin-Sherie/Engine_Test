# Nova Frontier

This branch (`novafrontier`) is a game built on the engine from `main`. The README and `CLAUDE.md`
describe the engine and its workflow; this file describes what is specific to Nova Frontier. The long
version, with the algorithms, is `docs/NOVAFRONTIER.md`.

**The game.** A landscape, 3D real-time strategy game for one player against the computer. You start
with a Hub, four workers and 250 minerals. Mine minerals, raise Depots (supply), a Barracks, a
Refinery on a geyser (gas), a Factory and an Airfield; train Troopers, Tanks and Skiffs (flyers);
guard with Turrets; and destroy every enemy building. Fog of war hides what you have not scouted.
Three opponents: Easy, Normal and Hard.

- App ID: `com.maxmartin.novafrontier` (`capacitor.config.json`, `"orientation": "landscape"`)
- Controls: mouse and keyboard, or touch (tap, drag to pan, press-and-hold then drag to box-select,
  pinch to zoom). The in-game "How to play" lists them all.
- Ads: one optional rewarded **Supply drop** per battle (+400 minerals, +200 gas, from the pause
  menu) and an interstitial between battles (never before the second battle, never after a short one).
- Saved data (localStorage): `novafrontier.profile` (settings, opponent, map, wins, games played)

## Built for phones first

The target is a phone held sideways, so touch is the main way to play and the mouse is the extra.

- **Touch layout.** On a touch screen every button is at least 44 px, the command card stands taller than the
  bottom panel so its buttons can be big without eating the battlefield, keyboard hints are hidden and text is a
  notch larger. A test checks this at five phone sizes (667 x 375 up to 932 x 430).
- **Controls.** Tap selects; tap the ground to move, an enemy to attack, minerals to mine. There is no right click
  on a phone, so the Move, Attack and Rally buttons ("press one, then tap") and the x on the selection panel
  (let go of the selection) cover the rest. Hold then drag draws a selection box; one finger pans; two fingers zoom.
- **Fullscreen and landscape.** On a phone, pressing Battle asks the browser for fullscreen and a landscape lock
  (Android Chrome allows both; an iPhone's Safari allows neither, so *Add to Home Screen* is the way to get a
  fullscreen game there). The screen is kept awake during a battle. Held upright, the game asks you to turn the phone,
  and it pauses when you leave the page.
- **Speed you cannot test for.** The game measures its own frame rate and, if frames keep taking over about 32 ms,
  draws fewer pixels (down to 60%). `src/game/quality.ts`, with tests.
- **Installable.** `public/manifest.webmanifest` and the icons let Chrome and Safari install it as a fullscreen,
  landscape app from the web page. The Android project (`android/`) is generated and locked to landscape.

## No hand-made maps

A map is a number. `generateMap(seed)` scatters rock blobs and ridges, turns the picture half way
round so both sides get the same ground, clears room around six bases, and proves with a flood fill
that every base can be walked to from every other. A map that fails is thrown away and the next
attempt for that seed is tried (the last resort is an open field). The same seed is the same map on
every device.

## Where things are

```
src/game/
  index.ts       the FLOW: menu (with a battle playing behind it) / playing / paused / result
  session.ts     what the player is doing: selection, modes, the command card, what a click means (no DOM)
  controls.ts    mouse, touch and keyboard -> camera, selection and orders
  sfx.ts, info.ts, profile.ts, globals.d.ts
  sim/           PURE rules (no DOM, no clock, no Math.random; no sin/cos/pow: a seed plays out the same everywhere)
    config.ts    every tuning number: units, buildings, economy, the three AI levels
    map.ts       the seeded, symmetric, verified map generator
    path.ts      A* with corner rules and string-pulling
    match.ts     createMatch / stepMatch (20 ticks a second) / victory
    commands.ts  everything a player or the computer can order (each checks ownership)
    economy.ts, construction.ts, combat.ts, orders.ts, units.ts, vision.ts, entities.ts
    ai.ts        the computer player: same commands as a person, no free units
    testing.ts   helpers that drop entities straight in (tests and dev screenshots only)
  view/          Three.js world (instanced solids, fog in the shader), Pixi overlay, minimap, effects
  ui/            DOM HUD, command card, menus, icons, styles (callbacks and plain values only)
tests/           unit, balance and architecture tests (Vitest)
e2e/             Playwright: real mouse, keyboard and touch against the running game
docs/            NOVAFRONTIER.md (+ pdf/)
```

## Dev flags (dev builds only)

`?seed=N` the map · `?level=easy|normal|hard` · `?autostart=1` skip the menu · `?demo=0` no battle
behind the menu · `?speed=N` run N sim ticks per update (1..16) · `?fog=0` no fog of war ·
`?quality=N` pin the resolution (0.5..1) instead of letting the game adapt it.
`window.__game.debug` has the live match and session and helpers for tests (`spawn`, `give`,
`screenOf`, `focus`, `freeSpot`, `destroyBuildings`, `fogBrightness`).

## Status

Verified: the simulation (unit, balance and determinism tests), the whole game in desktop Chrome with
software WebGL (Playwright, mouse and Chrome's emulated touch, at five phone sizes), the production
build. **Not verified on a real phone or tablet**: touch feel, frame rate on a real GPU, haptics,
fullscreen and the wake lock, and installing it to a home screen. See `docs/NOVAFRONTIER.md` section 11.
