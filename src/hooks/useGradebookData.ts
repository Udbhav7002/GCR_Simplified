import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGradebook,
  updateGradeOverride,
  approveGrade,
  approveAllGrades,
  createRubricCriterion,
  deleteRubricCriterion,
} from "@/lib/ipc";
import { useToast, friendlyError } from "@/components/ui/toaster";
import type { GradebookView } from "@/lib/types";

export function useGradebookQuery(assignmentId?: string) {
  return useQuery<GradebookView, Error>({
    queryKey: ["gradebook", assignmentId],
    queryFn: async () => {
      if (!assignmentId) throw new Error("No assignment ID");
      return getGradebook(assignmentId);
    },
    enabled: !!assignmentId,
  });
}

export function useRubricMutations(assignmentId?: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const addCriterion = useMutation({
    mutationFn: (data: { name: string; maxMarks: number; sortOrder: number }) =>
      createRubricCriterion({
        assignmentId: assignmentId!,
        ...data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gradebook", assignmentId] });
      toast("Rubric criterion added", "success");
    },
    onError: (err) => toast("Failed to add criterion: " + friendlyError(err), "error"),
  });

  const deleteCriterion = useMutation({
    mutationFn: (id: string) => deleteRubricCriterion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gradebook", assignmentId] });
      toast("Criterion removed", "success");
    },
    onError: (err) => toast("Failed to remove criterion: " + friendlyError(err), "error"),
  });

  return { addCriterion, deleteCriterion };
}

export function useGradebookMutations(assignmentId?: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const updateOverride = useMutation({
    mutationFn: (data: { grade_id: string; teacher_score: number; teacher_feedback?: string }) =>
      updateGradeOverride(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gradebook", assignmentId] });
    },
    onError: (err) => toast("Failed to update grade: " + friendlyError(err), "error"),
  });

  const approveSingleGrade = useMutation({
    mutationFn: (gradeId: string) => approveGrade(gradeId, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gradebook", assignmentId] });
      toast("Grade approved", "success");
    },
    onError: (err) => toast("Failed to approve grade: " + friendlyError(err), "error"),
  });

  const approveAll = useMutation({
    mutationFn: () => approveAllGrades(assignmentId!),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["gradebook", assignmentId] });
      toast(`Approved ${count} suggested grades`, "success");
    },
    onError: (err) => toast("Failed to approve grades: " + friendlyError(err), "error"),
  });

  return { updateOverride, approveSingleGrade, approveAll };
}
