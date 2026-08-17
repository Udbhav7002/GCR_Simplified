use super::{normalize_text, MatchedFragment};
use std::collections::{HashMap, HashSet};

const K_GRAM_SIZE: usize = 5; // Number of words per k-gram
const WINDOW_SIZE: usize = 4; // Winnowing window size

/// Simple hash function for k-grams (FNV-1a inspired)
fn hash_kgram(kgram: &str) -> u64 {
    let mut hash: u64 = 14695981039346656037;
    for byte in kgram.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

/// Generate k-grams from normalized text (word-level)
fn generate_kgrams(text: &str, k: usize) -> Vec<(String, u64)> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < k {
        return Vec::new();
    }
    let mut kgrams = Vec::new();
    for i in 0..=(words.len() - k) {
        let kgram = words[i..i + k].join(" ");
        let hash = hash_kgram(&kgram);
        kgrams.push((kgram, hash));
    }
    kgrams
}

/// Apply winnowing algorithm to select fingerprint hashes
fn winnow(hashes: &[u64], window_size: usize) -> HashSet<u64> {
    if hashes.is_empty() {
        return HashSet::new();
    }
    let mut fingerprints = HashSet::new();
    if hashes.len() <= window_size {
        // If fewer hashes than window, take the minimum
        if let Some(&min) = hashes.iter().min() {
            fingerprints.insert(min);
        }
        return fingerprints;
    }

    for i in 0..=(hashes.len() - window_size) {
        let window = &hashes[i..i + window_size];
        if let Some(&min) = window.iter().min() {
            fingerprints.insert(min);
        }
    }
    fingerprints
}

/// Compute Jaccard similarity between two sets of fingerprints
fn jaccard_similarity(set_a: &HashSet<u64>, set_b: &HashSet<u64>) -> f64 {
    if set_a.is_empty() && set_b.is_empty() {
        return 0.0;
    }
    let intersection = set_a.intersection(set_b).count() as f64;
    let union = set_a.union(set_b).count() as f64;
    if union == 0.0 {
        return 0.0;
    }
    intersection / union
}

/// Extract fingerprints from text
pub fn extract_fingerprints(text: &str) -> (HashSet<u64>, HashMap<u64, String>) {
    let normalized = normalize_text(text);
    let kgrams = generate_kgrams(&normalized, K_GRAM_SIZE);
    let hashes: Vec<u64> = kgrams.iter().map(|(_, h)| *h).collect();
    let hash_to_text: HashMap<u64, String> = kgrams.into_iter().map(|(t, h)| (h, t)).collect();
    let fingerprints = winnow(&hashes, WINDOW_SIZE);
    (fingerprints, hash_to_text)
}

/// Compare two texts using winnowing fingerprinting
/// Returns (similarity_score, matched_fragments)
pub fn compare_winnowing(text_a: &str, text_b: &str) -> (f64, Vec<MatchedFragment>) {
    let (fp_a, map_a) = extract_fingerprints(text_a);
    let (fp_b, map_b) = extract_fingerprints(text_b);

    let score = jaccard_similarity(&fp_a, &fp_b);

    // Find matched fragments (common fingerprints)
    let mut fragments = Vec::new();
    let common: HashSet<_> = fp_a.intersection(&fp_b).copied().collect();

    // Limit to top 10 fragments
    let mut common_vec: Vec<u64> = common.into_iter().collect();
    common_vec.truncate(10);

    for hash in common_vec {
        let text_a_frag = map_a.get(&hash).cloned().unwrap_or_default();
        let text_b_frag = map_b.get(&hash).cloned().unwrap_or_default();
        if !text_a_frag.is_empty() {
            fragments.push(MatchedFragment {
                text_a: text_a_frag,
                text_b: text_b_frag,
                similarity: 1.0,
            });
        }
    }

    (score, fragments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_text() {
        assert_eq!(normalize_text("Hello World!"), "hello world");
        assert_eq!(normalize_text("  Multiple   Spaces  "), "multiple spaces");
        assert_eq!(normalize_text("UPPERCASE"), "uppercase");
        assert_eq!(normalize_text("Special@#$%Chars"), "special chars");
        assert_eq!(normalize_text(""), "");
    }

    #[test]
    fn test_hash_kgram() {
        let hash1 = hash_kgram("hello world test this");
        let hash2 = hash_kgram("hello world test this");
        let hash3 = hash_kgram("different words here");
        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_generate_kgrams() {
        let kgrams = generate_kgrams("one two three four five six", 3);
        assert_eq!(kgrams.len(), 4); // 6 words - 3 + 1 = 4 k-grams
        assert_eq!(kgrams[0].0, "one two three");
        assert_eq!(kgrams[3].0, "four five six");
    }

    #[test]
    fn test_generate_kgrams_short_text() {
        let kgrams = generate_kgrams("one two", 5);
        assert!(kgrams.is_empty());
    }

    #[test]
    fn test_winnow() {
        let hashes = vec![10, 5, 8, 3, 7, 2, 9];
        let fingerprints = winnow(&hashes, 3);
        // Window 0: [10,5,8] -> min=5
        // Window 1: [5,8,3] -> min=3
        // Window 2: [8,3,7] -> min=3
        // Window 3: [3,7,2] -> min=2
        // Window 4: [7,2,9] -> min=2
        assert!(fingerprints.contains(&5));
        assert!(fingerprints.contains(&3));
        assert!(fingerprints.contains(&2));
    }

    #[test]
    fn test_winnow_short() {
        let hashes = vec![10, 5, 8];
        let fingerprints = winnow(&hashes, 5);
        assert_eq!(fingerprints.len(), 1);
        assert!(fingerprints.contains(&5));
    }

    #[test]
    fn test_jaccard_similarity() {
        let mut set_a = HashSet::new();
        set_a.insert(1);
        set_a.insert(2);
        set_a.insert(3);

        let mut set_b = HashSet::new();
        set_b.insert(2);
        set_b.insert(3);
        set_b.insert(4);

        let sim = jaccard_similarity(&set_a, &set_b);
        assert!((sim - 0.5).abs() < 0.001); // intersection=2, union=4
    }

    #[test]
    fn test_jaccard_empty() {
        let set_a = HashSet::new();
        let set_b = HashSet::new();
        assert_eq!(jaccard_similarity(&set_a, &set_b), 0.0);
    }

    #[test]
    fn test_compare_winnowing_identical() {
        let text = "This is a test document for plagiarism detection";
        let (score, fragments) = compare_winnowing(text, text);
        assert!((score - 1.0).abs() < 0.001);
        assert!(!fragments.is_empty());
    }

    #[test]
    fn test_compare_winnowing_different() {
        let text_a = "This is a test document";
        let text_b = "Completely different content here";
        let (score, _) = compare_winnowing(text_a, text_b);
        assert!(score < 0.5);
    }

    #[test]
    fn test_compare_winnowing_short_text() {
        let text_a = "Short";
        let text_b = "Short";
        let (score, _) = compare_winnowing(text_a, text_b);
        // Short text (< 5 words) produces no k-grams, so similarity is 0
        assert_eq!(score, 0.0);
    }

    #[test]
    fn test_extract_fingerprints() {
        let text = "This is a test document for fingerprint extraction";
        let (fingerprints, map) = extract_fingerprints(text);
        assert!(!fingerprints.is_empty());
        assert!(!map.is_empty());
    }
}
