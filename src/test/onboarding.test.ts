import { describe, it, expect, beforeEach } from "vitest";
import { isOnboardingDismissed, dismissOnboarding, resetOnboarding } from "@/lib/onboarding";

describe("onboarding state helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is not dismissed by default", () => {
    expect(isOnboardingDismissed()).toBe(false);
  });

  it("marks onboarding as dismissed", () => {
    dismissOnboarding();
    expect(isOnboardingDismissed()).toBe(true);
  });

  it("resets onboarding status", () => {
    dismissOnboarding();
    expect(isOnboardingDismissed()).toBe(true);
    resetOnboarding();
    expect(isOnboardingDismissed()).toBe(false);
  });
});
