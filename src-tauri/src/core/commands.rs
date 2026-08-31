//! Core command types and utilities

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::State;

/// A thread-safe cancellation token that can be shared across async tasks.
///
/// Usage:
/// ```rust
/// use gcr_app_lib::core::commands::CancellationToken;
///
/// let cancel = CancellationToken::new();
/// // In spawned task:
/// if cancel.is_cancelled() { return; }
/// // To cancel from outside:
/// cancel.cancel();
/// ```
#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    /// Check if cancellation was requested.
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// Request cancellation.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    /// Reset the cancellation state (for reuse).
    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone)]
pub struct AppCancellationFlag(pub CancellationToken);

impl Default for AppCancellationFlag {
    fn default() -> Self {
        Self(CancellationToken::new())
    }
}

#[derive(Clone)]
pub struct LoginCancelFlag(pub CancellationToken);

impl Default for LoginCancelFlag {
    fn default() -> Self {
        Self(CancellationToken::new())
    }
}

#[tauri::command]
pub fn cancel_active_tasks(cancel_flag: State<'_, AppCancellationFlag>) -> Result<(), String> {
    cancel_flag.0.cancel();
    Ok(())
}
