import { createStage } from '../../engine/ui/stage';
import { button, coinAmount, el, formatTime, section, setLabel, setText } from './dom';
import { skinPreview, type SkinPreviewData } from './skinPreview';
import './styles.css';

export type Screen = 'menu' | 'hud' | 'paused' | 'tryAgain' | 'result' | 'shop' | 'settings' | 'ad';
export type UiMode = 'classic' | 'arcade';
export type SettingKey = 'sound' | 'haptics';
export type Tone = 'perfect' | 'great' | 'good' | 'miss' | 'cancel' | 'bomb';

export interface UiCallbacks {
  onPlay(mode: UiMode): void;
  onOpenShop(): void;
  onOpenSettings(): void;
  onBack(): void;
  onBuy(id: string): void;
  onEquip(id: string): void;
  onToggle(key: SettingKey): void;
  onPause(): void;
  onResume(): void;
  onQuit(): void;
  onRetryCoins(): void;
  onRetryAd(): void;
  onGiveUp(): void;
  onDouble(): void;
  onPlayAgain(): void;
  onMenu(): void;
}

export interface MenuInfo {
  coins: number;
  bestClassic: number;
  bestArcade: number;
}

export interface HudInfo {
  mode: UiMode;
  score: number;
  fruits: number;
  tolerance: number;
  combo: number;
  multiplier: number;
  timeLeft: number;
  strikes: number;
  maxStrikes: number;
}

export interface TryAgainInfo {
  mode: UiMode;
  /** "tolerance", "strikes" or "time". */
  reason: string;
  /** How far off the last cut was, and how far it was allowed to be (percentage points). */
  deviation: number;
  tolerance: number;
  score: number;
  fruits: number;
  cost: number;
  coins: number;
  adReady: boolean;
}

export interface ResultInfo {
  mode: UiMode;
  score: number;
  fruits: number;
  accuracy: number;
  best: number;
  newBest: boolean;
  coinsEarned: number;
  canDouble: boolean;
  doubled: boolean;
}

export interface SkinCard {
  id: string;
  name: string;
  rarity: string;
  price: number;
  owned: boolean;
  equipped: boolean;
  preview: SkinPreviewData;
}

export interface ShopInfo {
  coins: number;
  skins: readonly SkinCard[];
}

export interface FlashInfo {
  /** Where to show it, in world coordinates. */
  x: number;
  y: number;
  text: string;
  sub?: string;
  tone: Tone;
}

export interface Ui {
  show(screen: Screen): void;
  setMenu(info: MenuInfo): void;
  setHud(info: HudInfo): void;
  setHint(text: string | null): void;
  /** Marks where the last cut landed on the gauge (0..100 = percent of the fruit on the left), or clears it. */
  setMarker(leftPercent: number | null): void;
  flash(info: FlashInfo): void;
  setTryAgain(info: TryAgainInfo): void;
  setResult(info: ResultInfo): void;
  setShop(info: ShopInfo): void;
  setSettings(settings: Record<SettingKey, boolean>): void;
  toast(text: string): void;
}

const REASONS: Record<string, string> = {
  tolerance: 'Not even enough',
  strikes: 'Three strikes',
  time: "Time's up",
};

export function createUi(root: HTMLElement, cb: UiCallbacks): Ui {
  const stage = createStage(root).element;
  stage.classList.add('fs');

  // ---- HUD ------------------------------------------------------------------------------
  const hud = el('div', 'hud');
  hud.hidden = true;
  const pause = el('button', 'hud-pause');
  pause.type = 'button';
  pause.dataset['action'] = 'pause';
  pause.setAttribute('aria-label', 'Pause');
  pause.append(el('i'), el('i'));
  const hudScore = el('div', 'hud-score', '0');
  const hudMeta = el('div', 'hud-meta');
  const metaLabel = el('span', 'hud-meta-label');
  const strikes = el('span', 'strikes');
  hudMeta.append(metaLabel, strikes);
  const gauge = el('div', 'gauge');
  const zone = el('div', 'gauge-zone');
  const center = el('div', 'gauge-center');
  const marker = el('div', 'gauge-marker');
  marker.hidden = true;
  const gaugeLabel = el('div', 'gauge-label');
  gauge.append(zone, center, marker);
  const combo = el('div', 'hud-combo');
  const hint = el('div', 'hint');
  hint.hidden = true;
  hud.append(pause, hudScore, hudMeta, gauge, gaugeLabel, combo, hint);

  // ---- main menu ------------------------------------------------------------------------
  const menu = section('menu', 'Main menu', 'light');
  const menuCoins = el('div', 'coins-pill');
  const classicBest = el('span', 'btn-sub');
  const arcadeBest = el('span', 'btn-sub');
  const classicButton = button('Classic', 'classic', 'btn-lime btn-big');
  const arcadeButton = button('Arcade', 'arcade', 'btn-citrus btn-big');
  classicButton.append(classicBest);
  arcadeButton.append(arcadeBest);
  const logo = el('div', 'logo-art');
  logo.setAttribute('aria-hidden', 'true');
  logo.append(el('i', 'logo-half logo-half-a'), el('i', 'logo-half logo-half-b'));
  const menuRow = el('div', 'menu-row');
  menuRow.append(button('Skins', 'shop', 'btn-ghost'), button('Settings', 'settings', 'btn-ghost'));
  const menuPanel = el('div', 'panel');
  menuPanel.append(
    logo,
    el('h1', 'title', 'Fruit Slice'),
    el('p', 'tagline', 'Cut it exactly in half'),
    classicButton,
    arcadeButton,
    menuRow,
  );
  menu.append(menuCoins, menuPanel);

  // ---- paused ---------------------------------------------------------------------------
  const paused = section('paused', 'Paused', 'heavy');
  const pausedPanel = el('div', 'panel');
  pausedPanel.append(el('h2', 'heading', 'Paused'), button('Resume', 'resume', 'btn-lime'), button('Quit run', 'quit', 'btn-ghost'));
  paused.append(pausedPanel);

  // ---- try again ------------------------------------------------------------------------
  const tryAgain = section('tryAgain', 'Try again', 'heavy');
  const tryReason = el('h2', 'heading heading-bad');
  const tryDetail = el('p', 'detail');
  const trySummary = el('p', 'meta');
  const retryCoins = button('Try again', 'retry-coins', 'btn-lime');
  const retryCost = el('span', 'btn-sub');
  retryCoins.append(retryCost);
  const retryAd = button('Watch ad to try again', 'retry-ad', 'btn-citrus');
  const retryNote = el('p', 'note');
  const tryPanel = el('div', 'panel');
  const tryActions = el('div', 'actions');
  tryActions.append(retryCoins, retryAd, retryNote, button('Give up', 'give-up', 'btn-link'));
  tryPanel.append(tryReason, tryDetail, trySummary, tryActions);
  tryAgain.append(tryPanel);

  // ---- result ---------------------------------------------------------------------------
  const result = section('result', 'Run over', 'heavy');
  const resultMode = el('p', 'meta');
  const resultScore = el('div', 'big-score', '0');
  const resultBest = el('p', 'meta');
  const stats = el('div', 'stats');
  const statFruit = el('span', 'stat-value');
  const statAccuracy = el('span', 'stat-value');
  const stat = (label: string, value: HTMLElement): HTMLElement => {
    const box = el('div', 'stat');
    box.append(el('span', 'stat-label', label), value);
    return box;
  };
  stats.append(stat('Fruit', statFruit), stat('Accuracy', statAccuracy));
  const earned = el('div', 'earned');
  const earnedAmount = el('span', 'earned-amount');
  earned.append(el('span', 'earned-label', 'Coins earned'), earnedAmount);
  const doubleButton = button('Watch ad to double', 'double', 'btn-citrus');
  const resultActions = el('div', 'actions');
  resultActions.append(doubleButton, button('Play again', 'again', 'btn-lime'), button('Main menu', 'menu', 'btn-ghost'));
  const resultPanel = el('div', 'panel');
  resultPanel.append(el('h2', 'heading', 'Run over'), resultMode, resultScore, resultBest, stats, earned, resultActions);
  result.append(resultPanel);

  // ---- shop -----------------------------------------------------------------------------
  const shop = section('shop', 'Knife skins', 'heavy');
  shop.classList.add('screen-top');
  const shopCoins = el('div', 'coins-pill');
  const shopHead = el('div', 'bar');
  shopHead.append(button('Back', 'back', 'btn-small btn-ghost'), el('h2', 'heading heading-small', 'Skins'), shopCoins);
  const shopList = el('div', 'skin-grid');
  const shopScroll = el('div', 'scroll');
  shopScroll.append(shopList);
  shop.append(shopHead, shopScroll);

  // ---- settings -------------------------------------------------------------------------
  const settings = section('settings', 'Settings', 'heavy');
  const soundToggle = button('Sound', 'toggle-sound', 'btn-toggle');
  const hapticsToggle = button('Vibration', 'toggle-haptics', 'btn-toggle');
  soundToggle.setAttribute('role', 'switch');
  hapticsToggle.setAttribute('role', 'switch');
  const settingsPanel = el('div', 'panel');
  settingsPanel.append(el('h2', 'heading', 'Settings'), soundToggle, hapticsToggle, button('Back', 'back', 'btn-lime'));
  settings.append(settingsPanel);

  // ---- waiting for an ad ----------------------------------------------------------------
  const waiting = section('ad', 'Loading ad', 'heavy');
  const waitingPanel = el('div', 'panel');
  waitingPanel.append(el('div', 'spinner'), el('h2', 'heading heading-small', 'Loading ad…'));
  waiting.append(waitingPanel);

  const toastEl = el('div', 'toast');
  toastEl.hidden = true;
  stage.append(hud, menu, paused, tryAgain, result, shop, settings, waiting, toastEl);

  const screens: Record<Screen, HTMLElement[]> = {
    menu: [menu],
    hud: [hud],
    paused: [hud, paused],
    tryAgain: [hud, tryAgain],
    result: [result],
    shop: [shop],
    settings: [settings],
    ad: [waiting],
  };
  const all = [hud, menu, paused, tryAgain, result, shop, settings, waiting];

  // One delegated listener for every button.
  stage.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const node = target.closest<HTMLElement>('button[data-action]');
    if (!node || (node instanceof HTMLButtonElement && node.disabled)) return;
    const id = node.dataset['id'] ?? '';
    switch (node.dataset['action']) {
      case 'classic': return cb.onPlay('classic');
      case 'arcade': return cb.onPlay('arcade');
      case 'shop': return cb.onOpenShop();
      case 'settings': return cb.onOpenSettings();
      case 'back': return cb.onBack();
      case 'buy': return cb.onBuy(id);
      case 'equip': return cb.onEquip(id);
      case 'toggle-sound': return cb.onToggle('sound');
      case 'toggle-haptics': return cb.onToggle('haptics');
      case 'pause': return cb.onPause();
      case 'resume': return cb.onResume();
      case 'quit': return cb.onQuit();
      case 'retry-coins': return cb.onRetryCoins();
      case 'retry-ad': return cb.onRetryAd();
      case 'give-up': return cb.onGiveUp();
      case 'double': return cb.onDouble();
      case 'again': return cb.onPlayAgain();
      case 'menu': return cb.onMenu();
    }
  });

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTolerance = -1;
  let lastGaugeText = '';

  return {
    show(screen) {
      const visible = new Set(screens[screen]);
      for (const node of all) node.hidden = !visible.has(node);
    },

    setMenu({ coins, bestClassic, bestArcade }) {
      menuCoins.replaceChildren(coinAmount(coins));
      setText(classicBest, bestClassic > 0 ? `Best ${bestClassic}` : 'Take your time');
      setText(arcadeBest, bestArcade > 0 ? `Best ${bestArcade}` : 'Beat the clock');
    },

    setHud(info) {
      setText(hudScore, String(info.score));
      if (info.mode === 'arcade') {
        setText(metaLabel, formatTime(info.timeLeft));
        hudMeta.classList.toggle('is-low', info.timeLeft <= 10);
        if (strikes.children.length !== info.maxStrikes) {
          strikes.replaceChildren(...Array.from({ length: info.maxStrikes }, () => el('i', 'strike')));
        }
        [...strikes.children].forEach((node, i) => node.classList.toggle('is-lost', i < info.strikes));
      } else {
        setText(metaLabel, `Fruit ${info.fruits + 1}`);
        hudMeta.classList.remove('is-low');
        strikes.replaceChildren();
      }
      const tol = Math.round(info.tolerance * 10) / 10;
      if (tol !== lastTolerance) {
        lastTolerance = tol;
        zone.style.left = `${50 - info.tolerance}%`;
        zone.style.width = `${info.tolerance * 2}%`;
      }
      const label = `Allowed ${(50 - info.tolerance).toFixed(1)} / ${(50 + info.tolerance).toFixed(1)}`;
      if (label !== lastGaugeText) {
        lastGaugeText = label;
        gaugeLabel.textContent = label;
      }
      const multiplier = info.multiplier.toFixed(1);
      setText(combo, info.combo > 0 ? `Combo ×${multiplier}` : '');
      combo.classList.toggle('is-on', info.combo > 0);
    },

    setHint(text) {
      hint.hidden = text === null;
      if (text !== null) setText(hint, text);
    },

    setMarker(leftPercent) {
      marker.hidden = leftPercent === null;
      if (leftPercent !== null) marker.style.left = `${Math.min(100, Math.max(0, leftPercent))}%`;
    },

    flash({ x, y, text, sub, tone }) {
      stage.querySelectorAll('.flash').forEach((old) => old.remove()); // one popup at a time
      const node = el('div', `flash flash-${tone}`);
      node.style.left = `calc(var(--u) * ${x})`;
      node.style.top = `calc(var(--u) * ${y})`;
      node.append(el('span', 'flash-text', text));
      if (sub) node.append(el('span', 'flash-sub', sub));
      stage.append(node);
      setTimeout(() => node.remove(), 1400);
    },

    setTryAgain(info) {
      setText(tryReason, REASONS[info.reason] ?? 'Missed');
      setText(
        tryDetail,
        info.reason === 'tolerance'
          ? `You were off by ${info.deviation.toFixed(1)} points. The limit was ${info.tolerance.toFixed(1)}.`
          : info.mode === 'arcade'
            ? 'Take some time back and keep slicing.'
            : '',
      );
      setText(trySummary, `${info.fruits} fruit · ${info.score} points`);
      const affordable = info.coins >= info.cost;
      retryCoins.disabled = !affordable;
      retryCost.replaceChildren(coinAmount(info.cost));
      retryAd.hidden = !info.adReady;
      setText(retryNote, affordable ? `You have ${info.coins} coins` : `You have ${info.coins} coins. Watch an ad to try again for free.`);
    },

    setResult(info) {
      setText(resultMode, info.mode === 'classic' ? 'Classic' : 'Arcade');
      setText(resultScore, String(info.score));
      resultBest.textContent = info.newBest ? 'New best!' : `Best ${info.best}`;
      resultBest.classList.toggle('is-new-best', info.newBest);
      setText(statFruit, String(info.fruits));
      setText(statAccuracy, info.fruits > 0 ? `${info.accuracy.toFixed(1)}%` : '–');
      earnedAmount.replaceChildren(coinAmount(`+${info.coinsEarned}`));
      doubleButton.hidden = !info.canDouble;
      doubleButton.classList.toggle('is-done', info.doubled);
      setLabel(doubleButton, `Watch ad to double (+${info.coinsEarned})`);
      earned.classList.toggle('is-doubled', info.doubled);
    },

    setShop({ coins, skins }) {
      shopCoins.replaceChildren(coinAmount(coins));
      shopList.replaceChildren(
        ...skins.map((s) => {
          const card = el('article', `skin-card rarity-${s.rarity}${s.equipped ? ' is-equipped' : ''}`);
          const preview = el('div', 'skin-art');
          preview.append(skinPreview(s.preview));
          const head = el('div', 'skin-head');
          head.append(el('span', 'skin-name', s.name), el('span', 'rarity-chip', s.rarity));
          let action: HTMLButtonElement;
          if (s.equipped) {
            action = button('Equipped', 'noop', 'btn-small btn-ghost');
            action.disabled = true;
          } else if (s.owned) {
            action = button('Equip', 'equip', 'btn-small btn-lime');
          } else {
            action = button('', 'buy', `btn-small btn-citrus${s.price > coins ? ' is-poor' : ''}`);
            action.querySelector('.btn-label')!.replaceWith(coinAmount(s.price));
          }
          action.dataset['id'] = s.id;
          card.append(preview, head, action);
          return card;
        }),
      );
    },

    setSettings(values) {
      for (const [key, node] of [['sound', soundToggle], ['haptics', hapticsToggle]] as const) {
        node.classList.toggle('is-on', values[key]);
        node.setAttribute('aria-checked', String(values[key]));
        setLabel(node, `${key === 'sound' ? 'Sound' : 'Vibration'}: ${values[key] ? 'On' : 'Off'}`);
      }
    },

    toast(text) {
      toastEl.hidden = false;
      toastEl.textContent = text;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.hidden = true;
      }, 1800);
    },
  };
}
