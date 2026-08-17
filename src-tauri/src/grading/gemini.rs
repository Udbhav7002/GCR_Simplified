use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Rough character cap for a submission (~8k tokens) to stay inside the model
/// context window alongside the rubric + prompt.
const MAX_INPUT_CHARS: usize = 32_000;

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
    pub text: String,
}

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

pub struct GeminiClient {
    client: Client,
    api_key: String,
    model: String,
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

/// Whether an API error is worth retrying once (5xx / server hiccups).
fn is_retryable(error: &str) -> bool {
    error.contains("500")
        || error.contains("503")
        || error.contains("429")
        || error.contains("502")
        || error.contains("504")
}

impl GeminiClient {
    pub fn new(api_key: String, model: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("Failed to create HTTP client"),
            api_key,
            model: model.unwrap_or_else(|| "gemini-2.5-flash".to_string()),
        }
    }

    fn build_grading_prompt(
        &self,
        rubric: &[RubricCriterion],
        model_answer: Option<&str>,
        student_text: &str,
    ) -> String {
        let rubric_json = serde_json::to_string_pretty(rubric).unwrap_or_default();
        let model_answer_section = model_answer
            .map(|ma| format!("\n\nMODEL ANSWER:\n{}", ma))
            .unwrap_or_default();

        format!(
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
        )
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
        let prompt = self.build_grading_prompt(rubric, model_answer, &truncated);
        let schema = self.build_response_schema(rubric);

        // Single retry on transient failures (5xx or malformed JSON).
        let mut last_err: Option<String> = None;
        for attempt in 0..2 {
            match self.call_gemini(&prompt, &schema, rubric).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    if attempt == 0 && is_retryable(&e) {
                        last_err = Some(e);
                        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                    } else {
                        return Err(e);
                    }
                }
            }
        }
        Err(last_err.unwrap_or_else(|| "Gemini request failed".to_string()))
    }

    async fn call_gemini(
        &self,
        prompt: &str,
        schema: &serde_json::Value,
        rubric: &[RubricCriterion],
    ) -> Result<GradingResult, String> {
        let request = GeminiRequest {
            contents: vec![GeminiContent {
                role: "user".to_string(),
                parts: vec![GeminiPart {
                    text: prompt.to_string(),
                }],
            }],
            generation_config: GeminiGenerationConfig {
                response_mime_type: "application/json".to_string(),
                response_schema: schema.clone(),
                max_output_tokens: 4096,
                temperature: 0.1,
            },
        };

        let url = format!(
            "{}/{}:generateContent?key={}",
            GEMINI_API_BASE, self.model, self.api_key
        );

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Gemini API request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Gemini API error ({}): {}", status, error_text));
        }

        let gemini_resp: GeminiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

        let response_text = gemini_resp
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.clone())
            .ok_or("Empty response from Gemini")?;

        let grading_result: GradingResult = serde_json::from_str(&response_text).map_err(|e| {
            format!(
                "Failed to parse grading JSON: {}. Response: {}",
                e, response_text
            )
        })?;

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
        let client = GeminiClient::new("test-key".to_string(), None);
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
        let client = GeminiClient::new("test-key".to_string(), None);
        let rubric = vec![RubricCriterion {
            id: "c1".to_string(),
            name: "Understanding".to_string(),
            description: Some("Shows understanding".to_string()),
            max_marks: 10.0,
            sort_order: 1,
        }];
        let prompt =
            client.build_grading_prompt(&rubric, Some("Model answer here"), "Student answer here");
        assert!(prompt.contains("RUBRIC"));
        assert!(prompt.contains("MODEL ANSWER"));
        assert!(prompt.contains("STUDENT SUBMISSION"));
        assert!(prompt.contains("Student answer here"));
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
}
