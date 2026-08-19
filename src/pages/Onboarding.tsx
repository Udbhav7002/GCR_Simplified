import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  GraduationCap,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  Loader2,
  KeyRound,
  FileSearch,
  Bot,
} from "lucide-react";
import { getGoogleAuthStatus, getSettings, getDashboardStats } from "@/lib/ipc";
import { dismissOnboarding } from "@/lib/onboarding";
import type { GoogleAuthStatus, AppSettings, DashboardStats } from "@/lib/types";

export function Onboarding() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<GoogleAuthStatus>({ is_authenticated: false });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [authRes, settingsRes, statsRes] = await Promise.all([
          getGoogleAuthStatus(),
          getSettings(),
          getDashboardStats(),
        ]);
        setAuth(authRes);
        setSettings(settingsRes);
        setStats(statsRes);
      } catch (err) {
        console.error("Failed to load onboarding status:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const googleConnected = auth.is_authenticated;
  const geminiConfigured = Boolean(settings?.gemini_api_key && settings.gemini_api_key.trim().length > 0);
  const courseSynced = Boolean(stats && stats.total_courses > 0);

  const stepsDone = [googleConnected, geminiConfigured, courseSynced].filter(Boolean).length;

  const handleStart = useCallback(() => {
    dismissOnboarding();
    navigate("/");
  }, [navigate]);

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground p-8">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold">Welcome to GCR Simplified! 🎉</h1>
          <p className="mt-2 text-primary-foreground/80 max-w-lg">
            Grade · Check · Report — a desktop power tool that automates assignment evaluation, plagiarism detection,
            and AI grading on top of Google Classroom. Set up in under 5 minutes.
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <Button variant="secondary" className="gap-2" onClick={handleStart}>
              Get started
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              className="gap-2 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
              onClick={handleStart}
            >
              Skip for now
            </Button>
          </div>
        </div>
        <div className="absolute -right-8 -top-8 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -right-4 -bottom-8 w-32 h-32 rounded-full bg-white/5 blur-xl" />
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${(stepsDone / 3) * 100}%` }}
          />
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">{stepsDone}/3 setup steps done</span>
      </div>

      {/* Setup checklist */}
      <div className="grid grid-cols-1 gap-4">
        <SetupStep
          icon={<GraduationCap className="w-5 h-5" />}
          title="Connect Google Classroom"
          description="Sign in with your school Google account to sync courses, rosters, and assignments."
          done={googleConnected}
          doneLabel={auth.email ? `Connected as ${auth.email}` : "Connected"}
          actionLabel="Go to Settings"
          onAction={() => navigate("/settings")}
          loading={loading}
        />
        <SetupStep
          icon={<KeyRound className="w-5 h-5" />}
          title="Add your Gemini API key"
          description="Get a free key from Google AI Studio and paste it in Settings to enable AI grading."
          done={geminiConfigured}
          doneLabel="API key configured"
          actionLabel="Add API key"
          onAction={() => navigate("/settings")}
          loading={loading}
        />
        <SetupStep
          icon={<Sparkles className="w-5 h-5" />}
          title="Sync a course"
          description="Open Courses to pull in your Google Classroom courses and pick an assignment to work with."
          done={courseSynced}
          doneLabel={`${stats?.total_courses ?? 0} course(s) synced`}
          actionLabel="View Courses"
          onAction={() => navigate("/courses")}
          loading={loading}
        />
      </div>

      <Separator />

      {/* Try-it suggestions */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Try these next</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Once connected, explore the core features on any assignment:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center">
                  <FileSearch className="w-5 h-5 text-destructive" />
                </div>
                <CardTitle className="text-base">Check plagiarism</CardTitle>
              </div>
              <CardDescription>
                Runs offline winnowing + TF-IDF analysis to catch copied work between students.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/courses")}>
                Open an assignment
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-chart-2/10 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-chart-2" />
                </div>
                <CardTitle className="text-base">AI-grade with Gemini</CardTitle>
              </div>
              <CardDescription>
                Score submissions against your rubric with per-criterion justifications, then review and approve.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/courses")}>
                Open an assignment
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Privacy note */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/60">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Local-first & private.</span> Submissions and similarity analysis
          stay 100% on your machine. Credentials are stored in your OS keychain. AI grading sends submission text to
          Google Gemini — review before you grade.
        </p>
      </div>
    </div>
  );
}

interface SetupStepProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  done: boolean;
  doneLabel: string;
  actionLabel: string;
  onAction: () => void;
  loading: boolean;
}

function SetupStep({ icon, title, description, done, doneLabel, actionLabel, onAction, loading }: SetupStepProps) {
  return (
    <Card className={done ? "border-primary/40" : undefined}>
      <CardContent className="flex items-center gap-4 p-4">
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
            done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{title}</h3>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : done ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {doneLabel}
              </Badge>
            ) : (
              <Badge variant="outline">Pending</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
        {!done && (
          <Button size="sm" className="gap-1.5 shrink-0" onClick={onAction}>
            {actionLabel}
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
