import { createStage } from '../../engine/ui/stage';
import { button, el, markSelected, section, setText } from './dom';
import { icon } from './icons';
import './styles.css';

export type Screen = 'menu' | 'pause' | 'result' | 'help' | 'settings' | 'none';
export type SettingKey = 'sound' | 'haptics' | 'edgeScroll' | 'bars';
export type Level = 'easy' | 'normal' | 'hard';
export type ToastTone = 'info' | 'warn' | 'danger' | 'good';

export interface UiCallbacks {
  onPlay(): void;
  onLevel(level: Level): void;
  onNewMap(): void;
  onHelp(): void;
  onSettings(): void;
  onBack(): void;
  onToggle(key: SettingKey): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onSupplyDrop(): void;
  onSpeed(): void;
  onAgain(): void;
  onMenu(): void;
  /** A command-card button was pressed. */
  onCard(id: string): void;
  /** A unit icon in the selection panel was pressed. */
  onPick(id: number): void;
  onCancelQueue(index: number): void;
  /** The x on the selection panel: let go of everything selected. */
  onDeselect(): void;
  onIdleWorker(): void;
  onArmy(): void;
}

export interface MenuInfo {
  level: Level;
  seed: number;
  wins: number;
  played: number;
}

export interface HudInfo {
  minerals: number;
  gas: number;
  supplyUsed: number;
  supplyCap: number;
  clock: string;
  idleWorkers: number;
  army: number;
  speed: number;
  /** The pause menu's supply-drop button: 'ready', 'used' or 'none' (no ad available). */
  drop: 'ready' | 'used' | 'none';
}

export interface SelectedItem {
  id: number;
  icon: string;
  name: string;
  /** 0..1 */
  frac: number;
}

export interface QueueSlot {
  icon: string;
  /** 0..1 for the first (training) slot, else 0. */
  progress: number;
}

export interface SelectionInfo {
  title: string;
  /** A short description or the stats line. */
  lines: string[];
  icon: string;
  /** 0..1, or -1 for none. */
  hp: number;
  hpText: string;
  /** 0..1 while being built, or -1. */
  building: number;
  /** One tinted team colour (0 or 1), or -1 for neutral. */
  team: number;
  /** Several selected: a grid of icons. */
  items: SelectedItem[];
  queue: QueueSlot[];
}

export interface CardButton {
  id: string;
  label: string;
  hotkey: string;
  icon: string;
  cost: string;
  enabled: boolean;
  active: boolean;
  /** Shown as a tooltip. */
  hint: string;
}

export interface ResultInfo {
  won: boolean;
  time: string;
  killed: number;
  lost: number;
  built: number;
  mined: number;
  level: Level;
}

export interface Ui {
  /** Which overlay screen is up ('none' for just the game). */
  show(screen: Screen): void;
  /** The in-game HUD (resources, minimap, selection, commands). */
  showHud(visible: boolean): void;
  /** The canvas the minimap is drawn into. */
  readonly minimap: HTMLCanvasElement;
  setMenu(info: MenuInfo): void;
  setHud(info: HudInfo): void;
  setSelection(info: SelectionInfo | null): void;
  setCard(buttons: readonly CardButton[]): void;
  setResult(info: ResultInfo): void;
  setSettings(settings: Record<SettingKey, boolean>): void;
  toast(text: string, tone?: ToastTone): void;
  /** Flashes the screen edge red (the base is under attack). */
  flashAlert(): void;
  /** Shows or hides the first-game hint line. */
  setHint(text: string): void;
}

const LEVELS: readonly { value: Level; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
];

const SETTINGS: readonly { key: SettingKey; label: string }[] = [
  { key: 'sound', label: 'Sound' },
  { key: 'haptics', label: 'Vibration' },
  { key: 'edgeScroll', label: 'Edge scrolling' },
  { key: 'bars', label: 'Always show health bars' },
];

const HELP: readonly { title: string; rows: readonly [string, string][] }[] = [
  {
    title: 'Mouse and keyboard',
    rows: [
      ['Left click / drag', 'Select · drag a box around units'],
      ['Right click (or Ctrl + click)', 'Move, attack, mine or set a rally point'],
      ['A then click', 'Attack-move: fight whatever you meet'],
      ['S · H', 'Stop · hold position'],
      ['B, then D / B / R / F / A / T', 'Workers: build a depot, barracks, refinery, factory, airfield, turret'],
      ['Q W E', 'Train from the selected building'],
      ['Ctrl + 1..9 · 1..9', 'Set and recall a group of units'],
      ['WASD / arrows · wheel · middle drag', 'Move and zoom the camera'],
      ['Space · . · , · Esc', 'Jump to the last alert · idle worker · army · cancel'],
    ],
  },
  {
    title: 'Touch',
    rows: [
      ['Tap', 'Select a unit or building'],
      ['Tap the ground', 'Move your selection there (or attack, or mine)'],
      ['Drag the ground', 'Pan the camera'],
      ['Press and hold, then drag', 'Draw a selection box'],
      ['Two fingers', 'Pinch to zoom and pan'],
      ['Double tap a unit', 'Select all of that kind on screen'],
      ['Minimap', 'Tap or drag to move the camera; press and hold to send your units there'],
      ['x on the selection panel', 'Let go of your selection (a tap on the ground would send the units there)'],
      ['Move, Attack, Rally buttons', 'Press one, then tap the ground, instead of tapping straight away'],
    ],
  },
  {
    title: 'How to win',
    rows: [
      ['1', 'Mine minerals with workers, and build depots before you run out of supply.'],
      ['2', 'Build a refinery on a geyser for gas: tanks and skiffs need it.'],
      ['3', 'Barracks, then a factory, then an airfield. Turrets guard your base.'],
      ['4', 'Destroy every enemy building. Mind the fog: scout to see what they have.'],
    ],
  },
];

export function createUi(root: HTMLElement, cb: UiCallbacks, world: { width: number; height: number }): Ui {
  const stage = createStage(root, world).element;
  stage.classList.add('nova');

  // ---- HUD ------------------------------------------------------------------------------
  const hud = el('div', 'hud');
  hud.hidden = true;

  const top = el('div', 'topbar');
  const resource = (name: string, glyph: string, cls: string): { box: HTMLElement; value: HTMLElement } => {
    const box = el('div', `res ${cls}`);
    box.innerHTML = icon(glyph, 'res-icon');
    box.title = name;
    const value = el('span', 'res-value', '0');
    box.append(value);
    return { box, value };
  };
  const minerals = resource('Minerals', 'minerals', 'res-minerals');
  const gas = resource('Gas', 'gas', 'res-gas');
  const supply = resource('Supply', 'supply', 'res-supply');
  const left = el('div', 'topbar-left');
  left.append(minerals.box, gas.box, supply.box);

  const clock = el('div', 'clock', '0:00');
  const barButton = (action: string, glyph: string, label: string): HTMLButtonElement => {
    const b = el('button', 'chip');
    b.type = 'button';
    b.dataset['action'] = action;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon(glyph, 'chip-icon');
    const badge = el('span', 'chip-badge');
    b.append(badge);
    return b;
  };
  const idleButton = barButton('idle', 'worker', 'Idle workers (.)');
  const armyButton = barButton('army', 'army', 'Select army (,)');
  const speedButton = barButton('speed', 'fast', 'Game speed');
  const pauseButton = barButton('pause', 'pause', 'Pause (Esc)');
  const right = el('div', 'topbar-right');
  right.append(clock, idleButton, armyButton, speedButton, pauseButton);
  top.append(left, right);

  const toasts = el('div', 'toasts');
  const alertEdge = el('div', 'alert-edge');
  const hint = el('div', 'hint');
  hint.hidden = true;

  // The bottom panel: minimap, selection, command card.
  const bottom = el('div', 'bottom');
  const mapBox = el('div', 'mapbox');
  const minimap = el('canvas', 'minimap');
  minimap.dataset['role'] = 'minimap';
  mapBox.append(minimap);

  const selection = el('div', 'selection');
  const selectionBody = el('div', 'selection-body');
  // Touch has no Escape: this is how you let go of a selection (a tap on the ground sends the units there).
  const deselect = el('button', 'sel-close');
  deselect.type = 'button';
  deselect.dataset['action'] = 'deselect';
  deselect.title = 'Deselect';
  deselect.setAttribute('aria-label', 'Deselect');
  deselect.innerHTML = icon('cancel', 'sel-close-icon');
  selection.append(selectionBody, deselect);

  const card = el('div', 'card');
  bottom.append(mapBox, selection, card);
  hud.append(top, toasts, alertEdge, hint, bottom);

  // ---- menu -----------------------------------------------------------------------------
  const menu = section('menu', 'Main menu');
  const logo = el('div', 'logo');
  logo.setAttribute('aria-hidden', 'true');
  logo.innerHTML = '<i class="hex hex-a"></i><i class="hex hex-b"></i><i class="core"></i>';
  const levelButtons: HTMLButtonElement[] = LEVELS.map((l) => {
    const b = button(l.label, 'level', 'seg');
    b.dataset['value'] = l.value;
    return b;
  });
  const levelRow = el('div', 'segs');
  levelRow.append(...levelButtons);
  const mapLabel = el('span', 'map-label', 'Map 1');
  const newMap = button('New map', 'new-map', 'btn-ghost btn-small');
  const mapRow = el('div', 'maprow');
  mapRow.append(mapLabel, newMap);
  const record = el('p', 'record', '');
  const playButton = button('Battle', 'play', 'btn-primary btn-big');
  const menuPanel = el('div', 'panel panel-menu');
  menuPanel.append(
    logo,
    el('h1', 'title', 'Nova Frontier'),
    el('p', 'tagline', 'Mine. Build. Command. Conquer the frontier.'),
    el('div', 'field-label', 'Opponent'),
    levelRow,
    mapRow,
    playButton,
    record,
  );
  const menuLinks = el('div', 'menu-links');
  menuLinks.append(button('How to play', 'help', 'btn-ghost btn-small'), button('Settings', 'settings', 'btn-ghost btn-small'));
  menu.append(menuPanel, menuLinks);

  // ---- pause ----------------------------------------------------------------------------
  const pause = section('pause', 'Paused');
  const dropButton = button('Supply drop', 'drop', 'btn-accent');
  dropButton.append(el('span', 'btn-sub', 'Watch a short ad: +400 minerals, +200 gas'));
  const pausePanel = el('div', 'panel');
  pausePanel.append(
    el('h2', 'heading', 'Paused'),
    button('Resume', 'resume', 'btn-primary'),
    dropButton,
    button('Restart', 'restart', 'btn-ghost'),
    button('Settings', 'settings', 'btn-ghost'),
    button('How to play', 'help', 'btn-ghost'),
    button('Quit to menu', 'quit', 'btn-ghost btn-danger'),
  );
  pause.append(pausePanel);

  // ---- settings -------------------------------------------------------------------------
  const settings = section('settings', 'Settings');
  const settingsPanel = el('div', 'panel');
  const toggles = new Map<SettingKey, HTMLButtonElement>();
  settingsPanel.append(el('h2', 'heading', 'Settings'));
  for (const s of SETTINGS) {
    const b = button(s.label, 'toggle', 'toggle');
    b.dataset['key'] = s.key;
    b.append(el('span', 'toggle-state', 'On'));
    toggles.set(s.key, b);
    settingsPanel.append(b);
  }
  settingsPanel.append(button('Back', 'back', 'btn-ghost'));
  settings.append(settingsPanel);

  // ---- help -----------------------------------------------------------------------------
  const help = section('help', 'How to play');
  const helpPanel = el('div', 'panel panel-wide');
  helpPanel.append(el('h2', 'heading', 'How to play'));
  const helpColumns = el('div', 'help-cols');
  for (const group of HELP) {
    const col = el('div', 'help-col');
    col.append(el('h3', 'help-title', group.title));
    for (const [key, text] of group.rows) {
      const row = el('div', 'help-row');
      row.append(el('kbd', 'help-key', key), el('span', 'help-text', text));
      col.append(row);
    }
    helpColumns.append(col);
  }
  helpPanel.append(helpColumns, button('Back', 'back', 'btn-ghost'));
  help.append(helpPanel);

  // ---- result ---------------------------------------------------------------------------
  const result = section('result', 'Result');
  const resultTitle = el('h2', 'heading result-title', 'Victory');
  const resultSub = el('p', 'result-sub', '');
  const resultStats = el('div', 'stats');
  const resultPanel = el('div', 'panel');
  resultPanel.append(resultTitle, resultSub, resultStats, button('Play again', 'again', 'btn-primary'), button('Main menu', 'menu', 'btn-ghost'));
  result.append(resultPanel);

  stage.append(hud, menu, pause, settings, help, result);

  // A phone held upright: ask for the other way (shown by CSS only in portrait on a narrow screen).
  const rotate = el('div', 'rotate');
  rotate.innerHTML = '<svg class="rotate-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M19 8a7 7 0 010 8M20.500 14.500L19 16.500l-2-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  rotate.append(el('p', 'rotate-text', 'Turn your phone sideways to play'));
  root.append(rotate);
  const screens: Record<Exclude<Screen, 'none'>, HTMLElement> = { menu, pause, settings, help, result };

  // ---- events ---------------------------------------------------------------------------
  const press = (target: HTMLElement): void => {
    const b = target.closest<HTMLElement>('[data-action]');
    if (b === null || b.hasAttribute('disabled')) return;
    switch (b.dataset['action']) {
      case 'play': return cb.onPlay();
      case 'level': return cb.onLevel((b.dataset['value'] ?? 'normal') as Level);
      case 'new-map': return cb.onNewMap();
      case 'help': return cb.onHelp();
      case 'settings': return cb.onSettings();
      case 'back': return cb.onBack();
      case 'toggle': return cb.onToggle((b.dataset['key'] ?? 'sound') as SettingKey);
      case 'pause': return cb.onPause();
      case 'resume': return cb.onResume();
      case 'restart': return cb.onRestart();
      case 'quit': return cb.onQuit();
      case 'drop': return cb.onSupplyDrop();
      case 'speed': return cb.onSpeed();
      case 'again': return cb.onAgain();
      case 'menu': return cb.onMenu();
      case 'idle': return cb.onIdleWorker();
      case 'army': return cb.onArmy();
      case 'card': return cb.onCard(b.dataset['id'] ?? '');
      case 'pick': return cb.onPick(Number(b.dataset['id']));
      case 'cancel-queue': return cb.onCancelQueue(Number(b.dataset['index']));
      case 'deselect': return cb.onDeselect();
      default:
    }
  };
  // `click` fires for touch, mouse and keyboard alike.
  stage.addEventListener('click', (event) => press(event.target as HTMLElement));

  // ---- updates --------------------------------------------------------------------------
  let cardSignature = '';
  let selectionSignature = '';
  let selectionRefs: { hp: HTMLElement | null; hpText: HTMLElement | null; building: HTMLElement | null; items: Map<number, HTMLElement>; queue: HTMLElement[] } | null = null;

  const setBadge = (b: HTMLElement, count: number): void => {
    const badge = b.querySelector<HTMLElement>('.chip-badge');
    if (badge !== null) setText(badge, count > 0 ? String(count) : '');
    b.classList.toggle('is-lit', count > 0);
  };

  return {
    minimap,

    show(name) {
      for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
    },

    showHud(visible) {
      hud.hidden = !visible;
    },

    setMenu(info) {
      markSelected(levelButtons, info.level);
      setText(mapLabel, `Map ${info.seed}`);
      setText(record, info.played > 0 ? `${info.wins} win${info.wins === 1 ? '' : 's'} in ${info.played} game${info.played === 1 ? '' : 's'}` : 'Your first battle awaits');
    },

    setHud(info) {
      setText(minerals.value, String(Math.floor(info.minerals)));
      setText(gas.value, String(Math.floor(info.gas)));
      setText(supply.value, `${info.supplyUsed}/${info.supplyCap}`);
      supply.box.classList.toggle('is-full', info.supplyUsed >= info.supplyCap);
      setText(clock, info.clock);
      setBadge(idleButton, info.idleWorkers);
      setBadge(armyButton, info.army);
      speedButton.classList.toggle('is-lit', info.speed > 1);
      const speedBadge = speedButton.querySelector<HTMLElement>('.chip-badge');
      if (speedBadge !== null) setText(speedBadge, info.speed > 1 ? `${info.speed}x` : '');
      dropButton.disabled = info.drop !== 'ready';
      const sub = dropButton.querySelector<HTMLElement>('.btn-sub');
      if (sub !== null) setText(sub, info.drop === 'used' ? 'Already used this battle' : info.drop === 'none' ? 'No ad available right now' : 'Watch a short ad: +400 minerals, +200 gas');
    },

    setSelection(info) {
      if (info === null) {
        if (selectionSignature !== '') {
          selectionBody.replaceChildren();
          selectionSignature = '';
          selectionRefs = null;
        }
        selection.classList.add('is-empty');
        deselect.hidden = true;
        return;
      }
      selection.classList.remove('is-empty');
      deselect.hidden = false;
      const signature = [info.title, info.icon, info.team, info.items.map((i) => i.id).join(','), info.queue.map((q) => q.icon).join(','), info.lines.join('|'), info.hp >= 0, info.building >= 0].join('#');
      if (signature !== selectionSignature) {
        selectionSignature = signature;
        selectionBody.replaceChildren();
        const refs = { hp: null as HTMLElement | null, hpText: null as HTMLElement | null, building: null as HTMLElement | null, items: new Map<number, HTMLElement>(), queue: [] as HTMLElement[] };
        selectionRefs = refs;
        if (info.items.length > 1) {
          selectionBody.append(el('div', 'sel-count', info.title));
          const grid = el('div', 'sel-grid');
          for (const item of info.items.slice(0, 24)) {
            const b = el('button', 'sel-item');
            b.type = 'button';
            b.dataset['action'] = 'pick';
            b.dataset['id'] = String(item.id);
            b.title = item.name;
            b.innerHTML = icon(item.icon, 'sel-icon');
            const bar = el('i', 'sel-hp');
            b.append(bar);
            refs.items.set(item.id, bar);
            grid.append(b);
          }
          if (info.items.length > 24) grid.append(el('span', 'sel-more', `+${info.items.length - 24}`));
          selectionBody.append(grid);
        } else {
          const head = el('div', 'sel-head');
          const portrait = el('div', `portrait team-${info.team}`);
          portrait.innerHTML = icon(info.icon, 'portrait-icon');
          const text = el('div', 'sel-text');
          text.append(el('div', 'sel-title', info.title));
          for (const line of info.lines) text.append(el('div', 'sel-line', line));
          head.append(portrait, text);
          selectionBody.append(head);
          if (info.hp >= 0) {
            const bar = el('div', 'hpbar');
            const fill = el('i', 'hpbar-fill');
            const label = el('span', 'hpbar-text');
            bar.append(fill, label);
            refs.hp = fill;
            refs.hpText = label;
            selectionBody.append(bar);
          }
          if (info.building >= 0) {
            const bar = el('div', 'buildbar');
            const fill = el('i', 'buildbar-fill');
            bar.append(el('span', 'buildbar-text', 'Under construction'), fill);
            refs.building = fill;
            selectionBody.append(bar);
          }
          if (info.queue.length > 0) {
            const row = el('div', 'queue');
            info.queue.forEach((slot, index) => {
              const b = el('button', 'queue-slot');
              b.type = 'button';
              b.dataset['action'] = 'cancel-queue';
              b.dataset['index'] = String(index);
              b.title = 'Cancel';
              b.innerHTML = icon(slot.icon, 'queue-icon');
              const bar = el('i', 'queue-progress');
              b.append(bar);
              refs.queue.push(bar);
              row.append(b);
            });
            selectionBody.append(row);
          }
        }
      }
      const refs = selectionRefs;
      if (refs === null) return;
      if (refs.hp !== null) {
        refs.hp.style.width = `${Math.max(0, Math.min(1, info.hp)) * 100}%`;
        refs.hp.dataset['level'] = info.hp > 0.6 ? 'good' : info.hp > 0.3 ? 'mid' : 'low';
      }
      if (refs.hpText !== null) setText(refs.hpText, info.hpText);
      if (refs.building !== null) refs.building.style.width = `${Math.max(0, Math.min(1, info.building)) * 100}%`;
      for (const item of info.items) {
        const bar = refs.items.get(item.id);
        if (bar !== undefined) {
          bar.style.width = `${Math.max(0, Math.min(1, item.frac)) * 100}%`;
          bar.dataset['level'] = item.frac > 0.6 ? 'good' : item.frac > 0.3 ? 'mid' : 'low';
        }
      }
      info.queue.forEach((slot, i) => {
        const bar = refs.queue[i];
        if (bar !== undefined) bar.style.width = `${Math.max(0, Math.min(1, slot.progress)) * 100}%`;
      });
    },

    setCard(buttons) {
      const signature = buttons.map((b) => `${b.id}:${b.label}:${b.enabled}:${b.active}:${b.cost}`).join('|');
      if (signature === cardSignature) return;
      cardSignature = signature;
      card.replaceChildren();
      for (const b of buttons) {
        if (b.id === '') {
          card.append(el('div', 'cmd-empty'));
          continue;
        }
        const node = el('button', `cmd${b.enabled ? '' : ' is-disabled'}${b.active ? ' is-active' : ''}`);
        node.type = 'button';
        node.dataset['action'] = 'card';
        node.dataset['id'] = b.id;
        node.title = `${b.label}${b.hotkey ? ` (${b.hotkey})` : ''}${b.hint ? `: ${b.hint}` : ''}`;
        node.setAttribute('aria-label', b.label);
        node.innerHTML = icon(b.icon, 'cmd-icon');
        if (b.hotkey) node.append(el('span', 'cmd-key', b.hotkey));
        node.append(el('span', 'cmd-label', b.label));
        if (b.cost) node.append(el('span', 'cmd-cost', b.cost));
        card.append(node);
      }
    },

    setResult(info) {
      setText(resultTitle, info.won ? 'Victory' : 'Defeat');
      resultTitle.dataset['won'] = String(info.won);
      setText(resultSub, info.won ? 'The frontier is yours.' : 'Your colony has fallen.');
      resultStats.replaceChildren();
      const rows: [string, string][] = [
        ['Time', info.time],
        ['Enemies destroyed', String(info.killed)],
        ['Units lost', String(info.lost)],
        ['Buildings raised', String(info.built)],
        ['Minerals mined', String(info.mined)],
      ];
      for (const [name, value] of rows) {
        const row = el('div', 'stat');
        row.append(el('span', 'stat-name', name), el('span', 'stat-value', value));
        resultStats.append(row);
      }
    },

    setSettings(values) {
      for (const [key, b] of toggles) {
        const on = values[key];
        b.classList.toggle('is-on', on);
        const state = b.querySelector<HTMLElement>('.toggle-state');
        if (state !== null) setText(state, on ? 'On' : 'Off');
      }
    },

    toast(text, tone = 'info') {
      const t = el('div', `toast toast-${tone}`, text);
      toasts.append(t);
      while (toasts.children.length > 3) toasts.firstElementChild?.remove();
      window.setTimeout(() => t.classList.add('is-leaving'), 2400);
      window.setTimeout(() => t.remove(), 2900);
    },

    flashAlert() {
      alertEdge.classList.remove('is-on');
      void alertEdge.offsetWidth;
      alertEdge.classList.add('is-on');
    },

    setHint(text) {
      hint.hidden = text === '';
      setText(hint, text);
    },
  };
}
