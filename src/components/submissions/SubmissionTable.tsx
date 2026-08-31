import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubmissionRow } from "./SubmissionRow";
import type { GoogleSubmission, GoogleAttachment, ExtractionResult } from "@/lib/types";
import { FileText } from "lucide-react";

export interface SubmissionTableProps {
  loading: boolean;
  submissions: GoogleSubmission[];
  downloadingItems: Record<string, "downloading" | "success" | "error">;
  extractionByStudent: Record<string, ExtractionResult>;
  onDownload: (sub: GoogleSubmission, att: GoogleAttachment) => void;
  onViewText: (studentName: string, result: ExtractionResult) => void;
}

export function SubmissionTable({
  loading,
  submissions,
  downloadingItems,
  extractionByStudent,
  onDownload,
  onViewText,
}: SubmissionTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Grade</TableHead>
          <TableHead>Extracted</TableHead>
          <TableHead>Attachments</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={`skeleton-${i}`} className="animate-pulse">
              <TableCell>
                <div className="h-4 bg-muted rounded w-24"></div>
              </TableCell>
              <TableCell>
                <div className="h-4 bg-muted rounded w-16"></div>
              </TableCell>
              <TableCell>
                <div className="h-4 bg-muted rounded w-12"></div>
              </TableCell>
              <TableCell>
                <div className="h-4 bg-muted rounded w-16"></div>
              </TableCell>
              <TableCell>
                <div className="h-4 bg-muted rounded w-32"></div>
              </TableCell>
              <TableCell className="text-right">
                <div className="h-8 bg-muted rounded w-8 ml-auto"></div>
              </TableCell>
            </TableRow>
          ))
        ) : submissions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="h-48 text-center">
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-lg font-medium">No submissions found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    There are no student submissions for this assignment yet.
                  </p>
                </div>
              </div>
            </TableCell>
          </TableRow>
        ) : (
          submissions.map((sub) => (
            <SubmissionRow
              key={sub.id}
              sub={sub}
              downloadingItems={downloadingItems}
              extractionResult={extractionByStudent[sub.user_id]}
              onDownload={onDownload}
              onViewText={onViewText}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}
