const fs = require('fs');
let code = fs.readFileSync('src-tauri/src/domain/export/commands.rs', 'utf8');

const imports = `use crate::core::db::DbPool;
use crate::domain::export::xlsx::{export_gradebook_xlsx, IntegrityRow};
use crate::domain::plagiarism::PlagiarismReport;
use crate::domain::grading::commands::get_gradebook;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager, State};`;

// Replace all imports
code = code.replace(/use crate::core::db::DbPool;[\s\S]*?use tauri::\{AppHandle, Manager, State\};/, imports);

// Insert integrity logic
const logic = `
    let mut integrity_rows = Vec::new();
    if let (Some(cid), Some(cwid)) = (&options.course_id, &options.course_work_id) {
        if let Ok(conn) = pool.get() {
            if let Ok(mut stmt) = conn.prepare("SELECT report_json FROM plagiarism_runs WHERE course_id = ?1 AND course_work_id = ?2 ORDER BY created_at DESC LIMIT 1") {
                if let Ok(report_json) = stmt.query_row(rusqlite::params![cid, cwid], |row| row.get::<_, String>(0)) {
                    if let Ok(report) = serde_json::from_str::<PlagiarismReport>(&report_json) {
                        for res in report.results {
                            if res.flagged {
                                integrity_rows.push(IntegrityRow {
                                    student_a: res.student_a_name,
                                    student_b: res.student_b_name,
                                    fingerprint: res.fingerprint_score,
                                    semantic: res.semantic_score,
                                    combined: res.combined_score,
                                    flagged: res.flagged,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    export_gradebook_xlsx(&gradebook, &integrity_rows, Path::new(&path))`;

code = code.replace(/export_gradebook_xlsx\(&gradebook, &\[\], Path::new\(&path\)\)/, logic);

fs.writeFileSync('src-tauri/src/domain/export/commands.rs', code);
