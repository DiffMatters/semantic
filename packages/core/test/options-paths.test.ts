import { describe, expect, it } from 'vitest';
import { pathToText } from '../src/diff/path.js';
import { OptionsError } from '../src/errors.js';
import { canonicalKey } from '../src/normalize/keys.js';
import { compilePattern, matchPath } from '../src/normalize/pathPattern.js';
import { DEFAULT_MASK_PATTERN, LOOSE, resolveOptions, STRICT } from '../src/options.js';
import { fromJS, nodeTypeName, toJS } from '../src/node-utils.js';

describe('canonicalKey', () => {
  it('folds style and case', () => {
    const keys = ['maxRetries', 'max_retries', 'max-retries', 'MAX_RETRIES', 'MaxRetries'];
    expect(new Set(keys.map((k) => canonicalKey(k, LOOSE.keys))).size).toBe(1);
    expect(canonicalKey('Max_Retries', { caseInsensitive: true, styleInsensitive: false })).toBe('max_retries');
    expect(canonicalKey('Max_Retries', STRICT.keys)).toBe('Max_Retries');
  });
});

describe('path patterns', () => {
  it('basic keys and wildcards', () => {
    expect(matchPath('a.b', ['a', 'b'])).toBe(true);
    expect(matchPath('a.b', ['a', 'b', 'c'])).toBe(false);
    expect(matchPath('a.*', ['a', 'x'])).toBe(true);
    expect(matchPath('a.*', ['a', 3])).toBe(true);
    expect(matchPath('a.*', ['a'])).toBe(false);
    expect(matchPath('a.*', ['a', 'x', 'y'])).toBe(false);
  });
  it('globstar matches zero or more', () => {
    expect(matchPath('**.password', ['password'])).toBe(true);
    expect(matchPath('**.password', ['db', 0, 'password'])).toBe(true);
    expect(matchPath('a.**', ['a'])).toBe(true);
    expect(matchPath('a.**.z', ['a', 'b', 'c', 'z'])).toBe(true);
    expect(matchPath('**', [])).toBe(true);
    expect(matchPath('a.**.z', ['a', 'b'])).toBe(false);
  });
  it('indices and any-index', () => {
    expect(matchPath('servers[0].port', ['servers', 0, 'port'])).toBe(true);
    expect(matchPath('servers[1].port', ['servers', 0, 'port'])).toBe(false);
    expect(matchPath('servers[*].port', ['servers', 7, 'port'])).toBe(true);
    expect(matchPath('servers[*]', ['servers', 'x'])).toBe(false);
    expect(matchPath('servers.0', ['servers', 0])).toBe(true);
    expect(matchPath('[0]', [0])).toBe(true);
    expect(matchPath('[*][*]', [0, 1])).toBe(true);
  });
  it('quoted literal keys', () => {
    expect(matchPath('["a.b"]', ['a.b'])).toBe(true);
    expect(matchPath('["a.b"]', ['a', 'b'])).toBe(false);
    expect(matchPath('x["a.b"].c', ['x', 'a.b', 'c'])).toBe(true);
    expect(matchPath('["say \\"hi\\""]', ['say "hi"'])).toBe(true);
  });
  it('glob within a key', () => {
    expect(matchPath('db_*', ['db_password'])).toBe(true);
    expect(matchPath('db_*', ['cache_password'])).toBe(false);
  });
  it('key folding with options', () => {
    expect(matchPath('database.maxRetries', ['DATABASE', 'MAX_RETRIES'])).toBe(false);
    expect(matchPath('database.maxRetries', ['DATABASE', 'MAX_RETRIES'], LOOSE.keys)).toBe(true);
  });
  it('invalid patterns throw OptionsError', () => {
    for (const p of ['', 'a..b', '.a', 'a.', 'a[', 'a[x]', 'a**b', '["unterminated', 'a]b']) {
      expect(() => compilePattern(p), p).toThrow(OptionsError);
    }
  });
});

describe('pathToText', () => {
  it('renders segments', () => {
    expect(pathToText([])).toBe('(root)');
    expect(pathToText(['settings', 'timeout'])).toBe('settings.timeout');
    expect(pathToText(['features', 2])).toBe('features[2]');
    expect(pathToText(['servers', { keyField: 'name', keyValue: 'web' }, 'port'])).toBe('servers[name=web].port');
    expect(pathToText(['a.b'])).toBe('["a.b"]');
    expect(pathToText(['x', 'with space', ''])).toBe('x["with space"][""]');
    expect(pathToText([0, 'max-retries'])).toBe('[0].max-retries');
  });
});

describe('resolveOptions', () => {
  it('defaults to loose and deep merges', () => {
    const o = resolveOptions({ coerce: { emptyStringIsNull: true }, ignore: ['meta.**'] });
    expect(o.mode).toBe('loose');
    expect(o.coerce.booleans).toBe(true);
    expect(o.coerce.emptyStringIsNull).toBe(true);
    expect(o.ignore).toEqual(['meta.**']);
    expect(o.mask.keyPattern).toBe(DEFAULT_MASK_PATTERN);
    expect(LOOSE.coerce.emptyStringIsNull).toBe(false); // presets untouched
  });
  it('strict preset', () => {
    const o = resolveOptions({ mode: 'strict' });
    expect(o).toEqual(STRICT);
    expect(o).not.toBe(STRICT);
  });
  it('parses strategies and validates', () => {
    const o = resolveOptions({ arrays: { rules: [{ pattern: 'servers', strategy: 'keyed:name' as never }] } });
    expect(o.arrays.rules[0]?.strategy).toEqual({ keyedBy: 'name' });
    expect(() => resolveOptions({ arrays: { default: 'random' as never } })).toThrow(OptionsError);
    expect(() => resolveOptions({ arrays: { rules: [{ pattern: 'a..b', strategy: 'set' }] } })).toThrow(OptionsError);
    expect(() => resolveOptions({ ignore: ['['] })).toThrow(OptionsError);
    expect(() => resolveOptions({ mask: { keyPattern: '(' } })).toThrow(OptionsError);
    expect(() => resolveOptions({ mode: 'fuzzy' as never })).toThrow(OptionsError);
    expect(() => resolveOptions({ coerce: { bogus: true } as never })).toThrow(OptionsError);
  });
});

describe('node-utils', () => {
  it('round-trips JS values', () => {
    const v = { a: [1, 'x', null, true, { b: {} }], c: [], ['__proto__']: 1 };
    const back = toJS(fromJS(JSON.parse(JSON.stringify({ a: v.a, c: v.c }))));
    expect(back).toEqual({ a: v.a, c: [] });
    const proto = toJS(fromJS(JSON.parse('{"__proto__": 1}'))) as Record<string, unknown>;
    expect(Object.keys(proto)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(proto)).toBe(Object.prototype);
  });
  it('raw text and quoting', () => {
    expect(fromJS('x')).toMatchObject({ kind: 'scalar', type: 'string', raw: '"x"', quoted: true, loc: null });
    expect(fromJS(-0)).toMatchObject({ raw: '-0', quoted: false });
    expect(fromJS(1.5)).toMatchObject({ raw: '1.5', type: 'number' });
    expect(nodeTypeName(fromJS([]))).toBe('array');
    expect(nodeTypeName(fromJS(null))).toBe('null');
  });
});
