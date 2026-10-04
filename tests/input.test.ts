import { describe, expect, it } from 'vitest';
import { PointerInput, type Gesture } from '../src/engine/core/input';

/** A fake pointer event: Node's Event has read-only fields, so define each one explicitly. */
function pointerEvent(type: string, props: Record<string, unknown>): Event {
  const event = new Event(type);
  for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value, configurable: true });
  return event;
}

/** A stand-in window: an EventTarget that accepts our fake pointer events. */
function setup(area?: { contains: (node: unknown) => boolean }) {
  const win = new EventTarget();
  const input = new PointerInput(win as unknown as Window, area as unknown as HTMLElement);
  const gestures: Gesture[] = [];
  input.onGesture((g) => gestures.push(g));

  let clock = 0;
  const fire = (
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    x: number,
    y: number,
    extra: { pointerId?: number; isPrimary?: boolean; target?: unknown } = {},
  ): void => {
    win.dispatchEvent(
      pointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: extra.pointerId ?? 1,
        isPrimary: extra.isPrimary ?? true,
        timeStamp: (clock += 16),
        ...(extra.target !== undefined ? { target: extra.target } : {}),
      }),
    );
  };
  return { input, gestures, fire };
}

describe('PointerInput polling', () => {
  it('starts empty, then tracks x and y of the primary pointer', () => {
    const { input, fire } = setup();
    expect(input.clientX).toBeNull();
    expect(input.clientY).toBeNull();
    fire('pointermove', 10, 20);
    expect([input.clientX, input.clientY]).toEqual([10, 20]);
    fire('pointerdown', 30, 40);
    expect(input.isDown).toBe(true);
    fire('pointerup', 50, 60);
    expect(input.isDown).toBe(false);
    expect([input.clientX, input.clientY]).toEqual([50, 60]); // the last position sticks
  });

  it('ignores non-primary pointers (a second finger)', () => {
    const { input, gestures, fire } = setup();
    fire('pointerdown', 1, 2);
    fire('pointermove', 99, 99, { pointerId: 2, isPrimary: false });
    fire('pointerup', 99, 99, { pointerId: 2, isPrimary: false });
    expect([input.clientX, input.clientY]).toEqual([1, 2]);
    expect(input.isDown).toBe(true);
    expect(gestures.map((g) => g.phase)).toEqual(['start']);
  });
});

describe('PointerInput gestures', () => {
  it('reports a drag as start, moves, end with positions and pointer id', () => {
    const { gestures, fire } = setup();
    fire('pointerdown', 10, 10);
    fire('pointermove', 20, 15);
    fire('pointermove', 30, 20);
    fire('pointerup', 40, 25);
    expect(gestures.map((g) => [g.phase, g.clientX, g.clientY])).toEqual([
      ['start', 10, 10],
      ['move', 20, 15],
      ['move', 30, 20],
      ['end', 40, 25],
    ]);
    expect(new Set(gestures.map((g) => g.pointerId)).size).toBe(1);
    expect(gestures[3]!.timeStamp).toBeGreaterThan(gestures[0]!.timeStamp);
  });

  it('a mouse hovering without pressing is not a gesture', () => {
    const { gestures, fire } = setup();
    fire('pointermove', 5, 5);
    fire('pointermove', 6, 6);
    expect(gestures).toEqual([]);
  });

  it('a cancelled touch reports cancel, not end', () => {
    const { gestures, fire } = setup();
    fire('pointerdown', 1, 1);
    fire('pointercancel', 9, 9);
    expect(gestures.map((g) => g.phase)).toEqual(['start', 'cancel']);
  });

  it('only gestures that start inside the game area count', () => {
    const canvas = {};
    const button = {};
    const { gestures, fire } = setup({ contains: (node) => node === canvas });

    fire('pointerdown', 1, 1, { target: button }); // a tap on a DOM button over the game
    fire('pointermove', 2, 2);
    fire('pointerup', 3, 3);
    expect(gestures).toEqual([]);

    fire('pointerdown', 4, 4, { target: canvas });
    fire('pointermove', 5, 5, { target: button }); // moving over a button does not end it
    fire('pointerup', 6, 6, { target: button });
    expect(gestures.map((g) => g.phase)).toEqual(['start', 'move', 'end']);
  });

  it('a listener that throws does not break others or input tracking', () => {
    const { input, gestures, fire } = setup();
    input.onGesture(() => {
      throw new Error('bad listener');
    });
    const noise = console.error;
    console.error = () => {};
    try {
      fire('pointerdown', 7, 8);
    } finally {
      console.error = noise;
    }
    expect(gestures.map((g) => g.phase)).toEqual(['start']);
    expect(input.clientX).toBe(7);
  });

  it('unsubscribe and dispose stop events', () => {
    const win = new EventTarget();
    const input = new PointerInput(win as unknown as Window);
    const seen: string[] = [];
    const off = input.onGesture((g) => seen.push(g.phase));
    const press = (): void => {
      win.dispatchEvent(pointerEvent('pointerdown', { clientX: 1, clientY: 1, pointerId: 1, isPrimary: true, timeStamp: 1 }));
    };
    press();
    off();
    press();
    expect(seen).toEqual(['start']);
    input.dispose();
    press();
    expect(seen).toEqual(['start']);
  });
});
