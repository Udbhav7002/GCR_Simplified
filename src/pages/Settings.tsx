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
} from "lucide-react";
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
import { useToast, friendlyError } from "@/components/ui/toaster";
import { useTheme, type ThemeMode } from "@/lib/useTheme";
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
  const [gradingConcurrency, setGradingConcurrency] = useState("3");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus>({ is_authenticated: false });
  const [clientId, setClientId] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [maintaining, setMaintaining] = useState(false);

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
        setGradingConcurrency((settings.grading_concurrency ?? 3).toString());
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleGoogleConnect = async () => {
    if (!clientId.trim()) {
      toast("Please enter a Google OAuth Client ID", "error");
      return;
    }
    try {
      setLoginLoading(true);
      const status = await startGoogleLogin(clientId.trim());
      setAuthStatus(status);
      toast("Connected to Google Classroom", "success");
    } catch (err) {
      console.error(err);
      toast("Failed to connect to Google Classroom: " + friendlyError(err), "error");
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
        grading_concurrency: isNaN(gradeConc) ? 3 : Math.min(Math.max(gradeConc, 1), 10),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast("Settings saved successfully", "success");
    } catch (err) {
      console.error("Failed to save settings:", err);
      toast("Failed to save settings: " + friendlyError(err), "error");
    }
  };

  const handleThemeChange = (value: string | null) => {
    if (!value) return;
    setTheme(value as ThemeMode);
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
              <div className="space-y-2">
                <label className="text-sm font-medium">OAuth Client ID</label>
                <Input
                  type="text"
                  placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Google Desktop App OAuth Client ID (PKCE enabled — no client secret required).
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
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
              <CardDescription>Required for AI-powered rubric grading</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="AIzaSy..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Stored securely in your OS Keychain. Get a free key from{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline hover:text-primary/80"
              >
                Google AI Studio <ExternalLink className="w-3 h-3 inline" />
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Model</label>
            <Select value={geminiModel} onValueChange={(v) => v && setGeminiModel(v)}>
              <SelectTrigger className="w-full">
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
          <Select value={theme} onValueChange={handleThemeChange}>
            <SelectTrigger className="w-48">
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
              <label className="text-sm font-medium">Fingerprint Threshold (%)</label>
              <Input
                type="number"
                min="0"
                max="100"
                value={fingerprintThreshold}
                onChange={(e) => setFingerprintThreshold(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Exact text matching via Winnowing (default 40%)</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Semantic Threshold (%)</label>
              <Input
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
              <label className="text-sm font-medium">Downloads</label>
              <Input
                type="number"
                min="1"
                max="16"
                value={downloadConcurrency}
                onChange={(e) => setDownloadConcurrency(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Drive downloads (1–16)</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Text Extraction</label>
              <Input
                type="number"
                min="1"
                max="16"
                value={extractionConcurrency}
                onChange={(e) => setExtractionConcurrency(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">PDF/Docx parsers (1–16)</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">AI Grading</label>
              <Input
                type="number"
                min="1"
                max="10"
                value={gradingConcurrency}
                onChange={(e) => setGradingConcurrency(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Gemini API workers (1–10)</p>
            </div>
          </div>
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
            <Button onClick={handlePurgeFiles} disabled={maintaining} variant="outline" className="gap-2">
              <Trash2 className="w-4 h-4" />
              Purge Downloaded Files
            </Button>
            <Button onClick={handlePurgePlagiarismHistory} disabled={maintaining} variant="outline" className="gap-2">
              <Trash2 className="w-4 h-4" />
              Clean Plagiarism History
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Backups are created via atomic SQLite VACUUM snapshots. Restores automatically create a safety rollback point.
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
