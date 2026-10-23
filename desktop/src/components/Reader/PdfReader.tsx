/**
 * PDF reader (Step 2/4): pdf.js single-page view with fit-width zoom,
 * page navigation, keyboard support and debounced progress persistence.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Book } from "../../lib/types";
import { readBookFile } from "../../lib/tauri";
import { pdfjsLib, type PDFDocumentProxy } from "../../readers/pdfSetup";
import {
  ProgressSaver,
  decodeLocation,
  encodeLocation,
} from "../../readers/progress";
import { ReaderShell, ReaderIconButton } from "./ReaderShell";
import {
  IconChevronLeft,
  IconChevronRight,
  IconZoomIn,
  IconZoomOut,
} from "../icons";

interface Props {
  book: Book;
  onBack: () => void;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; doc: PDFDocumentProxy };

export function PdfReader({ book, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1); // multiplier over fit-width
  const [rendering, setRendering] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const saverRef = useRef<ProgressSaver | null>(null);
  const pageNumRef = useRef(1);

  // ---- Load document ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const saver = new ProgressSaver(book.id);
    saverRef.current = saver;

    (async () => {
      try {
        const buf = await readBookFile(book.file_path);
        const doc = await pdfjsLib.getDocument({
          data: new Uint8Array(buf),
          isEvalSupported: false,
        }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        const total = doc.numPages;
        setTotalPages(total);

        const loc = decodeLocation(book.last_read_location);
        const start =
          loc?.type === "pdf" ? Math.min(Math.max(1, loc.page), total) : 1;
        pageNumRef.current = start;
        setPageNum(start);
        setState({ phase: "ready", doc });
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof Error && e.name === "PasswordException"
            ? "This PDF is password-protected. Vellum only opens unencrypted files."
            : e instanceof Error
              ? e.message
              : "Could not open this PDF.";
        setState({ phase: "error", message });
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      saverRef.current?.close();
      saverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // Destroy the document on unmount.
  useEffect(() => {
    return () => {
      if (state.phase === "ready") void state.doc.destroy();
    };
  }, [state]);

  // ---- Navigation ---------------------------------------------------------
  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), totalPages || 1);
      if (clamped === pageNumRef.current) return;
      pageNumRef.current = clamped;
      setPageNum(clamped);
      if (saverRef.current && totalPages > 0) {
        saverRef.current.save(
          clamped / totalPages,
          encodeLocation({ type: "pdf", page: clamped, total: totalPages }),
        );
      }
      scrollRef.current?.scrollTo({ top: 0 });
    },
    [totalPages],
  );

  const goPrev = useCallback(() => goToPage(pageNum - 1), [goToPage, pageNum]);
  const goNext = useCallback(() => goToPage(pageNum + 1), [goToPage, pageNum]);

  // ---- Rendering ----------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "ready") return;
    const canvas = canvasRef.current;
    const container = scrollRef.current;
    if (!canvas || !container) return;

    let cancelled = false;
    setRendering(true);

    (async () => {
      try {
        const page = await state.doc.getPage(pageNum);
        if (cancelled) return;

        const cssWidth = container.clientWidth - 48; // 24px padding
        const base = page.getViewport({ scale: 1 });
        const fitScale = Math.max(0.1, cssWidth / base.width) * zoom;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: fitScale });

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTaskRef.current?.cancel();
        const task = page.render({
          canvasContext: canvas.getContext("2d")!,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = task;
        await task.promise;
      } catch (e) {
        // RenderingCancelledException is expected when flipping fast.
        if (!(e instanceof Error && e.name === "RenderingCancelledException")) {
          console.error("pdf render failed", e);
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state, pageNum, zoom]);

  // ---- Keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          goNext();
          break;
        case "+":
        case "=":
          setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
          break;
        case "-":
          setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  // ---- UI -----------------------------------------------------------------
  const actions = (
    <>
      <ReaderIconButton
        label="Zoom out (−)"
        onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
      >
        <IconZoomOut size={16} />
      </ReaderIconButton>
      <span className="min-w-[42px] text-center font-mono text-[11px] tabular-nums text-ink-2">
        {Math.round(zoom * 100)}%
      </span>
      <ReaderIconButton
        label="Zoom in (+)"
        onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
      >
        <IconZoomIn size={16} />
      </ReaderIconButton>
    </>
  );

  return (
    <ReaderShell
      title={book.title}
      subtitle={`PDF${totalPages ? ` · ${totalPages} pages` : ""}`}
      onBack={onBack}
      actions={actions}
    >
      {state.phase === "loading" && (
        <Center>
          <p className="text-[13px] text-ink-2">Opening…</p>
        </Center>
      )}
      {state.phase === "error" && (
        <Center>
          <p className="max-w-[420px] text-center text-[13px] leading-relaxed text-danger">
            {state.message}
          </p>
        </Center>
      )}
      {state.phase === "ready" && (
        <div className="flex h-full flex-col">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-auto"
            role="document"
            aria-label={`PDF page ${pageNum} of ${totalPages}`}
          >
            <div className="flex min-h-full items-start justify-center p-6">
              <canvas
                ref={canvasRef}
                className="rounded-[4px] shadow-[0_2px_12px_rgba(17,17,17,0.10)] dark:shadow-[0_2px_16px_rgba(0,0,0,0.5)]"
              />
            </div>
          </div>

          <div className="flex h-[52px] shrink-0 items-center justify-center gap-3 border-t border-line bg-surface/80 backdrop-blur-xl">
            <ReaderIconButton
              label="Previous page (←)"
              onClick={goPrev}
              disabled={pageNum <= 1}
            >
              <IconChevronLeft size={17} />
            </ReaderIconButton>

            <label className="flex items-center gap-1.5 text-[12.5px] tabular-nums text-ink-2">
              <span className="sr-only">Current page</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageNum}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) goToPage(v);
                }}
                aria-label={`Page number, of ${totalPages}`}
                className="h-[28px] w-[52px] rounded-input border border-line bg-bg px-1.5
                           text-center font-mono text-[12px] text-ink focus:border-accent-fill focus:outline-none"
              />
              <span>
                / {totalPages}
                {rendering ? "  ·" : ""}
              </span>
            </label>

            <ReaderIconButton
              label="Next page (→)"
              onClick={goNext}
              disabled={pageNum >= totalPages}
            >
              <IconChevronRight size={17} />
            </ReaderIconButton>
          </div>
        </div>
      )}
    </ReaderShell>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">{children}</div>
  );
}
