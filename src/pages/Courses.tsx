import { Link, useNavigate } from "react-router-dom";
import { useCourses } from "@/hooks/useGoogleData";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, RefreshCw, ExternalLink, BookOpen } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

function isAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("not authenticated") || lower.includes("sign in") || lower.includes("refresh token");
}

export function Courses() {
  const navigate = useNavigate();
  const { data: courses = [], isLoading: loading, errorMsg: error, sync, isSyncing, refetch } = useCourses();

  const handleSync = () => {
    sync().catch(console.error);
  };
  const handleRetry = () => {
    refetch().catch(console.error);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Google Classroom</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage Google Classroom courses and assignments.</p>
        </div>
        <Button id="tour-sync-btn" onClick={() => handleSync} disabled={loading || isSyncing} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading || isSyncing ? "animate-spin" : ""}`} />
          Sync
        </Button>
      </div>

      {error ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <ExternalLink className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-destructive">
                {isAuthError(error) ? "Authentication Required" : "Failed to Load Courses"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                {isAuthError(error) ? "Connect your Google account first — it takes one click." : error}
              </p>
            </div>
            <div className="flex gap-2">
              <Button render={<Link to="/onboarding" />} variant="outline">
                Connect Google
              </Button>
              <Button onClick={() => handleRetry} variant="default">
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-4">
                <div className="h-6 bg-muted rounded w-2/3 mb-2"></div>
                <div className="h-4 bg-muted rounded w-1/3"></div>
              </CardHeader>
              <CardContent>
                <div className="h-10 bg-muted rounded w-full"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-medium">No courses found</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                We couldn't find any active courses in your Google Classroom account.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map((course) => (
            <Card
              key={course.id}
              role="article"
              className="hover:border-primary/50 transition-colors flex flex-col cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/courses/${course.id}`)}
            >
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="line-clamp-2" title={course.name}>
                      {course.name}
                    </CardTitle>
                    {course.section && <CardDescription className="line-clamp-1">{course.section}</CardDescription>}
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {course.course_state}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="mt-auto space-y-4">
                {course.enrollment_code && (
                  <div className="text-sm flex items-center justify-between bg-muted/50 p-2 rounded-md">
                    <span className="text-muted-foreground">Class Code:</span>
                    <span className="font-mono font-medium">{course.enrollment_code}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    render={<Link to={`/courses/${course.id}`} />}
                    className="flex-1 gap-2"
                    variant="default"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <BookOpen className="w-4 h-4" />
                    View Details
                  </Button>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (course.alternate_link) {
                        openUrl(course.alternate_link).catch(() => window.open(course.alternate_link, "_blank"));
                      }
                    }}
                    size="icon"
                    variant="outline"
                    title="Open in Classroom"
                    aria-label={`Open ${course.name} in Google Classroom`}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
