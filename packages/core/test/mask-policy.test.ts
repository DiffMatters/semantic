import { describe, expect, it } from 'vitest';
import { OptionsError } from '../src/errors.js';
import { maskChanges } from '../src/mask.js';
import { fromJS } from '../src/node-utils.js';
import { resolveOptions } from '../src/options.js';
import { evaluate, exitCode, POLICIES, resolvePolicy, summarize } from '../src/policy/index.js';
import type { Change } from '../src/types.js';
import { diff, makeReport } from './diff-helpers.js';

describe('masking', () => {
  const opts = resolveOptions();
  it('still detects changes, replaces values, matches nested keys', () => {
    const { changes } = diff(
      { db: { password: 'hunter2', host: 'a' }, auth: { jwt: { secret: 'x' } }, API_KEY: 'k1', plain: 'p' },
      { db: { password: 'hunter3', host: 'a' }, auth: { jwt: { secret: 'x' } }, API_KEY: 'k2', plain: 'p' },
    );
    const masked = maskChanges(changes, opts);
    const by = new Map(masked.map((c) => [c.pathText, c]));
    expect(by.get('db.password')).toMatchObject({ kind: 'changed', masked: true, left: { value: '••••••', raw: '••••••', type: 'string' } });
    expect(by.get('db.password')!.right).toMatchObject({ value: '••••••' });
    expect(by.get('auth.jwt.secret')).toMatchObject({ kind: 'equal', masked: true });
    expect(by.get('API_KEY')).toMatchObject({ kind: 'changed', masked: true });
    expect(by.get('db.host')!.masked).toBeUndefined();
    expect(by.get('plain')!.left).toMatchObject({ value: 'p' });
    // input nodes untouched
    expect(changes.find((c) => c.pathText === 'db.password')!.left).toMatchObject({ value: 'hunter2' });
  });

  it('masks whole added containers and keeps loc', () => {
    const right = fromJS({ credentials: { user: 'u', pass: 'p' } });
    right.loc = { line: 1, col: 1, endLine: 3, endCol: 1, offset: 0, length: 10 };
    const change: Change = { kind: 'added', path: ['credentials'], pathText: 'credentials', right };
    const [m] = maskChanges([change], opts);
    expect(m!.right).toMatchObject({ kind: 'scalar', value: '••••••', loc: { line: 1 } });
  });

  it('disabled or custom pattern', () => {
    const { changes } = diff({ password: 'a', pin: '1' }, { password: 'b', pin: '2' });
    expect(maskChanges(changes, resolveOptions({ mask: { enabled: false } }))[0]!.masked).toBeUndefined();
    const custom = maskChanges(changes, resolveOptions({ mask: { keyPattern: '^pin$', replacement: 'XXX' } }));
    expect(custom.map((c) => c.masked ?? false)).toEqual([false, true]);
    expect(custom[1]!.right).toMatchObject({ value: 'XXX' });
  });

  it('matches keys in leftPath/rightPath too', () => {
    const c: Change = { kind: 'moved', path: [0], pathText: '[0]', leftPath: [0], rightPath: ['token', 1], left: fromJS('t') };
    expect(maskChanges([c], opts)[0]!.masked).toBe(true);
  });
});

describe('policy', () => {
  const left = { version: 'v1', settings: { timeout: 30, debug: false }, features: ['a', 'b', 'metrics'], dropped: 1, ord: [1, 2], n: '5' };
  const right = { version: 2, settings: { timeout: 60, debug: false }, features: ['a', 'b'], extra: true, ord: [2, 1], n: 5 };

  it('drift preset', () => {
    const r = makeReport(fromJS(left), fromJS(right), { mode: 'loose' }, 'drift');
    expect(r.findings.map((f) => [f.severity, f.code, f.message])).toEqual([
      ['error', 'TYPE_MISMATCH', 'version type changed: "v1" (string) → 2 (number)'],
      ['warn', 'VALUE_CHANGE', 'settings.timeout changed: 30 → 60'],
      ['error', 'MISSING_KEY', 'features[2] missing (was "metrics")'],
      ['error', 'MISSING_KEY', 'dropped missing (was 1)'],
      ['warn', 'EXTRA_KEY', 'extra added: true'],
    ]);
  });

  it('equivalence and strict-ci presets', () => {
    const eq = makeReport(fromJS(left), fromJS(right), {}, 'equivalence');
    expect(eq.findings.filter((f) => f.code === 'REORDER').map((f) => [f.severity, f.message])).toEqual([['warn', 'ord[0] moved to ord[1]']]);
    expect(eq.findings.every((f) => f.severity === 'error' || f.code === 'REORDER')).toBe(true);
    const ci = makeReport(fromJS(left), fromJS(right), {}, 'strict-ci');
    expect(ci.findings.find((f) => f.code === 'COERCED')).toMatchObject({ severity: 'warn', message: 'n equal after coercion (numbers): "5" ≈ 5' });
    expect(ci.findings.find((f) => f.code === 'REORDER')!.severity).toBe('error');
  });

  it('rule overrides: first match wins, keys folded', () => {
    const policy = resolvePolicy({
      rules: [
        { pattern: 'settings.TIMEOUT', override: { valueChange: 'error' } },
        { pattern: 'settings.**', override: { valueChange: 'ignore' } },
        { pattern: 'dropped', override: { missingKeys: 'ignore' } },
      ],
    });
    const r = makeReport(fromJS(left), fromJS(right), {}, policy);
    expect(r.findings.find((f) => f.change.pathText === 'settings.timeout')!.severity).toBe('error');
    expect(r.findings.some((f) => f.change.pathText === 'dropped')).toBe(false);
  });

  it('masked values show the replacement in messages', () => {
    const r = makeReport(fromJS({ db: { password: 'a' } }), fromJS({ db: { password: 'b' } }));
    expect(r.findings[0]!.message).toBe('db.password changed: "••••••" → "••••••"');
  });

  it('resolvePolicy', () => {
    expect(resolvePolicy()).toEqual(POLICIES.drift);
    expect(resolvePolicy('strict-ci').coerced).toBe('warn');
    expect(resolvePolicy({ extraKeys: 'error' })).toMatchObject({ ...POLICIES.drift, extraKeys: 'error' });
    expect(() => resolvePolicy('lenient' as never)).toThrow(OptionsError);
    expect(() => resolvePolicy({ extraKeys: 'fatal' as never })).toThrow(OptionsError);
    expect(() => resolvePolicy({ rules: [{ pattern: 'a..b', override: {} }] })).toThrow(OptionsError);
    resolvePolicy('drift').rules.push({ pattern: 'x', override: {} });
    expect(POLICIES.drift.rules).toEqual([]);
  });

  it('summarize and exitCode', () => {
    const r = makeReport(fromJS(left), fromJS(right), {}, 'drift');
    expect(r.summary).toMatchObject({ removed: 2, added: 1, changed: 1, typeChanged: 1, moved: 1, equalCoerced: 1, errors: 3, warnings: 2 });
    expect(r.summary.total).toBe(r.changes.length);
    expect(exitCode(r, 'error')).toBe(1);
    expect(exitCode(r, 'never')).toBe(0);

    const onlyWarn = makeReport(fromJS({ a: 1 }), fromJS({ a: 2 }), {}, 'drift');
    expect([exitCode(onlyWarn, 'error'), exitCode(onlyWarn, 'warn'), exitCode(onlyWarn, 'any')]).toEqual([0, 1, 1]);

    const reorderOnly = makeReport(fromJS([1, 2]), fromJS([2, 1]), {}, 'drift');
    expect(reorderOnly.findings).toEqual([]);
    expect([exitCode(reorderOnly, 'warn'), exitCode(reorderOnly, 'any')]).toEqual([0, 1]);

    const coercedOnly = makeReport(fromJS({ a: '1' }), fromJS({ a: 1 }), {}, 'strict-ci');
    expect(coercedOnly.identical).toBe(true);
    expect([exitCode(coercedOnly, 'any'), exitCode(coercedOnly, 'warn'), exitCode(coercedOnly, 'error')]).toEqual([0, 1, 0]);
  });

  it('evaluate skips equal and ignored', () => {
    const changes = diff({ a: 1, b: 2 }, { a: 1, b: 3 }, { ignore: ['b'] }).changes;
    expect(evaluate(changes, POLICIES['strict-ci'])).toEqual([]);
    expect(summarize(changes, [])).toMatchObject({ total: 2, equal: 1, ignored: 1 });
  });
});
