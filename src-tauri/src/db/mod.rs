use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub type DbPool = Pool<SqliteConnectionManager>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RubricCriterion {
    pub id: String,
    pub assignment_id: String,
    pub name: String,
    pub description: Option<String>,
    pub max_marks: f64,
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExtractionResult {
    pub file_path: String,
    pub extracted_text: String,
    pub extraction_method: String,
    pub char_count: i64,
    pub success: bool,
    pub error: Option<String>,
}

fn table_has_column(conn: &rusqlite::Connection, table: &str, column: &str) -> bool {
    let mut stmt = match conn.prepare(&format!("PRAGMA table_info({})", table)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map(|iter| iter.filter_map(|c| c.ok()).collect::<Vec<_>>())
        .unwrap_or_default();
    cols.iter().any(|c| c == column)
}

fn ensure_column(conn: &rusqlite::Connection, table: &str, column: &str, ddl: &str) {
    if !table_has_column(conn, table, column) {
        conn.execute(&format!("ALTER TABLE {} ADD COLUMN {}", table, ddl), [])
            .ok();
    }
}
pub fn init_db(db_path: PathBuf) -> DbPool {
    // busy_timeout + synchronous=NORMAL so concurrent writers (batch grading,
    // batch downloads) retry instead of failing with SQLITE_BUSY, while WAL
    // keeps readers unblocked.
    let manager = SqliteConnectionManager::file(db_path).with_init(|conn| {
        conn.pragma_update(None, "busy_timeout", 5000_i64)?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(())
    });
    let pool = Pool::new(manager).expect("Failed to create DB pool.");

    let conn = pool.get().expect("Failed to get connection from pool");

    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS classes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            subject TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            roll_number TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(class_id, roll_number)
        );

        CREATE TABLE IF NOT EXISTS assignments (
            id TEXT PRIMARY KEY,
            class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            question_text TEXT,
            model_answer TEXT,
            max_score REAL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rubric_criteria (
            id TEXT PRIMARY KEY,
            assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT,
            max_marks REAL NOT NULL,
            sort_order INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS submissions (
            id TEXT PRIMARY KEY,
            assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
            student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            file_path TEXT,
            extracted_text TEXT,
            status TEXT NOT NULL,
            submitted_at TEXT,
            created_at TEXT NOT NULL,
            ai_feedback TEXT,
            ai_total_score REAL,
            grading_status TEXT NOT NULL DEFAULT 'ungraded',
            UNIQUE(assignment_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS grades (
            id TEXT PRIMARY KEY,
            submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
            criterion_id TEXT NOT NULL REFERENCES rubric_criteria(id) ON DELETE CASCADE,
            score REAL,
            feedback TEXT,
            justification TEXT,
            graded_by TEXT NOT NULL DEFAULT 'ai',
            approved INTEGER NOT NULL DEFAULT 0,
            graded_at TEXT,
            UNIQUE(submission_id, criterion_id)
        );

        CREATE TABLE IF NOT EXISTS plagiarism_runs (
            id TEXT PRIMARY KEY,
            course_id TEXT NOT NULL,
            course_work_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            total_submissions INTEGER NOT NULL,
            pairs_checked INTEGER NOT NULL,
            flagged_pairs INTEGER NOT NULL,
            fingerprint_threshold REAL NOT NULL,
            semantic_threshold REAL NOT NULL,
            report_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS google_cache (
            cache_key TEXT PRIMARY KEY,
            etag TEXT,
            payload TEXT NOT NULL,
            next_token TEXT,
            fetched_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS extracted_texts (
            file_path TEXT PRIMARY KEY,
            extracted_text TEXT NOT NULL,
            extraction_method TEXT NOT NULL,
            char_count INTEGER NOT NULL DEFAULT 0,
            extracted_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_plagiarism_runs_course_work
            ON plagiarism_runs(course_id, course_work_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_submissions_assignment
            ON submissions(assignment_id);
        CREATE INDEX IF NOT EXISTS idx_grades_submission
            ON grades(submission_id);
        ",
    )
    .expect("Failed to create tables.");

    // Migrations for older databases (new columns added after initial release)
    ensure_column(&conn, "grades", "justification", "justification TEXT");
    ensure_column(
        &conn,
        "grades",
        "graded_by",
        "graded_by TEXT NOT NULL DEFAULT 'ai'",
    );
    ensure_column(
        &conn,
        "grades",
        "approved",
        "approved INTEGER NOT NULL DEFAULT 0",
    );
    ensure_column(&conn, "grades", "graded_at", "graded_at TEXT");
    ensure_column(&conn, "submissions", "ai_feedback", "ai_feedback TEXT");
    ensure_column(
        &conn,
        "submissions",
        "ai_total_score",
        "ai_total_score REAL",
    );
    ensure_column(
        &conn,
        "submissions",
        "grading_status",
        "grading_status TEXT NOT NULL DEFAULT 'ungraded'",
    );

    pool
}
