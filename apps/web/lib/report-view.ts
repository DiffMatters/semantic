/**
 * Pure helpers that turn a core Report plus UI filters into display rows.
 * No React here so it can be unit-tested directly.
 */
import {
  displayValue,
  isDifference,
  nodeTypeName,
  pathToText,
  type Change,
  type ChangeKind,
  type Diagnostic,
  type Finding,
  type Node,
  type Report,
  type Summary,
} from "@config-diff/core";

export { displayValue, isDifference };

export type ShowMode = "diff" | "all";

/** Display order for chips and toggles. */
export const ALL_KINDS: readonly ChangeKind[] = [
  "added",
  "removed",
  "changed",
  "type-changed",
  "moved",
  "equal-coerced",
  "equal",
  "ignored",
];

export const KIND_LABEL: Record<ChangeKind, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  "type-changed": "Type changed",
  moved: "Moved",
  equal: "Equal",
  "equal-coerced": "Coerced",
  ignored: "Ignored",
};

/** Kinds that can appear under the given show mode, in display order. */
export function kindsFor(show: ShowMode): ChangeKind[] {
  return ALL_KINDS.filter((k) => show === "all" || isDifference(k));
}

export function kindCount(s: Summary, kind: ChangeKind): number {
  switch (kind) {
    case "added":
      return s.added;
    case "removed":
      return s.removed;
    case "changed":
      return s.changed;
    case "type-changed":
      return s.typeChanged;
    case "moved":
      return s.moved;
    case "equal":
      return s.equal;
    case "equal-coerced":
      return s.equalCoerced;
    case "ignored":
      return s.ignored;
  }
}

export interface ValueCell {
  text: string;
  /** Longer form for a tooltip. */
  title: string;
  type: string;
  /** 1-based source line; null for synthesized nodes (e.g. env nesting intermediates). */
  line: number | null;
  masked: boolean;
}

export interface Row {
  /** Index into report.changes; stable within one report. */
  id: string;
  kind: ChangeKind;
  pathText: string;
  /** Destination path for moved items. */
  movedTo: string | null;
  left: ValueCell | null;
  right: ValueCell | null;
  /** Coercion rule or move destination. */
  note: string | null;
  severity: Finding["severity"] | null;
  message: string | null;
}

export interface ViewFilters {
  show: ShowMode;
  /** Kinds switched off by the kind toggles. */
  hiddenKinds: readonly ChangeKind[];
  /** Case-insensitive substring match on the path (and the moved-to path). */
  query: string;
}

export const DEFAULT_FILTERS: ViewFilters = { show: "diff", hiddenKinds: [], query: "" };

function cell(node: Node | undefined, masked: boolean): ValueCell | null {
  if (!node) return null;
  // Masked nodes were replaced by a string scalar holding the replacement: show it bare.
  const text = masked && node.kind === "scalar" ? String(node.value) : displayValue(node, 120);
  const title = masked ? "masked secret" : displayValue(node, 2000);
  return { text, title, type: nodeTypeName(node), line: node.loc?.line ?? null, masked };
}

function noteFor(c: Change, movedTo: string | null): string | null {
  if (c.coercion) return `${c.coercion.rule}: ${c.coercion.from} → ${c.coercion.to}`;
  if (c.kind === "moved" && movedTo) return `moved to ${movedTo}`;
  return null;
}

const findingKey = (c: Change): string => `${c.kind}\u0000${c.pathText}`;

/** One row per change, with the matching finding's severity attached. */
export function toRows(report: Report): Row[] {
  const byChange = new Map<Change, Finding>();
  const byKey = new Map<string, Finding>();
  for (const f of report.findings) {
    byChange.set(f.change, f);
    byKey.set(findingKey(f.change), f);
  }
  return report.changes.map((c, i) => {
    // Identity first; the key fallback covers reports that were cloned or deserialized.
    const finding = byChange.get(c) ?? byKey.get(findingKey(c)) ?? null;
    const movedTo = c.kind === "moved" && c.rightPath ? pathToText(c.rightPath) : null;
    const masked = c.masked === true;
    return {
      id: String(i),
      kind: c.kind,
      pathText: c.pathText,
      movedTo,
      left: cell(c.left, masked),
      right: cell(c.right, masked),
      note: noteFor(c, movedTo),
      severity: finding?.severity ?? null,
      message: finding?.message ?? null,
    };
  });
}

export function filterRows(rows: readonly Row[], filters: ViewFilters): Row[] {
  const hidden = new Set(filters.hiddenKinds);
  const q = filters.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.show === "diff" && !isDifference(r.kind)) return false;
    if (hidden.has(r.kind)) return false;
    if (q && !r.pathText.toLowerCase().includes(q) && !(r.movedTo?.toLowerCase().includes(q) ?? false)) return false;
    return true;
  });
}

/** Rows for a report under the given filters. */
export function buildRows(report: Report, filters: ViewFilters): Row[] {
  return filterRows(toRows(report), filters);
}

/** Diagnostics produced by the comparison itself (key folding collisions, LCS fallback, duplicate array keys). */
export function comparisonDiagnostics(report: Report): Diagnostic[] {
  return report.diagnostics;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
