import type { PairwiseResult } from "@/lib/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, ChevronDown, ChevronUp } from "lucide-react";
import { FragmentDiff } from "./FragmentDiff";

interface ClusterViewProps {
  clusters: PairwiseResult[][];
  expandedRows: Record<string, boolean>;
  toggleRow: (id: string) => void;
  clusterStudents: (cluster: PairwiseResult[]) => string[];
}

export function ClusterView({ clusters, expandedRows, toggleRow, clusterStudents }: ClusterViewProps) {
  if (clusters.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">No flagged clusters found.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {clusters.map((cluster, idx) => {
        const members = clusterStudents(cluster);
        const maxCombined = Math.max(...cluster.map((r) => r.combined_score));
        return (
          <Card key={idx} className="border-red-200 dark:border-red-900/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="gap-1">
                    <Users className="w-3 h-3" /> Cluster {idx + 1}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {members.length} students · highest similarity {Math.round(maxCombined * 100)}%
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate max-w-[300px]" title={members.join(", ")}>
                  {members.join(", ")}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {cluster.map((result) => {
                const resultId = `${result.student_a_id}-${result.student_b_id}`;
                const isExpanded = expandedRows[resultId];
                return (
                  <div key={resultId} className="rounded-md border bg-card">
                    <div className="flex items-center justify-between gap-4 px-3 py-2">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <span className="font-medium truncate">{result.student_a_name}</span>
                        <span className="text-muted-foreground shrink-0">↔</span>
                        <span className="font-medium truncate">{result.student_b_name}</span>
                        {result.is_identical_file && (
                          <span className="ml-2 inline-flex items-center rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/10 dark:bg-red-400/10 dark:text-red-400 dark:ring-red-400/20">
                            Identical File
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          F: {Math.round(result.fingerprint_score * 100)}%
                        </span>
                        <span className="text-xs text-muted-foreground">
                          S: {Math.round(result.semantic_score * 100)}%
                        </span>
                        <span className="text-sm font-bold text-red-600 dark:text-red-400">
                          {Math.round(result.combined_score * 100)}%
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={isExpanded ? "Collapse matched fragments" : "Expand matched fragments"}
                          onClick={() => toggleRow(resultId)}
                          disabled={result.matched_fragments.length === 0}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                    {isExpanded && result.matched_fragments.length > 0 && (
                      <div className="px-3 pb-3 border-t pt-3 space-y-3">
                        {result.matched_fragments.map((fragment, fragIdx) => (
                          <FragmentDiff
                            key={fragIdx}
                            fragment={fragment}
                            studentAName={result.student_a_name}
                            studentBName={result.student_b_name}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
