import { useCallback, useEffect, useState } from "react";
import { getSettings, saveSettings } from "@/lib/ipc";

export type ThemeMode = "light" | "dark" | "system";

const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

/// Apply a theme mode to the document (toggle `dark` class + native color-scheme).
export function applyThemeClass(theme: ThemeMode) {
  const isDark = theme === "dark" || (theme === "system" && darkMedia.matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

/// Load the persisted theme on mount, apply it, and expose a persisting setter.
/// "system" mode follows the OS preference live.
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (cancelled) return;
        const t = (settings.theme as ThemeMode) || "system";
        setThemeState(t);
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
    applyThemeClass(next);
    try {
      await saveSettings({ theme: next });
    } catch (err) {
      console.warn("Failed to persist theme:", err);
    }
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const onChange = () => applyThemeClass("system");
    darkMedia.addEventListener("change", onChange);
    return () => darkMedia.removeEventListener("change", onChange);
  }, [theme]);

  return { theme, setTheme, loaded };
}
