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

## 2. First launch (about 2 minutes)

The app opens on a **Getting Started** screen. Do both steps there — you do
**not** need Google Cloud Console.

1. Click **Connect Google** and sign in with the account you use for Classroom.
2. Click **Get a free key**, copy a Gemini API key from Google AI Studio, paste
   it, click **Save key**.
3. Click **Open my courses**.

> **If Google says “Access blocked”:** the app is still in testing, so only
> approved emails can sign in. Send the developer the Google email you use for
> Classroom. After they add you, try Connect again.
>
> You can skip the Gemini key if you only want plagiarism checks. AI grading
> needs the key.

---

## 3. What to try (10 minutes)

| Step | Where | What to expect |
|------|-------|----------------|
| **Sync your courses** | Courses page | Your Google Classroom courses appear |
| **Open an assignment** | Click a course → an assignment | Submission list |
| **Download & extract** | One button on the assignment page | Files downloaded, text extracted |
| **Check plagiarism** | Assignment page → Plagiarism | Offline similarity scores + side-by-side fragments |
| **AI grade** | Gradebook page | Gemini scores each rubric criterion with justifications |
| **Override / approve** | Gradebook page | Adjust any score; approve when happy |
| **Export gradebook** | Gradebook page | 4-sheet formatted Excel workbook |

**Privacy note:** submissions and plagiarism checks never leave the Mac. Only
the **AI grading** step sends submission text to Google Gemini.

---

## 4. Feedback for the student developer

Since this is a student project, structured feedback is hugely valuable. Please
answer (feel free to be blunt!):

1. **Was anything confusing or hard to figure out?** Where did you get stuck?
2. **Did first-launch setup (Connect Google + paste Gemini key) make sense?**
3. **Which feature is most/least useful** for your actual teaching workflow?
4. **Any bugs, crashes, or wrong behavior?** What were you doing when it happened?
5. **What's missing** that you'd expect from such a tool?
6. **Overall impression** — would you use something like this? Why or why not?

Drop your feedback in the shared doc, an email, or a voice note — anything works.

---

*Running `GCR Simplified 0.1.1` · Built with Tauri, React, and Rust.*
