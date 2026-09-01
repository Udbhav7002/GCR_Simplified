import { useState } from "react";
import { Download, X, ArrowUpCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UpdateBannerProps {
  version: string;
  releaseNotes?: string;
  onInstall: () => Promise<void>;
  onDismiss: () => void;
}

export function UpdateBanner({ version, releaseNotes, onInstall, onDismiss }: UpdateBannerProps) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstall();
    } catch {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in duration-500">
      <div className="bg-card border border-border rounded-lg shadow-lg p-4 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <ArrowUpCircle className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Update Available</p>
            <p className="text-xs text-muted-foreground mt-0.5">Version {version} is ready to install.</p>
            {releaseNotes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">{releaseNotes}</p>}
            <div className="flex items-center gap-2 mt-3">
              <Button size="sm" className="h-7 text-xs px-3 gap-1.5" onClick={handleInstall} disabled={installing}>
                {installing ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Installing…
                  </>
                ) : (
                  <>
                    <Download className="w-3 h-3" />
                    Update Now
                  </>
                )}
              </Button>
              {!installing && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs px-2 text-muted-foreground"
                  onClick={onDismiss}
                >
                  Later
                </Button>
              )}
            </div>
          </div>
          {!installing && (
            <button
              onClick={onDismiss}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
