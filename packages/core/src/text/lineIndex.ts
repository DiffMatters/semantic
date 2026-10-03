/**
 * Offset -> 1-based line/column lookup for a source string.
 * "\r\n", "\n" and a lone "\r" each count as one line break. Columns count UTF-16 code units.
 */
import type { Diagnostic, Loc } from '../types.js';

export class LineIndex {
  /** Offset of the first character of each line. */
  private readonly starts: number[] = [0];

  constructor(private readonly source: string) {
    for (let i = 0; i < source.length; i++) {
      const ch = source.charCodeAt(i);
      if (ch === 10 /* \n */) {
        this.starts.push(i + 1);
      } else if (ch === 13 /* \r */) {
        if (source.charCodeAt(i + 1) === 10) i++;
        this.starts.push(i + 1);
      }
    }
  }

  /** 1-based line and column of a 0-based offset (clamped to the source). */
  position(offset: number): { line: number; col: number } {
    const off = Math.max(0, Math.min(offset, this.source.length));
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= off) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: off - (this.starts[lo] ?? 0) + 1 };
  }

  /** Loc for the span [offset, offset + length). The end position is the position of offset + length. */
  locAt(offset: number, length: number): Loc {
    const len = Math.max(0, length);
    const start = this.position(offset);
    const end = this.position(offset + len);
    return { line: start.line, col: start.col, endLine: end.line, endCol: end.col, offset, length: len };
  }
}

/** Stable in-place sort of diagnostics by source position; position-less ones first. */
export function sortByPosition(diagnostics: Diagnostic[]): void {
  diagnostics.sort((a, b) => (a.loc?.offset ?? -1) - (b.loc?.offset ?? -1));
}
