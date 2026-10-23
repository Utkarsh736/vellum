/**
 * One cover-grid cell: cover thumbnail (or format fallback), title, author,
 * reading progress. Click = open; right-click = context menu.
 */
import { memo, useState } from "react";
import type { Book } from "../lib/types";
import { coverAssetUrl } from "../lib/tauri";
import { cx, formatPercent } from "../lib/format";

interface Props {
  book: Book;
  width: number;
  onOpen: (book: Book) => void;
  onContextMenu: (book: Book, x: number, y: number) => void;
}

function CoverFallback({ book }: { book: Book }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2"
      style={{
        background:
          book.format === "pdf"
            ? "linear-gradient(150deg,#3f3f46,#18181b)"
            : "linear-gradient(150deg,#8b5cf6,#5b21b6)",
      }}
    >
      <span
        className="font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-white/90"
        aria-hidden="true"
      >
        {book.format}
      </span>
    </div>
  );
}

export const BookCard = memo(function BookCard({
  book,
  width,
  onOpen,
  onContextMenu,
}: Props) {
  const [coverBroken, setCoverBroken] = useState(false);
  const percent = book.progress_percent;
  const showProgress = percent != null && percent > 0.005 && percent < 0.995;
  const finished = percent != null && percent >= 0.995;
  const coverHeight = Math.round(width * 1.5);

  return (
    <div
      role="listitem"
      className="group/card flex flex-col focus-within:z-10"
      style={{ width }}
    >
      <button
        type="button"
        className="relative block cursor-pointer overflow-hidden rounded-card bg-line-soft
                   shadow-[0_1px_2px_rgba(17,17,17,0.06)] transition
                   duration-150 group-hover/card:shadow-[0_8px_24px_rgba(17,17,17,0.14)]
                   dark:shadow-none dark:group-hover/card:shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
        style={{ height: coverHeight }}
        onClick={() => onOpen(book)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(book, e.clientX, e.clientY);
        }}
        aria-label={`Open ${book.title} by ${
          book.author ?? "unknown author"
        }${showProgress ? `, ${formatPercent(percent)} read` : ""}`}
      >
        {book.cover_path && !coverBroken ? (
          <img
            src={coverAssetUrl(book.cover_path)}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover"
            onError={() => setCoverBroken(true)}
          />
        ) : (
          <CoverFallback book={book} />
        )}

        {finished && (
          <span
            className="absolute left-2 top-2 rounded-full bg-accent-fill px-2 py-0.5
                       text-[10px] font-semibold uppercase tracking-wide text-on-accent"
          >
            Finished
          </span>
        )}
      </button>

      <div className="min-w-0 pt-2">
        <p className="clamp-2 text-[13px] font-medium leading-snug text-ink">
          {book.title}
        </p>
        <p className="truncate pt-0.5 text-[12px] text-ink-2">
          {book.author ?? "Unknown author"}
        </p>
        {showProgress && (
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={Math.round(percent! * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${formatPercent(percent)} read`}
          >
            <div
              className={cx("h-full rounded-full bg-accent-fill")}
              style={{ width: `${Math.round(percent! * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
});
