/** Test helpers: build Reports from plain JS values without parsers or compare(). */
import { diffNodes } from '../src/diff/index.js';
import { maskChanges } from '../src/mask.js';
import { fromJS } from '../src/node-utils.js';
import { resolveOptions } from '../src/options.js';
import { evaluate, resolvePolicy, summarize, isDifference, type PolicyName } from '../src/policy/index.js';
import type { Change, DeepPartial, Loc, Node, NormalizeOptions, Policy, Report, ScalarNode } from '../src/types.js';

export function diff(l: unknown, r: unknown, opts?: DeepPartial<NormalizeOptions>) {
  return diffNodes(fromJS(l), fromJS(r), resolveOptions(opts));
}

/** Only the real differences, as compact tuples for easy assertions. */
export function diffs(changes: Change[]): Array<[string, string]> {
  return changes.filter((c) => isDifference(c.kind)).map((c) => [c.kind, c.pathText]);
}

export function sc(type: ScalarNode['type'], value: ScalarNode['value'], raw: string, quoted = false): ScalarNode {
  return { kind: 'scalar', type, value, raw, quoted, loc: null };
}

export function loc(line: number): Loc {
  return { line, col: 3, endLine: line, endCol: 9, offset: 0, length: 6 };
}

/** Recursively assign fake locations (line = 1-based visit order) so renderers have line refs. */
export function withLines(node: Node, start = { n: 1 }): Node {
  node.loc = loc(start.n++);
  if (node.kind === 'object') for (const e of node.entries) withLines(e.value, start);
  if (node.kind === 'array') for (const i of node.items) withLines(i, start);
  return node;
}

export function makeReport(
  left: Node,
  right: Node,
  opts?: DeepPartial<NormalizeOptions>,
  policy?: PolicyName | Partial<Policy>,
  names: { left?: string; right?: string } = { left: 'a.json', right: 'b.yaml' },
): Report {
  const options = resolveOptions(opts);
  const pol = resolvePolicy(policy);
  const d = diffNodes(left, right, options);
  const changes = maskChanges(d.changes, options);
  const findings = evaluate(changes, pol, options.keys);
  const summary = summarize(changes, findings);
  const leftInfo: Report['left'] = { format: 'json', diagnostics: [] };
  const rightInfo: Report['right'] = { format: 'yaml', diagnostics: [] };
  if (names.left) leftInfo.name = names.left;
  if (names.right) rightInfo.name = names.right;
  return {
    left: leftInfo,
    right: rightInfo,
    options,
    policy: pol,
    changes,
    findings,
    diagnostics: d.diagnostics,
    summary,
    identical: !changes.some((c) => isDifference(c.kind)),
  };
}
