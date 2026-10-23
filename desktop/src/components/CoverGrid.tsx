/**
 * The virtualized cover grid (Apple HIG content area).
 * role="list" lives here; each card is role="listitem".
 */
import type { Book } from "../lib/types";
import { BookCard } from "./BookCard";
import { useVirtualGrid } from "../hooks/useVirtualGrid";

interface Props {
  books: Book[];
  onOpen: (book: Book) => void;
  onContextMenu: (book: Book, x: number, y: number) => void;
}

export function CoverGrid({ books, onOpen, onContextMenu }: Props) {
  const { containerRef, onScroll, geo } = useVirtualGrid({
    itemCount: books.length,
    minCardWidth: 148,
    gap: 16,
    captionHeight: 92,
  });

  const visible = books.slice(geo.startIndex, geo.endIndex);
  const renderedRows = Math.ceil(visible.length / geo.columns);
  const bottomPad = Math.max(
    0,
    geo.totalHeight - geo.topPad - renderedRows * geo.rowHeight,
  );

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="h-full overflow-y-auto overflow-x-hidden px-8 pb-10 pt-4"
      role="list"
      aria-label="Book library"
    >
      {geo.topPad > 0 && (
        <div style={{ height: geo.topPad }} aria-hidden="true" />
      )}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${geo.columns}, ${geo.cardWidth}px)`,
          gap: 16,
          justifyContent: "center",
        }}
      >
        {visible.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            width={geo.cardWidth}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
      {bottomPad > 0 && (
        <div style={{ height: bottomPad }} aria-hidden="true" />
      )}
    </div>
  );
}
