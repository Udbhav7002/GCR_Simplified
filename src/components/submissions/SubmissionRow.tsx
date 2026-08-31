import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell } from "@/components/ui/table";
import { Download, FileArchive, Eye, Loader2 } from "lucide-react";
import type { GoogleSubmission, GoogleAttachment, ExtractionResult } from "@/lib/types";

const getStatusBadgeVariant = (state: string): "default" | "secondary" | "outline" | "destructive" => {
  switch (state) {
    case "TURNED_IN":
      return "default";
    case "CREATED":
      return "secondary";
    case "RETURNED":
      return "outline";
    default:
      return "outline";
  }
};

const getStatusLabel = (state: string) => {
  switch (state) {
    case "TURNED_IN":
      return "Turned In";
    case "CREATED":
      return "Not Started";
    case "RETURNED":
      return "Returned";
    case "RECLAIMED_BY_STUDENT":
      return "Reclaimed";
    default:
      return state.replace(/_/g, " ");
  }
};

const getStatusColorClass = (state: string) => {
  switch (state) {
    case "TURNED_IN":
      return "bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/20 border-green-500/20";
    case "CREATED":
      return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/20 border-yellow-500/20";
    case "RETURNED":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 border-blue-500/20";
    default:
      return "";
  }
};

export interface SubmissionRowProps {
  sub: GoogleSubmission;
  downloadingItems: Record<string, "downloading" | "success" | "error">;
  extractionResult: ExtractionResult | undefined;
  onDownload: (sub: GoogleSubmission, att: GoogleAttachment) => void;
  onViewText: (studentName: string, result: ExtractionResult) => void;
}

export const SubmissionRow = memo(function SubmissionRow({
  sub,
  downloadingItems,
  extractionResult,
  onDownload,
  onViewText,
}: SubmissionRowProps) {
  return (
    <TableRow key={sub.id}>
      <TableCell>
        <div className="font-medium">{sub.student_name || "Unknown Student"}</div>
        <div className="text-sm text-muted-foreground">{sub.student_email || "No email"}</div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Badge variant={getStatusBadgeVariant(sub.state)} className={getStatusColorClass(sub.state)}>
            {getStatusLabel(sub.state)}
          </Badge>
          {sub.late && <Badge variant="destructive">Late</Badge>}
        </div>
      </TableCell>
      <TableCell>{sub.assigned_grade !== undefined ? sub.assigned_grade : "-"}</TableCell>
      <TableCell>
        {(() => {
          if (extractionResult) {
            if (extractionResult.extraction_method === "skipped") {
              return (
                <Badge
                  variant="outline"
                  className="border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                >
                  Scanned – skipped
                </Badge>
              );
            }
            if (extractionResult.success) {
              return (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20"
                  >
                    ✓ {extractionResult.char_count} chars
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    aria-label={`View extracted text for ${sub.student_name || "student"}`}
                    onClick={() => onViewText(sub.student_name || "Unknown Student", extractionResult)}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                </div>
              );
            }
            return <Badge variant="destructive">Failed</Badge>;
          }
          return <span className="text-sm text-muted-foreground">Not extracted</span>;
        })()}
      </TableCell>
      <TableCell>
        {sub.attachments.length > 0 ? (
          <span className="text-sm">{sub.attachments.length} file(s)</span>
        ) : (
          <span className="text-sm text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {sub.attachments.map((att, idx) => {
            const downloadKey = `${sub.id}-${att.drive_file_id}`;
            const status = downloadingItems[downloadKey];

            if (!att.drive_file_id) return null;

            return (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                disabled={status === "downloading"}
                onClick={() => onDownload(sub, att)}
                className="gap-1.5"
              >
                {status === "downloading" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : status === "success" ? (
                  <FileArchive className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span className="max-w-[120px] truncate text-xs">{att.drive_file_title || "Download"}</span>
              </Button>
            );
          })}
        </div>
      </TableCell>
    </TableRow>
  );
});
