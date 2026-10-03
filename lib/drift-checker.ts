import { computeSemanticDiff } from './diff-engine';

export interface DriftResult {
  key: string;
  leftValue: any;
  rightValue: any;
  status: 'match' | 'drift' | 'missing' | 'extra';
}

/**
 * Recursively flattens a nested object into a flat map with dot-notation keys.
 * Example: { settings: { timeout: 30 } } -> { "settings.timeout": 30 }
 */
function flattenObject(obj: any, prefix = ''): Record<string, any> {
  const flat: Record<string, any> = {};

  if (obj === null || typeof obj !== 'object') {
    return { [prefix]: obj };
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object') {
        Object.assign(flat, flattenObject(value, newKey));
      } else {
        flat[newKey] = value;
      }
    }
  }

  return flat;
}

/**
 * Specialized drift checker for environment comparisons.
 * Now performs a deep comparison by flattening nested objects into dot-notation keys.
 */
export function checkDrift(left: any, right: any): DriftResult[] {
  const flatLeft = flattenObject(left);
  const flatRight = flattenObject(right);

  const allKeys = new Set([
    ...Object.keys(flatLeft),
    ...Object.keys(flatRight)
  ]);

  return Array.from(allKeys).sort().map(key => {
    const leftVal = flatLeft[key];
    const rightVal = flatRight[key];

    if (leftVal === undefined) return { key, leftValue: undefined, rightValue: rightVal, status: 'extra' };
    if (rightVal === undefined) return { key, leftValue: leftVal, rightValue: undefined, status: 'missing' };
    if (JSON.stringify(leftVal) === JSON.stringify(rightVal)) return { key, leftValue: leftVal, rightValue: rightVal, status: 'match' };

    return { key, leftValue: leftVal, rightValue: rightVal, status: 'drift' };
  });
}
