//! Re-export all Tauri commands from domain modules

pub use crate::domain::google::auth::{
    start_google_login, cancel_google_login, get_google_auth_status, google_logout,
};

pub use crate::domain::google::classroom::{
    list_google_courses, list_google_coursework, list_google_students,
    list_google_submissions, get_missing_submissions,
};

pub use crate::domain::google::drive::{
    download_submission_file, download_all_submissions,
};

pub use crate::domain::google::grades::push_grade_to_classroom;

pub use crate::domain::grading::commands::{
    grade_submission, grade_all_assignment, update_grade_override,
    approve_grade, approve_all_grades, get_gradebook,
    push_grades_to_classroom,
};

pub use crate::core::rubrics::{
    create_rubric_criterion, get_rubric_criteria, update_rubric_criterion, delete_rubric_criterion,
};

pub use crate::domain::extraction::commands::{
    extract_text, extract_all_submissions, get_extraction_result,
};

pub use crate::domain::plagiarism::commands::{
    run_plagiarism_check, list_plagiarism_runs, get_plagiarism_run, purge_plagiarism_runs,
};

pub use crate::domain::export::commands::export_gradebook;

pub use crate::core::maintenance::{
    purge_downloaded_submissions, backup_database, restore_database,
};

pub use crate::core::settings::{get_settings, save_settings};

pub use crate::core::commands::cancel_active_tasks;

pub use crate::core::submissions::get_dashboard_stats;