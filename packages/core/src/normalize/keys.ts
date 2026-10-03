/** Object key folding used for matching entries (case and naming-style insensitivity). */
import type { NormalizeOptions } from '../types.js';

/**
 * styleInsensitive: drop `_` and `-`, then lowercase (maxRetries = MAX_RETRIES = max-retries).
 * caseInsensitive alone: lowercase only.
 */
export function canonicalKey(key: string, opts: NormalizeOptions['keys']): string {
  if (opts.styleInsensitive) return key.replace(/[_-]/g, '').toLowerCase();
  if (opts.caseInsensitive) return key.toLowerCase();
  return key;
}
