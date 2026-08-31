use crate::core::commands::AppCancellationFlag;
use crate::core::db::DbPool;
use crate::domain::grading::gemini::{
    GeminiClient, GradingResult, RubricCriterion as GeminiRubricCriterion,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradingProgressPayload {
    pub current: usize,
    pub total: usize,
    pub student_name: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradeSubmissionResult {
    pub submission_id: String,
    pub grades: Vec<Grade>,
    pub total_score: f64,
    pub feedback: String,
    pub graded_at: String,
    /// "text" for typed submissions, "vision" when graded from handwriting.
    pub graded_via: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Grade {
    pub id: String,
    pub submission_id: String,
    pub criterion_id: String,
    pub score: Option<f64>,
    pub feedback: Option<String>,
    pub justification: Option<String>,
    pub graded_by: String,
    pub approved: bool,
    pub graded_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradebookView {
    pub assignment_id: String,
    pub assignment_title: String,
    pub class_name: String,
    pub rubric: Vec<RubricCriterion>,
    pub rows: Vec<GradebookRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradebookRow {
    pub submission_id: String,
    pub student_id: String,
    pub student_name: String,
    pub student_email: Option<String>,
    /// Roll number as stored locally (currently the Classroom user id).
    pub roll_number: String,
    /// Registration number parsed from the uploaded filename, if any.
    pub file_reg_no: Option<String>,
    /// Name parsed from the uploaded filename, if any.
    pub file_name_hint: Option<String>,
    pub grading_status: String,
    pub ai_total_score: Option<f64>,
    pub ai_feedback: Option<String>,
    /// "text" or "vision" (handwritten/scanned graded via Gemini vision).
    pub graded_via: String,
    pub grades: Vec<Grade>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RubricCriterion {
    pub id: String,
    pub assignment_id: String,
    pub name: String,
    pub description: Option<String>,
    pub max_marks: f64,
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradeOverride {
    pub grade_id: String,
    pub teacher_score: f64,
    pub teacher_feedback: Option<String>,
}

async fn get_rubric_criteria(
    pool: &DbPool,
    assignment_id: &str,
) -> Result<Vec<RubricCriterion>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, assignment_id, name, description, max_marks, sort_order
             FROM rubric_criteria WHERE assignment_id = ?1 ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;
    let criteria = stmt
        .query_map(params![assignment_id], |row| {
            Ok(RubricCriterion {
                id: row.get(0)?,
                assignment_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                max_marks: row.get(4)?,
                sort_order: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read rubric criteria: {}", e))?;
    Ok(criteria)
}

/// Rubric resolution for grading: use the teacher's criteria if any exist;
/// otherwise synthesize a single "Overall" criterion from the assignment's
/// total marks (synced from Google Classroom max points). This lets teachers
/// grade with just "this assignment is for X marks".
async fn ensure_rubric_criteria(
    pool: &DbPool,
    assignment_id: &str,
) -> Result<Vec<RubricCriterion>, String> {
    let existing = get_rubric_criteria(pool, assignment_id).await?;
    if !existing.is_empty() {
        return Ok(existing);
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    let max_score: Option<f64> = conn
        .query_row(
            "SELECT max_score FROM assignments WHERE id = ?1",
            params![assignment_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let Some(total) = max_score.filter(|t| *t > 0.0) else {
        return Err(
            "No rubric criteria and no total marks available. Add criteria in the Gradebook or re-sync the assignment from Google Classroom."
                .to_string(),
        );
    };

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO rubric_criteria (id, assignment_id, name, description, max_marks, sort_order)
         VALUES (?1, ?2, 'Overall', 'Auto-created from the assignment total marks', ?3, 1)",
        params![id, assignment_id, total],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    log::info!(
        "Created default 'Overall' criterion ({} marks) for assignment {}",
        total,
        assignment_id
    );
    get_rubric_criteria(pool, assignment_id).await
}

async fn get_submission_text(pool: &DbPool, submission_id: &str) -> Result<Option<String>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    match conn.query_row(
        "SELECT extracted_text FROM submissions WHERE id = ?1",
        params![submission_id],
        |row| row.get::<_, Option<String>>(0),
    ) {
        Ok(text) => Ok(text),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read submission text: {}", e)),
    }
}

async fn get_assignment_details(
    pool: &DbPool,
    assignment_id: &str,
) -> Result<(String, Option<String>), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let (title, model_answer): (String, Option<String>) = conn
        .query_row(
            "SELECT title, model_answer FROM assignments WHERE id = ?1",
            params![assignment_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok((title, model_answer))
}

async fn get_submissions_for_assignment(
    pool: &DbPool,
    assignment_id: &str,
) -> Result<
    Vec<(
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<f64>,
        Option<String>,
        String,
    )>,
    String,
> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.student_id, st.name, st.email, st.roll_number, s.file_reg_no, s.file_name,
                    s.grading_status, s.ai_total_score, s.ai_feedback, s.graded_via
             FROM submissions s
             JOIN students st ON s.student_id = st.id
             WHERE s.assignment_id = ?1
             ORDER BY st.name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![assignment_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
                row.get(10)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read submissions: {}", e))?;
    Ok(rows)
}

/// Locate the on-disk folder holding a student's downloaded files:
/// `app_data/submissions/{course_id}/{course_work_id}/{student_id}`.
async fn resolve_submission_dir(
    app: &AppHandle,
    pool: &DbPool,
    submission_id: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let (assignment_id, student_id): (String, String) = conn
        .query_row(
            "SELECT assignment_id, student_id FROM submissions WHERE id = ?1",
            params![submission_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Failed to read submission: {}", e))?;
    let course_id: String = conn
        .query_row(
            "SELECT class_id FROM assignments WHERE id = ?1",
            params![&assignment_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to read assignment: {}", e))?;
    drop(conn);

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = app_data
        .join("submissions")
        .join(&course_id)
        .join(&assignment_id)
        .join(&student_id);
    Ok(if dir.is_dir() { Some(dir) } else { None })
}

/// Persist how a submission was graded ("text" or "vision").
fn set_graded_via(pool: &DbPool, submission_id: &str, graded_via: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE submissions SET graded_via = ?1 WHERE id = ?2",
        params![graded_via, submission_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

async fn get_grades_for_submission(
    pool: &DbPool,
    submission_id: &str,
) -> Result<Vec<Grade>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, submission_id, criterion_id, score, feedback, justification, graded_by, approved, graded_at
             FROM grades WHERE submission_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let grades = stmt
        .query_map(params![submission_id], |row| {
            Ok(Grade {
                id: row.get(0)?,
                submission_id: row.get(1)?,
                criterion_id: row.get(2)?,
                score: row.get(3)?,
                feedback: row.get(4)?,
                justification: row.get(5)?,
                graded_by: row.get(6)?,
                approved: row.get::<_, i64>(7)? != 0,
                graded_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read grades: {}", e))?;
    Ok(grades)
}

/// DB row: (id, submission_id, criterion_id, score, feedback, justification, graded_by, approved, graded_at).
type DbGradeRow = (
    String,
    String,
    String,
    Option<f64>,
    Option<String>,
    Option<String>,
    String,
    i64,
    String,
);

fn grade_result_to_db_grades(
    submission_id: &str,
    result: &GradingResult,
    graded_by: &str,
) -> Vec<DbGradeRow> {
    let now = chrono::Utc::now().to_rfc3339();
    result
        .criteria
        .iter()
        .map(|c| {
            (
                uuid::Uuid::new_v4().to_string(),
                submission_id.to_string(),
                c.criterion_id.clone(),
                Some(c.score),
                None,
                Some(c.justification.clone()),
                graded_by.to_string(),
                0,
                now.clone(),
            )
        })
        .collect()
}

/// Criteria the teacher has already overridden for a submission. AI re-grades
/// must never overwrite these (Golden Rule: teacher judgement wins).
fn teacher_graded_criteria(
    pool: &DbPool,
    submission_id: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT criterion_id FROM grades WHERE submission_id = ?1 AND graded_by = 'teacher'",
        )
        .map_err(|e| e.to_string())?;
    let criteria: std::collections::HashSet<String> = stmt
        .query_map(params![submission_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read teacher criteria: {}", e))?
        .into_iter()
        .collect();
    Ok(criteria)
}

/// Set the AI feedback text on a submission (never touches totals/status).
fn conn_execute_feedback(pool: &DbPool, submission_id: &str, feedback: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE submissions SET ai_feedback = ?1 WHERE id = ?2",
        params![feedback, submission_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Recompute `ai_total_score` and `grading_status` for a submission from its
/// per-criterion grades. Keeps the Gradebook total and Excel export consistent
/// after teacher overrides.
fn recompute_submission_total(pool: &DbPool, submission_id: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let (total, count): (Option<f64>, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(score), 0), COUNT(*) FROM grades WHERE submission_id = ?1",
            params![submission_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let status = if count > 0 { "graded" } else { "ungraded" };
    conn.execute(
        "UPDATE submissions SET ai_total_score = ?1, grading_status = ?2 WHERE id = ?3",
        params![total, status, submission_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn grade_submission(
    app: AppHandle,
    pool: State<'_, DbPool>,
    submission_id: String,
) -> Result<GradeSubmissionResult, String> {
    let settings = crate::core::settings::load_settings(&pool)?;
    let api_key = settings
        .gemini_api_key
        .clone()
        .ok_or_else(|| "Gemini API key not configured. Please add it in Settings.".to_string())?;
    let client = GeminiClient::new(api_key, Some(settings.gemini_model.clone()))?;

    let extracted_text = get_submission_text(&pool, &submission_id)
        .await?
        .unwrap_or_default();

    let conn = pool.get().map_err(|e| e.to_string())?;
    let assignment_id: String = conn
        .query_row(
            "SELECT assignment_id FROM submissions WHERE id = ?1",
            params![&submission_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let rubric = ensure_rubric_criteria(&pool, &assignment_id).await?;
    if rubric.is_empty() {
        return Err("No rubric criteria defined for this assignment".to_string());
    }

    let (_, model_answer) = get_assignment_details(&pool, &assignment_id).await?;

    let gemini_rubric: Vec<GeminiRubricCriterion> = rubric
        .iter()
        .map(|r| GeminiRubricCriterion {
            id: r.id.clone(),
            name: r.name.clone(),
            description: r.description.clone(),
            max_marks: r.max_marks,
            sort_order: r.sort_order,
        })
        .collect();

    // Typed submissions grade from extracted text; handwritten/scanned ones
    // fall back to Gemini vision over their image/PDF files.
    let mut graded_via = "text";
    let grading_result = if !extracted_text.trim().is_empty() {
        client
            .grade_submission(&gemini_rubric, model_answer.as_deref(), &extracted_text)
            .await?
    } else {
        let dir = resolve_submission_dir(&app, pool.inner(), &submission_id).await?;
        let images = match dir {
            Some(dir) => super::vision::collect_vision_images(&dir)?,
            None => Vec::new(),
        };
        if images.is_empty() {
            return Err(
                "Submission has no extracted text and no gradable image/PDF files".to_string(),
            );
        }
        log::info!(
            "Grading {} via vision ({} file(s))",
            submission_id,
            images.len()
        );
        graded_via = "vision";
        client
            .grade_submission_vision(&gemini_rubric, model_answer.as_deref(), &images)
            .await?
    };

    let now = chrono::Utc::now().to_rfc3339();
    // Preserve teacher overrides: AI must never overwrite a teacher grade.
    let teacher_criteria = teacher_graded_criteria(&pool, &submission_id)?;
    let db_grades: Vec<DbGradeRow> =
        grade_result_to_db_grades(&submission_id, &grading_result, "ai")
            .into_iter()
            .filter(|row| !teacher_criteria.contains(&row.2))
            .collect();

    let conn = pool.get().map_err(|e| e.to_string())?;
    for (id, sub_id, crit_id, score, feedback, justification, graded_by, approved, graded_at) in
        &db_grades
    {
        conn.execute(
            "INSERT OR REPLACE INTO grades (id, submission_id, criterion_id, score, feedback, justification, graded_by, approved, graded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, sub_id, crit_id, score, feedback, justification, graded_by, approved, graded_at],
        )
        .map_err(|e| e.to_string())?;
    }
    drop(conn);

    conn_execute_feedback(&pool, &submission_id, &grading_result.feedback)?;
    recompute_submission_total(&pool, &submission_id)?;
    set_graded_via(&pool, &submission_id, graded_via)?;

    let grades = db_grades
        .into_iter()
        .map(
            |(
                id,
                sub_id,
                crit_id,
                score,
                feedback,
                justification,
                graded_by,
                approved,
                graded_at,
            )| Grade {
                id,
                submission_id: sub_id,
                criterion_id: crit_id,
                score,
                feedback,
                justification,
                graded_by,
                approved: approved != 0,
                graded_at: Some(graded_at),
            },
        )
        .collect();

    Ok(GradeSubmissionResult {
        submission_id,
        grades,
        total_score: grading_result.total_score,
        feedback: grading_result.feedback,
        graded_at: now,
        graded_via: graded_via.to_string(),
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradeAllResult {
    pub graded: Vec<GradeSubmissionResult>,
    pub failed: usize,
    pub failed_names: Vec<String>,
}

#[tauri::command]
pub async fn grade_all_assignment(
    app: AppHandle,
    pool: State<'_, DbPool>,
    cancel_flag: State<'_, AppCancellationFlag>,
    assignment_id: String,
) -> Result<GradeAllResult, String> {
    cancel_flag.0.reset();
    let settings = crate::core::settings::load_settings(&pool)?;
    let api_key = settings
        .gemini_api_key
        .clone()
        .ok_or_else(|| "Gemini API key not configured. Please add it in Settings.".to_string())?;
    let client = Arc::new(GeminiClient::new(
        api_key,
        Some(settings.gemini_model.clone()),
    )?);

    let rubric = ensure_rubric_criteria(&pool, &assignment_id).await?;
    if rubric.is_empty() {
        return Err("No rubric criteria defined for this assignment".to_string());
    }

    let (_, model_answer) = get_assignment_details(&pool, &assignment_id).await?;
    let submissions = get_submissions_for_assignment(&pool, &assignment_id).await?;
    let total = submissions.len();

    let gemini_rubric: Vec<GeminiRubricCriterion> = rubric
        .iter()
        .map(|r| GeminiRubricCriterion {
            id: r.id.clone(),
            name: r.name.clone(),
            description: r.description.clone(),
            max_marks: r.max_marks,
            sort_order: r.sort_order,
        })
        .collect();

    let concurrency = settings.grading_concurrency.clamp(1, 10);
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let progress_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut handles = Vec::new();

    for (submission_id, _student_id, student_name_opt, _email, _roll, _freg, _fname, _, _, _, _) in
        submissions
    {
        let client = client.clone();
        let rubric = gemini_rubric.clone();
        let model_answer = model_answer.clone();
        let pool = pool.inner().clone();
        let semaphore = semaphore.clone();
        let submission_id_clone = submission_id.clone();
        let student_name = student_name_opt.unwrap_or_else(|| "Unknown Student".to_string());
        let cancel = cancel_flag.0.clone();
        let app_handle = app.clone();
        let counter = progress_counter.clone();
        let grading_delay = settings.grading_delay_seconds;

        let handle = tokio::spawn(async move {
            if cancel.is_cancelled() {
                return Err("Grading cancelled by user".to_string());
            }

            let _permit = semaphore.acquire().await.ok();

            if cancel.is_cancelled() {
                return Err("Grading cancelled by user".to_string());
            }

            // Typed submissions grade from text; handwritten/scanned ones fall
            // back to Gemini vision over their downloaded image/PDF files.
            let extracted_text = match get_submission_text(&pool, &submission_id_clone).await {
                Ok(text) => text.unwrap_or_default(),
                Err(e) => {
                    log::warn!("Grading failed for {}: {}", student_name, e);
                    let curr = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    let _ = app_handle.emit(
                        "grading-progress",
                        GradingProgressPayload {
                            current: curr,
                            total,
                            student_name: student_name.clone(),
                            status: format!("failed: {}", e),
                        },
                    );
                    return Err(e);
                }
            };

            let mut vision_images: Vec<super::gemini::VisionImage> = Vec::new();
            if extracted_text.trim().is_empty() {
                let dir = resolve_submission_dir(&app_handle, &pool, &submission_id_clone)
                    .await
                    .ok()
                    .flatten();
                if let Some(dir) = dir {
                    match super::vision::collect_vision_images(&dir) {
                        Ok(images) => vision_images = images,
                        Err(e) => {
                            log::warn!("Failed to scan files for {}: {}", submission_id_clone, e)
                        }
                    }
                }
            }

            let grading_result = if !vision_images.is_empty() {
                log::info!(
                    "Grading {} via vision ({} file(s))",
                    submission_id_clone,
                    vision_images.len()
                );
                client
                    .grade_submission_vision(&rubric, model_answer.as_deref(), &vision_images)
                    .await
            } else if !extracted_text.trim().is_empty() {
                client
                    .grade_submission(&rubric, model_answer.as_deref(), &extracted_text)
                    .await
            } else {
                log::warn!(
                    "Skipping submission {}: no extracted text and no gradable files",
                    submission_id_clone
                );
                let curr = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                let _ = app_handle.emit(
                    "grading-progress",
                    GradingProgressPayload {
                        current: curr,
                        total,
                        student_name: student_name.clone(),
                        status: "skipped (no text or files)".to_string(),
                    },
                );
                return Err(format!("No gradable content for {}", student_name));
            };

            let grading_result = match grading_result {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("Grading failed for {}: {}", student_name, e);
                    let curr = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    let _ = app_handle.emit(
                        "grading-progress",
                        GradingProgressPayload {
                            current: curr,
                            total,
                            student_name: student_name.clone(),
                            status: format!("failed: {}", e),
                        },
                    );
                    return Err(e);
                }
            };

            let graded_via = if vision_images.is_empty() {
                "text"
            } else {
                "vision"
            };

            let now = chrono::Utc::now().to_rfc3339();
            // Preserve teacher overrides: AI must never overwrite a teacher grade.
            let teacher_criteria = teacher_graded_criteria(&pool, &submission_id_clone)?;
            let db_grades: Vec<DbGradeRow> =
                grade_result_to_db_grades(&submission_id_clone, &grading_result, "ai")
                    .into_iter()
                    .filter(|row| !teacher_criteria.contains(&row.2))
                    .collect();

            let conn = pool.get().map_err(|e| e.to_string())?;
            for (
                id,
                sub_id,
                crit_id,
                score,
                feedback,
                justification,
                graded_by,
                approved,
                graded_at,
            ) in &db_grades
            {
                conn.execute(
                    "INSERT OR REPLACE INTO grades (id, submission_id, criterion_id, score, feedback, justification, graded_by, approved, graded_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![id, sub_id, crit_id, score, feedback, justification, graded_by, approved, graded_at],
                )
                .map_err(|e| e.to_string())?;
            }
            drop(conn);

            conn_execute_feedback(&pool, &submission_id_clone, &grading_result.feedback)?;
            recompute_submission_total(&pool, &submission_id_clone)?;
            set_graded_via(&pool, &submission_id_clone, graded_via)?;

            let curr = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            let _ = app_handle.emit(
                "grading-progress",
                GradingProgressPayload {
                    current: curr,
                    total,
                    student_name: student_name.clone(),
                    status: if graded_via == "vision" {
                        "graded (handwriting)".to_string()
                    } else {
                        "graded".to_string()
                    },
                },
            );

            let grades = db_grades
                .into_iter()
                .map(
                    |(
                        id,
                        sub_id,
                        crit_id,
                        score,
                        feedback,
                        justification,
                        graded_by,
                        approved,
                        graded_at,
                    )| Grade {
                        id,
                        submission_id: sub_id,
                        criterion_id: crit_id,
                        score,
                        feedback,
                        justification,
                        graded_by,
                        approved: approved != 0,
                        graded_at: Some(graded_at),
                    },
                )
                .collect();

            if grading_delay > 0 {
                tokio::time::sleep(std::time::Duration::from_secs(grading_delay)).await;
            }
            Ok(GradeSubmissionResult {
                submission_id: submission_id_clone,
                grades,
                total_score: grading_result.total_score,
                feedback: grading_result.feedback,
                graded_at: now,
                graded_via: graded_via.to_string(),
            })
        });

        handles.push(handle);
    }

    let mut graded = Vec::new();
    let mut failed_names = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(result)) => graded.push(result),
            Ok(Err(e)) => {
                log::warn!("Grading task error: {}", e);
                failed_names.push(e);
            }
            Err(e) => {
                log::error!("Task join error: {}", e);
                failed_names.push(format!("task join error: {}", e));
            }
        }
    }

    Ok(GradeAllResult {
        failed: failed_names.len(),
        graded,
        failed_names,
    })
}

#[tauri::command]
pub async fn update_grade_override(
    pool: State<'_, DbPool>,
    grade_id: String,
    teacher_score: f64,
    teacher_feedback: Option<String>,
) -> Result<Grade, String> {
    update_grade_override_impl(&pool, grade_id, teacher_score, teacher_feedback).await
}

async fn update_grade_override_impl(
    pool: &DbPool,
    grade_id: String,
    teacher_score: f64,
    teacher_feedback: Option<String>,
) -> Result<Grade, String> {
    if !teacher_score.is_finite() || teacher_score < 0.0 {
        return Err("Teacher score must be a non-negative finite number".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;

    // Check bounds against criterion max_marks
    let (max_marks, criterion_name): (f64, String) = conn
        .query_row(
            "SELECT rc.max_marks, rc.name FROM grades g
             JOIN rubric_criteria rc ON rc.id = g.criterion_id
             WHERE g.id = ?1",
            params![&grade_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Criterion lookup failed: {}", e))?;

    if teacher_score > max_marks {
        return Err(format!(
            "Score ({:.2}) cannot exceed criterion max marks ({:.2}) for '{}'",
            teacher_score, max_marks, criterion_name
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE grades SET score = ?1, feedback = ?2, graded_by = 'teacher', graded_at = ?3 WHERE id = ?4",
        params![teacher_score, teacher_feedback, now, &grade_id],
    )
    .map_err(|e| e.to_string())?;

    let submission_id: String = conn
        .query_row(
            "SELECT submission_id FROM grades WHERE id = ?1",
            params![&grade_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    drop(conn);

    // Keep the submission total and Gradebook consistent with the override.
    recompute_submission_total(pool, &submission_id)?;

    let conn = pool.get().map_err(|e| e.to_string())?;
    let grade: Grade = conn
        .query_row(
            "SELECT id, submission_id, criterion_id, score, feedback, justification, graded_by, approved, graded_at
             FROM grades WHERE id = ?1",
            params![&grade_id],
            |row| {
                Ok(Grade {
                    id: row.get(0)?,
                    submission_id: row.get(1)?,
                    criterion_id: row.get(2)?,
                    score: row.get(3)?,
                    feedback: row.get(4)?,
                    justification: row.get(5)?,
                    graded_by: row.get(6)?,
                    approved: row.get::<_, i64>(7)? != 0,
                    graded_at: row.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(grade)
}

#[tauri::command]
pub async fn approve_grade(
    pool: State<'_, DbPool>,
    grade_id: String,
    approved: bool,
) -> Result<Grade, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let approved_int = if approved { 1 } else { 0 };

    conn.execute(
        "UPDATE grades SET approved = ?1 WHERE id = ?2",
        params![approved_int, &grade_id],
    )
    .map_err(|e| e.to_string())?;

    let grade: Grade = conn
        .query_row(
            "SELECT id, submission_id, criterion_id, score, feedback, justification, graded_by, approved, graded_at
             FROM grades WHERE id = ?1",
            params![&grade_id],
            |row| {
                Ok(Grade {
                    id: row.get(0)?,
                    submission_id: row.get(1)?,
                    criterion_id: row.get(2)?,
                    score: row.get(3)?,
                    feedback: row.get(4)?,
                    justification: row.get(5)?,
                    graded_by: row.get(6)?,
                    approved: row.get::<_, i64>(7)? != 0,
                    graded_at: row.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(grade)
}

#[tauri::command]
pub async fn approve_all_grades(
    pool: State<'_, DbPool>,
    assignment_id: String,
) -> Result<usize, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE grades SET approved = 1
             WHERE submission_id IN (SELECT id FROM submissions WHERE assignment_id = ?1)
             AND graded_by = 'ai' AND approved = 0",
            params![&assignment_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed)
}

#[tauri::command]
pub async fn get_gradebook(
    pool: State<'_, DbPool>,
    assignment_id: String,
) -> Result<GradebookView, String> {
    let rubric = ensure_rubric_criteria(&pool, &assignment_id).await?;
    let (assignment_title, _) = get_assignment_details(&pool, &assignment_id).await?;

    let conn = pool.get().map_err(|e| e.to_string())?;
    let class_name: String = conn
        .query_row(
            "SELECT c.name FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = ?1",
            params![&assignment_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "Unknown Class".to_string());
    drop(conn);

    let submissions = get_submissions_for_assignment(&pool, &assignment_id).await?;

    let mut rows = Vec::new();
    for (
        submission_id,
        student_id,
        student_name_opt,
        student_email,
        roll_number,
        file_reg_no,
        file_name_hint,
        grading_status,
        ai_total_score,
        ai_feedback,
        graded_via,
    ) in submissions
    {
        let grades = get_grades_for_submission(&pool, &submission_id).await?;
        rows.push(GradebookRow {
            submission_id,
            student_id,
            student_name: student_name_opt.unwrap_or_else(|| "Unknown Student".to_string()),
            student_email,
            roll_number,
            file_reg_no,
            file_name_hint,
            grading_status,
            ai_total_score,
            ai_feedback,
            graded_via,
            grades,
        });
    }

    Ok(GradebookView {
        assignment_id,
        assignment_title,
        class_name,
        rubric,
        rows,
    })
}

#[tauri::command]
pub async fn push_grades_to_classroom(
    assignment_id: String,
    course_id: String,
    course_work_id: String,
    state: tauri::State<'_, crate::db::DbPool>,
) -> Result<usize, String> {
    let view = get_gradebook(state.clone(), assignment_id.clone()).await?;

    let mut count = 0;
    for row in view.rows {
        // We consider a row "approved" if it has any approved grade.
        let has_approved = row.grades.iter().any(|g| g.approved);
        if has_approved {
            let total = row.grades.iter().filter_map(|g| g.score).sum::<f64>();
            crate::domain::google::grades::push_grade_to_classroom(
                &state,
                &course_id,
                &course_work_id,
                &row.submission_id,
                total,
            )
            .await?;
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::db;
    use crate::domain::grading::gemini::CriterionGrade;
    use std::path::PathBuf;

    fn temp_db() -> (DbPool, PathBuf) {
        let path = std::env::temp_dir().join(format!("gcr_test_{}.db", uuid::Uuid::new_v4()));
        let pool = db::init_db(path.clone()).unwrap();
        (pool, path)
    }

    fn seed_submission(pool: &DbPool, assignment_id: &str, student_id: &str, submission_id: &str) {
        let conn = pool.get().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute_batch(&format!(
            "INSERT INTO classes (id, name, created_at, updated_at) VALUES ('c1', 'Course', '{n}', '{n}');
             INSERT INTO students (id, class_id, roll_number, name, created_at) VALUES ('{s}', 'c1', '{s}', 'Student', '{n}');
             INSERT INTO assignments (id, class_id, title, status, created_at, updated_at) VALUES ('{a}', 'c1', 'Assignment', 'Active', '{n}', '{n}');
             INSERT INTO submissions (id, assignment_id, student_id, status, created_at) VALUES ('{sid}', '{a}', '{s}', 'ungraded', '{n}');",
            n = now, a = assignment_id, s = student_id, sid = submission_id
        ))
        .unwrap();
    }

    fn insert_grade(
        pool: &DbPool,
        submission_id: &str,
        criterion_id: &str,
        score: f64,
        graded_by: &str,
    ) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO grades (id, submission_id, criterion_id, score, justification, graded_by, approved, graded_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, 0, NULL)",
            params![uuid::Uuid::new_v4().to_string(), submission_id, criterion_id, score, graded_by],
        )
        .unwrap();
    }

    fn rubric_criteria(pool: &DbPool, assignment_id: &str) -> Vec<RubricCriterion> {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO rubric_criteria (id, assignment_id, name, max_marks, sort_order) VALUES ('r1', ?1, 'C1', 10, 1), ('r2', ?1, 'C2', 10, 2)",
            params![assignment_id],
        )
        .unwrap();
        block(get_rubric_criteria(pool, assignment_id))
    }

    /// Run a small async DB helper on a current-thread runtime.
    fn block<T>(future: impl std::future::Future<Output = Result<T, String>>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
            .unwrap()
    }

    #[test]
    fn teacher_grades_survive_ai_regrade() {
        let (pool, path) = temp_db();
        let assignment = "a1".to_string();
        let student = "stu1".to_string();
        let submission = "sub1".to_string();
        seed_submission(&pool, &assignment, &student, &submission);

        let criteria = rubric_criteria(&pool, &assignment);
        insert_grade(&pool, &submission, &criteria[0].id, 8.0, "teacher");
        insert_grade(&pool, &submission, &criteria[1].id, 6.0, "ai");

        // Simulate re-grading: AI result for both criteria.
        let grading_result = GradingResult {
            criteria: vec![
                CriterionGrade {
                    criterion_id: criteria[0].id.clone(),
                    score: 1.0,
                    justification: "AI low".to_string(),
                },
                CriterionGrade {
                    criterion_id: criteria[1].id.clone(),
                    score: 9.0,
                    justification: "AI high".to_string(),
                },
            ],
            total_score: 10.0,
            feedback: "AI feedback".to_string(),
        };

        let teacher_criteria = teacher_graded_criteria(&pool, &submission).unwrap();
        let db_grades: Vec<DbGradeRow> =
            grade_result_to_db_grades(&submission, &grading_result, "ai")
                .into_iter()
                .filter(|row| !teacher_criteria.contains(&row.2))
                .collect();

        let conn = pool.get().unwrap();
        for (id, sub_id, crit_id, score, feedback, justification, graded_by, approved, graded_at) in
            &db_grades
        {
            conn.execute(
                "INSERT OR REPLACE INTO grades (id, submission_id, criterion_id, score, feedback, justification, graded_by, approved, graded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![id, sub_id, crit_id, score, feedback, justification, graded_by, approved, graded_at],
            )
            .unwrap();
        }

        // Teacher criterion must still be teacher-graded with the original score.
        let grades = block(get_grades_for_submission(&pool, &submission));
        let teacher_grade = grades
            .iter()
            .find(|g| g.criterion_id == criteria[0].id)
            .unwrap();
        assert_eq!(teacher_grade.graded_by, "teacher");
        assert!((teacher_grade.score.unwrap() - 8.0).abs() < 1e-9);
        // AI criterion was refreshed.
        let ai_grade = grades
            .iter()
            .find(|g| g.criterion_id == criteria[1].id)
            .unwrap();
        assert_eq!(ai_grade.graded_by, "ai");
        assert!((ai_grade.score.unwrap() - 9.0).abs() < 1e-9);

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn recompute_total_reflects_all_grades() {
        let (pool, path) = temp_db();
        let assignment = "a1".to_string();
        let student = "stu1".to_string();
        let submission = "sub1".to_string();
        seed_submission(&pool, &assignment, &student, &submission);
        let criteria = rubric_criteria(&pool, &assignment);
        insert_grade(&pool, &submission, &criteria[0].id, 8.0, "ai");
        insert_grade(&pool, &submission, &criteria[1].id, 7.5, "teacher");

        recompute_submission_total(&pool, &submission).unwrap();

        let conn = pool.get().unwrap();
        let (total, status): (Option<f64>, String) = conn
            .query_row(
                "SELECT ai_total_score, grading_status FROM submissions WHERE id = ?1",
                params![submission],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!((total.unwrap() - 15.5).abs() < 1e-9);
        assert_eq!(status, "graded");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn recompute_total_handles_no_grades() {
        let (pool, path) = temp_db();
        let assignment = "a1".to_string();
        let student = "stu1".to_string();
        let submission = "sub1".to_string();
        seed_submission(&pool, &assignment, &student, &submission);

        recompute_submission_total(&pool, &submission).unwrap();

        let conn = pool.get().unwrap();
        let (total, status): (Option<f64>, String) = conn
            .query_row(
                "SELECT ai_total_score, grading_status FROM submissions WHERE id = ?1",
                params![submission],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!((total.unwrap() - 0.0).abs() < 1e-9);
        assert_eq!(status, "ungraded");

        std::fs::remove_file(&path).ok();
    }
    /// Run a small async DB helper on a current-thread runtime and return Result.
    fn block_result<T>(
        future: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn test_update_grade_override() {
        let (pool, path) = temp_db();
        let assignment = "a1".to_string();
        let student = "stu1".to_string();
        let submission = "sub1".to_string();
        seed_submission(&pool, &assignment, &student, &submission);
        let criteria = rubric_criteria(&pool, &assignment);

        // Insert an initial AI grade
        let grade_id = uuid::Uuid::new_v4().to_string();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO grades (id, submission_id, criterion_id, score, justification, graded_by, approved, graded_at)
                 VALUES (?1, ?2, ?3, ?4, NULL, 'ai', 0, NULL)",
                params![&grade_id, &submission, &criteria[0].id, 5.0],
            ).unwrap();
        }

        // Run the override command
        let updated_grade = block(update_grade_override_impl(
            &pool,
            grade_id.clone(),
            8.0,
            Some("Good improvement".to_string()),
        ));

        // Verify the returned grade object
        assert_eq!(updated_grade.graded_by, "teacher");
        assert_eq!(updated_grade.score, Some(8.0));
        assert_eq!(updated_grade.feedback, Some("Good improvement".to_string()));

        // Verify it was saved in the DB
        let conn = pool.get().unwrap();
        let (db_score, db_feedback, db_graded_by): (f64, String, String) = conn
            .query_row(
                "SELECT score, feedback, graded_by FROM grades WHERE id = ?1",
                params![&grade_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(db_score, 8.0);
        assert_eq!(db_feedback, "Good improvement");
        assert_eq!(db_graded_by, "teacher");

        // Verify bounds check
        let result = block_result(update_grade_override_impl(
            &pool,
            grade_id.clone(),
            15.0, // max is 10 for criteria[0]
            None,
        ));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("cannot exceed criterion max marks"));

        std::fs::remove_file(&path).ok();
    }
}
