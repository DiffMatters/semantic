/**
 * Array strategies: ordered (LCS anchors + positional pairing + move detection), set (multiset
 * matching by fingerprint) and keyed (join on a field value, unkeyed items fall back to ordered).
 */
import type { ArrayStrategy, Node } from '../types.js';
import { childCtx, type Ctx, type Differ } from './index.js';
import { fallbackAnchors, lcsAnchors, LCS_CELL_LIMIT } from './lcs.js';
import { scalarFingerprint } from './fingerprint.js';
import { pathToText } from './path.js';

/** An array element together with its index in the source array. */
export interface Item {
  node: Node;
  index: number;
}

/** Leftover pairs are checked for loose equivalence only below this many comparisons. */
const EQUIVALENCE_PROBE_LIMIT = 10_000;

export function diffArrays(d: Differ, left: Item[], right: Item[], ctx: Ctx, leftNode: Node, rightNode: Node): void {
  if (left.length === 0 && right.length === 0) return d.emit('equal', ctx, leftNode, rightNode);
  const strategy: ArrayStrategy = d.strategyFor(ctx.path);
  if (strategy === 'ordered') return diffOrdered(d, left, right, ctx, leftNode);
  if (strategy === 'set') return diffSet(d, left, right, ctx);
  return diffKeyed(d, left, right, ctx, strategy.keyedBy, leftNode);
}

function pair(d: Differ, l: Item, r: Item, ctx: Ctx): void {
  d.visit(l.node, r.node, childCtx(ctx, l.index, r.index));
}

function intern(d: Differ, items: Item[], table: Map<string, number>): number[] {
  return items.map((it) => {
    const fp = d.fp(it.node);
    let id = table.get(fp);
    if (id === undefined) table.set(fp, (id = table.size));
    return id;
  });
}

export function diffOrdered(d: Differ, left: Item[], right: Item[], ctx: Ctx, leftNode: Node): void {
  const table = new Map<string, number>();
  const a = intern(d, left, table);
  const b = intern(d, right, table);

  let anchors = lcsAnchors(a, b, LCS_CELL_LIMIT);
  if (anchors === null) {
    d.warn(
      'LCS_FALLBACK',
      `Array at ${pathToText(ctx.display)} is too large for an exact ordered diff (${left.length} x ${right.length}); used approximate matching`,
      leftNode.loc,
    );
    anchors = fallbackAnchors(a, b);
  }

  // Move detection: unanchored left/right items with the same fingerprint.
  const leftUsed = new Uint8Array(left.length);
  const rightUsed = new Uint8Array(right.length);
  for (const [i, j] of anchors) leftUsed[i] = rightUsed[j] = 1;
  const moveTarget = new Map<number, number>(); // left position -> right position
  const pool = new Map<number, number[]>();
  for (let i = left.length - 1; i >= 0; i--) {
    if (leftUsed[i]) continue;
    const list = pool.get(a[i]!);
    if (list) list.push(i);
    else pool.set(a[i]!, [i]);
  }
  for (let j = 0; j < right.length; j++) {
    if (rightUsed[j]) continue;
    const i = pool.get(b[j]!)?.pop();
    if (i === undefined) continue;
    moveTarget.set(i, j);
    leftUsed[i] = rightUsed[j] = 1;
  }

  // Walk gaps between anchors: pair leftovers positionally, the rest are removed/added.
  let li = 0;
  let rj = 0;
  const flushGap = (endL: number, endR: number): void => {
    const ls: number[] = [];
    const rs: number[] = [];
    for (; li < endL; li++) {
      const target = moveTarget.get(li);
      if (target !== undefined) {
        d.emit('moved', childCtx(ctx, left[li]!.index, right[target]!.index), left[li]!.node, right[target]!.node);
      } else if (!leftUsed[li]) ls.push(li);
    }
    for (; rj < endR; rj++) if (!rightUsed[rj]) rs.push(rj);
    const k = Math.min(ls.length, rs.length);
    for (let x = 0; x < k; x++) pair(d, left[ls[x]!]!, right[rs[x]!]!, ctx);
    for (let x = k; x < ls.length; x++) {
      const it = left[ls[x]!]!;
      d.removed(it.node, childCtx(ctx, it.index, it.index));
    }
    for (let x = k; x < rs.length; x++) {
      const it = right[rs[x]!]!;
      d.added(it.node, childCtx(ctx, it.index, it.index));
    }
  };
  for (const [i, j] of anchors) {
    flushGap(i, j);
    pair(d, left[i]!, right[j]!, ctx);
    li = i + 1;
    rj = j + 1;
  }
  flushGap(left.length, right.length);
}

/** Multiset semantics: duplicates count, order is irrelevant, no moves are reported. */
export function diffSet(d: Differ, left: Item[], right: Item[], ctx: Ctx): void {
  const pool = new Map<string, number[]>();
  for (let i = left.length - 1; i >= 0; i--) {
    const fp = d.fp(left[i]!.node);
    const list = pool.get(fp);
    if (list) list.push(i);
    else pool.set(fp, [i]);
  }
  const matchOf = new Map<number, number>(); // left position -> right position
  const unmatchedRight: number[] = [];
  for (let j = 0; j < right.length; j++) {
    const i = pool.get(d.fp(right[j]!.node))?.pop();
    if (i === undefined) unmatchedRight.push(j);
    else matchOf.set(i, j);
  }
  // Second chance for items equal only via rules fingerprints cannot express (e.g. the 'raw' rule).
  const unmatchedLeft = left.map((_, i) => i).filter((i) => !matchOf.has(i));
  if (unmatchedLeft.length * unmatchedRight.length <= EQUIVALENCE_PROBE_LIMIT) {
    for (const i of unmatchedLeft) {
      const k = unmatchedRight.findIndex((j) => d.equivalent(left[i]!.node, right[j]!.node, childCtx(ctx, left[i]!.index, right[j]!.index)));
      if (k >= 0) {
        matchOf.set(i, unmatchedRight[k]!);
        unmatchedRight.splice(k, 1);
      }
    }
  }
  for (let i = 0; i < left.length; i++) {
    const j = matchOf.get(i);
    if (j !== undefined) pair(d, left[i]!, right[j]!, ctx);
    else d.removed(left[i]!.node, childCtx(ctx, left[i]!.index, left[i]!.index));
  }
  for (const j of unmatchedRight) d.added(right[j]!.node, childCtx(ctx, right[j]!.index, right[j]!.index));
}

interface KeyedItem extends Item {
  fp: string;
  label: string;
}

function splitKeyed(d: Differ, items: Item[], field: string, ctx: Ctx, side: string): { keyed: Map<string, KeyedItem>; rest: Item[] } {
  const want = d.canon(field);
  const keyed = new Map<string, KeyedItem>();
  const rest: Item[] = [];
  for (const it of items) {
    const entry = it.node.kind === 'object' ? it.node.entries.find((e) => d.canon(e.key) === want) : undefined;
    const v = entry?.value;
    if (!v || v.kind !== 'scalar') {
      rest.push(it);
      continue;
    }
    const fp = scalarFingerprint(v, d.opts);
    const label = String(v.value);
    if (keyed.has(fp)) {
      d.warn(
        'DUPLICATE_KEY',
        `Duplicate ${field}=${label} in ${pathToText(ctx.display)} (${side}, item ${it.index}); the first one is matched by key, the rest positionally`,
        it.node.loc,
      );
      rest.push(it);
      continue;
    }
    keyed.set(fp, { ...it, fp, label });
  }
  return { keyed, rest };
}

/** Join items on the value of `field`; matched pairs render as `[field=value]`, order is irrelevant. */
export function diffKeyed(d: Differ, left: Item[], right: Item[], ctx: Ctx, field: string, leftNode: Node): void {
  const L = splitKeyed(d, left, field, ctx, 'left');
  const R = splitKeyed(d, right, field, ctx, 'right');
  for (const [fp, l] of L.keyed) {
    const seg = { keyField: field, keyValue: l.label };
    const r = R.keyed.get(fp);
    if (r) d.visit(l.node, r.node, childCtx(ctx, l.index, r.index, seg));
    else d.removed(l.node, childCtx(ctx, l.index, l.index, seg));
  }
  for (const [fp, r] of R.keyed) {
    if (!L.keyed.has(fp)) d.added(r.node, childCtx(ctx, r.index, r.index, { keyField: field, keyValue: r.label }));
  }
  if (L.rest.length > 0 || R.rest.length > 0) diffOrdered(d, L.rest, R.rest, ctx, leftNode);
}
