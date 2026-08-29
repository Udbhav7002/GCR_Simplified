use super::normalize_text;
use std::collections::HashMap;

/// Tokenize text into words
fn tokenize(text: &str) -> Vec<String> {
    normalize_text(text)
        .split_whitespace()
        .filter(|w| w.len() > 2) // Skip very short words
        .map(|w| w.to_string())
        .collect()
}

/// Compute term frequency for a document
fn compute_tf(tokens: &[String]) -> HashMap<String, f64> {
    let mut freq: HashMap<String, f64> = HashMap::new();
    let total = tokens.len() as f64;
    if total == 0.0 {
        return freq;
    }
    for token in tokens {
        *freq.entry(token.clone()).or_insert(0.0) += 1.0;
    }
    for val in freq.values_mut() {
        *val /= total;
    }
    freq
}

/// Compute IDF across all documents
fn compute_idf(documents: &[Vec<String>]) -> HashMap<String, f64> {
    let n = documents.len() as f64;
    let mut doc_freq: HashMap<String, f64> = HashMap::new();

    for doc in documents {
        let unique: std::collections::HashSet<_> = doc.iter().collect();
        for word in unique {
            *doc_freq.entry(word.clone()).or_insert(0.0) += 1.0;
        }
    }

    let mut idf: HashMap<String, f64> = HashMap::new();
    for (word, df) in doc_freq {
        idf.insert(word, (n / df).ln() + 1.0);
    }
    idf
}

/// Compute TF-IDF vector for a document given precomputed IDF
fn compute_tfidf_vector(
    tf: &HashMap<String, f64>,
    idf: &HashMap<String, f64>,
    vocabulary: &[String],
) -> Vec<f64> {
    vocabulary
        .iter()
        .map(|word| {
            let tf_val = tf.get(word).copied().unwrap_or(0.0);
            let idf_val = idf.get(word).copied().unwrap_or(1.0);
            tf_val * idf_val
        })
        .collect()
}

/// Compute cosine similarity between two vectors
fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

/// Compare multiple documents and return pairwise cosine similarity matrix
/// Input: list of (id, text) pairs
/// Output: list of (id_a, id_b, similarity) triples
pub fn compare_all_tfidf(documents: &[(String, String)]) -> Vec<(String, String, f64)> {
    if documents.len() < 2 {
        return Vec::new();
    }

    // Tokenize all documents
    let tokenized: Vec<Vec<String>> = documents.iter().map(|(_, text)| tokenize(text)).collect();

    // Compute IDF
    let idf = compute_idf(&tokenized);

    // Build vocabulary (all unique words)
    let mut vocabulary: Vec<String> = idf.keys().cloned().collect();
    vocabulary.sort();

    // Compute TF-IDF vectors
    let tfs: Vec<HashMap<String, f64>> =
        tokenized.iter().map(|tokens| compute_tf(tokens)).collect();
    let vectors: Vec<Vec<f64>> = tfs
        .iter()
        .map(|tf| compute_tfidf_vector(tf, &idf, &vocabulary))
        .collect();

    // Pairwise comparison
    let mut results = Vec::new();
    for i in 0..documents.len() {
        for j in (i + 1)..documents.len() {
            let sim = cosine_similarity(&vectors[i], &vectors[j]);
            results.push((documents[i].0.clone(), documents[j].0.clone(), sim));
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize() {
        let tokens = tokenize("Hello World! This is a test.");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
        assert!(tokens.contains(&"this".to_string()));
        assert!(tokens.contains(&"test".to_string()));
        // "is" and "a" should be filtered out (len <= 2)
        assert!(!tokens.contains(&"is".to_string()));
        assert!(!tokens.contains(&"a".to_string()));
    }

    #[test]
    fn test_tokenize_empty() {
        let tokens = tokenize("");
        assert!(tokens.is_empty());
    }

    #[test]
    fn test_compute_tf() {
        let tokens = vec![
            "hello".to_string(),
            "world".to_string(),
            "hello".to_string(),
        ];
        let tf = compute_tf(&tokens);
        assert!((tf.get("hello").copied().unwrap_or(0.0) - 2.0 / 3.0).abs() < 0.001);
        assert!((tf.get("world").copied().unwrap_or(0.0) - 1.0 / 3.0).abs() < 0.001);
    }

    #[test]
    fn test_compute_tf_empty() {
        let tf = compute_tf(&[]);
        assert!(tf.is_empty());
    }

    #[test]
    fn test_compute_idf() {
        let docs = vec![
            vec!["hello".to_string(), "world".to_string()],
            vec!["hello".to_string(), "test".to_string()],
        ];
        let idf = compute_idf(&docs);
        // "hello" appears in 2/2 docs -> idf = ln(2/2) + 1 = 1
        // "world" appears in 1/2 docs -> idf = ln(2/1) + 1 = ln(2) + 1
        // "test" appears in 1/2 docs -> idf = ln(2/1) + 1 = ln(2) + 1
        assert!((idf.get("hello").copied().unwrap_or(0.0) - 1.0).abs() < 0.001);
        assert!((idf.get("world").copied().unwrap_or(0.0) - (2.0_f64.ln() + 1.0)).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 0.001);

        let c = vec![1.0, 0.0, 0.0];
        let d = vec![0.0, 1.0, 0.0];
        assert!((cosine_similarity(&c, &d) - 0.0).abs() < 0.001);

        let e = vec![1.0, 1.0];
        let f = vec![1.0, 1.0];
        assert!((cosine_similarity(&e, &f) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_zero_magnitude() {
        let a = vec![0.0, 0.0];
        let b = vec![1.0, 1.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn test_compare_all_tfidf_identical() {
        let docs = vec![
            (
                "doc1".to_string(),
                "This is a test document for similarity".to_string(),
            ),
            (
                "doc2".to_string(),
                "This is a test document for similarity".to_string(),
            ),
        ];
        let results = compare_all_tfidf(&docs);
        assert_eq!(results.len(), 1);
        assert!((results[0].2 - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_compare_all_tfidf_different() {
        let docs = vec![
            ("doc1".to_string(), "This is a test document".to_string()),
            (
                "doc2".to_string(),
                "Completely different content here".to_string(),
            ),
        ];
        let results = compare_all_tfidf(&docs);
        assert_eq!(results.len(), 1);
        assert!(results[0].2 < 0.5);
    }

    #[test]
    fn test_compare_all_tfidf_single_doc() {
        let docs = vec![("doc1".to_string(), "Single document".to_string())];
        let results = compare_all_tfidf(&docs);
        assert!(results.is_empty());
    }

    #[test]
    fn test_compare_all_tfidf_three_docs() {
        let docs = vec![
            ("doc1".to_string(), "First document content".to_string()),
            ("doc2".to_string(), "Second document content".to_string()),
            ("doc3".to_string(), "Third document content".to_string()),
        ];
        let results = compare_all_tfidf(&docs);
        assert_eq!(results.len(), 3); // 3 choose 2 = 3 pairs
    }
}
