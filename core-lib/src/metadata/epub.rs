//! EPUB metadata extraction.
//!
//! Pipeline: `META-INF/container.xml` → OPF path → parse `<dc:title>`,
//! `<dc:creator>` and the manifest — then resolve the cover:
//! 1. EPUB 3: manifest item with `properties="cover-image"`.
//! 2. EPUB 2: `<meta name="cover" content="<item-id>"/>` → manifest lookup.
//!
//! Everything is parsed in memory from the zip bytes; nothing is persisted.
//! The parser matches on *local* XML names (`dc:title` → `title`) so
//! non-standard namespace prefixes still work, and zip entry lookup
//! tolerates percent-encoded and case-mismatched names, which both occur in
//! real-world EPUBs.

use std::collections::HashMap;
use std::io::{Cursor, Read, Seek};

use quick_xml::events::{BytesStart, Event};
use quick_xml::name::QName;
use quick_xml::Reader;
use zip::ZipArchive;

use crate::error::{Result, VellumError};
use crate::metadata::{corrupt, fallback_title};
use crate::models::{BookFormat, BookMetadata, CoverImage};

/// Extract EPUB metadata from in-memory bytes.
pub fn extract(bytes: &[u8], source_name: &str) -> Result<BookMetadata> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| corrupt(source_name, format!("not a valid EPUB (zip container): {e}")))?;

    // 1. Locate the OPF via container.xml. Slightly broken books without a
    //    container fall back to the conventional root location.
    let opf_path = match read_zip_entry(&mut archive, "META-INF/container.xml", source_name) {
        Ok(container) => {
            parse_container(&String::from_utf8_lossy(&container), source_name)?
                .unwrap_or_else(|| "content.opf".to_string())
        }
        Err(_) => "content.opf".to_string(),
    };

    // 2. Parse the OPF package.
    let opf_bytes = read_zip_entry(&mut archive, &opf_path, source_name)?;
    let opf = parse_opf(&String::from_utf8_lossy(&opf_bytes), source_name)?;

    // 3. Resolve the cover: EPUB 3 `properties` first, then EPUB 2 `<meta>`.
    let cover_ref = opf
        .cover_props_item
        .clone()
        .or_else(|| opf.cover_meta_id.as_ref().and_then(|id| opf.manifest.get(id).cloned()));

    let cover = cover_ref.and_then(|(href, media_type)| {
        let full = join_opf_href(&opf_path, &href);
        if full.is_empty() {
            return None;
        }
        read_zip_entry(&mut archive, &full, source_name)
            .ok()
            .map(|bytes| CoverImage { bytes, media_type })
    });

    let title = opf
        .title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| fallback_title(source_name));

    Ok(BookMetadata {
        format: BookFormat::Epub,
        title,
        author: opf.author.filter(|a| !a.trim().is_empty()),
        cover,
    })
}

// ---------------------------------------------------------------------------
// zip helpers
// ---------------------------------------------------------------------------

/// Read a zip entry, tolerating percent-encoded and case-mismatched names
/// (both occur in real-world EPUBs).
fn read_zip_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    source: &str,
) -> Result<Vec<u8>> {
    let mut candidates = vec![name.to_string()];
    if let Some(decoded) = percent_decode(name) {
        if decoded != name {
            candidates.push(decoded);
        }
    }

    let entry_names: Vec<String> = archive.file_names().map(str::to_string).collect();

    let matched = match candidates
        .iter()
        .find(|c| entry_names.iter().any(|n| n == *c))
        .cloned()
    {
        Some(exact) => exact,
        None => {
            // Case-insensitive fallback for sloppy packaging tools.
            let wanted: Vec<String> = candidates.iter().map(|c| c.to_lowercase()).collect();
            entry_names
                .into_iter()
                .find(|n| wanted.contains(&n.to_lowercase()))
                .ok_or_else(|| corrupt(source, format!("EPUB is missing required entry `{name}`")))?
        }
    };

    let mut file = archive
        .by_name(&matched)
        .map_err(|e| corrupt(source, format!("could not read EPUB entry `{matched}`: {e}")))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|e| corrupt(source, format!("could not read EPUB entry `{matched}`: {e}")))?;
    Ok(buf)
}

fn percent_decode(s: &str) -> Option<String> {
    percent_encoding::percent_decode_str(s)
        .decode_utf8()
        .ok()
        .map(|cow| cow.into_owned())
}

// ---------------------------------------------------------------------------
// XML: container.xml
// ---------------------------------------------------------------------------

fn parse_container(xml: &str, source: &str) -> Result<Option<String>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if local_name(e.name()).as_slice() == b"rootfile" {
                    for attr in e.attributes() {
                        let attr = attr.map_err(|err| corrupt_xml(source, err))?;
                        if attr.key.as_ref() == b"full-path" {
                            let value = attr
                                .unescape_value()
                                .map_err(|err| corrupt_xml(source, err))?
                                .into_owned();
                            if !value.trim().is_empty() {
                                return Ok(Some(value));
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => return Ok(None),
            Err(err) => return Err(corrupt_xml(source, err)),
            _ => {}
        }
        buf.clear();
    }
}

/// Build a `CorruptFile` error from any quick-xml failure (parser errors and
/// attribute errors are different types; both are `Display`).
fn corrupt_xml(source: &str, err: impl std::fmt::Display) -> VellumError {
    corrupt(source, format!("invalid XML: {err}"))
}

// ---------------------------------------------------------------------------
// XML: OPF package
// ---------------------------------------------------------------------------

#[derive(Default)]
struct OpfData {
    title: Option<String>,
    author: Option<String>,
    /// `(href, media_type)` of the EPUB 3 `properties="cover-image"` item.
    cover_props_item: Option<(String, String)>,
    /// Manifest id referenced by the EPUB 2 `<meta name="cover">` element.
    cover_meta_id: Option<String>,
    /// id → (href, media_type)
    manifest: HashMap<String, (String, String)>,
}

#[derive(Clone, Copy, PartialEq)]
enum Capture {
    None,
    Title,
    Creator,
}

fn parse_opf(xml: &str, source: &str) -> Result<OpfData> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut data = OpfData::default();
    let mut capture = Capture::None;
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut title_texts: Vec<String> = Vec::new();
    let mut creator_texts: Vec<String> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                match local_name(e.name()).as_slice() {
                    b"metadata" => in_metadata = true,
                    b"manifest" => in_manifest = true,
                    b"title" if in_metadata => capture = Capture::Title,
                    b"creator" if in_metadata => capture = Capture::Creator,
                    b"item" if in_manifest => parse_item(&e, &mut data, source)?,
                    b"meta" if in_metadata => parse_meta(&e, &mut data, source)?,
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                // Self-closing variants carry attributes only, no text.
                match local_name(e.name()).as_slice() {
                    b"item" if in_manifest => parse_item(&e, &mut data, source)?,
                    b"meta" if in_metadata => parse_meta(&e, &mut data, source)?,
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                let text = t
                    .unescape()
                    .map_err(|err| corrupt_xml(source, err))?
                    .into_owned();
                match capture {
                    Capture::Title => title_texts.push(text),
                    Capture::Creator => creator_texts.push(text),
                    Capture::None => {}
                }
            }
            Ok(Event::End(e)) => {
                match local_name(e.name()).as_slice() {
                    b"metadata" => in_metadata = false,
                    b"manifest" => in_manifest = false,
                    b"title" | b"creator" => capture = Capture::None,
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(corrupt_xml(source, err)),
            _ => {}
        }
        buf.clear();
    }

    // First non-empty <dc:title> wins; multiple creators are joined.
    data.title = title_texts.into_iter().find(|t| !t.trim().is_empty());
    let authors: Vec<String> = creator_texts
        .into_iter()
        .filter(|t| !t.trim().is_empty())
        .collect();
    if !authors.is_empty() {
        data.author = Some(authors.join(", "));
    }
    Ok(data)
}

/// Parse `<item id=".." href=".." media-type=".." properties=".."/>`.
fn parse_item(e: &BytesStart<'_>, data: &mut OpfData, source: &str) -> Result<()> {
    let mut id = None;
    let mut href = None;
    let mut media_type = None;
    let mut properties = None;

    for attr in e.attributes() {
        let attr = attr.map_err(|err| corrupt_xml(source, err))?;
        let value = attr
            .unescape_value()
            .map_err(|err| corrupt_xml(source, err))?
            .into_owned();
        match attr.key.as_ref() {
            b"id" => id = Some(value),
            b"href" => href = Some(value),
            b"media-type" => media_type = Some(value),
            b"properties" => properties = Some(value),
            _ => {}
        }
    }

    if let (Some(id), Some(href)) = (id, href) {
        let media_type =
            media_type.unwrap_or_else(|| "application/octet-stream".to_string());
        // `properties` is a space-separated token list (EPUB 3).
        if let Some(props) = &properties {
            if props.split_whitespace().any(|p| p == "cover-image") {
                data.cover_props_item = Some((href.clone(), media_type.clone()));
            }
        }
        data.manifest.insert(id, (href, media_type));
    }
    Ok(())
}

/// Parse `<meta name="cover" content="<item-id>"/>` (EPUB 2 convention).
fn parse_meta(e: &BytesStart<'_>, data: &mut OpfData, source: &str) -> Result<()> {
    let mut name = None;
    let mut content = None;
    for attr in e.attributes() {
        let attr = attr.map_err(|err| corrupt_xml(source, err))?;
        let value = attr
            .unescape_value()
            .map_err(|err| corrupt_xml(source, err))?
            .into_owned();
        match attr.key.as_ref() {
            b"name" => name = Some(value),
            b"content" => content = Some(value),
            _ => {}
        }
    }
    if name.as_deref() == Some("cover") {
        data.cover_meta_id = content;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// href resolution
// ---------------------------------------------------------------------------

/// Resolve an OPF `href` (relative to the OPF file) into a zip entry path,
/// collapsing `.` and `..` segments.
fn join_opf_href(opf_path: &str, href: &str) -> String {
    let href = href.trim();
    if href.is_empty() || href.starts_with("data:") {
        return String::new();
    }
    // Zip-root-absolute hrefs (rare, non-standard).
    if let Some(stripped) = href.strip_prefix('/') {
        return stripped.to_string();
    }
    let dir = match opf_path.rfind('/') {
        Some(idx) => &opf_path[..idx],
        None => return href.to_string(),
    };
    let mut parts: Vec<&str> = dir
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != ".")
        .collect();
    for seg in href.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

/// Local name of a (possibly prefixed) qualified name: `dc:title` → `title`.
fn local_name(qname: QName<'_>) -> Vec<u8> {
    let raw = qname.as_ref();
    match raw.iter().position(|&b| b == b':') {
        Some(idx) => raw[idx + 1..].to_vec(),
        None => raw.to_vec(),
    }
}
