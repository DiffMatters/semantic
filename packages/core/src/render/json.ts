/**
 * JSON renderer: the Report as plain JSON. Nodes are reduced to { kind, type?, value, raw, line? },
 * findings reference their change by pathText, diagnostics keep only line/col.
 */
import { toJS } from '../node-utils.js';
import type { Change, Diagnostic, DocumentInfo, Node, Report } from '../types.js';

interface JsonNode {
  kind: Node['kind'];
  type?: string;
  value: unknown;
  raw: string;
  line?: number;
}

function nonFinite(v: unknown): unknown {
  return typeof v === 'number' && !Number.isFinite(v) ? String(v) : v;
}

function reduceNode(n: Node): JsonNode {
  const out: JsonNode = { kind: n.kind, value: null, raw: n.raw };
  if (n.kind === 'scalar') {
    out.type = n.type;
    out.value = typeof n.value === 'number' && !Number.isFinite(n.value) ? n.raw || String(n.value) : n.value;
  } else out.value = toJS(n);
  if (n.loc) out.line = n.loc.line;
  return out;
}

function reduceChange(c: Change): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: c.kind, path: c.path, pathText: c.pathText };
  if (c.left) out.left = reduceNode(c.left);
  if (c.right) out.right = reduceNode(c.right);
  if (c.leftPath) out.leftPath = c.leftPath;
  if (c.rightPath) out.rightPath = c.rightPath;
  if (c.coercion) out.coercion = c.coercion;
  if (c.masked) out.masked = true;
  return out;
}

function reduceDiagnostic(d: Diagnostic): Record<string, unknown> {
  const out: Record<string, unknown> = { severity: d.severity, code: d.code, message: d.message };
  if (d.loc) {
    out.line = d.loc.line;
    out.col = d.loc.col;
  }
  return out;
}

function reduceDoc(d: DocumentInfo): Record<string, unknown> {
  const out: Record<string, unknown> = { format: d.format, diagnostics: d.diagnostics.map(reduceDiagnostic) };
  if (d.name !== undefined) out.name = d.name;
  if (d.documentCount !== undefined) out.documentCount = d.documentCount;
  return out;
}

export function toJson(report: Report, opts?: { pretty?: boolean }): string {
  const data = {
    identical: report.identical,
    summary: report.summary,
    left: reduceDoc(report.left),
    right: reduceDoc(report.right),
    changes: report.changes.map(reduceChange),
    findings: report.findings.map((f) => ({
      severity: f.severity,
      code: f.code,
      message: f.message,
      path: f.change.path,
      pathText: f.change.pathText,
    })),
    diagnostics: report.diagnostics.map(reduceDiagnostic),
    options: report.options,
    policy: report.policy,
  };
  return JSON.stringify(data, (_k, v: unknown) => nonFinite(v), opts?.pretty === false ? undefined : 2);
}
