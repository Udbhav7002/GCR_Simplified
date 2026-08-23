import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  runPlagiarismCheck,
  listPlagiarismRuns,
  getPlagiarismRun,
  getSettings,
  cancelActiveTasks,
} from "@/lib/ipc";
import { useToast, friendlyError } from "@/components/ui/toaster";
import type { PlagiarismReport, PlagiarismRunMeta, PairwiseResult } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ChevronRight,
  Users,
  FileSearch,
  History,
  Network,
  List,
} from "lucide-react";

type ViewMode = "flat" | "clusters";

/// Group flagged pairs into connected components (union-find over student ids).
function buildClusters(results: PairwiseResult[]): PairwiseResult[][] {
  const flagged = results.filter((r) => r.flagged);
  if (flagged.length === 0) return [];

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let cur = x;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, parent.get(parent.get(next)!)!);
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

function clusterStudents(cluster: PairwiseResult[]): string[] {
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

export function PlagiarismReportPage() {
  const { courseId, courseWorkId } = useParams<{ courseId: string; courseWorkId: string }>();
  const toast = useToast();
  const [report, setReport] = useState<PlagiarismReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<PlagiarismRunMeta[]>([]);
  const [viewingRun, setViewingRun] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("flat");

  const clusters = useMemo(() => buildClusters(report?.results ?? []), [report]);

  // Load prior runs + saved thresholds on mount. Never auto-compute: a full
  // pairwise analysis is expensive and persisting it on every visit would
  // spam the run history (and duplicate runs in dev StrictMode).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!courseId || !courseWorkId) return;
      try {
        const history = await listPlagiarismRuns(courseId, courseWorkId);
        if (cancelled) return;
        setRuns(history);
        // Show the most recent run by default.
        if (history.length > 0) {
          const latest = history[0];
          const data = await getPlagiarismRun(latest.id);
          if (!cancelled) {
            setReport(data);
            setViewingRun(latest.id);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast("Failed to load previous checks: " + friendlyError(err), "error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, courseWorkId, toast]);

  const handleRun = async () => {
    if (!courseId || !courseWorkId) return;
    try {
      setRunning(true);
      setLoading(true);
      setError(null);
      const settings = await getSettings();
      const data = await runPlagiarismCheck(
        courseId,
        courseWorkId,
        settings.default_fingerprint_threshold,
        settings.default_semantic_threshold
      );
      setReport(data);
      setViewingRun("");
      setExpandedRows({});
      toast(`Analysis complete: ${data.flagged_pairs} flagged pair(s)`, "success");
      const history = await listPlagiarismRuns(courseId, courseWorkId);
      setRuns(history);
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setRunning(false);
      setLoading(false);
    }
  };

  const handleCancelCheck = async () => {
    try {
      await cancelActiveTasks();
      toast("Cancelling plagiarism check...", "info");
    } catch (err: unknown) {
      console.error(err);
    }
  };

  const handleViewRun = async (runId: string | null) => {
    if (!runId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getPlagiarismRun(runId);
      setReport(data);
      setViewingRun(runId);
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const getScoreColor = (score: number, type: "fingerprint" | "semantic") => {
    if (!report) return "text-green-600";
    if (type === "fingerprint") {
      const threshold = report.fingerprint_threshold;
      if (score < threshold * 0.66) return "text-green-600";
      if (score < threshold) return "text-yellow-600";
      return "text-red-600";
    } else {
      const threshold = report.semantic_threshold;
      if (score < threshold * 0.75) return "text-green-600";
      if (score < threshold) return "text-yellow-600";
      return "text-red-600";
    }
  };

  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <AlertTriangle className="w-8 h-8 text-destructive" />
            <h3 className="text-lg font-medium text-destructive">Error Running Plagiarism Check</h3>
            <p className="text-sm text-muted-foreground">{error}</p>
            <div className="flex gap-2">
              <Button render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}`} />} variant="outline">
                Back to Submissions
              </Button>
              <Button onClick={handleRun} variant="default">
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="p-8 max-w-6xl mx-auto flex flex-col items-center justify-center space-y-4 h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Analyzing submissions for plagiarism...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card>
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4 py-16">
            <Shield className="w-10 h-10 text-muted-foreground" />
            <h3 className="text-lg font-medium">No plagiarism checks yet</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Run an integrity check to compare every student submission pair against each other using fingerprinting
              and semantic analysis.
            </p>
            <Button onClick={handleRun} disabled={running} className="gap-2">
              {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              {running ? "Analyzing..." : "Run Plagiarism Check"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button render={<Link to="/courses" />} variant="ghost" size="sm" className="text-muted-foreground">
            Courses
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <Button
            render={<Link to={`/courses/${courseId}`} />}
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
          >
            Course
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <Button
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}`} />}
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
          >
            Submissions
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Plagiarism Report</h1>
        </div>
        <div className="flex items-center gap-2">
          {runs.length > 0 && (
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <Select value={viewingRun} onValueChange={handleViewRun}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Past runs..." />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      {new Date(run.created_at).toLocaleString()} · {run.flagged_pairs} flagged
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {running ? (
            <Button onClick={handleCancelCheck} variant="destructive" className="gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Cancel Check
            </Button>
          ) : (
            <Button onClick={handleRun} disabled={loading} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Run New Check
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Submissions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div className="text-2xl font-bold">{report.total_submissions}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pairs Checked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <FileSearch className="w-4 h-4 text-muted-foreground" />
              <div className="text-2xl font-bold">{report.pairs_checked}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Flagged Pairs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {report.flagged_pairs > 0 ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              )}
              <div className={`text-2xl font-bold ${report.flagged_pairs > 0 ? "text-red-500" : "text-green-500"}`}>
                {report.flagged_pairs}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Thresholds</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <div className="text-lg font-bold">
                {Math.round(report.fingerprint_threshold * 100)}% / {Math.round(report.semantic_threshold * 100)}%
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Network className="w-4 h-4" />
          <span>{clusters.length} cluster(s) of flagged students</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <Button
            variant={viewMode === "flat" ? "secondary" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => setViewMode("flat")}
          >
            <List className="w-3.5 h-3.5" /> List
          </Button>
          <Button
            variant={viewMode === "clusters" ? "secondary" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => setViewMode("clusters")}
          >
            <Network className="w-3.5 h-3.5" /> Clusters
          </Button>
        </div>
      </div>

      {viewMode === "clusters" ? (
        <div className="space-y-4">
          {clusters.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">No flagged clusters found.</CardContent>
            </Card>
          ) : (
            clusters.map((cluster, idx) => {
              const members = clusterStudents(cluster);
              const maxCombined = Math.max(...cluster.map((r) => r.combined_score));
              return (
                <Card key={idx} className="border-red-200">
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
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-xs text-muted-foreground">
                                F: {Math.round(result.fingerprint_score * 100)}%
                              </span>
                              <span className="text-xs text-muted-foreground">
                                S: {Math.round(result.semantic_score * 100)}%
                              </span>
                              <span className="text-sm font-bold text-red-600">
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
                                <div key={fragIdx} className="grid grid-cols-2 gap-4 text-sm">
                                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-md">
                                    <div className="text-xs text-muted-foreground mb-1 font-semibold">
                                      {result.student_a_name}
                                    </div>
                                    <div>{fragment.text_a}</div>
                                  </div>
                                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-md">
                                    <div className="text-xs text-muted-foreground mb-1 font-semibold">
                                      {result.student_b_name}
                                    </div>
                                    <div>{fragment.text_b}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <Card>
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
                      <TableRow className={result.flagged ? "bg-red-50/50" : ""}>
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
                            <Badge
                              variant="secondary"
                              className="bg-yellow-100 text-yellow-800 gap-1 border-yellow-200"
                            >
                              <AlertTriangle className="w-3 h-3" /> Suspicious
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-50 text-green-700 gap-1 border-green-200">
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
                                  <div key={idx} className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                                      <div className="text-xs text-muted-foreground mb-1 font-semibold">
                                        {result.student_a_name}
                                      </div>
                                      <div>{fragment.text_a}</div>
                                    </div>
                                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                                      <div className="text-xs text-muted-foreground mb-1 font-semibold">
                                        {result.student_b_name}
                                      </div>
                                      <div>{fragment.text_b}</div>
                                    </div>
                                  </div>
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
        </Card>
      )}
    </div>
  );
}
