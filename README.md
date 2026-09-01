<div align="center">

# 📚 GCR Simplified
### **Grade · Check · Report — Simplified**

*A local-first, privacy-focused desktop power tool that automates assignment evaluation, intra-class plagiarism detection, AI grading, and Excel gradebook generation on top of Google Classroom.*

[![Tauri v2](https://img.shields.io/badge/Tauri-v2.0-blue?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-1.80+-orange?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?logo=apple&logoColor=black)](https://github.com/Udbhav7002/GCR_Simplified/releases)

---

**[Download](#-download)** •
**[How to Use It](#-teacher-workflow-step-by-step)** •
**[Key Features](#-key-features)** •
**[Privacy](#-privacy--ferpa-compliance)** •
**[For Developers](#-for-developers)**

---

</div>

<br/>

## 🌟 Overview

Teachers spend upwards of **140+ hours per academic year** just marking assignments. Grading requires opening dozens of browser tabs, cross-referencing rubrics, manually looking for copied student work, and copy-pasting numbers into spreadsheets.

**GCR Simplified** eliminates this repetitive burden by sitting **directly on top of Google Classroom**:
* **Students don't need any new app:** They submit their PDFs, DOCX files, Google Docs — even **photos of handwritten pages** — on Google Classroom as usual.
* **Teachers get superpowers:** One-click batch sync, automated text extraction, offline peer-to-peer plagiarism checking, AI-assisted grading via Google Gemini, and an auto-exported Excel gradebook.
* **Local-First & Private:** Submissions and grading are processed **100% locally on your machine**.

---

## 📥 Download

**Latest release:** [v0.1.5 on GitHub Releases](https://github.com/Udbhav7002/GCR_Simplified/releases/tag/v0.1.5)

| Operating System | Download |
|----------|----------|
| **Windows** | [`GCR.Simplified_0.1.5_x64_en-US.msi`](https://github.com/Udbhav7002/GCR_Simplified/releases/download/v0.1.5/GCR.Simplified_0.1.5_x64_en-US.msi) |
| **Mac (Apple Silicon)** | [`GCR.Simplified_0.1.5_aarch64.dmg`](https://github.com/Udbhav7002/GCR_Simplified/releases/download/v0.1.5/GCR.Simplified_0.1.5_aarch64.dmg) |
| **Mac (Intel)** | [`GCR.Simplified_0.1.5_x64.dmg`](https://github.com/Udbhav7002/GCR_Simplified/releases/download/v0.1.5/GCR.Simplified_0.1.5_x64.dmg) |

**First-time Mac install:**
1. Open the `.dmg` and drag **GCR Simplified** to your **Applications** folder.
2. **Right-click** the app in Applications ▸ choose **Open** ▸ click **Open** again.
3. After this one time, it opens normally like any app.

---

## 🔄 Teacher Workflow (Step-by-Step)

Using GCR Simplified turns a 4-hour grading session into a 5-minute task. 

### Step 1: Connect your Accounts
* Open the app. Click **Connect Google Account** and sign in with the email you use for Google Classroom.
* (Optional) Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey) and paste it into the **Settings** page if you want the app to grade assignments for you.

### Step 2: Select an Assignment
* Click **Courses** in the sidebar, choose your class, and select an assignment.
* Click **Sync** to pull in the roster.

### Step 3: Download & Extract
* On the Submissions page, click **Download & extract**.
* The app will silently download every submission (PDFs, Docs, Images) and read the text out of them.

### Step 4: Check for Plagiarism (Optional)
* Click **Check Plagiarism**. The app will instantly compare every student's work against each other and flag anyone who copied (even if they changed a few words). 

### Step 5: Grade & Review
* Click **Gradebook**. 
* Click **Grade All (AI)**. The app will evaluate the submissions and suggest scores. (Handwritten photos are automatically read and graded using Gemini Vision).
* Review the scores. You can click any score to manually override it.
* Click **Approve All Suggested**.

### Step 6: Export
* Click **Export** to save a beautiful 4-sheet Excel Gradebook to your computer!
* Use the exported spreadsheet for your records or to manually enter scores into Google Classroom.

---

## 🚀 Key Features

* **Identical File Detection:** Catches students who download a classmate's file, rename it, and re-upload it — flagged instantly via SHA-256 binary hashing.
* **Handwriting Support:** Students can upload photos of handwritten pages. The app automatically reads and grades them via Gemini Vision.
* **Offline Plagiarism Engine:** Catches verbatim copying and paraphrased cheating without uploading student work to the cloud.
* **Auto-Generated Excel Gradebook:** Generates an institutional-grade `.xlsx` workbook containing class stats, the grade sheet, a plagiarism integrity report, and detailed AI feedback for every student.
* **Missing Submissions Tracker:** See who hasn't submitted at a glance.

---

## 🔒 Privacy & FERPA Compliance

* **Local-First Architecture:** All student data and files remain strictly on your local computer.
* **No Student Accounts:** Students never interact with this app. They just use Google Classroom normally.
* **Encrypted Storage:** Your Google login and API keys are stored securely in your computer's encrypted credential manager (Keychain/Credential Manager).

---

## 👨‍💻 For Developers

### Prerequisites
* Node.js v20+
* Rust Stable (`rustc`, `cargo`)
* [Tauri v2 Prerequisites](https://tauri.app/start/prerequisites/)

### Local Setup

```bash
git clone https://github.com/Udbhav7002/GCR_Simplified.git
cd GCR_Simplified
npm install
npm run tauri dev
```

### System Architecture

The project has been refactored into a clean Domain-Driven Design structure:

```text
GCR_Simplified/
├── src/                               # React 19 + TypeScript Frontend (Base UI / Vite)
│   ├── components/                    # UI Components (Gradebook, Submissions, Plagiarism)
│   ├── pages/                         # Route Views (Dashboard, Settings, CourseDetail, etc.)
│   └── lib/                           # Tauri IPC bridge & TypeScript types
│
└── src-tauri/                         # Rust Core Backend
    ├── src/
    │   ├── core/                      # Foundation: Database, Settings, Security, Maintenance
    │   ├── domain/                    # Business Logic:
    │   │   ├── google/                # OAuth2, Classroom, Drive, Gmail APIs
    │   │   ├── extraction/            # Document parsing (PDF, DOCX, OCR)
    │   │   ├── grading/               # AI Evaluation & Gemini Vision
    │   │   ├── plagiarism/            # Winnowing & TF-IDF Cosine algorithms
    │   │   └── export/                # Excel (.xlsx) Generation
    │   └── lib.rs                     # Tauri builder & command handler dispatch
    └── Cargo.toml                     # Rust crate dependencies
```

### Testing & Building

```bash
# Run Rust test suite
cd src-tauri && cargo test

# Build production installers (.dmg, .exe, .deb)
npm run tauri build
```

---

<div align="center">
  <sub>Built with ❤️ for educators everywhere.</sub>
</div>
