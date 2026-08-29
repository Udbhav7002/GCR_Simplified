import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { listGoogleStudents, listGoogleCoursework, listGoogleCourses } from "@/lib/ipc";
import type { GoogleStudent, GoogleCourseWork } from "@/lib/types";
import { friendlyError } from "@/components/ui/toaster";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCw, Users, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const [students, setStudents] = useState<GoogleStudent[]>([]);
  const [coursework, setCoursework] = useState<GoogleCourseWork[]>([]);
  const [courseName, setCourseName] = useState<string>("Course Details");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (force?: boolean) => {
      if (!courseId) return;
      try {
        setLoading(true);
        setError(null);
        const [studentsData, courseworkData, coursesData] = await Promise.all([
          listGoogleStudents(courseId, force),
          listGoogleCoursework(courseId, force),
          listGoogleCourses(force),
        ]);
        setStudents(studentsData);
        setCoursework(courseworkData);
        const course = coursesData.find((c) => c.id === courseId);
        if (course) setCourseName(course.name);
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
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-4 pt-8 -mt-8 -mx-8 px-8 border-b mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            render={<Link to="/courses" />}
            variant="ghost"
            size="icon"
            className="mt-1 shrink-0"
            title="Back to Courses"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Link to="/courses" className="hover:text-foreground transition-colors">
                Courses
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{courseName}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => fetchData(true)} disabled={loading} variant="outline" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Sync
          </Button>
        </div>
      </div>

      <Tabs defaultValue="assignments" className="flex-col space-y-6">
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
                <Card key={i} className="animate-pulse h-32">
                  <CardHeader className="pb-4">
                    <div className="h-6 bg-muted rounded w-2/3 mb-2"></div>
                    <div className="h-4 bg-muted rounded w-1/3"></div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : coursework.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 space-y-3 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-medium">No assignments found</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    This course doesn't have any assignments yet.
                  </p>
                </div>
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
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={`skeleton-student-${i}`} className="animate-pulse">
                      <TableCell><div className="h-4 bg-muted rounded w-32"></div></TableCell>
                      <TableCell><div className="h-4 bg-muted rounded w-48"></div></TableCell>
                    </TableRow>
                  ))
                ) : students.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <Users className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-lg font-medium">No students enrolled</p>
                          <p className="text-sm text-muted-foreground mt-1">There are no students enrolled in this course.</p>
                        </div>
                      </div>
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
