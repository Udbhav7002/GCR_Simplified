import { describe, it, expect, beforeEach } from "vitest";
import { applyThemeClass } from "@/lib/useTheme";

describe("Theme management", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("applies dark class for dark theme", () => {
    applyThemeClass("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("removes dark class for light theme", () => {
    document.documentElement.classList.add("dark");
    applyThemeClass("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
