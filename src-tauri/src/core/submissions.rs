use crate::core::db::DbPool;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardStats {
    pub total_courses: i64,
    pub total_students: i64,
    pub total_assignments: i64,
    pub graded_submissions: i64,
}

/// Real aggregate stats for the Dashboard, computed from the local mirror of
/// synced Google Classroom data (and any manually created records).
#[tauri::command]
pub fn get_dashboard_stats(pool: State<DbPool>) -> Result<DashboardStats, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let total_courses: i64 = conn
        .query_row("SELECT COUNT(*) FROM classes", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let total_students: i64 = conn
        .query_row("SELECT COUNT(*) FROM students", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let total_assignments: i64 = conn
        .query_row("SELECT COUNT(*) FROM assignments", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let graded_submissions: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT submission_id) FROM grades",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(DashboardStats {
        total_courses,
        total_students,
        total_assignments,
        graded_submissions,
    })
}
