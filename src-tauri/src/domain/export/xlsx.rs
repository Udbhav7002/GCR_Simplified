use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, XlsxError};
use std::path::Path;

use crate::domain::grading::commands::{GradebookRow, GradebookView};

/// A row in the integrity report sheet.
#[derive(Debug, Clone)]
pub struct IntegrityRow {
    pub student_a: String,
    pub student_b: String,
    pub fingerprint: f64,
    pub semantic: f64,
    pub combined: f64,
    pub flagged: bool,
}

/// Cell formats shared by all four sheets.
struct SheetFormats {
    header: Format,
    title: Format,
    normal: Format,
    num: Format,
    text: Format,
    green: Format,
    amber: Format,
    red: Format,
}

fn make_formats() -> SheetFormats {
    SheetFormats {
        header: Format::new()
            .set_bold()
            .set_font_color(Color::White)
            .set_background_color(Color::RGB(0x1F4E78))
            .set_align(FormatAlign::Center)
            .set_border(FormatBorder::Thin),
        title: Format::new()
            .set_bold()
            .set_font_size(16)
            .set_font_color(Color::RGB(0x1F4E78)),
        normal: Format::new().set_border(FormatBorder::Thin),
        num: Format::new()
            .set_num_format("0.00")
            .set_align(FormatAlign::Center)
            .set_border(FormatBorder::Thin),
        text: Format::new().set_text_wrap().set_border(FormatBorder::Thin),
        green: Format::new()
            .set_background_color(Color::RGB(0xC6EFCE))
            .set_font_color(Color::RGB(0x006100))
            .set_align(FormatAlign::Center)
            .set_border(FormatBorder::Thin),
        amber: Format::new()
            .set_background_color(Color::RGB(0xFFEB9C))
            .set_font_color(Color::RGB(0x9C6500))
            .set_align(FormatAlign::Center)
            .set_border(FormatBorder::Thin),
        red: Format::new()
            .set_background_color(Color::RGB(0xFFC7CE))
            .set_font_color(Color::RGB(0x9C0006))
            .set_align(FormatAlign::Center)
            .set_border(FormatBorder::Thin),
    }
}

pub fn export_gradebook_xlsx(
    gradebook: &GradebookView,
    _integrity: &[IntegrityRow],
    save_path: &Path,
) -> Result<String, String> {
    let mut workbook = Workbook::new();
    let fmt = make_formats();

    write_simple_grade_sheet(&mut workbook, gradebook, &fmt).map_err(|e| e.to_string())?;

    workbook
        .save(save_path)
        .map_err(|e| format!("Failed to write Excel file: {}", e))?;

    Ok(save_path.to_string_lossy().to_string())
}

fn write_summary_sheet(
    workbook: &mut Workbook,
    gradebook: &GradebookView,
    fmt: &SheetFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Summary")?;
    sheet.set_column_width(0, 45)?;
    sheet.set_column_width(1, 25)?;

    let rows = &gradebook.rows;
    let total_students = rows.len();
    let graded = rows.iter().filter(|r| r.grading_status == "graded").count();
    let submission_rate = if total_students > 0 {
        graded as f64 / total_students as f64 * 100.0
    } else {
        0.0
    };

    let approved_scores: Vec<f64> = rows
        .iter()
        .flat_map(|r| r.grades.iter())
        .filter(|g| g.approved || g.graded_by == "teacher")
        .filter_map(|g| g.score)
        .collect();
    let average_score = if approved_scores.is_empty() {
        0.0
    } else {
        approved_scores.iter().sum::<f64>() / approved_scores.len() as f64
    };

    let suggested = rows
        .iter()
        .flat_map(|r| r.grades.iter())
        .filter(|g| g.graded_by == "ai" && !g.approved)
        .count();

    let handwritten = rows
        .iter()
        .filter(|r| r.grading_status == "graded" && r.graded_via == "vision")
        .count();

    sheet.merge_range(0, 0, 0, 1, "Assignment Summary", &fmt.title)?;
    sheet.write_with_format(2, 0, "Class", &fmt.normal)?;
    sheet.write_with_format(2, 1, &gradebook.class_name, &fmt.normal)?;
    sheet.write_with_format(3, 0, "Assignment", &fmt.normal)?;
    sheet.write_with_format(3, 1, &gradebook.assignment_title, &fmt.normal)?;
    sheet.write_with_format(4, 0, "Total Students", &fmt.normal)?;
    sheet.write_number_with_format(4, 1, total_students as f64, &fmt.num)?;
    sheet.write_with_format(5, 0, "Graded Students", &fmt.normal)?;
    sheet.write_number_with_format(5, 1, graded as f64, &fmt.num)?;
    sheet.write_with_format(6, 0, "Submission Rate (%)", &fmt.normal)?;
    sheet.write_number_with_format(6, 1, submission_rate, &fmt.num)?;
    sheet.write_with_format(7, 0, "Average Approved Score", &fmt.normal)?;
    sheet.write_number_with_format(7, 1, average_score, &fmt.num)?;
    sheet.write_with_format(8, 0, "AI Suggested Grades (unapproved)", &fmt.normal)?;
    sheet.write_number_with_format(8, 1, suggested as f64, &fmt.num)?;
    sheet.write_with_format(9, 0, "Handwritten (vision-graded)", &fmt.normal)?;
    sheet.write_number_with_format(9, 1, handwritten as f64, &fmt.num)?;

    Ok(())
}

/// Human-readable identity evidence parsed from the uploaded filename, with a
/// ✓ when the reg hint matches the roster roll number (suffix match) and ⚠
/// when it doesn't.
fn filename_evidence(row: &GradebookRow) -> String {
    match (&row.file_reg_no, &row.file_name_hint) {
        (None, None) => "-".to_string(),
        (reg, name) => {
            let mut parts = Vec::new();
            if let Some(r) = reg {
                let matches = row
                    .roll_number
                    .to_lowercase()
                    .ends_with(&r.to_lowercase());
                parts.push(format!("{}{}", r, if matches { " ✓" } else { " ⚠" }));
            }
            if let Some(n) = name {
                parts.push(n.clone());
            }
            parts.join(" · ")
        }
    }
}

fn write_simple_grade_sheet(
    workbook: &mut Workbook,
    gradebook: &GradebookView,
    fmt: &SheetFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Grades")?;
    sheet.set_column_width(0, 35)?;
    sheet.set_column_width(1, 20)?;
    sheet.set_column_width(2, 15)?;

    sheet.merge_range(0, 0, 0, 2, "Gradebook", &fmt.title)?;

    sheet.write_string_with_format(1, 0, "Student Name", &fmt.header)?;
    sheet.write_string_with_format(1, 1, "Reg No", &fmt.header)?;
    sheet.write_string_with_format(1, 2, "Marks", &fmt.header)?;

    for (row, gradebook_row) in (2..).zip(gradebook.rows.iter()) {
        sheet.write_string_with_format(row, 0, &gradebook_row.student_name, &fmt.normal)?;
        let reg_no = gradebook_row.file_reg_no.clone().unwrap_or_else(|| "-".to_string());
        sheet.write_string_with_format(row, 1, &reg_no, &fmt.normal)?;

        let mut total = 0.0_f64;
        for c in &gradebook.rubric {
            let grade = gradebook_row.grades.iter().find(|g| g.criterion_id == c.id);
            if let Some(g) = grade {
                if let Some(score) = g.score {
                    total += score;
                }
            }
        }
        sheet.write_number_with_format(row, 2, total, &fmt.num)?;
    }

    Ok(())
}

fn write_integrity_sheet(
    workbook: &mut Workbook,
    integrity: &[IntegrityRow],
    fmt: &SheetFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Integrity Report")?;
    sheet.set_column_width(0, 28)?;
    sheet.set_column_width(1, 28)?;
    sheet.set_column_width(2, 16)?;
    sheet.set_column_width(3, 16)?;
    sheet.set_column_width(4, 16)?;

    sheet.merge_range(
        0,
        0,
        0,
        4,
        "Integrity Report (Similarity Analysis)",
        &fmt.title,
    )?;

    if integrity.is_empty() {
        sheet.write_string_with_format(
            1,
            0,
            "No similarity analysis available for this assignment.",
            &fmt.normal,
        )?;
        return Ok(());
    }

    sheet.write_string_with_format(1, 0, "Student A", &fmt.header)?;
    sheet.write_string_with_format(1, 1, "Student B", &fmt.header)?;
    sheet.write_string_with_format(1, 2, "Fingerprint", &fmt.header)?;
    sheet.write_string_with_format(1, 3, "Semantic", &fmt.header)?;
    sheet.write_string_with_format(1, 4, "Combined", &fmt.header)?;

    for (row, pair) in (2..).zip(integrity.iter()) {
        let cell_fmt = if pair.flagged { &fmt.red } else { &fmt.num };
        sheet.write_string_with_format(row, 0, &pair.student_a, &fmt.normal)?;
        sheet.write_string_with_format(row, 1, &pair.student_b, &fmt.normal)?;
        sheet.write_number_with_format(row, 2, pair.fingerprint, cell_fmt)?;
        sheet.write_number_with_format(row, 3, pair.semantic, cell_fmt)?;
        sheet.write_number_with_format(row, 4, pair.combined, cell_fmt)?;
    }

    Ok(())
}

fn write_feedback_sheet(
    workbook: &mut Workbook,
    gradebook: &GradebookView,
    fmt: &SheetFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Feedback Log")?;
    sheet.set_column_width(0, 28)?;
    sheet.set_column_width(1, 60)?;

    sheet.merge_range(0, 0, 0, 1, "Feedback Log", &fmt.title)?;

    sheet.write_string_with_format(1, 0, "Student", &fmt.header)?;
    sheet.write_string_with_format(1, 1, "AI Feedback", &fmt.header)?;

    let mut row = 2;
    for gradebook_row in &gradebook.rows {
        if let Some(feedback) = &gradebook_row.ai_feedback {
            if !feedback.trim().is_empty() {
                sheet.write_string_with_format(row, 0, &gradebook_row.student_name, &fmt.normal)?;
                sheet.write_string_with_format(row, 1, feedback, &fmt.text)?;
                row += 1;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::grading::commands::{Grade, GradebookRow, RubricCriterion};

    fn sample_gradebook() -> GradebookView {
        GradebookView {
            assignment_id: "a1".to_string(),
            assignment_title: "Essay Test".to_string(),
            class_name: "CSE 2026 Section 3".to_string(),
            rubric: vec![
                RubricCriterion {
                    id: "c1".to_string(),
                    assignment_id: "a1".to_string(),
                    name: "Clarity".to_string(),
                    description: Some("Clarity of writing".to_string()),
                    max_marks: 10.0,
                    sort_order: 1,
                },
                RubricCriterion {
                    id: "c2".to_string(),
                    assignment_id: "a1".to_string(),
                    name: "Content".to_string(),
                    description: None,
                    max_marks: 10.0,
                    sort_order: 2,
                },
            ],
            rows: vec![
                GradebookRow {
                    submission_id: "s1".to_string(),
                    student_id: "stu1".to_string(),
                    student_name: "Alice Smith".to_string(),
                    student_email: Some("alice@example.com".to_string()),
                    roll_number: "RA2511026010410".to_string(),
                    file_reg_no: Some("410".to_string()),
                    file_name_hint: Some("Alice".to_string()),
                    grading_status: "graded".to_string(),
                    ai_total_score: Some(16.0),
                    ai_feedback: Some("Good work overall.".to_string()),
                    graded_via: "text".to_string(),
                    grades: vec![
                        Grade {
                            id: "g1".to_string(),
                            submission_id: "s1".to_string(),
                            criterion_id: "c1".to_string(),
                            score: Some(8.0),
                            feedback: None,
                            justification: Some("Clear thesis".to_string()),
                            graded_by: "ai".to_string(),
                            approved: true,
                            graded_at: None,
                        },
                        Grade {
                            id: "g2".to_string(),
                            submission_id: "s1".to_string(),
                            criterion_id: "c2".to_string(),
                            score: Some(8.0),
                            feedback: None,
                            justification: Some("Good content".to_string()),
                            graded_by: "ai".to_string(),
                            approved: false,
                            graded_at: None,
                        },
                    ],
                },
                GradebookRow {
                    submission_id: "s2".to_string(),
                    student_id: "stu2".to_string(),
                    student_name: "Bob Jones".to_string(),
                    student_email: None,
                    roll_number: "9876543210".to_string(),
                    file_reg_no: None,
                    file_name_hint: None,
                    grading_status: "ungraded".to_string(),
                    ai_total_score: None,
                    ai_feedback: None,
                    graded_via: "text".to_string(),
                    grades: Vec::new(),
                },
            ],
        }
    }

    #[test]
    fn test_export_writes_file() {
        let gradebook = sample_gradebook();
        let integrity = vec![IntegrityRow {
            student_a: "Alice Smith".to_string(),
            student_b: "Bob Jones".to_string(),
            fingerprint: 0.85,
            semantic: 0.90,
            combined: 0.875,
            flagged: true,
        }];

        let tmp = std::env::temp_dir().join("test_gradebook_export.xlsx");
        let result = export_gradebook_xlsx(&gradebook, &integrity, &tmp);
        assert!(result.is_ok());
        assert!(tmp.exists());

        // Verify it's a valid xlsx (zip) file with the right size
        let file_size = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
        assert!(file_size > 1000);

        // Verify sheet names by reading xl/workbook.xml from the ZIP
        let file = std::fs::File::open(&tmp).unwrap();
        let mut archive = zip::ZipArchive::new(file).expect("Failed to open xlsx as zip archive");
        
        let mut workbook_xml = archive.by_name("xl/workbook.xml").expect("workbook.xml not found");
        let mut xml_content = String::new();
        std::io::Read::read_to_string(&mut workbook_xml, &mut xml_content).unwrap();

        // The four sheets should be declared in workbook.xml
        assert!(xml_content.contains("name=\"Summary\""));
        assert!(xml_content.contains("name=\"Grade Sheet\""));
        assert!(xml_content.contains("name=\"Integrity Report\""));
        assert!(xml_content.contains("name=\"Feedback Log\""));

        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn test_export_with_no_integrity() {
        let gradebook = sample_gradebook();
        let integrity: Vec<IntegrityRow> = Vec::new();

        let tmp = std::env::temp_dir().join("test_gradebook_nointegrity.xlsx");
        let result = export_gradebook_xlsx(&gradebook, &integrity, &tmp);
        assert!(result.is_ok());
        assert!(tmp.exists());

        std::fs::remove_file(&tmp).ok();
    }
}

