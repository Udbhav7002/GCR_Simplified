// ── GCR Simplified — Onboarding state ──
// Tracks whether the first-run setup checklist has been dismissed.

const DISMISS_KEY = "gcr_onboarding_dismissed";

export function isOnboardingDismissed() {
  return localStorage.getItem(DISMISS_KEY) === "1";
}

export function dismissOnboarding() {
  localStorage.setItem(DISMISS_KEY, "1");
}

export function resetOnboarding() {
  localStorage.removeItem(DISMISS_KEY);
}
