//! PDF metadata extraction via `lopdf`.
//!
//! Reads the trailer `Info` dictionary (`Title`, `Author`) — nothing else.
//! No text extraction and no page parsing (privacy rule #3: the core never
//! indexes book content).
//!
//! Encrypted PDFs are deliberately treated as metadata-less: decrypting a
//! file just to read a title would drag heavy crypto machinery into the
//! core, and the file-name fallback produces a perfectly good title. The
//! document itself still opens fine in the frontend renderers, which handle
//! decryption with the user's password when needed.

use lopdf::{Dictionary, Document, Object};

use crate::error::Result;
use crate::metadata::{corrupt, fallback_title};
use crate::models::{BookFormat, BookMetadata};

/// Extract PDF metadata from in-memory bytes.
pub fn extract(bytes: &[u8], source_name: &str) -> Result<BookMetadata> {
    let doc = Document::load_mem(bytes)
        .map_err(|e| corrupt(source_name, format!("not a valid PDF: {e}")))?;

    // Encrypted PDFs store encrypted string objects; reading the Info dict
    // would produce garbage, so we skip it entirely.
    let (title, author) = if doc.trailer.get(b"Encrypt").is_ok() {
        (None, None)
    } else {
        info_fields(&doc)
    };

    let title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| fallback_title(source_name));

    Ok(BookMetadata {
        format: BookFormat::Pdf,
        title,
        author: author.filter(|a| !a.trim().is_empty()),
        // PDF covers require *rendering* page 1 — the frontend's job
        // (pdf.js on desktop, PdfRenderer on Android). The frontend then
        // calls `VellumLibrary::set_cover` with the rendered bytes.
        cover: None,
    })
}

/// Pull `(Title, Author)` from the trailer `Info` dictionary, if present.
fn info_fields(doc: &Document) -> (Option<String>, Option<String>) {
    let info_id = match doc.trailer.get(b"Info") {
        Ok(Object::Reference(id)) => *id,
        _ => return (None, None),
    };
    let dict = match doc.get_object(info_id) {
        Ok(Object::Dictionary(dict)) => dict,
        _ => return (None, None),
    };
    (string_field(dict, b"Title"), string_field(dict, b"Author"))
}

/// Read one string entry from a dictionary.
fn string_field(dict: &Dictionary, key: &[u8]) -> Option<String> {
    match dict.get(key).ok()? {
        Object::String(bytes, _) => Some(decode_pdf_string(bytes)),
        _ => None,
    }
}

/// Decode a PDF string:
/// - `FE FF` prefix → UTF-16BE (the standard for non-ASCII titles),
/// - valid UTF-8 → UTF-8 (common in modern generator output),
/// - otherwise → PDFDocEncoding, which is ASCII-compatible in the
///   printable range; the `u8 as char` mapping is the pragmatic decode.
fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16(&units).unwrap_or_default()
    } else {
        match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(_) => bytes.iter().map(|&b| b as char).collect(),
        }
    }
}
