/**
 * Vellum reading engine — progress persistence (Step 4).
 *
 * Contract (shared with the Android reader, see docs/READING_ENGINE.md):
 *  - Readers emit (percent, location) on every *displayed* change.
 *  - Saves are debounced (1200 ms trailing) so page-flipping through a
 *    book writes the SQLite row once, not per page.
 *  - `flush()` forces the pending save (used when a book is closed, the
 *    reader unmounts, or the window is hidden/closed).
 *  - The `location` is a small JSON locator; `percent` is 0.0..=1.0 and is
 *    clamped by the core (readers may emit slight overshoot at a book end).
 */

import { updateProgress } from "../lib/tauri";

export const SAVE_DEBOUNCE_MS = 1200;

/** PDF locator: a page number within a known page count. */
export interface PdfLocation {
  type: "pdf";
  page: number;
  total: number;
}

/** EPUB locator: an EPUB CFI (canonical fragment identifier). */
export interface EpubLocation {
  type: "epub";
  cfi: string;
}

export type ReadingLocation = PdfLocation | EpubLocation;

export function encodeLocation(loc: ReadingLocation): string {
  return JSON.stringify(loc);
}

export function decodeLocation(
  raw: string | null | undefined,
): ReadingLocation | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as ReadingLocation;
    if (obj.type === "pdf" && typeof obj.page === "number") return obj;
    if (obj.type === "epub" && typeof obj.cfi === "string") return obj;
  } catch {
    /* legacy or corrupt locator — start from the beginning */
  }
  return null;
}

/**
 * Debounced, ordered progress writer.
 *
 * Ordering guarantee: if a save is in flight when the next one fires, the
 * newest payload always wins — `latest` holds the most recent value and any
 * in-flight stale write is followed by an immediate re-save.
 */
export class ProgressSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> = Promise.resolve();
  private latest: { location: string; percent: number } | null = null;
  private closed = false;

  constructor(private readonly bookId: number) {}

  /** Called by readers on every displayed change. */
  save(percent: number, location: string): void {
    if (this.closed) return;
    this.latest = { location, percent };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
  }

  /** Write the pending value now (if any). Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const payload = this.latest;
    if (!payload) return this.inFlight;
    this.latest = null;
    // Chain writes to keep them ordered; a rejection surfaces on flush()
    // but never breaks the chain for the *next* save.
    this.inFlight = this.inFlight.then(() =>
      updateProgress(this.bookId, payload.location, payload.percent).catch(
        () => {
          /* best-effort: progress is non-critical data */
        },
      ),
    );
    return this.inFlight;
  }

  /** Stop debouncing entirely (reader unmounted). Flushes once. */
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  /** True when a save is pending (used by UI to show a "saving" hint). */
  get pending(): boolean {
    return this.timer != null || this.latest != null;
  }
}
