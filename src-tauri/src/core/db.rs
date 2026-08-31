use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub type DbPool = Pool<SqliteConnectionManager>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Class {
    pub id: String,
    pub name: String,
    pub subject: Option<String>,
    pub student_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Student {
    pub id: String,
    pub class_id: String,
    pub roll_number: String,
    pub name: String,
    pub email: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Assignment {
    pub id: String,
    pub class_id: String,
    pub title: String,
    pub description: Option<String>,
    pub question_text: Option<String>,
    pub model_answer: Option<String>,
    pub max_score: Option<f64>,
    pub status: String,
    pub submission_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

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

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "001_initial_schema",
        "
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
    ),
    (
        "002_performance_and_extraction_indexes",
        "
        CREATE INDEX IF NOT EXISTS idx_extracted_texts_method ON extracted_texts(extraction_method);
        CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
        CREATE INDEX IF NOT EXISTS idx_submissions_grading_status ON submissions(grading_status);
        ",
    ),
    (
        "003_submissions_graded_via",
        "
        ALTER TABLE submissions ADD COLUMN graded_via TEXT NOT NULL DEFAULT 'text';
        ",
    ),
    (
        "004_submissions_filename_identity",
        "
        ALTER TABLE submissions ADD COLUMN file_reg_no TEXT;
        ALTER TABLE submissions ADD COLUMN file_name TEXT;
        ",
    ),
];

pub fn run_migrations(conn: &mut rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS _schema_versions (
             version TEXT PRIMARY KEY,
             applied_at TEXT NOT NULL
         );",
    )
    .map_err(|e| format!("Failed to setup schema versioning: {}", e))?;

    for (version, sql) in MIGRATIONS {
        let applied: bool = conn
            .query_row(
                "SELECT 1 FROM _schema_versions WHERE version = ?1",
                params![version],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if !applied {
            log::info!("Applying schema migration: {}", version);
            let tx = conn.transaction().map_err(|e| {
                format!(
                    "Failed to begin migration transaction for {}: {}",
                    version, e
                )
            })?;
            tx.execute_batch(sql)
                .map_err(|e| format!("Failed to execute migration {}: {}", version, e))?;
            let now = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO _schema_versions (version, applied_at) VALUES (?1, ?2)",
                params![version, now],
            )
            .map_err(|e| format!("Failed to record migration {}: {}", version, e))?;
            tx.commit()
                .map_err(|e| format!("Failed to commit migration {}: {}", version, e))?;
        }
    }

    // Prune stale Google cache entries older than 30 days
    if let Err(e) = conn.execute(
        "DELETE FROM google_cache WHERE datetime(fetched_at) < datetime('now', '-30 days')",
        [],
    ) {
        log::warn!("Failed to prune stale google_cache rows: {}", e);
    }

    Ok(())
}

pub fn init_db(db_path: PathBuf) -> Result<DbPool, String> {
    let manager = SqliteConnectionManager::file(db_path).with_init(|conn| {
        conn.pragma_update(None, "busy_timeout", 5000_i64)?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(())
    });
    let pool = Pool::new(manager).map_err(|e| format!("Failed to create DB pool: {}", e))?;

    let mut conn = pool
        .get()
        .map_err(|e| format!("Failed to get connection from pool: {}", e))?;
    run_migrations(&mut conn)?;

    Ok(pool)
}

/// Get a connection from the pool with proper error handling.
pub fn get_conn(pool: &DbPool) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, String> {
    pool.get()
        .map_err(|e| format!("Failed to get DB connection: {}", e))
}

/// Get a setting value by key (common string case).
pub fn get_setting(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    query_one(
        pool,
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
}

/// Execute a query that returns a single optional row.
pub fn query_one<T, P, F>(pool: &DbPool, sql: &str, params: P, map: F) -> Result<Option<T>, String>
where
    P: rusqlite::Params,
    F: FnOnce(&rusqlite::Row) -> Result<T, rusqlite::Error>,
{
    let conn = get_conn(pool)?;
    match conn.query_row(sql, params, map) {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Execute a query that returns multiple rows.
pub fn query_all<T, P, F>(pool: &DbPool, sql: &str, params: P, map: F) -> Result<Vec<T>, String>
where
    P: rusqlite::Params,
    F: Fn(&rusqlite::Row) -> Result<T, rusqlite::Error>,
{
    let conn = get_conn(pool)?;
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params, map).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read rows: {}", e))
}

/// Execute an INSERT/UPDATE/DELETE statement, returning rows affected.
pub fn execute<P: rusqlite::Params>(pool: &DbPool, sql: &str, params: P) -> Result<usize, String> {
    let conn = get_conn(pool)?;
    conn.execute(sql, params).map_err(|e| e.to_string())
}

/// Execute an INSERT/UPDATE/DELETE statement, discarding rows affected.
pub fn execute_void<P: rusqlite::Params>(
    pool: &DbPool,
    sql: &str,
    params: P,
) -> Result<(), String> {
    execute(pool, sql, params).map(|_| ())
}

/// Execute a statement within a transaction.
pub fn transaction<F, R>(pool: &DbPool, f: F) -> Result<R, String>
where
    F: FnOnce(&rusqlite::Transaction) -> Result<R, String>,
{
    let mut conn = get_conn(pool)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to start transaction: {}", e))?;
    let result = f(&tx)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_are_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("migration_test.db");

        let pool = init_db(db_path.clone()).unwrap();
        {
            let conn = pool.get().unwrap();
            let count: i64 = conn
                .query_row("SELECT count(*) FROM _schema_versions", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, MIGRATIONS.len() as i64);
        }

        // Running init_db again on existing DB should succeed without errors
        let pool2 = init_db(db_path).unwrap();
        {
            let conn2 = pool2.get().unwrap();
            let count2: i64 = conn2
                .query_row("SELECT count(*) FROM _schema_versions", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count2, MIGRATIONS.len() as i64);
        }
    }
}
