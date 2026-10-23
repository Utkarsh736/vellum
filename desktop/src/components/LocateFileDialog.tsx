/**
 * "File moved" recovery: the desktop book file is gone (renamed, moved,
 * external drive unmounted). The user re-picks it; the library row is
 * re-pointed via core.update_book_path — id, cover and progress survive.
 */
import { useEffect, useRef } from "react";
import type { Book } from "../lib/types";
import { IconSearch } from "./icons";

interface Props {
  book: Book;
  onCancel: () => void;
  /** Called with the re-picked path after a successful update. */
  onResolved: (updated: Book) => void;
  onError: (message: string) => void;
}

export function LocateFileDialog({
  book,
  onCancel,
  onResolved,
  onError,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const pick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      title: `Locate “${book.title}”`,
      filters: [{ name: "Books", extensions: [book.format] }],
    });
    if (typeof picked !== "string") return;
    try {
      const { updateBookPath } = await import("../lib/tauri");
      onResolved(await updateBookPath(book.id, picked));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="locate-title"
        aria-describedby="locate-body"
        className="w-full max-w-[400px] rounded-card border border-line bg-elevated p-5
                   shadow-[0_24px_64px_rgba(17,17,17,0.28)]"
      >
        <h2
          id="locate-title"
          className="font-display text-[15px] font-semibold text-ink"
        >
          Where is this book?
        </h2>
        <p
          id="locate-body"
          className="mt-1.5 text-[13px] leading-relaxed text-ink-2"
        >
          Vellum can’t find{" "}
          <span className="font-medium text-ink">{book.title}</span> at its
          saved location. It may have been moved or renamed. Pick it again —
          your reading progress stays intact.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-[32px] rounded-btn border border-line bg-surface px-3.5
                       text-[12.5px] font-medium text-ink-2 hover:bg-line-soft hover:text-ink"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => void pick()}
            className="flex h-[32px] items-center gap-1.5 rounded-btn bg-ink px-3.5
                       text-[12.5px] font-semibold text-bg hover:opacity-85"
          >
            <IconSearch size={14} />
            Locate File…
          </button>
        </div>
      </div>
    </div>
  );
}
