/** Parser test helpers: fixture loading and a plain-JS view of IR nodes. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node } from '../src/types.js';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Read a fixture as UTF-8 text, path relative to test/fixtures. */
export function fixture(relPath: string): string {
  return readFileSync(join(FIXTURES, relPath), 'utf8');
}

/** File names in a fixture subdirectory (dotfiles such as .gitattributes skipped). */
export function fixtureFiles(dir: string): string[] {
  return readdirSync(join(FIXTURES, dir)).filter((f) => !f.startsWith('.'));
}

/** Plain JS value of a node. Object.fromEntries defines own properties, so `__proto__` stays data. */
export function toJS(node: Node): unknown {
  switch (node.kind) {
    case 'scalar':
      return node.value;
    case 'array':
      return node.items.map(toJS);
    case 'object':
      return Object.fromEntries(node.entries.map((e) => [e.key, toJS(e.value)]));
  }
}

/** Child node at a path of object keys / array indexes; throws when missing. */
export function at(node: Node, ...path: Array<string | number>): Node {
  let cur = node;
  for (const seg of path) {
    let next: Node | undefined;
    if (cur.kind === 'object') next = cur.entries.find((e) => e.key === seg)?.value;
    else if (cur.kind === 'array' && typeof seg === 'number') next = cur.items[seg];
    if (!next) throw new Error(`no node at ${path.join('.')} (missing ${String(seg)})`);
    cur = next;
  }
  return cur;
}
