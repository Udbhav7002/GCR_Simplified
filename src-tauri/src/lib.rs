pub mod commands;
pub mod db;
pub mod export;
pub mod extraction;
pub mod google;
pub mod grading;
pub mod plagiarism;
pub mod security;

use crate::commands::{maintenance::*, rubrics::*, settings::*, submissions::*};
use crate::export::commands::*;
use crate::extraction::commands::*;
use crate::google::{auth::*, classroom::*, drive::*, gmail::*};
use crate::grading::commands::*;
use crate::plagiarism::commands::*;
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Setup DB in app data directory
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            if !app_dir.exists() {
                fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
            }

            let db_path = app_dir.join("gcr_simplified.db");
            let pool = db::init_db(db_path);

            // Manage DB pool in Tauri State
            app.manage(pool);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_rubric_criterion,
            get_rubric_criteria,
            update_rubric_criterion,
            delete_rubric_criterion,
            get_dashboard_stats,
            start_google_login,
            cancel_google_login,
            get_google_auth_status,
            google_logout,
            list_google_courses,
            list_google_coursework,
            list_google_students,
            list_google_submissions,
            get_missing_submissions,
            download_submission_file,
            download_all_submissions,
            nudge_student,
            extract_text,
            extract_all_submissions,
            get_extraction_result,
            run_plagiarism_check,
            list_plagiarism_runs,
            get_plagiarism_run,
            get_settings,
            save_settings,
            grade_submission,
            grade_all_assignment,
            update_grade_override,
            approve_grade,
            approve_all_grades,
            get_gradebook,
            export_gradebook,
            purge_downloaded_submissions,
            backup_database
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
