/**
 * App-wide library state: the book list, mutating operations with refresh,
 * and a small toast queue (aria-live).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../lib/tauri";
import type { Book } from "../lib/types";
import { bytesToBase64, fileName } from "../lib/format";

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "danger";
}

interface LibraryContextValue {
  books: Book[];
  loading: boolean;
  refresh: () => Promise<void>;
  addFromPaths: (paths: string[]) => Promise<void>;
  addFromPicker: () => Promise<void>;
  remove: (book: Book) => Promise<void>;
  onBookChanged: (book: Book) => void;
  toasts: Toast[];
  pushToast: (message: string, tone?: Toast["tone"]) => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

const BOOK_EXTENSIONS = /\.(pdf|epub)$/i;

let toastSeq = 1;

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const coverJobs = useRef(new Set<number>()); // book ids queued for cover render

  const pushToast = useCallback(
    (message: string, tone: Toast["tone"] = "info") => {
      const id = toastSeq++;
      setToasts((t) => [...t.slice(-2), { id, message, tone }]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 4200);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setBooks(await api.getLibrary());
    } catch (e) {
      pushToast(errorMessage(e), "danger");
    }
  }, [pushToast]);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  /** Patch one book in place (progress/cover updated while reading). */
  const onBookChanged = useCallback((book: Book) => {
    setBooks((list) => list.map((b) => (b.id === book.id ? book : b)));
  }, []);

  /**
   * PDFs carry no embedded cover — render page 1 via pdf.js and hand the
   * bytes to the core (privacy: the thumbnail lives in the OS cache dir).
   */
  const renderPdfCover = useCallback(
    async (book: Book) => {
      if (coverJobs.current.has(book.id)) return;
      coverJobs.current.add(book.id);
      try {
        const { getDocument, GlobalWorkerOptions } = await import(
          "pdfjs-dist"
        );
        const workerUrl = (
          await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        ).default;
        GlobalWorkerOptions.workerSrc = workerUrl;

        const data = new Uint8Array(await api.readBookFile(book.file_path));
        const doc = await getDocument({
          data,
          // Encrypted PDFs are out of scope — surface as a no-cover, not an error.
          isEvalSupported: false,
        }).promise;
        try {
          const page = await doc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2, 400 / base.width);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          await page.render({ canvasContext: ctx, viewport }).promise;
          const blob = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, "image/jpeg", 0.82),
          );
          if (!blob) return;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const updated = await api.setCover(
            book.id,
            bytesToBase64(bytes),
            "jpg",
          );
          onBookChanged(updated);
        } finally {
          await doc.destroy();
        }
      } catch {
        /* cover generation is best-effort */
      } finally {
        coverJobs.current.delete(book.id);
      }
    },
    [onBookChanged],
  );

  const addFromPaths = useCallback(
    async (paths: string[]) => {
      const bookPaths = paths.filter((p) => BOOK_EXTENSIONS.test(p));
      if (bookPaths.length === 0) return;
      try {
        const result = await api.addBooks(bookPaths);
        if (result.skipped.length > 0) {
          const sample = fileName(result.skipped[0]);
          pushToast(
            `Skipped ${result.skipped.length} already in library (${sample})`,
            "info",
          );
        }
        if (result.added.length > 0) {
          pushToast(`Added ${result.added.length} book(s)`, "success");
        }
        await refresh();
        // Generate missing covers (PDFs) after the grid is visible.
        for (const book of result.added) {
          if (book.format === "pdf" && !book.cover_path) {
            void renderPdfCover(book);
          }
        }
      } catch (e) {
        pushToast(errorMessage(e), "danger");
      }
    },
    [pushToast, refresh, renderPdfCover],
  );

  const addFromPicker = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: "Add books to Vellum",
      filters: [
        { name: "Books (PDF, EPUB)", extensions: ["pdf", "epub"] },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    await addFromPaths(paths);
  }, [addFromPaths]);

  const remove = useCallback(
    async (book: Book) => {
      try {
        await api.removeBook(book.id, true);
        setBooks((list) => list.filter((b) => b.id !== book.id));
        pushToast(`Removed “${book.title}” from library`, "info");
      } catch (e) {
        pushToast(errorMessage(e), "danger");
      }
    },
    [pushToast],
  );

  const value = useMemo(
    () => ({
      books,
      loading,
      refresh,
      addFromPaths,
      addFromPicker,
      remove,
      onBookChanged,
      toasts,
      pushToast,
    }),
    [
      books,
      loading,
      refresh,
      addFromPaths,
      addFromPicker,
      remove,
      onBookChanged,
      toasts,
      pushToast,
    ],
  );

  return (
    <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}

function errorMessage(e: unknown): string {
  if (typeof e === "object" && e != null) {
    const payload = e as { message?: string; kind?: string };
    if (payload.message) return String(payload.message);
    if (payload.kind) return `Library error (${payload.kind})`;
  }
  return String(e);
}
