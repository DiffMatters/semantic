/**
 * Hand-written dotenv parser (line state machine).
 *
 * Rules: BOM stripped; CRLF/CR/LF line breaks; blank and `#` lines skipped; optional
 * indentation and `export ` prefix; key `[A-Za-z_][A-Za-z0-9_.-]*`, optional spaces, `=`,
 * optional spaces. Values:
 *  - `"..."` may span lines; escapes \n \r \t \" \\ \$ are decoded, other backslashes kept.
 *  - `'...'` and `` `...` `` are literal and may span lines.
 *  - unquoted values end at EOL or at whitespace followed by `#`, and are trimmed (`a#b` keeps the `#`).
 * A quoted value ends at the FIRST matching closing quote. Text after it on that line (other than a
 * comment) is a MALFORMED_LINE warning, unless the closing quote is on a later line: then the opening
 * quote is considered unmatched and the line is read as an unquoted value (dotenv behaviour for
 * `KEY='abc"`), also with a warning. No closing quote anywhere is a ParseError at the opening quote.
 * `${VAR}` is left literal. Every value is a string scalar; typing is the normalizer's job.
 *
 * Nesting: the key is split on the separator (default `__`) greedily from left to right, exactly like
 * String.prototype.split, so `TRIPLE___UNDERSCORE` becomes [`TRIPLE`, `_UNDERSCORE`]. Empty segments
 * (`TRAILING__`, `__LEADING`, `A____B`) are dropped with an EMPTY_SEGMENT warning.
 */
import { ParseError } from '../errors.js';
import { LineIndex } from '../text/lineIndex.js';
import type { Diagnostic, Document, Loc, ObjectEntry, ObjectNode, ParseOptions, ScalarNode } from '../types.js';

const LINE_HEAD = /^([ \t]*)(export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*=([ \t]*)/;
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', $: '$' };

function unescapeDouble(text: string): string {
  return text.replace(/\\([\s\S])/g, (m, ch: string) => (Object.hasOwn(ESCAPES, ch) ? (ESCAPES[ch] ?? m) : m));
}

/** Offset of the first line break at or after pos (or source.length). */
function lineEnd(source: string, pos: number): number {
  for (let i = pos; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c === 10 || c === 13) return i;
  }
  return source.length;
}

/** Start of the line after a line ending at `end`. */
function nextLineStart(source: string, end: number): number {
  if (source[end] === '\r' && source[end + 1] === '\n') return end + 2;
  return Math.min(end + 1, source.length + 1);
}

/** Offset of the closing quote for a value opened at `open`, or -1. */
function findClose(source: string, open: number, quote: string): number {
  if (quote !== '"') return source.indexOf(quote, open + 1);
  for (let i = open + 1; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') i++;
    else if (c === '"') return i;
  }
  return -1;
}

export function parseEnv(input: string, name?: string, opts: ParseOptions['env'] = {}): Document {
  const source = input.startsWith('﻿') ? input.slice(1) : input;
  const lines = new LineIndex(source);
  const separator = opts.separator === undefined ? '__' : opts.separator;
  const diagnostics: Diagnostic[] = [];
  const warn = (code: Diagnostic['code'], message: string, loc: Loc | null): void => {
    diagnostics.push({ severity: 'warning', code, message, loc });
  };

  const root: ObjectNode = { kind: 'object', entries: [], loc: null, raw: '' };
  /** Per-object key index, so lookups never touch JS object prototypes (`__proto__` is plain data). */
  const index = new Map<ObjectNode, Map<string, ObjectEntry>>();
  /** Full source key that produced each leaf, to tell duplicates from collisions. */
  const leafKey = new WeakMap<ScalarNode, string>();

  const entriesOf = (obj: ObjectNode): Map<string, ObjectEntry> => {
    let m = index.get(obj);
    if (!m) {
      m = new Map();
      index.set(obj, m);
    }
    return m;
  };
  const removeEntry = (obj: ObjectNode, entry: ObjectEntry): void => {
    obj.entries.splice(obj.entries.indexOf(entry), 1);
    entriesOf(obj).delete(entry.key);
  };
  const addEntry = (obj: ObjectNode, entry: ObjectEntry): void => {
    obj.entries.push(entry);
    entriesOf(obj).set(entry.key, entry);
  };

  const describe = (n: ObjectEntry['value']): string => (n.kind === 'object' ? 'an object' : 'a value');

  const assign = (fullKey: string, keyOffset: number, value: ScalarNode): void => {
    // Split into segments with their offsets inside the key.
    let segments: Array<{ text: string; offset: number }> = [];
    if (separator === null || separator === '') {
      segments = [{ text: fullKey, offset: 0 }];
    } else {
      let at = 0;
      for (const part of fullKey.split(separator)) {
        segments.push({ text: part, offset: at });
        at += part.length + separator.length;
      }
      const nonEmpty = segments.filter((s) => s.text !== '');
      if (nonEmpty.length !== segments.length) {
        warn('EMPTY_SEGMENT', `key "${fullKey}" has an empty segment around "${separator}"; it was dropped`, lines.locAt(keyOffset, fullKey.length));
      }
      segments = nonEmpty.length > 0 ? nonEmpty : [{ text: fullKey, offset: 0 }];
    }

    let obj = root;
    segments.forEach((seg, i) => {
      const keyLoc = lines.locAt(keyOffset + seg.offset, seg.text.length);
      const existing = entriesOf(obj).get(seg.text);
      const isLeaf = i === segments.length - 1;
      if (!isLeaf) {
        if (existing && existing.value.kind === 'object') {
          obj = existing.value;
          return;
        }
        const child: ObjectNode = { kind: 'object', entries: [], loc: null, raw: '' };
        if (existing) {
          warn('KEY_COLLISION', `"${fullKey}" needs "${seg.text}" to be an object, replacing ${describe(existing.value)} set earlier`, keyLoc);
          removeEntry(obj, existing);
        }
        addEntry(obj, { key: seg.text, sourceKey: seg.text, keyLoc, value: child });
        obj = child;
        return;
      }
      if (existing) {
        const prev = existing.value;
        if (prev.kind === 'scalar' && leafKey.get(prev) === fullKey) {
          warn('DUPLICATE_KEY', `duplicate key "${fullKey}" (line ${existing.keyLoc?.line ?? '?'}); the later value on line ${keyLoc.line} wins`, keyLoc);
        } else {
          warn('KEY_COLLISION', `"${fullKey}" replaces ${describe(prev)} at the same path`, keyLoc);
        }
        removeEntry(obj, existing);
      }
      leafKey.set(value, fullKey);
      addEntry(obj, { key: seg.text, sourceKey: seg.text, keyLoc, value });
    });
  };

  const scalar = (value: string, quoted: boolean, offset: number, end: number): ScalarNode => ({
    kind: 'scalar',
    type: 'string',
    value,
    quoted,
    loc: lines.locAt(offset, end - offset),
    raw: source.slice(offset, end),
  });

  const malformed = (start: number, end: number, why: string): void => {
    const text = source.slice(start, end);
    const lead = text.length - text.trimStart().length;
    warn('MALFORMED_LINE', why, lines.locAt(start + lead, text.trim().length));
  };

  /** Unquoted value starting at `from` on a line ending at `end`. Returns [valueStart, valueEnd]. */
  const unquotedSpan = (from: number, end: number): [number, number] => {
    const text = source.slice(from, end);
    const comment = /\s#/.exec(text);
    const body = comment ? text.slice(0, comment.index) : text;
    const lead = body.length - body.trimStart().length;
    const start = from + lead;
    return [start, Math.max(start, from + body.trimEnd().length)];
  };

  let pos = 0;
  while (pos < source.length) {
    const end = lineEnd(source, pos);
    const line = source.slice(pos, end);
    const next = nextLineStart(source, end);
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      pos = next;
      continue;
    }
    const m = LINE_HEAD.exec(line);
    const key = m?.[3];
    if (!m || key === undefined) {
      malformed(pos, end, `expected KEY=value: "${trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed}"`);
      pos = next;
      continue;
    }
    const keyOffset = pos + (m[1]?.length ?? 0) + (m[2]?.length ?? 0);
    const valueStart = pos + m[0].length;
    const afterEq = valueStart - (m[4]?.length ?? 0);
    const quote = source[valueStart];

    if (valueStart < end && (quote === '"' || quote === "'" || quote === '`')) {
      const close = findClose(source, valueStart, quote);
      if (close < 0) {
        throw new ParseError(`unterminated ${quote} quoted value for ${key}`, 'env', lines.locAt(valueStart, 1), name);
      }
      const closeLineEnd = lineEnd(source, close);
      const rest = source.slice(close + 1, closeLineEnd);
      const restOk = /^\s*(#.*)?$/.test(rest);
      if (!restOk && close > end) {
        // The first closing quote belongs to some later line: the opening quote is unmatched.
        malformed(valueStart, end, `unmatched ${quote} in value of ${key}; value taken literally`);
        const [s, e] = unquotedSpan(afterEq, end);
        assign(key, keyOffset, scalar(source.slice(s, e), false, s, e));
        pos = next;
        continue;
      }
      if (!restOk) malformed(close + 1, closeLineEnd, `unexpected text after the closing quote of ${key}`);
      const inner = source.slice(valueStart + 1, close).replace(/\r\n?/g, '\n');
      const value = quote === '"' ? unescapeDouble(inner) : inner;
      assign(key, keyOffset, scalar(value, true, valueStart, close + 1));
      pos = nextLineStart(source, closeLineEnd);
      continue;
    }

    const [s, e] = unquotedSpan(afterEq, end);
    assign(key, keyOffset, scalar(source.slice(s, e), false, s, e));
    pos = next;
  }

  return { format: 'env', ...(name !== undefined ? { name } : {}), source, root, diagnostics };
}
