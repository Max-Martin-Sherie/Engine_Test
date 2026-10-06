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
behind the menu · `?speed=N` run N sim ticks per update (1..16) · `?fog=0` no fog of war.
`window.__game.debug` has the live match and session and helpers for tests (`spawn`, `give`,
`screenOf`, `focus`, `freeSpot`, `destroyBuildings`).

## Status

Verified: the simulation (unit, balance and determinism tests), the whole game in desktop Chrome with
software WebGL (Playwright, mouse and Chrome's emulated touch), the production build. **Not verified
on a real phone or tablet**: touch feel, frame rate on a real GPU and haptics. See
`docs/NOVAFRONTIER.md` section 11.
