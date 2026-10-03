import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { newRuleId, type ArrayRuleDraft, type OptionIssue, type RuleStrategy } from "@/lib/options";

interface ArrayRulesEditorProps {
  rules: ArrayRuleDraft[];
  issues: OptionIssue[];
  onChange(rules: ArrayRuleDraft[]): void;
}

const input = "h-7 rounded-md border border-border bg-surface px-2 text-xs";

export function ArrayRulesEditor({ rules, issues, onChange }: ArrayRulesEditorProps) {
  const update = (id: string, patch: Partial<ArrayRuleDraft>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className="mb-1.5 text-xs font-medium text-muted">Array rules</legend>
      {rules.length === 0 && <p className="text-xs text-muted">All arrays compare in order. Add a rule to match by set or key.</p>}
      {rules.map((r, i) => {
        const issue = issues.find((x) => x.source === r.id);
        return (
          <div key={r.id} className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="sr-only" htmlFor={`${r.id}-pattern`}>
                Rule {i + 1} path pattern
              </label>
              <input
                id={`${r.id}-pattern`}
                value={r.pattern}
                onChange={(e) => update(r.id, { pattern: e.target.value })}
                placeholder="servers or **.ports"
                spellCheck={false}
                aria-invalid={issue ? true : undefined}
                className={cn(input, "w-40 font-mono", issue && "border-error")}
              />
              <label className="sr-only" htmlFor={`${r.id}-strategy`}>
                Rule {i + 1} strategy
              </label>
              <select
                id={`${r.id}-strategy`}
                value={r.strategy}
                onChange={(e) => update(r.id, { strategy: e.target.value as RuleStrategy })}
                className={input}
              >
                <option value="ordered">ordered</option>
                <option value="set">set</option>
                <option value="keyed">keyed by…</option>
              </select>
              {r.strategy === "keyed" && (
                <>
                  <label className="sr-only" htmlFor={`${r.id}-field`}>
                    Rule {i + 1} key field
                  </label>
                  <input
                    id={`${r.id}-field`}
                    value={r.field}
                    onChange={(e) => update(r.id, { field: e.target.value })}
                    placeholder="name"
                    spellCheck={false}
                    className={cn(input, "w-24 font-mono")}
                  />
                </>
              )}
              <button
                type="button"
                onClick={() => onChange(rules.filter((x) => x.id !== r.id))}
                aria-label={`Remove rule ${i + 1}`}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <Trash2 aria-hidden className="size-3.5" />
              </button>
            </div>
            {issue && <p className="text-[11px] text-error">{issue.message}</p>}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...rules, { id: newRuleId(), pattern: "", strategy: "keyed", field: "name" }])}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border-strong px-2 text-xs text-muted hover:text-foreground"
      >
        <Plus aria-hidden className="size-3.5" />
        Add rule
      </button>
    </fieldset>
  );
}
