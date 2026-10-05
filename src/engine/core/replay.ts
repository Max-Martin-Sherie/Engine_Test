/**
 * A compact text encoding for a list of integers, for putting a recorded run in a link.
 *
 * Games that are deterministic (same seed + same inputs = same run) only need to store the inputs.
 * Inputs change slowly, so each value is stored as the difference from the one before it, as a
 * variable-length number, and a run of "no change" is stored as one short token. The bytes are written
 * as URL-safe base64 (A-Z a-z 0-9 - _), so the result can sit in a query string without escaping.
 *
 * Pure: no DOM, no `btoa`. Decoding never throws; it returns null for anything that is not valid.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charAt(i)] = i;

/** Integers beyond this are not stored exactly (and make no sense as game inputs). */
export const MAX_REPLAY_INT = 0x3fffffff;
const SIX_BITS = 64;

function pushVarint(bytes: number[], value: number): void {
  let v = value;
  while (v >= 128) {
    bytes.push((v % 128) + 128);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
}

const zigzag = (d: number): number => (d >= 0 ? d * 2 : -d * 2 - 1);
const unzigzag = (z: number): number => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

function toBase64Url(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = a * 65536 + b * 256 + c;
    out += ALPHABET.charAt(Math.floor(triple / 262144) % SIX_BITS);
    out += ALPHABET.charAt(Math.floor(triple / 4096) % SIX_BITS);
    if (i + 1 < bytes.length) out += ALPHABET.charAt(Math.floor(triple / SIX_BITS) % SIX_BITS);
    if (i + 2 < bytes.length) out += ALPHABET.charAt(triple % SIX_BITS);
  }
  return out;
}

function fromBase64Url(text: string): number[] | null {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    if (chunk.length === 1) return null; // one character cannot hold a byte
    const values: number[] = [];
    for (const ch of chunk) {
      const v = LOOKUP[ch];
      if (v === undefined) return null;
      values.push(v);
    }
    const triple = (values[0] ?? 0) * 262144 + (values[1] ?? 0) * 4096 + (values[2] ?? 0) * SIX_BITS + (values[3] ?? 0);
    bytes.push(Math.floor(triple / 65536) % 256);
    if (chunk.length >= 3) bytes.push(Math.floor(triple / 256) % 256);
    if (chunk.length === 4) bytes.push(triple % 256);
  }
  return bytes;
}

/** Encodes whole numbers (|n| <= MAX_REPLAY_INT) as URL-safe text. Throws on anything else (a programming error). */
export function encodeInts(values: readonly number[]): string {
  const bytes: number[] = [];
  let previous = 0;
  let zeros = 0;
  const flushZeros = (): void => {
    if (zeros === 0) return;
    pushVarint(bytes, 0); // 0 = "a run of repeats follows"
    pushVarint(bytes, zeros);
    zeros = 0;
  };
  for (const value of values) {
    if (!Number.isInteger(value) || Math.abs(value) > MAX_REPLAY_INT) throw new RangeError(`cannot encode ${value}`);
    const delta = value - previous;
    previous = value;
    if (delta === 0) {
      zeros += 1;
      continue;
    }
    flushZeros();
    pushVarint(bytes, zigzag(delta));
  }
  flushZeros();
  return toBase64Url(bytes);
}

/**
 * Decodes what `encodeInts` wrote. Returns null if the text is malformed, or if it would produce more
 * than `maxCount` numbers (so a hostile link cannot make a game allocate without limit).
 */
export function decodeInts(text: string, maxCount = 100_000): number[] | null {
  const bytes = fromBase64Url(text);
  if (bytes === null) return null;
  const out: number[] = [];
  let previous = 0;
  let i = 0;
  const readVarint = (): number | null => {
    let value = 0;
    let scale = 1;
    for (let used = 0; used < 7; used++) {
      const byte = bytes[i++];
      if (byte === undefined) return null;
      value += (byte % 128) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
    return null; // too long to be a number we wrote
  };
  while (i < bytes.length) {
    const token = readVarint();
    if (token === null) return null;
    if (token === 0) {
      const count = readVarint();
      if (count === null || count === 0 || out.length + count > maxCount) return null;
      for (let k = 0; k < count; k++) out.push(previous);
    } else {
      previous += unzigzag(token);
      if (Math.abs(previous) > MAX_REPLAY_INT) return null;
      if (out.length + 1 > maxCount) return null;
      out.push(previous);
    }
  }
  return out;
}
