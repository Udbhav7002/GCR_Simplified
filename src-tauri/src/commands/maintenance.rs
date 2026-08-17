use crate::db::DbPool;
use tauri::{AppHandle, Manager, State};

/// Delete all downloaded submission files from disk. Extracted-text caches and
/// grades in the DB are preserved. Returns the number of files removed.
#[tauri::command]
pub async fn purge_downloaded_submissions(app: AppHandle) -> Result<usize, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let submissions_dir = app_data.join("submissions");

    if !submissions_dir.exists() {
        return Ok(0);
    }

    let mut removed = 0usize;
    for entry in std::fs::read_dir(&submissions_dir)
        .map_err(|e| format!("Failed to read submissions dir: {}", e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            if let Ok(n) = remove_dir_contents(&path) {
                removed += n;
            }
        }
    }
    Ok(removed)
}

fn remove_dir_contents(dir: &std::path::Path) -> Result<usize, String> {
    let mut removed = 0usize;
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let n = remove_dir_contents(&path)?;
            std::fs::remove_dir(&path).map_err(|e| e.to_string())?;
            removed += n;
        } else if path.is_file() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Copy the SQLite database to a user-chosen path (GDPR data-portability:
/// everything is exportable and deletable).
#[tauri::command]
pub async fn backup_database(
    app: AppHandle,
    _pool: State<'_, DbPool>,
    dest_path: String,
) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data.join("gcr_simplified.db");

    if !db_path.exists() {
        return Err("Database file not found.".to_string());
    }

    std::fs::copy(&db_path, &dest_path).map_err(|e| format!("Failed to copy database: {}", e))?;
    Ok(dest_path)
}
