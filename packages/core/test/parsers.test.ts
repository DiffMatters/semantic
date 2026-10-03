/** Parser tests against the fixtures in test/fixtures (see fixtures/README.md for the expectations). */
import { describe, expect, it } from 'vitest';
import { ParseError } from '../src/errors.js';
import { detectFormat } from '../src/format.js';
import { parse, parseEnv, parseJson, parseYaml } from '../src/parsers/index.js';
import { LineIndex } from '../src/text/lineIndex.js';
import type { DiagnosticCode, Document, Node, ParseOptions, ScalarNode } from '../src/types.js';
import { at, fixture, fixtureFiles, toJS } from './fixture-helpers.js';

const load = (rel: string, opts: ParseOptions = {}): Document => parse(fixture(rel), { name: rel, ...opts });
const codes = (doc: Document): DiagnosticCode[] => doc.diagnostics.map((d) => d.code);
const scalar = (node: Node): ScalarNode => {
  if (node.kind !== 'scalar') throw new Error(`expected scalar, got ${node.kind}`);
  return node;
};
const parseError = (fn: () => unknown): ParseError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  throw new Error('expected a ParseError');
};

describe('LineIndex', () => {
  it('maps offsets to 1-based positions with LF, CRLF and CR', () => {
    const idx = new LineIndex('ab\r\ncd\nef\rg');
    expect(idx.locAt(0, 2)).toEqual({ line: 1, col: 1, endLine: 1, endCol: 3, offset: 0, length: 2 });
    expect(idx.locAt(4, 1)).toMatchObject({ line: 2, col: 1, endLine: 2, endCol: 2 });
    expect(idx.locAt(7, 1)).toMatchObject({ line: 3, col: 1 });
    expect(idx.locAt(10, 1)).toMatchObject({ line: 4, col: 1 });
    expect(idx.locAt(1, 5)).toMatchObject({ line: 1, col: 2, endLine: 2, endCol: 3 });
  });
});

describe('detectFormat', () => {
  it('uses the file name first', () => {
    expect(detectFormat('{}', 'a.yaml')).toBe('yaml');
    expect(detectFormat('a: 1', 'x.json')).toBe('json');
    expect(detectFormat('', 'tsconfig.jsonc')).toBe('json');
    expect(detectFormat('x', '.env')).toBe('env');
    expect(detectFormat('x', '.env.production')).toBe('env');
    expect(detectFormat('x', 'dir/app.prod.env')).toBe('env');
    expect(detectFormat('x', 'env.txt')).toBe('env');
    expect(detectFormat('x', 'b.yml')).toBe('yaml');
  });
  it('sniffs content otherwise', () => {
    expect(detectFormat('\uFEFF  {"a": 1}')).toBe('json');
    expect(detectFormat('[1]')).toBe('json');
    expect(detectFormat('# c\nexport A=1\n\nb.c-d = 2\n')).toBe('env');
    expect(detectFormat('a: 1\nb=2')).toBe('yaml');
    expect(detectFormat('')).toBe('yaml');
    expect(detectFormat(fixture('malformed/mixed-formats.txt'), 'mixed-formats.txt')).toBe('yaml');
  });
});

describe('every valid fixture parses', () => {
  const documentedErrors = new Set(['edge/empty.json']);
  const files = [
    ...fixtureFiles('edge').map((f) => `edge/${f}`),
    ...fixtureFiles('realistic').map((f) => `realistic/${f}`),
    'config.json',
    'config.yaml',
    'config_modified.json',
    'config_reordered.yaml',
    'env.txt',
  ].filter((f) => !documentedErrors.has(f));
  it.each(files)('%s', (rel) => {
    const doc = load(rel);
    expect(doc.root).toBeDefined();
    expect(doc.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });
});

describe('JSON', () => {
  it('rejects an empty document', () => {
    const err = parseError(() => load('edge/empty.json'));
    expect(err.message).toBe('empty document');
    expect(err.format).toBe('json');
    expect(parseError(() => parseJson('  \n ')).message).toBe('empty document');
  });

  it('keeps exact raw text and quoted flags', () => {
    const doc = load('edge/types.json');
    expect(scalar(at(doc.root, 'int_big')).raw).toBe('9007199254740993');
    expect(scalar(at(doc.root, 'int_big')).value).toBe(9007199254740992);
    expect(scalar(at(doc.root, 'neg_zero')).raw).toBe('-0');
    expect(Object.is(scalar(at(doc.root, 'neg_zero')).value, -0)).toBe(true);
    expect(scalar(at(doc.root, 'float_exp_dot')).raw).toBe('1000.0');
    const v = scalar(at(doc.root, 'version_like'));
    expect(v).toMatchObject({ type: 'string', value: '1.10', raw: '"1.10"', quoted: true });
    expect(scalar(at(doc.root, 'int_plain')).quoted).toBe(false);
    expect(doc.diagnostics).toEqual([]);
  });

  it('accepts comments and trailing commas with one NON_STANDARD_JSON warning', () => {
    for (const rel of ['edge/jsonc.json', 'edge/trailing-comma.json']) {
      const doc = load(rel);
      expect(codes(doc)).toEqual(['NON_STANDARD_JSON']);
    }
    const doc = load('edge/jsonc.json');
    expect(toJS(at(doc.root, 'include'))).toEqual(['**/*.ts', '**/*.tsx']);
    expect(toJS(at(doc.root, 'compilerOptions', 'paths'))).toEqual({ '@/*': ['./src/*', './*'] });
    expect(toJS(load('edge/trailing-comma.json').root)).toEqual({ name: 'trailing comma', items: [1, 2, 3] });
  });

  it('duplicate keys: last wins with DUPLICATE_KEY warnings', () => {
    const doc = load('edge/duplicate-keys.json');
    expect(toJS(doc.root)).toEqual({ dup: 2, nested: { x: 2 } });
    expect(codes(doc)).toEqual(['DUPLICATE_KEY', 'DUPLICATE_KEY']);
    const dup = doc.diagnostics.find((d) => d.message.includes('"dup"'));
    expect(dup?.loc).toMatchObject({ line: 1, col: 12 });
    expect(doc.root.kind === 'object' && doc.root.entries.map((e) => e.key)).toEqual(['dup', 'nested']);
  });

  it('strips a BOM without shifting positions', () => {
    const doc = load('edge/bom.json');
    expect(doc.source.startsWith('{')).toBe(true);
    expect(doc.root.loc).toMatchObject({ line: 1, col: 1, offset: 0 });
    expect(doc.root.kind === 'object' && doc.root.entries[0]?.keyLoc).toMatchObject({ line: 1, col: 2 });
    expect(toJS(doc.root)).toMatchObject({ bom: true });
  });

  it('accepts any root value', () => {
    expect(load('edge/array-root.json').root.kind).toBe('array');
    expect(toJS(parseJson('"x"').root)).toBe('x');
    expect(toJS(parseJson(' 42 ').root)).toBe(42);
  });

  it('copes with deep nesting', () => {
    let node = load('edge/deep-nesting.json').root;
    let depth = 0;
    while (node.kind === 'object' && node.entries[0]) {
      node = node.entries[0].value;
      depth++;
    }
    expect(depth).toBeGreaterThanOrEqual(60);
  });

  it('stores __proto__ as plain data', () => {
    const doc = load('edge/collisions.a.json');
    expect(doc.root.kind === 'object' && doc.root.entries.some((e) => e.key === '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('YAML', () => {
  const types = load('edge/types.yaml');

  it('follows YAML 1.2 core typing and keeps raw text', () => {
    const r = types.root;
    expect(scalar(at(r, 'version_like'))).toMatchObject({ type: 'number', value: 1.1, raw: '1.10', quoted: false });
    expect(scalar(at(r, 'date_plain'))).toMatchObject({ type: 'string', value: '2024-01-15' });
    expect(scalar(at(r, 'bool_yes'))).toMatchObject({ type: 'string', value: 'yes' });
    expect(scalar(at(r, 'bool_false_caps'))).toMatchObject({ type: 'boolean', value: false });
    expect(scalar(at(r, 'int_big'))).toMatchObject({ type: 'number', raw: '9007199254740993' });
    expect(scalar(at(r, 'neg_zero')).raw).toBe('-0');
    expect(scalar(at(r, 'int_octal_legacy'))).toMatchObject({ type: 'number', value: 755, raw: '0755' });
    expect(scalar(at(r, 'int_underscore'))).toMatchObject({ type: 'string', value: '1_000_000' });
    expect(scalar(at(r, 'zip_leading_zero')).raw).toBe('02134');
    expect(scalar(at(r, 'time_like')).value).toBe('12:30:45');
    expect(scalar(at(r, 'float_inf')).value).toBe(Infinity);
    expect(scalar(at(r, 'float_neg_inf')).value).toBe(-Infinity);
    expect(Number.isNaN(scalar(at(r, 'float_nan')).value)).toBe(true);
    expect(scalar(at(r, 'null_tilde'))).toMatchObject({ type: 'null', raw: '~' });
    expect(scalar(at(r, 'null_empty')).type).toBe('null');
    expect(scalar(at(r, 'null_string'))).toMatchObject({ type: 'string', value: 'null', quoted: true });
    expect(scalar(at(r, 'str_single'))).toMatchObject({ value: "it's single", raw: "'it''s single'", quoted: true });
    expect(scalar(at(r, 'str_plain')).quoted).toBe(false);
  });

  it('block scalars are quoted and raw covers the whole block', () => {
    const lit = scalar(at(types.root, 'block_literal'));
    expect(lit).toMatchObject({ value: 'line one\nline two\n', quoted: true, raw: '|\n  line one\n  line two\n' });
    expect(scalar(at(types.root, 'block_folded')).value).toBe('folded into one line\n');
    expect(scalar(at(types.root, 'block_literal_strip')).value).toBe('no trailing newline');
  });

  it('non-string keys use their source text', () => {
    expect(toJS(at(types.root, '123'))).toBe('numeric key');
    expect(toJS(at(types.root, 'true'))).toBe('boolean key');
    expect(toJS(at(types.root, 'quoted.key'))).toBe('dotted key quoted');
    expect(toJS(at(types.root, 'a.b'))).toBe('dotted key plain');
  });

  it('resolves aliases and applies merge keys', () => {
    expect(toJS(at(types.root, 'nested', 'alias'))).toEqual({ one: 1, two: 2 });
    expect(toJS(at(types.root, 'nested', 'merged'))).toEqual({ one: 1, two: 22, three: 3 });
    const alias = at(types.root, 'nested', 'alias');
    expect(alias.loc).toMatchObject({ line: 67, col: 10 });
    expect(types.diagnostics).toEqual([]);
  });

  it('keeps << literal with a MERGE_KEY warning when merge is off', () => {
    const doc = load('edge/types.yaml', { yaml: { merge: false } });
    const merged = at(doc.root, 'nested', 'merged');
    expect(toJS(merged)).toEqual({ '<<': { one: 1, two: 2 }, two: 22, three: 3 });
    expect(codes(doc)).toEqual(['MERGE_KEY']);
  });

  it('merge semantics: explicit keys win, earlier sources win', () => {
    const doc = parseYaml('a: &a {x: 1, y: 1}\nb: &b {y: 2, z: 2}\nc:\n  z: 3\n  <<: [*a, *b]\n');
    expect(toJS(at(doc.root, 'c'))).toEqual({ z: 3, x: 1, y: 1 });
  });

  it('flow collections and empty containers', () => {
    expect(toJS(at(types.root, 'flow_map'))).toEqual({ a: 1, b: [1, 2, { c: 3 }] });
    expect(toJS(at(types.root, 'flow_seq'))).toEqual([1, 'two', 3, true, null, null, ['nested']]);
    expect(toJS(at(types.root, 'empty_map'))).toEqual({});
    expect(toJS(at(types.root, 'empty_seq'))).toEqual([]);
    expect(toJS(at(types.root, 'multiline_flow'))).toEqual(['one', 'two']);
  });

  it('positions are 1-based line/col', () => {
    const entry = types.root.kind === 'object' ? types.root.entries[0] : undefined;
    expect(entry?.key).toBe('int_plain');
    expect(entry?.keyLoc).toMatchObject({ line: 7, col: 1, endLine: 7, endCol: 10 });
    expect(entry?.value.loc).toMatchObject({ line: 7, col: 12, length: 2 });
  });

  it('unknown tags warn and never throw', () => {
    const doc = load('edge/parser-dependent.yaml');
    const unknown = doc.diagnostics.filter((d) => d.code === 'UNKNOWN_TAG');
    expect(unknown).toHaveLength(4);
    expect(unknown.every((d) => d.loc !== null)).toBe(true);
    const r = doc.root;
    expect(scalar(at(r, 'custom_tag'))).toMatchObject({ type: 'string', value: 'some-value' });
    expect(scalar(at(r, 'binary_tag'))).toMatchObject({ type: 'string', value: 'R0lGODlhDAAMAIQAAP//9/X17unp5WZmZgAAAOfn515eXvPz7Y6OjuDg4J+fn5\n' });
    expect(toJS(at(r, 'set_tag'))).toEqual({ a: null, b: null });
    expect(toJS(at(r, 'omap_tag'))).toEqual([{ x: 1 }, { y: 2 }]);
    expect(toJS(at(r, '[complex, key]'))).toMatch(/^sequence as key/);
  });

  it('multi-document streams', () => {
    const first = load('edge/multi-doc.yaml');
    expect(first.documentCount).toBe(3);
    expect(codes(first)).toEqual(['MULTI_DOCUMENT']);
    expect(first.diagnostics[0]?.message).toContain('3 documents');
    expect(toJS(at(first.root, 'kind'))).toBe('ConfigMap');

    const second = load('edge/multi-doc.yaml', { yaml: { document: 1 } });
    expect(toJS(at(second.root, 'kind'))).toBe('Secret');

    const third = load('edge/multi-doc.yaml', { yaml: { document: 2 } });
    expect(third.root).toMatchObject({ kind: 'scalar', type: 'null', loc: null });
    expect(codes(third)).toEqual(['MULTI_DOCUMENT', 'EMPTY_DOCUMENT']);

    expect(parseError(() => load('edge/multi-doc.yaml', { yaml: { document: 3 } })).message).toContain('out of range');
    expect(parseError(() => load('edge/multi-doc.yaml', { yaml: { document: 'error' } })).message).toContain('found 3');
    expect(codes(load('config.yaml', { yaml: { document: 'error' } }))).toEqual([]);
  });

  it('empty and comment-only documents become a null root', () => {
    for (const text of [fixture('edge/comments-only.yaml'), '', '   \n']) {
      const doc = parseYaml(text);
      expect(doc.root).toMatchObject({ kind: 'scalar', type: 'null', value: null, loc: null });
      expect(codes(doc)).toEqual(['EMPTY_DOCUMENT']);
    }
  });

  it('duplicate keys warn, last wins', () => {
    const doc = load('edge/duplicate-keys.yaml');
    expect(toJS(doc.root)).toEqual({ key: 'duplicate', nested: { x: 2 } });
    expect(codes(doc)).toEqual(['DUPLICATE_KEY', 'DUPLICATE_KEY']);
    expect(doc.diagnostics.map((d) => d.loc?.line)).toEqual([2, 5]);
  });

  it('scalar root', () => {
    expect(load('edge/scalar-root.yaml').root).toMatchObject({ kind: 'scalar', type: 'string' });
  });

  it('CRLF values carry no \\r', () => {
    const doc = load('edge/crlf.yaml');
    expect(toJS(doc.root)).toEqual({ key: 'value', list: ['a', 'b'], nested: { deep: true } });
    expect(at(doc.root, 'nested', 'deep').loc).toMatchObject({ line: 6, col: 9 });
  });

  it('recursive aliases fail cleanly', () => {
    expect(parseError(() => parseYaml('a: &x\n  b: *x\n')).message).toContain('recursive alias');
  });

  it('realistic staging config applies anchors and merge', () => {
    const doc = load('realistic/app.staging.yaml');
    expect(doc.root.kind).toBe('object');
    expect(codes(doc).filter((c) => c !== 'DUPLICATE_KEY')).toEqual([]);
  });
});

describe('env', () => {
  const tricky = load('edge/env-tricky.env');
  const v = (...path: string[]): unknown => toJS(at(tricky.root, ...path));

  it('quoting and comment rules', () => {
    expect(v('UNQUOTED')).toBe('plain value with spaces');
    expect(v('UNQUOTED_TRAILING_WS')).toBe('trailing spaces');
    expect(v('DOUBLE')).toBe('double quoted');
    expect(v('SINGLE')).toBe('single quoted');
    expect(v('BACKTICK')).toBe('backtick quoted');
    expect(v('EMPTY')).toBe('');
    expect(v('EMPTY_DOUBLE')).toBe('');
    expect(v('EMPTY_SINGLE')).toBe('');
    expect(v('QUOTE_INSIDE_SINGLE')).toBe('He said "hi"');
    expect(v('ESCAPED_DOUBLE')).toBe('say "hello"');
    expect(v('MISMATCHED_QUOTES')).toBe(`'abc"`);
    expect(v('ONLY_OPEN_QUOTE_IN_VALUE')).toBe("5'oclock");
    expect(v('HASH_IN_DOUBLE')).toBe('value # not a comment');
    expect(v('HASH_IN_SINGLE')).toBe('value # not a comment');
    expect(v('HASH_UNQUOTED_NO_SPACE')).toBe('value#not-a-comment');
    expect(v('HASH_UNQUOTED_SPACE')).toBe('value');
    expect(v('INLINE_COMMENT_AFTER_QUOTE')).toBe('quoted');
  });

  it('quoted flag, raw and loc', () => {
    const d = scalar(at(tricky.root, 'DOUBLE'));
    expect(d).toMatchObject({ type: 'string', quoted: true, raw: '"double quoted"' });
    expect(d.loc).toMatchObject({ line: 8, col: 8 });
    expect(scalar(at(tricky.root, 'UNQUOTED')).quoted).toBe(false);
    const host = scalar(at(tricky.root, 'APP', 'DB', 'HOST'));
    expect(host.loc).toMatchObject({ line: 54, col: 15, endCol: 32 });
    const app = tricky.root.kind === 'object' ? tricky.root.entries.find((e) => e.key === 'APP') : undefined;
    expect(app?.value).toMatchObject({ kind: 'object', loc: null, raw: '' });
    expect(app?.keyLoc).toMatchObject({ line: 53, col: 1, length: 3 });
  });

  it('escapes and multi-line values', () => {
    expect(v('NEWLINE_ESCAPE')).toBe('line1\nline2');
    expect(v('NEWLINE_ESCAPE_SINGLE')).toBe('line1\\nline2');
    expect(v('TAB_ESCAPE')).toBe('a\tb');
    expect(v('MULTILINE_DOUBLE')).toBe('first line\nsecond line\nthird line');
    expect(v('MULTILINE_SINGLE')).toBe('first\nsecond');
    const pem = v('PRIVATE_KEY');
    expect(pem).toMatch(/^-----BEGIN RSA PRIVATE KEY-----\nMIIBOg/);
    expect(pem).toMatch(/\n-----END RSA PRIVATE KEY-----$/);
    expect(scalar(at(tricky.root, 'PRIVATE_KEY')).loc).toMatchObject({ line: 34, endLine: 37 });
    expect(v('DOLLAR_ESCAPED')).toBe('$HOME');
    expect(v('DOLLAR_LITERAL')).toBe('$HOME');
    expect(v('WINDOWS_PATH')).toBe('C:\\Users\\me\\app');
  });

  it('keys', () => {
    expect(v('EXPORTED')).toBe('1');
    expect(v('INDENTED')).toBe('2');
    expect(v('lowercase_key')).toBe('3');
    expect(v('MixedCase_Key')).toBe('4');
    expect(v('KEY.WITH.DOTS')).toBe('5');
    expect(v('KEY-WITH-DASHES')).toBe('6');
    expect(v('SPACES_AROUND')).toBe('9');
    expect(v('SPACES_BEFORE_EQ')).toBe('10');
    expect(v('SPACES_AFTER_EQ')).toBe('11');
  });

  it('special characters stay literal', () => {
    expect(v('HAS_EQUALS')).toBe('a=b=c');
    expect(v('URL')).toBe('postgres://user:p%40ss@host:5432/db?sslmode=require&pool=5');
    expect(v('JSON_VALUE')).toBe('{"nested":{"key":[1,2,3]},"flag":true}');
    expect(v('YAML_LOOKING')).toBe('key: value');
    expect(v('INTERPOLATION')).toBe('${APP__NAME}/suffix');
    expect(v('INTERPOLATION_DEFAULT')).toBe('${MISSING:-fallback}');
    expect(v('NUMBER')).toBe('42');
    expect(v('BOOL_TRUE')).toBe('true');
    expect(v('UNICODE')).toBe('Grüße 世界 🚀');
  });

  it('nesting on __', () => {
    expect(v('APP')).toEqual({
      NAME: 'nested-one-level',
      DB: { HOST: 'nested-two-levels', PORT: '5432' },
      TAGS: { '0': 'first', '1': 'second', '2': 'third' },
    });
    expect(v('LEADING_SEP')).toBe('leading separator yields empty segment');
    expect(v('TRAILING')).toBe('trailing separator yields empty segment');
    expect(v('TRIPLE', '_UNDERSCORE')).toMatch(/^ambiguous/);
    expect(v('SINGLE_UNDERSCORE_IS_NOT_NESTING')).toBe('true');
  });

  it('diagnostics', () => {
    expect(v('DUPLICATE')).toBe('second');
    const dup = tricky.diagnostics.find((d) => d.code === 'DUPLICATE_KEY');
    expect(dup?.loc?.line).toBe(94);
    const empty = tricky.diagnostics.filter((d) => d.code === 'EMPTY_SEGMENT');
    expect(empty.map((d) => d.loc?.line)).toEqual([59, 60]);
    const malformed = tricky.diagnostics.filter((d) => d.code === 'MALFORMED_LINE');
    expect(malformed.map((d) => d.loc?.line)).toEqual([17]);
    expect(codes(tricky).sort()).toEqual(['DUPLICATE_KEY', 'EMPTY_SEGMENT', 'EMPTY_SEGMENT', 'MALFORMED_LINE']);
  });

  it('separator null disables nesting; custom separators work', () => {
    const flat = load('edge/env-tricky.env', { env: { separator: null } });
    expect(toJS(at(flat.root, 'APP__DB__HOST'))).toBe('nested-two-levels');
    const dot = parseEnv('A.B=1\nA.C=2\n', undefined, { separator: '.' });
    expect(toJS(dot.root)).toEqual({ A: { B: '1', C: '2' } });
  });

  it('collisions: last write wins with KEY_COLLISION', () => {
    const doc = load('edge/collisions.b.env');
    expect(toJS(at(doc.root, 'A'))).toBe('scalar at the parent path');
    expect(codes(doc)).toContain('KEY_COLLISION');
    expect(toJS(at(doc.root, 'A.B'))).toBe('literal dotted key a.b');
    const back = parseEnv('A=1\nA__B=2\n');
    expect(toJS(back.root)).toEqual({ A: { B: '2' } });
    expect(codes(back)).toEqual(['KEY_COLLISION']);
  });

  it('__proto__ is plain data', () => {
    const doc = parseEnv('__proto__=x\nconstructor=y\n', undefined, { separator: null });
    expect(doc.root.kind === 'object' && doc.root.entries.map((e) => [e.key, e.sourceKey])).toEqual([
      ['__proto__', '__proto__'],
      ['constructor', 'constructor'],
    ]);
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('realistic prod env nests', () => {
    const doc = load('realistic/app.prod.env');
    const r = doc.root;
    expect(toJS(at(r, 'SERVER', 'CORS', 'MAX_AGE_S'))).toBe('86400');
    expect(toJS(at(r, 'SERVER', 'HOST'))).toBe('0.0.0.0');
    expect(toJS(at(r, 'SERVER', 'CORS', 'ALLOWED_METHODS'))).toBe('GET,POST,PUT,DELETE');
    expect(toJS(at(r, 'DATABASE', 'PASSWORD'))).toBe('Pr0d-P@ssw0rd!');
    expect(toJS(at(r, 'DATABASE', 'POOL'))).toEqual({ MIN: '2', MAX: '50', IDLE_TIMEOUT_S: '300' });
    expect(toJS(at(r, 'SERVICES', '1', 'NAME'))).toBe('payments');
    expect(toJS(at(r, 'MAINTENANCE_WINDOW'))).toBe('');
    expect(toJS(at(r, 'NOTES'))).toBe('line one\nline two\n');
    expect(toJS(at(r, 'JWT_SECRET'))).toMatch(/^eyJ/);
    expect(doc.diagnostics).toEqual([]);
  });

  it('CRLF values carry no \\r', () => {
    const doc = load('edge/crlf.env');
    expect(toJS(doc.root)).toEqual({ KEY: 'value', SECOND: 'two', QUOTED: 'with crlf', LAST: 'end' });
    expect(at(doc.root, 'LAST').loc).toMatchObject({ line: 5, col: 6 });
  });

  it('BOM is stripped from the first key', () => {
    const doc = load('edge/bom.env');
    expect(doc.source.startsWith('KEY')).toBe(true);
    expect(toJS(doc.root)).toEqual({ KEY: 'bom env' });
    expect(doc.root.kind === 'object' && doc.root.entries[0]?.keyLoc).toMatchObject({ line: 1, col: 1 });
  });

  it('empty file is an empty object', () => {
    expect(parseEnv('').root).toMatchObject({ kind: 'object', entries: [] });
    expect(parseEnv('# only a comment\n\n').diagnostics).toEqual([]);
  });

  it('bad lines warn and parsing continues', () => {
    const doc = load('malformed/bad-lines.env');
    expect(toJS(doc.root)).toEqual({ VALID: '1', KEY: 'value with trailing "quote' });
    const bad = doc.diagnostics.filter((d) => d.code === 'MALFORMED_LINE');
    expect(bad.map((d) => d.loc?.line)).toEqual([1, 3, 4, 5]);
  });

  it('junk after a closing quote warns and keeps the quoted value', () => {
    const doc = load('malformed/junk-after-quote.env');
    expect(toJS(doc.root)).toEqual({ GOOD: '1', BAD: 'closed', ALSO_BAD: 'single' });
    const bad = doc.diagnostics.filter((d) => d.code === 'MALFORMED_LINE');
    expect(bad.map((d) => [d.loc?.line, d.loc?.col])).toEqual([
      [2, 14],
      [3, 19],
    ]);
  });
});

describe('malformed inputs fail cleanly', () => {
  const parsesWithWarnings = new Set(['bad-lines.env', 'junk-after-quote.env']);
  const failing = fixtureFiles('malformed').filter((f) => !parsesWithWarnings.has(f));
  const noLoc = new Set(['binary-garbage.bin']);

  it.each(failing)('%s throws ParseError', (f) => {
    const err = parseError(() => load(`malformed/${f}`));
    expect(err).toBeInstanceOf(ParseError);
    if (noLoc.has(f)) expect(err.loc).toBeNull();
    else {
      expect(err.loc).not.toBeNull();
      expect(err.loc?.line).toBeGreaterThanOrEqual(1);
    }
    expect(String(err)).toMatch(new RegExp(`^malformed/${f.replace('.', '\\.')}:`));
  });

  it('error positions', () => {
    expect(parseError(() => load('malformed/unterminated-quote.env')).loc).toMatchObject({ line: 2, col: 5 });
    expect(parseError(() => load('malformed/unterminated-single-quote.env')).loc).toMatchObject({ line: 2, col: 8 });
    expect(parseError(() => load('malformed/tab-indent.yaml')).loc).toMatchObject({ line: 2, col: 1 });
    expect(parseError(() => load('malformed/unknown-anchor.yaml'))).toMatchObject({ message: 'unknown alias *missing_anchor', loc: { line: 4, col: 7 } });
    expect(parseError(() => load('malformed/trailing-garbage.json')).loc).toMatchObject({ line: 1, col: 10 });
    expect(parseError(() => load('malformed/two-roots.json')).loc).toMatchObject({ line: 1, col: 9 });
    expect(parseError(() => load('malformed/html-error-page.json')).loc).toMatchObject({ line: 1, col: 1 });
  });

  it('binary input is rejected before parsing', () => {
    expect(parseError(() => load('malformed/binary-garbage.bin')).message).toBe('binary or non-UTF-8 input');
    expect(parseError(() => parse('a\u0000b', { format: 'yaml' })).message).toBe('binary or non-UTF-8 input');
    expect(parse('a: \uFFFD', { format: 'yaml' }).root.kind).toBe('object');
  });
});
