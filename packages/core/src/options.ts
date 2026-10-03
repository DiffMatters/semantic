/** NormalizeOptions presets (STRICT, LOOSE) and validation/merging of user-supplied partial options. */
import { OptionsError } from './errors.js';
import { compilePattern } from './normalize/pathPattern.js';
import type { ArrayStrategy, DeepPartial, NormalizeOptions } from './types.js';

/** Matched case-insensitively against every object key in a change's path. */
export const DEFAULT_MASK_PATTERN = 'password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|dsn|auth';
export const DEFAULT_MASK_REPLACEMENT = '••••••';

export const STRICT: NormalizeOptions = {
  mode: 'strict',
  keys: { caseInsensitive: false, styleInsensitive: false },
  coerce: {
    booleans: false,
    numbers: false,
    nulls: false,
    emptyStringIsNull: false,
    commaLists: false,
    indexKeyObjects: false,
    legacyYamlBooleans: false,
  },
  arrays: { default: 'ordered', rules: [] },
  ignore: [],
  mask: { enabled: true, keyPattern: DEFAULT_MASK_PATTERN, replacement: DEFAULT_MASK_REPLACEMENT },
};

export const LOOSE: NormalizeOptions = {
  mode: 'loose',
  keys: { caseInsensitive: true, styleInsensitive: true },
  coerce: {
    booleans: true,
    numbers: true,
    nulls: true,
    emptyStringIsNull: false,
    commaLists: true,
    indexKeyObjects: true,
    legacyYamlBooleans: true,
  },
  arrays: { default: 'ordered', rules: [] },
  ignore: [],
  mask: { enabled: true, keyPattern: DEFAULT_MASK_PATTERN, replacement: DEFAULT_MASK_REPLACEMENT },
};

function clone(o: NormalizeOptions): NormalizeOptions {
  return {
    mode: o.mode,
    keys: { ...o.keys },
    coerce: { ...o.coerce },
    arrays: { default: o.arrays.default, rules: o.arrays.rules.map((r) => ({ ...r })) },
    ignore: [...o.ignore],
    mask: { ...o.mask },
  };
}

/** Accepts 'ordered', 'set', { keyedBy } and, for convenience, the CLI spelling 'keyed:<field>'. */
export function parseStrategy(s: unknown): ArrayStrategy {
  if (s === 'ordered' || s === 'set') return s;
  if (typeof s === 'string' && s.startsWith('keyed:') && s.length > 6) return { keyedBy: s.slice(6) };
  if (typeof s === 'object' && s !== null && 'keyedBy' in s) {
    const k: unknown = (s as { keyedBy: unknown }).keyedBy;
    if (typeof k === 'string' && k.length > 0) return { keyedBy: k };
  }
  throw new OptionsError(`Unknown array strategy ${JSON.stringify(s)} (expected ordered, set or keyed:<field>)`);
}

function assignBooleans<T extends object>(target: T, src: unknown, where: string): void {
  if (src === undefined) return;
  if (typeof src !== 'object' || src === null) throw new OptionsError(`${where} must be an object`);
  for (const [k, v] of Object.entries(src)) {
    if (!(k in target)) throw new OptionsError(`Unknown option ${where}.${k}`);
    if (v === undefined) continue;
    if (typeof v !== 'boolean') throw new OptionsError(`${where}.${k} must be a boolean`);
    (target as Record<string, unknown>)[k] = v;
  }
}

/**
 * Start from STRICT or LOOSE (per partial.mode, default 'loose') and deep-merge the rest.
 * Arrays (ignore, arrays.rules) replace the preset's. Throws OptionsError on invalid input.
 */
export function resolveOptions(partial?: DeepPartial<NormalizeOptions>): NormalizeOptions {
  const mode = partial?.mode ?? 'loose';
  if (mode !== 'strict' && mode !== 'loose') throw new OptionsError(`Unknown mode ${JSON.stringify(mode)}`);
  const out = clone(mode === 'strict' ? STRICT : LOOSE);
  if (!partial) return out;

  assignBooleans(out.keys, partial.keys, 'keys');
  assignBooleans(out.coerce, partial.coerce, 'coerce');

  if (partial.arrays) {
    if (partial.arrays.default !== undefined) out.arrays.default = parseStrategy(partial.arrays.default);
    if (partial.arrays.rules !== undefined) {
      if (!Array.isArray(partial.arrays.rules)) throw new OptionsError('arrays.rules must be an array');
      out.arrays.rules = partial.arrays.rules.map((r) => {
        compilePattern(r.pattern);
        return { pattern: r.pattern, strategy: parseStrategy(r.strategy) };
      });
    }
  }

  if (partial.ignore !== undefined) {
    if (!Array.isArray(partial.ignore)) throw new OptionsError('ignore must be an array of path patterns');
    for (const p of partial.ignore) compilePattern(p);
    out.ignore = [...partial.ignore];
  }

  if (partial.mask) {
    const m = partial.mask;
    if (m.enabled !== undefined) out.mask.enabled = m.enabled;
    if (m.keyPattern !== undefined) out.mask.keyPattern = m.keyPattern;
    if (m.replacement !== undefined) out.mask.replacement = m.replacement;
  }
  try {
    new RegExp(out.mask.keyPattern, 'i');
  } catch (e) {
    throw new OptionsError(`Invalid mask.keyPattern: ${(e as Error).message}`);
  }
  return out;
}
