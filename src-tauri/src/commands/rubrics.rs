use crate::db::{DbPool, RubricCriterion};
use rusqlite::params;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn create_rubric_criterion(
    pool: State<DbPool>,
    assignment_id: String,
    name: String,
    description: Option<String>,
    max_marks: f64,
    sort_order: i32,
) -> Result<RubricCriterion, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO rubric_criteria (id, assignment_id, name, description, max_marks, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, assignment_id, name, description, max_marks, sort_order],
    )
    .map_err(|e| e.to_string())?;

    Ok(RubricCriterion {
        id,
        assignment_id,
        name,
        description,
        max_marks,
        sort_order,
    })
}

#[tauri::command]
pub fn get_rubric_criteria(
    pool: State<DbPool>,
    assignment_id: String,
) -> Result<Vec<RubricCriterion>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, assignment_id, name, description, max_marks, sort_order
         FROM rubric_criteria
         WHERE assignment_id = ?1
         ORDER BY sort_order ASC",
        )
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map(params![assignment_id], |row| {
            Ok(RubricCriterion {
                id: row.get(0)?,
                assignment_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                max_marks: row.get(4)?,
                sort_order: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut criteria = Vec::new();
    for c in iter {
        criteria.push(c.map_err(|e| e.to_string())?);
    }

    Ok(criteria)
}

#[tauri::command]
pub fn update_rubric_criterion(
    pool: State<DbPool>,
    id: String,
    name: String,
    description: Option<String>,
    max_marks: f64,
    sort_order: i32,
) -> Result<RubricCriterion, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE rubric_criteria
         SET name = ?1, description = ?2, max_marks = ?3, sort_order = ?4
         WHERE id = ?5",
        params![name, description, max_marks, sort_order, id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, assignment_id, name, description, max_marks, sort_order
         FROM rubric_criteria
         WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let criterion = stmt
        .query_row(params![id], |row| {
            Ok(RubricCriterion {
                id: row.get(0)?,
                assignment_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                max_marks: row.get(4)?,
                sort_order: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(criterion)
}

#[tauri::command]
pub fn delete_rubric_criterion(pool: State<DbPool>, id: String) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM rubric_criteria WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
