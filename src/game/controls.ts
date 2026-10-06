/**
 * Input: mouse, touch and keyboard turned into camera moves, selections and orders. It listens on the game's host
 * element (under the HUD), so presses on buttons never reach it. Screen points are the engine's world coordinates
 * (640 x 360); the 3D world turns them into map points.
 *
 * Mouse: left click selects (drag draws a box), right click orders, middle drag pans, the wheel zooms.
 * Touch: tap selects or orders, drag pans, press-and-hold then drag draws a box, two fingers pinch and pan.
 */
import { attackMoveAt, clearSelection, moveTo, orderAt, placeAt, rallyTo, select, selection, toggleSelected, type Outcome, type Session } from './session';
import { isUnit, type Entity } from './sim';
import { ZOOM_MAX, ZOOM_MIN, type Box, type World3d } from './view';

export interface ControlsOptions {
  /** The element pointer events are listened to. */
  target: HTMLElement;
  world: World3d;
  /** Client pixels to the engine's world coordinates. */
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  /** The size of the engine's world (the screen space the 3D world picks in). */
  size: { width: number; height: number };
  minimap: HTMLCanvasElement;
  /** Client pixels over the minimap to a map point. */
  minimapToMap(clientX: number, clientY: number): { x: number; y: number };
  /** The match being played, or null (the menu and the result screen take no orders). */
  session(): Session | null;
  fog(): boolean;
  edgeScroll(): boolean;
  /** Something was ordered, placed or failed: the flow shows the marker, plays the sound, shows the reason. */
  act(outcome: Outcome): void;
  /** The selection or mode changed: refresh the HUD now. */
  changed(): void;
  /** A key the controls do not handle themselves. Returns true if it was used. */
  key(event: KeyboardEvent): boolean;
  /** A touch hold turned into a selection box: a buzz. */
  buzz(): void;
}

export interface Controls {
  update(dt: number): void;
  /** The entity under the pointer (for highlighting). */
  hover(): number | null;
  /** The selection rectangle being dragged, in the engine's world coordinates. */
  box(): Box | null;
  /** The map point under the mouse, or where a finger last tapped. */
  pointer(): { x: number; y: number } | null;
  /** Glide the camera to a map point. */
  glideTo(x: number, y: number): void;
  dispose(): void;
}

const DRAG_PX = 6;
const PAN_PX = 10;
const HOLD_MS = 320;
const DOUBLE_MS = 380;
const PAN_SPEED = 1.1;

interface Point {
  x: number;
  y: number;
}

interface Press {
  id: number;
  touch: boolean;
  button: number;
  startClient: Point;
  start: Point;
  last: Point;
  mode: 'pending' | 'box' | 'pan';
  holdTimer: number;
  shift: boolean;
}

export function createControls(o: ControlsOptions): Controls {
  const { world, target } = o;
  const cam = world.cam;
  const pointers = new Map<number, { client: Point; point: Point }>();
  let press: Press | null = null;
  let pinch: { distance: number; mid: Point } | null = null;
  let ignoreUntilUp = new Set<number>();
  let box: Box | null = null;
  let hover: number | null = null;
  let mouse: { client: Point; point: Point } | null = null;
  let mouseInside = false;
  let ground: Point | null = null;
  let glide: Point | null = null;
  let lastTap: { time: number; type: string; own: boolean } | null = null;
  const held = new Set<string>();

  function groundAt(p: Point): Point | null {
    return world.groundAt(p.x, p.y);
  }

  function pickAt(p: Point, touch: boolean): Entity | undefined {
    const s = o.session();
    if (s === null) return undefined;
    return world.pick(s.match, s.player, o.fog(), p.x, p.y, touch ? 0.45 : 0) ?? undefined;
  }

  /** Moves the camera so the map point `g` sits under the screen point `p`. */
  function anchor(g: Point, p: Point): void {
    const now = groundAt(p);
    if (now === null) return;
    cam.x += g.x - now.x;
    cam.y += g.y - now.y;
    world.clampCamera();
    glide = null;
  }

  function zoomAbout(p: Point, factor: number): void {
    const before = groundAt(p);
    cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor));
    if (before !== null) anchor(before, p);
    else world.clampCamera();
  }

  /** Selects every unit (or building) of a type that is on screen. */
  function selectAllOfType(s: Session, type: string, additive: boolean): void {
    const same = s.match.entities.filter((e) => {
      if (!e.alive || e.owner !== s.player || e.type !== type) return false;
      const p = world.project(e.x, e.y, 0.4);
      return p !== null && p.x >= 0 && p.x <= o.size.width && p.y >= 0 && p.y <= o.size.height;
    });
    select(s, same.map((e) => e.id), additive);
  }

  // ---- left click / tap ----------------------------------------------------------------------

  function click(s: Session, at: Point, touch: boolean, shift: boolean): void {
    const g = groundAt(at);
    const target = pickAt(at, touch);

    if (s.mode.kind === 'place') {
      if (touch) {
        if (g !== null) ground = g; // the flow's Confirm button places it
      } else if (g !== null) {
        o.act(placeAt(s, g.x, g.y, shift));
      }
      o.changed();
      return;
    }
    if (s.mode.kind === 'attackMove') {
      const p = target !== undefined ? { x: target.x, y: target.y } : g;
      if (p !== null) o.act(attackMoveAt(s, p.x, p.y));
      o.changed();
      return;
    }
    if (s.mode.kind === 'move') {
      if (g !== null) o.act(moveTo(s, g.x, g.y));
      o.changed();
      return;
    }
    if (s.mode.kind === 'rally') {
      if (g !== null) o.act(rallyTo(s, g.x, g.y, target));
      o.changed();
      return;
    }

    const chosen = selection(s);
    const haveUnits = chosen.some((e) => e.owner === s.player && isUnit(e));
    const haveWorkers = chosen.some((e) => e.owner === s.player && e.type === 'worker');

    if (target !== undefined && target.owner === s.player) {
      const now = performance.now();
      const double = lastTap !== null && now - lastTap.time < DOUBLE_MS && lastTap.type === target.type && lastTap.own;
      lastTap = { time: now, type: target.type, own: true };
      if (double) selectAllOfType(s, target.type, shift);
      else if (shift) toggleSelected(s, target.id);
      else select(s, [target.id]);
      o.changed();
      return;
    }
    lastTap = null;

    // A touch on something that is not yours, with units selected, is an order; the mouse uses right click for that.
    if (touch && haveUnits) {
      const enemy = target !== undefined && target.owner >= 0 && target.owner !== s.player;
      const minerals = target !== undefined && target.type === 'minerals' && haveWorkers;
      const site = target !== undefined && target.owner === s.player;
      if (enemy || minerals || site || (target === undefined && g !== null)) {
        if (g !== null || target !== undefined) o.act(orderAt(s, target, target?.x ?? g?.x ?? 0, target?.y ?? g?.y ?? 0));
        o.changed();
        return;
      }
    }

    if (target !== undefined) select(s, [target.id], shift);
    else if (!shift) clearSelection(s);
    o.changed();
  }

  function finishBox(s: Session, from: Point, to: Point, shift: boolean): void {
    const found = world.boxSelect(s.match, s.player, from.x, from.y, to.x, to.y);
    if (found.length > 0) select(s, found.map((e) => e.id), shift);
    else if (!shift) clearSelection(s);
    o.changed();
  }

  function rightClick(s: Session, at: Point): void {
    if (s.mode.kind !== 'none' || s.menu !== 'root') {
      s.mode = { kind: 'none' };
      s.menu = 'root';
      o.changed();
      return;
    }
    const g = groundAt(at);
    const target = pickAt(at, false);
    if (g === null && target === undefined) return;
    o.act(orderAt(s, target, target?.x ?? g?.x ?? 0, target?.y ?? g?.y ?? 0));
    o.changed();
  }

  // ---- pointer events --------------------------------------------------------------------------

  function point(e: PointerEvent): { client: Point; point: Point } {
    const client = { x: e.clientX, y: e.clientY };
    return { client, point: o.toWorld(e.clientX, e.clientY) };
  }

  function onDown(e: PointerEvent): void {
    const s = o.session();
    if (s === null) return;
    const p = point(e);
    const touch = e.pointerType !== 'mouse';
    pointers.set(e.pointerId, p);
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Capture is only a convenience.
    }

    if (touch && pointers.size === 2) {
      // A second finger: pinch and pan; drop anything the first one started.
      if (press !== null) {
        window.clearTimeout(press.holdTimer);
        ignoreUntilUp.add(press.id);
      }
      press = null;
      box = null;
      const [a, b] = [...pointers.values()];
      if (a !== undefined && b !== undefined) pinch = { distance: Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y), mid: { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 } };
      return;
    }
    if (pointers.size > 1 || ignoreUntilUp.has(e.pointerId)) return;

    if (!touch && e.button === 2) {
      rightClick(s, p.point);
      return;
    }
    press = {
      id: e.pointerId,
      touch,
      button: e.button,
      startClient: p.client,
      start: p.point,
      last: p.point,
      mode: 'pending',
      holdTimer: 0,
      shift: e.shiftKey,
    };
    if (!touch && e.button === 1) {
      press.mode = 'pan';
      return;
    }
    if (touch && s.mode.kind === 'none') {
      const pending = press;
      pending.holdTimer = window.setTimeout(() => {
        if (press === pending && pending.mode === 'pending') {
          pending.mode = 'box';
          box = { x0: pending.start.x, y0: pending.start.y, x1: pending.last.x, y1: pending.last.y };
          o.buzz();
        }
      }, HOLD_MS);
    }
  }

  function onMove(e: PointerEvent): void {
    const p = point(e);
    if (e.pointerType === 'mouse') {
      mouse = p;
      mouseInside = true;
    }
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

    if (pinch !== null && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (a === undefined || b === undefined) return;
      const distance = Math.max(1, Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y));
      const mid = { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 };
      const before = groundAt(pinch.mid);
      cam.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (cam.zoom * pinch.distance) / distance));
      if (before !== null) anchor(before, mid);
      pinch = { distance, mid };
      return;
    }

    const current = press;
    if (current === null || current.id !== e.pointerId) return;
    const moved = Math.hypot(p.client.x - current.startClient.x, p.client.y - current.startClient.y);
    const previous = current.last;
    current.last = p.point;

    if (current.mode === 'pending' && moved > (current.touch ? PAN_PX : DRAG_PX)) {
      window.clearTimeout(current.holdTimer);
      if (current.touch) current.mode = 'pan';
      else if (current.button === 0 && o.session()?.mode.kind === 'none') current.mode = 'box';
    }
    if (current.mode === 'box') box = { x0: current.start.x, y0: current.start.y, x1: p.point.x, y1: p.point.y };
    else if (current.mode === 'pan') {
      const g = groundAt(previous);
      if (g !== null) anchor(g, p.point);
    }
  }

  function onUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      // Not captured.
    }
    if (ignoreUntilUp.delete(e.pointerId)) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (pinch !== null && pointers.size < 2) {
      pinch = null;
      // The finger left on the screen should not start a tap or a pan.
      for (const id of pointers.keys()) ignoreUntilUp.add(id);
      return;
    }
    const current = press;
    if (current === null || current.id !== e.pointerId) return;
    window.clearTimeout(current.holdTimer);
    press = null;
    const s = o.session();
    const p = point(e);
    if (s === null) {
      box = null;
      return;
    }
    if (e.type === 'pointercancel') {
      box = null;
      return;
    }
    if (current.mode === 'box') {
      box = null;
      finishBox(s, current.start, p.point, current.shift || e.shiftKey);
    } else if (current.mode === 'pending' && current.button === 0) {
      click(s, p.point, current.touch, current.shift || e.shiftKey);
    }
  }

  function onLeave(): void {
    mouseInside = false;
    hover = null;
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = o.toWorld(e.clientX, e.clientY);
    zoomAbout(p, Math.exp(e.deltaY * 0.0012));
  }

  // ---- minimap -----------------------------------------------------------------------------------

  let mapPress: { id: number; touch: boolean; holdTimer: number; startClient: Point; commanded: boolean } | null = null;

  function mapJump(e: PointerEvent): void {
    const m = o.minimapToMap(e.clientX, e.clientY);
    cam.x = m.x;
    cam.y = m.y;
    world.clampCamera();
    glide = null;
  }

  function mapCommand(e: PointerEvent | { clientX: number; clientY: number }): void {
    const s = o.session();
    if (s === null) return;
    const m = o.minimapToMap(e.clientX, e.clientY);
    if (s.mode.kind === 'attackMove') o.act(attackMoveAt(s, m.x, m.y));
    else o.act(orderAt(s, undefined, m.x, m.y));
    o.changed();
  }

  function onMapDown(e: PointerEvent): void {
    e.preventDefault();
    o.minimap.setPointerCapture(e.pointerId);
    const touch = e.pointerType !== 'mouse';
    if (!touch && e.button === 2) {
      mapCommand(e);
      return;
    }
    mapPress = { id: e.pointerId, touch, holdTimer: 0, startClient: { x: e.clientX, y: e.clientY }, commanded: false };
    mapJump(e);
    if (touch) {
      const current = mapPress;
      const at = { clientX: e.clientX, clientY: e.clientY };
      current.holdTimer = window.setTimeout(() => {
        if (mapPress === current && !current.commanded) {
          current.commanded = true;
          o.buzz();
          mapCommand(at);
        }
      }, 450);
    }
  }

  function onMapMove(e: PointerEvent): void {
    const current = mapPress;
    if (current === null || current.id !== e.pointerId || current.commanded) return;
    if (Math.hypot(e.clientX - current.startClient.x, e.clientY - current.startClient.y) > 8) window.clearTimeout(current.holdTimer);
    mapJump(e);
  }

  function onMapUp(e: PointerEvent): void {
    if (mapPress !== null && mapPress.id === e.pointerId) {
      window.clearTimeout(mapPress.holdTimer);
      mapPress = null;
    }
  }

  // ---- keyboard ----------------------------------------------------------------------------------

  const CAMERA_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  function onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (CAMERA_KEYS.has(e.key)) {
      held.add(e.key);
      glide = null;
      e.preventDefault();
      return;
    }
    if (e.key === '=' || e.key === '+') {
      cam.zoom = Math.max(ZOOM_MIN, cam.zoom / 1.15);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      cam.zoom = Math.min(ZOOM_MAX, cam.zoom * 1.15);
      return;
    }
    if (e.repeat) {
      if (e.key === ' ') e.preventDefault();
      return;
    }
    if (o.key(e)) e.preventDefault();
  }

  function onKeyUp(e: KeyboardEvent): void {
    held.delete(e.key);
  }

  function onBlur(): void {
    held.clear();
    press = null;
    box = null;
    pinch = null;
    pointers.clear();
    ignoreUntilUp = new Set();
  }

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  target.addEventListener('pointerleave', onLeave);
  target.addEventListener('wheel', onWheel, { passive: false });
  o.minimap.addEventListener('pointerdown', onMapDown);
  o.minimap.addEventListener('pointermove', onMapMove);
  o.minimap.addEventListener('pointerup', onMapUp);
  o.minimap.addEventListener('pointercancel', onMapUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    update(dt) {
      const s = o.session();
      // Camera: arrow keys, the screen edge, and a glide toward a jump target.
      let dx = 0;
      let dy = 0;
      if (held.has('ArrowLeft')) dx -= 1;
      if (held.has('ArrowRight')) dx += 1;
      if (held.has('ArrowUp')) dy -= 1;
      if (held.has('ArrowDown')) dy += 1;
      if (o.edgeScroll() && mouseInside && mouse !== null && (press === null || press.mode !== 'box')) {
        const edge = 6;
        if (mouse.client.x < edge) dx -= 1;
        if (mouse.client.x > window.innerWidth - edge) dx += 1;
        if (mouse.client.y < edge) dy -= 1;
        if (mouse.client.y > window.innerHeight - edge) dy += 1;
      }
      if (dx !== 0 || dy !== 0) {
        const length = Math.hypot(dx, dy);
        cam.x += (dx / length) * PAN_SPEED * cam.zoom * dt;
        cam.y += (dy / length) * PAN_SPEED * cam.zoom * dt;
        glide = null;
      }
      if (glide !== null) {
        const k = Math.min(1, dt * 9);
        cam.x += (glide.x - cam.x) * k;
        cam.y += (glide.y - cam.y) * k;
        if (Math.hypot(glide.x - cam.x, glide.y - cam.y) < 0.05) glide = null;
      }
      world.clampCamera();

      // What the mouse is over.
      if (s !== null && mouse !== null && mouseInside && press === null) {
        hover = pickAt(mouse.point, false)?.id ?? null;
        ground = groundAt(mouse.point) ?? ground;
        const enemy = hover !== null && s.match.byId.get(hover)?.owner !== s.player;
        const armed = selection(s).some((u) => u.owner === s.player && isUnit(u));
        target.style.cursor = s.mode.kind !== 'none' ? 'crosshair' : enemy && armed ? 'crosshair' : hover !== null ? 'pointer' : 'default';
      } else if (s === null) {
        target.style.cursor = 'default';
      }
    },

    hover: () => hover,
    box: () => box,
    pointer: () => ground,

    glideTo(x, y) {
      glide = { x, y };
    },

    dispose() {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      target.removeEventListener('pointerleave', onLeave);
      target.removeEventListener('wheel', onWheel);
      o.minimap.removeEventListener('pointerdown', onMapDown);
      o.minimap.removeEventListener('pointermove', onMapMove);
      o.minimap.removeEventListener('pointerup', onMapUp);
      o.minimap.removeEventListener('pointercancel', onMapUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.clearTimeout(press?.holdTimer);
    },
  };
}

