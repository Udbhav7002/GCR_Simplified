import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SetupGuard } from "@/App";
import * as ipc from "@/lib/ipc";
import * as onboarding from "@/lib/onboarding";

vi.mock("@/lib/ipc", () => ({
  getGoogleAuthStatus: vi.fn(),
}));

describe("SetupGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders children when google account is authenticated", async () => {
    vi.mocked(ipc.getGoogleAuthStatus).mockResolvedValue({
      is_authenticated: true,
      email: "teacher@school.edu",
      name: "Teacher",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <SetupGuard>
          <div>Protected Content</div>
        </SetupGuard>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });
  });

  it("renders children when onboarding is explicitly dismissed", async () => {
    onboarding.dismissOnboarding();
    vi.mocked(ipc.getGoogleAuthStatus).mockResolvedValue({
      is_authenticated: false,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <SetupGuard>
          <div>Protected Content</div>
        </SetupGuard>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Protected Content")).toBeInTheDocument();
    });
  });

  it("redirects to /onboarding when unauthenticated and not dismissed", async () => {
    vi.mocked(ipc.getGoogleAuthStatus).mockResolvedValue({
      is_authenticated: false,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <SetupGuard>
                <div>Protected Content</div>
              </SetupGuard>
            }
          />
          <Route path="/onboarding" element={<div>Onboarding Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Onboarding Page")).toBeInTheDocument();
    });
  });
});
