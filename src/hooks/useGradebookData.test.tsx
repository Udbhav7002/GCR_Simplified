import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGradebookQuery } from "./useGradebookData";
import { getGradebook } from "@/lib/ipc";
import React from "react";

// Mock the IPC module
vi.mock("@/lib/ipc", () => ({
  getGradebook: vi.fn(),
  updateGradeOverride: vi.fn(),
  approveGrade: vi.fn(),
  approveAllGrades: vi.fn(),
  createRubricCriterion: vi.fn(),
  deleteRubricCriterion: vi.fn(),
}));

// Mock the toaster
vi.mock("@/components/ui/toaster", () => ({
  useToast: () => vi.fn(),
  friendlyError: vi.fn((err) => String(err)),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("useGradebookQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("should not fetch if assignmentId is undefined", () => {
    const { result } = renderHook(() => useGradebookQuery(undefined), { wrapper });
    expect(result.current.isFetching).toBe(false);
  });

  it("should fetch gradebook data successfully", async () => {
    const mockData = { id: "a1", assignment_title: "Test" };
    vi.mocked(getGradebook).mockResolvedValue(mockData as any);

    const { result } = renderHook(() => useGradebookQuery("a1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(getGradebook).toHaveBeenCalledWith("a1");
  });

  it("should handle fetch error", async () => {
    vi.mocked(getGradebook).mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => useGradebookQuery("a1"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Network Error");
  });
});
