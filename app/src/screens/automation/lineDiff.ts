/**
 * Minimal line-level diff (longest-common-subsequence based), no dependency.
 *
 * Used to highlight what a spec regeneration changed. Splits both revisions into
 * lines, computes the LCS via a classic O(n·m) dynamic-programming table, then
 * walks the alignment to classify each line of `next` as unchanged or
 * added/changed and to collect the lines that were removed from `prev`.
 *
 * For spec files (tens to low-hundreds of lines) the quadratic table is trivially
 * fast; this stays dependency-free per the project's "no new npm dependency" rule.
 *
 * @param prev The previous spec source.
 * @param next The regenerated spec source.
 * @returns `changed` — 0-based indices of added/changed lines in `next`;
 *   `count` — how many lines changed; `removed` — the lines dropped from `prev`
 *   (used by the summary heuristic, e.g. detecting removed hard waits).
 */
export function diffLines(
  prev: string,
  next: string,
): { changed: Set<number>; count: number; removed: string[] } {
  const a = prev.split("\n");
  const b = next.split("\n");
  const n = a.length;
  const m = b.length;

  // dp[i][j] = length of the LCS of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const changed = new Set<number>();
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // Dropping a[i] keeps at least as long an LCS — treat it as removed.
      removed.push(a[i]);
      i++;
    } else {
      // b[j] is not part of the common subsequence here — it's added/changed.
      changed.add(j);
      j++;
    }
  }
  while (i < n) {
    removed.push(a[i]);
    i++;
  }
  while (j < m) {
    changed.add(j);
    j++;
  }

  return { changed, count: changed.size, removed };
}
