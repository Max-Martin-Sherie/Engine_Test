/**
 * Nova Frontier: the game's flow. The engine gives us its tools (the 2D layer, ads, analytics, haptics, audio, the #ui
 * overlay); this file runs the phases (menu with a battle playing behind it, playing, paused, result) and connects the
 * pure simulation (sim/) to what is drawn (view/), what is shown (ui/) and what the player does (controls, session).
 */
import type { GameFactory } from '../engine';
import { safeGetItem, safeSetItem } from '../engine/core/storage';
import { createControls } from './controls';
import { GAME_ID, PROFILE_KEY } from './info';
import { parseProfile, serializeProfile, type Profile } from './profile';
import {
  armyOf,
  attackMoveAt,
  buttonForKey,
  cancelQueued,
  cardFor,
  centreOf,
  clockText,
  createSession,
  idleWorkers,
  nearestMinerals,
  placeAt,
  placementAt,
  pressCard,
  recallGroup,
  select,
  selectionInfo,
  setGroup,
  selection,
  type Outcome,
  type Session,
} from './session';
import { createSfx } from './sfx';
import { cmdRally, createMatch, drainEvents, fogAt, isBuilding, isUnit, stepMatch, typeName, type BuildingType, type Match, type MatchEvent } from './sim';
import { createUi, type Level, type SettingKey, type Ui } from './ui';
import { COLORS, createMinimap, createOverlay, createWorld3d, type Alert, type Ghost, type Minimap, type World3d } from './view';

type Phase = 'menu' | 'playing' | 'paused' | 'result';

const EMPTY: ReadonlySet<number> = new Set();
/** After the last building falls, the fight is shown for this many ticks before the result appears. */
const ENDING_TICKS = 40;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function parseSeed(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(99999, Math.trunc(n)) : null;
}

export const createGame: GameFactory = ({ ads, analytics, audio, haptics, view, params, uiRoot, resetClock, world }) => {
  const dev = import.meta.env.DEV;
  const fixedSeed = parseSeed(params.get('seed'));
  const devSpeed = dev ? clamp(Math.trunc(Number(params.get('speed')) || 1), 1, 16) : 1;
  const showDemo = !(dev && params.get('demo') === '0');
  const autostart = dev && params.get('autostart') === '1';
  const fogOn = !(dev && params.get('fog') === '0');
  const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  view.setBackground(COLORS.letterbox);
  const sfx = createSfx(audio, haptics);

  const profile: Profile = parseProfile(safeGetItem(PROFILE_KEY));
  const levelParam = params.get('level');
  if (levelParam === 'easy' || levelParam === 'normal' || levelParam === 'hard') profile.level = levelParam;
  if (fixedSeed !== null) profile.seed = fixedSeed;
  const save = (): void => void safeSetItem(PROFILE_KEY, serializeProfile(profile));
  const randomSeed = (): number => 1 + Math.floor(Math.random() * 9999);

  // ---- the 3D world, or a message if this device cannot make one ----------------------------------
  let world3d: World3d;
  try {
    world3d = createWorld3d(view.host, world);
  } catch (error) {
    analytics.track('webgl_failed', { message: String(error) });
    const note = document.createElement('div');
    note.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:#e8f0ff;font:600 16px system-ui,sans-serif;pointer-events:auto';
    note.textContent = 'Nova Frontier needs WebGL, and this device could not start it.';
    uiRoot.append(note);
    return { step: 1 / 20, update() {}, render() {} };
  }
  const overlay = createOverlay(view.field);

  // ---- state --------------------------------------------------------------------------------
  let phase: Phase = 'menu';
  let match: Match | null = null;
  let session: Session | null = null;
  let demo: Match | null = null;
  let minimap: Minimap | null = null;
  let speed = devSpeed;
  let clockTime = 0;
  let lastNow = performance.now();
  let hudTimer = 0;
  let hudDirty = true;
  let endTicks = -1;
  let dropUsed = false;
  let busy = false;
  let returnTo: 'menu' | 'pause' = 'menu';
  let matchStartedAt = 0;
  let lastToast = { text: '', at: 0 };
  let lastGroupKey = { key: '', at: 0 };
  let hintUntil = 0;
  let onMenuScreen = true;
  let idleCursor = 0;
  const alerts: Alert[] = [];
  /** Average milliseconds of CPU work per frame (drawing) and per update (the sim): for the dev snapshot. */
  const cost = { draw: 0, sim: 0, hud: 0 };
  const smooth = (old: number, sample: number): number => old + (sample - old) * 0.05;

  const matchOf = (): Match | null => match ?? demo;

  // ---- screens ------------------------------------------------------------------------------
  const ui: Ui = createUi(
    uiRoot,
    {
      onPlay: () => startMatch(profile.seed),
      onLevel: (level: Level) => {
        profile.level = level;
        save();
        sfx.click();
        refreshMenu();
      },
      onNewMap: () => {
        profile.seed = randomSeed();
        save();
        sfx.click();
        startDemo(profile.seed);
        refreshMenu();
      },
      onHelp: () => openOverlay('help'),
      onSettings: () => openOverlay('settings'),
      onBack: () => {
        sfx.click();
        ui.show(returnTo === 'pause' ? 'pause' : 'menu');
      },
      onToggle: (key: SettingKey) => {
        profile.settings[key] = !profile.settings[key];
        applySettings();
        save();
        sfx.click();
      },
      onPause: () => pause(),
      onResume: () => resume(),
      onRestart: () => {
        analytics.track('match_restart', { seed: profile.seed });
        startMatch(profile.seed);
      },
      onQuit: () => {
        analytics.track('match_quit', { tick: match?.tick ?? 0 });
        toMenu();
      },
      onSupplyDrop: () => supplyDrop(),
      onSpeed: () => {
        speed = speed >= 3 ? 1 : speed + 1;
        hudDirty = true;
        sfx.click();
      },
      onAgain: () => afterResult(() => startMatch(fixedSeed ?? randomSeed())),
      onMenu: () => afterResult(() => toMenu()),
      onCard: (id: string) => press(id),
      onPick: (id: number) => {
        if (session === null) return;
        select(session, [id]);
        sfx.select();
        hudDirty = true;
      },
      onCancelQueue: (index: number) => {
        if (session === null) return;
        act(cancelQueued(session, index));
        hudDirty = true;
      },
      onIdleWorker: () => jumpToIdleWorker(),
      onArmy: () => selectArmy(),
    },
    world,
  );

  function applySettings(): void {
    audio.setEnabled(profile.settings.sound);
    haptics.setEnabled(profile.settings.haptics);
    ui.setSettings(profile.settings);
  }

  function refreshMenu(): void {
    ui.setMenu({ level: profile.level, seed: profile.seed, wins: profile.wins, played: profile.played });
  }

  function openOverlay(screen: 'settings' | 'help'): void {
    returnTo = phase === 'paused' ? 'pause' : 'menu';
    sfx.click();
    ui.show(screen);
  }

  // ---- controls -----------------------------------------------------------------------------
  const controls = createControls({
    target: view.host,
    world: world3d,
    toWorld: (x, y) => view.clientToWorld(x, y),
    size: world,
    minimap: ui.minimap,
    minimapToMap: (x, y) => {
      const rect = ui.minimap.getBoundingClientRect();
      const size = matchOf()?.map.size ?? 96;
      return { x: clamp(((x - rect.left) / Math.max(1, rect.width)) * size, 0, size), y: clamp(((y - rect.top) / Math.max(1, rect.height)) * size, 0, size) };
    },
    session: () => (phase === 'playing' ? session : null),
    fog: () => fogOn,
    edgeScroll: () => profile.settings.edgeScroll,
    act: (outcome) => act(outcome),
    changed: () => {
      hudDirty = true;
    },
    key: (event) => onKey(event),
    buzz: () => haptics.impact('medium'),
  });

  /** The marker, sound and message for something the player just did. */
  function act(outcome: Outcome): void {
    hintUntil = 0;
    if (!outcome.ok) {
      if (outcome.reason !== '') toast(outcome.reason, 'warn');
      sfx.error();
      return;
    }
    if (outcome.ping !== null) world3d.effects.ping(outcome.ping.x, outcome.ping.y, outcome.ping.kind);
    switch (outcome.sound) {
      case 'order':
        sfx.order();
        break;
      case 'attack':
        sfx.attackOrder();
        break;
      case 'train':
        sfx.train();
        break;
      case 'build':
        sfx.placed();
        break;
      case 'select':
        sfx.select();
        break;
      default:
    }
    hudDirty = true;
  }

  function toast(text: string, tone: 'info' | 'warn' | 'danger' | 'good' = 'info'): void {
    const now = performance.now();
    if (text === lastToast.text && now - lastToast.at < 900) return;
    lastToast = { text, at: now };
    ui.toast(text, tone);
  }

  /** A command-card press (a button or its hotkey). */
  function press(id: string): void {
    const s = session;
    if (s === null || phase !== 'playing') return;
    if (id === 'confirm') {
      const at = controls.pointer();
      if (at === null) {
        toast('Tap the ground to choose where', 'info');
        return;
      }
      act(placeAt(s, at.x, at.y));
      return;
    }
    const button = cardFor(s).find((b) => b.id === id);
    if (button !== undefined && !button.enabled) {
      act({ ok: false, reason: button.hint, ping: null, sound: 'error' });
      return;
    }
    act(pressCard(s, id));
    hudDirty = true;
  }

  function selectArmy(): void {
    if (session === null || phase !== 'playing') return;
    const army = armyOf(session);
    if (army.length === 0) {
      toast('No army yet', 'info');
      return;
    }
    select(session, army.map((e) => e.id));
    const c = centreOf(army);
    if (c !== null) controls.glideTo(c.x, c.y);
    sfx.select();
    hudDirty = true;
  }

  function jumpToIdleWorker(): void {
    if (session === null || phase !== 'playing') return;
    const idle = idleWorkers(session);
    const w = idle[idleCursor % Math.max(1, idle.length)];
    idleCursor += 1;
    if (w === undefined) {
      toast('No idle workers', 'info');
      return;
    }
    select(session, [w.id]);
    controls.glideTo(w.x, w.y);
    sfx.select();
    hudDirty = true;
  }

  function focusBase(): void {
    const m = match;
    if (m === null) return;
    const hub = m.entities.find((e) => e.alive && e.owner === 0 && e.type === 'hub');
    if (hub !== undefined) controls.glideTo(hub.x, hub.y + 3);
  }

  /** Keys the controls pass on: the command card's hotkeys, groups, jumps, escape. */
  function onKey(event: KeyboardEvent): boolean {
    const key = event.key;
    if (phase === 'menu') {
      if (key === 'Enter' && onMenuScreen) {
        startMatch(profile.seed);
        return true;
      }
      if (key === 'Escape') {
        ui.show('menu');
        return true;
      }
      return false;
    }
    if (key === 'Escape' || key === 'F10' || key === 'p' || key === 'P') {
      if (phase === 'paused') {
        resume();
        return true;
      }
      if (phase === 'playing') {
        const s = session;
        if (key === 'Escape' && s !== null && (s.mode.kind !== 'none' || s.menu !== 'root')) {
          s.mode = { kind: 'none' };
          s.menu = 'root';
          hudDirty = true;
          return true;
        }
        pause();
        return true;
      }
      return false;
    }
    const s = session;
    if (s === null || phase !== 'playing') return false;
    if (key === ' ') {
      if (s.lastAlert !== null) controls.glideTo(s.lastAlert.x, s.lastAlert.y);
      return true;
    }
    if (key === 'Home' || key === 'Backspace') {
      focusBase();
      return true;
    }
    if (key === ',') {
      selectArmy();
      return true;
    }
    if (key === '.') {
      jumpToIdleWorker();
      return true;
    }
    if (/^[0-9]$/.test(key)) {
      const n = Number(key);
      if (event.ctrlKey || event.metaKey) {
        setGroup(s, n);
        toast(`Group ${n} set`, 'info');
      } else {
        const group = recallGroup(s, n);
        if (group.length > 0) {
          select(s, group.map((e) => e.id));
          const now = performance.now();
          if (lastGroupKey.key === key && now - lastGroupKey.at < 400) {
            const c = centreOf(group);
            if (c !== null) controls.glideTo(c.x, c.y);
          }
          lastGroupKey = { key, at: now };
          sfx.select();
        }
      }
      hudDirty = true;
      return true;
    }
    if (key === 'Enter' && s.mode.kind === 'place') {
      press('confirm');
      return true;
    }
    const button = buttonForKey(cardFor(s), key);
    if (button !== undefined) {
      press(button.id);
      return true;
    }
    return false;
  }

  // ---- starting, pausing, ending ----------------------------------------------------------------
  function startDemo(seed: number): void {
    demo = createMatch({ seed, ai: [true, true], difficulty: ['normal', 'normal'] });
    if (showDemo) {
      // Let it run a couple of minutes so the menu opens on a base that is already busy.
      for (let i = 0; i < 2400; i++) {
        stepMatch(demo);
        drainEvents(demo);
      }
    }
    world3d.load(demo.map);
    // The camera opens on the first base.
    const first = demo.entities.find((e) => e.alive && e.type === 'hub' && e.owner === 0);
    if (first !== undefined) {
      world3d.cam.x = first.x;
      world3d.cam.y = first.y;
      world3d.cam.zoom = 26;
      world3d.clampCamera();
      actionX = first.x;
      actionY = first.y;
      actionAt = clockTime;
    }
  }

  /** New workers from a hub go straight to its minerals unless the player says otherwise. */
  function rallyToMinerals(s: Session, hub: { x: number; y: number; id: number }): void {
    const patch = nearestMinerals(s, hub.x, hub.y);
    if (patch !== undefined) cmdRally(s.match, s.player, hub.id, patch.x, patch.y);
  }

  function startMatch(seed: number): void {
    profile.seed = seed;
    save();
    analytics.track('match_start', { seed, level: profile.level });
    match = createMatch({ seed, ai: [false, true], difficulty: [profile.level, profile.level] });
    session = createSession(match, 0);
    world3d.load(match.map);
    minimap = createMinimap(ui.minimap, match.map);
    alerts.length = 0;
    endTicks = -1;
    dropUsed = false;
    speed = devSpeed;
    matchStartedAt = performance.now();
    const hub = match.entities.find((e) => e.owner === 0 && e.type === 'hub');
    if (hub !== undefined) {
      rallyToMinerals(session, hub);
      select(session, [hub.id]);
      world3d.cam.x = hub.x;
      world3d.cam.y = hub.y + 2;
      world3d.cam.zoom = touch ? 21 : 19;
      world3d.clampCamera();
    }
    phase = 'playing';
    onMenuScreen = false;
    ui.show('none');
    ui.showHud(true);
    hudDirty = true;
    if (!profile.helped) {
      ui.setHint(touch ? 'Tap a worker, then tap minerals to mine. Tap the Hub to train more workers.' : 'Right click minerals to mine · click the Hub, press Q to train workers · B builds with a worker · Esc for help');
      hintUntil = clockTime + 30;
      profile.helped = true;
      save();
    } else ui.setHint('');
    resetClock();
  }

  function toMenu(): void {
    phase = 'menu';
    match = null;
    session = null;
    minimap = null;
    onMenuScreen = true;
    ui.show('menu');
    ui.showHud(false);
    ui.setHint('');
    ui.setSelection(null);
    refreshMenu();
    startDemo(profile.seed);
    resetClock();
  }

  function pause(): void {
    if (phase !== 'playing') return;
    phase = 'paused';
    hudDirty = true;
    ui.show('pause');
    sfx.click();
  }

  function resume(): void {
    if (phase !== 'paused') return;
    phase = 'playing';
    ui.show('none');
    resetClock();
    sfx.click();
  }

  function supplyDrop(): void {
    if (busy || dropUsed || match === null) return;
    if (!ads.isRewardedReady()) {
      toast('No ad available right now', 'warn');
      void ads.preloadRewarded();
      return;
    }
    busy = true;
    analytics.track('supply_drop_offered', {});
    void ads.showRewarded().then((rewarded) => {
      busy = false;
      resetClock();
      const p = match?.players[0];
      if (rewarded && p !== undefined) {
        p.minerals += 400;
        p.gas += 200;
        dropUsed = true;
        sfx.drop();
        toast('Supply drop: +400 minerals, +200 gas', 'good');
        analytics.track('supply_drop_claimed', {});
      }
      void ads.preloadRewarded();
      hudDirty = true;
    });
  }

  /** Between matches: maybe an ad, then whatever was asked for. */
  function afterResult(next: () => void): void {
    if (busy) return;
    const lastedMs = performance.now() - matchStartedAt;
    if (profile.played >= 2 && lastedMs > 120_000 && ads.isInterstitialReady()) {
      busy = true;
      void ads.showInterstitial().then(() => {
        busy = false;
        void ads.preloadInterstitial();
        next();
      });
      return;
    }
    next();
  }

  function endMatch(m: Match): void {
    const won = m.winner === 0;
    phase = 'result';
    profile.played += 1;
    if (won) profile.wins += 1;
    save();
    const stats = m.players[0]?.stats;
    ui.setResult({
      won,
      time: clockText(m.tick),
      killed: stats?.unitsKilled ?? 0,
      lost: stats?.unitsLost ?? 0,
      built: stats?.built ?? 0,
      mined: stats?.mined ?? 0,
      level: profile.level,
    });
    ui.show('result');
    ui.showHud(false);
    ui.setHint('');
    if (won) sfx.win();
    else sfx.lose();
    analytics.track('match_end', { won, level: profile.level, seconds: Math.round(m.tick / 20) });
  }

  // ---- events from the sim --------------------------------------------------------------------------
  const sees = (m: Match, x: number, y: number): boolean => fogAt(m, 0, x, y) === 2 || !fogOn || phase !== 'playing';
  const loudness = (x: number, y: number): number => {
    const cam = world3d.cam;
    return clamp(1 - Math.hypot(x - cam.x, y - cam.y) / (cam.zoom * 1.4), 0, 1);
  };

  function handle(m: Match, ev: MatchEvent): void {
    const fx = world3d.effects;
    /** The demo behind the menu is silent: only a match the player is in makes noise. */
    const loud = m === match;
    switch (ev.type) {
      case 'shot': {
        if (!sees(m, ev.fx, ev.fy) && !sees(m, ev.tx, ev.ty)) return;
        fx.shot(ev.weapon, ev.fx, ev.fy, ev.weapon === 'skiff', ev.tx, ev.ty, ev.air);
        if (loud) sfx.shot(ev.weapon, loudness(ev.fx, ev.fy));
        return;
      }
      case 'death': {
        if (ev.entity === 'minerals' || ev.entity === 'geyser') return;
        if (!sees(m, ev.x, ev.y)) return;
        const building = ev.entity !== 'worker' && ev.entity !== 'trooper' && ev.entity !== 'tank' && ev.entity !== 'skiff';
        fx.death(ev.entity, ev.x, ev.y, ev.owner, building);
        if (loud) sfx.explosion(building, loudness(ev.x, ev.y));
        return;
      }
      case 'built':
        if (ev.owner !== 0 || match === null) return;
        fx.built(ev.x, ev.y, 3, 0);
        if (ev.entity === 'hub' && session !== null) rallyToMinerals(session, { x: ev.x, y: ev.y, id: ev.id });
        sfx.built();
        if (phase === 'playing') toast(`${typeName(ev.entity)} ready`, 'good');
        return;
      case 'started':
        if (ev.owner === 0 && match !== null) fx.ping(ev.x, ev.y, 'move');
        return;
      case 'trained':
        if (ev.owner === 0 && match !== null) sfx.ready();
        return;
      case 'deposit':
        if (ev.owner === 0 && match !== null && sees(m, ev.x, ev.y)) {
          fx.deposit(ev.x, ev.y);
          if (loud && loudness(ev.x, ev.y) > 0.3) sfx.deposit();
        }
        return;
      case 'alert': {
        if (ev.owner !== 0 || session === null || match === null) return;
        if (ev.kind === 'attack') {
          session.lastAlert = { x: ev.x, y: ev.y };
          alerts.push({ x: ev.x, y: ev.y, at: performance.now() / 1000 });
          fx.ping(ev.x, ev.y, 'alert');
          ui.flashAlert();
          toast('Your base is under attack!', 'danger');
          sfx.alarm();
        } else if (ev.kind === 'supply') toast('Need more depots', 'warn');
        else if (ev.kind === 'minerals') toast('Not enough minerals', 'warn');
        else if (ev.kind === 'gas') toast('Not enough gas', 'warn');
        return;
      }
      case 'victory':
        if (m === match) endTicks = 0;
        return;
      default:
    }
  }

  // ---- the loop ----------------------------------------------------------------------------------------
  /** Runs `count` ticks, keeping the picture smooth: interpolate across the whole batch, not just its last tick. */
  function stepBatch(m: Match, count: number): void {
    const saved = count > 1 ? new Map<number, [number, number]>() : null;
    for (let k = 0; k < count; k++) {
      stepMatch(m);
      if (k === 0 && saved !== null) for (const e of m.entities) saved.set(e.id, [e.px, e.py]);
      for (const ev of drainEvents(m)) handle(m, ev);
    }
    if (saved !== null) {
      for (const e of m.entities) {
        const start = saved.get(e.id);
        if (start !== undefined) {
          e.px = start[0];
          e.py = start[1];
        }
      }
    }
  }

  function update(): void {
    const simStart = performance.now();
    stepPhase();
    cost.sim = smooth(cost.sim, performance.now() - simStart);
  }

  function stepPhase(): void {
    if (phase === 'playing' && match !== null) {
      stepBatch(match, speed);
      if (endTicks >= 0) {
        endTicks += speed;
        if (endTicks >= ENDING_TICKS) endMatch(match);
      }
    } else if (phase === 'result' && match !== null) {
      stepBatch(match, 1);
    } else if (phase === 'menu' && demo !== null) {
      if (demo.winner >= 0) startDemo(randomSeed());
      else stepBatch(demo, 2);
    }
  }

  function refreshHud(m: Match, s: Session): void {
    const p = m.players[0];
    if (p === undefined) return;
    ui.setHud({
      minerals: p.minerals,
      gas: p.gas,
      supplyUsed: p.supplyUsed,
      supplyCap: p.supplyCap,
      clock: clockText(m.tick),
      idleWorkers: idleWorkers(s).length,
      army: armyOf(s).length,
      speed,
      drop: dropUsed ? 'used' : ads.isRewardedReady() ? 'ready' : 'none',
    });
    ui.setSelection(selectionInfo(s));
    ui.setCard(phase === 'playing' ? cardFor(s) : []);
    if (hintUntil > 0 && clockTime > hintUntil) {
      ui.setHint('');
      hintUntil = 0;
    }
  }

  /** The camera behind the menu: toward the fighting if there is any, else drifting from one base to the other. */
  let actionX = 48;
  let actionY = 48;
  let actionAt = -10;
  function followAction(m: Match, dt: number): void {
    if (clockTime - actionAt > 0.6) {
      actionAt = clockTime;
      let x = 0;
      let y = 0;
      let n = 0;
      for (const e of m.entities) {
        if (e.alive && m.tick - e.hurtAt < 60 && e.owner >= 0) {
          x += e.x;
          y += e.y;
          n += 1;
        }
      }
      if (n >= 2) {
        actionX = x / n;
        actionY = y / n;
      } else {
        const hubs = m.entities.filter((e) => e.alive && e.type === 'hub' && m.map.bases.some((b) => b.start >= 0 && b.x === e.x && b.y === e.y));
        const a = hubs[0];
        const b = hubs[1] ?? a;
        if (a !== undefined && b !== undefined) {
          // Starts at the first base, lingers at each end, and crosses the middle quickly.
          const t = clamp(0.5 + 0.95 * Math.sin(clockTime * 0.05 - 1.2), 0, 1);
          actionX = a.x + (b.x - a.x) * t;
          actionY = a.y + (b.y - a.y) * t;
        }
      }
    }
    const cam = world3d.cam;
    const k = Math.min(1, dt * 0.9);
    cam.x += (actionX - cam.x) * k;
    cam.y += (actionY - cam.y) * k;
    cam.zoom += (26 - cam.zoom) * k;
    world3d.clampCamera();
  }

  function render(alpha: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    clockTime += dt;

    world3d.layout(view.fit());
    const m = matchOf();
    if (m === null) return;
    if (phase === 'playing') controls.update(dt);
    else if (phase === 'menu') {
      followAction(m, dt);
    }

    const s = session;
    let ghost: Ghost | null = null;
    if (s !== null && phase === 'playing' && s.mode.kind === 'place') {
      const at = controls.pointer();
      if (at !== null) {
        const type: BuildingType = s.mode.building;
        const place = placementAt(s, type, at.x, at.y);
        ghost = { type, x: place.x, y: place.y, valid: place.ok };
      }
    }

    const drawStart = performance.now();
    const frame = world3d.draw({
      match: m,
      player: 0,
      fog: fogOn && phase !== 'menu' && phase !== 'result',
      alpha: phase === 'paused' ? 1 : alpha,
      dt,
      time: clockTime,
      selected: s !== null && phase !== 'result' ? s.selected : EMPTY,
      hover: phase === 'playing' ? controls.hover() : null,
      ghost,
      allBars: profile.settings.bars,
    });
    overlay.draw(phase === 'menu' ? [] : frame.bars, phase === 'playing' ? controls.box() : null);
    cost.draw = smooth(cost.draw, performance.now() - drawStart);

    if (phase === 'playing' || phase === 'paused') {
      minimap?.draw({ match: m, player: 0, fog: fogOn, quad: world3d.viewQuad(), alerts, now: now / 1000 });
      hudTimer += dt;
      if (s !== null && (hudDirty || hudTimer > 0.1)) {
        hudTimer = 0;
        hudDirty = false;
        refreshHud(m, s);
      }
    }
  }

  // Leaving the game (another tab, a turned phone) pauses it: nobody should lose a base while looking away.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  if (typeof window.matchMedia === 'function') {
    const portrait = window.matchMedia('(orientation: portrait) and (max-width: 820px)');
    portrait.addEventListener('change', (event) => {
      if (event.matches) pause();
    });
  }

  // ---- go ----------------------------------------------------------------------------------------------
  applySettings();
  refreshMenu();
  ui.show('menu');
  ui.showHud(false);
  startDemo(profile.seed);
  void ads.init().then(() => {
    void ads.preloadRewarded();
    void ads.preloadInterstitial();
  });
  if (autostart) startMatch(profile.seed);

  if (dev) {
    // Read-only snapshot for tests. Not present in production builds.
    Object.defineProperty(window, '__game', {
      get: () => ({
        phase,
        score: match?.players[0]?.minerals ?? 0,
        alive: phase === 'playing',
        debug: {
          id: GAME_ID,
          match,
          demo,
          session,
          profile,
          speed,
          cost,
          selected: session !== null ? selection(session).map((e) => e.id) : [],
          mode: session?.mode.kind ?? null,
          cam: { ...world3d.cam },
          /** Where an entity is on the screen in client pixels (for clicking it in a test). */
          screenOf: (id: number) => {
            const e = matchOf()?.byId.get(id);
            if (e === undefined) return null;
            const p = world3d.project(e.x, e.y, 0.4);
            if (p === null) return null;
            const fit = view.fit();
            return { x: fit.offsetX + p.x * fit.scale, y: fit.offsetY + p.y * fit.scale };
          },
          /** Where a map point is on the screen in client pixels. */
          screenOfPoint: (x: number, y: number) => {
            const p = world3d.project(x, y, 0);
            if (p === null) return null;
            const fit = view.fit();
            return { x: fit.offsetX + p.x * fit.scale, y: fit.offsetY + p.y * fit.scale };
          },
          focus: (x: number, y: number, zoom?: number) => {
            world3d.cam.x = x;
            world3d.cam.y = y;
            if (zoom !== undefined) world3d.cam.zoom = zoom;
            world3d.clampCamera();
          },
          give: (minerals: number, gas: number) => {
            const p = match?.players[0];
            if (p !== undefined) {
              p.minerals += minerals;
              p.gas += gas;
            }
          },
          start: (seed: number) => startMatch(seed),
          /** Drops an entity into the match, skipping the rules (tests and screenshots only). */
          spawn: async (type: string, owner: number, x: number, y: number, finished = true) => {
            const { addEntityForTests } = await import('./sim/testing');
            const m = match ?? demo;
            if (m === null) return null;
            return addEntityForTests(m, type as never, owner, x, y, finished).id;
          },
          /** A spot where a building of this type can go, searching outward from a point. */
          freeSpot: (type: string, x: number, y: number) => {
            if (session === null) return null;
            for (let r = 0; r < 20; r += 1) {
              for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                  if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                  const p = placementAt(session, type as BuildingType, x + dx, y + dy);
                  if (p.ok) return { x: p.x, y: p.y };
                }
              }
            }
            return null;
          },
          /** Destroys an entity (or every building of a side) at once. */
          kill: async (id: number) => {
            const { killEntity } = await import('./sim/testing');
            const e = match?.byId.get(id) ?? demo?.byId.get(id);
            if (e !== undefined) killEntity(match ?? demo!, e, -1);
          },
          destroyBuildings: async (owner: number) => {
            const { killEntity } = await import('./sim/testing');
            const m = match;
            if (m === null) return;
            for (const e of m.entities) if (e.alive && e.owner === owner && isBuilding(e)) killEntity(m, e, -1);
          },
          attackMove: (x: number, y: number) => (session !== null ? attackMoveAt(session, x, y) : null),
          counts: () => {
            const out: Record<string, number> = {};
            for (const e of match?.entities ?? []) if (e.alive && e.owner === 0 && (isUnit(e) || isBuilding(e))) out[e.type] = (out[e.type] ?? 0) + 1;
            return out;
          },
        },
      }),
    });
  }

  return { step: 1 / 20, update, render };
};
