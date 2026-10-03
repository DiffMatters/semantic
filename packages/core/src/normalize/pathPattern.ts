/**
 * Path patterns used by ignore lists, array strategy rules, policy overrides.
 * Syntax: dot-separated keys; `*` = exactly one segment; `**` = zero or more segments; `[n]` index;
 * `[*]` any index; `["a.b"]` quoted literal key; a key containing `*` (e.g. `db_*`) globs within one key.
 */
import { OptionsError } from '../errors.js';
import type { NormalizeOptions, PathSegment } from '../types.js';
import { canonicalKey } from './keys.js';

export type SegmentMatcher =
  | { type: 'key'; key: string }
  | { type: 'glob'; key: string }
  | { type: 'index'; index: number }
  | { type: 'anyIndex' }
  | { type: 'one' }
  | { type: 'globstar' };

export interface PathMatcher {
  source: string;
  segments: SegmentMatcher[];
}

function fail(p: string, why: string): never {
  throw new OptionsError(`Invalid path pattern ${JSON.stringify(p)}: ${why}`);
}

export function compilePattern(p: string): PathMatcher {
  if (typeof p !== 'string' || p.length === 0) fail(String(p), 'empty pattern');
  const segments: SegmentMatcher[] = [];
  let i = 0;
  const n = p.length;
  while (i < n) {
    if (p[i] === '[') {
      const close = p.indexOf(']', i);
      if (p[i + 1] === '"') {
        // Quoted key: find the closing unescaped quote, then expect ']'.
        let j = i + 2;
        while (j < n && p[j] !== '"') j += p[j] === '\\' ? 2 : 1;
        if (j >= n || p[j + 1] !== ']') fail(p, 'unterminated quoted key');
        let key: unknown;
        try {
          key = JSON.parse(p.slice(i + 1, j + 1));
        } catch {
          fail(p, 'bad escape in quoted key');
        }
        segments.push({ type: 'key', key: String(key) });
        i = j + 2;
      } else {
        if (close < 0) fail(p, 'unclosed [');
        const inner = p.slice(i + 1, close);
        if (inner === '*') segments.push({ type: 'anyIndex' });
        else if (/^\d+$/.test(inner)) segments.push({ type: 'index', index: Number(inner) });
        else fail(p, `bad bracket segment [${inner}]`);
        i = close + 1;
      }
    } else {
      let j = i;
      while (j < n && p[j] !== '.' && p[j] !== '[') j++;
      const tok = p.slice(i, j);
      if (tok === '') fail(p, 'empty segment');
      if (tok.includes(']')) fail(p, 'unexpected ] (use ["..."] for keys with special characters)');
      if (tok === '**') segments.push({ type: 'globstar' });
      else if (tok === '*') segments.push({ type: 'one' });
      else if (tok.includes('**')) fail(p, '`**` must be a whole segment');
      else if (tok.includes('*')) segments.push({ type: 'glob', key: tok });
      else segments.push({ type: 'key', key: tok });
      i = j;
    }
    if (i < n) {
      if (p[i] === '.') {
        i++;
        if (i >= n) fail(p, 'trailing dot');
      } else if (p[i] !== '[') fail(p, `unexpected character ${JSON.stringify(p[i])}`);
    }
  }
  return { source: p, segments };
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

function matchSegment(m: SegmentMatcher, seg: PathSegment, keys: NormalizeOptions['keys'] | undefined): boolean {
  const fold = (k: string): string => (keys ? canonicalKey(k, keys) : k);
  switch (m.type) {
    case 'one':
      return true;
    case 'globstar':
      return true;
    case 'anyIndex':
      return typeof seg === 'number';
    case 'index':
      return typeof seg === 'number' ? seg === m.index : seg === String(m.index);
    case 'key':
      if (typeof seg === 'number') return /^(0|[1-9]\d*)$/.test(m.key) && Number(m.key) === seg;
      return fold(m.key) === fold(seg);
    case 'glob':
      return typeof seg === 'string' && globToRegExp(fold(m.key)).test(fold(seg));
  }
}

/** True when the whole path matches. Keys are folded with `keys` (the active key options) when given. */
export function matchPath(
  pattern: string | PathMatcher,
  path: readonly PathSegment[],
  keys?: NormalizeOptions['keys'],
): boolean {
  const segs = (typeof pattern === 'string' ? compilePattern(pattern) : pattern).segments;
  const M = segs.length;
  const N = path.length;
  // dp[j] for the current i: does segs[i..] match path[j..]?
  let next: boolean[] = new Array<boolean>(N + 1).fill(false);
  next[N] = true;
  for (let i = M - 1; i >= 0; i--) {
    const m = segs[i]!;
    const cur: boolean[] = new Array<boolean>(N + 1).fill(false);
    for (let j = N; j >= 0; j--) {
      if (m.type === 'globstar') cur[j] = next[j]! || (j < N && cur[j + 1]!);
      else cur[j] = j < N && next[j + 1]! && matchSegment(m, path[j]!, keys);
    }
    next = cur;
  }
  return next[0]!;
}
