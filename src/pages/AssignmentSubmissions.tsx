import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  listGoogleSubmissions,
  downloadSubmissionFile,
  downloadAllSubmissions,
  extractAllSubmissions,
  cancelActiveTasks,
} from "@/lib/ipc";
import { useToast, friendlyError } from "@/components/ui/toaster";
import type { GoogleSubmission, GoogleAttachment, ExtractionResult, DownloadProgress } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, Download, RefreshCw, FileText, Loader2, Shield, Users } from "lucide-react";
import { SubmissionTable } from "@/components/submissions/SubmissionTable";
import { TextPreviewDialog } from "@/components/submissions/TextPreviewDialog";
import { DownloadProgressBar } from "@/components/submissions/DownloadProgressBar";
import { motion } from "framer-motion";

export function AssignmentSubmissions() {
  const { courseId, courseWorkId } = useParams<{ courseId: string; courseWorkId: string }>();
  const toast = useToast();
  const [submissions, setSubmissions] = useState<GoogleSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingItems, setDownloadingItems] = useState<Record<string, "downloading" | "success" | "error">>({});
  const [extractionResults, setExtractionResults] = useState<Record<string, ExtractionResult>>({});
  const [extractingAll, setExtractingAll] = useState(false);
  const [viewingText, setViewingText] = useState<{ studentName: string; text: string; method: string } | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<DownloadProgress | null>(null);

  const downloadUnlistenRef = useRef<(() => void) | null>(null);
  const extractionUnlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;
    listen<DownloadProgress>("download-progress", (event) => {
      if (mounted) setDownloadProgress(event.payload);
    }).then((unlisten) => {
      downloadUnlistenRef.current = unlisten;
    });
    return () => {
      mounted = false;
      if (downloadUnlistenRef.current) {
        downloadUnlistenRef.current();
        downloadUnlistenRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    listen<DownloadProgress>("extraction-progress", (event) => {
      if (mounted) setExtractionProgress(event.payload);
    }).then((unlisten) => {
      extractionUnlistenRef.current = unlisten;
    });
    return () => {
      mounted = false;
      if (extractionUnlistenRef.current) {
        extractionUnlistenRef.current();
        extractionUnlistenRef.current = null;
      }
    };
  }, []);

  const fetchSubmissions = useCallback(
    async (force?: boolean) => {
      if (!courseId || !courseWorkId) return;
      try {
        setLoading(true);
        setError(null);
        const data = await listGoogleSubmissions(courseId, courseWorkId, force);
        setSubmissions(data);
      } catch (err: unknown) {
        console.error(err);
        setError(friendlyError(err));
      } finally {
        setLoading(false);
      }
    },
    [courseId, courseWorkId]
  );

  useEffect(() => {
    fetchSubmissions(false);
  }, [fetchSubmissions]);

  const extractionByStudent = useMemo(() => {
    const map: Record<string, ExtractionResult> = {};
    for (const result of Object.values(extractionResults)) {
      const segments = result.file_path.replace(/\\/g, "/").split("/");
      const studentId = segments.length >= 2 ? segments[segments.length - 2] : null;
      if (!studentId) continue;
      const existing = map[studentId];
      if (!existing || existing.char_count < result.char_count) {
        map[studentId] = result;
      }
    }
    return map;
  }, [extractionResults]);

  const handleDownload = useCallback(
    async (sub: GoogleSubmission, att: GoogleAttachment) => {
      if (!courseId || !courseWorkId || !att.drive_file_id || !att.drive_file_title) return;

      const downloadKey = `${sub.id}-${att.drive_file_id}`;
      setDownloadingItems((prev) => ({ ...prev, [downloadKey]: "downloading" }));

      try {
        const result = await downloadSubmissionFile({
          fileId: att.drive_file_id,
          fileName: att.drive_file_title,
          courseId,
          courseWorkId,
          studentId: sub.user_id,
        });

        if (result.success) {
          setDownloadingItems((prev) => ({ ...prev, [downloadKey]: "success" }));
        } else {
          console.error("Download failed:", result.error);
          setDownloadingItems((prev) => ({ ...prev, [downloadKey]: "error" }));
        }
      } catch (err) {
        console.error("Download error:", err);
        setDownloadingItems((prev) => ({ ...prev, [downloadKey]: "error" }));
      }
    },
    [courseId, courseWorkId]
  );

  const applyExtractionResults = (results: ExtractionResult[]) => {
    const resultMap: Record<string, ExtractionResult> = {};
    for (const r of results) {
      resultMap[r.file_path] = r;
    }
    setExtractionResults(resultMap);
    const skippedCount = results.filter((r) => r.extraction_method === "skipped").length;
    const failedCount = results.filter((r) => !r.success && r.extraction_method !== "skipped").length;
    const okCount = results.filter((r) => r.success).length;

    if (skippedCount > 0) {
      toast(`Ready: extracted ${okCount} file(s) (${skippedCount} scanned/photos left for AI grading)`, "success");
    } else if (failedCount > 0) {
      toast(`Extracted ${okCount} file(s), ${failedCount} failed`, "error");
    } else if (results.length > 0) {
      toast(`Ready — ${results.length} file(s) downloaded and extracted`, "success");
    } else {
      toast("No new files to extract", "success");
    }
  };

  const handlePrepareAll = async () => {
    if (!courseId || !courseWorkId) return;
    setDownloadingAll(true);
    setDownloadProgress(null);
    try {
      const results = await downloadAllSubmissions(courseId, courseWorkId);
      const failed = results.filter((r) => !r.success).length;
      const succeeded = results.length - failed;
      if (failed > 0 && succeeded === 0) {
        toast(`Download failed for ${failed} file(s)`, "error");
        return;
      }
      if (failed > 0) {
        toast(`Downloaded ${succeeded}, ${failed} failed — extracting what we have`, "info");
      }
      setDownloadingAll(false);
      setDownloadProgress(null);
      setExtractingAll(true);
      setExtractionProgress(null);
      const extracted = await extractAllSubmissions(courseId, courseWorkId);
      applyExtractionResults(extracted);
    } catch (err: unknown) {
      console.error(err);
      toast("Prepare finished: " + friendlyError(err), "info");
    } finally {
      setDownloadingAll(false);
      setExtractingAll(false);
      setDownloadProgress(null);
      setExtractionProgress(null);
    }
  };

  const handleCancelTask = async () => {
    try {
      await cancelActiveTasks();
      toast("Cancelling active background task...", "info");
    } catch (err: unknown) {
      console.error(err);
    }
  };

  const handleViewText = useCallback((studentName: string, result: ExtractionResult) => {
    setViewingText({
      studentName,
      text: result.extracted_text,
      method: result.extraction_method,
    });
  }, []);

  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <h3 className="text-lg font-medium text-destructive">Error Loading Submissions</h3>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={() => fetchSubmissions(true)} variant="outline">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const total = submissions.length;
  const turnedIn = submissions.filter((s) => s.state === "TURNED_IN").length;
  const late = submissions.filter((s) => s.late).length;
  const graded = submissions.filter((s) => s.assigned_grade !== undefined).length;
  const assignmentId = courseWorkId || "";

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="p-8 max-w-7xl mx-auto space-y-6"
    >
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-4 pt-8 -mt-8 -mx-8 px-8 border-b mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            render={<Link to={`/courses/${courseId}`} />}
            variant="ghost"
            size="icon"
            className="mt-1 shrink-0"
            title="Back to Course Details"
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
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Submissions</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => fetchSubmissions(true)} disabled={loading} variant="ghost" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Sync
          </Button>

          {downloadingAll || extractingAll ? (
            <Button onClick={handleCancelTask} variant="destructive" className="gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cancel
            </Button>
          ) : (
            <Button onClick={handlePrepareAll} disabled={loading || turnedIn === 0} className="gap-2">
              <Download className="w-4 h-4" />
              Download & extract
            </Button>
          )}

          <Button
            id="tour-plagiarism-btn"
            variant="outline"
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}/plagiarism`} />}
            className="gap-2"
          >
            <Shield className="w-4 h-4" />
            Check Plagiarism
          </Button>

          <Button
            id="tour-gradebook-btn"
            variant="outline"
            render={
              <Link to={`/assignments/${assignmentId}/gradebook?courseId=${courseId}&courseWorkId=${courseWorkId}`} />
            }
            className="gap-2"
          >
            <FileText className="w-4 h-4" />
            Gradebook
          </Button>

          <Button
            variant="ghost"
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}/missing`} />}
            className="gap-2 text-muted-foreground"
          >
            <Users className="w-4 h-4" />
            Missing
          </Button>
        </div>
      </div>

      <DownloadProgressBar label="Downloading" progress={downloadProgress} active={downloadingAll} />

      <DownloadProgressBar label="Extracting text" progress={extractionProgress} active={extractingAll} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-muted-foreground">Total Students</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{turnedIn}</div>
            <p className="text-xs text-muted-foreground">Turned In</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{late}</div>
            <p className="text-xs text-muted-foreground">Late Submissions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{graded}</div>
            <p className="text-xs text-muted-foreground">Graded</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <SubmissionTable
          loading={loading}
          submissions={submissions}
          downloadingItems={downloadingItems}
          extractionByStudent={extractionByStudent}
          onDownload={handleDownload}
          onViewText={handleViewText}
        />
      </Card>

      <TextPreviewDialog viewingText={viewingText} onClose={() => setViewingText(null)} />
    </motion.div>
  );
}
