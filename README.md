# GCR Simplified

[![CI](https://github.com/Udbhav7002/GCR_Simplified/actions/workflows/ci.yml/badge.svg)](https://github.com/Udbhav7002/GCR_Simplified/actions/workflows/ci.yml)

*Grade · Check · Report — a desktop app for Google Classroom.*

GCR Simplified is a Tauri v2 desktop app for teachers. It connects to Google Classroom, downloads assignment submissions, extracts their text, checks for plagiarism between students, grades with AI (optional), and exports an Excel gradebook. Students submit work through Google Classroom as usual and never touch this app.

## Download

Latest release: [v0.1.9 on GitHub Releases](https://github.com/Udbhav7002/GCR_Simplified/releases/tag/v0.1.9)

| Operating System | Download |
|----------|----------|
| Windows | [`GCR.Simplified_0.1.9_x64_en-US.msi`](https://github.com/Udbhav7002/GCR_Simplified/releases/download/v0.1.9/GCR.Simplified_0.1.9_x64_en-US.msi) |
| Mac (Apple Silicon) | [`GCR.Simplified_0.1.9_aarch64.dmg`](https://github.com/Udbhav7002/GCR_Simplified/releases/download/v0.1.9/GCR.Simplified_0.1.9_aarch64.dmg) |
| Mac (Intel) | [`GCR.Simplified_0.1.9_x64.dmg`](https://github.com/Udbhav7002/GCR_Simplified/releases/download/v0.1.9/GCR.Simplified_0.1.9_x64.dmg) |

First-time Mac install: open the `.dmg`, drag the app to Applications, then right-click it and choose Open once to get past Gatekeeper. After that it opens normally.

## Workflow

1. **Connect** — sign in with the Google account you use for Classroom. Optionally paste a free [Gemini API key](https://aistudio.google.com/apikey) into Settings to enable AI grading.
2. **Select an assignment** — Courses → your class → assignment, then Sync to pull the roster.
3. **Download & extract** — pulls every submission (PDFs, DOCX, Google Docs, images) and extracts the text.
4. **Check plagiarism** — compares every student's work against every other student's, offline.
5. **Grade** — Grade All (AI) suggests scores; handwritten photos are read and graded with Gemini Vision. Any score can be overridden before you approve.
6. **Export** — saves a 4-sheet Excel gradebook: class summary, grade sheet, plagiarism integrity report, and per-student AI feedback. Use it for your records or to enter scores into Classroom.

## Features

- Identical file detection: SHA-256 hashing flags submissions that are a classmate's file renamed and re-uploaded.
- Offline plagiarism detection: winnowing and TF-IDF cosine similarity catch verbatim and paraphrased copying without uploading student work anywhere.
- AI grading via the Gemini API, including vision-based grading of handwritten submissions. Optional, requires a free API key.
- Excel gradebook export (.xlsx) with class stats, grades, an integrity report, and detailed feedback per student.
- Missing submissions tracker.

## Privacy

- File processing and plagiarism checking run entirely on your machine; submissions are stored in a local SQLite database.
- AI grading is the only feature that sends data off your machine: extracted text or images go to the Gemini API using your own key.
- Students never install anything and have no accounts here.
- Google credentials and API keys are stored in the OS credential manager (Keychain on macOS, Credential Manager on Windows).

## Development

Prerequisites: Node.js v20+, Rust stable, and the [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Udbhav7002/GCR_Simplified.git
cd GCR_Simplified
npm install
npm run tauri dev
```

Project layout:

```text
src/            React 19 + TypeScript frontend (Base UI, Vite, React Query)
  components/   UI components
  hooks/        React Query data fetching
  pages/        route views
  lib/          Tauri IPC bridge and TypeScript types
src-tauri/      Rust core
  src/core/     SQLite storage, keychain security, maintenance
  src/domain/   google/ (OAuth2 PKCE, Classroom, Drive), extraction/ (PDF, DOCX),
                grading/ (Gemini, vision), plagiarism/ (winnowing, TF-IDF),
                export/ (.xlsx generation)
```

Testing and building:

```bash
cd src-tauri && cargo test   # Rust backend tests
npm run test                 # frontend tests (Vitest)
npm run tauri build          # production installers (.dmg, .msi, .deb, .rpm, .AppImage)
```

## License

MIT — see [LICENSE](LICENSE).
