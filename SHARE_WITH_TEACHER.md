# GCR Simplified — Try It Out (v0.1.1)

> **Grade · Check · Report — Simplified.** An app that sits on top of Google
> Classroom to download submissions, check for copied work, AI-grade against a
> rubric, and export an Excel gradebook. Everything except AI grading runs
> **100% locally** on your Mac.

---

## 1. Download & Install (2 minutes)

1. Open the download link we shared (GitHub Releases).
2. Download the file that matches your Mac:
   - **Apple Silicon (M1/M2/M3/M4/M5)** → `GCR Simplified_0.1.1_aarch64.dmg`
   - **Intel Mac** → `GCR Simplified_0.1.1_x64.dmg`
   - Not sure? Click the Apple menu → **About This Mac**. If it shows "Chip:
     Apple M1/M2/M3/M4" choose the `aarch64` file. If it shows an Intel chip,
     choose the `x64` file.
3. Open the `.dmg`, then drag the **GCR Simplified** icon into your **Applications** folder.
4. **Important (first time only):** because the app isn't signed with an Apple
   Developer certificate, macOS will block it. To open it anyway:
   - In **Finder**, go to your **Applications** folder
   - **Right-click** the GCR Simplified app → click **Open**
   - Click **Open** again in the popup that appears
   - After this first time, you can open it normally like any app.

> If you don't want to see that warning, you can also open **System Settings →
> Privacy & Security** and click **Open Anyway** next to "GCR Simplified was
> blocked from opening."

---

## 2. Connect Google Classroom (3 minutes)

The app needs your own free Google Cloud credentials to talk to Google
Classroom. Follow the README's **[Google Cloud Console Setup](../../README.md#-google-cloud-console-setup)**:

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) → create a project.
2. Enable **Google Classroom API** and **Google Drive API**.
3. Set up the **OAuth consent screen** (External), add your Google account as a
   **Test User** — *this is the step people miss, and the app won't sign in without it*.
4. Create an **OAuth client ID** → type **Desktop app** → copy the **Client ID**
   and **Client Secret**.
5. In GCR Simplified: **Settings → Connect Google Account** → paste the two
   values → click **Connect Google Account** and approve the sign-in.

On first launch the app shows a **Setup Guide** checklist that walks through
this and the next step.

---

## 3. Add your Gemini API key (2 minutes)

1. Get a free key from [Google AI Studio](https://aistudio.google.com/apikey).
2. In the app: **Settings → AI Configuration** → paste the key → **Save**.
3. Optional: also set default plagiarism thresholds in **Settings**.

---

## 4. What to try (10 minutes)

| Step | Where | What to expect |
|------|-------|----------------|
| **Sync your courses** | Courses page | Your Google Classroom courses appear |
| **Open an assignment** | Click a course → an assignment | Submission list + download buttons |
| **Download & extract** | Assignment page | Submissions downloaded, text extracted |
| **Check plagiarism** | Assignment page → Plagiarism | Offline similarity scores + side-by-side fragments |
| **AI grade** | Gradebook page | Gemini scores each rubric criterion with justifications |
| **Override / approve** | Gradebook page | Adjust any score; approve when happy |
| **Export gradebook** | Gradebook page | 4-sheet formatted Excel workbook |

**Privacy note:** submissions and plagiarism checks never leave the Mac. Only
the **AI grading** step sends submission text to Google Gemini.

---

## 5. Feedback for the student developer

Since this is a student project, structured feedback is hugely valuable. Please
answer (feel free to be blunt!):

1. **Was anything confusing or hard to figure out?** Where did you get stuck?
2. **Did the setup (Google Cloud + Gemini key) make sense?** What would you change?
3. **Which feature is most/least useful** for your actual teaching workflow?
4. **Any bugs, crashes, or wrong behavior?** What were you doing when it happened?
5. **What's missing** that you'd expect from such a tool?
6. **Overall impression** — would you use something like this? Why or why not?

Drop your feedback in the shared doc, an email, or a voice note — anything works.

---

*Running `GCR Simplified 0.1.1` · Built with Tauri, React, and Rust.*
