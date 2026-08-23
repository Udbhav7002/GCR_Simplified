use crate::db::{DbPool, RubricCriterion};
use rusqlite::params;
use tauri::State;
use uuid::Uuid;

pub fn validate_rubric_input(name: &str, max_marks: f64, sort_order: i32) -> Result<(), String> {
    let name_trimmed = name.trim();
    if name_trimmed.is_empty() {
        return Err("Criterion name cannot be empty".to_string());
    }
    if name_trimmed.len() > 200 {
        return Err("Criterion name cannot exceed 200 characters".to_string());
    }
    if !max_marks.is_finite() || max_marks <= 0.0 || max_marks > 1000.0 {
        return Err("Max marks must be a positive finite number between 0.1 and 1000".to_string());
    }
    if sort_order < 0 {
        return Err("Sort order must be a non-negative integer".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn create_rubric_criterion(
    pool: State<DbPool>,
    assignment_id: String,
    name: String,
    description: Option<String>,
    max_marks: f64,
    sort_order: i32,
) -> Result<RubricCriterion, String> {
    validate_rubric_input(&name, max_marks, sort_order)?;

    let conn = pool.get().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO rubric_criteria (id, assignment_id, name, description, max_marks, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, assignment_id, name.trim(), description, max_marks, sort_order],
    )
    .map_err(|e| e.to_string())?;

    Ok(RubricCriterion {
        id,
        assignment_id,
        name: name.trim().to_string(),
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
    validate_rubric_input(&name, max_marks, sort_order)?;

    let conn = pool.get().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE rubric_criteria
         SET name = ?1, description = ?2, max_marks = ?3, sort_order = ?4
         WHERE id = ?5",
        params![name.trim(), description, max_marks, sort_order, id],
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_rubric_input() {
        assert!(validate_rubric_input("Content & Analysis", 10.0, 0).is_ok());
        assert!(validate_rubric_input("Grammar", 5.5, 1).is_ok());
        assert!(validate_rubric_input("Structure", 1000.0, 2).is_ok());
    }

    #[test]
    fn test_invalid_rubric_inputs() {
        // Empty name
        assert!(validate_rubric_input("", 10.0, 0).is_err());
        assert!(validate_rubric_input("   ", 10.0, 0).is_err());

        // Name too long
        let long_name = "a".repeat(201);
        assert!(validate_rubric_input(&long_name, 10.0, 0).is_err());

        // Invalid max marks
        assert!(validate_rubric_input("Name", 0.0, 0).is_err());
        assert!(validate_rubric_input("Name", -5.0, 0).is_err());
        assert!(validate_rubric_input("Name", 1000.1, 0).is_err());
        assert!(validate_rubric_input("Name", f64::NAN, 0).is_err());
        assert!(validate_rubric_input("Name", f64::INFINITY, 0).is_err());

        // Invalid sort order
        assert!(validate_rubric_input("Name", 10.0, -1).is_err());
    }
}
