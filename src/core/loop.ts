export interface LoopCallbacks {
  /** Called zero or more times per frame with the fixed step, in seconds. */
  update(dt: number): void;
  /** Called once per frame. alpha in [0, 1) is how far we are into the next fixed step. */
  render(alpha: number): void;
}

export interface LoopOptions {
  /** Fixed step in seconds. */
  step: number;
  /** Longest frame we will simulate, in seconds. Longer frames (tab switch, debugger) are clamped. */
  maxFrameTime?: number;
}

/**
 * Fixed-timestep loop with an accumulator. `frame()` holds all the logic and takes the clock as
 * an argument, so it can be driven from tests; `start()` just feeds it from requestAnimationFrame.
 */
export class FixedLoop {
  private readonly step: number;
  private readonly maxFrameTime: number;
  private accumulator = 0;
  private lastTime: number | null = null;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly callbacks: LoopCallbacks,
    options: LoopOptions,
  ) {
    this.step = options.step;
    this.maxFrameTime = options.maxFrameTime ?? 0.25;
  }

  /** Runs one frame at time `nowMs` (a DOMHighResTimeStamp-style millisecond clock). */
  frame(nowMs: number): void {
    if (this.lastTime === null) this.lastTime = nowMs;
    const frameTime = Math.min(Math.max((nowMs - this.lastTime) / 1000, 0), this.maxFrameTime);
    this.lastTime = nowMs;

    this.accumulator += frameTime;
    while (this.accumulator >= this.step) {
      this.callbacks.update(this.step);
      this.accumulator -= this.step;
    }
    this.callbacks.render(this.accumulator / this.step);
  }

  /** Forget the previous timestamp, e.g. after the page was hidden, so the next frame has dt 0. */
  resetClock(): void {
    this.lastTime = null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resetClock();
    const tick = (now: number): void => {
      if (!this.running) return;
      // Schedule first so one thrown error does not kill the loop for good.
      this.rafId = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
