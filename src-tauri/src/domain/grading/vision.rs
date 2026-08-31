use super::gemini::{VisionImage, MAX_VISION_FILES, MAX_VISION_FILE_BYTES, MAX_VISION_TOTAL_BYTES};
use base64::{engine::general_purpose, Engine as _};
use std::path::Path;

/// Gemini-supported inline MIME types for handwritten/scanned work.
fn mime_for_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        "pdf" => Some("application/pdf"),
        _ => None,
    }
}

pub fn is_vision_gradable(file_name: &str) -> bool {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    mime_for_extension(&ext).is_some()
}

/// Split a name into digit / non-digit chunks for natural sorting.
fn split_chunks(s: &str) -> Vec<&str> {
    let mut chunks = Vec::new();
    let bytes = s.as_bytes();
    let mut start = 0;
    for i in 1..=bytes.len() {
        let prev_digit = bytes[i - 1].is_ascii_digit();
        let at_end = i == bytes.len();
        let curr_digit = !at_end && bytes[i].is_ascii_digit();
        if at_end || prev_digit != curr_digit {
            chunks.push(&s[start..i]);
            start = i;
        }
    }
    chunks
}

/// Natural ordering so "page-2.png" sorts before "page-10.png".
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let ca = split_chunks(a);
    let cb = split_chunks(b);
    for (x, y) in ca.iter().zip(cb.iter()) {
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(n), Ok(m)) => n.cmp(&m),
            _ => x.to_lowercase().cmp(&y.to_lowercase()),
        };
        if ord != std::cmp::Ordering::Equal {
            return ord;
        }
    }
    ca.len().cmp(&cb.len())
}

/// Collect all gradable image/PDF files from a student's submission directory,
/// ready to be sent to Gemini as inline parts.
///
/// Free-tier guardrails:
/// - At most `MAX_VISION_FILES` files per submission
/// - Files larger than `MAX_VISION_FILE_BYTES` are skipped (base64 would blow
///   the 20 MB inline request limit)
/// - Stops once the combined payload reaches `MAX_VISION_TOTAL_BYTES`
///
/// Files are sorted by name so multi-page scans ("scan-1.png", "scan-2.png")
/// reach the model in a stable, human order.
pub fn collect_vision_images(dir: &Path) -> Result<Vec<VisionImage>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut candidates: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read submission dir: {}", e))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    // Natural sort so multi-page scans reach the model in reading order
    // (page-2 before page-10).
    candidates.sort_by(|a, b| {
        let name_a = a.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let name_b = b.file_name().and_then(|n| n.to_str()).unwrap_or("");
        natural_cmp(name_a, name_b)
    });

    let mut images = Vec::new();
    let mut total_bytes = 0usize;

    for path in candidates {
        if images.len() >= MAX_VISION_FILES {
            log::warn!(
                "Vision cap reached ({} files) for {}; skipping the rest",
                MAX_VISION_FILES,
                dir.display()
            );
            break;
        }

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let Some(mime_type) = mime_for_extension(&ext) else {
            continue;
        };

        // Stat BEFORE reading: never load an oversized file into memory.
        let file_len = match std::fs::metadata(&path) {
            Ok(m) => m.len() as usize,
            Err(e) => {
                log::warn!("Skipping unreadable file {}: {}", file_name, e);
                continue;
            }
        };
        if file_len > MAX_VISION_FILE_BYTES {
            log::warn!(
                "Skipping {} ({} MB exceeds per-file cap)",
                file_name,
                file_len / (1024 * 1024)
            );
            continue;
        }
        if total_bytes + file_len > MAX_VISION_TOTAL_BYTES {
            log::warn!(
                "Total vision payload cap reached for {}; skipping {}",
                dir.display(),
                file_name
            );
            break;
        }

        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                log::warn!("Skipping unreadable file {}: {}", file_name, e);
                continue;
            }
        };

        total_bytes += file_len;
        images.push(VisionImage {
            label: file_name,
            mime_type: mime_type.to_string(),
            data_base64: general_purpose::STANDARD.encode(&bytes),
        });
    }

    Ok(images)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tempdir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_file(dir: &Path, name: &str, contents: &[u8]) {
        fs::write(dir.join(name), contents).unwrap();
    }

    #[test]
    fn test_mime_for_extension() {
        assert_eq!(mime_for_extension("png"), Some("image/png"));
        assert_eq!(mime_for_extension("jpg"), Some("image/jpeg"));
        assert_eq!(mime_for_extension("jpeg"), Some("image/jpeg"));
        assert_eq!(mime_for_extension("pdf"), Some("application/pdf"));
        assert_eq!(mime_for_extension("webp"), Some("image/webp"));
        assert_eq!(mime_for_extension("txt"), None);
        assert_eq!(mime_for_extension("docx"), None);
        assert_eq!(mime_for_extension("gif"), None);
    }

    #[test]
    fn test_is_vision_gradable() {
        assert!(is_vision_gradable("photo.PNG"));
        assert!(is_vision_gradable("scan.pdf"));
        assert!(!is_vision_gradable("notes.txt"));
        assert!(!is_vision_gradable("noext"));
    }

    #[test]
    fn test_collect_selects_supported_files_sorted() {
        let dir = tempdir();
        write_file(dir.path(), "b-scan.png", b"png-bytes");
        write_file(dir.path(), "a-photo.jpg", b"jpg-bytes");
        write_file(dir.path(), "c-notes.txt", b"ignore me");
        write_file(dir.path(), "d-scan.pdf", b"%PDF-bytes");

        let images = collect_vision_images(dir.path()).unwrap();
        assert_eq!(images.len(), 3);
        // Sorted by filename: a-photo.jpg, b-scan.png, d-scan.pdf
        assert_eq!(images[0].label, "a-photo.jpg");
        assert_eq!(images[0].mime_type, "image/jpeg");
        assert_eq!(images[1].label, "b-scan.png");
        assert_eq!(images[2].label, "d-scan.pdf");
        assert_eq!(images[2].mime_type, "application/pdf");
        // Base64 round-trips
        assert_eq!(
            general_purpose::STANDARD
                .decode(&images[0].data_base64)
                .unwrap(),
            b"jpg-bytes"
        );
    }

    #[test]
    fn test_natural_sort_pages_in_reading_order() {
        let dir = tempdir();
        for name in [
            "page-10.png",
            "page-2.png",
            "page-1.png",
            "page-20.png",
            "page-3.png",
        ] {
            write_file(dir.path(), name, b"x");
        }
        let images = collect_vision_images(dir.path()).unwrap();
        let labels: Vec<&str> = images.iter().map(|i| i.label.as_str()).collect();
        assert_eq!(
            labels,
            vec![
                "page-1.png",
                "page-2.png",
                "page-3.png",
                "page-10.png",
                "page-20.png"
            ]
        );
    }

    #[test]
    fn test_natural_cmp_basics() {
        use std::cmp::Ordering;
        assert_eq!(natural_cmp("page-2.png", "page-10.png"), Ordering::Less);
        assert_eq!(natural_cmp("scan9.jpg", "scan10.jpg"), Ordering::Less);
        assert_eq!(natural_cmp("A.png", "b.png"), Ordering::Less);
        assert_eq!(natural_cmp("same.png", "same.png"), Ordering::Equal);
        assert_eq!(natural_cmp("abc", "abcd"), Ordering::Less);
    }

    #[test]
    fn test_collect_skips_oversized_files() {
        let dir = tempdir();
        write_file(
            dir.path(),
            "huge.png",
            vec![0u8; MAX_VISION_FILE_BYTES + 1].as_slice(),
        );
        write_file(dir.path(), "ok.png", b"tiny");

        let images = collect_vision_images(dir.path()).unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].label, "ok.png");
    }

    #[test]
    fn test_collect_respects_file_count_cap() {
        let dir = tempdir();
        for i in 0..(MAX_VISION_FILES + 5) {
            write_file(dir.path(), &format!("page-{:02}.png", i), b"x");
        }
        let images = collect_vision_images(dir.path()).unwrap();
        assert_eq!(images.len(), MAX_VISION_FILES);
    }

    #[test]
    fn test_collect_stops_at_total_byte_cap() {
        let dir = tempdir();
        // Two files that together exceed MAX_VISION_TOTAL_BYTES but each stay
        // under the per-file cap.
        let half = MAX_VISION_TOTAL_BYTES / 2 + 1024;
        write_file(dir.path(), "a.png", vec![1u8; half].as_slice());
        write_file(dir.path(), "b.png", vec![2u8; half].as_slice());

        let images = collect_vision_images(dir.path()).unwrap();
        assert_eq!(images.len(), 1);
    }

    #[test]
    fn test_collect_empty_or_missing_dir() {
        let dir = tempdir();
        assert!(collect_vision_images(dir.path().join("nope").as_path())
            .unwrap()
            .is_empty());
        assert!(collect_vision_images(dir.path()).unwrap().is_empty());
    }
}
