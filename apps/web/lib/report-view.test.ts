import { compare, compareDocuments, fromJS, parse, type Report } from "@config-diff/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, activePresetId, resolveUiOptions, sanitizeOptions, splitPatterns } from "./options";
import { parseSource } from "./parse-source";
import { buildRows, comparisonDiagnostics, displayValue, filterRows, kindCount, kindsFor, toRows } from "./report-view";
import { SAMPLES } from "./samples";

function report(left: string, right: string, extra: Partial<typeof DEFAULT_OPTIONS> = {}): Report {
  const r = resolveUiOptions({ ...DEFAULT_OPTIONS, ...extra });
  return compare({
    left: { text: left, name: "l.json" },
    right: { text: right, name: "r.yaml" },
    options: r.options,
    policy: r.policy,
  });
}

describe("toRows / filterRows", () => {
  const rep = report(
    '{\n  "a": 1,\n  "b": "x",\n  "port": "8080",\n  "password": "old"\n}\n',
    "a: 2\nport: 8080\npassword: new\nc: true\n",
  );

  it("maps every change to a row with lines and severity from findings", () => {
    const rows = toRows(rep);
    expect(rows).toHaveLength(rep.changes.length);
    const a = rows.find((r) => r.pathText === "a")!;
    expect(a.kind).toBe("changed");
    expect(a.left).toMatchObject({ text: "1", line: 2 });
    expect(a.right).toMatchObject({ text: "2", line: 1 });
    expect(a.severity).toBe("error"); // equivalence policy
    expect(rows.find((r) => r.pathText === "b")).toMatchObject({ kind: "removed", right: null });
    expect(rows.find((r) => r.pathText === "c")).toMatchObject({ kind: "added", left: null });
  });

  it("notes coercions and leaves them without severity under equivalence", () => {
    const port = toRows(rep).find((r) => r.pathText === "port")!;
    expect(port.kind).toBe("equal-coerced");
    expect(port.note).toMatch(/string → number|number → string/);
    expect(port.severity).toBeNull();
  });

  it("renders masked values as the bare replacement", () => {
    const pw = toRows(rep).find((r) => r.pathText === "password")!;
    expect(pw.left?.masked).toBe(true);
    expect(pw.left?.text).toBe(rep.options.mask.replacement);
    expect(pw.right?.text).not.toContain("new");
  });

  it("filters by show mode, hidden kinds and path query", () => {
    const diff = buildRows(rep, { show: "diff", hiddenKinds: [], query: "" });
    expect(diff.map((r) => r.kind).sort()).toEqual(["added", "changed", "changed", "removed"]);
    const all = buildRows(rep, { show: "all", hiddenKinds: [], query: "" });
    expect(all.some((r) => r.kind === "equal-coerced")).toBe(true);
    const noAdded = buildRows(rep, { show: "diff", hiddenKinds: ["added"], query: "" });
    expect(noAdded.some((r) => r.kind === "added")).toBe(false);
    expect(filterRows(toRows(rep), { show: "all", hiddenKinds: [], query: "PORT" }).map((r) => r.pathText)).toEqual(["port"]);
  });

  it("finds severity by key when the report was cloned", () => {
    const cloned = structuredClone(rep);
    expect(toRows(cloned).find((r) => r.pathText === "a")?.severity).toBe("error");
  });

  it("describes moved items with their destination", () => {
    const rep2 = report('{"xs":[1,2,3]}', "xs: [3, 1, 2]\n", { mode: "strict", policy: "strict-ci" });
    const moved = toRows(rep2).filter((r) => r.kind === "moved");
    expect(moved.length).toBeGreaterThan(0);
    expect(moved[0].movedTo).toMatch(/^xs\[\d\]$/);
    expect(moved[0].note).toContain("moved to");
  });
});

describe("helpers", () => {
  it("displayValue matches core formatting", () => {
    expect(displayValue(fromJS("x"))).toBe('"x"');
    expect(displayValue(fromJS([1, { a: null }]))).toBe('[1,{"a":null}]');
    expect(displayValue(fromJS({}))).toBe("{}");
    expect(displayValue(fromJS("a".repeat(100)), 10)).toHaveLength(10);
  });

  it("kindsFor and kindCount", () => {
    expect(kindsFor("diff")).toEqual(["added", "removed", "changed", "type-changed", "moved"]);
    expect(kindsFor("all")).toHaveLength(8);
    const rep = report('{"a":1}', "a: 1\n");
    expect(kindCount(rep.summary, "equal")).toBe(1);
  });

  it("separates comparison diagnostics from parse diagnostics", () => {
    const l = parse('{"fooBar": 1, "foo_bar": 2}', { format: "json" });
    const r = parse('{"x": 1, "x": 2}', { format: "json" });
    const rep = compareDocuments(l, r, { mode: "loose" });
    expect(comparisonDiagnostics(rep).map((d) => d.code)).toEqual(["KEY_COLLISION"]);
    expect(rep.right.diagnostics.map((d) => d.code)).toEqual(["DUPLICATE_KEY"]);
  });
});

describe("options", () => {
  it("resolves rules and skips invalid patterns with issues", () => {
    const r = resolveUiOptions({
      ...DEFAULT_OPTIONS,
      ignore: "meta.**, [bad\nx.y",
      arrayRules: [
        { id: "1", pattern: "servers", strategy: "keyed", field: "name" },
        { id: "2", pattern: "ports", strategy: "set", field: "" },
        { id: "3", pattern: "jobs", strategy: "keyed", field: "" },
        { id: "4", pattern: "", strategy: "set", field: "" },
      ],
      envSeparator: "",
    });
    expect(r.options.ignore).toEqual(["meta.**", "x.y"]);
    expect(r.options.arrays?.rules).toEqual([
      { pattern: "servers", strategy: { keyedBy: "name" } },
      { pattern: "ports", strategy: "set" },
    ]);
    expect(r.issues.map((i) => i.source).sort()).toEqual(["3", "ignore"]);
    expect(r.envSeparator).toBeNull();
  });

  it("detects presets and sanitizes stored data", () => {
    expect(activePresetId(DEFAULT_OPTIONS)).toBe("environments");
    expect(activePresetId({ ...DEFAULT_OPTIONS, mode: "strict", policy: "drift" })).toBe("drift");
    expect(sanitizeOptions("nope")).toBe(DEFAULT_OPTIONS);
    expect(sanitizeOptions({ mode: "weird", policy: "drift", arrayRules: [{ pattern: "a", strategy: "x" }] })).toMatchObject({
      mode: "loose",
      policy: "drift",
      arrayRules: [{ pattern: "a", strategy: "ordered", field: "" }],
    });
    expect(splitPatterns(" a ,\n\n b,")).toEqual(["a", "b"]);
  });
});

describe("parseSource and samples", () => {
  it("reports parse errors with a location", () => {
    const out = parseSource('{\n  "a": 1,\n  "b": \n}', "json", "x.json", undefined);
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.line).toBeGreaterThan(1);
    expect(parseSource("   ", "yaml", "", undefined)).toEqual({ status: "empty" });
  });

  it("every sample parses and produces differences", () => {
    for (const s of SAMPLES) {
      const rep = compare({ left: { text: s.left.text, name: s.left.name }, right: { text: s.right.text, name: s.right.name }, parse: { env: { separator: "__" } } });
      expect(rep.identical, s.id).toBe(false);
    }
  });
});
