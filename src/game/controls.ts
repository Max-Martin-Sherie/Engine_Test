/**
 * Turns what the player does (keys and mouse, or thumbs on a phone) into the simulation's input. It owns where the
 * player is looking, so the view can turn at the screen's speed between simulation ticks.
 *
 *  - Mouse: the pointer is locked to the game and its movement turns the view. A click captures it, Esc lets go (and
 *    pauses). Where the browser will not lock it, dragging with the right button looks instead.
 *  - Touch: the stick, the look area and the buttons come from the UI as plain values.
 *  - Either can be used at any time (a tablet with a keyboard); the last one used decides which help is shown.
 */
import { noInput, type Input } from './sim';
import type { TouchHandlers } from './ui';

/** Radians of turn per pixel at the default sensitivity. A finger sweeps a short, fast arc; a mouse moves in small steps. */
export const MOUSE_TURN = 0.0021;
export const TOUCH_TURN = 0.0042;

export interface ControlsOptions {
  /** The element the mouse is captured on. */
  target: HTMLElement;
  /** The player's sensitivity (1 is the default) and whether up is down. */
  sensitivity(): number;
  invertY(): boolean;
  /** The player asked to pause (Esc, P, or the mouse was let go). */
  onPause(): void;
  /** The scoreboard key went down or up. */
  onBoard(held: boolean): void;
  /** A weapon slot (0..4) was chosen. */
  onSlot(slot: number): void;
  /** The next (1) or previous (-1) weapon was asked for. */
  onCycle(direction: number): void;
  /** The device in use changed (true: fingers). */
  onDevice(touch: boolean): void;
  /** The sights were toggled by the touch button. */
  onAimToggle(on: boolean): void;
}

export interface Controls {
  /** What the touch area reports; give it to the UI. */
  readonly touchHandlers: TouchHandlers;
  readonly touch: boolean;
  yaw: number;
  pitch: number;
  /** Is the trigger held (by any means)? */
  readonly firing: boolean;
  /** Did the view turn during the last frame? */
  readonly turning: boolean;
  /** Are the sights up (touch toggle or the right button)? */
  readonly aiming: boolean;
  readonly locked: boolean;
  /** The browser would not capture the mouse (the player looks by right-dragging instead). */
  readonly lockFailed: boolean;
  /** Listens (while playing) or lets go of everything (not playing). */
  setEnabled(on: boolean): void;
  /** Asks the browser to capture the mouse. */
  capture(): void;
  /** Points the view somewhere (a new life). */
  look(yaw: number, pitch: number): void;
  /** Applies the turn gathered since the last frame; `assist` may reshape it (aim assist). `scale` slows it while zoomed. */
  frame(scale: number, assist: (dYaw: number, dPitch: number, turning: boolean) => { dYaw: number; dPitch: number }): void;
  /** The input for the next simulation tick (a press that has not been used yet is delivered once). `fire` forces the trigger down (auto fire). */
  sample(fire?: boolean): Input;
  /** Queues a weapon slot for the next tick. */
  queueSlot(slot: number): void;
  setAiming(on: boolean): void;
  dispose(): void;
}

const clampPitch = (p: number): number => Math.max(-1.45, Math.min(1.45, p));

export function createControls(options: ControlsOptions): Controls {
  const { target } = options;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  let touch = coarse;
  let enabled = false;

  let yaw = 0;
  let pitch = 0;
  let pendingYaw = 0;
  let pendingPitch = 0;
  let turning = false;

  const keys = new Set<string>();
  let mouseFire = false;
  let mouseAim = false;
  let touchFire = false;
  let touchAim = false;
  let touchJump = false;
  let stickX = 0;
  let stickY = 0;
  let reloadQueued = false;
  let slotQueued = -1;
  let ignoreClick = false;
  let lockedNow = false;
  let lockFailed = false;

  const setTouch = (value: boolean): void => {
    if (touch === value) return;
    touch = value;
    options.onDevice(value);
  };

  // ---- turning ----------------------------------------------------------------------------------
  const turn = (dx: number, dy: number, rate: number): void => {
    const s = options.sensitivity() * rate;
    pendingYaw -= dx * s;
    pendingPitch -= dy * s * (options.invertY() ? -1 : 1);
  };

  const touchHandlers: TouchHandlers = {
    stick(x, y) {
      stickX = x;
      stickY = y;
    },
    look(dx, dy) {
      if (enabled) turn(dx, dy, TOUCH_TURN);
    },
    button(name, down) {
      if (!enabled && down) return;
      switch (name) {
        case 'fire':
          touchFire = down;
          break;
        case 'jump':
          touchJump = down;
          break;
        case 'reload':
          if (down) reloadQueued = true;
          break;
        case 'aim':
          if (down) {
            touchAim = !touchAim;
            options.onAimToggle(touchAim);
          }
          break;
        case 'swap':
          if (down) options.onCycle(1);
          break;
      }
    },
  };

  // ---- keyboard ---------------------------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!enabled) return;
    if (e.target instanceof HTMLInputElement) return;
    setTouch(false);
    if (e.repeat) {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'KeyR':
        reloadQueued = true;
        break;
      case 'Tab':
        e.preventDefault();
        options.onBoard(true);
        break;
      case 'Escape':
      case 'KeyP':
        options.onPause();
        break;
      case 'Space':
        e.preventDefault();
        break;
      default: {
        const m = /^Digit([1-5])$/.exec(e.code);
        if (m !== null) options.onSlot(Number(m[1]) - 1);
        else if (e.code === 'KeyQ') options.onCycle(-1);
        else if (e.code === 'KeyE') options.onCycle(1);
      }
    }
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
    if (e.code === 'Tab') {
      e.preventDefault();
      options.onBoard(false);
    }
  };

  // ---- mouse ------------------------------------------------------------------------------------
  const onMouseDown = (e: MouseEvent): void => {
    if (!enabled || touch) return;
    // A press on a button is the button's.
    if (e.target instanceof Element && e.target.closest('button, input, label') !== null) return;
    if (!lockedNow && !lockFailed) {
      ignoreClick = true;
      capture();
      return;
    }
    if (e.button === 0) mouseFire = true;
    else if (e.button === 2) mouseAim = true;
  };
  const onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) mouseFire = false;
    else if (e.button === 2) mouseAim = false;
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!enabled) return;
    if (lockedNow) {
      turn(e.movementX, e.movementY, MOUSE_TURN);
    } else if (lockFailed && (e.buttons & 2) !== 0) {
      turn(e.movementX, e.movementY, MOUSE_TURN);
    }
  };
  const onWheel = (e: WheelEvent): void => {
    if (!enabled || touch) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) > 0) options.onCycle(e.deltaY > 0 ? 1 : -1);
  };
  const onContextMenu = (e: Event): void => e.preventDefault();
  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') setTouch(true);
    else if (e.pointerType === 'mouse') setTouch(false);
  };

  function capture(): void {
    if (touch || lockedNow || typeof target.requestPointerLock !== 'function') {
      lockFailed = typeof target.requestPointerLock !== 'function';
      return;
    }
    try {
      const result = target.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      lockFailed = true;
    }
  }

  const onLockChange = (): void => {
    const was = lockedNow;
    lockedNow = document.pointerLockElement === target;
    if (lockedNow) lockFailed = false;
    // Letting go of the mouse mid-match is how a player pauses on a desktop.
    if (was && !lockedNow && enabled && !ignoreClick) options.onPause();
    ignoreClick = false;
  };
  const onLockError = (): void => {
    lockFailed = true;
  };
  const onBlur = (): void => {
    keys.clear();
    mouseFire = false;
    mouseAim = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);

  const release = (): void => {
    keys.clear();
    mouseFire = mouseAim = touchFire = touchJump = false;
    stickX = stickY = 0;
    reloadQueued = false;
    slotQueued = -1;
    pendingYaw = pendingPitch = 0;
  };

  const self: Controls = {
    touchHandlers,
    get touch() {
      return touch;
    },
    get yaw() {
      return yaw;
    },
    set yaw(v: number) {
      yaw = v;
    },
    get pitch() {
      return pitch;
    },
    set pitch(v: number) {
      pitch = clampPitch(v);
    },
    get firing() {
      return mouseFire || touchFire;
    },
    get turning() {
      return turning;
    },
    get aiming() {
      return mouseAim || touchAim;
    },
    get locked() {
      return lockedNow;
    },
    get lockFailed() {
      return lockFailed;
    },

    setEnabled(on) {
      enabled = on;
      if (!on) {
        release();
        if (document.pointerLockElement === target) {
          ignoreClick = true;
          document.exitPointerLock();
        }
      }
    },

    capture,

    look(newYaw, newPitch) {
      yaw = newYaw;
      pitch = clampPitch(newPitch);
      pendingYaw = pendingPitch = 0;
    },

    frame(scale, assist) {
      const dYaw = pendingYaw * scale;
      const dPitch = pendingPitch * scale;
      pendingYaw = pendingPitch = 0;
      turning = Math.abs(dYaw) + Math.abs(dPitch) > 1e-6;
      const r = assist(dYaw, dPitch, turning);
      yaw += r.dYaw;
      pitch = clampPitch(pitch + r.dPitch);
    },

    sample(fire = false) {
      const input = noInput();
      let mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      let mz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      let sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      if (stickX !== 0 || stickY !== 0) {
        mx += stickX;
        mz -= stickY;
        // Pushing the stick all the way out runs.
        if (Math.hypot(stickX, stickY) > 0.92 && mz > 0.3) sprint = true;
      }
      input.moveX = Math.max(-1, Math.min(1, mx));
      input.moveZ = Math.max(-1, Math.min(1, mz));
      input.yaw = yaw;
      input.pitch = pitch;
      input.fire = mouseFire || touchFire || fire;
      input.jump = keys.has('Space') || touchJump;
      input.sprint = sprint;
      input.reload = reloadQueued;
      input.aim = mouseAim || touchAim;
      input.switchTo = slotQueued;
      reloadQueued = false;
      slotQueued = -1;
      return input;
    },

    queueSlot(slot) {
      slotQueued = slot;
    },

    setAiming(on) {
      touchAim = on;
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
    },
  };
  return self;
}
