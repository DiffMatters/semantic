import { describe, expect, it } from 'vitest';
import { fallbackAnchors, lcsAnchors } from '../src/diff/lcs.js';
import type { Change } from '../src/types.js';
import { diff, diffs } from './diff-helpers.js';

const rows = (cs: Change[]) => cs.map((c) => [c.kind, c.pathText]);

describe('ordered arrays', () => {
  it('positional change, removal and addition', () => {
    expect(rows(diff({ f: ['a', 'b', 'c'] }, { f: ['a', 'x', 'c', 'd'] }).changes)).toEqual([
      ['equal', 'f[0]'],
      ['changed', 'f[1]'],
      ['equal', 'f[2]'],
      ['added', 'f[3]'],
    ]);
  });

  it('removal in the middle is anchored by LCS (no cascade of changes)', () => {
    const { changes } = diff({ f: ['a', 'b', 'metrics', 'c', 'd'] }, { f: ['a', 'b', 'c', 'd'] });
    expect(diffs(changes)).toEqual([['removed', 'f[2]']]);
    const eq = changes.find((c) => c.pathText === 'f[3]')!;
    expect(eq).toMatchObject({ kind: 'equal', path: ['f', 3], leftPath: ['f', 3], rightPath: ['f', 2] });
  });

  it('pure reorder gives moved records with leftPath/rightPath', () => {
    const { changes } = diff(['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c']);
    expect(diffs(changes)).toEqual([['moved', '[3]']]);
    const mv = changes.find((c) => c.kind === 'moved')!;
    expect(mv.leftPath).toEqual([3]);
    expect(mv.rightPath).toEqual([0]);
    expect(mv.left).toMatchObject({ value: 'd' });
    expect(changes.filter((c) => c.kind === 'equal')).toHaveLength(3);
  });

  it('swap of objects is a move, not field changes', () => {
    const { changes } = diff([{ n: 1 }, { n: 2 }], [{ n: 2 }, { n: 1 }]);
    expect(diffs(changes).map(([k]) => k)).toEqual(['moved']);
  });

  it('loose-equal items anchor (fingerprints are normalized)', () => {
    const { changes } = diff(['1', 'true', 'x'], [1, true, 'x']);
    expect(changes.map((c) => c.kind)).toEqual(['equal-coerced', 'equal-coerced', 'equal']);
  });

  it('duplicates', () => {
    expect(diffs(diff(['a'], ['a', 'a']).changes)).toEqual([['added', '[1]']]);
    expect(diffs(diff(['a', 'a', 'b'], ['a', 'b']).changes)).toEqual([['removed', '[1]']]);
  });

  it('large arrays: one move, one removal, one flip, one append, fast', () => {
    const mk = (i: number) => ({ id: i, name: `item-${i}`, enabled: i % 3 === 0, tags: ['x', `t${i % 7}`] });
    const left = Array.from({ length: 1500 }, (_, i) => mk(i));
    const right = left.map((o) => ({ ...o, tags: [...o.tags] }));
    right.splice(1200, 1); // remove item 1200
    right[500]!.enabled = !right[500]!.enabled; // flip
    right.push(mk(1500)); // append
    const [moved] = right.splice(900, 1); // move 900 -> 3
    right.splice(3, 0, moved!);
    const t0 = performance.now();
    const { changes, diagnostics } = diff({ items: left }, { items: right });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(diagnostics).toEqual([]);
    expect(diffs(changes)).toEqual([
      ['changed', 'items[500].enabled'],
      ['moved', 'items[900]'],
      ['removed', 'items[1200]'],
      ['added', 'items[1499]'],
    ]);
    expect(changes.find((c) => c.kind === 'moved')!.rightPath).toEqual(['items', 3]);
  });

  it('LCS fallback on huge arrays emits LCS_FALLBACK and stays sensible', () => {
    const left = Array.from({ length: 2500 }, (_, i) => `v${i}`);
    const right = [...left];
    right[0] = 'changed-first';
    right[2499] = 'changed-last';
    right.splice(10, 1);
    right.splice(2000, 0, 'v10');
    const t0 = performance.now();
    const { changes, diagnostics } = diff({ a: left }, { a: right });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(diagnostics.map((d) => d.code)).toEqual(['LCS_FALLBACK']);
    expect(diffs(changes)).toEqual([
      ['changed', 'a[0]'],
      ['moved', 'a[10]'],
      ['changed', 'a[2499]'],
    ]);
  });

  it('lcs helpers agree on simple input', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 3, 4, 9, 5];
    expect(lcsAnchors(a, b)).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
      [4, 4],
    ]);
    expect(fallbackAnchors(a, b)).toEqual(lcsAnchors(a, b));
    expect(lcsAnchors(a, b, 1)).toBeNull();
  });
});

describe('set arrays', () => {
  const set = { arrays: { default: 'set' as const } };
  it('order is irrelevant', () => {
    expect(diffs(diff(['a', 'b', 'c'], ['c', 'a', 'b'], set).changes)).toEqual([]);
  });
  it('multiset semantics: duplicates count', () => {
    expect(diffs(diff({ tags: ['a', 'a', 'b', 'c'] }, { tags: ['a', 'b', 'c'] }, set).changes)).toEqual([['removed', 'tags[1]']]);
    expect(diffs(diff(['a', 'b'], ['b', 'a', 'b'], set).changes)).toEqual([['added', '[2]']]);
  });
  it('unmatched items are removed/added, not paired', () => {
    expect(diffs(diff(['a', 'b'], ['a', 'c'], set).changes)).toEqual([
      ['removed', '[1]'],
      ['added', '[1]'],
    ]);
  });
  it('matched items carry leftPath/rightPath when indices differ', () => {
    const c = diff(['a', 'b'], ['b', 'a'], set).changes.find((x) => x.pathText === '[0]')!;
    expect(c).toMatchObject({ kind: 'equal', leftPath: [0], rightPath: [1] });
  });
  it('rule by pattern', () => {
    const o = { arrays: { rules: [{ pattern: 'tags', strategy: 'set' as const }] } };
    expect(diffs(diff({ tags: ['a', 'b'], list: ['a', 'b'] }, { tags: ['b', 'a'], list: ['b', 'a'] }, o).changes)).toEqual([['moved', 'list[0]']]);
  });
});

describe('keyed arrays', () => {
  const keyed = { arrays: { rules: [{ pattern: 'servers', strategy: { keyedBy: 'name' } }] } };
  const a = {
    servers: [
      { name: 'web', host: 'web.local', port: 80 },
      { name: 'db', host: 'db.local', port: 5432 },
      { name: 'cache', host: 'cache.local', port: 6379 },
    ],
  };
  const b = {
    servers: [
      { name: 'queue', host: 'mq.local', port: 5672 },
      { name: 'db', host: 'db.local', port: 5432 },
      { name: 'web', host: 'web.local', port: 8080 },
    ],
  };

  it('reorder + one field change + add + remove gives exactly those rows', () => {
    const { changes, diagnostics } = diff(a, b, keyed);
    expect(diagnostics).toEqual([]);
    expect(diffs(changes)).toEqual([
      ['changed', 'servers[name=web].port'],
      ['removed', 'servers[name=cache]'],
      ['added', 'servers[name=queue]'],
    ]);
    const port = changes.find((c) => c.kind === 'changed')!;
    expect(port).toMatchObject({ path: ['servers', 0, 'port'], leftPath: ['servers', 0, 'port'], rightPath: ['servers', 2, 'port'] });
    expect(changes.find((c) => c.kind === 'added')!.path).toEqual(['servers', 0]);
    expect(changes.find((c) => c.kind === 'removed')!.path).toEqual(['servers', 2]);
  });

  it('positional diffing of the same input is noisier', () => {
    expect(diffs(diff(a, b).changes).length).toBeGreaterThan(3);
  });

  it('key field lookup uses key folding', () => {
    const o = { arrays: { default: { keyedBy: 'Name' } } };
    expect(diffs(diff([{ name: 'x', v: 1 }], [{ NAME: 'x', v: 2 }], o).changes)).toEqual([['changed', '[Name=x].v']]);
  });

  it('items missing the key field fall back to ordered diff among themselves', () => {
    const { changes } = diff(
      { servers: [{ name: 'web', port: 1 }, { host: 'anon-1' }, { host: 'anon-2' }] },
      { servers: [{ host: 'anon-2' }, { port: 1, name: 'web' }, { host: 'anon-3' }] },
      keyed,
    );
    expect(diffs(changes)).toEqual([
      ['removed', 'servers[1]'],
      ['added', 'servers[2]'],
    ]);
  });

  it('duplicate key values: DUPLICATE_KEY, first wins, rest unkeyed', () => {
    const { changes, diagnostics } = diff(
      { servers: [{ name: 'web', port: 1 }, { name: 'web', port: 2 }] },
      { servers: [{ name: 'web', port: 1 }, { name: 'web', port: 3 }] },
      keyed,
    );
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ['DUPLICATE_KEY', 'warning'],
      ['DUPLICATE_KEY', 'warning'],
    ]);
    expect(diffs(changes)).toEqual([['changed', 'servers[1].port']]);
  });

  it('loose key values join across types', () => {
    const o = { arrays: { default: { keyedBy: 'id' } } };
    expect(diffs(diff([{ id: '1', v: 'a' }], [{ id: 1, v: 'a' }], o).changes)).toEqual([]);
  });
});
