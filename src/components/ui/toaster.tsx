import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

type ToastFn = (message: string, type?: ToastType) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback<ToastFn>((message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 max-w-md">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg text-sm bg-card animate-in fade-in slide-in-from-bottom-2 ${
              t.type === "success"
                ? "border-green-500/30"
                : t.type === "error"
                  ? "border-red-500/30"
                  : "border-blue-500/30"
            }`}
          >
            {t.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
            ) : t.type === "error" ? (
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            )}
            <span className="whitespace-pre-wrap break-words">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/// Convert an unknown error into a short, friendly message.
export function friendlyError(err: unknown): string {
  let raw = "";
  if (typeof err === "string") {
    raw = err;
  } else if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === "object" && err !== null) {
    if ("message" in err) {
      raw = String((err as any).message);
    } else {
      raw = JSON.stringify(err);
    }
  } else {
    raw = String(err);
  }

  const lower = raw.toLowerCase();
  if (
    lower.includes("has not completed the google verification") ||
    lower.includes("access blocked") ||
    lower.includes("access_denied")
  ) {
    return "Google only allows approved tester accounts while this app is in testing. Send the developer the Google email you use for Classroom so they can add you, then try Connect again.";
  }
  return truncate(raw);
}

function truncate(text: string): string {
  const cleaned = text.trim();
  if (cleaned.length <= 300) return cleaned;
  return cleaned.slice(0, 300) + "…";
}
