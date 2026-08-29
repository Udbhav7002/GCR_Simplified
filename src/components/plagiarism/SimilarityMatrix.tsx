import React from "react";
import type { PlagiarismReport } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { FragmentDiff } from "./FragmentDiff";

interface SimilarityMatrixProps {
  report: PlagiarismReport;
  expandedRows: Record<string, boolean>;
  toggleRow: (id: string) => void;
  getScoreColor: (score: number, type: "fingerprint" | "semantic") => string;
}

export function SimilarityMatrix({ report, expandedRows, toggleRow, getScoreColor }: SimilarityMatrixProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Student A</TableHead>
          <TableHead>Student B</TableHead>
          <TableHead>Fingerprint</TableHead>
          <TableHead>Semantic</TableHead>
          <TableHead>Combined</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.results.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
              No pairs to compare or no submissions extracted.
            </TableCell>
          </TableRow>
        ) : (
          report.results.map((result) => {
            const resultId = `${result.student_a_id}-${result.student_b_id}`;
            const isExpanded = expandedRows[resultId];

            return (
              <React.Fragment key={resultId}>
                <TableRow className={result.flagged ? "bg-red-50/50 dark:bg-red-900/20" : ""}>
                  <TableCell className="font-medium">{result.student_a_name}</TableCell>
                  <TableCell className="font-medium">{result.student_b_name}</TableCell>
                  <TableCell>
                    <span className={`font-semibold ${getScoreColor(result.fingerprint_score, "fingerprint")}`}>
                      {Math.round(result.fingerprint_score * 100)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`font-semibold ${getScoreColor(result.semantic_score, "semantic")}`}>
                      {Math.round(result.semantic_score * 100)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-bold">{Math.round(result.combined_score * 100)}%</span>
                  </TableCell>
                  <TableCell>
                    {result.flagged ? (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="w-3 h-3" /> Flagged
                      </Badge>
                    ) : result.combined_score >= report.fingerprint_threshold ? (
                      <Badge variant="secondary" className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 gap-1 border-yellow-200 dark:border-yellow-900/50">
                        <AlertTriangle className="w-3 h-3" /> Suspicious
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 gap-1 border-green-200 dark:border-green-900/50">
                        <CheckCircle2 className="w-3 h-3" /> Clear
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={isExpanded ? "Collapse matched fragments" : "Expand matched fragments"}
                      onClick={() => toggleRow(resultId)}
                      disabled={result.matched_fragments.length === 0}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </TableCell>
                </TableRow>
                {isExpanded && result.matched_fragments.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0 border-b-0">
                      <div className="bg-muted/30 p-4 border-b">
                        <h4 className="text-sm font-semibold mb-3">Matched Fragments</h4>
                        <div className="space-y-4">
                          {result.matched_fragments.map((fragment, idx) => (
                            <FragmentDiff
                              key={idx}
                              fragment={fragment}
                              studentAName={result.student_a_name}
                              studentBName={result.student_b_name}
                            />
                          ))}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
