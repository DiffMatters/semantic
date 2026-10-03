/**
 * Parser entry point: rejects binary input, strips a leading BOM, detects the format
 * and dispatches to the JSON, YAML or env parser.
 */
import { ParseError } from '../errors.js';
import { detectFormat } from '../format.js';
import type { Document, ParseOptions } from '../types.js';
import { parseEnv } from './env.js';
import { parseJson } from './json.js';
import { parseYaml } from './yaml.js';

export { parseEnv, parseJson, parseYaml };

/** More replacement characters than this means the bytes were not UTF-8. */
const MAX_REPLACEMENT_CHARS = 2;

function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true;
  let replacements = 0;
  for (let i = text.indexOf('�'); i !== -1; i = text.indexOf('�', i + 1)) {
    if (++replacements > MAX_REPLACEMENT_CHARS) return true;
  }
  return false;
}

/** Parse config text into a Document. Throws ParseError when the text cannot be parsed. */
export function parse(text: string, opts: ParseOptions = {}): Document {
  const format = opts.format ?? detectFormat(text, opts.name);
  if (looksBinary(text)) throw new ParseError('binary or non-UTF-8 input', format, null, opts.name);
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  switch (format) {
    case 'json':
      return parseJson(source, opts.name);
    case 'yaml':
      return parseYaml(source, opts.name, opts.yaml);
    case 'env':
      return parseEnv(source, opts.name, opts.env);
  }
}
