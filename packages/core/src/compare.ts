/**
 * One-call entry point: parse both sides, diff under normalization options,
 * mask secrets, evaluate the policy and summarize into a serializable Report.
 */
import { diffNodes } from './diff/index.js';
import { maskChanges } from './mask.js';
import { resolveOptions } from './options.js';
import { parse } from './parsers/index.js';
import { evaluate, resolvePolicy, summarize, type PolicyName } from './policy/index.js';
import type {
  DeepPartial,
  Document,
  DocumentInfo,
  Format,
  NormalizeOptions,
  ParseOptions,
  Policy,
  Report,
} from './types.js';

export interface CompareSide {
  text: string;
  /** Omit to auto-detect from name and content. */
  format?: Format;
  name?: string;
}

export interface CompareArgs {
  left: CompareSide;
  right: CompareSide;
  options?: DeepPartial<NormalizeOptions>;
  policy?: PolicyName | Partial<Policy>;
  parse?: Pick<ParseOptions, 'env' | 'yaml'>;
}

const DIFFERENT = new Set(['added', 'removed', 'changed', 'type-changed', 'moved']);

function info(doc: Document): DocumentInfo {
  const { root: _root, source: _source, ...rest } = doc;
  return rest;
}

/** Compare two already-parsed documents. Useful when the caller parses once and re-diffs on option changes. */
export function compareDocuments(
  left: Document,
  right: Document,
  options?: DeepPartial<NormalizeOptions>,
  policy?: PolicyName | Partial<Policy>,
): Report {
  const opts = resolveOptions(options);
  const pol = resolvePolicy(policy);
  const { changes: raw, diagnostics } = diffNodes(left.root, right.root, opts);
  const changes = maskChanges(raw, opts);
  const findings = evaluate(changes, pol, opts.keys);
  const leftInfo = info(left);
  // Diff-time diagnostics (key collisions after folding, LCS fallback) belong to the comparison;
  // attach them to the right side so they surface once.
  const rightInfo = { ...info(right), diagnostics: [...right.diagnostics, ...diagnostics] };
  return {
    left: leftInfo,
    right: rightInfo,
    options: opts,
    policy: pol,
    changes,
    findings,
    summary: summarize(changes, findings),
    identical: !changes.some((c) => DIFFERENT.has(c.kind)),
  };
}

/** Parse both sides and compare. Throws ParseError (with loc and sourceName) or OptionsError. */
export function compare(args: CompareArgs): Report {
  const left = parse(args.left.text, { ...args.parse, format: args.left.format, name: args.left.name });
  const right = parse(args.right.text, { ...args.parse, format: args.right.format, name: args.right.name });
  return compareDocuments(left, right, args.options, args.policy);
}
