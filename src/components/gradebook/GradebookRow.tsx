import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit2 } from "lucide-react";
import type { GradebookView, Grade, GradebookRow as GradebookRowType } from "@/lib/types";

const getStatusBadge = (status: string) => {
  switch (status) {
    case "graded":
      return (
        <Badge variant="default" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
          Graded
        </Badge>
      );
    case "ungraded":
      return (
        <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20">
          Ungraded
        </Badge>
      );
    case "reviewed":
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">
          Reviewed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

interface GradebookRowProps {
  row: GradebookRowType;
  rubric: GradebookView["rubric"];
  onEditGrade: (grade: Grade, row: GradebookRowType) => void;
  onApproveGrade: (gradeId: string, approved: boolean) => void;
}

const MotionTableRow = motion.tr;

export const GradebookRow = memo(function GradebookRow({
  row,
  rubric,
  onEditGrade,
  onApproveGrade,
}: GradebookRowProps) {
  const rowTotal = row.grades.reduce((sum, g) => sum + (g.score ?? 0), 0);
  const maxTotal = rubric.reduce((sum, c) => sum + c.max_marks, 0);

  const approvedCount = row.grades.filter((g) => g.approved).length;
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    setHighlight(true);
    const timer = setTimeout(() => setHighlight(false), 800);
    return () => clearTimeout(timer);
  }, [approvedCount]);

  return (
    <MotionTableRow
      initial={false}
      animate={{ backgroundColor: highlight ? "rgba(34, 197, 94, 0.15)" : "transparent" }}
      transition={{ duration: 0.4 }}
      className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
    >
      <TableCell>
        <div>
          <p className="font-medium text-sm">{row.student_name}</p>
          {row.student_email && <p className="text-xs text-muted-foreground">{row.student_email}</p>}
          {(row.file_reg_no || row.file_name_hint) && (
            <p className="text-xs text-muted-foreground italic" title="Identity parsed from the uploaded filename">
              file: {row.file_name_hint ?? "?"}
              {row.file_reg_no ? ` · ${row.file_reg_no}` : ""}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {getStatusBadge(row.grading_status)}
          {row.grading_status === "graded" && row.graded_via === "vision" && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-purple-500/40 text-purple-600 dark:text-purple-400 bg-purple-500/5"
              title="Graded from handwritten/scanned files via Gemini vision"
            >
              Handwritten
            </Badge>
          )}
        </div>
      </TableCell>
      {rubric.map((c) => {
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
                      ? "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/5"
                      : grade.approved
                        ? "border-green-500/40 text-green-600 dark:text-green-400 bg-green-500/5"
                        : "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                  }`}
                >
                  {grade.graded_by === "teacher" ? "Teacher" : grade.approved ? "Approved" : "AI"}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  aria-label={`Edit grade for ${row.student_name} – ${c.name}`}
                  onClick={() => onEditGrade(grade, row)}
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
              row.grades.filter((g) => !g.approved).forEach((g) => onApproveGrade(g.id, true));
            }}
          >
            Approve
          </Button>
        )}
      </TableCell>
    </MotionTableRow>
  );
});
