use crate::core::db::DbPool;
use crate::domain::export::xlsx::export_gradebook_xlsx;
use crate::domain::grading::commands::get_gradebook;
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
    let gradebook = get_gradebook(pool, options.assignment_id).await?;

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

    export_gradebook_xlsx(&gradebook, &[], Path::new(&path))
}
