/**
 * Fruit Slice: the game's flow. The engine gives us its tools (pointer gestures, the Pixi view,
 * ads, haptics, audio, the #ui overlay); this file runs the phase machine and connects the pure
 * simulation (sim/) to what is drawn (view/) and shown (ui/).
 *
 *   menu -> playing -> failing -> tryAgain -> playing ...      a mistake
 *                   \-> result -> menu / playing again         the run ends
 *   menu <-> shop, settings          playing <-> paused
 */
import type { GameFactory } from '../engine';
import { safeGetItem, safeSetItem } from '../engine/core/storage';
import { loadCatalog, offlineCatalog } from './catalog';
import { CATALOG_KEY, PROFILE_KEY } from './info';
import { createSfx } from './sfx';
import {
  BUNDLED_SKINS,
  CONFIG,
  FRUIT_KINDS,
  adRetriesLeft,
  bladeOutline,
  buySkin,
  comboMultiplier,
  createRun,
  debugRun,
  drainEvents,
  earn,
  endRun,
  equipSkin,
  parseProfile,
  recordBest,
  restartCost,
  restartRun,
  runCoins,
  runStats,
  serializeProfile,
  setSetting,
  shouldShowInterstitial,
  lossMultiplierFor,
  spend,
  stepRun,
  type Mode,
  type Profile,
  type Run,
  type RunEvent,
  type Skin,
  type Vec,
} from './sim';
import { createUi, type HudInfo, type ResultInfo, type SkinCard, type Tone, type TryAgainInfo } from './ui';
import { createScene } from './view';
import { COLORS } from './view/palette';

type Phase = 'menu' | 'playing' | 'paused' | 'failing' | 'tryAgain' | 'result' | 'shop' | 'settings' | 'ad';
/** What the purse is refilled to in dev builds. */
const DEV_COINS = 999_999;

type CutEventData = Extract<RunEvent, { type: 'cut' }>;

const RARITY_RANK: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

function parseSeed(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) >>> 0 : null;
}

const pct = (value: number): string => (Math.round(value * 1000) / 10).toFixed(1);

export const createGame: GameFactory = ({ ads, analytics, audio, haptics, input, view, params, uiRoot, resetClock }) => {
  // ?seed=N makes every run deal the same fruit. In dev builds ?time=N sets the Arcade clock and
  // ?catalog=URL points at a skin catalog, for tests.
  const fixedSeed = parseSeed(params.get('seed'));
  const pickSeed = (): number => fixedSeed ?? (Math.random() * 0x100000000) >>> 0;
  const devStartTime = import.meta.env.DEV ? Number(params.get('time')) || undefined : undefined;
  const catalogUrl = import.meta.env.DEV ? (params.get('catalog') ?? import.meta.env.VITE_SKINS_CATALOG_URL) : import.meta.env.VITE_SKINS_CATALOG_URL;

  view.setBackground(COLORS.letterbox);
  const scene = createScene(view.field);
  const sfx = createSfx(audio, haptics);

  // ---- state ----------------------------------------------------------------------------
  let phase: Phase = 'menu';
  let run: Run | null = null;
  let profile: Profile = parseProfile(safeGetItem(PROFILE_KEY));
  let catalog: Skin[] = offlineCatalog(() => safeGetItem(CATALOG_KEY));
  let visualTime = 0;
  let failingUntil = 0;
  let drag: { a: Vec; b: Vec } | null = null;
  let pendingCut: { a: Vec; b: Vec } | null = null;
  let lastFail: { reason: string; deviation: number; tolerance: number } = { reason: 'tolerance', deviation: 0, tolerance: 0 };
  let watchedRewardedThisRun = false;
  let lastInterstitialAt: number | null = null;
  let result: ResultInfo | null = null;
  let pendingFlash: { x: number; y: number; text: string; sub?: string; tone: Tone } | null = null;

  const skinById = (id: string): Skin => catalog.find((s) => s.id === id) ?? catalog.find((s) => s.id === CONFIG.defaultSkin) ?? BUNDLED_SKINS[0]!;
  // Dev builds (npm run dev) keep the purse full so the shop and retries can be tried freely. Production builds
  // never do (import.meta.env.DEV is false there); the e2e server turns it off with VITE_INFINITE_COINS=false.
  const infiniteCoins = import.meta.env.DEV && import.meta.env.VITE_INFINITE_COINS !== 'false';
  const topUp = (): void => {
    if (infiniteCoins && profile.coins < DEV_COINS) profile = { ...profile, coins: DEV_COINS };
  };
  topUp();
  const save = (): void => {
    topUp();
    safeSetItem(PROFILE_KEY, serializeProfile(profile));
  };

  function applyProfile(): void {
    audio.setEnabled(profile.settings.sound);
    haptics.setEnabled(profile.settings.haptics);
    scene.setSkin(skinById(profile.equipped));
  }

  // ---- screens --------------------------------------------------------------------------
  const ui = createUi(uiRoot, {
    onPlay: (mode) => {
      sfx.click();
      startRun(mode);
    },
    onOpenShop: () => {
      sfx.click();
      refreshShop();
      setPhase('shop', 'shop');
    },
    onOpenSettings: () => {
      sfx.click();
      ui.setSettings(profile.settings);
      setPhase('settings', 'settings');
    },
    onBack: () => {
      sfx.click();
      toMenu();
    },
    onBuy: buy,
    onEquip: (id) => {
      const next = equipSkin(profile, id);
      if (next === null) return;
      sfx.click();
      profile = next;
      save();
      applyProfile();
      refreshShop();
    },
    onToggle: (key) => {
      profile = setSetting(profile, key, !profile.settings[key]);
      save();
      applyProfile();
      ui.setSettings(profile.settings);
      sfx.click();
    },
    onPause: pause,
    onResume: resume,
    onQuit: () => void finishRun(),
    onRetryCoins: retryWithCoins,
    onRetryAd: () => void retryWithAd(),
    onGiveUp: () => void finishRun(),
    onDouble: () => void doubleCoins(),
    onPlayAgain: () => {
      sfx.click();
      startRun(result?.mode ?? 'classic');
    },
    onMenu: () => void backToMenuAfterRun(),
  });

  function setPhase(next: Phase, screen: Parameters<typeof ui.show>[0]): void {
    phase = next;
    ui.show(screen);
  }

  function refreshMenu(): void {
    ui.setMenu({
      coins: profile.coins,
      bestClassic: profile.best.classic,
      bestArcade: profile.best.arcade,
      bestSurvival: profile.best.survival,
    });
  }

  function refreshShop(): void {
    const cards: SkinCard[] = [...catalog]
      .sort((a, b) => (RARITY_RANK[a.rarity] ?? 0) - (RARITY_RANK[b.rarity] ?? 0) || a.price - b.price)
      .map((s) => ({
        id: s.id,
        name: s.name,
        rarity: s.rarity,
        price: s.price,
        owned: profile.owned.includes(s.id),
        equipped: profile.equipped === s.id,
        preview: {
          bladeColor: s.blade.color,
          edgeColor: s.blade.edge,
          handleColor: s.handle.color,
          accentColor: s.handle.accent,
          trailColor: s.trail.color,
          glowColor: s.trail.glow,
          trailWidth: s.trail.width,
          outline: bladeOutline(s.blade.shape),
        },
      }));
    ui.setShop({ coins: profile.coins, skins: cards });
  }

  function toMenu(): void {
    run = null;
    drag = null;
    pendingCut = null;
    scene.clearEffects();
    scene.setDrag(null);
    refreshMenu();
    setPhase('menu', 'menu');
  }

  // ---- shop -----------------------------------------------------------------------------
  function buy(id: string): void {
    const skin = catalog.find((s) => s.id === id);
    if (!skin) return;
    const bought = buySkin(profile, skin);
    if (!bought.ok) {
      ui.toast(bought.reason === 'poor' ? 'Not enough coins' : 'You already own it');
      return;
    }
    profile = equipSkin(bought.profile, id) ?? bought.profile; // wear what you just bought
    save();
    applyProfile();
    sfx.coins();
    analytics.track('buy_skin', { id, price: skin.price });
    refreshShop();
    ui.toast(`${skin.name} equipped`);
  }

  // ---- a run ----------------------------------------------------------------------------
  function startRun(mode: Mode): void {
    run = createRun(mode, pickSeed(), devStartTime === undefined ? {} : { startTime: devStartTime });
    watchedRewardedThisRun = false;
    result = null;
    drag = null;
    pendingCut = null;
    scene.clearEffects();
    ui.setMarker(null);
    resetClock();
    setPhase('playing', 'hud');
    analytics.track('run_start', { mode, seed: run.seed });
    void ads.preloadRewarded();
    void ads.preloadInterstitial();
  }

  function pause(): void {
    if (phase !== 'playing') return;
    drag = null;
    setPhase('paused', 'paused');
  }

  function resume(): void {
    if (phase !== 'paused') return;
    sfx.click();
    setPhase('playing', 'hud');
    resetClock();
  }

  // The app was backgrounded: pause, but only while playing so an ad covering the app is left alone.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  function showTryAgain(): void {
    if (!run) return;
    const stats = runStats(run);
    const info: TryAgainInfo = {
      mode: run.mode,
      reason: lastFail.reason,
      deviation: lastFail.deviation,
      tolerance: lastFail.tolerance,
      score: stats.score,
      fruits: stats.fruits,
      cost: restartCost(run.restarts),
      coins: profile.coins,
      adReady: ads.isRewardedReady(),
      adTriesLeft: adRetriesLeft(run.adRestarts),
      adTriesMax: CONFIG.economy.maxAdRetries,
    };
    ui.setTryAgain(info);
    setPhase('tryAgain', 'tryAgain');
  }

  function continueRun(viaAd = false): void {
    if (!run || !restartRun(run, viaAd)) return;
    drain(run);
    scene.clearEffects();
    ui.setMarker(null);
    resetClock();
    sfx.restart();
    setPhase('playing', 'hud');
  }

  function retryWithCoins(): void {
    if (!run) return;
    const paid = spend(profile, restartCost(run.restarts));
    if (paid === null) {
      ui.toast('Not enough coins');
      return;
    }
    profile = paid;
    save();
    analytics.track('retry', { method: 'coins', n: run.restarts + 1 });
    continueRun();
  }

  async function retryWithAd(): Promise<void> {
    if (run && adRetriesLeft(run.adRestarts) === 0) {
      ui.toast('No ad tries left this run');
      return;
    }
    if (!run || !ads.isRewardedReady()) {
      ui.toast('No ad available right now');
      return;
    }
    setPhase('ad', 'ad');
    watchedRewardedThisRun = true;
    const rewarded = await ads.showRewarded(); // never rejects
    void ads.preloadRewarded();
    analytics.track('retry', { method: 'ad', rewarded, n: (run?.restarts ?? 0) + 1 });
    if (rewarded) continueRun(true);
    else {
      showTryAgain();
      ui.toast('The ad was not finished');
    }
  }

  async function finishRun(): Promise<void> {
    if (!run) return;
    if (run.phase !== 'over') endRun(run);
    drain(run);
    const stats = runStats(run);
    const coinsEarned = runCoins(stats);
    const best = recordBest(profile, run.mode, stats.score);
    profile = earn(best.profile, coinsEarned);
    save();
    result = {
      mode: run.mode,
      score: stats.score,
      fruits: stats.fruits,
      accuracy: stats.accuracy,
      best: profile.best[run.mode],
      newBest: best.isNewBest && stats.score > 0,
      coinsEarned,
      canDouble: coinsEarned > 0 && ads.isRewardedReady(),
      doubled: false,
    };
    drag = null;
    analytics.track('run_end', { mode: run.mode, score: stats.score, fruits: stats.fruits, coins: coinsEarned, restarts: run.restarts });
    run = null;
    scene.clearEffects();
    ui.setResult(result);
    setPhase('result', 'result');
    if (coinsEarned > 0) sfx.coins();
    void ads.preloadRewarded();
  }

  async function doubleCoins(): Promise<void> {
    if (!result || result.doubled || phase !== 'result') return;
    if (!ads.isRewardedReady()) {
      ui.toast('No ad available right now');
      return;
    }
    const shown = result;
    setPhase('ad', 'ad');
    watchedRewardedThisRun = true;
    const rewarded = await ads.showRewarded();
    void ads.preloadRewarded();
    analytics.track('double_coins', { rewarded, coins: shown.coinsEarned });
    if (rewarded) {
      profile = earn(profile, shown.coinsEarned);
      save();
      result = { ...shown, doubled: true, canDouble: false };
      sfx.coins();
    } else {
      ui.toast('The ad was not finished');
    }
    if (result) ui.setResult(result);
    setPhase('result', 'result');
  }

  /** Back to the main menu from a result, with a short ad if one is due. */
  async function backToMenuAfterRun(): Promise<void> {
    if (phase !== 'result') return;
    sfx.click();
    const due = shouldShowInterstitial({
      nowMs: Date.now(),
      lastShownAtMs: lastInterstitialAt,
      watchedRewardedThisRun,
      ready: ads.isInterstitialReady(),
    });
    if (due) {
      setPhase('ad', 'ad');
      const shown = await ads.showInterstitial(); // never rejects
      if (shown) lastInterstitialAt = Date.now();
      analytics.track('interstitial', { shown });
      void ads.preloadInterstitial();
    }
    toMenu();
  }

  // ---- input: a drag becomes a cut when the finger lifts ---------------------------------
  input.onGesture((g) => {
    if (phase !== 'playing') {
      drag = null;
      return;
    }
    const p = view.clientToWorld(g.clientX, g.clientY);
    if (g.phase === 'start') drag = { a: p, b: p };
    else if (drag && g.phase === 'move') drag = { a: drag.a, b: p };
    else if (drag && g.phase === 'end') {
      pendingCut = { a: drag.a, b: p };
      drag = null;
    } else if (g.phase === 'cancel') drag = null;
  });

  // ---- events from the simulation --------------------------------------------------------
  function toneFor(event: CutEventData): Tone {
    return event.ok ? (event.rating === 'miss' ? 'miss' : event.rating) : 'miss';
  }

  function handleEvent(event: RunEvent): void {
    switch (event.type) {
      case 'spawn':
        ui.setMarker(null);
        break;
      case 'cancel': {
        if (event.reason === 'short') break; // just a tap
        scene.showCancel(event.a, event.b, visualTime);
        ui.flash({ x: (event.a.x + event.b.x) / 2, y: (event.a.y + event.b.y) / 2, text: 'Cut all the way across', tone: 'cancel' });
        sfx.cancel();
        break;
      }
      case 'cut': {
        scene.showCut(event.a, event.b, event.pieces, event.ok, visualTime);
        const worst = event.pieces.reduce((w, p) => (Math.abs(p.fraction - 0.5) > Math.abs(w.fraction - 0.5) ? p : w), event.pieces[0]!);
        ui.setMarker(worst.fraction * 100);
        const first = event.pieces[0]!;
        const split = `${pct(worst.fraction)} | ${pct(1 - worst.fraction)}`;
        const labels = { perfect: 'Perfect!', great: 'Great!', good: 'Nice', miss: 'Uneven' } as const;
        // Above the fruit, so the two halves stay in view.
        const flash = { x: first.x, y: Math.min(560, Math.max(180, first.y - first.radius - 34)), text: labels[event.rating], sub: split, tone: toneFor(event) };
        if (run?.mode === 'survival') pendingFlash = flash; // the margin event that follows adds what it cost
        else ui.flash(flash);
        for (const bubble of event.bubbles) scene.showBubble(bubble.x, bubble.y, visualTime);
        if (event.ok && event.rating !== 'miss') sfx.slice(event.rating);
        else sfx.uneven();
        if (!event.ok) lastFail = { reason: 'tolerance', deviation: event.deviation, tolerance: event.tolerance };
        break;
      }
      case 'margin': {
        // Survival: what the cut cost, and what the bubbles gave back.
        const base = pendingFlash ?? { x: 180, y: 250, text: '', tone: 'miss' as Tone };
        pendingFlash = null;
        // Just the change in margin: "−1.9", or "+4 −1.9" when a bubble gave some back.
        const gained = event.gained > 0 ? `+${event.gained} ` : '';
        ui.flash({ ...base, sub: `${gained}−${event.lost.toFixed(1)}` });
        break;
      }
      case 'bomb':
        scene.showBomb(event.x, event.y, visualTime);
        ui.flash({ x: event.x, y: event.y, text: 'Bomb!', tone: 'bomb' });
        sfx.bomb();
        break;
      case 'failed':
        if (event.reason !== 'tolerance') lastFail = { reason: event.reason, deviation: lastFail.deviation, tolerance: lastFail.tolerance };
        failingUntil = visualTime + (event.reason === 'tolerance' ? 1.0 : 0.6);
        phase = 'failing';
        drag = null;
        analytics.track('failed', { reason: event.reason });
        break;
      default:
        break;
    }
  }

  function drain(r: Run): void {
    for (const event of drainEvents(r)) handleEvent(event);
  }

  // ---- hud ------------------------------------------------------------------------------
  function hudInfo(r: Run): HudInfo {
    return {
      mode: r.mode,
      score: r.score,
      fruits: r.fruitsCut,
      tolerance: r.tolerance,
      combo: r.combo,
      multiplier: comboMultiplier(r.combo),
      timeLeft: r.timeLeft,
      strikes: r.strikes,
      maxStrikes: CONFIG.arcade.maxStrikes,
      margin: Math.max(0, r.margin),
      lossMultiplier: lossMultiplierFor(r.round),
    };
  }

  // ---- startup --------------------------------------------------------------------------
  applyProfile();
  refreshMenu();
  ui.show('menu');

  // Dev tool (?gallery): every fruit laid out, to review the art.
  const gallery = import.meta.env.DEV ? params.get('gallery') : null;
  if (gallery !== null) {
    void scene.ready.then(() => scene.showGallery(FRUIT_KINDS));
    ui.show('none');
  }

  // Online skins load in the background; the bundled ones are already usable.
  void loadCatalog({
    url: catalogUrl,
    readCache: () => safeGetItem(CATALOG_KEY),
    writeCache: (json) => void safeSetItem(CATALOG_KEY, json),
  }).then((skins) => {
    catalog = skins;
    applyProfile();
    if (phase === 'shop') refreshShop();
  });

  if (import.meta.env.DEV) {
    // Read-only snapshot for e2e tests. Not present in production builds.
    Object.defineProperty(window, '__game', {
      get: () => ({
        phase,
        score: run?.score ?? result?.score ?? 0,
        alive: run?.phase === 'playing',
        debug: {
          run: run ? debugRun(run) : null,
          profile,
          result,
          catalog: catalog.map((s) => s.id),
          fruitHidden: scene.fruitHidden,
          lastInterstitialAt,
        },
      }),
    });
  }

  return {
    step: CONFIG.dt,

    update() {
      visualTime += CONFIG.dt;
      if (phase === 'failing' && visualTime >= failingUntil) showTryAgain();
      if (phase !== 'playing' || !run) return;
      const cut = pendingCut;
      pendingCut = null;
      stepRun(run, { cut });
      drain(run);
      const hint = run.mode === 'survival' ? 'Drag across · slice bubbles for margin' : 'Drag across the whole fruit';
      ui.setHint(run.round < 2 && run.phase === 'playing' ? hint : null);
    },

    render(alpha) {
      const showRun = run !== null && (phase === 'playing' || phase === 'paused' || phase === 'failing' || phase === 'tryAgain');
      scene.setDrag(phase === 'playing' ? drag : null);
      scene.update({ run: showRun ? run : null, alpha, now: visualTime });
      if (showRun && run) ui.setHud(hudInfo(run));
    },
  };
};
