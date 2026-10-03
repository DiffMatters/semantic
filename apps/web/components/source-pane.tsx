import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { FORMATS, type Diagnostic, type Format } from "@config-diff/core";
import { AlertTriangle, FileUp, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FormatChoice, ParseOutcome, SourceState } from "@/lib/parse-source";
import { plural } from "@/lib/report-view";
import { CodeEditor, type CodeEditorHandle } from "./code-editor";

interface SourcePaneProps {
  side: "left" | "right";
  title: string;
  role: string;
  value: SourceState;
  onChange(next: SourceState): void;
  /** Format auto-detection would pick for the current text and name. */
  detected: Format;
  outcome: ParseOutcome;
  /** True while the deferred parse lags behind the typed text. */
  pending: boolean;
  ref?: Ref<CodeEditorHandle>;
}

const FORMAT_LABEL: Record<Format, string> = { json: "JSON", yaml: "YAML", env: ".env" };

export function SourcePane({ side, title, role, value, onChange, detected, outcome, pending, ref }: SourcePaneProps) {
  const editorRef = useRef<CodeEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const id = `source-${side}`;

  useImperativeHandle(ref, () => ({ revealLine: (line, opts) => editorRef.current?.revealLine(line, opts) }), []);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setReadError(null);
      onChange({ text, name: file.name, format: "auto" });
    } catch (e) {
      setReadError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const goTo = (line: number) => editorRef.current?.revealLine(line, { select: true });

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm",
        dragging && "border-accent ring-2 ring-accent/40",
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void loadFile(e.dataTransfer.files[0]);
      }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="mr-auto flex min-w-0 items-baseline gap-2">
          <h2 id={`${id}-title`} className="text-sm font-semibold">
            {title}
          </h2>
          <span className="text-xs text-muted">{role}</span>
          {value.name && (
            <span className="truncate font-mono text-xs text-muted" title={value.name}>
              {value.name}
            </span>
          )}
        </div>
        <label className="sr-only" htmlFor={`${id}-format`}>
          {title} format
        </label>
        <select
          id={`${id}-format`}
          value={value.format}
          onChange={(e) => onChange({ ...value, format: e.target.value as FormatChoice })}
          className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs"
        >
          <option value="auto">Auto (detected: {FORMAT_LABEL[detected]})</option>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f]}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".json,.jsonc,.yaml,.yml,.env,.txt,text/*,application/json"
          onChange={(e) => {
            void loadFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-surface-2"
        >
          <FileUp aria-hidden className="size-3.5" />
          Open file
        </button>
        <button
          type="button"
          onClick={() => onChange({ text: "", name: "", format: "auto" })}
          disabled={value.text === "" && value.name === ""}
          aria-label={`Clear ${title}`}
          title="Clear"
          className="inline-flex size-7 items-center justify-center rounded-md border border-border hover:bg-surface-2 disabled:opacity-40"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </header>

      <div className="relative h-72 lg:h-[26rem]">
        <CodeEditor
          ref={editorRef}
          id={id}
          label={`${title} (${role}) source`}
          value={value.text}
          onChange={(text) => onChange({ ...value, text })}
          placeholder={`Paste ${role} config here, or drop a .json / .yaml / .env file`}
          errorLine={outcome.status === "error" ? outcome.line : null}
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/80 text-sm font-medium text-accent">
            Drop file to load into {title}
          </div>
        )}
      </div>

      <PaneStatus outcome={outcome} pending={pending} readError={readError} onGoTo={goTo} />
    </section>
  );
}

function PaneStatus({
  outcome,
  pending,
  readError,
  onGoTo,
}: {
  outcome: ParseOutcome;
  pending: boolean;
  readError: string | null;
  onGoTo(line: number): void;
}) {
  return (
    <div className="min-h-9 border-t border-border px-3 py-2 text-xs" aria-live="polite">
      {readError && <p className="text-error">{readError}</p>}
      {outcome.status === "empty" && !readError && <p className="text-muted">Empty</p>}
      {outcome.status === "error" && (
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1 text-error" role="alert">
          <XCircle aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="font-medium">
            Parse error{outcome.line !== null && ` at ${outcome.line}:${outcome.col ?? 1}`}
          </span>
          <span className="min-w-0 flex-1 break-words text-foreground">{outcome.message}</span>
          {outcome.line !== null && (
            <button
              type="button"
              onClick={() => onGoTo(outcome.line as number)}
              className="rounded border border-error/40 px-1.5 py-px font-medium hover:bg-error/10"
            >
              Go to line {outcome.line}
            </button>
          )}
        </div>
      )}
      {outcome.status === "ok" && (
        <OkStatus format={outcome.doc.format} diagnostics={outcome.doc.diagnostics} pending={pending} onGoTo={onGoTo} />
      )}
    </div>
  );
}

function OkStatus({
  format,
  diagnostics,
  pending,
  onGoTo,
}: {
  format: Format;
  diagnostics: Diagnostic[];
  pending: boolean;
  onGoTo(line: number): void;
}) {
  const head = (
    <span className="text-muted">
      Parsed as {FORMAT_LABEL[format]}
      {pending && " · updating…"}
    </span>
  );
  if (diagnostics.length === 0) return <p>{head}</p>;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        {head}
        <span className="inline-flex items-center gap-1 text-warn">
          <AlertTriangle aria-hidden className="size-3.5" />
          {plural(diagnostics.length, "warning")}
        </span>
        <span className="text-muted group-open:hidden">show</span>
        <span className="hidden text-muted group-open:inline">hide</span>
      </summary>
      <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-auto">
        {diagnostics.map((d, i) => (
          <li key={i} className="flex gap-2">
            {d.loc ? (
              <button
                type="button"
                onClick={() => onGoTo(d.loc!.line)}
                className="shrink-0 font-mono text-accent hover:underline"
                title="Go to line"
              >
                {d.loc.line}:{d.loc.col}
              </button>
            ) : (
              <span className="shrink-0 font-mono text-muted">–</span>
            )}
            <span className={cn("shrink-0 font-mono", d.severity === "error" ? "text-error" : "text-warn")}>{d.code}</span>
            <span className="min-w-0 break-words">{d.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
