/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { getSettings, saveSettings } from "@/lib/ipc";

export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "gcr_theme";
const darkMedia = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function applyThemeClass(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark" || (theme === "system" && darkMedia?.matches);
  document.documentElement.classList.toggle("dark", Boolean(isDark));
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  if (stored === "light" || stored === "dark" || stored === "system") {
    applyThemeClass(stored);
    return stored;
  }
  applyThemeClass("system");
  return "system";
}

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (next: ThemeMode) => Promise<void>;
  loaded: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: async () => {},
  loaded: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (cancelled) return;
        const t = (settings.theme as ThemeMode) || "system";
        setThemeState(t);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, t);
        } catch {
          // ignore storage error
        }
        applyThemeClass(t);
      })
      .catch((err) => console.warn("Failed to load theme:", err))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback(async (next: ThemeMode) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    applyThemeClass(next);
    try {
      const current = await getSettings().catch(() => ({
        gemini_model: "gemini-2.5-flash",
        default_fingerprint_threshold: 0.4,
        default_semantic_threshold: 0.8,
      }));
      await saveSettings({
        ...current,
        theme: next,
      });
    } catch (err) {
      console.warn("Failed to persist theme:", err);
    }
  }, []);

  useEffect(() => {
    if (!darkMedia || theme !== "system") return;
    const onChange = () => applyThemeClass("system");
    darkMedia.addEventListener("change", onChange);
    return () => darkMedia.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, loaded }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
