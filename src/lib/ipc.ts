// ── GCR Simplified — Typed IPC Wrappers ──
// Wraps Tauri invoke() calls with proper TypeScript types

import { invoke } from "@tauri-apps/api/core";
import type {
  RubricCriterion,
  GoogleAuthStatus,
  GoogleCourse,
  GoogleCourseWork,
  GoogleStudent,
  GoogleSubmission,
  MissingStudent,
  DownloadResult,
  ExtractionResult,
  PlagiarismReport,
  PlagiarismRunMeta,
  AppSettings,
  Grade,
  GradebookView,
  GradeAllResult,
  GradeOverride,
  DashboardStats,
} from "./types";

// ── Rubric Criteria ──

export async function createRubricCriterion(params: {
  assignmentId: string;
  name: string;
  description?: string;
  maxMarks: number;
  sortOrder: number;
}): Promise<RubricCriterion> {
  return invoke<RubricCriterion>("create_rubric_criterion", {
    assignmentId: params.assignmentId,
    name: params.name,
    description: params.description ?? null,
    maxMarks: params.maxMarks,
    sortOrder: params.sortOrder,
  });
}

export async function deleteRubricCriterion(id: string): Promise<void> {
  return invoke<void>("delete_rubric_criterion", { id });
}

// ── Cancellation ──

export async function cancelActiveTasks(): Promise<void> {
  return invoke<void>("cancel_active_tasks");
}

// ── Google Auth ──

export async function startGoogleLogin(): Promise<GoogleAuthStatus> {
  return invoke<GoogleAuthStatus>("start_google_login");
}

export async function cancelGoogleLogin(): Promise<void> {
  return invoke<void>("cancel_google_login");
}

export async function getGoogleAuthStatus(): Promise<GoogleAuthStatus> {
  return invoke<GoogleAuthStatus>("get_google_auth_status");
}

export async function googleLogout(): Promise<void> {
  return invoke<void>("google_logout");
}

// ── Google Classroom ──

export async function listGoogleCourses(force?: boolean): Promise<GoogleCourse[]> {
  return invoke<GoogleCourse[]>("list_google_courses", { force: force ?? false });
}

export async function listGoogleCoursework(courseId: string, force?: boolean): Promise<GoogleCourseWork[]> {
  return invoke<GoogleCourseWork[]>("list_google_coursework", { courseId, force: force ?? false });
}

export async function listGoogleStudents(courseId: string, force?: boolean): Promise<GoogleStudent[]> {
  return invoke<GoogleStudent[]>("list_google_students", { courseId, force: force ?? false });
}

export async function listGoogleSubmissions(
  courseId: string,
  courseWorkId: string,
  force?: boolean
): Promise<GoogleSubmission[]> {
  return invoke<GoogleSubmission[]>("list_google_submissions", { courseId, courseWorkId, force: force ?? false });
}

export async function getMissingSubmissions(courseId: string, courseWorkId: string): Promise<MissingStudent[]> {
  return invoke<MissingStudent[]>("get_missing_submissions", { courseId, courseWorkId });
}


export async function downloadSubmissionFile(params: {
  fileId: string;
  fileName: string;
  courseId: string;
  courseWorkId: string;
  studentId: string;
}): Promise<DownloadResult> {
  return invoke<DownloadResult>("download_submission_file", {
    fileId: params.fileId,
    fileName: params.fileName,
    courseId: params.courseId,
    courseWorkId: params.courseWorkId,
    studentId: params.studentId,
  });
}

export async function downloadAllSubmissions(courseId: string, courseWorkId: string): Promise<DownloadResult[]> {
  return invoke<DownloadResult[]>("download_all_submissions", { courseId, courseWorkId });
}

// ── Text Extraction ──

export async function extractAllSubmissions(courseId: string, courseWorkId: string): Promise<ExtractionResult[]> {
  return invoke<ExtractionResult[]>("extract_all_submissions", { courseId, courseWorkId });
}

// ── Plagiarism Detection ──

export async function runPlagiarismCheck(
  courseId: string,
  courseWorkId: string,
  fingerprintThreshold?: number,
  semanticThreshold?: number
): Promise<PlagiarismReport> {
  return invoke<PlagiarismReport>("run_plagiarism_check", {
    courseId,
    courseWorkId,
    fingerprintThreshold: fingerprintThreshold ?? null,
    semanticThreshold: semanticThreshold ?? null,
  });
}

export async function listPlagiarismRuns(courseId: string, courseWorkId: string): Promise<PlagiarismRunMeta[]> {
  return invoke<PlagiarismRunMeta[]>("list_plagiarism_runs", { courseId, courseWorkId });
}

export async function getPlagiarismRun(runId: string): Promise<PlagiarismReport> {
  return invoke<PlagiarismReport>("get_plagiarism_run", { runId });
}

// ── Settings ──

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

// ── Grading ──

export async function gradeAllAssignment(assignmentId: string): Promise<GradeAllResult> {
  return invoke<GradeAllResult>("grade_all_assignment", { assignmentId });
}

export async function updateGradeOverride(params: GradeOverride): Promise<Grade> {
  return invoke<Grade>("update_grade_override", {
    grade_id: params.grade_id,
    teacher_score: params.teacher_score,
    teacher_feedback: params.teacher_feedback,
  });
}

export async function approveGrade(gradeId: string, approved: boolean): Promise<Grade> {
  return invoke<Grade>("approve_grade", { gradeId, approved });
}

export async function approveAllGrades(assignmentId: string): Promise<number> {
  return invoke<number>("approve_all_grades", { assignmentId });
}

export async function getGradebook(assignmentId: string): Promise<GradebookView> {
  return invoke<GradebookView>("get_gradebook", { assignmentId });
}

export async function pushGradesToClassroom(
  assignmentId: string,
  courseId: string,
  courseWorkId: string
): Promise<number> {
  return invoke<number>("push_grades_to_classroom", { assignmentId, courseId, courseWorkId });
}

// ── Export ──

export async function exportGradebook(params: {
  assignmentId: string;
  courseId?: string;
  courseWorkId?: string;
  savePath?: string;
}): Promise<string> {
  return invoke<string>("export_gradebook", {
    options: {
      assignment_id: params.assignmentId,
      course_id: params.courseId ?? null,
      course_work_id: params.courseWorkId ?? null,
      save_path: params.savePath ?? null,
    }
  });
}

// ── Dashboard ──

export async function getDashboardStats(): Promise<DashboardStats> {
  return invoke<DashboardStats>("get_dashboard_stats");
}

// ── Maintenance ──

export async function purgeDownloadedSubmissions(): Promise<number> {
  return invoke<number>("purge_downloaded_submissions");
}

export async function purgePlagiarismRuns(olderThanDays?: number): Promise<number> {
  return invoke<number>("purge_plagiarism_runs", { olderThanDays: olderThanDays ?? null });
}

export async function backupDatabase(destPath: string): Promise<string> {
  return invoke<string>("backup_database", { destPath });
}

export async function restoreDatabase(sourcePath: string): Promise<string> {
  return invoke<string>("restore_database", { sourcePath });
}

