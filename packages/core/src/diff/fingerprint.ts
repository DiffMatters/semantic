/**
 * Stable canonical strings for nodes, used to anchor array items (LCS, multiset and keyed joins).
 * Object keys are folded and sorted; scalars that are loose-equal under the active coerce rules share a
 * fingerprint where that is cheap to decide.
 */
import { NUMERIC_STRING, numberKey } from '../normalize/coerce.js';
import { canonicalKey } from '../normalize/keys.js';
import type { Node, NormalizeOptions, ScalarNode } from '../types.js';

export function scalarFingerprint(n: ScalarNode, opts: NormalizeOptions): string {
  switch (n.type) {
    case 'null':
      return 'z';
    case 'boolean':
      return n.value ? 'b1' : 'b0';
    case 'number':
      return `n${numberKey(n.value as number, n.raw)}`;
    case 'string': {
      const s = n.value as string;
      const c = opts.coerce;
      if (c.booleans && /^(true|false)$/i.test(s)) return s.toLowerCase() === 'true' ? 'b1' : 'b0';
      if (c.legacyYamlBooleans && /^(yes|no|on|off)$/i.test(s)) return /^(yes|on)$/i.test(s) ? 'b1' : 'b0';
      if (c.numbers && NUMERIC_STRING.test(s)) return `n${numberKey(Number(s), s)}`;
      if (c.nulls && /^(null|~)$/i.test(s)) return 'z';
      if (c.emptyStringIsNull && s === '') return 'z';
      return `s${JSON.stringify(s)}`;
    }
  }
}

/** Keys exactly "0".."n-1" (n >= 1): the items in index order, else null. */
export function indexKeyItems(node: Node): Node[] | null {
  if (node.kind !== 'object' || node.entries.length === 0) return null;
  const items: Array<Node | undefined> = new Array<Node | undefined>(node.entries.length);
  for (const e of node.entries) {
    if (!/^(0|[1-9]\d*)$/.test(e.sourceKey)) return null;
    const i = Number(e.sourceKey);
    if (i >= items.length || items[i] !== undefined) return null;
    items[i] = e.value;
  }
  return items as Node[];
}

export function fingerprint(node: Node, opts: NormalizeOptions, cache?: WeakMap<Node, string>): string {
  const hit = cache?.get(node);
  if (hit !== undefined) return hit;
  let fp: string;
  if (node.kind === 'scalar') fp = scalarFingerprint(node, opts);
  else if (node.kind === 'array') fp = `[${node.items.map((i) => fingerprint(i, opts, cache)).join(',')}]`;
  else {
    const asArray = opts.coerce.indexKeyObjects ? indexKeyItems(node) : null;
    if (asArray) fp = `[${asArray.map((i) => fingerprint(i, opts, cache)).join(',')}]`;
    else {
      const parts = node.entries.map((e) => `${JSON.stringify(canonicalKey(e.key, opts.keys))}:${fingerprint(e.value, opts, cache)}`);
      parts.sort();
      fp = `{${parts.join(',')}}`;
    }
  }
  cache?.set(node, fp);
  return fp;
}
