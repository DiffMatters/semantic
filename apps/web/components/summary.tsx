import type { ChangeKind, Report } from "@config-diff/core";
import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { ALL_KINDS, KIND_LABEL, isDifference, kindCount, plural, type ViewFilters } from "@/lib/report-view";
import { KIND_TONE } from "./kind-badge";

interface SummaryProps {
  report: Report;
  filters: ViewFilters;
  onToggleKind(kind: ChangeKind): void;
}

export function Summary({ report, filters, onToggleKind }: SummaryProps) {
  const s = report.summary;
  const differences = s.added + s.removed + s.changed + s.typeChanged + s.moved;

  return (
    <div className="space-y-3">
      {report.identical ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-success/30 bg-success/8 px-4 py-3" role="status">
          <CheckCircle2 aria-hidden className="size-5 text-success" />
          <span className="text-base font-semibold text-success">Identical</span>
          <span className="text-sm text-muted">
            No differences in {plural(s.total, "compared value")}: {s.equal} equal
            {", "}
            <span className={cn(s.equalCoerced > 0 && "font-medium text-coerced")}>{s.equalCoerced} equal only after coercion</span>
            {s.ignored > 0 && `, ${s.ignored} ignored`}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
          <span className="text-base font-semibold">{plural(differences, "difference")}</span>
          <span className="text-sm text-muted">in {plural(s.total, "compared value")}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5" aria-label="Counts by kind; click to show or hide">
        {ALL_KINDS.map((kind) => {
          const n = kindCount(s, kind);
          const inMode = filters.show === "all" || isDifference(kind);
          const visible = inMode && !filters.hiddenKinds.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={visible}
              onClick={() => onToggleKind(kind)}
              disabled={n === 0}
              title={visible ? `Hide ${KIND_LABEL[kind].toLowerCase()} rows` : `Show ${KIND_LABEL[kind].toLowerCase()} rows`}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs tabular-nums transition-colors",
                visible ? "border-border-strong bg-surface" : "border-border bg-transparent text-muted",
                n === 0 && "cursor-default opacity-45",
              )}
            >
              <span aria-hidden className={cn("size-2 rounded-full", KIND_TONE[kind].dot, !visible && "opacity-40")} />
              <span className={cn(visible && "font-semibold", visible && KIND_TONE[kind].text)}>{n}</span>
              <span>{KIND_LABEL[kind]}</span>
            </button>
          );
        })}
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs tabular-nums",
            s.errors > 0 ? "bg-error/12 font-semibold text-error" : "text-muted",
          )}
        >
          <CircleAlert aria-hidden className="size-3.5" />
          {plural(s.errors, "error")}
        </span>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs tabular-nums",
            s.warnings > 0 ? "bg-warn/12 font-semibold text-warn" : "text-muted",
          )}
        >
          <TriangleAlert aria-hidden className="size-3.5" />
          {plural(s.warnings, "warning")}
        </span>
      </div>
    </div>
  );
}
