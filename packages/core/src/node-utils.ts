/**
 * Helpers for building, unwrapping and displaying Nodes independent of any parser.
 * fromJS is mainly for tests and programmatic callers; displayValue is shared by policy messages and renderers.
 */
import type { Node, ObjectEntry, ScalarNode, ScalarType } from './types.js';

function scalar(type: ScalarType, value: ScalarNode['value'], raw: string, quoted: boolean): ScalarNode {
  return { kind: 'scalar', type, value, raw, quoted, loc: null };
}

/** Plain JS value to Node. loc is null; scalars get JSON-like raw text; strings are marked quoted. */
export function fromJS(value: unknown): Node {
  if (value === null || value === undefined) return scalar('null', null, 'null', false);
  switch (typeof value) {
    case 'string':
      return scalar('string', value, JSON.stringify(value), true);
    case 'number':
      return scalar('number', value, Object.is(value, -0) ? '-0' : String(value), false);
    case 'bigint':
      return scalar('number', Number(value), value.toString(), false);
    case 'boolean':
      return scalar('boolean', value, String(value), false);
    case 'object': {
      if (Array.isArray(value)) return { kind: 'array', items: value.map((v: unknown) => fromJS(v)), loc: null, raw: '' };
      if (value instanceof Date) return scalar('string', value.toISOString(), JSON.stringify(value.toISOString()), true);
      const entries: ObjectEntry[] = Object.entries(value).map(([k, v]) => ({
        key: k,
        sourceKey: k,
        keyLoc: null,
        value: fromJS(v),
      }));
      return { kind: 'object', entries, loc: null, raw: '' };
    }
    default:
      throw new TypeError(`fromJS: unsupported value of type ${typeof value}`);
  }
}

/** Node to plain JS. Object keys use sourceKey; "__proto__" stays an own data property. */
export function toJS(node: Node): unknown {
  switch (node.kind) {
    case 'scalar':
      return node.value;
    case 'array':
      return node.items.map(toJS);
    case 'object':
      return Object.fromEntries(node.entries.map((e) => [e.sourceKey, toJS(e.value)]));
  }
}

export function nodeTypeName(node: Node): ScalarType | 'array' | 'object' {
  return node.kind === 'scalar' ? node.type : node.kind;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/** JSON.stringify that writes non-finite numbers as strings instead of null. */
export function safeJson(value: unknown, space?: number): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), space);
}

/**
 * Single-line display text for a node: the source raw text for scalars when it is single-line,
 * otherwise JSON. Containers render as compact JSON. Truncated to `max` characters.
 */
export function displayValue(node: Node, max = 80): string {
  if (node.kind === 'scalar') {
    // Strings are always shown JSON-quoted so YAML/env and JSON sources look alike;
    // other scalars keep their source text so 1.10, 0755 and -0 stay visible as written.
    if (node.type === 'string') return truncate(JSON.stringify(node.value), max);
    if (node.raw !== '' && !/[\r\n]/.test(node.raw)) return truncate(node.raw, max);
    if (node.type === 'number') return truncate(String(node.value), max);
    return truncate(JSON.stringify(node.value), max);
  }
  if (node.kind === 'array' && node.items.length === 0) return '[]';
  if (node.kind === 'object' && node.entries.length === 0) return '{}';
  return truncate(safeJson(toJS(node)), max);
}
