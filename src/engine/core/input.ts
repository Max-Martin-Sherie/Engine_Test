/**
 * Tracks where the primary pointer is, in client (CSS pixel) space. It knows nothing about the
 * game world; whoever owns the view converts client space to world space.
 *
 * A mouse steers whenever it moves; a finger steers while it drags and the last position sticks
 * after lifting.
 */
export class PointerInput {
  private x: number | null = null;
  private down = false;

  constructor(private readonly target: Window = window) {
    target.addEventListener('pointerdown', this.onDown, { passive: true });
    target.addEventListener('pointermove', this.onMove, { passive: true });
    target.addEventListener('pointerup', this.onUp, { passive: true });
    target.addEventListener('pointercancel', this.onUp, { passive: true });
  }

  /** Last known pointer x in client space, or null before the first pointer event. */
  get clientX(): number | null {
    return this.x;
  }

  get isDown(): boolean {
    return this.down;
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('pointercancel', this.onUp);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.down = true;
    this.x = e.clientX;
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.x = e.clientX;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.down = false;
    if (e.type === 'pointerup') this.x = e.clientX;
  };
}
