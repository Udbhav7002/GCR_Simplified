use super::{get_setting, get_valid_access_token};
use crate::db::DbPool;
use base64::{engine::general_purpose, Engine as _};
use tauri::State;

/// Encode an email header value, MIME-encoding non-ASCII text.
fn encode_header(value: &str) -> String {
    let cleaned: String = value.replace(['\r', '\n'], " ");
    if cleaned.is_ascii() {
        cleaned
    } else {
        let b64 = general_purpose::STANDARD.encode(cleaned.as_bytes());
        format!("=?UTF-8?B?{}?=", b64)
    }
}

/// Send a "missing submission" reminder email to a student via the Gmail API.
#[tauri::command]
pub async fn nudge_student(
    pool: State<'_, DbPool>,
    course_id: String,
    course_work_id: String,
    student_email: String,
    student_name: String,
) -> Result<(), String> {
    let token = get_valid_access_token(&pool).await?;
    let teacher_email = get_setting(&pool, "google_user_email")?
        .ok_or("Not authenticated with Google. Please sign in first.")?;

    // Resolve the assignment title from the (cached) coursework list.
    let coursework =
        super::classroom::list_google_coursework_impl(&pool, &course_id, false).await?;
    let assignment_title = coursework
        .iter()
        .find(|cw| cw.id == course_work_id)
        .map(|cw| cw.title.clone())
        .unwrap_or_else(|| "your assignment".to_string());

    let subject = format!("Reminder: Missing submission — {}", assignment_title);
    let body = format!(
        "Hi {},\n\nThis is a friendly reminder that you have not yet submitted \"{}\" in Google Classroom.\n\nPlease submit your work as soon as possible.\n\nBest regards,\nYour Teacher",
        student_name, assignment_title
    );

    let raw = format!(
        "From: {}\r\nTo: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\n\r\n{}",
        encode_header(&teacher_email),
        encode_header(&student_email),
        encode_header(&subject),
        body
    );
    let encoded = general_purpose::URL_SAFE_NO_PAD.encode(raw.as_bytes());

    let client = reqwest::Client::new();
    let resp = client
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .bearer_auth(&token)
        .json(&serde_json::json!({ "raw": encoded }))
        .send()
        .await
        .map_err(|e| format!("Failed to send email: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let error_text = resp.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(
                "Email permission missing. Please reconnect your Google account in Settings to grant send access."
                    .to_string(),
            );
        }
        return Err(format!("Gmail API error ({}): {}", status, error_text));
    }

    Ok(())
}
