import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import {
  startGoogleLogin,
  cancelGoogleLogin,
  getGoogleAuthStatus,
  googleLogout,
  getSettings,
  saveSettings,
  purgeDownloadedSubmissions,
  backupDatabase,
} from "@/lib/ipc";
import { save } from "@tauri-apps/plugin-dialog";
import { useToast, friendlyError } from "@/components/ui/toaster";
import { useTheme, type ThemeMode } from "@/lib/useTheme";
import type { GoogleAuthStatus } from "@/lib/types";

export function Settings() {
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const [apiKey, setApiKey] = useState("");
  const [fingerprintThreshold, setFingerprintThreshold] = useState("40");
  const [semanticThreshold, setSemanticThreshold] = useState("80");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus>({ is_authenticated: false });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [auth, settings] = await Promise.all([getGoogleAuthStatus(), getSettings()]);
        setAuthStatus(auth);
        setApiKey(settings.gemini_api_key || "");
        setFingerprintThreshold(Math.round(settings.default_fingerprint_threshold * 100).toString());
        setSemanticThreshold(Math.round(settings.default_semantic_threshold * 100).toString());
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleGoogleConnect = async () => {
    try {
      setLoginLoading(true);
      const status = await startGoogleLogin(clientId, clientSecret);
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
        default_fingerprint_threshold: fingerprint / 100,
        default_semantic_threshold: semantic / 100,
        theme,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast("Settings saved", "success");
    } catch (err) {
      console.error("Failed to save settings:", err);
      toast("Failed to save settings: " + friendlyError(err), "error");
    }
  };

  const handleThemeChange = (value: string | null) => {
    if (!value) return;
    setTheme(value as ThemeMode);
  };

  const [maintaining, setMaintaining] = useState(false);

  const handleBackup = async () => {
    try {
      const destPath = await save({
        title: "Back up GCR data",
        defaultPath: `gcr_backup_${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });
      if (!destPath) return;
      setMaintaining(true);
      const path = await backupDatabase(destPath);
      toast(`Backup saved to:\n${path}`, "success");
    } catch (err) {
      console.error(err);
      toast("Backup failed: " + friendlyError(err), "error");
    } finally {
      setMaintaining(false);
    }
  };

  const handlePurge = async () => {
    try {
      setMaintaining(true);
      const removed = await purgeDownloadedSubmissions();
      toast(
        removed > 0
          ? `Removed ${removed} downloaded submission file(s) from disk. Grades and extracted text are kept.`
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
          <div className="flex items-center gap-2 mb-4">
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
                <label className="text-sm font-medium">Client ID</label>
                <Input
                  type="text"
                  placeholder="Google OAuth Client ID..."
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Client Secret</label>
                <Input
                  type="password"
                  placeholder="Google OAuth Client Secret..."
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </div>
              {loginLoading ? (
                <div className="flex gap-2">
                  <Button onClick={handleGoogleCancel} variant="outline" disabled={!loginLoading}>
                    Cancel
                  </Button>
                  <Button disabled={!clientId || !clientSecret || loginLoading}>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Connecting...
                  </Button>
                </div>
              ) : (
                <Button onClick={handleGoogleConnect} disabled={!clientId || !clientSecret}>
                  Connect Google Account
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">AI Configuration</CardTitle>
              <CardDescription>Configure the AI provider for assignment grading.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Google Gemini API Key</label>
            <Input
              type="password"
              placeholder="Enter your Gemini API key..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Get your API key from{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                Google AI Studio
                <ExternalLink className="w-3 h-3" />
              </a>
              . Your key is stored locally and never shared.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-chart-3" />
              {apiKey ? "Configured" : "Not configured"}
            </Badge>
            <span className="text-xs text-muted-foreground">Required for AI grading (Phase 3)</span>
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-chart-3/10 flex items-center justify-center">
              <Palette className="w-5 h-5 text-chart-3" />
            </div>
            <div>
              <CardTitle className="text-base">Appearance</CardTitle>
              <CardDescription>Customize the look and feel of the app.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Theme</label>
            <Select value={theme} onValueChange={handleThemeChange}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">☀️ Light</SelectItem>
                <SelectItem value="dark">🌙 Dark</SelectItem>
                <SelectItem value="system">💻 System</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Plagiarism Thresholds */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-chart-2/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-chart-2" />
            </div>
            <div>
              <CardTitle className="text-base">Integrity Detection</CardTitle>
              <CardDescription>
                Default thresholds for plagiarism detection. Teachers can override per assignment.
              </CardDescription>
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
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
            <strong>Tip:</strong> Lower thresholds catch more cases but may flag false positives. The defaults (40%
            fingerprint, 80% semantic) are conservative to avoid false accusations.
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
              <CardTitle className="text-base">Data Management</CardTitle>
              <CardDescription>Back up your local database or purge downloaded submission files.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleBackup} disabled={maintaining} variant="outline" className="gap-2">
              {maintaining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              Back Up Database
            </Button>
            <Button onClick={handlePurge} disabled={maintaining} variant="destructive" className="gap-2">
              <Trash2 className="w-4 h-4" />
              Purge Downloaded Files
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Purging removes the raw downloaded submission files from disk but keeps extracted text, grades, and rubrics
            in the database.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Save */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Settings are stored locally on your machine.</p>
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
