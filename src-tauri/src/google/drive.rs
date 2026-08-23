use super::get_valid_access_token;
use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadResult {
    pub file_id: String,
    pub file_name: String,
    pub local_path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub completed: usize,
    pub total: usize,
    pub current: String,
    pub success: bool,
}

/// Download one attachment. Shared by the single-file command and the batch job.
pub async fn download_file_impl(
    pool: &DbPool,
    app_data_dir: &std::path::Path,
    file_id: String,
    file_name: String,
    course_id: &str,
    course_work_id: &str,
    student_id: &str,
) -> Result<DownloadResult, String> {
    let token = get_valid_access_token(pool).await?;
    let client = reqwest::Client::new();

    // Create download directory
    let download_dir = app_data_dir
        .join("submissions")
        .join(course_id)
        .join(course_work_id)
        .join(student_id);
    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;

    // First, get file metadata to check MIME type
    let meta_url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?fields=id,name,mimeType,size",
        file_id
    );
    let meta_resp = client
        .get(&meta_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;

    if !meta_resp.status().is_success() {
        let error_text = meta_resp.text().await.unwrap_or_default();
        return Ok(DownloadResult {
            file_id,
            file_name,
            local_path: String::new(),
            success: false,
            error: Some(format!("Failed to get file metadata: {}", error_text)),
        });
    }

    let meta: serde_json::Value = meta_resp.json().await.map_err(|e| e.to_string())?;
    let mime_type = meta["mimeType"].as_str().unwrap_or("");

    // Determine download URL and final filename
    let (download_url, final_name) = if mime_type.starts_with("application/vnd.google-apps.") {
        // Google Workspace document — export as PDF
        let export_url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/export?mimeType=application/pdf",
            file_id
        );
        let name = if file_name.ends_with(".pdf") {
            file_name.clone()
        } else {
            format!("{}.pdf", file_name)
        };
        (export_url, name)
    } else {
        // Regular file — direct download
        let download_url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?alt=media",
            file_id
        );
        (download_url, file_name.clone())
    };

    // Download the file
    let file_resp = client
        .get(&download_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !file_resp.status().is_success() {
        let error_text = file_resp.text().await.unwrap_or_default();
        return Ok(DownloadResult {
            file_id,
            file_name,
            local_path: String::new(),
            success: false,
            error: Some(format!("Download failed: {}", error_text)),
        });
    }

    let bytes = file_resp.bytes().await.map_err(|e| e.to_string())?;

    // Save to disk, avoiding filename collisions
    let mut file_path = download_dir.join(&final_name);
    if file_path.exists() {
        let stem = std::path::Path::new(&final_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = std::path::Path::new(&final_name)
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| format!(".{}", s))
            .unwrap_or_default();
        let mut counter = 1;
        while file_path.exists() {
            file_path = download_dir.join(format!("{}_{}{}", stem, counter, ext));
            counter += 1;
        }
    }
    std::fs::write(&file_path, &bytes).map_err(|e| format!("Failed to save file: {}", e))?;

    Ok(DownloadResult {
        file_id,
        file_name: final_name,
        local_path: file_path.to_string_lossy().to_string(),
        success: true,
        error: None,
    })
}

#[tauri::command]
pub async fn download_submission_file(
    pool: State<'_, DbPool>,
    app: AppHandle,
    file_id: String,
    file_name: String,
    course_id: String,
    course_work_id: String,
    student_id: String,
) -> Result<DownloadResult, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    download_file_impl(
        &pool,
        &app_data,
        file_id,
        file_name,
        &course_id,
        &course_work_id,
        &student_id,
    )
    .await
}

/// Download every attachment for a coursework with bounded concurrency,
/// emitting `download-progress` events as files complete.
#[tauri::command]
pub async fn download_all_submissions(
    pool: State<'_, DbPool>,
    app: AppHandle,
    cancel_flag: State<'_, crate::commands::AppCancellationFlag>,
    course_id: String,
    course_work_id: String,
) -> Result<Vec<DownloadResult>, String> {
    cancel_flag.0.store(false, Ordering::SeqCst);
    let settings = crate::commands::settings::load_settings(&pool)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let submissions =
        super::classroom::fetch_google_submissions(&pool, &course_id, &course_work_id).await?;

    struct Work {
        file_id: String,
        file_name: String,
        student_id: String,
        label: String,
    }
    let mut work_list: Vec<Work> = Vec::new();
    for sub in &submissions {
        let student_name = sub
            .student_name
            .clone()
            .unwrap_or_else(|| "Unknown Student".to_string());
        for att in &sub.attachments {
            if let (Some(fid), Some(title)) = (&att.drive_file_id, &att.drive_file_title) {
                work_list.push(Work {
                    file_id: fid.clone(),
                    file_name: title.clone(),
                    student_id: sub.user_id.clone(),
                    label: format!("{} — {}", student_name, title),
                });
            }
        }
    }

    let total = work_list.len();
    if total == 0 {
        return Ok(Vec::new());
    }

    let concurrency = settings.download_concurrency.clamp(1, 16);
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let completed = Arc::new(AtomicUsize::new(0));
    let mut handles: Vec<tokio::task::JoinHandle<Result<DownloadResult, String>>> = Vec::new();

    for work in work_list {
        let pool = pool.inner().clone();
        let app_data = app_data.clone();
        let semaphore = semaphore.clone();
        let completed = completed.clone();
        let app = app.clone();
        let course_id = course_id.clone();
        let course_work_id = course_work_id.clone();
        let cancel = cancel_flag.0.clone();

        let handle = tokio::spawn(async move {
            if cancel.load(Ordering::SeqCst) {
                return Ok(DownloadResult {
                    file_id: work.file_id,
                    file_name: work.file_name,
                    local_path: String::new(),
                    success: false,
                    error: Some("Download cancelled by user".to_string()),
                });
            }

            let _permit = semaphore.acquire().await.map_err(|e| e.to_string())?;

            if cancel.load(Ordering::SeqCst) {
                return Ok(DownloadResult {
                    file_id: work.file_id,
                    file_name: work.file_name,
                    local_path: String::new(),
                    success: false,
                    error: Some("Download cancelled by user".to_string()),
                });
            }

            let result = download_file_impl(
                &pool,
                &app_data,
                work.file_id.clone(),
                work.file_name.clone(),
                &course_id,
                &course_work_id,
                &work.student_id,
            )
            .await;

            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            let progress = DownloadProgress {
                completed: done,
                total,
                current: work.label.clone(),
                success: result.as_ref().map(|r| r.success).unwrap_or(false),
            };
            app.emit("download-progress", progress).ok();

            match result {
                Ok(r) => Ok(r),
                Err(e) => Ok(DownloadResult {
                    file_id: work.file_id,
                    file_name: work.file_name,
                    local_path: String::new(),
                    success: false,
                    error: Some(e),
                }),
            }
        });
        handles.push(handle);
    }

    let mut results = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(result)) => results.push(result),
            Ok(Err(e)) => {
                log::warn!("Batch download task error: {}", e);
            }
            Err(e) => {
                log::error!("Batch download join error: {}", e);
            }
        }
    }

    Ok(results)
}
