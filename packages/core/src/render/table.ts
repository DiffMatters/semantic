/** Plain-text table for terminals: one aligned line per change with a kind symbol, optional ANSI colors. */
import { pathToText } from '../diff/path.js';
import { displayValue, nodeTypeName, truncate } from '../node-utils.js';
import type { Change, ChangeKind, Node, Report } from '../types.js';
import { countsText, findingsText, identicalText, SYMBOLS, visibleChanges, type Show } from './common.js';

const COLORS: Record<ChangeKind, string> = {
  added: '\x1b[32m',
  removed: '\x1b[31m',
  changed: '\x1b[33m',
  'type-changed': '\x1b[35m',
  moved: '\x1b[36m',
  equal: '\x1b[2m',
  'equal-coerced': '\x1b[2m',
  ignored: '\x1b[2m',
};
const RESET = '\x1b[0m';
const MAX_PATH = 50;

const v = (n: Node | undefined): string => (n ? displayValue(n, 60) : '');

function detail(c: Change): string {
  switch (c.kind) {
    case 'changed':
      return `${v(c.left)} → ${v(c.right)}${c.coercion ? ` (${c.coercion.rule})` : ''}`;
    case 'type-changed':
      return `${v(c.left)} (${c.left ? nodeTypeName(c.left) : '?'}) → ${v(c.right)} (${c.right ? nodeTypeName(c.right) : '?'})`;
    case 'added':
      return v(c.right);
    case 'removed':
      return v(c.left);
    case 'moved':
      return `→ ${pathToText(c.rightPath ?? c.path)}`;
    case 'equal':
      return v(c.left);
    case 'equal-coerced':
      return `${v(c.left)} ≈ ${v(c.right)} (${c.coercion?.rule ?? '?'})`;
    case 'ignored':
      return 'ignored';
  }
}

export function toTable(report: Report, opts?: { color?: boolean; show?: Show; width?: number }): string {
  const rows = visibleChanges(report, opts?.show ?? 'diff');
  const color = opts?.color === true;
  const width = opts?.width;
  const pathW = Math.min(MAX_PATH, rows.reduce((w, c) => Math.max(w, c.pathText.length), 0));
  const lines: string[] = [];
  for (const c of rows) {
    let line = `${SYMBOLS[c.kind]} ${truncate(c.pathText, MAX_PATH).padEnd(pathW)}  ${detail(c)}`.trimEnd();
    if (width !== undefined && width > 1) line = truncate(line, width);
    lines.push(color ? `${COLORS[c.kind]}${line}${RESET}` : line);
  }
  if (lines.length > 0) lines.push('');
  const s = report.summary;
  lines.push(report.identical ? identicalText(s) : countsText(s));
  if (report.findings.length > 0 || !report.identical) lines.push(findingsText(s));
  return lines.join('\n');
}
