/**
 * Secret masking, applied after comparison so masked values still diff correctly.
 * A change is masked when any object key in its path (or leftPath/rightPath) matches mask.keyPattern.
 */
import type { Change, Node, NormalizeOptions, ScalarNode } from './types.js';

function masked(node: Node, replacement: string): ScalarNode {
  return { kind: 'scalar', type: 'string', value: replacement, raw: replacement, quoted: true, loc: node.loc };
}

export function maskChanges(changes: Change[], opts: NormalizeOptions): Change[] {
  if (!opts.mask.enabled) return changes;
  const re = new RegExp(opts.mask.keyPattern, 'i');
  const hits = (segs: Change['path'] | undefined): boolean => !!segs?.some((s) => typeof s === 'string' && re.test(s));
  return changes.map((c) => {
    if (!hits(c.path) && !hits(c.leftPath) && !hits(c.rightPath)) return c;
    const out: Change = { ...c, masked: true };
    if (c.left) out.left = masked(c.left, opts.mask.replacement);
    if (c.right) out.right = masked(c.right, opts.mask.replacement);
    return out;
  });
}
