/**
 * Everything on the screen that is not the 3D view: the HUD, the touch controls and the menus. It is fed plain values
 * and reports presses through callbacks; it never sees the match.
 */
import { createStage } from '../../engine/ui/stage';
import type { WorldSize } from '../../engine/core/config';
import { button, el, markSelected, section, setText } from './dom';
import { icon } from './icons';
import { createTouchpad, type TouchButton, type TouchHandlers, type Touchpad } from './touchpad';
import './styles.css';

export type Screen = 'menu' | 'pause' | 'result' | 'help' | 'settings' | 'none';
export type ModeChoice = 'ffa' | 'tdm';
export type LevelChoice = 'easy' | 'normal' | 'hard';
export type QualityChoice = 'auto' | 'low' | 'high';
export type ToggleKey = 'sound' | 'haptics' | 'fullscreen' | 'aimAssist' | 'autoFire' | 'leftHanded' | 'invertY';
export type SliderKey = 'sensitivity' | 'fov';
export type ToastTone = 'info' | 'warn' | 'danger' | 'good';

export interface UiCallbacks {
  onPlay(): void;
  onMode(mode: ModeChoice): void;
  onLevel(level: LevelChoice): void;
  onBots(count: number): void;
  onNewMap(): void;
  onHelp(): void;
  onSettings(): void;
  onBack(): void;
  onToggle(key: ToggleKey): void;
  onSlider(key: SliderKey, value: number): void;
  onQuality(quality: QualityChoice): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onAgain(): void;
  onMenu(): void;
  /** The scoreboard chip (a phone has no Tab key). */
  onBoard(): void;
  /** A weapon slot was tapped. */
  onSlot(slot: number): void;
  /** The ad button on the death banner. */
  onBoost(): void;
  touch: TouchHandlers;
}

export interface MenuInfo {
  mode: ModeChoice;
  level: LevelChoice;
  bots: number;
  botChoices: readonly number[];
  seed: number;
  played: number;
  wins: number;
  kills: number;
  best: number;
}

export interface SettingsInfo {
  sound: boolean;
  haptics: boolean;
  fullscreen: boolean;
  aimAssist: boolean;
  autoFire: boolean;
  leftHanded: boolean;
  invertY: boolean;
  sensitivity: number;
  fov: number;
  quality: QualityChoice;
}

export interface SlotInfo {
  owned: boolean;
  current: boolean;
  /** Rounds in the magazine (so an empty gun shows). */
  mag: number;
  icon: string;
}

export interface HudInfo {
  health: number;
  armor: number;
  weapon: string;
  mag: number;
  /** Spare rounds, or -1 for never running out. */
  reserve: number;
  /** 0..1 while reloading, else -1. */
  reload: number;
  slots: readonly SlotInfo[];
  /** The scores to show at the top: left, right, and what they are called. */
  left: { label: string; value: number; tone: 'you' | 'team0' | 'team1' | 'rival' };
  right: { label: string; value: number; tone: 'you' | 'team0' | 'team1' | 'rival' };
  clock: string;
  limit: string;
  /** Safe after spawning. */
  protect: boolean;
  /** How far the bullets could stray, in screen units from the centre. */
  gap: number;
  aiming: boolean;
  /** Is the crosshair on an enemy? */
  hot: boolean;
  /** The sniper's scope picture. */
  scope: boolean;
  alive: boolean;
}

export interface FeedEntry {
  killer: string;
  victim: string;
  weapon: string;
  head: boolean;
  /** Whether you are the one who killed, or who died. */
  you: 'killer' | 'victim' | 'none';
  /** The sides' colours (0 or 1 in a team match, else -1). */
  killerTeam: number;
  victimTeam: number;
}

export interface RadarDot {
  x: number;
  z: number;
  kind: 'ally' | 'enemy' | 'pickup';
}

export interface RadarInfo {
  x: number;
  z: number;
  yaw: number;
  dots: readonly RadarDot[];
}

export interface BoardRow {
  name: string;
  kills: number;
  deaths: number;
  /** Shown as text (e.g. "34%"). */
  accuracy: string;
  team: number;
  you: boolean;
  alive: boolean;
}

export interface ResultInfo {
  title: string;
  sub: string;
  rows: readonly BoardRow[];
  /** Short facts about your match. */
  facts: readonly { name: string; value: string }[];
  tone: 'win' | 'lose' | 'draw';
}

export interface BannerInfo {
  title: string;
  sub: string;
  /** Show the "watch an ad to come back stronger" button. */
  boost: string | null;
  tone: 'info' | 'danger' | 'good';
}

export interface Ui {
  /** Draws the arena as a small map once: heights (size x size), the width in cells. */
  setMap(heights: Float32Array, size: number): void;
  show(screen: Screen): void;
  showHud(visible: boolean): void;
  setMenu(info: MenuInfo): void;
  setSettings(info: SettingsInfo): void;
  setHud(info: HudInfo): void;
  setRadar(info: RadarInfo): void;
  pushFeed(entry: FeedEntry): void;
  toast(text: string, tone?: ToastTone): void;
  banner(info: BannerInfo | null): void;
  hitMarker(kind: 'hit' | 'head' | 'kill'): void;
  /** Something hurt you from this direction (radians, 0 ahead, positive to the left). */
  damageFrom(angle: number, amount: number): void;
  /** 0..1 red at the edges of the screen (low health). */
  setDanger(level: number): void;
  setBoard(rows: readonly BoardRow[], title: string): void;
  showBoard(visible: boolean): void;
  setResult(info: ResultInfo): void;
  setHint(text: string): void;
  /** A phone: shows the touch controls and the matching help text. */
  setTouch(touch: boolean): void;
  setAiming(on: boolean): void;
  setLeftHanded(on: boolean): void;
  /** Shows the touch controls only while playing. */
  setPlaying(playing: boolean): void;
  /** Lets go of every touch (a pause or a lost window). */
  release(): void;
  readonly touchpad: Touchpad;
}

const TONE_CLASS = { you: 'is-you', team0: 'is-team0', team1: 'is-team1', rival: 'is-rival' } as const;

export function createUi(root: HTMLElement, cb: UiCallbacks, world: WorldSize): Ui {
  const stage = createStage(root, world).element;
  stage.classList.add('az');

  // ---- the HUD --------------------------------------------------------------------------------
  const hud = el('div', 'hud');

  const vitals = el('div', 'vitals');
  const healthBar = el('div', 'bar bar-health');
  const healthFill = el('div', 'bar-fill');
  const healthIcon = el('span', 'bar-icon');
  healthIcon.innerHTML = icon('health', 'bar-svg');
  const healthText = el('span', 'bar-text', '100');
  healthBar.append(healthFill, healthIcon, healthText);
  const armorBar = el('div', 'bar bar-armor');
  const armorFill = el('div', 'bar-fill');
  const armorIcon = el('span', 'bar-icon');
  armorIcon.innerHTML = icon('armor', 'bar-svg');
  const armorText = el('span', 'bar-text', '0');
  armorBar.append(armorFill, armorIcon, armorText);
  vitals.append(healthBar, armorBar);

  const radarBox = el('div', 'radar');
  const radarCanvas = document.createElement('canvas');
  radarCanvas.width = 112;
  radarCanvas.height = 112;
  radarBox.append(radarCanvas);
  const radarContext = radarCanvas.getContext('2d');
  let radarMap: HTMLCanvasElement | null = null;

  const scorebar = el('div', 'scorebar');
  const scoreLeft = el('div', 'score score-left');
  const scoreLeftValue = el('span', 'score-value', '0');
  const scoreLeftLabel = el('span', 'score-label', '');
  scoreLeft.append(scoreLeftLabel, scoreLeftValue);
  const scoreRight = el('div', 'score score-right');
  const scoreRightValue = el('span', 'score-value', '0');
  const scoreRightLabel = el('span', 'score-label', '');
  scoreRight.append(scoreRightValue, scoreRightLabel);
  const clockBox = el('div', 'clockbox');
  const clock = el('span', 'clock', '5:00');
  const limit = el('span', 'limit', '');
  clockBox.append(clock, limit);
  scorebar.append(scoreLeft, clockBox, scoreRight);

  const feed = el('div', 'feed');

  const chips = el('div', 'chips');
  const boardChip = button('', 'board', 'chip');
  boardChip.classList.remove('btn');
  boardChip.innerHTML = icon('board', 'chip-icon');
  boardChip.setAttribute('aria-label', 'Scoreboard');
  const pauseChip = button('', 'pause', 'chip');
  pauseChip.classList.remove('btn');
  pauseChip.innerHTML = icon('pause', 'chip-icon');
  pauseChip.setAttribute('aria-label', 'Pause');
  chips.append(boardChip, pauseChip);

  const crosshair = el('div', 'crosshair');
  for (const side of ['n', 'e', 's', 'w']) crosshair.append(el('i', `ch ch-${side}`));
  crosshair.append(el('i', 'ch-dot'));
  const scope = el('div', 'scope');
  const hitmark = el('div', 'hitmark');
  for (let i = 0; i < 4; i++) hitmark.append(el('i', `hm hm-${i}`));
  const arcs = el('div', 'arcs');
  const vignette = el('div', 'vignette');
  const toasts = el('div', 'toasts');
  const hint = el('div', 'hint');
  hint.hidden = true;

  const bannerBox = el('div', 'banner');
  bannerBox.hidden = true;
  const bannerTitle = el('div', 'banner-title');
  const bannerSub = el('div', 'banner-sub');
  const boostButton = button('', 'boost', 'btn-primary banner-boost');
  boostButton.hidden = true;
  bannerBox.append(bannerTitle, bannerSub, boostButton);

  const weaponBar = el('div', 'weaponbar');
  const ammo = el('div', 'ammo');
  const ammoName = el('span', 'ammo-name', '');
  const ammoMag = el('span', 'ammo-mag', '0');
  const ammoReserve = el('span', 'ammo-reserve', '');
  const reloadBar = el('div', 'reloadbar');
  const reloadFill = el('div', 'reloadbar-fill');
  reloadBar.append(reloadFill);
  const ammoNumbers = el('span', 'ammo-numbers');
  ammoNumbers.append(ammoMag, ammoReserve);
  ammo.append(ammoName, ammoNumbers, reloadBar);
  const slotBar = el('div', 'slots');
  const slotButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < 5; i++) {
    const b = button('', 'slot', 'slot');
    b.classList.remove('btn');
    b.dataset['slot'] = String(i);
    b.replaceChildren(el('span', 'slot-key', String(i + 1)));
    const art = el('span', 'slot-art');
    b.append(art);
    slotButtons.push(b);
    slotBar.append(b);
  }
  weaponBar.append(ammo, slotBar);

  const boardBox = el('div', 'board');
  boardBox.hidden = true;
  const boardTitle = el('div', 'board-title', 'Scoreboard');
  const boardTable = el('div', 'board-table');
  boardBox.append(boardTitle, boardTable);

  hud.append(vitals, radarBox, scorebar, feed, chips, crosshair, scope, hitmark, arcs, vignette, toasts, hint, bannerBox, weaponBar, boardBox);

  // ---- the menu -------------------------------------------------------------------------------
  const menu = section('menu', 'Main menu');
  const menuPanel = el('div', 'panel panel-menu');
  const title = el('h1', 'title');
  title.append(el('span', 'title-a', 'ARENA'), document.createTextNode(' '), el('span', 'title-b', 'ZERO'));
  const blurb = el('p', 'blurb', 'Bots only, no waiting. Fast arena fights built for your thumbs.');
  const modeRow = el('div', 'choice');
  modeRow.append(el('span', 'row-label', 'Mode'));
  const modeSeg = el('div', 'seg');
  const modeButtons = (
    [
      ['tdm', 'Teams'],
      ['ffa', 'Free for all'],
    ] as const
  ).map(([value, label]) => {
    const b = button(label, 'mode', 'seg-btn');
    b.dataset['value'] = value;
    modeSeg.append(b);
    return b;
  });
  modeRow.append(modeSeg);
  const levelRow = el('div', 'choice');
  levelRow.append(el('span', 'row-label', 'Bots are'));
  const levelSeg = el('div', 'seg');
  const levelButtons = (['easy', 'normal', 'hard'] as const).map((value) => {
    const b = button(value[0]!.toUpperCase() + value.slice(1), 'level', 'seg-btn');
    b.dataset['value'] = value;
    levelSeg.append(b);
    return b;
  });
  levelRow.append(levelSeg);
  const botsRow = el('div', 'choice');
  botsRow.append(el('span', 'row-label', 'Players'));
  const botsSeg = el('div', 'seg');
  let botButtons: HTMLButtonElement[] = [];
  botsRow.append(botsSeg);
  const mapRow = el('div', 'choice');
  const mapLabel = el('span', 'row-label', 'Map 1');
  const mapButton = button('New map', 'new-map', 'btn-small');
  mapRow.append(mapLabel, mapButton);
  const choices = el('div', 'choices');
  choices.append(modeRow, levelRow, botsRow, mapRow);
  const career = el('p', 'career', '');
  const menuActions = el('div', 'actions');
  menuActions.append(button('Play', 'play', 'btn-primary btn-big'));
  const menuMore = el('div', 'actions-row');
  menuMore.append(button('How to play', 'help', 'btn-ghost'), button('Settings', 'settings', 'btn-ghost'));
  menuPanel.append(title, blurb, choices, menuActions, menuMore, career);
  menu.append(menuPanel);

  // ---- pause ----------------------------------------------------------------------------------
  const pause = section('pause', 'Paused');
  const pausePanel = el('div', 'panel panel-pause');
  pausePanel.append(
    el('h2', 'heading', 'Paused'),
    button('Resume', 'resume', 'btn-primary'),
    button('Restart match', 'restart', 'btn-ghost'),
    button('Settings', 'settings', 'btn-ghost'),
    button('How to play', 'help', 'btn-ghost'),
    button('Quit to menu', 'quit', 'btn-ghost'),
  );
  pause.append(pausePanel);

  // ---- settings -------------------------------------------------------------------------------
  const settings = section('settings', 'Settings');
  const settingsPanel = el('div', 'panel panel-settings');
  const settingsHead = el('div', 'panel-head');
  settingsHead.append(el('h2', 'heading', 'Settings'), button('Back', 'back', 'btn-primary btn-small'));
  settingsPanel.append(settingsHead);
  const settingsGrid = el('div', 'settings-grid');
  const toggles = new Map<ToggleKey, HTMLButtonElement>();
  const addToggle = (key: ToggleKey, label: string, note: string): void => {
    const b = button('', 'toggle', 'toggle');
    b.classList.remove('btn');
    b.dataset['key'] = key;
    b.append(el('span', 'toggle-label', label), el('span', 'toggle-note', note), el('span', 'toggle-state', 'On'));
    toggles.set(key, b);
    settingsGrid.append(b);
  };
  const sliders = new Map<SliderKey, { input: HTMLInputElement; value: HTMLElement }>();
  const addSlider = (key: SliderKey, label: string, min: number, max: number, step: number, format: (v: number) => string): void => {
    const row = el('label', 'slider');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.dataset['key'] = key;
    const value = el('span', 'slider-value', '');
    row.append(el('span', 'toggle-label', label), input, value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      setText(value, format(v));
      cb.onSlider(key, v);
    });
    sliders.set(key, { input, value });
    settingsGrid.append(row);
  };
  const formatters: Record<SliderKey, (v: number) => string> = { sensitivity: (v) => `${v.toFixed(2)}x`, fov: (v) => `${Math.round(v)}°` };
  addSlider('sensitivity', 'Look speed', 0.3, 2.5, 0.05, formatters.sensitivity);
  addSlider('fov', 'Field of view', 60, 100, 1, formatters.fov);
  addToggle('aimAssist', 'Aim assist', 'Slows and nudges toward enemies');
  addToggle('autoFire', 'Auto fire', 'Shoots while the crosshair is on an enemy');
  addToggle('leftHanded', 'Left handed', 'Swaps the thumbs');
  addToggle('invertY', 'Invert look', 'Up is down');
  addToggle('sound', 'Sound', '');
  addToggle('haptics', 'Vibration', '');
  addToggle('fullscreen', 'Fullscreen', 'On a phone, when a match starts');
  const qualityRow = el('div', 'row row-wide quality-row');
  qualityRow.append(el('span', 'row-label', 'Graphics'));
  const qualitySeg = el('div', 'seg');
  const qualityButtons = (
    [
      ['auto', 'Auto'],
      ['low', 'Fast'],
      ['high', 'Sharp'],
    ] as const
  ).map(([value, label]) => {
    const b = button(label, 'quality', 'seg-btn');
    b.dataset['value'] = value;
    qualitySeg.append(b);
    return b;
  });
  qualityRow.append(qualitySeg);
  settingsGrid.append(qualityRow);
  settingsPanel.append(settingsGrid);
  settings.append(settingsPanel);

  // ---- help -----------------------------------------------------------------------------------
  const help = section('help', 'How to play');
  const helpPanel = el('div', 'panel panel-help');
  const helpHead = el('div', 'panel-head');
  helpHead.append(el('h2', 'heading', 'How to play'), button('Back', 'back', 'btn-primary btn-small'));
  const helpBody = el('div', 'help-body');
  helpPanel.append(helpHead, helpBody);
  help.append(helpPanel);
  const helpTouch: [string, string][] = [
    ['Left thumb', 'Drag anywhere on the left to move. Push it all the way out to run.'],
    ['Right thumb', 'Drag anywhere on the right to look around.'],
    ['Fire', 'Hold the big button. Keep your thumb on it and slide to aim while you shoot.'],
    ['Aim', 'Raises the sights: slower, steadier, and a zoom.'],
    ['Jump · Reload · Swap', 'The small buttons. The weapon bar picks a gun directly.'],
    ['Aim assist', 'Near an enemy the view slows and drifts onto them. Turn it off in Settings, or turn on Auto fire.'],
    ['Pick-ups', 'Walk over them: health, armor, ammo and bigger guns. They come back after a while.'],
  ];
  const helpDesktop: [string, string][] = [
    ['W A S D', 'Move. Hold Shift to run.'],
    ['Mouse', 'Look. Left button fires, right button aims.'],
    ['Space', 'Jump.'],
    ['R', 'Reload.'],
    ['1 – 5 · wheel', 'Choose a weapon.'],
    ['Tab', 'Hold for the scoreboard.'],
    ['Esc · P', 'Pause. Click to take the mouse back.'],
  ];
  const fillHelp = (touch: boolean): void => {
    helpBody.replaceChildren();
    for (const [key, text] of touch ? helpTouch : helpDesktop) {
      const row = el('div', 'help-row');
      row.append(el('kbd', 'help-key', key), el('span', 'help-text', text));
      helpBody.append(row);
    }
  };
  fillHelp(false);

  // ---- result ---------------------------------------------------------------------------------
  const result = section('result', 'Result');
  const resultPanel = el('div', 'panel panel-result');
  const resultTitle = el('h2', 'heading result-title', 'Victory');
  const resultSub = el('p', 'result-sub', '');
  const resultBoard = el('div', 'board-table');
  const resultFacts = el('div', 'facts');
  const resultActions = el('div', 'actions-row');
  resultActions.append(button('Play again', 'again', 'btn-primary'), button('Main menu', 'menu', 'btn-ghost'));
  resultPanel.append(resultTitle, resultSub, resultBoard, resultFacts, resultActions);
  result.append(resultPanel);

  stage.append(hud, menu, pause, settings, help, result);

  // A phone held upright: ask for the other way (shown by CSS only in portrait on a narrow screen).
  const rotate = el('div', 'rotate');
  rotate.innerHTML = `${icon('rotate', 'rotate-icon')}`;
  rotate.append(el('p', 'rotate-text', 'Turn your phone sideways to play'));
  root.append(rotate);

  const touchpad = createTouchpad(root, stage, cb.touch);
  const screens: Record<Exclude<Screen, 'none'>, HTMLElement> = { menu, pause, settings, help, result };

  // ---- events ---------------------------------------------------------------------------------
  const press = (target: HTMLElement): void => {
    const b = target.closest<HTMLElement>('[data-action]');
    if (b === null || b.hasAttribute('disabled')) return;
    switch (b.dataset['action']) {
      case 'play':
        return cb.onPlay();
      case 'mode':
        return cb.onMode((b.dataset['value'] ?? 'tdm') as ModeChoice);
      case 'level':
        return cb.onLevel((b.dataset['value'] ?? 'normal') as LevelChoice);
      case 'bots':
        return cb.onBots(Number(b.dataset['value']));
      case 'quality':
        return cb.onQuality((b.dataset['value'] ?? 'auto') as QualityChoice);
      case 'new-map':
        return cb.onNewMap();
      case 'help':
        return cb.onHelp();
      case 'settings':
        return cb.onSettings();
      case 'back':
        return cb.onBack();
      case 'toggle':
        return cb.onToggle((b.dataset['key'] ?? 'sound') as ToggleKey);
      case 'pause':
        return cb.onPause();
      case 'resume':
        return cb.onResume();
      case 'restart':
        return cb.onRestart();
      case 'quit':
        return cb.onQuit();
      case 'again':
        return cb.onAgain();
      case 'menu':
        return cb.onMenu();
      case 'board':
        return cb.onBoard();
      case 'boost':
        return cb.onBoost();
      case 'slot':
        return cb.onSlot(Number(b.dataset['slot']));
      default:
    }
  };
  // `click` fires for touch, mouse and keyboard alike.
  stage.addEventListener('click', (event) => press(event.target as HTMLElement));

  // ---- helpers --------------------------------------------------------------------------------
  const percent = (fill: HTMLElement, value: number): void => {
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, value)).toFixed(3)})`;
  };

  const rowsHtml = (table: HTMLElement, rows: readonly BoardRow[]): void => {
    table.replaceChildren();
    const head = el('div', 'brow brow-head');
    head.append(el('span', 'b-name', 'Player'), el('span', 'b-num', 'Kills'), el('span', 'b-num', 'Deaths'), el('span', 'b-num', 'Acc'));
    table.append(head);
    for (const r of rows) {
      const row = el('div', `brow${r.you ? ' is-you' : ''}${r.alive ? '' : ' is-dead'} team-${r.team}`);
      row.append(el('span', 'b-name', r.name), el('span', 'b-num', String(r.kills)), el('span', 'b-num', String(r.deaths)), el('span', 'b-num', r.accuracy));
      table.append(row);
    }
  };

  const restartAnimation = (node: HTMLElement, name: string): void => {
    node.classList.remove(name);
    void node.offsetWidth;
    node.classList.add(name);
  };

  let hudSignature = '';
  const slotArt: HTMLElement[] = slotButtons.map((b) => b.querySelector<HTMLElement>('.slot-art')!);
  const slotIcons: string[] = [];

  return {
    touchpad,

    setMap(heights, size) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      if (g === null) return;
      const image = g.createImageData(size, size);
      for (let i = 0; i < size * size; i++) {
        const h = heights[i] ?? 0;
        const [r, gg, b] = h >= 2.5 ? [150, 168, 220] : h > 1.05 ? [80, 190, 175] : h > 0.2 ? [235, 150, 90] : [26, 36, 62];
        image.data[i * 4] = r;
        image.data[i * 4 + 1] = gg;
        image.data[i * 4 + 2] = b;
        image.data[i * 4 + 3] = 255;
      }
      g.putImageData(image, 0, 0);
      radarMap = c;
    },

    show(name) {
      for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
    },

    showHud(visible) {
      hud.hidden = !visible;
    },

    setMenu(info) {
      markSelected(modeButtons, info.mode);
      markSelected(levelButtons, info.level);
      if (botButtons.length !== info.botChoices.length) {
        botsSeg.replaceChildren();
        botButtons = info.botChoices.map((n) => {
          const b = button(String(n + 1), 'bots', 'seg-btn');
          b.dataset['value'] = String(n);
          botsSeg.append(b);
          return b;
        });
      }
      markSelected(botButtons, String(info.bots));
      setText(mapLabel, `Map ${info.seed}`);
      setText(career, info.played === 0 ? 'Your first match.' : `${info.played} matches · ${info.wins} won · ${info.kills} kills · best ${info.best}`);
    },

    setSettings(info) {
      const values: Record<ToggleKey, boolean> = {
        sound: info.sound,
        haptics: info.haptics,
        fullscreen: info.fullscreen,
        aimAssist: info.aimAssist,
        autoFire: info.autoFire,
        leftHanded: info.leftHanded,
        invertY: info.invertY,
      };
      for (const [key, b] of toggles) {
        const on = values[key];
        b.classList.toggle('is-on', on);
        setText(b.querySelector<HTMLElement>('.toggle-state')!, on ? 'On' : 'Off');
        b.setAttribute('aria-pressed', String(on));
      }
      for (const [key, s] of sliders) {
        const v = key === 'sensitivity' ? info.sensitivity : info.fov;
        if (s.input.value !== String(v)) s.input.value = String(v);
        setText(s.value, formatters[key](v));
      }
      markSelected(qualityButtons, info.quality);
    },

    setHud(info) {
      setText(healthText, String(Math.max(0, Math.ceil(info.health))));
      percent(healthFill, info.health / 100);
      healthBar.classList.toggle('is-low', info.health <= 30);
      setText(armorText, String(Math.ceil(info.armor)));
      percent(armorFill, info.armor / 100);
      armorBar.classList.toggle('is-empty', info.armor <= 0);

      const signature = `${info.weapon}|${info.mag}|${info.reserve}`;
      if (signature !== hudSignature) {
        hudSignature = signature;
        setText(ammoName, info.weapon);
        setText(ammoMag, String(info.mag));
        setText(ammoReserve, info.reserve < 0 ? '/ ∞' : `/ ${info.reserve}`);
        ammo.classList.toggle('is-empty', info.mag <= 0);
      }
      reloadBar.classList.toggle('is-on', info.reload >= 0);
      if (info.reload >= 0) percent(reloadFill, info.reload);

      info.slots.forEach((slot, i) => {
        const b = slotButtons[i];
        const art = slotArt[i];
        if (b === undefined || art === undefined) return;
        b.classList.toggle('is-owned', slot.owned);
        b.classList.toggle('is-current', slot.current);
        b.classList.toggle('is-empty', slot.owned && slot.mag <= 0);
        b.disabled = !slot.owned;
        if (slotIcons[i] !== slot.icon) {
          slotIcons[i] = slot.icon;
          art.innerHTML = icon(slot.icon, 'slot-svg');
        }
      });

      setText(scoreLeftLabel, info.left.label);
      setText(scoreLeftValue, String(info.left.value));
      setText(scoreRightLabel, info.right.label);
      setText(scoreRightValue, String(info.right.value));
      scoreLeft.className = `score score-left ${TONE_CLASS[info.left.tone]}`;
      scoreRight.className = `score score-right ${TONE_CLASS[info.right.tone]}`;
      setText(clock, info.clock);
      setText(limit, info.limit);

      crosshair.style.setProperty('--gap', `${info.gap.toFixed(1)}`);
      crosshair.classList.toggle('is-hot', info.hot);
      crosshair.classList.toggle('is-aim', info.aiming);
      crosshair.classList.toggle('is-protected', info.protect);
      hud.classList.toggle('is-dead', !info.alive);
      scope.classList.toggle('is-on', info.scope);
    },

    setRadar(info) {
      const g = radarContext;
      if (g === null) return;
      const size = radarCanvas.width;
      const centre = size / 2;
      const scale = size / 46; // pixels per metre: about 23 metres each way
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath();
      g.arc(centre, centre, centre - 1, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = 'rgba(6, 10, 22, 0.9)';
      g.fillRect(0, 0, size, size);
      g.translate(centre, centre);
      g.rotate(info.yaw);
      g.scale(scale, scale);
      g.translate(-info.x, -info.z);
      if (radarMap !== null) {
        g.imageSmoothingEnabled = false;
        g.globalAlpha = 0.85;
        g.drawImage(radarMap, 0, 0);
        g.globalAlpha = 1;
      }
      for (const dot of info.dots) {
        g.fillStyle = dot.kind === 'enemy' ? '#ff5050' : dot.kind === 'ally' ? '#58a8ff' : '#f2e46a';
        g.beginPath();
        g.arc(dot.x, dot.z, dot.kind === 'pickup' ? 0.7 : 1.5, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      // You: a small arrow in the middle, always pointing up.
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(centre, centre - 6);
      g.lineTo(centre + 4.5, centre + 4.5);
      g.lineTo(centre, centre + 2);
      g.lineTo(centre - 4.5, centre + 4.5);
      g.closePath();
      g.fill();
    },

    pushFeed(entry) {
      const row = el('div', `feed-row${entry.you === 'killer' ? ' is-mine' : entry.you === 'victim' ? ' is-theirs' : ''}`);
      const killer = el('span', `feed-name team-${entry.killerTeam}`, entry.killer);
      const weapon = el('span', 'feed-weapon');
      weapon.innerHTML = icon(entry.weapon, 'feed-icon') + (entry.head ? '<span class="feed-head">HEAD</span>' : '');
      const victim = el('span', `feed-name team-${entry.victimTeam}`, entry.victim);
      row.append(killer, weapon, victim);
      feed.prepend(row);
      while (feed.children.length > 4) feed.lastElementChild?.remove();
      window.setTimeout(() => row.remove(), 6000);
    },

    toast(text, tone = 'info') {
      const t = el('div', `toast tone-${tone}`, text);
      toasts.append(t);
      while (toasts.children.length > 3) toasts.firstElementChild?.remove();
      window.setTimeout(() => t.remove(), 2300);
    },

    banner(info) {
      if (info === null) {
        bannerBox.hidden = true;
        return;
      }
      bannerBox.hidden = false;
      bannerBox.dataset['tone'] = info.tone;
      setText(bannerTitle, info.title);
      setText(bannerSub, info.sub);
      boostButton.hidden = info.boost === null;
      if (info.boost !== null) setText(boostButton.querySelector<HTMLElement>('.btn-label')!, info.boost);
    },

    hitMarker(kind) {
      hitmark.dataset['kind'] = kind;
      restartAnimation(hitmark, 'is-on');
    },

    damageFrom(angle, amount) {
      const arc = el('div', 'arc');
      arc.style.transform = `rotate(${(-angle * 180) / Math.PI}deg)`;
      arc.style.opacity = String(Math.min(1, 0.45 + amount / 60));
      arcs.append(arc);
      while (arcs.children.length > 5) arcs.firstElementChild?.remove();
      window.setTimeout(() => arc.remove(), 1100);
    },

    setDanger(level) {
      vignette.style.opacity = String(Math.max(0, Math.min(1, level)).toFixed(2));
    },

    setBoard(rows, heading) {
      setText(boardTitle, heading);
      rowsHtml(boardTable, rows);
    },

    showBoard(visible) {
      boardBox.hidden = !visible;
    },

    setResult(info) {
      resultPanel.dataset['tone'] = info.tone;
      setText(resultTitle, info.title);
      setText(resultSub, info.sub);
      rowsHtml(resultBoard, info.rows);
      resultFacts.replaceChildren();
      for (const fact of info.facts) {
        const row = el('div', 'fact');
        row.append(el('span', 'fact-name', fact.name), el('span', 'fact-value', fact.value));
        resultFacts.append(row);
      }
    },

    setHint(text) {
      hint.hidden = text === '';
      setText(hint, text);
    },

    setTouch(touch) {
      root.classList.toggle('touch', touch);
      stage.classList.toggle('touch', touch);
      fillHelp(touch);
    },

    setAiming(on) {
      touchpad.setAiming(on);
    },

    setLeftHanded(on) {
      touchpad.setLeftHanded(on);
    },

    setPlaying(playing) {
      touchpad.setActive(playing);
    },

    release() {
      touchpad.release();
    },
  };
}

export type { TouchButton, TouchHandlers };
