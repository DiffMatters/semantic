/** Shared helpers for renderers: kind symbols, visibility filter, summary wording. */
import { isDifference } from '../policy/index.js';
import type { Change, ChangeKind, Report, Summary } from '../types.js';

export type Show = 'diff' | 'all';

export const SYMBOLS: Record<ChangeKind, string> = {
  added: '+',
  removed: '-',
  changed: '~',
  'type-changed': '!',
  moved: '↕',
  equal: '=',
  'equal-coerced': '≈',
  ignored: '·',
};

export function visibleChanges(report: Report, show: Show = 'diff'): Change[] {
  return show === 'all' ? report.changes : report.changes.filter((c) => isDifference(c.kind));
}

export function countsText(s: Summary): string {
  const parts: Array<[number, string]> = [
    [s.changed, 'changed'],
    [s.typeChanged, 'type changed'],
    [s.removed, 'removed'],
    [s.added, 'added'],
    [s.moved, 'moved'],
    [s.equal, 'equal'],
    [s.equalCoerced, 'equal after coercion'],
    [s.ignored, 'ignored'],
  ];
  const listed = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return `${listed.length ? listed.join(', ') : 'nothing compared'} (${s.total} compared)`;
}

export function findingsText(s: Summary): string {
  return `${s.errors} error${s.errors === 1 ? '' : 's'}, ${s.warnings} warning${s.warnings === 1 ? '' : 's'}`;
}

export function identicalText(s: Summary): string {
  return `Identical: no differences in ${s.total} compared value${s.total === 1 ? '' : 's'} (${s.equal} equal, ${s.equalCoerced} equal after coercion, ${s.ignored} ignored)`;
}
