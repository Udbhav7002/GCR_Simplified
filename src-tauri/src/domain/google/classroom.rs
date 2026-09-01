use super::{fetch_collection, get_valid_access_token};
use crate::core::db::DbPool;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleCourse {
    pub id: String,
    pub name: String,
    pub section: Option<String>,
    pub course_state: String,
    pub alternate_link: String,
    pub enrollment_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleCourseWork {
    pub course_id: String,
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub max_points: Option<f64>,
    pub work_type: String,
    pub state: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleStudent {
    pub user_id: String,
    pub full_name: String,
    pub email_address: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleAttachment {
    pub drive_file_id: Option<String>,
    pub drive_file_title: Option<String>,
    pub drive_file_link: Option<String>,
    pub link_url: Option<String>,
    pub link_title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleSubmission {
    pub id: String,
    pub course_id: String,
    pub course_work_id: String,
    pub user_id: String,
    pub student_name: Option<String>,
    pub student_email: Option<String>,
    pub state: String,
    pub late: bool,
    pub assigned_grade: Option<f64>,
    pub attachments: Vec<GoogleAttachment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MissingStudent {
    pub user_id: String,
    pub name: String,
    pub email: Option<String>,
}

/// Fetch the student roster for a course as a map of user_id -> (name, email)
pub async fn fetch_roster_map(
    pool: &DbPool,
    course_id: &str,
) -> Result<std::collections::HashMap<String, (String, Option<String>)>, String> {
    let token = get_valid_access_token(pool).await?;
    let client = reqwest::Client::new();
    let base_url = format!(
        "https://classroom.googleapis.com/v1/courses/{}/students?pageSize=100",
        course_id
    );
    let body = fetch_collection(
        pool,
        &client,
        &token,
        &format!("students:{}", course_id),
        &base_url,
        "students",
        false,
    )
    .await?;

    let mut student_map = std::collections::HashMap::new();
    if let Some(students) = body["students"].as_array() {
        for s in students {
            let uid = s["userId"].as_str().unwrap_or_default().to_string();
            let name = s["profile"]["name"]["fullName"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            let email = s["profile"]["emailAddress"].as_str().map(|s| s.to_string());
            student_map.insert(uid, (name, email));
        }
    }
    Ok(student_map)
}

#[tauri::command]
pub async fn list_google_courses(
    pool: State<'_, DbPool>,
    force: Option<bool>,
) -> Result<Vec<GoogleCourse>, String> {
    list_google_courses_impl(&pool, force.unwrap_or(false)).await
}

/// Shared implementation (also used by the local-DB mirror to resolve names).
pub async fn list_google_courses_impl(
    pool: &DbPool,
    force: bool,
) -> Result<Vec<GoogleCourse>, String> {
    let token = get_valid_access_token(pool).await?;
    let client = reqwest::Client::new();
    let base_url =
        "https://classroom.googleapis.com/v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=100";
    let body =
        fetch_collection(pool, &client, &token, "courses", base_url, "courses", force).await?;

    let mut all_courses = Vec::new();
    if let Some(courses) = body["courses"].as_array() {
        for c in courses {
            all_courses.push(GoogleCourse {
                id: c["id"].as_str().unwrap_or_default().to_string(),
                name: c["name"].as_str().unwrap_or_default().to_string(),
                section: c["section"].as_str().map(|s| s.to_string()),
                course_state: c["courseState"].as_str().unwrap_or("ACTIVE").to_string(),
                alternate_link: c["alternateLink"].as_str().unwrap_or_default().to_string(),
                enrollment_code: c["enrollmentCode"].as_str().map(|s| s.to_string()),
            });
        }
    }
    Ok(all_courses)
}

#[tauri::command]
pub async fn list_google_coursework(
    pool: State<'_, DbPool>,
    course_id: String,
    force: Option<bool>,
) -> Result<Vec<GoogleCourseWork>, String> {
    list_google_coursework_impl(&pool, &course_id, force.unwrap_or(false)).await
}

/// Shared implementation (also used by the Gmail nudge to resolve titles).
pub async fn list_google_coursework_impl(
    pool: &DbPool,
    course_id: &str,
    force: bool,
) -> Result<Vec<GoogleCourseWork>, String> {
    let token = get_valid_access_token(pool).await?;
    let client = reqwest::Client::new();
    let base_url = format!(
        "https://classroom.googleapis.com/v1/courses/{}/courseWork?courseWorkStates=PUBLISHED&pageSize=100",
        course_id
    );
    let body = fetch_collection(
        pool,
        &client,
        &token,
        &format!("coursework:{}", course_id),
        &base_url,
        "courseWork",
        force,
    )
    .await?;

    let mut all_work = Vec::new();
    if let Some(works) = body["courseWork"].as_array() {
        for w in works {
            all_work.push(GoogleCourseWork {
                course_id: w["courseId"].as_str().unwrap_or_default().to_string(),
                id: w["id"].as_str().unwrap_or_default().to_string(),
                title: w["title"].as_str().unwrap_or_default().to_string(),
                description: w["description"].as_str().map(|s| s.to_string()),
                max_points: w["maxPoints"].as_f64(),
                work_type: w["workType"].as_str().unwrap_or("ASSIGNMENT").to_string(),
                state: w["state"].as_str().unwrap_or("PUBLISHED").to_string(),
            });
        }
    }

    // Persist coursework metadata (esp. total marks) so AI grading can fall
    // back to the Classroom max points when the teacher defines no rubric.
    // Best-effort: coursework listing must never fail because of mirroring.
    {
        let conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Skipping coursework mirror (pool unavailable): {}", e);
                return Ok(all_work);
            }
        };
        let now = chrono::Utc::now().to_rfc3339();
        for w in &all_work {
            let result = conn.execute(
                "INSERT INTO assignments (id, class_id, title, description, question_text, model_answer, max_score, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, NULL, NULL, NULL, ?4, 'Active', ?5, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                     title = excluded.title,
                     updated_at = excluded.updated_at,
                     max_score = COALESCE(excluded.max_score, assignments.max_score)",
                rusqlite::params![w.id, course_id, w.title, w.max_points, now],
            );
            if let Err(e) = result {
                log::warn!("Failed to mirror coursework {}: {}", w.id, e);
            }
        }
    }

    Ok(all_work)
}

#[tauri::command]
pub async fn list_google_students(
    pool: State<'_, DbPool>,
    course_id: String,
    force: Option<bool>,
) -> Result<Vec<GoogleStudent>, String> {
    let force = force.unwrap_or(false);
    let token = get_valid_access_token(&pool).await?;
    let client = reqwest::Client::new();
    let base_url = format!(
        "https://classroom.googleapis.com/v1/courses/{}/students?pageSize=100",
        course_id
    );
    let body = fetch_collection(
        &pool,
        &client,
        &token,
        &format!("students:{}", course_id),
        &base_url,
        "students",
        force,
    )
    .await?;

    let mut all_students = Vec::new();
    if let Some(students) = body["students"].as_array() {
        for s in students {
            let profile = &s["profile"];
            all_students.push(GoogleStudent {
                user_id: s["userId"].as_str().unwrap_or_default().to_string(),
                full_name: profile["name"]["fullName"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                email_address: profile["emailAddress"].as_str().map(|s| s.to_string()),
            });
        }
    }
    Ok(all_students)
}

#[tauri::command]
pub async fn list_google_submissions(
    pool: State<'_, DbPool>,
    course_id: String,
    course_work_id: String,
    force: Option<bool>,
) -> Result<Vec<GoogleSubmission>, String> {
    let force = force.unwrap_or(false);
    fetch_google_submissions_impl(&pool, &course_id, &course_work_id, force).await
}

/// Fetch student submissions for a coursework (shared by list + batch download).
pub async fn fetch_google_submissions(
    pool: &DbPool,
    course_id: &str,
    course_work_id: &str,
) -> Result<Vec<GoogleSubmission>, String> {
    fetch_google_submissions_impl(pool, course_id, course_work_id, false).await
}
async fn fetch_google_submissions_impl(
    pool: &DbPool,
    course_id: &str,
    course_work_id: &str,
    force: bool,
) -> Result<Vec<GoogleSubmission>, String> {
    let token = get_valid_access_token(pool).await?;
    let client = reqwest::Client::new();

    // Roster for name mapping (incrementally cached).
    let student_map = fetch_roster_map(pool, course_id).await.unwrap_or_default();

    let base_url = format!(
        "https://classroom.googleapis.com/v1/courses/{}/courseWork/{}/studentSubmissions?pageSize=100",
        course_id, course_work_id
    );
    let collection = format!("submissions:{}:{}", course_id, course_work_id);
    let body = fetch_collection(
        pool,
        &client,
        &token,
        &collection,
        &base_url,
        "studentSubmissions",
        force,
    )
    .await?;

    let mut all_submissions = Vec::new();
    if let Some(subs) = body["studentSubmissions"].as_array() {
        for sub in subs {
            let user_id = sub["userId"].as_str().unwrap_or_default().to_string();
            let (student_name, student_email) = student_map
                .get(&user_id)
                .map(|(n, e)| (Some(n.clone()), e.clone()))
                .unwrap_or((None, None));

            let mut attachments = Vec::new();
            if let Some(assignment_sub) = sub.get("assignmentSubmission") {
                if let Some(atts) = assignment_sub["attachments"].as_array() {
                    for att in atts {
                        let mut attachment = GoogleAttachment {
                            drive_file_id: None,
                            drive_file_title: None,
                            drive_file_link: None,
                            link_url: None,
                            link_title: None,
                        };
                        if let Some(df) = att.get("driveFile") {
                            attachment.drive_file_id = df["id"].as_str().map(|s| s.to_string());
                            attachment.drive_file_title =
                                df["title"].as_str().map(|s| s.to_string());
                            attachment.drive_file_link =
                                df["alternateLink"].as_str().map(|s| s.to_string());
                        }
                        if let Some(lnk) = att.get("link") {
                            attachment.link_url = lnk["url"].as_str().map(|s| s.to_string());
                            attachment.link_title = lnk["title"].as_str().map(|s| s.to_string());
                        }
                        attachments.push(attachment);
                    }
                }
            }

            all_submissions.push(GoogleSubmission {
                id: sub["id"].as_str().unwrap_or_default().to_string(),
                course_id: sub["courseId"].as_str().unwrap_or_default().to_string(),
                course_work_id: sub["courseWorkId"].as_str().unwrap_or_default().to_string(),
                user_id,
                student_name,
                student_email,
                state: sub["state"].as_str().unwrap_or("CREATED").to_string(),
                late: sub["late"].as_bool().unwrap_or(false),
                assigned_grade: sub["assignedGrade"].as_f64(),
                attachments,
            });
        }
    }

    // Mirror into the local DB so AI grading, the gradebook and exports work
    // on Google coursework without the manual class-management flow.
    if let Err(e) =
        mirror_submissions_to_db(pool, &all_submissions, course_id, course_work_id).await
    {
        log::warn!("Failed to mirror submissions to local DB: {}", e);
    }

    Ok(all_submissions)
}

/// Upsert a Google course into the local `classes` table (id = Google course
/// id) and return its display name.
async fn ensure_local_course(pool: &DbPool, course_id: &str) -> String {
    let name = list_google_courses_impl(pool, false)
        .await
        .ok()
        .and_then(|courses| {
            courses
                .into_iter()
                .find(|c| c.id == course_id)
                .map(|c| c.name)
        })
        .unwrap_or_else(|| course_id.to_string());

    let now = chrono::Utc::now().to_rfc3339();
    if let Ok(conn) = pool.get() {
        let _ = conn.execute(
            "INSERT INTO classes (id, name, subject, created_at, updated_at)
             VALUES (?1, ?2, NULL, ?3, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at",
            rusqlite::params![course_id, name, now],
        );
    }
    name
}

/// Mirror Google submissions into the local `students` / `assignments` /
/// `submissions` tables. The local assignment id is the Google coursework id,
/// and student ids are Google user ids — this is what lets `get_gradebook`
/// and AI grading operate on the synced course without manual data entry.
pub async fn mirror_submissions_to_db(
    pool: &DbPool,
    submissions: &[GoogleSubmission],
    course_id: &str,
    course_work_id: &str,
) -> Result<(), String> {
    if submissions.is_empty() {
        return Ok(());
    }

    ensure_local_course(pool, course_id).await;

    let assignment_title = list_google_coursework_impl(pool, course_id, false)
        .await
        .ok()
        .and_then(|works| {
            works
                .into_iter()
                .find(|w| w.id == course_work_id)
                .map(|w| w.title)
        })
        .unwrap_or_else(|| course_work_id.to_string());

    let now = chrono::Utc::now().to_rfc3339();
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    tx.execute(
        "INSERT INTO assignments (id, class_id, title, description, question_text, model_answer, max_score, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL, 'Active', ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at",
        rusqlite::params![course_work_id, course_id, assignment_title, now],
    )
    .map_err(|e| e.to_string())?;

    for sub in submissions {
        let mut name = sub
            .student_name
            .clone()
            .unwrap_or_else(|| "Unknown Student".to_string());

        let mut roll_number = sub.user_id.clone();

        // Extract Registration Number from parentheses e.g. "SANAGARI UDBHAV (RA2511026010418)"
        if let Some(start) = name.rfind('(') {
            if let Some(end) = name.rfind(')') {
                if start < end {
                    roll_number = name[start + 1..end].trim().to_string();
                    name = name[..start].trim().to_string();
                }
            }
        }

        tx.execute(
            "INSERT INTO students (id, class_id, roll_number, name, email, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, roll_number = excluded.roll_number",
            rusqlite::params![
                sub.user_id,
                course_id,
                roll_number,
                name,
                sub.student_email,
                now
            ],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO submissions (id, assignment_id, student_id, file_path, status, submitted_at, created_at)
             VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)
             ON CONFLICT(assignment_id, student_id) DO UPDATE SET status = excluded.status, submitted_at = excluded.submitted_at",
            rusqlite::params![sub.id, course_work_id, sub.user_id, sub.state, now, now],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit mirrored submissions: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_missing_submissions(
    pool: State<'_, DbPool>,
    course_id: String,
    course_work_id: String,
) -> Result<Vec<MissingStudent>, String> {
    // Fetch full roster
    let roster = fetch_roster_map(&pool, &course_id).await?;

    // Submissions: force a fresh fetch so the missing-report is always current.
    let submissions =
        fetch_google_submissions_impl(&pool, &course_id, &course_work_id, true).await?;

    let submitted_user_ids: std::collections::HashSet<String> = submissions
        .iter()
        .filter(|s| s.state == "TURNED_IN")
        .map(|s| s.user_id.clone())
        .collect();

    let mut missing = Vec::new();
    for (user_id, (name, email)) in roster {
        if !submitted_user_ids.contains(&user_id) {
            missing.push(MissingStudent {
                user_id,
                name,
                email,
            });
        }
    }

    missing.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(missing)
}
