import { useEffect, useRef } from "react";

type KeyHandler = (e: KeyboardEvent) => void;

export interface ShortcutMap {
  [key: string]: KeyHandler;
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap, active = true) {
  const shortcutsRef = useRef(shortcuts);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      const parts = [];
      if (e.metaKey || e.ctrlKey) parts.push("Cmd");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");

      const key = e.key;
      if (key === "Meta" || key === "Control" || key === "Shift" || key === "Alt") {
        return;
      }

      if (key === "Escape") {
        parts.push("Escape");
      } else if (key === "Enter") {
        parts.push("Enter");
      } else {
        parts.push(key.toUpperCase());
      }

      const shortcutKey = parts.join("+");
      const handler = shortcutsRef.current[shortcutKey];

      if (handler) {
        if (isInput && shortcutKey !== "Cmd+Enter" && shortcutKey !== "Escape") {
          return;
        }

        handler(e);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);
}
