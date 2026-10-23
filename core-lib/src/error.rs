//! Error type shared with both frontends.

/// Every failure mode the Vellum core can surface.
///
/// Maps to a Kotlin `sealed class` via UniFFI and is JSON-serializable for
/// the Tauri IPC layer (`{"kind": "io", "path": ..., "message": ...}`).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, serde::Serialize, uniffi::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VellumError {
    /// A file could not be read (missing, no permission, locked).
    #[error("could not read `{path}`: {message}")]
    Io { path: String, message: String },

    /// SQLite-level failure.
    #[error("database error: {message}")]
    Database { message: String },

    /// The format is not PDF or EPUB (v1 scope).
    #[error("unsupported book format: `{path}`")]
    UnsupportedFormat { path: String },

    /// A book with the same file path / SAF URI is already in the library.
    #[error("this book is already in the library: `{path}`")]
    BookAlreadyExists { path: String },

    /// The file exists but cannot be parsed as PDF or EPUB.
    #[error("corrupt or unreadable book file `{path}`: {message}")]
    CorruptFile { path: String, message: String },

    /// No book row with this id.
    #[error("no book with id {id}")]
    BookNotFound { id: i64 },

    /// Invalid argument passed by the caller.
    #[error("invalid argument: {message}")]
    InvalidArgument { message: String },
}

impl From<rusqlite::Error> for VellumError {
    fn from(e: rusqlite::Error) -> Self {
        VellumError::Database { message: e.to_string() }
    }
}

/// Convenience alias for internal code. Exported UniFFI functions spell out
/// `std::result::Result` explicitly to keep the proc-macro parser happy.
pub type Result<T> = std::result::Result<T, VellumError>;
