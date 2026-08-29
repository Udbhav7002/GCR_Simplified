import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { DownloadProgress } from "@/lib/types";

export interface DownloadProgressBarProps {
  label: string;
  progress: DownloadProgress | null;
  active: boolean;
}

export function DownloadProgressBar({ label, progress, active }: DownloadProgressBarProps) {
  if (!active || !progress) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>
              {label} {progress.completed} of {progress.total}: {progress.current}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {Math.round((progress.completed / Math.max(progress.total, 1)) * 100)}%
          </span>
        </div>
        <div className="w-full bg-primary/20 h-2 rounded-full overflow-hidden">
          <div
            className="bg-primary h-full transition-all duration-300"
            style={{ width: `${Math.round((progress.completed / Math.max(progress.total, 1)) * 100)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
