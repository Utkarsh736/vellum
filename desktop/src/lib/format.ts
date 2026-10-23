/** Small pure formatting helpers used across the UI. */

export function formatAuthor(author: string | null): string {
  return author?.trim() || "Unknown author";
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

/** 0.0..1.0 → "42%" (never "100%" unless actually finished). */
export function formatPercent(p: number | null): string {
  if (p == null) return "";
  return `${Math.round(p * 100)}%`;
}

/** True when the book was opened but not finished. */
export function isReading(book: { progress_percent: number | null }): boolean {
  const p = book.progress_percent;
  return p != null && p > 0 && p < 0.995;
}

export function isFinished(book: { progress_percent: number | null }): boolean {
  const p = book.progress_percent;
  return p != null && p >= 0.995;
}

export function fileName(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return idx === -1 ? clean : clean.slice(idx + 1);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // avoid arg-count limits
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
