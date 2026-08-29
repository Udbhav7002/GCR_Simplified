import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  GraduationCap,
  FileText,
  Users,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  BookOpen,
  CheckCircle2,
  X,
} from "lucide-react";
import { getDashboardStats } from "@/lib/ipc";
import type { DashboardStats } from "@/lib/types";
import { friendlyError, useToast } from "@/components/ui/toaster";

export function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBanner, setShowBanner] = useState(() => !localStorage.getItem("hide_welcome_banner"));

  const dismissBanner = () => {
    localStorage.setItem("hide_welcome_banner", "true");
    setShowBanner(false);
  };

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch((err) => {
        console.error(err);
        toast("Failed to load dashboard: " + friendlyError(err), "error");
      })
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <div className="p-8 space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your synced courses and assignments</p>
      </div>

      {/* Welcome Banner */}
      {showBanner && (
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground p-8">
          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute top-2 right-2 text-primary-foreground/80 hover:bg-white/20 hover:text-white z-20"
            onClick={dismissBanner}
            title="Dismiss"
          >
            <X className="w-5 h-5" />
          </Button>
          <div className="relative z-10">
            <h1 className="text-2xl font-bold">Welcome back! 👋</h1>
            <p className="mt-2 text-primary-foreground/80 max-w-lg">
              From submissions to scoresheets in minutes, not hours. Connect your Google Classroom to sync courses and
              start grading.
            </p>
            <div className="flex gap-3 mt-5">
              <Button variant="secondary" className="gap-2" onClick={() => { dismissBanner(); navigate("/courses"); }}>
                <BookOpen className="w-4 h-4" />
                View Courses
              </Button>
            </div>
          </div>
          <div className="absolute -right-8 -top-8 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -right-4 -bottom-8 w-32 h-32 rounded-full bg-white/5 blur-xl" />
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Courses</p>
                <p className="text-3xl font-bold mt-1">{loading ? "—" : (stats?.total_courses ?? 0)}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <GraduationCap className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Students</p>
                <p className="text-3xl font-bold mt-1">{loading ? "—" : (stats?.total_students ?? 0)}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-chart-2/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-chart-2" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Assignments</p>
                <p className="text-3xl font-bold mt-1">{loading ? "—" : (stats?.total_assignments ?? 0)}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-chart-3/10 flex items-center justify-center">
                <FileText className="w-6 h-6 text-chart-3" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Grades Given</p>
                <p className="text-3xl font-bold mt-1">{loading ? "—" : (stats?.graded_submissions ?? 0)}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-chart-4/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-chart-4" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="group hover:shadow-md transition-all hover:border-primary/30">
          <CardHeader>
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2 group-hover:bg-primary/20 transition-colors">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base">AI-Powered Grading</CardTitle>
            <CardDescription>
              Evaluate essays and short answers with rubric-aligned AI scoring and explainable feedback.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="group hover:shadow-md transition-all hover:border-primary/30">
          <CardHeader>
            <div className="w-10 h-10 rounded-lg bg-chart-2/10 flex items-center justify-center mb-2 group-hover:bg-chart-2/20 transition-colors">
              <ShieldCheck className="w-5 h-5 text-chart-2" />
            </div>
            <CardTitle className="text-base">Plagiarism Detection</CardTitle>
            <CardDescription>
              Catch intra-class copying with multi-layer fingerprinting and semantic analysis.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="group hover:shadow-md transition-all hover:border-primary/30">
          <CardHeader>
            <div className="w-10 h-10 rounded-lg bg-chart-3/10 flex items-center justify-center mb-2 group-hover:bg-chart-3/20 transition-colors">
              <TrendingUp className="w-5 h-5 text-chart-3" />
            </div>
            <CardTitle className="text-base">Excel Reports</CardTitle>
            <CardDescription>
              One-click export of formatted grade sheets with scores, feedback, and integrity flags.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* Empty State */}
      {!loading && (stats?.total_courses ?? 0) === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <BookOpen className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No courses synced yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Connect your Google Classroom account and sync a course to get started.
            </p>
            <Button onClick={() => navigate("/onboarding")} className="gap-2">
              <GraduationCap className="w-4 h-4" />
              Connect Google Account
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
