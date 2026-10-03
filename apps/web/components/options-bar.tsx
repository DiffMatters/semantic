import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEFAULT_OPTIONS,
  POLICY_NAMES,
  PRESETS,
  activePresetId,
  applyPreset,
  type OptionIssue,
  type PolicyName,
  type UiOptions,
} from "@/lib/options";
import { ArrayRulesEditor } from "./array-rules-editor";

interface OptionsBarProps {
  options: UiOptions;
  issues: OptionIssue[];
  onChange(next: UiOptions): void;
}

const label = "text-xs font-medium text-muted";
const control = "h-7 rounded-md border border-border bg-surface px-2 text-xs";

function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange(v: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 rounded px-2.5 text-xs whitespace-nowrap text-muted hover:text-foreground",
            value === o.value && "bg-surface font-medium text-foreground shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function OptionsBar({ options, issues, onChange }: OptionsBarProps) {
  const set = (patch: Partial<UiOptions>) => onChange({ ...options, ...patch });
  const presetId = activePresetId(options);
  const ignoreIssues = issues.filter((i) => i.source === "ignore");

  return (
    <section aria-label="Comparison options" className="rounded-lg border border-border bg-surface p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={label}>Scenario</span>
          <Segmented
            name="Scenario preset"
            value={presetId}
            options={PRESETS.map((p) => ({ value: p.id, label: p.label, title: p.description }))}
            onChange={(id) => onChange(applyPreset(options, PRESETS.find((p) => p.id === id)!))}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className={label}>Mode</span>
          <Segmented
            name="Mode"
            value={options.mode}
            options={[
              { value: "strict", label: "Strict", title: "Exact keys, types and values" },
              { value: "loose", label: "Loose", title: "Fold key case/style, coerce \"8080\" = 8080, true = \"yes\", …" },
            ]}
            onChange={(mode) => set({ mode })}
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="opt-policy" className={label}>
            Policy
          </label>
          <select
            id="opt-policy"
            value={options.policy}
            onChange={(e) => set({ policy: e.target.value as PolicyName })}
            className={control}
          >
            {POLICY_NAMES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={options.emptyStringIsNull}
            onChange={(e) => set({ emptyStringIsNull: e.target.checked })}
            className="accent-accent"
          />
          &quot;&quot; equals null
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={options.mask} onChange={(e) => set({ mask: e.target.checked })} className="accent-accent" />
          Mask secrets
        </label>
        <div className="flex items-center gap-2">
          <label htmlFor="opt-env-sep" className={label}>
            .env separator
          </label>
          <input
            id="opt-env-sep"
            value={options.envSeparator}
            onChange={(e) => set({ envSeparator: e.target.value })}
            placeholder="none"
            spellCheck={false}
            aria-describedby="opt-env-sep-hint"
            className={cn(control, "w-14 font-mono")}
          />
          <span id="opt-env-sep-hint" className="sr-only">
            Key separator that nests .env keys, for example two underscores. Leave empty to disable nesting.
          </span>
        </div>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_OPTIONS)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Reset
        </button>
      </div>

      <details className="group mt-3 border-t border-border pt-2">
        <summary className="cursor-pointer text-xs font-medium text-muted select-none hover:text-foreground">
          Array rules &amp; ignore patterns
          {(options.arrayRules.length > 0 || options.ignore.trim() !== "") && (
            <span className="ml-2 font-normal">
              ({options.arrayRules.length} rule{options.arrayRules.length === 1 ? "" : "s"}
              {options.ignore.trim() !== "" && ", ignoring paths"})
            </span>
          )}
        </summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <ArrayRulesEditor rules={options.arrayRules} issues={issues} onChange={(arrayRules) => set({ arrayRules })} />
          <div className="min-w-0">
            <label htmlFor="opt-ignore" className={cn(label, "mb-1.5 block")}>
              Ignore paths
            </label>
            <textarea
              id="opt-ignore"
              value={options.ignore}
              onChange={(e) => set({ ignore: e.target.value })}
              rows={3}
              spellCheck={false}
              placeholder={"metadata.**, *.updatedAt\nservers[*].id"}
              aria-invalid={ignoreIssues.length > 0 || undefined}
              className={cn(
                "w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs",
                ignoreIssues.length > 0 && "border-error",
              )}
            />
            <p className="mt-1 text-[11px] text-muted">
              Comma or newline separated. <code className="font-mono">*</code> one segment,{" "}
              <code className="font-mono">**</code> any depth, <code className="font-mono">[*]</code> any index.
            </p>
            {ignoreIssues.map((i, n) => (
              <p key={n} className="text-[11px] text-error">
                {i.message}
              </p>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}
