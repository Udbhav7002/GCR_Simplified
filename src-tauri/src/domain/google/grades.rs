use crate::core::db::DbPool;
use crate::domain::google::{get_valid_access_token, handle_http_error};
use reqwest::Client;
use serde_json::json;

pub async fn push_grade_to_classroom(
    pool: &DbPool,
    course_id: &str,
    course_work_id: &str,
    submission_id: &str, // This is the Google Classroom studentSubmissionId
    grade: f64,
) -> Result<(), String> {
    let token = get_valid_access_token(pool).await?;
    let url = format!(
        "https://classroom.googleapis.com/v1/courses/{}/courseWork/{}/studentSubmissions/{}?updateMask=assignedGrade,draftGrade",
        course_id, course_work_id, submission_id
    );

    let client = Client::new();
    let res = client
        .patch(&url)
        .bearer_auth(token)
        .json(&json!({
            "assignedGrade": grade,
            "draftGrade": grade
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(handle_http_error(res, "Push grade to Classroom").await);
    }

    Ok(())
}
