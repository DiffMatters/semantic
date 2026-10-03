import { describe, expect, it } from 'vitest';
import { compareScalars, decimalKey } from '../src/normalize/coerce.js';
import { LOOSE, resolveOptions, STRICT } from '../src/options.js';
import { fromJS } from '../src/node-utils.js';
import type { ScalarNode } from '../src/types.js';
import { sc } from './diff-helpers.js';

const s = (v: unknown): ScalarNode => fromJS(v) as ScalarNode;

type Row = [label: string, l: ScalarNode, r: ScalarNode, strict: string, loose: string, rule?: string];

const rows: Row[] = [
  ['"true" vs true', s('true'), s(true), 'type-changed', 'equal-coerced', 'booleans'],
  ['"FALSE" vs false', s('FALSE'), s(false), 'type-changed', 'equal-coerced', 'booleans'],
  ['"true" vs false', s('true'), s(false), 'type-changed', 'changed', 'booleans'],
  ['"yes" vs true', s('yes'), s(true), 'type-changed', 'equal-coerced', 'legacyYamlBooleans'],
  ['"Off" vs false', s('Off'), s(false), 'type-changed', 'equal-coerced', 'legacyYamlBooleans'],
  ['"on" vs false', s('on'), s(false), 'type-changed', 'changed', 'legacyYamlBooleans'],
  ['"30" vs 30', s('30'), s(30), 'type-changed', 'equal-coerced', 'numbers'],
  ['"30.0" vs 30', s('30.0'), s(30), 'type-changed', 'equal-coerced', 'numbers'],
  ['"1e3" vs 1000', s('1e3'), s(1000), 'type-changed', 'equal-coerced', 'numbers'],
  ['"31" vs 30', s('31'), s(30), 'type-changed', 'changed', 'numbers'],
  ['"0755" vs 755', s('0755'), s(755), 'type-changed', 'type-changed'],
  ['"null" vs null', s('null'), s(null), 'type-changed', 'equal-coerced', 'nulls'],
  ['"~" vs null', s('~'), s(null), 'type-changed', 'equal-coerced', 'nulls'],
  ['"" vs null (emptyStringIsNull off)', s(''), s(null), 'type-changed', 'type-changed'],
  ['0 vs false', s(0), s(false), 'type-changed', 'type-changed'],
  ['null vs 0', s(null), s(0), 'type-changed', 'type-changed'],
  ['"abc" vs 1', s('abc'), s(1), 'type-changed', 'type-changed'],
];

describe('compareScalars table', () => {
  for (const [label, l, r, strict, loose, rule] of rows) {
    it(label, () => {
      for (const [a, b] of [
        [l, r],
        [r, l],
      ] as const) {
        expect(compareScalars(a, b, STRICT).kind).toBe(strict);
        const res = compareScalars(a, b, LOOSE);
        expect(res.kind).toBe(loose);
        expect(res.coercion?.rule).toBe(rule);
        if (res.coercion) {
          expect(res.coercion.from).toBe(a.type);
          expect(res.coercion.to).toBe(b.type);
        }
      }
    });
  }

  it('emptyStringIsNull when enabled', () => {
    const o = resolveOptions({ coerce: { emptyStringIsNull: true } });
    expect(compareScalars(s(''), s(null), o)).toEqual({
      kind: 'equal-coerced',
      coercion: { from: 'string', to: 'null', rule: 'emptyStringIsNull' },
    });
  });

  it('legacy booleans can be switched off', () => {
    const o = resolveOptions({ coerce: { legacyYamlBooleans: false } });
    expect(compareScalars(s('yes'), s(true), o).kind).toBe('type-changed');
  });

  it('both strings are never coerced; quoting is irrelevant', () => {
    expect(compareScalars(s('30'), s('30.0'), LOOSE).kind).toBe('changed');
    expect(compareScalars(s('true'), s('TRUE'), LOOSE).kind).toBe('changed');
    expect(compareScalars(sc('string', 'abc', 'abc', false), sc('string', 'abc', '"abc"', true), STRICT).kind).toBe('equal');
  });

  it('raw rule: unquoted YAML scalar whose source text equals the string (loose only)', () => {
    const yamlVersion = sc('number', 1.1, '1.10');
    const zip = sc('number', 2134, '02134');
    expect(compareScalars(s('02134'), zip, LOOSE)).toEqual({
      kind: 'equal-coerced',
      coercion: { from: 'string', to: 'number', rule: 'raw' },
    });
    expect(compareScalars(zip, s('02134'), LOOSE).coercion).toEqual({ from: 'number', to: 'string', rule: 'raw' });
    expect(compareScalars(yamlVersion, s('1.10'), LOOSE).kind).toBe('equal-coerced');
    expect(compareScalars(s('02134'), zip, STRICT).kind).toBe('type-changed');
    // quoted non-string side does not qualify
    expect(compareScalars(s('02134'), sc('number', 2134, '02134', true), LOOSE).kind).toBe('type-changed');
    // raw rule rescues a value the numbers rule would call changed? no: only exact raw text
    expect(compareScalars(s('1.1'), sc('number', 1.1, '1.10'), LOOSE).kind).toBe('equal-coerced');
    // raw rule needs mode loose even if coerce flags are on
    const strictWithFlags = resolveOptions({ mode: 'strict', coerce: { numbers: true } });
    expect(compareScalars(s('02134'), zip, strictWithFlags).kind).toBe('type-changed');
    expect(compareScalars(s('30'), s(30), strictWithFlags).kind).toBe('equal-coerced');
  });

  it('numbers: -0 equals 0, NaN equals NaN, infinities', () => {
    expect(compareScalars(s(-0), s(0), STRICT).kind).toBe('equal');
    expect(compareScalars(s(NaN), s(NaN), STRICT).kind).toBe('equal');
    expect(compareScalars(sc('number', NaN, '.nan'), sc('number', NaN, 'NaN'), STRICT).kind).toBe('equal');
    expect(compareScalars(s(Infinity), s(-Infinity), STRICT).kind).toBe('changed');
    expect(compareScalars(s(1), s(1.5), STRICT).kind).toBe('changed');
  });

  it('big integers compare by source digits beyond 15 significant digits', () => {
    const a = sc('number', 9007199254740993, '9007199254740993');
    const b = sc('number', 9007199254740992, '9007199254740992');
    expect(a.value).toBe(b.value); // precision lost in JS
    expect(compareScalars(a, b, STRICT).kind).toBe('changed');
    expect(compareScalars(a, sc('number', 9007199254740993, '9007199254740993'), STRICT).kind).toBe('equal');
    expect(compareScalars(a, sc('number', 9007199254740993, '9.007199254740993e15'), STRICT).kind).toBe('equal');
    expect(compareScalars(s('9007199254740993'), b, LOOSE).kind).toBe('changed');
    expect(compareScalars(s('9007199254740993'), a, LOOSE).kind).toBe('equal-coerced');
  });

  it('decimalKey canonicalizes', () => {
    expect(decimalKey('1.10')?.key).toBe(decimalKey('1.1')?.key);
    expect(decimalKey('100')?.key).toBe(decimalKey('1e2')?.key);
    expect(decimalKey('-0')?.key).toBe('0');
    expect(decimalKey('0x1F')).toBeNull();
    expect(decimalKey('9007199254740993')?.sig).toBe(16);
  });
});
