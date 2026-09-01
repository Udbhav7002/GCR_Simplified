import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Key,
  Palette,
  Shield,
  Save,
  ExternalLink,
  CheckCircle2,
  BookOpen,
  Loader2,
  Database,
  Trash2,
  RotateCcw,
  Sliders,
  DownloadCloud,
  Eye,
  EyeOff,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  startGoogleLogin,
  cancelGoogleLogin,
  getGoogleAuthStatus, 
  googleLogout,
  getSettings,
  saveSettings,
  purgeDownloadedSubmissions,
  purgePlagiarismRuns,
  backupDatabase,
  restoreDatabase,
} from "@/lib/ipc";
import { save, open, ask } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { useToast, friendlyError } from "@/components/ui/toaster";
import { useTheme } from "@/lib/useTheme";
import type { GoogleAuthStatus } from "@/lib/types";

export function Settings() {
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const [apiKey, setApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [fingerprintThreshold, setFingerprintThreshold] = useState("40");
  const [semanticThreshold, setSemanticThreshold] = useState("80");
  const [downloadConcurrency, setDownloadConcurrency] = useState("4");
  const [extractionConcurrency, setExtractionConcurrency] = useState("4");
  const [gradingConcurrency, setGradingConcurrency] = useState("1");
  const [gradingDelay, setGradingDelay] = useState("12");
  const [showApiKey, setShowApiKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus>({ is_authenticated: false });
  const [loginLoading, setLoginLoading] = useState(false);
  const [maintaining, setMaintaining] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [auth, settings] = await Promise.all([getGoogleAuthStatus(), getSettings()]);
        setAuthStatus(auth);
        setApiKey(settings.gemini_api_key || "");
        setGeminiModel(settings.gemini_model || "gemini-2.5-flash");
        setFingerprintThreshold(Math.round(settings.default_fingerprint_threshold * 100).toString());
        setSemanticThreshold(Math.round(settings.default_semantic_threshold * 100).toString());
        setDownloadConcurrency((settings.download_concurrency ?? 4).toString());
        setExtractionConcurrency((settings.extraction_concurrency ?? 4).toString());
        setGradingConcurrency((settings.grading_concurrency ?? 1).toString());
        setGradingDelay((settings.grading_delay_seconds ?? 12).toString());
      } catch (err) {
        console.error("Failed to load settings:", err);
        toast("Failed to load settings: " + friendlyError(err), "error");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [toast]);

  const handleGoogleConnect = async () => {
    try {
      setLoginLoading(true);
      const res = await startGoogleLogin();
      setAuthStatus(res);
      toast("Successfully connected to Google Classroom", "success");
    } catch (err) {
      console.error(err);
      toast("Google login failed: " + friendlyError(err), "error");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleGoogleCancel = async () => {
    try {
      await cancelGoogleLogin();
      setLoginLoading(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      await googleLogout();
      setAuthStatus(await getGoogleAuthStatus());
      toast("Disconnected from Google Classroom", "success");
    } catch (err) {
      console.error(err);
      toast("Failed to disconnect: " + friendlyError(err), "error");
    }
  };

  

  const handleSave = async () => {
    const fingerprint = parseInt(fingerprintThreshold, 10);
    const semantic = parseInt(semanticThreshold, 10);
    const dlConc = parseInt(downloadConcurrency, 10);
    const extConc = parseInt(extractionConcurrency, 10);
    const gradeConc = parseInt(gradingConcurrency, 10);
      const gradeDelay = parseInt(gradingDelay, 10);

    if (isNaN(fingerprint) || isNaN(semantic)) {
      toast("Thresholds must be valid numbers between 0 and 100.", "error");
      return;
    }
    if (fingerprint < 0 || fingerprint > 100 || semantic < 0 || semantic > 100) {
      toast("Thresholds must be between 0 and 100.", "error");
      return;
    }

    try {
      await saveSettings({
        gemini_api_key: apiKey,
        gemini_model: geminiModel,
        default_fingerprint_threshold: fingerprint / 100,
        default_semantic_threshold: semantic / 100,
        theme,
        download_concurrency: isNaN(dlConc) ? 4 : Math.min(Math.max(dlConc, 1), 16),
        extraction_concurrency: isNaN(extConc) ? 4 : Math.min(Math.max(extConc, 1), 16),
        grading_concurrency: isNaN(gradeConc) ? 1 : Math.min(Math.max(gradeConc, 1), 10),
        grading_delay_seconds: isNaN(gradeDelay) ? 12 : Math.max(gradeDelay, 0),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast("Settings saved successfully", "success");
    } catch (err) {
      console.error("Failed to save settings:", err);
      toast("Failed to save settings: " + friendlyError(err), "error");
    }
  };

  const handleBackup = async () => {
    try {
      const destPath = await save({
        title: "Back up GCR database snapshot",
        defaultPath: `gcr_backup_${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });
      if (!destPath) return;
      setMaintaining(true);
      const path = await backupDatabase(destPath);
      toast(`Backup saved successfully to:\n${path}`, "success");
    } catch (err) {
      console.error(err);
      toast("Backup failed: " + friendlyError(err), "error");
    } finally {
      setMaintaining(false);
    }
  };

  const handleRestore = async () => {
    try {
      const selected = await open({
        title: "Select SQLite backup file to restore",
        multiple: false,
        directory: false,
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });
      if (!selected || typeof selected !== "string") return;

      const confirmed = await ask(
        "Restoring will replace your current local database with this backup. A safety backup of your existing data will be created first. Continue?",
        { title: "Confirm Database Restore", kind: "warning" }
      );
      if (!confirmed) return;

      setMaintaining(true);
      await restoreDatabase(selected);
      toast("Database restored successfully!", "success");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      console.error(err);
      toast("Restore failed: " + friendlyError(err), "error");
    } finally {
      setMaintaining(false);
    }
  };

  const handlePurgeFiles = async () => {
    const confirmed = await ask(
      "This will remove downloaded assignment files from disk. Extracted text, rubrics, and grades will be kept. Continue?",
      { title: "Confirm Purge Downloaded Files", kind: "warning" }
    );
    if (!confirmed) return;

    try {
      setMaintaining(true);
      const removed = await purgeDownloadedSubmissions();
      toast(
        removed > 0
          ? `Removed ${removed} downloaded submission file(s) from disk.`
          : "No downloaded submission files to remove.",
        "success"
      );
    } catch (err) {
      console.error(err);
      toast("Purge failed: " + friendlyError(err), "error");
    } finally {
      setMaintaining(false);
    }
  };

  const handlePurgePlagiarismHistory = async () => {
    const confirmed = await ask(
      "This will delete historical plagiarism report snapshots to free disk space. Current extracted texts and grades will remain intact. Continue?",
      { title: "Confirm Plagiarism History Purge", kind: "warning" }
    );
    if (!confirmed) return;

    try {
      setMaintaining(true);
      const removed = await purgePlagiarismRuns();
      toast(
        removed > 0 ? `Deleted ${removed} historical plagiarism run(s).` : "No plagiarism history to remove.",
        "success"
      );
    } catch (err) {
      console.error(err);
      toast("Purge failed: " + friendlyError(err), "error");
    } finally {
      setMaintaining(false);
    }
  };

  const handleCheckUpdate = async () => {
    try {
      setCheckingUpdate(true);
      const update = await check();
      if (update) {
        toast(`Update ${update.version} available! Downloading...`, "success");
        await update.downloadAndInstall();
        toast("Update installed successfully! Please restart the app.", "success");
      } else {
        toast("You are on the latest version.", "success");
      }
    } catch (err) {
      console.error(err);
      toast("Failed to check for updates: " + friendlyError(err), "error");
    } finally {
      setCheckingUpdate(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-2xl space-y-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div className="space-y-1.5 pb-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure app preferences, thresholds, and maintenance</p>
      </div>

      {/* Google Account Integration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <CardTitle className="text-base">Google Classroom Account</CardTitle>
              <CardDescription>Connect your Google account to sync courses and assignments.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${authStatus.is_authenticated ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-sm font-medium">{authStatus.is_authenticated ? "Connected" : "Disconnected"}</span>
          </div>

          {authStatus.is_authenticated ? (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm font-medium">{authStatus.name || "Unknown Name"}</p>
                <p className="text-sm text-muted-foreground">{authStatus.email || "Unknown Email"}</p>
              </div>
              <Button variant="destructive" onClick={handleGoogleDisconnect}>
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Click Connect — a browser window opens. Sign in with the Google account you use for Classroom. You do
                not need a Client ID or Client Secret.
              </p>
              <div className="flex items-center gap-3">
                <Button onClick={handleGoogleConnect} disabled={loginLoading} className="gap-2">
                  {loginLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Waiting for browser sign-in...
                    </>
                  ) : (
                    <>
                      <BookOpen className="w-4 h-4" />
                      Connect Google Account
                    </>
                  )}
                </Button>
                {loginLoading && (
                  <Button variant="outline" onClick={handleGoogleCancel}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gemini AI */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Gemini API Key</CardTitle>
              <CardDescription>Only needed for AI grading — skip if you just check plagiarism</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder="AIzaSy..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                aria-label="Gemini API key"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored securely in your OS Keychain. Get a free key from{" "}
              <button
                type="button"
                onClick={() =>
                  openUrl("https://aistudio.google.com/apikey").catch(() =>
                    window.open("https://aistudio.google.com/apikey", "_blank")
                  )
                }
                className="text-primary underline hover:text-primary/80 font-inherit bg-transparent p-0 cursor-pointer"
              >
                Google AI Studio <ExternalLink className="w-3 h-3 inline" />
              </button>
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="gemini-model" className="text-sm font-medium">
              Model
            </label>
            <Select value={geminiModel} onValueChange={(v) => v && setGeminiModel(v)}>
              <SelectTrigger id="gemini-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (Fast & accurate)</SelectItem>
                <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro (Deep reasoning)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Palette className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Appearance</CardTitle>
              <CardDescription>Customize the application theme</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Select
            value={theme}
            onValueChange={(val) => {
              if (!val) return;
              const themeVal = val as "light" | "dark" | "system";
              setTheme(themeVal);
              if (themeVal === "dark") {
                document.documentElement.classList.add("dark");
              } else if (themeVal === "light") {
                document.documentElement.classList.remove("dark");
              } else {
                if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
                  document.documentElement.classList.add("dark");
                } else {
                  document.documentElement.classList.remove("dark");
                }
              }
              saveSettings({ theme: themeVal }).catch(console.error);
            }}
          >
            <SelectTrigger aria-label="Theme" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Plagiarism Detection Defaults */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Plagiarism Detection Thresholds</CardTitle>
              <CardDescription>Default similarity thresholds for flagging suspicious submissions</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="fingerprint-threshold" className="text-sm font-medium">
                Fingerprint Threshold (%)
              </label>
              <Input
                id="fingerprint-threshold"
                type="number"
                min="0"
                max="100"
                value={fingerprintThreshold}
                onChange={(e) => setFingerprintThreshold(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Exact text matching via Winnowing (default 40%)</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="semantic-threshold" className="text-sm font-medium">
                Semantic Threshold (%)
              </label>
              <Input
                id="semantic-threshold"
                type="number"
                min="0"
                max="100"
                value={semanticThreshold}
                onChange={(e) => setSemanticThreshold(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Paraphrase detection via TF-IDF (default 80%)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance & Concurrency */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sliders className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Concurrency & Performance</CardTitle>
              <CardDescription>Fine-tune background job concurrency for your device</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label htmlFor="download-concurrency" className="text-sm font-medium">
                Downloads
              </label>
              <Input
                id="download-concurrency"
                type="number"
                min="1"
                max="16"
                value={downloadConcurrency}
                onChange={(e) => setDownloadConcurrency(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Drive downloads (1–16)</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="extraction-concurrency" className="text-sm font-medium">
                Text Extraction
              </label>
              <Input
                id="extraction-concurrency"
                type="number"
                min="1"
                max="16"
                value={extractionConcurrency}
                onChange={(e) => setExtractionConcurrency(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">PDF/Docx parsers (1–16)</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="grading-concurrency" className="text-sm font-medium">
                AI Grading
              </label>
              <Input
                id="grading-concurrency"
                type="number"
                min="1"
                max="10"
                value={gradingConcurrency}
                onChange={(e) => setGradingConcurrency(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Gemini API workers (1–10)</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-4 mt-4">
            <div className="space-y-2">
              <label htmlFor="grading-delay" className="text-sm font-medium flex items-center gap-2">
                Free Tier Rate Limit Pacing
                <span className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">New</span>
              </label>
              <Input
                id="grading-delay"
                type="number"
                min="0"
                value={gradingDelay}
                onChange={(e) => setGradingDelay(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Seconds to wait after each grading request. Set to <b>12</b> if you are on the 5 RPM free tier limit for Gemini 2.5.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* App Updates */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <DownloadCloud className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">App Updates</CardTitle>
              <CardDescription>Check for and install the latest version of GCR Simplified</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button onClick={handleCheckUpdate} disabled={checkingUpdate} variant="outline" className="gap-2">
            {checkingUpdate ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
            Check for Updates
          </Button>
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
              <Database className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-base">Data Management & Backup</CardTitle>
              <CardDescription>Export SQLite snapshots, restore backups, or clean local caches.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleBackup} disabled={maintaining} variant="outline" className="gap-2">
              {maintaining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              Back Up Database
            </Button>
            <Button onClick={handleRestore} disabled={maintaining} variant="outline" className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Restore Database
            </Button>
            <Button onClick={handlePurgeFiles} disabled={maintaining} variant="destructive" className="gap-2">
              <Trash2 className="w-4 h-4" />
              Purge Downloaded Files
            </Button>
            <Button
              onClick={handlePurgePlagiarismHistory}
              disabled={maintaining}
              variant="destructive"
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Clean Plagiarism History
            </Button>
            <Button
              onClick={() => {
                localStorage.removeItem("gcr_tour_completed");
                window.location.href = "/";
              }}
              disabled={maintaining}
              variant="outline"
              className="gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset Tour
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Backups are created via atomic SQLite VACUUM snapshots. Restores automatically create a safety rollback
            point.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Save Button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Preferences are persisted in local SQLite storage.</p>
        <Button onClick={handleSave} className="gap-2" disabled={loading}>
          {saved ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
