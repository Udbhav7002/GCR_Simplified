import { describe, it, expect } from "vitest";
import { friendlyError } from "@/components/ui/toaster";

describe("friendlyError", () => {
  it("formats string errors directly", () => {
    expect(friendlyError("Network error occurred")).toBe("Network error occurred");
  });

  it("extracts message from Error instance", () => {
    const err = new Error("Database locked");
    expect(friendlyError(err)).toBe("Database locked");
  });

  it("handles null and undefined safely", () => {
    expect(friendlyError(null)).toBe("null");
    expect(friendlyError(undefined)).toBe("undefined");
  });

  it("truncates excessively long error payloads", () => {
    const longErr = "a".repeat(400);
    const result = friendlyError(longErr);
    expect(result.length).toBe(301); // 300 chars + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });

  it("explains Google tester-list blocks in plain language", () => {
    const msg = friendlyError(
      "Access blocked: GCR Simplified has not completed the Google verification process"
    );
    expect(msg).toMatch(/approved tester/i);
    expect(msg).not.toMatch(/verification process/i);
  });
});
