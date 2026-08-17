use crate::db::DbPool;

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
/// Manager / Linux Secret Service). Removes any legacy plaintext copy from
/// the settings table.
pub fn save_secret(pool: &DbPool, key: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key)
        .map_err(|e| format!("Keychain init failed for '{}': {}", key, e))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Keychain write failed for '{}': {}", key, e))?;
    delete_setting(pool, key);
    Ok(())
}

/// Load a secret from the OS keychain. If not present, check the legacy
/// plaintext settings table and transparently migrate it into the keychain.
pub fn get_secret(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    let entry = match keyring::Entry::new(KEYCHAIN_SERVICE, key) {
        Ok(e) => e,
        Err(e) => return Err(format!("Keychain init failed for '{}': {}", key, e)),
    };
    match entry.get_password() {
        Ok(value) => return Ok(Some(value)),
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(format!("Keychain read failed for '{}': {}", key, e)),
    }

    if let Some(legacy) = get_setting(pool, key)? {
        save_secret(pool, key, &legacy)?;
        return Ok(Some(legacy));
    }

    Ok(None)
}

/// Remove a secret from the OS keychain (no-op if absent).
pub fn delete_secret(key: &str) -> Result<(), String> {
    let entry = match keyring::Entry::new(KEYCHAIN_SERVICE, key) {
        Ok(e) => e,
        Err(e) => return Err(format!("Keychain init failed for '{}': {}", key, e)),
    };
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Keychain delete failed for '{}': {}", key, e)),
    }
}

fn get_setting(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    );
    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

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
