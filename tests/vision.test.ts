import { describe, expect, it } from 'vitest';
import { UNITS, canSee, cmdMove, fogAt, updateVision } from '../src/game/sim/testing';
import { ARENA, building, find, quiet, run, unit } from './helpers/world';

const { x: X, y: Y } = ARENA;

describe('fog of war', () => {
  it('each side sees its own start and not the other\'s', () => {
    const m = quiet(1);
    const a = find(m, 'hub', 0)!;
    const b = find(m, 'hub', 1)!;
    expect(fogAt(m, 0, a.x, a.y)).toBe(2);
    expect(fogAt(m, 0, b.x, b.y)).toBe(0);
    expect(fogAt(m, 1, b.x, b.y)).toBe(2);
    expect(fogAt(m, 1, a.x, a.y)).toBe(0);
    expect(fogAt(m, 0, -5, 3)).toBe(0);
    expect(fogAt(m, 0, 500, 3)).toBe(0);
  });

  it('a unit lights up a disc of its sight radius', () => {
    const m = quiet(1, true);
    const t = unit(m, 'trooper', 0, X + 0.5, Y + 0.5);
    const r = UNITS.trooper.vision;
    expect(fogAt(m, 0, X + 0.5 + r - 1, Y + 0.5)).toBe(2);
    expect(fogAt(m, 0, X + 0.5, Y + 0.5 - r + 1)).toBe(2);
    expect(fogAt(m, 0, X + 0.5 + r + 2, Y + 0.5)).toBe(0);
    expect(fogAt(m, 0, X + 0.5 + r, Y + 0.5 + r)).toBe(0); // the corner of the square is outside the circle
    expect(fogAt(m, 1, X + 0.5, Y + 0.5)).toBe(0);
    expect(t.alive).toBe(true);
  });

  it('remembers what was seen: ground left behind goes dim but is not forgotten', () => {
    const m = quiet(1, true);
    const t = unit(m, 'trooper', 0, X, Y);
    expect(fogAt(m, 0, X, Y)).toBe(2);
    cmdMove(m, 0, [t.id], X + 30, Y);
    run(m, 12);
    expect(t.x).toBeGreaterThan(X + 20);
    expect(fogAt(m, 0, X, Y)).toBe(1);
    expect(fogAt(m, 0, t.x, t.y)).toBe(2);
    expect(fogAt(m, 0, X - 30, Y)).toBe(0);
  });

  it('shows enemy units only while in sight, and buildings and resources once the ground has been seen', () => {
    const m = quiet(1, true);
    const scout = unit(m, 'worker', 0, X, Y);
    const enemy = unit(m, 'trooper', 1, X + 4, Y);
    const enemyDepot = building(m, 'depot', 1, X + 5, Y + 4);
    const patch = m.entities.find((e) => e.type === 'minerals')!;
    expect(canSee(m, 0, enemy)).toBe(true);
    expect(canSee(m, 0, enemyDepot)).toBe(true);
    expect(canSee(m, 0, scout)).toBe(true); // always your own
    // The scout leaves: the unit hides, the building stays on the map as it was last seen.
    scout.x = X - 40;
    updateVision(m);
    expect(fogAt(m, 0, enemy.x, enemy.y)).toBe(1);
    expect(canSee(m, 0, enemy)).toBe(false);
    expect(canSee(m, 0, enemyDepot)).toBe(true);
    // Ground never seen shows nothing.
    const hidden = unit(m, 'worker', 1, 80, 20);
    const hiddenDepot = building(m, 'depot', 1, 80, 24);
    expect(canSee(m, 0, hidden)).toBe(false);
    expect(canSee(m, 0, hiddenDepot)).toBe(false);
    expect(typeof canSee(m, 0, patch)).toBe('boolean');
  });

  it('a building going up sees a little, and a finished one sees its full radius', () => {
    const m = quiet(1, true);
    const site = building(m, 'barracks', 0, X + 0.5, Y + 0.5, false);
    expect(fogAt(m, 0, X + 0.5 + 6, Y + 0.5)).toBe(0);
    expect(fogAt(m, 0, X + 0.5 + 3, Y + 0.5)).toBe(2);
    site.progress = 1;
    updateVision(m);
    expect(fogAt(m, 0, X + 0.5 + 6, Y + 0.5)).toBe(2);
  });

  it('a dead unit stops seeing', () => {
    const m = quiet(1, true);
    const t = unit(m, 'trooper', 0, X, Y);
    t.alive = false;
    updateVision(m);
    updateVision(m);
    expect(fogAt(m, 0, X, Y)).toBe(1);
  });
});
