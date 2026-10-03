/** Human-readable path text: settings.timeout, features[2], servers[name=web].port, ["a.b"], (root). */
import type { PathSegment } from '../types.js';

export type DisplaySegment = PathSegment | { keyField: string; keyValue: string };

const IDENT = /^[A-Za-z_$][\w$-]*$/;

export function pathToText(segments: readonly DisplaySegment[]): string {
  if (segments.length === 0) return '(root)';
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else if (typeof seg === 'string') out += IDENT.test(seg) ? (out === '' ? seg : `.${seg}`) : `[${JSON.stringify(seg)}]`;
    else out += `[${seg.keyField}=${seg.keyValue}]`;
  }
  return out;
}
