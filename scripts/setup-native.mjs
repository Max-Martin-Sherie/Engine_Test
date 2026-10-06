#!/usr/bin/env node
/**
 * Configures the generated native projects for AdMob and a portrait-only (or landscape-only) game.
 * The orientation comes from "orientation" in capacitor.config.json ("portrait" if it is not there).
 *
 *   node scripts/setup-native.mjs <android|ios>
 *
 * Run it after `cap add android|ios`. It is idempotent: running it again changes nothing.
 * This is the only supported way to modify android/ and ios/ - do not hand-edit them.
 *
 * Optional env overrides (for release builds; they replace an existing value):
 *   ADMOB_APP_ID_ANDROID, ADMOB_APP_ID_IOS   your real AdMob *app* IDs (ca-app-pub-XXXX~YYYY)
 * Without them the Google test app IDs are written, and an existing value is left alone.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Google's official sample AdMob app IDs. https://developers.google.com/admob/android/quick-start
export const ANDROID_TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
export const IOS_TEST_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
export const SKADNETWORK_GOOGLE = 'cstr6suwn9.skadnetwork';
export const ATT_DESCRIPTION = 'This identifier will be used to deliver personalized ads to you.';

const APP_ID_PATTERN = /^ca-app-pub-\d{16}~\d{10}$/;

/** @param {string} value @param {string} name */
function assertAppId(value, name) {
  if (!APP_ID_PATTERN.test(value)) {
    throw new Error(`${name} must look like ca-app-pub-1234567890123456~1234567890, got "${value}"`);
  }
}

// ---- Android ---------------------------------------------------------------------------

/**
 * Adds the AdMob APPLICATION_ID meta-data (pointing at @string/admob_app_id) and locks
 * MainActivity to portrait (or landscape, both ways round).
 * @param {string} xml AndroidManifest.xml
 * @param {'portrait' | 'landscape'} [orientation]
 * @returns {string}
 */
export function patchAndroidManifest(xml, orientation = 'portrait') {
  const lock = orientation === 'landscape' ? 'sensorLandscape' : 'portrait';
  let out = xml;

  if (!out.includes('com.google.android.gms.ads.APPLICATION_ID')) {
    const close = out.indexOf('</application>');
    if (close === -1) throw new Error('AndroidManifest.xml has no </application>');
    const lineStart = out.lastIndexOf('\n', close) + 1;
    const indent = out.slice(lineStart, close);
    const meta = [
      `${indent}    <!-- AdMob app ID; the value lives in res/values/strings.xml -->`,
      `${indent}    <meta-data`,
      `${indent}        android:name="com.google.android.gms.ads.APPLICATION_ID"`,
      `${indent}        android:value="@string/admob_app_id" />`,
      '',
      '',
    ].join('\n');
    out = out.slice(0, lineStart) + meta + out.slice(lineStart);
  }

  const activity = /<activity\b[^>]*android:name="[\w.]*\.MainActivity"[^>]*>/.exec(out);
  if (!activity) throw new Error('AndroidManifest.xml has no MainActivity <activity>');
  const tag = activity[0];
  const orientationAttribute = /android:screenOrientation="[^"]*"/;
  const patched = orientationAttribute.test(tag)
    ? tag.replace(orientationAttribute, `android:screenOrientation="${lock}"`)
    : tag.replace(
        /(android:name="[\w.]*\.MainActivity")/,
        `$1\n            android:screenOrientation="${lock}"`,
      );
  return out.replace(tag, () => patched);
}

/**
 * Makes sure strings.xml defines admob_app_id.
 * @param {string} xml strings.xml
 * @param {string} appId
 * @param {boolean} overwrite replace an existing value (only when the caller supplied one)
 * @returns {string}
 */
export function patchAndroidStrings(xml, appId, overwrite) {
  const entry = /<string name="admob_app_id">[^<]*<\/string>/;
  const line = `<string name="admob_app_id">${appId}</string>`;
  if (entry.test(xml)) return overwrite ? xml.replace(entry, line) : xml;
  if (!xml.includes('</resources>')) throw new Error('strings.xml has no </resources>');
  return xml.replace('</resources>', () => `    ${line}\n</resources>`);
}

// ---- iOS -------------------------------------------------------------------------------

const PLIST_VALUE = String.raw`(?:<string>[\s\S]*?</string>|<array>[\s\S]*?</array>|<true\s*/>|<false\s*/>|<integer>[\s\S]*?</integer>)`;

/** Matches `<key>name</key>` plus the value element that follows it. @param {string} key */
function plistEntry(key) {
  return new RegExp(String.raw`<key>${key}</key>\s*${PLIST_VALUE}`);
}

/**
 * Inserts text just before the final </dict> of the plist.
 * @param {string} xml @param {string} entries one or more complete `<key>`/value blocks, tab-indented
 */
function insertTopLevel(xml, entries) {
  const close = xml.lastIndexOf('</dict>');
  if (close === -1) throw new Error('Info.plist has no top-level </dict>');
  const lineStart = xml.lastIndexOf('\n', close) + 1;
  return xml.slice(0, lineStart) + entries + xml.slice(lineStart);
}

/**
 * Adds GADApplicationIdentifier, NSUserTrackingUsageDescription and the Google SKAdNetwork ID,
 * and limits iPhone to portrait (or landscape). iPad orientations are left as they are.
 * @param {string} input Info.plist
 * @param {{ appId?: string, overwriteAppId?: boolean, orientation?: 'portrait' | 'landscape' }} [options]
 * @returns {string}
 */
export function patchInfoPlist(input, options = {}) {
  const { appId = IOS_TEST_APP_ID, overwriteAppId = false, orientation = 'portrait' } = options;
  const eol = input.includes('\r\n') ? '\r\n' : '\n';
  let xml = input.replace(/\r\n/g, '\n');

  // GADApplicationIdentifier
  const gad = plistEntry('GADApplicationIdentifier');
  const gadBlock = `<key>GADApplicationIdentifier</key>\n\t<string>${appId}</string>`;
  if (gad.test(xml)) {
    if (overwriteAppId) xml = xml.replace(gad, () => gadBlock);
  } else {
    xml = insertTopLevel(xml, `\t${gadBlock}\n`);
  }

  // NSUserTrackingUsageDescription (App Tracking Transparency prompt text)
  if (!plistEntry('NSUserTrackingUsageDescription').test(xml)) {
    xml = insertTopLevel(
      xml,
      `\t<key>NSUserTrackingUsageDescription</key>\n\t<string>${ATT_DESCRIPTION}</string>\n`,
    );
  }

  // SKAdNetworkItems
  const item = [
    '\t\t<dict>',
    '\t\t\t<key>SKAdNetworkIdentifier</key>',
    `\t\t\t<string>${SKADNETWORK_GOOGLE}</string>`,
    '\t\t</dict>',
  ].join('\n');
  const sk = plistEntry('SKAdNetworkItems').exec(xml);
  if (!sk) {
    xml = insertTopLevel(xml, `\t<key>SKAdNetworkItems</key>\n\t<array>\n${item}\n\t</array>\n`);
  } else if (!sk[0].includes(SKADNETWORK_GOOGLE)) {
    const close = sk[0].lastIndexOf('</array>');
    const lineStart = sk[0].lastIndexOf('\n', close) + 1;
    const updated = sk[0].slice(0, lineStart) + `${item}\n` + sk[0].slice(lineStart);
    xml = xml.replace(sk[0], () => updated);
  }

  // iPhone: one orientation family only.
  const allowed =
    orientation === 'landscape'
      ? ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight']
      : ['UIInterfaceOrientationPortrait'];
  const orientations = plistEntry('UISupportedInterfaceOrientations').exec(xml);
  const only = [
    '<key>UISupportedInterfaceOrientations</key>',
    '\t<array>',
    ...allowed.map((name) => `\t\t<string>${name}</string>`),
    '\t</array>',
  ].join('\n');
  if (!orientations) {
    xml = insertTopLevel(xml, `\t${only}\n`);
  } else {
    const values = [...orientations[0].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    const already = values.length === allowed.length && allowed.every((name) => values.includes(name));
    if (!already) xml = xml.replace(orientations[0], () => only);
  }

  return xml.replace(/\n/g, eol);
}

// ---- driver ----------------------------------------------------------------------------

/**
 * @param {string} file @param {(text: string) => string} patch
 * @param {(message: string) => void} log
 * @returns {boolean} whether the file changed
 */
function updateFile(file, patch, log) {
  if (!existsSync(file)) {
    throw new Error(`${file} not found. Run "npm run build" and "npx cap add <platform>" first.`);
  }
  const before = readFileSync(file, 'utf8');
  const after = patch(before);
  if (after === before) {
    log(`  unchanged  ${file}`);
    return false;
  }
  writeFileSync(file, after);
  log(`  updated    ${file}`);
  return true;
}

/**
 * The orientation the game declares in capacitor.config.json ("portrait" when it says nothing).
 * @param {string} root
 * @returns {'portrait' | 'landscape'}
 */
export function readOrientation(root) {
  const file = join(root, 'capacitor.config.json');
  if (!existsSync(file)) return 'portrait';
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')).orientation;
    return value === 'landscape' ? 'landscape' : 'portrait';
  } catch {
    return 'portrait';
  }
}

/**
 * @param {string} platform "android" or "ios"
 * @param {{ root?: string, env?: Record<string, string | undefined>, log?: (message: string) => void }} [options]
 * @returns {boolean} whether anything changed
 */
export function setupNative(platform, options = {}) {
  const { root = process.cwd(), env = process.env, log = console.log } = options;
  const orientation = readOrientation(root);
  log(`Configuring ${platform} for AdMob test ads + ${orientation}`);

  if (platform === 'android') {
    const override = env['ADMOB_APP_ID_ANDROID'];
    if (override) assertAppId(override, 'ADMOB_APP_ID_ANDROID');
    const main = join(root, 'android', 'app', 'src', 'main');
    const manifest = updateFile(join(main, 'AndroidManifest.xml'), (xml) => patchAndroidManifest(xml, orientation), log);
    const strings = updateFile(
      join(main, 'res', 'values', 'strings.xml'),
      (xml) => patchAndroidStrings(xml, override || ANDROID_TEST_APP_ID, Boolean(override)),
      log,
    );
    return manifest || strings;
  }

  if (platform === 'ios') {
    const override = env['ADMOB_APP_ID_IOS'];
    if (override) assertAppId(override, 'ADMOB_APP_ID_IOS');
    return updateFile(
      join(root, 'ios', 'App', 'App', 'Info.plist'),
      (xml) =>
        patchInfoPlist(xml, { appId: override || IOS_TEST_APP_ID, overwriteAppId: Boolean(override), orientation }),
      log,
    );
  }

  throw new Error(`Usage: node scripts/setup-native.mjs <android|ios> (got "${platform}")`);
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  try {
    const changed = setupNative(process.argv[2] ?? '');
    console.log(changed ? 'Done.' : 'Already configured; nothing to do.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
