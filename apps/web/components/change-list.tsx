import { useState, type KeyboardEvent } from "react";
import { Lock, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { plural, type Row, type ShowMode, type ValueCell } from "@/lib/report-view";
import { KindBadge } from "./kind-badge";

const PAGE = 300;

interface ChangeListProps {
  rows: Row[];
  totalRows: number;
  show: ShowMode;
  query: string;
  selectedId: string | null;
  onShowChange(show: ShowMode): void;
  onQueryChange(query: string): void;
  onSelect(row: Row): void;
}

export function ChangeList({ rows, totalRows, show, query, selectedId, onShowChange, onQueryChange, onSelect }: ChangeListProps) {
  const [limit, setLimit] = useState(PAGE);
  const shown = rows.slice(0, limit);

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(row);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sib = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      if (sib instanceof HTMLElement) sib.focus();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Rows to show" className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
          {(["diff", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={show === v}
              onClick={() => onShowChange(v)}
              className={cn(
                "h-6 rounded px-2.5 text-xs text-muted hover:text-foreground",
                show === v && "bg-surface font-medium text-foreground shadow-sm",
              )}
            >
              {v === "diff" ? "Differences" : "All"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" />
          <label htmlFor="path-filter" className="sr-only">
            Filter by path
          </label>
          <input
            id="path-filter"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter paths…"
            spellCheck={false}
            className="h-7 w-56 rounded-md border border-border bg-surface pr-2 pl-7 font-mono text-xs"
          />
        </div>
        <span className="text-xs text-muted" aria-live="polite">
          {rows.length === totalRows ? plural(rows.length, "row") : `${rows.length} of ${plural(totalRows, "row")}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <caption className="sr-only">Changes. Select a row to highlight its lines in both sources.</caption>
          <thead className="border-b border-border bg-surface-2 text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" className="w-28 px-3 py-2 font-medium">
                Kind
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Path
              </th>
              <th scope="col" className="w-[26%] px-3 py-2 font-medium">
                Left
              </th>
              <th scope="col" className="w-[26%] px-3 py-2 font-medium">
                Right
              </th>
              <th scope="col" className="w-20 px-3 py-2 font-medium">
                Severity
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  {totalRows === 0 ? "Nothing to compare." : "No rows match the current filters."}
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                aria-selected={r.id === selectedId}
                onClick={() => onSelect(r)}
                onKeyDown={(e) => onRowKey(e, r)}
                title={r.message ?? undefined}
                className={cn(
                  "cursor-pointer border-b border-border align-top last:border-b-0 hover:bg-surface-2 focus-visible:outline-offset-[-2px]",
                  r.id === selectedId && "bg-highlight hover:bg-highlight",
                )}
              >
                <td className="px-3 py-1.5">
                  <KindBadge kind={r.kind} />
                </td>
                <td className="px-3 py-1.5">
                  <div className="font-mono break-all">{r.pathText || "(root)"}</div>
                  {r.note && <div className="mt-0.5 text-[11px] text-muted">{r.note}</div>}
                </td>
                <td className="px-3 py-1.5">
                  <Value cell={r.left} />
                </td>
                <td className="px-3 py-1.5">
                  <Value cell={r.right} />
                </td>
                <td className="px-3 py-1.5">
                  {r.severity && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        r.severity === "error" ? "bg-error/12 text-error" : "bg-warn/12 text-warn",
                      )}
                    >
                      {r.severity === "error" ? "error" : "warn"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="h-7 rounded-md border border-border px-3 text-xs hover:bg-surface-2"
        >
          Show {Math.min(PAGE, rows.length - limit)} more ({rows.length - limit} hidden)
        </button>
      )}
    </div>
  );
}

function Value({ cell }: { cell: ValueCell | null }) {
  if (!cell) return <span className="text-muted">—</span>;
  return (
    <div className="flex items-start gap-1.5">
      {cell.masked && <Lock aria-label="masked" className="mt-0.5 size-3 shrink-0 text-muted" />}
      <span className={cn("min-w-0 font-mono break-all", cell.masked && "text-muted")} title={cell.title}>
        {cell.text}
      </span>
      {cell.line !== null && <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">L{cell.line}</span>}
    </div>
  );
}
