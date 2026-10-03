import { describe, expect, it } from 'vitest';
import { diffNodes } from '../src/diff/index.js';
import { fromJS } from '../src/node-utils.js';
import { LOOSE, STRICT, resolveOptions } from '../src/options.js';
import type { Node } from '../src/types.js';
import { diff, diffs, sc } from './diff-helpers.js';

describe('objects', () => {
  it('added / removed / changed / type-changed plus equal leaves', () => {
    const { changes } = diff(
      { a: 1, b: 'x', c: true, d: { e: 1 } },
      { a: 2, c: 'yes please', d: { e: 1 }, f: null },
      { mode: 'strict' },
    );
    expect(changes.map((c) => [c.kind, c.pathText])).toEqual([
      ['changed', 'a'],
      ['removed', 'b'],
      ['type-changed', 'c'],
      ['equal', 'd.e'],
      ['added', 'f'],
    ]);
    const a = changes[0]!;
    expect(a.path).toEqual(['a']);
    expect(a.left).toMatchObject({ value: 1 });
    expect(a.right).toMatchObject({ value: 2 });
    expect(changes[1]!.right).toBeUndefined();
    expect(changes[4]!.left).toBeUndefined();
  });

  it('falsy values are never confused with missing', () => {
    const { changes } = diff(
      { zero: 0, f: false, s: '', n: null, onlyLeft: 0, nested: { x: false } },
      { zero: false, f: '', s: null, n: 0, onlyRight: null, nested: { x: false } },
      { mode: 'strict' },
    );
    expect(changes.map((c) => [c.kind, c.pathText])).toEqual([
      ['type-changed', 'zero'],
      ['type-changed', 'f'],
      ['type-changed', 's'],
      ['type-changed', 'n'],
      ['removed', 'onlyLeft'],
      ['equal', 'nested.x'],
      ['added', 'onlyRight'],
    ]);
  });

  it('empty containers: equal leaves, vs each other, vs missing', () => {
    const { changes } = diff({ o: {}, a: [], x: {}, y: [], gone: {} }, { o: {}, a: [], x: [], y: {}, fresh: [] }, { mode: 'loose' });
    expect(changes.map((c) => [c.kind, c.pathText])).toEqual([
      ['equal', 'o'],
      ['equal', 'a'],
      ['type-changed', 'x'],
      ['type-changed', 'y'],
      ['removed', 'gone'],
      ['added', 'fresh'],
    ]);
  });

  it('whole subtree add/remove is one record', () => {
    const { changes } = diff({ keep: 1 }, { keep: 1, big: { a: { b: [1, 2, 3] }, c: 2 } });
    expect(diffs(changes)).toEqual([['added', 'big']]);
  });

  it('root kind mismatch is one record at (root)', () => {
    const { changes } = diff('plain string', { a: 1 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'type-changed', path: [], pathText: '(root)' });
  });

  it('identical scalars at root', () => {
    expect(diff(1, 1).changes).toEqual([expect.objectContaining({ kind: 'equal', pathText: '(root)' })]);
  });

  it('key folding in loose mode, exact keys in strict', () => {
    const l = { maxRetries: 3, Timeout: 30 };
    const r = { MAX_RETRIES: 3, timeout: 30 };
    expect(diffs(diff(l, r, { mode: 'loose' }).changes)).toEqual([]);
    expect(diffs(diff(l, r, { mode: 'strict' }).changes)).toEqual([
      ['removed', 'maxRetries'],
      ['removed', 'Timeout'],
      ['added', 'MAX_RETRIES'],
      ['added', 'timeout'],
    ]);
    // the reported path uses the left spelling; key-spelling differences do not set leftPath/rightPath
    const eq = diff(l, r).changes[0]!;
    expect(eq.pathText).toBe('maxRetries');
    expect(eq.rightPath).toBeUndefined();
  });

  it('key collisions after folding: diagnostic, last wins', () => {
    const { changes, diagnostics } = diff({ maxRetries: 1, max_retries: 2, MAX_RETRIES: 3 }, { maxRetries: 3 });
    expect(diagnostics.map((d) => d.code)).toEqual(['KEY_COLLISION', 'KEY_COLLISION']);
    expect(diagnostics[0]!.severity).toBe('warning');
    expect(changes).toEqual([expect.objectContaining({ kind: 'equal', pathText: 'MAX_RETRIES' })]);
    expect(diff({ maxRetries: 1, max_retries: 2 }, {}, { mode: 'strict' }).diagnostics).toEqual([]);
  });

  it('literal dotted key never collides with nesting', () => {
    const { changes } = diff({ 'a.b': 1, a: { b: 2 } }, { 'a.b': 1, a: { b: 3 } });
    expect(changes.map((c) => [c.kind, c.pathText])).toEqual([
      ['equal', '["a.b"]'],
      ['changed', 'a.b'],
    ]);
    expect(changes[1]!.path).toEqual(['a', 'b']);
  });

  it('deep nesting', () => {
    let l: unknown = 1;
    let r: unknown = 2;
    for (let i = 0; i < 200; i++) {
      l = { n: l };
      r = { n: r };
    }
    const { changes } = diff(l, r);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toHaveLength(200);
  });

  it('coerced scalars produce equal-coerced records with the rule', () => {
    const { changes } = diff({ port: '8080', debug: 'false', zip: '02134' }, { port: 8080, debug: false, zip: 2134 });
    expect(changes.map((c) => [c.kind, c.coercion?.rule])).toEqual([
      ['equal-coerced', 'numbers'],
      ['equal-coerced', 'booleans'],
      ['type-changed', undefined],
    ]);
    // the YAML parser keeps raw '02134' for the plain scalar, which the raw rule accepts
    const zip: Node = { kind: 'object', loc: null, raw: '', entries: [{ key: 'zip', sourceKey: 'zip', keyLoc: null, value: sc('number', 2134, '02134') }] };
    const res = diffNodes(fromJS({ zip: '02134' }), zip, LOOSE).changes;
    expect(res[0]).toMatchObject({ kind: 'equal-coerced', coercion: { rule: 'raw' } });
  });
});

describe('commaLists and indexKeyObjects', () => {
  it('comma string vs array', () => {
    expect(diff({ tags: 'a, b,c' }, { tags: ['a', 'b', 'c'] }).changes).toEqual([
      expect.objectContaining({ kind: 'equal-coerced', coercion: { from: 'string', to: 'array', rule: 'commaLists' } }),
    ]);
    expect(diff({ tags: ['a', 'b'] }, { tags: 'a,b,' }).changes[0]).toMatchObject({
      kind: 'equal-coerced',
      coercion: { from: 'array', to: 'string', rule: 'commaLists' },
    });
    expect(diff({ ports: '80,443' }, { ports: [80, 443] }).changes[0]!.kind).toBe('equal-coerced');
    expect(diff({ tags: 'a,b' }, { tags: ['a', 'c'] }).changes).toEqual([
      expect.objectContaining({ kind: 'changed', pathText: 'tags', coercion: expect.objectContaining({ rule: 'commaLists' }) }),
    ]);
    expect(diff({ tags: '' }, { tags: [] }).changes[0]!.kind).toBe('equal-coerced');
    expect(diff({ tags: 'a,b' }, { tags: ['a', 'b'] }, { mode: 'strict' }).changes[0]!.kind).toBe('type-changed');
    expect(diff({ tags: 'a' }, { tags: [{ a: 1 }] }).changes[0]!.kind).toBe('type-changed');
  });

  it('index-key object vs array', () => {
    const obj = { services: { 0: { name: 'web' }, 1: { name: 'db' } } };
    const arr = { services: [{ name: 'web' }, { name: 'worker' }] };
    expect(diff(obj, arr).changes.map((c) => [c.kind, c.pathText])).toEqual([
      ['equal', 'services[0].name'],
      ['changed', 'services[1].name'],
    ]);
    expect(diff(obj, arr, { mode: 'strict' }).changes.map((c) => c.kind)).toEqual(['type-changed']);
    // sparse or non-index keys are not arrays
    expect(diff({ s: { 0: 'a', 2: 'b' } }, { s: ['a', 'b'] }).changes[0]!.kind).toBe('type-changed');
    expect(diff({ s: { 0: 'a', x: 'b' } }, { s: ['a', 'b'] }).changes[0]!.kind).toBe('type-changed');
    expect(diff({ s: {} }, { s: [] }).changes[0]!.kind).toBe('type-changed');
  });
});

describe('ignore patterns', () => {
  it('ignored subtree is one record, no recursion; also for added/removed', () => {
    const { changes } = diff(
      { meta: { built: 1, by: 'a' }, servers: [{ id: 1, ts: 5 }], keep: 1, stale: 1 },
      { meta: { built: 2, by: 'b' }, servers: [{ id: 1, ts: 6 }], keep: 1, fresh: 2 },
      { ignore: ['meta', 'servers[*].ts', 'stale', 'fresh'] },
    );
    expect(changes.map((c) => [c.kind, c.pathText])).toEqual([
      ['ignored', 'meta'],
      ['equal', 'servers[0].id'],
      ['ignored', 'servers[0].ts'],
      ['equal', 'keep'],
      ['ignored', 'stale'],
      ['ignored', 'fresh'],
    ]);
  });

  it('globstar ignore at root ignores everything', () => {
    expect(diff({ a: 1 }, { a: 2 }, { ignore: ['**'] }).changes).toEqual([
      expect.objectContaining({ kind: 'ignored', pathText: '(root)' }),
    ]);
  });

  it('ignore uses key folding', () => {
    expect(diffs(diff({ buildTime: 1 }, { BUILD_TIME: 2 }, { ignore: ['build_time'] }).changes)).toEqual([]);
  });
});

describe('options objects are not mutated', () => {
  it('STRICT/LOOSE stay intact and nodes are not mutated', () => {
    const before = JSON.stringify([STRICT, LOOSE]);
    const l = fromJS({ a: [1, 2], b: 'x' });
    const snapshot = JSON.stringify(l);
    diffNodes(l, fromJS({ a: [2, 1], b: 'y' }), resolveOptions());
    expect(JSON.stringify(l)).toBe(snapshot);
    expect(JSON.stringify([STRICT, LOOSE])).toBe(before);
  });
});
