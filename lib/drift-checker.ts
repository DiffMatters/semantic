import { computeSemanticDiff } from './diff-engine';

export interface DriftResult {
  key: string;
  leftValue: any;
  rightValue: any;
  status: 'match' | 'drift' | 'missing' | 'extra';
}

/**
 * Specialized drift checker for environment comparisons.
 * Flattens nested objects into dot-notation keys for a table view.
 */
export function checkDrift(left: any, right: any): DriftResult[] {
  const delta = computeSemanticDiff(left, right);

  if (!delta) {
    // Everything matches, but we still need to list all keys for the table
    const allKeys = new Set([
      ...Object.keys(left || {}),
      ...Object.keys(right || {})
    ]);

    return Array.from(allKeys).map(key => ({
      key,
      leftValue: left?.[key],
      rightValue: right?.[key],
      status: 'match'
    }));
  }

  // For simplicity in V1, we flatten the objects to compare top-level keys
  // A more robust version would recursively traverse the delta object
  const allKeys = new Set([
    ...Object.keys(left || {}),
    ...Object.keys(right || {})
  ]);

  return Array.from(allKeys).map(key => {
    const leftVal = left?.[key];
    const rightVal = right?.[key];

    if (leftVal === undefined) return { key, leftValue: undefined, rightValue: rightVal, status: 'extra' };
    if (rightVal === undefined) return { key, leftValue: leftVal, rightValue: undefined, status: 'missing' };
    if (JSON.stringify(leftVal) === JSON.stringify(rightVal)) return { key, leftValue: leftVal, rightValue: rightVal, status: 'match' };

    return { key, leftValue: leftVal, rightValue: rightVal, status: 'drift' };
  });
}
