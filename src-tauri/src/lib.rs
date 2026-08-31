//! GCR Simplified — AI-powered assignment evaluation & integrity system for teachers
//!
//! A Tauri v2 desktop application that integrates with Google Classroom to provide:
//! - AI-assisted grading with Gemini
//! - Plagiarism detection (winnowing + TF-IDF)
//! - Automated submission download & text extraction
//! - Gradebook management with Excel export

pub mod api;
pub mod core;
pub mod domain;

use crate::api::commands::*;
use crate::core::db;
use std::fs;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("gcr.log".to_string()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {}", e))?;
            if !app_dir.exists() {
                fs::create_dir_all(&app_dir)
                    .map_err(|e| format!("Failed to create app data dir: {}", e))?;
            }

            let db_path = app_dir.join("gcr_simplified.db");
            let pool = db::init_db(db_path)
                .map_err(|e| format!("Database initialization failed: {}", e))?;

            app.manage(pool);
            app.manage(crate::core::commands::AppCancellationFlag::default());
            app.manage(crate::core::commands::LoginCancelFlag::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Core commands
            cancel_active_tasks,
            start_google_login,
            cancel_google_login,
            get_google_auth_status,
            google_logout,
            get_settings,
            save_settings,
            // Google Classroom
            list_google_courses,
            list_google_coursework,
            list_google_students,
            list_google_submissions,
            get_missing_submissions,
            // Drive
            download_submission_file,
            download_all_submissions,
            // Extraction
            extract_text,
            extract_all_submissions,
            get_extraction_result,
            // Plagiarism
            run_plagiarism_check,
            list_plagiarism_runs,
            get_plagiarism_run,
            purge_plagiarism_runs,
            // Grading
            grade_submission,
            grade_all_assignment,
            update_grade_override,
            approve_grade,
            approve_all_grades,
            get_gradebook,
            push_grades_to_classroom,
            // Rubrics
            create_rubric_criterion,
            get_rubric_criteria,
            update_rubric_criterion,
            delete_rubric_criterion,
            // Export
            export_gradebook,
            // Maintenance
            purge_downloaded_submissions,
            backup_database,
            restore_database,
            // Dashboard
            get_dashboard_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
