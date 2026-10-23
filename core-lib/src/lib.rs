//! Vellum core — the shared, local-first heart of the Vellum reader apps.
//!
//! This crate owns **data**, never UI:
//! - the SQLite library database (books + reading progress),
//! - PDF / EPUB metadata extraction,
//! - cover thumbnail caching inside the OS cache directory,
//! - UniFFI bindings for the Android (Kotlin) frontend.
//!
//! # Privacy contract (enforced by design)
//!
//! - Zero network access. There are no HTTP dependencies anywhere in this
//!   crate, and the apps that link it make no requests.
//! - Book *contents* are never stored or indexed. The database persists only
//!   the fields the product spec allows: `id`, `title`, `author`, `format`,
//!   `file_path`, reading location, and `date_added`.
//! - Cover thumbnails live in the OS-provided cache directory and may be
//!   purged by the OS at any time.
//! - Book files are read in place — never copied into app storage.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────┐        ┌──────────────────────────┐
//! │ Desktop (Tauri v2)  │        │ Android (Kotlin/Compose) │
//! │ tauri::command IPC  │        │ UniFFI bindings          │
//! └─────────┬───────────┘        └────────────┬─────────────┘
//!           │   direct path dependency          │  .so + generated Kotlin
//!           ▼                                   ▼
//!           ┌──────────────────────────────────────┐
//!           │   vellum-core: VellumLibrary + meta  │
//!           │ rusqlite · zip · quick-xml · lopdf   │
//!           └──────────────────────────────────────┘
//! ```

pub mod db;
pub mod error;
pub mod library;
pub mod metadata;
pub mod models;

pub use error::VellumError;
pub use library::VellumLibrary;
pub use models::{Book, BookFormat, BookMetadata, CoverImage, ReadingProgress};

/// Extract EPUB metadata from in-memory bytes.
///
/// `source_name` (file name or SAF display name) is used only as a fallback
/// title when the EPUB carries no `dc:title`. The bytes are parsed in memory
/// and discarded — nothing is persisted.
#[uniffi::export]
pub fn extract_epub_metadata(
    bytes: Vec<u8>,
    source_name: String,
) -> std::result::Result<BookMetadata, VellumError> {
    metadata::epub::extract(&bytes, &source_name)
}

/// Extract PDF metadata from in-memory bytes (trailer `Info` dictionary).
#[uniffi::export]
pub fn extract_pdf_metadata(
    bytes: Vec<u8>,
    source_name: String,
) -> std::result::Result<BookMetadata, VellumError> {
    metadata::pdf::extract(&bytes, &source_name)
}

/// Desktop convenience: detect the format from the file extension, read the
/// file and extract its metadata in one call.
#[uniffi::export]
pub fn extract_metadata_from_path(
    path: String,
) -> std::result::Result<BookMetadata, VellumError> {
    let format = metadata::detect_format(&path)
        .ok_or_else(|| VellumError::UnsupportedFormat { path: path.clone() })?;
    let bytes = std::fs::read(&path)
        .map_err(|e| VellumError::Io { path: path.clone(), message: e.to_string() })?;
    match format {
        BookFormat::Pdf => metadata::pdf::extract(&bytes, &path),
        BookFormat::Epub => metadata::epub::extract(&bytes, &path),
    }
}

uniffi::setup_scaffolding!();
