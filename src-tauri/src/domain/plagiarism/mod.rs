pub mod commands;
pub mod tfidf;
pub mod winnowing;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PairwiseResult {
    pub student_a_name: String,
    pub student_a_id: String,
    pub student_a_file: String,
    pub student_b_name: String,
    pub student_b_id: String,
    pub student_b_file: String,
    pub fingerprint_score: f64,
    pub semantic_score: f64,
    pub combined_score: f64,
    pub flagged: bool,
    pub is_identical_file: bool,
    pub matched_fragments: Vec<MatchedFragment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MatchedFragment {
    pub text_a: String,
    pub text_b: String,
    pub similarity: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlagiarismReport {
    pub course_id: String,
    pub course_work_id: String,
    pub total_submissions: usize,
    pub pairs_checked: usize,
    pub flagged_pairs: usize,
    pub results: Vec<PairwiseResult>,
    pub fingerprint_threshold: f64,
    pub semantic_threshold: f64,
    pub created_at: String,
}

/// Normalize text for comparison: lowercase, collapse whitespace, remove punctuation
pub fn normalize_text(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
