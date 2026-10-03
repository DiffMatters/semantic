import { useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { cn } from "@/lib/cn";

/** Must match the leading-5 / py-2 classes below: 20px lines, 8px top padding. */
const LINE_HEIGHT = 20;
const PAD_TOP = 8;

export interface CodeEditorHandle {
  /**
   * Scroll the given 1-based line into view and highlight it.
   * With `select`, also focus the textarea and select the line (used by "go to line").
   */
  revealLine(line: number, opts?: { select?: boolean }): void;
}

interface CodeEditorProps {
  id: string;
  value: string;
  onChange(value: string): void;
  label: string;
  placeholder?: string;
  /** Line with a parse error, marked in the gutter. */
  errorLine?: number | null;
  ref?: Ref<CodeEditorHandle>;
}

function lineBounds(text: string, line: number): [number, number] {
  let start = 0;
  for (let i = 1; i < line; i++) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return [text.length, text.length];
    start = nl + 1;
  }
  const end = text.indexOf("\n", start);
  return [start, end === -1 ? text.length : end];
}

/** Plain textarea with a synced line-number gutter and a line highlight layer. */
export function CodeEditor({ id, value, onChange, label, placeholder, errorLine, ref }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

  const lineCount = useMemo(() => {
    let n = 1;
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) n++;
    return n;
  }, [value]);

  // Gutter and highlight layers follow the textarea scroll via direct style writes (no re-render per scroll).
  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const t = `translateY(${-ta.scrollTop}px)`;
    if (layerRef.current) layerRef.current.style.transform = t;
    if (barRef.current) barRef.current.style.transform = t;
  };

  useImperativeHandle(
    ref,
    () => ({
      revealLine(line, opts) {
        const ta = textareaRef.current;
        if (!ta) return;
        const target = Math.max(1, Math.min(line, lineCount));
        setHighlight(target);
        const top = PAD_TOP + (target - 1) * LINE_HEIGHT;
        ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
        syncScroll();
        if (opts?.select) {
          const [start, end] = lineBounds(ta.value, target);
          ta.focus({ preventScroll: true });
          ta.setSelectionRange(start, end);
          ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
          syncScroll();
        }
      },
    }),
    [lineCount],
  );

  const numbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount]);

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden font-mono text-[12.5px] leading-5">
      <div
        aria-hidden
        className="relative w-11 shrink-0 overflow-hidden border-r border-border bg-surface-2 text-right text-muted select-none"
      >
        <div ref={layerRef} className="absolute inset-x-0 top-0 py-2 will-change-transform">
          {numbers.map((n) => (
            <div
              key={n}
              className={cn(
                "h-5 pr-2 tabular-nums",
                n === highlight && "font-semibold text-accent",
                n === errorLine && "bg-error/15 font-semibold text-error",
              )}
            >
              {n}
            </div>
          ))}
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        {highlight !== null && (
          <div
            aria-hidden
            ref={(el) => {
              barRef.current = el;
              syncScroll();
            }}
            className="pointer-events-none absolute inset-x-0 top-0"
          >
            <div
              className="absolute inset-x-0 h-5 border-y border-accent/30 bg-highlight"
              style={{ top: PAD_TOP + (highlight - 1) * LINE_HEIGHT }}
            />
          </div>
        )}
        <textarea
          ref={textareaRef}
          id={id}
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (e.key === "Escape") setHighlight(null);
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          className="relative h-full w-full resize-none overflow-auto bg-transparent px-3 py-2 whitespace-pre text-foreground outline-none placeholder:text-muted"
        />
      </div>
    </div>
  );
}
