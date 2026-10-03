import { useEffect, useRef, useState } from "react";
import { toJson, toMarkdown, type Report } from "@config-diff/core";
import { Check, Copy, Download } from "lucide-react";
import type { ShowMode } from "@/lib/report-view";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type CopyState = { which: "md" | "json"; ok: boolean } | null;

const btn =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs hover:bg-surface-2 disabled:opacity-40";

export function ExportBar({ report, show }: { report: Report | null; show: ShowMode }) {
  const [copied, setCopied] = useState<CopyState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async (which: "md" | "json") => {
    if (!report) return;
    const text = which === "md" ? toMarkdown(report, { show }) : toJson(report);
    const ok = await copyText(text);
    setCopied({ which, ok });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  };

  const label = (which: "md" | "json", text: string) =>
    copied?.which === which ? (copied.ok ? "Copied" : "Copy failed") : text;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Export report">
      <button type="button" className={btn} disabled={!report} onClick={() => void copy("md")}>
        {copied?.which === "md" && copied.ok ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
        <span aria-live="polite">{label("md", "Copy Markdown")}</span>
      </button>
      <button type="button" className={btn} disabled={!report} onClick={() => void copy("json")}>
        {copied?.which === "json" && copied.ok ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
        <span aria-live="polite">{label("json", "Copy JSON")}</span>
      </button>
      <button
        type="button"
        className={btn}
        disabled={!report}
        onClick={() => report && download("report.md", toMarkdown(report, { show }), "text/markdown;charset=utf-8")}
      >
        <Download aria-hidden className="size-3.5" />
        report.md
      </button>
    </div>
  );
}
