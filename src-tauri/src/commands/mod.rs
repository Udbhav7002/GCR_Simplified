use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::State;

pub mod maintenance;
pub mod rubrics;
pub mod settings;
pub mod submissions;

#[derive(Clone)]
pub struct AppCancellationFlag(pub Arc<AtomicBool>);

impl Default for AppCancellationFlag {
    fn default() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

#[tauri::command]
pub fn cancel_active_tasks(cancel_flag: State<'_, AppCancellationFlag>) -> Result<(), String> {
    cancel_flag.0.store(true, Ordering::SeqCst);
    Ok(())
}
