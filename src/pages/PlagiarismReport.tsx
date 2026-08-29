import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { runPlagiarismCheck, listPlagiarismRuns, getPlagiarismRun, getSettings, cancelActiveTasks } from "@/lib/ipc";
import { useToast, friendlyError } from "@/components/ui/toaster";
import type { PlagiarismReport, PlagiarismRunMeta, PairwiseResult } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ArrowLeft,
  ChevronRight,
  Users,
  FileSearch,
  History,
  Network,
  List,
} from "lucide-react";
import { SimilarityMatrix } from "@/components/plagiarism/SimilarityMatrix";
import { ClusterView } from "@/components/plagiarism/ClusterView";
import { motion } from "framer-motion";

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
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="p-8 max-w-6xl mx-auto space-y-6"
    >
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-4 pt-8 -mt-8 -mx-8 px-8 border-b mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}`} />}
            variant="ghost"
            size="icon"
            className="mt-1 shrink-0"
            title="Back to Submissions"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Link to="/courses" className="hover:text-foreground transition-colors">
                Courses
              </Link>
              <ChevronRight className="w-4 h-4" />
              <Link to={`/courses/${courseId}`} className="hover:text-foreground transition-colors whitespace-nowrap">
                Course Details
              </Link>
              <ChevronRight className="w-4 h-4" />
              <Link
                to={`/courses/${courseId}/assignments/${courseWorkId}`}
                className="hover:text-foreground transition-colors"
              >
                Submissions
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Plagiarism Report</h1>
          </div>
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
        <ClusterView
          clusters={clusters}
          expandedRows={expandedRows}
          toggleRow={toggleRow}
          clusterStudents={clusterStudents}
        />
      ) : (
        <Card>
          <SimilarityMatrix
            report={report}
            expandedRows={expandedRows}
            toggleRow={toggleRow}
            getScoreColor={getScoreColor}
          />
        </Card>
      )}
    </motion.div>
  );
}
