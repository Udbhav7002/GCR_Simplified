import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { listGoogleStudents, listGoogleCoursework } from "@/lib/ipc";
import type { GoogleStudent, GoogleCourseWork } from "@/lib/types";
import { friendlyError } from "@/components/ui/toaster";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Users, FileText, ChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const [students, setStudents] = useState<GoogleStudent[]>([]);
  const [coursework, setCoursework] = useState<GoogleCourseWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (force?: boolean) => {
      if (!courseId) return;
      try {
        setLoading(true);
        setError(null);
        const [studentsData, courseworkData] = await Promise.all([
          listGoogleStudents(courseId, force),
          listGoogleCoursework(courseId, force),
        ]);
        setStudents(studentsData);
        setCoursework(courseworkData);
      } catch (err: unknown) {
        console.error(err);
        setError(friendlyError(err));
      } finally {
        setLoading(false);
      }
    },
    [courseId]
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <h3 className="text-lg font-medium text-destructive">Error Loading Course</h3>
            <p className="text-sm text-muted-foreground">{error}</p>
            <div className="flex gap-2">
              <Button render={<Link to="/courses" />} variant="outline">
                Back to Courses
              </Button>
              <Button onClick={() => fetchData(false)} variant="default">
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
          <h1 className="text-2xl font-semibold tracking-tight">Course Details</h1>
        </div>
        <Button onClick={() => fetchData(true)} disabled={loading} variant="outline" className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Sync
        </Button>
      </div>

      <Tabs defaultValue="assignments" className="space-y-6">
        <TabsList>
          <TabsTrigger value="assignments" className="gap-2">
            <FileText className="w-4 h-4" />
            Assignments
          </TabsTrigger>
          <TabsTrigger value="students" className="gap-2">
            <Users className="w-4 h-4" />
            Students
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assignments" className="space-y-4">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse h-32"></Card>
              ))}
            </div>
          ) : coursework.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="pt-6 text-center text-muted-foreground">
                No assignments found for this course.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {coursework.map((work) => (
                <Card key={work.id} className="hover:border-primary/50 transition-colors flex flex-col">
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <CardTitle className="line-clamp-2 text-base" title={work.title}>
                        {work.title}
                      </CardTitle>
                      <Badge variant="outline" className="shrink-0">
                        {work.state}
                      </Badge>
                    </div>
                    {work.description && (
                      <CardDescription className="line-clamp-2 mt-2">{work.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="mt-auto pt-0 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {work.max_points ? `${work.max_points} Points` : "Ungraded"}
                    </span>
                    <Button
                      render={<Link to={`/courses/${courseId}/assignments/${work.id}`} />}
                      size="sm"
                      variant="secondary"
                    >
                      View Submissions
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="students">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : students.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                      No students enrolled.
                    </TableCell>
                  </TableRow>
                ) : (
                  students.map((student) => (
                    <TableRow key={student.user_id}>
                      <TableCell className="font-medium">{student.full_name}</TableCell>
                      <TableCell className="text-muted-foreground">{student.email_address || "N/A"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
