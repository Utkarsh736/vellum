//! Tauri command layer — thin, typed wrappers around `vellum-core`.
//!
//! Privacy notes (product spec):
//! - No plugin other than the native file-dialog; no updater, no network.
//! - Book files are read in place and streamed to the webview as raw bytes
//!   (`tauri::ipc::Response`); they are never copied into app storage.
//! - Cover thumbnails are written by the core into the OS cache dir, and the
//!   webview reads them through the asset protocol scoped to that directory
//!   (see tauri.conf.json → assetProtocol.scope).

use base64::Engine;
use tauri::ipc::Response;
use tauri::State;
use vellum_core::models::Book;
use vellum_core::{VellumError, VellumLibrary};

/// Managed state — one VellumLibrary per process (thread-safe inside).
pub struct AppState {
    pub library: VellumLibrary,
}

/// Result of a batch import: duplicates are skipped, not fatal.
#[derive(serde::Serialize)]
pub struct AddBooksResult {
    pub added: Vec<Book>,
    pub skipped: Vec<String>,
}

#[tauri::command]
fn get_library(state: State<'_, AppState>) -> Result<Vec<Book>, VellumError> {
    state.library.get_library()
}

#[tauri::command]
fn get_book(book_id: i64, state: State<'_, AppState>) -> Result<Book, VellumError> {
    state
        .library
        .get_book(book_id)?
        .ok_or(VellumError::BookNotFound { id: book_id })
}

#[tauri::command]
fn add_books(paths: Vec<String>, state: State<'_, AppState>) -> Result<AddBooksResult, VellumError> {
    let mut added = Vec::new();
    let mut skipped = Vec::new();
    for path in paths {
        match state.library.add_book(path.clone(), None, None) {
            Ok(book) => added.push(book),
            // Already imported — a silent skip, the UI surfaces a toast.
            Err(VellumError::BookAlreadyExists { .. }) => skipped.push(path),
            Err(e) => return Err(e),
        }
    }
    Ok(AddBooksResult { added, skipped })
}

#[tauri::command]
fn remove_book(
    book_id: i64,
    delete_cover: bool,
    state: State<'_, AppState>,
) -> Result<(), VellumError> {
    state.library.remove_book(book_id, delete_cover)
}

#[tauri::command]
fn update_progress(
    book_id: i64,
    location: String,
    percent: f64,
    state: State<'_, AppState>,
) -> Result<(), VellumError> {
    state.library.update_progress(book_id, location, percent)
}

#[tauri::command]
fn set_cover(
    book_id: i64,
    data_b64: String,
    ext: String,
    state: State<'_, AppState>,
) -> Result<Book, VellumError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|e| VellumError::InvalidArgument {
            message: format!("invalid base64 cover payload: {e}"),
        })?;
    state.library.set_cover(book_id, bytes, ext)?;
    state
        .library
        .get_book(book_id)?
        .ok_or(VellumError::BookNotFound { id: book_id })
}

#[tauri::command]
fn update_book_path(
    book_id: i64,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<Book, VellumError> {
    state.library.update_book_path(book_id, new_path)
}

#[tauri::command]
fn book_file_exists(book: Book, state: State<'_, AppState>) -> bool {
    state.library.book_file_exists(&book)
}

/// Stream a book file to the webview as raw bytes (zero-copy IPC).
#[tauri::command]
fn read_book_file(path: String) -> Result<Response, VellumError> {
    let bytes = std::fs::read(&path).map_err(|e| VellumError::Io {
        path,
        message: e.to_string(),
    })?;
    Ok(Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let handle = app.handle().clone();

            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("app data dir should resolve");
            let cache_dir = handle
                .path()
                .app_cache_dir()
                .expect("app cache dir should resolve");
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&cache_dir)?;

            let library = VellumLibrary::new(
                data_dir.join("library.db").to_string_lossy().into_owned(),
                cache_dir.to_string_lossy().into_owned(),
            )?;
            app.manage(AppState { library });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            get_book,
            add_books,
            remove_book,
            update_progress,
            set_cover,
            update_book_path,
            book_file_exists,
            read_book_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vellum");
}
