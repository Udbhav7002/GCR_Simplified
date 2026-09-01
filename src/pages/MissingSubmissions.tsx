import { useParams, Link } from "react-router-dom";
import { useMissingSubmissions, useSubmissions } from "@/hooks/useGoogleData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, RefreshCw, AlertTriangle, CheckCircle2, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function MissingSubmissions() {
  const { courseId, courseWorkId } = useParams<{ courseId: string; courseWorkId: string }>();

  const { data: missingStudents = [], isLoading: loadingMissing, errorMsg: errorMissing, refetch: refetchMissing } = useMissingSubmissions(courseId || "", courseWorkId || "");
  const { data: submissions = [], isLoading: loadingSubs, errorMsg: errorSubs, refetch: refetchSubs, isSyncing } = useSubmissions(courseId || "", courseWorkId || "");

  const loading = loadingMissing || loadingSubs;
  const error = errorMissing || errorSubs;

  const totalStudents = missingStudents.length + submissions.filter((s) => s.state === "TURNED_IN").length;
  const submittedCount = submissions.filter((s) => s.state === "TURNED_IN").length;
  const missingCount = missingStudents.length;
  const submissionRate = totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0;

  
  const handleRetry = async () => {
    try {
      await Promise.all([refetchMissing(), refetchSubs()]);
    } catch (e) { console.error(e); }
  };

  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <AlertTriangle className="w-8 h-8 text-destructive" />
            <h3 className="text-lg font-medium text-destructive">Error Loading Missing Submissions</h3>
            <p className="text-sm text-muted-foreground">{error}</p>
            <div className="flex gap-2">
              <Button render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}`} />} variant="outline">
                Back to Submissions
              </Button>
              <Button onClick={handleRetry} variant="default">
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-muted rounded w-64 animate-pulse"></div>
          <div className="h-10 bg-muted rounded w-24 animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 bg-muted rounded w-24"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-muted rounded w-16"></div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="animate-pulse">
          <CardHeader>
            <div className="h-6 bg-muted rounded w-48 mb-4"></div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4">
                  <div className="h-4 bg-muted rounded w-1/3"></div>
                  <div className="h-4 bg-muted rounded w-1/3"></div>
                  <div className="h-4 bg-muted rounded w-1/4 ml-auto"></div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-4 pt-8 -mt-8 -mx-8 px-8 border-b mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            render={<Link to={`/courses/${courseId}/assignments/${courseWorkId}`} />}
            variant="ghost"
            size="icon"
            className="mt-1 shrink-0"
            title="Back to Submissions"
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
              <ChevronRight className="w-4 h-4" />
              <Link
                to={`/courses/${courseId}/assignments/${courseWorkId}`}
                className="hover:text-foreground transition-colors"
              >
                Submissions
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Missing Submissions</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleRetry} disabled={loading || isSyncing} variant="outline" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading || isSyncing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Students</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div className="text-2xl font-bold">{totalStudents}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Submitted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <div className="text-2xl font-bold text-green-600">{submittedCount}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Missing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {missingCount > 0 ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              )}
              <div className={`text-2xl font-bold ${missingCount > 0 ? "text-red-500" : "text-green-500"}`}>
                {missingCount}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Submission Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div className="text-2xl font-bold">{submissionRate}%</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Students Missing Submissions</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {missingCount === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-green-600">All students have submitted!</h3>
              <p className="text-sm text-muted-foreground mt-1">No missing submissions for this assignment.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missingStudents.map((student) => (
                    <TableRow key={student.user_id}>
                      <TableCell className="font-medium">{student.name}</TableCell>
                      <TableCell>
                        {student.email ? (
                          <span className="text-sm text-muted-foreground">{student.email}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">No email on file</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
