import { useCallback, useEffect, useRef, useState } from "react";
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
  pushGradesToClassroom,
  
} from "@/lib/ipc";
import { useToast, friendlyError } from "@/components/ui/toaster";
import type { GradebookView, Grade, GradebookRow, GradingProgressPayload } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ChevronRight, RefreshCw, Loader2, AlertTriangle, Shield, Brain, FileSpreadsheet, Plus, UploadCloud } from "lucide-react";

import { GradingProgressBar } from "@/components/gradebook/GradingProgressBar";
import { GradebookTable } from "@/components/gradebook/GradebookTable";
import { GradeOverrideDialog } from "@/components/gradebook/GradeOverrideDialog";
import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";
import { useUndoStack } from "@/lib/useUndoStack";
import { motion } from "framer-motion";

type GradeOverrideAction = {
  gradeId: string;
  previousScore: number | null;
  previousFeedback: string | null;
  newScore: number;
};

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
  const [pushingToClassroom, setPushingToClassroom] = useState(false);
  const [confirmPush, setConfirmPush] = useState(false);
  const { push, undo } = useUndoStack<GradeOverrideAction>();

  const gradingUnlistenRef = useRef<(() => void) | null>(null);

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
    let mounted = true;
    listen<GradingProgressPayload>("grading-progress", (event) => {
      if (mounted) setProgress(event.payload);
    }).then((unlisten) => {
      gradingUnlistenRef.current = unlisten;
    });
    return () => {
      mounted = false;
      if (gradingUnlistenRef.current) {
        gradingUnlistenRef.current();
        gradingUnlistenRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
        
        const action = undo();
        if (action) {
          try {
            await updateGradeOverride({ 
              grade_id: action.gradeId, 
              teacher_score: action.previousScore ?? 0, 
              teacher_feedback: action.previousFeedback ?? undefined 
            });
            await fetchGradebook();
            toast("Override undone", "success");
          } catch (err) {
            console.error(err);
            toast("Failed to undo override: " + friendlyError(err), "error");
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, fetchGradebook, toast]);

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

      if (result.graded.length > 0) {
        try {
          const path = await exportGradebook({ assignmentId, courseId, courseWorkId });
          toast(`Gradebook auto-exported:\n${path}`, "success");
        } catch (exportErr: unknown) {
          console.error(exportErr);
          toast("Grading done, but auto-export failed. Use Export Gradebook.", "error");
        }
      }
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
      if (!savePath) return;

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

  const handlePushToClassroom = async () => {
    if (!assignmentId || !courseId || !courseWorkId) return;
    setConfirmPush(false);
    
    try {
      setPushingToClassroom(true);
      const pushedCount = await pushGradesToClassroom(assignmentId, courseId, courseWorkId);
      toast(`Successfully pushed ${pushedCount} grades to Classroom`, "success");
    } catch (err: unknown) {
      console.error(err);
      toast("Failed to push grades: " + friendlyError(err), "error");
    } finally {
      setPushingToClassroom(false);
    }
  };

  

  const handleEditGrade = useCallback((grade: Grade, row: GradebookRow) => {
    setOverrideScore(grade.score?.toString() ?? "");
    setOverrideFeedback(grade.feedback ?? "");
    setEditingGrade({ grade, row });
  }, []);

  const handleSaveOverride = async (gradeId: string, teacherScore: number, teacherFeedback?: string) => {
    try {
      const previousScore = editingGrade?.grade.score ?? null;
      const previousFeedback = editingGrade?.grade.feedback ?? null;

      await updateGradeOverride({ grade_id: gradeId, teacher_score: teacherScore, teacher_feedback: teacherFeedback });
      
      push({
        gradeId,
        previousScore,
        previousFeedback,
        newScore: teacherScore
      });

      setEditingGrade(null);
      await fetchGradebook();
      toast("Grade override saved", "success");
    } catch (err: unknown) {
      console.error(err);
      toast("Failed to save override: " + friendlyError(err), "error");
    }
  };

  const handleApproveGrade = useCallback(
    async (gradeId: string, approved: boolean) => {
      try {
        await approveGrade(gradeId, approved);
        await fetchGradebook();
        toast(approved ? "Grade approved" : "Approval removed", "success");
      } catch (err: unknown) {
        console.error(err);
        toast("Failed to update approval: " + friendlyError(err), "error");
      }
    },
    [fetchGradebook, toast]
  );

  useKeyboardShortcuts({
    "Cmd+S": (e) => {
      e.preventDefault();
      handleExport();
    },
    "Cmd+Shift+A": (e) => {
      e.preventDefault();
      handleApproveAll();
    },
    "Cmd+Enter": (e) => {
      if (editingGrade) {
        e.preventDefault();
        const score = parseFloat(overrideScore);
        if (isNaN(score) || score < 0) {
          toast("Please enter a valid score.", "error");
          return;
        }
        handleSaveOverride(editingGrade.grade.id, score, overrideFeedback.trim() || undefined);
      }
    },
    "Escape": (e) => {
      if (editingGrade) {
        e.preventDefault();
        setEditingGrade(null);
      }
    },
  });

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
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="p-8 max-w-7xl mx-auto space-y-6"
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
              <Link to={`/courses/${courseId}/assignments/${courseWorkId}`} className="hover:text-foreground transition-colors whitespace-nowrap">
                Submissions
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{gradebook.assignment_title}</h1>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={fetchGradebook} disabled={loading} variant="ghost" className="gap-2">
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
              {approvingAll ? "Approving..." : `Approve All (${suggestedCount})`}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleExport} disabled={loading || exporting} variant="outline" size="sm" className="gap-2">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              {exporting ? "Exporting..." : "Export"}
            </Button>
            <Button onClick={() => setConfirmPush(true)} disabled={loading || pushingToClassroom || approvedCount === 0} variant="outline" size="sm" className="gap-2">
              {pushingToClassroom ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {pushingToClassroom ? "Pushing..." : "Push to Classroom"}
            </Button>
          </div>
        </div>
      </div>

      {gradingAll && progress && <GradingProgressBar progress={progress} />}

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
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{gradedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">AI Suggested</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{suggestedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{approvedCount}</div>
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
                <div key={criterion.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
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
          <GradebookTable gradebook={gradebook} onEditGrade={handleEditGrade} onApproveGrade={handleApproveGrade} />
        </CardContent>
      </Card>

      <GradeOverrideDialog
        editingGrade={editingGrade}
        gradebook={gradebook}
        overrideScore={overrideScore}
        setOverrideScore={setOverrideScore}
        overrideFeedback={overrideFeedback}
        setOverrideFeedback={setOverrideFeedback}
        onClose={() => setEditingGrade(null)}
        onSave={handleSaveOverride}
      />

      <Dialog open={confirmPush} onOpenChange={setConfirmPush}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Push Grades to Classroom</DialogTitle>
            <DialogDescription>
              Are you sure you want to push all approved grades to Google Classroom?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPush(false)}>
              Cancel
            </Button>
            <Button onClick={handlePushToClassroom}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


    </motion.div>
  );
}
