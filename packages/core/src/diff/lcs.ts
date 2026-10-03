/**
 * Anchor computation for ordered arrays over interned fingerprints (integers).
 * lcsAnchors: exact LCS (DP) after trimming the common prefix/suffix.
 * fallbackAnchors: multiset matching + longest increasing subsequence, O(n log n), for huge inputs.
 */

export const LCS_CELL_LIMIT = 4_000_000;

export type Anchor = [left: number, right: number];

/** Exact LCS. Returns anchors in increasing order, or null when the trimmed table exceeds `limit` cells. */
export function lcsAnchors(a: readonly number[], b: readonly number[], limit = LCS_CELL_LIMIT): Anchor[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n * m > limit) return null;

  const anchors: Anchor[] = [];
  for (let i = 0; i < start; i++) anchors.push([i, i]);
  if (n > 0 && m > 0) {
    // dp[i*(m+1)+j] = LCS length of a[start+i..endA) and b[start+j..endB)
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      const ai = a[start + i];
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = ai === b[start + j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        anchors.push([start + i, start + j]);
        i++;
        j++;
      } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
      else j++;
    }
  }
  for (let k = 0; endA + k < a.length; k++) anchors.push([endA + k, endB + k]);
  return anchors;
}

/** Greedy multiset matching by value, then the longest increasing chain of those matches. */
export function fallbackAnchors(a: readonly number[], b: readonly number[]): Anchor[] {
  const positions = new Map<number, number[]>();
  for (let i = a.length - 1; i >= 0; i--) {
    const list = positions.get(a[i]!);
    if (list) list.push(i);
    else positions.set(a[i]!, [i]);
  }
  // Pairs in right order; each list is popped from the end, giving left positions in ascending order.
  const pairs: Anchor[] = [];
  for (let j = 0; j < b.length; j++) {
    const i = positions.get(b[j]!)?.pop();
    if (i !== undefined) pairs.push([i, j]);
  }
  // LIS on left positions (patience sorting with predecessor links).
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    const v = pairs[k]![0];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![0] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1]!;
    tails[lo] = k;
  }
  const out: Anchor[] = [];
  let k = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (k >= 0) {
    out.push(pairs[k]!);
    k = prev[k]!;
  }
  return out.reverse();
}
