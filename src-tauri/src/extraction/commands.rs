use crate::db::{DbPool, ExtractionResult};
use rusqlite::params;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

/// Extract text from a single file
#[tauri::command]
pub async fn extract_text(
    pool: State<'_, DbPool>,
    file_path: String,
) -> Result<ExtractionResult, String> {
    // Check cache first
    {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let cached: Result<(String, String, i64), _> = conn.query_row(
            "SELECT extracted_text, extraction_method, char_count FROM extracted_texts WHERE file_path = ?1",
            params![file_path],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        );
        if let Ok((text, method, count)) = cached {
            return Ok(ExtractionResult {
                file_path,
                extracted_text: text,
                extraction_method: method,
                char_count: count,
                success: true,
                error: None,
            });
        }
    }

    // Not cached — extract
    let path_clone = file_path.clone();
    let result = tokio::task::spawn_blocking(move || super::extract_text_from_file(&path_clone))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok((text, method)) => {
            let char_count = text.len() as i64;
            let now = chrono::Utc::now().to_rfc3339();

            // Cache the result
            let conn = pool.get().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT OR REPLACE INTO extracted_texts (file_path, extracted_text, extraction_method, char_count, extracted_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![file_path, text, method, char_count, now],
            ).map_err(|e| e.to_string())?;

            Ok(ExtractionResult {
                file_path,
                extracted_text: text,
                extraction_method: method,
                char_count,
                success: true,
                error: None,
            })
        }
        Err(e) => Ok(ExtractionResult {
            file_path,
            extracted_text: String::new(),
            extraction_method: "failed".to_string(),
            char_count: 0,
            success: false,
            error: Some(e),
        }),
    }
}

/// Batch extract text from all downloaded files for an assignment, using
/// bounded concurrency and emitting `extraction-progress` events as files
/// complete (mirrors the download pipeline).
#[tauri::command]
pub async fn extract_all_submissions(
    pool: State<'_, DbPool>,
    app: AppHandle,
    course_id: String,
    course_work_id: String,
) -> Result<Vec<ExtractionResult>, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let submissions_dir = app_data
        .join("submissions")
        .join(&course_id)
        .join(&course_work_id);

    if !submissions_dir.exists() {
        return Ok(Vec::new());
    }

    // Collect all candidate files first (skipping cached ones).
    struct Work {
        file_path: String,
        label: String,
    }
    let mut work_list: Vec<Work> = Vec::new();
    let mut cached_results: Vec<ExtractionResult> = Vec::new();

    {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let entries = std::fs::read_dir(&submissions_dir)
            .map_err(|e| format!("Failed to read submissions dir: {}", e))?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let student_dir = entry.path();
            if !student_dir.is_dir() {
                continue;
            }
            let files = std::fs::read_dir(&student_dir)
                .map_err(|e| format!("Failed to read student dir: {}", e))?;

            for file_entry in files {
                let file_entry = file_entry.map_err(|e| e.to_string())?;
                let file_path = file_entry.path();
                if !file_path.is_file() {
                    continue;
                }
                let file_path_str = file_path.to_string_lossy().to_string();

                let cached = conn
                    .query_row(
                        "SELECT extracted_text, extraction_method, char_count FROM extracted_texts WHERE file_path = ?1",
                        params![file_path_str],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
                    )
                    .ok();
                if let Some((text, method, count)) = cached {
                    cached_results.push(ExtractionResult {
                        file_path: file_path_str.clone(),
                        extracted_text: text,
                        extraction_method: method,
                        char_count: count,
                        success: true,
                        error: None,
                    });
                    continue;
                }

                work_list.push(Work {
                    file_path: file_path_str,
                    label: file_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("file")
                        .to_string(),
                });
            }
        }
    }

    let total = work_list.len();
    let max_concurrency = 4usize.min(total.max(1));
    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
    let completed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut handles: Vec<tokio::task::JoinHandle<ExtractionResult>> = Vec::new();

    for work in work_list {
        let pool = pool.inner().clone();
        let semaphore = semaphore.clone();
        let completed = completed.clone();
        let app = app.clone();
        let course_work_id = course_work_id.clone();
        let label = work.label.clone();

        let handle = tokio::spawn(async move {
            let _permit = semaphore.acquire().await;

            let path_for_extraction = work.file_path.clone();
            let extraction = tokio::task::spawn_blocking(move || {
                super::extract_text_from_file(&path_for_extraction)
            })
            .await
            .map_err(|e| e.to_string());

            let result = match extraction {
                Ok(Ok((text, method))) => {
                    let char_count = text.len() as i64;
                    let now = chrono::Utc::now().to_rfc3339();

                    let cache_and_mirror = (|| -> Result<(), String> {
                        let conn = pool.get().map_err(|e| e.to_string())?;
                        conn.execute(
                            "INSERT OR REPLACE INTO extracted_texts (file_path, extracted_text, extraction_method, char_count, extracted_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                            params![work.file_path, text, method, char_count, now],
                        )
                        .map_err(|e| e.to_string())?;

                        // Mirror into the local submissions row (assignment_id =
                        // coursework id, student_id = parent directory name).
                        let normalized_path = work.file_path.replace('\\', "/");
                        let segments: Vec<&str> = normalized_path.split('/').collect();
                        if let Some(student_id) =
                            segments.len().checked_sub(2).and_then(|i| segments.get(i))
                        {
                            let _ = conn.execute(
                                "UPDATE submissions SET extracted_text = ?1, status = 'extracted' WHERE assignment_id = ?2 AND student_id = ?3",
                                params![text.clone(), &course_work_id, student_id],
                            );
                        }
                        Ok(())
                    })();

                    // Extraction succeeded regardless of cache/mirror hiccups.
                    if let Err(e) = &cache_and_mirror {
                        log::warn!("Failed to cache extraction: {}", e);
                    }

                    ExtractionResult {
                        file_path: work.file_path,
                        extracted_text: text,
                        extraction_method: method,
                        char_count,
                        success: true,
                        error: None,
                    }
                }
                Ok(Err(e)) | Err(e) => ExtractionResult {
                    file_path: work.file_path,
                    extracted_text: String::new(),
                    extraction_method: "failed".to_string(),
                    char_count: 0,
                    success: false,
                    error: Some(e),
                },
            };

            let done = completed.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            app.emit(
                "extraction-progress",
                serde_json::json!({
                    "completed": done,
                    "total": total,
                    "current": label,
                }),
            )
            .ok();

            result
        });
        handles.push(handle);
    }

    let mut results: Vec<ExtractionResult> = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => {
                log::error!("Extraction join error: {}", e);
            }
        }
    }

    results.extend(cached_results);
    Ok(results)
}

/// Get cached extraction result for a file
#[tauri::command]
pub async fn get_extraction_result(
    pool: State<'_, DbPool>,
    file_path: String,
) -> Result<Option<ExtractionResult>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT extracted_text, extraction_method, char_count FROM extracted_texts WHERE file_path = ?1",
        params![file_path],
        |row| Ok(ExtractionResult {
            file_path: file_path.clone(),
            extracted_text: row.get(0)?,
            extraction_method: row.get(1)?,
            char_count: row.get(2)?,
            success: true,
            error: None,
        }),
    );

    match result {
        Ok(r) => Ok(Some(r)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
