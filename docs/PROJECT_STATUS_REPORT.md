# GCR Simplified — Codebase Verification & Status Report

**Date:** Aug 15, 2026
**Method:** Full manual review of all Rust/TS sources + verified `cargo check` and `npm run build` both pass.

---

## 1. Verdict in One Line

**Phases 0–2 (Foundation, GCR Sync, Extraction, Plagiarism) are genuinely built and compile — roughly 90% done, with a handful of real bugs. Phase 3 (AI Grading) is ~5% done (schema + UI placeholder only). Phase 4 (Excel export) is ~10% (dependency installed, no code). Phase 5 is 0%.**

---

## 2. What Exists and Actually Works (Verified)

| Capability | Files | Status |
|---|---|---|
| Tauri 2 shell, plugins, SQLite schema (WAL, FK) | `src-tauri/src/lib.rs`, `db/mod.rs` | ✅ Compiles, full schema incl. `rubric_criteria`, `grades`, `similarity_results`, `extracted_texts` |
| OAuth2 PKCE loopback login + token refresh | `google/auth.rs`, `google/mod.rs` | ✅ Complete: PKCE, S256, offline access, refresh flow |
| Classroom API (courses, coursework, students, submissions) w/ pagination | `google/classroom.rs` | ✅ Complete |
| Drive download + Google Docs→PDF export | `google/drive.rs` | ✅ Complete |
| PDF / DOCX / plaintext / code extraction + SQLite cache | `extraction/*` | ✅ Complete (scanned PDFs & images → error, OCR stubbed) |
| Winnowing fingerprinting + TF-IDF cosine | `plagiarism/*` | ✅ Algorithms correct, pairwise engine in `spawn_blocking` |
| CRUD commands for classes/students/assignments/rubrics/submissions | `commands/*` | ✅ Complete incl. CSV roster import, assignment stats |
| Frontend: 8 pages wired to IPC via `lib/ipc.ts` | `src/pages/*` | ✅ Router wired, all pages invoke real commands |

**Line counts:** Rust ~2,440 lines · TS/TSX ~4,335 lines · total ~6,800.

---

## 3. Bugs & Issues Found (Fix First)

### 3.1 Critical / High

1. **Login hangs forever if browser tab is closed.** `wait_for_callback` blocks on `listener.accept()` with no timeout (`src-tauri/src/google/auth.rs:54`). The invoke promise hangs and the UI has no cancel path. **Fix:** wrap accept in a timeout (e.g., 5 min) or poll with `set_nonblocking` + a cancellable state; emit a Tauri event when done.
2. **Plagiarism report shows raw Google user IDs instead of student names.** `run_plagiarism_check` fills `student_a_name` with the directory name (= Google `userId`, e.g. `10721...`) and the comment says "resolved in frontend" (`src-tauri/src/plagiarism/commands.rs:138`) — but `PlagiarismReport.tsx` never resolves it (`src/pages/PlagiarismReport.tsx:211,263`). **Fix:** join against `students`/roster in the Rust command (you already have email mapping in `list_google_submissions`).
3. **Settings are fake.** `handleSave` in `Settings.tsx:67` is `// TODO`, and thresholds/Gemini key/theme are never persisted or loaded. Worse, the UI defaults (40% / 80%) contradict the backend defaults (0.30 / 0.75 in `plagiarism/commands.rs:16-17`). **Fix:** add `get_settings` / `save_settings` commands; load on mount; pass stored thresholds to `run_plagiarism_check` from the report page.
4. **Secrets in plaintext SQLite.** Google client secret, access/refresh tokens, and (future) Gemini key stored unencrypted in the `settings` table. Acceptable for an MVP, but a real FERPA story needs OS keychain. **Fix (Phase 5):** `keyring` crate or `tauri-plugin-stronghold`.
5. **`google_logout` deletes the OAuth client ID/secret** (`google/auth.rs:196` uses `LIKE 'google_%'`), forcing teachers to re-enter them to reconnect. **Fix:** only delete tokens + profile keys, keep `google_client_id`/`google_client_secret`.

### 3.2 Medium

6. **No history persistence for similarity runs.** `similarity_results` table is never written. Teachers lose report history; re-running recomputes. **Fix:** insert pairwise results keyed by (course_work_id, run timestamp); add "view past reports".
7. **`grades` table has no CRUD commands** — only a stats query (`commands/submissions.rs:152-163`). Needed by Phase 3 anyway; add `upsert_grade`, `get_grades_for_submission` now.
8. **Batch download is a sequential frontend loop** (`AssignmentSubmissions.tsx:77-85`) with no concurrency and no progress events. 150 students × several files = slow, UI blocks on the promise. **Fix:** move batch download into a Rust command with a bounded concurrency pool (e.g., 4-6 parallel) and emit `tauri::Emitter` progress events.
9. **Download filename collisions** — two attachments with the same title overwrite each other (`google/drive.rs:105`). **Fix:** append a short content hash / dedupe suffix.
10. **No tests anywhere** (0 `#[test]` modules, no frontend tests). Winnowing, TF-IDF, DOCX parsing are pure functions — trivially unit-testable. **Fix:** add `src-tauri/src/plagiarism/winnowing.rs::tests`, `tfidf.rs::tests`, `docx.rs::tests` with fixture files.
11. **Vite chunk >500 kB warning** — lazy-load pages with `React.lazy` + `Suspense` per route.
12. **OCR stub returns an error** (`extraction/ocr.rs:3`) — fine for now, but the UX message should be surfaced once in Settings, not per-file during batch extraction.

### 3.3 Low / Polish

13. Empty-doc guard: winnowing returns 0.0 for docs < 5 words — fine, but short answers can produce inflated Jaccard when fingerprint sets are tiny; consider a minimum document length before scoring.
14. `extract_code_from_request` assumes query params in a specific order; fine in practice, but use a proper query-string parse if it ever breaks.
15. Manual "Classes" CRUD pages (`Classes.tsx`, `ClassDetail.tsx`) are a leftover from the pre-GCR-sync MVP and now duplicate the Google "Courses" flow. Keep for offline/manual mode or hide behind a toggle to reduce teacher confusion.
16. `security.csp: null` — fine for MVP, tighten before release.

---

## 4. Gap Analysis vs. Original Blueprint

| Blueprint Item | Current State | Effort |
|---|---|---|
| Submission tracking (MVP: manual + CSV, Full: GCR sync) | ✅ Both exist (CSV import + GCR sync) | Done |
| Missing-report + nudge reminders | ❌ Missing report not implemented | S (0.5 day) — derive from roster vs `TURNED_IN` set |
| Layer 1 Winnowing | ✅ Done | — |
| Layer 2 TF-IDF semantic | ✅ Done | — |
| Layer 3 Stylometry | ❌ Not started | M (optional; low ROI — deprioritize) |
| Clustering view / copy clusters | ❌ Flat sorted list only | S–M (group transitive pairs > threshold) |
| Side-by-side highlighted diff | ⚠️ Fragment list only, not aligned diff | M (LCS alignment over matched regions) |
| AI Grading (Gemini, rubric JSON, justification, override) | ❌ UI placeholder + `rubric_criteria` CRUD only | **Phase 3 main work (below)** |
| Teacher approval workflow ("Suggested" → "Approve") | ❌ Not started | M — needed before AI grades mean anything |
| Excel export (4 sheets, conditional formatting) | ❌ `rust_xlsxwriter` installed, zero code | **Phase 4 main work (below)** |
| PDF reports, parent email, audio feedback (Full release) | ❌ | Defer to post-launch |
| Installers (MSI/DMG), shortcuts, perf audit | ❌ | Phase 5 |

---

## 5. How to Make It Better — Phase 3 & 4 Design (Recommended)

### Phase 3: AI Grading (build this first — it's your killer feature)

**Backend — new `src-tauri/src/grading/` module:**
- `gemini.rs`: reqwest POST to `https://generativelang.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` (or configurable model). Read API key from settings. Send the prompt from the blueprint §6 with rubric JSON + model answer + student text.
- **Strict JSON output:** request `responseMimeType: "application/json"` (Gemini supports JSON mode natively — no fragile parsing) and a `responseSchema` matching `{"criteria": [{"criterion_id", "score", "justification"}], "total_score", "feedback"}`.
- **Chunking:** cap input at ~30k tokens; for longer submissions chunk by paragraphs and grade per-chunk against a per-criterion prompt, then aggregate.
- **Robustness:** retry once on malformed JSON/5xx; on final failure, return `error` so UI can retry per student.
- **Commands:** `grade_submission(pool, submission_id)` (reads rubric + extracted text, writes `grades`), `grade_all_assignment(...)` with concurrency limit (~3-4, Gemini free tier rate limits), `update_grade_override(...)` for teacher adjustments, `approve_grade(...)`.
- **Schema:** add `graded_by` (AI/teacher), `approved` (bool), `graded_at` to `grades` + `ai_feedback` on submissions. Every AI grade defaults to `approved=0` → shown as "Suggested" (Golden Rule #2).

**Frontend — new `Gradebook.tsx` page** (or tab inside AssignmentSubmissions):
- Table: student × criterion cells, each cell shows suggested score + click → justification panel.
- Inline edit for override; approval button per student + "Approve All Clean" bulk action.
- Left: rubric sidebar; right: extracted text viewer with justification anchored to it.

### Phase 4: Excel Export
- `src-tauri/src/export/xlsx.rs` using `rust_xlsxwriter`: 4 sheets exactly per blueprint §Module 4 (Summary with averages, Grade Sheet with per-criterion columns, Integrity Report from `similarity_results`, Feedback Log).
- Conditional formatting: red for flagged similarity pairs, green for approved grades, amber for suggested-but-not-approved.
- `export_gradebook(course_id, course_work_id, save_path?)` using `tauri-plugin-dialog` save picker; auto filename `ClassName_AssignmentName_Date.xlsx`.

### Phase 5 (after 3+4): Keychain secrets, MSI/DMG, tests, chunking, keyboard shortcuts.

---

## 6. Prioritized Action Plan (Suggested Order)

| # | Task | Effort |
|---|---|---|
| 1 | Fix §3.1 items 1–5 (login timeout, names, real settings, keychain-scope logout) | 1–2 days |
| 2 | Add unit tests for winnowing/TF-IDF/DOCX + a couple of fixture files | 1 day |
| 3 | Missing-submissions report (roster minus TURNED_IN) | 0.5 day |
| 4 | Phase 3: Gemini grading module + grades CRUD + Gradebook UI + approval workflow | 4–6 days |
| 5 | Phase 4: Excel export (4 sheets, formatting) | 2–3 days |
| 6 | Phase 5 polish: keychain, installers, lazy-loading, history persistence, clustering | 3–5 days |

**Total to a shippable v1.0: ~2–3 weeks of focused work.**

---

## 7. Things Worth Doing Differently (My Recommendations)

1. **Your architecture is genuinely good** — local-first, pure-Rust extraction, no Python dependency is exactly right for a distributable desktop app. Don't change it.
2. **Drop Layer 3 stylometry** from scope. It has weak evidence and high false-positive risk; your differentiator is pairwise + rubric grading. Spend that time on the approval workflow instead.
3. **Add incremental sync.** Right now every "Sync" re-fetches everything. Cache per-course etags/updated timestamps; this matters at 150+ students.
4. **Concurrency everywhere:** downloads, extraction, grading should be pooled in Rust with progress events to the frontend — not sequential loops in the UI.
5. **Persist everything:** similarity runs, AI grades, teacher overrides, per-assignment settings. Teachers expect history; you have the tables already.
6. **One small thing that sells the product:** after plagiarism check + AI grading, the Excel export must look *beautiful* out of the box. That's the screenshot teachers will share (Golden Rule #3).
