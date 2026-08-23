use super::{get_setting, save_setting};
use crate::db::DbPool;
use crate::security;
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const SCOPES: &str = "https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.students.readonly https://www.googleapis.com/auth/classroom.rosters.readonly https://www.googleapis.com/auth/classroom.profile.emails https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.send";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleAuthStatus {
    pub is_authenticated: bool,
    pub email: Option<String>,
    pub name: Option<String>,
}

pub struct LoginCancelFlag(pub Arc<AtomicBool>);

fn generate_pkce() -> (String, String) {
    let mut verifier_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let code_verifier = general_purpose::URL_SAFE_NO_PAD.encode(verifier_bytes);

    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let challenge_bytes = hasher.finalize();
    let code_challenge = general_purpose::URL_SAFE_NO_PAD.encode(challenge_bytes);

    (code_verifier, code_challenge)
}

fn extract_code_from_request(request: &str) -> Result<String, String> {
    let first_line = request.lines().next().ok_or("Empty request")?;
    let path = first_line
        .split_whitespace()
        .nth(1)
        .ok_or("No path in request")?;

    if path.contains("error=") {
        return Err("User denied access or an error occurred during authentication.".to_string());
    }

    let query = path.split('?').nth(1).ok_or("No query string")?;
    for param in query.split('&') {
        let mut kv = param.splitn(2, '=');
        if let (Some(key), Some(value)) = (kv.next(), kv.next()) {
            if key == "code" {
                return Ok(urlencoding::decode(value)
                    .map_err(|e| e.to_string())?
                    .to_string());
            }
        }
    }
    Err("No authorization code in callback".to_string())
}

const CALLBACK_TIMEOUT_SECS: u64 = 120;

fn wait_for_callback(
    listener: std::net::TcpListener,
    cancel_flag: Arc<AtomicBool>,
) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(CALLBACK_TIMEOUT_SECS);

    let mut stream = loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Authentication cancelled by user.".to_string());
        }
        if std::time::Instant::now() > deadline {
            return Err("Authentication timed out after 2 minutes. Please try again.".to_string());
        }
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("Accept failed: {}", e)),
        }
    };
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();

    let mut buffer = [0u8; 8192];
    let n = stream.read(&mut buffer).map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..n]);

    let code = extract_code_from_request(&request);

    let (status, body) = if code.is_ok() {
        ("200 OK", "<html><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h1 style='color:#2563eb'>\u{2705} Authentication Successful!</h1><p style='color:#64748b'>You can close this tab and return to GCR Simplified.</p></div></div></body></html>")
    } else {
        ("400 Bad Request", "<html><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h1 style='color:#ef4444'>\u{274c} Authentication Failed</h1><p style='color:#64748b'>Please try again from the app.</p></div></div></body></html>")
    };

    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n{}",
        status, body
    );
    stream.write_all(response.as_bytes()).ok();
    stream.flush().ok();

    code
}

#[tauri::command]
pub async fn start_google_login(
    app: AppHandle,
    pool: State<'_, DbPool>,
    client_id: String,
) -> Result<GoogleAuthStatus, String> {
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("Google Client ID cannot be empty.".to_string());
    }

    // Store client credentials (ID is public)
    save_setting(&pool, "google_client_id", &client_id)?;

    // Generate PKCE
    let (code_verifier, code_challenge) = generate_pkce();

    // Bind ephemeral loopback listener
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind listener: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}", port);

    // Build auth URL
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(SCOPES),
        urlencoding::encode(&code_challenge),
    );

    // Open system browser
    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {}", e))?;

    // Create cancellation flag and store in app state
    let cancel_flag = Arc::new(AtomicBool::new(false));
    app.manage(LoginCancelFlag(cancel_flag.clone()));

    // Wait for callback (blocking, so use spawn_blocking)
    let auth_code = tokio::task::spawn_blocking(move || wait_for_callback(listener, cancel_flag))
        .await
        .map_err(|e| format!("Join error: {}", e))??;

    // Note: the cancel flag remains in app state; the next login replaces it.
    // Exchange code for tokens (PKCE does not require client_secret)
    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", auth_code.as_str()),
            ("client_id", client_id.as_str()),
            ("code_verifier", code_verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    if !resp.status().is_success() {
        let error_text = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {}", error_text));
    }

    let token_resp: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let access_token = token_resp["access_token"]
        .as_str()
        .ok_or("No access_token in response")?
        .to_string();
    let refresh_token = token_resp["refresh_token"].as_str().map(|s| s.to_string());
    let expires_in = token_resp["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    // Store tokens (sensitive values go to the OS keychain)
    security::save_secret(&pool, "google_access_token", &access_token)?;
    if let Some(ref rt) = refresh_token {
        security::save_secret(&pool, "google_refresh_token", rt)?;
    }
    save_setting(&pool, "google_token_expires_at", &expires_at.to_string())?;

    // Get user profile from Google
    let profile_resp = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let profile: serde_json::Value = profile_resp.json().await.unwrap_or_default();
    let email = profile["email"].as_str().map(|s| s.to_string());
    let name = profile["name"].as_str().map(|s| s.to_string());

    if let Some(ref e) = email {
        save_setting(&pool, "google_user_email", e)?;
    }
    if let Some(ref n) = name {
        save_setting(&pool, "google_user_name", n)?;
    }

    Ok(GoogleAuthStatus {
        is_authenticated: true,
        email,
        name,
    })
}

#[tauri::command]
pub async fn cancel_google_login(app: AppHandle) -> Result<(), String> {
    if let Some(flag) = app.try_state::<LoginCancelFlag>() {
        flag.0.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_google_auth_status(pool: State<'_, DbPool>) -> Result<GoogleAuthStatus, String> {
    let access_token = security::get_secret(&pool, "google_access_token")?;
    if access_token.is_none() {
        return Ok(GoogleAuthStatus {
            is_authenticated: false,
            email: None,
            name: None,
        });
    }

    let email = get_setting(&pool, "google_user_email")?;
    let name = get_setting(&pool, "google_user_name")?;

    Ok(GoogleAuthStatus {
        is_authenticated: true,
        email,
        name,
    })
}

#[tauri::command]
pub async fn google_logout(pool: State<'_, DbPool>) -> Result<(), String> {
    // Remove tokens from the OS keychain.
    security::delete_secret("google_access_token").ok();
    security::delete_secret("google_refresh_token").ok();

    // Remove non-secret account metadata and any legacy plaintext rows.
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM settings WHERE key IN (
            'google_access_token', 'google_refresh_token', 'google_token_expires_at',
            'google_user_email', 'google_user_name'
        )",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_code_from_query() {
        let request = "GET /callback?code=AUTH_CODE_123&scope=x HTTP/1.1\r\nHost: localhost\r\n";
        assert_eq!(extract_code_from_request(request).unwrap(), "AUTH_CODE_123");
    }

    #[test]
    fn decodes_url_encoded_code() {
        let request = "GET /?code=a%2Bb%2Fc%3D HTTP/1.1\r\n";
        assert_eq!(extract_code_from_request(request).unwrap(), "a+b/c=");
    }

    #[test]
    fn errors_on_missing_code() {
        let request = "GET /?state=abc HTTP/1.1\r\n";
        assert!(extract_code_from_request(request).is_err());
    }

    #[test]
    fn errors_on_empty_request() {
        assert!(extract_code_from_request("").is_err());
    }

    #[test]
    fn errors_on_denied_access() {
        let request = "GET /?error=access_denied HTTP/1.1\r\n";
        assert!(extract_code_from_request(request).is_err());
    }
}
