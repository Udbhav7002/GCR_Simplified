use crate::db::DbPool;
use crate::grading::gemini::{
    GeminiClient, GradingResult, RubricCriterion as GeminiRubricCriterion,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Semaphore;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradeSubmissionResult {
    pub submission_id: String,
    pub grades: Vec<Grade>,
    pub total_score: f64,
    pub feedback: String,
    pub graded_at: String,
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
    pub rubric: Vec<RubricCriterion>,
    pub rows: Vec<GradebookRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradebookRow {
    pub submission_id: String,
    pub student_id: String,
    pub student_name: String,
    pub student_email: Option<String>,
    pub grading_status: String,
    pub ai_total_score: Option<f64>,
    pub ai_feedback: Option<String>,
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
        .filter_map(|r| r.ok())
        .collect();
    Ok(criteria)
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
        Option<f64>,
        Option<String>,
    )>,
    String,
> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.student_id, st.name, st.email, s.grading_status, s.ai_total_score, s.ai_feedback
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
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
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
        .filter_map(|r| r.ok())
        .collect();
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
    let criteria = stmt
        .query_map(params![submission_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
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
    pool: State<'_, DbPool>,
    submission_id: String,
) -> Result<GradeSubmissionResult, String> {
    let settings = crate::commands::settings::load_settings(&pool)?;
    let api_key = settings
        .gemini_api_key
        .clone()
        .ok_or_else(|| "Gemini API key not configured. Please add it in Settings.".to_string())?;
    let client = GeminiClient::new(api_key, Some(settings.gemini_model.clone()));

    let submission_text = get_submission_text(&pool, &submission_id)
        .await?
        .ok_or("Submission has no extracted text".to_string())?;

    let conn = pool.get().map_err(|e| e.to_string())?;
    let assignment_id: String = conn
        .query_row(
            "SELECT assignment_id FROM submissions WHERE id = ?1",
            params![&submission_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let rubric = get_rubric_criteria(&pool, &assignment_id).await?;
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

    let grading_result = client
        .grade_submission(&gemini_rubric, model_answer.as_deref(), &submission_text)
        .await?;

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
    _app: AppHandle,
    pool: State<'_, DbPool>,
    assignment_id: String,
) -> Result<GradeAllResult, String> {
    let settings = crate::commands::settings::load_settings(&pool)?;
    let api_key = settings
        .gemini_api_key
        .clone()
        .ok_or_else(|| "Gemini API key not configured. Please add it in Settings.".to_string())?;
    let client = Arc::new(GeminiClient::new(
        api_key,
        Some(settings.gemini_model.clone()),
    ));

    let rubric = get_rubric_criteria(&pool, &assignment_id).await?;
    if rubric.is_empty() {
        return Err("No rubric criteria defined for this assignment".to_string());
    }

    let (_, model_answer) = get_assignment_details(&pool, &assignment_id).await?;
    let submissions = get_submissions_for_assignment(&pool, &assignment_id).await?;

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

    let semaphore = Arc::new(Semaphore::new(3));
    let mut handles = Vec::new();

    for (submission_id, _student_id, student_name_opt, _email, _, _, _) in submissions {
        let client = client.clone();
        let rubric = gemini_rubric.clone();
        let model_answer = model_answer.clone();
        let pool = pool.inner().clone();
        let semaphore = semaphore.clone();
        let submission_id_clone = submission_id.clone();
        let student_name = student_name_opt.unwrap_or_else(|| "Unknown Student".to_string());

        let handle = tokio::spawn(async move {
            let _permit = semaphore.acquire().await.ok();

            let submission_text = match get_submission_text(&pool, &submission_id_clone).await {
                Ok(Some(text)) if !text.trim().is_empty() => text,
                _ => {
                    log::warn!(
                        "Skipping submission {}: no extracted text",
                        submission_id_clone
                    );
                    return Err(format!("No extracted text for {}", student_name));
                }
            };

            let grading_result = match client
                .grade_submission(&rubric, model_answer.as_deref(), &submission_text)
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("Grading failed for {}: {}", student_name, e);
                    return Err(e);
                }
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
                submission_id: submission_id_clone,
                grades,
                total_score: grading_result.total_score,
                feedback: grading_result.feedback,
                graded_at: now,
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
    let conn = pool.get().map_err(|e| e.to_string())?;
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
    recompute_submission_total(&pool, &submission_id)?;

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
    let rubric = get_rubric_criteria(&pool, &assignment_id).await?;
    let (assignment_title, _) = get_assignment_details(&pool, &assignment_id).await?;
    let submissions = get_submissions_for_assignment(&pool, &assignment_id).await?;

    let mut rows = Vec::new();
    for (
        submission_id,
        student_id,
        student_name_opt,
        student_email,
        grading_status,
        ai_total_score,
        ai_feedback,
    ) in submissions
    {
        let grades = get_grades_for_submission(&pool, &submission_id).await?;
        rows.push(GradebookRow {
            submission_id,
            student_id,
            student_name: student_name_opt.unwrap_or_else(|| "Unknown Student".to_string()),
            student_email,
            grading_status,
            ai_total_score,
            ai_feedback,
            grades,
        });
    }

    Ok(GradebookView {
        assignment_id,
        assignment_title,
        rubric,
        rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;

    fn temp_db() -> (DbPool, PathBuf) {
        let path = std::env::temp_dir().join(format!("gcr_test_{}.db", uuid::Uuid::new_v4()));
        let pool = db::init_db(path.clone());
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
                crate::grading::gemini::CriterionGrade {
                    criterion_id: criteria[0].id.clone(),
                    score: 1.0,
                    justification: "AI low".to_string(),
                },
                crate::grading::gemini::CriterionGrade {
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
}
