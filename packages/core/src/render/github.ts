/** GitHub Actions workflow commands: one ::error / ::warning annotation per finding. */
import type { Finding, Report } from '../types.js';

/** Message data: % CR LF. */
export function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Property values additionally escape ':' and ','. */
export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function annotation(f: Finding, report: Report): string {
  const onLeft = f.change.kind === 'removed' || !f.change.right;
  const doc = onLeft ? report.left : report.right;
  const node = onLeft ? f.change.left : f.change.right;
  const props: string[] = [];
  if (doc.name) props.push(`file=${escapeProperty(doc.name)}`);
  if (doc.name && node?.loc) props.push(`line=${node.loc.line}`, `col=${node.loc.col}`);
  props.push(`title=${escapeProperty(f.code)}`);
  const cmd = f.severity === 'error' ? 'error' : 'warning';
  return `::${cmd} ${props.join(',')}::${escapeData(f.message)}`;
}

export function toGithubAnnotations(report: Report): string {
  return report.findings.map((f) => annotation(f, report)).join('\n');
}
