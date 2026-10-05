import { createStage } from '../../engine/ui/stage';
import { button, el, section, setLabel, setText, starRow } from './dom';
import './styles.css';

export type Screen = 'menu' | 'hud' | 'paused' | 'result' | 'lost' | 'settings' | 'ad' | 'demo' | 'viewer' | 'none';
export type SettingKey = 'sound' | 'haptics';
export type BannerTone = 'loop' | 'rewind' | 'ouch' | 'win';

export interface UiCallbacks {
  onDaily(): void;
  onRandom(): void;
  onDemo(): void;
  onOpenSettings(): void;
  onBack(): void;
  onToggle(key: SettingKey): void;
  onPause(): void;
  onResume(): void;
  onQuit(): void;
  onShare(): void;
  onWatch(): void;
  onAnother(): void;
  onMenu(): void;
  onEndLoop(): void;
  onExtraLoops(): void;
  onGiveUp(): void;
  onDemoSpeed(): void;
  onDemoStop(): void;
  onPlayArena(): void;
}

export interface MenuInfo {
  dailySeed: number;
  dailyBest: { loops: number; stars: number } | null;
  totalStars: number;
  cleared: number;
}

export interface HudInfo {
  loop: number;
  maxLoops: number;
  orbs: number;
  orbsTotal: number;
  ghosts: number;
  /** 0..1 of the loop that has passed. */
  progress: number;
  secondsLeft: number;
  /** Show the how-to-play hint. */
  hint: boolean;
  /** "Rewind now" can be pressed. */
  canEnd: boolean;
}

export interface ResultInfo {
  seed: number;
  loops: number;
  par: number;
  stars: number;
  isBest: boolean;
  deaths: number;
  daily: boolean;
}

export interface LostInfo {
  seed: number;
  collected: number;
  total: number;
  adReady: boolean;
  extraLoops: number;
}

export interface DemoInfo {
  title: string;
  line: string;
  speed: number;
  /** Where the demo is up to, 0..1 across all its arenas, for a thin progress bar. */
  cleared: number;
}

export interface ViewerInfo {
  title: string;
  line: string;
  speed: number;
  done: boolean;
}

export interface Ui {
  show(screen: Screen): void;
  setMenu(info: MenuInfo): void;
  setHud(info: HudInfo): void;
  setResult(info: ResultInfo): void;
  setLost(info: LostInfo): void;
  setDemo(info: DemoInfo): void;
  setViewer(info: ViewerInfo): void;
  setSettings(settings: Record<SettingKey, boolean>): void;
  banner(text: string, tone: BannerTone, sub?: string): void;
  toast(text: string): void;
}

export function createUi(root: HTMLElement, cb: UiCallbacks): Ui {
  const stage = createStage(root).element;
  stage.classList.add('echo');

  // ---- HUD ------------------------------------------------------------------------------
  const hud = el('div', 'hud');
  hud.hidden = true;
  const pause = el('button', 'hud-pause');
  pause.type = 'button';
  pause.dataset['action'] = 'pause';
  pause.setAttribute('aria-label', 'Pause');
  pause.append(el('i'), el('i'));
  const hudLoop = el('div', 'hud-loop', 'Loop 1 of 8');
  const hudGhosts = el('div', 'hud-ghosts');
  const pips = el('div', 'pips');
  const timeBar = el('div', 'timebar');
  const timeFill = el('div', 'timebar-fill');
  const timeText = el('span', 'timebar-text');
  timeBar.append(timeFill, timeText);
  const hint = el('div', 'hint', 'Drag to move · stand on a plate to open its door');
  hint.hidden = true;
  const endLoopButton = button('Rewind now', 'end-loop', 'btn-small btn-magenta hud-end');
  hud.append(pause, hudLoop, hudGhosts, pips, timeBar, hint, endLoopButton);

  // ---- main menu ------------------------------------------------------------------------
  const menu = section('menu', 'Main menu', 'light');
  const starsPill = el('div', 'pill');
  const logo = el('div', 'logo');
  logo.setAttribute('aria-hidden', 'true');
  logo.append(el('i', 'ring ring-a'), el('i', 'ring ring-b'), el('i', 'dot dot-core'), el('i', 'dot dot-orbit'));
  const dailyBest = el('span', 'btn-sub');
  const dailyButton = button('Daily arena', 'daily', 'btn-cyan btn-big');
  dailyButton.append(dailyBest);
  const randomButton = button('Random arena', 'random', 'btn-magenta btn-big');
  randomButton.append(el('span', 'btn-sub', 'A fresh one, made just now'));
  const demoButton = button('Watch it play itself', 'demo', 'btn-amber btn-big');
  demoButton.append(el('span', 'btn-sub', 'The bot clears arena after arena'));
  const menuPanel = el('div', 'panel');
  menuPanel.append(logo, el('h1', 'title', 'Echo Loop'), el('p', 'tagline', "One of you can't do it all."), dailyButton, randomButton, demoButton, button('Settings', 'settings', 'btn-ghost'));
  menu.append(starsPill, menuPanel);

  // ---- paused ---------------------------------------------------------------------------
  const paused = section('paused', 'Paused', 'heavy');
  const pausedPanel = el('div', 'panel');
  pausedPanel.append(el('h2', 'heading', 'Paused'), button('Resume', 'resume', 'btn-cyan'), button('Quit', 'quit', 'btn-ghost'));
  paused.append(pausedPanel);

  // ---- result ---------------------------------------------------------------------------
  const result = section('result', 'Arena cleared', 'heavy');
  const resultKind = el('p', 'meta');
  const resultStars = el('div', 'stars-wrap');
  const resultLoops = el('div', 'big-number');
  const resultLine = el('p', 'meta');
  const resultBest = el('p', 'tag');
  const resultActions = el('div', 'actions');
  resultActions.append(button('Share this run', 'share', 'btn-cyan'), button('Watch it back', 'watch', 'btn-ghost'), button('Another arena', 'another', 'btn-magenta'), button('Main menu', 'menu', 'btn-link'));
  const resultPanel = el('div', 'panel');
  resultPanel.append(el('h2', 'heading', 'Cleared'), resultKind, resultStars, resultLoops, resultLine, resultBest, resultActions);
  result.append(resultPanel);

  // ---- lost -----------------------------------------------------------------------------
  const lost = section('lost', 'Out of loops', 'heavy');
  const lostDetail = el('p', 'detail');
  const extra = button('Watch ad for more loops', 'extra', 'btn-amber');
  const extraTag = el('span', 'btn-sub');
  extra.append(extraTag);
  const lostNote = el('p', 'note');
  const lostActions = el('div', 'actions');
  lostActions.append(extra, lostNote, button('Give up', 'give-up', 'btn-link'));
  const lostPanel = el('div', 'panel');
  lostPanel.append(el('h2', 'heading heading-bad', 'Out of loops'), lostDetail, lostActions);
  lost.append(lostPanel);

  // ---- settings -------------------------------------------------------------------------
  const settings = section('settings', 'Settings', 'heavy');
  const soundToggle = button('Sound', 'toggle-sound', 'btn-toggle');
  const hapticsToggle = button('Vibration', 'toggle-haptics', 'btn-toggle');
  soundToggle.setAttribute('role', 'switch');
  hapticsToggle.setAttribute('role', 'switch');
  const settingsPanel = el('div', 'panel');
  settingsPanel.append(el('h2', 'heading', 'Settings'), soundToggle, hapticsToggle, button('Back', 'back', 'btn-cyan'));
  settings.append(settingsPanel);

  // ---- waiting for an ad ----------------------------------------------------------------
  const waiting = section('ad', 'Loading ad', 'heavy');
  const waitingPanel = el('div', 'panel');
  waitingPanel.append(el('div', 'spinner'), el('h2', 'heading heading-small', 'Loading ad…'));
  waiting.append(waitingPanel);

  // ---- the demo (the bot playing) --------------------------------------------------------
  const demo = el('div', 'hud demo');
  demo.hidden = true;
  const demoTitle = el('div', 'demo-title');
  const demoLine = el('div', 'demo-line');
  const demoBar = el('div', 'demo-bar');
  const demoFill = el('div', 'demo-bar-fill');
  demoBar.append(demoFill);
  const demoActions = el('div', 'demo-actions');
  const speedButton = button('64×', 'demo-speed', 'btn-small btn-amber');
  demoActions.append(speedButton, button('Stop', 'demo-stop', 'btn-small btn-ghost'));
  demo.append(demoTitle, demoLine, demoBar, demoActions);

  // ---- viewing a shared run --------------------------------------------------------------
  const viewer = el('div', 'hud demo viewer');
  viewer.hidden = true;
  const viewerTitle = el('div', 'demo-title');
  const viewerLine = el('div', 'demo-line');
  const viewerActions = el('div', 'demo-actions');
  const viewerSpeed = button('1×', 'demo-speed', 'btn-small btn-amber');
  const viewerPlay = button('Play this arena', 'play-arena', 'btn-small btn-cyan');
  viewerActions.append(viewerSpeed, viewerPlay, button('Menu', 'menu', 'btn-small btn-ghost'));
  viewer.append(viewerTitle, viewerLine, viewerActions);

  const bannerEl = el('div', 'banner');
  bannerEl.hidden = true;
  const toastEl = el('div', 'toast');
  toastEl.hidden = true;
  stage.append(hud, demo, viewer, menu, paused, result, lost, settings, waiting, bannerEl, toastEl);

  const screens: Record<Screen, HTMLElement[]> = {
    menu: [menu],
    hud: [hud],
    paused: [hud, paused],
    result: [result],
    lost: [hud, lost],
    settings: [settings],
    ad: [waiting],
    demo: [demo],
    viewer: [viewer],
    none: [],
  };
  const all = [hud, demo, viewer, menu, paused, result, lost, settings, waiting];

  // One delegated listener for every button.
  stage.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const node = target.closest<HTMLElement>('button[data-action]');
    if (!node || (node instanceof HTMLButtonElement && node.disabled)) return;
    switch (node.dataset['action']) {
      case 'daily': return cb.onDaily();
      case 'random': return cb.onRandom();
      case 'demo': return cb.onDemo();
      case 'settings': return cb.onOpenSettings();
      case 'back': return cb.onBack();
      case 'toggle-sound': return cb.onToggle('sound');
      case 'toggle-haptics': return cb.onToggle('haptics');
      case 'pause': return cb.onPause();
      case 'resume': return cb.onResume();
      case 'quit': return cb.onQuit();
      case 'share': return cb.onShare();
      case 'watch': return cb.onWatch();
      case 'another': return cb.onAnother();
      case 'menu': return cb.onMenu();
      case 'end-loop': return cb.onEndLoop();
      case 'extra': return cb.onExtraLoops();
      case 'give-up': return cb.onGiveUp();
      case 'demo-speed': return cb.onDemoSpeed();
      case 'demo-stop': return cb.onDemoStop();
      case 'play-arena': return cb.onPlayArena();
    }
  });

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  let pipCount = -1;

  return {
    show(screen) {
      const visible = new Set(screens[screen]);
      for (const node of all) node.hidden = !visible.has(node);
    },

    setMenu({ dailySeed, dailyBest: best, totalStars, cleared }) {
      setText(starsPill, `★ ${totalStars}  ·  ${cleared} cleared`);
      setText(dailyBest, best === null ? `Seed ${dailySeed} · not played yet` : `Seed ${dailySeed} · best ${best.loops} loops ${'★'.repeat(best.stars)}`);
    },

    setHud(info) {
      setText(hudLoop, `Loop ${info.loop + 1} of ${info.maxLoops}`);
      setText(hudGhosts, info.ghosts === 0 ? 'No ghosts yet' : info.ghosts === 1 ? '1 ghost with you' : `${info.ghosts} ghosts with you`);
      if (pips.children.length !== info.orbsTotal || pipCount !== info.orbsTotal) {
        pips.replaceChildren(...Array.from({ length: info.orbsTotal }, () => el('i', 'pip')));
        pipCount = info.orbsTotal;
      }
      [...pips.children].forEach((node, i) => node.classList.toggle('is-got', i < info.orbs));
      timeFill.style.width = `${Math.min(100, Math.max(0, info.progress * 100)).toFixed(1)}%`;
      timeBar.classList.toggle('is-low', info.secondsLeft <= 3);
      setText(timeText, `${Math.ceil(info.secondsLeft)}s`);
      hint.hidden = !info.hint;
      endLoopButton.hidden = !info.canEnd;
    },

    setResult(info) {
      setText(resultKind, `${info.daily ? 'Daily arena' : 'Arena'} · seed ${info.seed}`);
      resultStars.replaceChildren(starRow(info.stars, 'stars stars-big'));
      setText(resultLoops, `${info.loops} ${info.loops === 1 ? 'loop' : 'loops'}`);
      setText(resultLine, `Par ${info.par}${info.deaths > 0 ? ` · ${info.deaths} ${info.deaths === 1 ? 'rewind' : 'rewinds'} after dying` : ''}`);
      setText(resultBest, info.isBest ? 'New best for this arena' : '');
      resultBest.hidden = !info.isBest;
    },

    setLost(info) {
      setText(lostDetail, `You collected ${info.collected} of ${info.total} orbs in the last loop. Every orb must be taken in the same loop.`);
      extra.hidden = !info.adReady;
      setText(extraTag, `+${info.extraLoops} loops`);
      setText(lostNote, info.adReady ? '' : 'No ad is available right now.');
    },

    setDemo(info) {
      setText(demoTitle, info.title);
      setText(demoLine, info.line);
      demoFill.style.width = `${Math.min(100, info.cleared * 100).toFixed(1)}%`;
      setLabel(speedButton, `${info.speed}×`);
    },

    setViewer(info) {
      setText(viewerTitle, info.title);
      setText(viewerLine, info.line);
      setLabel(viewerSpeed, `${info.speed}×`);
      viewerSpeed.hidden = info.done;
    },

    setSettings(values) {
      for (const [node, name, on] of [
        [soundToggle, 'Sound', values.sound],
        [hapticsToggle, 'Vibration', values.haptics],
      ] as const) {
        setLabel(node, `${name}: ${on ? 'On' : 'Off'}`);
        node.setAttribute('aria-checked', String(on));
        node.classList.toggle('is-on', on);
      }
    },

    banner(text, tone, sub) {
      bannerEl.replaceChildren(el('span', 'banner-text', text), ...(sub ? [el('span', 'banner-sub', sub)] : []));
      bannerEl.className = `banner banner-${tone}`;
      bannerEl.hidden = false;
      // Restart the animation even if a banner is already showing.
      void bannerEl.offsetWidth;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => (bannerEl.hidden = true), 1300);
    },

    toast(text) {
      setText(toastEl, text);
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
    },
  };
}
