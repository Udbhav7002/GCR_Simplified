# Changelog

All notable changes to GCR Simplified are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-08-31

### Added
- **Identical File Detection:** SHA-256 binary hashing catches students who
  re-upload a classmate's file under a different name. Flagged with a red
  "Identical File" badge in the Plagiarism Report UI.
- Grade Override dialog now works correctly (fixed IPC argument naming).
- Aggressive rate-limit back-off for Gemini API: on 429 errors the engine
  now waits 15–30 s per retry (up to 6 retries) instead of failing immediately.
- Deleting a rubric criterion now correctly resets affected submissions to
  "ungraded" so the Grade All button re-enables.

### Removed
- **Push to Classroom** button: Google's API forbids third-party apps from
  modifying grades on assignments they didn't create. The button has been
  removed to avoid confusion; use the Export button instead.
- **Email Grades / Nudge Students** features and the `gmail.send` OAuth
  scope: eliminates the need for a costly Google Restricted Scope security
  audit.

### Fixed
- Build errors that prevented GitHub Actions from producing installers
  (missing `confirmPush` state, unused imports).
- README download links now point to the latest release.

### Security
- Removed `https://www.googleapis.com/auth/gmail.send` scope, reducing
  the app's OAuth permission footprint.

## [0.1.1] - 2026-08-19

### Added
- First-run onboarding checklist: guides new users through Google Classroom
  connection, Gemini API key setup, and course sync, with a Setup Guide entry
  in the sidebar to revisit anytime.

### Security
- Gemini client: no more `.expect()` panic on HTTP client init, API key is
  validated up front, configurable timeout and retry count with exponential
  backoff + jitter, and API errors are sanitized and mapped to friendly
  messages instead of leaking raw response bodies.
- Database reads now surface row-parse errors instead of silently dropping
  rows via `filter_map(|r| r.ok())`.

### Build
- Releases build without Apple signing secrets (unsigned installers for
  teacher review); updater artifacts disabled until signing is configured.

## [0.1.0] - 2026-08-17

### Added
- Google Classroom sync: OAuth 2.0 (PKCE loopback), courses, coursework, rosters, submissions,
  missing-submission report with Gmail reminder emails, incremental ETag caching.
- Drive download pipeline with bounded concurrency, live progress events, Google Docs → PDF
  export, and filename-collision dedupe.
- Text extraction for PDF / DOCX / plaintext / code, cached in SQLite.
- Plagiarism engine: Winnowing fingerprints + TF-IDF cosine similarity, cluster view,
  side-by-side matched fragments, and persisted run history with an explicit "Run" action.
- AI grading (Gemini): rubric-driven scoring with strict JSON mode, per-criterion
  justifications, teacher override + approve workflow, and long-input truncation with retry.
- Excel export: 4-sheet workbook (Summary, Grade Sheet, Integrity Report, Feedback Log) with
  conditional formatting.
- OS keychain storage for OAuth tokens, client secret, and the Gemini API key.
- Settings: Google account, Gemini key, theme (light / dark / system), plagiarism thresholds,
  and data management (DB backup, purge downloaded files).
- CI/CD: GitHub Actions CI (build, lint, format, clippy, tests) and a signed multi-platform
  release workflow.

### Fixed
- Save Settings now works (IPC contract aligned between frontend and backend).
- Plagiarism thresholds from Settings are actually applied to checks and exports.
- Re-running AI grading no longer overwrites teacher overrides or approvals.
- Teacher grade overrides now keep the gradebook total and Excel export consistent.
- Theme (incl. system preference) is applied on app startup, not only in Settings.
- Student ↔ file matching uses exact path segments instead of unsafe substring matching.
- Gradebook breadcrumb, override dialog (criterion max marks, no state mutation), and student
  emails shown correctly.
- Manual Classes flow removed; AI grading + gradebook now work directly on synced Google
  coursework via a local mirror.

### Removed
- Manual Classes / ClassDetail pages and their CRUD commands (superseded by Google sync).

### Security
- Tightened CSP (production), keychain-first secret storage with legacy migration.
