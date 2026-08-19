import { Suspense, lazy, useEffect, useState, useRef } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toaster";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useTheme } from "@/lib/useTheme";
import { Loader2 } from "lucide-react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import { getGoogleAuthStatus } from "@/lib/ipc";
import { isOnboardingDismissed } from "@/lib/onboarding";

// Keep Dashboard eagerly loaded (it's the app entry).
import { Dashboard } from "@/pages/Dashboard";
import { Onboarding } from "@/pages/Onboarding";

// Lazy-load the rest so each page is a separate chunk.
const Settings = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })));
const Courses = lazy(() => import("@/pages/Courses").then((m) => ({ default: m.Courses })));
const CourseDetail = lazy(() => import("@/pages/CourseDetail").then((m) => ({ default: m.CourseDetail })));
const AssignmentSubmissions = lazy(() =>
  import("@/pages/AssignmentSubmissions").then((m) => ({ default: m.AssignmentSubmissions }))
);
const PlagiarismReportPage = lazy(() =>
  import("@/pages/PlagiarismReport").then((m) => ({ default: m.PlagiarismReportPage }))
);
const MissingSubmissions = lazy(() =>
  import("@/pages/MissingSubmissions").then((m) => ({ default: m.MissingSubmissions }))
);
const Gradebook = lazy(() => import("@/pages/Gradebook").then((m) => ({ default: m.Gradebook })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Redirect first-time users to the onboarding checklist until they connect a
 *  Google account (or explicitly dismiss). The /onboarding route itself is
 *  always accessible from within the app. The redirect happens once per app
 *  launch, so navigating away from onboarding never bounces the user back. */
function SetupGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const checkedOnce = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (checkedOnce.current) {
      setReady(true);
      return;
    }
    checkedOnce.current = true;
    let cancelled = false;
    (async () => {
      try {
        if (isOnboardingDismissed()) {
          setReady(true);
          return;
        }
        const status = await getGoogleAuthStatus();
        if (cancelled) return;
        if (!status.is_authenticated) {
          navigate("/onboarding", { replace: true });
          return;
        }
        setReady(true);
      } catch {
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!ready) {
    return <PageLoader />;
  }
  return <>{children}</>;
}

function AppLayout() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (!update || cancelled) return;
        const install = await ask(`Version ${update.version} is available. Download and install now?`, {
          title: "Update available",
          kind: "info",
        });
        if (!install || cancelled) return;
        await update.downloadAndInstall();
        await relaunch();
      } catch (err) {
        console.warn("Updater check failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <Suspense fallback={<PageLoader />}>
            <SetupGuard>
              <Routes>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/" element={<Dashboard />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/courses" element={<Courses />} />
                <Route path="/courses/:courseId" element={<CourseDetail />} />
                <Route path="/courses/:courseId/assignments/:courseWorkId" element={<AssignmentSubmissions />} />
                <Route
                  path="/courses/:courseId/assignments/:courseWorkId/plagiarism"
                  element={<PlagiarismReportPage />}
                />
                <Route path="/courses/:courseId/assignments/:courseWorkId/missing" element={<MissingSubmissions />} />
                <Route path="/assignments/:assignmentId/gradebook" element={<Gradebook />} />
              </Routes>
            </SetupGuard>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function App() {
  useTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider>
          <ErrorBoundary>
            <BrowserRouter>
              <AppLayout />
            </BrowserRouter>
          </ErrorBoundary>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
