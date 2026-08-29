use crate::core::db::DbPool;
use crate::domain::grading::commands::get_gradebook;
use crate::domain::export::xlsx::export_gradebook_xlsx;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportOptions {
    pub assignment_id: String,
    pub course_id: Option<String>,
    pub course_work_id: Option<String>,
    pub save_path: Option<String>,
}

#[tauri::command]
pub async fn export_gradebook(
    pool: State<'_, DbPool>,
    options: ExportOptions,
) -> Result<String, String> {
    let gradebook = get_gradebook(pool, options.assignment_id).await?;
    
    let path = if let Some(save_path) = options.save_path {
        save_path
    } else {
        let default_name = gradebook
            .assignment_title
            .replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '_' && c != '-', "")
            .replace(' ', "_")
            + ".xlsx";
        default_name
    };
    
    export_gradebook_xlsx(&gradebook, &[], Path::new(&path))
}