use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Database connection error: {0}")]
    DatabasePool(#[from] r2d2::Error),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Google API error: {0}")]
    GoogleApi(String),
    #[error("Auth error: {0}")]
    Auth(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
