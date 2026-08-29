use crate::core::db::DbPool;
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

/// Backup the SQLite database to a user-chosen path using VACUUM INTO
/// (consistent, uncorrupted snapshot even in active WAL mode).
#[tauri::command]
pub async fn backup_database(
    _app: AppHandle,
    pool: State<'_, DbPool>,
    dest_path: String,
) -> Result<String, String> {
    backup_database_impl(&pool, &dest_path)
}

pub fn backup_database_impl(pool: &DbPool, dest_path: &str) -> Result<String, String> {
    let dest = std::path::Path::new(dest_path);
    if dest.exists() {
        std::fs::remove_file(dest)
            .map_err(|e| format!("Failed to overwrite existing destination: {}", e))?;
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("VACUUM INTO ?1", rusqlite::params![dest_path])
        .map_err(|e| format!("Failed to backup database via VACUUM INTO: {}", e))?;

    Ok(dest_path.to_string())
}

/// Restore the SQLite database from a backup file:
/// 1. Verifies the backup is a valid SQLite file
/// 2. Creates a safety snapshot of current DB
/// 3. Restores all data from backup into active pool via SQLite Online Backup API.
#[tauri::command]
pub async fn restore_database(
    app: AppHandle,
    pool: State<'_, DbPool>,
    source_path: String,
) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let safety_copy = app_data.join(format!(
        "gcr_pre_restore_{}.db",
        chrono::Utc::now().timestamp()
    ));

    // Make safety backup first
    if let Ok(path_str) = safety_copy.to_str().ok_or("Invalid safety path") {
        let _ = backup_database_impl(&pool, path_str);
    }

    restore_database_impl(&pool, &source_path)
}

pub fn restore_database_impl(pool: &DbPool, source_path: &str) -> Result<String, String> {
    let source = std::path::Path::new(source_path);
    if !source.exists() || !source.is_file() {
        return Err("Selected backup file does not exist.".to_string());
    }

    // Verify source is valid SQLite database
    let src_conn = rusqlite::Connection::open_with_flags(
        source,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Invalid SQLite backup file: {}", e))?;

    let _table_count: i64 = src_conn
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
        .map_err(|e| format!("Backup verification query failed: {}", e))?;

    // Restore from source into active pool connection via SQLite Backup API
    let mut dst_conn = pool.get().map_err(|e| e.to_string())?;

    {
        let backup = rusqlite::backup::Backup::new(&src_conn, &mut dst_conn)
            .map_err(|e| format!("Failed to initialize SQLite backup restore: {}", e))?;

        backup
            .run_to_completion(100, std::time::Duration::from_millis(5), None)
            .map_err(|e| format!("Failed to execute database restore: {}", e))?;
    }

    dst_conn
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|e| format!("Failed to reset database pragmas: {}", e))?;

    Ok("Database restored successfully.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    fn create_test_pool(path: &std::path::Path) -> DbPool {
        let manager = SqliteConnectionManager::file(path);
        let pool = Pool::new(manager).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS test_data (id TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT OR REPLACE INTO test_data (id, value) VALUES ('1', 'original');",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn test_backup_and_restore() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("test_app.db");
        let backup_path = tmp.path().join("test_backup.db");

        let pool = create_test_pool(&db_path);

        // 1. Test backup via VACUUM INTO
        let backup_res = backup_database_impl(&pool, backup_path.to_str().unwrap());
        assert!(backup_res.is_ok());
        assert!(backup_path.exists());

        // 2. Modify original DB
        {
            let conn = pool.get().unwrap();
            conn.execute("UPDATE test_data SET value = 'modified' WHERE id = '1'", [])
                .unwrap();
            let val: String = conn
                .query_row("SELECT value FROM test_data WHERE id = '1'", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_eq!(val, "modified");
        }

        // 3. Test restore from backup using SQLite Backup API
        let restore_res = restore_database_impl(&pool, backup_path.to_str().unwrap());
        assert!(restore_res.is_ok());

        // 4. Verify value reverted to 'original'
        {
            let conn = pool.get().unwrap();
            let val: String = conn
                .query_row("SELECT value FROM test_data WHERE id = '1'", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_eq!(val, "original");
        }
    }

    #[test]
    fn test_restore_rejects_invalid_file() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("test_app2.db");
        let invalid_backup = tmp.path().join("invalid.txt");
        std::fs::write(&invalid_backup, "not a sqlite database").unwrap();

        let pool = create_test_pool(&db_path);
        let restore_res = restore_database_impl(&pool, invalid_backup.to_str().unwrap());
        assert!(restore_res.is_err());
    }
}
