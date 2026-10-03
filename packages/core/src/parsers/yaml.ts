/**
 * YAML parser built on the `yaml` package (YAML 1.2 core schema).
 * Converts the parsed node tree into our IR: resolves aliases into fresh copies,
 * applies `<<` merge keys itself, keeps exact raw slices and reports unknown tags,
 * duplicate keys and multi-document streams as diagnostics.
 */
import { LineCounter, isAlias, isMap, isPair, isScalar, isSeq, parseAllDocuments } from 'yaml';
import type { Alias, Document as YamlDocument, Pair, Scalar, YAMLError, YAMLMap, YAMLSeq } from 'yaml';
import { ParseError } from '../errors.js';
import { LineIndex, sortByPosition } from '../text/lineIndex.js';
import type { Diagnostic, Document, Loc, Node, ObjectEntry, ObjectNode, ParseOptions, ScalarNode } from '../types.js';

type YamlNode = Alias | Scalar | YAMLMap | YAMLSeq;

/** Tags that map onto our IR without loss. Anything else is reported as UNKNOWN_TAG. */
const KNOWN_TAGS = new Set([
  '!',
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
]);

/** Upper bound on IR nodes created, so alias bombs fail instead of exhausting memory. */
const MAX_NODES = 1_000_000;

function cleanMessage(err: YAMLError): string {
  const firstLine = err.message.split('\n')[0] ?? err.message;
  return firstLine.replace(/ at line \d+, column \d+:?$/, '');
}

export function parseYaml(input: string, name?: string, opts: ParseOptions['yaml'] = {}): Document {
  const source = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const lines = new LineIndex(source);
  const merge = opts.merge ?? true;
  const diagnostics: Diagnostic[] = [];
  const warn = (code: Diagnostic['code'], message: string, loc: Loc | null): void => {
    diagnostics.push({ severity: 'warning', code, message, loc });
  };
  const fail = (message: string, loc: Loc | null): never => {
    throw new ParseError(message, 'yaml', loc, name);
  };
  const rangeLoc = (range: readonly [number, number, number] | null | undefined): Loc | null =>
    range ? lines.locAt(range[0], range[1] - range[0]) : null;
  const rangeRaw = (range: readonly [number, number, number] | null | undefined): string =>
    range ? source.slice(range[0], range[1]) : '';

  const docs = parseAllDocuments(source, {
    lineCounter: new LineCounter(),
    version: '1.2',
    schema: 'core',
    merge,
    uniqueKeys: false,
  });

  for (const doc of docs) {
    const err = doc.errors[0];
    if (err) fail(cleanMessage(err), lines.locAt(err.pos[0], err.pos[1] - err.pos[0]));
  }

  const count = docs.length;
  const base = { format: 'yaml' as const, ...(name !== undefined ? { name } : {}), source, diagnostics, documentCount: count };
  const emptyRoot = (): Document => {
    warn('EMPTY_DOCUMENT', 'the document has no content; treating it as null', null);
    return { ...base, root: { kind: 'scalar', type: 'null', value: null, quoted: false, loc: null, raw: '' } };
  };

  if (count === 0) return emptyRoot();

  const selected = opts.document ?? 0;
  if (selected === 'error' && count > 1) fail(`expected a single YAML document, found ${count}`, null);
  const index = selected === 'error' ? 0 : selected;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    fail(`document index ${index} out of range: the stream has ${count} document${count === 1 ? '' : 's'}`, null);
  }
  if (count > 1) warn('MULTI_DOCUMENT', `the stream has ${count} documents; using document ${index}`, null);

  const doc = docs[index] as YamlDocument.Parsed;
  for (const w of doc.warnings) {
    if (w.code === 'TAG_RESOLVE_FAILED') continue; // reported per node as UNKNOWN_TAG
    warn('YAML_WARNING', cleanMessage(w), lines.locAt(w.pos[0], w.pos[1] - w.pos[0]));
  }

  const contents = doc.contents;
  // A document with only comments (or `---` followed by nothing) has null or an empty null scalar.
  if (contents === null || (isScalar(contents) && contents.value === null && rangeRaw(contents.range) === '')) {
    return emptyRoot();
  }

  let created = 0;
  const activeAliases = new Set<YamlNode>();

  const nullNode = (): ScalarNode => ({ kind: 'scalar', type: 'null', value: null, quoted: false, loc: null, raw: '' });

  const checkTag = (n: Scalar | YAMLMap | YAMLSeq): boolean => {
    if (n.tag === undefined || KNOWN_TAGS.has(n.tag)) return false;
    warn('UNKNOWN_TAG', `unknown tag ${n.tag}; kept as plain ${isScalar(n) ? 'string' : isMap(n) ? 'mapping' : 'sequence'}`, rangeLoc(n.range));
    return true;
  };

  const keyText = (key: unknown): string => {
    if (key === null || key === undefined) return '';
    if (isScalar(key) && typeof key.value === 'string' && (key.tag === undefined || KNOWN_TAGS.has(key.tag))) return key.value;
    if (isScalar(key) || isMap(key) || isSeq(key) || isAlias(key)) {
      const raw = rangeRaw(key.range).trim();
      if (raw !== '') return raw;
      if (isScalar(key)) return String(key.value);
    }
    return String(key);
  };

  const isMergeKey = (key: unknown): boolean => isScalar(key) && key.type === 'PLAIN' && key.source === '<<';

  const resolveAlias = (a: Alias): YamlNode => {
    const target = a.resolve(doc);
    if (!target) return fail(`unknown alias *${a.source}`, rangeLoc(a.range));
    return target;
  };

  const convertScalar = (s: Scalar, loc: Loc | null, raw: string): ScalarNode => {
    const quoted = s.type === 'QUOTE_DOUBLE' || s.type === 'QUOTE_SINGLE' || s.type === 'BLOCK_LITERAL' || s.type === 'BLOCK_FOLDED';
    const text = typeof s.source === 'string' ? s.source : raw;
    if (checkTag(s)) return { kind: 'scalar', type: 'string', value: text, quoted, loc, raw };
    const v: unknown = s.value;
    if (v === null || v === undefined) return { kind: 'scalar', type: 'null', value: null, quoted, loc, raw };
    if (typeof v === 'string') return { kind: 'scalar', type: 'string', value: v, quoted, loc, raw };
    if (typeof v === 'number') return { kind: 'scalar', type: 'number', value: v, quoted, loc, raw };
    if (typeof v === 'bigint') return { kind: 'scalar', type: 'number', value: Number(v), quoted, loc, raw };
    if (typeof v === 'boolean') return { kind: 'scalar', type: 'boolean', value: v, quoted, loc, raw };
    warn('UNKNOWN_TAG', `value of type ${typeof v} kept as its source text`, loc);
    return { kind: 'scalar', type: 'string', value: text, quoted, loc, raw };
  };

  /** Collapse duplicate keys: last occurrence wins and keeps its own position. Merged entries never override. */
  const finishEntries = (items: Array<{ entry: ObjectEntry; merged: boolean }>): ObjectEntry[] => {
    const lastExplicit = new Map<string, number>();
    items.forEach((it, i) => {
      if (!it.merged) lastExplicit.set(it.entry.key, i);
    });
    const seenMerged = new Set<string>();
    const out: ObjectEntry[] = [];
    items.forEach((it, i) => {
      const { key } = it.entry;
      if (it.merged) {
        if (lastExplicit.has(key) || seenMerged.has(key)) return;
        seenMerged.add(key);
        out.push(it.entry);
        return;
      }
      const winner = lastExplicit.get(key);
      if (winner === i) {
        out.push(it.entry);
        return;
      }
      const w = winner === undefined ? undefined : items[winner];
      warn(
        'DUPLICATE_KEY',
        `duplicate key "${key}" (line ${it.entry.keyLoc?.line ?? '?'}); the later value on line ${w?.entry.keyLoc?.line ?? '?'} wins`,
        w?.entry.keyLoc ?? it.entry.keyLoc,
      );
    });
    return out;
  };

  const mergeSources = (value: unknown, pairLoc: Loc | null): ObjectEntry[] => {
    const sources: unknown[] = isSeq(value) ? value.items : [value];
    const out: ObjectEntry[] = [];
    for (const src of sources) {
      const node = isAlias(src) || isMap(src) ? convert(src) : null;
      if (!node || node.kind !== 'object') return fail('merge key (<<) values must be mappings or aliases of mappings', pairLoc);
      out.push(...node.entries);
    }
    return out;
  };

  const convertMap = (m: YAMLMap, loc: Loc | null, raw: string): ObjectNode => {
    checkTag(m);
    const items: Array<{ entry: ObjectEntry; merged: boolean }> = [];
    for (const pair of m.items as Pair[]) {
      const keyNode = pair.key;
      const keyLoc = isScalar(keyNode) || isMap(keyNode) || isSeq(keyNode) || isAlias(keyNode) ? rangeLoc(keyNode.range) : null;
      if (isMergeKey(keyNode)) {
        if (merge) {
          for (const entry of mergeSources(pair.value, keyLoc)) items.push({ entry, merged: true });
          continue;
        }
        warn('MERGE_KEY', 'merge key (<<) kept as a literal key because merge keys are disabled', keyLoc);
      }
      const key = keyText(keyNode);
      items.push({ entry: { key, sourceKey: key, keyLoc, value: convertValue(pair.value) }, merged: false });
    }
    return { kind: 'object', entries: finishEntries(items), loc, raw };
  };

  const convertPair = (p: Pair): ObjectNode => {
    const keyNode = p.key;
    const keyLoc = isScalar(keyNode) || isMap(keyNode) || isSeq(keyNode) || isAlias(keyNode) ? rangeLoc(keyNode.range) : null;
    const key = keyText(keyNode);
    const value = convertValue(p.value);
    const start = keyLoc?.offset ?? value.loc?.offset;
    const end = value.loc ? value.loc.offset + value.loc.length : keyLoc ? keyLoc.offset + keyLoc.length : undefined;
    const loc = start !== undefined && end !== undefined ? lines.locAt(start, end - start) : null;
    return { kind: 'object', entries: [{ key, sourceKey: key, keyLoc, value }], loc, raw: loc ? source.slice(loc.offset, loc.offset + loc.length) : '' };
  };

  const convertValue = (v: unknown): Node => {
    if (v === null || v === undefined) return nullNode();
    if (isPair(v)) return convertPair(v);
    if (isAlias(v) || isScalar(v) || isMap(v) || isSeq(v)) return convert(v);
    return fail('unsupported YAML node', null);
  };

  function convert(n: YamlNode): Node {
    if (++created > MAX_NODES) fail('alias expansion too large', null);
    if (isAlias(n)) {
      const target = resolveAlias(n);
      if (activeAliases.has(target)) fail(`recursive alias *${n.source}`, rangeLoc(n.range));
      activeAliases.add(target);
      try {
        // Fresh copy of the anchored node. loc points at the alias; raw stays the anchored
        // node's text so raw-based scalar comparison (1.10 vs "1.10") still works.
        const copy = convert(target);
        return { ...copy, loc: rangeLoc(n.range) };
      } finally {
        activeAliases.delete(target);
      }
    }
    const loc = rangeLoc(n.range);
    const raw = rangeRaw(n.range);
    if (isScalar(n)) return convertScalar(n, loc, raw);
    if (isMap(n)) return convertMap(n, loc, raw);
    checkTag(n);
    return { kind: 'array', items: n.items.map(convertValue), loc, raw };
  }

  const root = convertValue(contents);
  sortByPosition(diagnostics);
  return { ...base, root };
}
