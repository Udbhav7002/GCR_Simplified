// ── GCR Simplified — Shared TypeScript Types ──
// These types mirror the Rust backend structs

export interface RubricCriterion {
  id: string;
  assignment_id: string;
  name: string;
  description: string | null;
  max_marks: number;
  sort_order: number;
}

export interface AppSettings {
  gemini_api_key?: string;
  gemini_model: string;
  default_fingerprint_threshold: number;
  default_semantic_threshold: number;
  theme: "light" | "dark" | "system";
  download_concurrency?: number;
  extraction_concurrency?: number;
  grading_concurrency?: number;
  grading_delay_seconds?: number;
}

export interface DashboardStats {
  total_courses: number;
  total_students: number;
  total_assignments: number;
  graded_submissions: number;
}

// ── Google Classroom Types ──

export interface GoogleAuthStatus {
  is_authenticated: boolean;
  email?: string;
  name?: string;
}

export interface GoogleCourse {
  id: string;
  name: string;
  section?: string;
  course_state: string;
  alternate_link: string;
  enrollment_code?: string;
}

export interface GoogleCourseWork {
  course_id: string;
  id: string;
  title: string;
  description?: string;
  max_points?: number;
  work_type: string;
  state: string;
}

export interface GoogleStudent {
  user_id: string;
  full_name: string;
  email_address?: string;
}

export interface GoogleAttachment {
  drive_file_id?: string;
  drive_file_title?: string;
  drive_file_link?: string;
  link_url?: string;
  link_title?: string;
}

export interface GoogleSubmission {
  id: string;
  course_id: string;
  course_work_id: string;
  user_id: string;
  student_name?: string;
  student_email?: string;
  state: string;
  late: boolean;
  assigned_grade?: number;
  attachments: GoogleAttachment[];
}

export interface MissingStudent {
  user_id: string;
  name: string;
  email?: string;
}

export interface DownloadResult {
  file_id: string;
  file_name: string;
  local_path: string;
  success: boolean;
  error?: string;
}

export interface DownloadProgress {
  completed: number;
  total: number;
  current: string;
  success: boolean;
}

// ── Text Extraction Types ──

export interface ExtractionResult {
  file_path: string;
  extracted_text: string;
  extraction_method: string;
  char_count: number;
  success: boolean;
  error?: string;
}

// ── Plagiarism Detection Types ──

export interface MatchedFragment {
  text_a: string;
  text_b: string;
  similarity: number;
}

export interface PairwiseResult {
  student_a_name: string;
  student_a_id: string;
  student_a_file: string;
  student_b_name: string;
  student_b_id: string;
  student_b_file: string;
  fingerprint_score: number;
  semantic_score: number;
  combined_score: number;
  flagged: boolean;
  is_identical_file: boolean;
  matched_fragments: MatchedFragment[];
}

export interface PlagiarismReport {
  course_id: string;
  course_work_id: string;
  total_submissions: number;
  pairs_checked: number;
  flagged_pairs: number;
  results: PairwiseResult[];
  fingerprint_threshold: number;
  semantic_threshold: number;
  created_at: string;
}

export interface PlagiarismRunMeta {
  id: string;
  course_id: string;
  course_work_id: string;
  created_at: string;
  total_submissions: number;
  pairs_checked: number;
  flagged_pairs: number;
  fingerprint_threshold: number;
  semantic_threshold: number;
}

// ── Grading Types ──

export interface Grade {
  id: string;
  submission_id: string;
  criterion_id: string;
  score: number | null;
  feedback: string | null;
  justification: string | null;
  graded_by: string;
  approved: boolean;
  graded_at: string | null;
}

export interface GradebookRow {
  submission_id: string;
  student_id: string;
  student_name: string;
  student_email: string | null;
  /** Roll number as stored locally (currently the Classroom user id). */
  roll_number: string;
  /** Registration number parsed from the uploaded filename, if any. */
  file_reg_no: string | null;
  /** Name parsed from the uploaded filename, if any. */
  file_name_hint: string | null;
  grading_status: string;
  ai_total_score: number | null;
  ai_feedback: string | null;
  /** "text" or "vision" (handwritten/scanned graded via Gemini vision). */
  graded_via: string;
  grades: Grade[];
}

export interface GradebookView {
  assignment_id: string;
  assignment_title: string;
  class_name: string;
  rubric: RubricCriterion[];
  rows: GradebookRow[];
}

export interface GradeSubmissionResult {
  submission_id: string;
  grades: Grade[];
  total_score: number;
  feedback: string;
  graded_at: string;
  /** "text" or "vision" (handwritten/scanned graded via Gemini vision). */
  graded_via: string;
}

export interface GradeAllResult {
  graded: GradeSubmissionResult[];
  failed: number;
  failed_names: string[];
}

export interface GradingProgressPayload {
  current: number;
  total: number;
  student_name: string;
  status: string;
}

export interface GradeOverride {
  grade_id: string;
  teacher_score: number;
  teacher_feedback?: string;
}
