import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, ShieldCheck, ArrowRight, CheckCircle2, Loader2, KeyRound, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { startGoogleLogin, cancelGoogleLogin, getGoogleAuthStatus, getSettings, saveSettings } from "@/lib/ipc";
import { dismissOnboarding } from "@/lib/onboarding";
import { useToast, friendlyError } from "@/components/ui/toaster";
import type { GoogleAuthStatus, AppSettings } from "@/lib/types";

export function Onboarding() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<GoogleAuthStatus>({ is_authenticated: false });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  const reload = useCallback(async () => {
    const [authRes, settingsRes] = await Promise.all([getGoogleAuthStatus(), getSettings()]);
    setAuth(authRes);
    setSettings(settingsRes);
    setApiKey(settingsRes.gemini_api_key || "");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch (err) {
        console.error("Failed to load onboarding status:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  const googleConnected = auth.is_authenticated;
  const geminiConfigured = Boolean(settings?.gemini_api_key && settings.gemini_api_key.trim().length > 0);
  const stepsDone = [googleConnected, geminiConfigured].filter(Boolean).length;

  const finish = useCallback(
    (to: string) => {
      dismissOnboarding();
      navigate(to);
    },
    [navigate]
  );

  const handleConnect = async () => {
    try {
      setLoginLoading(true);
      const status = await startGoogleLogin();
      setAuth(status);
      toast("Connected to Google Classroom", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      toast("Paste your Gemini API key first.", "error");
      return;
    }
    try {
      setSavingKey(true);
      const current = settings ?? (await getSettings());
      await saveSettings({ ...current, gemini_api_key: apiKey.trim() });
      await reload();
      toast("API key saved", "success");
    } catch (err) {
      toast("Could not save API key: " + friendlyError(err), "error");
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-2xl mx-auto">
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground p-8">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold">Two things, then you can grade</h1>
          <p className="mt-2 text-primary-foreground/80 max-w-lg">
            Sign in with Classroom, paste a free Gemini key. No Google Cloud Console.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${(stepsDone / 2) * 100}%` }}
          />
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">{stepsDone}/2 done</span>
      </div>

      <Card className={googleConnected ? "border-primary/40" : undefined}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-4">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                googleConnected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Connect Google Classroom</h3>
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : googleConnected ? (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {auth.email || "Connected"}
                  </Badge>
                ) : (
                  <Badge variant="outline">Needed</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Use the same Google account you use for Classroom. A browser window will open.
              </p>
            </div>
          </div>
          {!googleConnected && (
            <div className="flex items-center gap-2 pl-[3.75rem]">
              <Button size="sm" onClick={handleConnect} disabled={loginLoading} className="gap-1.5">
                {loginLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Waiting for browser…
                  </>
                ) : (
                  "Connect Google"
                )}
              </Button>
              {loginLoading && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    cancelGoogleLogin().catch(() => {});
                    setLoginLoading(false);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={geminiConfigured ? "border-primary/40" : undefined}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-4">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                geminiConfigured ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Paste your Gemini API key</h3>
                {geminiConfigured ? (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Saved
                  </Badge>
                ) : (
                  <Badge variant="outline">For AI grading</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Free from Google AI Studio. Skip this if you only want plagiarism checks.
              </p>
            </div>
          </div>
          <div className="space-y-2 pl-[3.75rem]">
            <Input
              type="password"
              placeholder="AIzaSy…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              aria-label="Gemini API key"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleSaveKey} disabled={savingKey} className="gap-1.5">
                {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save key
              </Button>
              <button
                type="button"
                className="text-sm text-primary underline inline-flex items-center gap-1"
                onClick={() =>
                  openUrl("https://aistudio.google.com/apikey").catch(() =>
                    window.open("https://aistudio.google.com/apikey", "_blank")
                  )
                }
              >
                Get a free key
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button className="gap-2" onClick={() => finish(googleConnected ? "/courses" : "/")} disabled={loading}>
          {googleConnected ? "Open my courses" : "Continue"}
          <ArrowRight className="w-4 h-4" />
        </Button>
        <Button variant="ghost" onClick={() => finish("/")}>
          Skip for now
        </Button>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/60">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">If Google says “Access blocked”:</span> the app is still in
          testing. Email the developer the Google address you sign in with so they can add you as a tester.
        </p>
      </div>
    </div>
  );
}
