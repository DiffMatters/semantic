/** Parse one pane's text into a core Document, turning exceptions into displayable state. */
import { ParseError, parse, type Document, type Format } from "@config-diff/core";

export type FormatChoice = "auto" | Format;

export interface SourceState {
  text: string;
  /** File name (from upload, drop or sample); drives extension-based detection. */
  name: string;
  format: FormatChoice;
}

export const EMPTY_SOURCE: SourceState = { text: "", name: "", format: "auto" };

export type ParseOutcome =
  | { status: "empty" }
  | { status: "ok"; doc: Document }
  | { status: "error"; message: string; line: number | null; col: number | null };

export function parseSource(text: string, format: Format, name: string, envSeparator: string | null | undefined): ParseOutcome {
  if (text.trim() === "") return { status: "empty" };
  try {
    const doc = parse(text, {
      format,
      name: name || undefined,
      env: envSeparator === undefined ? undefined : { separator: envSeparator },
    });
    return { status: "ok", doc };
  } catch (e) {
    if (e instanceof ParseError) return { status: "error", message: e.message, line: e.loc?.line ?? null, col: e.loc?.col ?? null };
    return { status: "error", message: e instanceof Error ? e.message : String(e), line: null, col: null };
  }
}
