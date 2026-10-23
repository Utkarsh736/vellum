//! Container metadata extraction, dispatched by format.

pub mod epub;
pub mod pdf;

use crate::error::VellumError;
use crate::models::BookFormat;

/// Detect the book format from a path or SAF URI extension.
pub(crate) fn detect_format(path_or_uri: &str) -> Option<BookFormat> {
    let filename = path_or_uri
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path_or_uri);
    let (_stem, ext) = filename.rsplit_once('.')?;
    match ext.to_ascii_lowercase().as_str() {
        "pdf" => Some(BookFormat::Pdf),
        "epub" => Some(BookFormat::Epub),
        _ => None,
    }
}

/// Human-readable fallback title from a file name / SAF display name.
pub(crate) fn fallback_title(source_name: &str) -> String {
    let filename = source_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(source_name);
    let stem = filename
        .rsplit_once('.')
        .map(|(stem, _ext)| stem)
        .unwrap_or(filename)
        .trim();
    if stem.is_empty() {
        "Untitled".to_string()
    } else {
        stem.to_string()
    }
}

/// Build a `CorruptFile` error with path context.
pub(crate) fn corrupt(path: &str, message: impl Into<String>) -> VellumError {
    VellumError::CorruptFile {
        path: path.to_string(),
        message: message.into(),
    }
}
