use crate::db::DbPool;
use crate::google::{get_setting, save_setting};
use crate::security;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Default thresholds as fractions (0.0–1.0), matching the semantics used by
/// the plagiarism engine and the frontend display layer (×100 → percent).
pub const DEFAULT_FINGERPRINT_THRESHOLD: f64 = 0.40;
pub const DEFAULT_SEMANTIC_THRESHOLD: f64 = 0.80;
pub const DEFAULT_THEME: &str = "light";
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-2.5-flash";

/// Mirrors the frontend `AppSettings`. All fields carry serde defaults so a
/// partial payload (e.g. missing `gemini_model`) never fails deserialization.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    #[serde(default)]
    pub gemini_api_key: Option<String>,
    #[serde(default = "default_model")]
    pub gemini_model: String,
    #[serde(default = "default_fingerprint")]
    pub default_fingerprint_threshold: f64,
    #[serde(default = "default_semantic")]
    pub default_semantic_threshold: f64,
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_model() -> String {
    DEFAULT_GEMINI_MODEL.to_string()
}

fn default_fingerprint() -> f64 {
    DEFAULT_FINGERPRINT_THRESHOLD
}

fn default_semantic() -> f64 {
    DEFAULT_SEMANTIC_THRESHOLD
}

fn default_theme() -> String {
    DEFAULT_THEME.to_string()
}

/// Load effective settings from the DB, filling missing values with defaults.
/// Plain function so other modules (plagiarism, grading, export) can reuse it.
pub fn load_settings(pool: &DbPool) -> Result<AppSettings, String> {
    Ok(AppSettings {
        gemini_api_key: security::get_secret(pool, "gemini_api_key")?,
        gemini_model: get_setting(pool, "gemini_model")?
            .unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string()),
        default_fingerprint_threshold: get_setting(pool, "default_fingerprint_threshold")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_FINGERPRINT_THRESHOLD),
        default_semantic_threshold: get_setting(pool, "default_semantic_threshold")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_SEMANTIC_THRESHOLD),
        theme: get_setting(pool, "theme")?.unwrap_or_else(|| DEFAULT_THEME.to_string()),
    })
}

#[tauri::command]
pub fn get_settings(pool: State<'_, DbPool>) -> Result<AppSettings, String> {
    load_settings(&pool)
}

#[tauri::command]
pub fn save_settings(pool: State<'_, DbPool>, settings: AppSettings) -> Result<(), String> {
    match &settings.gemini_api_key {
        Some(key) if !key.trim().is_empty() => {
            security::save_secret(&pool, "gemini_api_key", key.trim())?;
        }
        // An explicit empty value means the teacher cleared the key — remove it.
        Some(_) => {
            security::delete_secret("gemini_api_key").ok();
        }
        None => {}
    }
    if !settings.gemini_model.trim().is_empty() {
        save_setting(&pool, "gemini_model", settings.gemini_model.trim())?;
    }
    save_setting(
        &pool,
        "default_fingerprint_threshold",
        &settings.default_fingerprint_threshold.to_string(),
    )?;
    save_setting(
        &pool,
        "default_semantic_threshold",
        &settings.default_semantic_threshold.to_string(),
    )?;
    save_setting(&pool, "theme", &settings.theme)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_fractions_matching_docs() {
        // Documented defaults: 40% fingerprint / 80% semantic.
        assert!((DEFAULT_FINGERPRINT_THRESHOLD - 0.40).abs() < 1e-9);
        assert!((DEFAULT_SEMANTIC_THRESHOLD - 0.80).abs() < 1e-9);
        assert_eq!(DEFAULT_THEME, "light");
        assert_eq!(DEFAULT_GEMINI_MODEL, "gemini-2.5-flash");
    }

    #[test]
    fn partial_payload_deserializes_with_defaults() {
        let parsed: AppSettings = serde_json::from_str(r#"{"gemini_api_key":"k"}"#).unwrap();
        assert_eq!(parsed.gemini_api_key.as_deref(), Some("k"));
        assert_eq!(parsed.gemini_model, DEFAULT_GEMINI_MODEL);
        assert_eq!(parsed.theme, DEFAULT_THEME);
        assert!((parsed.default_fingerprint_threshold - 0.40).abs() < 1e-9);
    }

    #[test]
    fn empty_payload_deserializes() {
        let parsed: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(parsed.gemini_api_key.is_none());
        assert_eq!(parsed.gemini_model, DEFAULT_GEMINI_MODEL);
    }
}
