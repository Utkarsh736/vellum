# Vellum Reading Engine — Cross-Platform Contract (Step 4)

This document defines the shared reading-engine behavior implemented by both
frontends. The Rust core (`vellum-core`) stores the results; everything in
this document describes how the *frontends* produce them.

## Progress persistence

| Aspect            | Behavior                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| Trigger           | Every *displayed* location change (page turn, chapter render)            |
| Debounce          | **1200 ms trailing** — flipping pages writes once, not per page          |
| Ordering          | Newest value wins; writes are serialized (no out-of-order saves)         |
| Flush on exit     | Back navigation / reader unmount forces the pending write                |
| Failure policy    | Progress is non-critical: write failures are swallowed, reading continues |
| Percent semantics | `0.0 .. 1.0` completion; the core clamps overshoot and rejects non-finite |

Reference implementations:

- Desktop: `desktop/src/readers/progress.ts` (`ProgressSaver` class)
- Android PDF: `PdfReaderState.scheduleProgress/flush/close`
- Android EPUB: `EpubReaderState.Bridge.onRelocated` + `writeProgress`

## Location locators

The `last_read_location` column holds a small JSON locator:

```json
{"type": "pdf", "page": 12, "total": 240}
{"type": "epub", "cfi": "epubcfi(/6/14!/4/2/1:0)"}
```

- **PDF** locators are produced by pdf.js (desktop) and `PdfRenderer`
  (Android). `page` is 1-based. Restoring clamps to the current page count,
  so a locator survives re-flowed documents (e.g. an updated PDF with more
  pages) by clamping to the last page.
- **EPUB** locators are EPUB CFIs produced by epub.js on both platforms —
  byte-identical libraries mean byte-identical CFIs, so progress made on the
  phone resumes on the laptop and vice versa.

Unknown/corrupt locators are ignored and the book opens from the beginning.

## Percent estimation

- PDF: exact — `(page + 1) / pageCount`.
- EPUB: epub.js reports an exact `percentage` only when book *locations* are
  generated, a CPU-heavy full-pagination pass. Vellum deliberately skips it;
  both engines fall back to the **spine-index estimate**
  `(spineIndex + 1) / spineLength`. This is approximate for books with very
  uneven chapter lengths, and both platforms compute it the same way so the
  number is consistent across devices.

## Resilience flows

- **Moved file (desktop)**: opening a book whose path no longer resolves
  offers "Locate File…"; the row is re-pointed with `update_book_path` and
  id/cover/progress survive.
- **Revoked SAF grant (Android)**: readers surface a "choose file again"
  state; re-taking the persistable URI permission (or re-pointing the row at
  a new URI via `update_book_path`) restores reading with progress intact.

## Security posture of the engines

| Engine    | Desktop                                  | Android                                          |
| --------- | ---------------------------------------- | ------------------------------------------------ |
| PDF       | pdf.js 4.x, local worker, eval disabled  | `android.graphics.pdf.PdfRenderer` (system)      |
| EPUB      | epub.js, `allowScriptedContent: false`   | epub.js, `allowScriptedContent: false`           |
| Book data | in-memory `ArrayBuffer` over raw IPC     | in-memory byte feed, chunked base64 into WebView |
| Network   | blocked by CSP (`connect-src` has no remote origins) | blocked by CSP **and** absent `INTERNET` permission |

Book contents are never written to app storage by any engine, never indexed,
and never leave the device.
