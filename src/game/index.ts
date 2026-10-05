/**
 * Echo Loop: the game's flow. The engine gives us its tools (input, the Pixi view, ads, analytics, haptics,
 * audio, the #ui overlay); this file runs the phase machine (menu / playing / rewinding / result / demo ...)
 * and connects the pure simulation (sim/) to what is drawn (view/) and shown (ui/).
 */
import type { GameFactory } from '../engine';
import { safeGetItem, safeSetItem } from '../engine/core/storage';
import { GAME_ID, PROFILE_KEY } from './info';
import { createSfx } from './sfx';
import {
  CONFIG,
  beginNextLoop,
  bestFor,
  createRun,
  dailySeed,
  debugRun,
  decodeReplay,
  drainEvents,
  encodeReplay,
  endLoop,
  extendLoops,
  generateArena,
  loopsOf,
  parseProfile,
  playReplay,
  pointerAt,
  recordResult,
  retryLoop,
  serializeProfile,
  setSetting,
  shouldShowInterstitial,
  starsFor,
  stepReplay,
  stepRun,
  totalStars,
  type Arena,
  type Generated,
  type Pointer,
  type Replay,
  type Run,
  type RunEvent,
  type Samples,
} from './sim';
import { createUi, type SettingKey } from './ui';
import { COLORS, createScene } from './view';

type Phase = 'menu' | 'settings' | 'playing' | 'dead' | 'rewind' | 'winning' | 'paused' | 'result' | 'lost' | 'ad' | 'demo' | 'viewer';

/** The bot (demo) or a recorded run (viewer) playing by itself, at a speed measured in ticks per frame. */
interface Playback {
  kind: 'demo' | 'viewer';
  arena: Arena;
  loops: Samples[];
  speed: number;
  /** Do `next` once the clock passes `wait` (a short beat between loops and arenas). */
  wait: number;
  next: 'loop' | 'arena' | null;
  seed: number;
  cleared: number;
  totalLoops: number;
  done: boolean;
  label: string;
}

/** "Rewind now" appears after this many ticks (half a second), so a stray tap cannot end a loop at once. */
const END_LOOP_AFTER = 30;
const DEMO_SPEEDS = [8, 32, 64, 128] as const;
const VIEWER_SPEEDS = [1, 2, 4] as const;

function parseSeed(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) >>> 0 : null;
}

export const createGame: GameFactory = ({ ads, analytics, audio, haptics, input, view, params, uiRoot, resetClock }) => {
  // ?seed=N makes "Random arena" and the demo start from that seed. In dev builds ?speed=N plays N ticks per frame and
  // ?autoplay=1 lets the bot's own recording drive the player, for tests.
  const fixedSeed = parseSeed(params.get('seed'));
  const devSpeed = import.meta.env.DEV ? Math.max(1, Math.min(240, Number(params.get('speed')) || 1)) : 1;
  const autoplay = import.meta.env.DEV && params.get('autoplay') === '1';
  let nextRandom = fixedSeed;
  const pickSeed = (): number => {
    if (nextRandom !== null) {
      const seed = nextRandom;
      nextRandom += 1; // the next "random" arena after a fixed seed is the following seed: predictable for tests
      return seed;
    }
    return (Math.random() * 100_000) >>> 0;
  };

  const clock = (): number => performance.now() / 1000;

  view.setBackground(COLORS.letterbox);
  const scene = createScene(view.field);
  const sfx = createSfx(audio, haptics);

  // ---- state ----------------------------------------------------------------------------
  let phase: Phase = 'menu';
  let profile = parseProfile(safeGetItem(PROFILE_KEY));
  let generated: Generated | null = null;
  let run: Run | null = null;
  let playback: Playback | null = null;
  let waitUntil = 0;
  let isDaily = false;
  let lastReplay: Replay | null = null;
  let watchedRewarded = false;
  let lastInterstitialAt: number | null = null;
  let resultInfo: Record<string, unknown> | null = null;

  const save = (): void => void safeSetItem(PROFILE_KEY, serializeProfile(profile));
  const today = (): number => dailySeed(Date.now() / 86_400_000);

  function applyProfile(): void {
    audio.setEnabled(profile.settings.sound);
    haptics.setEnabled(profile.settings.haptics);
  }

  // ---- screens --------------------------------------------------------------------------
  const ui = createUi(uiRoot, {
    onDaily: () => {
      sfx.click();
      startArena(today(), true);
    },
    onRandom: () => {
      sfx.click();
      startArena(pickSeed(), false);
    },
    onDemo: () => {
      sfx.click();
      startDemo();
    },
    onOpenSettings: () => {
      sfx.click();
      ui.setSettings(profile.settings);
      setPhase('settings', 'settings');
    },
    onBack: () => {
      sfx.click();
      void backToMenu(false);
    },
    onToggle: (key: SettingKey) => {
      profile = setSetting(profile, key, !profile.settings[key]);
      save();
      applyProfile();
      ui.setSettings(profile.settings);
    },
    onPause: () => pause(),
    onResume: () => resume(),
    onQuit: () => {
      sfx.click();
      void backToMenu(false);
    },
    onShare: () => void share(),
    onWatch: () => {
      sfx.click();
      if (lastReplay && generated) startViewer(generated.arena, lastReplay, 'Your run', false);
    },
    onAnother: () => {
      sfx.click();
      startArena(pickSeed(), false);
    },
    onMenu: () => {
      sfx.click();
      void backToMenu(phase === 'result');
    },
    onEndLoop: () => {
      if (phase !== 'playing' || !run || !endLoop(run)) return;
      sfx.click();
      for (const event of drainEvents(run)) handleEvent(event, true, clock());
      settle(run, clock());
    },
    onExtraLoops: () => void extraLoopsWithAd(),
    onGiveUp: () => {
      sfx.click();
      void backToMenu(true);
    },
    onDemoSpeed: () => {
      if (!playback) return;
      const speeds: readonly number[] = playback.kind === 'demo' ? DEMO_SPEEDS : VIEWER_SPEEDS;
      playback.speed = speeds[(speeds.indexOf(playback.speed) + 1) % speeds.length] ?? speeds[0] ?? 1;
      sfx.click();
    },
    onDemoStop: () => {
      sfx.click();
      void backToMenu(false);
    },
    onPlayArena: () => {
      sfx.click();
      if (playback) startArena(playback.seed, false);
    },
  });

  function setPhase(next: Phase, screen: Parameters<typeof ui.show>[0]): void {
    phase = next;
    ui.show(screen);
  }

  function refreshMenu(): void {
    const seed = today();
    ui.setMenu({ dailySeed: seed, dailyBest: bestFor(profile, seed), totalStars: totalStars(profile), cleared: profile.cleared });
  }

  async function backToMenu(mayShowAd: boolean): Promise<void> {
    phase = 'menu';
    run = null;
    playback = null;
    scene.reset();
    refreshMenu();
    ui.show('menu');
    if (!mayShowAd) return;
    const ready = ads.isInterstitialReady();
    if (!shouldShowInterstitial({ nowMs: clock() * 1000, lastShownAtMs: lastInterstitialAt, watchedRewarded, ready })) {
      void ads.preloadInterstitial();
      return;
    }
    const shown = await ads.showInterstitial();
    if (shown) lastInterstitialAt = clock() * 1000;
    watchedRewarded = false;
    void ads.preloadInterstitial();
    analytics.track('interstitial', { shown });
    resetClock();
  }

  // ---- playing --------------------------------------------------------------------------
  function startArena(seed: number, daily: boolean): void {
    generated = generateArena(seed);
    run = createRun(generated.arena);
    isDaily = daily;
    playback = null;
    lastReplay = null;
    scene.reset();
    drainEvents(run);
    setPhase('playing', 'hud');
    resetClock();
    ui.banner('Loop 1', 'loop', 'Take every orb in one loop');
    sfx.loopStart();
    void ads.preloadRewarded();
    void ads.preloadInterstitial();
    analytics.track('arena_start', { seed, par: generated.arena.par, attempts: generated.attempts, daily });
  }

  function currentPointer(r: Run): Pointer {
    if (autoplay && generated) return pointerAt(generated.solution.loops[r.loop] ?? [], r.tick);
    if (!input.isDown || input.clientX === null || input.clientY === null) return null;
    return view.clientToWorld(input.clientX, input.clientY);
  }

  function handleEvent(event: RunEvent, audible: boolean, now: number): void {
    switch (event.type) {
      case 'orb':
        scene.orb(event.x, event.y, event.by, now);
        if (audible) sfx.orb(event.by === 0);
        break;
      case 'died':
        scene.died(event.x, event.y, now);
        if (audible) sfx.died();
        analytics.track('died', { seed: run?.arena.seed ?? 0, loop: run?.loop ?? 0 });
        break;
      case 'ghostDied':
        scene.ghostDied(event.x, event.y, event.ghost, now);
        if (audible) sfx.ghostDied();
        break;
      case 'gate':
        scene.gate(event.gate, event.open, now);
        if (audible) sfx.gate(event.open);
        break;
      default:
        break;
    }
  }

  function stepLive(now: number): void {
    const r = run;
    if (!r) return;
    for (let i = 0; i < devSpeed && r.phase === 'playing'; i++) {
      stepRun(r, currentPointer(r));
      for (const event of drainEvents(r)) handleEvent(event, true, now);
    }
    settle(r, now);
  }

  /** Reacts to how a step (or a "rewind now") left the run. */
  function settle(r: Run, now: number): void {
    switch (r.phase) {
      case 'dead':
        phase = 'dead';
        waitUntil = now + 0.8;
        ui.banner('Rewinding', 'ouch', 'The loop restarts');
        break;
      case 'loopEnd':
        phase = 'rewind';
        waitUntil = now + 0.95;
        sfx.rewind();
        scene.rewind(now);
        ui.banner('Loop over', 'rewind', 'You become a ghost');
        break;
      case 'won':
        winArena(r, now);
        break;
      case 'lost':
        sfx.lost();
        ui.setLost({ seed: r.arena.seed, collected: r.collectedCount, total: r.arena.orbs.length, adReady: ads.isRewardedReady(), extraLoops: CONFIG.extraLoops });
        setPhase('lost', 'lost');
        break;
      default:
        break;
    }
  }

  function loopBanner(r: Run): void {
    const ghosts = r.ghosts.length;
    ui.banner(`Loop ${r.loop + 1}`, 'loop', ghosts === 0 ? 'Take every orb in one loop' : ghosts === 1 ? 'Your ghost is with you' : `${ghosts} ghosts are with you`);
  }

  function winArena(r: Run, now: number): void {
    const loops = r.loop + 1;
    const par = r.arena.par;
    const stars = starsFor(loops, par);
    const saved = recordResult(profile, r.arena.seed, loops, stars);
    profile = saved.profile;
    save();
    lastReplay = { seed: r.arena.seed, loops: loopsOf(r) };
    resultInfo = { seed: r.arena.seed, loops, par, stars, isBest: saved.isBest, deaths: r.deaths, daily: isDaily };
    ui.setResult({ seed: r.arena.seed, loops, par, stars, isBest: saved.isBest, deaths: r.deaths, daily: isDaily });
    sfx.win();
    scene.won(now);
    ui.banner('Cleared', 'win', `${loops} ${loops === 1 ? 'loop' : 'loops'} · par ${par}`);
    phase = 'winning';
    waitUntil = now + 1.4;
    analytics.track('arena_won', { seed: r.arena.seed, loops, par, stars, deaths: r.deaths });
  }

  async function extraLoopsWithAd(): Promise<void> {
    const r = run;
    if (!r || phase !== 'lost') return;
    if (!ads.isRewardedReady()) {
      ui.toast('No ad available right now');
      return;
    }
    setPhase('ad', 'ad');
    watchedRewarded = true;
    const rewarded = await ads.showRewarded(); // never rejects
    void ads.preloadRewarded();
    analytics.track('extra_loops', { rewarded });
    if (rewarded && extendLoops(r, CONFIG.extraLoops)) {
      scene.rewind(clock());
      phase = 'rewind';
      waitUntil = clock() + 0.3;
      ui.show('hud');
      resetClock();
    } else {
      setPhase('lost', 'lost');
      ui.toast('The ad was not finished');
    }
  }

  function pause(): void {
    if (phase !== 'playing') return;
    sfx.click();
    setPhase('paused', 'paused');
  }

  function resume(): void {
    if (phase !== 'paused') return;
    sfx.click();
    setPhase('playing', 'hud');
    resetClock();
  }

  // Backgrounded: pause. Only while playing, so an ad that covers the app doesn't trip it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'playing') setPhase('paused', 'paused');
  });

  async function share(): Promise<void> {
    if (!lastReplay) return;
    const url = `${window.location.origin}${window.location.pathname}?replay=${encodeReplay(lastReplay)}`;
    sfx.click();
    try {
      await navigator.clipboard.writeText(url);
      ui.toast('Link copied: send it to a friend');
    } catch {
      window.prompt('Copy this link', url);
    }
    analytics.track('share', { seed: lastReplay.seed, loops: lastReplay.loops.length });
  }

  // ---- the bot, and recorded runs --------------------------------------------------------
  function openArena(pb: Playback): void {
    run = createRun(pb.arena);
    scene.reset();
    drainEvents(run);
  }

  function startDemo(): void {
    const seed = pickSeed();
    const g = generateArena(seed);
    playback = { kind: 'demo', arena: g.arena, loops: g.solution.loops, speed: DEMO_SPEEDS[1], wait: 0, next: null, seed, cleared: 0, totalLoops: 0, done: false, label: '' };
    generated = g;
    openArena(playback);
    setPhase('demo', 'demo');
    analytics.track('demo_start', { seed });
  }

  function startViewer(arena: Arena, replay: Replay, label: string, shared: boolean): void {
    playback = { kind: 'viewer', arena, loops: replay.loops, speed: VIEWER_SPEEDS[1], wait: 0, next: null, seed: arena.seed, cleared: 0, totalLoops: replay.loops.length, done: false, label };
    generated = null;
    openArena(playback);
    setPhase('viewer', 'viewer');
    analytics.track('viewer_start', { seed: arena.seed, shared });
  }

  function openShared(text: string): void {
    const replay = decodeReplay(text);
    if (replay === null) {
      ui.toast('That link is not a valid run');
      return;
    }
    const g = generateArena(replay.seed);
    const verdict = playReplay(g.arena, replay);
    if (!verdict.won) {
      ui.toast('That run does not check out');
      return;
    }
    startViewer(g.arena, replay, `A friend cleared arena ${replay.seed} in ${verdict.loops} ${verdict.loops === 1 ? 'loop' : 'loops'}`, true);
  }

  function stepPlayback(now: number): void {
    const pb = playback;
    const r = run;
    if (!pb || !r) return;
    if (pb.next !== null) {
      if (now < pb.wait) return;
      const next = pb.next;
      pb.next = null;
      if (next === 'loop') {
        beginNextLoop(r);
        drainEvents(r);
        scene.reset();
      } else {
        const seed = pb.seed + 1;
        const g = generateArena(seed);
        pb.seed = seed;
        pb.arena = g.arena;
        pb.loops = g.solution.loops;
        generated = g;
        openArena(pb);
      }
      return;
    }
    if (pb.done) return;
    const audible = pb.speed < 8;
    for (let i = 0; i < pb.speed && r.phase === 'playing'; i++) {
      stepReplay(r, pb.loops);
      for (const event of drainEvents(r)) handleEvent(event, audible, now);
    }
    if (r.phase === 'loopEnd') {
      scene.rewind(now);
      if (audible) sfx.rewind();
      pb.next = 'loop';
      pb.wait = now + (pb.speed >= 8 ? 0.05 : 0.7);
    } else if (r.phase === 'won') {
      scene.won(now);
      if (audible) sfx.win();
      if (pb.kind === 'demo') {
        pb.cleared += 1;
        pb.totalLoops += r.loop + 1;
        pb.next = 'arena';
        pb.wait = now + (pb.speed >= 8 ? 0.45 : 1.2);
      } else {
        pb.done = true;
      }
    } else if (r.phase === 'dead' || r.phase === 'lost') {
      // A recording that no longer plays out (it should never happen): stop quietly.
      pb.done = true;
    }
  }

  function playbackUi(): void {
    const pb = playback;
    const r = run;
    if (!pb || !r) return;
    if (pb.kind === 'demo') {
      const progress = (r.loop + r.tick / CONFIG.loopTicks) / Math.max(1, r.arena.par);
      ui.setDemo({
        title: 'The bot is playing',
        line: `Arena ${pb.seed} · loop ${r.loop + 1} of ${r.arena.par} · ${r.ghosts.length} ${r.ghosts.length === 1 ? 'ghost' : 'ghosts'} · cleared ${pb.cleared} (${pb.totalLoops} loops)`,
        speed: pb.speed,
        cleared: Math.min(1, progress),
      });
    } else {
      ui.setViewer({
        title: pb.done ? 'Can you beat it?' : 'Watch the run',
        line: pb.done ? `${pb.label}. Par is ${r.arena.par}.` : `${pb.label} · loop ${r.loop + 1} of ${pb.loops.length}`,
        speed: pb.speed,
        done: pb.done,
      });
    }
  }

  // ---- startup --------------------------------------------------------------------------
  applyProfile();
  refreshMenu();
  ui.show('menu');
  const shared = params.get('replay');
  if (shared !== null && shared !== '') openShared(shared);

  if (import.meta.env.DEV) {
    // Read-only snapshot for tests. Not present in production builds.
    Object.defineProperty(window, '__game', {
      get: () => ({
        phase,
        score: totalStars(profile),
        alive: run?.phase === 'playing',
        debug: {
          run: run ? debugRun(run) : null,
          arena: run
            ? {
                seed: run.arena.seed,
                start: run.arena.start,
                orbs: run.arena.orbs,
                gates: run.arena.gates,
                drifters: run.arena.drifters,
                pulsars: run.arena.pulsars,
                par: run.arena.par,
              }
            : null,
          solution: generated?.solution.loops ?? null,
          playback: playback ? { kind: playback.kind, speed: playback.speed, seed: playback.seed, cleared: playback.cleared, totalLoops: playback.totalLoops, done: playback.done } : null,
          profile,
          lastReplay,
          result: resultInfo,
          id: GAME_ID,
        },
      }),
    });
  }

  return {
    step: CONFIG.dt,

    update() {
      const now = clock();
      switch (phase) {
        case 'playing':
          stepLive(now);
          break;
        case 'dead':
          if (now >= waitUntil && run) {
            retryLoop(run);
            drainEvents(run);
            scene.reset();
            setPhase('playing', 'hud');
            loopBanner(run);
          }
          break;
        case 'rewind':
          if (now >= waitUntil && run) {
            beginNextLoop(run);
            drainEvents(run);
            scene.reset();
            setPhase('playing', 'hud');
            sfx.loopStart();
            loopBanner(run);
          }
          break;
        case 'winning':
          if (now >= waitUntil) setPhase('result', 'result');
          break;
        case 'demo':
        case 'viewer':
          stepPlayback(now);
          break;
        default:
          break;
      }
    },

    render(alpha) {
      const now = clock();
      const r = phase === 'menu' || phase === 'settings' ? null : run;
      const smooth = phase === 'playing' ? devSpeed === 1 : (phase === 'demo' || phase === 'viewer') && playback !== null && playback.speed === 1;
      scene.update({ run: r, alpha: smooth ? alpha : 1, now });
      if (r && phase !== 'demo' && phase !== 'viewer') {
        ui.setHud({
          loop: r.loop,
          maxLoops: r.maxLoops,
          orbs: r.collectedCount,
          orbsTotal: r.arena.orbs.length,
          ghosts: r.ghosts.length,
          progress: r.tick / CONFIG.loopTicks,
          secondsLeft: (CONFIG.loopTicks - r.tick) / CONFIG.ticksPerSecond,
          hint: profile.cleared < 2 && r.loop < 2 && r.collectedCount === 0 && phase === 'playing',
          canEnd: phase === 'playing' && r.tick >= END_LOOP_AFTER,
        });
      }
      if (phase === 'demo' || phase === 'viewer') playbackUi();
    },
  };
};
