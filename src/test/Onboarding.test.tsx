import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Onboarding } from "@/pages/Onboarding";
import { ToastProvider } from "@/components/ui/toaster";
import * as ipc from "@/lib/ipc";

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    getGoogleAuthStatus: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    startGoogleLogin: vi.fn(),
    cancelGoogleLogin: vi.fn(),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const emptySettings = {
  gemini_model: "gemini-2.5-flash",
  default_fingerprint_threshold: 0.4,
  default_semantic_threshold: 0.8,
  theme: "system" as const,
};

function renderOnboarding() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Onboarding />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(ipc.getGoogleAuthStatus).mockResolvedValue({ is_authenticated: false });
    vi.mocked(ipc.getSettings).mockResolvedValue(emptySettings);
  });

  it("lets a teacher connect Google without leaving the page", async () => {
    vi.mocked(ipc.startGoogleLogin).mockResolvedValue({
      is_authenticated: true,
      email: "teacher@school.edu",
    });

    renderOnboarding();
    fireEvent.click(await screen.findByRole("button", { name: /connect google/i }));

    await waitFor(() => {
      expect(ipc.startGoogleLogin).toHaveBeenCalled();
      expect(screen.getByText("teacher@school.edu")).toBeInTheDocument();
    });
  });

  it("saves a Gemini key from the same screen", async () => {
    vi.mocked(ipc.saveSettings).mockResolvedValue(undefined);
    vi.mocked(ipc.getSettings)
      .mockResolvedValueOnce(emptySettings)
      .mockResolvedValue({ ...emptySettings, gemini_api_key: "AIzaTest" });

    renderOnboarding();
    fireEvent.change(await screen.findByLabelText(/gemini api key/i), { target: { value: "AIzaTest" } });
    fireEvent.click(screen.getByRole("button", { name: /save key/i }));

    await waitFor(() => {
      expect(ipc.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ gemini_api_key: "AIzaTest" })
      );
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });
});
