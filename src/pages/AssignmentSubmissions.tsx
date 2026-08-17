import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  listGoogleSubmissions,
  downloadSubmissionFile,
  downloadAllSubmissions,
  extractAllSubmissions,
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
  AlertCircle,
  CheckCircle2,
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
      } catch (err: any) {
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

  // Match extracted text to students by exact student-id path segment. The
  // backend stores files under submissions/{course}/{courseWork}/{userId}/...
  // so the segment before the filename IS the Google user ID. Substring
  // matching is unsafe ("12" would match "123456...").
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
    } catch (err: any) {
      console.error(err);
      toast("Batch download failed: " + friendlyError(err), "error");
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
      const failed = results.filter((r) => !r.success).length;
      if (failed > 0 && results.length > failed) {
        toast(
          `Text extraction finished: ${results.length - failed} ok, ${failed} skipped (e.g. scanned PDFs)`,
          "error"
        );
      } else if (failed > 0) {
        toast(`No text could be extracted from ${failed} file(s)`, "error");
      } else if (results.length > 0) {
        toast(`Extracted text from ${results.length} file(s)`, "success");
      } else {
        toast("No new files to extract", "success");
      }
    } catch (err: any) {
      console.error("Extraction error:", err);
      toast("Failed to extract text: " + friendlyError(err), "error");
    } finally {
      setExtractingAll(false);
      setExtractionProgress(null);
    }
  };

  const handleViewText = (studentName: string, result: ExtractionResult) => {
    setViewingText({
      studentName,
      text: result.extracted_text,
      method: result.extraction_method,
    });
  };

  const getStatusBadgeVariant = (state: string) => {
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
            <div className="flex gap-2">
              <Button render={<Link to={`/courses/${courseId}`} />} variant="outline">
                Back to Course
              </Button>
              <Button onClick={() => fetchSubmissions(false)} variant="default">
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
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
            Details
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Submissions</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => fetchSubmissions(true)} disabled={loading} variant="outline" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Sync
          </Button>
          <Button onClick={handleExtractAll} disabled={extractingAll || loading} variant="outline" className="gap-2">
            {extractingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {extractingAll ? "Extracting..." : "Extract All Text"}
          </Button>
          <Button
            onClick={handleDownloadAll}
            disabled={loading || submissions.length === 0 || downloadingAll}
            className="gap-2"
          >
            {downloadingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileArchive className="w-4 h-4" />}
            {downloadingAll ? "Downloading..." : "Download All"}
          </Button>
          <Button
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}/plagiarism`} />}
            variant="outline"
            className="gap-2"
          >
            <Shield className="w-4 h-4" />
            Check Plagiarism
          </Button>
          <Button
            render={
              <Link to={`/assignments/${courseWorkId}/gradebook?courseId=${courseId}&courseWorkId=${courseWorkId}`} />
            }
            variant="outline"
            className="gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            Gradebook
          </Button>
          <Button
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}/missing`} />}
            variant="outline"
            className="gap-2"
          >
            <Users className="w-4 h-4" />
            View Missing
          </Button>
        </div>
      </div>

      {downloadProgress && downloadProgress.total > 0 && (
        <Card className="border-blue-500/30">
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                Downloading {downloadProgress.completed}/{downloadProgress.total} files
              </span>
              <span className="text-muted-foreground truncate max-w-[400px]" title={downloadProgress.current}>
                {downloadProgress.current}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5">
              <div
                className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((downloadProgress.completed / downloadProgress.total) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {extractionProgress && extractionProgress.total > 0 && (
        <Card className="border-chart-3/30">
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                Extracting {extractionProgress.completed}/{extractionProgress.total} files
              </span>
              <span className="text-muted-foreground truncate max-w-[400px]" title={extractionProgress.current}>
                {extractionProgress.current}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5">
              <div
                className="bg-chart-3 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((extractionProgress.completed / extractionProgress.total) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

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
                        variant={getStatusBadgeVariant(sub.state) as any}
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
                                onClick={() => handleViewText(sub.student_name || "Unknown Student", extracted)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </div>
                          );
                        } else {
                          return <Badge variant="destructive">Failed</Badge>;
                        }
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
                    <div className="flex flex-col gap-2 items-end">
                      {sub.attachments.map((att, idx) => {
                        if (!att.drive_file_id) return null;
                        const key = `${sub.id}-${att.drive_file_id}`;
                        const status = downloadingItems[key];

                        return (
                          <div key={att.drive_file_id ?? idx} className="flex items-center gap-2">
                            <span className="text-xs truncate max-w-[150px]" title={att.drive_file_title}>
                              {att.drive_file_title}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              onClick={() => handleDownload(sub, att)}
                              disabled={status === "downloading"}
                            >
                              {status === "downloading" ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : status === "success" ? (
                                <CheckCircle2 className="w-3 h-3 text-green-500" />
                              ) : status === "error" ? (
                                <AlertCircle className="w-3 h-3 text-red-500" />
                              ) : (
                                <Download className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
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

      {viewingText && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setViewingText(null)}
        >
          <div
            className="bg-card rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] m-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="font-semibold">{viewingText.studentName} — Extracted Text</h3>
                <p className="text-xs text-muted-foreground">Method: {viewingText.method}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setViewingText(null)}>
                ✕
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed text-foreground">
                {viewingText.text}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
