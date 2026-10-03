/**
 * Format detection: file name first, then a cheap content sniff.
 */
import type { Format } from './types.js';

const ENV_LINE = /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=/;

function fromName(name: string): Format | undefined {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  if (base.endsWith('.json') || base.endsWith('.jsonc')) return 'json';
  if (base.endsWith('.yml') || base.endsWith('.yaml')) return 'yaml';
  if (base.startsWith('.env') || base.endsWith('.env') || base === 'env.txt') return 'env';
  return undefined;
}

/** Detect the format of `text`, using `name` (a file name or path) when it has a known extension. */
export function detectFormat(text: string, name?: string): Format {
  if (name) {
    const byName = fromName(name);
    if (byName) return byName;
  }
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const trimmed = body.trim();
  if (trimmed === '') return 'yaml';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  const lines = body.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
  if (lines.length > 0 && lines.every((l) => ENV_LINE.test(l))) return 'env';
  return 'yaml';
}
