import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";

import { useGradebookQuery, useGradebookMutations } from "@/hooks/useGradebookData";
import { GradebookToolbar } from "@/components/gradebook/GradebookToolbar";
import { RubricEditor } from "@/components/gradebook/RubricEditor";
import { GradingProgressBar } from "@/components/gradebook/GradingProgressBar";
import { GradebookTable } from "@/components/gradebook/GradebookTable";
import { GradeOverrideDialog } from "@/components/gradebook/GradeOverrideDialog";
import { useUndoStack } from "@/lib/useUndoStack";
import type { Grade, GradebookRow, GradingProgressPayload } from "@/lib/types";

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

  const { data: gradebook, isLoading, error, refetch, isRefetching } = useGradebookQuery(assignmentId);
  const { updateOverride, approveSingleGrade } = useGradebookMutations(assignmentId);

  const [progress, setProgress] = useState<GradingProgressPayload | null>(null);
  const [editingGrade, setEditingGrade] = useState<{ grade: Grade; row: GradebookRow } | null>(null);
  const [overrideScore, setOverrideScore] = useState("");
  const [overrideFeedback, setOverrideFeedback] = useState("");

  const { push, undo } = useUndoStack<GradeOverrideAction>();

  // Global Ctrl+Z / Cmd+Z for undoing overrides
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();

        const action = undo();
        if (action) {
          updateOverride.mutate(
            {
              grade_id: action.gradeId,
              teacher_score: action.previousScore ?? 0,
              teacher_feedback: action.previousFeedback || undefined,
            },
            {
              onSuccess: () => toast("Override undone", "success"),
            }
          );
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, updateOverride, toast]);

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto text-center mt-20">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Error Loading Gradebook</h2>
        <p className="text-muted-foreground mb-6">{error.message}</p>
        <Button onClick={() => refetch()}>Try Again</Button>
      </div>
    );
  }

  if (isLoading || !gradebook) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const totalStudents = gradebook.rows.length;
  const gradedCount = gradebook.rows.filter((r) => r.grades.length > 0).length;
  const suggestedCount = gradebook.rows.reduce(
    (acc, r) => acc + r.grades.filter((g) => g.graded_by === "ai" && !g.approved).length,
    0
  );
  const approvedCount = gradebook.rows.reduce((acc, r) => acc + r.grades.filter((g) => g.approved).length, 0);

  const handleEditGrade = (row: GradebookRow, grade: Grade) => {
    setEditingGrade({ row, grade });
    setOverrideScore(grade.score?.toString() ?? "");
    setOverrideFeedback(grade.feedback ?? "");
  };

  const handleSaveOverride = async () => {
    if (!editingGrade) return;
    const score = parseFloat(overrideScore);
    if (isNaN(score) || score < 0) {
      toast("Please enter a valid positive number for the score.", "error");
      return;
    }

    push({
      gradeId: editingGrade.grade.id,
      previousScore: editingGrade.grade.score,
      previousFeedback: editingGrade.grade.feedback,
      newScore: score,
    });

    updateOverride.mutate(
      {
        grade_id: editingGrade.grade.id,
        teacher_score: score,
        teacher_feedback: overrideFeedback,
      },
      {
        onSuccess: () => {
          setEditingGrade(null);
          toast("Grade updated", "success");
        },
      }
    );
  };

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
                className="hover:text-foreground transition-colors whitespace-nowrap"
              >
                Submissions
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{gradebook.assignment_title}</h1>
          </div>
        </div>

        <GradebookToolbar
          assignmentId={assignmentId!}
          courseId={courseId}
          courseWorkId={courseWorkId}
          gradebook={gradebook}
          setProgress={setProgress}
          isRefetching={isRefetching}
          onRefresh={() => refetch()}
        />
      </div>

      {progress && <GradingProgressBar progress={progress} />}

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

      <RubricEditor assignmentId={assignmentId} rubric={gradebook.rubric} />

      <Card>
        <CardHeader>
          <CardTitle>Submissions Gradebook</CardTitle>
        </CardHeader>
        <CardContent>
          <GradebookTable
            gradebook={gradebook}
            onEditGrade={(grade, row) => handleEditGrade(row, grade)}
            onApproveGrade={(gradeId) => approveSingleGrade.mutate(gradeId)}
          />
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
    </motion.div>
  );
}
