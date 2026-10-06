/**
 * Arena Zero: the game's flow. The engine gives us its tools (ads, analytics, haptics, audio, the #ui overlay and the
 * canvas host); this file runs the phases (a menu with a bots-only match playing behind it, a countdown, the match, a
 * pause, the result) and connects the pure simulation (sim/) to what is drawn (view/), what is shown (ui/) and what the
 * player does (controls).
 */
import type { GameFactory } from '../engine';
import { safeGetItem, safeSetItem } from '../engine/core/storage';
import { assistLook, crosshairOnEnemy, findAimTarget } from './aim';
import { createRig, deadView, firstPerson, landed, zoomedFov, type Rig } from './camera';
import { createControls } from './controls';
import { showEvent } from './feedback';
import { PROFILE_KEY } from './info';
import { BOT_COUNTS, parseProfile, serializeProfile, type Profile } from './profile';
import { adaptQuality, createQuality } from './quality';
import { createSfx } from './sfx';
import { ACTOR, DEG, MODES, WEAPONS, WEAPON_IDS, sec, type Mode } from './sim/config';
import { createMatch, damageActor, drainEvents, giveWeapon, heightAt, lineOfSight, spreadOf, stepMatch, weaponDef, wrapAngle, type Actor, type Match, type MatchEvent } from './sim';
import { createUi, type BoardRow, type RadarDot, type Ui } from './ui';
import { COLORS, actorColor, createWorld3d, type CameraPose, type World3d } from './view';
import type { ViewmodelInput } from './view';

type Phase = 'menu' | 'playing' | 'paused' | 'result';

const DT = 1 / 60;
const COUNTDOWN = 3;
/** After the deciding kill the fight is shown this long before the result appears. */
const ENDING = 1.8;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function parseSeed(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(99999, Math.trunc(n)) : null;
}

const clockText = (ticks: number): string => {
  const s = Math.max(0, Math.ceil(ticks / 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const PICKUP_TEXT: Record<string, string> = { health: '+ Health', armor: '+ Armor', ammo: '+ Ammo', shotgun: 'Shotgun', rail: 'Railgun', rocket: 'Rocket Launcher' };

export const createGame: GameFactory = ({ ads, analytics, audio, haptics, view, params, uiRoot, resetClock, world }) => {
  const dev = import.meta.env.DEV;
  const fixedSeed = parseSeed(params.get('seed'));
  const autostart = dev && params.get('autostart') === '1';
  const skipCountdown = dev && params.get('countdown') === '0';

  view.setBackground(COLORS.letterbox);
  const sfx = createSfx(audio, haptics);

  const profile: Profile = parseProfile(safeGetItem(PROFILE_KEY));
  const levelParam = params.get('level');
  if (levelParam === 'easy' || levelParam === 'normal' || levelParam === 'hard') profile.level = levelParam;
  const modeParam = params.get('mode');
  if (modeParam === 'ffa' || modeParam === 'tdm') profile.mode = modeParam;
  const botsParam = Number(params.get('bots'));
  if (BOT_COUNTS.includes(botsParam)) profile.bots = botsParam;
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
    note.textContent = 'Arena Zero needs WebGL, and this device could not start it.';
    uiRoot.append(note);
    return { step: DT, update() {}, render() {} };
  }

  // ---- state --------------------------------------------------------------------------------
  let phase: Phase = 'menu';
  let match: Match | null = null;
  let demo: Match | null = null;
  let rig: Rig = createRig();
  let clock = 0;
  let lastNow = performance.now();
  let countdown = 0;
  let countdownShown = -1;
  let endAt = -1;
  let hudTimer = 0;
  let radarTimer = 0;
  let boardOpen = false;
  let hurtFlash = 0;
  let busy = false;
  let boostUsed = false;
  let boostPending = false;
  let bestStreak = 0;
  let returnTo: 'menu' | 'pause' = 'menu';
  let matchStartedAt = 0;
  let follow = -1;
  let followUntil = 0;
  let lastKiller = -1;
  let lastTurn = { yaw: 0, pitch: 0 };
  let hintUntil = 0;
  let hintText = '';
  let hot = false;
  /** Dev only: the player cannot be hurt (tests that are not about fighting). */
  let peace = false;
  // ?quality=N (dev) pins the resolution; otherwise the game measures its own frame rate and lowers it if need be.
  const pinnedQuality = dev && params.get('quality') !== null ? clamp(Number(params.get('quality')) || 1, 0.5, 1) : null;
  const quality = createQuality(pinnedQuality ?? 1);

  const current = (): Match | null => match ?? demo;

  // ---- input ----------------------------------------------------------------------------------
  const controls = createControls({
    target: document.body,
    sensitivity: () => profile.settings.sensitivity,
    invertY: () => profile.settings.invertY,
    onPause: () => pause(),
    onBoard: (held) => {
      boardOpen = held;
      refreshBoard();
    },
    onSlot: (slot) => chooseSlot(slot),
    onCycle: (direction) => cycleWeapon(direction),
    onDevice: (touch) => ui.setTouch(touch),
    onAimToggle: (on) => ui.setAiming(on),
  });

  // ---- screens --------------------------------------------------------------------------------
  const ui: Ui = createUi(
    uiRoot,
    {
      onPlay: () => startMatch(profile.seed),
      onMode: (mode: Mode) => {
        profile.mode = mode;
        save();
        sfx.click();
        refreshMenu();
        startDemo(profile.seed);
      },
      onLevel: (level) => {
        profile.level = level;
        save();
        sfx.click();
        refreshMenu();
      },
      onBots: (count) => {
        profile.bots = count;
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
      onToggle: (key) => {
        profile.settings[key] = !profile.settings[key];
        applySettings();
        save();
        sfx.click();
        if (key === 'fullscreen') void setFullscreen(profile.settings.fullscreen);
      },
      onSlider: (key, value) => {
        profile.settings[key] = value;
        save();
      },
      onQuality: (q) => {
        profile.settings.quality = q;
        applyQuality(true);
        applySettings();
        save();
        sfx.click();
      },
      onPause: () => pause(),
      onResume: () => resume(),
      onRestart: () => {
        sfx.click();
        startMatch(match?.seed ?? profile.seed);
      },
      onQuit: () => {
        sfx.click();
        toMenu();
      },
      onAgain: () => afterResult(() => startMatch(profile.seed)),
      onMenu: () => afterResult(() => toMenu()),
      onBoard: () => {
        boardOpen = !boardOpen;
        refreshBoard();
      },
      onSlot: (slot) => chooseSlot(slot),
      onBoost: () => boost(),
      touch: controls.touchHandlers,
    },
    world,
  );
  ui.setTouch(controls.touch);

  // ---- phones: fullscreen with a landscape lock, and a screen that stays awake ------------------------
  async function setFullscreen(on: boolean): Promise<void> {
    try {
      if (on && document.fullscreenEnabled && document.fullscreenElement === null) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await (screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }).lock?.('landscape');
      } else if (!on && document.fullscreenElement !== null) {
        await document.exitFullscreen();
      }
    } catch {
      // Not allowed here (an iPhone's Safari has no fullscreen): the game plays the same without it.
    }
  }

  let wake: WakeLockSentinel | null = null;
  async function keepAwake(on: boolean): Promise<void> {
    try {
      if (on && wake === null && 'wakeLock' in navigator) {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => {
          wake = null;
        });
      } else if (!on && wake !== null) {
        const held = wake;
        wake = null;
        await held.release();
      }
    } catch {
      wake = null;
    }
  }

  function applyQuality(reset: boolean): void {
    const q = profile.settings.quality;
    if (pinnedQuality !== null) quality.scale = pinnedQuality;
    else if (q === 'low') quality.scale = 0.65;
    else if (q === 'high') quality.scale = 1;
    else if (reset) {
      quality.scale = 1;
      quality.changedAt = clock;
    }
    world3d.setQuality(quality.scale);
  }

  function applySettings(): void {
    audio.setEnabled(profile.settings.sound);
    haptics.setEnabled(profile.settings.haptics);
    ui.setLeftHanded(profile.settings.leftHanded);
    ui.setSettings({ ...profile.settings });
  }

  function refreshMenu(): void {
    ui.setMenu({ mode: profile.mode, level: profile.level, bots: profile.bots, botChoices: BOT_COUNTS, seed: profile.seed, played: profile.played, wins: profile.wins, kills: profile.kills, best: profile.best });
  }

  function openOverlay(screen: 'help' | 'settings'): void {
    returnTo = phase === 'paused' ? 'pause' : 'menu';
    sfx.click();
    ui.show(screen);
  }

  // ---- matches --------------------------------------------------------------------------------
  function loadWorld(m: Match): void {
    world3d.load(m);
    ui.setMap(m.arena.heights, m.arena.size);
  }

  function startDemo(seed: number): void {
    demo = createMatch({ seed, mode: profile.mode, difficulty: 'normal', bots: 7, human: false });
    loadWorld(demo);
    follow = -1;
    followUntil = 0;
  }

  function startMatch(seed: number): void {
    if (busy) return;
    sfx.click();
    profile.seed = seed;
    save();
    match = createMatch({ seed, mode: profile.mode, difficulty: profile.level, bots: profile.bots, human: true });
    demo = null;
    loadWorld(match);
    const me = match.actors[0]!;
    controls.look(me.yaw, me.pitch);
    controls.setAiming(false);
    ui.setAiming(false);
    rig = createRig();
    rig.yaw = me.yaw;
    countdown = skipCountdown ? 0 : COUNTDOWN;
    countdownShown = -1;
    endAt = -1;
    boostUsed = false;
    boostPending = false;
    bestStreak = 0;
    boardOpen = false;
    hurtFlash = 0;
    lastKiller = -1;
    matchStartedAt = performance.now();
    phase = 'playing';
    ui.show('none');
    ui.showHud(true);
    ui.showBoard(false);
    ui.banner(null);
    ui.setPlaying(true);
    controls.setEnabled(true);
    // A press is the gesture the browser needs to capture the mouse and to allow fullscreen.
    if (!controls.touch) controls.capture();
    else if (profile.settings.fullscreen) void setFullscreen(true);
    void keepAwake(true);
    if (!profile.helped) {
      profile.helped = true;
      save();
      hintText = controls.touch ? 'Left thumb moves · right thumb looks · hold FIRE to shoot' : 'WASD moves · mouse looks · click fires · Esc pauses';
      hintUntil = clock + 9;
    } else hintText = '';
    analytics.track('match_start', { mode: profile.mode, level: profile.level, bots: profile.bots, seed });
    resetClock();
    refreshHud(true);
  }

  function toMenu(): void {
    void keepAwake(false);
    phase = 'menu';
    match = null;
    controls.setEnabled(false);
    ui.setPlaying(false);
    ui.show('menu');
    ui.showHud(false);
    ui.banner(null);
    ui.setHint('');
    ui.setDanger(0);
    refreshMenu();
    startDemo(profile.seed);
    resetClock();
  }

  function pause(): void {
    if (phase !== 'playing') return;
    phase = 'paused';
    controls.setEnabled(false);
    ui.release();
    ui.setPlaying(false);
    boardOpen = false;
    ui.showBoard(false);
    ui.show('pause');
    sfx.click();
  }

  function resume(): void {
    if (phase !== 'paused') return;
    phase = 'playing';
    ui.show('none');
    ui.setPlaying(true);
    controls.setEnabled(true);
    if (!controls.touch) controls.capture();
    resetClock();
    sfx.click();
  }

  /** The rewarded ad: come back at once, with armor and the heavy guns. */
  function boost(): void {
    if (busy || boostUsed || match === null) return;
    const me = match.actors[0]!;
    if (me.alive) return;
    if (!ads.isRewardedReady()) {
      ui.toast('No ad available right now', 'warn');
      void ads.preloadRewarded();
      return;
    }
    busy = true;
    analytics.track('boost_offered', {});
    void ads.showRewarded().then((rewarded) => {
      busy = false;
      resetClock();
      void ads.preloadRewarded();
      const m = match;
      if (!rewarded || m === null) return;
      const a = m.actors[0]!;
      boostUsed = true;
      if (!a.alive) {
        boostPending = true;
        a.respawnAt = m.tick;
      }
      analytics.track('boost_claimed', {});
    });
  }

  /** Between matches: maybe an ad, then whatever was asked for. */
  function afterResult(next: () => void): void {
    if (busy) return;
    const lastedMs = performance.now() - matchStartedAt;
    if (profile.played >= 2 && lastedMs > 90_000 && ads.isInterstitialReady()) {
      busy = true;
      void ads.showInterstitial().then(() => {
        busy = false;
        void ads.preloadInterstitial();
        resetClock();
        next();
      });
      return;
    }
    next();
  }

  function showResult(m: Match): void {
    const me = m.actors[0]!;
    const team = m.mode === 'tdm';
    const won = m.winner === (team ? me.team : me.id);
    const draw = m.winner === -2;
    void keepAwake(false);
    phase = 'result';
    controls.setEnabled(false);
    ui.release();
    ui.setPlaying(false);
    ui.showHud(false);
    ui.banner(null);
    ui.setDanger(0);
    profile.played += 1;
    if (won) profile.wins += 1;
    profile.kills += me.kills;
    profile.deaths += me.deaths;
    profile.best = Math.max(profile.best, me.kills);
    save();
    let sub = `${MODES[m.mode].name} · ${m.timeLeft === 0 ? 'time up' : `first to ${m.scoreLimit}`}`;
    if (!won && !draw) {
      const w = team ? null : m.actors[m.winner];
      sub = w !== null && w !== undefined ? `${w.name} won with ${w.kills} kills · ${sub}` : `The other team won · ${sub}`;
    }
    const acc = me.shots > 0 ? Math.round((me.hits / me.shots) * 100) : 0;
    ui.setResult({
      title: draw ? 'Draw' : won ? 'Victory' : 'Defeat',
      tone: draw ? 'draw' : won ? 'win' : 'lose',
      sub,
      rows: boardRows(m),
      facts: [
        { name: 'Kills', value: String(me.kills) },
        { name: 'Deaths', value: String(me.deaths) },
        { name: 'Accuracy', value: `${acc}%` },
        { name: 'Headshots', value: String(me.headshots) },
        { name: 'Damage dealt', value: String(Math.round(me.damageDealt)) },
        { name: 'Best streak', value: String(bestStreak) },
      ],
    });
    ui.show('result');
    if (won) sfx.win();
    else if (!draw) sfx.lose();
    analytics.track('match_end', { mode: m.mode, level: profile.level, won, kills: me.kills, deaths: me.deaths });
  }

  // ---- weapons --------------------------------------------------------------------------------
  function chooseSlot(slot: number): void {
    const me = match?.actors[0];
    if (me === undefined || !me.alive || phase !== 'playing') return;
    if (slot === me.current || me.weapons[slot]?.owned !== true) return;
    controls.queueSlot(slot);
  }

  function cycleWeapon(direction: number): void {
    const me = match?.actors[0];
    if (me === undefined || !me.alive || phase !== 'playing') return;
    const n = WEAPON_IDS.length;
    for (let i = 1; i <= n; i++) {
      const slot = (me.current + direction * i + n * 4) % n;
      if (me.weapons[slot]?.owned === true) {
        controls.queueSlot(slot);
        return;
      }
    }
  }

  // ---- what happens ---------------------------------------------------------------------------
  const nearness = (m: Match, x: number, z: number): number => {
    const me = m.actors[0];
    if (me === undefined || m.human < 0) return 0.5;
    const d = Math.hypot(x - me.x, z - me.z);
    return clamp(1 - d / 48, 0, 1) ** 1.5;
  };

  function handleEvent(m: Match, ev: MatchEvent, playing: boolean): void {
    showEvent(world3d, m, ev, playing ? 0 : -1);
    const me = playing ? m.actors[0] : undefined;
    switch (ev.type) {
      case 'fire': {
        const a = m.actors[ev.actor];
        if (a === undefined) break;
        if (ev.actor === 0 && playing) sfx.shot(ev.weapon, 1, true);
        else if (playing) sfx.shot(ev.weapon, nearness(m, a.x, a.z));
        break;
      }
      case 'hit': {
        if (!playing) break;
        if (ev.attacker === 0 && ev.victim !== 0) {
          ui.hitMarker(ev.killed ? 'kill' : ev.head ? 'head' : 'hit');
          sfx.hit(ev.head, ev.killed);
        }
        if (ev.victim === 0) {
          sfx.hurt(ev.damage > 25);
          ui.damageFrom(wrapAngle(ev.fromYaw - controls.yaw), ev.damage);
          hurtFlash = Math.min(1, hurtFlash + ev.damage / 50);
        }
        break;
      }
      case 'kill': {
        const killer = m.actors[ev.killer];
        const victim = m.actors[ev.victim];
        if (killer === undefined || victim === undefined) break;
        if (!playing) break;
        const team = m.mode === 'tdm';
        ui.pushFeed({
          killer: killer.name,
          victim: victim.name,
          weapon: ev.weapon,
          head: ev.head,
          you: ev.killer === 0 ? 'killer' : ev.victim === 0 ? 'victim' : 'none',
          killerTeam: team ? killer.team : -1,
          victimTeam: team ? victim.team : -1,
        });
        if (ev.killer === 0 && ev.victim !== 0) {
          bestStreak = Math.max(bestStreak, killer.streak);
          ui.toast(killer.streak >= 3 ? `${killer.streak} in a row!` : `Eliminated ${victim.name}`, 'good');
        }
        if (ev.victim === 0) lastKiller = ev.killer;
        break;
      }
      case 'death': {
        if (!playing) break;
        if (ev.actor === 0) {
          sfx.die();
          controls.setAiming(false);
          ui.setAiming(false);
          ui.release();
          boardOpen = false;
          ui.showBoard(false);
        } else sfx.fall(nearness(m, ev.x, ev.z));
        break;
      }
      case 'spawn': {
        if (playing && ev.actor === 0 && me !== undefined) {
          sfx.respawn();
          controls.look(me.yaw, me.pitch);
          rig = createRig();
          rig.yaw = me.yaw;
          ui.banner(null);
          if (boostPending) {
            boostPending = false;
            me.armor = 100;
            giveWeapon(me, 'rocket', 1);
            giveWeapon(me, 'rail', 1);
            ui.toast('Boost: armor, Railgun, Rocket Launcher', 'good');
          }
        }
        break;
      }
      case 'pickup':
        if (ev.actor === 0 && playing) {
          sfx.pickup(ev.kind);
          ui.toast(PICKUP_TEXT[ev.kind] ?? ev.kind, 'info');
        }
        break;
      case 'reload':
        if (ev.actor === 0 && playing) sfx.reload();
        break;
      case 'switch':
        if (ev.actor === 0 && playing) sfx.switchWeapon();
        break;
      case 'explosion':
        if (playing) sfx.explosion(nearness(m, ev.x, ev.z));
        break;
      case 'land':
        if (ev.actor === 0 && playing) {
          landed(rig, ev.speed);
          sfx.land(ev.speed);
        }
        break;
      case 'jump':
        if (ev.actor === 0 && playing) sfx.jump();
        break;
      default:
    }
  }

  // ---- the fixed step -------------------------------------------------------------------------
  function update(): void {
    clock += DT;
    if (phase === 'menu') {
      if (demo === null) return;
      stepMatch(demo);
      for (const ev of drainEvents(demo)) handleEvent(demo, ev, false);
      if (demo.winner !== -1) {
        demo = createMatch({ seed: demo.seed, mode: profile.mode, difficulty: 'normal', bots: 7, human: false });
        loadWorld(demo);
      }
      return;
    }
    if (phase !== 'playing' || match === null) return;
    const m = match;
    if (countdown > 0) {
      countdown = Math.max(0, countdown - DT);
      return;
    }
    if (m.winner !== -1) {
      if (endAt < 0) endAt = clock + ENDING;
      for (const ev of drainEvents(m)) handleEvent(m, ev, true);
      if (clock >= endAt) showResult(m);
      return;
    }
    const me = m.actors[0]!;
    if (peace && me.alive) me.protect = Math.max(me.protect, 120);
    const auto = profile.settings.autoFire && me.alive && crosshairOnEnemy(m, me, controls.yaw, controls.pitch);
    stepMatch(m, controls.sample(auto));
    for (const ev of drainEvents(m)) handleEvent(m, ev, true);
    if (m.winner !== -1 && endAt < 0) endAt = clock + ENDING;
  }

  // ---- the HUD --------------------------------------------------------------------------------
  function boardRows(m: Match): BoardRow[] {
    const rows = m.actors.map<BoardRow>((a) => ({
      name: a.name,
      kills: a.kills,
      deaths: a.deaths,
      accuracy: a.shots > 0 ? `${Math.round((a.hits / a.shots) * 100)}%` : '–',
      team: m.mode === 'tdm' ? a.team : -1,
      you: a.id === 0 && m.human === 0,
      alive: a.alive,
    }));
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    return rows;
  }

  function refreshBoard(): void {
    const m = match;
    ui.showBoard(boardOpen && m !== null && phase === 'playing');
    if (boardOpen && m !== null) {
      const sides = m.mode === 'tdm' ? `${m.scores[0]} – ${m.scores[1]}` : '';
      ui.setBoard(boardRows(m), `${MODES[m.mode].name} ${sides}`.trim());
    }
  }

  function refreshHud(force = false): void {
    const m = match;
    if (m === null) return;
    const me = m.actors[0]!;
    const def = weaponDef(me);
    const slot = me.weapons[me.current]!;
    const team = m.mode === 'tdm';
    let rival = { label: '', value: 0 };
    if (!team) {
      for (const a of m.actors) if (a.id !== 0 && (a.kills > rival.value || rival.label === '')) rival = { label: a.name, value: a.kills };
    }
    const fov = profile.settings.fov;
    const zoomFov = zoomedFov(fov, 1 + (def.zoom - 1) * rig.aim);
    const spread = me.alive ? spreadOf(me) : 0;
    const gap = clamp(Math.tan(spread * DEG) * (world.height / 2 / Math.tan((zoomFov * DEG) / 2)) + 2, 2, 46);
    hot = me.alive && crosshairOnEnemy(m, me, controls.yaw, controls.pitch);
    ui.setHud({
      health: me.alive ? me.health : 0,
      armor: me.alive ? me.armor : 0,
      weapon: def.name,
      mag: slot.mag,
      reserve: Number.isFinite(slot.reserve) ? slot.reserve : -1,
      reload: me.reloading > 0 ? 1 - me.reloading / sec(def.reload) : -1,
      slots: WEAPON_IDS.map((id, i) => ({ owned: me.weapons[i]?.owned === true, current: i === me.current, mag: me.weapons[i]?.mag ?? 0, icon: id })),
      left: team ? { label: 'You', value: m.scores[me.team] ?? 0, tone: 'team0' } : { label: 'You', value: me.kills, tone: 'you' },
      right: team ? { label: 'Them', value: m.scores[1 - me.team] ?? 0, tone: 'team1' } : { label: rival.label, value: rival.value, tone: 'rival' },
      clock: clockText(m.timeLeft),
      limit: `First to ${m.scoreLimit}`,
      protect: me.protect > 0,
      gap,
      aiming: rig.aim > 0.5,
      hot,
      scope: me.alive && def.zoom > 2.5 && rig.aim > 0.85,
      alive: me.alive,
    });
    if (boardOpen || force) refreshBoard();
    const low = me.alive && me.health < 35 ? (35 - me.health) / 35 : 0;
    ui.setDanger(Math.max(low * (0.55 + 0.25 * Math.sin(clock * 6)), hurtFlash * 0.7));
    // Words in the middle of the screen.
    if (countdown > 0) {
      const n = Math.ceil(countdown);
      ui.banner({ title: String(n), sub: `${MODES[m.mode].name} · ${m.mode === 'tdm' ? 'your team is blue' : 'everyone for themselves'}`, boost: null, tone: 'info' });
    } else if (!me.alive && m.winner === -1) {
      const killer = m.actors[lastKiller];
      const left = Math.max(0, Math.ceil((me.respawnAt - m.tick) / 60));
      ui.banner({
        title: 'ELIMINATED',
        sub: `${killer !== undefined && killer.id !== 0 ? `by ${killer.name} · ` : ''}back in ${left}`,
        boost: !boostUsed && ads.isRewardedReady() ? 'Watch an ad: back now with armor + heavy guns' : null,
        tone: 'danger',
      });
    } else if (m.winner !== -1) {
      ui.banner({ title: m.winner === -2 ? 'DRAW' : m.winner === (team ? me.team : me.id) ? 'VICTORY' : 'DEFEAT', sub: '', boost: null, tone: m.winner === (team ? me.team : me.id) ? 'good' : 'danger' });
    } else ui.banner(null);
    // A hint, or the way back to the mouse.
    if (!me.alive || countdown > 0 || m.winner !== -1) ui.setHint('');
    else if (clock < hintUntil) ui.setHint(hintText);
    else if (!controls.touch && !controls.locked && phase === 'playing') ui.setHint(controls.lockFailed ? 'Right-drag to look around' : 'Click to capture the mouse');
    else ui.setHint('');
  }

  function refreshRadar(m: Match, viewer: Actor): void {
    const dots: RadarDot[] = [];
    const team = m.mode === 'tdm';
    const eyeY = viewer.y + ACTOR.eye;
    for (const a of m.actors) {
      if (a.id === viewer.id || !a.alive) continue;
      const ally = team && a.team === viewer.team;
      if (ally) {
        dots.push({ x: a.x, z: a.z, kind: 'ally' });
        continue;
      }
      // An enemy shows while you can see them, and for a moment after they fire.
      const noisy = m.sounds.some((s) => s.owner === a.id && m.tick - s.tick < 80);
      if (noisy || lineOfSight(m.arena, viewer.x, eyeY, viewer.z, a.x, a.y + 1.1, a.z)) dots.push({ x: a.x, z: a.z, kind: 'enemy' });
    }
    for (const p of m.pickups) if (p.active) dots.push({ x: p.x, z: p.z, kind: 'pickup' });
    ui.setRadar({ x: viewer.x, z: viewer.z, yaw: controls.yaw, dots });
  }

  // ---- the frame ------------------------------------------------------------------------------
  function demoPose(m: Match, alpha: number): CameraPose {
    if (follow < 0 || clock > followUntil || m.actors[follow]?.alive !== true) {
      const alive = m.actors.filter((a) => a.alive);
      const pick = alive[Math.floor(clock * 7.3) % Math.max(1, alive.length)];
      follow = pick?.id ?? 0;
      followUntil = clock + 8;
    }
    const a = m.actors[follow]!;
    const x = a.px + (a.x - a.px) * alpha;
    const z = a.pz + (a.z - a.pz) * alpha;
    const fx = -Math.sin(a.yaw);
    const fz = -Math.cos(a.yaw);
    return { x: x - fx * 3.4, y: a.y + 2.3, z: z - fz * 3.4, yaw: a.yaw, pitch: -0.28, roll: 0, fov: 70 };
  }

  function render(alpha: number): void {
    const now = performance.now();
    const real = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    world3d.layout(view.fit());
    if (pinnedQuality === null && profile.settings.quality === 'auto' && (phase === 'playing' || phase === 'menu')) {
      if (adaptQuality(quality, real, clock)) world3d.setQuality(quality.scale);
    }
    const m = current();
    if (m === null) return;

    // The demo behind the menu.
    if (match === null) {
      world3d.draw({ match: m, viewer: -1, pose: demoPose(m, alpha), alpha, dt: real, time: clock, gun: null });
      return;
    }

    const me = match.actors[0]!;
    const live = phase === 'playing';
    const dt = live ? real : 0;
    let pose: CameraPose;
    let gun: ViewmodelInput | null = null;
    const def = weaponDef(me);
    if (me.alive) {
      const fov = profile.settings.fov;
      const zoomNow = zoomedFov(fov, 1 + (def.zoom - 1) * rig.aim);
      const scale = Math.tan((zoomNow * DEG) / 2) / Math.tan((fov * DEG) / 2);
      if (live) {
        const assistOn = profile.settings.aimAssist && controls.touch;
        controls.frame(scale, (dYaw, dPitch, turning) => {
          const target = assistOn && countdown <= 0 ? findAimTarget(match!, me, controls.yaw, controls.pitch) : null;
          const r = assistLook(dYaw, dPitch, target, { strength: 1, turning, firing: controls.firing || profile.settings.autoFire }, real);
          lastTurn = { yaw: r.dYaw, pitch: r.dPitch };
          return r;
        });
      } else lastTurn = { yaw: 0, pitch: 0 };
      pose = firstPerson(rig, me, alpha, dt, fov, def.zoom, me.input.moveX);
      // The view turns at the screen's speed, not the simulation's.
      pose.yaw = controls.yaw;
      pose.pitch = controls.pitch;
      const speed = Math.hypot(me.vx, me.vz);
      gun = {
        weapon: WEAPON_IDS[me.current] ?? 'rifle',
        aim: rig.aim,
        speed,
        stride: me.stride,
        onGround: me.onGround,
        sprinting: me.input.sprint && speed > 6,
        reload: me.reloading > 0 ? 1 - me.reloading / sec(def.reload) : 0,
        equip: me.equipping > 0 ? 1 - me.equipping / sec(WEAPONS[WEAPON_IDS[me.current] ?? 'rifle'].equip) : 1,
        lookYaw: lastTurn.yaw,
        lookPitch: lastTurn.pitch,
        dt,
      };
    } else {
      const head = world3d.characters.head(0) ?? { x: me.x, y: me.y + 0.3, z: me.z };
      const killer = match.actors[lastKiller];
      const target = killer !== undefined && killer.id !== 0 && killer.alive ? { x: killer.x, y: killer.y + 1.3, z: killer.z } : null;
      pose = deadView(rig, head, target, dt, profile.settings.fov);
      lastTurn = { yaw: 0, pitch: 0 };
    }
    world3d.draw({ match, viewer: 0, pose, alpha, dt, time: clock, gun });
    ui.setAiming(controls.aiming);

    hurtFlash = Math.max(0, hurtFlash - real * 2.2);
    radarTimer += real;
    if (live && radarTimer > 0.1) {
      radarTimer = 0;
      refreshRadar(match, me);
    }
    hudTimer += real;
    if (live && hudTimer > 0.08) {
      hudTimer = 0;
      if (countdown > 0) {
        const n = Math.ceil(countdown);
        if (n !== countdownShown) {
          countdownShown = n;
          sfx.count(false);
        }
      } else if (countdownShown !== 0) {
        countdownShown = 0;
        sfx.count(true);
        ui.toast('GO!', 'good');
      }
      refreshHud();
    }
  }

  // ---- leaving the game pauses it -----------------------------------------------------------------
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (phase === 'playing' || phase === 'paused') void keepAwake(true);
  });
  if (typeof window.matchMedia === 'function') {
    const portrait = window.matchMedia('(orientation: portrait) and (max-width: 820px)');
    portrait.addEventListener('change', (event) => {
      if (event.matches) pause();
    });
  }

  // ---- go ------------------------------------------------------------------------------------------
  applySettings();
  applyQuality(true);
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
    // A read-only snapshot for tests, with a few levers for setting up a scene. Not present in production builds.
    Object.defineProperty(window, '__game', {
      configurable: true,
      get: () => ({
        phase,
        score: match?.actors[0]?.kills ?? 0,
        alive: match?.actors[0]?.alive ?? false,
        debug: {
          match,
          demo,
          profile,
          hot,
          countdown,
          touch: controls.touch,
          locked: controls.locked,
          yaw: controls.yaw,
          pitch: controls.pitch,
          quality: quality.scale,
          start: (seed?: number) => startMatch(seed ?? profile.seed),
          /** Points the view somewhere. */
          look: (yaw: number, pitch: number) => controls.look(yaw, pitch),
          /** Turns to face an actor's chest. */
          faceActor: (id: number) => {
            const m = match;
            const a = m?.actors[id];
            const me = m?.actors[0];
            if (m === null || a === undefined || me === undefined) return;
            const dx = a.x - me.x;
            const dz = a.z - me.z;
            controls.look(Math.atan2(-dx, -dz), Math.atan2(a.y + 1.1 - (me.y + ACTOR.eye), Math.hypot(dx, dz)));
          },
          /** Puts the player somewhere. */
          teleport: (x: number, z: number) => {
            const me = match?.actors[0];
            if (match === null || me === undefined) return;
            me.x = me.px = x;
            me.z = me.pz = z;
            me.y = me.py = heightAt(match.arena, x, z);
            me.vx = me.vz = me.vy = 0;
          },
          /** Puts an actor somewhere, safe from harm for a moment. */
          put: (id: number, x: number, z: number) => {
            const a = match?.actors[id];
            if (match === null || a === undefined) return;
            a.x = a.px = x;
            a.z = a.pz = z;
            a.y = a.py = heightAt(match.arena, x, z);
            a.vx = a.vz = a.vy = 0;
          },
          give: (id: 'pistol' | 'rifle' | 'shotgun' | 'rail' | 'rocket') => {
            const me = match?.actors[0];
            if (me !== undefined) giveWeapon(me, id, 1);
          },
          /** Where an actor's chest is on the screen, in client pixels. */
          screenOf: (id: number) => {
            const a = match?.actors[id];
            if (a === undefined) return null;
            const p = world3d.project(a.x, a.y + 1.1, a.z);
            if (p === null) return null;
            const fit = view.fit();
            return { x: fit.offsetX + p.x * fit.scale, y: fit.offsetY + p.y * fit.scale };
          },
          kill: (id: number) => {
            const a = match?.actors[id];
            const killer = match?.actors[id === 0 ? 1 : 0];
            if (match !== null && a !== undefined && killer !== undefined) {
              a.protect = 0;
              damageActor(match, a, 1000, killer, 'rifle', false, killer.x, killer.z);
            }
          },
          /** Has this actor's body fallen into a ragdoll? */
          fallen: (id: number) => world3d.characters.head(id) !== null,
          fallenHead: (id: number) => world3d.characters.head(id),
          /** Nobody can hurt the player while this is on. */
          peace: (on: boolean) => {
            peace = on;
          },
          pause: () => pause(),
          resume: () => resume(),
          actorColor: (id: number) => actorColor(id, 0, false),
        },
      }),
    });
  }

  return { step: DT, update, render };
};
