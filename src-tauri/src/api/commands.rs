//! Re-export all Tauri commands from domain modules

pub use crate::domain::google::auth::{
    cancel_google_login, get_google_auth_status, google_logout, start_google_login,
};

pub use crate::domain::google::classroom::{
    get_missing_submissions, list_google_courses, list_google_coursework, list_google_students,
    list_google_submissions,
};

pub use crate::domain::google::drive::{download_all_submissions, download_submission_file};

pub use crate::domain::google::grades::push_grade_to_classroom;

pub use crate::domain::grading::commands::{
    approve_all_grades, approve_grade, get_gradebook, grade_all_assignment, grade_submission,
    push_grades_to_classroom, update_grade_override,
};

pub use crate::core::rubrics::{
    create_rubric_criterion, delete_rubric_criterion, get_rubric_criteria, update_rubric_criterion,
};

pub use crate::domain::extraction::commands::{
    extract_all_submissions, extract_text, get_extraction_result,
};

pub use crate::domain::plagiarism::commands::{
    get_plagiarism_run, list_plagiarism_runs, purge_plagiarism_runs, run_plagiarism_check,
};

pub use crate::domain::export::commands::export_gradebook;

pub use crate::core::maintenance::{
    backup_database, purge_downloaded_submissions, restore_database,
};

pub use crate::core::settings::{get_settings, save_settings};

pub use crate::core::commands::cancel_active_tasks;

pub use crate::core::submissions::get_dashboard_stats;
