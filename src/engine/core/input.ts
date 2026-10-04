/**
 * Pointer input in client (CSS pixel) space. It knows nothing about the game world; whoever owns
 * the view converts client space to world space.
 *
 * Two ways to use it:
 *  - polling: `clientX` / `clientY` are the primary pointer's last position. A mouse updates them
 *    whenever it moves; a finger while it drags (and the last position sticks after lifting).
 *  - gestures: `onGesture` reports a drag as start -> move... -> end (or cancel). A gesture only
 *    starts when the press began inside `gestureArea`, so taps on DOM buttons laid over the game
 *    never become gestures.
 */

export interface Gesture {
  phase: 'start' | 'move' | 'end' | 'cancel';
  clientX: number;
  clientY: number;
  pointerId: number;
  /** Event time in ms (performance.now() clock). */
  timeStamp: number;
}

export type GestureListener = (gesture: Gesture) => void;

export class PointerInput {
  private x: number | null = null;
  private y: number | null = null;
  private down = false;
  private activePointer: number | null = null;
  private readonly listeners = new Set<GestureListener>();

  /**
   * @param target where pointer events are listened for (the window)
   * @param gestureArea only presses that start inside this element begin a gesture; default: anywhere
   */
  constructor(
    private readonly target: Window = window,
    private readonly gestureArea?: Pick<HTMLElement, 'contains'>,
  ) {
    target.addEventListener('pointerdown', this.onDown, { passive: true });
    target.addEventListener('pointermove', this.onMove, { passive: true });
    target.addEventListener('pointerup', this.onUp, { passive: true });
    target.addEventListener('pointercancel', this.onUp, { passive: true });
  }

  /** Last known pointer x in client space, or null before the first pointer event. */
  get clientX(): number | null {
    return this.x;
  }

  get clientY(): number | null {
    return this.y;
  }

  get isDown(): boolean {
    return this.down;
  }

  /** Subscribes to gestures. Returns the unsubscribe function. */
  onGesture(listener: GestureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('pointercancel', this.onUp);
    this.listeners.clear();
  }

  private emit(phase: Gesture['phase'], e: PointerEvent): void {
    const gesture: Gesture = {
      phase,
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
      timeStamp: e.timeStamp,
    };
    for (const listener of [...this.listeners]) {
      try {
        listener(gesture);
      } catch (error) {
        console.error('Gesture listener failed', error);
      }
    }
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.down = true;
    this.x = e.clientX;
    this.y = e.clientY;
    const inside = this.gestureArea === undefined || (e.target !== null && this.gestureArea.contains(e.target as Node));
    if (inside) {
      this.activePointer = e.pointerId;
      this.emit('start', e);
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.x = e.clientX;
    this.y = e.clientY;
    if (this.activePointer === e.pointerId) this.emit('move', e);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.down = false;
    const ended = e.type === 'pointerup';
    if (ended) {
      this.x = e.clientX;
      this.y = e.clientY;
    }
    if (this.activePointer === e.pointerId) {
      this.activePointer = null;
      this.emit(ended ? 'end' : 'cancel', e);
    }
  };
}
