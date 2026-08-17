# GCR Simplified — Grade · Check · Report

A local-first desktop app for teachers that syncs Google Classroom coursework, downloads and
extracts student submissions, detects plagiarism (Winnowing + TF-IDF), grades with Gemini AI
(with teacher approval workflow), and exports a polished 4-sheet Excel gradebook.

Built with **Tauri 2 + React + TypeScript + Rust** — no Python, no server. All data stays on
your machine.

## Features

- **Google Classroom sync** — OAuth 2.0 (PKCE, loopback) login, courses, coursework, rosters,
  submissions, missing-submission report with real Gmail reminder emails, incremental
  ETag-based syncing (Sync button forces a full refresh)
- **Drive download** — batch downloads with 4-way concurrency and live progress; Google Docs
  auto-export as PDF; filename collision dedupe
- **Text extraction** — PDF, DOCX, plaintext and code files, cached in SQLite
- **Plagiarism detection** — Winnowing fingerprints + TF-IDF cosine similarity, side-by-side
  matched fragments, cluster view of connected students, run history
- **AI grading (Gemini)** — rubric-driven grading with strict JSON mode, per-criterion
  justifications, chunk-safe prompts, teacher override + approve workflow
- **Excel export** — 4 sheets (Summary, Grade Sheet, Integrity Report, Feedback Log) with
  conditional formatting
- **Security** — OAuth tokens, client secret and the Gemini API key are stored in the OS
  keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service), never plaintext

## Prerequisites

- Node.js 20+ and Rust (stable) toolchain
- Platform deps for Tauri 2: see
  [Tauri prerequisites](https://tauri.app/start/prerequisites/) (WebKit on Linux)
- Linux only: a Secret Service provider (e.g. `gnome-keyring` or `kwallet`) for the keychain
  integration

## Setup

```bash
npm install
```

### Google Cloud Console setup (required for sync)

1. Go to <https://console.cloud.google.com/> and create a project.
2. Enable the **Google Classroom API** and **Google Drive API**.
3. In **APIs & Services → OAuth consent screen**, set the app type to *Internal* (workspace
   domain) or *External* + test users, and add yourself as a test user.
4. In **APIs & Services → Credentials**, create an **OAuth client ID** of type
   **Desktop app**.
5. Open GCR Simplified → **Settings**, paste your Client ID and Client Secret, and click
   **Connect Google Account**. Approve the consent screen in your browser. The window closes
   automatically.

> The app requests the `gmail.send` scope (for missing-submission reminder emails). If you
> connected before this scope existed, reconnect once in Settings to grant it.

### Gemini API key (required for AI grading)

1. Get a key at <https://aistudio.google.com/apikey>.
2. Paste it into **Settings → AI Configuration → Google Gemini API Key** and save.

## Development

```bash
npm run tauri dev
```

## Building installers

```bash
npm run tauri build
```

Outputs (per your OS): `.dmg`/`.app` (macOS), `.msi`/`.exe` (Windows), `.deb`/`.AppImage`
(Linux) under `src-tauri/target/release/bundle/`.

A GitHub Actions workflow (`.github/workflows/release.yml`) builds all three platforms on a
`v*` tag and attaches the installers to a draft release.

## Auto-updates

The app checks for updates on launch via `tauri-plugin-updater` (update manifest served from
GitHub Releases).

Before shipping updates:

1. Add the updater signing key to your GitHub repo secrets (Settings → Secrets and variables →
   Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/gcr_simplified.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the key password (empty string if none)
2. Bump `version` in `src-tauri/tauri.conf.json` and tag the release with `v<version>`. The
   `Release` workflow builds installers and attaches them to a draft release; the update
   manifest is served from that release.

> Keep the private key safe — losing it means you can no longer sign updates.

### Code signing & notarization (macOS)

The release workflow signs and notarizes macOS builds automatically when these repo secrets
are configured:

- `APPLE_CERTIFICATE` — base64 of your Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD` — the `.p12` password
- `APPLE_SIGNING_IDENTITY` — e.g. `Developer ID Application: Your Name (TEAMID)`
- `APPLE_ID` / `APPLE_PASSWORD` — Apple ID + app-specific password (notarization)
- `APPLE_TEAM_ID` — your Apple Developer Team ID

Without these, macOS builds still produce a `.dmg`, but Gatekeeper will warn users that the
app is unsigned. Windows builds can be signed via an OV code-signing certificate (configured
outside of the workflow).

## Tests & quality gates

```bash
# Rust unit tests
cd src-tauri && cargo test

# Frontend lint + format
npm run lint
npm run format:check

# All type checks + production build
npm run build

# Rust quality gates (run in CI)
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings
```

Unit tests cover Winnowing, TF-IDF, DOCX extraction, Gemini prompt/schema construction, Excel
export, and secret-key classification.

## Data & privacy

- All student data, extracted text, grades, and similarity results live in a local SQLite
  database in the OS app-data directory — nothing is uploaded except the explicit API calls
  to Google (Classroom/Drive) and Gemini (grading).
- Credentials are stored in the OS keychain under service `com.gcrsimplified.app`.
- Gemini grading sends the student's submission text and your rubric to Google's Gemini API.
  Review your institution's FERPA/data-sharing policies before enabling AI grading.

## Project layout

```
src/                      React frontend (pages, components, IPC wrappers in src/lib/ipc.ts)
src-tauri/src/
  db/                     SQLite schema + pool
  google/                 OAuth PKCE, Classroom API, Drive downloads
  extraction/             PDF / DOCX / plaintext extractors
  plagiarism/             Winnowing + TF-IDF + pairwise engine
  grading/                Gemini client + gradebook commands
  export/                 Excel export (rust_xlsxwriter, 4 sheets)
  commands/               rubric CRUD, dashboard stats, maintenance (purge/backup)
  security.rs             OS keychain secret storage
```
