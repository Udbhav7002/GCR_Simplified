use crate::core::db::DbPool;
use crate::domain::export::xlsx::{export_gradebook_xlsx, IntegrityRow};
use crate::domain::grading::commands::get_gradebook;
use crate::domain::plagiarism::PlagiarismReport;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportOptions {
    pub assignment_id: String,
    pub course_id: Option<String>,
    pub course_work_id: Option<String>,
    pub save_path: Option<String>,
}

#[tauri::command]
pub async fn export_gradebook(
    app: AppHandle,
    pool: State<'_, DbPool>,
    options: ExportOptions,
) -> Result<String, String> {
    let gradebook = get_gradebook(pool.clone(), options.assignment_id).await?;

    let path = if let Some(save_path) = options.save_path {
        save_path
    } else {
        let filename = gradebook
            .assignment_title
            .replace(
                |c: char| !c.is_alphanumeric() && c != ' ' && c != '_' && c != '-',
                "",
            )
            .replace(' ', "_")
            + ".xlsx";

        let download_dir = app
            .path()
            .download_dir()
            .map_err(|e| e.to_string())?
            .join(&filename);

        download_dir.to_string_lossy().to_string()
    };

    let mut integrity_rows = Vec::new();
    if let (Some(cid), Some(cwid)) = (&options.course_id, &options.course_work_id) {
        if let Ok(conn) = pool.get() {
            if let Ok(mut stmt) = conn.prepare("SELECT report_json FROM plagiarism_runs WHERE course_id = ?1 AND course_work_id = ?2 ORDER BY created_at DESC LIMIT 1") {
                if let Ok(report_json) = stmt.query_row(rusqlite::params![cid, cwid], |row| row.get::<_, String>(0)) {
                    if let Ok(report) = serde_json::from_str::<PlagiarismReport>(&report_json) {
                        for res in report.results {
                            if res.flagged {
                                integrity_rows.push(IntegrityRow {
                                    student_a: res.student_a_name,
                                    student_b: res.student_b_name,
                                    fingerprint: res.fingerprint_score,
                                    semantic: res.semantic_score,
                                    combined: res.combined_score,
                                    flagged: res.flagged,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    export_gradebook_xlsx(&gradebook, &integrity_rows, Path::new(&path))
}
