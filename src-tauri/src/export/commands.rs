use crate::db::DbPool;
use crate::export::xlsx::{self, IntegrityRow};
use crate::grading::commands::get_gradebook;
use crate::plagiarism::commands::compute_plagiarism_report;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// Export the gradebook for an assignment to a 4-sheet Excel workbook.
/// If `save_path` is not provided, a default filename is generated under
/// the app data directory.
#[tauri::command]
pub async fn export_gradebook(
    app: AppHandle,
    pool: State<'_, DbPool>,
    assignment_id: String,
    course_id: Option<String>,
    course_work_id: Option<String>,
    save_path: Option<String>,
) -> Result<String, String> {
    let gradebook = get_gradebook(pool.clone(), assignment_id.clone()).await?;

    let integrity =
        build_integrity_rows(&pool, &app, course_id.as_deref(), course_work_id.as_deref()).await?;

    let path = resolve_save_path(&app, &assignment_id, &gradebook.assignment_title, save_path)?;

    let written = xlsx::export_gradebook_xlsx(&gradebook, &integrity, &path)?;
    Ok(written)
}

/// Compute plagiarism data for the integrity sheet (recomputed on demand).
async fn build_integrity_rows(
    pool: &State<'_, DbPool>,
    app: &AppHandle,
    course_id: Option<&str>,
    course_work_id: Option<&str>,
) -> Result<Vec<IntegrityRow>, String> {
    let (Some(cid), Some(cwid)) = (course_id, course_work_id) else {
        return Ok(Vec::new());
    };

    // Use the teacher's saved thresholds and resolve student names from the
    // Google roster so the sheet shows names, not user IDs.
    let settings = crate::commands::settings::load_settings(pool)?;
    let roster = crate::google::classroom::fetch_roster_map(pool, cid)
        .await
        .ok();

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let report = compute_plagiarism_report(
        pool,
        &app_data,
        cid.to_string(),
        cwid.to_string(),
        settings.default_fingerprint_threshold,
        settings.default_semantic_threshold,
        roster,
    )
    .await?;

    let rows = report
        .results
        .iter()
        .filter(|r| r.flagged)
        .map(|r| IntegrityRow {
            student_a: r.student_a_name.clone(),
            student_b: r.student_b_name.clone(),
            fingerprint: r.fingerprint_score,
            semantic: r.semantic_score,
            combined: r.combined_score,
            flagged: true,
        })
        .collect();

    Ok(rows)
}

/// Resolve where to write the file, defaulting to a dated filename in app data.
fn resolve_save_path(
    app: &AppHandle,
    assignment_id: &str,
    assignment_title: &str,
    save_path: Option<String>,
) -> Result<PathBuf, String> {
    if let Some(p) = save_path {
        if !p.trim().is_empty() {
            return Ok(PathBuf::from(p));
        }
    }

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let exports_dir = app_data.join("exports");
    std::fs::create_dir_all(&exports_dir).map_err(|e| e.to_string())?;

    let safe_title: String = assignment_title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let date = chrono::Local::now().format("%Y-%m-%d");
    let filename = format!(
        "{}_{}_{}.xlsx",
        safe_title.trim().replace(' ', "_"),
        date,
        assignment_id.chars().take(8).collect::<String>()
    );

    Ok(exports_dir.join(filename))
}
