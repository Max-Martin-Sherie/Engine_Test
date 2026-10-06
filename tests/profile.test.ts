import { describe, expect, it } from 'vitest';
import { BOT_COUNTS, FOV, SENSITIVITY, defaultProfile, parseProfile, serializeProfile } from '../src/game/profile';

describe('the saved profile', () => {
  it('starts with sensible defaults', () => {
    const p = defaultProfile();
    expect(p.settings.sensitivity).toBe(1);
    expect(p.settings.aimAssist).toBe(true);
    expect(p.settings.autoFire).toBe(false);
    expect(BOT_COUNTS).toContain(p.bots);
  });

  it('survives a round trip', () => {
    const p = defaultProfile();
    p.settings.sensitivity = 1.7;
    p.settings.leftHanded = true;
    p.settings.quality = 'low';
    p.mode = 'ffa';
    p.level = 'hard';
    p.bots = 9;
    p.seed = 42;
    p.kills = 120;
    p.best = 17;
    expect(parseProfile(serializeProfile(p))).toEqual(p);
  });

  it('gives the defaults for nothing, nonsense and the wrong shape', () => {
    expect(parseProfile(null)).toEqual(defaultProfile());
    expect(parseProfile('{not json')).toEqual(defaultProfile());
    expect(parseProfile('42')).toEqual(defaultProfile());
    expect(parseProfile('null')).toEqual(defaultProfile());
  });

  it('keeps every number in range', () => {
    const p = parseProfile(JSON.stringify({ settings: { sensitivity: 99, fov: 1 }, bots: 4, seed: -5, kills: 'many', best: 1e9 }));
    expect(p.settings.sensitivity).toBe(SENSITIVITY.max);
    expect(p.settings.fov).toBe(FOV.min);
    expect(p.bots).toBe(defaultProfile().bots);
    expect(p.seed).toBe(1);
    expect(p.kills).toBe(0);
    expect(p.best).toBe(1000);
    const q = parseProfile(JSON.stringify({ settings: { sensitivity: 0, fov: 500 } }));
    expect(q.settings.sensitivity).toBe(SENSITIVITY.min);
    expect(q.settings.fov).toBe(FOV.max);
  });

  it('ignores unknown choices', () => {
    const p = parseProfile(JSON.stringify({ mode: 'duel', level: 'nightmare', settings: { quality: 'ultra' } }));
    expect(p.mode).toBe('tdm');
    expect(p.level).toBe('normal');
    expect(p.settings.quality).toBe('auto');
  });
});
