/**
 * JSON parser built on jsonc-parser's offset-preserving tree.
 * Comments and trailing commas are tolerated with one NON_STANDARD_JSON warning;
 * duplicate keys keep the last occurrence with a DUPLICATE_KEY warning.
 */
import { createScanner, parseTree, printParseErrorCode } from 'jsonc-parser';
import type { Node as JsonNode, ParseError as JsonParseError } from 'jsonc-parser';
import { ParseError } from '../errors.js';
import { LineIndex, sortByPosition } from '../text/lineIndex.js';
import type { Diagnostic, Document, Node, ObjectEntry, ScalarNode } from '../types.js';

// jsonc-parser's SyntaxKind is an ambient const enum, which isolatedModules cannot inline.
const TOKEN = {
  closeBrace: 2,
  closeBracket: 4,
  comma: 5,
  lineComment: 12,
  blockComment: 13,
  lineBreak: 14,
  trivia: 15,
  eof: 17,
} as const;

/** True when the text uses comments or trailing commas. */
function usesNonStandardSyntax(source: string): boolean {
  const scanner = createScanner(source, false);
  let previous = -1;
  for (let kind = scanner.scan(); kind !== TOKEN.eof; kind = scanner.scan()) {
    if (kind === TOKEN.lineComment || kind === TOKEN.blockComment) return true;
    if (kind === TOKEN.lineBreak || kind === TOKEN.trivia) continue;
    if ((kind === TOKEN.closeBrace || kind === TOKEN.closeBracket) && previous === TOKEN.comma) return true;
    previous = kind;
  }
  return false;
}

export function parseJson(input: string, name?: string): Document {
  const source = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const lines = new LineIndex(source);
  const diagnostics: Diagnostic[] = [];

  if (source.trim() === '') {
    throw new ParseError('empty document', 'json', source.length > 0 ? lines.locAt(0, source.length) : null, name);
  }

  const errors: JsonParseError[] = [];
  const tree = parseTree(source, errors, { disallowComments: false, allowTrailingComma: true, allowEmptyContent: false });
  const first = errors[0];
  if (first) {
    throw new ParseError(
      `invalid JSON: ${printParseErrorCode(first.error)}`,
      'json',
      lines.locAt(first.offset, first.length),
      name,
    );
  }
  if (!tree) throw new ParseError('empty document', 'json', null, name);

  if (usesNonStandardSyntax(source)) {
    diagnostics.push({
      severity: 'warning',
      code: 'NON_STANDARD_JSON',
      message: 'comments or trailing commas are not standard JSON',
      loc: null,
    });
  }

  const convert = (n: JsonNode): Node => {
    const loc = lines.locAt(n.offset, n.length);
    const raw = source.slice(n.offset, n.offset + n.length);
    switch (n.type) {
      case 'object': {
        const all: ObjectEntry[] = [];
        for (const prop of n.children ?? []) {
          const [keyNode, valueNode] = prop.children ?? [];
          if (!keyNode || !valueNode) throw new ParseError('invalid JSON: malformed property', 'json', lines.locAt(prop.offset, prop.length), name);
          const key = String(keyNode.value);
          all.push({ key, sourceKey: key, keyLoc: lines.locAt(keyNode.offset, keyNode.length), value: convert(valueNode) });
        }
        // Last occurrence wins and keeps its own position in source order.
        const lastIndex = new Map<string, number>();
        all.forEach((e, i) => lastIndex.set(e.key, i));
        const entries: ObjectEntry[] = [];
        all.forEach((e, i) => {
          if (lastIndex.get(e.key) === i) {
            entries.push(e);
            return;
          }
          const winner = all[lastIndex.get(e.key) ?? i];
          diagnostics.push({
            severity: 'warning',
            code: 'DUPLICATE_KEY',
            message: `duplicate key "${e.key}" (line ${e.keyLoc?.line ?? '?'}); the later value on line ${winner?.keyLoc?.line ?? '?'} wins`,
            loc: winner?.keyLoc ?? e.keyLoc,
          });
        });
        return { kind: 'object', entries, loc, raw };
      }
      case 'array':
        return { kind: 'array', items: (n.children ?? []).map(convert), loc, raw };
      case 'string':
        return scalar('string', String(n.value), true);
      case 'number':
        return scalar('number', Number(n.value), false);
      case 'boolean':
        return scalar('boolean', n.value === true, false);
      case 'null':
        return scalar('null', null, false);
      default:
        throw new ParseError(`invalid JSON: unexpected ${n.type}`, 'json', loc, name);
    }

    function scalar(type: ScalarNode['type'], value: ScalarNode['value'], quoted: boolean): ScalarNode {
      return { kind: 'scalar', type, value, quoted, loc, raw };
    }
  };

  const root = convert(tree);
  sortByPosition(diagnostics);
  return { format: 'json', ...(name !== undefined ? { name } : {}), source, root, diagnostics };
}
