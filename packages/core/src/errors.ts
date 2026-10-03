import type { Format, Loc } from './types.js';

/** Thrown when a source cannot be turned into a Document at all. */
export class ParseError extends Error {
  override readonly name = 'ParseError';
  constructor(
    message: string,
    readonly format: Format,
    readonly loc: Loc | null,
    readonly sourceName?: string,
  ) {
    super(message);
  }

  /** "file:line:col: message", or without position parts when unknown. */
  override toString(): string {
    const where = [this.sourceName ?? '<input>', this.loc?.line, this.loc?.col].filter((p) => p !== undefined).join(':');
    return `${where}: ${this.message}`;
  }
}

/** Thrown for invalid options: bad path pattern, unknown array strategy, bad regex. */
export class OptionsError extends Error {
  override readonly name = 'OptionsError';
}
