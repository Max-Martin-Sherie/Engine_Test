import { describe, expect, it } from 'vitest';
import { defaultProfile, parseProfile, serializeProfile } from '../src/game/profile';

describe('the saved profile', () => {
  it('starts with sound on, normal opponents and nothing played', () => {
    expect(parseProfile(null)).toEqual(defaultProfile());
    expect(defaultProfile()).toMatchObject({ level: 'normal', wins: 0, played: 0, helped: false, settings: { sound: true, haptics: true, edgeScroll: false, bars: false } });
  });

  it('survives a round trip', () => {
    const p = { ...defaultProfile(), level: 'hard' as const, seed: 77, wins: 3, played: 9, helped: true, settings: { sound: false, haptics: true, edgeScroll: true, bars: true } };
    expect(parseProfile(serializeProfile(p))).toEqual(p);
  });

  it('never throws on rubbish, and falls back to the defaults', () => {
    for (const raw of ['', 'not json', '[]', 'null', '42', '{"settings": 7}', '{"level": "impossible", "wins": "many"}']) {
      expect(() => parseProfile(raw)).not.toThrow();
      expect(parseProfile(raw).level).toBe('normal');
      expect(parseProfile(raw).wins).toBe(0);
    }
  });

  it('keeps numbers sensible', () => {
    const p = parseProfile(JSON.stringify({ seed: -5, wins: -3, played: 1e12, level: 'easy' }));
    expect(p.seed).toBe(1);
    expect(p.wins).toBe(0);
    expect(p.played).toBe(1_000_000);
    expect(p.level).toBe('easy');
  });
});
