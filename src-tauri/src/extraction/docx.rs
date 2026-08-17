use std::io::Read;

/// Extract text from a DOCX file by parsing the XML inside the ZIP
pub fn extract_docx_text(file_path: &str) -> Result<String, String> {
    let file = std::fs::File::open(file_path).map_err(|e| format!("Failed to open DOCX: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read DOCX as ZIP: {}", e))?;

    let mut doc_xml = archive
        .by_name("word/document.xml")
        .map_err(|e| format!("No document.xml found in DOCX: {}", e))?;

    let mut xml_str = String::new();
    doc_xml
        .read_to_string(&mut xml_str)
        .map_err(|e| format!("Failed to read document.xml: {}", e))?;

    let mut reader = quick_xml::reader::Reader::from_str(&xml_str);
    reader.config_mut().trim_text(true);
    let mut text_output = String::new();
    let mut buf = Vec::new();
    let mut in_paragraph = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(ref e)) => {
                let name = e.name();
                if name.as_ref() == b"w:p" {
                    in_paragraph = true;
                }
            }
            Ok(quick_xml::events::Event::End(ref e)) => {
                let name = e.name();
                if name.as_ref() == b"w:p" && in_paragraph {
                    text_output.push('\n');
                    in_paragraph = false;
                }
            }
            Ok(quick_xml::events::Event::Text(e)) => {
                if let Ok(text) = e.unescape() {
                    text_output.push_str(&text);
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error in DOCX: {}", e)),
            _ => (),
        }
        buf.clear();
    }

    Ok(text_output.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
    use quick_xml::Writer;
    use std::io::{Cursor, Write};
    use zip::write::FileOptions;

    fn create_test_docx(content: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options: FileOptions<()> =
                FileOptions::default().compression_method(zip::CompressionMethod::Stored);

            // Create [Content_Types].xml
            zip.start_file("[Content_Types].xml", options).unwrap();
            zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#).unwrap();

            // Create _rels/.rels
            zip.start_file("_rels/.rels", options).unwrap();
            zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#).unwrap();

            // Create word/_rels/document.xml.rels
            zip.start_file("word/_rels/document.xml.rels", options)
                .unwrap();
            zip.write_all(
                br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships>
</Relationships>"#,
            )
            .unwrap();

            // Create word/document.xml
            zip.start_file("word/document.xml", options).unwrap();
            let mut writer = Writer::new(&mut zip);
            writer
                .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
                .unwrap();

            // w:document
            let mut doc_start = BytesStart::new("w:document");
            doc_start.push_attribute((
                "xmlns:w",
                "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            ));
            writer.write_event(Event::Start(doc_start)).unwrap();

            // w:body
            writer
                .write_event(Event::Start(BytesStart::new("w:body")))
                .unwrap();

            // w:p (paragraph)
            writer
                .write_event(Event::Start(BytesStart::new("w:p")))
                .unwrap();
            writer
                .write_event(Event::Start(BytesStart::new("w:r")))
                .unwrap();
            writer
                .write_event(Event::Start(BytesStart::new("w:t")))
                .unwrap();
            writer
                .write_event(Event::Text(BytesText::new(content)))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:t")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:r")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:p")))
                .unwrap();

            writer
                .write_event(Event::End(BytesEnd::new("w:body")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:document")))
                .unwrap();
        }
        buf
    }

    #[test]
    fn test_extract_docx_text() {
        let docx_bytes = create_test_docx("Hello World! This is a test document.");

        // Write to temp file
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_docx.docx");
        std::fs::write(&temp_path, docx_bytes).unwrap();

        let result = extract_docx_text(temp_path.to_str().unwrap());
        assert!(result.is_ok());
        let text = result.unwrap();
        assert!(text.contains("Hello World"));
        assert!(text.contains("test document"));

        // Cleanup
        std::fs::remove_file(temp_path).ok();
    }

    #[test]
    fn test_extract_docx_multiple_paragraphs() {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options: FileOptions<()> =
                FileOptions::default().compression_method(zip::CompressionMethod::Stored);

            zip.start_file("[Content_Types].xml", options).unwrap();
            zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#).unwrap();

            zip.start_file("_rels/.rels", options).unwrap();
            zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#).unwrap();

            zip.start_file("word/_rels/document.xml.rels", options)
                .unwrap();
            zip.write_all(
                br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships>
</Relationships>"#,
            )
            .unwrap();

            zip.start_file("word/document.xml", options).unwrap();
            let mut writer = Writer::new(&mut zip);
            writer
                .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
                .unwrap();

            let mut doc_start = BytesStart::new("w:document");
            doc_start.push_attribute((
                "xmlns:w",
                "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            ));
            writer.write_event(Event::Start(doc_start)).unwrap();

            writer
                .write_event(Event::Start(BytesStart::new("w:body")))
                .unwrap();

            // First paragraph
            writer
                .write_event(Event::Start(BytesStart::new("w:p")))
                .unwrap();
            writer
                .write_event(Event::Start(BytesStart::new("w:r")))
                .unwrap();
            writer
                .write_event(Event::Start(BytesStart::new("w:t")))
                .unwrap();
            writer
                .write_event(Event::Text(BytesText::new("First paragraph")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:t")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:r")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:p")))
                .unwrap();

            // Second paragraph
            writer
                .write_event(Event::Start(BytesStart::new("w:p")))
                .unwrap();
            writer
                .write_event(Event::Start(BytesStart::new("w:r")))
                .unwrap();
            writer
                .write_event(Event::Start(BytesStart::new("w:t")))
                .unwrap();
            writer
                .write_event(Event::Text(BytesText::new("Second paragraph")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:t")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:r")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:p")))
                .unwrap();

            writer
                .write_event(Event::End(BytesEnd::new("w:body")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:document")))
                .unwrap();
        }

        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("test_docx_multi.docx");
        std::fs::write(&temp_path, buf).unwrap();

        let result = extract_docx_text(temp_path.to_str().unwrap());
        assert!(result.is_ok());
        let text = result.unwrap();
        assert!(text.contains("First paragraph"));
        assert!(text.contains("Second paragraph"));
        // Should have newline between paragraphs
        assert!(text.contains("\n"));

        std::fs::remove_file(temp_path).ok();
    }

    #[test]
    fn test_extract_docx_nonexistent() {
        let result = extract_docx_text("/nonexistent/path.docx");
        assert!(result.is_err());
    }
}
