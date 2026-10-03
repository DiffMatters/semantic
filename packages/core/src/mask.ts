/**
 * Secret masking, applied after comparison so masked values still diff correctly.
 * - A change is masked when any object key in its path (or leftPath/rightPath) matches mask.keyPattern.
 * - Container values (whole added/removed objects) are redacted recursively: nested entries whose key
 *   matches are replaced, so a removed `integrations` block never prints its api_key.
 * - Credentials embedded in URL strings (scheme://user:password@host) are redacted everywhere.
 */
import type { Change, Node, NormalizeOptions, ScalarNode } from './types.js';

const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)([^\s@/]+)(@)/gi;

function masked(node: Node, replacement: string): ScalarNode {
  return { kind: 'scalar', type: 'string', value: replacement, raw: replacement, quoted: true, loc: node.loc };
}

/** Redacted containers get raw '' because their source slice would still contain the secret. */
function redact(node: Node, re: RegExp, replacement: string): Node {
  switch (node.kind) {
    case 'scalar': {
      if (node.type !== 'string' || typeof node.value !== 'string') return node;
      URL_CREDENTIALS.lastIndex = 0;
      if (!URL_CREDENTIALS.test(node.value)) return node;
      const value = node.value.replace(URL_CREDENTIALS, `$1${replacement}$3`);
      return { ...node, value, raw: node.raw.replace(URL_CREDENTIALS, `$1${replacement}$3`) };
    }
    case 'array': {
      const items = node.items.map((i) => redact(i, re, replacement));
      return items.every((i, n) => i === node.items[n]) ? node : { ...node, items, raw: '' };
    }
    case 'object': {
      const entries = node.entries.map((e) => {
        const value = re.test(e.sourceKey) ? masked(e.value, replacement) : redact(e.value, re, replacement);
        return value === e.value ? e : { ...e, value };
      });
      return entries.every((e, n) => e === node.entries[n]) ? node : { ...node, entries, raw: '' };
    }
  }
}

export function maskChanges(changes: Change[], opts: NormalizeOptions): Change[] {
  if (!opts.mask.enabled) return changes;
  const re = new RegExp(opts.mask.keyPattern, 'i');
  const replacement = opts.mask.replacement;
  const hits = (segs: Change['path'] | undefined): boolean => !!segs?.some((s) => typeof s === 'string' && re.test(s));
  return changes.map((c) => {
    if (hits(c.path) || hits(c.leftPath) || hits(c.rightPath)) {
      const out: Change = { ...c, masked: true };
      if (c.left) out.left = masked(c.left, replacement);
      if (c.right) out.right = masked(c.right, replacement);
      return out;
    }
    const left = c.left && redact(c.left, re, replacement);
    const right = c.right && redact(c.right, re, replacement);
    if (left === c.left && right === c.right) return c;
    const out: Change = { ...c, masked: true };
    if (left) out.left = left;
    if (right) out.right = right;
    return out;
  });
}
