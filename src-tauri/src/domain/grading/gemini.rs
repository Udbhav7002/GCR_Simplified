use rand;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Rough character cap for a submission (~8k tokens) to stay inside the model
/// context window alongside the rubric + prompt.
const MAX_INPUT_CHARS: usize = 32_000;

/// Default HTTP timeout for Gemini API requests.
const DEFAULT_TIMEOUT_SECS: u64 = 120;

/// Maximum number of retry attempts for transient failures.
const MAX_RETRIES: u32 = 3;

/// Base delay for exponential backoff (milliseconds).
const BASE_RETRY_DELAY_MS: u64 = 800;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiRequest {
    pub contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    pub generation_config: GeminiGenerationConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiContent {
    pub role: String,
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "inlineData")]
    pub inline_data: Option<GeminiInlineData>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    /// Base64-encoded file bytes.
    pub data: String,
}

/// A handwritten/scanned file ready to be sent to Gemini as an inline part.
#[derive(Debug, Clone)]
pub struct VisionImage {
    pub label: String,
    pub mime_type: String,
    pub data_base64: String,
}

/// Free-tier guardrails: cap how much handwriting we send per submission so a
/// runaway scan doesn't blow the 20 MB inline request limit or burn quota.
pub const MAX_VISION_FILES: usize = 10;
/// Max raw bytes per file (base64 inflates ~33%; 15 MB keeps us safe).
pub const MAX_VISION_FILE_BYTES: usize = 15 * 1024 * 1024;
/// Max combined raw bytes across all files in one submission.
pub const MAX_VISION_TOTAL_BYTES: usize = 18 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiGenerationConfig {
    #[serde(rename = "responseMimeType")]
    pub response_mime_type: String,
    #[serde(rename = "responseSchema")]
    pub response_schema: serde_json::Value,
    #[serde(rename = "maxOutputTokens")]
    pub max_output_tokens: i32,
    pub temperature: f32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GeminiResponse {
    pub candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GeminiCandidate {
    pub content: GeminiContent,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GradingResult {
    pub criteria: Vec<CriterionGrade>,
    pub total_score: f64,
    pub feedback: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CriterionGrade {
    #[serde(rename = "criterion_id")]
    pub criterion_id: String,
    pub score: f64,
    pub justification: String,
}

#[derive(Debug)]
pub struct GeminiClient {
    client: Client,
    api_key: String,
    model: String,
    max_retries: u32,
}

/// Truncate very long submissions at a paragraph boundary near the cap.
fn truncate_for_model(text: &str) -> String {
    if text.len() <= MAX_INPUT_CHARS {
        return text.to_string();
    }
    let mut end = MAX_INPUT_CHARS;
    if let Some(idx) = text[..MAX_INPUT_CHARS].rfind('\n') {
        if idx > MAX_INPUT_CHARS / 2 {
            end = idx;
        }
    }
    let mut clipped = text[..end].to_string();
    clipped.push_str("\n\n[Submission truncated for length.]");
    clipped
}

/// Whether an API error is worth retrying (5xx / server hiccups / rate limit).
fn is_retryable(error: &str) -> bool {
    error.contains("500")
        || error.contains("503")
        || error.contains("429")
        || error.contains("502")
        || error.contains("504")
}

/// Sanitize error messages to avoid leaking internal details to frontend.
fn sanitize_error(e: &dyn std::fmt::Display) -> String {
    let msg = e.to_string();
    // Remove potential sensitive data patterns
    msg.replace(&['\n', '\r'][..], " ")
        .split_whitespace()
        .take(50)
        .collect::<Vec<_>>()
        .join(" ")
}

/// Map HTTP status to user-friendly error without leaking response body.
fn map_api_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        400 => "Invalid request to Gemini API".to_string(),
        401 => "Invalid or missing Gemini API key".to_string(),
        403 => "Gemini API access forbidden".to_string(),
        404 => "Gemini model not found".to_string(),
        429 => "Gemini API rate limit exceeded".to_string(),
        500 => "Gemini API internal error".to_string(),
        502 => "Gemini API bad gateway".to_string(),
        503 => "Gemini API temporarily unavailable".to_string(),
        504 => "Gemini API gateway timeout".to_string(),
        code => format!("Gemini API error ({})", code),
    }
}

impl GeminiClient {
    pub fn new(api_key: String, model: Option<String>) -> Result<Self, String> {
        Self::with_config(api_key, model, DEFAULT_TIMEOUT_SECS, MAX_RETRIES)
    }

    pub fn with_config(
        api_key: String,
        model: Option<String>,
        timeout_secs: u64,
        max_retries: u32,
    ) -> Result<Self, String> {
        if api_key.trim().is_empty() {
            return Err("Gemini API key cannot be empty".to_string());
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
        Ok(Self {
            client,
            api_key,
            model: model.unwrap_or_else(|| "gemini-2.5-flash".to_string()),
            max_retries,
        })
    }

    fn build_grading_prompt(
        &self,
        rubric: &[RubricCriterion],
        model_answer: Option<&str>,
        student_text: &str,
    ) -> Result<String, String> {
        let rubric_json = serde_json::to_string_pretty(rubric)
            .map_err(|e| format!("Failed to serialize rubric: {}", e))?;
        let model_answer_section = model_answer
            .map(|ma| format!("\n\nMODEL ANSWER:\n{}", ma))
            .unwrap_or_default();

        Ok(format!(
            r#"You are an expert grader. Grade the student's submission against the provided rubric.

RUBRIC (JSON array of criteria):
{rubric_json}
{model_answer_section}

STUDENT SUBMISSION:
{student_text}

INSTRUCTIONS:
1. For each criterion in the rubric, assign a score from 0 to max_marks (inclusive).
2. Provide a brief justification for each score, referencing specific parts of the student's work.
3. Calculate the total_score as the sum of all criterion scores.
4. Provide overall feedback summarizing strengths and areas for improvement.
5. Output ONLY valid JSON matching the response schema.

Be fair, consistent, and specific in your justifications."#
        ))
    }

    /// Prompt variant for handwritten/scanned submissions sent as images or PDFs.
    fn build_vision_grading_prompt(
        &self,
        rubric: &[RubricCriterion],
        model_answer: Option<&str>,
        file_count: usize,
    ) -> Result<String, String> {
        let rubric_json = serde_json::to_string_pretty(rubric)
            .map_err(|e| format!("Failed to serialize rubric: {}", e))?;
        let model_answer_section = model_answer
            .map(|ma| format!("\n\nMODEL ANSWER:\n{}", ma))
            .unwrap_or_default();

        Ok(format!(
            r#"You are an expert grader. The student's submission is handwritten or scanned and is attached below as {file_count} file(s) (photos, scans, or PDF documents).

RUBRIC (JSON array of criteria):
{rubric_json}
{model_answer_section}

STUDENT SUBMISSION:
Read the attached files carefully. The work may be handwritten — read the handwriting attentively, including equations, diagrams, and labels. If a word is unclear, infer it from context rather than skipping it.

INSTRUCTIONS:
1. For each criterion in the rubric, assign a score from 0 to max_marks (inclusive).
2. Provide a brief justification for each score, referencing specific parts of the student's work.
3. Calculate the total_score as the sum of all criterion scores.
4. Provide overall feedback summarizing strengths and areas for improvement.
5. If the pages are blank, illegible beyond recovery, or contain no attempt, score every criterion 0 and say so in the feedback.
6. Output ONLY valid JSON matching the response schema.

Be fair, consistent, and specific in your justifications."#
        ))
    }

    /// Build the Gemini parts list for a vision grading request: prompt first,
    /// then one inline part per file.
    fn build_vision_parts(prompt: String, images: &[VisionImage]) -> Vec<GeminiPart> {
        let mut parts = vec![GeminiPart {
            text: Some(prompt),
            inline_data: None,
        }];
        for image in images {
            parts.push(GeminiPart {
                text: None,
                inline_data: Some(GeminiInlineData {
                    mime_type: image.mime_type.clone(),
                    data: image.data_base64.clone(),
                }),
            });
        }
        parts
    }

    fn build_response_schema(&self, _rubric: &[RubricCriterion]) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "criteria": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "criterion_id": { "type": "string" },
                            "score": { "type": "number" },
                            "justification": { "type": "string" }
                        },
                        "required": ["criterion_id", "score", "justification"]
                    }
                },
                "total_score": { "type": "number" },
                "feedback": { "type": "string" }
            },
            "required": ["criteria", "total_score", "feedback"],
            "propertyOrdering": ["criteria", "total_score", "feedback"]
        })
    }

    pub async fn grade_submission(
        &self,
        rubric: &[RubricCriterion],
        model_answer: Option<&str>,
        student_text: &str,
    ) -> Result<GradingResult, String> {
        if student_text.trim().is_empty() {
            return Err("Student submission is empty".to_string());
        }

        // Cap the input so long essays stay within the model context window.
        let truncated = truncate_for_model(student_text);
        let prompt = self.build_grading_prompt(rubric, model_answer, &truncated)?;
        let schema = self.build_response_schema(rubric);
        let parts = vec![GeminiPart {
            text: Some(prompt),
            inline_data: None,
        }];

        self.execute_with_retry(parts, &schema, rubric).await
    }

    /// Grade a handwritten/scanned submission from inline images or PDFs.
    pub async fn grade_submission_vision(
        &self,
        rubric: &[RubricCriterion],
        model_answer: Option<&str>,
        images: &[VisionImage],
    ) -> Result<GradingResult, String> {
        if images.is_empty() {
            return Err("No readable image or PDF files for this submission".to_string());
        }

        let prompt = self.build_vision_grading_prompt(rubric, model_answer, images.len())?;
        let schema = self.build_response_schema(rubric);
        let parts = Self::build_vision_parts(prompt, images);

        self.execute_with_retry(parts, &schema, rubric).await
    }

    /// Shared retry loop with exponential backoff + jitter for transient failures.
    /// The request body is serialized exactly once and reused across attempts so
    /// large vision payloads are never cloned per retry.
    async fn execute_with_retry(
        &self,
        parts: Vec<GeminiPart>,
        schema: &serde_json::Value,
        rubric: &[RubricCriterion],
    ) -> Result<GradingResult, String> {
        let request = GeminiRequest {
            contents: vec![GeminiContent {
                role: "user".to_string(),
                parts,
            }],
            generation_config: GeminiGenerationConfig {
                response_mime_type: "application/json".to_string(),
                response_schema: schema.clone(),
                max_output_tokens: 4096,
                temperature: 0.1,
            },
        };
        let body = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize Gemini request: {}", e))?;

        let mut last_err: Option<String> = None;
        for attempt in 0..self.max_retries {
            match self.call_gemini(&body, rubric).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    if attempt < self.max_retries - 1 && is_retryable(&e) {
                        last_err = Some(e);
                        let base_delay = BASE_RETRY_DELAY_MS * 2_u64.pow(attempt);
                        let jitter = rand::random::<u64>() % 201;
                        let delay = base_delay + jitter;
                        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                    } else {
                        return Err(e);
                    }
                }
            }
        }
        Err(last_err.unwrap_or_else(|| "Gemini request failed after retries".to_string()))
    }

    async fn call_gemini(
        &self,
        body: &str,
        rubric: &[RubricCriterion],
    ) -> Result<GradingResult, String> {
        let url = format!(
            "{}/{}:generateContent?key={}",
            GEMINI_API_BASE, self.model, self.api_key
        );

        let response = self
            .client
            .post(&url)
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Gemini API request failed: {}", sanitize_error(&e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let _ = response.text().await; // consume body to free connection
            return Err(map_api_error(status));
        }

        let gemini_resp: GeminiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Gemini response: {}", sanitize_error(&e)))?;

        let response_text = gemini_resp
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .and_then(|p| p.text.clone())
            .filter(|t| !t.is_empty())
            .ok_or("Empty response from Gemini")?;

        let grading_result: GradingResult = serde_json::from_str(&response_text)
            .map_err(|e| format!("Failed to parse grading JSON: {}", sanitize_error(&e)))?;

        // Validate scores are within bounds
        for criterion_grade in &grading_result.criteria {
            if let Some(rubric_criterion) =
                rubric.iter().find(|r| r.id == criterion_grade.criterion_id)
            {
                if criterion_grade.score < 0.0 || criterion_grade.score > rubric_criterion.max_marks
                {
                    return Err(format!(
                        "Score {} out of bounds for criterion {} (max: {})",
                        criterion_grade.score,
                        criterion_grade.criterion_id,
                        rubric_criterion.max_marks
                    ));
                }
            }
        }

        Ok(grading_result)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RubricCriterion {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub max_marks: f64,
    pub sort_order: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_response_schema() {
        let client = GeminiClient::new("test-key".to_string(), None).unwrap();
        let rubric = vec![
            RubricCriterion {
                id: "c1".to_string(),
                name: "Criterion 1".to_string(),
                description: None,
                max_marks: 10.0,
                sort_order: 1,
            },
            RubricCriterion {
                id: "c2".to_string(),
                name: "Criterion 2".to_string(),
                description: None,
                max_marks: 5.0,
                sort_order: 2,
            },
        ];
        let schema = client.build_response_schema(&rubric);
        assert!(schema.get("properties").is_some());
        assert!(schema.get("required").is_some());
    }

    #[test]
    fn test_build_grading_prompt() {
        let client = GeminiClient::new("test-key".to_string(), None).unwrap();
        let rubric = vec![RubricCriterion {
            id: "c1".to_string(),
            name: "Understanding".to_string(),
            description: Some("Shows understanding".to_string()),
            max_marks: 10.0,
            sort_order: 1,
        }];
        let prompt = client
            .build_grading_prompt(&rubric, Some("Model answer here"), "Student answer here")
            .unwrap();
        assert!(prompt.contains("RUBRIC"));
        assert!(prompt.contains("MODEL ANSWER"));
        assert!(prompt.contains("STUDENT SUBMISSION"));
        assert!(prompt.contains("Student answer here"));
    }

    #[test]
    fn test_build_vision_grading_prompt() {
        let client = GeminiClient::new("test-key".to_string(), None).unwrap();
        let rubric = vec![RubricCriterion {
            id: "c1".to_string(),
            name: "Neatness".to_string(),
            description: None,
            max_marks: 5.0,
            sort_order: 1,
        }];
        let prompt = client
            .build_vision_grading_prompt(&rubric, Some("Model answer"), 3)
            .unwrap();
        assert!(prompt.contains("handwritten or scanned"));
        assert!(prompt.contains("3 file(s)"));
        assert!(prompt.contains("RUBRIC"));
        assert!(prompt.contains("MODEL ANSWER"));
        assert!(prompt.contains("illegible"));
    }

    #[test]
    fn test_build_vision_parts_structure() {
        let images = vec![
            VisionImage {
                label: "page1.png".to_string(),
                mime_type: "image/png".to_string(),
                data_base64: "cGFnZTE=".to_string(),
            },
            VisionImage {
                label: "scan.pdf".to_string(),
                mime_type: "application/pdf".to_string(),
                data_base64: "c2Nhbg==".to_string(),
            },
        ];
        let parts = GeminiClient::build_vision_parts("prompt text".to_string(), &images);
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].text.as_deref(), Some("prompt text"));
        assert!(parts[0].inline_data.is_none());
        assert!(parts[1].text.is_none());
        let inline = parts[1].inline_data.as_ref().unwrap();
        assert_eq!(inline.mime_type, "image/png");
        assert_eq!(inline.data, "cGFnZTE=");
        assert_eq!(parts[2].inline_data.as_ref().unwrap().mime_type, "application/pdf");

        // Serialized request must use camelCase inlineData and skip nulls.
        let json = serde_json::to_value(&parts[1]).unwrap();
        assert!(json.get("inlineData").is_some());
        assert!(json.get("text").is_none());
        assert_eq!(
            json["inlineData"]["mimeType"],
            serde_json::json!("image/png")
        );
    }

    #[test]
    fn test_grade_submission_vision_rejects_empty_images() {
        let client = GeminiClient::new("test-key".to_string(), None).unwrap();
        let rubric = vec![RubricCriterion {
            id: "c1".to_string(),
            name: "C".to_string(),
            description: None,
            max_marks: 5.0,
            sort_order: 1,
        }];
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(client.grade_submission_vision(&rubric, None, &[]));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No readable image"));
    }

    #[test]
    fn test_truncate_short_text_unchanged() {
        let text = "short submission";
        assert_eq!(truncate_for_model(text), text);
    }

    #[test]
    fn test_truncate_long_text_clips() {
        let text = "a".repeat(MAX_INPUT_CHARS + 100);
        let result = truncate_for_model(&text);
        assert!(result.len() < MAX_INPUT_CHARS + 100);
        assert!(result.ends_with("[Submission truncated for length.]"));
    }

    #[test]
    fn test_truncate_at_paragraph_boundary() {
        let mut text = "word ".repeat(MAX_INPUT_CHARS / 2);
        text.push('\n');
        text.push_str(&"more ".repeat(MAX_INPUT_CHARS));
        let result = truncate_for_model(&text);
        assert!(result.contains("[Submission truncated for length.]"));
        assert!(result.len() <= MAX_INPUT_CHARS + 100);
    }

    #[test]
    fn test_is_retryable_codes() {
        assert!(is_retryable("Gemini API error (500): boom"));
        assert!(is_retryable("Gemini API error (503): boom"));
        assert!(is_retryable("Gemini API error (429): boom"));
        assert!(!is_retryable("Gemini API error (400): bad request"));
        assert!(!is_retryable("Failed to parse grading JSON"));
    }

    #[test]
    fn test_empty_api_key_rejected() {
        let result = GeminiClient::new("".to_string(), None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));

        let result = GeminiClient::new("   ".to_string(), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_sanitize_error() {
        let err = std::io::Error::new(std::io::ErrorKind::Other, "test\nerror\rwith\twhitespace");
        let sanitized = sanitize_error(&err);
        assert!(!sanitized.contains('\n'));
        assert!(!sanitized.contains('\r'));
    }

    #[test]
    fn test_map_api_error() {
        assert_eq!(
            map_api_error(reqwest::StatusCode::UNAUTHORIZED),
            "Invalid or missing Gemini API key"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::TOO_MANY_REQUESTS),
            "Gemini API rate limit exceeded"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::INTERNAL_SERVER_ERROR),
            "Gemini API internal error"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::BAD_GATEWAY),
            "Gemini API bad gateway"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::SERVICE_UNAVAILABLE),
            "Gemini API temporarily unavailable"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::GATEWAY_TIMEOUT),
            "Gemini API gateway timeout"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::NOT_FOUND),
            "Gemini model not found"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::FORBIDDEN),
            "Gemini API access forbidden"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::BAD_REQUEST),
            "Invalid request to Gemini API"
        );
        assert_eq!(
            map_api_error(reqwest::StatusCode::from_u16(999).unwrap()),
            "Gemini API error (999)"
        );
    }
}
