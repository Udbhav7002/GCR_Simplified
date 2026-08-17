import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { save } from "@tauri-apps/plugin-dialog";
import {
  getGradebook,
  gradeAllAssignment,
  updateGradeOverride,
  approveGrade,
  approveAllGrades,
  exportGradebook,
  createRubricCriterion,
  deleteRubricCriterion,
} from "@/lib/ipc";
import { useToast, friendlyError } from "@/components/ui/toaster";
import type { GradebookView, Grade, GradebookRow } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ChevronRight,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Edit2,
  Check,
  Shield,
  Brain,
  Sparkles,
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
    } catch (err: any) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    fetchGradebook();
  }, [fetchGradebook]);

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
    } catch (err: any) {
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
    } catch (err: any) {
      console.error(err);
      toast("Failed to remove criterion: " + friendlyError(err), "error");
    }
  };

  const handleGradeAll = async () => {
    if (!assignmentId) return;
    try {
      setGradingAll(true);
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
    } catch (err: any) {
      console.error(err);
      toast("AI grading failed: " + friendlyError(err), "error");
    } finally {
      setGradingAll(false);
    }
  };

  const handleApproveAll = async () => {
    if (!assignmentId) return;
    try {
      setApprovingAll(true);
      const count = await approveAllGrades(assignmentId);
      toast(`Approved ${count} AI-suggested grades`, "success");
      await fetchGradebook();
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
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
          <Button
            onClick={handleGradeAll}
            disabled={loading || gradingAll || gradedCount === totalStudents}
            variant="outline"
            className="gap-2"
          >
            {gradingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            {gradingAll ? "Grading..." : "Grade All (AI)"}
          </Button>
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
              No rubric criteria defined yet. Add criteria below, then run AI grading.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Criterion</TableHead>
                    <TableHead className="text-right">Max Marks</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gradebook.rubric.map((criterion) => (
                    <TableRow key={criterion.id}>
                      <TableCell className="font-medium">{criterion.name}</TableCell>
                      <TableCell className="text-right font-mono">{criterion.max_marks}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{criterion.description || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteCriterion(criterion.id, criterion.name)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3 pt-2 border-t">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Criterion name</label>
              <Input
                className="w-64"
                placeholder="e.g. Thesis Clarity"
                value={newCriterionName}
                onChange={(e) => setNewCriterionName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Max marks</label>
              <Input
                className="w-24"
                type="number"
                min="1"
                step="0.5"
                value={newCriterionMax}
                onChange={(e) => setNewCriterionMax(e.target.value)}
              />
            </div>
            <Button onClick={handleAddCriterion} disabled={savingCriterion} className="gap-2">
              {savingCriterion ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Criterion
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Student Grades</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  {gradebook.rubric.map((criterion) => (
                    <TableHead key={criterion.id} className="text-center min-w-[100px]">
                      <div className="font-medium">{criterion.name}</div>
                      <div className="text-xs text-muted-foreground">/ {criterion.max_marks}</div>
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gradebook.rows.map((row) => (
                  <TableRow key={row.submission_id}>
                    <TableCell>
                      <div className="font-medium">{row.student_name}</div>
                      <div className="text-sm text-muted-foreground">{row.student_email || "No email"}</div>
                    </TableCell>
                    <TableCell>{getStatusBadge(row.grading_status)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {row.ai_total_score !== null ? row.ai_total_score.toFixed(1) : "-"}
                    </TableCell>
                    {gradebook.rubric.map((criterion) => {
                      const grade = row.grades.find((g) => g.criterion_id === criterion.id);
                      if (!grade) {
                        return <TableCell className="text-center text-muted-foreground">-</TableCell>;
                      }
                      const isApproved = grade.approved;
                      const isTeacher = grade.graded_by === "teacher";
                      const displayScore = grade.score !== null ? grade.score.toFixed(1) : "-";
                      return (
                        <TableCell key={criterion.id} className="text-center">
                          <div
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded ${
                              isTeacher
                                ? "bg-blue-500/10 text-blue-700"
                                : isApproved
                                  ? "bg-green-500/10 text-green-700"
                                  : "bg-amber-500/10 text-amber-700"
                            }`}
                          >
                            {displayScore}
                            {isTeacher && <Edit2 className="w-3 h-3" />}
                            {!isTeacher && isApproved && <CheckCircle2 className="w-3 h-3" />}
                            {!isTeacher && !isApproved && <Sparkles className="w-3 h-3" />}
                          </div>
                          {grade.justification && (
                            <div
                              className="text-xs text-muted-foreground mt-1 truncate max-w-[100px]"
                              title={grade.justification}
                            >
                              {grade.justification}
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.grades.some((g) => g.graded_by === "ai" && !g.approved) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() =>
                              handleApproveGrade(row.grades.find((g) => g.graded_by === "ai" && !g.approved)!.id, true)
                            }
                          >
                            <Check className="w-3 h-3" /> Approve
                          </Button>
                        )}
                        {row.grades.some((g) => g.graded_by === "ai") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1"
                            onClick={() =>
                              handleEditGrade(
                                row.grades.find((g) => g.graded_by === "ai")!,
                                row
                              )
                            }
                          >
                            <Edit2 className="w-3 h-3" /> Override
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {editingGrade && (
        <Dialog open onOpenChange={(open) => !open && setEditingGrade(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Override Grade for {editingGrade.row.student_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {editingGrade.grade.justification && (
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-sm font-medium text-muted-foreground mb-1">AI Justification:</p>
                  <p className="text-sm">{editingGrade.grade.justification}</p>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Teacher Score (max:{" "}
                  {gradebook.rubric.find((c) => c.id === editingGrade.grade.criterion_id)?.max_marks ?? "N/A"})
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max={gradebook.rubric.find((c) => c.id === editingGrade.grade.criterion_id)?.max_marks ?? 100}
                  value={overrideScore}
                  onChange={(e) => setOverrideScore(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Teacher Feedback (optional)</label>
                <Input
                  type="text"
                  placeholder="Enter feedback..."
                  value={overrideFeedback}
                  onChange={(e) => setOverrideFeedback(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setEditingGrade(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveOverrideClick}>Save Override</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
