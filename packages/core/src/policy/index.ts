/**
 * Policy: decides which changes matter. Maps change kinds to severities (with per-path overrides),
 * produces Findings with readable messages, summary counts and the process exit code.
 */
import { pathToText } from '../diff/path.js';
import { OptionsError } from '../errors.js';
import { compilePattern, matchPath, type PathMatcher } from '../normalize/pathPattern.js';
import { displayValue, nodeTypeName } from '../node-utils.js';
import type {
  Change,
  ChangeKind,
  Finding,
  FindingCode,
  Node,
  NormalizeOptions,
  Policy,
  PolicyLevels,
  Report,
  Severity,
  Summary,
} from '../types.js';

export type PolicyName = 'drift' | 'equivalence' | 'strict-ci';
export type FailOn = 'error' | 'warn' | 'any' | 'never';

export const POLICIES: Record<PolicyName, Policy> = {
  drift: { missingKeys: 'error', extraKeys: 'warn', typeMismatch: 'error', valueChange: 'warn', reorder: 'ignore', coerced: 'ignore', rules: [] },
  equivalence: { missingKeys: 'error', extraKeys: 'error', typeMismatch: 'error', valueChange: 'error', reorder: 'warn', coerced: 'ignore', rules: [] },
  'strict-ci': { missingKeys: 'error', extraKeys: 'error', typeMismatch: 'error', valueChange: 'error', reorder: 'error', coerced: 'warn', rules: [] },
};

const LEVEL_KEYS: Array<keyof PolicyLevels> = ['missingKeys', 'extraKeys', 'typeMismatch', 'valueChange', 'reorder', 'coerced'];
const SEVERITIES: readonly Severity[] = ['error', 'warn', 'ignore'];

const KIND_MAP: Partial<Record<ChangeKind, { level: keyof PolicyLevels; code: FindingCode }>> = {
  added: { level: 'extraKeys', code: 'EXTRA_KEY' },
  removed: { level: 'missingKeys', code: 'MISSING_KEY' },
  'type-changed': { level: 'typeMismatch', code: 'TYPE_MISMATCH' },
  changed: { level: 'valueChange', code: 'VALUE_CHANGE' },
  moved: { level: 'reorder', code: 'REORDER' },
  'equal-coerced': { level: 'coerced', code: 'COERCED' },
};

function checkLevels(levels: Partial<PolicyLevels>, where: string): void {
  for (const [k, v] of Object.entries(levels)) {
    if (!LEVEL_KEYS.includes(k as keyof PolicyLevels)) throw new OptionsError(`Unknown policy level ${where}${k}`);
    if (v !== undefined && !SEVERITIES.includes(v as Severity)) throw new OptionsError(`Invalid severity ${JSON.stringify(v)} for ${where}${k}`);
  }
}

/** Default 'drift'. A partial policy is merged over drift. Throws OptionsError on unknown names or values. */
export function resolvePolicy(p?: PolicyName | Partial<Policy>): Policy {
  if (p === undefined) return { ...POLICIES.drift, rules: [] };
  if (typeof p === 'string') {
    const preset = POLICIES[p];
    if (!preset) throw new OptionsError(`Unknown policy ${JSON.stringify(p)} (expected drift, equivalence or strict-ci)`);
    return { ...preset, rules: [] };
  }
  const { rules, ...levels } = p;
  checkLevels(levels, '');
  const out: Policy = { ...POLICIES.drift, ...levels, rules: [] };
  for (const r of rules ?? []) {
    compilePattern(r.pattern);
    checkLevels(r.override, `${r.pattern}: `);
    out.rules.push({ pattern: r.pattern, override: { ...r.override } });
  }
  return out;
}

const show = (n: Node | undefined): string => (n ? displayValue(n) : '?');

export function changeMessage(c: Change): string {
  const p = c.pathText;
  switch (c.kind) {
    case 'changed':
      return `${p} changed: ${show(c.left)} → ${show(c.right)}`;
    case 'type-changed':
      return `${p} type changed: ${show(c.left)} (${c.left ? nodeTypeName(c.left) : '?'}) → ${show(c.right)} (${c.right ? nodeTypeName(c.right) : '?'})`;
    case 'removed':
      return `${p} missing (was ${show(c.left)})`;
    case 'added':
      return `${p} added: ${show(c.right)}`;
    case 'moved':
      return `${p} moved to ${pathToText(c.rightPath ?? c.path)}`;
    case 'equal-coerced':
      return `${p} equal after coercion (${c.coercion?.rule ?? '?'}): ${show(c.left)} ≈ ${show(c.right)}`;
    case 'equal':
      return `${p} equal`;
    case 'ignored':
      return `${p} ignored`;
  }
}

/**
 * One Finding per change whose severity is not 'ignore'. Per-path rules (first match wins) are tested
 * against path and rightPath; pass `keys` to fold keys like the comparison did.
 */
export function evaluate(changes: Change[], policy: Policy, keys?: NormalizeOptions['keys']): Finding[] {
  const rules: Array<{ m: PathMatcher; override: Partial<PolicyLevels> }> = policy.rules.map((r) => ({
    m: compilePattern(r.pattern),
    override: r.override,
  }));
  const findings: Finding[] = [];
  for (const change of changes) {
    const map = KIND_MAP[change.kind];
    if (!map) continue;
    const rule = rules.find(
      (r) => matchPath(r.m, change.path, keys) || (change.rightPath !== undefined && matchPath(r.m, change.rightPath, keys)),
    );
    const severity = rule?.override[map.level] ?? policy[map.level];
    if (severity === 'ignore') continue;
    findings.push({ severity, code: map.code, change, message: changeMessage(change) });
  }
  return findings;
}

export function summarize(changes: Change[], findings: Finding[]): Summary {
  const s: Summary = {
    total: changes.length,
    added: 0,
    removed: 0,
    changed: 0,
    typeChanged: 0,
    moved: 0,
    equal: 0,
    equalCoerced: 0,
    ignored: 0,
    errors: 0,
    warnings: 0,
  };
  for (const c of changes) {
    switch (c.kind) {
      case 'added': s.added++; break;
      case 'removed': s.removed++; break;
      case 'changed': s.changed++; break;
      case 'type-changed': s.typeChanged++; break;
      case 'moved': s.moved++; break;
      case 'equal': s.equal++; break;
      case 'equal-coerced': s.equalCoerced++; break;
      case 'ignored': s.ignored++; break;
    }
  }
  for (const f of findings) {
    if (f.severity === 'error') s.errors++;
    else s.warnings++;
  }
  return s;
}

/** True for kinds that are actual differences (not equal, equal-coerced or ignored). */
export function isDifference(kind: ChangeKind): boolean {
  return kind !== 'equal' && kind !== 'equal-coerced' && kind !== 'ignored';
}

export function exitCode(report: Report, failOn: FailOn): 0 | 1 {
  switch (failOn) {
    case 'never':
      return 0;
    case 'any':
      return report.changes.some((c) => isDifference(c.kind)) ? 1 : 0;
    case 'warn':
      return report.findings.length > 0 ? 1 : 0;
    case 'error':
      return report.findings.some((f) => f.severity === 'error') ? 1 : 0;
  }
}
