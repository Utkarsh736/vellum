/**
 * Typed wrappers around the Tauri IPC commands (`src-tauri/src/lib.rs`).
 * Every function here is the *only* place that knows a command name —
 * the rest of the app imports semantic operations.
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { AddBooksResult, Book } from "./types";

export function getLibrary(): Promise<Book[]> {
  return invoke<Book[]>("get_library");
}

export function getBook(bookId: number): Promise<Book> {
  return invoke<Book>("get_book", { bookId });
}

export function addBooks(paths: string[]): Promise<AddBooksResult> {
  return invoke<AddBooksResult>("add_books", { paths });
}

export function removeBook(bookId: number, deleteCover: boolean): Promise<void> {
  return invoke("remove_book", { bookId, deleteCover });
}

export function updateProgress(
  bookId: number,
  location: string,
  percent: number,
): Promise<void> {
  return invoke("update_progress", { bookId, location, percent });
}

/** Returns the (possibly updated) book with its new cover_path. */
export function setCover(
  bookId: number,
  dataB64: string,
  ext: string,
): Promise<Book> {
  return invoke<Book>("set_cover", { bookId, dataB64, ext });
}

export function updateBookPath(bookId: number, newPath: string): Promise<Book> {
  return invoke<Book>("update_book_path", { bookId, newPath });
}

export function bookFileExists(book: Book): Promise<boolean> {
  return invoke<boolean>("book_file_exists", { book });
}

/**
 * Raw bytes of the book file. The Rust side returns `tauri::ipc::Response`
 * (zero-copy raw IPC) which the invoke bridge hands back as an ArrayBuffer.
 */
export function readBookFile(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_book_file", { path });
}

/**
 * Cover thumbnails are served through Tauri's asset protocol
 * (scope-limited to the app cache dir — see tauri.conf.json).
 */
export function coverAssetUrl(coverPath: string): string {
  return convertFileSrc(coverPath);
}
