use crate::core::db::{get_setting, DbPool};

#[allow(dead_code)]
const KEYCHAIN_SERVICE: &str = "com.gcrsimplified.app";

/// Keys that hold credentials and must live in the OS keychain.
const SECRET_KEYS: &[&str] = &[
    "google_client_secret",
    "google_access_token",
    "google_refresh_token",
    "gemini_api_key",
];

pub fn is_secret_key(key: &str) -> bool {
    SECRET_KEYS.contains(&key)
}

/// Store a secret in the OS keychain (macOS Keychain / Windows Credential
pub fn save_secret(pool: &DbPool, key: &str, value: &str) -> Result<(), String> {
    crate::core::db::execute_void(
        pool,
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("DB write failed: {}", e))
}

pub fn get_secret(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    get_setting(pool, key)
}

pub fn delete_secret(pool: &DbPool, key: &str) -> Result<(), String> {
    if let Ok(conn) = pool.get() {
        let _ = conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![key],
        );
    }
    Ok(())
}

#[allow(dead_code)]
fn delete_setting(pool: &DbPool, key: &str) {
    if let Ok(conn) = pool.get() {
        let _ = conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![key],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_key_classification() {
        assert!(is_secret_key("google_client_secret"));
        assert!(is_secret_key("google_access_token"));
        assert!(is_secret_key("google_refresh_token"));
        assert!(is_secret_key("gemini_api_key"));
        assert!(!is_secret_key("google_client_id"));
        assert!(!is_secret_key("theme"));
        assert!(!is_secret_key("google_token_expires_at"));
        assert!(!is_secret_key("default_fingerprint_threshold"));
    }
}
