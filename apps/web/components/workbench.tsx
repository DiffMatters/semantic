"use client";

/**
 * The only client boundary. Owns pane text (never persisted), view filters and selection;
 * options live in a localStorage-backed store. Parsing and comparison run here, in the browser.
 */
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { compareDocuments, detectFormat, type ChangeKind, type Report } from "@config-diff/core";
import { ArrowLeftRight, GitCompareArrows } from "lucide-react";
import { useOptions } from "@/lib/options-store";
import { PRESETS, applyPreset, resolveUiOptions } from "@/lib/options";
import { parseSource, type ParseOutcome, type SourceState } from "@/lib/parse-source";
import {
  DEFAULT_FILTERS,
  comparisonDiagnostics,
  filterRows,
  isDifference,
  toRows,
  type Row,
  type ViewFilters,
} from "@/lib/report-view";
import { SAMPLES } from "@/lib/samples";
import type { CodeEditorHandle } from "./code-editor";
import { ChangeList } from "./change-list";
import { ExportBar } from "./export-bar";
import { OptionsBar } from "./options-bar";
import { SourcePane } from "./source-pane";
import { Summary } from "./summary";

/** Parse one side from its deferred text; only this side's inputs are memo keys. */
function useParsedSide(side: SourceState, envSeparator: string | null) {
  const text = useDeferredValue(side.text);
  const detected = useMemo(() => detectFormat(text, side.name || undefined), [text, side.name]);
  const format = side.format === "auto" ? detected : side.format;
  // The env separator only matters for .env input; keep it out of the key otherwise.
  const sep = format === "env" ? envSeparator : undefined;
  const outcome = useMemo(() => parseSource(text, format, side.name, sep), [text, format, side.name, sep]);
  return { outcome, detected, pending: text !== side.text };
}

type Comparison = { status: "ok"; report: Report } | { status: "error"; message: string } | { status: "waiting" };

function runCompare(left: ParseOutcome, right: ParseOutcome, resolved: ReturnType<typeof resolveUiOptions>): Comparison {
  if (left.status !== "ok" || right.status !== "ok") return { status: "waiting" };
  try {
    return { status: "ok", report: compareDocuments(left.doc, right.doc, resolved.options, resolved.policy) };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export function Workbench() {
  const [options, setOptions] = useOptions();
  const [left, setLeft] = useState<SourceState>(SAMPLES[0].left);
  const [right, setRight] = useState<SourceState>(SAMPLES[0].right);
  const [filters, setFilters] = useState<ViewFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const leftRef = useRef<CodeEditorHandle>(null);
  const rightRef = useRef<CodeEditorHandle>(null);
  const panesRef = useRef<HTMLDivElement>(null);

  const resolved = useMemo(() => resolveUiOptions(options), [options]);
  const l = useParsedSide(left, resolved.envSeparator);
  const r = useParsedSide(right, resolved.envSeparator);
  const comparison = useMemo(() => runCompare(l.outcome, r.outcome, resolved), [l.outcome, r.outcome, resolved]);
  const report = comparison.status === "ok" ? comparison.report : null;

  const allRows = useMemo(() => (report ? toRows(report) : []), [report]);
  const rows = useMemo(() => filterRows(allRows, filters), [allRows, filters]);
  const diffDiagnostics = report ? comparisonDiagnostics(report) : [];

  const loadSample = (id: string) => {
    const sample = SAMPLES.find((s) => s.id === id);
    if (!sample) return;
    setLeft(sample.left);
    setRight(sample.right);
    setSelectedId(null);
    const preset = PRESETS.find((p) => p.id === sample.preset);
    if (preset) setOptions((o) => applyPreset(o, preset));
  };

  const swap = () => {
    setLeft(right);
    setRight(left);
    setSelectedId(null);
  };

  const toggleKind = (kind: ChangeKind) =>
    setFilters((f) => {
      if (f.show === "diff" && !isDifference(kind)) {
        // Equal / coerced / ignored rows only exist under "All": switch and make sure the kind is shown.
        return { ...f, show: "all", hiddenKinds: f.hiddenKinds.filter((k) => k !== kind) };
      }
      const hidden = f.hiddenKinds.includes(kind) ? f.hiddenKinds.filter((k) => k !== kind) : [...f.hiddenKinds, kind];
      return { ...f, hiddenKinds: hidden };
    });

  const selectRow = (row: Row) => {
    setSelectedId(row.id);
    if (row.left?.line) leftRef.current?.revealLine(row.left.line);
    if (row.right?.line) rightRef.current?.revealLine(row.right.line);
    const panes = panesRef.current;
    if (panes) {
      const rect = panes.getBoundingClientRect();
      // Bring the panes back into view only when they are entirely off-screen.
      if (rect.bottom < 0 || rect.top > window.innerHeight) panes.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  const changeSide = (setter: (s: SourceState) => void) => (next: SourceState) => {
    setter(next);
    setSelectedId(null);
  };

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="mr-auto flex items-center gap-2.5">
          <GitCompareArrows aria-hidden className="size-6 text-accent" />
          <div>
            <h1 className="text-lg leading-tight font-semibold tracking-tight">Config Diff</h1>
            <p className="text-xs text-muted">Semantic diff for JSON, YAML and .env. Everything runs in your browser.</p>
          </div>
        </div>
        <label htmlFor="sample-select" className="sr-only">
          Load sample
        </label>
        <select
          id="sample-select"
          value=""
          onChange={(e) => loadSample(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        >
          <option value="" disabled>
            Load sample…
          </option>
          {SAMPLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={swap}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs hover:bg-surface-2"
        >
          <ArrowLeftRight aria-hidden className="size-3.5" />
          Swap sides
        </button>
      </header>

      <OptionsBar options={options} issues={resolved.issues} onChange={setOptions} />

      <div ref={panesRef} className="grid scroll-mt-4 gap-4 lg:grid-cols-2">
        <SourcePane
          ref={leftRef}
          side="left"
          title="Left"
          role="baseline"
          value={left}
          onChange={changeSide(setLeft)}
          detected={l.detected}
          outcome={l.outcome}
          pending={l.pending}
        />
        <SourcePane
          ref={rightRef}
          side="right"
          title="Right"
          role="candidate"
          value={right}
          onChange={changeSide(setRight)}
          detected={r.detected}
          outcome={r.outcome}
          pending={r.pending}
        />
      </div>

      <section aria-labelledby="results-title" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="results-title" className="mr-auto text-sm font-semibold">
            Results
            <span className="ml-2 font-normal text-muted">
              {options.mode} mode · {options.policy} policy
            </span>
          </h2>
          <ExportBar report={report} show={filters.show} />
        </div>

        {comparison.status === "waiting" && (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">
            {l.outcome.status === "error" || r.outcome.status === "error"
              ? "Fix the parse error above to see the comparison."
              : "Paste, open or drop a config into both panes, or load a sample."}
          </p>
        )}
        {comparison.status === "error" && (
          <p role="alert" className="rounded-lg border border-error/40 bg-error/8 px-4 py-3 text-sm text-error">
            Comparison failed: {comparison.message}
          </p>
        )}
        {report && (
          <div className={l.pending || r.pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
            <div className="space-y-3">
              <Summary report={report} filters={filters} onToggleKind={toggleKind} />
              {diffDiagnostics.length > 0 && (
                <ul className="space-y-0.5 text-xs text-warn">
                  {diffDiagnostics.map((d, i) => (
                    <li key={i}>
                      <span className="font-mono">{d.code}</span> {d.message}
                    </li>
                  ))}
                </ul>
              )}
              <ChangeList
                rows={rows}
                totalRows={filters.show === "all" ? allRows.length : allRows.filter((x) => isDifference(x.kind)).length}
                show={filters.show}
                query={filters.query}
                selectedId={selectedId}
                onShowChange={(show) => setFilters((f) => ({ ...f, show }))}
                onQueryChange={(query) => setFilters((f) => ({ ...f, query }))}
                onSelect={selectRow}
              />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
