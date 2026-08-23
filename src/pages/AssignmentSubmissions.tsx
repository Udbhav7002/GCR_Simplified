import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  Download,
  RefreshCw,
  FileArchive,
  FileText,
  Eye,
  Loader2,
  Shield,
  Users,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<DownloadProgress>("download-progress", (event) => {
      setDownloadProgress(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<DownloadProgress>("extraction-progress", (event) => {
      setExtractionProgress(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);
    return () => {
      unlisten?.();
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

  const handleDownload = async (sub: GoogleSubmission, att: GoogleAttachment) => {
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
  };

  const handleDownloadAll = async () => {
    if (!courseId || !courseWorkId) return;
    setDownloadingAll(true);
    setDownloadProgress(null);
    try {
      const results = await downloadAllSubmissions(courseId, courseWorkId);
      const failed = results.filter((r) => !r.success).length;
      const succeeded = results.length - failed;
      if (failed > 0 && succeeded > 0) {
        toast(`Download finished: ${succeeded} succeeded, ${failed} failed`, "error");
      } else if (failed > 0) {
        toast(`Download failed for ${failed} file(s)`, "error");
      } else if (succeeded > 0) {
        toast(`Downloaded ${succeeded} files successfully`, "success");
      }
    } catch (err: unknown) {
      console.error(err);
      toast("Batch download finished: " + friendlyError(err), "info");
    } finally {
      setDownloadingAll(false);
      setDownloadProgress(null);
    }
  };

  const handleExtractAll = async () => {
    if (!courseId || !courseWorkId) return;
    setExtractingAll(true);
    setExtractionProgress(null);
    try {
      const results = await extractAllSubmissions(courseId, courseWorkId);
      const resultMap: Record<string, ExtractionResult> = {};
      for (const r of results) {
        resultMap[r.file_path] = r;
      }
      setExtractionResults(resultMap);
      const skippedCount = results.filter((r) => r.extraction_method === "skipped").length;
      const failedCount = results.filter((r) => !r.success && r.extraction_method !== "skipped").length;
      const okCount = results.filter((r) => r.success).length;

      if (skippedCount > 0) {
        toast(`Extracted ${okCount} file(s) (${skippedCount} non-text/scanned skipped)`, "success");
      } else if (failedCount > 0) {
        toast(`Extracted ${okCount} file(s), ${failedCount} failed`, "error");
      } else if (results.length > 0) {
        toast(`Extracted text from ${results.length} file(s)`, "success");
      } else {
        toast("No new files to extract", "success");
      }
    } catch (err: unknown) {
      console.error("Extraction error:", err);
      toast("Extraction finished: " + friendlyError(err), "info");
    } finally {
      setExtractingAll(false);
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

  const handleViewText = (studentName: string, result: ExtractionResult) => {
    setViewingText({
      studentName,
      text: result.extracted_text,
      method: result.extraction_method,
    });
  };

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
        return "bg-green-500/10 text-green-700 hover:bg-green-500/20 border-green-500/20";
      case "CREATED":
        return "bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20 border-yellow-500/20";
      case "RETURNED":
        return "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 border-blue-500/20";
      default:
        return "";
    }
  };

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
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button render={<Link to="/courses" />} variant="ghost" size="sm" className="text-muted-foreground">
            Courses
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <Button
            render={<Link to={`/courses/${courseId}`} />}
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
          >
            Course
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Submissions</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => fetchSubmissions(true)} disabled={loading} variant="outline" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Sync
          </Button>

          {downloadingAll ? (
            <Button onClick={handleCancelTask} variant="destructive" className="gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cancel Download
            </Button>
          ) : (
            <Button onClick={handleDownloadAll} disabled={loading || turnedIn === 0} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Download All
            </Button>
          )}

          {extractingAll ? (
            <Button onClick={handleCancelTask} variant="destructive" className="gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cancel Extract
            </Button>
          ) : (
            <Button onClick={handleExtractAll} disabled={loading || turnedIn === 0} variant="outline" className="gap-2">
              <FileText className="w-4 h-4" />
              Extract All
            </Button>
          )}

          <Button
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}/plagiarism`} />}
            variant="outline"
            className="gap-2"
          >
            <Shield className="w-4 h-4" />
            Check Plagiarism
          </Button>

          <Button
            render={<Link to={`/assignments/${assignmentId}/gradebook?courseId=${courseId}&courseWorkId=${courseWorkId}`} />}
            className="gap-2"
          >
            <FileText className="w-4 h-4" />
            Gradebook
          </Button>

          <Button
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}/missing`} />}
            variant="ghost"
            className="gap-2 text-muted-foreground"
          >
            <Users className="w-4 h-4" />
            Missing
          </Button>
        </div>
      </div>

      {downloadingAll && downloadProgress && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>Downloading {downloadProgress.completed} of {downloadProgress.total}: {downloadProgress.current}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {Math.round((downloadProgress.completed / Math.max(downloadProgress.total, 1)) * 100)}%
              </span>
            </div>
            <div className="w-full bg-primary/20 h-2 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${Math.round((downloadProgress.completed / Math.max(downloadProgress.total, 1)) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {extractingAll && extractionProgress && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>Extracting text {extractionProgress.completed} of {extractionProgress.total}: {extractionProgress.current}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {Math.round((extractionProgress.completed / Math.max(extractionProgress.total, 1)) * 100)}%
              </span>
            </div>
            <div className="w-full bg-primary/20 h-2 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${Math.round((extractionProgress.completed / Math.max(extractionProgress.total, 1)) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-muted-foreground">Total Students</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{turnedIn}</div>
            <p className="text-xs text-muted-foreground">Turned In</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600">{late}</div>
            <p className="text-xs text-muted-foreground">Late Submissions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600">{graded}</div>
            <p className="text-xs text-muted-foreground">Graded</p>
          </CardContent>
        </Card>
      </div>

      <Card>
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
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading submissions...
                </TableCell>
              </TableRow>
            ) : submissions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No submissions found.
                </TableCell>
              </TableRow>
            ) : (
              submissions.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell>
                    <div className="font-medium">{sub.student_name || "Unknown Student"}</div>
                    <div className="text-sm text-muted-foreground">{sub.student_email || "No email"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={getStatusBadgeVariant(sub.state)}
                        className={getStatusColorClass(sub.state)}
                      >
                        {getStatusLabel(sub.state)}
                      </Badge>
                      {sub.late && <Badge variant="destructive">Late</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{sub.assigned_grade !== undefined ? sub.assigned_grade : "-"}</TableCell>
                  <TableCell>
                    {(() => {
                      const extracted = extractionByStudent[sub.user_id];
                      if (extracted) {
                        if (extracted.extraction_method === "skipped") {
                          return (
                            <Badge variant="outline" className="border-amber-500/30 text-amber-600 bg-amber-500/5">
                              Scanned – skipped
                            </Badge>
                          );
                        }
                        if (extracted.success) {
                          return (
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                                ✓ {extracted.char_count} chars
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                aria-label={`View extracted text for ${sub.student_name || "student"}`}
                                onClick={() => handleViewText(sub.student_name || "Unknown Student", extracted)}
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
                            onClick={() => handleDownload(sub, att)}
                            className="gap-1.5"
                          >
                            {status === "downloading" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : status === "success" ? (
                              <FileArchive className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            <span className="max-w-[120px] truncate text-xs">
                              {att.drive_file_title || "Download"}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Extracted Text Modal */}
      {viewingText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">{viewingText.studentName}</h3>
                <p className="text-xs text-muted-foreground">Extracted via {viewingText.method}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setViewingText(null)}>
                Close
              </Button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 font-mono text-sm whitespace-pre-wrap bg-muted/20">
              {viewingText.text || "No text content found."}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
