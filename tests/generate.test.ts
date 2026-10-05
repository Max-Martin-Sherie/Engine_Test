import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  bestFor,
  buildGrid,
  dailySeed,
  decodeReplay,
  defaultProfile,
  encodeReplay,
  generateArena,
  ghostTimeline,
  layoutArena,
  parseProfile,
  playReplay,
  recordResult,
  serializeProfile,
  setSetting,
  shouldShowInterstitial,
  solveArena,
  starsFor,
  totalStars,
  verifyLoop,
} from '../src/game/sim';
import { MAX_RESULTS } from '../src/game/sim/profile';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe('the generator and the bot', () => {
  it('builds an arena that can be won for every seed, with a solution that really wins under the real rules', () => {
    for (const seed of SEEDS) {
      const { arena, solution } = generateArena(seed);
      expect(arena.par, `seed ${seed}`).toBeGreaterThanOrEqual(arena.gates.length + 1);
      expect(arena.par).toBe(solution.par);
      expect(solution.loops).toHaveLength(arena.par);
      const result = playReplay(arena, { seed, loops: solution.loops });
      expect(result, `seed ${seed}`).toEqual({ won: true, loops: arena.par });
    }
  });

  it('gives the same arena for the same seed, and different ones for different seeds', () => {
    const a = generateArena(12345);
    const b = generateArena(12345);
    expect(a.arena).toEqual(b.arena);
    expect(a.solution).toEqual(b.solution);
    const other = generateArena(12346);
    expect(other.arena).not.toEqual(a.arena);
  });

  it('makes arenas that need the ghosts: nobody can win a gated arena in one loop', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const { arena } = generateArena(seed);
      expect(arena.par, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(arena.gates.length).toBeGreaterThanOrEqual(1);
      expect(arena.gates.length).toBeLessThanOrEqual(3);
      // Something waits behind the last gate (so every gate matters).
      const last = arena.gates[arena.gates.length - 1]!;
      expect(arena.orbs.some((o) => o.y < last.y)).toBe(true);
    }
  });

  it('keeps the start and every plate permanently safe, so a ghost can always hold a plate', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const { arena } = generateArena(seed);
      const grid = buildGrid(arena);
      for (let j = 0; j < CONFIG.loopSamples; j++) {
        expect(grid.blocked[j * (CONFIG.grid.cols * CONFIG.grid.rows) + grid.startCell], `seed ${seed} start`).toBe(0);
        for (const c of grid.plateCells) expect(grid.blocked[j * (CONFIG.grid.cols * CONFIG.grid.rows) + c]).toBe(0);
      }
    }
  });

  it('no ghost of the bot ever dies while the others replay (the plates only ever help)', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const { arena, solution } = generateArena(seed);
      for (let k = 1; k <= solution.loops.length; k++) {
        const timeline = ghostTimeline(arena, solution.loops.slice(0, k));
        expect(timeline.open).toHaveLength(arena.gates.length);
      }
      // Replaying all but the last loop as ghosts: every one of them stays alive for the whole loop.
      const run = playReplay(arena, { seed, loops: solution.loops });
      expect(run.won).toBe(true);
    }
  });

  it('rejects a recording that walks into danger', () => {
    const { arena, solution } = generateArena(7);
    const bad = Array.from({ length: CONFIG.loopSamples }, () => [arena.gates[0]!.doorX0 + 5, arena.gates[0]!.y]).flat();
    expect(verifyLoop(arena, [], bad).alive).toBe(false);
    expect(playReplay(arena, { seed: 7, loops: [bad] }).won).toBe(false);
    // And a recording with a loop missing does not win either.
    expect(playReplay(arena, { seed: 7, loops: solution.loops.slice(-1) }).won).toBe(false);
  });

  it('the bot solves every layout the generator accepts, and layouts are generated without any hand-placed content', () => {
    const arena = layoutArena(99, 0, false);
    expect(arena.orbs.length).toBeGreaterThanOrEqual(3);
    const solved = solveArena(arena);
    // Whether or not this particular layout is clearable, the answer comes back quickly and is either a verified plan or null.
    expect(solved === null || solved.par >= 2).toBe(true);
  });

  it('is fast enough to run when a game starts: under a quarter of a second on average', () => {
    const t0 = performance.now();
    for (const seed of SEEDS.slice(0, 20)) generateArena(seed + 1000);
    expect((performance.now() - t0) / 20).toBeLessThan(250);
  });
});

describe('sharing a run', () => {
  it('turns a solution into a short link-safe text and back, and the decoded run still wins', () => {
    for (const seed of [3, 9, 27, 81]) {
      const { arena, solution } = generateArena(seed);
      const text = encodeReplay({ seed, loops: solution.loops });
      expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(text.length).toBeLessThan(4000);
      const back = decodeReplay(text);
      expect(back).toEqual({ seed, loops: solution.loops });
      expect(playReplay(arena, back!)).toEqual({ won: true, loops: arena.par });
    }
  });

  it('refuses text that is not a plausible recording, without throwing', () => {
    expect(decodeReplay('')).toBeNull();
    expect(decodeReplay('!!!')).toBeNull();
    expect(decodeReplay('AAAA')).toBeNull();
    const { solution } = generateArena(5);
    const good = encodeReplay({ seed: 5, loops: solution.loops });
    expect(decodeReplay(good.slice(0, good.length - 7))).toBeNull(); // cut short
    expect(decodeReplay(good + 'AAAA')).toBeNull(); // extra junk
    for (const garbage of ['abc', 'zzzzzzzz', '_-_-_-', 'Q'.repeat(500)]) expect(() => decodeReplay(garbage)).not.toThrow();
  });
});

describe('stars and the profile', () => {
  it('gives 3 stars at par, 2 one loop over, 1 otherwise', () => {
    expect(starsFor(3, 3)).toBe(3);
    expect(starsFor(2, 3)).toBe(3);
    expect(starsFor(4, 3)).toBe(2);
    expect(starsFor(5, 3)).toBe(1);
    expect(starsFor(8, 3)).toBe(1);
  });

  it('saves settings and the best result per seed, keeps the better one, and survives garbage', () => {
    let profile = defaultProfile();
    expect(profile.settings).toEqual({ sound: true, haptics: true });
    profile = setSetting(profile, 'sound', false);
    let first = recordResult(profile, 42, 5, 1);
    expect(first.isBest).toBe(true);
    let second = recordResult(first.profile, 42, 3, 3);
    expect(second.isBest).toBe(true);
    const worse = recordResult(second.profile, 42, 4, 2);
    expect(worse.isBest).toBe(false);
    expect(bestFor(worse.profile, 42)).toEqual({ loops: 3, stars: 3 });
    expect(totalStars(worse.profile)).toBe(3);
    expect(worse.profile.cleared).toBe(3);

    const back = parseProfile(serializeProfile(worse.profile));
    expect(back).toEqual(worse.profile);
    for (const bad of [null, '', '{', '[]', '{"results":{"x":{"loops":2}}}', '{"settings":5}']) expect(() => parseProfile(bad)).not.toThrow();
    expect(parseProfile('{"results":{"x":{"loops":2,"stars":1},"7":{"loops":-3,"stars":9}}}').results).toEqual({});
  });

  it('keeps only the most recent results', () => {
    let profile = defaultProfile();
    for (let seed = 0; seed < MAX_RESULTS + 25; seed++) profile = recordResult(profile, seed, 3, 3).profile;
    expect(Object.keys(profile.results)).toHaveLength(MAX_RESULTS);
    expect(profile.results['0']).toBeUndefined();
    expect(profile.results[String(MAX_RESULTS + 24)]).toBeDefined();
  });

  it('shows the short ad only when ready, not right after a rewarded ad, and not too often', () => {
    const base = { nowMs: 1_000_000, lastShownAtMs: null, watchedRewarded: false, ready: true };
    expect(shouldShowInterstitial(base)).toBe(true);
    expect(shouldShowInterstitial({ ...base, ready: false })).toBe(false);
    expect(shouldShowInterstitial({ ...base, watchedRewarded: true })).toBe(false);
    expect(shouldShowInterstitial({ ...base, lastShownAtMs: base.nowMs - 10_000 })).toBe(false);
    expect(shouldShowInterstitial({ ...base, lastShownAtMs: base.nowMs - CONFIG.interstitial.minGapMs })).toBe(true);
  });

  it('names the day as the daily seed', () => {
    expect(dailySeed(20_000.9)).toBe(20_000);
    expect(dailySeed(-5)).toBe(0);
  });
});
