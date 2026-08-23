import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  getGradebook,
  gradeAllAssignment,
  updateGradeOverride,
  approveGrade,
  approveAllGrades,
  exportGradebook,
  createRubricCriterion,
  deleteRubricCriterion,
  cancelActiveTasks,
} from "@/lib/ipc";
import { useToast, friendlyError } from "@/components/ui/toaster";
import type { GradebookView, Grade, GradebookRow, GradingProgressPayload } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ChevronRight,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Edit2,
  Shield,
  Brain,
  FileSpreadsheet,
  Plus,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function Gradebook() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get("courseId") ?? undefined;
  const courseWorkId = searchParams.get("courseWorkId") ?? undefined;
  const toast = useToast();
  const [gradebook, setGradebook] = useState<GradebookView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gradingAll, setGradingAll] = useState(false);
  const [progress, setProgress] = useState<GradingProgressPayload | null>(null);
  const [editingGrade, setEditingGrade] = useState<{ grade: Grade; row: GradebookRow } | null>(null);
  const [overrideScore, setOverrideScore] = useState("");
  const [overrideFeedback, setOverrideFeedback] = useState("");
  const [approvingAll, setApprovingAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [newCriterionName, setNewCriterionName] = useState("");
  const [newCriterionMax, setNewCriterionMax] = useState("10");
  const [savingCriterion, setSavingCriterion] = useState(false);

  const fetchGradebook = useCallback(async () => {
    if (!assignmentId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getGradebook(assignmentId);
      setGradebook(data);
    } catch (err: unknown) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    fetchGradebook();
  }, [fetchGradebook]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<GradingProgressPayload>("grading-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    }).catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleAddCriterion = async () => {
    if (!assignmentId) return;
    const name = newCriterionName.trim();
    const maxMarks = parseFloat(newCriterionMax);
    if (!name) {
      toast("Please enter a criterion name.", "error");
      return;
    }
    if (isNaN(maxMarks) || maxMarks <= 0) {
      toast("Max marks must be a positive number.", "error");
      return;
    }
    try {
      setSavingCriterion(true);
      const nextOrder = (gradebook?.rubric.length ?? 0) + 1;
      await createRubricCriterion({
        assignmentId,
        name,
        maxMarks,
        sortOrder: nextOrder,
      });
      setNewCriterionName("");
      setNewCriterionMax("10");
      toast("Rubric criterion added", "success");
      await fetchGradebook();
    } catch (err: unknown) {
      console.error(err);
      toast("Failed to add criterion: " + friendlyError(err), "error");
    } finally {
      setSavingCriterion(false);
    }
  };

  const handleDeleteCriterion = async (id: string, name: string) => {
    if (!assignmentId) return;
    try {
      await deleteRubricCriterion(id);
      toast(`Removed criterion "${name}"`, "success");
      await fetchGradebook();
    } catch (err: unknown) {
      console.error(err);
      toast("Failed to remove criterion: " + friendlyError(err), "error");
    }
  };

  const handleGradeAll = async () => {
    if (!assignmentId) return;
    try {
      setGradingAll(true);
      setProgress(null);
      const result = await gradeAllAssignment(assignmentId);
      if (result.failed > 0) {
        toast(
          `AI grading finished: ${result.graded.length} graded, ${result.failed} failed.\n${result.failed_names.slice(0, 3).join("\n")}`,
          "error"
        );
      } else {
        toast(`AI grading complete for ${result.graded.length} submissions`, "success");
      }
      await fetchGradebook();
    } catch (err: unknown) {
      console.error(err);
      toast("AI grading finished: " + friendlyError(err), "info");
      await fetchGradebook();
    } finally {
      setGradingAll(false);
      setProgress(null);
    }
  };

  const handleCancelGrading = async () => {
    try {
      await cancelActiveTasks();
      toast("Cancelling batch grading...", "info");
    } catch (err: unknown) {
      console.error(err);
    }
  };

  const handleApproveAll = async () => {
    if (!assignmentId) return;
    try {
      setApprovingAll(true);
      const count = await approveAllGrades(assignmentId);
      toast(`Approved ${count} AI-suggested grades`, "success");
      await fetchGradebook();
    } catch (err: unknown) {
      console.error(err);
      toast("Failed to approve grades: " + friendlyError(err), "error");
    } finally {
      setApprovingAll(false);
    }
  };

  const handleExport = async () => {
    if (!assignmentId) return;
    try {
      const defaultName = gradebook
        ? `${gradebook.assignment_title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_")}.xlsx`
        : "gradebook.xlsx";
      const savePath = await save({
        title: "Export Gradebook",
        defaultPath: defaultName,
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      });
      if (!savePath) return; // user cancelled

      setExporting(true);
      const path = await exportGradebook({ assignmentId, courseId, courseWorkId, savePath });
      toast(`Gradebook exported to:\n${path}`, "success");
    } catch (err: unknown) {
      console.error(err);
      toast("Failed to export gradebook: " + friendlyError(err), "error");
    } finally {
      setExporting(false);
    }
  };

  const handleEditGrade = (grade: Grade, row: GradebookRow) => {
    setOverrideScore(grade.score?.toString() ?? "");
    setOverrideFeedback(grade.feedback ?? "");
    setEditingGrade({ grade, row });
  };

  const handleSaveOverride = async (gradeId: string, teacherScore: number, teacherFeedback?: string) => {
    try {
      await updateGradeOverride({ grade_id: gradeId, teacher_score: teacherScore, teacher_feedback: teacherFeedback });
      setEditingGrade(null);
      await fetchGradebook();
      toast("Grade override saved", "success");
    } catch (err: unknown) {
      console.error(err);
      toast("Failed to save override: " + friendlyError(err), "error");
    }
  };

  const handleSaveOverrideClick = () => {
    if (!editingGrade) return;
    const score = parseFloat(overrideScore);
    if (isNaN(score) || score < 0) {
      toast("Please enter a valid score.", "error");
      return;
    }
    handleSaveOverride(editingGrade.grade.id, score, overrideFeedback.trim() || undefined);
  };

  const handleApproveGrade = async (gradeId: string, approved: boolean) => {
    try {
      await approveGrade(gradeId, approved);
      await fetchGradebook();
      toast(approved ? "Grade approved" : "Approval removed", "success");
    } catch (err: unknown) {
      console.error(err);
      toast("Failed to update approval: " + friendlyError(err), "error");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "graded":
        return (
          <Badge variant="default" className="bg-green-500/10 text-green-700 border-green-500/20">
            Graded
          </Badge>
        );
      case "ungraded":
        return (
          <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
            Ungraded
          </Badge>
        );
      case "reviewed":
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20">
            Reviewed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <AlertTriangle className="w-8 h-8 text-destructive" />
            <h3 className="text-lg font-medium text-destructive">Error Loading Gradebook</h3>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={fetchGradebook} variant="outline">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !gradebook) {
    return (
      <div className="p-8 max-w-6xl mx-auto flex flex-col items-center justify-center space-y-4 h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Loading gradebook...</p>
      </div>
    );
  }

  const totalStudents = gradebook.rows.length;
  const gradedCount = gradebook.rows.filter((r) => r.grading_status === "graded").length;
  const suggestedCount = gradebook.rows.reduce(
    (acc, r) => acc + r.grades.filter((g) => g.graded_by === "ai" && !g.approved).length,
    0
  );
  const approvedCount = gradebook.rows.reduce((acc, r) => acc + r.grades.filter((g) => g.approved).length, 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button render={<Link to="/courses" />} variant="ghost" size="sm" className="text-muted-foreground">
            Courses
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Gradebook</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchGradebook} disabled={loading} variant="outline" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {gradingAll ? (
            <Button onClick={handleCancelGrading} variant="destructive" className="gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cancel Grading
            </Button>
          ) : (
            <Button
              onClick={handleGradeAll}
              disabled={loading || gradedCount === totalStudents || gradebook.rubric.length === 0}
              variant="outline"
              className="gap-2"
            >
              <Brain className="w-4 h-4" />
              Grade All (AI)
            </Button>
          )}
          <Button
            onClick={handleApproveAll}
            disabled={loading || approvingAll || suggestedCount === 0}
            variant="outline"
            className="gap-2"
          >
            {approvingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {approvingAll ? "Approving..." : `Approve All Suggested (${suggestedCount})`}
          </Button>
          <Button onClick={handleExport} disabled={loading || exporting} className="gap-2">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {exporting ? "Exporting..." : "Export Gradebook"}
          </Button>
        </div>
      </div>

      {/* Real-time Grading Progress Banner */}
      {gradingAll && progress && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>
                  Grading submission {progress.current} of {progress.total}:{" "}
                  <span className="font-semibold text-primary">{progress.student_name}</span> ({progress.status})
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%
              </span>
            </div>
            <div className="w-full bg-primary/20 h-2 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Students</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStudents}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Graded</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{gradedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">AI Suggested</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{suggestedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{approvedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rubric</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {gradebook.rubric.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rubric criteria defined. Add criteria below before running AI grading.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {gradebook.rubric.map((criterion) => (
                <div
                  key={criterion.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-muted/20"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{criterion.name}</p>
                    <p className="text-xs text-muted-foreground">Max marks: {criterion.max_marks}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteCriterion(criterion.id, criterion.name)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Input
              placeholder="Criterion name (e.g. Code Clarity)"
              value={newCriterionName}
              onChange={(e) => setNewCriterionName(e.target.value)}
              className="max-w-xs"
            />
            <Input
              type="number"
              placeholder="Max marks"
              value={newCriterionMax}
              onChange={(e) => setNewCriterionMax(e.target.value)}
              className="w-28"
            />
            <Button onClick={handleAddCriterion} disabled={savingCriterion} className="gap-2">
              {savingCriterion ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Criterion
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Submissions Gradebook</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                {gradebook.rubric.map((c) => (
                  <TableHead key={c.id} className="text-center">
                    {c.name} ({c.max_marks})
                  </TableHead>
                ))}
                <TableHead className="text-right">Total Score</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gradebook.rows.map((row) => {
                const rowTotal = row.grades.reduce((sum, g) => sum + (g.score ?? 0), 0);
                const maxTotal = gradebook.rubric.reduce((sum, c) => sum + c.max_marks, 0);

                return (
                  <TableRow key={row.submission_id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{row.student_name}</p>
                        {row.student_email && (
                          <p className="text-xs text-muted-foreground">{row.student_email}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(row.grading_status)}</TableCell>
                    {gradebook.rubric.map((c) => {
                      const grade = row.grades.find((g) => g.criterion_id === c.id);
                      return (
                        <TableCell key={c.id} className="text-center">
                          {grade && grade.score !== null ? (
                            <div className="inline-flex items-center gap-1.5">
                              <span className="font-semibold text-sm">{grade.score}</span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 ${
                                  grade.graded_by === "teacher"
                                    ? "border-blue-500/40 text-blue-600 bg-blue-500/5"
                                    : grade.approved
                                      ? "border-green-500/40 text-green-600 bg-green-500/5"
                                      : "border-amber-500/40 text-amber-600 bg-amber-500/5"
                                }`}
                              >
                                {grade.graded_by === "teacher"
                                  ? "Teacher"
                                  : grade.approved
                                    ? "Approved"
                                    : "AI"}
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                aria-label={`Edit grade for ${row.student_name} – ${c.name}`}
                                onClick={() => handleEditGrade(grade, row)}
                              >
                                <Edit2 className="w-3 h-3 text-muted-foreground" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-bold">
                      {row.grading_status === "graded" ? `${rowTotal.toFixed(1)} / ${maxTotal}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.grades.some((g) => !g.approved && g.graded_by === "ai") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            row.grades
                              .filter((g) => !g.approved)
                              .forEach((g) => handleApproveGrade(g.id, true));
                          }}
                        >
                          Approve All
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Override Dialog */}
      <Dialog open={Boolean(editingGrade)} onOpenChange={(open) => !open && setEditingGrade(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Grade Override</DialogTitle>
          </DialogHeader>
          {editingGrade && (
            <div className="space-y-4 py-2">
              <div>
                <p className="text-sm font-medium">{editingGrade.row.student_name}</p>
                <p className="text-xs text-muted-foreground">
                  Criterion:{" "}
                  {gradebook.rubric.find((r) => r.id === editingGrade.grade.criterion_id)?.name || "Criterion"} (Max:{" "}
                  {gradebook.rubric.find((r) => r.id === editingGrade.grade.criterion_id)?.max_marks})
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Score</label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  max={gradebook.rubric.find((r) => r.id === editingGrade.grade.criterion_id)?.max_marks}
                  value={overrideScore}
                  onChange={(e) => setOverrideScore(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Teacher Feedback</label>
                <Input
                  placeholder="Optional feedback to the student..."
                  value={overrideFeedback}
                  onChange={(e) => setOverrideFeedback(e.target.value)}
                />
              </div>
              {editingGrade.grade.justification && (
                <div className="p-3 bg-muted/40 rounded-lg text-xs space-y-1">
                  <p className="font-semibold text-muted-foreground">Original AI Justification:</p>
                  <p>{editingGrade.grade.justification}</p>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditingGrade(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveOverrideClick}>Save Override</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
