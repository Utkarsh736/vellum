/**
 * Vellum desktop — root component.
 *
 * Layout (Apple HIG): sidebar + toolbar + virtualized cover grid, with the
 * reader replacing the whole content area when a book is open.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Book } from "./lib/types";
import { bookFileExists } from "./lib/tauri";
import { fileName, isFinished, isReading } from "./lib/format";
import { LibraryProvider, useLibrary } from "./state/LibraryContext";
import { useTheme } from "./hooks/useTheme";
import { Sidebar, type LibraryFilter } from "./components/Sidebar";
import { Toolbar, type SortKey } from "./components/Toolbar";
import { CoverGrid } from "./components/CoverGrid";
import { EmptyState } from "./components/EmptyState";
import { BookContextMenu, type ContextMenuState } from "./components/BookContextMenu";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { LocateFileDialog } from "./components/LocateFileDialog";
import { Toasts } from "./components/Toasts";
import { PdfReader } from "./components/Reader/PdfReader";
import { EpubReader } from "./components/Reader/EpubReader";

type View = { kind: "library" } | { kind: "reader"; book: Book };

function Shell() {
  const { books, loading, addFromPaths, addFromPicker, remove, refresh, pushToast } =
    useLibrary();
  const { theme, toggle } = useTheme();

  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [view, setView] = useState<View>({ kind: "library" });
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Book | null>(null);
  const [locateFor, setLocateFor] = useState<Book | null>(null);

  // ---- Derived list -------------------------------------------------------
  const filtered = useMemo(() => {
    let list = books;
    if (filter === "reading") list = list.filter(isReading);
    if (filter === "finished") list = list.filter(isFinished);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.author ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    switch (sort) {
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "author":
        sorted.sort((a, b) =>
          (a.author ?? "\uffff").localeCompare(b.author ?? "\uffff"),
        );
        break;
      case "progress":
        sorted.sort(
          (a, b) => (b.progress_percent ?? 0) - (a.progress_percent ?? 0),
        );
        break;
      default:
        sorted.sort((a, b) => b.date_added - a.date_added); // recent
    }
    return sorted;
  }, [books, filter, query, sort]);

  const counts = useMemo(
    () => ({
      all: books.length,
      reading: books.filter(isReading).length,
      finished: books.filter(isFinished).length,
    }),
    [books],
  );

  // ---- Opening books ------------------------------------------------------
  const openBook = useCallback(
    async (book: Book) => {
      try {
        const exists = await bookFileExists(book);
        if (!exists) {
          setLocateFor(book);
          return;
        }
        setView({ kind: "reader", book });
      } catch {
        // The check is advisory; try to open anyway.
        setView({ kind: "reader", book });
      }
    },
    [],
  );

  const exitReader = useCallback(() => {
    setView({ kind: "library" });
    // Readers flush their pending progress on unmount; refresh the grid so
    // progress bars / sections reflect the latest save.
    void refresh();
  }, [refresh]);

  // ---- Global shortcuts & drag-and-drop import ---------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void addFromPicker();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addFromPicker]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let active = true;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        (e) => {
          void addFromPaths(e.payload.paths ?? []);
        },
      );
      if (!active) stop();
      else unlisten = stop;
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [addFromPaths]);

  // ---- Render -------------------------------------------------------------
  if (view.kind === "reader") {
    return view.book.format === "pdf" ? (
      <PdfReader book={view.book} onBack={exitReader} />
    ) : (
      <EpubReader book={view.book} onBack={exitReader} />
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar current={filter} onSelect={setFilter} counts={counts} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          theme={theme}
          onToggleTheme={toggle}
          onAdd={() => void addFromPicker()}
          resultCount={filtered.length}
        />
        <main className="min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-[13px] text-ink-3">Loading library…</p>
            </div>
          ) : books.length === 0 ? (
            <EmptyState onAdd={() => void addFromPicker()} />
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5">
              <p className="text-[13px] font-medium text-ink">No matches</p>
              <p className="text-[12px] text-ink-2">
                {query
                  ? `Nothing matches “${query}”`
                  : "Nothing in this section yet"}
              </p>
            </div>
          ) : (
            <CoverGrid
              books={filtered}
              onOpen={(b) => void openBook(b)}
              onContextMenu={(b, x, y) =>
                setMenu({ bookId: b.id, x, y })
              }
            />
          )}
        </main>
      </div>

      {menu && (
        <BookContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onRemove={() => {
            const book = books.find((b) => b.id === menu.bookId);
            if (book) setPendingRemove(book);
          }}
        />
      )}

      {pendingRemove && (
        <ConfirmDialog
          title={`Remove “${pendingRemove.title}” from Vellum?`}
          body={`The original file (${fileName(
            pendingRemove.file_path,
          )}) stays on disk. Only the library entry and cached cover are removed.`}
          confirmLabel="Remove"
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            void remove(pendingRemove);
            setPendingRemove(null);
          }}
        />
      )}

      {locateFor && (
        <LocateFileDialog
          book={locateFor}
          onCancel={() => setLocateFor(null)}
          onResolved={(updated) => {
            setLocateFor(null);
            pushToast(`Found it — opening “${updated.title}”`, "success");
            setView({ kind: "reader", book: updated });
          }}
          onError={(msg) => {
            setLocateFor(null);
            pushToast(msg, "danger");
          }}
        />
      )}

      <ToastsInner />
    </div>
  );
}

function ToastsInner() {
  const { toasts } = useLibrary();
  return <Toasts toasts={toasts} />;
}

export default function App() {
  return (
    <LibraryProvider>
      <Shell />
    </LibraryProvider>
  );
}
