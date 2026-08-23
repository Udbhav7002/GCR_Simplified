use super::{tfidf, winnowing, PairwiseResult, PlagiarismReport};
use crate::db::DbPool;
use rusqlite::params;
use tauri::{AppHandle, Manager, State};

/// Resolve the extracted text for every student directory under a coursework's
/// submissions folder. Returns (student_id, first_file_path, combined_text).
fn collect_submission_texts(
    pool: &DbPool,
    submissions_dir: &std::path::Path,
) -> Result<Vec<(String, String, String)>, String> {
    let mut submissions: Vec<(String, String, String)> = Vec::new();

    let entries = std::fs::read_dir(submissions_dir)
        .map_err(|e| format!("Failed to read submissions directory: {}", e))?;

    // Load the whole extraction cache once instead of opening a connection per file.
    let conn = pool.get().map_err(|e| e.to_string())?;
    let cache: std::collections::HashMap<String, String> = {
        let mut stmt = conn
            .prepare("SELECT file_path, extracted_text FROM extracted_texts")
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read extraction cache: {}", e))?;
        iter.into_iter().collect()
    };

    for entry in entries.flatten() {
        let student_dir = entry.path();
        if !student_dir.is_dir() {
            continue;
        }
        let student_id = student_dir
            .file_name()
            .and_then(|n| n.to_str().map(|s| s.to_string()))
            .unwrap_or_default();

        let files = match std::fs::read_dir(&student_dir) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let mut combined_text = String::new();
        let mut file_path_used = String::new();

        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if !file_path.is_file() {
                continue;
            }
            let file_path_str = file_path.to_string_lossy().to_string();
            if file_path_used.is_empty() {
                file_path_used = file_path_str.clone();
            }

            if let Some(t) = cache.get(&file_path_str) {
                if !combined_text.is_empty() {
                    combined_text.push_str("\n\n");
                }
                combined_text.push_str(t);
            }
        }

        if !combined_text.trim().is_empty() {
            submissions.push((student_id, file_path_used, combined_text));
        }
    }

    Ok(submissions)
}

/// Core plagiarism computation, reusable by the export engine.
/// Name resolution is performed by the caller if desired.
pub async fn compute_plagiarism_report(
    pool: &DbPool,
    app_data_dir: &std::path::Path,
    course_id: String,
    course_work_id: String,
    fingerprint_threshold: f64,
    semantic_threshold: f64,
    roster: Option<std::collections::HashMap<String, (String, Option<String>)>>,
) -> Result<PlagiarismReport, String> {
    let submissions_dir = app_data_dir
        .join("submissions")
        .join(&course_id)
        .join(&course_work_id);

    let empty_report = || PlagiarismReport {
        course_id: course_id.clone(),
        course_work_id: course_work_id.clone(),
        total_submissions: 0,
        pairs_checked: 0,
        flagged_pairs: 0,
        results: Vec::new(),
        fingerprint_threshold,
        semantic_threshold,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    if !submissions_dir.exists() {
        return Ok(empty_report());
    }

    let submissions = collect_submission_texts(pool, &submissions_dir)?;
    let total_submissions = submissions.len();
    if total_submissions < 2 {
        let mut report = empty_report();
        report.total_submissions = total_submissions;
        return Ok(report);
    }

    let subs = submissions.clone();
    let results = tokio::task::spawn_blocking(move || {
        let tfidf_docs: Vec<(String, String)> = subs
            .iter()
            .map(|(id, _, text)| (id.clone(), text.clone()))
            .collect();
        let tfidf_results = tfidf::compare_all_tfidf(&tfidf_docs);
        let tfidf_map: std::collections::HashMap<(String, String), f64> = tfidf_results
            .into_iter()
            .map(|(a, b, s)| ((a, b), s))
            .collect();

        let mut pairwise: Vec<PairwiseResult> = Vec::new();
        for i in 0..subs.len() {
            for j in (i + 1)..subs.len() {
                let (ref id_a, ref file_a, ref text_a) = subs[i];
                let (ref id_b, ref file_b, ref text_b) = subs[j];

                let (fp_score, fragments) = winnowing::compare_winnowing(text_a, text_b);
                let sem_score = tfidf_map
                    .get(&(id_a.clone(), id_b.clone()))
                    .copied()
                    .unwrap_or(0.0);

                let combined = fp_score * 0.5 + sem_score * 0.5;
                let flagged = fp_score >= fingerprint_threshold || sem_score >= semantic_threshold;

                let student_a_name = roster
                    .as_ref()
                    .and_then(|r| r.get(id_a))
                    .map(|(name, _)| name.clone())
                    .unwrap_or_else(|| id_a.clone());
                let student_b_name = roster
                    .as_ref()
                    .and_then(|r| r.get(id_b))
                    .map(|(name, _)| name.clone())
                    .unwrap_or_else(|| id_b.clone());

                pairwise.push(PairwiseResult {
                    student_a_name,
                    student_a_id: id_a.clone(),
                    student_a_file: file_a.clone(),
                    student_b_name,
                    student_b_id: id_b.clone(),
                    student_b_file: file_b.clone(),
                    fingerprint_score: (fp_score * 100.0).round() / 100.0,
                    semantic_score: (sem_score * 100.0).round() / 100.0,
                    combined_score: (combined * 100.0).round() / 100.0,
                    flagged,
                    matched_fragments: fragments,
                });
            }
        }

        pairwise.sort_by(|a, b| {
            b.combined_score
                .partial_cmp(&a.combined_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        pairwise
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    let flagged_pairs = results.iter().filter(|r| r.flagged).count();
    let pairs_checked = results.len();

    Ok(PlagiarismReport {
        course_id,
        course_work_id,
        total_submissions,
        pairs_checked,
        flagged_pairs,
        results,
        fingerprint_threshold,
        semantic_threshold,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Run plagiarism check on all extracted submissions for an assignment.
/// Thresholds default to the teacher's saved settings when not provided.
/// Persists a snapshot of the report to `plagiarism_runs` for history.
#[tauri::command]
pub async fn run_plagiarism_check(
    pool: State<'_, DbPool>,
    app: AppHandle,
    cancel_flag: State<'_, crate::commands::AppCancellationFlag>,
    course_id: String,
    course_work_id: String,
    fingerprint_threshold: Option<f64>,
    semantic_threshold: Option<f64>,
) -> Result<PlagiarismReport, String> {
    cancel_flag.0.store(false, std::sync::atomic::Ordering::SeqCst);
    let settings = crate::commands::settings::load_settings(&pool)?;
    let fp_threshold = fingerprint_threshold.unwrap_or(settings.default_fingerprint_threshold);
    let sem_threshold = semantic_threshold.unwrap_or(settings.default_semantic_threshold);

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Fetch roster for name resolution
    let roster = crate::google::classroom::fetch_roster_map(&pool, &course_id)
        .await
        .ok();

    if cancel_flag.0.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Plagiarism check cancelled by user".to_string());
    }

    let report = compute_plagiarism_report(
        &pool,
        &app_data,
        course_id,
        course_work_id,
        fp_threshold,
        sem_threshold,
        roster,
    )
    .await?;

    if cancel_flag.0.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Plagiarism check cancelled by user".to_string());
    }

    save_plagiarism_run(&pool, &report)?;

    Ok(report)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PlagiarismRunMeta {
    pub id: String,
    pub course_id: String,
    pub course_work_id: String,
    pub created_at: String,
    pub total_submissions: usize,
    pub pairs_checked: usize,
    pub flagged_pairs: usize,
    pub fingerprint_threshold: f64,
    pub semantic_threshold: f64,
}

fn save_plagiarism_run(pool: &DbPool, report: &PlagiarismReport) -> Result<(), String> {
    // Storage optimization: keep full details for flagged pairs; strip fragment detail for non-flagged pairs.
    let mut optimized_report = report.clone();
    for pair in &mut optimized_report.results {
        if !pair.flagged {
            pair.matched_fragments.clear();
        }
    }

    let report_json = serde_json::to_string(&optimized_report).map_err(|e| e.to_string())?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO plagiarism_runs (id, course_id, course_work_id, created_at, total_submissions, pairs_checked, flagged_pairs, fingerprint_threshold, semantic_threshold, report_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            run_id,
            report.course_id,
            report.course_work_id,
            report.created_at,
            report.total_submissions as i64,
            report.pairs_checked as i64,
            report.flagged_pairs as i64,
            report.fingerprint_threshold,
            report.semantic_threshold,
            report_json
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// List prior plagiarism runs for a coursework, newest first.
#[tauri::command]
pub fn list_plagiarism_runs(
    pool: State<'_, DbPool>,
    course_id: String,
    course_work_id: String,
) -> Result<Vec<PlagiarismRunMeta>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, course_id, course_work_id, created_at, total_submissions, pairs_checked, flagged_pairs, fingerprint_threshold, semantic_threshold
             FROM plagiarism_runs
             WHERE course_id = ?1 AND course_work_id = ?2
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let runs = stmt
        .query_map(params![course_id, course_work_id], |row| {
            Ok(PlagiarismRunMeta {
                id: row.get(0)?,
                course_id: row.get(1)?,
                course_work_id: row.get(2)?,
                created_at: row.get(3)?,
                total_submissions: row.get::<_, i64>(4)? as usize,
                pairs_checked: row.get::<_, i64>(5)? as usize,
                flagged_pairs: row.get::<_, i64>(6)? as usize,
                fingerprint_threshold: row.get(7)?,
                semantic_threshold: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read plagiarism runs: {}", e))?;
    Ok(runs)
}

/// Retrieve a previously saved plagiarism report by run id.
#[tauri::command]
pub fn get_plagiarism_run(
    pool: State<'_, DbPool>,
    run_id: String,
) -> Result<PlagiarismReport, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let report_json: String = conn
        .query_row(
            "SELECT report_json FROM plagiarism_runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Run not found: {}", e))?;
    let report: PlagiarismReport = serde_json::from_str(&report_json).map_err(|e| e.to_string())?;
    Ok(report)
}

/// Purge old plagiarism runs to free local disk space. If older_than_days is None or <= 0,
/// purges all runs.
#[tauri::command]
pub fn purge_plagiarism_runs(
    pool: State<'_, DbPool>,
    older_than_days: Option<i64>,
) -> Result<usize, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let removed = match older_than_days {
        Some(days) if days > 0 => {
            let cutoff = format!("-{} days", days);
            conn.execute(
                "DELETE FROM plagiarism_runs WHERE datetime(created_at) < datetime('now', ?1)",
                params![cutoff],
            )
            .map_err(|e| e.to_string())?
        }
        _ => conn
            .execute("DELETE FROM plagiarism_runs", [])
            .map_err(|e| e.to_string())?,
    };
    Ok(removed)
}
