import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GradebookRow } from "./GradebookRow";
import type { GradebookView, Grade, GradebookRow as GradebookRowType } from "@/lib/types";

interface GradebookTableProps {
  gradebook: GradebookView;
  onEditGrade: (grade: Grade, row: GradebookRowType) => void;
  onApproveGrade: (gradeId: string, approved: boolean) => void;
}

export function GradebookTable({ gradebook, onEditGrade, onApproveGrade }: GradebookTableProps) {
  return (
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
        {gradebook.rows.map((row) => (
          <GradebookRow
            key={row.submission_id}
            row={row}
            rubric={gradebook.rubric}
            onEditGrade={onEditGrade}
            onApproveGrade={onApproveGrade}
          />
        ))}
      </TableBody>
    </Table>
  );
}
