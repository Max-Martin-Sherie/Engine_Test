import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANDROID_TEST_APP_ID,
  ATT_DESCRIPTION,
  IOS_TEST_APP_ID,
  SKADNETWORK_GOOGLE,
  patchAndroidManifest,
  patchAndroidStrings,
  patchInfoPlist,
  setupNative,
} from '../scripts/setup-native.mjs';

/** Fixtures are templates as Capacitor generates them (LF). Git on Windows may check them out as CRLF. */
const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8').replace(/\r\n/g, '\n');
const MANIFEST = fixture('android-template-AndroidManifest.xml');
const STRINGS = fixture('android-template-strings.xml');
const PLIST = fixture('ios-template-Info.plist');

const count = (text: string, needle: string): number => text.split(needle).length - 1;

/** Cheap structural sanity check: every opened element is closed. */
function expectBalanced(xml: string, tags: string[]): void {
  for (const tag of tags) {
    const opened = xml.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0;
    expect(opened, tag).toBeGreaterThan(0);
    expect(opened, tag).toBe(count(xml, `</${tag}>`));
  }
}

describe('Android manifest', () => {
  const patched = patchAndroidManifest(MANIFEST);

  it('declares the AdMob app ID as a string reference, inside <application>', () => {
    const app = patched.slice(patched.indexOf('<application'), patched.indexOf('</application>'));
    expect(app).toContain('android:name="com.google.android.gms.ads.APPLICATION_ID"');
    expect(app).toContain('android:value="@string/admob_app_id"');
    expect(count(patched, 'com.google.android.gms.ads.APPLICATION_ID')).toBe(1);
  });

  it('locks MainActivity to portrait without disturbing its other attributes', () => {
    const activity = /<activity\b[^>]*>/.exec(patched)?.[0] ?? '';
    expect(activity).toContain('android:screenOrientation="portrait"');
    expect(count(activity, 'screenOrientation')).toBe(1);
    expect(activity).toContain('android:name=".MainActivity"');
    expect(activity).toContain('android:exported="true"');
    expect(activity).toContain('android:launchMode="singleTask"');
  });

  it('keeps the rest of the file intact', () => {
    expect(patched).toContain('<uses-permission android:name="android.permission.INTERNET" />');
    expect(patched).toContain('android.support.FILE_PROVIDER_PATHS');
    expectBalanced(patched, ['application', 'activity', 'provider', 'manifest']);
  });

  it('is idempotent', () => {
    expect(patchAndroidManifest(patched)).toBe(patched);
  });

  it('corrects a different orientation and leaves an existing app ID entry alone', () => {
    const landscape = MANIFEST.replace('android:launchMode', 'android:screenOrientation="landscape"\n            android:launchMode');
    const fixed = patchAndroidManifest(landscape);
    expect(fixed).toContain('android:screenOrientation="portrait"');
    expect(fixed).not.toContain('landscape');

    const custom = patched.replace('@string/admob_app_id', '@string/my_real_id');
    expect(patchAndroidManifest(custom)).toBe(custom);
  });

  it('fails loudly when the manifest is not what we expect', () => {
    expect(() => patchAndroidManifest('<manifest></manifest>')).toThrow(/application/);
    expect(() => patchAndroidManifest('<manifest><application></application></manifest>')).toThrow(/MainActivity/);
  });
});

describe('Android strings', () => {
  it('adds the Google test app ID once', () => {
    const patched = patchAndroidStrings(STRINGS, ANDROID_TEST_APP_ID, false);
    expect(patched).toContain(`<string name="admob_app_id">${ANDROID_TEST_APP_ID}</string>`);
    expect(count(patched, 'admob_app_id')).toBe(1);
    expect(patched).toContain('<string name="app_name">Rockfall</string>');
    expect(patchAndroidStrings(patched, ANDROID_TEST_APP_ID, false)).toBe(patched);
  });

  it('only replaces an existing value when asked to', () => {
    const real = 'ca-app-pub-1234567890123456~1234567890';
    const patched = patchAndroidStrings(STRINGS, ANDROID_TEST_APP_ID, false);
    expect(patchAndroidStrings(patched, real, false)).toBe(patched);
    const replaced = patchAndroidStrings(patched, real, true);
    expect(replaced).toContain(real);
    expect(replaced).not.toContain(ANDROID_TEST_APP_ID);
    expect(count(replaced, 'admob_app_id')).toBe(1);
  });
});

describe('iOS Info.plist', () => {
  const patched = patchInfoPlist(PLIST);

  it('adds the AdMob app ID, the ATT text and the Google SKAdNetwork ID', () => {
    expect(patched).toMatch(
      new RegExp(`<key>GADApplicationIdentifier</key>\\s*<string>${IOS_TEST_APP_ID}</string>`),
    );
    expect(patched).toMatch(
      new RegExp(`<key>NSUserTrackingUsageDescription</key>\\s*<string>${ATT_DESCRIPTION}</string>`),
    );
    expect(patched).toMatch(
      new RegExp(
        `<key>SKAdNetworkItems</key>\\s*<array>\\s*<dict>\\s*<key>SKAdNetworkIdentifier</key>\\s*<string>${SKADNETWORK_GOOGLE.replace('.', '\\.')}</string>\\s*</dict>\\s*</array>`,
      ),
    );
  });

  it('limits iPhone to portrait and leaves iPad alone', () => {
    expect(patched).toMatch(
      /<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<\/array>/,
    );
    const ipad = (xml: string) => /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>[\s\S]*?<\/array>/.exec(xml)?.[0];
    expect(ipad(patched)).toBeDefined();
    expect(ipad(patched)).toBe(ipad(PLIST));
  });

  it('keeps every original key and stays well-formed', () => {
    for (const key of [...PLIST.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])) {
      expect(patched, String(key)).toContain(`<key>${key}</key>`);
    }
    expectBalanced(patched, ['dict', 'array', 'plist']);
    expect(patched.trimEnd().endsWith('</plist>')).toBe(true);
  });

  it('is idempotent', () => {
    expect(patchInfoPlist(patched)).toBe(patched);
  });

  it('adds our SKAdNetwork ID to an existing list, once', () => {
    const withOther = PLIST.replace(
      '</dict>\n</plist>',
      '\t<key>SKAdNetworkItems</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>example.skadnetwork</string>\n\t\t</dict>\n\t</array>\n</dict>\n</plist>',
    );
    const out = patchInfoPlist(withOther);
    expect(out).toContain('example.skadnetwork');
    expect(count(out, SKADNETWORK_GOOGLE)).toBe(1);
    expectBalanced(out, ['dict', 'array']);
    expect(patchInfoPlist(out)).toBe(out);
  });

  it('only replaces an existing app ID when told to', () => {
    const real = 'ca-app-pub-1234567890123456~1234567890';
    expect(patchInfoPlist(patched, { appId: real })).toBe(patched);
    const replaced = patchInfoPlist(patched, { appId: real, overwriteAppId: true });
    expect(replaced).toContain(real);
    expect(replaced).not.toContain(IOS_TEST_APP_ID);
  });

  it('preserves CRLF line endings', () => {
    const crlf = patchInfoPlist(PLIST.replace(/\n/g, '\r\n'));
    expect(crlf).not.toMatch(/(?<!\r)\n/);
    expect(patchInfoPlist(crlf)).toBe(crlf);
  });
});

describe('setupNative (on a copy of the generated templates)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'native-setup-test-'));
    dirs.push(root);
    const files: Record<string, string> = {
      'android/app/src/main/AndroidManifest.xml': MANIFEST,
      'android/app/src/main/res/values/strings.xml': STRINGS,
      'ios/App/App/Info.plist': PLIST,
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }
  const quiet = { log: () => {} };

  it('android: the second run changes nothing', () => {
    const root = project();
    const read = () => [
      readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8'),
      readFileSync(join(root, 'android/app/src/main/res/values/strings.xml'), 'utf8'),
    ];
    expect(setupNative('android', { root, env: {}, ...quiet })).toBe(true);
    const afterFirst = read();
    expect(afterFirst[0]).toContain('admob_app_id');
    expect(setupNative('android', { root, env: {}, ...quiet })).toBe(false);
    expect(read()).toEqual(afterFirst);
  });

  it('ios: the second run changes nothing', () => {
    const root = project();
    const file = join(root, 'ios/App/App/Info.plist');
    expect(setupNative('ios', { root, env: {}, ...quiet })).toBe(true);
    const afterFirst = readFileSync(file, 'utf8');
    expect(setupNative('ios', { root, env: {}, ...quiet })).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(afterFirst);
  });

  it('uses real app IDs from env, validates them, and updates on re-run', () => {
    const root = project();
    const real = 'ca-app-pub-1234567890123456~1234567890';
    setupNative('android', { root, env: {}, ...quiet });
    expect(setupNative('android', { root, env: { ADMOB_APP_ID_ANDROID: real }, ...quiet })).toBe(true);
    const strings = readFileSync(join(root, 'android/app/src/main/res/values/strings.xml'), 'utf8');
    expect(strings).toContain(real);
    // Without the override a real ID that is already there is left alone.
    expect(setupNative('android', { root, env: {}, ...quiet })).toBe(false);
    expect(() => setupNative('android', { root, env: { ADMOB_APP_ID_ANDROID: 'nope' }, ...quiet })).toThrow(/ADMOB_APP_ID_ANDROID/);
  });

  it('explains what to do when the platform has not been added yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'native-setup-empty-'));
    dirs.push(root);
    expect(() => setupNative('android', { root, env: {}, ...quiet })).toThrow(/cap add/);
    expect(() => setupNative('windows', { root, env: {}, ...quiet })).toThrow(/Usage/);
  });
});
