pub mod auth;
pub mod classroom;
pub mod drive;
pub mod grades;

use crate::core::db::{DbPool, get_setting, execute_void};
use crate::core::security;
use rusqlite::params;

/// Save a setting to the settings table (convenience wrapper)
pub fn save_setting(pool: &DbPool, key: &str, value: &str) -> Result<(), String> {
    execute_void(
        pool,
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
}

/// Handle HTTP response errors consistently across Google API calls.
/// Consumes the response body and returns a user-friendly error message.
pub async fn handle_http_error(
    resp: reqwest::Response,
    context: &str,
) -> String {
    let status = resp.status();
    let error_text = resp.text().await.unwrap_or_default();
    
    match status.as_u16() {
        400 => format!("{} - Invalid request", context),
        401 => format!("{} - Authentication failed (token expired)", context),
        403 => format!("{} - Access forbidden (insufficient permissions)", context),
        404 => format!("{} - Resource not found", context),
        429 => format!("{} - Rate limited", context),
        500..=599 => format!("{} - Server error ({})", context, status),
        _ => format!("{} - HTTP {}: {}", context, status, error_text),
    }
}

// ── ETag-based incremental cache for Google list endpoints ──
// Pages are cached under `{collection}#{token_hash}` rows. When the first
// page is unmodified (304), the whole collection is rebuilt from cache.

fn hash_token(token: &str) -> u64 {
    use std::hash::Hasher;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    hasher.write(token.as_bytes());
    hasher.finish()
}

/// Cached page row: (etag, payload, next_page_token).
type CachedPage = (Option<String>, String, Option<String>);

fn get_cached_page(pool: &DbPool, key: &str) -> Result<Option<CachedPage>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT etag, payload, next_token FROM google_cache WHERE cache_key = ?1",
        params![key],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn save_cached_page(
    pool: &DbPool,
    key: &str,
    etag: Option<&str>,
    payload: &str,
    next_token: Option<&str>,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO google_cache (cache_key, etag, payload, next_token, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            key,
            etag,
            payload,
            next_token,
            chrono::Utc::now().to_rfc3339()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetch a paginated Google collection, using per-page ETag caching.
/// `base_url` is the request URL without the pageToken parameter.
/// `array_key` is the JSON key holding the item array (e.g. "courses").
/// With `force = true` the cache is ignored and fully refreshed.
pub async fn fetch_collection(
    pool: &DbPool,
    client: &reqwest::Client,
    token: &str,
    collection: &str,
    base_url: &str,
    array_key: &str,
    force: bool,
) -> Result<serde_json::Value, String> {
    // Try serving the whole collection from cache when the first page is unchanged.
    if !force {
        let mut pages: Vec<serde_json::Value> = Vec::new();
        let mut page_token: Option<String> = None;
        let mut hit_first = false;
        let mut ok = true;
        loop {
            let key = format!(
                "{}#{}",
                collection,
                hash_token(page_token.as_deref().unwrap_or("__first__"))
            );
            match get_cached_page(pool, &key)? {
                Some((etag, payload, next_token)) => {
                    if page_token.is_none() {
                        hit_first = true;
                    }
                    let _ = etag;
                    match serde_json::from_str::<serde_json::Value>(&payload) {
                        Ok(v) => pages.push(v),
                        Err(_) => {
                            ok = false;
                            break;
                        }
                    }
                    page_token = next_token;
                    if page_token.is_none() {
                        break;
                    }
                }
                None => {
                    if page_token.is_none() {
                        // No cache at all — fetch fresh below.
                        ok = false;
                    } else {
                        // Cache incomplete (stale pagination) — fall back to fresh.
                        ok = false;
                    }
                    break;
                }
            }
        }
        if ok && hit_first {
            let mut merged = serde_json::Map::new();
            let mut items: Vec<serde_json::Value> = Vec::new();
            for page in &pages {
                if let Some(arr) = page[array_key].as_array() {
                    items.extend(arr.iter().cloned());
                }
            }
            merged.insert(array_key.to_string(), serde_json::Value::Array(items));
            return Ok(serde_json::Value::Object(merged));
        }
    }

    // Fresh fetch (first page changed, force, or empty cache).
    let mut items: Vec<serde_json::Value> = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut url = base_url.to_string();
        if let Some(ref pt) = page_token {
            url.push_str(&format!("&pageToken={}", pt));
        }

        let key = format!(
            "{}#{}",
            collection,
            hash_token(page_token.as_deref().unwrap_or("__first__"))
        );

        let mut retry_count = 0;
        let resp = loop {
            let mut req = client.get(&url).bearer_auth(token);
            if !force {
                if let Some((Some(etag), _, _)) = get_cached_page(pool, &key)? {
                    req = req.header(reqwest::header::IF_NONE_MATCH, etag);
                }
            }

            let response = req.send().await.map_err(|e| format!("Request failed: {}", e))?;
            let status = response.status();

            if (status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()) && retry_count < 3 {
                retry_count += 1;
                let retry_after_secs = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|h| h.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(1u64 << retry_count); // 2s, 4s, 8s exponential backoff
                
                tokio::time::sleep(std::time::Duration::from_secs(retry_after_secs.min(30))).await;
                continue;
            }

            break response;
        };

        if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
            // Unchanged page — reuse the cached payload.
            if let Some((_, payload, next_token)) = get_cached_page(pool, &key)? {
                match serde_json::from_str::<serde_json::Value>(&payload) {
                    Ok(v) => {
                        if let Some(arr) = v[array_key].as_array() {
                            items.extend(arr.iter().cloned());
                        }
                        page_token = next_token;
                        if page_token.is_none() {
                            break;
                        }
                        continue;
                    }
                    Err(_) => { /* fall through to error below */ }
                }
            }
            return Err("Inconsistent cache state (304 without cache entry)".to_string());
        }

        if !resp.status().is_success() {
            return Err(handle_http_error(resp, "Google API").await);
        }

        let etag = resp
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let payload = resp.text().await.map_err(|e| e.to_string())?;
        let body: serde_json::Value =
            serde_json::from_str(&payload).map_err(|e| format!("Bad JSON from Google: {}", e))?;

        let next_token = body["nextPageToken"].as_str().map(|s| s.to_string());
        save_cached_page(pool, &key, etag.as_deref(), &payload, next_token.as_deref())?;

        if let Some(arr) = body[array_key].as_array() {
            items.extend(arr.iter().cloned());
        }
        page_token = next_token;
        if page_token.is_none() {
            break;
        }
    }

    let mut merged = serde_json::Map::new();
    merged.insert(array_key.to_string(), serde_json::Value::Array(items));
    Ok(serde_json::Value::Object(merged))
}

// Helper: get a valid access token, refreshing if expired
pub async fn get_valid_access_token(pool: &DbPool) -> Result<String, String> {
    let access_token = security::get_secret(pool, "google_access_token")?
        .ok_or("Not authenticated with Google. Please sign in first.")?;
    let expires_at_str =
        get_setting(pool, "google_token_expires_at")?.unwrap_or_else(|| "0".to_string());
    let expires_at: i64 = expires_at_str.parse().unwrap_or(0);
    let now = chrono::Utc::now().timestamp();

    if now < expires_at - 60 {
        // Token still valid (with 60s buffer)
        return Ok(access_token);
    }

    // Need to refresh (PKCE client does not require client_secret)
    let refresh_token = security::get_secret(pool, "google_refresh_token")?
        .ok_or("No refresh token found. Please sign in again.")?;
    let client_id = get_setting(pool, "google_client_id")?
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| auth::DEFAULT_CLIENT_ID.to_string());

    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", &client_id),
            ("refresh_token", &refresh_token),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(handle_http_error(resp, "Token refresh").await);
    }

    let token_resp: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let new_access_token = token_resp["access_token"]
        .as_str()
        .ok_or("No access_token in refresh response")?
        .to_string();
    let expires_in = token_resp["expires_in"].as_i64().unwrap_or(3600);
    let new_expires_at = chrono::Utc::now().timestamp() + expires_in;

    security::save_secret(pool, "google_access_token", &new_access_token)?;
    save_setting(pool, "google_token_expires_at", &new_expires_at.to_string())?;

    Ok(new_access_token)
}
