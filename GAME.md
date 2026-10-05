# Echo Loop

This branch (`echoloop`) is a game built on the engine from `main`. The README and `CLAUDE.md`
describe the engine and its workflow; this file describes what is specific to Echo Loop. The long
version, with the algorithms, is `docs/ECHOLOOP.md`.

**The game.** You have 20 seconds in an arena of laser walls, drifting mines and pulsing danger
zones. Drag a finger to steer. When the time ends, time rewinds and what you just did becomes a
**ghost** that repeats it exactly, while you go again beside it. Plates open doors in the laser
walls, but only while someone stands on them. So in loop 1 you walk to a plate and stay there; in
loop 2 your ghost holds the door open while you walk through; in loop 3 two ghosts hold two doors.
You win when, **in a single loop**, you and your ghosts together have collected every orb.
You have 8 loops (a rewarded ad adds 2). Stars compare your loops with the bot's (par).

- App ID: `com.maxmartin.echoloop` (`capacitor.config.json`)
- Modes on the menu: **Daily arena** (the same seed for everyone each UTC day), **Random arena**, and
  **Watch it play itself** (the bot clears arena after arena at up to 128x speed)
- **Rewind now** ends a loop early; its ghost then stands still where it stopped (to keep a plate pressed)
- **Share this run** copies a link; opening it replays exactly that run and shows "Can you beat it?"
- Saved data (localStorage): `echoloop.profile` (settings, best result per seed, arenas cleared)

## There are no hand-made levels

A level is a number. `generateArena(seed)` lays an arena out by rules (how many gates, where the
plates, orbs and hazards go), then a **bot** tries to clear it; a layout the bot cannot clear is
thrown away and the next attempt for that seed is tried. So every seed has a clearable arena, the
same one on every device, and the bot's loops give the par.

## Where things are

```
src/game/
  index.ts       the FLOW: menu / playing / dead / rewind / winning / result / lost / demo / viewer
  sfx.ts, info.ts
  sim/           PURE rules (no DOM, no clock, no Math.random; no sin/cos/pow: replays must match on every device)
    config.ts    every tuning number
    types.ts     Arena, Gate, Drifter, Pulsar, ...
    hazards.ts   what is deadly where and when (pure functions of the tick)
    run.ts       one run: ticks, ghosts, plates, orbs, loops, rewind
    plan.ts      the bot: plans on a grid over time, verified against the real rules
    generate.ts  seed -> arena (+ the bot's solution)
    share.ts     run <-> short link text, replay stepping, stars
    profile.ts, rules.ts, index.ts
  view/          Pixi drawing (scene.ts, palette.ts)
  ui/            DOM screens (ui.ts, styles.css, dom.ts)
tests/sim.test.ts, tests/generate.test.ts   the rules, the generator + bot, sharing, the profile
e2e/echoloop.spec.ts                        every flow in a real browser, with screenshots
src/engine/core/replay.ts                   (engine, from main) encodeInts / decodeInts for the link text
```

## Dev URL parameters

`?seed=N` (the first "Random arena" and the demo start at seed N, then N+1, ...), `?replay=<text>`
(open a shared run), and in dev builds only `?speed=N` (N ticks per frame) and `?autoplay=1` (the bot's
recording drives the player), which the browser tests use. `window.__game` (dev only) shows the run,
the arena, the bot's solution and the profile.

Engine updates arrive with `git merge main`.
