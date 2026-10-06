/**
 * The thumbs: a floating move stick under the left thumb, a look area under the right, and the buttons. It turns touches
 * into three plain things (a stick vector, how far a finger moved to look, button down / up) and knows nothing of the
 * game. Every touch is tracked by its own pointer, so any number of fingers work at once.
 */
import { button as makeButton, el } from './dom';
import { icon } from './icons';

export type TouchButton = 'fire' | 'jump' | 'reload' | 'aim' | 'swap';

export interface TouchHandlers {
  /** The stick, each -1..1 (y is down on the screen, so forward is negative). */
  stick(x: number, y: number): void;
  /** A finger moved this many CSS pixels while looking. */
  look(dx: number, dy: number): void;
  button(name: TouchButton, down: boolean): void;
}

export interface Touchpad {
  /** Mirrors the layout for a left-handed player. */
  setLeftHanded(on: boolean): void;
  /** Shows the controls (and takes the touches) or hides them. */
  setActive(on: boolean): void;
  /** The aim button shows whether the sights are up. */
  setAiming(on: boolean): void;
  /** Lets go of everything held (a pause, a lost touch). */
  release(): void;
}

/** Where a drag from `origin` leaves the stick: each -1..1, with a dead zone in the middle that costs no range. */
export function stickVector(dx: number, dy: number, radius: number, dead = 0.14): { x: number; y: number; length: number } {
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6 || radius <= 0) return { x: 0, y: 0, length: 0 };
  const raw = Math.min(1, distance / radius);
  const length = raw <= dead ? 0 : (raw - dead) / (1 - dead);
  return { x: (dx / distance) * length, y: (dy / distance) * length, length };
}

/** How far the stick can be pulled, in CSS pixels, for a window this size (a thumb's reach, not a fraction of a big screen). */
export const stickRadius = (width: number, height: number): number => Math.max(40, Math.min(66, Math.min(width, height) * 0.14));

interface ButtonSpec {
  name: TouchButton;
  label: string;
  className: string;
  /** From the near edge and the bottom, and the diameter, in world units. */
  x: number;
  y: number;
  d: number;
}

const BUTTONS: readonly ButtonSpec[] = [
  { name: 'fire', label: 'Fire', className: 'tb-fire', x: 18, y: 20, d: 80 },
  { name: 'jump', label: 'Jump', className: 'tb-jump', x: 30, y: 112, d: 54 },
  { name: 'aim', label: 'Aim', className: 'tb-aim', x: 116, y: 76, d: 54 },
  { name: 'reload', label: 'Reload', className: 'tb-reload', x: 126, y: 18, d: 46 },
  { name: 'swap', label: 'Next weapon', className: 'tb-swap', x: 190, y: 84, d: 46 },
];

export function createTouchpad(root: HTMLElement, stage: HTMLElement, handlers: TouchHandlers): Touchpad {
  // Two big areas under the stage (they cover the whole window, bars included): the stick and the look.
  const zones = el('div', 'tz');
  const moveZone = el('div', 'tz-move');
  const lookZone = el('div', 'tz-look');
  const base = el('div', 'stick-base');
  const knob = el('div', 'stick-knob');
  base.append(knob);
  zones.append(moveZone, lookZone, base);
  root.insertBefore(zones, stage);
  const noMenu = (e: Event): void => e.preventDefault();
  zones.addEventListener('contextmenu', noMenu);

  let active = false;

  // ---- the stick ----------------------------------------------------------------------------------
  let stickId: number | null = null;
  let originX = 0;
  let originY = 0;
  let radius = 56;
  const endStick = (): void => {
    stickId = null;
    base.classList.remove('is-on');
    handlers.stick(0, 0);
  };
  moveZone.addEventListener('pointerdown', (e) => {
    if (!active || stickId !== null) return;
    stickId = e.pointerId;
    moveZone.setPointerCapture(e.pointerId);
    originX = e.clientX;
    originY = e.clientY;
    radius = stickRadius(root.clientWidth, root.clientHeight);
    base.style.setProperty('--r', `${radius}px`);
    base.style.left = `${originX}px`;
    base.style.top = `${originY}px`;
    knob.style.transform = 'translate(-50%, -50%)';
    base.classList.add('is-on');
  });
  moveZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    const dx = e.clientX - originX;
    const dy = e.clientY - originY;
    const v = stickVector(dx, dy, radius);
    const distance = Math.hypot(dx, dy);
    const k = distance > radius ? radius / distance : 1;
    knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    handlers.stick(v.x, v.y);
  });
  const stickUp = (e: PointerEvent): void => {
    if (e.pointerId === stickId) endStick();
  };
  moveZone.addEventListener('pointerup', stickUp);
  moveZone.addEventListener('pointercancel', stickUp);

  // ---- looking ------------------------------------------------------------------------------------
  const lookers = new Map<number, { x: number; y: number }>();
  const startLook = (target: HTMLElement, e: PointerEvent): void => {
    target.setPointerCapture(e.pointerId);
    lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const moveLook = (e: PointerEvent): void => {
    const last = lookers.get(e.pointerId);
    if (last === undefined) return;
    handlers.look(e.clientX - last.x, e.clientY - last.y);
    last.x = e.clientX;
    last.y = e.clientY;
  };
  const endLook = (e: PointerEvent): void => {
    lookers.delete(e.pointerId);
  };
  lookZone.addEventListener('pointerdown', (e) => {
    if (active) startLook(lookZone, e);
  });
  lookZone.addEventListener('pointermove', moveLook);
  lookZone.addEventListener('pointerup', endLook);
  lookZone.addEventListener('pointercancel', endLook);

  // ---- the buttons --------------------------------------------------------------------------------
  const held = new Set<TouchButton>();
  const buttons = new Map<TouchButton, HTMLButtonElement>();
  for (const spec of BUTTONS) {
    const b = makeButton('', spec.name, `tb ${spec.className}`);
    b.classList.remove('btn');
    b.innerHTML = `${icon(spec.name, 'tb-icon')}<span class="tb-label">${spec.label}</span>`;
    b.setAttribute('aria-label', spec.label);
    b.style.setProperty('--x', String(spec.x));
    b.style.setProperty('--y', String(spec.y));
    b.style.setProperty('--d', String(spec.d));
    b.addEventListener('contextmenu', noMenu);
    b.addEventListener('pointerdown', (e) => {
      if (!active) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('is-down');
      held.add(spec.name);
      // The fire button also looks: the thumb that is shooting can keep turning.
      if (spec.name === 'fire') lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      handlers.button(spec.name, true);
    });
    if (spec.name === 'fire') b.addEventListener('pointermove', moveLook);
    const up = (e: PointerEvent): void => {
      lookers.delete(e.pointerId);
      if (!held.has(spec.name)) return;
      held.delete(spec.name);
      b.classList.remove('is-down');
      handlers.button(spec.name, false);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    stage.append(b);
    buttons.set(spec.name, b);
  }

  const release = (): void => {
    if (stickId !== null) endStick();
    lookers.clear();
    for (const name of [...held]) {
      held.delete(name);
      buttons.get(name)?.classList.remove('is-down');
      handlers.button(name, false);
    }
  };

  return {
    setLeftHanded(on) {
      root.classList.toggle('lefty', on);
    },
    setActive(on) {
      active = on;
      zones.classList.toggle('is-active', on);
      for (const b of buttons.values()) b.classList.toggle('is-shown', on);
      if (!on) release();
    },
    setAiming(on) {
      buttons.get('aim')?.classList.toggle('is-lit', on);
    },
    release,
  };
}
