import type { ChangeKind } from "@config-diff/core";
import { cn } from "@/lib/cn";
import { KIND_LABEL } from "@/lib/report-view";

/** Literal class strings per kind so Tailwind can see them. Added and removed never share a hue. */
export const KIND_TONE: Record<ChangeKind, { badge: string; dot: string; text: string }> = {
  added: { badge: "bg-added/12 text-added ring-added/30", dot: "bg-added", text: "text-added" },
  removed: { badge: "bg-removed/12 text-removed ring-removed/30", dot: "bg-removed", text: "text-removed" },
  changed: { badge: "bg-changed/12 text-changed ring-changed/30", dot: "bg-changed", text: "text-changed" },
  "type-changed": {
    badge: "bg-type-changed/12 text-type-changed ring-type-changed/30",
    dot: "bg-type-changed",
    text: "text-type-changed",
  },
  moved: { badge: "bg-moved/12 text-moved ring-moved/30", dot: "bg-moved", text: "text-moved" },
  "equal-coerced": { badge: "bg-coerced/12 text-coerced ring-coerced/30", dot: "bg-coerced", text: "text-coerced" },
  equal: { badge: "bg-equal/10 text-equal ring-equal/25", dot: "bg-equal", text: "text-equal" },
  ignored: { badge: "bg-ignored/10 text-ignored ring-ignored/25 italic", dot: "bg-ignored", text: "text-ignored" },
};

const SYMBOL: Record<ChangeKind, string> = {
  added: "+",
  removed: "−",
  changed: "~",
  "type-changed": "!",
  moved: "↕",
  equal: "=",
  "equal-coerced": "≈",
  ignored: "·",
};

export function KindBadge({ kind, className }: { kind: ChangeKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        KIND_TONE[kind].badge,
        className,
      )}
    >
      <span aria-hidden className="font-mono">
        {SYMBOL[kind]}
      </span>
      {KIND_LABEL[kind]}
    </span>
  );
}
