/// OCR placeholder — will be replaced with Tesseract integration
/// For now, returns an error message
pub fn ocr_image(_file_path: &str) -> Result<String, String> {
    Err("OCR support requires Tesseract. Install Tesseract and restart the app for scanned document support.".to_string())
}
