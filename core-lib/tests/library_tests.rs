//! Integration tests for the Vellum core.
//!
//! All fixtures (EPUB / PDF) are built in memory by the tests themselves —
//! no binary fixtures, no network, and no book content beyond the minimum
//! needed to exercise metadata parsing.

use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use vellum_core::{
    extract_epub_metadata, extract_pdf_metadata, BookFormat, VellumError, VellumLibrary,
};

// ===========================================================================
// Fixture builders
// ===========================================================================

fn container_xml(opf_path: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="{opf_path}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#
    )
}

/// EPUB 3: the cover is the manifest item with `properties="cover-image"`.
fn opf_epub3(title: Option<&str>, author: Option<&str>) -> String {
    let title_el = title
        .map(|t| format!("<dc:title>{t}</dc:title>"))
        .unwrap_or_default();
    let author_el = author
        .map(|a| format!("<dc:creator>{a}</dc:creator>"))
        .unwrap_or_default();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    {title_el}
    {author_el}
    <dc:language>en</dc:language>
    <dc:identifier id="pub-id">urn:uuid:00000000-0000-0000-0000-000000000001</dc:identifier>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-item" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>"#
    )
}

/// EPUB 2: the cover is declared via `<meta name="cover" content="id"/>`.
fn opf_epub2(title: Option<&str>, author: Option<&str>) -> String {
    let title_el = title
        .map(|t| format!("<dc:title>{t}</dc:title>"))
        .unwrap_or_default();
    let author_el = author
        .map(|a| format!("<dc:creator>{a}</dc:creator>"))
        .unwrap_or_default();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    {title_el}
    {author_el}
    <dc:language>en</dc:language>
    <dc:identifier id="pub-id">urn:uuid:00000000-0000-0000-0000-000000000002</dc:identifier>
    <meta name="cover" content="cover-item"/>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-item" href="cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>"#
    )
}

fn build_epub(opf: &str) -> Vec<u8> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();

        zip.start_file("META-INF/container.xml", deflated).unwrap();
        zip.write_all(container_xml("OEBPS/content.opf").as_bytes())
            .unwrap();

        zip.start_file("OEBPS/content.opf", deflated).unwrap();
        zip.write_all(opf.as_bytes()).unwrap();

        zip.start_file("OEBPS/cover.jpg", deflated).unwrap();
        zip.write_all(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])
            .unwrap();

        zip.start_file("OEBPS/chapter1.xhtml", deflated).unwrap();
        zip.write_all(b"<html><body><p>It was a dark and stormy night.</p></body></html>")
            .unwrap();

        zip.finish().unwrap();
    }
    cursor.into_inner()
}

fn build_pdf(title: Option<&str>, author: Option<&str>, utf16: bool) -> Vec<u8> {
    let mut doc = lopdf::Document::with_version("1.7");

    let mut info = lopdf::Dictionary::new();
    if let Some(title) = title {
        let title_obj = if utf16 {
            let mut bytes = vec![0xFE, 0xFF];
            for unit in title.encode_utf16() {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
            lopdf::Object::String(bytes, lopdf::StringFormat::Literal)
        } else {
            lopdf::Object::string_literal(title)
        };
        info.set("Title", title_obj);
    }
    if let Some(author) = author {
        info.set("Author", lopdf::Object::string_literal(author));
    }
    let info_id = doc.add_object(lopdf::Object::Dictionary(info));

    let page_id = doc.add_object(lopdf::dictionary! { "Type" => "Page" });
    let pages_id = doc.add_object(lopdf::dictionary! {
        "Type" => "Pages",
        "Count" => 1,
        "Kids" => vec![lopdf::Object::Reference(page_id)]
    });
    let catalog_id = doc.add_object(lopdf::dictionary! {
        "Type" => "Catalog",
        "Pages" => lopdf::Object::Reference(pages_id)
    });
    doc.trailer.set("Info", lopdf::Object::Reference(info_id));
    doc.trailer.set("Root", lopdf::Object::Reference(catalog_id));

    let mut out = Cursor::new(Vec::new());
    doc.save_to(&mut out).unwrap();
    out.into_inner()
}

// ===========================================================================
// Test environment
// ===========================================================================

struct Env {
    dir: PathBuf,
    _keep: tempfile::TempDir,
    db: PathBuf,
    cache: PathBuf,
}

impl Env {
    fn new() -> Self {
        let keep = tempfile::tempdir().expect("tempdir");
        let dir = keep.path().to_path_buf();
        Env {
            db: dir.join("vellum.db"),
            cache: dir.join("cache"),
            dir,
            _keep: keep,
        }
    }

    fn lib(&self) -> VellumLibrary {
        VellumLibrary::new(
            self.db.to_string_lossy().into_owned(),
            self.cache.to_string_lossy().into_owned(),
        )
        .expect("open library")
    }

    fn write_epub_fixture(&self, name: &str) -> String {
        self.write_file(
            name,
            &build_epub(&opf_epub3(Some("Fixture Book"), Some("Fixture Author"))),
        )
    }

    fn write_file(&self, name: &str, bytes: &[u8]) -> String {
        let path = self.dir.join(name);
        fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    }
}

// ===========================================================================
// Metadata extraction: EPUB
// ===========================================================================

#[test]
fn epub3_metadata_with_cover() {
    let bytes = build_epub(&opf_epub3(Some("The Vellum Test"), Some("Ada Lovelace")));
    let meta = extract_epub_metadata(bytes, "the-vellum-test.epub".to_string()).unwrap();
    assert_eq!(meta.format, BookFormat::Epub);
    assert_eq!(meta.title, "The Vellum Test");
    assert_eq!(meta.author.as_deref(), Some("Ada Lovelace"));
    let cover = meta.cover.expect("EPUB 3 property cover");
    assert_eq!(cover.media_type, "image/jpeg");
    assert_eq!(cover.bytes.first(), Some(&0xFF)); // JPEG magic byte
}

#[test]
fn epub2_cover_via_meta_name() {
    let bytes = build_epub(&opf_epub2(
        Some("Silent Spring Reprint"),
        Some("Rachel Carson"),
    ));
    let meta = extract_epub_metadata(bytes, "book.epub".to_string()).unwrap();
    assert_eq!(meta.title, "Silent Spring Reprint");
    let cover = meta.cover.expect("EPUB 2 meta cover");
    assert_eq!(cover.media_type, "image/jpeg");
}

#[test]
fn epub_missing_title_author_falls_back_to_filename() {
    let bytes = build_epub(&opf_epub3(None, None));
    let meta = extract_epub_metadata(bytes, "untitled-book.epub".to_string()).unwrap();
    assert_eq!(meta.title, "untitled-book");
    assert_eq!(meta.author, None);
    assert!(meta.cover.is_some()); // cover is still discovered
}

#[test]
fn corrupt_epub_is_rejected() {
    let err =
        extract_epub_metadata(vec![1, 2, 3, 4], "broken.epub".to_string()).unwrap_err();
    assert!(matches!(err, VellumError::CorruptFile { .. }));
}

// ===========================================================================
// Metadata extraction: PDF
// ===========================================================================

#[test]
fn pdf_metadata_ascii() {
    let bytes = build_pdf(
        Some("A Field Guide to Silence"),
        Some("Grace Hopper"),
        false,
    );
    let meta = extract_pdf_metadata(bytes, "guide.pdf".to_string()).unwrap();
    assert_eq!(meta.format, BookFormat::Pdf);
    assert_eq!(meta.title, "A Field Guide to Silence");
    assert_eq!(meta.author.as_deref(), Some("Grace Hopper"));
    assert!(meta.cover.is_none()); // PDF covers are rendered by the frontend
}

#[test]
fn pdf_metadata_utf16_title() {
    let bytes = build_pdf(Some("Résumé — テスト書籍"), None, true);
    let meta = extract_pdf_metadata(bytes, "resume.pdf".to_string()).unwrap();
    assert_eq!(meta.title, "Résumé — テスト書籍");
}

#[test]
fn pdf_fallback_title_when_no_info() {
    let bytes = build_pdf(None, None, false);
    let meta = extract_pdf_metadata(bytes, "manual.pdf".to_string()).unwrap();
    assert_eq!(meta.title, "manual");
    assert_eq!(meta.author, None);
}

#[test]
fn corrupt_pdf_is_rejected() {
    let err = extract_pdf_metadata(vec![0u8, 1, 2, 3], "broken.pdf".to_string()).unwrap_err();
    assert!(matches!(err, VellumError::CorruptFile { .. }));
}

// ===========================================================================
// Library lifecycle
// ===========================================================================

#[test]
fn library_add_get_roundtrip() {
    let env = Env::new();
    let lib = env.lib();

    let path = env.write_epub_fixture("vellum-test.epub");
    let book = lib.add_book(path.clone(), None, None).unwrap();

    assert_eq!(book.format, BookFormat::Epub);
    assert_eq!(book.title, "Fixture Book");
    assert_eq!(book.author.as_deref(), Some("Fixture Author"));
    assert_eq!(book.file_path, path);
    assert!(book.last_read_location.is_none());
    assert!(book.progress_percent.is_none());
    assert!(book.date_added > 0);

    // Cover written into the cache directory.
    let cover = book.cover_path.as_deref().expect("cover cached");
    assert!(cover.contains("covers"));
    assert!(Path::new(cover).is_file());

    let library = lib.get_library().unwrap();
    assert_eq!(library.len(), 1);
    assert_eq!(library[0].id, book.id);
    assert_eq!(library[0].title, "Fixture Book");

    let fetched = lib.get_book(book.id).unwrap().expect("book by id");
    assert_eq!(fetched.file_path, path);
}

#[test]
fn library_progress_upsert_and_join() {
    let env = Env::new();
    let lib = env.lib();
    let book = lib.add_book(env.write_epub_fixture("progress.epub"), None, None).unwrap();

    // No progress initially.
    assert!(lib.get_progress(book.id).unwrap().is_none());

    lib.update_progress(book.id, "epub:cfi=/6/4!/4/2".to_string(), 0.35)
        .unwrap();
    let p = lib.get_progress(book.id).unwrap().expect("progress");
    assert_eq!(p.book_id, book.id);
    assert_eq!(p.location, "epub:cfi=/6/4!/4/2");
    assert!((p.percent - 0.35).abs() < 1e-9);
    assert!(p.updated_at > 0);

    // The join surfaces on the Book record for the library grid.
    let b = lib.get_book(book.id).unwrap().unwrap();
    assert_eq!(b.last_read_location.as_deref(), Some("epub:cfi=/6/4!/4/2"));
    assert!((b.progress_percent.unwrap() - 0.35).abs() < 1e-9);

    // Upsert overwrites — still a single row.
    lib.update_progress(book.id, "epub:cfi=/6/12".to_string(), 0.9)
        .unwrap();
    let p2 = lib.get_progress(book.id).unwrap().unwrap();
    assert_eq!(p2.location, "epub:cfi=/6/12");
    assert!((p2.percent - 0.9).abs() < 1e-9);

    // Out-of-range clamps to [0, 1]; NaN neutralizes to 0.
    lib.update_progress(book.id, "x".to_string(), 7.5).unwrap();
    assert!((lib.get_progress(book.id).unwrap().unwrap().percent - 1.0).abs() < 1e-9);
    lib.update_progress(book.id, "x".to_string(), f64::NAN).unwrap();
    assert_eq!(lib.get_progress(book.id).unwrap().unwrap().percent, 0.0);

    // Empty location rejected; unknown book rejected.
    assert!(matches!(
        lib.update_progress(book.id, "   ".to_string(), 0.5),
        Err(VellumError::InvalidArgument { .. })
    ));
    assert!(matches!(
        lib.update_progress(999, "x".to_string(), 0.5),
        Err(VellumError::BookNotFound { .. })
    ));

    // "Mark as unread".
    lib.clear_progress(book.id).unwrap();
    assert!(lib.get_progress(book.id).unwrap().is_none());
    assert!(lib.get_book(book.id).unwrap().unwrap().last_read_location.is_none());
}

#[test]
fn library_remove_book_deletes_cover_and_progress() {
    let env = Env::new();
    let lib = env.lib();
    let book = lib
        .add_book(env.write_epub_fixture("removal.epub"), None, None)
        .unwrap();
    lib.update_progress(book.id, "epub:cfi=/2/4".to_string(), 0.5)
        .unwrap();

    let cover = book.cover_path.clone().unwrap();
    assert!(Path::new(&cover).is_file());

    lib.remove_book(book.id, true).unwrap();
    assert!(!Path::new(&cover).exists());
    assert!(lib.get_library().unwrap().is_empty());
    assert!(lib.get_progress(book.id).unwrap().is_none());
    assert!(lib.get_book(book.id).unwrap().is_none());
    assert!(matches!(
        lib.remove_book(book.id, true),
        Err(VellumError::BookNotFound { .. })
    ));
}

#[test]
fn library_rejects_duplicate_path() {
    let env = Env::new();
    let lib = env.lib();
    let path = env.write_epub_fixture("dup.epub");
    lib.add_book(path.clone(), None, None).unwrap();
    match lib.add_book(path, None, None) {
        Err(VellumError::BookAlreadyExists { .. }) => {}
        other => panic!("expected BookAlreadyExists, got {other:?}"),
    }
    assert_eq!(lib.get_library().unwrap().len(), 1);
}

#[test]
fn library_rejects_unsupported_format() {
    let env = Env::new();
    let lib = env.lib();
    let path = env.write_file("book.mobi", b"not really a mobi");
    assert!(matches!(
        lib.add_book(path, None, None),
        Err(VellumError::UnsupportedFormat { .. })
    ));
}

#[test]
fn library_reports_missing_file() {
    let env = Env::new();
    let lib = env.lib();
    let missing = env.dir.join("ghost.epub");
    assert!(matches!(
        lib.add_book(missing.to_string_lossy().into_owned(), None, None),
        Err(VellumError::Io { .. })
    ));
}

#[test]
fn library_title_override() {
    let env = Env::new();
    let lib = env.lib();
    let path = env.write_epub_fixture("override.epub");
    let book = lib
        .add_book(path, None, Some("My Custom Name".to_string()))
        .unwrap();
    assert_eq!(book.title, "My Custom Name");
}

// ===========================================================================
// Android SAF flow
// ===========================================================================

#[test]
fn library_android_saf_flow() {
    let env = Env::new();
    let lib = env.lib();

    // Android: Kotlin reads the bytes via ContentResolver and extracts
    // metadata first; the core only stores the record under the SAF URI.
    let bytes = build_epub(&opf_epub3(Some("SAF Book"), Some("K. Tanaka")));
    let meta = extract_epub_metadata(bytes, "saf-book.epub".to_string()).unwrap();
    let uri = "content://com.android.externalstorage.documents/document/primary%3ABooks%2Fsaf-book.epub".to_string();

    let book = lib.add_book(uri.clone(), Some(meta), None).unwrap();
    assert_eq!(book.file_path, uri);
    assert_eq!(book.title, "SAF Book");
    assert_eq!(book.author.as_deref(), Some("K. Tanaka"));

    // Cover was still cached — the bytes came from the provided metadata.
    let cover = book.cover_path.as_deref().expect("cover cached");
    assert!(Path::new(cover).is_file());

    // content:// URIs are reported as existing; resolution is the
    // ContentResolver's job, not the core's.
    assert!(lib.book_file_exists(&book));

    // The database file itself was created in the app data dir.
    assert!(env.db.is_file());
}

// ===========================================================================
// PDF cover rendering hand-off
// ===========================================================================

#[test]
fn library_set_cover_for_pdf() {
    let env = Env::new();
    let lib = env.lib();

    let pdf_path = env.write_file("coverless.pdf", &build_pdf(Some("Coverless"), None, false));
    let book = lib.add_book(pdf_path, None, None).unwrap();
    assert!(book.cover_path.is_none()); // PDFs have no embedded cover

    // The frontend renders page 1 and hands the bytes back.
    let fake_png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    let cover_path = lib
        .set_cover(book.id, fake_png, "png".to_string())
        .unwrap();
    assert!(cover_path.ends_with(".png"));
    assert!(Path::new(&cover_path).is_file());

    let b = lib.get_book(book.id).unwrap().unwrap();
    assert_eq!(b.cover_path.as_deref(), Some(cover_path.as_str()));
}

// ===========================================================================
// Re-pointing a book at a new path/URI (moved files, revoked SAF grants)
// ===========================================================================

#[test]
fn library_update_book_path_keeps_progress_and_cover() {
    let env = Env::new();
    let lib = env.lib();

    let old_path = env.write_epub_fixture("original.epub");
    let book = lib.add_book(old_path, None, None).unwrap();
    lib.update_progress(book.id, "epub:cfi=/6/4".to_string(), 0.42).unwrap();

    // The file "moved" on disk; the user picked the new location.
    let new_path = env.write_file(
        "moved.epub",
        &build_epub(&opf_epub3(Some("Fixture Book"), Some("Fixture Author"))),
    );
    let updated = lib.update_book_path(book.id, new_path.clone()).unwrap();
    assert_eq!(updated.id, book.id); // same row — progress and cover survive
    assert_eq!(updated.file_path, new_path);
    assert_eq!(updated.progress_percent, Some(0.42));

    let all = lib.get_library().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].file_path, new_path);
}

#[test]
fn library_update_book_path_rejects_collision_and_bad_input() {
    let env = Env::new();
    let lib = env.lib();

    let a = lib.add_book(env.write_epub_fixture("a.epub"), None, None).unwrap();
    let b_path = env.write_file(
        "b.epub",
        &build_epub(&opf_epub2(Some("Second"), None)),
    );
    let b = lib.add_book(b_path.clone(), None, None).unwrap();

    // Pointing book A at book B's path would break the UNIQUE constraint.
    match lib.update_book_path(a.id, b_path) {
        Err(VellumError::BookAlreadyExists { .. }) => {}
        other => panic!("expected BookAlreadyExists, got {other:?}"),
    }

    // Unknown id.
    match lib.update_book_path(9999, "/somewhere/else.epub".to_string()) {
        Err(VellumError::BookNotFound { id: 9999 }) => {}
        other => panic!("expected BookNotFound, got {other:?}"),
    }

    // Empty path.
    match lib.update_book_path(b.id, "   ".to_string()) {
        Err(VellumError::InvalidArgument { .. }) => {}
        other => panic!("expected InvalidArgument, got {other:?}"),
    }

    // A no-op same-path update is fine and returns the same row.
    let same = lib.get_book(b.id).unwrap().unwrap();
    let re = lib.update_book_path(b.id, same.file_path.clone()).unwrap();
    assert_eq!(re.file_path, same.file_path);
}
