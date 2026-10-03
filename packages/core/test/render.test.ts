import { describe, expect, it } from 'vitest';
import { fromJS } from '../src/node-utils.js';
import { toGithubAnnotations, toJson, toMarkdown, toTable } from '../src/render/index.js';
import { makeReport, withLines } from './diff-helpers.js';

const left = { name: 'svc', timeout: 30, features: ['a', 'metrics'], db: { password: 'hunter2' }, note: 'a|b', ratio: NaN };
const right = { name: 'svc', timeout: 60, features: ['a'], db: { password: 'hunter3' }, note: 'a|c\nline2', extra: '100%,ok', ratio: NaN };

const report = () => makeReport(withLines(fromJS(left)), withLines(fromJS(right)), {}, 'drift');

describe('json renderer', () => {
  it('parses, reduces nodes and has no loc noise beyond line', () => {
    const text = toJson(report());
    const data = JSON.parse(text) as {
      changes: Array<{ kind: string; pathText: string; left?: Record<string, unknown>; right?: Record<string, unknown> }>;
      findings: Array<{ code: string; pathText: string }>;
      summary: { total: number };
      identical: boolean;
    };
    expect(data.identical).toBe(false);
    expect(text).not.toContain('"loc"');
    expect(text).not.toContain('"offset"');
    expect(text).not.toContain('hunter');
    const timeout = data.changes.find((c) => c.pathText === 'timeout')!;
    expect(timeout.left).toEqual({ kind: 'scalar', type: 'number', value: 30, raw: '30', line: 3 });
    const ratio = data.changes.find((c) => c.pathText === 'ratio')!;
    expect(ratio.left).toMatchObject({ value: 'NaN', raw: 'NaN' });
    expect(data.findings.map((f) => f.code)).toContain('MISSING_KEY');
    expect(toJson(report(), { pretty: false })).not.toContain('\n');
  });

  it('containers serialize with value and kind', () => {
    const r = makeReport(fromJS({}), fromJS({ added: { x: [1, Infinity] } }));
    const data = JSON.parse(toJson(r)) as { changes: Array<{ right: unknown }> };
    expect(data.changes[0]!.right).toEqual({ kind: 'object', value: { x: [1, 'Infinity'] }, raw: '' });
  });
});

describe('markdown renderer', () => {
  it('summary, table with line refs and escaped pipes, findings', () => {
    const md = toMarkdown(report());
    expect(md).toContain('Comparing `a.json` (json) with `b.yaml` (yaml)');
    expect(md).toContain('**Summary:**');
    expect(md).toContain('| Path | Change | Left | Right |');
    expect(md).toContain('| timeout | changed | 30 (L3) | 60 (L3) |');
    expect(md).toContain('| features[1] | removed | "metrics" (L6) |  |');
    expect(md).toContain('"a\\|b"');
    expect(md).toContain('••••••');
    expect(md).not.toContain('hunter');
    expect(md).toContain('### Findings');
    expect(md).toContain('- **error** `MISSING_KEY` features[1] missing (was "metrics")');
    // every table row has exactly 5 unescaped pipes
    for (const line of md.split('\n').filter((l) => l.startsWith('| '))) {
      expect(line.replace(/\\\|/g, '').split('|').length - 1).toBe(5);
    }
    expect(md).not.toContain('| name |'); // equal rows hidden by default
    expect(toMarkdown(report(), { show: 'all' })).toContain('| name | equal |');
  });

  it('truncates long values', () => {
    const r = makeReport(fromJS({ s: 'x'.repeat(500) }), fromJS({ s: 'y' }));
    const row = toMarkdown(r).split('\n').find((l) => l.startsWith('| s '))!;
    expect(row.length).toBeLessThan(140);
    expect(row).toContain('…');
  });

  it('identical reports say so with counts', () => {
    const r = makeReport(fromJS({ a: 1, b: '2' }), fromJS({ b: 2, a: 1 }));
    const md = toMarkdown(r);
    expect(md).toContain('Identical: no differences in 2 compared values (1 equal, 1 equal after coercion, 0 ignored)');
    expect(md).not.toContain('| Path |');
  });
});

describe('table renderer', () => {
  it('aligned plain lines with symbols and a footer', () => {
    const t = toTable(report());
    const lines = t.split('\n');
    expect(lines.some((l) => /^~ timeout +30 → 60$/.test(l))).toBe(true);
    expect(t).toMatch(/^- features\[1\] +"metrics"$/m);
    expect(t).toMatch(/^\+ extra +"100%,ok"$/m);
    expect(t).not.toContain('\x1b[');
    expect(t).toMatch(/^3 changed, 1 removed, 1 added, 3 equal \(8 compared\)$/m);
    expect(t).toMatch(/\d errors?, \d warnings?/);
    expect(toTable(report(), { show: 'all' })).toContain('= name');
  });
  it('colors and width', () => {
    const t = toTable(report(), { color: true, width: 12 });
    expect(t).toContain('\x1b[33m~ timeout  …\x1b[0m');
  });
  it('identical', () => {
    expect(toTable(makeReport(fromJS([1]), fromJS([1])))).toBe('Identical: no differences in 1 compared value (1 equal, 0 equal after coercion, 0 ignored)');
  });
});

describe('github annotations', () => {
  it('one line per finding with file/line, escaped', () => {
    const out = toGithubAnnotations(report()).split('\n');
    expect(out).toHaveLength(report().findings.length);
    expect(out).toContain('::warning file=b.yaml,line=3,col=3,title=VALUE_CHANGE::timeout changed: 30 → 60');
    expect(out).toContain('::error file=a.json,line=6,col=3,title=MISSING_KEY::features[1] missing (was "metrics")');
    expect(out.find((l) => l.includes('title=EXTRA_KEY'))).toBe('::warning file=b.yaml,line=9,col=3,title=EXTRA_KEY::extra added: "100%25,ok"');
    expect(out.find((l) => l.includes('note'))).toContain('"a|b" → "a|c\\nline2"');
  });
  it('escapes newlines in data and omits unknown file/line', () => {
    const r = makeReport(fromJS({ k: 'a' }), fromJS({ k: 'b' }), {}, 'drift', {});
    expect(toGithubAnnotations(r)).toBe('::warning title=VALUE_CHANGE::k changed: "a" → "b"');
    const nl = makeReport(fromJS({ k: 'a' }), withLines(fromJS({ k: 'x' })), {}, 'drift');
    nl.findings[0]!.message = 'multi\nline\r100%';
    expect(toGithubAnnotations(nl)).toBe('::warning file=b.yaml,line=2,col=3,title=VALUE_CHANGE::multi%0Aline%0D100%25');
  });
});
