import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Grade, GradebookRow, GradebookView } from "@/lib/types";
import { useToast } from "@/components/ui/toaster";

interface GradeOverrideDialogProps {
  editingGrade: { grade: Grade; row: GradebookRow } | null;
  gradebook: GradebookView | null;
  overrideScore: string;
  setOverrideScore: (score: string) => void;
  overrideFeedback: string;
  setOverrideFeedback: (feedback: string) => void;
  onClose: () => void;
  onSave: (gradeId: string, score: number, feedback?: string) => void;
}

export function GradeOverrideDialog({
  editingGrade,
  gradebook,
  overrideScore,
  setOverrideScore,
  overrideFeedback,
  setOverrideFeedback,
  onClose,
  onSave,
}: GradeOverrideDialogProps) {
  const toast = useToast();

  const handleSaveOverrideClick = () => {
    if (!editingGrade) return;
    const score = parseFloat(overrideScore);
    if (isNaN(score) || score < 0) {
      toast("Please enter a valid score.", "error");
      return;
    }
    onSave(editingGrade.grade.id, score, overrideFeedback.trim() || undefined);
  };

  return (
    <Dialog open={Boolean(editingGrade)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Grade Override</DialogTitle>
        </DialogHeader>
        {editingGrade && gradebook && (
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium">{editingGrade.row.student_name}</p>
              <p className="text-xs text-muted-foreground">
                Criterion: {gradebook.rubric.find((r) => r.id === editingGrade.grade.criterion_id)?.name || "Criterion"}{" "}
                (Max: {gradebook.rubric.find((r) => r.id === editingGrade.grade.criterion_id)?.max_marks})
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="override-score" className="text-sm font-medium">
                Score
              </label>
              <Input
                id="override-score"
                type="number"
                step="0.5"
                min="0"
                max={gradebook.rubric.find((r) => r.id === editingGrade.grade.criterion_id)?.max_marks}
                value={overrideScore}
                onChange={(e) => setOverrideScore(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="override-feedback" className="text-sm font-medium">
                Teacher Feedback
              </label>
              <Input
                id="override-feedback"
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
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSaveOverrideClick}>Save Override</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
