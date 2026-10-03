import { diff as computeDiff } from 'jsondiffpatch';

/**
 * Recursively sorts all keys of an object alphabetically to ignore key order.
 */
export function canonicalize(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }

  const sortedObj: Record<string, any> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    sortedObj[key] = canonicalize(obj[key]);
  }

  return sortedObj;
}

/**
 * Computes a semantic diff between two configurations.
 * Normalizes both inputs to ignore formatting and key order.
 */
export function computeSemanticDiff(left: any, right: any) {
  const canonicalLeft = canonicalize(left);
  const canonicalRight = canonicalize(right);

  return computeDiff(canonicalLeft, canonicalRight);
}
