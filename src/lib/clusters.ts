import { PairwiseResult } from "./types";

export function buildClusters(results: PairwiseResult[]): PairwiseResult[][] {
  const flagged = results.filter((r) => r.flagged);
  if (flagged.length === 0) return [];

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let cur = x;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, parent.get(parent.get(next)!) || next);
      cur = next;
    }
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const r of flagged) union(r.student_a_id, r.student_b_id);

  const clusters = new Map<string, PairwiseResult[]>();
  for (const r of flagged) {
    const root = find(r.student_a_id);
    const list = clusters.get(root);
    if (list) list.push(r);
    else clusters.set(root, [r]);
  }

  return Array.from(clusters.values()).sort((a, b) => {
    const maxA = Math.max(...a.map((r) => r.combined_score));
    const maxB = Math.max(...b.map((r) => r.combined_score));
    return maxB - maxA;
  });
}

export function clusterStudents(cluster: PairwiseResult[]): string[] {
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const r of cluster) {
    if (!ids.has(r.student_a_id)) names.set(r.student_a_id, r.student_a_name);
    if (!ids.has(r.student_b_id)) names.set(r.student_b_id, r.student_b_name);
    ids.add(r.student_a_id);
    ids.add(r.student_b_id);
  }
  return Array.from(ids)
    .map((id) => names.get(id) || id)
    .sort();
}
