import { WORLD, type WorldSize } from '../core/config';
import { fitWorld } from '../core/layout';
import './base.css';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface StageLayout {
  /** Position and size of the stage in CSS pixels: exactly the letterboxed play field. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** CSS pixels per world unit, for sizing UI in the same units as the game. */
  unit: number;
  /** Safe-area insets that actually reach into the stage (bars already absorb part of them). */
  insets: Insets;
}

/**
 * Where the stage goes inside a `width` x `height` window, given the device's safe-area insets.
 * Only the part of an inset that the stage actually reaches into matters: the letterbox bars
 * absorb the rest.
 */
export function computeStageLayout(
  width: number,
  height: number,
  safe: Insets,
  world: WorldSize = WORLD,
): StageLayout {
  const fit = fitWorld(width, height, world);
  const reach = (inset: number, bar: number): number => Math.max(0, inset - bar);
  return {
    left: fit.offsetX,
    top: fit.offsetY,
    width: world.width * fit.scale,
    height: world.height * fit.scale,
    unit: fit.scale,
    insets: {
      top: reach(safe.top, fit.offsetY),
      bottom: reach(safe.bottom, fit.offsetY),
      left: reach(safe.left, fit.offsetX),
      right: reach(safe.right, fit.offsetX),
    },
  };
}

export interface Stage {
  /**
   * A positioned element covering exactly the play field. Put your screens and HUD inside it.
   * CSS variables on it: --u (one world unit in px), --inset-top/right/bottom/left (px).
   */
  readonly element: HTMLElement;
}

/**
 * Builds the stage inside `root` (a full-window element, e.g. #ui) and keeps it aligned with the
 * letterboxed canvas. It adds no visuals; styling is up to the game. `root` ignores pointer
 * events, so give your own interactive elements `pointer-events: auto`.
 */
export function createStage(root: HTMLElement): Stage {
  root.classList.add('ui-root');

  // Reads the device's safe-area insets as pixels. Capacitor's SystemBars plugin exposes them as
  // --safe-area-inset-* on Android, where env() is unreliable; iOS and browsers provide env().
  const probe = document.createElement('div');
  probe.className = 'safe-probe';
  const element = document.createElement('div');
  element.className = 'stage';
  root.append(probe, element);

  function layout(): void {
    const style = getComputedStyle(probe);
    const px = (value: string): number => Number.parseFloat(value) || 0;
    const result = computeStageLayout(root.clientWidth, root.clientHeight, {
      top: px(style.paddingTop),
      right: px(style.paddingRight),
      bottom: px(style.paddingBottom),
      left: px(style.paddingLeft),
    });
    element.style.left = `${result.left}px`;
    element.style.top = `${result.top}px`;
    element.style.width = `${result.width}px`;
    element.style.height = `${result.height}px`;
    element.style.setProperty('--u', `${result.unit}px`);
    element.style.setProperty('--inset-top', `${result.insets.top}px`);
    element.style.setProperty('--inset-right', `${result.insets.right}px`);
    element.style.setProperty('--inset-bottom', `${result.insets.bottom}px`);
    element.style.setProperty('--inset-left', `${result.insets.left}px`);
  }
  new ResizeObserver(layout).observe(root);
  window.addEventListener('resize', layout);
  layout();

  return { element };
}
