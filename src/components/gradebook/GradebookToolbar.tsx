import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, FileSpreadsheet, Brain, Shield } from "lucide-react";
import { useToast, friendlyError } from "@/components/ui/toaster";
import { useGradebookMutations } from "@/hooks/useGradebookData";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  downloadAllSubmissions,
  extractAllSubmissions,
  gradeAllAssignment,
  exportGradebook,
} from "@/lib/ipc";
import type { GradebookView, GradingProgressPayload } from "@/lib/types";

interface GradebookToolbarProps {
  assignmentId: string;
  courseId?: string;
  courseWorkId?: string;
  gradebook: GradebookView;
  setProgress: (p: GradingProgressPayload | null) => void;
  isRefetching: boolean;
  onRefresh: () => void;
}

export function GradebookToolbar({
  assignmentId,
  courseId,
  courseWorkId,
  gradebook,
  setProgress,
  isRefetching,
  onRefresh,
}: GradebookToolbarProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { approveAll } = useGradebookMutations(assignmentId);
  const suggestedCount = gradebook.rows.reduce((acc, r) => acc + r.grades.filter(g => g.graded_by === "ai" && !g.approved).length, 0);
  const [gradingAll, setGradingAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  
  const gradingUnlistenRef = useRef<(() => void) | null>(null);

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
  }, [setProgress]);

  const handleGradeAll = async () => {
    if (!courseId || !courseWorkId) return;
    try {
      setGradingAll(true);
      setProgress(null);
      
      toast("Downloading and extracting latest student files...", "info");
      await downloadAllSubmissions(courseId, courseWorkId);
      await extractAllSubmissions(courseId, courseWorkId);

      const result = await gradeAllAssignment(assignmentId);
      if (result.failed > 0) {
        toast(`AI grading finished: ${result.graded.length} graded, ${result.failed} failed.\n${result.failed_names.slice(0, 3).join("\n")}`, "error");
      } else {
        toast(`AI grading complete for ${result.graded.length} submissions`, "success");
      }
      queryClient.invalidateQueries({ queryKey: ["gradebook", assignmentId] });

      if (result.graded.length > 0) {
        try {
          const path = await exportGradebook({ assignmentId, courseId, courseWorkId });
          toast(`Gradebook auto-exported:\n${path}`, "success");
        } catch {
          toast("Grading done, but auto-export failed. Use Export Gradebook.", "error");
        }
      }
    } catch (err: unknown) {
      toast("AI grading finished: " + friendlyError(err), "info");
      queryClient.invalidateQueries({ queryKey: ["gradebook", assignmentId] });
    } finally {
      setGradingAll(false);
      setProgress(null);
    }
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      const path = await exportGradebook({ assignmentId, courseId, courseWorkId });
      toast(`Gradebook exported:\n${path}`, "success");
    } catch (err: unknown) {
      toast("Export failed: " + friendlyError(err), "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onRefresh} 
        disabled={isRefetching}
        className="text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
        Refresh
      </Button>
      
      <Button
        variant="default"
        size="sm"
        onClick={handleGradeAll}
        disabled={gradingAll || gradebook.rows.length === 0}
        className="bg-blue-600 hover:bg-blue-700 text-white"
      >
        <Brain className={`w-4 h-4 mr-2 ${gradingAll ? "animate-pulse text-blue-200" : ""}`} />
        {gradingAll ? "Grading..." : "Grade All"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => approveAll.mutate()}
        disabled={approveAll.isPending || suggestedCount === 0}
      >
        <Shield className="w-4 h-4 mr-2 text-green-600" />
        Approve All ({suggestedCount})
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={exporting}
      >
        <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" />
        Export
      </Button>
    </div>
  );
}
