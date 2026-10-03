/**
 * Scalar comparison under NormalizeOptions. Coercions never mutate nodes; they only decide equality
 * and report which rule made two differently-typed scalars equal (or comparable).
 */
import type { Coercion, NormalizeOptions, ScalarNode } from '../types.js';

export type ScalarComparison = {
  kind: 'equal' | 'equal-coerced' | 'changed' | 'type-changed';
  coercion?: Coercion;
};

/** Numeric strings eligible for the `numbers` coercion (no leading zeros, no hex, no underscores). */
export const NUMERIC_STRING = /^[+-]?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const DECIMAL = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const BOOL_STRING = /^(true|false)$/i;
const LEGACY_BOOL = /^(yes|no|on|off)$/i;
const NULL_STRING = /^(null|~)$/i;

/**
 * Canonical decimal form of numeric source text ("0.<digits>e<exp>", sign-prefixed) plus its number of
 * significant digits, or null when the text is not a plain decimal (hex, .inf, ...).
 */
export function decimalKey(raw: string): { key: string; sig: number } | null {
  const m = DECIMAL.exec(raw.trim().replace(/_/g, ''));
  if (!m) return null;
  const sign = m[1] ?? '';
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  let exp = Number(m[4] ?? '0') + int.length;
  let digits = int + frac;
  const lead = /^0*/.exec(digits)?.[0].length ?? 0;
  digits = digits.slice(lead).replace(/0+$/, '');
  exp -= lead;
  if (digits === '') return { key: '0', sig: 0 };
  return { key: `${sign === '-' ? '-' : ''}0.${digits}e${exp}`, sig: digits.length };
}

/** Number equality: -0 == 0, NaN == NaN; beyond 15 significant digits compare the source digits. */
export function numbersEqual(lv: number, lraw: string, rv: number, rraw: string): boolean {
  const lk = lraw ? decimalKey(lraw) : null;
  const rk = rraw ? decimalKey(rraw) : null;
  if (lk && rk && (lk.sig > 15 || rk.sig > 15)) return lk.key === rk.key;
  if (Number.isNaN(lv) && Number.isNaN(rv)) return true;
  return lv === rv;
}

/** Stable key for a number: equal keys iff numbersEqual (for parseable raws). */
export function numberKey(v: number, raw: string): string {
  const k = raw ? decimalKey(raw) : null;
  if (k && k.sig > 15) return `d${k.key}`;
  if (Number.isNaN(v)) return 'NaN';
  return String(v === 0 ? 0 : v);
}

function sameType(l: ScalarNode, r: ScalarNode): boolean {
  if (l.type === 'number') return numbersEqual(l.value as number, l.raw, r.value as number, r.raw);
  return l.value === r.value;
}

/** Applies the first enabled coerce rule that fits a string vs non-string pair. */
function coerceRule(s: string, o: ScalarNode, opts: NormalizeOptions): { rule: string; equal: boolean } | null {
  const c = opts.coerce;
  switch (o.type) {
    case 'boolean':
      if (c.booleans && BOOL_STRING.test(s)) return { rule: 'booleans', equal: (s.toLowerCase() === 'true') === o.value };
      if (c.legacyYamlBooleans && LEGACY_BOOL.test(s)) {
        const t = /^(yes|on)$/i.test(s);
        return { rule: 'legacyYamlBooleans', equal: t === o.value };
      }
      return null;
    case 'number':
      if (c.numbers && NUMERIC_STRING.test(s)) {
        return { rule: 'numbers', equal: numbersEqual(Number(s), s, o.value as number, o.raw) };
      }
      return null;
    case 'null':
      if (c.nulls && NULL_STRING.test(s)) return { rule: 'nulls', equal: true };
      if (c.emptyStringIsNull && s === '') return { rule: 'emptyStringIsNull', equal: true };
      return null;
    default:
      return null;
  }
}

export function compareScalars(l: ScalarNode, r: ScalarNode, opts: NormalizeOptions): ScalarComparison {
  if (l.type === r.type) return { kind: sameType(l, r) ? 'equal' : 'changed' };

  const strSide = l.type === 'string' ? l : r.type === 'string' ? r : null;
  const other = strSide === l ? r : l;
  if (strSide === null) return { kind: 'type-changed' };

  const s = strSide.value as string;
  const ruled = coerceRule(s, other, opts);
  const coercion = (rule: string): Coercion => ({ from: l.type, to: r.type, rule });
  if (ruled?.equal) return { kind: 'equal-coerced', coercion: coercion(ruled.rule) };

  // Loose only: the unquoted source text of the non-string side spelled exactly like the string.
  if (opts.mode === 'loose' && !other.quoted && other.raw !== '' && other.raw === s) {
    return { kind: 'equal-coerced', coercion: coercion('raw') };
  }
  if (ruled) return { kind: 'changed', coercion: coercion(ruled.rule) };
  return { kind: 'type-changed' };
}
