/// Extract text from a PDF file using pdf-extract
/// Returns Some(text) for text-based PDFs, None for scanned PDFs
pub fn extract_pdf_text(file_path: &str) -> Result<Option<String>, String> {
    let bytes = std::fs::read(file_path).map_err(|e| format!("Failed to read PDF: {}", e))?;

    match pdf_extract::extract_text_from_mem(&bytes) {
        Ok(text) => {
            let trimmed = text.trim().to_string();
            if trimmed.is_empty() || trimmed.len() < 10 {
                Ok(None) // Likely a scanned PDF
            } else {
                Ok(Some(trimmed))
            }
        }
        Err(e) => {
            // pdf-extract errors can happen on scanned PDFs or complex PDFs
            // Don't treat as a hard error, just return None to signal OCR needed
            log::debug!("pdf-extract warning: {}", e);
            Ok(None)
        }
    }
}
