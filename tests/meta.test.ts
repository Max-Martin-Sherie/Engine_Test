import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/sim/config';
import {
  buySkin,
  defaultProfile,
  earn,
  equipSkin,
  parseProfile,
  recordBest,
  serializeProfile,
  setSetting,
  spend,
} from '../src/game/sim/profile';
import {
  BLADE_SHAPES,
  BUNDLED_SKINS,
  bladeOutline,
  mergeCatalogs,
  parseCatalog,
  parseSkin,
  type Skin,
} from '../src/game/sim/skins';

const steel = BUNDLED_SKINS[0]!;
const ember = BUNDLED_SKINS.find((s) => s.id === 'ember')!;
const gold = BUNDLED_SKINS.find((s) => s.id === 'gold')!;

const validSkin = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'test-skin',
  name: 'Test',
  rarity: 'rare',
  price: 250,
  blade: { color: '#112233', edge: '#fff', shape: 'curved' },
  handle: { color: '#000000', accent: '#ff00ff' },
  trail: { color: '#00ff00', glow: '#0000ff', width: 4 },
  sparks: { color: '#ffffff' },
  ...over,
});

describe('profile', () => {
  it('a new player owns and wears the default skin, with an empty wallet', () => {
    const p = defaultProfile();
    expect(p).toMatchObject({ coins: CONFIG.startCoins, owned: [CONFIG.defaultSkin], equipped: CONFIG.defaultSkin });
    expect(p.best).toEqual({ classic: 0, arcade: 0, survival: 0 });
    expect(p.settings).toEqual({ sound: true, haptics: true });
  });

  it('survives a save and load unchanged', () => {
    let p = earn(defaultProfile(), 500);
    const bought = buySkin(p, ember);
    if (!bought.ok) throw new Error('should afford');
    p = setSetting(recordBest(bought.profile, 'arcade', 4321).profile, 'sound', false);
    expect(parseProfile(serializeProfile(p))).toEqual(p);
  });

  it('missing, corrupt or non-object data falls back to a fresh profile', () => {
    for (const raw of [null, '', 'not json', '[1,2]', '42', '"x"', 'null']) {
      expect(parseProfile(raw)).toEqual(defaultProfile());
    }
  });

  it('repairs tampered or partial data field by field instead of losing everything', () => {
    const p = parseProfile(
      JSON.stringify({
        coins: -50,
        owned: ['ember', 7, '', 'x'.repeat(99), 'ember'],
        equipped: 'gold', // not owned
        best: { classic: 'lots', arcade: 880.9 },
        settings: { sound: 'yes', haptics: false },
      }),
    );
    expect(p.coins).toBe(0);
    expect(p.owned).toEqual([CONFIG.defaultSkin, 'ember']);
    expect(p.equipped).toBe(CONFIG.defaultSkin);
    expect(p.best).toEqual({ classic: 0, arcade: 880, survival: 0 });
    expect(p.settings).toEqual({ sound: true, haptics: false });
    expect(parseProfile('{"coins": 1e999}').coins).toBe(0); // Infinity is not a wallet
    expect(parseProfile('{"coins": 12.7}').coins).toBe(12);
  });

  it('always owns the default skin, even if the save says otherwise', () => {
    expect(parseProfile('{"owned":["ember"],"equipped":"ember"}').owned).toContain(CONFIG.defaultSkin);
  });

  it('earning adds coins; spending takes them or refuses; neither mutates', () => {
    const p = defaultProfile();
    const rich = earn(p, 100);
    expect(rich.coins).toBe(100);
    expect(p.coins).toBe(0);
    expect(earn(rich, -5).coins).toBe(100);
    expect(earn(rich, Number.NaN).coins).toBe(100);
    expect(spend(rich, 30)?.coins).toBe(70);
    expect(spend(rich, 100)?.coins).toBe(0);
    expect(spend(rich, 101)).toBeNull();
    expect(spend(rich, 0)).toEqual(rich);
    expect(rich.coins).toBe(100);
  });

  it('buying needs enough coins, takes them, adds the skin once, and does not equip it', () => {
    const poor = buySkin(earn(defaultProfile(), ember.price - 1), ember);
    expect(poor).toEqual({ ok: false, reason: 'poor' });

    const funded = earn(defaultProfile(), ember.price + 5);
    const bought = buySkin(funded, ember);
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.profile.coins).toBe(5);
    expect(bought.profile.owned).toEqual([CONFIG.defaultSkin, 'ember']);
    expect(bought.profile.equipped).toBe(CONFIG.defaultSkin);
    expect(funded.owned).toEqual([CONFIG.defaultSkin]);

    expect(buySkin(bought.profile, ember)).toEqual({ ok: false, reason: 'owned' });
    expect(buySkin(earn(defaultProfile(), 0), steel)).toEqual({ ok: false, reason: 'owned' }); // the free default
  });

  it('equipping needs ownership', () => {
    const p = defaultProfile();
    expect(equipSkin(p, 'gold')).toBeNull();
    const own = buySkin(earn(p, gold.price), gold);
    if (!own.ok) throw new Error('should afford');
    expect(equipSkin(own.profile, 'gold')?.equipped).toBe('gold');
    expect(equipSkin(own.profile, CONFIG.defaultSkin)?.equipped).toBe(CONFIG.defaultSkin);
  });

  it('records a best only when it is beaten, per mode', () => {
    const p = defaultProfile();
    const first = recordBest(p, 'classic', 500);
    expect(first).toMatchObject({ isNewBest: true });
    expect(first.profile.best).toEqual({ classic: 500, arcade: 0, survival: 0 });
    expect(recordBest(first.profile, 'classic', 500).isNewBest).toBe(false);
    expect(recordBest(first.profile, 'classic', 100).profile).toBe(first.profile);
    expect(recordBest(first.profile, 'arcade', 50).profile.best).toEqual({ classic: 500, arcade: 50, survival: 0 });
    expect(recordBest(first.profile, 'survival', 70).profile.best).toEqual({ classic: 500, arcade: 0, survival: 70 });
  });

  it('settings toggle independently', () => {
    const p = setSetting(setSetting(defaultProfile(), 'sound', false), 'haptics', false);
    expect(p.settings).toEqual({ sound: false, haptics: false });
    expect(setSetting(p, 'sound', true).settings).toEqual({ sound: true, haptics: false });
  });
});

describe('skins: the bundled catalog', () => {
  it('is valid, unique, cosmetic data with a free default', () => {
    const parsed = parseCatalog({ skins: BUNDLED_SKINS });
    expect(parsed.errors).toEqual([]);
    expect(parsed.skins).toEqual(BUNDLED_SKINS);
    expect(new Set(BUNDLED_SKINS.map((s) => s.id)).size).toBe(BUNDLED_SKINS.length);
    const def = BUNDLED_SKINS.find((s) => s.id === CONFIG.defaultSkin);
    expect(def?.price).toBe(0);
  });

  it('has a spread of rarities with prices that rise with rarity', () => {
    const rank = { common: 0, rare: 1, epic: 2, legendary: 3 } as const;
    const priceOf = (rarity: keyof typeof rank): number[] => BUNDLED_SKINS.filter((s) => s.rarity === rarity).map((s) => s.price);
    for (const r of ['common', 'rare', 'epic', 'legendary'] as const) expect(priceOf(r).length).toBeGreaterThan(0);
    expect(Math.max(...priceOf('rare'))).toBeLessThan(Math.min(...priceOf('epic')));
    expect(Math.max(...priceOf('epic'))).toBeLessThan(Math.min(...priceOf('legendary')));
    expect(rank.legendary).toBeGreaterThan(rank.common);
  });
});

describe('skins: validating untrusted catalogs', () => {
  it('accepts a good entry and normalises it (short hex expanded, lower-cased, trimmed name, clamped width)', () => {
    const parsed = parseSkin(validSkin({ name: '  Test  ', blade: { color: '#ABC', edge: '#FFFFFF', shape: 'cleaver' }, trail: { color: '#00FF00', glow: '#0000ff', width: 99 } }));
    expect(parsed).toHaveProperty('skin');
    if ('skin' in parsed) {
      expect(parsed.skin.name).toBe('Test');
      expect(parsed.skin.blade).toEqual({ color: '#aabbcc', edge: '#ffffff', shape: 'cleaver' });
      expect(parsed.skin.trail.width).toBe(8);
    }
    const noWidth = parseSkin(validSkin({ trail: { color: '#00ff00', glow: '#0000ff' } }));
    expect('skin' in noWidth && noWidth.skin.trail.width).toBe(3);
  });

  it('rejects every kind of bad entry, with a reason, and never throws', () => {
    const bad: [string, unknown][] = [
      ['not an object', 'skin'],
      ['null', null],
      ['array', []],
      ['no id', validSkin({ id: undefined })],
      ['uppercase id', validSkin({ id: 'Bad' })],
      ['id with a slash', validSkin({ id: '../evil' })],
      ['id too long', validSkin({ id: 'a'.repeat(40) })],
      ['empty name', validSkin({ name: '   ' })],
      ['long name', validSkin({ name: 'x'.repeat(33) })],
      ['unknown rarity', validSkin({ rarity: 'mythic' })],
      ['negative price', validSkin({ price: -1 })],
      ['fractional price', validSkin({ price: 9.5 })],
      ['string price', validSkin({ price: '100' })],
      ['absurd price', validSkin({ price: 1e9 })],
      ['bad blade shape', validSkin({ blade: { color: '#000000', edge: '#ffffff', shape: 'sword' } })],
      ['bad colour', validSkin({ handle: { color: 'red', accent: '#ffffff' } })],
      ['css injection in a colour', validSkin({ trail: { color: '#fff;background:url(x)', glow: '#fff', width: 3 } })],
      ['missing block', validSkin({ sparks: undefined })],
    ];
    for (const [label, entry] of bad) {
      const result = parseSkin(entry);
      expect(result, label).toHaveProperty('error');
    }
  });

  it('a catalog drops bad entries and duplicates but keeps the good ones', () => {
    const parsed = parseCatalog({
      version: 1,
      skins: [validSkin({ id: 'one' }), validSkin({ id: 'bad', price: -3 }), validSkin({ id: 'one', name: 'Again' }), validSkin({ id: 'two' })],
    });
    expect(parsed.skins.map((s) => s.id)).toEqual(['one', 'two']);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.skins[0]!.name).toBe('Test'); // the first duplicate wins
  });

  it('accepts a bare array, and rejects anything that is not a catalog', () => {
    expect(parseCatalog([validSkin()]).skins).toHaveLength(1);
    for (const junk of [null, 5, 'x', {}, { skins: 'no' }, { skins: null }]) {
      const parsed = parseCatalog(junk);
      expect(parsed.skins).toEqual([]);
      expect(parsed.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('skins: merging an online catalog', () => {
  const online = (over: Record<string, unknown>): Skin => {
    const parsed = parseSkin(validSkin(over));
    if (!('skin' in parsed)) throw new Error('bad test skin');
    return parsed.skin;
  };

  it('online skins add to the bundled ones and replace those with the same id', () => {
    const merged = mergeCatalogs(BUNDLED_SKINS, [online({ id: 'brand-new' }), online({ id: 'ember', name: 'Ember v2', price: 999 })]);
    expect(merged).toHaveLength(BUNDLED_SKINS.length + 1);
    expect(merged.find((s) => s.id === 'brand-new')).toBeDefined();
    expect(merged.find((s) => s.id === 'ember')).toMatchObject({ name: 'Ember v2', price: 999 });
  });

  it('the default skin always exists and is always free, whatever the online catalog says', () => {
    const merged = mergeCatalogs(BUNDLED_SKINS, [online({ id: CONFIG.defaultSkin, price: 500, name: 'Pricey' })]);
    const def = merged.find((s) => s.id === CONFIG.defaultSkin);
    expect(def).toBeDefined();
    expect(def?.price).toBe(0);
    expect(mergeCatalogs([], []).find((s) => s.id === CONFIG.defaultSkin)).toBeDefined();
  });
});

describe('blade outlines', () => {
  it('every shape fits the 100 x 28 box and has a point at the tip', () => {
    for (const shape of BLADE_SHAPES) {
      const pts = bladeOutline(shape);
      expect(pts.length, shape).toBeGreaterThanOrEqual(4);
      for (const [x, y] of pts) {
        expect(x, shape).toBeGreaterThanOrEqual(0);
        expect(x, shape).toBeLessThanOrEqual(100);
        expect(y, shape).toBeGreaterThanOrEqual(0);
        expect(y, shape).toBeLessThanOrEqual(28);
      }
      expect(Math.max(...pts.map(([x]) => x)), shape).toBe(100);
    }
  });
});
