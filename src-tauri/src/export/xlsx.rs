use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, XlsxError};
use std::path::Path;

use crate::grading::commands::GradebookView;

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

/// Write the full 4-sheet gradebook workbook to `save_path`.
pub fn export_gradebook_xlsx(
    gradebook: &GradebookView,
    integrity: &[IntegrityRow],
    save_path: &Path,
) -> Result<String, String> {
    let mut workbook = Workbook::new();
    let fmt = make_formats();

    write_summary_sheet(&mut workbook, gradebook, &fmt).map_err(|e| e.to_string())?;
    write_grade_sheet(&mut workbook, gradebook, &fmt).map_err(|e| e.to_string())?;
    write_integrity_sheet(&mut workbook, integrity, &fmt).map_err(|e| e.to_string())?;
    write_feedback_sheet(&mut workbook, gradebook, &fmt).map_err(|e| e.to_string())?;

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

    sheet.merge_range(0, 0, 0, 1, "Assignment Summary", &fmt.title)?;
    sheet.write_with_format(2, 0, "Assignment", &fmt.normal)?;
    sheet.write_with_format(2, 1, &gradebook.assignment_title, &fmt.normal)?;
    sheet.write_with_format(3, 0, "Total Students", &fmt.normal)?;
    sheet.write_number_with_format(3, 1, total_students as f64, &fmt.num)?;
    sheet.write_with_format(4, 0, "Graded Students", &fmt.normal)?;
    sheet.write_number_with_format(4, 1, graded as f64, &fmt.num)?;
    sheet.write_with_format(5, 0, "Submission Rate (%)", &fmt.normal)?;
    sheet.write_number_with_format(5, 1, submission_rate, &fmt.num)?;
    sheet.write_with_format(6, 0, "Average Approved Score", &fmt.normal)?;
    sheet.write_number_with_format(6, 1, average_score, &fmt.num)?;
    sheet.write_with_format(7, 0, "AI Suggested Grades (unapproved)", &fmt.normal)?;
    sheet.write_number_with_format(7, 1, suggested as f64, &fmt.num)?;

    Ok(())
}

fn write_grade_sheet(
    workbook: &mut Workbook,
    gradebook: &GradebookView,
    fmt: &SheetFormats,
) -> Result<(), XlsxError> {
    let sheet = workbook.add_worksheet();
    sheet.set_name("Grade Sheet")?;
    sheet.set_column_width(0, 28)?;
    sheet.set_column_width(1, 20)?;

    let criteria = &gradebook.rubric;
    for (i, _c) in criteria.iter().enumerate() {
        sheet.set_column_width(2 + i as u16, 14)?;
    }
    let total_col = 2 + criteria.len() as u16;

    sheet.merge_range(0, 0, 0, total_col, "Grade Sheet", &fmt.title)?;

    sheet.write_string_with_format(1, 0, "Student", &fmt.header)?;
    sheet.write_string_with_format(1, 1, "Status", &fmt.header)?;
    for (i, c) in criteria.iter().enumerate() {
        sheet.write_string_with_format(1, 2 + i as u16, &c.name, &fmt.header)?;
    }
    sheet.write_string_with_format(1, total_col, "Total", &fmt.header)?;

    for (row, gradebook_row) in (2..).zip(gradebook.rows.iter()) {
        sheet.write_string_with_format(row, 0, &gradebook_row.student_name, &fmt.normal)?;
        sheet.write_string_with_format(row, 1, &gradebook_row.grading_status, &fmt.normal)?;

        let mut total = 0.0_f64;
        for (i, c) in criteria.iter().enumerate() {
            let grade = gradebook_row.grades.iter().find(|g| g.criterion_id == c.id);
            match grade {
                Some(g) if g.graded_by == "teacher" => {
                    if let Some(score) = g.score {
                        sheet.write_number_with_format(row, 2 + i as u16, score, &fmt.num)?;
                        total += score;
                    }
                }
                Some(g) if g.approved => {
                    if let Some(score) = g.score {
                        sheet.write_number_with_format(row, 2 + i as u16, score, &fmt.green)?;
                        total += score;
                    }
                }
                Some(g) => {
                    if let Some(score) = g.score {
                        sheet.write_number_with_format(row, 2 + i as u16, score, &fmt.amber)?;
                    }
                }
                None => {
                    sheet.write_string_with_format(row, 2 + i as u16, "-", &fmt.normal)?;
                }
            }
        }
        sheet.write_number_with_format(row, total_col, total, &fmt.num)?;
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
    use crate::grading::commands::{Grade, GradebookRow, RubricCriterion};

    fn sample_gradebook() -> GradebookView {
        GradebookView {
            assignment_id: "a1".to_string(),
            assignment_title: "Essay Test".to_string(),
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
                    grading_status: "graded".to_string(),
                    ai_total_score: Some(16.0),
                    ai_feedback: Some("Good work overall.".to_string()),
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
                    grading_status: "ungraded".to_string(),
                    ai_total_score: None,
                    ai_feedback: None,
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
