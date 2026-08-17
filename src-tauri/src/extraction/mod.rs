pub mod commands;
pub mod docx;
pub mod ocr;
pub mod pdf;

use std::path::Path;

/// Detect file type from extension and extract text accordingly
pub fn extract_text_from_file(file_path: &str) -> Result<(String, String), String> {
    let path = Path::new(file_path);
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match extension.as_str() {
        "pdf" => {
            let text = pdf::extract_pdf_text(file_path)?;
            match text {
                Some(t) if !t.trim().is_empty() => Ok((t, "pdf".to_string())),
                _ => {
                    // Scanned PDF — try OCR
                    // For now, return a message since OCR is not yet integrated
                    Err("Scanned PDF detected. OCR support requires Tesseract. Install Tesseract and restart the app for scanned document support.".to_string())
                }
            }
        }
        "docx" => {
            let text = docx::extract_docx_text(file_path)?;
            Ok((text, "docx".to_string()))
        }
        "doc" => {
            Err("Legacy .doc format not supported. Please convert to .docx or .pdf.".to_string())
        }
        "txt" | "md" | "py" | "java" | "js" | "ts" | "c" | "cpp" | "rs" | "go" | "rb" | "html"
        | "css" | "json" | "xml" | "csv" => {
            let text = std::fs::read_to_string(file_path)
                .map_err(|e| format!("Failed to read text file: {}", e))?;
            Ok((text, "plaintext".to_string()))
        }
        "jpg" | "jpeg" | "png" | "tiff" | "tif" | "bmp" | "gif" | "webp" => {
            // OCR placeholder
            ocr::ocr_image(file_path).map(|text| (text, "ocr".to_string()))
        }
        _ => {
            // Try to read as plain text
            match std::fs::read_to_string(file_path) {
                Ok(text) => Ok((text, "plaintext".to_string())),
                Err(_) => Err(format!("Unsupported file type: .{}", extension)),
            }
        }
    }
}
