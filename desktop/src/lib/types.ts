/**
 * Mirror of the Rust core's records (`vellum-core/src/models.rs`).
 *
 * serde serializes with the field names as declared in Rust (snake_case),
 * so the TS side intentionally keeps snake_case too — one less mapping to
 * keep in sync. `BookFormat` serializes as the lowercase string.
 */

export type BookFormat = "pdf" | "epub";

export interface Book {
  id: number;
  title: string;
  author: string | null;
  format: BookFormat;
  /** Absolute filesystem path (desktop). */
  file_path: string;
  /** Cached cover thumbnail path, if one was stored. */
  cover_path: string | null;
  /** Last reading location (JSON locator), if the book was opened. */
  last_read_location: string | null;
  /** Completion 0.0..=1.0, if the book was opened. */
  progress_percent: number | null;
  /** Unix epoch milliseconds. */
  date_added: number;
}

/** `{"kind": "io", "path": ..., "message": ...}` — see core error.rs. */
export interface VellumErrorPayload {
  kind:
    | "io"
    | "database"
    | "unsupported_format"
    | "book_already_exists"
    | "corrupt_file"
    | "book_not_found"
    | "invalid_argument";
  [key: string]: unknown;
}

export interface AddBooksResult {
  added: Book[];
  skipped: string[];
}
