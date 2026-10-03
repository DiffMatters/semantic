/** Markdown renderer: summary line, a GFM change table and the findings list (for PR comments, reports). */
import { pathToText } from '../diff/path.js';
import { displayValue, truncate } from '../node-utils.js';
import type { Change, Node, Report } from '../types.js';
import { countsText, findingsText, identicalText, visibleChanges, type Show } from './common.js';

const MAX_CELL = 80;

/** Escape for a GFM table cell: pipes, backslashes before pipes, newlines. */
export function escapeCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n|\r/g, '<br>');
}

function cell(n: Node | undefined): string {
  if (!n) return '';
  const v = escapeCell(truncate(displayValue(n, MAX_CELL), MAX_CELL));
  return n.loc ? `${v} (L${n.loc.line})` : v;
}

function changeCell(c: Change): string {
  if (c.kind === 'equal-coerced' && c.coercion) return `equal-coerced (${c.coercion.rule})`;
  if (c.kind === 'moved' && c.rightPath) return `moved → ${escapeCell(pathToText(c.rightPath))}`;
  if (c.kind === 'changed' && c.coercion) return `changed (${c.coercion.rule})`;
  return c.kind;
}

export function toMarkdown(report: Report, opts?: { show?: Show }): string {
  const s = report.summary;
  const out: string[] = [];
  const name = (d: Report['left'], fallback: string): string => `\`${d.name ?? fallback}\` (${d.format})`;
  out.push(`Comparing ${name(report.left, 'left')} with ${name(report.right, 'right')}`, '');
  out.push(report.identical ? `**${identicalText(s)}**` : `**Summary:** ${countsText(s)}; ${findingsText(s)}`, '');

  const rows = visibleChanges(report, opts?.show ?? 'diff');
  if (rows.length > 0) {
    out.push('| Path | Change | Left | Right |', '|---|---|---|---|');
    for (const c of rows) {
      out.push(`| ${escapeCell(c.pathText)} | ${changeCell(c)} | ${cell(c.left)} | ${cell(c.right)} |`);
    }
    out.push('');
  }

  if (report.findings.length > 0) {
    out.push('### Findings', '');
    for (const f of report.findings) out.push(`- **${f.severity}** \`${f.code}\` ${escapeCell(f.message)}`);
    out.push('');
  }
  return out.join('\n');
}
